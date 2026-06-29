# Architecture

PokeChronicle is a static browser application. The runtime app must work from the built `dist/` directory without an application server.

## MVP Pipeline

```text
videoinput capture / video / screenshot
-> frame sampling
-> ROI crop
-> Canvas preprocessing
-> OCR provider
-> text normalization
-> seed rules / dictionary / imported templates
-> battle events or unknowns
-> review timeline
-> statistics and export
```

## M1 Input Boundary

The primary live input path is browser `MediaDevices` device capture:

- `enumerateDevices()` lists `videoinput` and `audioinput` sources.
- The user selects one `videoinput` as the live video source.
- The user selects one `audioinput`, or `音声なし` which maps to `audio: false`.
- The selected video input is opened with `getUserMedia()` using 16:9-preferred profiles: exact 1920x1080, exact 1280x720, ideal 1920x1080 with 16:9 aspect ratio, then a final fallback.
- The selected audio input is opened as a separate audio-only stream and routed through Web Audio playback. The preview video element stays muted, matching the `others/pokemon-SnapCrop` pattern.
- `getDisplayMedia()` screen sharing is not the M1 main path; keep it as a possible future separate mode.

## M2 Frame Sampling Boundary

M2 keeps processing in the browser UI thread until OCR work begins:

- The sampler reads the active `videoinput`, video file, or image file preview at 3fps or 5fps.
- ROI coordinates stay normalized, then convert to source pixels only when drawing the crop.
- The raw ROI crop is generated with Canvas and kept as a debug preview.
- The preprocessing pass extracts bright low-chroma text candidates, writes them onto a solid black or white background, optionally inverts the output, and upscales without smoothing.
- Recent frame samples are kept in a small in-memory ring buffer. They are not persisted and do not grow without bounds.

OCR, parser, IndexedDB, and champout import are later milestones.

## Runtime Constraints

- Browser-only processing by default.
- `others/` is a local reference area, not a runtime dependency.
- `rawText` from OCR is preserved and normalized text is treated as derived data.
- Unknown messages are first-class data for review and future rule creation.
