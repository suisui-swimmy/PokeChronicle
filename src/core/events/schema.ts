import type { MessageMaskFingerprint } from "../preprocess/messagePreprocess";

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

export interface OCRRecognitionCandidateTrace {
  id: string;
  variantId: string;
  strategy: "block" | "linewise" | "sparse";
  pageSegModes: Array<"single_block" | "single_line" | "sparse_text">;
  rawText: string;
  confidence: number | null;
  lineCount: number;
  parseStatus: "event" | "unknown";
  eventSignatures: string[];
  score: number;
  selected: boolean;
  selectionReason: string | null;
  durationMs: number;
}

export interface OCRMessage {
  id: string;
  battleId: string;
  observationId?: string | null;
  rawText: string;
  normalizedText: string;
  matchText: string;
  ocrConfidence: number | null;
  timestampMs: number;
  frameIndex: number | null;
  roi: NormalizedRoi;
  lines: OCRLine[];
  recognitionCandidates?: OCRRecognitionCandidateTrace[];
}

export interface BattleEvent {
  id: string;
  battleId: string;
  observationId?: string | null;
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
  observationId?: string | null;
  timestampMs: number;
  afterEventId: string | null;
  rawText: string;
  normalizedText: string;
  ocrConfidence: number | null;
  candidateMatches: string[];
  sourceFrameRef: string | null;
  reviewStatus: "unreviewed" | "reviewed";
}

export type MessageObservationLifecycle = "active" | "closed";

export type MessageObservationResolution =
  | "pending"
  | "resolved"
  | "ocr_unknown"
  | "unread";

export type MessageObservationDisposition =
  | "primary"
  | "review"
  | "suppressed";

export type MessageObservationSuppressionReason =
  | "persistent_ui"
  | "ocr_noise_gate"
  | "visual_low_quality"
  | "phase_gate"
  | "merged_duplicate"
  | null;

export type MessagePhase =
  | "unknown"
  | "message_candidate"
  | "hud"
  | "ended";

export type MessageOcrAdmissionReason =
  | "phase_confirmed"
  | "phase_transition_grace"
  | "strong_visual_fallback"
  | "phase_rejected"
  | "battle_ended";

export type UnknownEventGateReason =
  | "accepted"
  | "too_short"
  | "timer"
  | "ui_fragment"
  | "symbol_noise"
  | "prefix_only"
  | "low_confidence_no_action_signal"
  | "duplicate"
  | "other_noise";

export type MessageObservationFailureReason =
  | "ocr_empty"
  | "ocr_timeout"
  | "ocr_error"
  | "ocr_busy"
  | "ocr_deferred_dropped"
  | "preprocess_rejected"
  | "density_rejected"
  | "no_ocr_attempt"
  | "parser_unknown"
  | null;

export interface MessageObservation {
  id: string;
  battleId: string;
  openedAtMs: number;
  closedAtMs: number | null;
  frameStart: number;
  frameEnd: number | null;
  lifecycle: MessageObservationLifecycle;
  resolution: MessageObservationResolution;
  visualFingerprint: MessageMaskFingerprint;
  maxPresenceScore: number;
  bestFrameIndex: number | null;
  bestEvidenceRef: string | null;
  ocrAttemptCount: number;
  ocrMessageIds: string[];
  eventIds: string[];
  unknownEventIds: string[];
  failureReason: MessageObservationFailureReason;
  openedWhileOcrBusy: boolean;
  disposition?: MessageObservationDisposition;
  suppressionReason?: MessageObservationSuppressionReason;
  commitScore?: number;
  persistentUiOverlapRatio?: number;
  dynamicForegroundRatio?: number;
  unknownGateReason?: UnknownEventGateReason | null;
  mergedIntoObservationId?: string | null;
  phaseAtCommit?: MessagePhase | null;
  ocrAdmissionReason?: MessageOcrAdmissionReason | null;
}

export interface MessageObservationSummary {
  detectedCount: number;
  committedCount: number;
  resolvedCount: number;
  ocrUnknownCount: number;
  unreadCount: number;
  openedWhileOcrBusyCount: number;
  suppressedCount: number;
  persistentUiSuppressedCount: number;
  noiseSuppressedCount: number;
  mergedCount: number;
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
  | "battleHudSampled"
  | "battleHudRose"
  | "battleHudFell"
  | "hpHudSampled"
  | "hpHudRose"
  | "hpHudFell"
  | "vsSampled"
  | "vsFell"
  | "messagePhaseOpened"
  | "messagePhaseClosed"
  | "messagePhaseExpired"
  | "skippedPhase"
  | "waitSampled"
  | "waitRose"
  | "waitFell"
  | "messageWatchArmed"
  | "messageWatchExpired"
  | "messageWatchEnded"
  | "messageWatchCandidateStarted"
  | "messageWatchCandidateCommitted"
  | "messageWatchCandidateSuppressed"
  | "messageWatchPersistentUiSuppressed"
  | "messageWatchNoiseSuppressed"
  | "messageWatchMerged"
  | "messageWatchProgressiveRenderContinued"
  | "messageWatchSwitchConfirmed"
  | "messageWatchOpened"
  | "messageWatchChanged"
  | "messageWatchClosed"
  | "messageWatchResolved"
  | "messageWatchOcrUnknown"
  | "messageWatchUnread"
  | "messageWatchStaleClosed"
  | "ocrQueued"
  | "ocrRetryQueued"
  | "ocrRetryPreempted"
  | "ocrDeferred"
  | "ocrDeferredDropped"
  | "ocrCandidateSelected"
  | "ocrCandidateConflict"
  | "ocrPhaseDeferred"
  | "ocrPhaseAdmitted"
  | "ocrPhaseRejected"
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

export interface BattleHudImageSignalDiagnostic {
  kind: "battle_hud";
  roi: NormalizedRoi;
  roiLabel: "opponent" | "player";
  score: number;
  isVisible: boolean;
  plateScore: number;
  frameScore: number;
  darkBandScore: number;
  hpBandScore: number;
  platePixelRatio: number;
  whitePixelRatio: number;
  darkPixelRatio: number;
  hpBandPixelRatio: number;
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

export interface MessagePresenceImageSignalDiagnostic {
  kind: "message_presence";
  roi: NormalizedRoi;
  score: number;
  isVisible: boolean;
  fingerprint: string | null;
  foregroundRatio: number;
  whiteForegroundRatio: number;
  yellowForegroundRatio: number;
  lineBandCount: number;
  componentCount: number;
  largestComponentRatio: number;
  rejectReason: string | null;
}

export type FrameImageSignalDiagnostic =
  | BattleHudImageSignalDiagnostic
  | HpHudImageSignalDiagnostic
  | MessagePresenceImageSignalDiagnostic
  | VsSplashImageSignalDiagnostic
  | LegacyWaitIndicatorImageSignalDiagnostic;

export interface FrameSampleDiagnostic {
  id: string;
  battleId: string;
  observationId?: string | null;
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
  ocrCandidateId?: string | null;
  ocrCandidateCount?: number | null;
  ocrDurationMs?: number | null;
  selectionReason?: string | null;
  imageSignal?: FrameImageSignalDiagnostic | null;
}

export interface PhaseImageSignalSummary {
  sampleCount: number;
  visibleCount: number;
  scoreTotal: number;
  maxScore: number;
}

export interface PhaseDetectionSummary {
  opponentHud: PhaseImageSignalSummary;
  playerHud: PhaseImageSignalSummary;
  vsSplash: PhaseImageSignalSummary;
  transitionCounts: {
    battleHudRose: number;
    battleHudFell: number;
    vsFell: number;
    messagePhaseOpened: number;
    messagePhaseClosed: number;
    messagePhaseExpired: number;
  };
  ocrAdmissionCounts: {
    confirmed: number;
    grace: number;
    fallback: number;
    deferred: number;
    rejected: number;
  };
}

export type PhaseTransitionStage =
  | "battleHudRose"
  | "battleHudFell"
  | "vsFell"
  | "messagePhaseOpened"
  | "messagePhaseClosed"
  | "messagePhaseExpired";

export interface PhaseTransitionDiagnostic {
  id: string;
  frameIndex: number;
  timestampMs: number;
  stage: PhaseTransitionStage;
  detail: string;
}

export function createEmptyPhaseDetectionSummary(): PhaseDetectionSummary {
  const createSignalSummary = (): PhaseImageSignalSummary => ({
    sampleCount: 0,
    visibleCount: 0,
    scoreTotal: 0,
    maxScore: 0,
  });

  return {
    opponentHud: createSignalSummary(),
    playerHud: createSignalSummary(),
    vsSplash: createSignalSummary(),
    transitionCounts: {
      battleHudRose: 0,
      battleHudFell: 0,
      vsFell: 0,
      messagePhaseOpened: 0,
      messagePhaseClosed: 0,
      messagePhaseExpired: 0,
    },
    ocrAdmissionCounts: {
      confirmed: 0,
      grace: 0,
      fallback: 0,
      deferred: 0,
      rejected: 0,
    },
  };
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
  messageObservations: MessageObservation[];
  messageObservationSummary: MessageObservationSummary;
  frameEvidence: BattleLogFrameEvidence[];
  sampleDiagnostics: FrameSampleDiagnostic[];
  phaseDetectionSummary: PhaseDetectionSummary;
  phaseTransitions: PhaseTransitionDiagnostic[];
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
      name: "Default opponent battle HUD ROI",
      roi: { x: 0.55, y: 0.03, w: 0.43, h: 0.14 },
      updatedAt: new Date(0).toISOString(),
    },
    playerHudRoiProfile: {
      id: "roi_player_hud_default",
      name: "Default player battle HUD ROI",
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
    messageObservations: [],
    messageObservationSummary: {
      detectedCount: 0,
      committedCount: 0,
      resolvedCount: 0,
      ocrUnknownCount: 0,
      unreadCount: 0,
      openedWhileOcrBusyCount: 0,
      suppressedCount: 0,
      persistentUiSuppressedCount: 0,
      noiseSuppressedCount: 0,
      mergedCount: 0,
    },
    frameEvidence: [],
    sampleDiagnostics: [],
    phaseDetectionSummary: createEmptyPhaseDetectionSummary(),
    phaseTransitions: [],
    manualCorrections: [],
  };
}
