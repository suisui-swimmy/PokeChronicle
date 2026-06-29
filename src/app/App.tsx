import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { APP_ROUTES } from "./routes";
import { BATTLE_LOG_SCHEMA_VERSION, type NormalizedRoi } from "../core/events/schema";
import {
  preprocessMessageImageData,
  type MessagePreprocessOptions,
} from "../core/preprocess/messagePreprocess";
import { mapDisplayRoiToSourceRect } from "../core/media/roiMapping";

const MILESTONES = [
  { id: "M0", label: "静的アプリ基盤", status: "完了" },
  { id: "M1", label: "キャプチャ表示とROI調整", status: "完了" },
  { id: "M2", label: "フレームサンプリングと前処理preview", status: "進行中" },
];

const DEFAULT_ROI: NormalizedRoi = { x: 0.06, y: 0.72, w: 0.88, h: 0.2 };
const MIN_ROI_SIZE = 0.08;
const NO_AUDIO_DEVICE_ID = "none";
const DEFAULT_SAMPLE_FPS = 3;
const MAX_FRAME_BUFFER = 8;
const DEFAULT_PREPROCESS_OPTIONS: MessagePreprocessOptions = {
  whiteThreshold: 180,
  background: "black",
  invert: false,
};
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

type FrameSourceElement = HTMLVideoElement | HTMLImageElement;

type CapturedFrameImages = {
  rawDataUrl: string;
  processedDataUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  cropWidth: number;
  cropHeight: number;
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function roundRoiValue(value: number) {
  return Math.round(value * 10000) / 10000;
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
          (kind === "videoinput" ? `映像ソース ${deviceIndex}` : `音声ソース ${deviceIndex}`),
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
  const processedImageData = preprocessMessageImageData(rawImageData, preprocess);
  const processedCanvas = document.createElement("canvas");
  processedCanvas.width = crop.width;
  processedCanvas.height = crop.height;
  const processedContext = processedCanvas.getContext("2d");

  if (!processedContext) {
    return null;
  }

  processedContext.putImageData(processedImageData, 0, 0);

  const scale = Math.max(1, Math.round(upscaleFactor));
  const scaledCanvas = document.createElement("canvas");
  scaledCanvas.width = crop.width * scale;
  scaledCanvas.height = crop.height * scale;
  const scaledContext = scaledCanvas.getContext("2d");

  if (!scaledContext) {
    return null;
  }

  scaledContext.imageSmoothingEnabled = false;
  scaledContext.drawImage(processedCanvas, 0, 0, scaledCanvas.width, scaledCanvas.height);

  return {
    rawDataUrl: rawCanvas.toDataURL("image/png"),
    processedDataUrl: scaledCanvas.toDataURL("image/png"),
    sourceWidth,
    sourceHeight,
    cropWidth: crop.width,
    cropHeight: crop.height,
  };
}

export function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imagePreviewRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const audioInputStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioGainNodeRef = useRef<GainNode | null>(null);
  const audioSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const samplingTimerRef = useRef<number | null>(null);
  const frameIndexRef = useRef(0);
  const samplingStartMsRef = useRef(0);
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
  const [roi, setRoi] = useState<NormalizedRoi>(DEFAULT_ROI);
  const [sampleFps, setSampleFps] = useState(DEFAULT_SAMPLE_FPS);
  const [isSampling, setIsSampling] = useState(false);
  const [preprocessOptions, setPreprocessOptions] =
    useState<MessagePreprocessOptions>(DEFAULT_PREPROCESS_OPTIONS);
  const [upscaleFactor, setUpscaleFactor] = useState(2);
  const [frameSamples, setFrameSamples] = useState<FrameSample[]>([]);
  const [logs, setLogs] = useState<SystemLog[]>(() => [
    createLog("M1 capture workspace initialized."),
  ]);
  const roiRef = useRef(roi);
  const mediaModeRef = useRef(mediaMode);
  const preprocessOptionsRef = useRef(preprocessOptions);
  const upscaleFactorRef = useRef(upscaleFactor);

  const addLog = useCallback((message: string, level: LogLevel = "info") => {
    setLogs((currentLogs) => [createLog(message, level), ...currentLogs].slice(0, 12));
  }, []);

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
    stopTracks(stream);
    stopAudioInput();
    clearObjectUrl();
    setStream(null);
    setMediaMode("idle");
    setFilePreviewUrl(null);
    setFrameSamples([]);
    setStatusLabel("待機中");
    setMetadata({ width: null, height: null, frameRate: null });

    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.removeAttribute("src");
    }
  }, [clearObjectUrl, stopAudioInput, stopSampling, stopTracks, stream]);

  useEffect(() => {
    return () => {
      if (samplingTimerRef.current !== null) {
        window.clearInterval(samplingTimerRef.current);
      }

      stopTracks(stream);
      clearObjectUrl();
    };
  }, [clearObjectUrl, stopTracks, stream]);

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
        audioGainNodeRef.current.gain.value = 1;
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
    [addLog, resumeAudioContext, warmAudioOutput],
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

  const handleStartCapture = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      addLog("このブラウザはカメラ入力に対応していません。", "error");
      setStatusLabel("非対応");
      return;
    }

    if (videoDevices.length === 0) {
      addLog("映像ソースが見つかりません。", "warn");
      setStatusLabel("未選択");
      return;
    }

    const selectedVideoLabel = getDeviceLabel(videoDevices, selectedVideoDeviceId, "選択中の映像ソース");
    const selectedAudioLabel =
      selectedAudioDeviceId === NO_AUDIO_DEVICE_ID
        ? "音声なし"
        : getDeviceLabel(audioDevices, selectedAudioDeviceId, "選択中の音声ソース");

    try {
      resetMedia();
      warmAudioOutput();
      const deviceStream = await requestPreferredVideoStream(selectedVideoDeviceId);

      const [videoTrack] = deviceStream.getVideoTracks();
      videoTrack?.addEventListener(
        "ended",
        () => {
          setStream(null);
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

      if (selectedAudioDeviceId !== NO_AUDIO_DEVICE_ID) {
        const audioStream = await requestSelectedAudioStream(selectedAudioDeviceId);

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
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "カメラまたはマイクの権限が拒否されました。"
          : "入力デバイスの開始に失敗しました。";
      addLog(message, "error");
      setStatusLabel("開始失敗");
    }
  }, [
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
  ]);

  const handleStopCapture = useCallback(() => {
    resetMedia();
    addLog("入力を停止しました。");
  }, [addLog, resetMedia]);

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
      setMediaMode(file.type.startsWith("image/") ? "image-file" : "video-file");
      setStatusLabel("ファイル表示中");
      addLog(`ファイルを読み込みました: ${file.name}`);
      event.target.value = "";
    },
    [addLog, resetMedia],
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

      return true;
    },
    [addLog],
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

  const handleResetRoi = useCallback(() => {
    setRoi(DEFAULT_ROI);
    addLog("ROIを初期位置へ戻しました。");
  }, [addLog]);

  const statusTone = useMemo(() => {
    if (statusLabel.includes("失敗") || statusLabel === "非対応") {
      return "danger";
    }

    if (statusLabel === "キャプチャ中" || statusLabel === "ファイル表示中") {
      return "active";
    }

    return "idle";
  }, [statusLabel]);

  const activeVideoLabel = useMemo(() => {
    if (mediaMode === "video-file" || mediaMode === "image-file") {
      return "ファイルpreview";
    }

    return getDeviceLabel(videoDevices, selectedVideoDeviceId, "映像ソース未選択");
  }, [mediaMode, selectedVideoDeviceId, videoDevices]);

  const activeAudioLabel = useMemo(() => {
    if (selectedAudioDeviceId === NO_AUDIO_DEVICE_ID) {
      return "音声なし";
    }

    const label = getDeviceLabel(audioDevices, selectedAudioDeviceId, "音声ソース未選択");

    if (mediaMode !== "device") {
      return label;
    }

    return audioReady ? `${label} (再生中)` : `${label} (未再生)`;
  }, [audioDevices, audioReady, mediaMode, selectedAudioDeviceId]);

  const latestFrameSample = frameSamples[0] ?? null;

  return (
    <main className="capture-shell">
      <header className="capture-toolbar" aria-label="capture controls">
        <div className="input-badge">
          <span className={`status-dot status-dot--${statusTone}`} aria-hidden="true" />
          <span>入力({formatAspect(metadata)})</span>
        </div>
        <div className="device-selects" aria-label="input device selectors">
          <label className="device-select">
            <span>映像ソース</span>
            <select
              value={selectedVideoDeviceId}
              onChange={(event) => setSelectedVideoDeviceId(event.target.value)}
              disabled={mediaMode === "device"}
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
            <span>音声ソース</span>
            <select
              value={selectedAudioDeviceId}
              onChange={(event) => setSelectedAudioDeviceId(event.target.value)}
              disabled={mediaMode === "device"}
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
          <button
            type="button"
            className="icon-button"
            onClick={() => void refreshDevices()}
            disabled={mediaMode === "device"}
          >
            <span aria-hidden="true">↻</span>
            <span>更新</span>
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={handleStartCapture}
            disabled={videoDevices.length === 0 || mediaMode === "device"}
          >
            <span aria-hidden="true">▶</span>
            <span>開始</span>
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={handleStopCapture}
            disabled={mediaMode === "idle"}
          >
            <span aria-hidden="true">■</span>
            <span>停止</span>
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={mediaMode === "device"}
          >
            <span aria-hidden="true">↥</span>
            <span>ファイル</span>
          </button>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept="video/*,image/*"
            onChange={handleFileChange}
          />
          <button
            type="button"
            className="icon-button icon-button--ghost"
            aria-label="ROIを初期位置へ戻す"
            onClick={handleResetRoi}
          >
            <span aria-hidden="true">↺</span>
            <span>ROI</span>
          </button>
        </div>
      </header>

      <section className="capture-main" aria-label="M1 capture workspace">
        <div className="preview-column">
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
              <RoiOverlay roi={roi} onChange={setRoi} />
            </div>
          </section>

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
                <button
                  type="button"
                  className="icon-button icon-button--compact"
                  onClick={handleStartSampling}
                  disabled={mediaMode === "idle" || isSampling}
                >
                  <span aria-hidden="true">▶</span>
                  <span>サンプル開始</span>
                </button>
                <button
                  type="button"
                  className="icon-button icon-button--compact"
                  onClick={handleStopSampling}
                  disabled={!isSampling}
                >
                  <span aria-hidden="true">■</span>
                  <span>サンプル停止</span>
                </button>
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
                      ? `${latestFrameSample.upscaleFactor}x / ${latestFrameSample.preprocess.whiteThreshold}`
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

          <footer className="capture-statusbar" aria-label="media status">
            <span>
              <span className={`status-dot status-dot--${statusTone}`} aria-hidden="true" />
              {statusLabel}
            </span>
            <span>映像: {activeVideoLabel}</span>
            <span>音声: {activeAudioLabel}</span>
            <span>解像度: {formatResolution(metadata)}</span>
            <span>{formatFps(metadata.frameRate)}</span>
            <span>サンプル: {isSampling ? `${sampleFps}fps` : "停止中"}</span>
            <span>
              ROI: x={roi.x.toFixed(4)} y={roi.y.toFixed(4)} w={roi.w.toFixed(4)} h=
              {roi.h.toFixed(4)}
            </span>
          </footer>
        </div>

        <aside className="log-panel" aria-labelledby="log-title">
          <div className="panel-heading">
            <h1 id="log-title">ログ</h1>
            <span>M1</span>
          </div>
          <ol className="log-list" aria-label="system log">
            {logs.map((log) => (
              <li key={log.id} className={`log-entry log-entry--${log.level}`}>
                <time>{log.timestamp}</time>
                <span>{log.message}</span>
              </li>
            ))}
          </ol>
        </aside>
      </section>

      <section className="milestone-strip" aria-label="project status">
        <span>schema: {BATTLE_LOG_SCHEMA_VERSION}</span>
        <span>route: {APP_ROUTES.home.path}</span>
        {MILESTONES.map((milestone) => (
          <span key={milestone.id}>
            {milestone.id} {milestone.status}
          </span>
        ))}
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
