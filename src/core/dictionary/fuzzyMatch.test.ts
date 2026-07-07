import { describe, expect, it } from "vitest";
import {
  matchDictionaryEntry,
  normalizedOcrWeightedSimilarity,
  normalizedSimilarity,
} from "./fuzzyMatch";
import { SEED_MOVE_DICTIONARY, SEED_POKEMON_DICTIONARY } from "./seedBattleDictionary";

describe("matchDictionaryEntry", () => {
  it("accepts exact dictionary matches", () => {
    expect(matchDictionaryEntry("エルフーン", SEED_POKEMON_DICTIONARY)).toMatchObject({
      best: "エルフーン",
      method: "exact",
      status: "accepted",
    });
  });

  it("accepts high-confidence fuzzy matches with enough margin", () => {
    expect(
      matchDictionaryEntry("マフォオクシー", SEED_POKEMON_DICTIONARY, {
        ocrConfidence: 0.9,
      }),
    ).toMatchObject({
      best: "マフォクシー",
      method: "fuzzy",
      status: "accepted",
    });
  });

  it("keeps fuzzy matches as review candidates when OCR confidence is low", () => {
    expect(
      matchDictionaryEntry("マフォオクシー", SEED_POKEMON_DICTIONARY, {
        ocrConfidence: 0.52,
      }),
    ).toMatchObject({
      best: "マフォクシー",
      method: "fuzzy",
      status: "needs_review",
      reason: "low-ocr-confidence",
    });
  });

  it("accepts kana-script OCR noise for moves only when score and confidence are high", () => {
    const match = matchDictionaryEntry("ま モもモる", SEED_MOVE_DICTIONARY, {
      acceptScore: 0.72,
      reviewScore: 0.68,
      acceptMargin: 0.12,
      minOcrConfidenceForFuzzy: 0.68,
      ocrConfidence: 0.86,
      similarity: "ocr_weighted",
    });

    expect(match).toMatchObject({
      best: "まもる",
      method: "fuzzy",
      status: "accepted",
    });
    expect(match.score).toBeGreaterThan(normalizedSimilarity("まモもモる", "まもる"));
  });
});

describe("normalizedSimilarity", () => {
  it("scores single-character OCR insertions near the intended label", () => {
    expect(normalizedSimilarity("マフォオクシー", "マフォクシー")).toBeGreaterThan(0.84);
  });
});

describe("normalizedOcrWeightedSimilarity", () => {
  it("discounts common OCR kana confusions for limited dictionary correction", () => {
    expect(normalizedOcrWeightedSimilarity("カプリアス", "ガブリアス")).toBeGreaterThan(
      normalizedSimilarity("カプリアス", "ガブリアス"),
    );
    expect(normalizedOcrWeightedSimilarity("アクアジエッツト", "アクアジェット")).toBeGreaterThan(
      0.82,
    );
  });
});
