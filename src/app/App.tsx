import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Activity, BarChart3, Crop, Database, List, RotateCcw, ScanText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import fullscreenExitIconUrl from "../assets/icons/fullscreen-exit.svg";
import fullscreenIconUrl from "../assets/icons/fullscreen.svg";
import reloadIconUrl from "../assets/icons/reload.svg";
import uploadIconUrl from "../assets/icons/upload.svg";
import volumeMutedIconUrl from "../assets/icons/volume-muted.svg";
import volumeIconUrl from "../assets/icons/volume.svg";
import {
  createEmptyPhaseDetectionSummary,
  type BattleLogDocument,
  type BattleLogFrameEvidence,
  type BattleLogMediaMetadata,
  type BattleEvent,
  type FrameImageSignalDiagnostic,
  type FrameSampleDiagnostic,
  type FrameSampleDiagnosticStage,
  type MessageObservation,
  type MessageObservationFailureReason,
  type MessageOcrAdmissionReason,
  type NormalizedRoi,
  type OCRMessage,
  type OCRRecognitionCandidateTrace,
  type PhaseDetectionSummary,
  type PhaseTransitionDiagnostic,
  type PhaseTransitionStage,
  type UnknownEventGateReason,
  type UnknownEvent,
} from "../core/events/schema";
import {
  createAcceptedEventRecord,
  createConstrainedCandidateRecord,
  createSourceFrameRef,
  createTimelineObservation,
  shouldSuppressTimelineObservation,
  type TimelineAcceptedEventRecord,
  type TimelineConstrainedCandidateRecord,
  type TimelineDeduplicationRecord,
} from "../core/events/timeline";
import { renderBattleEventCanonicalText } from "../core/events/canonicalText";
import {
  admitMessageObservationOcr,
  advanceMessageWatcher,
  attachMessageObservationOcrMessage,
  closeActiveMessageWatcher,
  closeMessageObservation,
  createInitialMessageWatcherState,
  createMessageObservation,
  isStrongVisualMessageObservation,
  recordMessageObservationFailure,
  recordMessageObservationOcrAttempt,
  rejectMessageObservationOcrForPhase,
  resolveMessageObservationAsOcrUnknown,
  resolveMessageObservationWithEvents,
  settleMessageObservationUnread,
  suppressMessageObservation,
  updateMessageObservationBestEvidence,
  type MessageWatcherCloseReason,
  type MessageWatcherSample,
  type MessageWatcherState,
  type MessageWatcherTransition,
} from "../core/events/messageObservation";
import {
  decideObservationMerge,
  mergeMessageObservationPair,
  selectPrimaryLiveLogItems,
} from "../core/events/observationMerge";
import type { DictionaryEntry } from "../core/dictionary/types";
import { summarizeBattleStats } from "../core/stats/battleStats";
import {
  choosePreferredMessagePreprocessVariant,
  createMessageMaskFingerprint,
  createMessagePreprocessVariants,
  type MessageMaskFingerprint,
  type MessagePreprocessOptions,
  type MessageTextMask,
} from "../core/preprocess/messagePreprocess";
import {
  analyzeMessagePresence,
  type MessagePresenceAnalysis,
} from "../core/preprocess/messagePresenceDetection";
import {
  advancePersistentUiModel,
  createInitialPersistentUiModelState,
  type PersistentUiModelState,
} from "../core/preprocess/persistentUiModel";
import {
  analyzeBattleHudImage,
  analyzeVsSplashImage,
  type BattleHudSignal,
  type VsSplashSignal,
} from "../core/preprocess/hudPhaseDetection";
import {
  advanceMessagePhaseGate,
  createInitialMessagePhaseGateState,
  endMessagePhase,
  recordMessagePhaseActivity,
  type MessagePhaseGateState,
} from "../core/preprocess/messagePhaseGate";
import { mapDisplayRoiToSourceRect } from "../core/media/roiMapping";
import { createTesseractWorkerConfig } from "../core/ocr/tesseractConfig";
import type {
  OCRWorkerJobMeta,
  OCRWorkerRecognitionCandidate,
  OCRWorkerRequest,
  OCRWorkerResponse,
} from "../core/ocr/workerMessages";
import {
  createRecognitionCandidate,
  selectOcrCandidate,
  shouldRetryOcrCandidate,
  type EvaluatedOcrCandidate,
} from "../core/ocr/ocrCandidateSelection";
import {
  enqueueDeferredOcrSample,
  MAX_DEFERRED_OCR_SAMPLES,
  shouldPreemptOcrRetry,
  takeNextDeferredOcrSample,
} from "../core/ocr/ocrScheduler";
import {
  decideMessagePhaseOcrAdmission,
} from "../core/ocr/messagePhaseOcrAdmission";
import {
  getParsedBattleEvents,
  parseBattleMessage,
  type BattleMessageParseResult,
} from "../core/parser/seedParser";
import {
  createImportedTemplateCollectionFromJsonFiles,
  parseImportedTemplateCollectionJson,
  serializeImportedTemplateCollection,
  type ImportedTemplateCollection,
} from "../core/templates/importedTemplates";
import { STANDARD_TEMPLATE_RULES } from "../core/templates/standardTemplateRules";
import type { BattleTemplateRule } from "../core/templates/types";
import {
  createBattleLogDocument,
  createEventsCsv,
  createUnknownsCsv,
  parseBattleLogJson,
  serializeBattleLogDocument,
} from "../storage/export";
import {
  clearImportedTemplateCollections,
  isIndexedDbSupported,
  loadLatestImportedTemplateCollection,
  saveImportedTemplateCollection,
} from "../storage/indexedDb";

const LIVE_BATTLE_ID = "battle_live";
const LIVE_BATTLE_TITLE = "Live OCR battle log";
const DEFAULT_ROI: NormalizedRoi = { x: 0.15, y: 0.72, w: 0.5, h: 0.14 };
const DEFAULT_OPPONENT_HUD_ROI: NormalizedRoi = { x: 0.55, y: 0.03, w: 0.43, h: 0.14 };
const DEFAULT_PLAYER_HUD_ROI: NormalizedRoi = { x: 0.02, y: 0.84, w: 0.46, h: 0.14 };
const DEFAULT_VS_SPLASH_ROI: NormalizedRoi = { x: 0.34, y: 0.32, w: 0.32, h: 0.32 };
const DEFAULT_IS_ROI_VISIBLE = false;
const DEFAULT_IS_OPPONENT_HUD_ROI_VISIBLE = false;
const DEFAULT_IS_PLAYER_HUD_ROI_VISIBLE = false;
const DEFAULT_IS_VS_ROI_VISIBLE = false;
const MIN_ROI_SIZE = 0.08;
const NO_AUDIO_DEVICE_ID = "none";
const DEFAULT_SAMPLE_FPS = 3;
const DEFAULT_MESSAGE_WATCH_FPS = 12;
const MESSAGE_WATCH_MAX_WIDTH = 320;
const MAX_FRAME_BUFFER = 8;
const MAX_OCR_LOGS = 30;
const MAX_OCR_HISTORY = 1024;
const MAX_EVENT_HISTORY = 512;
const MAX_UNKNOWN_HISTORY = 512;
const MAX_MESSAGE_OBSERVATION_HISTORY = 512;
const MAX_TIMELINE_ITEMS = 48;
const MAX_RESOLVED_DISPLAY_ITEMS = 48;
const MAX_UNKNOWN_DISPLAY_ITEMS = 48;
const MAX_MESSAGE_OBSERVATION_DISPLAY_ITEMS = 48;
const MAX_CROP_EVIDENCE = 80;
const MAX_SAMPLE_DIAGNOSTICS = 600;
const MAX_PHASE_TRANSITIONS = 64;
const OCR_RAW_GROUP_LIMIT = 30;
const DEFAULT_RESOLVED_LOG_PANEL_WIDTH = 260;
const MIN_RESOLVED_LOG_PANEL_WIDTH = 180;
const MAX_RESOLVED_LOG_PANEL_WIDTH = 520;
const MIN_PREVIEW_PANEL_WIDTH = 360;
const WORKSPACE_RESIZER_WIDTH = 12;
const DEFAULT_MANAGEMENT_PANEL_HEIGHT = 320;
const DEFAULT_MANAGEMENT_TABBAR_HEIGHT = 58;
const MIN_MANAGEMENT_PANEL_HEIGHT = 0;
const MAX_MANAGEMENT_PANEL_HEIGHT = 2000;
const MANAGEMENT_RESIZER_HEIGHT = 12;
const DEFAULT_AUDIO_VOLUME = 1;
const HEADER_MEDIA_SETTINGS_STORAGE_KEY = "pokechronicle:header-media-settings:v1";
const ROI_SETTINGS_STORAGE_KEY = "pokechronicle:roi-settings:v1";
const RESOLVED_LOG_RESIZE_STEP = 24;
const MAX_PENDING_OCR_JOBS = 1;
const MAX_PHASE_WAITING_OCR_SAMPLES = 3;
const MAX_OCR_ATTEMPTS_PER_OBSERVATION = 2;
const OCR_JOB_TIMEOUT_MS = 60_000;
const TIMELINE_DUPLICATE_WINDOW_MS = 2500;
const MAX_TIMELINE_DEDUPE_RECORDS = 32;
const MAX_SESSION_ROSTER_DICTIONARY_ENTRIES = 18;
const MAX_OBSERVED_MOVE_DICTIONARY_ENTRIES = 96;
const MIN_TEXT_PIXEL_RATIO = 0.004;
const MAX_TEXT_PIXEL_RATIO = 0.18;
const SAMPLE_DIAGNOSTIC_STAGES: readonly FrameSampleDiagnosticStage[] = [
  "sampled",
  "battleHudSampled",
  "battleHudRose",
  "battleHudFell",
  "vsSampled",
  "vsFell",
  "messagePhaseOpened",
  "messagePhaseClosed",
  "messagePhaseExpired",
  "skippedPhase",
  "messageWatchCandidateStarted",
  "messageWatchCandidateCommitted",
  "messageWatchCandidateSuppressed",
  "messageWatchPersistentUiSuppressed",
  "messageWatchNoiseSuppressed",
  "messageWatchMerged",
  "messageWatchProgressiveRenderContinued",
  "messageWatchSwitchConfirmed",
  "messageWatchOpened",
  "messageWatchChanged",
  "messageWatchClosed",
  "messageWatchResolved",
  "messageWatchOcrUnknown",
  "messageWatchUnread",
  "messageWatchStaleClosed",
  "ocrQueued",
  "ocrRetryQueued",
  "ocrRetryPreempted",
  "ocrDeferred",
  "ocrDeferredDropped",
  "ocrCandidateSelected",
  "ocrCandidateConflict",
  "ocrPhaseDeferred",
  "ocrPhaseAdmitted",
  "ocrPhaseRejected",
  "skippedBusy",
  "skippedPreprocess",
  "skippedDensity",
  "recognized",
  "empty",
  "error",
];
const DEFAULT_PREPROCESS_OPTIONS: MessagePreprocessOptions = {
  whiteThreshold: 180,
  background: "black",
  invert: false,
};
const OCR_WORKER_CONFIG = createTesseractWorkerConfig(import.meta.env, import.meta.env.BASE_URL);
const ASPECT_16_BY_9 = 16 / 9;
const ASPECT_4_BY_3 = 4 / 3;
const ASPECT_TOLERANCE = 0.03;
const STREAM_PROFILES: MediaTrackConstraints[] = [
  { width: { exact: 1920 }, height: { exact: 1080 } },
  { width: { exact: 1280 }, height: { exact: 720 } },
  { width: { ideal: 1920 }, height: { ideal: 1080 }, aspectRatio: { ideal: ASPECT_16_BY_9 } },
  {},
];

type MediaMode = "idle" | "device" | "video-file" | "image-file";

type MediaMetadata = {
  width: number | null;
  height: number | null;
  frameRate: number | null;
};

type LogLevel = "info" | "warn" | "error";
type InputStatus =
  | "unknown"
  | "starting"
  | "active"
  | "stopped"
  | "denied"
  | "busy"
  | "start-failed"
  | "unsupported";
type InputBadgeTone = "idle" | "warn" | "active" | "danger";

type SystemLog = {
  id: string;
  level: LogLevel;
  message: string;
  timestamp: string;
};

type InputDevice = {
  deviceId: string;
  kind: "videoinput" | "audioinput";
  label: string;
  hasDeviceLabel: boolean;
};

type HeaderMediaSettings = {
  videoDeviceId: string;
  audioDeviceId: string;
  audioVolume: number;
  isAudioMuted: boolean;
};

type RoiSettings = {
  roi: NormalizedRoi;
  opponentHudRoi: NormalizedRoi;
  playerHudRoi: NormalizedRoi;
  vsRoi: NormalizedRoi;
  isRoiVisible: boolean;
  isOpponentHudRoiVisible: boolean;
  isPlayerHudRoiVisible: boolean;
  isVsRoiVisible: boolean;
};

type DragMode =
  | "move"
  | "resize-nw"
  | "resize-ne"
  | "resize-sw"
  | "resize-se";

type DragState = {
  mode: DragMode;
  startX: number;
  startY: number;
  startRoi: NormalizedRoi;
};
type RoiField = keyof NormalizedRoi;

type FrameSourceElement = HTMLVideoElement | HTMLImageElement;

type ProcessedLineCropPreview = {
  id: string;
  textMask: MessageTextMask;
  processedDataUrl: string;
  cropWidth: number;
  cropHeight: number;
  sourceY: number;
  lineCount: number;
  foregroundPixelRatio: number;
};

type CapturedFrameImages = {
  rawDataUrl: string;
  processedDataUrl: string;
  preprocessVariantId: MessageTextMask;
  preprocessVariantRejectReason: string | null;
  ocrDataUrl: string;
  ocrVariantId: string;
  ocrForegroundPixelRatio: number;
  messageFingerprint: MessageMaskFingerprint;
  lineBandCount: number;
  lineCropVariants: ProcessedLineCropPreview[];
  ocrCandidates: OCRWorkerRecognitionCandidate[];
  sourceWidth: number;
  sourceHeight: number;
  cropWidth: number;
  cropHeight: number;
  foregroundPixelCount: number;
  totalPixelCount: number;
  foregroundPixelRatio: number;
};

type FrameSample = CapturedFrameImages & {
  id: string;
  frameIndex: number;
  timestampMs: number;
  capturedAt: string;
  roi: NormalizedRoi;
  preprocess: MessagePreprocessOptions;
  upscaleFactor: number;
  observationId?: string | null;
};

type MessageWatchRuntimeAnalysis = MessagePresenceAnalysis & {
  persistentUiOverlapRatio: number;
  dynamicForegroundRatio: number;
  persistentUiModelWarmedUp: boolean;
};

type HudRoiLabel = "opponent" | "player";

type BattleHudObservation = {
  roiLabel: HudRoiLabel;
  roi: NormalizedRoi;
  signal: BattleHudSignal;
};

type HudPhaseObservation = {
  opponent: BattleHudObservation | null;
  player: BattleHudObservation | null;
  selected: BattleHudObservation | null;
  isVisible: boolean;
};

type VsSplashObservation = {
  roi: NormalizedRoi;
  signal: VsSplashSignal;
};

type PhaseAdmissionVisualEvidence = {
  persistentUiModelWarmedUp: boolean;
  commitScore: number;
  presenceScore: number;
  persistentUiOverlapRatio: number;
  dynamicForegroundRatio: number;
  lineBandCount: number;
  componentCount: number;
  largestComponentRatio: number;
};

type PhaseWaitingOcrSample = {
  sample: FrameSample;
  evidence: PhaseAdmissionVisualEvidence;
};

type OCRLogEntry = {
  id: string;
  frameIndex: number;
  timestampMs: number;
  rawText: string;
  normalizedText: string;
  matchText: string;
  parseResult?: BattleMessageParseResult;
  confidence: number | null;
  lineCount: number;
  status: "recognized" | "empty" | "error";
  errorMessage?: string;
};

type ActiveOcrJob = {
  jobId: string;
  meta: OCRWorkerJobMeta;
  sample: FrameSample;
  candidates: OCRWorkerRecognitionCandidate[];
  candidateIndex: number;
  evaluatedCandidates: EvaluatedOcrCandidate[];
  timeoutId: number;
};

type CropEvidence = {
  sourceFrameRef: string;
  rawDataUrl: string;
  processedDataUrl: string;
  cropWidth: number;
  cropHeight: number;
  capturedAt: string | null;
};

type TimelineItem =
  | { kind: "event"; event: BattleEvent }
  | { kind: "unknown"; unknown: UnknownEvent };
type ManagementTab = "roi" | "sampler" | "ocr" | "stats" | "data" | "logs";
type ReviewTab = "timeline" | "resolved" | "unknown" | "ocr" | "system";
type OCRLogGroup = {
  key: string;
  entry: OCRLogEntry;
  count: number;
};
type ResolvedLogResizeSession = {
  startX: number;
  startWidth: number;
  containerWidth: number | null;
};
type ManagementPanelResizeSession = {
  startY: number;
  startHeight: number;
  containerHeight: number | null;
};
type InputBadgeState = {
  label: string;
  tone: InputBadgeTone;
};

function recordPhaseSignalSummary(
  summary: PhaseDetectionSummary,
  key: "opponentHud" | "playerHud" | "vsSplash",
  signal: { score: number; isVisible: boolean },
) {
  const target = summary[key];

  target.sampleCount += 1;
  target.visibleCount += signal.isVisible ? 1 : 0;
  target.scoreTotal += signal.score;
  target.maxScore = Math.max(target.maxScore, signal.score);
}

const REVIEW_TABS: Array<{ id: ReviewTab; label: string }> = [
  { id: "timeline", label: "Timeline" },
  { id: "resolved", label: "解決済み" },
  { id: "unknown", label: "Unknown" },
  { id: "ocr", label: "OCR Raw" },
  { id: "system", label: "System" },
];

const MANAGEMENT_TAB_GROUPS: Array<{
  label: string;
  tabs: Array<{
    id: ManagementTab;
    label: string;
    Icon: typeof Crop;
  }>;
}> = [
  {
    label: "調整",
    tabs: [
      { id: "roi", label: "ROI", Icon: Crop },
      { id: "sampler", label: "サンプラー", Icon: Activity },
      { id: "ocr", label: "OCR", Icon: ScanText },
    ],
  },
  {
    label: "確認・出力",
    tabs: [
      { id: "stats", label: "統計", Icon: BarChart3 },
      { id: "data", label: "データ", Icon: Database },
      { id: "logs", label: "ログ", Icon: List },
    ],
  },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeHeaderMediaSettings(value: unknown): HeaderMediaSettings | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  const rawAudioVolume = Number(value.audioVolume);
  const audioVolume = Number.isFinite(rawAudioVolume)
    ? clamp(rawAudioVolume, 0, 1)
    : DEFAULT_AUDIO_VOLUME;
  const isAudioMuted =
    typeof value.isAudioMuted === "boolean" ? value.isAudioMuted : audioVolume === 0;

  return {
    videoDeviceId: typeof value.videoDeviceId === "string" ? value.videoDeviceId : "",
    audioDeviceId:
      typeof value.audioDeviceId === "string" && value.audioDeviceId.length > 0
        ? value.audioDeviceId
        : NO_AUDIO_DEVICE_ID,
    audioVolume,
    isAudioMuted,
  };
}

function loadStoredHeaderMediaSettings(): HeaderMediaSettings | null {
  try {
    const rawSettings = window.localStorage.getItem(HEADER_MEDIA_SETTINGS_STORAGE_KEY);

    if (!rawSettings) {
      return null;
    }

    return normalizeHeaderMediaSettings(JSON.parse(rawSettings));
  } catch {
    return null;
  }
}

function saveStoredHeaderMediaSettings(settings: HeaderMediaSettings) {
  try {
    window.localStorage.setItem(HEADER_MEDIA_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage can be unavailable in private browsing or when storage is disabled.
  }
}

function roundRoiValue(value: number) {
  return Math.round(value * 10000) / 10000;
}

function normalizeRoi(value: unknown, fallback: NormalizedRoi = DEFAULT_ROI): NormalizedRoi {
  if (!isObjectRecord(value)) {
    return fallback;
  }

  const rawX = Number(value.x);
  const rawY = Number(value.y);
  const rawW = Number(value.w);
  const rawH = Number(value.h);
  const safeW = Number.isFinite(rawW) ? rawW : fallback.w;
  const safeH = Number.isFinite(rawH) ? rawH : fallback.h;
  const w = roundRoiValue(clamp(safeW, MIN_ROI_SIZE, 1));
  const h = roundRoiValue(clamp(safeH, MIN_ROI_SIZE, 1));

  return {
    x: roundRoiValue(clamp(Number.isFinite(rawX) ? rawX : fallback.x, 0, 1 - w)),
    y: roundRoiValue(clamp(Number.isFinite(rawY) ? rawY : fallback.y, 0, 1 - h)),
    w,
    h,
  };
}

function normalizeRoiSettings(value: unknown): RoiSettings | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  return {
    roi: normalizeRoi(value.roi, DEFAULT_ROI),
    opponentHudRoi: normalizeRoi(value.opponentHudRoi, DEFAULT_OPPONENT_HUD_ROI),
    playerHudRoi: normalizeRoi(value.playerHudRoi, DEFAULT_PLAYER_HUD_ROI),
    vsRoi: normalizeRoi(value.vsRoi, DEFAULT_VS_SPLASH_ROI),
    isRoiVisible:
      typeof value.isRoiVisible === "boolean" ? value.isRoiVisible : DEFAULT_IS_ROI_VISIBLE,
    isOpponentHudRoiVisible:
      typeof value.isOpponentHudRoiVisible === "boolean"
        ? value.isOpponentHudRoiVisible
        : DEFAULT_IS_OPPONENT_HUD_ROI_VISIBLE,
    isPlayerHudRoiVisible:
      typeof value.isPlayerHudRoiVisible === "boolean"
        ? value.isPlayerHudRoiVisible
        : DEFAULT_IS_PLAYER_HUD_ROI_VISIBLE,
    isVsRoiVisible:
      typeof value.isVsRoiVisible === "boolean"
        ? value.isVsRoiVisible
        : DEFAULT_IS_VS_ROI_VISIBLE,
  };
}

function loadStoredRoiSettings(): RoiSettings | null {
  try {
    const rawSettings = window.localStorage.getItem(ROI_SETTINGS_STORAGE_KEY);

    if (!rawSettings) {
      return null;
    }

    return normalizeRoiSettings(JSON.parse(rawSettings));
  } catch {
    return null;
  }
}

function saveStoredRoiSettings(settings: RoiSettings) {
  try {
    window.localStorage.setItem(ROI_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage can be unavailable in private browsing or when storage is disabled.
  }
}

function updateRoiField(currentRoi: NormalizedRoi, field: RoiField, value: number): NormalizedRoi {
  if (!Number.isFinite(value)) {
    return currentRoi;
  }

  switch (field) {
    case "x":
      return {
        ...currentRoi,
        x: roundRoiValue(clamp(value, 0, 1 - currentRoi.w)),
      };
    case "y":
      return {
        ...currentRoi,
        y: roundRoiValue(clamp(value, 0, 1 - currentRoi.h)),
      };
    case "w":
      return {
        ...currentRoi,
        w: roundRoiValue(clamp(value, MIN_ROI_SIZE, 1 - currentRoi.x)),
      };
    case "h":
      return {
        ...currentRoi,
        h: roundRoiValue(clamp(value, MIN_ROI_SIZE, 1 - currentRoi.y)),
      };
  }
}

function formatResolution(metadata: MediaMetadata) {
  if (!metadata.width || !metadata.height) {
    return "未取得";
  }

  return `${metadata.width}x${metadata.height}`;
}

function getActiveInputBadge(metadata: MediaMetadata): InputBadgeState {
  if (!metadata.width || !metadata.height) {
    return { label: "未取得", tone: "idle" };
  }

  const aspect = metadata.width / metadata.height;

  if (Math.abs(aspect - ASPECT_16_BY_9) <= ASPECT_TOLERANCE) {
    return { label: "入力(16:9)", tone: "active" };
  }

  if (Math.abs(aspect - ASPECT_4_BY_3) <= ASPECT_TOLERANCE) {
    return { label: "入力(4:3)", tone: "warn" };
  }

  return { label: "入力(非16:9)", tone: "warn" };
}

function getFailureInputBadge(inputStatus: InputStatus): InputBadgeState | null {
  switch (inputStatus) {
    case "denied":
      return { label: "拒否", tone: "danger" };
    case "busy":
      return { label: "使用中", tone: "danger" };
    case "start-failed":
      return { label: "開始失敗", tone: "danger" };
    case "unsupported":
      return { label: "非対応", tone: "danger" };
    default:
      return null;
  }
}

function getInputBadgeState({
  hasEnumeratedDevices,
  inputStatus,
  mediaMode,
  metadata,
  selectedVideoDeviceId,
  videoDevices,
}: {
  hasEnumeratedDevices: boolean;
  inputStatus: InputStatus;
  mediaMode: MediaMode;
  metadata: MediaMetadata;
  selectedVideoDeviceId: string;
  videoDevices: InputDevice[];
}): InputBadgeState {
  const failureBadge = getFailureInputBadge(inputStatus);

  if (failureBadge) {
    return failureBadge;
  }

  if (inputStatus === "starting") {
    return { label: "開始中", tone: "warn" };
  }

  if (mediaMode === "video-file" || mediaMode === "image-file") {
    return { label: "動画", tone: "warn" };
  }

  if (mediaMode === "device" || inputStatus === "active") {
    return getActiveInputBadge(metadata);
  }

  if (inputStatus === "stopped") {
    return { label: "停止", tone: "idle" };
  }

  if (hasEnumeratedDevices) {
    if (videoDevices.length === 0) {
      return { label: "未接続", tone: "danger" };
    }

    const selectedVideoDevice = videoDevices.find(
      (device) => device.deviceId === selectedVideoDeviceId,
    );

    if (selectedVideoDeviceId && !selectedVideoDevice) {
      return { label: "未接続", tone: "danger" };
    }

    if (
      selectedVideoDevice
        ? !selectedVideoDevice.hasDeviceLabel
        : videoDevices.every((device) => !device.hasDeviceLabel)
    ) {
      return { label: "権限待ち", tone: "danger" };
    }
  }

  return { label: "未取得", tone: "idle" };
}

function getStartFailureStatus(error: unknown): InputStatus {
  if (error instanceof DOMException) {
    if (["NotAllowedError", "SecurityError"].includes(error.name)) {
      return "denied";
    }

    if (["NotReadableError", "AbortError", "TrackStartError"].includes(error.name)) {
      return "busy";
    }
  }

  return "start-failed";
}

function getStartFailureMessage(inputStatus: InputStatus) {
  switch (inputStatus) {
    case "denied":
      return "カメラまたはマイクの権限が拒否されました。";
    case "busy":
      return "入力デバイスが他アプリまたは他タブで使用中の可能性があります。";
    default:
      return "入力デバイスの開始に失敗しました。";
  }
}

function formatFps(frameRate: number | null) {
  if (!frameRate) {
    return "-- fps";
  }

  return `${Number.isInteger(frameRate) ? frameRate : frameRate.toFixed(1)} fps`;
}

function formatConfidence(confidence: number | null) {
  if (confidence === null) {
    return "--%";
  }

  return `${Math.round(confidence * 100)}%`;
}

function formatTextDensity(ratio: number) {
  return `${(ratio * 100).toFixed(1)}%`;
}

function formatDiagnosticStage(stage: FrameSampleDiagnosticStage) {
  const labels: Record<FrameSampleDiagnosticStage, string> = {
    sampled: "sampled",
    battleHudSampled: "battleHudSampled",
    battleHudRose: "battleHudRose",
    battleHudFell: "battleHudFell",
    hpHudSampled: "hpHudSampled",
    hpHudRose: "hpHudRose",
    hpHudFell: "hpHudFell",
    vsSampled: "vsSampled",
    vsFell: "vsFell",
    messagePhaseOpened: "messagePhaseOpened",
    messagePhaseClosed: "messagePhaseClosed",
    messagePhaseExpired: "messagePhaseExpired",
    skippedPhase: "skippedPhase",
    waitSampled: "waitSampled",
    waitRose: "waitRose",
    waitFell: "waitFell",
    messageWatchArmed: "messageWatchArmed",
    messageWatchExpired: "messageWatchExpired",
    messageWatchEnded: "messageWatchEnded",
    messageWatchCandidateStarted: "messageWatchCandidateStarted",
    messageWatchCandidateCommitted: "messageWatchCandidateCommitted",
    messageWatchCandidateSuppressed: "messageWatchCandidateSuppressed",
    messageWatchPersistentUiSuppressed: "messageWatchPersistentUiSuppressed",
    messageWatchNoiseSuppressed: "messageWatchNoiseSuppressed",
    messageWatchMerged: "messageWatchMerged",
    messageWatchProgressiveRenderContinued: "messageWatchProgressiveRenderContinued",
    messageWatchSwitchConfirmed: "messageWatchSwitchConfirmed",
    messageWatchOpened: "messageWatchOpened",
    messageWatchChanged: "messageWatchChanged",
    messageWatchClosed: "messageWatchClosed",
    messageWatchResolved: "messageWatchResolved",
    messageWatchOcrUnknown: "messageWatchOcrUnknown",
    messageWatchUnread: "messageWatchUnread",
    messageWatchStaleClosed: "messageWatchStaleClosed",
    ocrQueued: "ocrQueued",
    ocrRetryQueued: "ocrRetryQueued",
    ocrRetryPreempted: "ocrRetryPreempted",
    ocrDeferred: "ocrDeferred",
    ocrDeferredDropped: "ocrDeferredDropped",
    ocrCandidateSelected: "ocrCandidateSelected",
    ocrCandidateConflict: "ocrCandidateConflict",
    ocrPhaseDeferred: "ocrPhaseDeferred",
    ocrPhaseAdmitted: "ocrPhaseAdmitted",
    ocrPhaseRejected: "ocrPhaseRejected",
    skippedBusy: "skippedBusy",
    skippedPreprocess: "skippedPreprocess",
    skippedDensity: "skippedDensity",
    recognized: "recognized",
    empty: "empty",
    error: "error",
  };

  return labels[stage];
}

function formatSignalScore(signal: FrameImageSignalDiagnostic | BattleHudSignal | VsSplashSignal) {
  return `${Math.round(signal.score * 100)}%`;
}

function createBattleHudImageSignalDiagnostic(
  roi: NormalizedRoi,
  roiLabel: HudRoiLabel,
  signal: BattleHudSignal,
): FrameImageSignalDiagnostic {
  return {
    kind: "battle_hud",
    roi,
    roiLabel,
    score: signal.score,
    isVisible: signal.isVisible,
    plateScore: signal.plateScore,
    frameScore: signal.frameScore,
    darkBandScore: signal.darkBandScore,
    hpBandScore: signal.hpBandScore,
    platePixelRatio: signal.platePixelRatio,
    whitePixelRatio: signal.whitePixelRatio,
    darkPixelRatio: signal.darkPixelRatio,
    hpBandPixelRatio: signal.hpBandPixelRatio,
  };
}

function createVsSplashImageSignalDiagnostic(
  roi: NormalizedRoi,
  signal: VsSplashSignal,
): FrameImageSignalDiagnostic {
  return {
    kind: "vs_splash",
    roi,
    score: signal.score,
    isVisible: signal.isVisible,
    purpleScore: signal.purpleScore,
    edgeScore: signal.edgeScore,
    largeComponentScore: signal.largeComponentScore,
    purplePixelRatio: signal.purplePixelRatio,
    brightPixelRatio: signal.brightPixelRatio,
  };
}

function formatMessageFingerprint(
  fingerprint: MessagePresenceAnalysis["fingerprint"],
) {
  return fingerprint
    ? fingerprint.cells.map((value) => value.toString(16)).join("")
    : null;
}

function createMessagePresenceImageSignalDiagnostic(
  roi: NormalizedRoi,
  analysis: MessagePresenceAnalysis,
): FrameImageSignalDiagnostic {
  return {
    kind: "message_presence",
    roi,
    score: analysis.presenceScore,
    isVisible: analysis.present,
    fingerprint: formatMessageFingerprint(analysis.fingerprint),
    foregroundRatio: analysis.foregroundRatio,
    whiteForegroundRatio: analysis.whiteForegroundRatio,
    yellowForegroundRatio: analysis.yellowForegroundRatio,
    lineBandCount: analysis.lineBandCount,
    componentCount: analysis.componentCount,
    largestComponentRatio: analysis.largestComponentRatio,
    rejectReason: analysis.rejectReason,
  };
}

function formatSampleDiagnosticDetail(diagnostic: FrameSampleDiagnostic) {
  const details: string[] = [];

  if (diagnostic.imageSignal) {
    const { imageSignal } = diagnostic;

    if (imageSignal.kind === "battle_hud") {
      details.push(
        `hud:${imageSignal.roiLabel} ${imageSignal.isVisible ? "visible" : "hidden"} ${formatSignalScore(
          imageSignal,
        )}`,
      );
      details.push(
        `plate ${formatConfidence(imageSignal.plateScore)} / frame ${formatConfidence(
          imageSignal.frameScore,
        )} / hp ${formatConfidence(imageSignal.hpBandScore)}`,
      );
    } else if (imageSignal.kind === "hp_hud") {
      details.push(
        `hp:${imageSignal.roiLabel} ${imageSignal.isVisible ? "visible" : "hidden"} ${formatSignalScore(
          imageSignal,
        )}`,
      );
      details.push(
        `bar ${formatConfidence(imageSignal.greenBarScore)} / plate ${formatConfidence(
          imageSignal.nameplateScore,
        )}`,
      );
    } else if (imageSignal.kind === "vs_splash") {
      details.push(
        `vs ${imageSignal.isVisible ? "visible" : "hidden"} ${formatSignalScore(imageSignal)}`,
      );
      details.push(
        `purple ${formatConfidence(imageSignal.purpleScore)} / area ${formatConfidence(
          imageSignal.largeComponentScore,
        )}`,
      );
    } else if (imageSignal.kind === "message_presence") {
      details.push(
        `message ${imageSignal.isVisible ? "present" : "absent"} ${formatSignalScore(
          imageSignal,
        )}`,
      );
      details.push(
        `foreground ${formatTextDensity(imageSignal.foregroundRatio)} / ${imageSignal.lineBandCount} bands / ${imageSignal.componentCount} components`,
      );
      if (imageSignal.fingerprint) {
        details.push(`fingerprint ${imageSignal.fingerprint}`);
      }
    } else {
      details.push(
        `wait ${imageSignal.isVisible ? "visible" : "hidden"} ${formatSignalScore(imageSignal)}`,
      );
      details.push(
        `icon ${formatConfidence(imageSignal.yellowIconScore)} / text ${formatConfidence(
          imageSignal.whiteTextScore,
        )}`,
      );
    }
  }

  if (diagnostic.detail) {
    details.push(diagnostic.detail);
  }

  if (diagnostic.preprocessVariantId) {
    details.push(`mask ${diagnostic.preprocessVariantId}`);
  }

  if (diagnostic.ocrVariantId) {
    details.push(`OCR ${diagnostic.ocrVariantId}`);
  }

  if (diagnostic.ocrCandidateId) {
    details.push(
      `candidate ${diagnostic.ocrCandidateId}${
        diagnostic.ocrCandidateCount ? `/${diagnostic.ocrCandidateCount}` : ""
      }`,
    );
  }

  if (diagnostic.ocrForegroundPixelRatio !== null) {
    details.push(`density ${formatTextDensity(diagnostic.ocrForegroundPixelRatio)}`);
  }

  if (diagnostic.pendingOcrJobs !== null) {
    details.push(`pending ${diagnostic.pendingOcrJobs}`);
  }

  if (diagnostic.ocrConfidence !== null) {
    details.push(`conf ${formatConfidence(diagnostic.ocrConfidence)}`);
  }

  if (diagnostic.lineCount !== null) {
    details.push(`${diagnostic.lineCount} lines`);
  }

  if (diagnostic.ocrDurationMs !== null && diagnostic.ocrDurationMs !== undefined) {
    details.push(`${diagnostic.ocrDurationMs}ms`);
  }

  if (diagnostic.selectionReason) {
    details.push(diagnostic.selectionReason);
  }

  return details.length > 0 ? details.join(" / ") : "no detail";
}

function formatProgress(progress: number) {
  return `${Math.round(clamp(progress, 0, 1) * 100)}%`;
}

function getResolvedLogPanelWidthBounds(containerWidth: number | null) {
  if (!containerWidth) {
    return {
      minWidth: MIN_RESOLVED_LOG_PANEL_WIDTH,
      maxWidth: MAX_RESOLVED_LOG_PANEL_WIDTH,
    };
  }

  const maxWidthFromContainer =
    containerWidth - MIN_PREVIEW_PANEL_WIDTH - WORKSPACE_RESIZER_WIDTH;

  return {
    minWidth: MIN_RESOLVED_LOG_PANEL_WIDTH,
    maxWidth: Math.max(
      MIN_RESOLVED_LOG_PANEL_WIDTH,
      Math.min(MAX_RESOLVED_LOG_PANEL_WIDTH, maxWidthFromContainer),
    ),
  };
}

function clampResolvedLogPanelWidth(width: number, containerWidth: number | null) {
  const { minWidth, maxWidth } = getResolvedLogPanelWidthBounds(containerWidth);
  return Math.round(clamp(width, minWidth, maxWidth));
}

function getManagementPanelHeightBounds(containerHeight: number | null) {
  if (!containerHeight) {
    return {
      minHeight: MIN_MANAGEMENT_PANEL_HEIGHT,
      maxHeight: MAX_MANAGEMENT_PANEL_HEIGHT,
    };
  }

  const maxHeightFromContainer = containerHeight - MANAGEMENT_RESIZER_HEIGHT;

  return {
    minHeight: MIN_MANAGEMENT_PANEL_HEIGHT,
    maxHeight: Math.max(
      MIN_MANAGEMENT_PANEL_HEIGHT,
      Math.min(MAX_MANAGEMENT_PANEL_HEIGHT, maxHeightFromContainer),
    ),
  };
}

function clampManagementPanelHeight(height: number, containerHeight: number | null) {
  const { minHeight, maxHeight } = getManagementPanelHeightBounds(containerHeight);
  return Math.round(clamp(height, minHeight, maxHeight));
}

function getPositiveSizeOrNull(size: number | undefined) {
  return size && size > 0 ? size : null;
}

function formatEventType(type: string) {
  const labels: Record<string, string> = {
    ability: "特性",
    activate: "発動",
    battle_end: "勝負終了",
    battle_start: "勝負開始",
    boost: "能力上昇",
    critical: "急所",
    damage: "ダメージ",
    fail: "失敗",
    faint: "ひんし",
    field_end: "場終了",
    field_start: "場開始",
    flinch: "ひるみ",
    heal: "回復",
    immune: "無効",
    item: "道具",
    miss: "外れ",
    move: "技",
    protect: "まもる",
    redirection: "注目誘導",
    resisted: "半減",
    side_end: "サイド終了",
    side_start: "サイド開始",
    status: "状態異常",
    status_cure: "状態回復",
    supereffective: "抜群",
    switch_in: "交代in",
    switch_out: "交代out",
    terrain_end: "フィールド終了",
    terrain_start: "フィールド開始",
    unboost: "能力下降",
    weather_end: "天候終了",
    weather_start: "天候開始",
  };

  return labels[type] ?? type;
}

function formatParseSummary(result: BattleMessageParseResult) {
  if (result.status === "unknown") {
    return result.candidateMatches.length > 0
      ? `unknown / ${result.candidateMatches.length} candidates`
      : "unknown";
  }

  const events = getParsedBattleEvents(result);
  const firstEvent = events[0] ?? result.event;
  const eventCount = events.length > 1 ? ` x${events.length}` : "";
  const actor = firstEvent.actor.name ? ` / ${firstEvent.actor.name}` : "";
  const move = firstEvent.move ? ` / ${firstEvent.move}` : "";

  return `${formatEventType(firstEvent.type)}${eventCount} / ${firstEvent.classification.method}${actor}${move}`;
}

function formatSide(side: BattleEvent["actor"]["side"]) {
  if (side === "opponent") {
    return "相手";
  }

  if (side === "player") {
    return "自分";
  }

  return "side未判定";
}

function formatEventSummary(event: BattleEvent) {
  const actor = event.actor.name ? ` / ${formatSide(event.actor.side)} ${event.actor.name}` : "";
  const move = event.move ? ` / ${event.move}` : "";

  return `${formatEventType(event.type)}${actor}${move}`;
}

function formatCanonicalEventText(event: BattleEvent) {
  return renderBattleEventCanonicalText(event);
}

function createObservedDictionaryEntry(kind: "pokemon" | "move", label: string): DictionaryEntry {
  return {
    id: `${kind === "pokemon" ? "session-roster" : "observed-move"}:${encodeURIComponent(label)}`,
    label,
  };
}

function upsertObservedDictionaryEntry(
  currentEntries: readonly DictionaryEntry[],
  kind: "pokemon" | "move",
  label: string | null,
  limit: number,
) {
  if (!label) {
    return currentEntries;
  }

  const withoutExisting = currentEntries.filter((entry) => entry.label !== label);

  return [createObservedDictionaryEntry(kind, label), ...withoutExisting].slice(0, limit);
}

function collectSessionRosterDictionary(events: readonly BattleEvent[]) {
  let entries: readonly DictionaryEntry[] = [];

  for (const event of events) {
    entries = upsertObservedDictionaryEntry(
      entries,
      "pokemon",
      event.actor.name,
      MAX_SESSION_ROSTER_DICTIONARY_ENTRIES,
    );
    entries = upsertObservedDictionaryEntry(
      entries,
      "pokemon",
      event.target?.name ?? null,
      MAX_SESSION_ROSTER_DICTIONARY_ENTRIES,
    );
  }

  return entries;
}

function collectObservedMoveDictionary(events: readonly BattleEvent[]) {
  let entries: readonly DictionaryEntry[] = [];

  for (const event of events) {
    entries = upsertObservedDictionaryEntry(
      entries,
      "move",
      event.move,
      MAX_OBSERVED_MOVE_DICTIONARY_ENTRIES,
    );
  }

  return entries;
}

function formatOcrLogDisplayText(entry: OCRLogEntry) {
  if (entry.parseResult?.status === "event") {
    const event = {
      id: entry.id,
      battleId: LIVE_BATTLE_ID,
      turn: null,
      timestampMs: entry.timestampMs,
      rawText: entry.rawText,
      normalizedText: entry.normalizedText,
      source: { frameIndex: entry.frameIndex, timestampMs: entry.timestampMs, cropObjectUrl: null },
      ...entry.parseResult.event,
    } satisfies BattleEvent;

    return formatCanonicalEventText(event);
  }

  return entry.normalizedText || "テキストなし";
}

function formatResolvedEventChip(event: BattleEvent) {
  const actor = event.actor.name ? ` / ${event.actor.name}` : "";
  const move = event.move ? ` / ${event.move}` : "";

  return `${formatEventType(event.type)} / ${event.classification.method}${actor}${move}`;
}

function formatReviewStatus(status: UnknownEvent["reviewStatus"]) {
  return status === "reviewed" ? "reviewed" : "unreviewed";
}

function getTimelineItemTimestamp(item: TimelineItem) {
  return item.kind === "event" ? item.event.timestampMs : item.unknown.timestampMs;
}

function getTimelineItemId(item: TimelineItem) {
  return item.kind === "event" ? item.event.id : item.unknown.id;
}

function getTimelineItemSourceFrameRef(item: TimelineItem) {
  if (item.kind === "event") {
    return createSourceFrameRef(item.event.source.frameIndex, item.event.source.timestampMs);
  }

  return item.unknown.sourceFrameRef;
}

function createOcrLogGroupKey(entry: OCRLogEntry) {
  if (entry.status === "error") {
    return `error:${entry.errorMessage ?? ""}`;
  }

  return [
    entry.status,
    entry.matchText,
    entry.parseResult?.status ?? "",
    entry.parseResult && entry.parseResult.status === "event" ? entry.parseResult.event.type : "",
  ].join("|");
}

function groupOcrLogs(entries: readonly OCRLogEntry[], limit: number) {
  const groups: OCRLogGroup[] = [];

  for (const entry of entries) {
    const key = createOcrLogGroupKey(entry);
    const latestGroup = groups[groups.length - 1];

    if (latestGroup?.key === key) {
      latestGroup.count += 1;
      continue;
    }

    groups.push({ key, entry, count: 1 });

    if (groups.length >= limit) {
      break;
    }
  }

  return groups;
}

function createOcrLogEntryFromMessage(message: OCRMessage): OCRLogEntry {
  return {
    id: message.id,
    frameIndex: message.frameIndex ?? 0,
    timestampMs: message.timestampMs,
    rawText: message.rawText,
    normalizedText: message.normalizedText,
    matchText: message.matchText,
    confidence: message.ocrConfidence,
    lineCount: message.lines.length,
    status: message.normalizedText.length > 0 ? "recognized" : "empty",
  };
}

function sortNewestFirst<T extends { timestampMs: number; id: string }>(items: readonly T[]) {
  return [...items].sort(
    (left, right) => right.timestampMs - left.timestampMs || right.id.localeCompare(left.id),
  );
}

function formatStorageTimestamp(date = new Date()) {
  return date.toLocaleTimeString("ja-JP", { hour12: false });
}

function createFileStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function downloadTextFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function pruneOldestMapEntries<TKey, TValue>(map: Map<TKey, TValue>, maxSize: number) {
  const deletedKeys: TKey[] = [];

  while (map.size > maxSize) {
    const firstKey = map.keys().next().value as TKey | undefined;

    if (firstKey === undefined) {
      break;
    }

    map.delete(firstKey);
    deletedKeys.push(firstKey);
  }

  return deletedKeys;
}

function updateTimelineDeduplicationRecords(
  currentRecords: readonly TimelineDeduplicationRecord[],
  nextRecords: readonly TimelineDeduplicationRecord[],
  timestampMs: number,
) {
  if (nextRecords.length === 0) {
    return currentRecords.filter(
      (record) => timestampMs - record.timestampMs <= TIMELINE_DUPLICATE_WINDOW_MS,
    );
  }

  const minTimestampMs = timestampMs - TIMELINE_DUPLICATE_WINDOW_MS;

  return [
    ...nextRecords,
    ...currentRecords.filter((record) => record.timestampMs >= minTimestampMs),
  ].slice(0, MAX_TIMELINE_DEDUPE_RECORDS);
}

function createLog(message: string, level: LogLevel = "info"): SystemLog {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    level,
    message,
    timestamp: new Date().toLocaleTimeString("ja-JP", { hour12: false }),
  };
}

function getVideoTrackSettings(activeStream: MediaStream | null) {
  const [videoTrack] = activeStream?.getVideoTracks() ?? [];
  return videoTrack?.getSettings() ?? {};
}

function getVideoMetadata(video: HTMLVideoElement, activeStream: MediaStream | null): MediaMetadata {
  const settings = getVideoTrackSettings(activeStream);

  return {
    width: video.videoWidth || settings.width || null,
    height: video.videoHeight || settings.height || null,
    frameRate: settings.frameRate ?? null,
  };
}

function getTrackFrameRate(stream: MediaStream | null) {
  return getVideoTrackSettings(stream).frameRate ?? null;
}

function createDeviceOptions(devices: MediaDeviceInfo[], kind: InputDevice["kind"]) {
  let deviceIndex = 0;

  return devices
    .filter((device) => device.kind === kind)
    .map((device) => {
      deviceIndex += 1;
      const rawLabel = device.label.trim();

      return {
        deviceId: device.deviceId,
        kind,
        hasDeviceLabel: rawLabel.length > 0,
        label:
          rawLabel ||
          (kind === "videoinput" ? `映像デバイス ${deviceIndex}` : `音声デバイス ${deviceIndex}`),
      };
    });
}

function getDeviceLabel(devices: InputDevice[], deviceId: string, fallback: string) {
  return devices.find((device) => device.deviceId === deviceId)?.label ?? fallback;
}

function buildVideoConstraints(
  selectedDeviceId: string,
  profile: MediaTrackConstraints,
): MediaStreamConstraints {
  const video: MediaTrackConstraints = { ...profile };

  if (selectedDeviceId) {
    video.deviceId = { exact: selectedDeviceId };
  }

  return {
    audio: false,
    video: Object.keys(video).length > 0 ? video : true,
  };
}

function shouldRetryVideoRequest(error: unknown, index: number, total: number) {
  if (index >= total - 1) {
    return false;
  }

  return (
    error instanceof DOMException &&
    ["OverconstrainedError", "ConstraintNotSatisfiedError", "NotFoundError"].includes(error.name)
  );
}

async function requestPreferredVideoStream(selectedDeviceId: string) {
  let lastError: unknown = null;

  for (let index = 0; index < STREAM_PROFILES.length; index += 1) {
    try {
      return await navigator.mediaDevices.getUserMedia(
        buildVideoConstraints(selectedDeviceId, STREAM_PROFILES[index]),
      );
    } catch (error) {
      lastError = error;

      if (!shouldRetryVideoRequest(error, index, STREAM_PROFILES.length)) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("映像入力の開始に失敗しました。");
}

function buildAudioConstraints(selectedDeviceId: string): MediaStreamConstraints {
  const audio: MediaTrackConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };

  if (selectedDeviceId) {
    audio.deviceId = { exact: selectedDeviceId };
  }

  return {
    audio,
    video: false,
  };
}

function getAudioContextClass() {
  const browserWindow = window as Window &
    typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  return browserWindow.AudioContext ?? browserWindow.webkitAudioContext ?? null;
}

async function playVideoElement(video: HTMLVideoElement) {
  try {
    await video.play();
  } catch {
    // Browser autoplay policy can reject play(); the user can press start again after permission.
  }
}

function getFrameSourceDimensions(source: FrameSourceElement) {
  if (source instanceof HTMLVideoElement) {
    return {
      width: source.videoWidth,
      height: source.videoHeight,
    };
  }

  return {
    width: source.naturalWidth,
    height: source.naturalHeight,
  };
}

function getFrameDisplayDimensions(source: FrameSourceElement, sourceWidth: number, sourceHeight: number) {
  const rect = source.getBoundingClientRect();

  if (!rect.width || !rect.height) {
    return { width: sourceWidth, height: sourceHeight };
  }

  return { width: rect.width, height: rect.height };
}

function imageDataToScaledDataUrl(imageData: ImageData, scale: number) {
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = imageData.width;
  sourceCanvas.height = imageData.height;
  const sourceContext = sourceCanvas.getContext("2d");

  if (!sourceContext) {
    return null;
  }

  sourceContext.putImageData(imageData, 0, 0);

  const scaledCanvas = document.createElement("canvas");
  scaledCanvas.width = imageData.width * scale;
  scaledCanvas.height = imageData.height * scale;
  const scaledContext = scaledCanvas.getContext("2d");

  if (!scaledContext) {
    return null;
  }

  scaledContext.imageSmoothingEnabled = false;
  scaledContext.drawImage(sourceCanvas, 0, 0, scaledCanvas.width, scaledCanvas.height);

  return scaledCanvas.toDataURL("image/png");
}

function captureRoiImageData(
  source: FrameSourceElement,
  roi: NormalizedRoi,
) {
  const { width: sourceWidth, height: sourceHeight } = getFrameSourceDimensions(source);

  if (!sourceWidth || !sourceHeight) {
    return null;
  }

  const crop = mapDisplayRoiToSourceRect(
    roi,
    { width: sourceWidth, height: sourceHeight },
    getFrameDisplayDimensions(source, sourceWidth, sourceHeight),
  );

  if (!crop) {
    return null;
  }

  const rawCanvas = document.createElement("canvas");
  rawCanvas.width = crop.width;
  rawCanvas.height = crop.height;
  const rawContext = rawCanvas.getContext("2d", { willReadFrequently: true });

  if (!rawContext) {
    return null;
  }

  rawContext.drawImage(
    source,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height,
  );

  const rawImageData = rawContext.getImageData(0, 0, crop.width, crop.height);

  return {
    imageData: rawImageData,
    dataUrl: rawCanvas.toDataURL("image/png"),
    sourceWidth,
    sourceHeight,
    cropWidth: crop.width,
    cropHeight: crop.height,
  };
}

function captureScaledRoiImageData(
  source: FrameSourceElement,
  roi: NormalizedRoi,
  maxWidth: number,
) {
  const { width: sourceWidth, height: sourceHeight } = getFrameSourceDimensions(source);

  if (!sourceWidth || !sourceHeight) {
    return null;
  }

  const crop = mapDisplayRoiToSourceRect(
    roi,
    { width: sourceWidth, height: sourceHeight },
    getFrameDisplayDimensions(source, sourceWidth, sourceHeight),
  );

  if (!crop) {
    return null;
  }

  const scale = Math.min(1, Math.max(1, maxWidth) / crop.width);
  const width = Math.max(1, Math.round(crop.width * scale));
  const height = Math.max(1, Math.round(crop.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    return null;
  }

  context.imageSmoothingEnabled = true;
  context.drawImage(
    source,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    width,
    height,
  );

  return context.getImageData(0, 0, width, height);
}

function captureBattleHudObservation(
  source: FrameSourceElement,
  roi: NormalizedRoi,
  roiLabel: HudRoiLabel,
): BattleHudObservation | null {
  const captured = captureRoiImageData(source, roi);

  if (!captured) {
    return null;
  }

  return {
    roiLabel,
    roi,
    signal: analyzeBattleHudImage(captured.imageData, roiLabel),
  };
}

function captureHudPhaseObservation(
  source: FrameSourceElement,
  opponentHudRoi: NormalizedRoi,
  playerHudRoi: NormalizedRoi,
): HudPhaseObservation {
  const opponent = captureBattleHudObservation(source, opponentHudRoi, "opponent");
  const player = captureBattleHudObservation(source, playerHudRoi, "player");
  const visibleObservations = [opponent, player].filter(
    (observation): observation is BattleHudObservation =>
      observation !== null && observation.signal.isVisible,
  );
  const selected =
    visibleObservations.sort((left, right) => right.signal.score - left.signal.score)[0] ??
    [opponent, player]
      .filter((observation): observation is BattleHudObservation => observation !== null)
      .sort((left, right) => right.signal.score - left.signal.score)[0] ??
    null;

  return {
    opponent,
    player,
    selected,
    isVisible: visibleObservations.length > 0,
  };
}

function captureVsSplashObservation(
  source: FrameSourceElement,
  roi: NormalizedRoi,
): VsSplashObservation | null {
  const captured = captureRoiImageData(source, roi);

  if (!captured) {
    return null;
  }

  return {
    roi,
    signal: analyzeVsSplashImage(captured.imageData),
  };
}

function captureRoiFrame(
  source: FrameSourceElement,
  roi: NormalizedRoi,
  preprocess: MessagePreprocessOptions,
  upscaleFactor: number,
): CapturedFrameImages | null {
  const captured = captureRoiImageData(source, roi);

  if (!captured) {
    return null;
  }

  const rawImageData = captured.imageData;
  const preprocessVariants = createMessagePreprocessVariants(rawImageData, preprocess, {
    minForegroundPixelRatio: MIN_TEXT_PIXEL_RATIO,
    maxForegroundPixelRatio: MAX_TEXT_PIXEL_RATIO,
  });
  const selectedPreprocessVariant =
    choosePreferredMessagePreprocessVariant(preprocessVariants) ??
    preprocessVariants.find((variant) => variant.id === "white");

  if (!selectedPreprocessVariant) {
    return null;
  }

  const processedImageData = selectedPreprocessVariant.imageData;
  const metrics = selectedPreprocessVariant.metrics;
  const selectedTextMask = selectedPreprocessVariant.id;
  const selectedRejectReason = selectedPreprocessVariant.rejectReason;
  const selectedLineCropVariants = selectedPreprocessVariant.lineCropVariants;
  const messageFingerprint = createMessageMaskFingerprint(processedImageData, {
    ...preprocess,
    textMask: selectedTextMask,
  });
  const fallbackVariants = preprocessVariants
    .filter((variant) => variant.id !== selectedTextMask && variant.isOcrCandidate)
    .sort((left, right) => right.score - left.score);
  const scale = Math.max(1, Math.round(upscaleFactor));
  const processedDataUrl = imageDataToScaledDataUrl(processedImageData, scale);

  if (!processedDataUrl) {
    return null;
  }

  const lineCropPreviews: ProcessedLineCropPreview[] = [];

  for (const variant of selectedLineCropVariants) {
    const dataUrl = variant.id === "full"
      ? processedDataUrl
      : imageDataToScaledDataUrl(variant.imageData, scale);

    if (!dataUrl) {
      continue;
    }

    lineCropPreviews.push({
      id: `${selectedTextMask}/${variant.id}`,
      textMask: selectedTextMask,
      processedDataUrl: dataUrl,
      cropWidth: variant.imageData.width,
      cropHeight: variant.imageData.height,
      sourceY: variant.y,
      lineCount: variant.lineCount,
      foregroundPixelRatio: variant.metrics.foregroundPixelRatio,
    });
  }

  const detectedLineCount = selectedLineCropVariants[0]?.lineCount ?? 0;
  const preferredLineCount = Math.min(3, detectedLineCount);
  const preferredVariant =
    lineCropPreviews.find(
      (variant) => variant.id === `${selectedTextMask}/top-${preferredLineCount}-lines`,
    ) ??
    lineCropPreviews[0] ?? {
      id: `${selectedTextMask}/full`,
      textMask: selectedTextMask,
      processedDataUrl,
      cropWidth: captured.cropWidth,
      cropHeight: captured.cropHeight,
      sourceY: 0,
      lineCount: detectedLineCount,
      foregroundPixelRatio: metrics.foregroundPixelRatio,
    };
  const fallbackPreviewVariants: ProcessedLineCropPreview[] = [];
  const fallbackVariant = fallbackVariants[0];

  if (fallbackVariant) {
    const fallbackLineCount = Math.min(3, fallbackVariant.lineCropVariants[0]?.lineCount ?? 0);
    const fallbackCrop =
      fallbackVariant.lineCropVariants.find(
        (variant) => variant.id === `top-${fallbackLineCount}-lines`,
      ) ?? fallbackVariant.lineCropVariants[0];
    const fallbackDataUrl = fallbackCrop
      ? imageDataToScaledDataUrl(fallbackCrop.imageData, scale)
      : null;

    if (fallbackCrop && fallbackDataUrl) {
      fallbackPreviewVariants.push({
        id: `${fallbackVariant.id}/${fallbackCrop.id}`,
        textMask: fallbackVariant.id,
        processedDataUrl: fallbackDataUrl,
        cropWidth: fallbackCrop.imageData.width,
        cropHeight: fallbackCrop.imageData.height,
        sourceY: fallbackCrop.y,
        lineCount: fallbackCrop.lineCount,
        foregroundPixelRatio: fallbackCrop.metrics.foregroundPixelRatio,
      });
    }
  }

  const suppressedLinePreviews = lineCropPreviews
    .filter((variant) => variant.id.startsWith(`${selectedTextMask}/annotation-suppressed-line-`))
    .sort((left, right) => left.sourceY - right.sourceY)
    .slice(0, 3);
  const regularLinePreviews = lineCropPreviews
    .filter((variant) => /^.+\/line-\d+$/u.test(variant.id))
    .sort((left, right) => left.sourceY - right.sourceY)
    .slice(0, 3);
  const linewisePreviews = suppressedLinePreviews.length > 0
    ? suppressedLinePreviews
    : regularLinePreviews;
  const fullPreview = lineCropPreviews.find(
    (variant) => variant.id === `${selectedTextMask}/full`,
  );
  const ocrCandidates = [
    createRecognitionCandidate({
      id: "primary",
      variantId: preferredVariant.id,
      strategy: "block",
      segments: [{
        id: preferredVariant.id,
        imageDataUrl: preferredVariant.processedDataUrl,
        pageSegMode: "single_block",
      }],
    }),
    ...(linewisePreviews.length > 0
      ? [createRecognitionCandidate({
          id: "linewise",
          variantId: `${selectedTextMask}/linewise`,
          strategy: "linewise",
          segments: linewisePreviews.map((variant) => ({
            id: variant.id,
            imageDataUrl: variant.processedDataUrl,
            pageSegMode: "single_line" as const,
          })),
        })]
      : []),
    ...(fallbackPreviewVariants[0]
      ? [createRecognitionCandidate({
          id: "fallback-mask",
          variantId: fallbackPreviewVariants[0].id,
          strategy: "block",
          segments: [{
            id: fallbackPreviewVariants[0].id,
            imageDataUrl: fallbackPreviewVariants[0].processedDataUrl,
            pageSegMode: "single_block",
          }],
        })]
      : fullPreview
        ? [createRecognitionCandidate({
            id: "sparse-full",
            variantId: fullPreview.id,
            strategy: "sparse",
            segments: [{
              id: fullPreview.id,
              imageDataUrl: fullPreview.processedDataUrl,
              pageSegMode: "sparse_text",
            }],
          })]
        : []),
  ].slice(0, 3);

  return {
    rawDataUrl: captured.dataUrl,
    processedDataUrl,
    preprocessVariantId: selectedTextMask,
    preprocessVariantRejectReason: selectedRejectReason,
    ocrDataUrl: preferredVariant.processedDataUrl,
    ocrVariantId: preferredVariant.id,
    ocrForegroundPixelRatio: preferredVariant.foregroundPixelRatio,
    messageFingerprint,
    lineBandCount: detectedLineCount,
    lineCropVariants: [...lineCropPreviews, ...fallbackPreviewVariants],
    ocrCandidates,
    sourceWidth: captured.sourceWidth,
    sourceHeight: captured.sourceHeight,
    cropWidth: captured.cropWidth,
    cropHeight: captured.cropHeight,
    foregroundPixelCount: metrics.foregroundPixelCount,
    totalPixelCount: metrics.totalPixelCount,
    foregroundPixelRatio: metrics.foregroundPixelRatio,
  };
}

export function App() {
  const [initialHeaderMediaSettings] = useState<HeaderMediaSettings | null>(() =>
    loadStoredHeaderMediaSettings(),
  );
  const [initialRoiSettings] = useState<RoiSettings | null>(() => loadStoredRoiSettings());
  const captureShellRef = useRef<HTMLElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imagePreviewRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const battleLogImportInputRef = useRef<HTMLInputElement | null>(null);
  const templateImportInputRef = useRef<HTMLInputElement | null>(null);
  const captureMainRef = useRef<HTMLElement | null>(null);
  const previewColumnRef = useRef<HTMLDivElement | null>(null);
  const resolvedLogPanelRef = useRef<HTMLElement | null>(null);
  const resolvedLogResizeSessionRef = useRef<ResolvedLogResizeSession | null>(null);
  const managementPanelRef = useRef<HTMLElement | null>(null);
  const managementPanelResizeSessionRef = useRef<ManagementPanelResizeSession | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const audioInputStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioGainNodeRef = useRef<GainNode | null>(null);
  const audioSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const samplingTimerRef = useRef<number | null>(null);
  const messageWatchTimerRef = useRef<number | null>(null);
  const deferredOcrTimerIdsRef = useRef<Set<number>>(new Set());
  const ocrWorkerRef = useRef<Worker | null>(null);
  const cropEvidenceBySourceRef = useRef<Map<string, CropEvidence>>(new Map());
  const observationEvidenceRefById = useRef<Map<string, string>>(new Map());
  const recentTimelineDeduplicationRecordsRef = useRef<TimelineDeduplicationRecord[]>([]);
  const recentConstrainedCandidateRecordsRef = useRef<TimelineConstrainedCandidateRecord[]>([]);
  const recentAcceptedEventRecordsRef = useRef<TimelineAcceptedEventRecord[]>([]);
  const sessionRosterDictionaryRef = useRef<DictionaryEntry[]>([]);
  const observedMoveDictionaryRef = useRef<DictionaryEntry[]>([]);
  const latestHeaderMediaSettingsRef = useRef<HeaderMediaSettings>({
    videoDeviceId: initialHeaderMediaSettings?.videoDeviceId ?? "",
    audioDeviceId: initialHeaderMediaSettings?.audioDeviceId ?? NO_AUDIO_DEVICE_ID,
    audioVolume: initialHeaderMediaSettings?.audioVolume ?? DEFAULT_AUDIO_VOLUME,
    isAudioMuted: initialHeaderMediaSettings?.isAudioMuted ?? false,
  });
  const hasAttemptedSavedMediaAutoStartRef = useRef(false);
  const lastAcceptedEventIdRef = useRef<string | null>(null);
  const frameIndexRef = useRef(0);
  const messageWatchFrameIndexRef = useRef(0);
  const messageObservationCounterRef = useRef(0);
  const ocrJobCounterRef = useRef(0);
  const sampleDiagnosticCounterRef = useRef(0);
  const phaseTransitionCounterRef = useRef(0);
  const pendingOcrJobsRef = useRef(0);
  const activeOcrJobRef = useRef<ActiveOcrJob | null>(null);
  const deferredOcrSamplesRef = useRef<FrameSample[]>([]);
  const phaseWaitingOcrSamplesRef = useRef<PhaseWaitingOcrSample[]>([]);
  const scheduledDeferredObservationIdsRef = useRef<Set<string>>(new Set());
  const messageWatcherStateRef = useRef<MessageWatcherState>(
    createInitialMessageWatcherState(),
  );
  const persistentUiModelStateRef = useRef<PersistentUiModelState>(
    createInitialPersistentUiModelState(),
  );
  const messageObservationsRef = useRef<MessageObservation[]>([]);
  const ocrMessagesRef = useRef<OCRMessage[]>([]);
  const battleEventsRef = useRef<BattleEvent[]>([]);
  const unknownEventsRef = useRef<UnknownEvent[]>([]);
  const usableOcrTextObservationIdsRef = useRef<Set<string>>(new Set());
  const unknownGateReasonByObservationIdRef = useRef<
    Map<string, UnknownEventGateReason>
  >(new Map());
  const queueOcrRecognitionRef = useRef<(sample: FrameSample) => void>(() => undefined);
  const requestPhaseAwareOcrRef = useRef<
    (
      sample: FrameSample,
      evidence: PhaseAdmissionVisualEvidence,
      nowMs?: number,
    ) => void
  >(() => undefined);
  const flushPhaseWaitingOcrSamplesRef = useRef<(nowMs: number) => void>(
    () => undefined,
  );
  const dropPhaseWaitingOcrSamplesRef = useRef<
    (
      reason: "phase_rejected" | "battle_ended",
      timestampMs: number,
      frameIndex: number,
    ) => void
  >(() => undefined);
  const phaseDetectionSummaryRef = useRef<PhaseDetectionSummary>(
    createEmptyPhaseDetectionSummary(),
  );
  const phaseTransitionsRef = useRef<PhaseTransitionDiagnostic[]>([]);
  const templateRulesRef = useRef<readonly BattleTemplateRule[]>(STANDARD_TEMPLATE_RULES);
  const samplingStartMsRef = useRef(0);
  const isOcrEnabledRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [mediaMode, setMediaMode] = useState<MediaMode>("idle");
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [videoDevices, setVideoDevices] = useState<InputDevice[]>([]);
  const [audioDevices, setAudioDevices] = useState<InputDevice[]>([]);
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState(
    () => initialHeaderMediaSettings?.videoDeviceId ?? "",
  );
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState(
    () => initialHeaderMediaSettings?.audioDeviceId ?? NO_AUDIO_DEVICE_ID,
  );
  const [inputStatus, setInputStatus] = useState<InputStatus>("unknown");
  const [hasEnumeratedDevices, setHasEnumeratedDevices] = useState(false);
  const [metadata, setMetadata] = useState<MediaMetadata>({
    width: null,
    height: null,
    frameRate: null,
  });
  const [audioReady, setAudioReady] = useState(false);
  const [audioVolume, setAudioVolume] = useState(
    () => initialHeaderMediaSettings?.audioVolume ?? DEFAULT_AUDIO_VOLUME,
  );
  const [isAudioMuted, setIsAudioMuted] = useState(
    () => initialHeaderMediaSettings?.isAudioMuted ?? false,
  );
  const [isVolumePanelOpen, setIsVolumePanelOpen] = useState(false);
  const [roi, setRoi] = useState<NormalizedRoi>(() => initialRoiSettings?.roi ?? DEFAULT_ROI);
  const [opponentHudRoi, setOpponentHudRoi] = useState<NormalizedRoi>(
    () => initialRoiSettings?.opponentHudRoi ?? DEFAULT_OPPONENT_HUD_ROI,
  );
  const [playerHudRoi, setPlayerHudRoi] = useState<NormalizedRoi>(
    () => initialRoiSettings?.playerHudRoi ?? DEFAULT_PLAYER_HUD_ROI,
  );
  const [vsRoi, setVsRoi] = useState<NormalizedRoi>(
    () => initialRoiSettings?.vsRoi ?? DEFAULT_VS_SPLASH_ROI,
  );
  const [isRoiVisible, setIsRoiVisible] = useState(
    () => initialRoiSettings?.isRoiVisible ?? DEFAULT_IS_ROI_VISIBLE,
  );
  const [isOpponentHudRoiVisible, setIsOpponentHudRoiVisible] = useState(
    () =>
      initialRoiSettings?.isOpponentHudRoiVisible ?? DEFAULT_IS_OPPONENT_HUD_ROI_VISIBLE,
  );
  const [isPlayerHudRoiVisible, setIsPlayerHudRoiVisible] = useState(
    () => initialRoiSettings?.isPlayerHudRoiVisible ?? DEFAULT_IS_PLAYER_HUD_ROI_VISIBLE,
  );
  const [isVsRoiVisible, setIsVsRoiVisible] = useState(
    () => initialRoiSettings?.isVsRoiVisible ?? DEFAULT_IS_VS_ROI_VISIBLE,
  );
  const [sampleFps, setSampleFps] = useState(DEFAULT_SAMPLE_FPS);
  const [isSampling, setIsSampling] = useState(false);
  const [preprocessOptions, setPreprocessOptions] =
    useState<MessagePreprocessOptions>(DEFAULT_PREPROCESS_OPTIONS);
  const [upscaleFactor, setUpscaleFactor] = useState(2);
  const [frameSamples, setFrameSamples] = useState<FrameSample[]>([]);
  const [isOcrEnabled, setIsOcrEnabled] = useState(false);
  const [ocrStatusLabel, setOcrStatusLabel] = useState("未開始");
  const [ocrProgress, setOcrProgress] = useState(0);
  const [pendingOcrJobs, setPendingOcrJobs] = useState(0);
  const [ocrLogs, setOcrLogs] = useState<OCRLogEntry[]>([]);
  const [ocrMessages, setOcrMessages] = useState<OCRMessage[]>([]);
  const [sampleDiagnostics, setSampleDiagnostics] = useState<FrameSampleDiagnostic[]>([]);
  const [battleEvents, setBattleEvents] = useState<BattleEvent[]>([]);
  const [unknownEvents, setUnknownEvents] = useState<UnknownEvent[]>([]);
  const [messageObservations, setMessageObservations] = useState<MessageObservation[]>([]);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [suppressedTimelineCount, setSuppressedTimelineCount] = useState(0);
  const [resolvedLogPanelWidth, setResolvedLogPanelWidth] = useState<number | null>(null);
  const [isResizingResolvedLogPanel, setIsResizingResolvedLogPanel] = useState(false);
  const [managementPanelHeight, setManagementPanelHeight] = useState<number | null>(null);
  const [isResizingManagementPanel, setIsResizingManagementPanel] = useState(false);
  const [isManagementPanelMaximized, setIsManagementPanelMaximized] = useState(false);
  const [isWorkspaceFullscreen, setIsWorkspaceFullscreen] = useState(false);
  const [activeManagementTab, setActiveManagementTab] = useState<ManagementTab | null>(null);
  const [activeReviewTab, setActiveReviewTab] = useState<ReviewTab>("timeline");
  const [templateImportStatusLabel, setTemplateImportStatusLabel] = useState("Template未読込");
  const [importedTemplateCollection, setImportedTemplateCollection] =
    useState<ImportedTemplateCollection | null>(null);
  const [logs, setLogs] = useState<SystemLog[]>(() => [
    createLog("M8 MVP workspace initialized."),
  ]);
  const roiRef = useRef(roi);
  const opponentHudRoiRef = useRef(opponentHudRoi);
  const playerHudRoiRef = useRef(playerHudRoi);
  const vsRoiRef = useRef(vsRoi);
  const phaseGateStateRef = useRef<MessagePhaseGateState>(
    createInitialMessagePhaseGateState(),
  );
  const mediaModeRef = useRef(mediaMode);
  const preprocessOptionsRef = useRef(preprocessOptions);
  const upscaleFactorRef = useRef(upscaleFactor);

  const addLog = useCallback((message: string, level: LogLevel = "info") => {
    setLogs((currentLogs) => [createLog(message, level), ...currentLogs].slice(0, 12));
  }, []);

  const appendSampleDiagnostic = useCallback(
    (diagnostic: Omit<FrameSampleDiagnostic, "id" | "battleId">) => {
      sampleDiagnosticCounterRef.current += 1;
      const nextDiagnostic: FrameSampleDiagnostic = {
        id: `sample_diag_${sampleDiagnosticCounterRef.current}`,
        battleId: LIVE_BATTLE_ID,
        ...diagnostic,
      };

      setSampleDiagnostics((currentDiagnostics) =>
        [nextDiagnostic, ...currentDiagnostics].slice(0, MAX_SAMPLE_DIAGNOSTICS),
      );
    },
    [],
  );
  const appendFrameSampleDiagnostic = useCallback(
    (
      sample: FrameSample,
      stage: FrameSampleDiagnosticStage,
      detail: string | null = null,
      ocrJobId: string | null = null,
    ) => {
      appendSampleDiagnostic({
        observationId: sample.observationId ?? null,
        frameIndex: sample.frameIndex,
        timestampMs: sample.timestampMs,
        stage,
        detail,
        preprocessVariantId: sample.preprocessVariantId,
        preprocessRejectReason: sample.preprocessVariantRejectReason,
        ocrVariantId: sample.ocrVariantId,
        ocrForegroundPixelRatio: sample.ocrForegroundPixelRatio,
        pendingOcrJobs: pendingOcrJobsRef.current,
        ocrJobId,
        ocrConfidence: null,
        lineCount: null,
      });
    },
    [appendSampleDiagnostic],
  );
  const commitOcrMessages = useCallback(
    (nextMessages: readonly OCRMessage[]) => {
      const bounded = [...nextMessages].slice(0, MAX_OCR_HISTORY);
      ocrMessagesRef.current = bounded;
      setOcrMessages(bounded);
    },
    [],
  );
  const commitBattleEvents = useCallback(
    (nextEvents: readonly BattleEvent[]) => {
      const bounded = [...nextEvents].slice(0, MAX_EVENT_HISTORY);
      battleEventsRef.current = bounded;
      setBattleEvents(bounded);
    },
    [],
  );
  const commitUnknownEvents = useCallback(
    (nextUnknowns: readonly UnknownEvent[]) => {
      const bounded = [...nextUnknowns].slice(0, MAX_UNKNOWN_HISTORY);
      unknownEventsRef.current = bounded;
      setUnknownEvents(bounded);
    },
    [],
  );
  const commitMessageObservations = useCallback(
    (nextObservations: readonly MessageObservation[]) => {
      const bounded = [...nextObservations].slice(0, MAX_MESSAGE_OBSERVATION_HISTORY);
      messageObservationsRef.current = bounded;
      setMessageObservations(bounded);
    },
    [],
  );
  const appendMessageWatchDiagnostic = useCallback(
    (input: {
      stage: Extract<
        FrameSampleDiagnosticStage,
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
      >;
      observationId: string;
      frameIndex: number;
      timestampMs: number;
      detail: string;
      analysis?: MessageWatchRuntimeAnalysis | null;
    }) => {
      appendSampleDiagnostic({
        observationId: input.observationId,
        frameIndex: input.frameIndex,
        timestampMs: input.timestampMs,
        stage: input.stage,
        detail: `${input.observationId} / ${input.detail}`,
        preprocessVariantId: null,
        preprocessRejectReason: input.analysis?.rejectReason ?? null,
        ocrVariantId: null,
        ocrForegroundPixelRatio: input.analysis?.foregroundRatio ?? null,
        pendingOcrJobs: pendingOcrJobsRef.current,
        ocrJobId: null,
        ocrConfidence: null,
        lineCount: input.analysis?.lineBandCount ?? null,
        imageSignal: input.analysis
          ? createMessagePresenceImageSignalDiagnostic(roiRef.current, input.analysis)
          : null,
      });
    },
    [appendSampleDiagnostic],
  );
  const appendObservationResolutionDiagnostic = useCallback(
    (
      previous: MessageObservation,
      next: MessageObservation,
      timestampMs: number,
      frameIndex: number,
    ) => {
      if (
        previous.disposition !== "suppressed" &&
        next.disposition === "suppressed" &&
        next.suppressionReason === "ocr_noise_gate"
      ) {
        appendMessageWatchDiagnostic({
          stage: "messageWatchNoiseSuppressed",
          observationId: next.id,
          frameIndex,
          timestampMs,
          detail: `unknown gate ${next.unknownGateReason ?? "other_noise"} / commit ${Math.round(
            (next.commitScore ?? 0) * 100,
          )}%`,
        });
        return;
      }

      if (previous.resolution === next.resolution || next.resolution === "pending") {
        return;
      }

      const durationMs = Math.max(0, timestampMs - next.openedAtMs);
      const detail = `resolution ${next.resolution} / ${durationMs}ms / ${next.ocrAttemptCount} OCR attempt(s)${
        next.failureReason ? ` / ${next.failureReason}` : ""
      }`;
      const stage =
        next.resolution === "resolved"
          ? "messageWatchResolved"
          : next.resolution === "ocr_unknown"
            ? "messageWatchOcrUnknown"
            : "messageWatchUnread";
      appendMessageWatchDiagnostic({
        stage,
        observationId: next.id,
        frameIndex,
        timestampMs,
        detail,
      });
      addLog(
        next.resolution === "resolved"
          ? `バトルメッセージを解決しました: ${next.id}`
          : next.resolution === "ocr_unknown"
            ? `OCR文字列を未解決として記録しました: ${next.id}`
            : `内容を認識できないメッセージを記録しました: ${next.id} (${next.failureReason ?? "unknown"})`,
        next.resolution === "unread" ? "warn" : "info",
      );
    },
    [addLog, appendMessageWatchDiagnostic],
  );
  const updateMessageObservationById = useCallback(
    (
      observationId: string,
      updater: (observation: MessageObservation) => MessageObservation,
      transitionContext?: { timestampMs: number; frameIndex: number },
    ) => {
      const index = messageObservationsRef.current.findIndex(
        (observation) => observation.id === observationId,
      );

      if (index < 0) {
        return null;
      }

      const previous = messageObservationsRef.current[index];
      const next = updater(previous);

      if (next === previous) {
        return next;
      }

      const observations = [...messageObservationsRef.current];
      observations[index] = next;
      commitMessageObservations(observations);

      if (transitionContext) {
        appendObservationResolutionDiagnostic(
          previous,
          next,
          transitionContext.timestampMs,
          transitionContext.frameIndex,
        );
      }

      return next;
    },
    [
      appendObservationResolutionDiagnostic,
      commitMessageObservations,
    ],
  );
  const tryMergeObservation = useCallback(
    (
      observationId: string,
      timestampMs: number,
      frameIndex: number,
    ) => {
      const candidate = messageObservationsRef.current.find(
        (observation) => observation.id === observationId,
      );

      if (!candidate || candidate.resolution === "pending") {
        return null;
      }

      const decision = decideObservationMerge({
        candidate,
        observations: messageObservationsRef.current,
        ocrMessages: ocrMessagesRef.current,
        events: battleEventsRef.current,
      });

      if (
        !decision.merge ||
        !decision.targetObservationId ||
        !decision.secondaryObservationId
      ) {
        return null;
      }

      const target = messageObservationsRef.current.find(
        (observation) =>
          observation.id === decision.targetObservationId,
      );
      const secondary = messageObservationsRef.current.find(
        (observation) =>
          observation.id === decision.secondaryObservationId,
      );

      if (!target || !secondary || target.id === secondary.id) {
        return null;
      }

      const merged = mergeMessageObservationPair(target, secondary);
      commitMessageObservations(
        messageObservationsRef.current.map((observation) =>
          observation.id === target.id
            ? merged.target
            : observation.id === secondary.id
              ? merged.secondary
              : observation,
        ),
      );

      if (merged.target.bestEvidenceRef) {
        observationEvidenceRefById.current.set(
          merged.target.id,
          merged.target.bestEvidenceRef,
        );
      }
      appendMessageWatchDiagnostic({
        stage: "messageWatchMerged",
        observationId: secondary.id,
        frameIndex,
        timestampMs,
        detail: `merged into ${target.id} / score ${decision.score.toFixed(
          2,
        )} / ${decision.reasons.join(",")}`,
      });
      addLog(
        `近接する同一メッセージ観測を統合しました: ${secondary.id} -> ${target.id}`,
      );

      return merged.target;
    },
    [
      addLog,
      appendMessageWatchDiagnostic,
      commitMessageObservations,
    ],
  );
  const getObservationPendingOcrJobCount = useCallback((observationId: string) => {
    const activeCount =
      activeOcrJobRef.current?.sample.observationId === observationId ? 1 : 0;
    const deferredCount = deferredOcrSamplesRef.current.some(
      (sample) => sample.observationId === observationId,
    )
      ? 1
      : 0;
    const scheduledCount = scheduledDeferredObservationIdsRef.current.has(observationId)
      ? 1
      : 0;
    const phaseWaitingCount = phaseWaitingOcrSamplesRef.current.some(
      (entry) => entry.sample.observationId === observationId,
    )
      ? 1
      : 0;

    return activeCount + deferredCount + scheduledCount + phaseWaitingCount;
  }, []);
  const settleObservationIfIdle = useCallback(
    (
      observationId: string,
      timestampMs: number,
      frameIndex: number,
      failureReason?: MessageObservationFailureReason,
    ) => {
      const settled = updateMessageObservationById(
        observationId,
        (observation) =>
          settleMessageObservationUnread(observation, {
            pendingOcrJobCount: getObservationPendingOcrJobCount(observationId),
            hasUsableOcrText: usableOcrTextObservationIdsRef.current.has(observationId),
            failureReason,
            unknownGateReason:
              unknownGateReasonByObservationIdRef.current.get(
                observationId,
              ) ?? null,
            strongVisualEvidence:
              isStrongVisualMessageObservation(observation),
          }),
        { timestampMs, frameIndex },
      );

      if (settled && settled.resolution !== "pending") {
        tryMergeObservation(observationId, timestampMs, frameIndex);
      }

      return settled;
    },
    [
      getObservationPendingOcrJobCount,
      tryMergeObservation,
      updateMessageObservationById,
    ],
  );
  const storeObservationCropEvidence = useCallback(
    (
      observationId: string,
      sample: FrameSample,
      presenceScore: number,
    ) => {
      const sourceFrameRef = createSourceFrameRef(sample.frameIndex, sample.timestampMs);
      const previousEvidenceRef = observationEvidenceRefById.current.get(observationId);

      if (previousEvidenceRef && previousEvidenceRef !== sourceFrameRef) {
        cropEvidenceBySourceRef.current.delete(previousEvidenceRef);
      }

      cropEvidenceBySourceRef.current.set(sourceFrameRef, {
        sourceFrameRef,
        rawDataUrl: sample.rawDataUrl,
        processedDataUrl: sample.processedDataUrl,
        cropWidth: sample.cropWidth,
        cropHeight: sample.cropHeight,
        capturedAt: sample.capturedAt,
      });
      observationEvidenceRefById.current.set(observationId, sourceFrameRef);
      const evictedEvidenceKeys = pruneOldestMapEntries(
        cropEvidenceBySourceRef.current,
        MAX_CROP_EVIDENCE,
      );

      if (evictedEvidenceKeys.length > 0) {
        const evictedEvidenceSet = new Set(evictedEvidenceKeys);
        for (const [storedObservationId, storedEvidenceRef] of
          observationEvidenceRefById.current) {
          if (evictedEvidenceSet.has(storedEvidenceRef)) {
            observationEvidenceRefById.current.delete(storedObservationId);
          }
        }
        commitMessageObservations(
          messageObservationsRef.current.map((observation) =>
            observation.bestEvidenceRef &&
            evictedEvidenceSet.has(observation.bestEvidenceRef)
              ? {
                  ...observation,
                  bestEvidenceRef: null,
                  bestFrameIndex: null,
                }
              : observation,
          ),
        );
      }
      updateMessageObservationById(observationId, (observation) => {
        if (!observation.bestEvidenceRef) {
          return {
            ...observation,
            bestFrameIndex: sample.frameIndex,
            bestEvidenceRef: sourceFrameRef,
            maxPresenceScore: Math.max(observation.maxPresenceScore, presenceScore),
          };
        }

        return updateMessageObservationBestEvidence(observation, {
          presenceScore,
          frameIndex: sample.frameIndex,
          evidenceRef: sourceFrameRef,
        });
      });

      return sourceFrameRef;
    },
    [commitMessageObservations, updateMessageObservationById],
  );
  const captureObservationPrioritySample = useCallback(
    (
      source: FrameSourceElement,
      transition: Extract<MessageWatcherTransition, { type: "opened" | "updated" }>,
      watcherSample: MessageWatcherSample,
    ) => {
      const captured = captureRoiFrame(
        source,
        roiRef.current,
        preprocessOptionsRef.current,
        upscaleFactorRef.current,
      );

      if (!captured) {
        updateMessageObservationById(transition.id, (observation) =>
          recordMessageObservationFailure(observation, "preprocess_rejected"),
        );
        return;
      }

      const timestampMs = watcherSample.timestampMs;
      const nextSample: FrameSample = {
        ...captured,
        id: `watch-${watcherSample.frameIndex}-${timestampMs}`,
        frameIndex: watcherSample.frameIndex,
        timestampMs,
        capturedAt: new Date().toLocaleTimeString("ja-JP", { hour12: false }),
        roi: roiRef.current,
        preprocess: preprocessOptionsRef.current,
        upscaleFactor: upscaleFactorRef.current,
        observationId: transition.id,
      };

      setFrameSamples((currentSamples) =>
        [nextSample, ...currentSamples].slice(0, MAX_FRAME_BUFFER),
      );
      storeObservationCropEvidence(
        transition.id,
        nextSample,
        watcherSample.analysis.presenceScore,
      );

      if (transition.type === "opened") {
        appendFrameSampleDiagnostic(
          nextSample,
          "sampled",
          "message watcher priority sample",
        );
        requestPhaseAwareOcrRef.current(nextSample, {
          persistentUiModelWarmedUp:
            watcherSample.analysis.persistentUiModelWarmedUp ?? false,
          commitScore: transition.commitScore,
          presenceScore: transition.maxPresenceScore,
          persistentUiOverlapRatio:
            transition.persistentUiOverlapRatio,
          dynamicForegroundRatio:
            transition.dynamicForegroundRatio,
          lineBandCount:
            watcherSample.analysis.lineBandCount ?? 0,
          componentCount:
            watcherSample.analysis.componentCount ?? 0,
          largestComponentRatio:
            watcherSample.analysis.largestComponentRatio ?? 1,
        });
      }
    },
    [
      appendFrameSampleDiagnostic,
      storeObservationCropEvidence,
      updateMessageObservationById,
    ],
  );
  const applyMessageWatcherTransitions = useCallback(
    (
      transitions: readonly MessageWatcherTransition[],
      sample: MessageWatcherSample,
      source: FrameSourceElement | null,
      analysis: MessageWatchRuntimeAnalysis | null,
    ) => {
      for (const transition of transitions) {
        if (transition.type === "candidate_started") {
          appendMessageWatchDiagnostic({
            stage: "messageWatchCandidateStarted",
            observationId: transition.id,
            frameIndex: transition.frameStart,
            timestampMs: transition.startedAtMs,
            detail: `candidate / score ${Math.round(
              transition.presenceScore * 100,
            )}%`,
            analysis,
          });
          continue;
        }

        if (transition.type === "candidate_suppressed") {
          appendMessageWatchDiagnostic({
            stage:
              transition.reason === "persistent_ui"
                ? "messageWatchPersistentUiSuppressed"
                : "messageWatchCandidateSuppressed",
            observationId: transition.id,
            frameIndex: transition.frameIndex,
            timestampMs: transition.timestampMs,
            detail: `${transition.reason} / ${transition.durationMs}ms / commit ${Math.round(
              transition.commitScore * 100,
            )}% / persistent ${Math.round(
              transition.persistentUiOverlapRatio * 100,
            )}% / dynamic ${Math.round(
              transition.dynamicForegroundRatio * 100,
            )}%`,
            analysis,
          });
          continue;
        }

        if (transition.type === "progressive_render_continued") {
          appendMessageWatchDiagnostic({
            stage: "messageWatchProgressiveRenderContinued",
            observationId: transition.id,
            frameIndex: transition.frameIndex,
            timestampMs: transition.timestampMs,
            detail: `fingerprint ${transition.comparison.fingerprintDistance.toFixed(
              2,
            )} / retained ${transition.comparison.retainedFromPrevious.toFixed(
              2,
            )}`,
            analysis,
          });
          continue;
        }

        if (transition.type === "opened") {
          const openedWhileOcrBusy = pendingOcrJobsRef.current > 0;
          const createdObservation = createMessageObservation({
            id: transition.id,
            battleId: LIVE_BATTLE_ID,
            openedAtMs: transition.openedAtMs,
            frameStart: transition.frameStart,
            visualFingerprint: transition.fingerprint,
            presenceScore: transition.maxPresenceScore,
            bestFrameIndex: transition.bestFrameIndex,
            openedWhileOcrBusy,
            commitScore: transition.commitScore,
            persistentUiOverlapRatio:
              transition.persistentUiOverlapRatio,
            dynamicForegroundRatio:
              transition.dynamicForegroundRatio,
            phaseAtCommit: phaseGateStateRef.current.phase,
          });
          const observation = openedWhileOcrBusy
            ? recordMessageObservationFailure(createdObservation, "ocr_busy")
            : createdObservation;
          commitMessageObservations([
            observation,
            ...messageObservationsRef.current.filter(
              (currentObservation) => currentObservation.id !== observation.id,
            ),
          ]);
          appendMessageWatchDiagnostic({
            stage: "messageWatchCandidateCommitted",
            observationId: transition.id,
            frameIndex: sample.frameIndex,
            timestampMs: sample.timestampMs,
            detail: `${transition.candidateDurationMs}ms / commit ${Math.round(
              transition.commitScore * 100,
            )}% / persistent ${Math.round(
              transition.persistentUiOverlapRatio * 100,
            )}% / dynamic ${Math.round(
              transition.dynamicForegroundRatio * 100,
            )}%`,
            analysis,
          });
          appendMessageWatchDiagnostic({
            stage: "messageWatchOpened",
            observationId: transition.id,
            frameIndex: sample.frameIndex,
            timestampMs: sample.timestampMs,
            detail: `opened / score ${Math.round(transition.maxPresenceScore * 100)}%${
              openedWhileOcrBusy ? " / OCR busy" : ""
            }`,
            analysis,
          });
          addLog(`バトルメッセージ表示を検出しました: ${transition.id}`);

          if (source) {
            captureObservationPrioritySample(source, transition, sample);
          }
          continue;
        }

        if (transition.type === "updated") {
          if (source) {
            captureObservationPrioritySample(source, transition, sample);
          }
          continue;
        }

        if (transition.reason === "fingerprint_changed") {
          appendMessageWatchDiagnostic({
            stage: "messageWatchChanged",
            observationId: transition.id,
            frameIndex: transition.frameEnd,
            timestampMs: transition.closedAtMs,
            detail: "different fingerprint stabilized",
            analysis,
          });
          appendMessageWatchDiagnostic({
            stage: "messageWatchSwitchConfirmed",
            observationId: transition.id,
            frameIndex: transition.frameEnd,
            timestampMs: transition.closedAtMs,
            detail: "different signature stable for switch",
            analysis,
          });
        }

        updateMessageObservationById(transition.id, (observation) =>
          closeMessageObservation(observation, {
            closedAtMs: transition.closedAtMs,
            frameEnd: transition.frameEnd,
          }),
        );
        appendMessageWatchDiagnostic({
          stage:
            transition.reason === "stale"
              ? "messageWatchStaleClosed"
              : "messageWatchClosed",
          observationId: transition.id,
          frameIndex: transition.frameEnd,
          timestampMs: transition.closedAtMs,
          detail: `closed / ${transition.reason}`,
          analysis,
        });
        addLog(`バトルメッセージ表示を終了しました: ${transition.id} (${transition.reason})`);
        settleObservationIfIdle(
          transition.id,
          transition.closedAtMs,
          transition.frameEnd,
        );
      }
    },
    [
      addLog,
      appendMessageWatchDiagnostic,
      captureObservationPrioritySample,
      commitMessageObservations,
      settleObservationIfIdle,
      updateMessageObservationById,
    ],
  );
  const closeMessageWatcher = useCallback(
    (
      reason: Extract<
        MessageWatcherCloseReason,
        "analysis_stopped" | "media_ended" | "stream_stopped"
      >,
    ) => {
      const timestampMs = Math.max(
        0,
        Math.round(performance.now() - samplingStartMsRef.current),
      );
      const frameIndex = messageWatchFrameIndexRef.current;
      const result = closeActiveMessageWatcher(messageWatcherStateRef.current, {
        timestampMs,
        frameIndex,
        reason,
      });
      messageWatcherStateRef.current = result.state;
      applyMessageWatcherTransitions(
        result.transitions,
        {
          timestampMs,
          frameIndex,
          analysis: {
            present: false,
            presenceScore: 0,
            fingerprint: null,
          },
        },
        null,
        null,
      );
      persistentUiModelStateRef.current =
        createInitialPersistentUiModelState();
    },
    [applyMessageWatcherTransitions],
  );
  const resetPhaseGateState = useCallback(() => {
    phaseGateStateRef.current = createInitialMessagePhaseGateState();
  }, []);
  const appendPhaseTransition = useCallback(
    (sample: FrameSample, stage: PhaseTransitionStage, detail: string) => {
      phaseTransitionCounterRef.current += 1;
      const transition: PhaseTransitionDiagnostic = {
        id: `phase_transition_${phaseTransitionCounterRef.current}`,
        frameIndex: sample.frameIndex,
        timestampMs: sample.timestampMs,
        stage,
        detail,
      };

      phaseTransitionsRef.current = [
        transition,
        ...phaseTransitionsRef.current,
      ].slice(0, MAX_PHASE_TRANSITIONS);
      phaseDetectionSummaryRef.current.transitionCounts[stage] += 1;
    },
    [],
  );
  const appendBattleHudDiagnostic = useCallback(
    (
      sample: FrameSample,
      stage: FrameSampleDiagnosticStage,
      observation: BattleHudObservation,
      detail: string | null,
    ) => {
      if (stage === "battleHudSampled") {
        recordPhaseSignalSummary(
          phaseDetectionSummaryRef.current,
          observation.roiLabel === "opponent" ? "opponentHud" : "playerHud",
          observation.signal,
        );
      } else if (stage === "battleHudRose" || stage === "battleHudFell") {
        appendPhaseTransition(sample, stage, detail ?? "");
      }

      appendSampleDiagnostic({
        frameIndex: sample.frameIndex,
        timestampMs: sample.timestampMs,
        stage,
        detail,
        preprocessVariantId: sample.preprocessVariantId,
        preprocessRejectReason: sample.preprocessVariantRejectReason,
        ocrVariantId: sample.ocrVariantId,
        ocrForegroundPixelRatio: sample.ocrForegroundPixelRatio,
        pendingOcrJobs: pendingOcrJobsRef.current,
        ocrJobId: null,
        ocrConfidence: null,
        lineCount: null,
        imageSignal: createBattleHudImageSignalDiagnostic(
          observation.roi,
          observation.roiLabel,
          observation.signal,
        ),
      });
    },
    [appendPhaseTransition, appendSampleDiagnostic],
  );
  const appendVsSplashDiagnostic = useCallback(
    (
      sample: FrameSample,
      stage: FrameSampleDiagnosticStage,
      observation: VsSplashObservation,
      detail: string | null,
    ) => {
      if (stage === "vsSampled") {
        recordPhaseSignalSummary(
          phaseDetectionSummaryRef.current,
          "vsSplash",
          observation.signal,
        );
      } else if (stage === "vsFell") {
        appendPhaseTransition(sample, stage, detail ?? "");
      }

      appendSampleDiagnostic({
        frameIndex: sample.frameIndex,
        timestampMs: sample.timestampMs,
        stage,
        detail,
        preprocessVariantId: sample.preprocessVariantId,
        preprocessRejectReason: sample.preprocessVariantRejectReason,
        ocrVariantId: sample.ocrVariantId,
        ocrForegroundPixelRatio: sample.ocrForegroundPixelRatio,
        pendingOcrJobs: pendingOcrJobsRef.current,
        ocrJobId: null,
        ocrConfidence: null,
        lineCount: null,
        imageSignal: createVsSplashImageSignalDiagnostic(observation.roi, observation.signal),
      });
    },
    [appendPhaseTransition, appendSampleDiagnostic],
  );
  const appendPhaseDiagnostic = useCallback(
    (
      sample: FrameSample,
      stage:
        | "messagePhaseOpened"
        | "messagePhaseClosed"
        | "messagePhaseExpired"
        | "skippedPhase",
      detail: string,
    ) => {
      if (
        stage === "messagePhaseOpened" ||
        stage === "messagePhaseClosed" ||
        stage === "messagePhaseExpired"
      ) {
        appendPhaseTransition(sample, stage, detail);
      }

      appendSampleDiagnostic({
        frameIndex: sample.frameIndex,
        timestampMs: sample.timestampMs,
        stage,
        detail,
        preprocessVariantId: sample.preprocessVariantId,
        preprocessRejectReason: sample.preprocessVariantRejectReason,
        ocrVariantId: sample.ocrVariantId,
        ocrForegroundPixelRatio: sample.ocrForegroundPixelRatio,
        pendingOcrJobs: pendingOcrJobsRef.current,
        ocrJobId: null,
        ocrConfidence: null,
        lineCount: null,
      });
    },
    [appendPhaseTransition, appendSampleDiagnostic],
  );
  const handlePhaseGateObservation = useCallback(
    (
      sample: FrameSample,
      hudObservation: HudPhaseObservation,
      vsObservation: VsSplashObservation | null,
    ) => {
      if (hudObservation.opponent) {
        const detail = `${hudObservation.opponent.signal.isVisible ? "visible" : "hidden"} / score ${formatSignalScore(
          hudObservation.opponent.signal,
        )}`;
        appendBattleHudDiagnostic(
          sample,
          "battleHudSampled",
          hudObservation.opponent,
          detail,
        );
      }

      if (hudObservation.player) {
        const detail = `${hudObservation.player.signal.isVisible ? "visible" : "hidden"} / score ${formatSignalScore(
          hudObservation.player.signal,
        )}`;
        appendBattleHudDiagnostic(
          sample,
          "battleHudSampled",
          hudObservation.player,
          detail,
        );
      }

      if (vsObservation) {
        const detail = `${vsObservation.signal.isVisible ? "visible" : "hidden"} / score ${formatSignalScore(
          vsObservation.signal,
        )}`;
        appendVsSplashDiagnostic(sample, "vsSampled", vsObservation, detail);
      }

      const result = advanceMessagePhaseGate(
        phaseGateStateRef.current,
        {
          timestampMs: sample.timestampMs,
          hudVisible: hudObservation.isVisible,
          vsVisible: vsObservation?.signal.isVisible ?? null,
          hasActiveObservation:
            messageWatcherStateRef.current.activeObservation !== null,
        },
      );
      phaseGateStateRef.current = result.state;

      for (const transition of result.transitions) {
        if (transition === "vs_fell" && vsObservation) {
          appendVsSplashDiagnostic(
            sample,
            "vsFell",
            vsObservation,
            `score ${formatSignalScore(vsObservation.signal)}`,
          );
          continue;
        }

        if (transition === "battle_hud_rose") {
          if (hudObservation.selected) {
            appendBattleHudDiagnostic(
              sample,
              "battleHudRose",
              hudObservation.selected,
              `score ${formatSignalScore(hudObservation.selected.signal)}`,
            );
          }
          continue;
        }

        if (transition === "battle_hud_fell") {
          if (hudObservation.selected) {
            appendBattleHudDiagnostic(
              sample,
              "battleHudFell",
              hudObservation.selected,
              `score ${formatSignalScore(hudObservation.selected.signal)}`,
            );
          }
          continue;
        }

        if (transition === "message_phase_opened") {
          const reason = result.transitions.includes("vs_fell")
            ? "VS消失"
            : "バトルHUD消失";
          appendPhaseDiagnostic(sample, "messagePhaseOpened", reason);
          addLog(`メッセージ候補フェーズを開始しました: ${reason}`);
          continue;
        }

        if (transition === "message_phase_closed") {
          appendPhaseDiagnostic(
            sample,
            "messagePhaseClosed",
            "バトルHUD出現",
          );
          addLog("メッセージ候補フェーズを終了しました: バトルHUD出現");
          continue;
        }

        appendPhaseDiagnostic(
          sample,
          "messagePhaseExpired",
          "candidate idle lease expired",
        );
        addLog(
          "メッセージ候補フェーズが無通信のまま失効したため、厳格fallbackへ戻しました。",
        );
      }

      if (result.transitions.some((transition) =>
        transition === "message_phase_opened"
      )) {
        flushPhaseWaitingOcrSamplesRef.current(sample.timestampMs);
      }

      return result.state.phase;
    },
    [
      addLog,
      appendBattleHudDiagnostic,
      appendPhaseDiagnostic,
      appendVsSplashDiagnostic,
    ],
  );

  useEffect(() => {
    latestHeaderMediaSettingsRef.current = {
      videoDeviceId: selectedVideoDeviceId,
      audioDeviceId: selectedAudioDeviceId,
      audioVolume,
      isAudioMuted,
    };
  }, [audioVolume, isAudioMuted, selectedAudioDeviceId, selectedVideoDeviceId]);

  const persistHeaderMediaSettings = useCallback((settings: Partial<HeaderMediaSettings>) => {
    const nextSettings = {
      ...latestHeaderMediaSettingsRef.current,
      ...settings,
    };

    latestHeaderMediaSettingsRef.current = nextSettings;
    saveStoredHeaderMediaSettings(nextSettings);
  }, []);

  const rememberBattleEventDictionaries = useCallback((event: BattleEvent) => {
    sessionRosterDictionaryRef.current = upsertObservedDictionaryEntry(
      sessionRosterDictionaryRef.current,
      "pokemon",
      event.actor.name,
      MAX_SESSION_ROSTER_DICTIONARY_ENTRIES,
    ) as DictionaryEntry[];
    sessionRosterDictionaryRef.current = upsertObservedDictionaryEntry(
      sessionRosterDictionaryRef.current,
      "pokemon",
      event.target?.name ?? null,
      MAX_SESSION_ROSTER_DICTIONARY_ENTRIES,
    ) as DictionaryEntry[];
    observedMoveDictionaryRef.current = upsertObservedDictionaryEntry(
      observedMoveDictionaryRef.current,
      "move",
      event.move,
      MAX_OBSERVED_MOVE_DICTIONARY_ENTRIES,
    ) as DictionaryEntry[];
  }, []);

  const rememberAcceptedEventRecord = useCallback((event: BattleEvent) => {
    const minTimestampMs = event.timestampMs - TIMELINE_DUPLICATE_WINDOW_MS;

    recentAcceptedEventRecordsRef.current = [
      createAcceptedEventRecord(event),
      ...recentAcceptedEventRecordsRef.current.filter(
        (record) => record.timestampMs >= minTimestampMs,
      ),
    ].slice(0, 16);
  }, []);

  const activeTemplateRules = useMemo<readonly BattleTemplateRule[]>(
    () => [
      ...STANDARD_TEMPLATE_RULES,
      ...(importedTemplateCollection?.rules ?? []),
    ],
    [importedTemplateCollection],
  );

  useEffect(() => {
    templateRulesRef.current = activeTemplateRules;
  }, [activeTemplateRules]);

  const setPendingOcrJobCount = useCallback((nextCount: number) => {
    const safeCount = Math.max(0, nextCount);
    pendingOcrJobsRef.current = safeCount;
    setPendingOcrJobs(safeCount);
  }, []);

  const clearActiveOcrJob = useCallback((jobId?: string) => {
    const activeJob = activeOcrJobRef.current;

    if (!activeJob || (jobId && activeJob.jobId !== jobId)) {
      return;
    }

    window.clearTimeout(activeJob.timeoutId);
    activeOcrJobRef.current = null;
  }, []);

  const appendOcrErrorLog = useCallback(
    (jobId: string, meta: OCRWorkerJobMeta | undefined, message: string) => {
      const errorEntry: OCRLogEntry = {
        id: jobId,
        frameIndex: meta?.frameIndex ?? 0,
        timestampMs: meta?.timestampMs ?? 0,
        rawText: "",
        normalizedText: "",
        matchText: "",
        confidence: null,
        lineCount: 0,
        status: "error",
        errorMessage: message,
      };

      if (meta) {
        appendSampleDiagnostic({
          frameIndex: meta.frameIndex,
          timestampMs: meta.timestampMs,
          stage: "error",
          detail: message,
          preprocessVariantId: null,
          preprocessRejectReason: null,
          ocrVariantId: null,
          ocrForegroundPixelRatio: null,
          pendingOcrJobs: pendingOcrJobsRef.current,
          ocrJobId: jobId,
          ocrConfidence: null,
          lineCount: null,
        });
      }

      setOcrLogs((currentLogs) => [errorEntry, ...currentLogs].slice(0, MAX_OCR_LOGS));
    },
    [appendSampleDiagnostic],
  );

  const resetOcrWorkerAfterFailure = useCallback(
    (message: string, activeJob?: ActiveOcrJob | null) => {
      clearActiveOcrJob(activeJob?.jobId);
      const worker = ocrWorkerRef.current;
      ocrWorkerRef.current = null;
      worker?.terminate();
      setPendingOcrJobCount(0);
      setOcrProgress(0);
      setOcrStatusLabel("OCR worker再起動待ち");
      addLog(message, "error");
    },
    [addLog, clearActiveOcrJob, setPendingOcrJobCount],
  );

  const preservePartialOcrResult = useCallback(
    (activeJob: ActiveOcrJob | null | undefined) => {
      const observationId = activeJob?.sample.observationId ?? null;

      if (
        !activeJob ||
        !observationId ||
        activeJob.evaluatedCandidates.length === 0
      ) {
        return false;
      }

      const selection = selectOcrCandidate(
        activeJob.evaluatedCandidates,
      );
      const selectedResult = selection.selected.result;
      const parseResult = selection.parseResult;

      if (!parseResult.normalizedText) {
        return false;
      }

      const partialMessageId = `${activeJob.jobId}-partial`;
      const timelineObservation = createTimelineObservation({
        id: partialMessageId,
        battleId: LIVE_BATTLE_ID,
        observationId,
        rawText: selectedResult.rawText,
        parseResult,
        ocrConfidence: selectedResult.confidence,
        lines: selectedResult.lines,
        frameIndex: activeJob.meta.frameIndex,
        timestampMs: activeJob.meta.timestampMs,
        roi: activeJob.meta.roi,
        afterEventId: lastAcceptedEventIdRef.current,
        recentConstrainedCandidates:
          recentConstrainedCandidateRecordsRef.current,
        recentAcceptedEvents:
          recentAcceptedEventRecordsRef.current,
        candidatePromotionWindowMs:
          TIMELINE_DUPLICATE_WINDOW_MS,
      });
      const suppressedDedupeIds = new Set(
        timelineObservation.dedupes
          .filter((dedupe) =>
            shouldSuppressTimelineObservation(
              recentTimelineDeduplicationRecordsRef.current,
              dedupe,
              TIMELINE_DUPLICATE_WINDOW_MS,
            ),
          )
          .map((dedupe) => dedupe.id),
      );
      const acceptedEvents = timelineObservation.events.filter(
        (event) => !suppressedDedupeIds.has(event.id),
      );
      const suppressUnknown =
        timelineObservation.unknown !== null &&
        suppressedDedupeIds.has(timelineObservation.unknown.id);
      const partialLog: OCRLogEntry = {
        id: partialMessageId,
        frameIndex: activeJob.meta.frameIndex,
        timestampMs: activeJob.meta.timestampMs,
        rawText: selectedResult.rawText,
        normalizedText: parseResult.normalizedText,
        matchText: parseResult.matchText,
        parseResult,
        confidence: selectedResult.confidence,
        lineCount: selectedResult.lines.length,
        status: "recognized",
      };
      const resolutionTimestampMs = Math.max(
        activeJob.meta.timestampMs,
        Math.round(performance.now() - samplingStartMsRef.current),
      );

      usableOcrTextObservationIdsRef.current.add(observationId);
      unknownGateReasonByObservationIdRef.current.set(
        observationId,
        suppressUnknown
          ? "duplicate"
          : timelineObservation.unknownGateDecision.reason,
      );
      commitOcrMessages([
        timelineObservation.ocrMessage,
        ...ocrMessagesRef.current,
      ]);
      setOcrLogs((currentLogs) =>
        [partialLog, ...currentLogs].slice(0, MAX_OCR_LOGS),
      );
      if (acceptedEvents.length > 0) {
        acceptedEvents.forEach((event) => {
          rememberBattleEventDictionaries(event);
          rememberAcceptedEventRecord(event);
        });
        lastAcceptedEventIdRef.current =
          acceptedEvents[acceptedEvents.length - 1].id;
        commitBattleEvents([
          ...acceptedEvents,
          ...battleEventsRef.current,
        ]);
      }
      if (timelineObservation.unknown && !suppressUnknown) {
        commitUnknownEvents([
          timelineObservation.unknown,
          ...unknownEventsRef.current,
        ]);
      }
      const updated = updateMessageObservationById(
        observationId,
        (observation) => {
          const withOcrMessage = attachMessageObservationOcrMessage(
            observation,
            partialMessageId,
          );

          if (acceptedEvents.length > 0) {
            return resolveMessageObservationWithEvents(
              withOcrMessage,
              {
                ocrMessageId: partialMessageId,
                eventIds: acceptedEvents.map((event) => event.id),
              },
            );
          }

          if (timelineObservation.unknown && !suppressUnknown) {
            return resolveMessageObservationAsOcrUnknown(
              withOcrMessage,
              {
                ocrMessageId: partialMessageId,
                unknownEventIds: [timelineObservation.unknown.id],
                unknownGateReason: "accepted",
              },
            );
          }

          return withOcrMessage;
        },
        {
          timestampMs: resolutionTimestampMs,
          frameIndex: activeJob.meta.frameIndex,
        },
      );
      if (updated && updated.resolution !== "pending") {
        tryMergeObservation(
          observationId,
          resolutionTimestampMs,
          activeJob.meta.frameIndex,
        );
      }
      if (timelineObservation.dedupes.length > 0) {
        recentTimelineDeduplicationRecordsRef.current =
          updateTimelineDeduplicationRecords(
            recentTimelineDeduplicationRecordsRef.current,
            timelineObservation.dedupes,
            activeJob.meta.timestampMs,
          );
      }
      addLog(
        acceptedEvents.length > 0
          ? "OCR fallbackの失敗前に取得できたeventを解決済みとして保持しました。"
          : timelineObservation.unknown && !suppressUnknown
            ? "OCR fallbackの失敗前に取得できたレビュー対象文字列を保持しました。"
            : "OCR fallbackの失敗前に取得できたraw文字列を詳細証拠として保持しました。",
        "warn",
      );
      return true;
    },
    [
      addLog,
      commitBattleEvents,
      commitOcrMessages,
      commitUnknownEvents,
      rememberAcceptedEventRecord,
      rememberBattleEventDictionaries,
      tryMergeObservation,
      updateMessageObservationById,
    ],
  );

  const queueNextDeferredOcrSample = useCallback(() => {
    const next = takeNextDeferredOcrSample(deferredOcrSamplesRef.current);
    const deferredSample = next.sample;

    deferredOcrSamplesRef.current = next.queue;

    if (!deferredSample) {
      return;
    }

    if (
      !isOcrEnabledRef.current ||
      phaseGateStateRef.current.phase === "ended"
    ) {
      if (deferredSample.observationId) {
        updateMessageObservationById(
          deferredSample.observationId,
          (observation) =>
            recordMessageObservationFailure(
              observation,
              "ocr_deferred_dropped",
            ),
        );
        settleObservationIfIdle(
          deferredSample.observationId,
          deferredSample.timestampMs,
          deferredSample.frameIndex,
          "ocr_deferred_dropped",
        );
      }
      return;
    }

    const deferredObservationId = deferredSample.observationId ?? null;

    if (deferredObservationId) {
      scheduledDeferredObservationIdsRef.current.add(deferredObservationId);
    }
    const timerId = window.setTimeout(() => {
      deferredOcrTimerIdsRef.current.delete(timerId);
      if (deferredObservationId) {
        scheduledDeferredObservationIdsRef.current.delete(deferredObservationId);
      }
      queueOcrRecognitionRef.current(deferredSample);
    }, 0);
    deferredOcrTimerIdsRef.current.add(timerId);
  }, [settleObservationIfIdle, updateMessageObservationById]);

  const postOcrCandidateAttempt = useCallback(
    (
      activeJob: ActiveOcrJob,
      candidateIndex: number,
      stage: "ocrQueued" | "ocrRetryQueued",
    ) => {
      const worker = ocrWorkerRef.current;
      const candidate = activeJob.candidates[candidateIndex];

      if (!worker || !candidate) {
        return false;
      }

      window.clearTimeout(activeJob.timeoutId);
      const timeoutId = window.setTimeout(() => {
        const currentJob = activeOcrJobRef.current;

        if (!currentJob || currentJob.jobId !== activeJob.jobId) {
          return;
        }

        appendOcrErrorLog(
          currentJob.jobId,
          currentJob.meta,
          `OCR candidate timed out after ${Math.round(OCR_JOB_TIMEOUT_MS / 1000)}s.`,
        );
        const preservedPartialResult = preservePartialOcrResult(currentJob);
        if (currentJob.sample.observationId && !preservedPartialResult) {
          updateMessageObservationById(
            currentJob.sample.observationId,
            (observation) =>
              recordMessageObservationFailure(observation, "ocr_timeout"),
          );
        }
        resetOcrWorkerAfterFailure(
          "OCR候補の応答が一定時間返らなかったため、workerを再起動できる状態に戻しました。",
          currentJob,
        );
        queueNextDeferredOcrSample();
        if (currentJob.sample.observationId) {
          settleObservationIfIdle(
            currentJob.sample.observationId,
            currentJob.meta.timestampMs + OCR_JOB_TIMEOUT_MS,
            currentJob.meta.frameIndex,
            "ocr_timeout",
          );
        }
      }, OCR_JOB_TIMEOUT_MS);

      activeJob.candidateIndex = candidateIndex;
      activeJob.timeoutId = timeoutId;
      activeOcrJobRef.current = activeJob;
      appendSampleDiagnostic({
        frameIndex: activeJob.sample.frameIndex,
        timestampMs: activeJob.sample.timestampMs,
        stage,
        detail: `${candidate.strategy} / ${candidate.variantId}`,
        preprocessVariantId: activeJob.sample.preprocessVariantId,
        preprocessRejectReason: activeJob.sample.preprocessVariantRejectReason,
        ocrVariantId: candidate.variantId,
        ocrForegroundPixelRatio: activeJob.sample.ocrForegroundPixelRatio,
        pendingOcrJobs: pendingOcrJobsRef.current,
        ocrJobId: activeJob.jobId,
        ocrConfidence: null,
        lineCount: null,
        ocrCandidateId: candidate.id,
        ocrCandidateCount: activeJob.candidates.length,
      });
      setOcrStatusLabel(stage === "ocrQueued" ? "認識リクエスト送信" : "OCR fallback実行中");
      worker.postMessage({
        type: "recognize",
        jobId: activeJob.jobId,
        candidate,
        meta: activeJob.meta,
        config: OCR_WORKER_CONFIG,
      } satisfies OCRWorkerRequest);

      return true;
    },
    [
      appendOcrErrorLog,
      appendSampleDiagnostic,
      preservePartialOcrResult,
      queueNextDeferredOcrSample,
      resetOcrWorkerAfterFailure,
      settleObservationIfIdle,
      updateMessageObservationById,
    ],
  );

  const handleOcrWorkerMessage = useCallback(
    (event: MessageEvent<OCRWorkerResponse>) => {
      const response = event.data;

      if (response.type === "progress") {
        setOcrProgress(response.progress);
        setOcrStatusLabel(`${response.status} ${formatProgress(response.progress)}`);
        return;
      }

      if (response.type === "result") {
        const activeJob = activeOcrJobRef.current;

        if (!activeJob || activeJob.jobId !== response.jobId) {
          return;
        }

        window.clearTimeout(activeJob.timeoutId);
        const candidateParseResult = parseBattleMessage({
          rawText: response.result.rawText,
          ocrConfidence: response.result.confidence,
          lines: response.result.lines.map((line) => line.text),
        }, undefined, {
          templateRules: templateRulesRef.current,
          sessionRosterDictionary: sessionRosterDictionaryRef.current,
          observedMoveDictionary: observedMoveDictionaryRef.current,
        });
        const evaluatedCandidate: EvaluatedOcrCandidate = {
          candidate: response.candidate,
          result: response.result,
          parseResult: candidateParseResult,
          durationMs: response.durationMs,
        };

        activeJob.evaluatedCandidates.push(evaluatedCandidate);
        const nextCandidateIndex = activeJob.candidateIndex + 1;
        const wantsRetry =
          shouldRetryOcrCandidate(evaluatedCandidate) &&
          nextCandidateIndex < activeJob.candidates.length;
        const retryPreempted =
          wantsRetry && shouldPreemptOcrRetry(deferredOcrSamplesRef.current);

        if (retryPreempted) {
          const detail = `${response.candidate.id} fallback skipped for ${deferredOcrSamplesRef.current.length} distinct queued message(s)`;
          appendSampleDiagnostic({
            frameIndex: response.meta.frameIndex,
            timestampMs: response.meta.timestampMs,
            stage: "ocrRetryPreempted",
            detail,
            preprocessVariantId: activeJob.sample.preprocessVariantId,
            preprocessRejectReason: activeJob.sample.preprocessVariantRejectReason,
            ocrVariantId: response.candidate.variantId,
            ocrForegroundPixelRatio: activeJob.sample.ocrForegroundPixelRatio,
            pendingOcrJobs: pendingOcrJobsRef.current,
            ocrJobId: response.jobId,
            ocrConfidence: response.result.confidence,
            lineCount: response.result.lines.length,
            ocrCandidateId: response.candidate.id,
            ocrCandidateCount: activeJob.candidates.length,
            ocrDurationMs: response.durationMs,
            selectionReason: "new-distinct-message-priority",
          });
          addLog("後続の異なるメッセージを優先し、OCR fallbackを打ち切りました。");
        } else if (wantsRetry) {
          addLog(
            `OCR fallbackを実行します: ${response.candidate.id} -> ${activeJob.candidates[nextCandidateIndex].id}`,
          );
          postOcrCandidateAttempt(activeJob, nextCandidateIndex, "ocrRetryQueued");
          return;
        }

        const selection = selectOcrCandidate(activeJob.evaluatedCandidates);
        const selectedResult = selection.selected.result;
        const parseResult = selection.parseResult;
        const recognitionCandidates: OCRRecognitionCandidateTrace[] = activeJob.evaluatedCandidates
          .slice(0, 3)
          .map((candidate) => {
            const assessment = selection.assessments.get(candidate.candidate.id);

            return {
              id: candidate.candidate.id,
              variantId: candidate.candidate.variantId,
              strategy: candidate.candidate.strategy,
              pageSegModes: [
                ...new Set(candidate.candidate.segments.map((segment) => segment.pageSegMode)),
              ],
              rawText: candidate.result.rawText,
              confidence: candidate.result.confidence,
              lineCount: candidate.result.lines.length,
              parseStatus: candidate.parseResult.status,
              eventSignatures: assessment?.eventSignatures ?? [],
              score: assessment?.score ?? 0,
              selected: candidate.candidate.id === selection.selected.candidate.id,
              selectionReason:
                candidate.candidate.id === selection.selected.candidate.id
                  ? selection.reason
                  : null,
              durationMs: candidate.durationMs,
            };
          });

        clearActiveOcrJob(response.jobId);
        setPendingOcrJobCount(pendingOcrJobsRef.current - 1);
        const normalizedText = parseResult.normalizedText;
        const hasText = normalizedText.length > 0;
        const nextEntry: OCRLogEntry = {
          id: response.jobId,
          frameIndex: response.meta.frameIndex,
          timestampMs: response.meta.timestampMs,
          rawText: selectedResult.rawText,
          normalizedText,
          matchText: parseResult.matchText,
          parseResult,
          confidence: selectedResult.confidence,
          lineCount: selectedResult.lines.length,
          status: hasText ? "recognized" : "empty",
        };
        appendSampleDiagnostic({
          frameIndex: response.meta.frameIndex,
          timestampMs: response.meta.timestampMs,
          stage: selection.conflict ? "ocrCandidateConflict" : "ocrCandidateSelected",
          detail: selection.reason,
          preprocessVariantId: activeJob.sample.preprocessVariantId,
          preprocessRejectReason: activeJob.sample.preprocessVariantRejectReason,
          ocrVariantId: selection.selected.candidate.variantId,
          ocrForegroundPixelRatio: activeJob.sample.ocrForegroundPixelRatio,
          pendingOcrJobs: pendingOcrJobsRef.current,
          ocrJobId: response.jobId,
          ocrConfidence: selectedResult.confidence,
          lineCount: selectedResult.lines.length,
          ocrCandidateId: selection.selected.candidate.id,
          ocrCandidateCount: activeJob.evaluatedCandidates.length,
          ocrDurationMs: activeJob.evaluatedCandidates.reduce(
            (total, candidate) => total + candidate.durationMs,
            0,
          ),
          selectionReason: selection.reason,
        });
        appendSampleDiagnostic({
          frameIndex: response.meta.frameIndex,
          timestampMs: response.meta.timestampMs,
          stage: hasText ? "recognized" : "empty",
          detail: hasText ? null : "OCR result was empty after normalization",
          preprocessVariantId: null,
          preprocessRejectReason: null,
          ocrVariantId: selection.selected.candidate.variantId,
          ocrForegroundPixelRatio: null,
          pendingOcrJobs: pendingOcrJobsRef.current,
          ocrJobId: response.jobId,
          ocrConfidence: selectedResult.confidence,
          lineCount: selectedResult.lines.length,
          ocrCandidateId: selection.selected.candidate.id,
          ocrCandidateCount: activeJob.evaluatedCandidates.length,
          selectionReason: selection.reason,
        });
        const observation = createTimelineObservation({
          id: response.jobId,
          battleId: LIVE_BATTLE_ID,
          observationId: response.meta.observationId ?? null,
          rawText: selectedResult.rawText,
          parseResult,
          ocrConfidence: selectedResult.confidence,
          lines: selectedResult.lines,
          frameIndex: response.meta.frameIndex,
          timestampMs: response.meta.timestampMs,
          roi: response.meta.roi,
          afterEventId: lastAcceptedEventIdRef.current,
          recentConstrainedCandidates: recentConstrainedCandidateRecordsRef.current,
          recentAcceptedEvents: recentAcceptedEventRecordsRef.current,
          candidatePromotionWindowMs: TIMELINE_DUPLICATE_WINDOW_MS,
          recognitionCandidates,
        });
        const constrainedCandidateRecord = createConstrainedCandidateRecord(
          parseResult,
          response.meta.timestampMs,
          response.meta.frameIndex,
        );
        const suppressedDedupeIds = new Set(
          observation.dedupes
            .filter((dedupe) =>
              shouldSuppressTimelineObservation(
                recentTimelineDeduplicationRecordsRef.current,
                dedupe,
                TIMELINE_DUPLICATE_WINDOW_MS,
              ),
            )
            .map((dedupe) => dedupe.id),
        );
        const acceptedEvents = observation.events.filter(
          (event) => !suppressedDedupeIds.has(event.id),
        );
        const suppressUnknown =
          observation.unknown !== null && suppressedDedupeIds.has(observation.unknown.id);
        const suppressedItemCount =
          observation.events.length -
          acceptedEvents.length +
          (suppressUnknown ? 1 : 0);

        if (constrainedCandidateRecord) {
          const minTimestampMs = response.meta.timestampMs - TIMELINE_DUPLICATE_WINDOW_MS;
          recentConstrainedCandidateRecordsRef.current = [
            constrainedCandidateRecord,
            ...recentConstrainedCandidateRecordsRef.current.filter(
              (record) => record.timestampMs >= minTimestampMs,
            ),
          ].slice(0, 12);
        }

        for (const event of observation.events) {
          rememberBattleEventDictionaries(event);
          rememberAcceptedEventRecord(event);
        }

        setOcrLogs((currentLogs) => [nextEntry, ...currentLogs].slice(0, MAX_OCR_LOGS));
        commitOcrMessages([
          observation.ocrMessage,
          ...ocrMessagesRef.current,
        ]);

        if (suppressedItemCount > 0) {
          setSuppressedTimelineCount((currentCount) => currentCount + suppressedItemCount);
        }

        if (acceptedEvents.length > 0) {
          lastAcceptedEventIdRef.current = acceptedEvents[acceptedEvents.length - 1].id;
          commitBattleEvents([
            ...acceptedEvents,
            ...battleEventsRef.current,
          ]);

          if (acceptedEvents.some((acceptedEvent) => acceptedEvent.type === "battle_end")) {
            phaseGateStateRef.current = endMessagePhase(
              phaseGateStateRef.current,
              response.meta.timestampMs,
            );
            dropPhaseWaitingOcrSamplesRef.current(
              "battle_ended",
              response.meta.timestampMs,
              response.meta.frameIndex,
            );
            const droppedObservationIds = new Set(
              deferredOcrSamplesRef.current
                .map((sample) => sample.observationId)
                .filter(
                  (observationId): observationId is string =>
                    Boolean(observationId),
                ),
            );
            scheduledDeferredObservationIdsRef.current.forEach((observationId) =>
              droppedObservationIds.add(observationId),
            );
            deferredOcrSamplesRef.current = [];
            deferredOcrTimerIdsRef.current.forEach((timerId) =>
              window.clearTimeout(timerId),
            );
            deferredOcrTimerIdsRef.current.clear();
            scheduledDeferredObservationIdsRef.current.clear();
            droppedObservationIds.forEach((observationId) => {
              updateMessageObservationById(observationId, (currentObservation) =>
                recordMessageObservationFailure(
                  currentObservation,
                  "ocr_deferred_dropped",
                ),
              );
              settleObservationIfIdle(
                observationId,
                response.meta.timestampMs,
                response.meta.frameIndex,
                "ocr_deferred_dropped",
              );
            });
            addLog("勝負終了イベントを検出したため、以降のOCR投入を抑制します。");
          }
        }

        if (observation.unknown && !suppressUnknown) {
          commitUnknownEvents([
            observation.unknown,
            ...unknownEventsRef.current,
          ]);
        }

        const messageObservationId = response.meta.observationId ?? null;

        if (messageObservationId) {
          const resolutionTimestampMs = Math.max(
            response.meta.timestampMs,
            Math.round(performance.now() - samplingStartMsRef.current),
          );

          if (hasText) {
            usableOcrTextObservationIdsRef.current.add(messageObservationId);
            unknownGateReasonByObservationIdRef.current.set(
              messageObservationId,
              suppressUnknown
                ? "duplicate"
                : observation.unknownGateDecision.reason,
            );
          }

          const updatedObservation = updateMessageObservationById(
            messageObservationId,
            (currentObservation) => {
              const withOcrMessage = attachMessageObservationOcrMessage(
                currentObservation,
                observation.ocrMessage.id,
              );

              if (acceptedEvents.length > 0) {
                return resolveMessageObservationWithEvents(withOcrMessage, {
                  ocrMessageId: observation.ocrMessage.id,
                  eventIds: acceptedEvents.map((event) => event.id),
                });
              }

              if (observation.unknown && !suppressUnknown) {
                return resolveMessageObservationAsOcrUnknown(withOcrMessage, {
                  ocrMessageId: observation.ocrMessage.id,
                  unknownEventIds: [observation.unknown.id],
                  unknownGateReason: "accepted",
                });
              }

              return hasText
                ? withOcrMessage
                : recordMessageObservationFailure(
                    withOcrMessage,
                    "ocr_empty",
                  );
            },
            {
              timestampMs: resolutionTimestampMs,
              frameIndex: response.meta.frameIndex,
            },
          );

          if (
            updatedObservation &&
            updatedObservation.resolution !== "pending"
          ) {
            tryMergeObservation(
              messageObservationId,
              resolutionTimestampMs,
              response.meta.frameIndex,
            );
          }
          settleObservationIfIdle(
            messageObservationId,
            resolutionTimestampMs,
            response.meta.frameIndex,
            hasText ? undefined : "ocr_empty",
          );
        }

        if (observation.dedupes.length > 0) {
          recentTimelineDeduplicationRecordsRef.current = updateTimelineDeduplicationRecords(
            recentTimelineDeduplicationRecordsRef.current,
            observation.dedupes,
            response.meta.timestampMs,
          );
        }

        setOcrProgress(0);
        setOcrStatusLabel(hasText ? "認識済み" : "空候補");
        if (selection.conflict) {
          addLog("OCR候補が異なるeventを示したため、unknownへ保留しました。", "warn");
        }
        queueNextDeferredOcrSample();
        return;
      }

      if (response.type === "error") {
        const failedActiveJob =
          activeOcrJobRef.current?.jobId === response.jobId
            ? activeOcrJobRef.current
            : null;
        const failedObservationId =
          failedActiveJob
            ? failedActiveJob.sample.observationId ?? null
            : response.meta?.observationId ?? null;
        const preservedPartialResult = preservePartialOcrResult(failedActiveJob);
        clearActiveOcrJob(response.jobId);
        setPendingOcrJobCount(pendingOcrJobsRef.current - 1);
        setOcrProgress(0);
        setOcrStatusLabel("OCR失敗");
        appendOcrErrorLog(response.jobId, response.meta, response.message);

        if (response.recoverable === false) {
          resetOcrWorkerAfterFailure(`OCR workerが停止しました: ${response.message}`);
        }

        if (failedObservationId && !preservedPartialResult) {
          updateMessageObservationById(failedObservationId, (observation) =>
            recordMessageObservationFailure(observation, "ocr_error"),
          );
        }
        addLog(`OCRに失敗しました: ${response.message}`, "error");
        queueNextDeferredOcrSample();
        if (failedObservationId) {
          settleObservationIfIdle(
            failedObservationId,
            response.meta?.timestampMs ?? 0,
            response.meta?.frameIndex ?? 0,
            "ocr_error",
          );
        }
        return;
      }

      if (response.type === "terminated") {
        clearActiveOcrJob();
        ocrWorkerRef.current?.terminate();
        ocrWorkerRef.current = null;
        setPendingOcrJobCount(0);
        setOcrProgress(0);
        setOcrStatusLabel("停止済み");
      }
    },
    [
      addLog,
      appendSampleDiagnostic,
      appendOcrErrorLog,
      clearActiveOcrJob,
      commitBattleEvents,
      commitOcrMessages,
      commitUnknownEvents,
      postOcrCandidateAttempt,
      preservePartialOcrResult,
      queueNextDeferredOcrSample,
      rememberAcceptedEventRecord,
      rememberBattleEventDictionaries,
      resetOcrWorkerAfterFailure,
      setPendingOcrJobCount,
      settleObservationIfIdle,
      tryMergeObservation,
      updateMessageObservationById,
    ],
  );

  const ensureOcrWorker = useCallback(() => {
    if (ocrWorkerRef.current) {
      return ocrWorkerRef.current;
    }

    const worker = new Worker(new URL("../workers/ocr.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = handleOcrWorkerMessage;
    worker.onerror = (event) => {
      const activeJob = activeOcrJobRef.current;
      const message = event.message || "OCR workerの起動または実行に失敗しました。";
      const observationId = activeJob?.sample.observationId ?? null;
      const preservedPartialResult = preservePartialOcrResult(activeJob);
      if (activeJob) {
        appendOcrErrorLog(activeJob.jobId, activeJob.meta, message);
      }
      if (observationId && !preservedPartialResult) {
        updateMessageObservationById(observationId, (observation) =>
          recordMessageObservationFailure(observation, "ocr_error"),
        );
      }
      resetOcrWorkerAfterFailure(`OCR workerの起動または実行に失敗しました: ${message}`, activeJob);
      queueNextDeferredOcrSample();
      if (observationId) {
        settleObservationIfIdle(
          observationId,
          Math.max(0, Math.round(performance.now() - samplingStartMsRef.current)),
          activeJob?.meta.frameIndex ?? messageWatchFrameIndexRef.current,
          "ocr_error",
        );
      }
    };
    worker.onmessageerror = () => {
      const activeJob = activeOcrJobRef.current;
      const message = "OCR workerからの応答を読み取れませんでした。";
      const observationId = activeJob?.sample.observationId ?? null;
      const preservedPartialResult = preservePartialOcrResult(activeJob);
      if (activeJob) {
        appendOcrErrorLog(activeJob.jobId, activeJob.meta, message);
      }
      if (observationId && !preservedPartialResult) {
        updateMessageObservationById(observationId, (observation) =>
          recordMessageObservationFailure(observation, "ocr_error"),
        );
      }
      resetOcrWorkerAfterFailure(message, activeJob);
      queueNextDeferredOcrSample();
      if (observationId) {
        settleObservationIfIdle(
          observationId,
          Math.max(0, Math.round(performance.now() - samplingStartMsRef.current)),
          activeJob?.meta.frameIndex ?? messageWatchFrameIndexRef.current,
          "ocr_error",
        );
      }
    };
    ocrWorkerRef.current = worker;

    return worker;
  }, [
    appendOcrErrorLog,
    handleOcrWorkerMessage,
    preservePartialOcrResult,
    queueNextDeferredOcrSample,
    resetOcrWorkerAfterFailure,
    settleObservationIfIdle,
    updateMessageObservationById,
  ]);

  const requestOcrWorkerShutdown = useCallback(() => {
    if (!ocrWorkerRef.current) {
      setOcrStatusLabel("停止済み");
      return;
    }

    const message: OCRWorkerRequest = {
      type: "terminate",
      jobId: `terminate-${Date.now()}`,
    };
    ocrWorkerRef.current.postMessage(message);
  }, []);

  const stopOcr = useCallback(
    (message?: string) => {
      const activeJob = activeOcrJobRef.current;
      const activeObservationId = activeJob?.sample.observationId ?? null;
      const preservedPartialResult = preservePartialOcrResult(activeJob);
      const droppedObservationIds = new Set(
        deferredOcrSamplesRef.current
          .map((sample) => sample.observationId)
          .filter((observationId): observationId is string => Boolean(observationId)),
      );
      scheduledDeferredObservationIdsRef.current.forEach((observationId) =>
        droppedObservationIds.add(observationId),
      );
      const timestampMs = Math.max(
        0,
        Math.round(performance.now() - samplingStartMsRef.current),
      );
      const frameIndex = messageWatchFrameIndexRef.current;

      dropPhaseWaitingOcrSamplesRef.current(
        "phase_rejected",
        timestampMs,
        frameIndex,
      );

      if (activeObservationId && !preservedPartialResult) {
        updateMessageObservationById(activeObservationId, (observation) =>
          recordMessageObservationFailure(observation, "ocr_error"),
        );
      }
      droppedObservationIds.forEach((observationId) => {
        updateMessageObservationById(observationId, (observation) =>
          recordMessageObservationFailure(observation, "ocr_deferred_dropped"),
        );
      });

      isOcrEnabledRef.current = false;
      setIsOcrEnabled(false);
      deferredOcrSamplesRef.current = [];
      deferredOcrTimerIdsRef.current.forEach((timerId) =>
        window.clearTimeout(timerId),
      );
      deferredOcrTimerIdsRef.current.clear();
      scheduledDeferredObservationIdsRef.current.clear();
      clearActiveOcrJob();
      setPendingOcrJobCount(0);
      setOcrProgress(0);
      setOcrStatusLabel("停止中");
      requestOcrWorkerShutdown();
      if (activeObservationId) {
        settleObservationIfIdle(
          activeObservationId,
          timestampMs,
          frameIndex,
          "ocr_error",
        );
      }
      droppedObservationIds.forEach((observationId) => {
        settleObservationIfIdle(
          observationId,
          timestampMs,
          frameIndex,
          "ocr_deferred_dropped",
        );
      });

      if (message) {
        addLog(message);
      }
    },
    [
      addLog,
      clearActiveOcrJob,
      preservePartialOcrResult,
      requestOcrWorkerShutdown,
      setPendingOcrJobCount,
      settleObservationIfIdle,
      updateMessageObservationById,
    ],
  );

  const queueOcrRecognition = useCallback(
    (sample: FrameSample) => {
      if (!isOcrEnabledRef.current) {
        return;
      }

      if (sample.preprocessVariantRejectReason) {
        if (sample.observationId) {
          updateMessageObservationById(sample.observationId, (observation) =>
            recordMessageObservationFailure(observation, "preprocess_rejected"),
          );
          settleObservationIfIdle(
            sample.observationId,
            sample.timestampMs,
            sample.frameIndex,
            "preprocess_rejected",
          );
        }
        appendFrameSampleDiagnostic(
          sample,
          "skippedPreprocess",
          sample.preprocessVariantRejectReason,
        );
        setOcrStatusLabel(
          `OCR skipped: preprocess ${sample.preprocessVariantRejectReason} gate (${sample.preprocessVariantId})`,
        );
        return;
      }

      if (
        sample.ocrForegroundPixelRatio < MIN_TEXT_PIXEL_RATIO ||
        sample.ocrForegroundPixelRatio > MAX_TEXT_PIXEL_RATIO
      ) {
        if (sample.observationId) {
          updateMessageObservationById(sample.observationId, (observation) =>
            recordMessageObservationFailure(observation, "density_rejected"),
          );
          settleObservationIfIdle(
            sample.observationId,
            sample.timestampMs,
            sample.frameIndex,
            "density_rejected",
          );
        }
        appendFrameSampleDiagnostic(
          sample,
          "skippedDensity",
          `text density ${formatTextDensity(sample.ocrForegroundPixelRatio)}`,
        );
        setOcrStatusLabel(
          `OCR skipped: text density gate (${formatTextDensity(sample.ocrForegroundPixelRatio)})`,
        );
        return;
      }

      if (sample.observationId) {
        const observation = messageObservationsRef.current.find(
          (candidate) => candidate.id === sample.observationId,
        );

        if (
          observation &&
          observation.ocrAttemptCount >= MAX_OCR_ATTEMPTS_PER_OBSERVATION
        ) {
          return;
        }
      }

      if (pendingOcrJobsRef.current >= MAX_PENDING_OCR_JOBS) {
        const enqueueResult = enqueueDeferredOcrSample(
          deferredOcrSamplesRef.current,
          sample,
          activeOcrJobRef.current?.sample ?? null,
          MAX_DEFERRED_OCR_SAMPLES,
        );
        deferredOcrSamplesRef.current = enqueueResult.queue;
        const detailByAction = {
          ignored_active_duplicate: "active message duplicate ignored while OCR is busy",
          replaced_deferred_duplicate: `queued duplicate replaced at slot ${(enqueueResult.replacedIndex ?? 0) + 1}`,
          queued_distinct: `distinct message queued ${enqueueResult.queue.length}/${MAX_DEFERRED_OCR_SAMPLES}`,
          dropped_queue_full: `distinct queue full ${enqueueResult.queue.length}/${MAX_DEFERRED_OCR_SAMPLES}`,
        } satisfies Record<typeof enqueueResult.action, string>;
        const stage =
          enqueueResult.action === "dropped_queue_full"
            ? "ocrDeferredDropped"
            : "ocrDeferred";
        appendFrameSampleDiagnostic(
          sample,
          stage,
          detailByAction[enqueueResult.action],
        );

        if (enqueueResult.action === "dropped_queue_full") {
          const droppedObservationId = enqueueResult.droppedSample?.observationId;

          if (droppedObservationId) {
            updateMessageObservationById(droppedObservationId, (observation) =>
              recordMessageObservationFailure(
                observation,
                "ocr_deferred_dropped",
              ),
            );
            settleObservationIfIdle(
              droppedObservationId,
              sample.timestampMs,
              sample.frameIndex,
              "ocr_deferred_dropped",
            );
          }
          addLog("OCR待機queueが満杯のため、新しいメッセージ候補を破棄しました。", "warn");
        }
        return;
      }

      ensureOcrWorker();
      const nextPendingCount = pendingOcrJobsRef.current + 1;
      const jobId = `ocr-${ocrJobCounterRef.current + 1}`;
      const sourceFrameRef = createSourceFrameRef(sample.frameIndex, sample.timestampMs);
      const meta: OCRWorkerJobMeta = {
        cropHeight: sample.cropHeight,
        cropWidth: sample.cropWidth,
        frameIndex: sample.frameIndex,
        observationId: sample.observationId ?? null,
        roi: sample.roi,
        timestampMs: sample.timestampMs,
      };
      ocrJobCounterRef.current += 1;
      const activeJob: ActiveOcrJob = {
        jobId,
        meta,
        sample,
        candidates: sample.ocrCandidates.slice(0, 3),
        candidateIndex: 0,
        evaluatedCandidates: [],
        timeoutId: 0,
      };
      activeOcrJobRef.current = activeJob;
      if (sample.observationId) {
        if (!observationEvidenceRefById.current.has(sample.observationId)) {
          const observation = messageObservationsRef.current.find(
            (candidate) => candidate.id === sample.observationId,
          );
          storeObservationCropEvidence(
            sample.observationId,
            sample,
            observation?.maxPresenceScore ?? 0,
          );
        }
        updateMessageObservationById(sample.observationId, (observation) =>
          recordMessageObservationOcrAttempt(observation),
        );
      } else {
        cropEvidenceBySourceRef.current.set(sourceFrameRef, {
          sourceFrameRef,
          rawDataUrl: sample.rawDataUrl,
          processedDataUrl: sample.processedDataUrl,
          cropWidth: sample.cropWidth,
          cropHeight: sample.cropHeight,
          capturedAt: sample.capturedAt,
        });
        pruneOldestMapEntries(cropEvidenceBySourceRef.current, MAX_CROP_EVIDENCE);
      }
      setPendingOcrJobCount(nextPendingCount);
      postOcrCandidateAttempt(activeJob, 0, "ocrQueued");
    },
    [
      addLog,
      appendFrameSampleDiagnostic,
      ensureOcrWorker,
      postOcrCandidateAttempt,
      setPendingOcrJobCount,
      settleObservationIfIdle,
      storeObservationCropEvidence,
      updateMessageObservationById,
    ],
  );

  useEffect(() => {
    queueOcrRecognitionRef.current = queueOcrRecognition;
  }, [queueOcrRecognition]);

  const appendPhaseAdmissionDiagnostic = useCallback(
    (
      sample: FrameSample,
      stage: Extract<
        FrameSampleDiagnosticStage,
        "ocrPhaseDeferred" | "ocrPhaseAdmitted" | "ocrPhaseRejected"
      >,
      detail: string,
    ) => {
      appendSampleDiagnostic({
        observationId: sample.observationId ?? null,
        frameIndex: sample.frameIndex,
        timestampMs: sample.timestampMs,
        stage,
        detail,
        preprocessVariantId: sample.preprocessVariantId,
        preprocessRejectReason: sample.preprocessVariantRejectReason,
        ocrVariantId: sample.ocrVariantId,
        ocrForegroundPixelRatio: sample.ocrForegroundPixelRatio,
        pendingOcrJobs: pendingOcrJobsRef.current,
        ocrJobId: null,
        ocrConfidence: null,
        lineCount: sample.lineBandCount,
      });
    },
    [appendSampleDiagnostic],
  );

  const requestPhaseAwareOcr = useCallback(
    (
      sample: FrameSample,
      evidence: PhaseAdmissionVisualEvidence,
      nowMs = sample.timestampMs,
    ) => {
      if (!isOcrEnabledRef.current || !sample.observationId) {
        return;
      }

      const observation = messageObservationsRef.current.find(
        (candidate) => candidate.id === sample.observationId,
      );

      if (!observation) {
        return;
      }

      if (
        observation.ocrAdmissionReason === "strong_visual_fallback" &&
        phaseGateStateRef.current.phase !== "message_candidate"
      ) {
        return;
      }

      const phaseState = phaseGateStateRef.current;
      const decision = decideMessagePhaseOcrAdmission({
        phase: phaseState.phase,
        nowMs,
        observationOpenedAtMs: observation.openedAtMs,
        messagePhaseClosedAtMs:
          phaseState.phase === "hud"
            ? phaseState.phaseChangedAtMs
            : null,
        ...evidence,
      });

      if (decision.action === "defer") {
        const existingIndex =
          phaseWaitingOcrSamplesRef.current.findIndex(
            (entry) =>
              entry.sample.observationId === sample.observationId,
          );

        if (existingIndex >= 0) {
          const nextEntries = [...phaseWaitingOcrSamplesRef.current];
          nextEntries[existingIndex] = { sample, evidence };
          phaseWaitingOcrSamplesRef.current = nextEntries;
          return;
        }

        if (
          phaseWaitingOcrSamplesRef.current.length >=
          MAX_PHASE_WAITING_OCR_SAMPLES
        ) {
          updateMessageObservationById(
            sample.observationId,
            (currentObservation) =>
              rejectMessageObservationOcrForPhase(
                currentObservation,
                "phase_rejected",
              ),
            { timestampMs: nowMs, frameIndex: sample.frameIndex },
          );
          phaseDetectionSummaryRef.current.ocrAdmissionCounts.rejected += 1;
          appendPhaseAdmissionDiagnostic(
            sample,
            "ocrPhaseRejected",
            `phase ${phaseState.phase} / phase wait queue full`,
          );
          settleObservationIfIdle(
            sample.observationId,
            nowMs,
            sample.frameIndex,
            "no_ocr_attempt",
          );
          return;
        }

        phaseWaitingOcrSamplesRef.current = [
          ...phaseWaitingOcrSamplesRef.current,
          { sample, evidence },
        ];
        updateMessageObservationById(
          sample.observationId,
          (currentObservation) =>
            suppressMessageObservation(
              currentObservation,
              "phase_gate",
            ),
          { timestampMs: nowMs, frameIndex: sample.frameIndex },
        );
        phaseDetectionSummaryRef.current.ocrAdmissionCounts.deferred += 1;
        appendPhaseAdmissionDiagnostic(
          sample,
          "ocrPhaseDeferred",
          `phase ${phaseState.phase} / retry ${decision.retryAtMs}ms`,
        );
        return;
      }

      phaseWaitingOcrSamplesRef.current =
        phaseWaitingOcrSamplesRef.current.filter(
          (entry) =>
            entry.sample.observationId !== sample.observationId,
        );

      if (decision.action === "reject") {
        const reason: Extract<
          MessageOcrAdmissionReason,
          "phase_rejected" | "battle_ended"
        > =
          decision.reason === "phase_ended"
            ? "battle_ended"
            : "phase_rejected";
        const alreadyRejected =
          observation.ocrAdmissionReason === reason;

        updateMessageObservationById(
          sample.observationId,
          (currentObservation) =>
            rejectMessageObservationOcrForPhase(
              currentObservation,
              reason,
            ),
          { timestampMs: nowMs, frameIndex: sample.frameIndex },
        );
        if (!alreadyRejected) {
          phaseDetectionSummaryRef.current.ocrAdmissionCounts.rejected += 1;
          appendPhaseAdmissionDiagnostic(
            sample,
            "ocrPhaseRejected",
            `phase ${phaseState.phase} / ${decision.reason} / commit ${evidence.commitScore.toFixed(
              2,
            )} / presence ${evidence.presenceScore.toFixed(2)}`,
          );
        }
        settleObservationIfIdle(
          sample.observationId,
          nowMs,
          sample.frameIndex,
          "no_ocr_attempt",
        );
        return;
      }

      const reason: Extract<
        MessageOcrAdmissionReason,
        | "phase_confirmed"
        | "phase_transition_grace"
        | "strong_visual_fallback"
      > =
        decision.reason === "message_candidate"
          ? "phase_confirmed"
          : decision.reason === "hud_trailing_grace"
            ? "phase_transition_grace"
            : "strong_visual_fallback";
      const firstAdmission =
        observation.ocrAdmissionReason !== reason;

      updateMessageObservationById(
        sample.observationId,
        (currentObservation) =>
          admitMessageObservationOcr(currentObservation, reason),
        { timestampMs: nowMs, frameIndex: sample.frameIndex },
      );
      if (phaseState.phase === "message_candidate") {
        phaseGateStateRef.current = recordMessagePhaseActivity(
          phaseState,
          nowMs,
        );
      }
      if (firstAdmission) {
        const countKey =
          reason === "phase_confirmed"
            ? "confirmed"
            : reason === "phase_transition_grace"
              ? "grace"
              : "fallback";
        phaseDetectionSummaryRef.current.ocrAdmissionCounts[countKey] += 1;
        appendPhaseAdmissionDiagnostic(
          sample,
          "ocrPhaseAdmitted",
          `phase ${phaseState.phase} / ${reason} / commit ${evidence.commitScore.toFixed(
            2,
          )} / presence ${evidence.presenceScore.toFixed(2)}`,
        );
      }
      queueOcrRecognitionRef.current(sample);
    },
    [
      appendPhaseAdmissionDiagnostic,
      settleObservationIfIdle,
      updateMessageObservationById,
    ],
  );

  const flushPhaseWaitingOcrSamples = useCallback(
    (nowMs: number) => {
      const waiting = [...phaseWaitingOcrSamplesRef.current];

      for (const entry of waiting) {
        requestPhaseAwareOcr(
          entry.sample,
          entry.evidence,
          nowMs,
        );
      }
    },
    [requestPhaseAwareOcr],
  );

  const dropPhaseWaitingOcrSamples = useCallback(
    (
      reason: "phase_rejected" | "battle_ended",
      timestampMs: number,
      frameIndex: number,
    ) => {
      const waiting = phaseWaitingOcrSamplesRef.current;
      phaseWaitingOcrSamplesRef.current = [];
      const byObservationId = new Map<string, FrameSample>();

      for (const entry of waiting) {
        if (entry.sample.observationId) {
          byObservationId.set(
            entry.sample.observationId,
            entry.sample,
          );
        }
      }

      for (const [observationId, sample] of byObservationId) {
        const observation = messageObservationsRef.current.find(
          (candidate) => candidate.id === observationId,
        );
        const alreadyRejected =
          observation?.ocrAdmissionReason === reason;
        updateMessageObservationById(
          observationId,
          (currentObservation) =>
            rejectMessageObservationOcrForPhase(
              currentObservation,
              reason,
            ),
          { timestampMs, frameIndex },
        );
        if (!alreadyRejected) {
          phaseDetectionSummaryRef.current.ocrAdmissionCounts.rejected += 1;
          appendPhaseAdmissionDiagnostic(
            sample,
            "ocrPhaseRejected",
            `phase wait cleared / ${reason}`,
          );
        }
        settleObservationIfIdle(
          observationId,
          timestampMs,
          frameIndex,
          "no_ocr_attempt",
        );
      }
    },
    [
      appendPhaseAdmissionDiagnostic,
      settleObservationIfIdle,
      updateMessageObservationById,
    ],
  );

  useEffect(() => {
    requestPhaseAwareOcrRef.current = requestPhaseAwareOcr;
    flushPhaseWaitingOcrSamplesRef.current =
      flushPhaseWaitingOcrSamples;
    dropPhaseWaitingOcrSamplesRef.current =
      dropPhaseWaitingOcrSamples;
  }, [
    dropPhaseWaitingOcrSamples,
    flushPhaseWaitingOcrSamples,
    requestPhaseAwareOcr,
  ]);

  useEffect(() => {
    roiRef.current = roi;
    persistentUiModelStateRef.current =
      createInitialPersistentUiModelState();
  }, [roi]);

  useEffect(() => {
    opponentHudRoiRef.current = opponentHudRoi;
  }, [opponentHudRoi]);

  useEffect(() => {
    playerHudRoiRef.current = playerHudRoi;
  }, [playerHudRoi]);

  useEffect(() => {
    vsRoiRef.current = vsRoi;
  }, [vsRoi]);

  useEffect(() => {
    saveStoredRoiSettings({
      roi,
      opponentHudRoi,
      playerHudRoi,
      vsRoi,
      isRoiVisible,
      isOpponentHudRoiVisible,
      isPlayerHudRoiVisible,
      isVsRoiVisible,
    });
  }, [
    isOpponentHudRoiVisible,
    isPlayerHudRoiVisible,
    isRoiVisible,
    isVsRoiVisible,
    opponentHudRoi,
    playerHudRoi,
    roi,
    vsRoi,
  ]);

  useEffect(() => {
    mediaModeRef.current = mediaMode;
  }, [mediaMode]);

  useEffect(() => {
    preprocessOptionsRef.current = preprocessOptions;
  }, [preprocessOptions]);

  useEffect(() => {
    upscaleFactorRef.current = upscaleFactor;
  }, [upscaleFactor]);

  useEffect(() => {
    if (!isIndexedDbSupported()) {
      return;
    }

    let isActive = true;

    loadLatestImportedTemplateCollection()
      .then((collection) => {
        if (!isActive || !collection) {
          return;
        }

        setImportedTemplateCollection(collection);
        setTemplateImportStatusLabel(
          `Template復元 ${collection.rules.length} rules`,
        );
        addLog(`Template importを復元しました: ${collection.rules.length} rules`);
      })
      .catch((error) => {
        if (!isActive) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Template importの復元に失敗しました。";
        setTemplateImportStatusLabel("Template復元失敗");
        addLog(message, "warn");
      });

    return () => {
      isActive = false;
    };
  }, [addLog]);

  useEffect(() => {
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";

    const resetInitialScrollPosition = () => {
      try {
        window.scrollTo(0, 0);
      } catch {
        // jsdom does not implement window.scrollTo; direct scrollTop resets still cover tests.
      }

      const scrollingElement = document.scrollingElement;

      if (scrollingElement) {
        scrollingElement.scrollTop = 0;
        scrollingElement.scrollLeft = 0;
      }

      document.documentElement.scrollTop = 0;
      document.documentElement.scrollLeft = 0;
      document.body.scrollTop = 0;
      document.body.scrollLeft = 0;

      if (previewColumnRef.current) {
        previewColumnRef.current.scrollTop = 0;
        previewColumnRef.current.scrollLeft = 0;
      }
    };

    resetInitialScrollPosition();

    const animationFrameId =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame(resetInitialScrollPosition)
        : null;
    const timeoutId = window.setTimeout(resetInitialScrollPosition, 80);

    return () => {
      if (animationFrameId !== null && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(animationFrameId);
      }

      window.clearTimeout(timeoutId);
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, []);

  const refreshDevices = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!navigator.mediaDevices?.enumerateDevices) {
        setVideoDevices([]);
        setAudioDevices([]);
        setHasEnumeratedDevices(true);
        setInputStatus("unsupported");
        addLog("このブラウザはデバイス一覧の取得に対応していません。", "error");
        return;
      }

      try {
        const mediaDevices = await navigator.mediaDevices.enumerateDevices();
        const nextVideoDevices = createDeviceOptions(mediaDevices, "videoinput");
        const nextAudioDevices = createDeviceOptions(mediaDevices, "audioinput");

        setVideoDevices(nextVideoDevices);
        setAudioDevices(nextAudioDevices);
        setHasEnumeratedDevices(true);
        setSelectedVideoDeviceId((currentDeviceId) => {
          if (nextVideoDevices.some((device) => device.deviceId === currentDeviceId)) {
            return currentDeviceId;
          }

          if (currentDeviceId) {
            return currentDeviceId;
          }

          return nextVideoDevices[0]?.deviceId ?? "";
        });
        setSelectedAudioDeviceId((currentDeviceId) => {
          if (currentDeviceId === NO_AUDIO_DEVICE_ID) {
            return currentDeviceId;
          }

          if (nextAudioDevices.some((device) => device.deviceId === currentDeviceId)) {
            return currentDeviceId;
          }

          return NO_AUDIO_DEVICE_ID;
        });

        if (!options?.silent) {
          addLog("入力デバイス一覧を更新しました。");
        }
      } catch {
        setHasEnumeratedDevices(true);
        setInputStatus("start-failed");
        addLog("入力デバイス一覧の取得に失敗しました。", "error");
      }
    },
    [addLog],
  );

  const stopTracks = useCallback((activeStream: MediaStream | null) => {
    activeStream?.getTracks().forEach((track) => {
      track.stop();
    });
  }, []);

  const stopAudioInput = useCallback(() => {
    if (audioSourceNodeRef.current) {
      audioSourceNodeRef.current.disconnect();
      audioSourceNodeRef.current = null;
    }

    stopTracks(audioInputStreamRef.current);
    audioInputStreamRef.current = null;
    setAudioReady(false);
  }, [stopTracks]);

  const clearObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const stopSampling = useCallback(
    (
      message?: string,
      reason: Extract<
        MessageWatcherCloseReason,
        "analysis_stopped" | "media_ended" | "stream_stopped"
      > = "analysis_stopped",
    ) => {
      if (samplingTimerRef.current !== null) {
        window.clearInterval(samplingTimerRef.current);
        samplingTimerRef.current = null;
      }
      if (messageWatchTimerRef.current !== null) {
        window.clearInterval(messageWatchTimerRef.current);
        messageWatchTimerRef.current = null;
      }

      closeMessageWatcher(reason);
      dropPhaseWaitingOcrSamplesRef.current(
        "phase_rejected",
        Math.max(
          0,
          Math.round(
            performance.now() - samplingStartMsRef.current,
          ),
        ),
        messageWatchFrameIndexRef.current,
      );
      setIsSampling(false);

      if (message) {
        addLog(message);
      }
    },
    [addLog, closeMessageWatcher],
  );

  const resetMedia = useCallback(() => {
    stopSampling(undefined, "stream_stopped");
    stopOcr();
    stopTracks(streamRef.current);
    streamRef.current = null;
    stopAudioInput();
    clearObjectUrl();
    setStream(null);
    mediaModeRef.current = "idle";
    setMediaMode("idle");
    setFilePreviewUrl(null);
    setFrameSamples([]);
    setInputStatus("stopped");
    setMetadata({ width: null, height: null, frameRate: null });

    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.removeAttribute("src");
    }
  }, [clearObjectUrl, stopAudioInput, stopOcr, stopSampling, stopTracks]);

  useEffect(() => {
    return () => {
      if (samplingTimerRef.current !== null) {
        window.clearInterval(samplingTimerRef.current);
      }
      if (messageWatchTimerRef.current !== null) {
        window.clearInterval(messageWatchTimerRef.current);
      }
      deferredOcrTimerIdsRef.current.forEach((timerId) =>
        window.clearTimeout(timerId),
      );
      deferredOcrTimerIdsRef.current.clear();
      phaseWaitingOcrSamplesRef.current = [];

      clearActiveOcrJob();
      stopTracks(streamRef.current);
      clearObjectUrl();
      ocrWorkerRef.current?.terminate();
    };
  }, [clearActiveOcrJob, clearObjectUrl, stopTracks]);

  useEffect(() => stopAudioInput, [stopAudioInput]);

  useEffect(() => {
    void refreshDevices({ silent: true });
  }, [refreshDevices]);

  useEffect(() => {
    if (!videoRef.current) {
      return;
    }

    videoRef.current.srcObject = stream;
  }, [stream]);

  const effectiveAudioVolume = isAudioMuted ? 0 : audioVolume;

  useEffect(() => {
    if (audioGainNodeRef.current) {
      audioGainNodeRef.current.gain.value = effectiveAudioVolume;
    }
  }, [effectiveAudioVolume]);

  const warmAudioOutput = useCallback(() => {
    const AudioContextClass = getAudioContextClass();

    if (!AudioContextClass) {
      return false;
    }

    let audioContext = audioContextRef.current;

    if (!audioContext) {
      audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;
    }

    if (!audioGainNodeRef.current) {
      audioGainNodeRef.current = audioContext.createGain();
      audioGainNodeRef.current.connect(audioContext.destination);
    }

    return true;
  }, []);

  const resumeAudioContext = useCallback(async () => {
    if (!audioContextRef.current) {
      return false;
    }

    if (audioContextRef.current.state === "running") {
      return true;
    }

    try {
      await audioContextRef.current.resume();
      return String(audioContextRef.current.state) === "running";
    } catch {
      return false;
    }
  }, []);

  const setupAudioPlayback = useCallback(
    async (audioStream: MediaStream) => {
      const audioTracks = audioStream.getAudioTracks();

      if (audioTracks.length === 0) {
        setAudioReady(false);
        return false;
      }

      if (!warmAudioOutput() || !audioContextRef.current || !audioGainNodeRef.current) {
        addLog("このブラウザでは音声再生APIが使えないため、映像のみで続行します。", "warn");
        setAudioReady(false);
        return false;
      }

      try {
        audioSourceNodeRef.current?.disconnect();
        audioSourceNodeRef.current = audioContextRef.current.createMediaStreamSource(
          new MediaStream(audioTracks),
        );
        audioGainNodeRef.current.gain.value = effectiveAudioVolume;
        audioSourceNodeRef.current.connect(audioGainNodeRef.current);
        const resumed = await resumeAudioContext();
        setAudioReady(resumed);

        if (!resumed) {
          addLog("音声再生はブラウザの自動再生制限で保留されました。開始ボタンを押し直してください。", "warn");
        }

        return resumed;
      } catch {
        addLog("音声再生の開始に失敗しました。", "error");
        setAudioReady(false);
        return false;
      }
    },
    [addLog, effectiveAudioVolume, resumeAudioContext, warmAudioOutput],
  );

  const requestSelectedAudioStream = useCallback(
    async (selectedDeviceId: string) => {
      try {
        return await navigator.mediaDevices.getUserMedia(buildAudioConstraints(selectedDeviceId));
      } catch (error) {
        const message =
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "音声入力へのアクセスが拒否されました。"
            : "選択した音声入力の開始に失敗しました。";
        addLog(message, "error");
        return null;
      }
    },
    [addLog],
  );

  const startCapture = useCallback(
    async (
      videoDeviceId = selectedVideoDeviceId || videoDevices[0]?.deviceId || "",
      audioDeviceId = selectedAudioDeviceId,
    ) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        addLog("このブラウザはカメラ入力に対応していません。", "error");
        setInputStatus("unsupported");
        return false;
      }

      if (videoDevices.length === 0) {
        addLog("映像デバイスが見つかりません。", "warn");
        return false;
      }

      const nextVideoDeviceId = videoDeviceId || videoDevices[0]?.deviceId || "";
      const nextAudioDeviceId = audioDeviceId || NO_AUDIO_DEVICE_ID;
      const hasSelectedVideoDevice = videoDevices.some(
        (device) => device.deviceId === nextVideoDeviceId,
      );

      if (!hasSelectedVideoDevice) {
        addLog("選択中の映像デバイスが見つかりません。", "warn");
        return false;
      }

      const selectedVideoLabel = getDeviceLabel(
        videoDevices,
        nextVideoDeviceId,
        "選択中の映像デバイス",
      );
      const selectedAudioLabel =
        nextAudioDeviceId === NO_AUDIO_DEVICE_ID
          ? "音声なし"
          : getDeviceLabel(audioDevices, nextAudioDeviceId, "選択中の音声デバイス");

      try {
        setSelectedVideoDeviceId(nextVideoDeviceId);
        setSelectedAudioDeviceId(nextAudioDeviceId);
        resetMedia();
        setInputStatus("starting");
        warmAudioOutput();
        const deviceStream = await requestPreferredVideoStream(nextVideoDeviceId);

        const [videoTrack] = deviceStream.getVideoTracks();
        videoTrack?.addEventListener(
          "ended",
          () => {
            stopSampling(undefined, "media_ended");
            stopOcr();
            streamRef.current = null;
            setStream(null);
            mediaModeRef.current = "idle";
            setMediaMode("idle");
            setInputStatus("stopped");
            addLog("入力デバイスの映像トラックが停止しました。");
          },
          { once: true },
        );

        if (videoRef.current) {
          videoRef.current.srcObject = deviceStream;
          videoRef.current.muted = true;
          await playVideoElement(videoRef.current);
        }

        streamRef.current = deviceStream;
        setStream(deviceStream);
        mediaModeRef.current = "device";
        setMediaMode("device");
        setInputStatus("active");
        setMetadata(
          videoRef.current
            ? getVideoMetadata(videoRef.current, deviceStream)
            : {
                width: getVideoTrackSettings(deviceStream).width ?? null,
                height: getVideoTrackSettings(deviceStream).height ?? null,
                frameRate: getTrackFrameRate(deviceStream),
              },
        );

        if (nextAudioDeviceId !== NO_AUDIO_DEVICE_ID) {
          const audioStream = await requestSelectedAudioStream(nextAudioDeviceId);

          if (audioStream) {
            audioInputStreamRef.current = audioStream;
            const nextAudioReady = await setupAudioPlayback(audioStream);

            if (!nextAudioReady) {
              stopAudioInput();
            }
          }
        }

        await refreshDevices({ silent: true });
        persistHeaderMediaSettings({
          videoDeviceId: nextVideoDeviceId,
          audioDeviceId: nextAudioDeviceId,
        });
        addLog(`入力を開始しました: ${selectedVideoLabel} / ${selectedAudioLabel}`);
        return true;
      } catch (error) {
        const nextInputStatus = getStartFailureStatus(error);
        const message = getStartFailureMessage(nextInputStatus);
        addLog(message, "error");
        setInputStatus(nextInputStatus);
        return false;
      }
    },
    [
      addLog,
      audioDevices,
      persistHeaderMediaSettings,
      refreshDevices,
      requestSelectedAudioStream,
      resetMedia,
      selectedAudioDeviceId,
      selectedVideoDeviceId,
      setupAudioPlayback,
      stopAudioInput,
      stopOcr,
      stopSampling,
      videoDevices,
      warmAudioOutput,
    ],
  );

  useEffect(() => {
    if (
      hasAttemptedSavedMediaAutoStartRef.current ||
      !initialHeaderMediaSettings?.videoDeviceId ||
      videoDevices.length === 0
    ) {
      return;
    }

    hasAttemptedSavedMediaAutoStartRef.current = true;

    if (mediaModeRef.current !== "idle") {
      return;
    }

    const savedVideoDeviceId = initialHeaderMediaSettings.videoDeviceId;
    const hasSavedVideoDevice = videoDevices.some(
      (device) => device.deviceId === savedVideoDeviceId,
    );

    if (!hasSavedVideoDevice) {
      addLog("保存済みの映像デバイスが見つかりません。現在の一覧から選択してください。", "warn");
      return;
    }

    const savedAudioDeviceId = initialHeaderMediaSettings.audioDeviceId || NO_AUDIO_DEVICE_ID;
    const nextAudioDeviceId =
      savedAudioDeviceId === NO_AUDIO_DEVICE_ID ||
      audioDevices.some((device) => device.deviceId === savedAudioDeviceId)
        ? savedAudioDeviceId
        : NO_AUDIO_DEVICE_ID;

    if (savedAudioDeviceId !== nextAudioDeviceId) {
      addLog("保存済みの音声デバイスが見つからないため、音声なしで自動開始します。", "warn");
    }

    void startCapture(savedVideoDeviceId, nextAudioDeviceId).then((started) => {
      if (started) {
        addLog("保存済みの入力構成で自動開始しました。");
      }
    });
  }, [addLog, audioDevices, initialHeaderMediaSettings, startCapture, videoDevices]);

  const handleVideoDeviceChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const nextVideoDeviceId = event.target.value;

      setSelectedVideoDeviceId(nextVideoDeviceId);

      if (nextVideoDeviceId || videoDevices.length > 0) {
        void startCapture(nextVideoDeviceId, selectedAudioDeviceId);
      }
    },
    [selectedAudioDeviceId, startCapture, videoDevices.length],
  );

  const handleAudioDeviceChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const nextAudioDeviceId = event.target.value;

      setSelectedAudioDeviceId(nextAudioDeviceId);

      if (selectedVideoDeviceId || videoDevices.length > 0) {
        void startCapture(
          selectedVideoDeviceId || videoDevices[0]?.deviceId || "",
          nextAudioDeviceId,
        );
      }
    },
    [selectedVideoDeviceId, startCapture, videoDevices],
  );

  const handleLoadedMetadata = useCallback(() => {
    if (!videoRef.current) {
      return;
    }

    setMetadata(getVideoMetadata(videoRef.current, mediaMode === "device" ? stream : null));
  }, [mediaMode, stream]);

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];

      if (!file) {
        return;
      }

      resetMedia();
      const objectUrl = URL.createObjectURL(file);
      objectUrlRef.current = objectUrl;
      setFilePreviewUrl(objectUrl);
      const nextMediaMode = file.type.startsWith("image/") ? "image-file" : "video-file";
      mediaModeRef.current = nextMediaMode;
      setMediaMode(nextMediaMode);
      setInputStatus("active");
      addLog(`ファイルを読み込みました: ${file.name}`);
      event.target.value = "";
    },
    [addLog, resetMedia],
  );

  const handleToggleAppFullscreen = useCallback(async () => {
    const shell = captureShellRef.current;

    if (!shell) {
      return;
    }

    try {
      if (document.fullscreenElement === shell) {
        await document.exitFullscreen();
        setIsWorkspaceFullscreen(false);
        addLog("全画面表示を解除しました。");
        return;
      }

      await shell.requestFullscreen();
      setIsWorkspaceFullscreen(true);
      addLog("ワークスペースを全画面表示しました。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Fullscreen APIの実行に失敗しました。";
      addLog(`全画面表示に失敗しました: ${message}`, "error");
      setIsWorkspaceFullscreen(document.fullscreenElement === shell);
    }
  }, [addLog]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsWorkspaceFullscreen(document.fullscreenElement === captureShellRef.current);
    };

    handleFullscreenChange();
    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const captureCurrentMessageWatchSample = useCallback(
    (options?: { logFailure?: boolean }) => {
      const currentMediaMode = mediaModeRef.current;
      const source =
        currentMediaMode === "image-file" ? imagePreviewRef.current : videoRef.current;

      if (currentMediaMode === "idle" || !source) {
        if (options?.logFailure) {
          addLog("表示監視する映像または画像がありません。", "warn");
        }
        return false;
      }

      const imageData = captureScaledRoiImageData(
        source,
        roiRef.current,
        MESSAGE_WATCH_MAX_WIDTH,
      );

      if (!imageData) {
        if (options?.logFailure) {
          addLog("フレーム寸法が未取得のため、メッセージ表示をまだ監視できません。", "warn");
        }
        return false;
      }

      messageWatchFrameIndexRef.current += 1;
      const timestampMs = Math.max(
        0,
        Math.round(performance.now() - samplingStartMsRef.current),
      );
      const presenceAnalysis = analyzeMessagePresence(imageData);
      const persistentUiResult = advancePersistentUiModel(
        persistentUiModelStateRef.current,
        presenceAnalysis.visualSignature,
      );
      persistentUiModelStateRef.current = persistentUiResult.state;
      const analysis: MessageWatchRuntimeAnalysis = {
        ...presenceAnalysis,
        persistentUiOverlapRatio:
          persistentUiResult.analysis.persistentUiOverlapRatio,
        dynamicForegroundRatio:
          persistentUiResult.analysis.dynamicForegroundRatio,
        persistentUiModelWarmedUp:
          persistentUiResult.analysis.isWarmedUp,
      };
      const sample: MessageWatcherSample = {
        timestampMs,
        frameIndex: messageWatchFrameIndexRef.current,
        analysis,
      };
      const nextObservationId = `msgobs_${String(
        messageObservationCounterRef.current + 1,
      ).padStart(6, "0")}`;
      const result = advanceMessageWatcher(
        messageWatcherStateRef.current,
        sample,
        nextObservationId,
      );

      if (
        result.transitions.some(
          (transition) => transition.type === "candidate_started",
        )
      ) {
        messageObservationCounterRef.current += 1;
      }
      messageWatcherStateRef.current = result.state;
      applyMessageWatcherTransitions(result.transitions, sample, source, analysis);
      flushPhaseWaitingOcrSamplesRef.current(timestampMs);
      return true;
    },
    [addLog, applyMessageWatcherTransitions],
  );

  const captureCurrentFrame = useCallback(
    (options?: { logFailure?: boolean }) => {
      const currentMediaMode = mediaModeRef.current;
      const source =
        currentMediaMode === "image-file" ? imagePreviewRef.current : videoRef.current;

      if (currentMediaMode === "idle" || !source) {
        if (options?.logFailure) {
          addLog("サンプリングする映像または画像がありません。", "warn");
        }

        return false;
      }

      const captured = captureRoiFrame(
        source,
        roiRef.current,
        preprocessOptionsRef.current,
        upscaleFactorRef.current,
      );

      if (!captured) {
        if (options?.logFailure) {
          addLog("フレーム寸法が未取得のため、ROI cropをまだ生成できません。", "warn");
        }

        return false;
      }

      const hudObservation = captureHudPhaseObservation(
        source,
        opponentHudRoiRef.current,
        playerHudRoiRef.current,
      );
      const vsObservation = captureVsSplashObservation(source, vsRoiRef.current);
      frameIndexRef.current += 1;
      const timestampMs = Math.max(0, Math.round(performance.now() - samplingStartMsRef.current));
      const nextSample: FrameSample = {
        ...captured,
        id: `${frameIndexRef.current}-${timestampMs}`,
        frameIndex: frameIndexRef.current,
        timestampMs,
        capturedAt: new Date().toLocaleTimeString("ja-JP", { hour12: false }),
        roi: roiRef.current,
        preprocess: preprocessOptionsRef.current,
        upscaleFactor: upscaleFactorRef.current,
        observationId:
          messageWatcherStateRef.current.activeObservation?.id ?? null,
      };

      setFrameSamples((currentSamples) =>
        [nextSample, ...currentSamples].slice(0, MAX_FRAME_BUFFER),
      );
      appendFrameSampleDiagnostic(nextSample, "sampled");
      const messagePhase = handlePhaseGateObservation(nextSample, hudObservation, vsObservation);

      if (nextSample.observationId) {
        const waitingEntry =
          phaseWaitingOcrSamplesRef.current.find(
            (entry) =>
              entry.sample.observationId === nextSample.observationId,
          );
        const observation = messageObservationsRef.current.find(
          (candidate) => candidate.id === nextSample.observationId,
        );
        requestPhaseAwareOcrRef.current(
          nextSample,
          waitingEntry?.evidence ?? {
            persistentUiModelWarmedUp: false,
            commitScore: observation?.commitScore ?? 0,
            presenceScore: observation?.maxPresenceScore ?? 0,
            persistentUiOverlapRatio:
              observation?.persistentUiOverlapRatio ?? 1,
            dynamicForegroundRatio:
              observation?.dynamicForegroundRatio ?? 0,
            lineBandCount: nextSample.lineBandCount,
            componentCount: 0,
            largestComponentRatio: 1,
          },
        );
      } else {
        appendFrameSampleDiagnostic(
          nextSample,
          "skippedPhase",
          `phase ${messagePhase} / message watcher has no active observation`,
        );
      }

      return true;
    },
    [addLog, appendFrameSampleDiagnostic, handlePhaseGateObservation],
  );

  const handleStartSampling = useCallback(() => {
    if (samplingTimerRef.current !== null) {
      return;
    }

    if (mediaModeRef.current === "idle") {
      addLog("サンプリングする映像または画像がありません。", "warn");
      return;
    }

    frameIndexRef.current = 0;
    resetPhaseGateState();
    samplingStartMsRef.current = performance.now();
    setFrameSamples([]);
    setIsSampling(true);
    messageWatchFrameIndexRef.current = 0;
    messageWatcherStateRef.current = createInitialMessageWatcherState();
    captureCurrentMessageWatchSample({ logFailure: true });
    messageWatchTimerRef.current = window.setInterval(
      () => captureCurrentMessageWatchSample(),
      Math.round(1000 / DEFAULT_MESSAGE_WATCH_FPS),
    );
    samplingTimerRef.current = window.setInterval(
      () => captureCurrentFrame(),
      Math.round(1000 / sampleFps),
    );
    addLog(
      `フレームサンプリングを開始しました (OCR ${sampleFps}fps / 表示監視 ${DEFAULT_MESSAGE_WATCH_FPS}fps)。`,
    );
  }, [
    addLog,
    captureCurrentFrame,
    captureCurrentMessageWatchSample,
    resetPhaseGateState,
    sampleFps,
  ]);

  const handleStopSampling = useCallback(() => {
    stopSampling("フレームサンプリングを停止しました。");
  }, [stopSampling]);

  const handleStartOcr = useCallback(() => {
    if (mediaModeRef.current === "idle") {
      addLog("OCRする映像または画像がありません。", "warn");
      return;
    }

    ensureOcrWorker();
    isOcrEnabledRef.current = true;
    setIsOcrEnabled(true);
    setOcrLogs([]);
    commitOcrMessages([]);
    setSampleDiagnostics([]);
    commitBattleEvents([]);
    commitUnknownEvents([]);
    commitMessageObservations([]);
    setReviewNotes({});
    setSuppressedTimelineCount(0);
    cropEvidenceBySourceRef.current.clear();
    observationEvidenceRefById.current.clear();
    usableOcrTextObservationIdsRef.current.clear();
    unknownGateReasonByObservationIdRef.current.clear();
    deferredOcrTimerIdsRef.current.forEach((timerId) =>
      window.clearTimeout(timerId),
    );
    deferredOcrTimerIdsRef.current.clear();
    scheduledDeferredObservationIdsRef.current.clear();
    messageObservationCounterRef.current = 0;
    messageWatchFrameIndexRef.current = 0;
    messageWatcherStateRef.current = createInitialMessageWatcherState();
    persistentUiModelStateRef.current =
      createInitialPersistentUiModelState();
    sampleDiagnosticCounterRef.current = 0;
    phaseTransitionCounterRef.current = 0;
    phaseDetectionSummaryRef.current = createEmptyPhaseDetectionSummary();
    phaseTransitionsRef.current = [];
    deferredOcrSamplesRef.current = [];
    phaseWaitingOcrSamplesRef.current = [];
    resetPhaseGateState();
    recentTimelineDeduplicationRecordsRef.current = [];
    recentConstrainedCandidateRecordsRef.current = [];
    recentAcceptedEventRecordsRef.current = [];
    sessionRosterDictionaryRef.current = [];
    observedMoveDictionaryRef.current = [];
    lastAcceptedEventIdRef.current = null;
    setOcrProgress(0);
    setOcrStatusLabel("OCR準備中");
    addLog("リアルタイムOCRログを開始しました。");

    if (samplingTimerRef.current === null) {
      handleStartSampling();
    }
  }, [
    addLog,
    commitBattleEvents,
    commitMessageObservations,
    commitOcrMessages,
    commitUnknownEvents,
    ensureOcrWorker,
    handleStartSampling,
    resetPhaseGateState,
  ]);

  const handleStopOcr = useCallback(() => {
    stopOcr("リアルタイムOCRログを停止しました。");
  }, [stopOcr]);

  const ensureMediaForProcessing = useCallback(async () => {
    if (mediaModeRef.current !== "idle") {
      return true;
    }

    return startCapture(
      selectedVideoDeviceId || videoDevices[0]?.deviceId || "",
      selectedAudioDeviceId,
    );
  }, [selectedAudioDeviceId, selectedVideoDeviceId, startCapture, videoDevices]);

  const handleToolbarStartAnalysis = useCallback(async () => {
    if (await ensureMediaForProcessing()) {
      handleStartOcr();
    }
  }, [ensureMediaForProcessing, handleStartOcr]);

  const handleToolbarStopAnalysis = useCallback(() => {
    const shouldStopOcr = isOcrEnabledRef.current || pendingOcrJobsRef.current > 0;
    const shouldStopSampling =
      samplingTimerRef.current !== null || messageWatchTimerRef.current !== null;

    if (shouldStopSampling) {
      stopSampling("フレームサンプリングを停止しました。");
    }
    if (shouldStopOcr) {
      stopOcr("リアルタイムOCRログを停止しました。");
    }
  }, [stopOcr, stopSampling]);

  const handleToggleAudioMuted = useCallback(() => {
    if (isAudioMuted || audioVolume === 0) {
      const nextAudioVolume = audioVolume === 0 ? DEFAULT_AUDIO_VOLUME : audioVolume;

      if (audioVolume === 0) {
        setAudioVolume(nextAudioVolume);
      }

      setIsAudioMuted(false);
      persistHeaderMediaSettings({
        audioVolume: nextAudioVolume,
        isAudioMuted: false,
      });
      return;
    }

    setIsAudioMuted(true);
    persistHeaderMediaSettings({ isAudioMuted: true });
  }, [audioVolume, isAudioMuted, persistHeaderMediaSettings]);

  const handleAudioVolumeChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextVolume = clamp(Number(event.target.value), 0, 1);
      const nextIsAudioMuted = nextVolume === 0;

      setAudioVolume(nextVolume);
      setIsAudioMuted(nextIsAudioMuted);
      persistHeaderMediaSettings({
        audioVolume: nextVolume,
        isAudioMuted: nextIsAudioMuted,
      });
    },
    [persistHeaderMediaSettings],
  );

  const handleResetRoi = useCallback(() => {
    setRoi(DEFAULT_ROI);
    addLog("ROIを初期位置へ戻しました。");
  }, [addLog]);

  const handleResetOpponentHudRoi = useCallback(() => {
    setOpponentHudRoi(DEFAULT_OPPONENT_HUD_ROI);
    addLog("相手バトルHUD ROIを初期位置へ戻しました。");
  }, [addLog]);

  const handleResetPlayerHudRoi = useCallback(() => {
    setPlayerHudRoi(DEFAULT_PLAYER_HUD_ROI);
    addLog("味方バトルHUD ROIを初期位置へ戻しました。");
  }, [addLog]);

  const handleResetVsRoi = useCallback(() => {
    setVsRoi(DEFAULT_VS_SPLASH_ROI);
    addLog("VS ROIを初期位置へ戻しました。");
  }, [addLog]);

  const handleRoiNumberChange = useCallback((field: RoiField, value: string) => {
    setRoi((currentRoi) => updateRoiField(currentRoi, field, Number(value)));
  }, []);

  const handleOpponentHudRoiNumberChange = useCallback((field: RoiField, value: string) => {
    setOpponentHudRoi((currentRoi) => updateRoiField(currentRoi, field, Number(value)));
  }, []);

  const handlePlayerHudRoiNumberChange = useCallback((field: RoiField, value: string) => {
    setPlayerHudRoi((currentRoi) => updateRoiField(currentRoi, field, Number(value)));
  }, []);

  const handleVsRoiNumberChange = useCallback((field: RoiField, value: string) => {
    setVsRoi((currentRoi) => updateRoiField(currentRoi, field, Number(value)));
  }, []);

  const inputBadge = useMemo(
    () =>
      getInputBadgeState({
        hasEnumeratedDevices,
        inputStatus,
        mediaMode,
        metadata,
        selectedVideoDeviceId,
        videoDevices,
      }),
    [hasEnumeratedDevices, inputStatus, mediaMode, metadata, selectedVideoDeviceId, videoDevices],
  );
  const isSelectedVideoDeviceMissing =
    hasEnumeratedDevices &&
    selectedVideoDeviceId.length > 0 &&
    videoDevices.length > 0 &&
    !videoDevices.some((device) => device.deviceId === selectedVideoDeviceId);

  const isVolumeEffectivelyMuted = isAudioMuted || audioVolume === 0;
  const volumePercent = Math.round(effectiveAudioVolume * 100);

  const activeVideoLabel = useMemo(() => {
    if (mediaMode === "video-file" || mediaMode === "image-file") {
      return "ファイルpreview";
    }

    return getDeviceLabel(videoDevices, selectedVideoDeviceId, "映像デバイス未選択");
  }, [mediaMode, selectedVideoDeviceId, videoDevices]);

  const activeAudioLabel = useMemo(() => {
    if (selectedAudioDeviceId === NO_AUDIO_DEVICE_ID) {
      return "音声なし";
    }

    const label = getDeviceLabel(audioDevices, selectedAudioDeviceId, "音声デバイス未選択");

    if (mediaMode !== "device") {
      return label;
    }

    return audioReady ? `${label} (再生中)` : `${label} (未再生)`;
  }, [audioDevices, audioReady, mediaMode, selectedAudioDeviceId]);

  const latestFrameSample = frameSamples[0] ?? null;
  const latestOcrLog = ocrLogs[0] ?? null;
  const displayedBattleEvents = useMemo(
    () => battleEvents.slice(0, MAX_RESOLVED_DISPLAY_ITEMS),
    [battleEvents],
  );
  const primaryLiveLogItems = useMemo(
    () =>
      selectPrimaryLiveLogItems({
        observations: messageObservations,
        events: battleEvents,
        limit: MAX_MESSAGE_OBSERVATION_DISPLAY_ITEMS,
      }),
    [battleEvents, messageObservations],
  );
  const displayedUnknownEvents = useMemo(
    () => unknownEvents.slice(0, MAX_UNKNOWN_DISPLAY_ITEMS),
    [unknownEvents],
  );
  const reviewedUnknownCount = useMemo(
    () => unknownEvents.filter((unknown) => unknown.reviewStatus === "reviewed").length,
    [unknownEvents],
  );
  const timelineItems = useMemo<TimelineItem[]>(
    () =>
      [
        ...battleEvents.map((event) => ({ kind: "event" as const, event })),
        ...unknownEvents.map((unknown) => ({ kind: "unknown" as const, unknown })),
      ]
        .sort(
          (left, right) =>
            getTimelineItemTimestamp(right) - getTimelineItemTimestamp(left) ||
            getTimelineItemId(right).localeCompare(getTimelineItemId(left)),
        )
        .slice(0, MAX_TIMELINE_ITEMS),
    [battleEvents, unknownEvents],
  );
  const ocrLogGroups = useMemo(
    () => groupOcrLogs(ocrLogs, OCR_RAW_GROUP_LIMIT),
    [ocrLogs],
  );
  const sampleDiagnosticCounts = useMemo(() => {
    const counts = Object.fromEntries(
      SAMPLE_DIAGNOSTIC_STAGES.map((stage) => [stage, 0]),
    ) as Record<FrameSampleDiagnosticStage, number>;

    for (const diagnostic of sampleDiagnostics) {
      if (!(diagnostic.stage in counts)) {
        counts[diagnostic.stage] = 0;
      }

      counts[diagnostic.stage] += 1;
    }

    return counts;
  }, [sampleDiagnostics]);
  const latestSampleDiagnostics = sampleDiagnostics.slice(0, 16);
  const battleStats = useMemo(
    () => summarizeBattleStats(battleEvents, unknownEvents),
    [battleEvents, unknownEvents],
  );
  const captureMainStyle = useMemo(
    () =>
      resolvedLogPanelWidth === null && managementPanelHeight === null
        ? undefined
        : ({
            ...(resolvedLogPanelWidth === null
              ? {}
              : { "--resolved-log-width": `${resolvedLogPanelWidth}px` }),
            ...(managementPanelHeight === null
              ? {}
              : { "--management-panel-height": `${managementPanelHeight}px` }),
          } as CSSProperties),
    [managementPanelHeight, resolvedLogPanelWidth],
  );
  const captureMainClassName = [
    "capture-main",
    activeManagementTab || managementPanelHeight !== null
      ? "capture-main--management-sized"
      : "",
    isResizingResolvedLogPanel ? "capture-main--resizing" : "",
    isResizingManagementPanel ? "capture-main--resizing-management" : "",
    activeManagementTab && isManagementPanelMaximized
      ? "capture-main--management-maximized"
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const resolvedLogPanelWidthValue =
    resolvedLogPanelWidth ?? DEFAULT_RESOLVED_LOG_PANEL_WIDTH;
  const managementPanelHeightValue =
    managementPanelHeight ??
    (activeManagementTab ? DEFAULT_MANAGEMENT_PANEL_HEIGHT : DEFAULT_MANAGEMENT_TABBAR_HEIGHT);
  const updateResolvedLogPanelWidth = useCallback((width: number, containerWidth?: number | null) => {
    const nextContainerWidth =
      containerWidth === undefined
        ? (captureMainRef.current?.getBoundingClientRect().width ?? null)
        : containerWidth;
    setResolvedLogPanelWidth(clampResolvedLogPanelWidth(width, nextContainerWidth));
  }, []);
  const updateManagementPanelHeight = useCallback(
    (height: number, containerHeight?: number | null) => {
      const nextContainerHeight =
        containerHeight === undefined
          ? (captureMainRef.current?.getBoundingClientRect().height ?? null)
          : containerHeight;
      const bounds = getManagementPanelHeightBounds(nextContainerHeight);
      const nextHeight = Math.round(clamp(height, bounds.minHeight, bounds.maxHeight));
      setManagementPanelHeight(nextHeight);
      setIsManagementPanelMaximized(nextHeight >= bounds.maxHeight);
    },
    [],
  );
  const beginResolvedLogResize = useCallback(
    (clientX: number) => {
      const containerRect = captureMainRef.current?.getBoundingClientRect();
      const logPanelRect = resolvedLogPanelRef.current?.getBoundingClientRect();
      resolvedLogResizeSessionRef.current = {
        startX: clientX,
        startWidth:
          resolvedLogPanelWidth ??
          getPositiveSizeOrNull(logPanelRect?.width) ??
          DEFAULT_RESOLVED_LOG_PANEL_WIDTH,
        containerWidth: getPositiveSizeOrNull(containerRect?.width),
      };
      setIsResizingResolvedLogPanel(true);
    },
    [resolvedLogPanelWidth],
  );
  const beginManagementPanelResize = useCallback(
    (clientY: number) => {
      const containerRect = captureMainRef.current?.getBoundingClientRect();
      const panelRect = managementPanelRef.current?.getBoundingClientRect();
      managementPanelResizeSessionRef.current = {
        startY: clientY,
        startHeight:
          managementPanelHeight ??
          getPositiveSizeOrNull(panelRect?.height) ??
          DEFAULT_MANAGEMENT_PANEL_HEIGHT,
        containerHeight: getPositiveSizeOrNull(containerRect?.height),
      };
      setIsResizingManagementPanel(true);
    },
    [managementPanelHeight],
  );
  const handleResolvedLogResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      beginResolvedLogResize(event.clientX);
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [beginResolvedLogResize],
  );
  const handleResolvedLogResizeMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.button !== 0 || resolvedLogResizeSessionRef.current) {
        return;
      }

      beginResolvedLogResize(event.clientX);
      event.preventDefault();
    },
    [beginResolvedLogResize],
  );
  const handleManagementPanelResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      beginManagementPanelResize(event.clientY);
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [beginManagementPanelResize],
  );
  const handleManagementPanelResizeMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.button !== 0 || managementPanelResizeSessionRef.current) {
        return;
      }

      beginManagementPanelResize(event.clientY);
      event.preventDefault();
    },
    [beginManagementPanelResize],
  );
  const handleResolvedLogResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const resizeSession = resolvedLogResizeSessionRef.current;

      if (!resizeSession) {
        return;
      }

      const nextWidth = resizeSession.startWidth - (event.clientX - resizeSession.startX);
      updateResolvedLogPanelWidth(nextWidth, resizeSession.containerWidth);
      event.preventDefault();
    },
    [updateResolvedLogPanelWidth],
  );
  const handleManagementPanelResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const resizeSession = managementPanelResizeSessionRef.current;

      if (!resizeSession) {
        return;
      }

      const nextHeight = resizeSession.startHeight - (event.clientY - resizeSession.startY);
      updateManagementPanelHeight(nextHeight, resizeSession.containerHeight);
      event.preventDefault();
    },
    [updateManagementPanelHeight],
  );
  const finishResolvedLogResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    resolvedLogResizeSessionRef.current = null;
    setIsResizingResolvedLogPanel(false);
  }, []);
  const finishManagementPanelResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    managementPanelResizeSessionRef.current = null;
    setIsResizingManagementPanel(false);
  }, []);
  useEffect(() => {
    if (!isResizingResolvedLogPanel) {
      return;
    }

    const handleWindowMouseMove = (event: MouseEvent) => {
      const resizeSession = resolvedLogResizeSessionRef.current;

      if (!resizeSession) {
        return;
      }

      const nextWidth = resizeSession.startWidth - (event.clientX - resizeSession.startX);
      updateResolvedLogPanelWidth(nextWidth, resizeSession.containerWidth);
    };
    const handleWindowMouseUp = () => {
      resolvedLogResizeSessionRef.current = null;
      setIsResizingResolvedLogPanel(false);
    };

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, [isResizingResolvedLogPanel, updateResolvedLogPanelWidth]);
  useEffect(() => {
    if (!isResizingManagementPanel) {
      return;
    }

    const handleWindowMouseMove = (event: MouseEvent) => {
      const resizeSession = managementPanelResizeSessionRef.current;

      if (!resizeSession) {
        return;
      }

      const nextHeight = resizeSession.startHeight - (event.clientY - resizeSession.startY);
      updateManagementPanelHeight(nextHeight, resizeSession.containerHeight);
    };
    const handleWindowMouseUp = () => {
      managementPanelResizeSessionRef.current = null;
      setIsResizingManagementPanel(false);
    };

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, [isResizingManagementPanel, updateManagementPanelHeight]);
  const handleResolvedLogResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const containerWidth = getPositiveSizeOrNull(
        captureMainRef.current?.getBoundingClientRect().width,
      );
      const currentWidth =
        resolvedLogPanelWidth ??
        getPositiveSizeOrNull(resolvedLogPanelRef.current?.getBoundingClientRect().width) ??
        DEFAULT_RESOLVED_LOG_PANEL_WIDTH;
      const step = event.shiftKey ? RESOLVED_LOG_RESIZE_STEP * 2 : RESOLVED_LOG_RESIZE_STEP;
      const bounds = getResolvedLogPanelWidthBounds(containerWidth);
      let nextWidth: number | null = null;

      if (event.key === "ArrowLeft") {
        nextWidth = currentWidth + step;
      } else if (event.key === "ArrowRight") {
        nextWidth = currentWidth - step;
      } else if (event.key === "Home") {
        nextWidth = bounds.minWidth;
      } else if (event.key === "End") {
        nextWidth = bounds.maxWidth;
      }

      if (nextWidth === null) {
        return;
      }

      updateResolvedLogPanelWidth(nextWidth, containerWidth);
      event.preventDefault();
    },
    [resolvedLogPanelWidth, updateResolvedLogPanelWidth],
  );
  const handleManagementPanelResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const containerHeight = getPositiveSizeOrNull(
        captureMainRef.current?.getBoundingClientRect().height,
      );
      const currentHeight =
        managementPanelHeight ??
        getPositiveSizeOrNull(managementPanelRef.current?.getBoundingClientRect().height) ??
        DEFAULT_MANAGEMENT_PANEL_HEIGHT;
      const step = event.shiftKey ? RESOLVED_LOG_RESIZE_STEP * 2 : RESOLVED_LOG_RESIZE_STEP;
      const bounds = getManagementPanelHeightBounds(containerHeight);
      let nextHeight: number | null = null;

      if (event.key === "ArrowUp") {
        nextHeight = currentHeight + step;
      } else if (event.key === "ArrowDown") {
        nextHeight = currentHeight - step;
      } else if (event.key === "Home") {
        nextHeight = bounds.minHeight;
      } else if (event.key === "End") {
        nextHeight = bounds.maxHeight;
      }

      if (nextHeight === null) {
        return;
      }

      updateManagementPanelHeight(nextHeight, containerHeight);
      event.preventDefault();
    },
    [managementPanelHeight, updateManagementPanelHeight],
  );
  const handleManagementTabClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, tab: ManagementTab) => {
      event.preventDefault();
      if (activeManagementTab === tab) {
        setActiveManagementTab(null);
        setManagementPanelHeight(null);
        setIsManagementPanelMaximized(false);
        return;
      }

      setActiveManagementTab(tab);
    },
    [activeManagementTab],
  );

  const buildCurrentBattleLogDocument = useCallback(() => {
    const sourceKind: BattleLogMediaMetadata["sourceKind"] =
      mediaMode === "idle" ? "none" : mediaMode;
    const frameEvidence: BattleLogFrameEvidence[] = Array.from(
      cropEvidenceBySourceRef.current.values(),
    ).map((evidence, index) => ({
      id: `frame_${index + 1}`,
      battleId: LIVE_BATTLE_ID,
      sourceFrameRef: evidence.sourceFrameRef,
      rawDataUrl: evidence.rawDataUrl,
      processedDataUrl: evidence.processedDataUrl,
      cropWidth: evidence.cropWidth,
      cropHeight: evidence.cropHeight,
      capturedAt: evidence.capturedAt,
    }));

    return createBattleLogDocument({
      battleId: LIVE_BATTLE_ID,
      title: LIVE_BATTLE_TITLE,
      startedAt: null,
      media: {
        sourceKind,
        videoLabel: activeVideoLabel,
        audioLabel: activeAudioLabel,
        width: metadata.width,
        height: metadata.height,
        frameRate: metadata.frameRate,
      },
      roi,
      roiName: "Battle message ROI",
      opponentHudRoi,
      opponentHudRoiName: "Opponent battle HUD ROI",
      playerHudRoi,
      playerHudRoiName: "Player battle HUD ROI",
      vsRoi,
      vsRoiName: "VS splash ROI",
      ocrMessages,
      events: battleEvents,
      unknowns: unknownEvents,
      messageObservations,
      frameEvidence,
      sampleDiagnostics,
      phaseDetectionSummary: phaseDetectionSummaryRef.current,
      phaseTransitions: phaseTransitionsRef.current,
      reviewNotes,
    });
  }, [
    activeAudioLabel,
    activeVideoLabel,
    battleEvents,
    mediaMode,
    metadata.frameRate,
    metadata.height,
    metadata.width,
    messageObservations,
    ocrMessages,
    opponentHudRoi,
    playerHudRoi,
    reviewNotes,
    roi,
    sampleDiagnostics,
    unknownEvents,
    vsRoi,
  ]);

  const restoreBattleLogDocument = useCallback(
    (document: BattleLogDocument) => {
      const restoredEvents = sortNewestFirst(document.events);
      const restoredOcrMessages = sortNewestFirst(document.ocrMessages).slice(
        0,
        MAX_OCR_HISTORY,
      );
      const restoredMessageObservations = [...document.messageObservations]
        .sort(
          (left, right) =>
            right.openedAtMs - left.openedAtMs || right.id.localeCompare(left.id),
        )
        .slice(0, MAX_MESSAGE_OBSERVATION_HISTORY);
      const restoredFrameEvidence = document.frameEvidence.slice(-MAX_CROP_EVIDENCE);

      cropEvidenceBySourceRef.current = new Map(
        restoredFrameEvidence.map((evidence) => [
          evidence.sourceFrameRef,
          {
            sourceFrameRef: evidence.sourceFrameRef,
            rawDataUrl: evidence.rawDataUrl,
            processedDataUrl: evidence.processedDataUrl,
            cropWidth: evidence.cropWidth,
            cropHeight: evidence.cropHeight,
            capturedAt: evidence.capturedAt,
          },
        ]),
      );
      observationEvidenceRefById.current = new Map(
        restoredMessageObservations
          .filter(
            (
              observation,
            ): observation is MessageObservation & { bestEvidenceRef: string } =>
              Boolean(
                observation.bestEvidenceRef &&
                  cropEvidenceBySourceRef.current.has(observation.bestEvidenceRef),
              ),
          )
          .map((observation) => [observation.id, observation.bestEvidenceRef]),
      );
      usableOcrTextObservationIdsRef.current = new Set(
        restoredOcrMessages
          .filter(
            (message) =>
              Boolean(message.observationId) &&
              message.normalizedText.trim().length > 0,
          )
          .map((message) => message.observationId as string),
      );
      unknownGateReasonByObservationIdRef.current.clear();
      messageWatcherStateRef.current = createInitialMessageWatcherState();
      persistentUiModelStateRef.current =
        createInitialPersistentUiModelState();
      messageWatchFrameIndexRef.current = 0;
      messageObservationCounterRef.current = restoredMessageObservations.reduce(
        (highestCounter, observation) => {
          const match = /^msgobs_(\d+)$/u.exec(observation.id);
          return match
            ? Math.max(highestCounter, Number.parseInt(match[1], 10))
            : highestCounter;
        },
        restoredMessageObservations.length,
      );
      commitMessageObservations(restoredMessageObservations);
      commitOcrMessages(restoredOcrMessages);
      setOcrLogs(
        restoredOcrMessages
          .slice(0, MAX_OCR_LOGS)
          .map((message) => createOcrLogEntryFromMessage(message)),
      );
      setSampleDiagnostics(
        sortNewestFirst(document.sampleDiagnostics ?? []).slice(0, MAX_SAMPLE_DIAGNOSTICS),
      );
      phaseDetectionSummaryRef.current = document.phaseDetectionSummary;
      phaseTransitionsRef.current = sortNewestFirst(document.phaseTransitions).slice(
        0,
        MAX_PHASE_TRANSITIONS,
      );
      phaseTransitionCounterRef.current = phaseTransitionsRef.current.length;
      commitBattleEvents(restoredEvents.slice(0, MAX_EVENT_HISTORY));
      commitUnknownEvents(
        sortNewestFirst(document.unknowns).slice(
          0,
          MAX_UNKNOWN_HISTORY,
        ),
      );
      setReviewNotes(
        Object.fromEntries(
          document.manualCorrections
            .filter((correction) => correction.note.trim().length > 0)
            .map((correction) => [correction.targetId, correction.note]),
        ),
      );
      setRoi(document.roiProfile.roi);
      setOpponentHudRoi(document.phaseHudRoiProfile.roi);
      setPlayerHudRoi(document.playerHudRoiProfile.roi);
      setVsRoi(document.vsSplashRoiProfile.roi);
      setSuppressedTimelineCount(0);
      recentTimelineDeduplicationRecordsRef.current = [];
      recentConstrainedCandidateRecordsRef.current = [];
      recentAcceptedEventRecordsRef.current = restoredEvents
        .map((event) => createAcceptedEventRecord(event))
        .slice(0, 16);
      sessionRosterDictionaryRef.current = collectSessionRosterDictionary(restoredEvents) as DictionaryEntry[];
      observedMoveDictionaryRef.current = collectObservedMoveDictionary(restoredEvents) as DictionaryEntry[];
      lastAcceptedEventIdRef.current = restoredEvents[0]?.id ?? null;
      setActiveReviewTab("timeline");
      addLog(`Battle Logを読み込みました: ${document.events.length} events / ${document.unknowns.length} unknown`);
    },
    [
      addLog,
      commitBattleEvents,
      commitMessageObservations,
      commitOcrMessages,
      commitUnknownEvents,
    ],
  );

  const handleExportBattleLogJson = useCallback(() => {
    const document = buildCurrentBattleLogDocument();
    downloadTextFile(
      `pokechronicle-battle-log-${createFileStamp()}.json`,
      serializeBattleLogDocument(document),
      "application/json;charset=utf-8",
    );
    addLog("Battle Log JSONを出力しました。");
  }, [addLog, buildCurrentBattleLogDocument]);

  const handleExportEventsCsv = useCallback(() => {
    const document = buildCurrentBattleLogDocument();
    downloadTextFile(
      `pokechronicle-events-${createFileStamp()}.csv`,
      createEventsCsv(document.events),
      "text/csv;charset=utf-8",
    );
    addLog("Events CSVを出力しました。");
  }, [addLog, buildCurrentBattleLogDocument]);

  const handleExportUnknownsCsv = useCallback(() => {
    const document = buildCurrentBattleLogDocument();
    downloadTextFile(
      `pokechronicle-unknowns-${createFileStamp()}.csv`,
      createUnknownsCsv(document.unknowns, document.manualCorrections),
      "text/csv;charset=utf-8",
    );
    addLog("Unknown messages CSVを出力しました。");
  }, [addLog, buildCurrentBattleLogDocument]);

  const handleBattleLogImportChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];

      if (!file) {
        return;
      }

      try {
        const result = parseBattleLogJson(await file.text());

        if (!result.ok) {
          addLog(result.error, "error");
          return;
        }

        restoreBattleLogDocument(result.document);
        result.warnings.forEach((warning) => addLog(warning, "warn"));
        addLog(`Battle Log JSONを読み込みました: ${file.name}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Battle Log JSONの読込に失敗しました。";
        addLog(message, "error");
      } finally {
        event.target.value = "";
      }
    },
    [addLog, restoreBattleLogDocument],
  );

  const handleTemplateImportChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(event.target.files ?? []);

      if (selectedFiles.length === 0) {
        return;
      }

      try {
        if (selectedFiles.length === 1) {
          const [file] = selectedFiles;
          const text = await file.text();
          const templatePackResult = parseImportedTemplateCollectionJson(text);

          if (templatePackResult.ok) {
            setImportedTemplateCollection(templatePackResult.collection);
            await saveImportedTemplateCollection(templatePackResult.collection);
            setTemplateImportStatusLabel(
              `Template読込 ${templatePackResult.collection.rules.length} rules`,
            );
            addLog(`Template packを読み込みました: ${file.name}`);
            return;
          }
        }

        const files = await Promise.all(
          selectedFiles.map(async (file) => ({
            name: file.name,
            text: await file.text(),
          })),
        );
        const result = createImportedTemplateCollectionFromJsonFiles(files);

        if (!result.ok) {
          setTemplateImportStatusLabel("Template読込失敗");
          addLog(result.error, "error");
          return;
        }

        setImportedTemplateCollection(result.collection);
        await saveImportedTemplateCollection(result.collection);
        setTemplateImportStatusLabel(`Template読込 ${result.collection.rules.length} rules`);
        result.warnings.forEach((warning) => addLog(warning, "warn"));
        addLog(
          `champout JSONを読み込みました: ${result.collection.stats.sourceFileCount} files / ${result.collection.rules.length} rules`,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Template JSONの読込に失敗しました。";
        setTemplateImportStatusLabel("Template読込失敗");
        addLog(message, "error");
      } finally {
        event.target.value = "";
      }
    },
    [addLog],
  );

  const handleExportTemplateImport = useCallback(() => {
    if (!importedTemplateCollection) {
      setTemplateImportStatusLabel("Template未読込");
      addLog("出力できるTemplate importがありません。", "warn");
      return;
    }

    downloadTextFile(
      `pokechronicle-template-import-${createFileStamp()}.json`,
      serializeImportedTemplateCollection(importedTemplateCollection),
      "application/json;charset=utf-8",
    );
    setTemplateImportStatusLabel(`Template出力 ${formatStorageTimestamp()}`);
    addLog("Template import JSONを出力しました。");
  }, [addLog, importedTemplateCollection]);

  const handleClearTemplateImport = useCallback(async () => {
    try {
      await clearImportedTemplateCollections();
      setImportedTemplateCollection(null);
      setTemplateImportStatusLabel("Template削除済み");
      addLog("Template importを削除しました。");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Template importの削除に失敗しました。";
      setTemplateImportStatusLabel("Template削除失敗");
      addLog(message, "error");
    }
  }, [addLog]);

  const handleUnknownReview = useCallback(
    (unknownId: string) => {
      commitUnknownEvents(
        unknownEventsRef.current.map((unknown) =>
          unknown.id === unknownId ? { ...unknown, reviewStatus: "reviewed" } : unknown,
        ),
      );
      addLog(`unknown ${unknownId} をreviewedにしました。`);
    },
    [addLog, commitUnknownEvents],
  );

  const handleReviewNoteChange = useCallback((unknownId: string, note: string) => {
    setReviewNotes((currentNotes) => {
      const nextNotes = { ...currentNotes };

      if (note.trim().length === 0) {
        delete nextNotes[unknownId];
      } else {
        nextNotes[unknownId] = note;
      }

      return nextNotes;
    });
  }, []);

  return (
    <main ref={captureShellRef} className="capture-shell" aria-label="capture workspace shell">
      <header className="capture-toolbar" aria-label="capture controls">
        <div className={`input-badge input-badge--${inputBadge.tone}`}>
          <span className={`status-dot status-dot--${inputBadge.tone}`} aria-hidden="true" />
          <span className="input-badge-text">{inputBadge.label}</span>
        </div>
        <div className="device-selects" aria-label="input device selectors">
          <label className="device-select">
            <select
              aria-label="映像デバイス"
              value={selectedVideoDeviceId}
              onChange={handleVideoDeviceChange}
              disabled={videoDevices.length === 0}
            >
              {videoDevices.length === 0 ? (
                <option value="">映像デバイスが見つかりません</option>
              ) : null}
              {isSelectedVideoDeviceMissing ? (
                <option value={selectedVideoDeviceId}>保存済み映像デバイス未接続</option>
              ) : null}
              {videoDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
          </label>
          <label className="device-select">
            <select
              aria-label="音声デバイス"
              value={selectedAudioDeviceId}
              onChange={handleAudioDeviceChange}
            >
              <option value={NO_AUDIO_DEVICE_ID}>音声なし</option>
              {audioDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="toolbar-actions" aria-label="input actions">
          <Button
            type="button"
            variant="outline"
            className="icon-button"
            aria-label="更新"
            title="更新"
            onClick={() => void refreshDevices()}
          >
            <img className="toolbar-icon" src={reloadIconUrl} alt="" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="default"
            className="icon-button"
            aria-label="開始"
            title="開始"
            onClick={() => void handleToolbarStartAnalysis()}
            disabled={isOcrEnabled || (mediaMode === "idle" && videoDevices.length === 0)}
          >
            <span className="toolbar-glyph" aria-hidden="true">▶</span>
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="icon-button"
            aria-label="停止"
            title="停止"
            onClick={handleToolbarStopAnalysis}
            disabled={!isSampling && !isOcrEnabled && pendingOcrJobs === 0}
          >
            <span className="toolbar-glyph" aria-hidden="true">■</span>
          </Button>
          <div
            className="volume-control"
            data-state={isVolumePanelOpen ? "open" : "closed"}
            onMouseEnter={() => setIsVolumePanelOpen(true)}
            onMouseLeave={() => setIsVolumePanelOpen(false)}
            onFocus={() => setIsVolumePanelOpen(true)}
            onBlur={(event) => {
              const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;

              if (!event.currentTarget.contains(nextTarget)) {
                setIsVolumePanelOpen(false);
              }
            }}
          >
            <Button
              type="button"
              variant="outline"
              className="icon-button"
              aria-label={isVolumeEffectivelyMuted ? "音量ミュート解除" : "音量ミュート"}
              title={isVolumeEffectivelyMuted ? "音量ミュート解除" : "音量ミュート"}
              onClick={handleToggleAudioMuted}
            >
              <img
                className="toolbar-icon"
                src={isVolumeEffectivelyMuted ? volumeMutedIconUrl : volumeIconUrl}
                alt=""
                aria-hidden="true"
              />
            </Button>
            <div className="volume-popover" aria-label="音量調整">
              <input
                className="volume-slider"
                aria-label={`音量 ${volumePercent}%`}
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={audioVolume}
                onChange={handleAudioVolumeChange}
              />
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            className="icon-button"
            aria-label="アップロード"
            title="アップロード"
            onClick={() => fileInputRef.current?.click()}
          >
            <img className="toolbar-icon" src={uploadIconUrl} alt="" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            className="icon-button"
            aria-label={isWorkspaceFullscreen ? "全画面解除" : "全画面表示"}
            title={isWorkspaceFullscreen ? "全画面解除" : "全画面表示"}
            onClick={() => void handleToggleAppFullscreen()}
          >
            <img
              className="toolbar-icon"
              src={isWorkspaceFullscreen ? fullscreenExitIconUrl : fullscreenIconUrl}
              alt=""
              aria-hidden="true"
            />
          </Button>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept="video/*,image/*"
            onChange={handleFileChange}
          />
        </div>
      </header>

      <section
        ref={captureMainRef}
        className={captureMainClassName}
        style={captureMainStyle}
        aria-label="M1 capture workspace"
      >
        <div ref={previewColumnRef} className="preview-column">
          <section className="preview-frame" aria-label="capture preview">
            <div className="preview-surface">
              {mediaMode === "image-file" && filePreviewUrl ? (
                <img
                  ref={imagePreviewRef}
                  className="capture-video"
                  src={filePreviewUrl}
                  alt="読み込んだ検証画像"
                  onLoad={(event) => {
                    setMetadata({
                      width: event.currentTarget.naturalWidth || null,
                      height: event.currentTarget.naturalHeight || null,
                      frameRate: null,
                    });
                  }}
                />
              ) : (
                <video
                  ref={videoRef}
                  className="capture-video"
                  src={mediaMode === "video-file" ? (filePreviewUrl ?? undefined) : undefined}
                  autoPlay
                  muted
                  playsInline
                  controls={mediaMode === "video-file"}
                  onLoadedMetadata={handleLoadedMetadata}
                  onEnded={() => {
                    if (mediaModeRef.current !== "video-file") {
                      return;
                    }
                    stopSampling(
                      "動画ファイルの再生終了によりフレームサンプリングを停止しました。",
                      "media_ended",
                    );
                    stopOcr();
                  }}
                />
              )}
              {mediaMode === "idle" ? (
                <div className="test-pattern" aria-label="preview placeholder">
                  <span>プレビュー待機中</span>
                </div>
              ) : null}
              {isRoiVisible ? (
                <RoiOverlay label="メッセージROI" roi={roi} onChange={setRoi} />
              ) : null}
              {isOpponentHudRoiVisible ? (
                <RoiOverlay
                  label="バトルHUD ROI（相手）"
                  roi={opponentHudRoi}
                  tone="hud"
                  onChange={setOpponentHudRoi}
                />
              ) : null}
              {isPlayerHudRoiVisible ? (
                <RoiOverlay
                  label="バトルHUD ROI（味方）"
                  roi={playerHudRoi}
                  tone="hud"
                  onChange={setPlayerHudRoi}
                />
              ) : null}
              {isVsRoiVisible ? (
                <RoiOverlay
                  label="VS ROI"
                  roi={vsRoi}
                  tone="vs"
                  onChange={setVsRoi}
                />
              ) : null}
            </div>
          </section>
        </div>

        <div
          className="workspace-resizer"
          role="separator"
          aria-label="プレビューとログの幅を変更"
          aria-orientation="vertical"
          aria-valuemin={MIN_RESOLVED_LOG_PANEL_WIDTH}
          aria-valuemax={MAX_RESOLVED_LOG_PANEL_WIDTH}
          aria-valuenow={Math.round(resolvedLogPanelWidthValue)}
          tabIndex={0}
          title="ドラッグでプレビューとログの幅を変更"
          onKeyDown={handleResolvedLogResizeKeyDown}
          onMouseDown={handleResolvedLogResizeMouseDown}
          onPointerCancel={finishResolvedLogResize}
          onPointerDown={handleResolvedLogResizePointerDown}
          onPointerMove={handleResolvedLogResizePointerMove}
          onPointerUp={finishResolvedLogResize}
        />

        <div
          className="management-panel-resizer"
          role="separator"
          aria-label="プレビューと下部タブの高さを変更"
          aria-orientation="horizontal"
          aria-valuemin={MIN_MANAGEMENT_PANEL_HEIGHT}
          aria-valuemax={MAX_MANAGEMENT_PANEL_HEIGHT}
          aria-valuenow={Math.round(managementPanelHeightValue)}
          tabIndex={0}
          title="ドラッグでプレビューと下部タブの高さを変更"
          onKeyDown={handleManagementPanelResizeKeyDown}
          onMouseDown={handleManagementPanelResizeMouseDown}
          onPointerCancel={finishManagementPanelResize}
          onPointerDown={handleManagementPanelResizePointerDown}
          onPointerMove={handleManagementPanelResizePointerMove}
          onPointerUp={finishManagementPanelResize}
        />

          <section
            ref={managementPanelRef}
            className="management-panel"
            aria-label="analysis and data management"
          >
            <Tabs value={activeManagementTab ?? "closed"} className="management-tabs">
              <div className="management-tabbar">
                <TabsList className="management-tab-list" variant="line" aria-label="analysis tabs">
                  {MANAGEMENT_TAB_GROUPS.map((group) => (
                    <div key={group.label} className="management-tab-group" role="presentation">
                      <div className="management-tab-items" role="presentation">
                        {group.tabs.map(({ id, label, Icon }) => (
                          <TabsTrigger
                            key={id}
                            value={id}
                            className="management-tab-trigger"
                            onClick={(event) => handleManagementTabClick(event, id)}
                          >
                            <Icon className="management-tab-icon" aria-hidden="true" />
                            <span>{label}</span>
                          </TabsTrigger>
                        ))}
                      </div>
                    </div>
                  ))}
                </TabsList>
              </div>

            <TabsContent value="roi" className="management-tab-panel">
          <section className="roi-settings-panel tool-panel" aria-label="ROI settings">
            <div className="roi-settings-header tool-panel-header">
              <div>
                <h2>ROI設定</h2>
              </div>
            </div>

            <div className="roi-detail-panel">
              <RoiControlSection
                title="メッセージROI"
                actionLabelPrefix="メッセージROI"
                numberLabelPrefix="ROI"
                roi={roi}
                isVisible={isRoiVisible}
                onReset={handleResetRoi}
                onToggleVisible={setIsRoiVisible}
                onNumberChange={handleRoiNumberChange}
              />
              <RoiControlSection
                title="バトルHUD ROI（相手）"
                actionLabelPrefix="相手バトルHUD ROI"
                numberLabelPrefix="相手バトルHUD ROI"
                roi={opponentHudRoi}
                isVisible={isOpponentHudRoiVisible}
                onReset={handleResetOpponentHudRoi}
                onToggleVisible={setIsOpponentHudRoiVisible}
                onNumberChange={handleOpponentHudRoiNumberChange}
              />
              <RoiControlSection
                title="バトルHUD ROI（味方）"
                actionLabelPrefix="味方バトルHUD ROI"
                numberLabelPrefix="味方バトルHUD ROI"
                roi={playerHudRoi}
                isVisible={isPlayerHudRoiVisible}
                onReset={handleResetPlayerHudRoi}
                onToggleVisible={setIsPlayerHudRoiVisible}
                onNumberChange={handlePlayerHudRoiNumberChange}
              />
              <RoiControlSection
                title="VS ROI"
                actionLabelPrefix="VS ROI"
                numberLabelPrefix="VS ROI"
                roi={vsRoi}
                isVisible={isVsRoiVisible}
                onReset={handleResetVsRoi}
                onToggleVisible={setIsVsRoiVisible}
                onNumberChange={handleVsRoiNumberChange}
              />
            </div>
          </section>
            </TabsContent>

            <TabsContent value="sampler" className="management-tab-panel">
          <section className="analysis-panel tool-panel" aria-label="frame sampling and preprocessing">
            <div className="analysis-header tool-panel-header">
              <div>
                <h2>フレームサンプラー</h2>
                <span>
                  {isSampling ? `${sampleFps}fps` : "停止中"} / {frameSamples.length}/
                  {MAX_FRAME_BUFFER}
                </span>
              </div>
              <div className="analysis-actions tool-panel-actions">
                <Button
                  type="button"
                  variant="default"
                  className="icon-button icon-button--compact"
                  onClick={handleStartSampling}
                  disabled={mediaMode === "idle" || isSampling}
                >
                  <span aria-hidden="true">▶</span>
                  <span>サンプル開始</span>
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="icon-button icon-button--compact"
                  onClick={handleStopSampling}
                  disabled={!isSampling}
                >
                  <span aria-hidden="true">■</span>
                  <span>サンプル停止</span>
                </Button>
              </div>
            </div>

            <div className="preprocess-controls" aria-label="preprocess controls">
              <label className="compact-select">
                <span>fps</span>
                <select
                  value={sampleFps}
                  onChange={(event) => setSampleFps(Number(event.target.value))}
                  disabled={isSampling}
                >
                  <option value={3}>3</option>
                  <option value={5}>5</option>
                </select>
              </label>
              <label className="range-control">
                <span>白抽出 {preprocessOptions.whiteThreshold}</span>
                <input
                  type="range"
                  min={120}
                  max={245}
                  step={5}
                  value={preprocessOptions.whiteThreshold}
                  onChange={(event) =>
                    setPreprocessOptions((currentOptions) => ({
                      ...currentOptions,
                      whiteThreshold: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label className="compact-select">
                <span>背景</span>
                <select
                  value={preprocessOptions.background}
                  onChange={(event) =>
                    setPreprocessOptions((currentOptions) => ({
                      ...currentOptions,
                      background: event.target.value as MessagePreprocessOptions["background"],
                    }))
                  }
                >
                  <option value="black">黒地</option>
                  <option value="white">白地</option>
                </select>
              </label>
              <label className="compact-select">
                <span>拡大</span>
                <select
                  value={upscaleFactor}
                  onChange={(event) => setUpscaleFactor(Number(event.target.value))}
                >
                  <option value={1}>1x</option>
                  <option value={2}>2x</option>
                  <option value={3}>3x</option>
                </select>
              </label>
              <label className="toggle-control">
                <input
                  type="checkbox"
                  checked={preprocessOptions.invert}
                  onChange={(event) =>
                    setPreprocessOptions((currentOptions) => ({
                      ...currentOptions,
                      invert: event.target.checked,
                    }))
                  }
                />
                <span>反転</span>
              </label>
            </div>

            <div className="crop-preview-grid">
              <figure className="crop-preview">
                <figcaption>
                  <span>raw crop</span>
                  <span>
                    {latestFrameSample
                      ? `${latestFrameSample.cropWidth}x${latestFrameSample.cropHeight}`
                      : "未生成"}
                  </span>
                </figcaption>
                <div className="crop-preview-media">
                  {latestFrameSample ? (
                    <img src={latestFrameSample.rawDataUrl} alt="最新のROI crop" />
                  ) : (
                    <span>未生成</span>
                  )}
                </div>
              </figure>
              <figure className="crop-preview">
                <figcaption>
                  <span>preprocessed</span>
                  <span>
                    {latestFrameSample
                      ? `${latestFrameSample.upscaleFactor}x / ${latestFrameSample.preprocess.whiteThreshold} / mask ${latestFrameSample.preprocessVariantId} / text ${formatTextDensity(latestFrameSample.foregroundPixelRatio)} / OCR ${latestFrameSample.ocrVariantId} ${formatTextDensity(latestFrameSample.ocrForegroundPixelRatio)}`
                      : "未生成"}
                  </span>
                </figcaption>
                <div className="crop-preview-media">
                  {latestFrameSample ? (
                    <img src={latestFrameSample.processedDataUrl} alt="最新の前処理preview" />
                  ) : (
                    <span>未生成</span>
                  )}
                </div>
              </figure>
            </div>

            <ol className="sample-buffer" aria-label="frame sample ring buffer">
              {frameSamples.length === 0 ? (
                <li>バッファ空</li>
              ) : (
                frameSamples.map((sample) => (
                  <li key={sample.id}>
                    <span>#{sample.frameIndex}</span>
                    <span>{sample.timestampMs}ms</span>
                    <span>
                      {sample.cropWidth}x{sample.cropHeight}
                    </span>
                    <span>{sample.capturedAt}</span>
                  </li>
                ))
              )}
            </ol>
          </section>
            </TabsContent>

            <TabsContent value="ocr" className="management-tab-panel">
            <section className="ocr-panel tool-panel" aria-label="realtime OCR log">
              <div className="ocr-header tool-panel-header">
                <div>
                  <h2>リアルタイムOCR</h2>
                  <span>
                    {ocrStatusLabel} / pending {pendingOcrJobs} / {formatConfidence(
                      latestOcrLog?.confidence ?? null,
                    )}
                  </span>
                </div>
                <div className="analysis-actions tool-panel-actions">
                  <Button
                    type="button"
                    variant="default"
                    className="icon-button icon-button--compact"
                    onClick={handleStartOcr}
                    disabled={mediaMode === "idle" || isOcrEnabled}
                  >
                    <span aria-hidden="true">▶</span>
                    <span>OCR開始</span>
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="icon-button icon-button--compact"
                    onClick={handleStopOcr}
                    disabled={!isOcrEnabled && pendingOcrJobs === 0}
                  >
                    <span aria-hidden="true">■</span>
                    <span>OCR停止</span>
                  </Button>
                </div>
              </div>

              <div className="ocr-meter" aria-label="OCR progress">
                <span style={{ width: `${Math.round(clamp(ocrProgress, 0, 1) * 100)}%` }} />
              </div>

              <div className="ocr-diagnostic-summary" aria-label="OCR sampling diagnostics">
                {SAMPLE_DIAGNOSTIC_STAGES.map((stage) => (
                  <span key={stage}>
                    <strong>{formatDiagnosticStage(stage)}</strong>
                    <em>{sampleDiagnosticCounts[stage]}</em>
                  </span>
                ))}
              </div>

              <ol className="ocr-diagnostic-log" aria-label="OCR sampling diagnostic log">
                {latestSampleDiagnostics.length === 0 ? (
                  <li className="ocr-diagnostic-empty">診断ログ空</li>
                ) : (
                  latestSampleDiagnostics.map((diagnostic) => (
                    <li
                      key={diagnostic.id}
                      className={`ocr-diagnostic-entry ocr-diagnostic-entry--${diagnostic.stage}`}
                    >
                      <div className="ocr-log-meta">
                        <span>#{diagnostic.frameIndex}</span>
                        <span>{diagnostic.timestampMs}ms</span>
                        <span>{formatDiagnosticStage(diagnostic.stage)}</span>
                      </div>
                      <p>{formatSampleDiagnosticDetail(diagnostic)}</p>
                    </li>
                  ))
                )}
              </ol>

              <ol className="ocr-log-list" aria-label="OCR result log">
                {ocrLogs.length === 0 ? (
                  <li className="ocr-log-empty">OCRログ空</li>
                ) : (
                  ocrLogs.map((entry) => (
                    <li key={entry.id} className={`ocr-log-entry ocr-log-entry--${entry.status}`}>
                      <div className="ocr-log-meta">
                        <span>#{entry.frameIndex}</span>
                        <span>{entry.timestampMs}ms</span>
                        <span>{formatConfidence(entry.confidence)}</span>
                        <span>{entry.lineCount} lines</span>
                      </div>
                      {entry.status === "error" ? (
                        <p>{entry.errorMessage}</p>
                      ) : (
                        <>
                          <p>{formatOcrLogDisplayText(entry)}</p>
                          {entry.parseResult ? (
                            <div className="parse-summary">
                              <span
                                className={`parse-chip parse-chip--${entry.parseResult.status}`}
                              >
                                {formatParseSummary(entry.parseResult)}
                              </span>
                              <span>{entry.matchText || "match empty"}</span>
                            </div>
                          ) : null}
                          <details className="raw-text-details">
                            <summary>OCR詳細</summary>
                            <span>{entry.normalizedText || "normalized empty"}</span>
                            <code>{entry.rawText || "raw empty"}</code>
                          </details>
                        </>
                      )}
                    </li>
                  ))
                )}
              </ol>
            </section>
            </TabsContent>

            <TabsContent value="stats" className="management-tab-panel">
          <section className="stats-panel tool-panel" aria-label="statistics summary">
            <div className="tool-panel-header">
              <div>
                <h2>統計サマリー</h2>
                <span>
                  {battleStats.totalResolvedEventCount} events / {battleStats.unknownMessageCount} unknown /{" "}
                  {Math.round(battleStats.unknownRate * 100)}%
                </span>
              </div>
            </div>

            <dl className="stats-grid">
              <div>
                <dt>observed moves</dt>
                <dd>{battleStats.observedMoveCount}</dd>
              </div>
              <div>
                <dt>pokemon actions</dt>
                <dd>{battleStats.pokemonActionCount}</dd>
              </div>
              <div>
                <dt>switches</dt>
                <dd>{battleStats.switchCount}</dd>
              </div>
              <div>
                <dt>faints</dt>
                <dd>{battleStats.faintCount}</dd>
              </div>
              <div>
                <dt>unknown</dt>
                <dd>{battleStats.unknownMessageCount}</dd>
              </div>
              <div>
                <dt>critical</dt>
                <dd>{battleStats.criticalCount}</dd>
              </div>
            </dl>

            <div className="stats-breakdown" aria-label="effectiveness counts">
              <span>効果抜群 {battleStats.effectiveness.supereffective}</span>
              <span>いまひとつ {battleStats.effectiveness.resisted}</span>
              <span>効果なし {battleStats.effectiveness.immune}</span>
            </div>

            <section className="stats-action-panel" aria-label="pokemon action counts">
              <div className="review-section-heading">
                <h2>ポケモン別行動</h2>
                <span>{battleStats.pokemonActionCounts.length} entries</span>
              </div>
              <ol className="pokemon-action-counts">
                {battleStats.pokemonActionCounts.length === 0 ? (
                  <li>
                    <span>行動ログ空</span>
                    <strong>0</strong>
                  </li>
                ) : (
                  battleStats.pokemonActionCounts.map((entry) => (
                    <li key={entry.key}>
                      <span>
                        {formatSide(entry.side)} / {entry.name}
                      </span>
                      <strong>{entry.count}</strong>
                    </li>
                  ))
                )}
              </ol>
            </section>
          </section>
            </TabsContent>

            <TabsContent value="data" className="management-tab-panel">
          <section className="data-management-panel tool-panel" aria-label="data import export and review details">
            <div className="panel-heading panel-heading--compact tool-panel-header">
              <div>
                <h2>データ管理</h2>
                <p>Battle Log JSON / CSV</p>
              </div>
            </div>

            <div className="storage-actions" aria-label="battle log storage actions">
              <Button
                type="button"
                variant="outline"
                className="storage-button"
                onClick={handleExportBattleLogJson}
              >
                ログJSON出力
              </Button>
              <Button
                type="button"
                variant="outline"
                className="storage-button"
                onClick={() => battleLogImportInputRef.current?.click()}
              >
                ログJSON読込
              </Button>
              <Button
                type="button"
                variant="outline"
                className="storage-button"
                onClick={handleExportEventsCsv}
              >
                イベントCSV出力
              </Button>
              <Button
                type="button"
                variant="outline"
                className="storage-button"
                onClick={handleExportUnknownsCsv}
              >
                Unknown CSV出力
              </Button>
              <input
                ref={battleLogImportInputRef}
                className="visually-hidden"
                type="file"
                accept="application/json,.json"
                onChange={(event) => void handleBattleLogImportChange(event)}
              />
            </div>
          </section>
            </TabsContent>

            <TabsContent value="logs" className="management-tab-panel">
          <section className="log-review-panel tool-panel" aria-label="log review details">
            <div className="tool-panel-header">
              <div>
                <h2>レビュー</h2>
                <span>
                  {timelineItems.length} timeline / {battleEvents.length} resolved / {unknownEvents.length} unknown
                </span>
              </div>
            </div>
            <div className="review-tabs" role="tablist" aria-label="review views">
              {REVIEW_TABS.map((tab) => (
                <Button
                  key={tab.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  role="tab"
                  id={`review-tab-${tab.id}`}
                  aria-controls={`review-panel-${tab.id}`}
                  aria-selected={activeReviewTab === tab.id}
                  className="review-tab"
                  onClick={() => setActiveReviewTab(tab.id)}
                >
                  <span>{tab.label}</span>
                  {tab.id === "timeline" ? <strong>{timelineItems.length}</strong> : null}
                  {tab.id === "resolved" ? <strong>{battleEvents.length}</strong> : null}
                  {tab.id === "unknown" ? <strong>{unknownEvents.length}</strong> : null}
                  {tab.id === "ocr" ? <strong>{ocrLogGroups.length}</strong> : null}
                  {tab.id === "system" ? <strong>{logs.length}</strong> : null}
                </Button>
              ))}
            </div>

            <div className="review-tabpanels">
              {activeReviewTab === "timeline" ? (
                <section
                  id="review-panel-timeline"
                  role="tabpanel"
                  aria-labelledby="review-tab-timeline"
                  className="review-section"
                >
                  <div className="review-section-heading">
                    <h2>イベントタイムライン</h2>
                    <span>
                      {battleEvents.length} events / {unknownEvents.length} unknown /{" "}
                      {suppressedTimelineCount} dup
                    </span>
                  </div>
                  <ol className="timeline-list">
                    {timelineItems.length === 0 ? (
                      <li className="timeline-empty">タイムライン空</li>
                    ) : (
                      timelineItems.map((item) => {
                        const sourceFrameRef = getTimelineItemSourceFrameRef(item);
                        const cropEvidence = sourceFrameRef
                          ? cropEvidenceBySourceRef.current.get(sourceFrameRef)
                          : null;

                        if (item.kind === "event") {
                          return (
                            <li key={item.event.id} className="timeline-entry timeline-entry--event">
                              <div className="timeline-meta">
                                <span>#{item.event.source.frameIndex ?? "--"}</span>
                                <span>{item.event.timestampMs}ms</span>
                                <span>{item.event.classification.method}</span>
                              </div>
                              <p>{formatCanonicalEventText(item.event)}</p>
                              <div className="timeline-evidence">
                                {cropEvidence ? (
                                  <img src={cropEvidence.processedDataUrl} alt="イベント元crop" />
                                ) : null}
                                <details className="raw-text-details">
                                  <summary>OCR詳細</summary>
                                  <span>{item.event.normalizedText || "normalized empty"}</span>
                                  <code>{item.event.rawText || "raw empty"}</code>
                                </details>
                              </div>
                            </li>
                          );
                        }

                        return (
                          <li
                            key={item.unknown.id}
                            className="timeline-entry timeline-entry--unknown"
                          >
                            <div className="timeline-meta">
                              <span>{item.unknown.sourceFrameRef ?? "frame未保存"}</span>
                              <span>{item.unknown.timestampMs}ms</span>
                              <span>{formatReviewStatus(item.unknown.reviewStatus)}</span>
                            </div>
                            <p>{item.unknown.normalizedText || "unknown text empty"}</p>
                            <div className="timeline-evidence">
                              {cropEvidence ? (
                                <img src={cropEvidence.processedDataUrl} alt="unknown元crop" />
                              ) : null}
                              <code>{item.unknown.rawText || "raw empty"}</code>
                            </div>
                          </li>
                        );
                      })
                    )}
                  </ol>
                </section>
              ) : null}

              {activeReviewTab === "resolved" ? (
                <section
                  id="review-panel-resolved"
                  role="tabpanel"
                  aria-labelledby="review-tab-resolved"
                  className="review-section"
                >
                  <div className="review-section-heading">
                    <h2>解決ログ</h2>
                    <span>{battleEvents.length} resolved</span>
                  </div>
                  <ol className="resolved-list">
                    {displayedBattleEvents.length === 0 ? (
                      <li className="timeline-empty">解決ログ空</li>
                    ) : (
                      displayedBattleEvents.map((event) => {
                        const sourceFrameRef = createSourceFrameRef(
                          event.source.frameIndex,
                          event.source.timestampMs,
                        );
                        const cropEvidence = cropEvidenceBySourceRef.current.get(sourceFrameRef);

                        return (
                          <li key={event.id} className="resolved-entry">
                            <div className="timeline-meta">
                              <span>#{event.source.frameIndex ?? "--"}</span>
                              <span>{event.timestampMs}ms</span>
                              <span>{formatConfidence(event.confidence)}</span>
                            </div>
                            <h3>{formatCanonicalEventText(event)}</h3>
                            <div className="resolved-summary">
                              <span className="parse-chip parse-chip--event">
                                {formatResolvedEventChip(event)}
                              </span>
                              <span>{event.normalizedText || "normalized empty"}</span>
                            </div>
                            <div className="timeline-evidence">
                              {cropEvidence ? (
                                <img src={cropEvidence.processedDataUrl} alt="resolved元crop" />
                              ) : null}
                              <details className="raw-text-details">
                                <summary>OCR詳細</summary>
                                <span>{event.normalizedText || "normalized empty"}</span>
                                <code>{event.rawText || "raw empty"}</code>
                              </details>
                            </div>
                          </li>
                        );
                      })
                    )}
                  </ol>
                </section>
              ) : null}

              {activeReviewTab === "unknown" ? (
                <section
                  id="review-panel-unknown"
                  role="tabpanel"
                  aria-labelledby="review-tab-unknown"
                  className="review-section"
                >
                  <div className="review-section-heading">
                    <h2>Unknown bucket</h2>
                    <span>
                      {reviewedUnknownCount}/{unknownEvents.length} reviewed
                    </span>
                  </div>
                  <ol className="unknown-list">
                    {displayedUnknownEvents.length === 0 ? (
                      <li className="timeline-empty">unknown空</li>
                    ) : (
                      displayedUnknownEvents.map((unknown) => (
                        <li key={unknown.id} className="unknown-entry">
                          <div className="timeline-meta">
                            <span>{unknown.id}</span>
                            <span>{formatConfidence(unknown.ocrConfidence)}</span>
                            <span>{formatReviewStatus(unknown.reviewStatus)}</span>
                          </div>
                          <p>{unknown.normalizedText}</p>
                          <label className="review-note">
                            <span>修正メモ</span>
                            <textarea
                              value={reviewNotes[unknown.id] ?? ""}
                              aria-label={`修正メモ ${unknown.id}`}
                              rows={2}
                              onChange={(event) =>
                                handleReviewNoteChange(unknown.id, event.target.value)
                              }
                            />
                          </label>
                          <details className="candidate-details">
                            <summary>{unknown.candidateMatches.length} candidates</summary>
                            <code>
                              {unknown.candidateMatches.length > 0
                                ? unknown.candidateMatches.join("\n")
                                : "候補なし"}
                            </code>
                          </details>
                          <Button
                            type="button"
                            variant="outline"
                            className="review-button"
                            onClick={() => handleUnknownReview(unknown.id)}
                            disabled={unknown.reviewStatus === "reviewed"}
                          >
                            reviewedにする
                          </Button>
                        </li>
                      ))
                    )}
                  </ol>
                </section>
              ) : null}

              {activeReviewTab === "ocr" ? (
                <section
                  id="review-panel-ocr"
                  role="tabpanel"
                  aria-labelledby="review-tab-ocr"
                  className="review-section"
                >
                  <div className="review-section-heading">
                    <h2>OCR Raw</h2>
                    <span>
                      {ocrLogGroups.length} groups / {ocrMessages.length} messages
                    </span>
                  </div>
                  <ol className="ocr-raw-list">
                    {ocrLogGroups.length === 0 ? (
                      <li className="timeline-empty">OCR raw空</li>
                    ) : (
                      ocrLogGroups.map((group) => (
                        <li
                          key={`${group.entry.id}-${group.key}`}
                          className={`ocr-raw-entry ocr-log-entry--${group.entry.status}`}
                        >
                          <div className="timeline-meta">
                            <span>#{group.entry.frameIndex}</span>
                            <span>{group.entry.timestampMs}ms</span>
                            <span>{formatConfidence(group.entry.confidence)}</span>
                            {group.count > 1 ? <span>x{group.count}</span> : null}
                          </div>
                          {group.entry.status === "error" ? (
                            <p>{group.entry.errorMessage}</p>
                          ) : (
                            <>
                              <p>{group.entry.normalizedText || "テキストなし"}</p>
                              {group.entry.parseResult ? (
                                <div className="parse-summary">
                                  <span
                                    className={`parse-chip parse-chip--${group.entry.parseResult.status}`}
                                  >
                                    {formatParseSummary(group.entry.parseResult)}
                                  </span>
                                  <span>{group.entry.matchText || "match empty"}</span>
                                </div>
                              ) : null}
                              <code>{group.entry.rawText || "raw empty"}</code>
                            </>
                          )}
                        </li>
                      ))
                    )}
                  </ol>
                </section>
              ) : null}

              {activeReviewTab === "system" ? (
                <section
                  id="review-panel-system"
                  role="tabpanel"
                  aria-labelledby="review-tab-system"
                  className="review-section"
                >
                  <div className="review-section-heading">
                    <h2>システムログ</h2>
                    <span>{ocrMessages.length} OCR messages</span>
                  </div>
                  <ol className="log-list">
                    {logs.map((log) => (
                      <li key={log.id} className={`log-entry log-entry--${log.level}`}>
                        <time>{log.timestamp}</time>
                        <span>{log.message}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}
            </div>
          </section>
            </TabsContent>
          </Tabs>
          </section>

        <aside
          ref={resolvedLogPanelRef}
          className="log-panel resolved-log-panel"
          aria-label="ライブイベントログ"
        >
          <ol className="resolved-text-log" aria-label="live event log">
            {primaryLiveLogItems.length === 0 ? (
              <li className="resolved-text-log-empty">ライブイベントログ空</li>
            ) : (
              primaryLiveLogItems.map((item) => {
                if (item.kind === "legacy_event") {
                  return (
                    <li
                      key={item.id}
                      className="live-event-row live-event-row--resolved"
                    >
                      <time className="live-event-time">
                        {item.event.timestampMs}ms
                      </time>
                      <span className="live-event-status">[解決]</span>
                      <span className="live-event-text">
                        {formatCanonicalEventText(item.event)}
                      </span>
                    </li>
                  );
                }

                const observation = item.observation;
                const resolvedEvents = item.events;
                const status =
                  observation.resolution === "resolved"
                    ? "解決"
                    : observation.resolution === "ocr_unknown"
                      ? "未解決"
                      : observation.resolution === "unread"
                        ? "未読"
                        : observation.lifecycle === "active"
                          ? "検出中"
                          : "解析中";
                const fallbackText =
                  observation.resolution === "ocr_unknown"
                    ? "内容を解決できませんでした"
                    : observation.resolution === "unread"
                      ? "内容を認識できませんでした"
                      : observation.lifecycle === "active"
                        ? "バトルメッセージを検出"
                        : "バトルメッセージを解析中";

                return (
                  <li
                    key={item.id}
                    data-observation-id={observation.id}
                    className={`live-event-row live-event-row--${observation.resolution}`}
                  >
                    <time className="live-event-time">{observation.openedAtMs}ms</time>
                    <span className="live-event-status">[{status}]</span>
                    {resolvedEvents.length > 0 ? (
                      <span className="live-event-lines">
                        {resolvedEvents.map((event) => (
                          <span key={event.id}>{formatCanonicalEventText(event)}</span>
                        ))}
                      </span>
                    ) : (
                      <span className="live-event-text">{fallbackText}</span>
                    )}
                  </li>
                );
              })
            )}
          </ol>
        </aside>

      </section>

    </main>
  );
}

function RoiControlSection({
  title,
  actionLabelPrefix,
  numberLabelPrefix,
  roi,
  isVisible,
  onReset,
  onToggleVisible,
  onNumberChange,
}: {
  title: string;
  actionLabelPrefix: string;
  numberLabelPrefix: string;
  roi: NormalizedRoi;
  isVisible: boolean;
  onReset: () => void;
  onToggleVisible: (isVisible: boolean) => void;
  onNumberChange: (field: RoiField, value: string) => void;
}) {
  return (
    <div className="roi-subsection">
      <div className="roi-subsection-header">
        <div className="roi-subsection-title">
          <strong>{title}</strong>
          <span>
            x={roi.x.toFixed(4)} y={roi.y.toFixed(4)} w={roi.w.toFixed(4)} h=
            {roi.h.toFixed(4)}
          </span>
        </div>
        <div className="roi-subsection-actions">
          <Button
            type="button"
            variant="outline"
            className="icon-button icon-button--compact roi-action-button"
            aria-label={`${actionLabelPrefix}リセット`}
            onClick={onReset}
          >
            <RotateCcw className="action-icon" aria-hidden="true" />
            <span>ROIリセット</span>
          </Button>
          <label className="toggle-control roi-visibility-toggle roi-action-button">
            <input
              type="checkbox"
              aria-label={`${actionLabelPrefix}表示`}
              checked={isVisible}
              onChange={(event) => onToggleVisible(event.target.checked)}
            />
            <span>ROI表示</span>
          </label>
        </div>
      </div>
      <div className="roi-number-grid" aria-label={`${numberLabelPrefix} numeric settings`}>
        <label className="roi-number-control">
          <span>X</span>
          <input
            aria-label={`${numberLabelPrefix} X`}
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={roi.x.toFixed(4)}
            onChange={(event) => onNumberChange("x", event.target.value)}
          />
        </label>
        <label className="roi-number-control">
          <span>Y</span>
          <input
            aria-label={`${numberLabelPrefix} Y`}
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={roi.y.toFixed(4)}
            onChange={(event) => onNumberChange("y", event.target.value)}
          />
        </label>
        <label className="roi-number-control">
          <span>W</span>
          <input
            aria-label={`${numberLabelPrefix} W`}
            type="number"
            min={MIN_ROI_SIZE}
            max={1}
            step={0.01}
            value={roi.w.toFixed(4)}
            onChange={(event) => onNumberChange("w", event.target.value)}
          />
        </label>
        <label className="roi-number-control">
          <span>H</span>
          <input
            aria-label={`${numberLabelPrefix} H`}
            type="number"
            min={MIN_ROI_SIZE}
            max={1}
            step={0.01}
            value={roi.h.toFixed(4)}
            onChange={(event) => onNumberChange("h", event.target.value)}
          />
        </label>
      </div>
    </div>
  );
}

function RoiOverlay({
  label,
  roi,
  tone = "message",
  onChange,
}: {
  label: string;
  roi: NormalizedRoi;
  tone?: "message" | "hud" | "vs";
  onChange: (nextRoi: NormalizedRoi) => void;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);

  const updateRoiFromPointer = useCallback(
    (event: PointerEvent) => {
      const overlay = overlayRef.current;
      const dragState = dragStateRef.current;

      if (!overlay || !dragState) {
        return;
      }

      const rect = overlay.getBoundingClientRect();
      const deltaX = (event.clientX - dragState.startX) / rect.width;
      const deltaY = (event.clientY - dragState.startY) / rect.height;
      const start = dragState.startRoi;
      let next = start;

      if (dragState.mode === "move") {
        next = {
          ...start,
          x: clamp(start.x + deltaX, 0, 1 - start.w),
          y: clamp(start.y + deltaY, 0, 1 - start.h),
        };
      }

      if (dragState.mode === "resize-nw") {
        const nextX = clamp(start.x + deltaX, 0, start.x + start.w - MIN_ROI_SIZE);
        const nextY = clamp(start.y + deltaY, 0, start.y + start.h - MIN_ROI_SIZE);
        next = {
          x: nextX,
          y: nextY,
          w: start.w + (start.x - nextX),
          h: start.h + (start.y - nextY),
        };
      }

      if (dragState.mode === "resize-ne") {
        const nextY = clamp(start.y + deltaY, 0, start.y + start.h - MIN_ROI_SIZE);
        next = {
          x: start.x,
          y: nextY,
          w: clamp(start.w + deltaX, MIN_ROI_SIZE, 1 - start.x),
          h: start.h + (start.y - nextY),
        };
      }

      if (dragState.mode === "resize-sw") {
        const nextX = clamp(start.x + deltaX, 0, start.x + start.w - MIN_ROI_SIZE);
        next = {
          x: nextX,
          y: start.y,
          w: start.w + (start.x - nextX),
          h: clamp(start.h + deltaY, MIN_ROI_SIZE, 1 - start.y),
        };
      }

      if (dragState.mode === "resize-se") {
        next = {
          x: start.x,
          y: start.y,
          w: clamp(start.w + deltaX, MIN_ROI_SIZE, 1 - start.x),
          h: clamp(start.h + deltaY, MIN_ROI_SIZE, 1 - start.y),
        };
      }

      onChange({
        x: roundRoiValue(next.x),
        y: roundRoiValue(next.y),
        w: roundRoiValue(next.w),
        h: roundRoiValue(next.h),
      });
    },
    [onChange],
  );

  const stopDrag = useCallback(() => {
    dragStateRef.current = null;
    window.removeEventListener("pointermove", updateRoiFromPointer);
    window.removeEventListener("pointerup", stopDrag);
  }, [updateRoiFromPointer]);

  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, mode: DragMode) => {
      event.preventDefault();
      event.stopPropagation();
      dragStateRef.current = {
        mode,
        startX: event.clientX,
        startY: event.clientY,
        startRoi: roi,
      };
      window.addEventListener("pointermove", updateRoiFromPointer);
      window.addEventListener("pointerup", stopDrag);
    },
    [roi, stopDrag, updateRoiFromPointer],
  );

  useEffect(() => stopDrag, [stopDrag]);

  return (
    <div ref={overlayRef} className="roi-layer" aria-label={`${label} adjustment layer`}>
      <div
        className={`roi-box roi-box--${tone}`}
        style={{
          left: `${roi.x * 100}%`,
          top: `${roi.y * 100}%`,
          width: `${roi.w * 100}%`,
          height: `${roi.h * 100}%`,
        }}
      >
        <button
          type="button"
          className="roi-move"
          aria-label={`${label}をドラッグして移動`}
          onPointerDown={(event) => startDrag(event, "move")}
        >
          <span>{label}</span>
        </button>
        <button
          type="button"
          className="roi-handle roi-handle--nw"
          aria-label={`${label}左上をリサイズ`}
          onPointerDown={(event) => startDrag(event, "resize-nw")}
        />
        <button
          type="button"
          className="roi-handle roi-handle--ne"
          aria-label={`${label}右上をリサイズ`}
          onPointerDown={(event) => startDrag(event, "resize-ne")}
        />
        <button
          type="button"
          className="roi-handle roi-handle--sw"
          aria-label={`${label}左下をリサイズ`}
          onPointerDown={(event) => startDrag(event, "resize-sw")}
        />
        <button
          type="button"
          className="roi-handle roi-handle--se"
          aria-label={`${label}右下をリサイズ`}
          onPointerDown={(event) => startDrag(event, "resize-se")}
        />
      </div>
    </div>
  );
}
