import type {
  MessageObservation,
  MessageObservationDisposition,
  MessageObservationFailureReason,
  MessageObservationSummary,
  MessageObservationSuppressionReason,
  UnknownEventGateReason,
} from "./schema";
import {
  compareMessageVisualSignatures,
  type MessageVisualComparison,
  type MessageVisualSignature,
} from "../preprocess/messagePresenceDetection";
import {
  getMessageMaskFingerprintDistance,
  type MessageMaskFingerprint,
} from "../preprocess/messagePreprocess";

export interface MessageWatcherConfig {
  candidateWindowSamples: number;
  candidateRequiredPresenceSamples: number;
  candidateMinDurationMs: number;
  candidateMaxDurationMs: number;
  candidateAbsenceSamplesRequired: number;
  minimumPresenceScore: number;
  minimumCommitScore: number;
  minimumLineBandCount: number;
  minimumComponentCount: number;
  maximumLargestComponentRatio: number;
  minimumDynamicForegroundRatio: number;
  maximumPersistentUiOverlapRatio: number;
  smallSingleLineMaximumWidthRatio: number;
  smallSingleLineHoldDurationMs: number;
  activeAbsenceSamples: number;
  switchStableSamples: number;
  minimumActiveBeforeSwitchMs: number;
  sameFingerprintDistance: number;
  switchFingerprintDistance: number;
  switchMaximumContainment: number;
  staleTimeoutMs: number;
  bestEvidenceMinScoreDelta: number;
}

export const DEFAULT_MESSAGE_WATCHER_CONFIG: Readonly<MessageWatcherConfig> = {
  candidateWindowSamples: 5,
  candidateRequiredPresenceSamples: 3,
  candidateMinDurationMs: 250,
  candidateMaxDurationMs: 900,
  candidateAbsenceSamplesRequired: 2,
  minimumPresenceScore: 0.35,
  minimumCommitScore: 0.45,
  minimumLineBandCount: 1,
  minimumComponentCount: 1,
  maximumLargestComponentRatio: 0.72,
  minimumDynamicForegroundRatio: 0.3,
  maximumPersistentUiOverlapRatio: 0.7,
  smallSingleLineMaximumWidthRatio: 0.45,
  smallSingleLineHoldDurationMs: 650,
  activeAbsenceSamples: 3,
  switchStableSamples: 4,
  minimumActiveBeforeSwitchMs: 350,
  sameFingerprintDistance: 0.22,
  switchFingerprintDistance: 0.28,
  switchMaximumContainment: 0.7,
  staleTimeoutMs: 15_000,
  bestEvidenceMinScoreDelta: 0.05,
};

export interface MessageWatcherPresenceAnalysis {
  present: boolean;
  presenceScore: number;
  fingerprint: MessageMaskFingerprint | null;
  visualSignature?: MessageVisualSignature | null;
  lineBandCount?: number;
  componentCount?: number;
  largestComponentRatio?: number;
  persistentUiOverlapRatio?: number;
  dynamicForegroundRatio?: number;
  persistentUiModelWarmedUp?: boolean;
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
  visualSignature: MessageVisualSignature;
  lineBandCount: number;
  componentCount: number;
  largestComponentRatio: number;
  persistentUiOverlapRatio: number;
  dynamicForegroundRatio: number;
  persistentUiModelWarmedUp: boolean;
}

export interface MessageWatcherCandidate {
  id: string;
  startedAtMs: number;
  frameStart: number;
  signature: MessageVisualSignature;
  samples: Array<MessageWatcherPresenceSample | null>;
  presenceSampleCount: number;
  absenceStreak: number;
  maxPresenceScore: number;
  bestFrameIndex: number;
  bestFingerprint: MessageMaskFingerprint;
  commitScore: number;
}

export interface MessageWatcherActiveObservation {
  id: string;
  signature: MessageVisualSignature;
  openedAtMs: number;
  frameStart: number;
  maxPresenceScore: number;
  bestFrameIndex: number;
  progressiveContinuationReported: boolean;
}

export interface MessageWatcherState {
  activeObservation: MessageWatcherActiveObservation | null;
  candidate: MessageWatcherCandidate | null;
  switchCandidate: MessageWatcherCandidate | null;
  suppressedSignature: MessageVisualSignature | null;
  suppressedSignatureReason: MessageWatcherCandidateSuppressionReason | null;
  suppressedAbsenceStreak: number;
  absenceStreak: number;
}

export type MessageWatcherCloseReason =
  | "absence"
  | "fingerprint_changed"
  | "stale"
  | "analysis_stopped"
  | "media_ended"
  | "stream_stopped";

export type MessageWatcherCandidateSuppressionReason =
  | "transient"
  | "persistent_ui"
  | "visual_low_quality"
  | "timeout";

export type MessageWatcherTransition =
  | {
      type: "candidate_started";
      id: string;
      startedAtMs: number;
      frameStart: number;
      presenceScore: number;
    }
  | {
      type: "candidate_suppressed";
      id: string;
      timestampMs: number;
      frameIndex: number;
      reason: MessageWatcherCandidateSuppressionReason;
      durationMs: number;
      commitScore: number;
      persistentUiOverlapRatio: number;
      dynamicForegroundRatio: number;
    }
  | {
      type: "progressive_render_continued";
      id: string;
      timestampMs: number;
      frameIndex: number;
      comparison: MessageVisualComparison;
    }
  | {
      type: "opened";
      id: string;
      fingerprint: MessageMaskFingerprint;
      signature: MessageVisualSignature;
      openedAtMs: number;
      frameStart: number;
      maxPresenceScore: number;
      bestFrameIndex: number;
      commitScore: number;
      candidateDurationMs: number;
      persistentUiOverlapRatio: number;
      dynamicForegroundRatio: number;
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
  commitScore?: number;
  persistentUiOverlapRatio?: number;
  dynamicForegroundRatio?: number;
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
  unknownGateReason?: UnknownEventGateReason | null;
  strongVisualEvidence?: boolean;
}

export interface ResolveMessageObservationInput {
  ocrMessageId?: string | null;
  eventIds?: readonly string[];
  unknownEventIds?: readonly string[];
  unknownGateReason?: UnknownEventGateReason | null;
}

const FAILURE_REASON_PRIORITY: Record<
  Exclude<MessageObservationFailureReason, null>,
  number
> = {
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

function cloneFingerprint(
  fingerprint: MessageMaskFingerprint,
): MessageMaskFingerprint {
  return {
    ...fingerprint,
    cells: [...fingerprint.cells],
  };
}

function cloneSignature(
  signature: MessageVisualSignature,
): MessageVisualSignature {
  return {
    ...signature,
    fingerprint: cloneFingerprint(signature.fingerprint),
    occupancyGrid: [...signature.occupancyGrid],
    foregroundBounds: signature.foregroundBounds
      ? { ...signature.foregroundBounds }
      : null,
  };
}

function createFallbackSignature(
  fingerprint: MessageMaskFingerprint,
  lineBandCount: number,
): MessageVisualSignature {
  const occupancyGrid = fingerprint.cells.map((cell) => (cell > 0 ? 1 : 0));

  return {
    fingerprint: cloneFingerprint(fingerprint),
    occupancyGrid,
    gridColumns: fingerprint.columns,
    gridRows: fingerprint.rows,
    foregroundBounds: occupancyGrid.some((cell) => cell > 0)
      ? { x: 0, y: 0, width: 1, height: 1 }
      : null,
    lineBandCount,
    foregroundCellCount: occupancyGrid.filter((cell) => cell > 0).length,
  };
}

function createWatcherPresenceSample(
  sample: MessageWatcherSample,
): MessageWatcherPresenceSample | null {
  if (!sample.analysis.present || !sample.analysis.fingerprint) {
    return null;
  }

  const lineBandCount = sample.analysis.lineBandCount ?? 1;
  const signature =
    sample.analysis.visualSignature ??
    createFallbackSignature(sample.analysis.fingerprint, lineBandCount);

  return {
    timestampMs: sample.timestampMs,
    frameIndex: sample.frameIndex,
    presenceScore: sample.analysis.presenceScore,
    fingerprint: cloneFingerprint(sample.analysis.fingerprint),
    visualSignature: cloneSignature(signature),
    lineBandCount,
    componentCount: sample.analysis.componentCount ?? 1,
    largestComponentRatio: sample.analysis.largestComponentRatio ?? 0,
    persistentUiOverlapRatio:
      sample.analysis.persistentUiOverlapRatio ?? 0,
    dynamicForegroundRatio: sample.analysis.dynamicForegroundRatio ?? 1,
    persistentUiModelWarmedUp:
      sample.analysis.persistentUiModelWarmedUp ?? false,
  };
}

function createCommitScore(sample: MessageWatcherPresenceSample) {
  const presence = Math.max(0, Math.min(1, sample.presenceScore));
  const lines = Math.max(0, Math.min(1, sample.lineBandCount / 2));
  const components = Math.max(0, Math.min(1, sample.componentCount / 6));
  const dynamic = Math.max(0, Math.min(1, sample.dynamicForegroundRatio));
  const nonPersistent = 1 - Math.max(
    0,
    Math.min(1, sample.persistentUiOverlapRatio),
  );

  return (
    presence * 0.45 +
    lines * 0.15 +
    components * 0.15 +
    dynamic * 0.15 +
    nonPersistent * 0.1
  );
}

function isPersistentUiSample(
  sample: MessageWatcherPresenceSample,
  config: MessageWatcherConfig,
) {
  return (
    sample.persistentUiModelWarmedUp &&
    sample.persistentUiOverlapRatio >=
      config.maximumPersistentUiOverlapRatio &&
    sample.dynamicForegroundRatio < config.minimumDynamicForegroundRatio
  );
}

function isQualityEligible(
  sample: MessageWatcherPresenceSample,
  config: MessageWatcherConfig,
) {
  return (
    sample.presenceScore >= config.minimumPresenceScore &&
    sample.lineBandCount >= config.minimumLineBandCount &&
    sample.componentCount >= config.minimumComponentCount &&
    sample.largestComponentRatio <= config.maximumLargestComponentRatio
  );
}

function shouldHoldSmallSingleLineCandidate(
  sample: MessageWatcherPresenceSample,
  durationMs: number,
  config: MessageWatcherConfig,
) {
  const width = sample.visualSignature.foregroundBounds?.width ?? 0;

  return (
    sample.lineBandCount === 1 &&
    width > 0 &&
    width <= config.smallSingleLineMaximumWidthRatio &&
    durationMs < config.smallSingleLineHoldDurationMs
  );
}

function createCandidate(
  id: string,
  sample: MessageWatcherPresenceSample,
): MessageWatcherCandidate {
  return {
    id,
    startedAtMs: sample.timestampMs,
    frameStart: sample.frameIndex,
    signature: cloneSignature(sample.visualSignature),
    samples: [sample],
    presenceSampleCount: 1,
    absenceStreak: 0,
    maxPresenceScore: sample.presenceScore,
    bestFrameIndex: sample.frameIndex,
    bestFingerprint: cloneFingerprint(sample.fingerprint),
    commitScore: createCommitScore(sample),
  };
}

function updateCandidate(
  candidate: MessageWatcherCandidate,
  sample: MessageWatcherPresenceSample | null,
  config: MessageWatcherConfig,
): MessageWatcherCandidate {
  const samples = [...candidate.samples, sample].slice(
    -config.candidateWindowSamples,
  );

  if (!sample) {
    return {
      ...candidate,
      samples,
      presenceSampleCount: samples.filter(Boolean).length,
      absenceStreak: candidate.absenceStreak + 1,
    };
  }

  const isBetter = sample.presenceScore > candidate.maxPresenceScore;

  return {
    ...candidate,
    signature: cloneSignature(sample.visualSignature),
    samples,
    presenceSampleCount: samples.filter(Boolean).length,
    absenceStreak: 0,
    maxPresenceScore: isBetter
      ? sample.presenceScore
      : candidate.maxPresenceScore,
    bestFrameIndex: isBetter
      ? sample.frameIndex
      : candidate.bestFrameIndex,
    bestFingerprint: isBetter
      ? cloneFingerprint(sample.fingerprint)
      : candidate.bestFingerprint,
    commitScore: Math.max(candidate.commitScore, createCommitScore(sample)),
  };
}

function createCandidateStartedTransition(
  candidate: MessageWatcherCandidate,
): Extract<MessageWatcherTransition, { type: "candidate_started" }> {
  return {
    type: "candidate_started",
    id: candidate.id,
    startedAtMs: candidate.startedAtMs,
    frameStart: candidate.frameStart,
    presenceScore: candidate.maxPresenceScore,
  };
}

function createCandidateSuppressedTransition(
  candidate: MessageWatcherCandidate,
  timestampMs: number,
  frameIndex: number,
  reason: MessageWatcherCandidateSuppressionReason,
): Extract<MessageWatcherTransition, { type: "candidate_suppressed" }> {
  const latest = [...candidate.samples]
    .reverse()
    .find((sample): sample is MessageWatcherPresenceSample => sample !== null);

  return {
    type: "candidate_suppressed",
    id: candidate.id,
    timestampMs,
    frameIndex,
    reason,
    durationMs: Math.max(0, timestampMs - candidate.startedAtMs),
    commitScore: candidate.commitScore,
    persistentUiOverlapRatio:
      latest?.persistentUiOverlapRatio ?? 0,
    dynamicForegroundRatio: latest?.dynamicForegroundRatio ?? 0,
  };
}

function createOpenedTransition(
  candidate: MessageWatcherCandidate,
  sample: MessageWatcherPresenceSample,
): Extract<MessageWatcherTransition, { type: "opened" }> {
  return {
    type: "opened",
    id: candidate.id,
    fingerprint: cloneFingerprint(candidate.bestFingerprint),
    signature: cloneSignature(sample.visualSignature),
    openedAtMs: candidate.startedAtMs,
    frameStart: candidate.frameStart,
    maxPresenceScore: candidate.maxPresenceScore,
    bestFrameIndex: candidate.bestFrameIndex,
    commitScore: candidate.commitScore,
    candidateDurationMs: Math.max(
      0,
      sample.timestampMs - candidate.startedAtMs,
    ),
    persistentUiOverlapRatio: sample.persistentUiOverlapRatio,
    dynamicForegroundRatio: sample.dynamicForegroundRatio,
  };
}

function createActiveWatcherObservation(
  transition: Extract<MessageWatcherTransition, { type: "opened" }>,
): MessageWatcherActiveObservation {
  return {
    id: transition.id,
    signature: cloneSignature(transition.signature),
    openedAtMs: transition.openedAtMs,
    frameStart: transition.frameStart,
    maxPresenceScore: transition.maxPresenceScore,
    bestFrameIndex: transition.bestFrameIndex,
    progressiveContinuationReported: false,
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
    candidate: null,
    switchCandidate: null,
    suppressedSignature: null,
    suppressedSignatureReason: null,
    suppressedAbsenceStreak: 0,
    absenceStreak: 0,
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

  if (state.suppressedSignature) {
    if (!presenceSample) {
      const suppressedAbsenceStreak = state.suppressedAbsenceStreak + 1;

      return {
        state:
          suppressedAbsenceStreak >= config.activeAbsenceSamples
            ? createEmptyWatcherState()
            : { ...state, suppressedAbsenceStreak },
        transitions: [],
      };
    }

    const comparison = compareMessageVisualSignatures(
      state.suppressedSignature,
      presenceSample.visualSignature,
    );

    const dynamicOverlayOnPersistentUi =
      state.suppressedSignatureReason === "persistent_ui" &&
      !isPersistentUiSample(presenceSample, config);

    if (
      comparison.likelySameMessage &&
      !dynamicOverlayOnPersistentUi
    ) {
      return {
        state: {
          ...state,
          suppressedSignature: cloneSignature(
            presenceSample.visualSignature,
          ),
          suppressedAbsenceStreak: 0,
        },
        transitions: [],
      };
    }
  }

  if (!state.candidate) {
    if (!presenceSample) {
      return {
        state: createEmptyWatcherState(),
        transitions: [],
      };
    }

    const candidate = createCandidate(nextObservationId, presenceSample);

    return {
      state: {
        ...createEmptyWatcherState(),
        candidate,
      },
      transitions: [createCandidateStartedTransition(candidate)],
    };
  }

  if (!presenceSample) {
    const candidate = updateCandidate(state.candidate, null, config);

    if (
      candidate.absenceStreak >=
      config.candidateAbsenceSamplesRequired
    ) {
      return {
        state: {
          ...createEmptyWatcherState(),
          suppressedSignature: cloneSignature(candidate.signature),
          suppressedSignatureReason: "transient",
          suppressedAbsenceStreak: candidate.absenceStreak,
        },
        transitions: [
          createCandidateSuppressedTransition(
            candidate,
            sample.timestampMs,
            sample.frameIndex,
            "transient",
          ),
        ],
      };
    }

    return {
      state: { ...state, candidate },
      transitions: [],
    };
  }

  const comparison = compareMessageVisualSignatures(
    state.candidate.signature,
    presenceSample.visualSignature,
  );

  if (!comparison.likelySameMessage) {
    const nextCandidate = createCandidate(nextObservationId, presenceSample);

    return {
      state: {
        ...createEmptyWatcherState(),
        candidate: nextCandidate,
      },
      transitions: [
        createCandidateSuppressedTransition(
          state.candidate,
          sample.timestampMs,
          sample.frameIndex,
          "visual_low_quality",
        ),
        createCandidateStartedTransition(nextCandidate),
      ],
    };
  }

  const candidate = updateCandidate(
    state.candidate,
    presenceSample,
    config,
  );
  const durationMs = sample.timestampMs - candidate.startedAtMs;
  const persistentUi = isPersistentUiSample(presenceSample, config);

  if (persistentUi) {
    return {
      state: {
        ...createEmptyWatcherState(),
        suppressedSignature: cloneSignature(
          presenceSample.visualSignature,
        ),
        suppressedSignatureReason: "persistent_ui",
      },
      transitions: [
        createCandidateSuppressedTransition(
          candidate,
          sample.timestampMs,
          sample.frameIndex,
          "persistent_ui",
        ),
      ],
    };
  }

  const canCommit =
    durationMs >= config.candidateMinDurationMs &&
    candidate.presenceSampleCount >=
      config.candidateRequiredPresenceSamples &&
    isQualityEligible(presenceSample, config) &&
    candidate.commitScore >= config.minimumCommitScore &&
    !shouldHoldSmallSingleLineCandidate(
      presenceSample,
      durationMs,
      config,
    );

  if (canCommit) {
    const opened = createOpenedTransition(candidate, presenceSample);

    return {
      state: {
        ...createEmptyWatcherState(),
        activeObservation: createActiveWatcherObservation(opened),
      },
      transitions: [opened],
    };
  }

  if (durationMs >= config.candidateMaxDurationMs) {
    const reason: MessageWatcherCandidateSuppressionReason =
      !isQualityEligible(presenceSample, config) ||
      candidate.commitScore < config.minimumCommitScore
        ? "visual_low_quality"
        : "timeout";

    return {
      state: {
        ...createEmptyWatcherState(),
        suppressedSignature: cloneSignature(
          presenceSample.visualSignature,
        ),
        suppressedSignatureReason: reason,
      },
      transitions: [
        createCandidateSuppressedTransition(
          candidate,
          sample.timestampMs,
          sample.frameIndex,
          reason,
        ),
      ],
    };
  }

  return {
    state: { ...state, candidate },
    transitions: [],
  };
}

function isConfirmedSwitch(
  active: MessageWatcherActiveObservation,
  candidate: MessageWatcherCandidate,
  sample: MessageWatcherPresenceSample,
  comparison: MessageVisualComparison,
  config: MessageWatcherConfig,
) {
  const structureChanged =
    comparison.boundsOverlap < 0.45 ||
    Math.abs(
      active.signature.lineBandCount -
        sample.visualSignature.lineBandCount,
    ) > 0;

  return (
    sample.timestampMs - active.openedAtMs >=
      config.minimumActiveBeforeSwitchMs &&
    candidate.presenceSampleCount >= config.switchStableSamples &&
    comparison.fingerprintDistance >
      config.switchFingerprintDistance &&
    comparison.sharedOverMinimumForeground <
      config.switchMaximumContainment &&
    structureChanged &&
    isQualityEligible(sample, config) &&
    !isPersistentUiSample(sample, config)
  );
}

export function advanceMessageWatcher(
  state: MessageWatcherState,
  sample: MessageWatcherSample,
  nextObservationId: string,
  config: MessageWatcherConfig = DEFAULT_MESSAGE_WATCHER_CONFIG,
): MessageWatcherAdvanceResult {
  const active = state.activeObservation;

  if (!active) {
    return advanceEmptyMessageWatcher(
      state,
      sample,
      nextObservationId,
      config,
    );
  }

  if (
    sample.timestampMs - active.openedAtMs >= config.staleTimeoutMs
  ) {
    const closed = createClosedWatcherTransition(
      active,
      sample.timestampMs,
      sample.frameIndex,
      "stale",
    );
    const advanced = advanceEmptyMessageWatcher(
      createEmptyWatcherState(),
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

    if (absenceStreak >= config.activeAbsenceSamples) {
      return {
        state: createEmptyWatcherState(),
        transitions: [
          createClosedWatcherTransition(
            active,
            sample.timestampMs,
            sample.frameIndex,
            "absence",
          ),
        ],
      };
    }

    return {
      state: {
        ...state,
        absenceStreak,
        switchCandidate: null,
      },
      transitions: [],
    };
  }

  const comparison = compareMessageVisualSignatures(
    active.signature,
    presenceSample.visualSignature,
    {
      sameFingerprintDistance: config.sameFingerprintDistance,
      progressiveRetainedFromPrevious: 0.65,
      containmentSharedMinimum: 0.7,
      minimumBoundsOverlap: 0.45,
      maximumLineBandDelta: 1,
    },
  );

  if (comparison.likelySameMessage) {
    const transitions: MessageWatcherTransition[] = [];
    const scoreDelta =
      presenceSample.presenceScore - active.maxPresenceScore;
    let nextActive: MessageWatcherActiveObservation = {
      ...active,
      signature: cloneSignature(presenceSample.visualSignature),
    };

    if (
      comparison.progressiveRender &&
      !active.progressiveContinuationReported
    ) {
      nextActive = {
        ...nextActive,
        progressiveContinuationReported: true,
      };
      transitions.push({
        type: "progressive_render_continued",
        id: active.id,
        timestampMs: sample.timestampMs,
        frameIndex: sample.frameIndex,
        comparison,
      });
    }

    if (scoreDelta >= config.bestEvidenceMinScoreDelta) {
      nextActive = {
        ...nextActive,
        maxPresenceScore: presenceSample.presenceScore,
        bestFrameIndex: presenceSample.frameIndex,
      };
      transitions.push({
        type: "updated",
        id: active.id,
        maxPresenceScore: nextActive.maxPresenceScore,
        bestFrameIndex: nextActive.bestFrameIndex,
      });
    }

    if (state.switchCandidate) {
      transitions.unshift(
        createCandidateSuppressedTransition(
          state.switchCandidate,
          sample.timestampMs,
          sample.frameIndex,
          "transient",
        ),
      );
    }

    return {
      state: {
        ...state,
        activeObservation: nextActive,
        absenceStreak: 0,
        switchCandidate: null,
      },
      transitions,
    };
  }

  let switchCandidate = state.switchCandidate;
  const transitions: MessageWatcherTransition[] = [];

  if (switchCandidate) {
    const switchComparison = compareMessageVisualSignatures(
      switchCandidate.signature,
      presenceSample.visualSignature,
    );

    if (switchComparison.likelySameMessage) {
      switchCandidate = updateCandidate(
        switchCandidate,
        presenceSample,
        config,
      );
    } else {
      transitions.push(
        createCandidateSuppressedTransition(
          switchCandidate,
          sample.timestampMs,
          sample.frameIndex,
          "visual_low_quality",
        ),
      );
      switchCandidate = createCandidate(
        nextObservationId,
        presenceSample,
      );
      transitions.push(
        createCandidateStartedTransition(switchCandidate),
      );
    }
  } else {
    switchCandidate = createCandidate(nextObservationId, presenceSample);
    transitions.push(createCandidateStartedTransition(switchCandidate));
  }

  if (
    isPersistentUiSample(presenceSample, config) ||
    sample.timestampMs - switchCandidate.startedAtMs >=
      config.candidateMaxDurationMs
  ) {
    transitions.push(
      createCandidateSuppressedTransition(
        switchCandidate,
        sample.timestampMs,
        sample.frameIndex,
        isPersistentUiSample(presenceSample, config)
          ? "persistent_ui"
          : "timeout",
      ),
    );

    return {
      state: {
        ...state,
        absenceStreak: 0,
        switchCandidate: null,
      },
      transitions,
    };
  }

  if (
    isConfirmedSwitch(
      active,
      switchCandidate,
      presenceSample,
      comparison,
      config,
    )
  ) {
    const opened = createOpenedTransition(
      switchCandidate,
      presenceSample,
    );

    return {
      state: {
        ...createEmptyWatcherState(),
        activeObservation: createActiveWatcherObservation(opened),
      },
      transitions: [
        ...transitions,
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

  return {
    state: {
      ...state,
      absenceStreak: 0,
      switchCandidate,
    },
    transitions,
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
  const transitions: MessageWatcherTransition[] = [];

  if (state.candidate) {
    transitions.push(
      createCandidateSuppressedTransition(
        state.candidate,
        input.timestampMs,
        input.frameIndex,
        "transient",
      ),
    );
  }

  if (state.switchCandidate) {
    transitions.push(
      createCandidateSuppressedTransition(
        state.switchCandidate,
        input.timestampMs,
        input.frameIndex,
        "transient",
      ),
    );
  }

  if (state.activeObservation) {
    transitions.push(
      createClosedWatcherTransition(
        state.activeObservation,
        input.timestampMs,
        input.frameIndex,
        input.reason,
      ),
    );
  }

  return {
    state: createEmptyWatcherState(),
    transitions,
  };
}

function appendUnique(
  current: readonly string[],
  values: readonly string[],
) {
  if (values.length === 0) {
    return [...current];
  }

  return [...new Set([...current, ...values])];
}

function appendOptionalId(
  current: readonly string[],
  value: string | null | undefined,
) {
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

  return FAILURE_REASON_PRIORITY[next] >= FAILURE_REASON_PRIORITY[current]
    ? next
    : current;
}

export function inferMessageObservationDisposition(
  observation: Pick<
    MessageObservation,
    "resolution" | "unknownEventIds" | "disposition"
  >,
): MessageObservationDisposition {
  if (observation.resolution === "resolved") {
    return "primary";
  }

  if (
    observation.resolution === "ocr_unknown" &&
    observation.unknownEventIds.length === 0
  ) {
    return "suppressed";
  }

  if (observation.disposition) {
    return observation.disposition;
  }

  return observation.resolution === "ocr_unknown"
    ? "review"
    : "primary";
}

export function shouldShowObservationInPrimaryLog(
  observation: MessageObservation,
) {
  const disposition = inferMessageObservationDisposition(observation);

  if (disposition === "suppressed") {
    return false;
  }

  return !(
    observation.resolution === "ocr_unknown" &&
    observation.unknownEventIds.length === 0
  );
}

export function isStrongVisualMessageObservation(
  observation: MessageObservation,
) {
  return (
    (observation.commitScore ?? 0) >=
      DEFAULT_MESSAGE_WATCHER_CONFIG.minimumCommitScore &&
    (observation.persistentUiOverlapRatio ?? 0) <
      DEFAULT_MESSAGE_WATCHER_CONFIG.maximumPersistentUiOverlapRatio &&
    (observation.dynamicForegroundRatio ?? 1) >=
      DEFAULT_MESSAGE_WATCHER_CONFIG.minimumDynamicForegroundRatio
  );
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
    visualFingerprint: cloneFingerprint(input.visualFingerprint),
    maxPresenceScore: input.presenceScore,
    bestFrameIndex: input.bestFrameIndex ?? null,
    bestEvidenceRef: input.bestEvidenceRef ?? null,
    ocrAttemptCount: 0,
    ocrMessageIds: [],
    eventIds: [],
    unknownEventIds: [],
    failureReason: null,
    openedWhileOcrBusy: input.openedWhileOcrBusy ?? false,
    disposition: "primary",
    suppressionReason: null,
    commitScore: input.commitScore ?? 0,
    persistentUiOverlapRatio:
      input.persistentUiOverlapRatio ?? 0,
    dynamicForegroundRatio: input.dynamicForegroundRatio ?? 1,
    unknownGateReason: null,
    mergedIntoObservationId: null,
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
    bestEvidenceRef:
      input.evidenceRef ?? observation.bestEvidenceRef,
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
  if (
    !ocrMessageId ||
    observation.ocrMessageIds.includes(ocrMessageId)
  ) {
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
  if (
    observation.resolution === "resolved" ||
    observation.resolution === "ocr_unknown"
  ) {
    return observation;
  }

  const nextFailureReason = selectFailureReason(
    observation.failureReason,
    failureReason,
  );

  if (nextFailureReason === observation.failureReason) {
    return observation;
  }

  return {
    ...observation,
    failureReason: nextFailureReason,
  };
}

export function suppressMessageObservation(
  observation: MessageObservation,
  reason: Exclude<MessageObservationSuppressionReason, null>,
  unknownGateReason: UnknownEventGateReason | null = null,
): MessageObservation {
  if (observation.resolution === "resolved") {
    return observation;
  }

  return {
    ...observation,
    disposition: "suppressed",
    suppressionReason: reason,
    unknownGateReason:
      unknownGateReason ?? observation.unknownGateReason ?? null,
  };
}

export function settleMessageObservationUnread(
  observation: MessageObservation,
  input: SettleMessageObservationUnreadInput,
): MessageObservation {
  if (
    observation.lifecycle !== "closed" ||
    input.pendingOcrJobCount > 0 ||
    observation.resolution === "resolved" ||
    (observation.resolution === "ocr_unknown" &&
      observation.unknownEventIds.length > 0)
  ) {
    return observation;
  }

  if (observation.unknownEventIds.length > 0) {
    return {
      ...observation,
      resolution: "ocr_unknown",
      disposition: "review",
      suppressionReason: null,
      failureReason: "parser_unknown",
      unknownGateReason: "accepted",
    };
  }

  if (input.hasUsableOcrText) {
    const strongVisualEvidence =
      input.strongVisualEvidence ??
      isStrongVisualMessageObservation(observation);

    if (!strongVisualEvidence) {
      return {
        ...observation,
        resolution: "unread",
        disposition: "suppressed",
        suppressionReason: "ocr_noise_gate",
        failureReason: "parser_unknown",
        unknownGateReason:
          input.unknownGateReason ??
          observation.unknownGateReason ??
          "other_noise",
      };
    }

    return {
      ...observation,
      resolution: "unread",
      disposition: "primary",
      suppressionReason: null,
      failureReason: "parser_unknown",
      unknownGateReason:
        input.unknownGateReason ??
        observation.unknownGateReason ??
        "other_noise",
    };
  }

  const attemptedFailureReason =
    input.failureReason ??
    observation.failureReason ??
    (observation.ocrAttemptCount > 0
      ? "ocr_empty"
      : "no_ocr_attempt");

  return {
    ...observation,
    resolution: "unread",
    disposition: "primary",
    suppressionReason: null,
    failureReason: selectFailureReason(
      observation.failureReason,
      attemptedFailureReason,
    ),
  };
}

export function resolveMessageObservationAsOcrUnknown(
  observation: MessageObservation,
  input: ResolveMessageObservationInput = {},
): MessageObservation {
  if (observation.resolution === "resolved") {
    return observation;
  }

  const unknownEventIds = appendUnique(
    observation.unknownEventIds,
    input.unknownEventIds ?? [],
  );

  if (unknownEventIds.length === 0) {
    return attachMessageObservationOcrMessage(
      observation,
      input.ocrMessageId,
    );
  }

  return {
    ...observation,
    resolution: "ocr_unknown",
    disposition: "review",
    suppressionReason: null,
    ocrMessageIds: appendOptionalId(
      observation.ocrMessageIds,
      input.ocrMessageId,
    ),
    unknownEventIds,
    failureReason: "parser_unknown",
    unknownGateReason: input.unknownGateReason ?? "accepted",
    mergedIntoObservationId: null,
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
    disposition: "primary",
    suppressionReason: null,
    ocrMessageIds: appendOptionalId(
      observation.ocrMessageIds,
      input.ocrMessageId,
    ),
    eventIds: appendUnique(observation.eventIds, eventIds),
    failureReason: null,
    unknownGateReason: null,
    mergedIntoObservationId: null,
  };
}

export function createEmptyMessageObservationSummary(): MessageObservationSummary {
  return {
    detectedCount: 0,
    committedCount: 0,
    resolvedCount: 0,
    ocrUnknownCount: 0,
    unreadCount: 0,
    openedWhileOcrBusyCount: 0,
    suppressedCount: 0,
    persistentUiSuppressedCount: 0,
    noiseSuppressedCount: 0,
    mergedCount: 0,
  };
}

export function summarizeMessageObservations(
  observations: readonly MessageObservation[],
): MessageObservationSummary {
  const summary = createEmptyMessageObservationSummary();

  for (const observation of observations) {
    const disposition =
      inferMessageObservationDisposition(observation);
    const suppressed = disposition === "suppressed";

    summary.detectedCount += 1;
    summary.committedCount += 1;
    summary.openedWhileOcrBusyCount +=
      observation.openedWhileOcrBusy ? 1 : 0;
    summary.suppressedCount += suppressed ? 1 : 0;
    summary.persistentUiSuppressedCount +=
      observation.suppressionReason === "persistent_ui" ? 1 : 0;
    summary.noiseSuppressedCount +=
      observation.suppressionReason === "ocr_noise_gate" ? 1 : 0;
    summary.mergedCount +=
      observation.suppressionReason === "merged_duplicate" ? 1 : 0;

    if (suppressed) {
      continue;
    }

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
