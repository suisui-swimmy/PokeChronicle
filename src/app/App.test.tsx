import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("renders the M1 device input workspace shell", async () => {
    render(<App />);

    expect(await screen.findByRole("combobox", { name: "映像ソース" })).toHaveValue("video-usb");
    expect(screen.getByRole("combobox", { name: "音声ソース" })).toHaveValue("none");
    expect(screen.getByRole("option", { name: "OBS Virtual Camera" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "音声なし" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /開始/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /停止/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /ファイル/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ログ" })).toBeInTheDocument();
    expect(screen.getByLabelText("preview placeholder")).toBeInTheDocument();
    expect(screen.getByText(/ROI: x=0.0600 y=0.7200 w=0.8800 h=0.2000/)).toBeInTheDocument();
    expect(screen.getByText("M1 進行中")).toBeInTheDocument();
  });

  it("starts selected video input with audio disabled when no audio is selected", async () => {
    render(<App />);

    expect(await screen.findByRole("combobox", { name: "映像ソース" })).toHaveValue("video-usb");

    fireEvent.click(screen.getByRole("button", { name: /開始/ }));

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
    expect(await screen.findByText(/入力を開始しました/)).toBeInTheDocument();
  });

  it("starts selected audio input through a separate audio stream", async () => {
    render(<App />);

    fireEvent.change(await screen.findByRole("combobox", { name: "音声ソース" }), {
      target: { value: "audio-usb" },
    });
    fireEvent.click(screen.getByRole("button", { name: /開始/ }));

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

    expect(screen.getByText("ROIを初期位置へ戻しました。")).toBeInTheDocument();
  });
});
