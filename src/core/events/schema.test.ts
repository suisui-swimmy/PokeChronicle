import { describe, expect, it } from "vitest";
import { BATTLE_LOG_SCHEMA_VERSION, createEmptyBattleLog } from "./schema";

describe("battle log schema", () => {
  it("creates an empty exportable battle log document", () => {
    const document = createEmptyBattleLog("battle_test");

    expect(document.schemaVersion).toBe(BATTLE_LOG_SCHEMA_VERSION);
    expect(document.battle.id).toBe("battle_test");
    expect(document.media.sourceKind).toBe("none");
    expect(document.roiProfile.roi).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(document.ocrMessages).toEqual([]);
    expect(document.events).toEqual([]);
    expect(document.unknowns).toEqual([]);
    expect(document.messageObservations).toEqual([]);
    expect(document.messageObservationSummary).toEqual({
      detectedCount: 0,
      resolvedCount: 0,
      ocrUnknownCount: 0,
      unreadCount: 0,
      openedWhileOcrBusyCount: 0,
    });
    expect(document.frameEvidence).toEqual([]);
    expect(document.manualCorrections).toEqual([]);
  });
});
