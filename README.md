# PokeChronicle

PokeChronicle is a static browser app for turning observed Pokémon Champions battle messages into reviewable battle logs.

The MVP is intentionally browser-only: capture or loaded media stays local, OCR runs in the browser, and logs can be reviewed and exported without a runtime server.

## Current Status

M3 is in progress on top of the static app foundation:

- React + TypeScript + Vite
- Vitest + React Testing Library
- Static GitHub Pages-ready build settings
- Initial battle log, OCR message, event, and unknown schemas
- Minimal capture console UI
- `videoinput` source selection for OBS Virtual Camera, OBS-Camera, USB capture devices, and similar inputs
- Separate `audioinput` selection with an `音声なし` option
- SnapCrop-style 16:9-preferred video constraints and separate audio playback routing
- ROI overlay movement and resizing
- 3fps / 5fps ROI frame sampling
- Raw ROI crop and Canvas-preprocessed preview
- White-text candidate extraction, solid background, inversion, and upscale controls
- Bounded in-memory frame sample buffer
- Browser OCR provider interface and Tesseract.js worker integration
- Real-time OCR log entries with raw text, normalized text, confidence, timestamp, and frame index

Parsing, storage, statistics, and champout import are later milestones described in `AGENTS.md`.

## Commands

Run these from PowerShell in the repository root:

```powershell
npm install
npm run dev
npm run test
npm run build
npm run preview
```

## Browser-Only Rules

- No FastAPI, Flask, Express, or always-on backend.
- No server-side OCR.
- No default cloud upload.
- No runtime imports from `others/`.
- No official assets, ROM dumps, official screenshots, or unverified redistributed battle-text dumps in the repository.

## GitHub Pages Base Path

`vite.config.ts` uses `VITE_BASE_PATH` when provided and defaults to `/PokeChronicle/`.

For local preview with root-relative paths, run:

```powershell
$env:VITE_BASE_PATH="/"; npm run build; npm run preview
```

## OCR Assets

Tesseract.js runs in a Web Worker. By default it may download worker/core/language assets from its upstream static CDN and cache language data in the browser; battle images are not uploaded.

If you host those assets yourself, relative paths are resolved against `import.meta.env.BASE_URL`:

```powershell
$env:VITE_TESSERACT_LANG_PATH="tessdata"; npm run build
```
