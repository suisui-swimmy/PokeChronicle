import type {
  BattleEvent,
  NormalizedRoi,
  OCRLine,
  OCRMessage,
  OCRRecognitionCandidateTrace,
  UnknownEvent,
} from "./schema";
import {
  getParsedBattleEvents,
  type BattleMessageParseResult,
  type ParsedBattleEvent,
} from "../parser/seedParser";

export const DEFAULT_TIMELINE_DUPLICATE_WINDOW_MS = 2500;
const SIDE_EFFECT_CONTEXT_WINDOW_MS = 6000;

export interface TimelineObservationInput {
  id: string;
  battleId: string;
  rawText: string;
  parseResult: BattleMessageParseResult;
  ocrConfidence: number | null;
  lines: readonly OCRLine[];
  frameIndex: number | null;
  timestampMs: number;
  roi: NormalizedRoi;
  afterEventId: string | null;
  recentConstrainedCandidates?: readonly TimelineConstrainedCandidateRecord[];
  recentAcceptedEvents?: readonly TimelineAcceptedEventRecord[];
  candidatePromotionWindowMs?: number;
  recognitionCandidates?: readonly OCRRecognitionCandidateTrace[];
}

export interface TimelineDeduplicationRecord {
  id: string;
  key: string;
  kind: "event" | "unknown";
  timestampMs: number;
  frameIndex: number | null;
}

export interface TimelineObservation {
  ocrMessage: OCRMessage;
  events: BattleEvent[];
  event: BattleEvent | null;
  unknown: UnknownEvent | null;
  dedupes: TimelineDeduplicationRecord[];
  dedupe: TimelineDeduplicationRecord | null;
}

export interface TimelineConstrainedCandidateRecord {
  identity: string;
  timestampMs: number;
  frameIndex: number | null;
}

export interface TimelineAcceptedEventRecord {
  eventType: BattleEvent["type"];
  actorName: string | null;
  actorSide: BattleEvent["actor"]["side"];
  templateId: string | null;
  timestampMs: number;
  frameIndex: number | null;
}

interface ParsedConstrainedCandidateMatch {
  identity: string;
  eventType: BattleEvent["type"];
  actorName: string | null;
  actorSide: BattleEvent["actor"]["side"];
  move: string | null;
  targetName: string | null;
  targetSide: NonNullable<BattleEvent["target"]>["side"] | null;
  templateId: string | null;
  score: number | null;
}

interface ParsedPartialTemplateMatch {
  eventType: BattleEvent["type"];
  actorName: string | null;
  actorSide: BattleEvent["actor"]["side"];
  templateId: string | null;
}

export function createSourceFrameRef(frameIndex: number | null, timestampMs: number) {
  return frameIndex === null ? `time:${timestampMs}` : `frame:${frameIndex}:${timestampMs}`;
}

function countCharacters(value: string) {
  return Array.from(value).length;
}

function containsJapaneseText(value: string) {
  return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(value);
}

function hasCandidateMatchWithPrefix(candidateMatches: readonly string[], prefixes: readonly string[]) {
  return candidateMatches.some((candidate) =>
    prefixes.some((prefix) => candidate.startsWith(prefix)),
  );
}

function hasBattleActionSignal(
  matchText: string,
  candidateMatches: readonly string[],
) {
  if (
    hasCandidateMatchWithPrefix(candidateMatches, [
      "constrained-review:",
      "constrained-candidate;",
      "span:move",
      "span-relation:",
    ])
  ) {
    return true;
  }

  return [
    "効果",
    "繰り出",
    "ゆけ",
    "いけ",
    "戻れ",
    "引っこめ",
    "ひっこめ",
    "倒れ",
    "たおれ",
    "ひんし",
    "守り",
    "身を守",
    "体勢",
    "上がっ",
    "下がっ",
    "治った",
    "なおった",
    "回復",
    "負った",
    "外れ",
    "失敗",
    "命が少し削られ",
    "命か少し削られ",
  ].some((keyword) => matchText.includes(keyword));
}

function isPrefixOnlyBattleFragment(matchText: string) {
  if (matchText === "味方の" || matchText === "相手の") {
    return true;
  }

  return /^(?:相手の)?[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}A-Za-z0-9ー]{2,14}(?:の|は)$/u.test(
    matchText,
  );
}

function isLikelyUiNoiseText(
  matchText: string,
  normalizedText: string,
  candidateMatches: readonly string[],
) {
  if (isPrefixOnlyBattleFragment(matchText)) {
    return true;
  }

  if (hasCandidateMatchWithPrefix(candidateMatches, ["partial-template;"]) && matchText.endsWith("の")) {
    return true;
  }

  if (/(?:^|\D)\d{1,2}\s*[:：]\s*\d{2}(?:\D|$)/u.test(normalizedText)) {
    return true;
  }

  if (["特性", "持ち物", "もちもの", "味方の"].some((hint) => matchText.includes(hint))) {
    return true;
  }

  const characters = Array.from(matchText);

  if (characters.length === 0) {
    return true;
  }

  const symbolCount = characters.filter(
    (character) => !/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}A-Za-z0-9]/u.test(character),
  ).length;

  return symbolCount / characters.length >= 0.45 && !hasBattleActionSignal(matchText, candidateMatches);
}

export function shouldCreateUnknownEvent(input: {
  matchText: string;
  normalizedText: string;
  ocrConfidence: number | null;
  candidateMatches: readonly string[];
}) {
  const matchText = input.matchText.trim();

  if (!matchText) {
    return false;
  }

  const matchTextLength = countCharacters(matchText);
  const hasActionSignal = hasBattleActionSignal(matchText, input.candidateMatches);

  if (isLikelyUiNoiseText(matchText, input.normalizedText, input.candidateMatches)) {
    return false;
  }

  if ((input.ocrConfidence ?? 0) < 0.5 && !hasActionSignal) {
    return false;
  }

  if (matchTextLength >= 6 && (input.ocrConfidence ?? 0) >= 0.7) {
    return true;
  }

  if (input.candidateMatches.length > 0 && matchTextLength >= 3 && hasActionSignal) {
    return true;
  }

  return containsJapaneseText(input.normalizedText) && matchTextLength >= 8;
}

function createResolvedEventDedupeKey(
  event: Pick<BattleEvent, "type" | "actor" | "move" | "target" | "classification">,
) {
  const actor = `${event.actor.side ?? "unknown"}:${event.actor.name ?? ""}`;
  const target = event.target
    ? `${event.target.side ?? "unknown"}:${event.target.name ?? ""}`
    : "";

  return [
    "event",
    event.type,
    actor,
    event.move ?? "",
    target,
    event.classification.templateId ?? "",
  ].join("|");
}

function decodeCandidateValue(value: string | undefined) {
  if (!value) {
    return "";
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseNullableSide(value: string): BattleEvent["actor"]["side"] {
  return value === "player" || value === "opponent" ? value : null;
}

function parseTargetSide(value: string): NonNullable<BattleEvent["target"]>["side"] | null {
  return value === "player" || value === "opponent" ? value : null;
}

function extractConstrainedCandidateMatch(
  candidateMatches: readonly string[],
): ParsedConstrainedCandidateMatch | null {
  const encoded = candidateMatches.find((candidate) =>
    candidate.startsWith("constrained-candidate;"),
  );

  if (!encoded) {
    return null;
  }

  const fields = new Map<string, string>();

  for (const part of encoded.split(";").slice(1)) {
    const separatorIndex = part.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    fields.set(part.slice(0, separatorIndex), part.slice(separatorIndex + 1));
  }

  const identity = decodeCandidateValue(fields.get("identity"));
  const eventType = decodeCandidateValue(fields.get("eventType")) as BattleEvent["type"];
  const templateId = decodeCandidateValue(fields.get("templateId"));

  if (!identity || !eventType || eventType === "unknown") {
    return null;
  }

  const actorName = decodeCandidateValue(fields.get("actorName"));
  const move = decodeCandidateValue(fields.get("move"));
  const targetName = decodeCandidateValue(fields.get("targetName"));
  const rawScore = Number(decodeCandidateValue(fields.get("score")));

  return {
    identity,
    eventType,
    actorName: actorName || null,
    actorSide: parseNullableSide(decodeCandidateValue(fields.get("actorSide"))),
    move: move || null,
    targetName: targetName || null,
    targetSide: parseTargetSide(decodeCandidateValue(fields.get("targetSide"))),
    templateId: templateId || null,
    score: Number.isFinite(rawScore) ? rawScore : null,
  };
}

function extractPartialTemplateMatch(
  candidateMatches: readonly string[],
): ParsedPartialTemplateMatch | null {
  const encoded = candidateMatches.find((candidate) => candidate.startsWith("partial-template;"));

  if (!encoded) {
    return null;
  }

  const fields = new Map<string, string>();

  for (const part of encoded.split(";").slice(1)) {
    const separatorIndex = part.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    fields.set(part.slice(0, separatorIndex), part.slice(separatorIndex + 1));
  }

  const eventType = decodeCandidateValue(fields.get("eventType")) as BattleEvent["type"];
  const actorName = decodeCandidateValue(fields.get("actorName"));
  const templateId = decodeCandidateValue(fields.get("templateId"));

  if (!eventType || eventType === "unknown" || !actorName) {
    return null;
  }

  return {
    eventType,
    actorName,
    actorSide: parseNullableSide(decodeCandidateValue(fields.get("actorSide"))),
    templateId: templateId || null,
  };
}

function getPromotedConstrainedCandidate(
  input: TimelineObservationInput,
): ParsedConstrainedCandidateMatch | null {
  if (input.parseResult.status !== "unknown") {
    return null;
  }

  const candidate = extractConstrainedCandidateMatch(input.parseResult.candidateMatches);

  if (!candidate) {
    return null;
  }

  const windowMs = input.candidatePromotionWindowMs ?? DEFAULT_TIMELINE_DUPLICATE_WINDOW_MS;
  const hasRecentMatch = (input.recentConstrainedCandidates ?? []).some((record) => {
    const deltaMs = input.timestampMs - record.timestampMs;

    return record.identity === candidate.identity && deltaMs >= 0 && deltaMs <= windowMs;
  });

  return hasRecentMatch ? candidate : null;
}

function shouldSuppressPartialTemplateUnknown(input: TimelineObservationInput) {
  if (input.parseResult.status !== "unknown") {
    return false;
  }

  const candidate = extractPartialTemplateMatch(input.parseResult.candidateMatches);

  if (!candidate) {
    return false;
  }

  const windowMs = input.candidatePromotionWindowMs ?? DEFAULT_TIMELINE_DUPLICATE_WINDOW_MS;

  return (input.recentAcceptedEvents ?? []).some((record) => {
    const deltaMs = input.timestampMs - record.timestampMs;
    const templateMatches =
      !candidate.templateId ||
      !record.templateId ||
      candidate.templateId === record.templateId;

    return (
      record.eventType === candidate.eventType &&
      record.actorName === candidate.actorName &&
      record.actorSide === candidate.actorSide &&
      templateMatches &&
      deltaMs >= 0 &&
      deltaMs <= windowMs
    );
  });
}

export function createConstrainedCandidateRecord(
  parseResult: BattleMessageParseResult,
  timestampMs: number,
  frameIndex: number | null,
): TimelineConstrainedCandidateRecord | null {
  const candidate = extractConstrainedCandidateMatch(parseResult.candidateMatches);

  if (!candidate) {
    return null;
  }

  return {
    identity: candidate.identity,
    timestampMs,
    frameIndex,
  };
}

export function createAcceptedEventRecord(
  event: Pick<BattleEvent, "type" | "actor" | "classification" | "source" | "timestampMs">,
): TimelineAcceptedEventRecord {
  return {
    eventType: event.type,
    actorName: event.actor.name,
    actorSide: event.actor.side,
    templateId: event.classification.templateId,
    timestampMs: event.timestampMs,
    frameIndex: event.source.frameIndex,
  };
}

function inferContextualActorSide(
  event: Pick<ParsedBattleEvent, "type" | "actor">,
  input: TimelineObservationInput,
) {
  if (
    event.type !== "side_start" ||
    event.actor.side !== null ||
    !input.parseResult.matchText.includes("追い風")
  ) {
    return event.actor;
  }

  const recentMove = [...(input.recentAcceptedEvents ?? [])]
    .filter((record) => {
      const deltaMs = input.timestampMs - record.timestampMs;

      return (
        record.eventType === "move" &&
        record.actorSide !== null &&
        deltaMs >= 0 &&
        deltaMs <= SIDE_EFFECT_CONTEXT_WINDOW_MS
      );
    })
    .sort((left, right) => right.timestampMs - left.timestampMs)[0];

  return recentMove
    ? { ...event.actor, side: recentMove.actorSide }
    : event.actor;
}

function createBattleEvents(
  input: TimelineObservationInput,
  promotedCandidate: ParsedConstrainedCandidateMatch | null,
): BattleEvent[] {
  if (input.parseResult.status !== "event" && !promotedCandidate) {
    return [];
  }

  if (promotedCandidate) {
    const actor = inferContextualActorSide(
      {
        type: promotedCandidate.eventType,
        actor: {
          name: promotedCandidate.actorName,
          side: promotedCandidate.actorSide,
        },
      },
      input,
    );

    return [{
      id: `evt_${input.id}`,
      battleId: input.battleId,
      turn: null,
      timestampMs: input.timestampMs,
      type: promotedCandidate.eventType,
      actor,
      move: promotedCandidate.move,
      target: promotedCandidate.targetName
        ? {
            name: promotedCandidate.targetName,
            side: promotedCandidate.targetSide,
          }
        : null,
      rawText: input.rawText,
      normalizedText: input.parseResult.normalizedText,
      confidence:
        input.ocrConfidence === null
          ? promotedCandidate.score
          : promotedCandidate.score === null
            ? input.ocrConfidence
            : Math.min(input.ocrConfidence, promotedCandidate.score),
      classification: {
        method: "template_dictionary",
        templateId: promotedCandidate.templateId,
        alternatives: [...input.parseResult.candidateMatches],
      },
      source: {
        frameIndex: input.frameIndex,
        timestampMs: input.timestampMs,
        cropObjectUrl: null,
      },
    }];
  }

  if (input.parseResult.status !== "event") {
    return [];
  }

  const parsedEvents = getParsedBattleEvents(input.parseResult);
  const useSlotIds = parsedEvents.length > 1;

  return parsedEvents.map((event, index) => ({
    id: useSlotIds ? `evt_${input.id}_${index + 1}` : `evt_${input.id}`,
    battleId: input.battleId,
    turn: null,
    timestampMs: input.timestampMs,
    type: event.type,
    actor: inferContextualActorSide(event, input),
    move: event.move,
    target: event.target,
    rawText: input.rawText,
    normalizedText: input.parseResult.normalizedText,
    confidence: event.confidence,
    classification: event.classification,
    source: {
      frameIndex: input.frameIndex,
      timestampMs: input.timestampMs,
      cropObjectUrl: null,
    },
  }));
}

function createUnknownEvent(input: TimelineObservationInput): UnknownEvent | null {
  if (input.parseResult.status !== "unknown" || !input.parseResult.matchText) {
    return null;
  }

  if (
    !shouldCreateUnknownEvent({
      matchText: input.parseResult.matchText,
      normalizedText: input.parseResult.normalizedText,
      ocrConfidence: input.ocrConfidence,
      candidateMatches: input.parseResult.candidateMatches,
    })
  ) {
    return null;
  }

  return {
    id: `unk_${input.id}`,
    battleId: input.battleId,
    timestampMs: input.timestampMs,
    afterEventId: input.afterEventId,
    rawText: input.rawText,
    normalizedText: input.parseResult.normalizedText,
    ocrConfidence: input.ocrConfidence,
    candidateMatches: [...input.parseResult.candidateMatches],
    sourceFrameRef: createSourceFrameRef(input.frameIndex, input.timestampMs),
    reviewStatus: "unreviewed",
  };
}

export function createTimelineObservation(input: TimelineObservationInput): TimelineObservation {
  const ocrMessage: OCRMessage = {
    id: input.id,
    battleId: input.battleId,
    rawText: input.rawText,
    normalizedText: input.parseResult.normalizedText,
    matchText: input.parseResult.matchText,
    ocrConfidence: input.ocrConfidence,
    timestampMs: input.timestampMs,
    frameIndex: input.frameIndex,
    roi: input.roi,
    lines: [...input.lines],
    recognitionCandidates: input.recognitionCandidates
      ? [...input.recognitionCandidates]
      : undefined,
  };
  const promotedCandidate = getPromotedConstrainedCandidate(input);
  const events = createBattleEvents(input, promotedCandidate);
  const event = events[0] ?? null;
  const unknown = events.length > 0 || shouldSuppressPartialTemplateUnknown(input)
    ? null
    : createUnknownEvent(input);
  const dedupes = [
    ...events.map((timelineEvent) => ({
      id: timelineEvent.id,
      key: createResolvedEventDedupeKey(timelineEvent),
      kind: "event" as const,
      timestampMs: input.timestampMs,
      frameIndex: input.frameIndex,
    })),
    ...(unknown && input.parseResult.matchText
      ? [
          {
            id: unknown.id,
            key: `unknown:${input.parseResult.matchText}`,
            kind: "unknown" as const,
            timestampMs: input.timestampMs,
            frameIndex: input.frameIndex,
          },
        ]
      : []),
  ];

  return {
    ocrMessage,
    events,
    event,
    unknown,
    dedupes,
    dedupe: dedupes[0] ?? null,
  };
}

export function shouldSuppressTimelineObservation(
  previous: TimelineDeduplicationRecord | readonly TimelineDeduplicationRecord[] | null,
  next: TimelineDeduplicationRecord | null,
  windowMs = DEFAULT_TIMELINE_DUPLICATE_WINDOW_MS,
) {
  if (!previous || !next) {
    return false;
  }

  const previousRecords = Array.isArray(previous) ? previous : [previous];

  return previousRecords.some((record) => {
    if (record.key !== next.key) {
      return false;
    }

    const deltaMs = next.timestampMs - record.timestampMs;

    return deltaMs >= 0 && deltaMs <= windowMs;
  });
}
