import { describe, expect, it } from "vitest";
import { getParsedBattleEvents, parseBattleMessage } from "../parser/seedParser";
import {
  selectOcrCandidate,
  shouldRetryOcrCandidate,
  type EvaluatedOcrCandidate,
} from "./ocrCandidateSelection";

function createCandidate(
  id: string,
  rawText: string,
  confidence: number,
): EvaluatedOcrCandidate {
  const result = { rawText, confidence, lines: [] };

  return {
    candidate: {
      id,
      variantId: id,
      strategy: id.includes("linewise") ? "linewise" : "block",
      segments: [],
    },
    result,
    parseResult: parseBattleMessage({ rawText, ocrConfidence: confidence }),
    durationMs: 100,
  };
}

describe("adaptive OCR candidate selection", () => {
  it("retries high-confidence OCR text when the parser still sees an unknown", () => {
    const primary = createCandidate("primary", "くろまろは ー", 0.86);

    expect(shouldRetryOcrCandidate(primary)).toBe(true);
  });

  it("prefers a parseable linewise switch-in over high-confidence junk", () => {
    const primary = createCandidate("primary", "くろまろは ー", 0.86);
    const linewise = createCandidate(
      "linewise",
      "くろまろは\nエルフーンを 繰り出した!",
      0.72,
    );
    const selection = selectOcrCandidate([primary, linewise]);

    expect(selection.conflict).toBe(false);
    expect(selection.selected.candidate.id).toBe("linewise");
    expect(selection.parseResult).toMatchObject({
      status: "event",
      event: { type: "switch_in", actor: { name: "エルフーン" } },
    });
  });

  it("does not retry a strong primary event", () => {
    const primary = createCandidate("primary", "相手の リザードンの ねっぷう!", 0.76);

    expect(shouldRetryOcrCandidate(primary)).toBe(false);
  });

  it("treats a target-resolved miss as a complete primary event", () => {
    const primary = createCandidate(
      "primary",
      "相手の エルフーンには 当たらなかった!",
      0.94,
    );

    expect(shouldRetryOcrCandidate(primary)).toBe(false);
  });

  it("accepts two events emitted by one strong candidate", () => {
    const primary = createCandidate(
      "primary",
      "くろまろは イベントにさんかした リザードンと\nエルフーンを 繰り出した/ 関",
      0.93,
    );
    const selection = selectOcrCandidate([primary]);

    expect(selection.conflict).toBe(false);
    expect(selection.reason).toBe("strong-event-selected");
    expect(getParsedBattleEvents(selection.parseResult).map((event) => event.actor.name)).toEqual([
      "リザードン",
      "エルフーン",
    ]);
  });

  it("accepts strong candidates that agree on the same multi-event bundle", () => {
    const primary = createCandidate(
      "primary",
      "くろまろは イベントにさんかした リザードンと\nエルフーンを 繰り出した!",
      0.93,
    );
    const retry = createCandidate(
      "linewise",
      "くぐろまろは イベントにさんかがかしただ リザードンと\nエルフーンを 繰り出した!",
      0.91,
    );
    const selection = selectOcrCandidate([primary, retry]);

    expect(selection.conflict).toBe(false);
    expect(getParsedBattleEvents(selection.parseResult).map((event) => event.actor.name)).toEqual([
      "リザードン",
      "エルフーン",
    ]);
  });

  it("holds strong candidates with different multi-event bundles as unknown", () => {
    const opponentSwitchIn = createCandidate(
      "primary",
      "くろまろは イベントにさんかした リザードンと\nエルフーンを 繰り出した!",
      0.93,
    );
    const playerSwitchIn = createCandidate(
      "linewise",
      "ゆけっ! ドドゲザン!\nマフォクシー!",
      0.9,
    );
    const selection = selectOcrCandidate([opponentSwitchIn, playerSwitchIn]);

    expect(selection.conflict).toBe(true);
    expect(selection.parseResult.status).toBe("unknown");
    expect(selection.parseResult.candidateMatches.join("\n")).toContain("ocr-conflict:");
  });

  it("holds conflicting strong event signatures as unknown", () => {
    const move = createCandidate("primary", "相手の リザードンの ねっぷう!", 0.82);
    const switchIn = createCandidate("linewise", "ゆけっ! ガブリアス!", 0.8);
    const selection = selectOcrCandidate([move, switchIn]);

    expect(selection.conflict).toBe(true);
    expect(selection.parseResult.status).toBe("unknown");
    expect(selection.parseResult.candidateMatches.join("\n")).toContain("ocr-conflict:");
  });

  it("accepts repeated candidates that agree on the same event", () => {
    const primary = createCandidate("primary", "相手の リザードンの ねっぷう!", 0.78);
    const retry = createCandidate("linewise", "相手の リザードンの ねっぷう!", 0.84);
    const selection = selectOcrCandidate([primary, retry]);

    expect(selection.conflict).toBe(false);
    expect(selection.parseResult.status).toBe("event");
  });
});
