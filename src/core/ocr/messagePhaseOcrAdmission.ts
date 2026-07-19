import type { MessagePhase } from "../events/schema";

export type MessagePhaseOcrAdmissionAction = "queue" | "defer" | "reject";

export type MessagePhaseOcrAdmissionReason =
  | "message_candidate"
  | "hud_trailing_grace"
  | "awaiting_phase_confirmation"
  | "strict_fallback"
  | "strict_fallback_failed"
  | "phase_ended";

export interface MessagePhaseOcrAdmissionConfig {
  confirmationWaitMs: number;
  trailingGraceMs: number;
  idleLeaseMs: number;
  warmedMinimumCommitScore: number;
  warmedMinimumPresenceScore: number;
  warmedMaximumPersistentUiOverlapRatio: number;
  warmedMinimumDynamicForegroundRatio: number;
  unwarmedMinimumCommitScore: number;
  unwarmedMinimumPresenceScore: number;
  minimumLineBandCount: number;
  minimumComponentCount: number;
  maximumLargestComponentRatio: number;
}

export const DEFAULT_MESSAGE_PHASE_OCR_ADMISSION_CONFIG: Readonly<
  MessagePhaseOcrAdmissionConfig
> = {
  confirmationWaitMs: 500,
  trailingGraceMs: 1_500,
  idleLeaseMs: 6_000,
  warmedMinimumCommitScore: 0.94,
  warmedMinimumPresenceScore: 0.9,
  warmedMaximumPersistentUiOverlapRatio: 0.35,
  warmedMinimumDynamicForegroundRatio: 0.65,
  unwarmedMinimumCommitScore: 0.97,
  unwarmedMinimumPresenceScore: 0.95,
  minimumLineBandCount: 1,
  minimumComponentCount: 2,
  maximumLargestComponentRatio: 0.55,
};

export interface MessagePhaseOcrAdmissionInput {
  phase: MessagePhase;
  nowMs: number;
  observationOpenedAtMs: number;
  messagePhaseClosedAtMs: number | null;
  persistentUiModelWarmedUp: boolean;
  commitScore: number;
  presenceScore: number;
  persistentUiOverlapRatio: number;
  dynamicForegroundRatio: number;
  lineBandCount: number;
  componentCount: number;
  largestComponentRatio: number;
}

interface MessagePhaseOcrAdmissionDecisionBase {
  action: MessagePhaseOcrAdmissionAction;
  reason: MessagePhaseOcrAdmissionReason;
  confirmationDeadlineMs: number;
  idleLeaseExpiresAtMs: number;
}

export interface QueueMessagePhaseOcrAdmissionDecision
  extends MessagePhaseOcrAdmissionDecisionBase {
  action: "queue";
  retryAtMs: null;
}

export interface DeferMessagePhaseOcrAdmissionDecision
  extends MessagePhaseOcrAdmissionDecisionBase {
  action: "defer";
  reason: "awaiting_phase_confirmation";
  retryAtMs: number;
}

export interface RejectMessagePhaseOcrAdmissionDecision
  extends MessagePhaseOcrAdmissionDecisionBase {
  action: "reject";
  retryAtMs: null;
}

export type MessagePhaseOcrAdmissionDecision =
  | QueueMessagePhaseOcrAdmissionDecision
  | DeferMessagePhaseOcrAdmissionDecision
  | RejectMessagePhaseOcrAdmissionDecision;

function createTiming(
  input: MessagePhaseOcrAdmissionInput,
  config: MessagePhaseOcrAdmissionConfig,
) {
  const observationOpenedAtMs = Math.max(0, input.observationOpenedAtMs);

  return {
    confirmationDeadlineMs:
      observationOpenedAtMs + Math.max(0, config.confirmationWaitMs),
    idleLeaseExpiresAtMs:
      observationOpenedAtMs + Math.max(0, config.idleLeaseMs),
  };
}

function hasStrictShape(
  input: MessagePhaseOcrAdmissionInput,
  config: MessagePhaseOcrAdmissionConfig,
) {
  return (
    input.lineBandCount >= config.minimumLineBandCount &&
    input.componentCount >= config.minimumComponentCount &&
    input.largestComponentRatio <= config.maximumLargestComponentRatio
  );
}

export function meetsStrictMessagePhaseOcrFallback(
  input: MessagePhaseOcrAdmissionInput,
  config: MessagePhaseOcrAdmissionConfig =
    DEFAULT_MESSAGE_PHASE_OCR_ADMISSION_CONFIG,
) {
  if (!hasStrictShape(input, config)) {
    return false;
  }

  if (!input.persistentUiModelWarmedUp) {
    return (
      input.commitScore >= config.unwarmedMinimumCommitScore &&
      input.presenceScore >= config.unwarmedMinimumPresenceScore
    );
  }

  return (
    input.commitScore >= config.warmedMinimumCommitScore &&
    input.presenceScore >= config.warmedMinimumPresenceScore &&
    input.persistentUiOverlapRatio <=
      config.warmedMaximumPersistentUiOverlapRatio &&
    input.dynamicForegroundRatio >=
      config.warmedMinimumDynamicForegroundRatio
  );
}

export function decideMessagePhaseOcrAdmission(
  input: MessagePhaseOcrAdmissionInput,
  config: MessagePhaseOcrAdmissionConfig =
    DEFAULT_MESSAGE_PHASE_OCR_ADMISSION_CONFIG,
): MessagePhaseOcrAdmissionDecision {
  const timing = createTiming(input, config);

  if (input.phase === "ended") {
    return {
      action: "reject",
      reason: "phase_ended",
      retryAtMs: null,
      ...timing,
    };
  }

  if (input.phase === "message_candidate") {
    return {
      action: "queue",
      reason: "message_candidate",
      retryAtMs: null,
      ...timing,
    };
  }

  const elapsedSinceMessagePhaseClosedMs =
    input.messagePhaseClosedAtMs === null
      ? null
      : input.nowMs - input.messagePhaseClosedAtMs;
  const withinHudTrailingGrace =
    input.phase === "hud" &&
    elapsedSinceMessagePhaseClosedMs !== null &&
    elapsedSinceMessagePhaseClosedMs >= 0 &&
    elapsedSinceMessagePhaseClosedMs <= Math.max(0, config.trailingGraceMs);

  if (withinHudTrailingGrace) {
    return {
      action: "queue",
      reason: "hud_trailing_grace",
      retryAtMs: null,
      ...timing,
    };
  }

  const admissionDeadlineMs = Math.min(
    timing.confirmationDeadlineMs,
    timing.idleLeaseExpiresAtMs,
  );

  if (input.nowMs < admissionDeadlineMs) {
    return {
      action: "defer",
      reason: "awaiting_phase_confirmation",
      retryAtMs: admissionDeadlineMs,
      ...timing,
    };
  }

  if (meetsStrictMessagePhaseOcrFallback(input, config)) {
    return {
      action: "queue",
      reason: "strict_fallback",
      retryAtMs: null,
      ...timing,
    };
  }

  return {
    action: "reject",
    reason: "strict_fallback_failed",
    retryAtMs: null,
    ...timing,
  };
}
