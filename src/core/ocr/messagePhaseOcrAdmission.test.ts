import { describe, expect, it } from "vitest";
import {
  decideMessagePhaseOcrAdmission,
  DEFAULT_MESSAGE_PHASE_OCR_ADMISSION_CONFIG,
  meetsStrictMessagePhaseOcrFallback,
  type MessagePhaseOcrAdmissionInput,
} from "./messagePhaseOcrAdmission";

function createInput(
  overrides: Partial<MessagePhaseOcrAdmissionInput> = {},
): MessagePhaseOcrAdmissionInput {
  return {
    phase: "unknown",
    nowMs: 1_000,
    observationOpenedAtMs: 0,
    messagePhaseClosedAtMs: null,
    persistentUiModelWarmedUp: true,
    commitScore: 0.94,
    presenceScore: 0.9,
    persistentUiOverlapRatio: 0.35,
    dynamicForegroundRatio: 0.65,
    lineBandCount: 1,
    componentCount: 2,
    largestComponentRatio: 0.55,
    ...overrides,
  };
}

describe("message phase OCR admission", () => {
  it("exposes the requested timing and strict fallback defaults", () => {
    expect(DEFAULT_MESSAGE_PHASE_OCR_ADMISSION_CONFIG).toEqual({
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
    });
  });

  it("queues message_candidate immediately without requiring strict signals", () => {
    const decision = decideMessagePhaseOcrAdmission(
      createInput({
        phase: "message_candidate",
        nowMs: 10,
        commitScore: 0,
        presenceScore: 0,
        lineBandCount: 0,
        componentCount: 0,
        largestComponentRatio: 1,
      }),
    );

    expect(decision).toMatchObject({
      action: "queue",
      reason: "message_candidate",
      retryAtMs: null,
    });
  });

  it("queues hud samples during the trailing grace after phase close", () => {
    const decision = decideMessagePhaseOcrAdmission(
      createInput({
        phase: "hud",
        nowMs: 2_500,
        observationOpenedAtMs: 2_400,
        messagePhaseClosedAtMs: 1_000,
        commitScore: 0,
        presenceScore: 0,
        lineBandCount: 0,
        componentCount: 0,
        largestComponentRatio: 1,
      }),
    );

    expect(decision).toMatchObject({
      action: "queue",
      reason: "hud_trailing_grace",
    });
  });

  it.each(["unknown", "hud"] as const)(
    "defers %s until confirmation while preserving the idle lease",
    (phase) => {
      const decision = decideMessagePhaseOcrAdmission(
        createInput({
          phase,
          nowMs: 1_499,
          observationOpenedAtMs: 1_000,
          messagePhaseClosedAtMs: null,
        }),
      );

      expect(decision).toEqual({
        action: "defer",
        reason: "awaiting_phase_confirmation",
        retryAtMs: 1_500,
        confirmationDeadlineMs: 1_500,
        idleLeaseExpiresAtMs: 7_000,
      });
    },
  );

  it.each(["unknown", "hud"] as const)(
    "queues a warmed strict fallback after the %s deadline",
    (phase) => {
      const decision = decideMessagePhaseOcrAdmission(
        createInput({
          phase,
          nowMs: 1_500,
          observationOpenedAtMs: 1_000,
          messagePhaseClosedAtMs:
            phase === "hud" ? -DEFAULT_MESSAGE_PHASE_OCR_ADMISSION_CONFIG.trailingGraceMs : null,
        }),
      );

      expect(decision).toMatchObject({
        action: "queue",
        reason: "strict_fallback",
      });
    },
  );

  it.each([
    ["commit score", { commitScore: 0.939 }],
    ["presence score", { presenceScore: 0.899 }],
    ["persistent overlap", { persistentUiOverlapRatio: 0.351 }],
    ["dynamic foreground", { dynamicForegroundRatio: 0.649 }],
    ["line bands", { lineBandCount: 0 }],
    ["components", { componentCount: 1 }],
    ["largest component", { largestComponentRatio: 0.551 }],
  ] satisfies Array<
    [string, Partial<MessagePhaseOcrAdmissionInput>]
  >)(
    "rejects a warmed fallback with weak %s",
    (_label, overrides) => {
      const input = createInput(overrides);

      expect(meetsStrictMessagePhaseOcrFallback(input)).toBe(false);
      expect(decideMessagePhaseOcrAdmission(input)).toMatchObject({
        action: "reject",
        reason: "strict_fallback_failed",
      });
    },
  );

  it("uses stricter unwarmed scores while ignoring unavailable persistence history", () => {
    const decision = decideMessagePhaseOcrAdmission(
      createInput({
        persistentUiModelWarmedUp: false,
        commitScore: 0.97,
        presenceScore: 0.95,
        persistentUiOverlapRatio: 1,
        dynamicForegroundRatio: 0,
      }),
    );

    expect(decision).toMatchObject({
      action: "queue",
      reason: "strict_fallback",
    });
  });

  it.each([
    ["commit score", { commitScore: 0.969 }],
    ["presence score", { presenceScore: 0.949 }],
    ["line bands", { lineBandCount: 0 }],
    ["components", { componentCount: 1 }],
    ["largest component", { largestComponentRatio: 0.551 }],
  ] satisfies Array<
    [string, Partial<MessagePhaseOcrAdmissionInput>]
  >)(
    "rejects an unwarmed fallback with weak %s",
    (_label, overrides) => {
      const decision = decideMessagePhaseOcrAdmission(
        createInput({
          persistentUiModelWarmedUp: false,
          commitScore: 0.97,
          presenceScore: 0.95,
          ...overrides,
        }),
      );

      expect(decision).toMatchObject({
        action: "reject",
        reason: "strict_fallback_failed",
      });
    },
  );

  it("applies strict fallback once hud trailing grace has expired", () => {
    const decision = decideMessagePhaseOcrAdmission(
      createInput({
        phase: "hud",
        nowMs: 2_501,
        observationOpenedAtMs: 0,
        messagePhaseClosedAtMs: 1_000,
        commitScore: 0.93,
      }),
    );

    expect(decision).toMatchObject({
      action: "reject",
      reason: "strict_fallback_failed",
    });
  });

  it("uses idle lease as a hard upper bound for deferral", () => {
    const decision = decideMessagePhaseOcrAdmission(
      createInput({
        nowMs: 300,
        observationOpenedAtMs: 0,
        commitScore: 0,
      }),
      {
        ...DEFAULT_MESSAGE_PHASE_OCR_ADMISSION_CONFIG,
        confirmationWaitMs: 500,
        idleLeaseMs: 300,
      },
    );

    expect(decision).toMatchObject({
      action: "reject",
      reason: "strict_fallback_failed",
      confirmationDeadlineMs: 500,
      idleLeaseExpiresAtMs: 300,
    });
  });

  it("always rejects ended phase even when other queue conditions are strong", () => {
    const decision = decideMessagePhaseOcrAdmission(
      createInput({
        phase: "ended",
        messagePhaseClosedAtMs: 900,
        commitScore: 1,
        presenceScore: 1,
      }),
    );

    expect(decision).toMatchObject({
      action: "reject",
      reason: "phase_ended",
      retryAtMs: null,
    });
  });
});
