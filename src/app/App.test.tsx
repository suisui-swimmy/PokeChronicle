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

  it("renders the M7.5 capture-first shell with footer management tabs", async () => {
    const user = userEvent.setup();
    render(<App />);

    const videoSourceSelect = await screen.findByRole("combobox", { name: "映像ソース" });
    await waitFor(() => expect(videoSourceSelect).toHaveValue("video-usb"));
    expect(screen.getByRole("combobox", { name: "音声ソース" })).toHaveValue("none");
    expect(screen.getByRole("button", { name: "開始" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "停止" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ファイル" })).toBeInTheDocument();
    expect(screen.queryByText("映像ソース")).not.toBeInTheDocument();
    expect(screen.queryByText("音声ソース")).not.toBeInTheDocument();
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
    expect(screen.queryByText(/x=0.3300 y=0.7200 w=0.3000 h=0.1400/)).not.toBeInTheDocument();
    expect(screen.queryByText("詳細調整")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "fps" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "OCR開始" })).not.toBeInTheDocument();
    expect(screen.queryByText("Battle Log JSON / CSV")).not.toBeInTheDocument();
    expect(screen.queryByText("タイムライン空")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "ROI" }));
    expect(screen.getByRole("tab", { name: "ROI" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "ROI設定" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "ROI表示" })).toBeChecked();
    expect(screen.getByText(/x=0.3300 y=0.7200 w=0.3000 h=0.1400/)).toBeInTheDocument();
    const roiDetailPanel = screen.getByText("詳細調整").closest("details");
    expect(roiDetailPanel).not.toHaveAttribute("open");
    expect(screen.getByText("詳細調整")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "統計サマリー" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "ROI" }));
    expect(screen.getByRole("tab", { name: "ROI" })).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByRole("heading", { name: "ROI設定" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "ROI" }));

    await user.click(screen.getByText("詳細調整"));
    const reopenedRoiDetailPanel = screen.getByText("詳細調整").closest("details");
    expect(reopenedRoiDetailPanel).toHaveAttribute("open");
    expect(screen.getByRole("spinbutton", { name: "ROI X" })).toHaveValue(0.33);
    expect(screen.getByRole("spinbutton", { name: "ROI Y" })).toHaveValue(0.72);
    expect(screen.getByRole("spinbutton", { name: "ROI W" })).toHaveValue(0.3);
    expect(screen.getByRole("spinbutton", { name: "ROI H" })).toHaveValue(0.14);
    expect(screen.getByRole("button", { name: "ROIリセット" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "サンプラー" }));
    expect(screen.getByRole("combobox", { name: "fps" })).toHaveValue("3");
    expect(screen.getByRole("slider", { name: /白抽出/ })).toHaveValue("180");
    expect(screen.getByRole("combobox", { name: "背景" })).toHaveValue("black");
    expect(screen.getByRole("combobox", { name: "拡大" })).toHaveValue("2");
    expect(screen.getByRole("checkbox", { name: "反転" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "サンプル開始" })).toBeDisabled();
    expect(screen.getByText("バッファ空")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "OCR" }));
    expect(screen.getByRole("button", { name: "OCR開始" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "OCR停止" })).toBeDisabled();
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
    expect(screen.queryByRole("heading", { name: "統計サマリー" })).not.toBeInTheDocument();
    expect(screen.queryByText("observed moves")).not.toBeInTheDocument();
    expect(screen.queryByText("効果抜群 0")).not.toBeInTheDocument();

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

  it("starts selected video input with audio disabled when no audio is selected", async () => {
    const user = userEvent.setup();
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
    expect(screen.getByLabelText("analysis and data management")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "ログ" }));
    await user.click(screen.getByRole("tab", { name: /System/ }));
    await waitFor(() => {
      expect(
        within(screen.getByRole("tabpanel", { name: /System/ })).getByText(/入力を開始しました/),
      ).toBeInTheDocument();
    });
  });

  it("starts selected audio input through a separate audio stream", async () => {
    const user = userEvent.setup();
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
  });

  it("configures ROI from analysis and data management", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("combobox", { name: "映像ソース" })).toHaveValue("video-usb");
    expect(screen.getByLabelText("ROI adjustment layer")).toBeInTheDocument();

    expect(screen.getByLabelText("analysis and data management")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "ROI" }));
    await user.click(screen.getByText("詳細調整"));
    fireEvent.change(screen.getByRole("spinbutton", { name: "ROI X" }), {
      target: { value: "0.1" },
    });
    expect(screen.getByRole("spinbutton", { name: "ROI X" })).toHaveValue(0.1);
    expect(screen.getByText(/x=0.1000 y=0.7200 w=0.3000 h=0.1400/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "ROI表示" }));
    expect(screen.queryByLabelText("ROI adjustment layer")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "ROI表示" }));
    expect(screen.getByLabelText("ROI adjustment layer")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ROIリセット" }));
    expect(screen.getByRole("spinbutton", { name: "ROI X" })).toHaveValue(0.33);
    await user.click(screen.getByRole("tab", { name: "ログ" }));
    await user.click(screen.getByRole("tab", { name: /System/ }));
    expect(
      within(screen.getByRole("tabpanel", { name: /System/ })).getByText(
        "ROIを初期位置へ戻しました。",
      ),
    ).toBeInTheDocument();
  });
});
