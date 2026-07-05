import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

function getBadgeForText(label: string) {
  return screen.getByText(label).closest(".input-badge");
}

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      value: class {
        addEventListener = vi.fn();
        postMessage = vi.fn();
        terminate = vi.fn();
      },
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
    expect(screen.getByLabelText("解決済みログ")).toBeInTheDocument();
    expect(within(screen.getByLabelText("resolved text log")).getByText("解決ログ空")).toBeInTheDocument();
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
    expect(screen.getByRole("checkbox", { name: "ROI表示" })).not.toBeChecked();
    expect(screen.getByText(/x=0.1500 y=0.7200 w=0.5000 h=0.1400/)).toBeInTheDocument();
    expect(screen.queryByText("詳細調整")).not.toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "ROI X" })).toHaveValue(0.15);
    expect(screen.getByRole("spinbutton", { name: "ROI Y" })).toHaveValue(0.72);
    expect(screen.getByRole("spinbutton", { name: "ROI W" })).toHaveValue(0.5);
    expect(screen.getByRole("spinbutton", { name: "ROI H" })).toHaveValue(0.14);
    expect(screen.queryByRole("heading", { name: "統計サマリー" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "ROI" }));
    expect(screen.getByRole("tab", { name: "ROI" })).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByRole("heading", { name: "ROI設定" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "ROI" }));

    expect(screen.getByRole("spinbutton", { name: "ROI X" })).toHaveValue(0.15);
    expect(screen.getByRole("spinbutton", { name: "ROI Y" })).toHaveValue(0.72);
    expect(screen.getByRole("spinbutton", { name: "ROI W" })).toHaveValue(0.5);
    expect(screen.getByRole("spinbutton", { name: "ROI H" })).toHaveValue(0.14);
    expect(screen.getByRole("button", { name: "ROIリセット" })).toBeInTheDocument();

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

  it("configures ROI from analysis and data management", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("combobox", { name: "映像デバイス" })).toHaveValue("video-usb");
    expect(screen.queryByLabelText("ROI adjustment layer")).not.toBeInTheDocument();

    expect(screen.getByLabelText("analysis and data management")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "ROI" }));
    expect(screen.queryByText("詳細調整")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "ROI表示" })).not.toBeChecked();
    fireEvent.change(screen.getByRole("spinbutton", { name: "ROI X" }), {
      target: { value: "0.1" },
    });
    expect(screen.getByRole("spinbutton", { name: "ROI X" })).toHaveValue(0.1);
    expect(screen.getByText(/x=0.1000 y=0.7200 w=0.5000 h=0.1400/)).toBeInTheDocument();
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem(ROI_SETTINGS_STORAGE_KEY) ?? "{}")).toMatchObject({
        roi: { x: 0.1, y: 0.72, w: 0.5, h: 0.14 },
        isRoiVisible: false,
      });
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "ROI表示" }));
    expect(screen.getByLabelText("ROI adjustment layer")).toBeInTheDocument();
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem(ROI_SETTINGS_STORAGE_KEY) ?? "{}")).toMatchObject({
        isRoiVisible: true,
      });
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "ROI表示" }));
    expect(screen.queryByLabelText("ROI adjustment layer")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ROIリセット" }));
    expect(screen.getByRole("spinbutton", { name: "ROI X" })).toHaveValue(0.15);
    expect(screen.getByRole("spinbutton", { name: "ROI W" })).toHaveValue(0.5);
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
        isRoiVisible: true,
      }),
    );

    render(<App />);

    expect(await screen.findByLabelText("ROI adjustment layer")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "ROI" }));
    expect(screen.getByRole("checkbox", { name: "ROI表示" })).toBeChecked();
    expect(screen.getByText(/x=0.2400 y=0.6600 w=0.4200 h=0.1200/)).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "ROI X" })).toHaveValue(0.24);
    expect(screen.getByRole("spinbutton", { name: "ROI Y" })).toHaveValue(0.66);
    expect(screen.getByRole("spinbutton", { name: "ROI W" })).toHaveValue(0.42);
    expect(screen.getByRole("spinbutton", { name: "ROI H" })).toHaveValue(0.12);
  });
});
