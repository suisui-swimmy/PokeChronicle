export const BATTLE_LOG_SCHEMA_VERSION = "0.1.0" as const;

export type BattleEventType =
  | "move"
  | "switch_out"
  | "switch_in"
  | "faint"
  | "battle_start"
  | "battle_end"
  | "turn_marker"
  | "damage"
  | "heal"
  | "status"
  | "status_cure"
  | "supereffective"
  | "resisted"
  | "immune"
  | "critical"
  | "flinch"
  | "boost"
  | "unboost"
  | "protect"
  | "miss"
  | "fail"
  | "weather_start"
  | "weather_end"
  | "terrain_start"
  | "terrain_end"
  | "field_start"
  | "field_end"
  | "side_start"
  | "side_end"
  | "item"
  | "ability"
  | "activate"
  | "redirection"
  | "unknown";

export type ClassificationMethod =
  | "seed_rule"
  | "template_dictionary"
  | "fuzzy_dictionary"
  | "manual"
  | "unknown";

export interface NormalizedRoi {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SourceFrameRef {
  frameIndex: number | null;
  timestampMs: number;
  cropObjectUrl: string | null;
}

export interface OCRLine {
  text: string;
  confidence: number | null;
  bbox: { x: number; y: number; width: number; height: number } | null;
}

export interface OCRMessage {
  id: string;
  battleId: string;
  rawText: string;
  normalizedText: string;
  matchText: string;
  ocrConfidence: number | null;
  timestampMs: number;
  frameIndex: number | null;
  roi: NormalizedRoi;
  lines: OCRLine[];
}

export interface BattleEvent {
  id: string;
  battleId: string;
  turn: number | null;
  timestampMs: number;
  type: BattleEventType;
  actor: { name: string | null; side: "player" | "opponent" | null };
  move: string | null;
  target: { name: string | null; side: "player" | "opponent" | null } | null;
  rawText: string;
  normalizedText: string;
  confidence: number | null;
  classification: {
    method: ClassificationMethod;
    templateId: string | null;
    alternatives: string[];
  };
  source: SourceFrameRef;
}

export interface UnknownEvent {
  id: string;
  battleId: string;
  timestampMs: number;
  afterEventId: string | null;
  rawText: string;
  normalizedText: string;
  ocrConfidence: number | null;
  candidateMatches: string[];
  sourceFrameRef: string | null;
  reviewStatus: "unreviewed" | "reviewed";
}

export type BattleLogMediaSourceKind = "device" | "video-file" | "image-file" | "none";

export interface BattleLogMediaMetadata {
  sourceKind: BattleLogMediaSourceKind;
  videoLabel: string | null;
  audioLabel: string | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
}

export interface BattleLogRoiProfile {
  id: string;
  name: string;
  roi: NormalizedRoi;
  updatedAt: string;
}

export interface BattleLogFrameEvidence {
  id: string;
  battleId: string;
  sourceFrameRef: string;
  rawDataUrl: string;
  processedDataUrl: string;
  cropWidth: number;
  cropHeight: number;
  capturedAt: string | null;
}

export interface ManualCorrection {
  id: string;
  battleId: string;
  targetType: "unknown";
  targetId: string;
  note: string;
  reviewStatus: UnknownEvent["reviewStatus"];
  updatedAt: string;
}

export interface BattleLogDocument {
  schemaVersion: typeof BATTLE_LOG_SCHEMA_VERSION;
  appVersion: string;
  exportedAt: string;
  battle: {
    id: string;
    title: string;
    startedAt: string | null;
  };
  media: BattleLogMediaMetadata;
  roiProfile: BattleLogRoiProfile;
  ocrMessages: OCRMessage[];
  events: BattleEvent[];
  unknowns: UnknownEvent[];
  frameEvidence: BattleLogFrameEvidence[];
  manualCorrections: ManualCorrection[];
}

export function createEmptyBattleLog(battleId: string): BattleLogDocument {
  return {
    schemaVersion: BATTLE_LOG_SCHEMA_VERSION,
    appVersion: "0.1.0",
    exportedAt: new Date(0).toISOString(),
    battle: {
      id: battleId,
      title: "Untitled battle",
      startedAt: null,
    },
    media: {
      sourceKind: "none",
      videoLabel: null,
      audioLabel: null,
      width: null,
      height: null,
      frameRate: null,
    },
    roiProfile: {
      id: "roi_default",
      name: "Default ROI",
      roi: { x: 0, y: 0, w: 1, h: 1 },
      updatedAt: new Date(0).toISOString(),
    },
    ocrMessages: [],
    events: [],
    unknowns: [],
    frameEvidence: [],
    manualCorrections: [],
  };
}
