import type { NormalizedRoi } from "../events/schema";

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function getContainedMediaRect(display: Size, source: Size): Rect | null {
  if (display.width <= 0 || display.height <= 0 || source.width <= 0 || source.height <= 0) {
    return null;
  }

  const scale = Math.min(display.width / source.width, display.height / source.height);
  const width = source.width * scale;
  const height = source.height * scale;

  return {
    x: (display.width - width) / 2,
    y: (display.height - height) / 2,
    width,
    height,
  };
}

export function mapDisplayRoiToSourceRect(
  roi: NormalizedRoi,
  source: Size,
  display: Size,
): Rect | null {
  const mediaRect = getContainedMediaRect(display, source);

  if (!mediaRect) {
    return null;
  }

  const displayRoi = {
    x: roi.x * display.width,
    y: roi.y * display.height,
    width: roi.w * display.width,
    height: roi.h * display.height,
  };
  const leftInMedia = clamp(displayRoi.x - mediaRect.x, 0, mediaRect.width);
  const topInMedia = clamp(displayRoi.y - mediaRect.y, 0, mediaRect.height);
  const rightInMedia = clamp(
    displayRoi.x + displayRoi.width - mediaRect.x,
    0,
    mediaRect.width,
  );
  const bottomInMedia = clamp(
    displayRoi.y + displayRoi.height - mediaRect.y,
    0,
    mediaRect.height,
  );

  if (rightInMedia <= leftInMedia || bottomInMedia <= topInMedia) {
    return null;
  }

  const x = clamp(Math.round((leftInMedia / mediaRect.width) * source.width), 0, source.width - 1);
  const y = clamp(
    Math.round((topInMedia / mediaRect.height) * source.height),
    0,
    source.height - 1,
  );
  const right = clamp(Math.round((rightInMedia / mediaRect.width) * source.width), x + 1, source.width);
  const bottom = clamp(
    Math.round((bottomInMedia / mediaRect.height) * source.height),
    y + 1,
    source.height,
  );

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}
