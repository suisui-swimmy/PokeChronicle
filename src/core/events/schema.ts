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

export type FrameSampleDiagnosticStage =
  | "sampled"
  | "hpHudSampled"
  | "hpHudRose"
  | "hpHudFell"
  | "vsSampled"
  | "vsFell"
  | "messagePhaseOpened"
  | "messagePhaseClosed"
  | "skippedPhase"
  | "waitSampled"
  | "waitRose"
  | "waitFell"
  | "messageWatchArmed"
  | "messageWatchExpired"
  | "messageWatchEnded"
  | "ocrQueued"
  | "skippedBusy"
  | "skippedPreprocess"
  | "skippedDensity"
  | "recognized"
  | "empty"
  | "error";

export interface LegacyWaitIndicatorImageSignalDiagnostic {
  kind: "wait_indicator";
  roi: NormalizedRoi;
  score: number;
  isVisible: boolean;
  yellowIconScore: number;
  whiteTextScore: number;
  contrastScore: number;
  yellowPixelRatio: number;
  whitePixelRatio: number;
  whiteRowBandScore: number;
}

export interface HpHudImageSignalDiagnostic {
  kind: "hp_hud";
  roi: NormalizedRoi;
  roiLabel: "opponent" | "player";
  score: number;
  isVisible: boolean;
  greenBarScore: number;
  frameScore: number;
  nameplateScore: number;
  darkBandScore: number;
  greenPixelRatio: number;
  whitePixelRatio: number;
  nameplatePixelRatio: number;
  darkPixelRatio: number;
}

export interface VsSplashImageSignalDiagnostic {
  kind: "vs_splash";
  roi: NormalizedRoi;
  score: number;
  isVisible: boolean;
  purpleScore: number;
  edgeScore: number;
  largeComponentScore: number;
  purplePixelRatio: number;
  brightPixelRatio: number;
}

export type FrameImageSignalDiagnostic =
  | HpHudImageSignalDiagnostic
  | VsSplashImageSignalDiagnostic
  | LegacyWaitIndicatorImageSignalDiagnostic;

export interface FrameSampleDiagnostic {
  id: string;
  battleId: string;
  frameIndex: number;
  timestampMs: number;
  stage: FrameSampleDiagnosticStage;
  detail: string | null;
  preprocessVariantId: string | null;
  preprocessRejectReason: string | null;
  ocrVariantId: string | null;
  ocrForegroundPixelRatio: number | null;
  pendingOcrJobs: number | null;
  ocrJobId: string | null;
  ocrConfidence: number | null;
  lineCount: number | null;
  imageSignal?: FrameImageSignalDiagnostic | null;
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
  phaseHudRoiProfile: BattleLogRoiProfile;
  playerHudRoiProfile: BattleLogRoiProfile;
  vsSplashRoiProfile: BattleLogRoiProfile;
  waitIndicatorRoiProfile?: BattleLogRoiProfile;
  ocrMessages: OCRMessage[];
  events: BattleEvent[];
  unknowns: UnknownEvent[];
  frameEvidence: BattleLogFrameEvidence[];
  sampleDiagnostics: FrameSampleDiagnostic[];
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
    phaseHudRoiProfile: {
      id: "roi_phase_hud_default",
      name: "Default opponent HP bar HUD ROI",
      roi: { x: 0.55, y: 0.03, w: 0.43, h: 0.14 },
      updatedAt: new Date(0).toISOString(),
    },
    playerHudRoiProfile: {
      id: "roi_player_hud_default",
      name: "Default player HP bar HUD ROI",
      roi: { x: 0.02, y: 0.84, w: 0.46, h: 0.14 },
      updatedAt: new Date(0).toISOString(),
    },
    vsSplashRoiProfile: {
      id: "roi_vs_splash_default",
      name: "Default VS splash ROI",
      roi: { x: 0.34, y: 0.32, w: 0.32, h: 0.32 },
      updatedAt: new Date(0).toISOString(),
    },
    ocrMessages: [],
    events: [],
    unknowns: [],
    frameEvidence: [],
    sampleDiagnostics: [],
    manualCorrections: [],
  };
}
