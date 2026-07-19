import { describe, expect, it } from "vitest";
import {
  advanceMessagePhaseGate,
  createInitialMessagePhaseGateState,
  endMessagePhase,
  recordMessagePhaseActivity,
} from "./messagePhaseGate";

function advance(
  state: ReturnType<typeof createInitialMessagePhaseGateState>,
  timestampMs: number,
  hudVisible: boolean,
  vsVisible: boolean | null = null,
  hasActiveObservation = false,
) {
  return advanceMessagePhaseGate(state, {
    timestampMs,
    hudVisible,
    vsVisible,
    hasActiveObservation,
  });
}

describe("message phase gate", () => {
  it("opens the message phase after a stable VS disappearance", () => {
    let state = createInitialMessagePhaseGateState();
    state = advance(state, 0, false, true).state;
    state = advance(state, 100, false, true).state;
    state = advance(state, 200, false, false).state;
    const result = advance(state, 300, false, false);

    expect(result.state.phase).toBe("message_candidate");
    expect(result.transitions).toEqual([
      "vs_fell",
      "message_phase_opened",
    ]);
  });

  it("closes on HUD rise and reopens on HUD fall", () => {
    let state = createInitialMessagePhaseGateState();
    state = advance(state, 0, true).state;
    const rose = advance(state, 100, true);

    expect(rose.state.phase).toBe("hud");
    expect(rose.transitions).toEqual([
      "battle_hud_rose",
      "message_phase_closed",
    ]);

    state = advance(rose.state, 200, false).state;
    const fell = advance(state, 300, false);

    expect(fell.state.phase).toBe("message_candidate");
    expect(fell.transitions).toEqual([
      "battle_hud_fell",
      "message_phase_opened",
    ]);
  });

  it("expires an idle candidate phase after six seconds", () => {
    let state = createInitialMessagePhaseGateState();
    state = {
      ...state,
      phase: "message_candidate",
      phaseChangedAtMs: 100,
      lastCandidateActivityAtMs: 100,
    };

    const result = advance(state, 6_100, false);

    expect(result.state.phase).toBe("unknown");
    expect(result.transitions).toEqual(["message_phase_expired"]);
  });

  it("does not expire while an observation is active", () => {
    const state = {
      ...createInitialMessagePhaseGateState(),
      phase: "message_candidate" as const,
      phaseChangedAtMs: 100,
      lastCandidateActivityAtMs: 100,
    };

    expect(advance(state, 10_000, false, null, true).state.phase).toBe(
      "message_candidate",
    );
  });

  it("renews the idle lease from admitted observation activity", () => {
    const state = recordMessagePhaseActivity(
      {
        ...createInitialMessagePhaseGateState(),
        phase: "message_candidate",
        phaseChangedAtMs: 100,
        lastCandidateActivityAtMs: 100,
      },
      5_000,
    );

    expect(advance(state, 10_999, false).state.phase).toBe(
      "message_candidate",
    );
    expect(advance(state, 11_000, false).state.phase).toBe("unknown");
  });

  it("ended is terminal until reset", () => {
    const ended = endMessagePhase(
      createInitialMessagePhaseGateState(),
      500,
    );
    const result = advance(ended, 600, false, false);

    expect(result.state.phase).toBe("ended");
    expect(result.transitions).toEqual([]);
    expect(createInitialMessagePhaseGateState().phase).toBe("unknown");
  });
});
