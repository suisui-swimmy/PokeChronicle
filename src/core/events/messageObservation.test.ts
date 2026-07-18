import { describe, expect, it } from "vitest";
import type { MessageMaskFingerprint } from "../preprocess/messagePreprocess";
import {
  advanceMessageWatcher,
  attachMessageObservationOcrMessage,
  closeActiveMessageWatcher,
  closeMessageObservation,
  createInitialMessageWatcherState,
  createMessageObservation,
  DEFAULT_MESSAGE_WATCHER_CONFIG,
  recordMessageObservationFailure,
  recordMessageObservationOcrAttempt,
  resolveMessageObservationAsOcrUnknown,
  resolveMessageObservationWithEvents,
  settleMessageObservationUnread,
  summarizeMessageObservations,
  updateMessageObservationBestEvidence,
  type MessageWatcherState,
} from "./messageObservation";

const fingerprintA: MessageMaskFingerprint = {
  columns: 2,
  rows: 2,
  cells: [4, 4, 0, 0],
  foregroundPixelRatio: 0.08,
};
const fingerprintAJitter: MessageMaskFingerprint = {
  columns: 2,
  rows: 2,
  cells: [4, 3, 0, 0],
  foregroundPixelRatio: 0.081,
};
const fingerprintB: MessageMaskFingerprint = {
  columns: 2,
  rows: 2,
  cells: [0, 0, 4, 4],
  foregroundPixelRatio: 0.08,
};

function createPendingObservation(id = "msg_obs_1") {
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
  });
}

function presentSample(
  frameIndex: number,
  timestampMs: number,
  fingerprint: MessageMaskFingerprint = fingerprintA,
  presenceScore = 0.7,
) {
  return {
    frameIndex,
    timestampMs,
    analysis: {
      present: true,
      presenceScore,
      fingerprint,
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
    },
  };
}

function openWatcherObservation() {
  let state = createInitialMessageWatcherState();
  state = advanceMessageWatcher(state, presentSample(1, 100), "msg_obs_a").state;
  return advanceMessageWatcher(state, presentSample(2, 200), "msg_obs_a").state;
}

describe("message observation", () => {
  it("creates and closes an observation without coupling lifecycle to resolution", () => {
    const active = createPendingObservation();
    const closed = closeMessageObservation(active, { closedAtMs: 1800, frameEnd: 18 });

    expect(active).toMatchObject({
      lifecycle: "active",
      resolution: "pending",
      openedWhileOcrBusy: false,
    });
    expect(closed).toMatchObject({
      lifecycle: "closed",
      resolution: "pending",
      closedAtMs: 1800,
      frameEnd: 18,
    });
  });

  it("updates best evidence only when the presence score improves", () => {
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

  it("records OCR attempts and settles a closed empty observation as unread", () => {
    const attempted = recordMessageObservationOcrAttempt(createPendingObservation());
    const failed = recordMessageObservationFailure(attempted, "ocr_timeout");
    const activeResult = settleMessageObservationUnread(failed, {
      pendingOcrJobCount: 0,
      hasUsableOcrText: false,
    });
    const closed = closeMessageObservation(failed, { closedAtMs: 1700, frameEnd: 17 });
    const pendingResult = settleMessageObservationUnread(closed, {
      pendingOcrJobCount: 1,
      hasUsableOcrText: false,
    });
    const unread = settleMessageObservationUnread(closed, {
      pendingOcrJobCount: 0,
      hasUsableOcrText: false,
    });

    expect(attempted.ocrAttemptCount).toBe(1);
    expect(activeResult.resolution).toBe("pending");
    expect(pendingResult.resolution).toBe("pending");
    expect(unread).toMatchObject({
      resolution: "unread",
      failureReason: "ocr_timeout",
    });
  });

  it("uses the actual gate failure and no-attempt fallback when settling unread", () => {
    const closed = closeMessageObservation(createPendingObservation(), {
      closedAtMs: 1700,
      frameEnd: 17,
    });
    const preprocessRejected = settleMessageObservationUnread(
      recordMessageObservationFailure(closed, "preprocess_rejected"),
      { pendingOcrJobCount: 0, hasUsableOcrText: false },
    );
    const noAttempt = settleMessageObservationUnread(closed, {
      pendingOcrJobCount: 0,
      hasUsableOcrText: false,
    });

    expect(preprocessRejected.failureReason).toBe("preprocess_rejected");
    expect(noAttempt.failureReason).toBe("no_ocr_attempt");
  });

  it("resolves one observation with every event in a parser bundle", () => {
    const resolved = resolveMessageObservationWithEvents(createPendingObservation(), {
      ocrMessageId: "ocr_1",
      eventIds: ["evt_ocr_1_1", "evt_ocr_1_2"],
    });

    expect(resolved).toMatchObject({
      resolution: "resolved",
      ocrMessageIds: ["ocr_1"],
      eventIds: ["evt_ocr_1_1", "evt_ocr_1_2"],
      failureReason: null,
    });
  });

  it("marks readable unclassified OCR as unknown without inventing an UnknownEvent id", () => {
    const withMessage = attachMessageObservationOcrMessage(
      createPendingObservation(),
      "ocr_1",
    );
    const unknown = resolveMessageObservationAsOcrUnknown(withMessage, {
      ocrMessageId: "ocr_1",
      unknownEventIds: [],
    });

    expect(unknown).toMatchObject({
      resolution: "ocr_unknown",
      ocrMessageIds: ["ocr_1"],
      unknownEventIds: [],
      failureReason: "parser_unknown",
    });
  });

  it("allows late unread upgrades and never downgrades a resolved observation", () => {
    const closed = closeMessageObservation(
      recordMessageObservationOcrAttempt(createPendingObservation()),
      { closedAtMs: 1700, frameEnd: 17 },
    );
    const unread = settleMessageObservationUnread(closed, {
      pendingOcrJobCount: 0,
      hasUsableOcrText: false,
    });
    const lateUnknown = resolveMessageObservationAsOcrUnknown(unread, {
      ocrMessageId: "ocr_late_unknown",
      unknownEventIds: ["unk_late"],
    });
    const lateResolved = resolveMessageObservationWithEvents(lateUnknown, {
      ocrMessageId: "ocr_late_resolved",
      eventIds: ["evt_late_1"],
    });
    const attemptedDowngrade = resolveMessageObservationAsOcrUnknown(lateResolved, {
      ocrMessageId: "ocr_too_late",
      unknownEventIds: ["unk_too_late"],
    });

    expect(unread.resolution).toBe("unread");
    expect(lateUnknown.resolution).toBe("ocr_unknown");
    expect(lateResolved).toMatchObject({
      resolution: "resolved",
      eventIds: ["evt_late_1"],
      failureReason: null,
    });
    expect(attemptedDowngrade).toBe(lateResolved);
  });

  it("summarizes observations without treating pending rows as resolved data", () => {
    const pending = createPendingObservation("pending");
    const resolved = resolveMessageObservationWithEvents(
      createMessageObservation({
        ...createPendingObservation("resolved"),
        id: "resolved",
        presenceScore: 0.7,
        visualFingerprint: fingerprintA,
        openedWhileOcrBusy: true,
      }),
      { eventIds: ["evt_1"] },
    );
    const unknown = resolveMessageObservationAsOcrUnknown(
      createPendingObservation("unknown"),
    );
    const unread = settleMessageObservationUnread(
      closeMessageObservation(createPendingObservation("unread"), {
        closedAtMs: 2000,
        frameEnd: 20,
      }),
      { pendingOcrJobCount: 0, hasUsableOcrText: false },
    );

    expect(summarizeMessageObservations([pending, resolved, unknown, unread])).toEqual({
      detectedCount: 4,
      resolvedCount: 1,
      ocrUnknownCount: 1,
      unreadCount: 1,
      openedWhileOcrBusyCount: 1,
    });
  });
});

describe("message watcher", () => {
  it("does not open for a one-sample spike", () => {
    let state = createInitialMessageWatcherState();
    const spike = advanceMessageWatcher(state, presentSample(1, 100), "msg_obs_a");
    state = spike.state;
    const absent = advanceMessageWatcher(state, absentSample(2, 200), "msg_obs_a");

    expect(spike.transitions).toEqual([]);
    expect(absent.transitions).toEqual([]);
    expect(absent.state.activeObservation).toBeNull();
  });

  it("opens after two similar presence samples within the latest three", () => {
    let state = createInitialMessageWatcherState();
    state = advanceMessageWatcher(state, presentSample(1, 100), "msg_obs_a").state;
    state = advanceMessageWatcher(state, absentSample(2, 200), "msg_obs_a").state;
    const result = advanceMessageWatcher(
      state,
      presentSample(3, 300, fingerprintAJitter, 0.78),
      "msg_obs_a",
    );

    expect(result.transitions).toEqual([
      expect.objectContaining({
        type: "opened",
        id: "msg_obs_a",
        openedAtMs: 100,
        frameStart: 1,
        maxPresenceScore: 0.78,
        bestFrameIndex: 3,
      }),
    ]);
    expect(result.state.activeObservation?.id).toBe("msg_obs_a");
  });

  it("keeps small fingerprint jitter in one observation and only emits significant best updates", () => {
    let state = openWatcherObservation();
    const smallChange = advanceMessageWatcher(
      state,
      presentSample(3, 300, fingerprintAJitter, 0.72),
      "unused",
    );
    state = smallChange.state;
    const stronger = advanceMessageWatcher(
      state,
      presentSample(4, 400, fingerprintAJitter, 0.82),
      "unused",
    );

    expect(smallChange.transitions).toEqual([]);
    expect(smallChange.state.activeObservation?.id).toBe("msg_obs_a");
    expect(stronger.transitions).toEqual([
      {
        type: "updated",
        id: "msg_obs_a",
        maxPresenceScore: 0.82,
        bestFrameIndex: 4,
      },
    ]);
  });

  it("closes A and opens B after a different fingerprint is stable twice", () => {
    let state = openWatcherObservation();
    const firstDifferent = advanceMessageWatcher(
      state,
      presentSample(3, 300, fingerprintB),
      "msg_obs_b",
    );
    state = firstDifferent.state;
    const switched = advanceMessageWatcher(
      state,
      presentSample(4, 400, fingerprintB, 0.8),
      "msg_obs_b",
    );

    expect(firstDifferent.transitions).toEqual([]);
    expect(switched.transitions.map((transition) => transition.type)).toEqual([
      "closed",
      "opened",
    ]);
    expect(switched.transitions[0]).toMatchObject({
      id: "msg_obs_a",
      reason: "fingerprint_changed",
    });
    expect(switched.transitions[1]).toMatchObject({
      id: "msg_obs_b",
      frameStart: 3,
    });
    expect(switched.state.activeObservation?.id).toBe("msg_obs_b");
  });

  it("closes after two consecutive absence samples", () => {
    let state = openWatcherObservation();
    const firstAbsent = advanceMessageWatcher(state, absentSample(3, 300), "unused");
    state = firstAbsent.state;
    const closed = advanceMessageWatcher(state, absentSample(4, 400), "unused");

    expect(firstAbsent.transitions).toEqual([]);
    expect(closed.transitions).toEqual([
      expect.objectContaining({
        type: "closed",
        id: "msg_obs_a",
        reason: "absence",
        frameEnd: 4,
      }),
    ]);
    expect(closed.state.activeObservation).toBeNull();
  });

  it("closes the active observation when analysis stops", () => {
    const result = closeActiveMessageWatcher(openWatcherObservation(), {
      timestampMs: 450,
      frameIndex: 5,
      reason: "analysis_stopped",
    });

    expect(result.transitions).toEqual([
      expect.objectContaining({
        type: "closed",
        id: "msg_obs_a",
        reason: "analysis_stopped",
      }),
    ]);
    expect(result.state.activeObservation).toBeNull();
  });

  it("stale-closes an observation instead of leaving it active forever", () => {
    const state = openWatcherObservation();
    const result = advanceMessageWatcher(
      state,
      presentSample(
        200,
        100 + DEFAULT_MESSAGE_WATCHER_CONFIG.staleTimeoutMs,
        fingerprintA,
      ),
      "msg_obs_after_stale",
    );

    expect(result.transitions[0]).toMatchObject({
      type: "closed",
      id: "msg_obs_a",
      reason: "stale",
    });
    expect(result.state.activeObservation).toBeNull();
  });
});
