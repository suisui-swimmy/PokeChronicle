import { describe, expect, it } from "vitest";
import { parseBattleMessage } from "../parser/seedParser";
import {
  createImportedTemplateCollectionFromJsonFiles,
  parseImportedTemplateCollectionJson,
  serializeImportedTemplateCollection,
} from "./importedTemplates";

describe("champout template import", () => {
  it("extracts battle templates from selected champout-style JSON files", () => {
    const result = createImportedTemplateCollectionFromJsonFiles(
      [
        {
          name: "btl_attack_syn.json",
          text: JSON.stringify({
            mSDataSet: [
              {
                LabelName: "ATKMSG_E_0001_syn",
                OriginalText: "相手の　{0}の\n{1}！",
              },
            ],
          }),
        },
        {
          name: "btl_std.json",
          text: JSON.stringify({
            mSDataSet: [
              {
                LabelName: "BTL_STRID_STD_CustomWeather",
                OriginalText: "おおあめが　降りはじめた！",
              },
            ],
          }),
        },
      ],
      new Date("2026-06-30T00:00:00.000Z"),
    );

    expect(result.ok).toBe(true);
    expect(result.ok ? result.collection.stats : null).toMatchObject({
      sourceFileCount: 2,
      extractedTextCount: 2,
      generatedRuleCount: 2,
    });
    expect(result.ok ? result.collection.rules : []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "move",
          patterns: ["相手の {pokemon}の{move}!"],
          constants: { "actor.side": "opponent" },
        }),
        expect.objectContaining({
          eventType: "weather_start",
          patterns: ["おおあめが 降りはじめた!"],
        }),
      ]),
    );
  });

  it("feeds imported rules through the parser without bundling the source text", () => {
    const result = createImportedTemplateCollectionFromJsonFiles([
      {
        name: "btl_std.json",
        text: JSON.stringify({
          mSDataSet: [
            {
              LabelName: "BTL_STRID_STD_CustomWeather",
              OriginalText: "おおあめが　降りはじめた！",
            },
          ],
        }),
      },
    ]);

    expect(result.ok).toBe(true);

    const parsed = parseBattleMessage("おおあめが 降りはじめた！", undefined, {
      templateRules: result.ok ? result.collection.rules : [],
    });

    expect(parsed).toMatchObject({
      status: "event",
      event: {
        type: "weather_start",
        classification: { method: "template_dictionary" },
      },
    });
  });

  it("round-trips the imported template collection JSON", () => {
    const result = createImportedTemplateCollectionFromJsonFiles(
      [
        {
          name: "btl_std.json",
          text: JSON.stringify({
            mSDataSet: [
              {
                LabelName: "BTL_STRID_STD_CustomWeather",
                OriginalText: "おおあめが　降りはじめた！",
              },
            ],
          }),
        },
      ],
      new Date("2026-06-30T00:00:00.000Z"),
    );

    expect(result.ok).toBe(true);
    const parsed = parseImportedTemplateCollectionJson(
      result.ok ? serializeImportedTemplateCollection(result.collection) : "{}",
    );

    expect(parsed).toMatchObject({
      ok: true,
      collection: {
        importedAt: "2026-06-30T00:00:00.000Z",
        stats: { generatedRuleCount: 1 },
      },
    });
  });
});
