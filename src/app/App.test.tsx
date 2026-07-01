import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function createMockVideoStream() {
  return {
    getTracks: () => [videoTrack],
    getVideoTracks: () => [videoTrack],
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

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("renders the M7.5 capture-first shell with hidden management controls", async () => {
    render(<App />);

    expect(await screen.findByRole("combobox", { name: "映像ソース" })).toHaveValue("video-usb");
    expect(screen.getByRole("combobox", { name: "音声ソース" })).toHaveValue("none");
    expect(screen.getByRole("button", { name: "開始" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "停止" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ファイル" })).toBeInTheDocument();
    expect(screen.getByLabelText("preview placeholder")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ログ" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("resolved text log")).getByText("解決ログ空")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "レビュー" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("project status")).not.toBeInTheDocument();
    const managementPanel = screen.getByLabelText("analysis and data management");
    expect(managementPanel).not.toHaveAttribute("open");

    fireEvent.click(screen.getByText("解析・データ管理"));
    expect(managementPanel).toHaveAttribute("open");

    expect(screen.getByRole("combobox", { name: "fps" })).toHaveValue("3");
    expect(screen.getByRole("slider", { name: /白抽出/ })).toHaveValue("180");
    expect(screen.getByRole("combobox", { name: "背景" })).toHaveValue("black");
    expect(screen.getByRole("combobox", { name: "拡大" })).toHaveValue("2");
    expect(screen.getByRole("checkbox", { name: "反転" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "サンプル開始" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "OCR開始" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "OCR停止" })).toBeDisabled();
    expect(screen.getByRole("option", { name: "OBS Virtual Camera" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "音声なし" })).toBeInTheDocument();
    expect(screen.getByText(/未保存/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "読込" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "JSON" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "JSON読込" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Events CSV" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unknown CSV" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Template読込" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Template出力" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Template削除" })).toBeDisabled();
    expect(screen.getByText(/Template未読込/)).toBeInTheDocument();
    expect(screen.getByLabelText("template import summary")).toHaveTextContent("0 files");
    expect(screen.getByLabelText("template import summary")).toHaveTextContent("0 candidates");
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
    expect(screen.getByRole("heading", { name: "リアルタイムOCR" })).toBeInTheDocument();
    expect(screen.getByText("バッファ空")).toBeInTheDocument();
    expect(screen.getByText("OCRログ空")).toBeInTheDocument();
    expect(screen.getByText("タイムライン空")).toBeInTheDocument();
    expect(screen.getByText(/ROI: x=0.0600 y=0.7200 w=0.8800 h=0.2000/)).toBeInTheDocument();
  });

  it("switches management review tabs without rendering every log category at once", async () => {
    render(<App />);

    fireEvent.click(await screen.findByText("解析・データ管理"));

    expect(await screen.findByRole("tab", { name: /Timeline/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByRole("heading", { name: "解決ログ" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Unknown bucket" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "OCR Raw" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "システムログ" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /解決済み/ }));

    expect(screen.getByRole("tab", { name: /解決済み/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("heading", { name: "解決ログ" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("tabpanel", { name: /解決済み/ })).getByText("解決ログ空"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "イベントタイムライン" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Unknown/ }));

    expect(screen.getByRole("tab", { name: /Unknown/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("heading", { name: "Unknown bucket" })).toBeInTheDocument();
    expect(screen.getByText("unknown空")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "イベントタイムライン" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /OCR Raw/ }));

    expect(screen.getByRole("heading", { name: "OCR Raw" })).toBeInTheDocument();
    expect(screen.getByText("OCR raw空")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Unknown bucket" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /System/ }));

    expect(screen.getByRole("heading", { name: "システムログ" })).toBeInTheDocument();
    expect(screen.getByText("M7 template import workspace initialized.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "OCR Raw" })).not.toBeInTheDocument();
  });

  it("starts selected video input with audio disabled when no audio is selected", async () => {
    render(<App />);

    expect(await screen.findByRole("combobox", { name: "映像ソース" })).toHaveValue("video-usb");

    fireEvent.click(screen.getByRole("button", { name: "開始" }));

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledWith({
        audio: false,
        video: {
          deviceId: { exact: "video-usb" },
          width: { exact: 1920 },
          height: { exact: 1080 },
        },
      });
    });
    expect(await screen.findByText("入力(16:9)")).toBeInTheDocument();
    fireEvent.click(screen.getByText("解析・データ管理"));
    fireEvent.click(screen.getByRole("tab", { name: /System/ }));
    await waitFor(() => {
      expect(
        within(screen.getByRole("tabpanel", { name: /System/ })).getByText(/入力を開始しました/),
      ).toBeInTheDocument();
    });
  });

  it("starts selected audio input through a separate audio stream", async () => {
    render(<App />);

    fireEvent.change(await screen.findByRole("combobox", { name: "音声ソース" }), {
      target: { value: "audio-usb" },
    });
    fireEvent.click(screen.getByRole("button", { name: "開始" }));

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
    expect(await screen.findByText(/再生中/)).toBeInTheDocument();
  });

  it("resets ROI from the toolbar", async () => {
    render(<App />);

    expect(await screen.findByRole("combobox", { name: "映像ソース" })).toHaveValue("video-usb");

    fireEvent.click(screen.getByRole("button", { name: "ROIを初期位置へ戻す" }));

    fireEvent.click(screen.getByText("解析・データ管理"));
    fireEvent.click(screen.getByRole("tab", { name: /System/ }));
    expect(
      within(screen.getByRole("tabpanel", { name: /System/ })).getByText(
        "ROIを初期位置へ戻しました。",
      ),
    ).toBeInTheDocument();
  });
});
