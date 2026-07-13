import { describe, expect, it } from "vitest";
import {
  createUnknownCoverageReport,
  replayBattleLogCoverage,
} from "../src/tools/unknownCoverageCore.ts";
import fixtureBattleLog from "./fixtures/unknown-coverage-battle-log.json";

function createReplayItem(overrides) {
  return {
    ocrId: "ocr-test",
    timestampMs: 1000,
    frameIndex: 1,
    rawText: "テスト",
    normalizedText: "テスト",
    matchText: "テスト",
    ocrConfidence: 0.8,
    parseStatus: "unknown",
    candidateMatches: [],
    acceptedEvents: [],
    suppressedEvents: [],
    unknown: {
      id: "unk-test",
      battleId: "battle-test",
      timestampMs: 1000,
      afterEventId: null,
      rawText: "テスト",
      normalizedText: "テスト",
      ocrConfidence: 0.8,
      candidateMatches: [],
      sourceFrameRef: null,
      reviewStatus: "unreviewed",
    },
    suppressedUnknown: null,
    unknownSuppressedAsNoise: false,
    duplicateSuppressed: false,
    dedupeKeys: [],
    ...overrides,
  };
}

function createReplayResult(items, acceptedEvents = []) {
  return {
    inputOcrMessageCount: items.length,
    replayParsedEventCount: acceptedEvents.length,
    replayUnknownCount: items.filter((item) => item.unknown).length,
    previousExportedEventCount: 0,
    previousExportedUnknownCount: 0,
    unknownRateBeforeReplay: 0,
    unknownRateAfterReplay: 0,
    eventTypeDistribution: {},
    duplicateSuppressedCount: items.filter((item) => item.duplicateSuppressed).length,
    unknownSuppressedAsNoiseCount: items.filter((item) => item.unknownSuppressedAsNoise).length,
    constrainedAcceptedCount: 0,
    constrainedReviewCount: items.filter((item) =>
      item.candidateMatches.some((candidate) => candidate.startsWith("constrained-review:")),
    ).length,
    multiEventOcrCount: 0,
    coverageDeltaSummary: {
      parsedEventDelta: 0,
      unknownDelta: 0,
      unknownRateDelta: 0,
    },
    replayItems: items,
    acceptedEvents,
    unknowns: items.map((item) => item.unknown).filter(Boolean),
  };
}

describe("unknown coverage report", () => {
  it("現在parserでBattle Log OCRをreplayし、multi-eventとdedupe/noiseを集計する", () => {
    const replay = replayBattleLogCoverage(fixtureBattleLog);

    expect(replay.inputOcrMessageCount).toBe(5);
    expect(replay.multiEventOcrCount).toBe(1);
    expect(replay.eventTypeDistribution.switch_in).toBe(2);
    expect(replay.replayParsedEventCount).toBeGreaterThanOrEqual(3);
    expect(replay.duplicateSuppressedCount).toBeGreaterThanOrEqual(1);
    expect(replay.unknownSuppressedAsNoiseCount).toBeGreaterThanOrEqual(1);
    expect(replay.coverageDeltaSummary.parsedEventDelta).toBe(
      replay.replayParsedEventCount - replay.previousExportedEventCount,
    );
  });

  it("runtime同様にsession rosterを育て、崩れた同一技を別Pokemonとして増やさない", () => {
    const replay = replayBattleLogCoverage({
      battle: { id: "battle-session-roster" },
      events: [],
      unknowns: [],
      ocrMessages: [
        {
          id: "ocr-1",
          rawText: "相手の リザードンの ねっぷう!",
          ocrConfidence: 0.9,
          timestampMs: 1000,
          frameIndex: 1,
        },
        {
          id: "ocr-2",
          rawText: "坪手の リザードマの でっぷう/",
          ocrConfidence: 0.86,
          timestampMs: 1800,
          frameIndex: 2,
        },
      ],
    });

    expect(replay.eventTypeDistribution.move).toBe(1);
    expect(replay.duplicateSuppressedCount).toBe(1);
    expect(replay.replayItems[1].suppressedEvents[0]).toMatchObject({
      type: "move",
      actor: { name: "リザードン", side: "opponent" },
      move: "ねっぷう",
    });
  });

  it("champout候補はbtl_setを優先しつつ、placeholder policy不足ならhold_reviewにする", () => {
    const replay = createReplayResult([
      createReplayItem({
        ocrId: "ocr-rankup",
        rawText: "ガブリアスの 攻撃が ぐーんと 上がった!",
        normalizedText: "ガブリアスの 攻撃が ぐーんと 上がった!",
        matchText: "ガブリアスの攻撃がぐーんと上がった",
      }),
      createReplayItem({
        ocrId: "ocr-state-risk",
        rawText: "状態異常に ついて",
        normalizedText: "状態異常に ついて",
        matchText: "状態異常について",
      }),
    ]);
    const report = createUnknownCoverageReport(replay, {
      top: 10,
      champoutIndex: {
        available: true,
        warnings: [],
        entries: [
          {
            fileName: "btl_set.json",
            labelName: "BTL_SET_RankupLv3",
            eventType: "boost",
            sourceStatus: "review_index",
            allowedByCurrentConfig: false,
            blockedByCurrentConfig: true,
            blockedByDenyPattern: false,
            requiresPlaceholderPolicy: true,
            riskHints: [
              "review_index_only",
              "blocked_by_current_config",
              "placeholder_policy_required",
              "risky_placeholder",
            ],
            notes: "placeholderの意味が未確定のためreviewで確認する候補。",
            matchText: "0の1がぐーんと上がった",
            skeletonMatchText: "攻撃がぐーんと上がった",
          },
          {
            fileName: "btl_state_syn.json",
            labelName: "STATE_HELP",
            eventType: "status",
            sourceStatus: "review_index",
            allowedByCurrentConfig: false,
            blockedByCurrentConfig: true,
            blockedByDenyPattern: true,
            requiresPlaceholderPolicy: false,
            riskHints: [
              "review_index_only",
              "blocked_by_current_config",
              "blocked_by_deny_pattern",
            ],
            notes: "deny/text denyに該当するためactive化は保留。",
            matchText: "状態異常について",
            skeletonMatchText: "状態異常について",
          },
        ],
      },
    });

    const champoutProposal = report.proposals.find((proposal) =>
      proposal.rootCauses.includes("champout_source_candidate"),
    );

    expect(champoutProposal).toMatchObject({
      kind: "hold_review",
      risk: "high",
    });
    expect(champoutProposal.rootCauses).toEqual(
      expect.arrayContaining([
        "champout_source_candidate",
        "blocked_by_current_config",
        "placeholder_policy_required",
        "risky_placeholder",
      ]),
    );
    expect(champoutProposal.recommendedActions).toContain("hold_review");
    expect(report.clusters.some((cluster) =>
      cluster.champoutCandidates.some((candidate) =>
        candidate.fileName === "btl_set.json" &&
          candidate.sourceStatus === "review_index" &&
          candidate.requiresPlaceholderPolicy &&
          candidate.riskHints.includes("risky_placeholder"),
      ),
    )).toBe(true);
    expect(report.proposals.every((proposal) => proposal.kind !== "champout_config_patch")).toBe(true);
  });

  it("placeholder不要のreview/index候補は低riskのallowlist候補として出す", () => {
    const replay = createReplayResult([
      createReplayItem({
        ocrId: "ocr-shine",
        rawText: "日差しが 強くなった!",
        normalizedText: "日差しが 強くなった!",
        matchText: "日差しが強くなった",
      }),
    ]);
    const report = createUnknownCoverageReport(replay, {
      top: 10,
      champoutIndex: {
        available: true,
        warnings: [],
        entries: [
          {
            fileName: "btl_std.json",
            labelName: "BTL_STRID_STD_ShineStart",
            eventType: "weather_start",
            sourceStatus: "review_index",
            allowedByCurrentConfig: false,
            blockedByCurrentConfig: true,
            blockedByDenyPattern: false,
            requiresPlaceholderPolicy: false,
            riskHints: ["review_index_only", "blocked_by_current_config"],
            notes: "現在のactive allowlist外のreview/index候補。",
            matchText: "日差しが強くなった",
            skeletonMatchText: "日差しが強くなった",
          },
        ],
      },
    });

    expect(report.clusters[0]).toMatchObject({
      classification: "champout_source_candidate",
      rootCauses: expect.arrayContaining([
        "champout_source_candidate",
        "blocked_by_current_config",
      ]),
      recommendedActions: expect.arrayContaining(["add_champout_allowlist", "hold_review"]),
      champoutCandidates: [
        expect.objectContaining({
          fileName: "btl_std.json",
          labelName: "BTL_STRID_STD_ShineStart",
          sourceStatus: "review_index",
          allowedByCurrentConfig: false,
          blockedByCurrentConfig: true,
          riskHints: ["review_index_only", "blocked_by_current_config"],
        }),
      ],
    });
    expect(report.proposals[0]).toMatchObject({
      kind: "champout_config_patch",
      risk: "low",
    });
  });

  it("generated near missはconstrained decoder review proposalへ寄せる", () => {
    const replay = createReplayResult([
      createReplayItem({
        ocrId: "ocr-fail-near-miss",
        rawText: "しかし うまぐ 決まらなかつた!",
        normalizedText: "しかし うまぐ 決まらなかつた!",
        matchText: "しかしうまぐ決まらなかつた",
        candidateMatches: ["constrained-review:eventType=fail;templateId=champout_fail_test"],
      }),
    ]);
    const report = createUnknownCoverageReport(replay, {
      champoutIndex: { available: false, warnings: [], entries: [] },
    });

    expect(report.clusters[0].rootCauses).toContain("generated_rule_near_miss");
    expect(report.proposals[0].kind).toBe("constrained_decoder_threshold_review");
  });

  it("champoutがない場合もwarningつきでreportを作れる", () => {
    const replay = createReplayResult([
      createReplayItem({
        ocrId: "ocr-sand-fragment",
        rawText: "砂あらしが ー",
        normalizedText: "砂あらしが ー",
        matchText: "砂あらしがー",
      }),
    ]);
    const report = createUnknownCoverageReport(replay, {
      champoutIndex: {
        available: false,
        warnings: ["others/champout がないため、champout source照合はskipしました。"],
        entries: [],
      },
    });

    expect(report.warnings).toHaveLength(1);
    expect(report.clusters[0].rootCauses).toContain("ocr_fragment");
    expect(report.proposals[0].kind).toBe("hold_review");
  });
});
