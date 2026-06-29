import { describe, expect, it } from "vitest";
import { BATTLE_LOG_SCHEMA_VERSION, createEmptyBattleLog } from "./schema";

describe("battle log schema", () => {
  it("creates an empty exportable battle log document", () => {
    const document = createEmptyBattleLog("battle_test");

    expect(document.schemaVersion).toBe(BATTLE_LOG_SCHEMA_VERSION);
    expect(document.battle.id).toBe("battle_test");
    expect(document.ocrMessages).toEqual([]);
    expect(document.events).toEqual([]);
    expect(document.unknowns).toEqual([]);
  });
});

