import { describe, expect, it } from "vitest";
import {
  BATTLE_DICTIONARY,
  MOVE_NAME_DICTIONARY,
  POKEMON_NAME_DICTIONARY,
} from "./generatedBattleDictionary";

describe("generated battle dictionaries", () => {
  it("contains the full generated name lists from local reference files", () => {
    expect(POKEMON_NAME_DICTIONARY).toHaveLength(1133);
    expect(MOVE_NAME_DICTIONARY).toHaveLength(497);
    expect(BATTLE_DICTIONARY.pokemon).toBe(POKEMON_NAME_DICTIONARY);
    expect(BATTLE_DICTIONARY.moves).toBe(MOVE_NAME_DICTIONARY);
  });

  it("contains representative names outside the old seed list", () => {
    expect(POKEMON_NAME_DICTIONARY.map((entry) => entry.label)).toEqual(
      expect.arrayContaining(["ガブリアス", "ルカリオ", "サーフゴー", "ハバタクカミ"]),
    );
    expect(MOVE_NAME_DICTIONARY.map((entry) => entry.label)).toEqual(
      expect.arrayContaining(["じしん", "いのちがけ", "ゴールドラッシュ", "ムーンフォース"]),
    );
  });
});
