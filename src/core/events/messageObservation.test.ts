import { describe, expect, it } from "vitest";
import type {
  MessageVisualSignature,
} from "../preprocess/messagePresenceDetection";
import type { MessageMaskFingerprint } from "../preprocess/messagePreprocess";
import {
  admitMessageObservationOcr,
  advanceMessageWatcher,
  attachMessageObservationOcrMessage,
  closeActiveMessageWatcher,
  closeMessageObservation,
  createInitialMessageWatcherState,
  createMessageObservation,
  recordMessageObservationFailure,
  recordMessageObservationOcrAttempt,
  rejectMessageObservationOcrForPhase,
  resolveMessageObservationAsOcrUnknown,
  resolveMessageObservationWithEvents,
  settleMessageObservationUnread,
  shouldShowObservationInPrimaryLog,
  summarizeMessageObservations,
  suppressMessageObservation,
  updateMessageObservationBestEvidence,
  type MessageWatcherState,
} from "./messageObservation";

const fingerprintA: MessageMaskFingerprint = {
  columns: 4,
  rows: 2,
  cells: [8, 8, 0, 0, 0, 0, 0, 0],
  foregroundPixelRatio: 0.08,
};
const fingerprintAJitter: MessageMaskFingerprint = {
  columns: 4,
  rows: 2,
  cells: [8, 7, 0, 0, 0, 0, 0, 0],
  foregroundPixelRatio: 0.081,
};
const fingerprintAProgressive: MessageMaskFingerprint = {
  columns: 4,
  rows: 2,
  cells: [8, 8, 8, 0, 0, 0, 0, 0],
  foregroundPixelRatio: 0.12,
};
const fingerprintB: MessageMaskFingerprint = {
  columns: 4,
  rows: 2,
  cells: [0, 0, 0, 0, 0, 0, 8, 8],
  foregroundPixelRatio: 0.08,
};

function createSignature(
  fingerprint: MessageMaskFingerprint,
  occupancyGrid: number[],
  lineBandCount = 1,
  bounds = { x: 0.08, y: 0.2, width: 0.72, height: 0.3 },
): MessageVisualSignature {
  return {
    fingerprint,
    occupancyGrid,
    gridColumns: 4,
    gridRows: 2,
    foregroundBounds: bounds,
    lineBandCount,
    foregroundCellCount: occupancyGrid.filter(Boolean).length,
  };
}

const signatureA = createSignature(
  fingerprintA,
  [1, 1, 0, 0, 0, 0, 0, 0],
);
const signatureAJitter = createSignature(
  fingerprintAJitter,
  [1, 1, 0, 0, 0, 0, 0, 0],
);
const signatureAProgressive = createSignature(
  fingerprintAProgressive,
  [1, 1, 1, 0, 0, 0, 0, 0],
  1,
  { x: 0.08, y: 0.2, width: 0.8, height: 0.3 },
);
const signatureB = createSignature(
  fingerprintB,
  [0, 0, 0, 0, 0, 0, 1, 1],
  2,
  { x: 0.58, y: 0.58, width: 0.34, height: 0.3 },
);

function createPendingObservation(
  id = "msg_obs_1",
  options: { commitScore?: number; dynamic?: number; persistent?: number } = {},
) {
  return createMessageObservation({
    id,
    battleId: "battle_test",
    openedAtMs: 1000,
    frameStart: 10,
    visualFingerprint: fingerprintA,
    presenceScore: 0.65,
    bestFrameIndex: 10,
    bestEvidenceRef: "frame:10:1000",
    openedWhileOcrBusy: false,
    commitScore: options.commitScore ?? 0.72,
    dynamicForegroundRatio: options.dynamic ?? 0.8,
    persistentUiOverlapRatio: options.persistent ?? 0.2,
  });
}

function presentSample(
  frameIndex: number,
  timestampMs: number,
  fingerprint: MessageMaskFingerprint = fingerprintA,
  signature: MessageVisualSignature = signatureA,
  presenceScore = 0.7,
  overrides: {
    lineBandCount?: number;
    componentCount?: number;
    largestComponentRatio?: number;
    persistentUiOverlapRatio?: number;
    dynamicForegroundRatio?: number;
    persistentUiModelWarmedUp?: boolean;
  } = {},
) {
  return {
    frameIndex,
    timestampMs,
    analysis: {
      present: true,
      presenceScore,
      fingerprint,
      visualSignature: signature,
      lineBandCount: overrides.lineBandCount ?? signature.lineBandCount,
      componentCount: overrides.componentCount ?? 6,
      largestComponentRatio: overrides.largestComponentRatio ?? 0.2,
      persistentUiOverlapRatio:
        overrides.persistentUiOverlapRatio ?? 0,
      dynamicForegroundRatio:
        overrides.dynamicForegroundRatio ?? 1,
      persistentUiModelWarmedUp:
        overrides.persistentUiModelWarmedUp ?? false,
    },
  };
}

function absentSample(frameIndex: number, timestampMs: number) {
  return {
    frameIndex,
    timestampMs,
    analysis: {
      present: false,
      presenceScore: 0,
      fingerprint: null,
      visualSignature: null,
    },
  };
}

function openWatcherObservation() {
  let state = createInitialMessageWatcherState();

  state = advanceMessageWatcher(
    state,
    presentSample(1, 100),
    "msg_obs_a",
  ).state;
  state = advanceMessageWatcher(
    state,
    presentSample(
      2,
      225,
      fingerprintAJitter,
      signatureAJitter,
    ),
    "unused",
  ).state;
  return advanceMessageWatcher(
    state,
    presentSample(3, 350),
    "unused",
  ).state;
}

describe("message observation", () => {
  it("keeps lifecycle and resolution independent", () => {
    const active = createPendingObservation();
    const closed = closeMessageObservation(active, {
      closedAtMs: 1800,
      frameEnd: 18,
    });

    expect(active).toMatchObject({
      lifecycle: "active",
      resolution: "pending",
      disposition: "primary",
    });
    expect(closed).toMatchObject({
      lifecycle: "closed",
      resolution: "pending",
      closedAtMs: 1800,
    });
  });

  it("updates best evidence only when presence improves", () => {
    const initial = createPendingObservation();
    const weaker = updateMessageObservationBestEvidence(initial, {
      presenceScore: 0.6,
      frameIndex: 11,
      evidenceRef: "frame:11:1100",
    });
    const stronger = updateMessageObservationBestEvidence(initial, {
      presenceScore: 0.82,
      frameIndex: 12,
      evidenceRef: "frame:12:1200",
    });

    expect(weaker).toBe(initial);
    expect(stronger).toMatchObject({
      maxPresenceScore: 0.82,
      bestFrameIndex: 12,
      bestEvidenceRef: "frame:12:1200",
    });
  });

  it("settles closed empty OCR as unread primary", () => {
    const attempted = recordMessageObservationOcrAttempt(
      createPendingObservation(),
    );
    const failed = recordMessageObservationFailure(
      attempted,
      "ocr_timeout",
    );
    const closed = closeMessageObservation(failed, {
      closedAtMs: 1700,
      frameEnd: 17,
    });
    const unread = settleMessageObservationUnread(closed, {
      pendingOcrJobCount: 0,
      hasUsableOcrText: false,
    });

    expect(unread).toMatchObject({
      resolution: "unread",
      disposition: "primary",
      failureReason: "ocr_timeout",
    });
  });

  it("keeps a phase-rejected no-attempt observation suppressed", () => {
    const rejected = rejectMessageObservationOcrForPhase(
      createPendingObservation("phase-rejected"),
      "phase_rejected",
    );
    const closed = closeMessageObservation(rejected, {
      closedAtMs: 1700,
      frameEnd: 17,
    });
    const settled = settleMessageObservationUnread(closed, {
      pendingOcrJobCount: 0,
      hasUsableOcrText: false,
      failureReason: "no_ocr_attempt",
    });

    expect(settled).toMatchObject({
      resolution: "unread",
      disposition: "suppressed",
      suppressionReason: "phase_gate",
      ocrAdmissionReason: "phase_rejected",
      failureReason: "no_ocr_attempt",
    });
    expect(shouldShowObservationInPrimaryLog(settled)).toBe(false);
  });

  it("promotes a phase-waiting observation before OCR is queued", () => {
    const waiting = suppressMessageObservation(
      createPendingObservation("phase-waiting"),
      "phase_gate",
    );
    const admitted = admitMessageObservationOcr(
      waiting,
      "phase_confirmed",
    );

    expect(admitted).toMatchObject({
      resolution: "pending",
      disposition: "primary",
      suppressionReason: null,
      ocrAdmissionReason: "phase_confirmed",
    });
    expect(shouldShowObservationInPrimaryLog(admitted)).toBe(true);
  });

  it("creates review state only when an UnknownEvent actually exists", () => {
    const withMessage = attachMessageObservationOcrMessage(
      createPendingObservation(),
      "ocr_1",
    );
    const rejected = resolveMessageObservationAsOcrUnknown(withMessage, {
      ocrMessageId: "ocr_1",
      unknownEventIds: [],
    });
    const review = resolveMessageObservationAsOcrUnknown(withMessage, {
      ocrMessageId: "ocr_1",
      unknownEventIds: ["unk_1"],
    });

    expect(rejected).toMatchObject({
      resolution: "pending",
      disposition: "primary",
      unknownEventIds: [],
    });
    expect(review).toMatchObject({
      resolution: "ocr_unknown",
      disposition: "review",
      unknownEventIds: ["unk_1"],
      failureReason: "parser_unknown",
    });
  });

  it("keeps strong visual garbage as unread and suppresses weak visual garbage", () => {
    const strong = closeMessageObservation(
      createPendingObservation("strong"),
      { closedAtMs: 1700, frameEnd: 17 },
    );
    const weak = closeMessageObservation(
      createPendingObservation("weak", {
        commitScore: 0.2,
        dynamic: 0.1,
        persistent: 0.85,
      }),
      { closedAtMs: 1700, frameEnd: 17 },
    );
    const strongResult = settleMessageObservationUnread(strong, {
      pendingOcrJobCount: 0,
      hasUsableOcrText: true,
      unknownGateReason: "timer",
    });
    const weakResult = settleMessageObservationUnread(weak, {
      pendingOcrJobCount: 0,
      hasUsableOcrText: true,
      unknownGateReason: "symbol_noise",
    });

    expect(strongResult).toMatchObject({
      resolution: "unread",
      disposition: "primary",
      suppressionReason: null,
      unknownGateReason: "timer",
    });
    expect(weakResult).toMatchObject({
      resolution: "unread",
      disposition: "suppressed",
      suppressionReason: "ocr_noise_gate",
      unknownGateReason: "symbol_noise",
    });
    expect(shouldShowObservationInPrimaryLog(strongResult)).toBe(true);
    expect(shouldShowObservationInPrimaryLog(weakResult)).toBe(false);
  });

  it("allows unread and suppressed observations to upgrade to resolved", () => {
    const closed = closeMessageObservation(
      createPendingObservation(),
      { closedAtMs: 1700, frameEnd: 17 },
    );
    const unread = settleMessageObservationUnread(closed, {
      pendingOcrJobCount: 0,
      hasUsableOcrText: false,
    });
    const suppressed = suppressMessageObservation(
      unread,
      "ocr_noise_gate",
      "timer",
    );
    const resolved = resolveMessageObservationWithEvents(suppressed, {
      ocrMessageId: "ocr_late",
      eventIds: ["evt_late"],
    });
    const downgrade = resolveMessageObservationAsOcrUnknown(resolved, {
      unknownEventIds: ["unk_late"],
    });

    expect(resolved).toMatchObject({
      resolution: "resolved",
      disposition: "primary",
      suppressionReason: null,
      eventIds: ["evt_late"],
    });
    expect(downgrade).toBe(resolved);
  });

  it("summarizes committed and suppressed observations separately", () => {
    const pending = createPendingObservation("pending");
    const resolved = resolveMessageObservationWithEvents(
      createPendingObservation("resolved"),
      { eventIds: ["evt_1"] },
    );
    const review = resolveMessageObservationAsOcrUnknown(
      createPendingObservation("review"),
      { unknownEventIds: ["unk_1"] },
    );
    const suppressed = suppressMessageObservation(
      createPendingObservation("suppressed"),
      "ocr_noise_gate",
      "timer",
    );

    expect(
      summarizeMessageObservations([
        pending,
        resolved,
        review,
        suppressed,
      ]),
    ).toEqual({
      detectedCount: 4,
      committedCount: 4,
      resolvedCount: 1,
      ocrUnknownCount: 1,
      unreadCount: 0,
      openedWhileOcrBusyCount: 0,
      suppressedCount: 1,
      persistentUiSuppressedCount: 0,
      noiseSuppressedCount: 1,
      mergedCount: 0,
    });
  });

  it("never hides resolved observations and suppresses orphan ocr_unknown rows", () => {
    const resolved = {
      ...resolveMessageObservationWithEvents(
        createPendingObservation("resolved"),
        { eventIds: ["evt_1"] },
      ),
      disposition: "suppressed" as const,
    };
    const orphanUnknown = {
      ...createPendingObservation("orphan"),
      resolution: "ocr_unknown" as const,
      disposition: "primary" as const,
      failureReason: "parser_unknown" as const,
    };

    expect(shouldShowObservationInPrimaryLog(resolved)).toBe(true);
    expect(shouldShowObservationInPrimaryLog(orphanUnknown)).toBe(false);
    expect(
      summarizeMessageObservations([resolved, orphanUnknown]),
    ).toMatchObject({
      resolvedCount: 1,
      ocrUnknownCount: 0,
      suppressedCount: 1,
    });
  });
});

describe("message watcher candidate and active states", () => {
  it("does not commit a one-sample spike", () => {
    let state = createInitialMessageWatcherState();
    const spike = advanceMessageWatcher(
      state,
      presentSample(1, 100),
      "msg_obs_a",
    );
    state = spike.state;
    state = advanceMessageWatcher(
      state,
      absentSample(2, 200),
      "unused",
    ).state;
    const suppressed = advanceMessageWatcher(
      state,
      absentSample(3, 300),
      "unused",
    );

    expect(spike.transitions.map((transition) => transition.type)).toEqual([
      "candidate_started",
    ]);
    expect(
      suppressed.transitions.some(
        (transition) => transition.type === "opened",
      ),
    ).toBe(false);
    expect(suppressed.state.activeObservation).toBeNull();
  });

  it("does not commit when only two of five samples are present", () => {
    let state = createInitialMessageWatcherState();
    const samples = [
      presentSample(1, 0),
      absentSample(2, 100),
      presentSample(3, 200),
      absentSample(4, 300),
      absentSample(5, 400),
    ];
    const transitions = [];

    for (const sample of samples) {
      const result = advanceMessageWatcher(
        state,
        sample,
        "msg_obs_a",
      );
      state = result.state;
      transitions.push(...result.transitions);
    }

    expect(
      transitions.some((transition) => transition.type === "opened"),
    ).toBe(false);
  });

  it("commits after three of five presence samples and 250ms", () => {
    let state = createInitialMessageWatcherState();

    state = advanceMessageWatcher(
      state,
      presentSample(1, 100),
      "msg_obs_a",
    ).state;
    state = advanceMessageWatcher(
      state,
      presentSample(
        2,
        225,
        fingerprintAJitter,
        signatureAJitter,
      ),
      "unused",
    ).state;
    const result = advanceMessageWatcher(
      state,
      presentSample(3, 350),
      "unused",
    );

    expect(result.transitions).toEqual([
      expect.objectContaining({
        type: "opened",
        id: "msg_obs_a",
        openedAtMs: 100,
        frameStart: 1,
        candidateDurationMs: 250,
      }),
    ]);
    expect(result.state.activeObservation?.id).toBe("msg_obs_a");
    expect(result.state.candidate).toBeNull();
  });

  it("keeps progressive rendering in the same observation even over the old fingerprint threshold", () => {
    let state = openWatcherObservation();
    const result = advanceMessageWatcher(
      state,
      presentSample(
        4,
        450,
        fingerprintAProgressive,
        signatureAProgressive,
        0.82,
      ),
      "unused",
    );

    expect(result.state.activeObservation?.id).toBe("msg_obs_a");
    expect(result.transitions.map((transition) => transition.type)).toContain(
      "progressive_render_continued",
    );
    expect(
      result.transitions.some(
        (transition) => transition.type === "closed",
      ),
    ).toBe(false);
  });

  it("requires four stable distinct samples before switching observations", () => {
    let state = openWatcherObservation();
    const first = advanceMessageWatcher(
      state,
      presentSample(4, 450, fingerprintB, signatureB),
      "msg_obs_b",
    );
    state = first.state;
    const second = advanceMessageWatcher(
      state,
      presentSample(5, 550, fingerprintB, signatureB),
      "unused",
    );
    state = second.state;
    const third = advanceMessageWatcher(
      state,
      presentSample(6, 650, fingerprintB, signatureB),
      "unused",
    );
    state = third.state;
    const fourth = advanceMessageWatcher(
      state,
      presentSample(7, 750, fingerprintB, signatureB),
      "unused",
    );

    expect(first.state.activeObservation?.id).toBe("msg_obs_a");
    expect(second.state.activeObservation?.id).toBe("msg_obs_a");
    expect(third.state.activeObservation?.id).toBe("msg_obs_a");
    expect(fourth.transitions.map((transition) => transition.type)).toEqual([
      "closed",
      "opened",
    ]);
    expect(fourth.state.activeObservation?.id).toBe("msg_obs_b");
  });

  it("does not close for one or two absent samples and closes on the third", () => {
    let state = openWatcherObservation();
    const first = advanceMessageWatcher(
      state,
      absentSample(4, 450),
      "unused",
    );
    state = first.state;
    const second = advanceMessageWatcher(
      state,
      absentSample(5, 550),
      "unused",
    );
    state = second.state;
    const third = advanceMessageWatcher(
      state,
      absentSample(6, 650),
      "unused",
    );

    expect(first.transitions).toEqual([]);
    expect(second.transitions).toEqual([]);
    expect(third.transitions).toEqual([
      expect.objectContaining({
        type: "closed",
        reason: "absence",
        frameEnd: 6,
      }),
    ]);
  });

  it("suppresses a warmed persistent UI candidate without opening it", () => {
    let state = createInitialMessageWatcherState();
    const persistentOverrides = {
      persistentUiOverlapRatio: 0.9,
      dynamicForegroundRatio: 0.1,
      persistentUiModelWarmedUp: true,
    };

    state = advanceMessageWatcher(
      state,
      presentSample(
        1,
        0,
        fingerprintA,
        signatureA,
        0.7,
        persistentOverrides,
      ),
      "msg_timer",
    ).state;
    const result = advanceMessageWatcher(
      state,
      presentSample(
        2,
        100,
        fingerprintA,
        signatureA,
        0.7,
        persistentOverrides,
      ),
      "unused",
    );

    expect(result.transitions).toEqual([
      expect.objectContaining({
        type: "candidate_suppressed",
        reason: "persistent_ui",
      }),
    ]);
    expect(result.state.activeObservation).toBeNull();
  });

  it("allows a dynamic message overlay to escape a suppressed persistent UI signature", () => {
    let state = createInitialMessageWatcherState();
    const persistentOverrides = {
      persistentUiOverlapRatio: 0.9,
      dynamicForegroundRatio: 0.1,
      persistentUiModelWarmedUp: true,
    };
    const dynamicOverrides = {
      persistentUiOverlapRatio: 0.2,
      dynamicForegroundRatio: 0.8,
      persistentUiModelWarmedUp: true,
    };

    state = advanceMessageWatcher(
      state,
      presentSample(
        1,
        0,
        fingerprintA,
        signatureA,
        0.7,
        persistentOverrides,
      ),
      "msg_timer",
    ).state;
    state = advanceMessageWatcher(
      state,
      presentSample(
        2,
        100,
        fingerprintA,
        signatureA,
        0.7,
        persistentOverrides,
      ),
      "unused",
    ).state;
    const started = advanceMessageWatcher(
      state,
      presentSample(
        3,
        200,
        fingerprintAProgressive,
        signatureAProgressive,
        0.8,
        dynamicOverrides,
      ),
      "msg_real",
    );
    state = started.state;
    state = advanceMessageWatcher(
      state,
      presentSample(
        4,
        325,
        fingerprintAProgressive,
        signatureAProgressive,
        0.8,
        dynamicOverrides,
      ),
      "unused",
    ).state;
    const committed = advanceMessageWatcher(
      state,
      presentSample(
        5,
        450,
        fingerprintAProgressive,
        signatureAProgressive,
        0.8,
        dynamicOverrides,
      ),
      "unused",
    );

    expect(started.transitions).toEqual([
      expect.objectContaining({
        type: "candidate_started",
        id: "msg_real",
      }),
    ]);
    expect(committed.transitions).toEqual([
      expect.objectContaining({
        type: "opened",
        id: "msg_real",
      }),
    ]);
  });

  it("closes active state and suppresses provisional state on stop", () => {
    const activeResult = closeActiveMessageWatcher(
      openWatcherObservation(),
      {
        timestampMs: 800,
        frameIndex: 8,
        reason: "analysis_stopped",
      },
    );
    let candidateState: MessageWatcherState =
      createInitialMessageWatcherState();
    candidateState = advanceMessageWatcher(
      candidateState,
      presentSample(1, 0),
      "msg_candidate",
    ).state;
    const candidateResult = closeActiveMessageWatcher(candidateState, {
      timestampMs: 100,
      frameIndex: 2,
      reason: "analysis_stopped",
    });

    expect(activeResult.transitions).toEqual([
      expect.objectContaining({
        type: "closed",
        reason: "analysis_stopped",
      }),
    ]);
    expect(candidateResult.transitions).toEqual([
      expect.objectContaining({
        type: "candidate_suppressed",
        reason: "transient",
      }),
    ]);
  });

  it("stale-closes an active observation", () => {
    const state = openWatcherObservation();
    const result = advanceMessageWatcher(
      state,
      absentSample(200, 15_350),
      "msg_after_stale",
    );

    expect(result.transitions[0]).toMatchObject({
      type: "closed",
      id: "msg_obs_a",
      reason: "stale",
    });
  });
});
