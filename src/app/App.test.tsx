import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OCRWorkerRequest,
  OCRWorkerResponse,
} from "../core/ocr/workerMessages";
import type {
  BattleEvent,
  MessageObservation,
  OCRMessage,
  UnknownEvent,
} from "../core/events/schema";
import {
  createBattleLogDocument,
  serializeBattleLogDocument,
} from "../storage/export";
import { App } from "./App";

const videoTrack = {
  addEventListener: vi.fn(),
  getSettings: () => ({ width: 1920, height: 1080, frameRate: 59.94 }),
  stop: vi.fn(),
};

const audioTrack = {
  addEventListener: vi.fn(),
  getSettings: () => ({}),
  stop: vi.fn(),
};

function createMockVideoStream(
  settings: MediaTrackSettings = { width: 1920, height: 1080, frameRate: 59.94 },
) {
  const mockVideoTrack = {
    ...videoTrack,
    getSettings: () => settings,
  };

  return {
    getTracks: () => [mockVideoTrack],
    getVideoTracks: () => [mockVideoTrack],
    getAudioTracks: () => [],
  } as unknown as MediaStream;
}

function createMockAudioStream() {
  return {
    getTracks: () => [audioTrack],
    getVideoTracks: () => [],
    getAudioTracks: () => [audioTrack],
  } as unknown as MediaStream;
}

const enumerateDevices = vi.fn();
const getUserMedia = vi.fn();
const requestFullscreen = vi.fn();
const exitFullscreen = vi.fn();
const createObjectURL = vi.fn(() => "blob:mock-preview");
const revokeObjectURL = vi.fn();
const HEADER_MEDIA_SETTINGS_STORAGE_KEY = "pokechronicle:header-media-settings:v1";
const ROI_SETTINGS_STORAGE_KEY = "pokechronicle:roi-settings:v1";
const mockOcrWorkers: MockOcrWorker[] = [];

class MockOcrWorker {
  onmessage: ((event: MessageEvent<OCRWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn<(message: OCRWorkerRequest) => void>();
  terminate = vi.fn();

  constructor() {
    mockOcrWorkers.push(this);
  }

  emit(message: OCRWorkerResponse) {
    this.onmessage?.({ data: message } as MessageEvent<OCRWorkerResponse>);
  }
}

function createSyntheticMessageImage(
  width: number,
  height: number,
  region: "full" | "left" | "right" = "full",
) {
  const image = new ImageData(width, height);

  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = 16;
    image.data[index + 1] = 18;
    image.data[index + 2] = 24;
    image.data[index + 3] = 255;
  }

  const rowStarts = [Math.max(3, Math.floor(height * 0.24)), Math.max(8, Math.floor(height * 0.62))];

  const xStart = region === "right" ? Math.floor(width * 0.58) : 4;
  const xEnd = region === "left" ? Math.floor(width * 0.42) : width - 4;

  for (const y of rowStarts) {
    for (let x = xStart; x + 1 < xEnd; x += 6) {
      for (let dy = 0; dy < 2 && y + dy < height; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const index = ((y + dy) * width + x + dx) * 4;
          image.data[index] = 244;
          image.data[index + 1] = 244;
          image.data[index + 2] = 244;
        }
      }
    }
  }

  return image;
}

function getBadgeForText(label: string) {
  return screen.getByText(label).closest(".input-badge");
}

function createMessageWatchClock() {
  let nowMs = 0;

  vi.spyOn(performance, "now").mockImplementation(() => nowMs);

  return {
    set(now: number) {
      nowMs = now;
    },
  };
}

function commitMessageWatchCandidate(
  watchFrame: () => void,
  clock: ReturnType<typeof createMessageWatchClock>,
) {
  act(() => {
    clock.set(0);
    watchFrame();
    clock.set(125);
    watchFrame();
    clock.set(250);
    watchFrame();
    clock.set(750);
    watchFrame();
  });
}

describe("App", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mockOcrWorkers.length = 0;
    window.localStorage.clear();
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null,
    });
    requestFullscreen.mockImplementation(function (this: Element) {
      Object.defineProperty(document, "fullscreenElement", {
        configurable: true,
        value: this,
      });
      document.dispatchEvent(new Event("fullscreenchange"));

      return Promise.resolve();
    });
    exitFullscreen.mockImplementation(() => {
      Object.defineProperty(document, "fullscreenElement", {
        configurable: true,
        value: null,
      });
      document.dispatchEvent(new Event("fullscreenchange"));

      return Promise.resolve();
    });
    enumerateDevices.mockResolvedValue([
      {
        deviceId: "video-usb",
        kind: "videoinput",
        label: "USB3. 0 capture (534d:2109)",
      },
      {
        deviceId: "video-obs",
        kind: "videoinput",
        label: "OBS Virtual Camera",
      },
      {
        deviceId: "audio-usb",
        kind: "audioinput",
        label: "デジタル オーディオ インターフェイス (USB3. 0 capture)",
      },
    ]);
    getUserMedia.mockImplementation((constraints: MediaStreamConstraints) =>
      Promise.resolve(constraints.video ? createMockVideoStream() : createMockAudioStream()),
    );

    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });

    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });

    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });

    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });

    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exitFullscreen,
    });

    Object.defineProperty(globalThis, "MediaStream", {
      configurable: true,
      value: class {
        private tracks: MediaStreamTrack[];

        constructor(tracks: MediaStreamTrack[] = []) {
          this.tracks = tracks;
        }

        getTracks() {
          return this.tracks;
        }
      },
    });

    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      value: MockOcrWorker,
    });

    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: class {
        state = "running";
        destination = {};

        createGain() {
          return {
            connect: vi.fn(),
            gain: { value: 0 },
          };
        }

        createMediaStreamSource() {
          return {
            connect: vi.fn(),
            disconnect: vi.fn(),
          };
        }

        resume = vi.fn().mockResolvedValue(undefined);
      },
    });

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices,
        getUserMedia,
      },
    });
  });

  it("renders the M7.5 capture-first shell with footer management tabs", async () => {
    const user = userEvent.setup();
    render(<App />);

    const videoSourceSelect = await screen.findByRole("combobox", { name: "映像デバイス" });
    await waitFor(() => expect(videoSourceSelect).toHaveValue("video-usb"));
    expect(screen.getByRole("combobox", { name: "音声デバイス" })).toHaveValue("none");
    expect(screen.getByRole("button", { name: "更新" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "開始" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "停止" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "音量ミュート" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "音量 100%" })).toHaveValue("1");
    expect(screen.getByRole("button", { name: "アップロード" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全画面表示" })).toBeInTheDocument();
    expect(
      within(screen.getByLabelText("input actions"))
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["更新", "開始", "停止", "音量ミュート", "アップロード", "全画面表示"]);
    expect(screen.queryByRole("button", { name: "解析開始" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "解析停止" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "サンプル開始" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "サンプル停止" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "OCR開始" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "OCR停止" })).not.toBeInTheDocument();
    expect(screen.queryByText("映像ソース")).not.toBeInTheDocument();
    expect(screen.queryByText("音声ソース")).not.toBeInTheDocument();
    expect(screen.queryByText("更新")).not.toBeInTheDocument();
    expect(screen.queryByText("開始")).not.toBeInTheDocument();
    expect(screen.queryByText("停止")).not.toBeInTheDocument();
    expect(screen.queryByText("音量")).not.toBeInTheDocument();
    expect(screen.queryByText("アップロード")).not.toBeInTheDocument();
    expect(screen.queryByText("全画面表示")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ROIを初期位置へ戻す" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("preview placeholder")).toBeInTheDocument();
    expect(screen.queryByLabelText("media status")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "ログ" })).not.toBeInTheDocument();
    expect(screen.queryByText("0 resolved")).not.toBeInTheDocument();
    const captureWorkspace = screen.getByLabelText("M1 capture workspace");
    const workspaceResizer = screen.getByRole("separator", {
      name: "プレビューとログの幅を変更",
    });
    const managementResizer = screen.getByRole("separator", {
      name: "プレビューと下部タブの高さを変更",
    });
    expect(workspaceResizer).toHaveAttribute("aria-orientation", "vertical");
    expect(workspaceResizer).toHaveAttribute("aria-valuenow", "260");
    workspaceResizer.focus();
    await user.keyboard("{ArrowLeft}");
    expect(workspaceResizer).toHaveAttribute("aria-valuenow", "284");
    expect(captureWorkspace).toHaveAttribute(
      "style",
      expect.stringContaining("--resolved-log-width: 284px"),
    );
    await user.keyboard("{ArrowRight}");
    expect(workspaceResizer).toHaveAttribute("aria-valuenow", "260");
    fireEvent.mouseDown(workspaceResizer, { button: 0, clientX: 642 });
    fireEvent.mouseMove(window, { clientX: 542 });
    expect(workspaceResizer).toHaveAttribute("aria-valuenow", "360");
    expect(captureWorkspace).toHaveAttribute(
      "style",
      expect.stringContaining("--resolved-log-width: 360px"),
    );
    fireEvent.mouseUp(window);
    expect(managementResizer).toHaveAttribute("aria-orientation", "horizontal");
    expect(managementResizer).toHaveAttribute("aria-valuemin", "0");
    expect(managementResizer).toHaveAttribute("aria-valuenow", "58");
    await user.click(screen.getByRole("tab", { name: "ログ" }));
    expect(managementResizer).toHaveAttribute("aria-valuenow", "320");
    managementResizer.focus();
    await user.keyboard("{ArrowUp}");
    expect(managementResizer).toHaveAttribute("aria-valuenow", "344");
    expect(captureWorkspace).toHaveAttribute(
      "style",
      expect.stringContaining("--management-panel-height: 344px"),
    );
    await user.keyboard("{ArrowDown}");
    expect(managementResizer).toHaveAttribute("aria-valuenow", "320");
    fireEvent.mouseDown(managementResizer, { button: 0, clientY: 720 });
    fireEvent.mouseMove(window, { clientY: 620 });
    expect(managementResizer).toHaveAttribute("aria-valuenow", "420");
    expect(captureWorkspace).toHaveAttribute(
      "style",
      expect.stringContaining("--management-panel-height: 420px"),
    );
    fireEvent.mouseUp(window);
    await user.keyboard("{Home}");
    expect(managementResizer).toHaveAttribute("aria-valuenow", "0");
    expect(captureWorkspace).toHaveAttribute(
      "style",
      expect.stringContaining("--management-panel-height: 0px"),
    );
    await user.keyboard("{ArrowUp}");
    expect(managementResizer).toHaveAttribute("aria-valuenow", "24");
    expect(captureWorkspace).toHaveAttribute(
      "style",
      expect.stringContaining("--management-panel-height: 24px"),
    );
    vi.spyOn(captureWorkspace, "getBoundingClientRect").mockReturnValue({
      bottom: 1080,
      height: 1022,
      left: 0,
      right: 1920,
      top: 58,
      width: 1920,
      x: 0,
      y: 58,
      toJSON: () => ({}),
    } as DOMRect);
    await user.keyboard("{End}");
    expect(managementResizer).toHaveAttribute("aria-valuenow", "1010");
    expect(captureWorkspace).toHaveAttribute(
      "style",
      expect.stringContaining("--management-panel-height: 1010px"),
    );
    await user.click(screen.getByRole("tab", { name: "ログ" }));
    expect(screen.getByRole("tab", { name: "ログ" })).toHaveAttribute("aria-selected", "false");
    expect(managementResizer).toHaveAttribute("aria-valuenow", "58");
    expect(captureWorkspace.getAttribute("style") ?? "").not.toContain(
      "--management-panel-height",
    );
    managementResizer.focus();
    await user.keyboard("{Home}");
    expect(managementResizer).toHaveAttribute("aria-valuenow", "0");
    expect(captureWorkspace).toHaveAttribute(
      "style",
      expect.stringContaining("--management-panel-height: 0px"),
    );
    await user.keyboard("{ArrowUp}");
    expect(managementResizer).toHaveAttribute("aria-valuenow", "24");
    expect(captureWorkspace).toHaveAttribute(
      "style",
      expect.stringContaining("--management-panel-height: 24px"),
    );
    expect(screen.getByLabelText("ライブイベントログ")).toBeInTheDocument();
    expect(
      within(screen.getByLabelText("live event log")).getByText("ライブイベントログ空"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "レビュー" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("project status")).not.toBeInTheDocument();
    const managementPanel = screen.getByLabelText("analysis and data management");
    expect(managementPanel).toBeInTheDocument();
    expect(managementPanel.tagName).toBe("SECTION");
    expect(within(managementPanel).queryByText("調整")).not.toBeInTheDocument();
    expect(within(managementPanel).queryByText("確認・出力")).not.toBeInTheDocument();
    expect(screen.queryByText("解析・データ管理")).not.toBeInTheDocument();

    expect(screen.getByRole("tab", { name: "ROI" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "サンプラー" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("tab", { name: "OCR" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "統計" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "データ" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "ログ" })).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByRole("heading", { name: "ROI設定" })).not.toBeInTheDocument();
    expect(screen.queryByText(/x=0.1500 y=0.7200 w=0.5000 h=0.1400/)).not.toBeInTheDocument();
    expect(screen.queryByText("詳細調整")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "fps" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("realtime OCR log")).not.toBeInTheDocument();
    expect(screen.queryByText("Battle Log JSON / CSV")).not.toBeInTheDocument();
    expect(screen.queryByText("タイムライン空")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "ROI" }));
    expect(screen.getByRole("tab", { name: "ROI" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "ROI設定" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "メッセージROI表示" })).not.toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "待機ROI表示" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "相手バトルHUD ROI表示" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "味方バトルHUD ROI表示" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "VS ROI表示" })).not.toBeChecked();
    expect(screen.getByText(/x=0.1500 y=0.7200 w=0.5000 h=0.1400/)).toBeInTheDocument();
    expect(screen.getByText(/x=0.5500 y=0.0300 w=0.4300 h=0.1400/)).toBeInTheDocument();
    expect(screen.getByText(/x=0.0200 y=0.8400 w=0.4600 h=0.1400/)).toBeInTheDocument();
    expect(screen.getByText(/x=0.3400 y=0.3200 w=0.3200 h=0.3200/)).toBeInTheDocument();
    expect(screen.queryByText(/wait x=0.4200/)).not.toBeInTheDocument();
    expect(screen.queryByText("詳細調整")).not.toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "ROI X" })).toHaveValue(0.15);
    expect(screen.getByRole("spinbutton", { name: "ROI Y" })).toHaveValue(0.72);
    expect(screen.getByRole("spinbutton", { name: "ROI W" })).toHaveValue(0.5);
    expect(screen.getByRole("spinbutton", { name: "ROI H" })).toHaveValue(0.14);
    expect(screen.queryByRole("spinbutton", { name: "通信待機ROI X" })).not.toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "相手バトルHUD ROI X" })).toHaveValue(0.55);
    expect(screen.getByRole("spinbutton", { name: "相手バトルHUD ROI Y" })).toHaveValue(0.03);
    expect(screen.getByRole("spinbutton", { name: "相手バトルHUD ROI W" })).toHaveValue(0.43);
    expect(screen.getByRole("spinbutton", { name: "相手バトルHUD ROI H" })).toHaveValue(0.14);
    expect(screen.getByRole("spinbutton", { name: "味方バトルHUD ROI X" })).toHaveValue(0.02);
    expect(screen.getByRole("spinbutton", { name: "味方バトルHUD ROI Y" })).toHaveValue(0.84);
    expect(screen.getByRole("spinbutton", { name: "味方バトルHUD ROI W" })).toHaveValue(0.46);
    expect(screen.getByRole("spinbutton", { name: "味方バトルHUD ROI H" })).toHaveValue(0.14);
    expect(screen.getByRole("spinbutton", { name: "VS ROI X" })).toHaveValue(0.34);
    expect(screen.getByRole("spinbutton", { name: "VS ROI Y" })).toHaveValue(0.32);
    expect(screen.getByRole("spinbutton", { name: "VS ROI W" })).toHaveValue(0.32);
    expect(screen.getByRole("spinbutton", { name: "VS ROI H" })).toHaveValue(0.32);
    expect(screen.queryByRole("heading", { name: "統計サマリー" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "ROI" }));
    expect(screen.getByRole("tab", { name: "ROI" })).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByRole("heading", { name: "ROI設定" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "ROI" }));

    expect(screen.getByRole("spinbutton", { name: "ROI X" })).toHaveValue(0.15);
    expect(screen.getByRole("spinbutton", { name: "ROI Y" })).toHaveValue(0.72);
    expect(screen.getByRole("spinbutton", { name: "ROI W" })).toHaveValue(0.5);
    expect(screen.getByRole("spinbutton", { name: "ROI H" })).toHaveValue(0.14);
    expect(screen.queryByRole("button", { name: "待機ROIリセット" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "相手バトルHUD ROIリセット" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "味方バトルHUD ROIリセット" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "VS ROIリセット" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "メッセージROIリセット" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "サンプラー" }));
    expect(screen.getByRole("combobox", { name: "fps" })).toHaveValue("3");
    expect(screen.getByRole("slider", { name: /白抽出/ })).toHaveValue("180");
    expect(screen.getByRole("combobox", { name: "背景" })).toHaveValue("black");
    expect(screen.getByRole("combobox", { name: "拡大" })).toHaveValue("2");
    expect(screen.getByRole("checkbox", { name: "反転" })).not.toBeChecked();
    expect(
      within(screen.getByLabelText("frame sampling and preprocessing")).getByRole("button", {
        name: "サンプル開始",
      }),
    ).toBeDisabled();
    expect(screen.getByText("バッファ空")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "OCR" }));
    expect(
      within(screen.getByLabelText("realtime OCR log")).getByRole("button", {
        name: "OCR開始",
      }),
    ).toBeDisabled();
    expect(
      within(screen.getByLabelText("realtime OCR log")).getByRole("button", {
        name: "OCR停止",
      }),
    ).toBeDisabled();
    expect(screen.getByRole("heading", { name: "リアルタイムOCR" })).toBeInTheDocument();
    expect(screen.getByLabelText("OCR sampling diagnostics")).toHaveTextContent("sampled0");
    expect(screen.getByLabelText("OCR sampling diagnostics")).toHaveTextContent("battleHudSampled0");
    expect(screen.getByLabelText("OCR sampling diagnostics")).toHaveTextContent("vsSampled0");
    expect(screen.getByLabelText("OCR sampling diagnostics")).toHaveTextContent("skippedPhase0");
    expect(screen.getByLabelText("OCR sampling diagnostics")).toHaveTextContent("ocrQueued0");
    expect(screen.getByLabelText("OCR sampling diagnostic log")).toHaveTextContent("診断ログ空");
    expect(screen.getByText("OCRログ空")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "データ" }));
    expect(screen.getByRole("option", { name: "OBS Virtual Camera" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "音声なし" })).toBeInTheDocument();
    expect(screen.getByText("Battle Log JSON / CSV")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ログJSON出力" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ログJSON読込" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "イベントCSV出力" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unknown CSV出力" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "読込" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ログ保存" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ログ読込" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Template読込" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Template出力" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Template削除" })).not.toBeInTheDocument();
    expect(screen.queryByText(/未保存/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Template未読込/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("template import summary")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "統計" }));
    expect(screen.getByRole("heading", { name: "統計サマリー" })).toBeInTheDocument();
    expect(screen.getByText("observed moves")).toBeInTheDocument();
    expect(screen.getByText("効果抜群 0")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ポケモン別行動" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "ログ" }));
    expect(screen.getByRole("tab", { name: /Timeline/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: /解決済み/ })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("tab", { name: /Unknown/ })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("tab", { name: /OCR Raw/ })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("tab", { name: /System/ })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("heading", { name: "イベントタイムライン" })).toBeInTheDocument();
    expect(screen.getByText("タイムライン空")).toBeInTheDocument();
  });

  it("uses the Fullscreen API for monitor fullscreen viewing", async () => {
    const user = userEvent.setup();
    render(<App />);

    const captureShell = await screen.findByLabelText("capture workspace shell");
    await user.click(screen.getByRole("button", { name: "全画面表示" }));

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(requestFullscreen.mock.contexts[0]).toBe(captureShell);
    expect(captureShell).not.toHaveClass("capture-shell--fullscreen");
    expect(document.fullscreenElement).toBe(captureShell);
    expect(screen.getByRole("button", { name: "全画面解除" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "全画面解除" }));

    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(document.fullscreenElement).toBeNull();
    expect(screen.getByRole("button", { name: "全画面表示" })).toBeInTheDocument();
  });

  it("shows the initial badge before device metadata is available", () => {
    enumerateDevices.mockReturnValue(new Promise(() => {}));
    render(<App />);

    expect(getBadgeForText("未取得")).toHaveClass("input-badge--idle");
  });

  it("shows permission-waiting when browser hides device labels before camera permission", async () => {
    enumerateDevices.mockResolvedValueOnce([
      {
        deviceId: "video-hidden",
        kind: "videoinput",
        label: "",
      },
      {
        deviceId: "audio-hidden",
        kind: "audioinput",
        label: "",
      },
    ]);

    render(<App />);

    expect(await screen.findByRole("combobox", { name: "映像デバイス" })).toHaveValue(
      "video-hidden",
    );
    expect(getBadgeForText("権限待ち")).toHaveClass("input-badge--danger");
  });

  it("shows disconnected when no video inputs are available", async () => {
    enumerateDevices.mockResolvedValueOnce([
      {
        deviceId: "audio-usb",
        kind: "audioinput",
        label: "USB audio",
      },
    ]);

    render(<App />);

    expect(await screen.findByText("映像デバイスが見つかりません")).toBeInTheDocument();
    expect(getBadgeForText("未接続")).toHaveClass("input-badge--danger");
  });

  it("shows disconnected when the previously selected video input is missing", async () => {
    window.localStorage.setItem(
      HEADER_MEDIA_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        videoDeviceId: "video-missing",
        audioDeviceId: "none",
        audioVolume: 1,
        isAudioMuted: false,
      }),
    );

    render(<App />);

    expect(await screen.findByRole("combobox", { name: "映像デバイス" })).toHaveValue(
      "video-missing",
    );
    expect(screen.getByText("保存済み映像デバイス未接続")).toBeInTheDocument();
    expect(getBadgeForText("未接続")).toHaveClass("input-badge--danger");
  });

  it("shows starting while waiting for getUserMedia and then the active aspect badge", async () => {
    const user = userEvent.setup();
    let resolveVideoStream: (stream: MediaStream) => void = () => {};

    getUserMedia.mockImplementation((constraints: MediaStreamConstraints) => {
      if (constraints.video) {
        return new Promise<MediaStream>((resolve) => {
          resolveVideoStream = resolve;
        });
      }

      return Promise.resolve(createMockAudioStream());
    });

    render(<App />);

    await screen.findByRole("combobox", { name: "映像デバイス" });
    await user.click(screen.getByRole("button", { name: "開始" }));

    expect(await screen.findByText("開始中")).toBeInTheDocument();
    expect(getBadgeForText("開始中")).toHaveClass("input-badge--warn");

    resolveVideoStream(createMockVideoStream());

    expect(await screen.findByText("入力(16:9)")).toBeInTheDocument();
    expect(getBadgeForText("入力(16:9)")).toHaveClass("input-badge--active");
  });

  it("shows video when a local media file is loaded into preview", async () => {
    render(<App />);

    await screen.findByRole("combobox", { name: "映像デバイス" });
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');

    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput as HTMLInputElement, {
      target: {
        files: [new File(["mock"], "battle.mp4", { type: "video/mp4" })],
      },
    });

    expect(getBadgeForText("動画")).toHaveClass("input-badge--warn");
  });

  it.each([
    {
      label: "入力(4:3)",
      settings: { width: 1024, height: 768, frameRate: 30 },
    },
    {
      label: "入力(非16:9)",
      settings: { width: 1000, height: 1000, frameRate: 30 },
    },
  ])("shows $label for non-standard capture aspect ratios", async ({ label, settings }) => {
    const user = userEvent.setup();
    getUserMedia.mockImplementation((constraints: MediaStreamConstraints) =>
      Promise.resolve(
        constraints.video
          ? createMockVideoStream(settings)
          : createMockAudioStream(),
      ),
    );

    render(<App />);

    await screen.findByRole("combobox", { name: "映像デバイス" });
    await user.click(screen.getByRole("button", { name: "開始" }));

    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(getBadgeForText(label)).toHaveClass("input-badge--warn");
  });

  it.each([
    {
      error: new DOMException("denied", "NotAllowedError"),
      label: "拒否",
    },
    {
      error: new DOMException("busy", "NotReadableError"),
      label: "使用中",
    },
    {
      error: new Error("device failed"),
      label: "開始失敗",
    },
  ])("shows $label when starting the selected input fails", async ({ error, label }) => {
    const user = userEvent.setup();
    getUserMedia.mockImplementation((constraints: MediaStreamConstraints) =>
      constraints.video ? Promise.reject(error) : Promise.resolve(createMockAudioStream()),
    );

    render(<App />);

    await screen.findByRole("combobox", { name: "映像デバイス" });
    await user.click(screen.getByRole("button", { name: "開始" }));

    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(getBadgeForText(label)).toHaveClass("input-badge--danger");
  });

  it("toggles audio mute and adjusts volume from the header control", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("combobox", { name: "映像デバイス" });
    const volumeButton = screen.getByRole("button", { name: "音量ミュート" });
    const volumeSlider = screen.getByRole("slider", { name: "音量 100%" });
    const volumeControl = volumeButton.closest(".volume-control") as HTMLElement;

    expect(volumeControl).toHaveAttribute("data-state", "closed");
    fireEvent.mouseEnter(volumeControl as HTMLElement);
    expect(volumeControl).toHaveAttribute("data-state", "open");
    fireEvent.mouseLeave(volumeControl as HTMLElement);
    expect(volumeControl).toHaveAttribute("data-state", "closed");

    fireEvent.change(volumeSlider, { target: { value: "0.4" } });

    expect(screen.getByRole("slider", { name: "音量 40%" })).toHaveValue("0.4");
    expect(screen.getByRole("button", { name: "音量ミュート" })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(HEADER_MEDIA_SETTINGS_STORAGE_KEY) ?? "{}")).toMatchObject({
      audioVolume: 0.4,
      isAudioMuted: false,
    });

    await user.click(volumeButton);

    expect(screen.getByRole("button", { name: "音量ミュート解除" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "音量 0%" })).toHaveValue("0.4");
    expect(JSON.parse(window.localStorage.getItem(HEADER_MEDIA_SETTINGS_STORAGE_KEY) ?? "{}")).toMatchObject({
      audioVolume: 0.4,
      isAudioMuted: true,
    });

    await user.click(screen.getByRole("button", { name: "音量ミュート解除" }));

    expect(screen.getByRole("button", { name: "音量ミュート" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "音量 40%" })).toHaveValue("0.4");
    expect(JSON.parse(window.localStorage.getItem(HEADER_MEDIA_SETTINGS_STORAGE_KEY) ?? "{}")).toMatchObject({
      audioVolume: 0.4,
      isAudioMuted: false,
    });
  });

  it("switches management review tabs without rendering every log category at once", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByLabelText("analysis and data management");
    await user.click(screen.getByRole("tab", { name: "ログ" }));

    expect(await screen.findByRole("tab", { name: /Timeline/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByRole("heading", { name: "解決ログ" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Unknown bucket" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "OCR Raw" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "システムログ" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /解決済み/ }));

    expect(screen.getByRole("tab", { name: /解決済み/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("heading", { name: "解決ログ" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("tabpanel", { name: /解決済み/ })).getByText("解決ログ空"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "イベントタイムライン" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Unknown/ }));

    expect(screen.getByRole("tab", { name: /Unknown/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("heading", { name: "Unknown bucket" })).toBeInTheDocument();
    expect(screen.getByText("unknown空")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "イベントタイムライン" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /OCR Raw/ }));

    expect(screen.getByRole("heading", { name: "OCR Raw" })).toBeInTheDocument();
    expect(screen.getByText("OCR raw空")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Unknown bucket" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /System/ }));

    expect(screen.getByRole("heading", { name: "システムログ" })).toBeInTheDocument();
    expect(screen.getByText("M8 MVP workspace initialized.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "OCR Raw" })).not.toBeInTheDocument();
  });

  it("starts selected video input automatically with audio disabled when no audio is selected", async () => {
    const user = userEvent.setup();
    render(<App />);

    fireEvent.change(await screen.findByRole("combobox", { name: "映像デバイス" }), {
      target: { value: "video-obs" },
    });

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledWith({
        audio: false,
        video: {
          deviceId: { exact: "video-obs" },
          width: { exact: 1920 },
          height: { exact: 1080 },
        },
      });
    });
    expect(await screen.findByText("入力(16:9)")).toBeInTheDocument();
    expect(screen.getByLabelText("analysis and data management")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "ログ" }));
    await user.click(screen.getByRole("tab", { name: /System/ }));
    await waitFor(() => {
      expect(
        within(screen.getByRole("tabpanel", { name: /System/ })).getByText(/入力を開始しました/),
      ).toBeInTheDocument();
    });
    expect(JSON.parse(window.localStorage.getItem(HEADER_MEDIA_SETTINGS_STORAGE_KEY) ?? "{}")).toMatchObject({
      videoDeviceId: "video-obs",
      audioDeviceId: "none",
    });
  });

  it("starts selected audio input automatically through a separate audio stream", async () => {
    const user = userEvent.setup();
    render(<App />);

    fireEvent.change(await screen.findByRole("combobox", { name: "音声デバイス" }), {
      target: { value: "audio-usb" },
    });

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenNthCalledWith(1, {
        audio: false,
        video: {
          deviceId: { exact: "video-usb" },
          width: { exact: 1920 },
          height: { exact: 1080 },
        },
      });
      expect(getUserMedia).toHaveBeenNthCalledWith(2, {
        video: false,
        audio: {
          deviceId: { exact: "audio-usb" },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    });
    expect(screen.getByLabelText("analysis and data management")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "ログ" }));
    await user.click(screen.getByRole("tab", { name: /System/ }));
    await waitFor(() => {
      expect(
        within(screen.getByRole("tabpanel", { name: /System/ })).getByText(
          /入力を開始しました: USB3\. 0 capture \(534d:2109\) \/ デジタル オーディオ インターフェイス/,
        ),
      ).toBeInTheDocument();
    });
    expect(JSON.parse(window.localStorage.getItem(HEADER_MEDIA_SETTINGS_STORAGE_KEY) ?? "{}")).toMatchObject({
      videoDeviceId: "video-usb",
      audioDeviceId: "audio-usb",
    });
  });

  it("restores saved header media settings and starts that device setup on load", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      HEADER_MEDIA_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        videoDeviceId: "video-obs",
        audioDeviceId: "audio-usb",
        audioVolume: 0.35,
        isAudioMuted: false,
      }),
    );

    render(<App />);

    expect(await screen.findByRole("combobox", { name: "映像デバイス" })).toHaveValue(
      "video-obs",
    );
    expect(screen.getByRole("combobox", { name: "音声デバイス" })).toHaveValue("audio-usb");
    expect(screen.getByRole("slider", { name: "音量 35%" })).toHaveValue("0.35");

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenNthCalledWith(1, {
        audio: false,
        video: {
          deviceId: { exact: "video-obs" },
          width: { exact: 1920 },
          height: { exact: 1080 },
        },
      });
      expect(getUserMedia).toHaveBeenNthCalledWith(2, {
        video: false,
        audio: {
          deviceId: { exact: "audio-usb" },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    });
    expect(await screen.findByText("入力(16:9)")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "ログ" }));
    await user.click(screen.getByRole("tab", { name: /System/ }));
    expect(
      within(screen.getByRole("tabpanel", { name: /System/ })).getByText(
        "保存済みの入力構成で自動開始しました。",
      ),
    ).toBeInTheDocument();
  });

  it("retries a weak block candidate and records only the selected linewise switch event", async () => {
    const user = userEvent.setup();
    const watchClock = createMessageWatchClock();
    const canvasContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn(
        (_x: number, _y: number, width: number, height: number) =>
          createSyntheticMessageImage(width, height),
      ),
      imageSmoothingEnabled: false,
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => canvasContext,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,mock",
    );
    vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(640);
    vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(360);
    const samplingInterval = vi.spyOn(window, "setInterval").mockImplementation(
      () => 1 as unknown as ReturnType<typeof window.setInterval>,
    );

    render(<App />);

    await screen.findByRole("combobox", { name: "映像デバイス" });
    await user.click(screen.getByRole("button", { name: "開始" }));
    await waitFor(() => expect(mockOcrWorkers).toHaveLength(1));
    const worker = mockOcrWorkers[0];
    const watchFrame = samplingInterval.mock.calls.find(([, timeout]) => timeout === 83)?.[0];
    expect(typeof watchFrame).toBe("function");

    act(() => {
      watchClock.set(0);
      (watchFrame as () => void)();
    });
    expect(screen.getByLabelText("live event log")).not.toHaveTextContent(
      "バトルメッセージを検出",
    );
    expect(worker.postMessage).not.toHaveBeenCalled();

    act(() => {
      watchClock.set(125);
      (watchFrame as () => void)();
      watchClock.set(250);
      (watchFrame as () => void)();
    });

    const liveEventLog = screen.getByLabelText("live event log");
    expect(liveEventLog).not.toHaveTextContent(
      "バトルメッセージを検出",
    );
    expect(worker.postMessage).not.toHaveBeenCalled();

    act(() => {
      watchClock.set(750);
      (watchFrame as () => void)();
    });

    const observationRow = within(liveEventLog)
      .getByText("バトルメッセージを検出")
      .closest("li");
    expect(observationRow).not.toBeNull();
    expect(observationRow).toHaveTextContent("[検出中]");

    await waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1));
    const firstRequest = worker.postMessage.mock.calls[0][0];

    expect(firstRequest.type).toBe("recognize");
    if (firstRequest.type !== "recognize") {
      throw new Error("recognize request was not queued");
    }
    expect(firstRequest.candidate).toMatchObject({ id: "primary", strategy: "block" });
    expect(firstRequest.candidate.variantId).toContain("top-2-lines");
    expect(firstRequest.meta.observationId).toMatch(/^msgobs_/);

    act(() => {
      worker.emit({
        type: "result",
        jobId: firstRequest.jobId,
        meta: firstRequest.meta,
        candidate: firstRequest.candidate,
        result: {
          rawText: "くろまろは ー",
          confidence: 0.86,
          lines: [
            {
              text: "くろまろは ー",
              confidence: 0.86,
              bbox: null,
            },
          ],
        },
        segmentResults: [],
        durationMs: 18,
      });
    });

    await waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
    const fallbackRequest = worker.postMessage.mock.calls[1][0];

    expect(fallbackRequest.type).toBe("recognize");
    if (fallbackRequest.type !== "recognize") {
      throw new Error("fallback recognize request was not queued");
    }
    expect(fallbackRequest.candidate).toMatchObject({ id: "linewise", strategy: "linewise" });
    expect(fallbackRequest.meta.observationId).toBe(firstRequest.meta.observationId);

    act(() => {
      worker.emit({
        type: "result",
        jobId: fallbackRequest.jobId,
        meta: fallbackRequest.meta,
        candidate: fallbackRequest.candidate,
        result: {
          rawText: "くろまろは ー\nエルフーンを 繰り出した/",
          confidence: 0.74,
          lines: [
            {
              text: "くろまろは ー",
              confidence: 0.72,
              bbox: null,
            },
            {
              text: "エルフーンを 繰り出した/",
              confidence: 0.76,
              bbox: null,
            },
          ],
        },
        segmentResults: [],
        durationMs: 24,
      });
    });

    await user.click(screen.getByRole("tab", { name: "ログ" }));
    await waitFor(() => {
      expect(screen.getAllByText("ゆけっ! エルフーン!").length).toBeGreaterThan(0);
    });
    expect(observationRow).toBeInTheDocument();
    expect(observationRow).toHaveTextContent("[解決]");
    expect(observationRow).toHaveTextContent("ゆけっ! エルフーン!");
    expect(within(liveEventLog).getAllByRole("listitem")).toHaveLength(1);
    expect(within(screen.getByRole("tab", { name: /Timeline/ })).getByText("1")).toBeInTheDocument();
    expect(within(screen.getByRole("tab", { name: /Unknown/ })).getByText("0")).toBeInTheDocument();
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
  });

  it("updates the detected row to unread without inventing an UnknownEvent when OCR stays empty", async () => {
    const user = userEvent.setup();
    const watchClock = createMessageWatchClock();
    const canvasContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn(
        (_x: number, _y: number, width: number, height: number) =>
          createSyntheticMessageImage(width, height),
      ),
      imageSmoothingEnabled: false,
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => canvasContext,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,mock",
    );
    vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(640);
    vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(360);
    const samplingInterval = vi.spyOn(window, "setInterval").mockImplementation(
      () => 1 as unknown as ReturnType<typeof window.setInterval>,
    );

    render(<App />);

    await screen.findByRole("combobox", { name: "映像デバイス" });
    await user.click(screen.getByRole("button", { name: "開始" }));
    await waitFor(() => expect(mockOcrWorkers).toHaveLength(1));
    const worker = mockOcrWorkers[0];
    const watchFrame = samplingInterval.mock.calls.find(([, timeout]) => timeout === 83)?.[0];
    expect(typeof watchFrame).toBe("function");
    commitMessageWatchCandidate(watchFrame as () => void, watchClock);

    const liveEventLog = screen.getByLabelText("live event log");
    const observationRow = within(liveEventLog)
      .getByText("バトルメッセージを検出")
      .closest("li");
    expect(observationRow).not.toBeNull();

    await waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("tab", { name: "サンプラー" }));
    await user.click(screen.getByRole("button", { name: "サンプル停止" }));
    expect(observationRow).toHaveTextContent("[解析中]");
    expect(observationRow).toHaveTextContent("バトルメッセージを解析中");

    for (let candidateIndex = 0; candidateIndex < 3; candidateIndex += 1) {
      await waitFor(() =>
        expect(worker.postMessage).toHaveBeenCalledTimes(candidateIndex + 1),
      );
      const request = worker.postMessage.mock.calls[candidateIndex][0];
      expect(request.type).toBe("recognize");
      if (request.type !== "recognize") {
        throw new Error("recognize request was not queued");
      }

      act(() => {
        worker.emit({
          type: "result",
          jobId: request.jobId,
          meta: request.meta,
          candidate: request.candidate,
          result: {
            rawText: "",
            confidence: 0,
            lines: [],
          },
          segmentResults: [],
          durationMs: 12,
        });
      });
    }

    await waitFor(() => {
      expect(observationRow).toHaveTextContent("[未読]");
      expect(observationRow).toHaveTextContent("内容を認識できませんでした");
    });
    expect(observationRow).toBeInTheDocument();
    expect(within(liveEventLog).getAllByRole("listitem")).toHaveLength(1);

    await user.click(screen.getByRole("tab", { name: "ログ" }));
    expect(within(screen.getByRole("tab", { name: /Unknown/ })).getByText("0")).toBeInTheDocument();
  });

  it("keeps usable OCR text unresolved when a later fallback candidate errors", async () => {
    const user = userEvent.setup();
    const watchClock = createMessageWatchClock();
    const canvasContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn(
        (_x: number, _y: number, width: number, height: number) =>
          createSyntheticMessageImage(width, height),
      ),
      imageSmoothingEnabled: false,
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => canvasContext,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,mock",
    );
    vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(640);
    vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(360);
    const samplingInterval = vi.spyOn(window, "setInterval").mockImplementation(
      () => 1 as unknown as ReturnType<typeof window.setInterval>,
    );

    render(<App />);
    await screen.findByRole("combobox", { name: "映像デバイス" });
    await user.click(screen.getByRole("button", { name: "開始" }));
    await waitFor(() => expect(mockOcrWorkers).toHaveLength(1));
    const worker = mockOcrWorkers[0];
    const watchFrame = samplingInterval.mock.calls.find(([, timeout]) => timeout === 83)?.[0];
    expect(typeof watchFrame).toBe("function");
    commitMessageWatchCandidate(watchFrame as () => void, watchClock);
    await waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1));
    const firstRequest = worker.postMessage.mock.calls[0][0];
    expect(firstRequest.type).toBe("recognize");
    if (firstRequest.type !== "recognize") {
      throw new Error("recognize request was not queued");
    }

    act(() => {
      worker.emit({
        type: "result",
        jobId: firstRequest.jobId,
        meta: firstRequest.meta,
        candidate: firstRequest.candidate,
        result: {
          rawText: "くろまろは ー",
          confidence: 0.86,
          lines: [{ text: "くろまろは ー", confidence: 0.86, bbox: null }],
        },
        segmentResults: [],
        durationMs: 18,
      });
    });
    await waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
    const fallbackRequest = worker.postMessage.mock.calls[1][0];
    expect(fallbackRequest.type).toBe("recognize");
    if (fallbackRequest.type !== "recognize") {
      throw new Error("fallback recognize request was not queued");
    }

    await user.click(screen.getByRole("tab", { name: "サンプラー" }));
    await user.click(screen.getByRole("button", { name: "サンプル停止" }));
    act(() => {
      worker.emit({
        type: "error",
        jobId: fallbackRequest.jobId,
        meta: fallbackRequest.meta,
        message: "fallback failed",
        recoverable: true,
      });
    });

    const liveEventLog = screen.getByLabelText("live event log");
    await waitFor(() => {
      expect(liveEventLog).toHaveTextContent("[未解決]");
      expect(liveEventLog).toHaveTextContent("内容を解決できませんでした");
      expect(liveEventLog).not.toHaveTextContent("OCR: くろまろは ー");
      expect(liveEventLog).not.toHaveTextContent("[未読]");
    });
    await user.click(screen.getByRole("tab", { name: "ログ" }));
    expect(within(screen.getByRole("tab", { name: /Unknown/ })).getByText("1")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /OCR Raw/ }));
    expect(
      within(screen.getByRole("tabpanel", { name: /OCR Raw/ })).getAllByText(
        "くろまろは ー",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("does not queue a persistent UI change as a distinct message while OCR is active", async () => {
    const user = userEvent.setup();
    const watchClock = createMessageWatchClock();
    let messageRegion: "full" | "left" | "right" = "full";
    const canvasContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn(
        (_x: number, _y: number, width: number, height: number) =>
          createSyntheticMessageImage(
            width,
            height,
            width >= 300 ? messageRegion : "full",
          ),
      ),
      imageSmoothingEnabled: false,
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => canvasContext,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,mock",
    );
    vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(640);
    vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(360);
    const samplingInterval = vi
      .spyOn(window, "setInterval")
      .mockImplementation(() => 1 as unknown as ReturnType<typeof window.setInterval>);

    render(<App />);

    await screen.findByRole("combobox", { name: "映像デバイス" });
    await user.click(screen.getByRole("button", { name: "開始" }));
    await waitFor(() => expect(mockOcrWorkers).toHaveLength(1));
    const worker = mockOcrWorkers[0];
    const watchFrame = samplingInterval.mock.calls.find(([, timeout]) => timeout === 83)?.[0];
    expect(typeof watchFrame).toBe("function");
    commitMessageWatchCandidate(watchFrame as () => void, watchClock);
    await waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1));
    const firstRequest = worker.postMessage.mock.calls[0][0];

    expect(firstRequest.type).toBe("recognize");
    if (firstRequest.type !== "recognize") {
      throw new Error("recognize request was not queued");
    }

    messageRegion = "right";
    act(() => {
      watchClock.set(700);
      (watchFrame as () => void)();
      watchClock.set(800);
      (watchFrame as () => void)();
      watchClock.set(900);
      (watchFrame as () => void)();
      watchClock.set(1000);
      (watchFrame as () => void)();
    });

    await user.click(screen.getByRole("tab", { name: "OCR" }));
    await waitFor(() => {
      expect(screen.getByLabelText("OCR sampling diagnostic log")).toHaveTextContent(
        "messageWatchPersistentUiSuppressed",
      );
    });

    act(() => {
      worker.emit({
        type: "result",
        jobId: firstRequest.jobId,
        meta: firstRequest.meta,
        candidate: firstRequest.candidate,
        result: {
          rawText: "くろまろは ー",
          confidence: 0.86,
          lines: [
            {
              text: "くろまろは ー",
              confidence: 0.86,
              bbox: null,
            },
          ],
        },
        segmentResults: [],
        durationMs: 18,
      });
    });

    await waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
    const fallbackRequest = worker.postMessage.mock.calls[1][0];

    expect(fallbackRequest.type).toBe("recognize");
    if (fallbackRequest.type !== "recognize") {
      throw new Error("fallback recognize request was not queued");
    }
    expect(fallbackRequest.jobId).toBe(firstRequest.jobId);
    expect(fallbackRequest.candidate).toMatchObject({
      id: "linewise",
      strategy: "linewise",
    });
    expect(screen.getByLabelText("OCR sampling diagnostic log")).not.toHaveTextContent(
      "distinct message queued",
    );
  });

  it("keeps imported session history while bounding each rendered review list", async () => {
    const user = userEvent.setup();
    const ocrMessages = Array.from({ length: 90 }, (_, index): OCRMessage => ({
      id: `ocr_history_${index + 1}`,
      battleId: "battle_history",
      rawText: `OCR raw ${index + 1}`,
      normalizedText: `OCR raw ${index + 1}`,
      matchText: `ocrraw${index + 1}`,
      ocrConfidence: 0.8,
      timestampMs: index * 100,
      frameIndex: index + 1,
      roi: { x: 0.15, y: 0.72, w: 0.5, h: 0.14 },
      lines: [],
    }));
    const events = Array.from({ length: 60 }, (_, index): BattleEvent => ({
      id: `evt_history_${index + 1}`,
      battleId: "battle_history",
      turn: null,
      timestampMs: index * 100,
      type: "move",
      actor: { name: "マフォクシー", side: "player" },
      move: "ねっぷう",
      target: null,
      rawText: `マフォクシーの ねっぷう! ${index + 1}`,
      normalizedText: `マフォクシーのねっぷう!${index + 1}`,
      confidence: 0.9,
      classification: {
        method: "seed_rule",
        templateId: "attack_actor_move",
        alternatives: [],
      },
      source: {
        frameIndex: index + 1,
        timestampMs: index * 100,
        cropObjectUrl: null,
      },
    }));
    const unknowns = Array.from({ length: 60 }, (_, index): UnknownEvent => ({
      id: `unk_history_${index + 1}`,
      battleId: "battle_history",
      timestampMs: index * 100 + 50,
      afterEventId: null,
      rawText: `unknown ${index + 1}`,
      normalizedText: `unknown ${index + 1}`,
      ocrConfidence: 0.5,
      candidateMatches: [],
      sourceFrameRef: `frame:${index + 1}:${index * 100 + 50}`,
      reviewStatus: "unreviewed",
    }));
    const battleLog = createBattleLogDocument({
      battleId: "battle_history",
      title: "History battle",
      startedAt: null,
      media: {
        sourceKind: "none",
        videoLabel: null,
        audioLabel: null,
        width: null,
        height: null,
        frameRate: null,
      },
      roi: { x: 0.15, y: 0.72, w: 0.5, h: 0.14 },
      roiName: "Battle message ROI",
      opponentHudRoi: { x: 0.55, y: 0.03, w: 0.43, h: 0.14 },
      opponentHudRoiName: "Opponent battle HUD ROI",
      playerHudRoi: { x: 0.02, y: 0.84, w: 0.46, h: 0.14 },
      playerHudRoiName: "Player battle HUD ROI",
      vsRoi: { x: 0.34, y: 0.32, w: 0.32, h: 0.32 },
      vsRoiName: "VS splash ROI",
      ocrMessages,
      events,
      unknowns,
      frameEvidence: [],
      reviewNotes: {},
    });
    const serialized = serializeBattleLogDocument(battleLog);
    const importFile = new File([serialized], "history.json", { type: "application/json" });
    Object.defineProperty(importFile, "text", {
      configurable: true,
      value: vi.fn().mockResolvedValue(serialized),
    });

    render(<App />);
    await screen.findByRole("combobox", { name: "映像デバイス" });
    await user.click(screen.getByRole("tab", { name: "データ" }));
    const importInput = document.querySelector<HTMLInputElement>(
      'input[accept="application/json,.json"]',
    );
    expect(importInput).not.toBeNull();
    fireEvent.change(importInput as HTMLInputElement, {
      target: { files: [importFile] },
    });

    await user.click(screen.getByRole("tab", { name: "ログ" }));
    await waitFor(() => {
      expect(within(screen.getByRole("tab", { name: /解決済み/ })).getByText("60")).toBeInTheDocument();
      expect(within(screen.getByRole("tab", { name: /Unknown/ })).getByText("60")).toBeInTheDocument();
    });
    expect(
      within(screen.getByLabelText("live event log")).getAllByRole("listitem"),
    ).toHaveLength(48);
    expect(screen.getByLabelText("live event log")).toHaveTextContent(
      "マフォクシーの ねっぷう!",
    );

    await user.click(screen.getByRole("tab", { name: /解決済み/ }));
    expect(
      within(screen.getByRole("tabpanel", { name: /解決済み/ })).getAllByRole("listitem"),
    ).toHaveLength(48);

    await user.click(screen.getByRole("tab", { name: /Unknown/ }));
    expect(
      within(screen.getByRole("tabpanel", { name: /Unknown/ })).getAllByRole("listitem"),
    ).toHaveLength(48);

    await user.click(screen.getByRole("tab", { name: /OCR Raw/ }));
    expect(
      within(screen.getByRole("tabpanel", { name: /OCR Raw/ })).getAllByRole("listitem"),
    ).toHaveLength(30);
  });

  it("renders multiple canonical events inside one imported observation row", async () => {
    const user = userEvent.setup();
    const events: BattleEvent[] = [
      {
        id: "evt_bundle_move",
        battleId: "battle_bundle",
        observationId: "msgobs_bundle",
        turn: null,
        timestampMs: 1200,
        type: "move",
        actor: { name: "マフォクシー", side: "player" },
        move: "ねっぷう",
        target: null,
        rawText: "マフォクシーの ねっぷう!",
        normalizedText: "マフォクシーのねっぷう!",
        confidence: 0.94,
        classification: {
          method: "seed_rule",
          templateId: "attack_actor_move",
          alternatives: [],
        },
        source: {
          frameIndex: 12,
          timestampMs: 1200,
          cropObjectUrl: null,
        },
      },
      {
        id: "evt_bundle_switch",
        battleId: "battle_bundle",
        observationId: "msgobs_bundle",
        turn: null,
        timestampMs: 1200,
        type: "switch_in",
        actor: { name: "エルフーン", side: "player" },
        move: null,
        target: null,
        rawText: "ゆけっ! エルフーン!",
        normalizedText: "ゆけっ!エルフーン!",
        confidence: 0.9,
        classification: {
          method: "seed_rule",
          templateId: "switch_in_go",
          alternatives: [],
        },
        source: {
          frameIndex: 12,
          timestampMs: 1200,
          cropObjectUrl: null,
        },
      },
    ];
    const unresolvedOcrMessage: OCRMessage = {
      id: "ocr_bundle_unknown",
      battleId: "battle_bundle",
      observationId: "msgobs_unknown",
      rawText: "ガフリアスの じじん",
      normalizedText: "ガフリアスの じじん",
      matchText: "ガフリアスのじじん",
      ocrConfidence: 0.58,
      timestampMs: 1700,
      frameIndex: 17,
      roi: { x: 0.15, y: 0.72, w: 0.5, h: 0.14 },
      lines: [],
    };
    const messageObservations: MessageObservation[] = [
      {
        id: "msgobs_unknown",
        battleId: "battle_bundle",
        openedAtMs: 1600,
        closedAtMs: 1800,
        frameStart: 16,
        frameEnd: 18,
        lifecycle: "closed",
        resolution: "ocr_unknown",
        visualFingerprint: {
          columns: 2,
          rows: 2,
          cells: [1, 3, 2, 0],
          foregroundPixelRatio: 0.05,
        },
        maxPresenceScore: 0.77,
        bestFrameIndex: 17,
        bestEvidenceRef: null,
        ocrAttemptCount: 1,
        ocrMessageIds: [unresolvedOcrMessage.id],
        eventIds: [],
        unknownEventIds: [],
        failureReason: "parser_unknown",
        openedWhileOcrBusy: false,
        disposition: "suppressed",
        suppressionReason: "ocr_noise_gate",
        commitScore: 0.2,
        persistentUiOverlapRatio: 0.8,
        dynamicForegroundRatio: 0.2,
        unknownGateReason: "symbol_noise",
        mergedIntoObservationId: null,
      },
      {
        id: "msgobs_bundle",
        battleId: "battle_bundle",
        openedAtMs: 1100,
        closedAtMs: 1350,
        frameStart: 10,
        frameEnd: 13,
        lifecycle: "closed",
        resolution: "resolved",
        visualFingerprint: {
          columns: 2,
          rows: 2,
          cells: [3, 2, 1, 0],
          foregroundPixelRatio: 0.06,
        },
        maxPresenceScore: 0.83,
        bestFrameIndex: 12,
        bestEvidenceRef: null,
        ocrAttemptCount: 1,
        ocrMessageIds: [],
        eventIds: events.map((event) => event.id),
        unknownEventIds: [],
        failureReason: null,
        openedWhileOcrBusy: false,
        disposition: "primary",
        suppressionReason: null,
        commitScore: 0.8,
        persistentUiOverlapRatio: 0.1,
        dynamicForegroundRatio: 0.9,
        unknownGateReason: null,
        mergedIntoObservationId: null,
      },
    ];
    const battleLog = createBattleLogDocument({
      battleId: "battle_bundle",
      title: "Bundle battle",
      startedAt: null,
      media: {
        sourceKind: "none",
        videoLabel: null,
        audioLabel: null,
        width: null,
        height: null,
        frameRate: null,
      },
      roi: { x: 0.15, y: 0.72, w: 0.5, h: 0.14 },
      roiName: "Battle message ROI",
      opponentHudRoi: { x: 0.55, y: 0.03, w: 0.43, h: 0.14 },
      opponentHudRoiName: "Opponent battle HUD ROI",
      playerHudRoi: { x: 0.02, y: 0.84, w: 0.46, h: 0.14 },
      playerHudRoiName: "Player battle HUD ROI",
      vsRoi: { x: 0.34, y: 0.32, w: 0.32, h: 0.32 },
      vsRoiName: "VS splash ROI",
      ocrMessages: [unresolvedOcrMessage],
      events,
      unknowns: [],
      messageObservations,
      frameEvidence: [],
      reviewNotes: {},
    });
    const serialized = serializeBattleLogDocument(battleLog);
    const importFile = new File([serialized], "bundle.json", {
      type: "application/json",
    });
    Object.defineProperty(importFile, "text", {
      configurable: true,
      value: vi.fn().mockResolvedValue(serialized),
    });

    render(<App />);
    await screen.findByRole("combobox", { name: "映像デバイス" });
    await user.click(screen.getByRole("tab", { name: "データ" }));
    const importInput = document.querySelector<HTMLInputElement>(
      'input[accept="application/json,.json"]',
    );
    fireEvent.change(importInput as HTMLInputElement, {
      target: { files: [importFile] },
    });

    const liveEventLog = screen.getByLabelText("live event log");
    await waitFor(() => {
      expect(within(liveEventLog).getAllByRole("listitem")).toHaveLength(1);
      expect(liveEventLog).toHaveTextContent("マフォクシーの ねっぷう!");
      expect(liveEventLog).toHaveTextContent("ゆけっ! エルフーン!");
      expect(liveEventLog).not.toHaveTextContent("[未解決]");
      expect(liveEventLog).not.toHaveTextContent("OCR: ガフリアスの じじん");
    });
    await user.click(screen.getByRole("tab", { name: "ログ" }));
    await user.click(screen.getByRole("tab", { name: /OCR Raw/ }));
    expect(
      within(screen.getByRole("tabpanel", { name: /OCR Raw/ })).getAllByText(
        "ガフリアスの じじん",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("configures ROI from analysis and data management", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("combobox", { name: "映像デバイス" })).toHaveValue("video-usb");
    expect(screen.queryByLabelText("メッセージROI adjustment layer")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("通信待機ROI adjustment layer")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("バトルHUD ROI（相手） adjustment layer")).not.toBeInTheDocument();

    expect(screen.getByLabelText("analysis and data management")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "ROI" }));
    expect(screen.queryByText("詳細調整")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "メッセージROI表示" })).not.toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "待機ROI表示" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "相手バトルHUD ROI表示" })).not.toBeChecked();
    fireEvent.change(screen.getByRole("spinbutton", { name: "ROI X" }), {
      target: { value: "0.1" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "相手バトルHUD ROI X" }), {
      target: { value: "0.44" },
    });
    expect(screen.getByRole("spinbutton", { name: "ROI X" })).toHaveValue(0.1);
    expect(screen.getByRole("spinbutton", { name: "相手バトルHUD ROI X" })).toHaveValue(0.44);
    expect(screen.getByText(/x=0.1000 y=0.7200 w=0.5000 h=0.1400/)).toBeInTheDocument();
    expect(screen.getByText(/x=0.4400 y=0.0300 w=0.4300 h=0.1400/)).toBeInTheDocument();
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem(ROI_SETTINGS_STORAGE_KEY) ?? "{}")).toMatchObject({
        roi: { x: 0.1, y: 0.72, w: 0.5, h: 0.14 },
        opponentHudRoi: { x: 0.44, y: 0.03, w: 0.43, h: 0.14 },
        playerHudRoi: { x: 0.02, y: 0.84, w: 0.46, h: 0.14 },
        vsRoi: { x: 0.34, y: 0.32, w: 0.32, h: 0.32 },
        isRoiVisible: false,
        isOpponentHudRoiVisible: false,
        isPlayerHudRoiVisible: false,
        isVsRoiVisible: false,
      });
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "メッセージROI表示" }));
    expect(screen.getByLabelText("メッセージROI adjustment layer")).toBeInTheDocument();
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem(ROI_SETTINGS_STORAGE_KEY) ?? "{}")).toMatchObject({
        isRoiVisible: true,
      });
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "相手バトルHUD ROI表示" }));
    expect(screen.getByLabelText("バトルHUD ROI（相手） adjustment layer")).toBeInTheDocument();
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem(ROI_SETTINGS_STORAGE_KEY) ?? "{}")).toMatchObject({
        isOpponentHudRoiVisible: true,
      });
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "メッセージROI表示" }));
    expect(screen.queryByLabelText("メッセージROI adjustment layer")).not.toBeInTheDocument();
    expect(screen.getByLabelText("バトルHUD ROI（相手） adjustment layer")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "メッセージROIリセット" }));
    expect(screen.getByRole("spinbutton", { name: "ROI X" })).toHaveValue(0.15);
    expect(screen.getByRole("spinbutton", { name: "ROI W" })).toHaveValue(0.5);
    fireEvent.click(screen.getByRole("button", { name: "相手バトルHUD ROIリセット" }));
    expect(screen.getByRole("spinbutton", { name: "相手バトルHUD ROI X" })).toHaveValue(0.55);
    await user.click(screen.getByRole("tab", { name: "ログ" }));
    await user.click(screen.getByRole("tab", { name: /System/ }));
    expect(
      within(screen.getByRole("tabpanel", { name: /System/ })).getByText(
        "ROIを初期位置へ戻しました。",
      ),
    ).toBeInTheDocument();
  });

  it("restores ROI settings from browser storage", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      ROI_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        roi: { x: 0.24, y: 0.66, w: 0.42, h: 0.12 },
        opponentHudRoi: { x: 0.43, y: 0.2, w: 0.16, h: 0.13 },
        playerHudRoi: { x: 0.03, y: 0.82, w: 0.44, h: 0.12 },
        vsRoi: { x: 0.31, y: 0.28, w: 0.34, h: 0.35 },
        isRoiVisible: true,
        isOpponentHudRoiVisible: true,
        isPlayerHudRoiVisible: true,
        isVsRoiVisible: true,
      }),
    );

    render(<App />);

    expect(await screen.findByLabelText("メッセージROI adjustment layer")).toBeInTheDocument();
    expect(screen.getByLabelText("バトルHUD ROI（相手） adjustment layer")).toBeInTheDocument();
    expect(screen.getByLabelText("バトルHUD ROI（味方） adjustment layer")).toBeInTheDocument();
    expect(screen.getByLabelText("VS ROI adjustment layer")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "ROI" }));
    expect(screen.getByRole("checkbox", { name: "メッセージROI表示" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "相手バトルHUD ROI表示" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "味方バトルHUD ROI表示" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "VS ROI表示" })).toBeChecked();
    expect(screen.getByText(/x=0.2400 y=0.6600 w=0.4200 h=0.1200/)).toBeInTheDocument();
    expect(screen.getByText(/x=0.4300 y=0.2000 w=0.1600 h=0.1300/)).toBeInTheDocument();
    expect(screen.getByText(/x=0.0300 y=0.8200 w=0.4400 h=0.1200/)).toBeInTheDocument();
    expect(screen.getByText(/x=0.3100 y=0.2800 w=0.3400 h=0.3500/)).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "ROI X" })).toHaveValue(0.24);
    expect(screen.getByRole("spinbutton", { name: "ROI Y" })).toHaveValue(0.66);
    expect(screen.getByRole("spinbutton", { name: "ROI W" })).toHaveValue(0.42);
    expect(screen.getByRole("spinbutton", { name: "ROI H" })).toHaveValue(0.12);
    expect(screen.getByRole("spinbutton", { name: "相手バトルHUD ROI X" })).toHaveValue(0.43);
    expect(screen.getByRole("spinbutton", { name: "相手バトルHUD ROI Y" })).toHaveValue(0.2);
    expect(screen.getByRole("spinbutton", { name: "相手バトルHUD ROI W" })).toHaveValue(0.16);
    expect(screen.getByRole("spinbutton", { name: "相手バトルHUD ROI H" })).toHaveValue(0.13);
    expect(screen.getByRole("spinbutton", { name: "味方バトルHUD ROI X" })).toHaveValue(0.03);
    expect(screen.getByRole("spinbutton", { name: "味方バトルHUD ROI Y" })).toHaveValue(0.82);
    expect(screen.getByRole("spinbutton", { name: "味方バトルHUD ROI W" })).toHaveValue(0.44);
    expect(screen.getByRole("spinbutton", { name: "味方バトルHUD ROI H" })).toHaveValue(0.12);
    expect(screen.getByRole("spinbutton", { name: "VS ROI X" })).toHaveValue(0.31);
    expect(screen.getByRole("spinbutton", { name: "VS ROI Y" })).toHaveValue(0.28);
    expect(screen.getByRole("spinbutton", { name: "VS ROI W" })).toHaveValue(0.34);
    expect(screen.getByRole("spinbutton", { name: "VS ROI H" })).toHaveValue(0.35);
  });
});
