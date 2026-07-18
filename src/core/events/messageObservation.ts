import type {
  MessageObservation,
  MessageObservationFailureReason,
  MessageObservationSummary,
} from "./schema";
import {
  getMessageMaskFingerprintDistance,
  type MessageMaskFingerprint,
} from "../preprocess/messagePreprocess";

export interface MessageWatcherConfig {
  recentPresenceWindowSize: number;
  presenceSamplesRequired: number;
  absenceSamplesRequired: number;
  changedFingerprintSamplesRequired: number;
  fingerprintMaxDistance: number;
  staleTimeoutMs: number;
  bestEvidenceMinScoreDelta: number;
}

export const DEFAULT_MESSAGE_WATCHER_CONFIG: MessageWatcherConfig = {
  recentPresenceWindowSize: 3,
  presenceSamplesRequired: 2,
  absenceSamplesRequired: 2,
  changedFingerprintSamplesRequired: 2,
  fingerprintMaxDistance: 0.16,
  staleTimeoutMs: 15_000,
  bestEvidenceMinScoreDelta: 0.05,
};

export interface MessageWatcherPresenceAnalysis {
  present: boolean;
  presenceScore: number;
  fingerprint: MessageMaskFingerprint | null;
}

export interface MessageWatcherSample {
  timestampMs: number;
  frameIndex: number;
  analysis: MessageWatcherPresenceAnalysis;
}

interface MessageWatcherPresenceSample {
  timestampMs: number;
  frameIndex: number;
  presenceScore: number;
  fingerprint: MessageMaskFingerprint;
}

export interface MessageWatcherActiveObservation {
  id: string;
  fingerprint: MessageMaskFingerprint;
  openedAtMs: number;
  frameStart: number;
  maxPresenceScore: number;
  bestFrameIndex: number;
}

interface MessageWatcherChangedCandidate {
  fingerprint: MessageMaskFingerprint;
  count: number;
  firstTimestampMs: number;
  firstFrameIndex: number;
  maxPresenceScore: number;
  bestFrameIndex: number;
}

export interface MessageWatcherState {
  activeObservation: MessageWatcherActiveObservation | null;
  recentSamples: Array<MessageWatcherPresenceSample | null>;
  absenceStreak: number;
  changedCandidate: MessageWatcherChangedCandidate | null;
}

export type MessageWatcherCloseReason =
  | "absence"
  | "fingerprint_changed"
  | "stale"
  | "analysis_stopped"
  | "media_ended"
  | "stream_stopped";

export type MessageWatcherTransition =
  | {
      type: "opened";
      id: string;
      fingerprint: MessageMaskFingerprint;
      openedAtMs: number;
      frameStart: number;
      maxPresenceScore: number;
      bestFrameIndex: number;
    }
  | {
      type: "updated";
      id: string;
      maxPresenceScore: number;
      bestFrameIndex: number;
    }
  | {
      type: "closed";
      id: string;
      closedAtMs: number;
      frameEnd: number;
      reason: MessageWatcherCloseReason;
    };

export interface MessageWatcherAdvanceResult {
  state: MessageWatcherState;
  transitions: MessageWatcherTransition[];
}

export interface CreateMessageObservationInput {
  id: string;
  battleId: string;
  openedAtMs: number;
  frameStart: number;
  visualFingerprint: MessageMaskFingerprint;
  presenceScore: number;
  bestFrameIndex?: number | null;
  bestEvidenceRef?: string | null;
  openedWhileOcrBusy?: boolean;
}

export interface CloseMessageObservationInput {
  closedAtMs: number;
  frameEnd: number;
}

export interface MessageObservationBestEvidenceInput {
  presenceScore: number;
  frameIndex: number;
  evidenceRef: string | null;
}

export interface SettleMessageObservationUnreadInput {
  pendingOcrJobCount: number;
  hasUsableOcrText: boolean;
  failureReason?: MessageObservationFailureReason;
}

export interface ResolveMessageObservationInput {
  ocrMessageId?: string | null;
  eventIds?: readonly string[];
  unknownEventIds?: readonly string[];
}

const FAILURE_REASON_PRIORITY: Record<Exclude<MessageObservationFailureReason, null>, number> = {
  ocr_busy: 1,
  no_ocr_attempt: 2,
  preprocess_rejected: 3,
  density_rejected: 3,
  ocr_empty: 4,
  ocr_deferred_dropped: 5,
  ocr_timeout: 6,
  ocr_error: 7,
  parser_unknown: 8,
};

function cloneFingerprint(fingerprint: MessageMaskFingerprint): MessageMaskFingerprint {
  return {
    ...fingerprint,
    cells: [...fingerprint.cells],
  };
}

function areWatcherFingerprintsSimilar(
  left: MessageMaskFingerprint,
  right: MessageMaskFingerprint,
  config: MessageWatcherConfig,
) {
  return getMessageMaskFingerprintDistance(left, right) <= config.fingerprintMaxDistance;
}

function createWatcherPresenceSample(sample: MessageWatcherSample) {
  if (!sample.analysis.present || !sample.analysis.fingerprint) {
    return null;
  }

  return {
    timestampMs: sample.timestampMs,
    frameIndex: sample.frameIndex,
    presenceScore: sample.analysis.presenceScore,
    fingerprint: cloneFingerprint(sample.analysis.fingerprint),
  };
}

function createOpenedWatcherTransition(
  id: string,
  samples: readonly MessageWatcherPresenceSample[],
) {
  const firstSample = samples.reduce((earliest, sample) =>
    sample.timestampMs < earliest.timestampMs ? sample : earliest,
  );
  const bestSample = samples.reduce((best, sample) =>
    sample.presenceScore > best.presenceScore ? sample : best,
  );
  const transition: Extract<MessageWatcherTransition, { type: "opened" }> = {
    type: "opened",
    id,
    fingerprint: cloneFingerprint(bestSample.fingerprint),
    openedAtMs: firstSample.timestampMs,
    frameStart: firstSample.frameIndex,
    maxPresenceScore: bestSample.presenceScore,
    bestFrameIndex: bestSample.frameIndex,
  };

  return transition;
}

function createActiveWatcherObservation(
  transition: Extract<MessageWatcherTransition, { type: "opened" }>,
): MessageWatcherActiveObservation {
  return {
    id: transition.id,
    fingerprint: cloneFingerprint(transition.fingerprint),
    openedAtMs: transition.openedAtMs,
    frameStart: transition.frameStart,
    maxPresenceScore: transition.maxPresenceScore,
    bestFrameIndex: transition.bestFrameIndex,
  };
}

function createClosedWatcherTransition(
  active: MessageWatcherActiveObservation,
  timestampMs: number,
  frameIndex: number,
  reason: MessageWatcherCloseReason,
): Extract<MessageWatcherTransition, { type: "closed" }> {
  return {
    type: "closed",
    id: active.id,
    closedAtMs: Math.max(active.openedAtMs, timestampMs),
    frameEnd: Math.max(active.frameStart, frameIndex),
    reason,
  };
}

function createEmptyWatcherState(): MessageWatcherState {
  return {
    activeObservation: null,
    recentSamples: [],
    absenceStreak: 0,
    changedCandidate: null,
  };
}

export function createInitialMessageWatcherState(): MessageWatcherState {
  return createEmptyWatcherState();
}

function advanceEmptyMessageWatcher(
  state: MessageWatcherState,
  sample: MessageWatcherSample,
  nextObservationId: string,
  config: MessageWatcherConfig,
): MessageWatcherAdvanceResult {
  const presenceSample = createWatcherPresenceSample(sample);
  const recentSamples = [...state.recentSamples, presenceSample].slice(
    -config.recentPresenceWindowSize,
  );

  if (!presenceSample) {
    return {
      state: {
        ...state,
        recentSamples,
      },
      transitions: [],
    };
  }

  const similarSamples = recentSamples.filter(
    (candidate): candidate is MessageWatcherPresenceSample =>
      candidate !== null &&
      areWatcherFingerprintsSimilar(
        presenceSample.fingerprint,
        candidate.fingerprint,
        config,
      ),
  );

  if (similarSamples.length < config.presenceSamplesRequired) {
    return {
      state: {
        ...state,
        recentSamples,
      },
      transitions: [],
    };
  }

  const opened = createOpenedWatcherTransition(nextObservationId, similarSamples);

  return {
    state: {
      activeObservation: createActiveWatcherObservation(opened),
      recentSamples: [],
      absenceStreak: 0,
      changedCandidate: null,
    },
    transitions: [opened],
  };
}

function createChangedCandidate(
  sample: MessageWatcherPresenceSample,
): MessageWatcherChangedCandidate {
  return {
    fingerprint: cloneFingerprint(sample.fingerprint),
    count: 1,
    firstTimestampMs: sample.timestampMs,
    firstFrameIndex: sample.frameIndex,
    maxPresenceScore: sample.presenceScore,
    bestFrameIndex: sample.frameIndex,
  };
}

export function advanceMessageWatcher(
  state: MessageWatcherState,
  sample: MessageWatcherSample,
  nextObservationId: string,
  config: MessageWatcherConfig = DEFAULT_MESSAGE_WATCHER_CONFIG,
): MessageWatcherAdvanceResult {
  const active = state.activeObservation;

  if (!active) {
    return advanceEmptyMessageWatcher(state, sample, nextObservationId, config);
  }

  if (sample.timestampMs - active.openedAtMs >= config.staleTimeoutMs) {
    const closed = createClosedWatcherTransition(
      active,
      sample.timestampMs,
      sample.frameIndex,
      "stale",
    );
    const nextState = createEmptyWatcherState();
    const advanced = advanceEmptyMessageWatcher(
      nextState,
      sample,
      nextObservationId,
      config,
    );

    return {
      state: advanced.state,
      transitions: [closed, ...advanced.transitions],
    };
  }

  const presenceSample = createWatcherPresenceSample(sample);

  if (!presenceSample) {
    const absenceStreak = state.absenceStreak + 1;

    if (absenceStreak >= config.absenceSamplesRequired) {
      return {
        state: createEmptyWatcherState(),
        transitions: [
          createClosedWatcherTransition(active, sample.timestampMs, sample.frameIndex, "absence"),
        ],
      };
    }

    return {
      state: {
        ...state,
        absenceStreak,
        changedCandidate: null,
      },
      transitions: [],
    };
  }

  if (areWatcherFingerprintsSimilar(active.fingerprint, presenceSample.fingerprint, config)) {
    const scoreDelta = presenceSample.presenceScore - active.maxPresenceScore;

    if (scoreDelta >= config.bestEvidenceMinScoreDelta) {
      const nextActive = {
        ...active,
        maxPresenceScore: presenceSample.presenceScore,
        bestFrameIndex: presenceSample.frameIndex,
      };

      return {
        state: {
          ...state,
          activeObservation: nextActive,
          absenceStreak: 0,
          changedCandidate: null,
        },
        transitions: [
          {
            type: "updated",
            id: active.id,
            maxPresenceScore: nextActive.maxPresenceScore,
            bestFrameIndex: nextActive.bestFrameIndex,
          },
        ],
      };
    }

    return {
      state: {
        ...state,
        absenceStreak: 0,
        changedCandidate: null,
      },
      transitions: [],
    };
  }

  const changedCandidate =
    state.changedCandidate &&
    areWatcherFingerprintsSimilar(
      state.changedCandidate.fingerprint,
      presenceSample.fingerprint,
      config,
    )
      ? {
          ...state.changedCandidate,
          count: state.changedCandidate.count + 1,
          ...(presenceSample.presenceScore > state.changedCandidate.maxPresenceScore
            ? {
                fingerprint: cloneFingerprint(presenceSample.fingerprint),
                maxPresenceScore: presenceSample.presenceScore,
                bestFrameIndex: presenceSample.frameIndex,
              }
            : {}),
        }
      : createChangedCandidate(presenceSample);

  if (changedCandidate.count < config.changedFingerprintSamplesRequired) {
    return {
      state: {
        ...state,
        absenceStreak: 0,
        changedCandidate,
      },
      transitions: [],
    };
  }

  const opened = createOpenedWatcherTransition(nextObservationId, [
    {
      timestampMs: changedCandidate.firstTimestampMs,
      frameIndex: changedCandidate.firstFrameIndex,
      presenceScore: changedCandidate.maxPresenceScore,
      fingerprint: changedCandidate.fingerprint,
    },
    presenceSample,
  ]);

  return {
    state: {
      activeObservation: createActiveWatcherObservation(opened),
      recentSamples: [],
      absenceStreak: 0,
      changedCandidate: null,
    },
    transitions: [
      createClosedWatcherTransition(
        active,
        sample.timestampMs,
        sample.frameIndex,
        "fingerprint_changed",
      ),
      opened,
    ],
  };
}

export function closeActiveMessageWatcher(
  state: MessageWatcherState,
  input: {
    timestampMs: number;
    frameIndex: number;
    reason: Extract<
      MessageWatcherCloseReason,
      "analysis_stopped" | "media_ended" | "stream_stopped"
    >;
  },
  _config: MessageWatcherConfig = DEFAULT_MESSAGE_WATCHER_CONFIG,
): MessageWatcherAdvanceResult {
  if (!state.activeObservation) {
    return {
      state: createEmptyWatcherState(),
      transitions: [],
    };
  }

  return {
    state: createEmptyWatcherState(),
    transitions: [
      createClosedWatcherTransition(
        state.activeObservation,
        input.timestampMs,
        input.frameIndex,
        input.reason,
      ),
    ],
  };
}

function appendUnique(current: readonly string[], values: readonly string[]) {
  if (values.length === 0) {
    return [...current];
  }

  return [...new Set([...current, ...values])];
}

function appendOptionalId(current: readonly string[], value: string | null | undefined) {
  return value ? appendUnique(current, [value]) : [...current];
}

function selectFailureReason(
  current: MessageObservationFailureReason,
  next: MessageObservationFailureReason,
) {
  if (next === null) {
    return current;
  }

  if (current === null) {
    return next;
  }

  return FAILURE_REASON_PRIORITY[next] >= FAILURE_REASON_PRIORITY[current] ? next : current;
}

export function createMessageObservation(
  input: CreateMessageObservationInput,
): MessageObservation {
  return {
    id: input.id,
    battleId: input.battleId,
    openedAtMs: input.openedAtMs,
    closedAtMs: null,
    frameStart: input.frameStart,
    frameEnd: null,
    lifecycle: "active",
    resolution: "pending",
    visualFingerprint: {
      ...input.visualFingerprint,
      cells: [...input.visualFingerprint.cells],
    },
    maxPresenceScore: input.presenceScore,
    bestFrameIndex: input.bestFrameIndex ?? null,
    bestEvidenceRef: input.bestEvidenceRef ?? null,
    ocrAttemptCount: 0,
    ocrMessageIds: [],
    eventIds: [],
    unknownEventIds: [],
    failureReason: null,
    openedWhileOcrBusy: input.openedWhileOcrBusy ?? false,
  };
}

export function closeMessageObservation(
  observation: MessageObservation,
  input: CloseMessageObservationInput,
): MessageObservation {
  if (observation.lifecycle === "closed") {
    return observation;
  }

  return {
    ...observation,
    lifecycle: "closed",
    closedAtMs: Math.max(observation.openedAtMs, input.closedAtMs),
    frameEnd: Math.max(observation.frameStart, input.frameEnd),
  };
}

export function updateMessageObservationBestEvidence(
  observation: MessageObservation,
  input: MessageObservationBestEvidenceInput,
): MessageObservation {
  if (input.presenceScore <= observation.maxPresenceScore) {
    return observation;
  }

  return {
    ...observation,
    maxPresenceScore: input.presenceScore,
    bestFrameIndex: input.frameIndex,
    bestEvidenceRef: input.evidenceRef ?? observation.bestEvidenceRef,
  };
}

export function recordMessageObservationOcrAttempt(
  observation: MessageObservation,
): MessageObservation {
  return {
    ...observation,
    ocrAttemptCount: observation.ocrAttemptCount + 1,
  };
}

export function attachMessageObservationOcrMessage(
  observation: MessageObservation,
  ocrMessageId: string | null | undefined,
): MessageObservation {
  if (!ocrMessageId || observation.ocrMessageIds.includes(ocrMessageId)) {
    return observation;
  }

  return {
    ...observation,
    ocrMessageIds: [...observation.ocrMessageIds, ocrMessageId],
  };
}

export function recordMessageObservationFailure(
  observation: MessageObservation,
  failureReason: Exclude<MessageObservationFailureReason, null>,
): MessageObservation {
  if (observation.resolution === "resolved" || observation.resolution === "ocr_unknown") {
    return observation;
  }

  const nextFailureReason = selectFailureReason(observation.failureReason, failureReason);

  if (nextFailureReason === observation.failureReason) {
    return observation;
  }

  return {
    ...observation,
    failureReason: nextFailureReason,
  };
}

export function settleMessageObservationUnread(
  observation: MessageObservation,
  input: SettleMessageObservationUnreadInput,
): MessageObservation {
  if (
    observation.lifecycle !== "closed" ||
    input.pendingOcrJobCount > 0 ||
    input.hasUsableOcrText ||
    observation.resolution === "resolved" ||
    observation.resolution === "ocr_unknown"
  ) {
    return observation;
  }

  const attemptedFailureReason =
    input.failureReason ??
    observation.failureReason ??
    (observation.ocrAttemptCount > 0 ? "ocr_empty" : "no_ocr_attempt");

  return {
    ...observation,
    resolution: "unread",
    failureReason: selectFailureReason(observation.failureReason, attemptedFailureReason),
  };
}

export function resolveMessageObservationAsOcrUnknown(
  observation: MessageObservation,
  input: ResolveMessageObservationInput = {},
): MessageObservation {
  if (observation.resolution === "resolved") {
    return observation;
  }

  return {
    ...observation,
    resolution: "ocr_unknown",
    ocrMessageIds: appendOptionalId(observation.ocrMessageIds, input.ocrMessageId),
    unknownEventIds: appendUnique(
      observation.unknownEventIds,
      input.unknownEventIds ?? [],
    ),
    failureReason: "parser_unknown",
  };
}

export function resolveMessageObservationWithEvents(
  observation: MessageObservation,
  input: ResolveMessageObservationInput,
): MessageObservation {
  const eventIds = input.eventIds ?? [];

  if (eventIds.length === 0) {
    return observation;
  }

  return {
    ...observation,
    resolution: "resolved",
    ocrMessageIds: appendOptionalId(observation.ocrMessageIds, input.ocrMessageId),
    eventIds: appendUnique(observation.eventIds, eventIds),
    failureReason: null,
  };
}

export function createEmptyMessageObservationSummary(): MessageObservationSummary {
  return {
    detectedCount: 0,
    resolvedCount: 0,
    ocrUnknownCount: 0,
    unreadCount: 0,
    openedWhileOcrBusyCount: 0,
  };
}

export function summarizeMessageObservations(
  observations: readonly MessageObservation[],
): MessageObservationSummary {
  const summary = createEmptyMessageObservationSummary();

  for (const observation of observations) {
    summary.detectedCount += 1;
    summary.openedWhileOcrBusyCount += observation.openedWhileOcrBusy ? 1 : 0;

    if (observation.resolution === "resolved") {
      summary.resolvedCount += 1;
    } else if (observation.resolution === "ocr_unknown") {
      summary.ocrUnknownCount += 1;
    } else if (observation.resolution === "unread") {
      summary.unreadCount += 1;
    }
  }

  return summary;
}
