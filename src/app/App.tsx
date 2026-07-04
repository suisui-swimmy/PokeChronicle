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
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import fullscreenExitIconUrl from "../assets/icons/fullscreen-exit.svg";
import fullscreenIconUrl from "../assets/icons/fullscreen.svg";
import reloadIconUrl from "../assets/icons/reload.svg";
import uploadIconUrl from "../assets/icons/upload.svg";
import volumeMutedIconUrl from "../assets/icons/volume-muted.svg";
import volumeIconUrl from "../assets/icons/volume.svg";
import {
  type BattleLogDocument,
  type BattleLogFrameEvidence,
  type BattleLogMediaMetadata,
  type BattleEvent,
  type NormalizedRoi,
  type OCRMessage,
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
import type { DictionaryEntry } from "../core/dictionary/types";
import {
  createMessageLineCropVariants,
  preprocessMessageImageDataWithMetrics,
  type MessagePreprocessOptions,
} from "../core/preprocess/messagePreprocess";
import { mapDisplayRoiToSourceRect } from "../core/media/roiMapping";
import { createTesseractWorkerConfig } from "../core/ocr/tesseractConfig";
import type {
  OCRWorkerJobMeta,
  OCRWorkerRequest,
  OCRWorkerResponse,
} from "../core/ocr/workerMessages";
import {
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
const DEFAULT_ROI: NormalizedRoi = { x: 0.33, y: 0.72, w: 0.3, h: 0.14 };
const MIN_ROI_SIZE = 0.08;
const NO_AUDIO_DEVICE_ID = "none";
const DEFAULT_SAMPLE_FPS = 3;
const MAX_FRAME_BUFFER = 8;
const MAX_OCR_LOGS = 30;
const MAX_OCR_MESSAGES = 80;
const MAX_TIMELINE_ITEMS = 48;
const MAX_UNKNOWN_EVENTS = 48;
const MAX_CROP_EVIDENCE = 80;
const OCR_RAW_GROUP_LIMIT = 30;
const DEFAULT_RESOLVED_LOG_PANEL_WIDTH = 260;
const MIN_RESOLVED_LOG_PANEL_WIDTH = 180;
const MAX_RESOLVED_LOG_PANEL_WIDTH = 520;
const MIN_PREVIEW_PANEL_WIDTH = 360;
const WORKSPACE_RESIZER_WIDTH = 12;
const DEFAULT_AUDIO_VOLUME = 1;
const RESOLVED_LOG_RESIZE_STEP = 24;
const MAX_PENDING_OCR_JOBS = 1;
const OCR_JOB_TIMEOUT_MS = 60_000;
const TIMELINE_DUPLICATE_WINDOW_MS = 2500;
const MAX_SESSION_ROSTER_DICTIONARY_ENTRIES = 18;
const MAX_OBSERVED_MOVE_DICTIONARY_ENTRIES = 96;
const MIN_TEXT_PIXEL_RATIO = 0.004;
const MAX_TEXT_PIXEL_RATIO = 0.18;
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
  ocrDataUrl: string;
  ocrVariantId: string;
  ocrForegroundPixelRatio: number;
  lineBandCount: number;
  lineCropVariants: ProcessedLineCropPreview[];
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

const REVIEW_TABS: Array<{ id: ReviewTab; label: string }> = [
  { id: "timeline", label: "Timeline" },
  { id: "resolved", label: "解決済み" },
  { id: "unknown", label: "Unknown" },
  { id: "ocr", label: "OCR Raw" },
  { id: "system", label: "System" },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function roundRoiValue(value: number) {
  return Math.round(value * 10000) / 10000;
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

function formatAspect(metadata: MediaMetadata) {
  if (!metadata.width || !metadata.height) {
    return "未取得";
  }

  const aspect = metadata.width / metadata.height;

  if (Math.abs(aspect - ASPECT_16_BY_9) <= ASPECT_TOLERANCE) {
    return "16:9";
  }

  if (Math.abs(aspect - ASPECT_4_BY_3) <= ASPECT_TOLERANCE) {
    return "4:3";
  }

  return aspect.toFixed(2);
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

function getPositiveWidthOrNull(width: number | undefined) {
  return width && width > 0 ? width : null;
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
    heal: "回復",
    immune: "無効",
    item: "道具",
    miss: "外れ",
    move: "技",
    protect: "まもる",
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

  const actor = result.event.actor.name ? ` / ${result.event.actor.name}` : "";
  const move = result.event.move ? ` / ${result.event.move}` : "";

  return `${formatEventType(result.event.type)} / ${result.event.classification.method}${actor}${move}`;
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
  while (map.size > maxSize) {
    const firstKey = map.keys().next().value as TKey | undefined;

    if (firstKey === undefined) {
      return;
    }

    map.delete(firstKey);
  }
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
      return {
        deviceId: device.deviceId,
        kind,
        label:
          device.label ||
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

function captureRoiFrame(
  source: FrameSourceElement,
  roi: NormalizedRoi,
  preprocess: MessagePreprocessOptions,
  upscaleFactor: number,
): CapturedFrameImages | null {
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
  const { imageData: processedImageData, metrics } = preprocessMessageImageDataWithMetrics(
    rawImageData,
    preprocess,
  );
  const scale = Math.max(1, Math.round(upscaleFactor));
  const processedDataUrl = imageDataToScaledDataUrl(processedImageData, scale);

  if (!processedDataUrl) {
    return null;
  }

  const lineCropVariants = createMessageLineCropVariants(processedImageData, preprocess);
  const lineCropPreviews: ProcessedLineCropPreview[] = [];

  for (const variant of lineCropVariants) {
    const dataUrl = variant.id === "full"
      ? processedDataUrl
      : imageDataToScaledDataUrl(variant.imageData, scale);

    if (!dataUrl) {
      continue;
    }

    lineCropPreviews.push({
      id: variant.id,
      processedDataUrl: dataUrl,
      cropWidth: variant.imageData.width,
      cropHeight: variant.imageData.height,
      sourceY: variant.y,
      lineCount: variant.lineCount,
      foregroundPixelRatio: variant.metrics.foregroundPixelRatio,
    });
  }

  const detectedLineCount = lineCropVariants[0]?.lineCount ?? 0;
  const preferredLineCount = Math.min(3, detectedLineCount);
  const preferredVariant =
    lineCropPreviews.find((variant) => variant.id === `top-${preferredLineCount}-lines`) ??
    lineCropPreviews[0] ?? {
      id: "full",
      processedDataUrl,
      cropWidth: crop.width,
      cropHeight: crop.height,
      sourceY: 0,
      lineCount: detectedLineCount,
      foregroundPixelRatio: metrics.foregroundPixelRatio,
    };

  return {
    rawDataUrl: rawCanvas.toDataURL("image/png"),
    processedDataUrl,
    ocrDataUrl: preferredVariant.processedDataUrl,
    ocrVariantId: preferredVariant.id,
    ocrForegroundPixelRatio: preferredVariant.foregroundPixelRatio,
    lineBandCount: detectedLineCount,
    lineCropVariants: lineCropPreviews,
    sourceWidth,
    sourceHeight,
    cropWidth: crop.width,
    cropHeight: crop.height,
    foregroundPixelCount: metrics.foregroundPixelCount,
    totalPixelCount: metrics.totalPixelCount,
    foregroundPixelRatio: metrics.foregroundPixelRatio,
  };
}

export function App() {
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
  const objectUrlRef = useRef<string | null>(null);
  const audioInputStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioGainNodeRef = useRef<GainNode | null>(null);
  const audioSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const samplingTimerRef = useRef<number | null>(null);
  const ocrWorkerRef = useRef<Worker | null>(null);
  const cropEvidenceBySourceRef = useRef<Map<string, CropEvidence>>(new Map());
  const lastTimelineDeduplicationRef = useRef<TimelineDeduplicationRecord | null>(null);
  const recentConstrainedCandidateRecordsRef = useRef<TimelineConstrainedCandidateRecord[]>([]);
  const recentAcceptedEventRecordsRef = useRef<TimelineAcceptedEventRecord[]>([]);
  const sessionRosterDictionaryRef = useRef<DictionaryEntry[]>([]);
  const observedMoveDictionaryRef = useRef<DictionaryEntry[]>([]);
  const lastAcceptedEventIdRef = useRef<string | null>(null);
  const frameIndexRef = useRef(0);
  const ocrJobCounterRef = useRef(0);
  const pendingOcrJobsRef = useRef(0);
  const activeOcrJobRef = useRef<ActiveOcrJob | null>(null);
  const templateRulesRef = useRef<readonly BattleTemplateRule[]>(STANDARD_TEMPLATE_RULES);
  const samplingStartMsRef = useRef(0);
  const isOcrEnabledRef = useRef(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [mediaMode, setMediaMode] = useState<MediaMode>("idle");
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [videoDevices, setVideoDevices] = useState<InputDevice[]>([]);
  const [audioDevices, setAudioDevices] = useState<InputDevice[]>([]);
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState("");
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState(NO_AUDIO_DEVICE_ID);
  const [statusLabel, setStatusLabel] = useState("待機中");
  const [metadata, setMetadata] = useState<MediaMetadata>({
    width: null,
    height: null,
    frameRate: null,
  });
  const [audioReady, setAudioReady] = useState(false);
  const [audioVolume, setAudioVolume] = useState(DEFAULT_AUDIO_VOLUME);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVolumePanelOpen, setIsVolumePanelOpen] = useState(false);
  const [roi, setRoi] = useState<NormalizedRoi>(DEFAULT_ROI);
  const [isRoiVisible, setIsRoiVisible] = useState(true);
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
  const [battleEvents, setBattleEvents] = useState<BattleEvent[]>([]);
  const [unknownEvents, setUnknownEvents] = useState<UnknownEvent[]>([]);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [suppressedTimelineCount, setSuppressedTimelineCount] = useState(0);
  const [resolvedLogPanelWidth, setResolvedLogPanelWidth] = useState<number | null>(null);
  const [isResizingResolvedLogPanel, setIsResizingResolvedLogPanel] = useState(false);
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
  const mediaModeRef = useRef(mediaMode);
  const preprocessOptionsRef = useRef(preprocessOptions);
  const upscaleFactorRef = useRef(upscaleFactor);

  const addLog = useCallback((message: string, level: LogLevel = "info") => {
    setLogs((currentLogs) => [createLog(message, level), ...currentLogs].slice(0, 12));
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

      setOcrLogs((currentLogs) => [errorEntry, ...currentLogs].slice(0, MAX_OCR_LOGS));
    },
    [],
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

  const handleOcrWorkerMessage = useCallback(
    (event: MessageEvent<OCRWorkerResponse>) => {
      const response = event.data;

      if (response.type === "progress") {
        setOcrProgress(response.progress);
        setOcrStatusLabel(`${response.status} ${formatProgress(response.progress)}`);
        return;
      }

      if (response.type === "result") {
        clearActiveOcrJob(response.jobId);
        setPendingOcrJobCount(pendingOcrJobsRef.current - 1);
        const parseResult = parseBattleMessage({
          rawText: response.result.rawText,
          ocrConfidence: response.result.confidence,
          lines: response.result.lines.map((line) => line.text),
        }, undefined, {
          templateRules: templateRulesRef.current,
          sessionRosterDictionary: sessionRosterDictionaryRef.current,
          observedMoveDictionary: observedMoveDictionaryRef.current,
        });
        const normalizedText = parseResult.normalizedText;
        const hasText = normalizedText.length > 0;
        const nextEntry: OCRLogEntry = {
          id: response.jobId,
          frameIndex: response.meta.frameIndex,
          timestampMs: response.meta.timestampMs,
          rawText: response.result.rawText,
          normalizedText,
          matchText: parseResult.matchText,
          parseResult,
          confidence: response.result.confidence,
          lineCount: response.result.lines.length,
          status: hasText ? "recognized" : "empty",
        };
        const observation = createTimelineObservation({
          id: response.jobId,
          battleId: LIVE_BATTLE_ID,
          rawText: response.result.rawText,
          parseResult,
          ocrConfidence: response.result.confidence,
          lines: response.result.lines,
          frameIndex: response.meta.frameIndex,
          timestampMs: response.meta.timestampMs,
          roi: response.meta.roi,
          afterEventId: lastAcceptedEventIdRef.current,
          recentConstrainedCandidates: recentConstrainedCandidateRecordsRef.current,
          recentAcceptedEvents: recentAcceptedEventRecordsRef.current,
          candidatePromotionWindowMs: TIMELINE_DUPLICATE_WINDOW_MS,
        });
        const constrainedCandidateRecord = createConstrainedCandidateRecord(
          parseResult,
          response.meta.timestampMs,
          response.meta.frameIndex,
        );
        const suppressTimelineItem = shouldSuppressTimelineObservation(
          lastTimelineDeduplicationRef.current,
          observation.dedupe,
          TIMELINE_DUPLICATE_WINDOW_MS,
        );

        if (constrainedCandidateRecord) {
          const minTimestampMs = response.meta.timestampMs - TIMELINE_DUPLICATE_WINDOW_MS;
          recentConstrainedCandidateRecordsRef.current = [
            constrainedCandidateRecord,
            ...recentConstrainedCandidateRecordsRef.current.filter(
              (record) => record.timestampMs >= minTimestampMs,
            ),
          ].slice(0, 12);
        }

        if (observation.event) {
          rememberBattleEventDictionaries(observation.event);
          rememberAcceptedEventRecord(observation.event);
        }

        setOcrLogs((currentLogs) => [nextEntry, ...currentLogs].slice(0, MAX_OCR_LOGS));
        setOcrMessages((currentMessages) =>
          [observation.ocrMessage, ...currentMessages].slice(0, MAX_OCR_MESSAGES),
        );

        if (suppressTimelineItem) {
          setSuppressedTimelineCount((currentCount) => currentCount + 1);

          if (observation.dedupe) {
            lastTimelineDeduplicationRef.current = observation.dedupe;
          }
        } else {
          if (observation.event) {
            lastAcceptedEventIdRef.current = observation.event.id;
            setBattleEvents((currentEvents) =>
              [observation.event as BattleEvent, ...currentEvents].slice(0, MAX_TIMELINE_ITEMS),
            );
          }

          if (observation.unknown) {
            setUnknownEvents((currentUnknowns) =>
              [observation.unknown as UnknownEvent, ...currentUnknowns].slice(
                0,
                MAX_UNKNOWN_EVENTS,
              ),
            );
          }

          if (observation.dedupe) {
            lastTimelineDeduplicationRef.current = observation.dedupe;
          }
        }

        setOcrProgress(0);
        setOcrStatusLabel(hasText ? "認識済み" : "空候補");
        return;
      }

      if (response.type === "error") {
        clearActiveOcrJob(response.jobId);
        setPendingOcrJobCount(pendingOcrJobsRef.current - 1);
        setOcrProgress(0);
        setOcrStatusLabel("OCR失敗");
        appendOcrErrorLog(response.jobId, response.meta, response.message);

        if (response.recoverable === false) {
          resetOcrWorkerAfterFailure(`OCR workerが停止しました: ${response.message}`);
        }

        addLog(`OCRに失敗しました: ${response.message}`, "error");
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
      appendOcrErrorLog,
      clearActiveOcrJob,
      rememberAcceptedEventRecord,
      rememberBattleEventDictionaries,
      resetOcrWorkerAfterFailure,
      setPendingOcrJobCount,
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
      if (activeJob) {
        appendOcrErrorLog(activeJob.jobId, activeJob.meta, message);
      }
      resetOcrWorkerAfterFailure(`OCR workerの起動または実行に失敗しました: ${message}`, activeJob);
    };
    worker.onmessageerror = () => {
      const activeJob = activeOcrJobRef.current;
      const message = "OCR workerからの応答を読み取れませんでした。";
      if (activeJob) {
        appendOcrErrorLog(activeJob.jobId, activeJob.meta, message);
      }
      resetOcrWorkerAfterFailure(message, activeJob);
    };
    ocrWorkerRef.current = worker;

    return worker;
  }, [appendOcrErrorLog, handleOcrWorkerMessage, resetOcrWorkerAfterFailure]);

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
      isOcrEnabledRef.current = false;
      setIsOcrEnabled(false);
      clearActiveOcrJob();
      setPendingOcrJobCount(0);
      setOcrProgress(0);
      setOcrStatusLabel("停止中");
      requestOcrWorkerShutdown();

      if (message) {
        addLog(message);
      }
    },
    [addLog, clearActiveOcrJob, requestOcrWorkerShutdown, setPendingOcrJobCount],
  );

  const queueOcrRecognition = useCallback(
    (sample: FrameSample) => {
      if (!isOcrEnabledRef.current) {
        return;
      }

      if (
        sample.ocrForegroundPixelRatio < MIN_TEXT_PIXEL_RATIO ||
        sample.ocrForegroundPixelRatio > MAX_TEXT_PIXEL_RATIO
      ) {
        setOcrStatusLabel(
          `OCR skipped: text density gate (${formatTextDensity(sample.ocrForegroundPixelRatio)})`,
        );
        return;
      }

      if (pendingOcrJobsRef.current >= MAX_PENDING_OCR_JOBS) {
        return;
      }

      const worker = ensureOcrWorker();
      const nextPendingCount = pendingOcrJobsRef.current + 1;
      const jobId = `ocr-${ocrJobCounterRef.current + 1}`;
      const sourceFrameRef = createSourceFrameRef(sample.frameIndex, sample.timestampMs);
      const meta: OCRWorkerJobMeta = {
        cropHeight: sample.cropHeight,
        cropWidth: sample.cropWidth,
        frameIndex: sample.frameIndex,
        roi: sample.roi,
        timestampMs: sample.timestampMs,
      };
      const message: OCRWorkerRequest = {
        type: "recognize",
        jobId,
        imageDataUrl: sample.ocrDataUrl,
        meta,
        config: OCR_WORKER_CONFIG,
      };
      const timeoutId = window.setTimeout(() => {
        const activeJob = activeOcrJobRef.current;

        if (!activeJob || activeJob.jobId !== jobId) {
          return;
        }

        appendOcrErrorLog(
          activeJob.jobId,
          activeJob.meta,
          `OCR job timed out after ${Math.round(OCR_JOB_TIMEOUT_MS / 1000)}s.`,
        );
        resetOcrWorkerAfterFailure(
          "OCRの応答が一定時間返らなかったため、workerを再起動できる状態に戻しました。",
          activeJob,
        );
      }, OCR_JOB_TIMEOUT_MS);

      ocrJobCounterRef.current += 1;
      activeOcrJobRef.current = { jobId, meta, timeoutId };
      cropEvidenceBySourceRef.current.set(sourceFrameRef, {
        sourceFrameRef,
        rawDataUrl: sample.rawDataUrl,
        processedDataUrl: sample.processedDataUrl,
        cropWidth: sample.cropWidth,
        cropHeight: sample.cropHeight,
        capturedAt: sample.capturedAt,
      });
      pruneOldestMapEntries(cropEvidenceBySourceRef.current, MAX_CROP_EVIDENCE);
      setPendingOcrJobCount(nextPendingCount);
      setOcrStatusLabel("認識リクエスト送信");
      worker.postMessage(message);
    },
    [
      appendOcrErrorLog,
      ensureOcrWorker,
      resetOcrWorkerAfterFailure,
      setPendingOcrJobCount,
    ],
  );

  useEffect(() => {
    roiRef.current = roi;
  }, [roi]);

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
        addLog("このブラウザはデバイス一覧の取得に対応していません。", "error");
        return;
      }

      try {
        const mediaDevices = await navigator.mediaDevices.enumerateDevices();
        const nextVideoDevices = createDeviceOptions(mediaDevices, "videoinput");
        const nextAudioDevices = createDeviceOptions(mediaDevices, "audioinput");

        setVideoDevices(nextVideoDevices);
        setAudioDevices(nextAudioDevices);
        setSelectedVideoDeviceId((currentDeviceId) => {
          if (nextVideoDevices.some((device) => device.deviceId === currentDeviceId)) {
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
    (message?: string) => {
      if (samplingTimerRef.current !== null) {
        window.clearInterval(samplingTimerRef.current);
        samplingTimerRef.current = null;
      }

      setIsSampling(false);

      if (message) {
        addLog(message);
      }
    },
    [addLog],
  );

  const resetMedia = useCallback(() => {
    stopSampling();
    stopOcr();
    stopTracks(stream);
    stopAudioInput();
    clearObjectUrl();
    setStream(null);
    mediaModeRef.current = "idle";
    setMediaMode("idle");
    setFilePreviewUrl(null);
    setFrameSamples([]);
    setStatusLabel("待機中");
    setMetadata({ width: null, height: null, frameRate: null });

    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.removeAttribute("src");
    }
  }, [clearObjectUrl, stopAudioInput, stopOcr, stopSampling, stopTracks, stream]);

  useEffect(() => {
    return () => {
      if (samplingTimerRef.current !== null) {
        window.clearInterval(samplingTimerRef.current);
      }

      clearActiveOcrJob();
      stopTracks(stream);
      clearObjectUrl();
      ocrWorkerRef.current?.terminate();
    };
  }, [clearActiveOcrJob, clearObjectUrl, stopTracks, stream]);

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
        setStatusLabel("非対応");
        return false;
      }

      if (videoDevices.length === 0) {
        addLog("映像デバイスが見つかりません。", "warn");
        setStatusLabel("未選択");
        return false;
      }

      const nextVideoDeviceId = videoDeviceId || videoDevices[0]?.deviceId || "";
      const nextAudioDeviceId = audioDeviceId || NO_AUDIO_DEVICE_ID;
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
        warmAudioOutput();
        const deviceStream = await requestPreferredVideoStream(nextVideoDeviceId);

        const [videoTrack] = deviceStream.getVideoTracks();
        videoTrack?.addEventListener(
          "ended",
          () => {
            setStream(null);
            mediaModeRef.current = "idle";
            setMediaMode("idle");
            setStatusLabel("停止済み");
            addLog("入力デバイスの映像トラックが停止しました。");
          },
          { once: true },
        );

        if (videoRef.current) {
          videoRef.current.srcObject = deviceStream;
          videoRef.current.muted = true;
          await playVideoElement(videoRef.current);
        }

        setStream(deviceStream);
        mediaModeRef.current = "device";
        setMediaMode("device");
        setStatusLabel("キャプチャ中");
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
        addLog(`入力を開始しました: ${selectedVideoLabel} / ${selectedAudioLabel}`);
        return true;
      } catch (error) {
        const message =
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "カメラまたはマイクの権限が拒否されました。"
            : "入力デバイスの開始に失敗しました。";
        addLog(message, "error");
        setStatusLabel("開始失敗");
        return false;
      }
    },
    [
      addLog,
      audioDevices,
      refreshDevices,
      requestSelectedAudioStream,
      resetMedia,
      selectedAudioDeviceId,
      selectedVideoDeviceId,
      setupAudioPlayback,
      stopAudioInput,
      videoDevices,
      warmAudioOutput,
    ],
  );

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
      setStatusLabel("ファイル表示中");
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
      };

      setFrameSamples((currentSamples) =>
        [nextSample, ...currentSamples].slice(0, MAX_FRAME_BUFFER),
      );
      queueOcrRecognition(nextSample);

      return true;
    },
    [addLog, queueOcrRecognition],
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
    samplingStartMsRef.current = performance.now();
    setFrameSamples([]);
    setIsSampling(true);
    captureCurrentFrame({ logFailure: true });
    samplingTimerRef.current = window.setInterval(
      () => captureCurrentFrame(),
      Math.round(1000 / sampleFps),
    );
    addLog(`フレームサンプリングを開始しました (${sampleFps}fps)。`);
  }, [addLog, captureCurrentFrame, sampleFps]);

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
    setOcrMessages([]);
    setBattleEvents([]);
    setUnknownEvents([]);
    setReviewNotes({});
    setSuppressedTimelineCount(0);
    cropEvidenceBySourceRef.current.clear();
    lastTimelineDeduplicationRef.current = null;
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
  }, [addLog, ensureOcrWorker, handleStartSampling]);

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
    const shouldStopSampling = samplingTimerRef.current !== null;

    if (shouldStopOcr) {
      stopOcr("リアルタイムOCRログを停止しました。");
    }

    if (shouldStopSampling) {
      stopSampling("フレームサンプリングを停止しました。");
    }
  }, [stopOcr, stopSampling]);

  const handleToggleAudioMuted = useCallback(() => {
    if (isAudioMuted || audioVolume === 0) {
      if (audioVolume === 0) {
        setAudioVolume(DEFAULT_AUDIO_VOLUME);
      }

      setIsAudioMuted(false);
      return;
    }

    setIsAudioMuted(true);
  }, [audioVolume, isAudioMuted]);

  const handleAudioVolumeChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextVolume = clamp(Number(event.target.value), 0, 1);

    setAudioVolume(nextVolume);
    setIsAudioMuted(nextVolume === 0);
  }, []);

  const handleResetRoi = useCallback(() => {
    setRoi(DEFAULT_ROI);
    addLog("ROIを初期位置へ戻しました。");
  }, [addLog]);

  const handleRoiNumberChange = useCallback((field: RoiField, value: string) => {
    setRoi((currentRoi) => updateRoiField(currentRoi, field, Number(value)));
  }, []);

  const statusTone = useMemo(() => {
    if (statusLabel.includes("失敗") || statusLabel === "非対応") {
      return "danger";
    }

    if (statusLabel === "キャプチャ中" || statusLabel === "ファイル表示中") {
      return "active";
    }

    return "idle";
  }, [statusLabel]);

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
  const captureMainStyle = useMemo(
    () =>
      resolvedLogPanelWidth === null
        ? undefined
        : ({
            "--resolved-log-width": `${resolvedLogPanelWidth}px`,
          } as CSSProperties),
    [resolvedLogPanelWidth],
  );
  const captureMainClassName = `capture-main${
    isResizingResolvedLogPanel ? " capture-main--resizing" : ""
  }`;
  const resolvedLogPanelWidthValue =
    resolvedLogPanelWidth ?? DEFAULT_RESOLVED_LOG_PANEL_WIDTH;
  const updateResolvedLogPanelWidth = useCallback((width: number, containerWidth?: number | null) => {
    const nextContainerWidth =
      containerWidth === undefined
        ? (captureMainRef.current?.getBoundingClientRect().width ?? null)
        : containerWidth;
    setResolvedLogPanelWidth(clampResolvedLogPanelWidth(width, nextContainerWidth));
  }, []);
  const beginResolvedLogResize = useCallback(
    (clientX: number) => {
      const containerRect = captureMainRef.current?.getBoundingClientRect();
      const logPanelRect = resolvedLogPanelRef.current?.getBoundingClientRect();
      resolvedLogResizeSessionRef.current = {
        startX: clientX,
        startWidth:
          resolvedLogPanelWidth ??
          getPositiveWidthOrNull(logPanelRect?.width) ??
          DEFAULT_RESOLVED_LOG_PANEL_WIDTH,
        containerWidth: getPositiveWidthOrNull(containerRect?.width),
      };
      setIsResizingResolvedLogPanel(true);
    },
    [resolvedLogPanelWidth],
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
  const finishResolvedLogResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    resolvedLogResizeSessionRef.current = null;
    setIsResizingResolvedLogPanel(false);
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
  const handleResolvedLogResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const containerWidth = getPositiveWidthOrNull(
        captureMainRef.current?.getBoundingClientRect().width,
      );
      const currentWidth =
        resolvedLogPanelWidth ??
        getPositiveWidthOrNull(resolvedLogPanelRef.current?.getBoundingClientRect().width) ??
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
  const handleManagementTabClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, tab: ManagementTab) => {
      event.preventDefault();
      setActiveManagementTab((currentTab) => (currentTab === tab ? null : tab));
    },
    [],
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
      ocrMessages,
      events: battleEvents,
      unknowns: unknownEvents,
      frameEvidence,
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
    ocrMessages,
    reviewNotes,
    roi,
    unknownEvents,
  ]);

  const restoreBattleLogDocument = useCallback(
    (document: BattleLogDocument) => {
      const restoredEvents = sortNewestFirst(document.events);

      cropEvidenceBySourceRef.current = new Map(
        document.frameEvidence.map((evidence) => [
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
      setOcrMessages(sortNewestFirst(document.ocrMessages));
      setBattleEvents(restoredEvents);
      setUnknownEvents(sortNewestFirst(document.unknowns));
      setReviewNotes(
        Object.fromEntries(
          document.manualCorrections
            .filter((correction) => correction.note.trim().length > 0)
            .map((correction) => [correction.targetId, correction.note]),
        ),
      );
      setRoi(document.roiProfile.roi);
      setSuppressedTimelineCount(0);
      lastTimelineDeduplicationRef.current = null;
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
    [addLog],
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
      setUnknownEvents((currentUnknowns) =>
        currentUnknowns.map((unknown) =>
          unknown.id === unknownId ? { ...unknown, reviewStatus: "reviewed" } : unknown,
        ),
      );
      addLog(`unknown ${unknownId} をreviewedにしました。`);
    },
    [addLog],
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
        <div className="input-badge">
          <span className={`status-dot status-dot--${statusTone}`} aria-hidden="true" />
          <span className="input-badge-text">入力({formatAspect(metadata)})</span>
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
                />
              )}
              {mediaMode === "idle" ? (
                <div className="test-pattern" aria-label="preview placeholder">
                  <span>プレビュー待機中</span>
                </div>
              ) : null}
              {isRoiVisible ? <RoiOverlay roi={roi} onChange={setRoi} /> : null}
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

          <section className="management-panel" aria-label="analysis and data management">
            <Tabs value={activeManagementTab ?? "closed"} className="management-tabs">
              <TabsList className="management-tab-list" variant="line" aria-label="analysis tabs">
                <TabsTrigger
                  value="roi"
                  onClick={(event) => handleManagementTabClick(event, "roi")}
                >
                  ROI
                </TabsTrigger>
                <TabsTrigger
                  value="sampler"
                  onClick={(event) => handleManagementTabClick(event, "sampler")}
                >
                  サンプラー
                </TabsTrigger>
                <TabsTrigger
                  value="ocr"
                  onClick={(event) => handleManagementTabClick(event, "ocr")}
                >
                  OCR
                </TabsTrigger>
                <TabsTrigger
                  value="stats"
                  onClick={(event) => handleManagementTabClick(event, "stats")}
                >
                  統計
                </TabsTrigger>
                <TabsTrigger
                  value="data"
                  onClick={(event) => handleManagementTabClick(event, "data")}
                >
                  データ
                </TabsTrigger>
                <TabsTrigger
                  value="logs"
                  onClick={(event) => handleManagementTabClick(event, "logs")}
                >
                  ログ
                </TabsTrigger>
              </TabsList>

            <TabsContent value="roi" className="management-tab-panel">
          <section className="roi-settings-panel" aria-label="ROI settings">
            <div className="roi-settings-header">
              <div>
                <h2>ROI設定</h2>
                <span>
                  x={roi.x.toFixed(4)} y={roi.y.toFixed(4)} w={roi.w.toFixed(4)} h=
                  {roi.h.toFixed(4)}
                </span>
              </div>
              <div className="roi-setting-actions">
                <label className="toggle-control roi-visibility-toggle">
                  <input
                    type="checkbox"
                    checked={isRoiVisible}
                    onChange={(event) => setIsRoiVisible(event.target.checked)}
                  />
                  <span>ROI表示</span>
                </label>
                <Button
                  type="button"
                  variant="outline"
                  className="icon-button icon-button--compact"
                  onClick={handleResetRoi}
                >
                  <span aria-hidden="true">↺</span>
                  <span>ROIリセット</span>
                </Button>
              </div>
            </div>

            <details className="roi-detail-panel">
              <summary>詳細調整</summary>
            <div className="roi-number-grid" aria-label="ROI numeric settings">
              <label className="roi-number-control">
                <span>X</span>
                <input
                  aria-label="ROI X"
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={roi.x.toFixed(4)}
                  onChange={(event) => handleRoiNumberChange("x", event.target.value)}
                />
              </label>
              <label className="roi-number-control">
                <span>Y</span>
                <input
                  aria-label="ROI Y"
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={roi.y.toFixed(4)}
                  onChange={(event) => handleRoiNumberChange("y", event.target.value)}
                />
              </label>
              <label className="roi-number-control">
                <span>W</span>
                <input
                  aria-label="ROI W"
                  type="number"
                  min={MIN_ROI_SIZE}
                  max={1}
                  step={0.01}
                  value={roi.w.toFixed(4)}
                  onChange={(event) => handleRoiNumberChange("w", event.target.value)}
                />
              </label>
              <label className="roi-number-control">
                <span>H</span>
                <input
                  aria-label="ROI H"
                  type="number"
                  min={MIN_ROI_SIZE}
                  max={1}
                  step={0.01}
                  value={roi.h.toFixed(4)}
                  onChange={(event) => handleRoiNumberChange("h", event.target.value)}
                />
              </label>
            </div>
            </details>
          </section>
            </TabsContent>

            <TabsContent value="sampler" className="management-tab-panel">
          <section className="analysis-panel" aria-label="frame sampling and preprocessing">
            <div className="analysis-header">
              <div>
                <h2>フレームサンプラー</h2>
                <span>
                  {isSampling ? `${sampleFps}fps` : "停止中"} / {frameSamples.length}/
                  {MAX_FRAME_BUFFER}
                </span>
              </div>
              <div className="analysis-actions">
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
                      ? `${latestFrameSample.upscaleFactor}x / ${latestFrameSample.preprocess.whiteThreshold} / text ${formatTextDensity(latestFrameSample.foregroundPixelRatio)} / OCR ${latestFrameSample.ocrVariantId} ${formatTextDensity(latestFrameSample.ocrForegroundPixelRatio)}`
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
            <section className="ocr-panel" aria-label="realtime OCR log">
              <div className="ocr-header">
                <div>
                  <h2>リアルタイムOCR</h2>
                  <span>
                    {ocrStatusLabel} / pending {pendingOcrJobs} / {formatConfidence(
                      latestOcrLog?.confidence ?? null,
                    )}
                  </span>
                </div>
                <div className="analysis-actions">
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

            <TabsContent value="stats" className="management-tab-panel management-tab-panel--empty" />

            <TabsContent value="data" className="management-tab-panel">
          <section className="data-management-panel" aria-label="data import export and review details">
            <div className="panel-heading panel-heading--compact">
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
          <section className="log-review-panel" aria-label="log review details">
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
                    {battleEvents.length === 0 ? (
                      <li className="timeline-empty">解決ログ空</li>
                    ) : (
                      battleEvents.map((event) => {
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
                    {unknownEvents.length === 0 ? (
                      <li className="timeline-empty">unknown空</li>
                    ) : (
                      unknownEvents.map((unknown) => (
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
          aria-label="解決済みログ"
        >
          <ol className="resolved-text-log" aria-label="resolved text log">
            {battleEvents.length === 0 ? (
              <li className="resolved-text-log-empty">解決ログ空</li>
            ) : (
              battleEvents.map((event) => (
                <li key={event.id}>{formatCanonicalEventText(event)}</li>
              ))
            )}
          </ol>
        </aside>

      </section>

    </main>
  );
}

function RoiOverlay({
  roi,
  onChange,
}: {
  roi: NormalizedRoi;
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
    <div ref={overlayRef} className="roi-layer" aria-label="ROI adjustment layer">
      <div
        className="roi-box"
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
          aria-label="ROIをドラッグして移動"
          onPointerDown={(event) => startDrag(event, "move")}
        >
          <span>ROI</span>
        </button>
        <button
          type="button"
          className="roi-handle roi-handle--nw"
          aria-label="ROI左上をリサイズ"
          onPointerDown={(event) => startDrag(event, "resize-nw")}
        />
        <button
          type="button"
          className="roi-handle roi-handle--ne"
          aria-label="ROI右上をリサイズ"
          onPointerDown={(event) => startDrag(event, "resize-ne")}
        />
        <button
          type="button"
          className="roi-handle roi-handle--sw"
          aria-label="ROI左下をリサイズ"
          onPointerDown={(event) => startDrag(event, "resize-sw")}
        />
        <button
          type="button"
          className="roi-handle roi-handle--se"
          aria-label="ROI右下をリサイズ"
          onPointerDown={(event) => startDrag(event, "resize-se")}
        />
      </div>
    </div>
  );
}
