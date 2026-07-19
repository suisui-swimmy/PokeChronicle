import type { MessagePhase } from "../events/schema";

export interface MessagePhaseGateConfig {
  hudVisibleStreakRequired: number;
  hudHiddenStreakRequired: number;
  vsVisibleStreakRequired: number;
  vsHiddenStreakRequired: number;
  candidateIdleLeaseMs: number;
}

export const DEFAULT_MESSAGE_PHASE_GATE_CONFIG: Readonly<MessagePhaseGateConfig> = {
  hudVisibleStreakRequired: 2,
  hudHiddenStreakRequired: 2,
  vsVisibleStreakRequired: 2,
  vsHiddenStreakRequired: 2,
  candidateIdleLeaseMs: 6_000,
};

export interface MessagePhaseGateState {
  phase: MessagePhase;
  phaseChangedAtMs: number | null;
  lastCandidateActivityAtMs: number | null;
  hpStableVisible: boolean | null;
  hpVisibleStreak: number;
  hpHiddenStreak: number;
  vsStableVisible: boolean | null;
  vsVisibleStreak: number;
  vsHiddenStreak: number;
  hasOpenedFromVs: boolean;
}

export interface MessagePhaseGateInput {
  timestampMs: number;
  hudVisible: boolean;
  vsVisible: boolean | null;
  hasActiveObservation: boolean;
}

export type MessagePhaseGateTransition =
  | "battle_hud_rose"
  | "battle_hud_fell"
  | "vs_fell"
  | "message_phase_opened"
  | "message_phase_closed"
  | "message_phase_expired";

export interface MessagePhaseGateAdvanceResult {
  state: MessagePhaseGateState;
  transitions: MessagePhaseGateTransition[];
}

export function createInitialMessagePhaseGateState(): MessagePhaseGateState {
  return {
    phase: "unknown",
    phaseChangedAtMs: null,
    lastCandidateActivityAtMs: null,
    hpStableVisible: null,
    hpVisibleStreak: 0,
    hpHiddenStreak: 0,
    vsStableVisible: null,
    vsVisibleStreak: 0,
    vsHiddenStreak: 0,
    hasOpenedFromVs: false,
  };
}

function openMessagePhase(
  state: MessagePhaseGateState,
  timestampMs: number,
  transitions: MessagePhaseGateTransition[],
) {
  if (state.phase === "ended" || state.phase === "message_candidate") {
    return;
  }

  state.phase = "message_candidate";
  state.phaseChangedAtMs = timestampMs;
  state.lastCandidateActivityAtMs = timestampMs;
  transitions.push("message_phase_opened");
}

function closeMessagePhase(
  state: MessagePhaseGateState,
  timestampMs: number,
  transitions: MessagePhaseGateTransition[],
) {
  if (state.phase === "hud") {
    return;
  }

  state.phase = "hud";
  state.phaseChangedAtMs = timestampMs;
  transitions.push("message_phase_closed");
}

export function advanceMessagePhaseGate(
  currentState: MessagePhaseGateState,
  input: MessagePhaseGateInput,
  config: MessagePhaseGateConfig = DEFAULT_MESSAGE_PHASE_GATE_CONFIG,
): MessagePhaseGateAdvanceResult {
  const state: MessagePhaseGateState = { ...currentState };
  const transitions: MessagePhaseGateTransition[] = [];

  if (state.phase === "ended") {
    return { state, transitions };
  }

  if (input.vsVisible === true) {
    state.vsVisibleStreak += 1;
    state.vsHiddenStreak = 0;
  } else if (input.vsVisible === false) {
    state.vsHiddenStreak += 1;
    state.vsVisibleStreak = 0;
  }

  if (
    input.vsVisible === true &&
    state.vsVisibleStreak >= config.vsVisibleStreakRequired &&
    state.vsStableVisible !== true
  ) {
    state.vsStableVisible = true;
  }

  if (
    input.vsVisible === false &&
    state.vsHiddenStreak >= config.vsHiddenStreakRequired &&
    state.vsStableVisible === true &&
    !state.hasOpenedFromVs
  ) {
    state.vsStableVisible = false;
    state.hasOpenedFromVs = true;
    transitions.push("vs_fell");
    openMessagePhase(state, input.timestampMs, transitions);
  }

  if (input.hudVisible) {
    state.hpVisibleStreak += 1;
    state.hpHiddenStreak = 0;
  } else {
    state.hpHiddenStreak += 1;
    state.hpVisibleStreak = 0;
  }

  if (
    input.hudVisible &&
    state.hpVisibleStreak >= config.hudVisibleStreakRequired &&
    state.hpStableVisible !== true
  ) {
    state.hpStableVisible = true;
    transitions.push("battle_hud_rose");
    closeMessagePhase(state, input.timestampMs, transitions);
  }

  if (
    !input.hudVisible &&
    state.hpHiddenStreak >= config.hudHiddenStreakRequired &&
    state.hpStableVisible !== false
  ) {
    const wasHudVisible = state.hpStableVisible === true;
    state.hpStableVisible = false;

    if (wasHudVisible) {
      transitions.push("battle_hud_fell");
      openMessagePhase(state, input.timestampMs, transitions);
    }
  }

  if (
    state.phase === "message_candidate" &&
    !input.hasActiveObservation
  ) {
    const lastActivityAtMs =
      state.lastCandidateActivityAtMs ?? state.phaseChangedAtMs;

    if (
      lastActivityAtMs !== null &&
      input.timestampMs - lastActivityAtMs >=
        config.candidateIdleLeaseMs
    ) {
      state.phase = "unknown";
      state.phaseChangedAtMs = input.timestampMs;
      transitions.push("message_phase_expired");
    }
  }

  return { state, transitions };
}

export function recordMessagePhaseActivity(
  state: MessagePhaseGateState,
  timestampMs: number,
): MessagePhaseGateState {
  if (state.phase !== "message_candidate") {
    return state;
  }

  return {
    ...state,
    lastCandidateActivityAtMs: Math.max(
      state.lastCandidateActivityAtMs ?? 0,
      timestampMs,
    ),
  };
}

export function endMessagePhase(
  state: MessagePhaseGateState,
  timestampMs: number,
): MessagePhaseGateState {
  return {
    ...state,
    phase: "ended",
    phaseChangedAtMs: timestampMs,
  };
}
