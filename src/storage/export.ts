import {
  BATTLE_LOG_SCHEMA_VERSION,
  type BattleEvent,
  type BattleLogDocument,
  type BattleLogFrameEvidence,
  type BattleLogMediaMetadata,
  type BattleLogRoiProfile,
  type FrameSampleDiagnostic,
  type ManualCorrection,
  type NormalizedRoi,
  type OCRMessage,
  type UnknownEvent,
} from "../core/events/schema";

export const BATTLE_LOG_APP_VERSION = "0.1.0";

export interface BattleLogBuildInput {
  battleId: string;
  title: string;
  startedAt: string | null;
  media: BattleLogMediaMetadata;
  roi: NormalizedRoi;
  roiName: string;
  opponentHudRoi: NormalizedRoi;
  opponentHudRoiName: string;
  playerHudRoi: NormalizedRoi;
  playerHudRoiName: string;
  vsRoi: NormalizedRoi;
  vsRoiName: string;
  ocrMessages: readonly OCRMessage[];
  events: readonly BattleEvent[];
  unknowns: readonly UnknownEvent[];
  frameEvidence: readonly BattleLogFrameEvidence[];
  sampleDiagnostics?: readonly FrameSampleDiagnostic[];
  reviewNotes: Readonly<Record<string, string>>;
}

export type BattleLogParseResult =
  | { ok: true; document: BattleLogDocument; warnings: string[] }
  | { ok: false; error: string };

function byTimestampThenId<T extends { timestampMs: number; id: string }>(left: T, right: T) {
  return left.timestampMs - right.timestampMs || left.id.localeCompare(right.id);
}

function createManualCorrections(
  battleId: string,
  unknowns: readonly UnknownEvent[],
  reviewNotes: Readonly<Record<string, string>>,
  updatedAt: string,
): ManualCorrection[] {
  return unknowns
    .map((unknown) => {
      const note = (reviewNotes[unknown.id] ?? "").trim();

      if (note.length === 0 && unknown.reviewStatus === "unreviewed") {
        return null;
      }

      return {
        id: `cor_${unknown.id}`,
        battleId,
        targetType: "unknown" as const,
        targetId: unknown.id,
        note,
        reviewStatus: unknown.reviewStatus,
        updatedAt,
      };
    })
    .filter((correction): correction is ManualCorrection => correction !== null);
}

export function createBattleLogDocument(
  input: BattleLogBuildInput,
  exportedAt = new Date(),
): BattleLogDocument {
  const exportedAtIso = exportedAt.toISOString();
  const roiProfile: BattleLogRoiProfile = {
    id: "roi_live_message",
    name: input.roiName,
    roi: input.roi,
    updatedAt: exportedAtIso,
  };
  const phaseHudRoiProfile: BattleLogRoiProfile = {
    id: "roi_phase_hud_opponent",
    name: input.opponentHudRoiName,
    roi: input.opponentHudRoi,
    updatedAt: exportedAtIso,
  };
  const playerHudRoiProfile: BattleLogRoiProfile = {
    id: "roi_phase_hud_player",
    name: input.playerHudRoiName,
    roi: input.playerHudRoi,
    updatedAt: exportedAtIso,
  };
  const vsSplashRoiProfile: BattleLogRoiProfile = {
    id: "roi_vs_splash",
    name: input.vsRoiName,
    roi: input.vsRoi,
    updatedAt: exportedAtIso,
  };

  return {
    schemaVersion: BATTLE_LOG_SCHEMA_VERSION,
    appVersion: BATTLE_LOG_APP_VERSION,
    exportedAt: exportedAtIso,
    battle: {
      id: input.battleId,
      title: input.title,
      startedAt: input.startedAt,
    },
    media: input.media,
    roiProfile,
    phaseHudRoiProfile,
    playerHudRoiProfile,
    vsSplashRoiProfile,
    ocrMessages: [...input.ocrMessages].sort(byTimestampThenId),
    events: [...input.events].sort(byTimestampThenId),
    unknowns: [...input.unknowns].sort(byTimestampThenId),
    frameEvidence: [...input.frameEvidence],
    sampleDiagnostics: [...(input.sampleDiagnostics ?? [])].sort(byTimestampThenId),
    manualCorrections: createManualCorrections(
      input.battleId,
      input.unknowns,
      input.reviewNotes,
      exportedAtIso,
    ),
  };
}

export function serializeBattleLogDocument(document: BattleLogDocument) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBattleLogDocument(value: unknown): value is BattleLogDocument {
  if (!isRecord(value)) {
    return false;
  }

  if (value.schemaVersion !== BATTLE_LOG_SCHEMA_VERSION) {
    return false;
  }

  if (!isRecord(value.battle) || typeof value.battle.id !== "string") {
    return false;
  }

  return (
    Array.isArray(value.ocrMessages) &&
    Array.isArray(value.events) &&
    Array.isArray(value.unknowns) &&
    Array.isArray(value.manualCorrections)
  );
}

export function parseBattleLogJson(text: string): BattleLogParseResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "JSONとして読めません。" };
  }

  if (!isBattleLogDocument(parsed)) {
    return { ok: false, error: "対応していないBattle Log形式です。" };
  }

  const warnings: string[] = [];

  if (!isRecord(parsed.media)) {
    warnings.push("media metadataがないため空情報として扱います。");
    parsed.media = {
      sourceKind: "none",
      videoLabel: null,
      audioLabel: null,
      width: null,
      height: null,
      frameRate: null,
    };
  }

  if (!isRecord(parsed.roiProfile)) {
    warnings.push("ROI profileがないため全画面ROIとして扱います。");
    parsed.roiProfile = {
      id: "roi_imported_default",
      name: "Imported default ROI",
      roi: { x: 0, y: 0, w: 1, h: 1 },
      updatedAt: parsed.exportedAt,
    };
  }

  if (!isRecord(parsed.phaseHudRoiProfile)) {
    warnings.push("HPバーHUD ROI profileがないため既定の相手側HUD ROIとして扱います。");
    parsed.phaseHudRoiProfile = {
      id: "roi_phase_hud_imported_default",
      name: "Imported opponent HP bar HUD ROI",
      roi: { x: 0.55, y: 0.03, w: 0.43, h: 0.14 },
      updatedAt: parsed.exportedAt,
    };
  }

  if (!isRecord(parsed.playerHudRoiProfile)) {
    warnings.push("味方HPバーHUD ROI profileがないため既定の味方側HUD ROIとして扱います。");
    parsed.playerHudRoiProfile = {
      id: "roi_player_hud_imported_default",
      name: "Imported player HP bar HUD ROI",
      roi: { x: 0.02, y: 0.84, w: 0.46, h: 0.14 },
      updatedAt: parsed.exportedAt,
    };
  }

  if (!isRecord(parsed.vsSplashRoiProfile)) {
    warnings.push("VS ROI profileがないため既定のVS ROIとして扱います。");
    parsed.vsSplashRoiProfile = {
      id: "roi_vs_splash_imported_default",
      name: "Imported VS splash ROI",
      roi: { x: 0.34, y: 0.32, w: 0.32, h: 0.32 },
      updatedAt: parsed.exportedAt,
    };
  }

  if (!Array.isArray(parsed.frameEvidence)) {
    warnings.push("frame evidenceがないためcrop previewなしで読み込みます。");
    parsed.frameEvidence = [];
  }

  if (!Array.isArray(parsed.sampleDiagnostics)) {
    warnings.push("sample diagnosticsがないためサンプラー診断なしで読み込みます。");
    parsed.sampleDiagnostics = [];
  }

  return { ok: true, document: parsed, warnings };
}

function escapeCsvValue(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);

  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

function createCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]) {
  return [
    headers.map(escapeCsvValue).join(","),
    ...rows.map((row) => row.map(escapeCsvValue).join(",")),
  ].join("\n");
}

export function createEventsCsv(events: readonly BattleEvent[]) {
  return createCsv(
    [
      "id",
      "battleId",
      "timestampMs",
      "type",
      "actorSide",
      "actorName",
      "move",
      "targetSide",
      "targetName",
      "confidence",
      "classificationMethod",
      "templateId",
      "frameIndex",
      "rawText",
      "normalizedText",
    ],
    [...events].sort(byTimestampThenId).map((event) => [
      event.id,
      event.battleId,
      event.timestampMs,
      event.type,
      event.actor.side,
      event.actor.name,
      event.move,
      event.target?.side ?? "",
      event.target?.name ?? "",
      event.confidence,
      event.classification.method,
      event.classification.templateId,
      event.source.frameIndex,
      event.rawText,
      event.normalizedText,
    ]),
  );
}

export function createUnknownsCsv(
  unknowns: readonly UnknownEvent[],
  manualCorrections: readonly ManualCorrection[] = [],
) {
  const noteByUnknownId = new Map(
    manualCorrections.map((correction) => [correction.targetId, correction.note]),
  );

  return createCsv(
    [
      "id",
      "battleId",
      "timestampMs",
      "reviewStatus",
      "ocrConfidence",
      "afterEventId",
      "sourceFrameRef",
      "candidateMatches",
      "manualNote",
      "rawText",
      "normalizedText",
    ],
    [...unknowns].sort(byTimestampThenId).map((unknown) => [
      unknown.id,
      unknown.battleId,
      unknown.timestampMs,
      unknown.reviewStatus,
      unknown.ocrConfidence,
      unknown.afterEventId,
      unknown.sourceFrameRef,
      unknown.candidateMatches.join(" | "),
      noteByUnknownId.get(unknown.id) ?? "",
      unknown.rawText,
      unknown.normalizedText,
    ]),
  );
}
