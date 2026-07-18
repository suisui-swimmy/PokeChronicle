import { normalizedSimilarity } from "../dictionary/fuzzyMatch";
import { createOcrMatchText } from "../normalize/ocrText";
import { getMessageMaskFingerprintDistance } from "../preprocess/messagePreprocess";
import {
  inferMessageObservationDisposition,
  shouldShowObservationInPrimaryLog,
} from "./messageObservation";
import type {
  BattleEvent,
  MessageObservation,
  OCRMessage,
} from "./schema";

export interface ObservationMergeConfig {
  maximumTimeGapMs: number;
  minimumTextSimilarity: number;
  minimumVisualSimilarity: number;
  minimumScore: number;
}

export const DEFAULT_OBSERVATION_MERGE_CONFIG: Readonly<
  ObservationMergeConfig
> = {
  maximumTimeGapMs: 1_500,
  minimumTextSimilarity: 0.66,
  minimumVisualSimilarity: 0.58,
  minimumScore: 0.72,
};

export interface ObservationMergeDecision {
  merge: boolean;
  targetObservationId: string | null;
  secondaryObservationId: string | null;
  score: number;
  reasons: string[];
}

export type PrimaryLiveLogItem =
  | {
      kind: "observation";
      id: string;
      timestampMs: number;
      observation: MessageObservation;
      events: BattleEvent[];
    }
  | {
      kind: "legacy_event";
      id: string;
      timestampMs: number;
      event: BattleEvent;
    };

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function getObservationEndMs(observation: MessageObservation) {
  return observation.closedAtMs ?? observation.openedAtMs;
}

function getObservationTexts(
  observation: MessageObservation,
  ocrMessages: readonly OCRMessage[],
  events: readonly BattleEvent[],
) {
  const ocrMessageIds = new Set(observation.ocrMessageIds);
  const eventIds = new Set(observation.eventIds);

  return unique([
    ...ocrMessages
      .filter(
        (message) =>
          ocrMessageIds.has(message.id) ||
          message.observationId === observation.id,
      )
      .flatMap((message) => [
        createOcrMatchText(message.normalizedText),
        createOcrMatchText(message.rawText),
      ]),
    ...events
      .filter(
        (event) =>
          eventIds.has(event.id) ||
          event.observationId === observation.id,
      )
      .flatMap((event) => [
        createOcrMatchText(event.normalizedText),
        createOcrMatchText(event.rawText),
      ]),
  ]).filter(Boolean);
}

function getObservationEvents(
  observation: MessageObservation,
  events: readonly BattleEvent[],
) {
  const eventIds = new Set(observation.eventIds);

  return events.filter(
    (event) =>
      eventIds.has(event.id) ||
      event.observationId === observation.id,
  );
}

function createEventIdentity(event: BattleEvent) {
  return [
    event.type,
    event.actor.side ?? "",
    event.actor.name ?? "",
    event.move ?? "",
    event.target?.side ?? "",
    event.target?.name ?? "",
  ].join("|");
}

function getMaximumTextSimilarity(
  leftTexts: readonly string[],
  rightTexts: readonly string[],
) {
  let best = 0;

  for (const left of leftTexts) {
    for (const right of rightTexts) {
      best = Math.max(best, normalizedSimilarity(left, right));
    }
  }

  return best;
}

function textContainsFuzzyEntity(text: string, entity: string) {
  if (text.includes(entity)) {
    return true;
  }

  const textCharacters = Array.from(text);
  const entityLength = Array.from(entity).length;

  for (
    let windowLength = Math.max(2, entityLength - 1);
    windowLength <= entityLength + 1;
    windowLength += 1
  ) {
    for (
      let start = 0;
      start + windowLength <= textCharacters.length;
      start += 1
    ) {
      if (
        normalizedSimilarity(
          textCharacters.slice(start, start + windowLength).join(""),
          entity,
        ) >= 0.66
      ) {
        return true;
      }
    }
  }

  return false;
}

function getResolvedIdentityKeys(event: BattleEvent) {
  if (event.move) {
    return [createOcrMatchText(event.move)];
  }

  if (event.actor.name) {
    return [createOcrMatchText(event.actor.name)];
  }

  if (event.target?.name) {
    return [createOcrMatchText(event.target.name)];
  }

  return [];
}

function getResolvedIdentitySignal(
  resolvedEvents: readonly BattleEvent[],
  otherTexts: readonly string[],
) {
  const identityKeys = unique(
    resolvedEvents.flatMap(getResolvedIdentityKeys),
  ).filter((key) => key.length >= 2);

  return {
    required: identityKeys.length > 0,
    matched: identityKeys.some((key) =>
      otherTexts.some((text) => textContainsFuzzyEntity(text, key)),
    ),
  };
}

function hasInterveningResolvedObservation(
  left: MessageObservation,
  right: MessageObservation,
  observations: readonly MessageObservation[],
) {
  const minOpenedAt = Math.min(left.openedAtMs, right.openedAtMs);
  const maxOpenedAt = Math.max(left.openedAtMs, right.openedAtMs);

  return observations.some(
    (observation) =>
      observation.id !== left.id &&
      observation.id !== right.id &&
      observation.openedAtMs > minOpenedAt &&
      observation.openedAtMs < maxOpenedAt &&
      observation.resolution === "resolved" &&
      inferMessageObservationDisposition(observation) !== "suppressed",
  );
}

export function decideObservationMerge(input: {
  candidate: MessageObservation;
  observations: readonly MessageObservation[];
  ocrMessages: readonly OCRMessage[];
  events: readonly BattleEvent[];
  config?: ObservationMergeConfig;
}): ObservationMergeDecision {
  const config = input.config ?? DEFAULT_OBSERVATION_MERGE_CONFIG;
  let bestDecision: ObservationMergeDecision = {
    merge: false,
    targetObservationId: null,
    secondaryObservationId: null,
    score: 0,
    reasons: [],
  };

  for (const other of input.observations) {
    if (
      other.id === input.candidate.id ||
      other.mergedIntoObservationId ||
      input.candidate.mergedIntoObservationId
    ) {
      continue;
    }

    const candidateResolved =
      input.candidate.resolution === "resolved";
    const otherResolved = other.resolution === "resolved";

    if (candidateResolved === otherResolved) {
      continue;
    }

    const target = candidateResolved ? input.candidate : other;
    const secondary = candidateResolved ? other : input.candidate;
    const timeGapMs = Math.max(
      0,
      Math.max(target.openedAtMs, secondary.openedAtMs) -
        Math.min(
          getObservationEndMs(target),
          getObservationEndMs(secondary),
        ),
    );

    if (
      timeGapMs > config.maximumTimeGapMs ||
      hasInterveningResolvedObservation(
        target,
        secondary,
        input.observations,
      )
    ) {
      continue;
    }

    const targetEvents = getObservationEvents(target, input.events);
    const secondaryEvents = getObservationEvents(
      secondary,
      input.events,
    );

    if (
      targetEvents.length > 0 &&
      secondaryEvents.length > 0 &&
      unique(targetEvents.map(createEventIdentity)).join("||") !==
        unique(secondaryEvents.map(createEventIdentity)).join("||")
    ) {
      continue;
    }

    const targetTexts = getObservationTexts(
      target,
      input.ocrMessages,
      input.events,
    );
    const secondaryTexts = getObservationTexts(
      secondary,
      input.ocrMessages,
      input.events,
    );
    const textSimilarity = getMaximumTextSimilarity(
      targetTexts,
      secondaryTexts,
    );
    const fingerprintDistance = getMessageMaskFingerprintDistance(
      target.visualFingerprint,
      secondary.visualFingerprint,
    );
    const visualSimilarity = 1 - fingerprintDistance;
    const identitySignal = getResolvedIdentitySignal(
      targetEvents,
      secondaryTexts,
    );

    if (
      textSimilarity < config.minimumTextSimilarity ||
      visualSimilarity < config.minimumVisualSimilarity ||
      (identitySignal.required && !identitySignal.matched)
    ) {
      continue;
    }

    const reasons = [
      "nearby",
      `text:${textSimilarity.toFixed(2)}`,
      `visual:${visualSimilarity.toFixed(2)}`,
      ...(identitySignal.matched ? ["resolved-identity"] : []),
    ];
    const score = Math.min(
      1,
      0.2 +
        textSimilarity * 0.35 +
        visualSimilarity * 0.2 +
        0.1 +
        (identitySignal.matched ? 0.15 : 0),
    );

    if (
      score >= config.minimumScore &&
      score > bestDecision.score
    ) {
      bestDecision = {
        merge: true,
        targetObservationId: target.id,
        secondaryObservationId: secondary.id,
        score,
        reasons,
      };
    }
  }

  return bestDecision;
}

export function mergeMessageObservationPair(
  target: MessageObservation,
  secondary: MessageObservation,
) {
  const secondaryHasBetterEvidence =
    secondary.maxPresenceScore > target.maxPresenceScore;
  const mergedTarget: MessageObservation = {
    ...target,
    openedAtMs: Math.min(target.openedAtMs, secondary.openedAtMs),
    closedAtMs:
      target.closedAtMs === null || secondary.closedAtMs === null
        ? null
        : Math.max(target.closedAtMs, secondary.closedAtMs),
    frameStart: Math.min(target.frameStart, secondary.frameStart),
    frameEnd:
      target.frameEnd === null || secondary.frameEnd === null
        ? null
        : Math.max(target.frameEnd, secondary.frameEnd),
    lifecycle:
      target.lifecycle === "active" || secondary.lifecycle === "active"
        ? "active"
        : "closed",
    maxPresenceScore: Math.max(
      target.maxPresenceScore,
      secondary.maxPresenceScore,
    ),
    bestFrameIndex: secondaryHasBetterEvidence
      ? secondary.bestFrameIndex
      : target.bestFrameIndex,
    bestEvidenceRef: secondaryHasBetterEvidence
      ? secondary.bestEvidenceRef
      : target.bestEvidenceRef,
    ocrAttemptCount:
      target.ocrAttemptCount + secondary.ocrAttemptCount,
    ocrMessageIds: unique([
      ...target.ocrMessageIds,
      ...secondary.ocrMessageIds,
    ]),
    eventIds: unique([...target.eventIds, ...secondary.eventIds]),
    unknownEventIds: unique([
      ...target.unknownEventIds,
      ...secondary.unknownEventIds,
    ]),
    disposition: "primary",
    suppressionReason: null,
    mergedIntoObservationId: null,
  };
  const mergedSecondary: MessageObservation = {
    ...secondary,
    disposition: "suppressed",
    suppressionReason: "merged_duplicate",
    mergedIntoObservationId: target.id,
  };

  return { target: mergedTarget, secondary: mergedSecondary };
}

export function selectPrimaryLiveLogItems(input: {
  observations: readonly MessageObservation[];
  events: readonly BattleEvent[];
  limit: number;
}): PrimaryLiveLogItem[] {
  const associatedEventIds = new Set<string>();
  const observationItems = input.observations
    .filter(shouldShowObservationInPrimaryLog)
    .map((observation): PrimaryLiveLogItem => {
      const declaredEventIds = new Set(observation.eventIds);
      const events = input.events.filter(
        (event) =>
          declaredEventIds.has(event.id) ||
          event.observationId === observation.id,
      );

      events.forEach((event) => associatedEventIds.add(event.id));

      return {
        kind: "observation",
        id: `observation:${observation.id}`,
        timestampMs: observation.openedAtMs,
        observation,
        events,
      };
    });
  const legacyEventItems = input.events
    .filter((event) => !associatedEventIds.has(event.id))
    .map(
      (event): PrimaryLiveLogItem => ({
        kind: "legacy_event",
        id: `event:${event.id}`,
        timestampMs: event.timestampMs,
        event,
      }),
    );

  return [...observationItems, ...legacyEventItems]
    .sort(
      (left, right) =>
        right.timestampMs - left.timestampMs ||
        right.id.localeCompare(left.id),
    )
    .slice(0, Math.max(0, input.limit));
}
