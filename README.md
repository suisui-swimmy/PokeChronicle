# PokeChronicle

PokeChronicle is a static browser app for turning observed Pokémon Champions battle messages into reviewable battle logs.

The MVP is intentionally browser-only: capture or loaded media stays local, OCR runs in the browser, and logs can be reviewed and exported without a runtime server.

## Current Status

M7 is complete on top of the static app foundation:

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
- Generated Pokemon and move name dictionaries from local `others/` reference lists
- Safe fuzzy dictionary matching that keeps low-confidence corrections reviewable
- Seed parser coverage for observed move messages, effectiveness messages, and unknown fallback
- Seed template matcher coverage for frequent damage, heal, weather, terrain, ability, and item messages
- Build-time generated champout template pack for additional battle-message coverage
- OCR log entries show the current parser classification candidate
- Event timeline and unknown bucket views fed by the real-time OCR stream
- Review tabs for timeline, resolved events, unknowns, raw OCR, and system logs so the live page does not grow with every log category
- Near-frame duplicate suppression for repeated timeline messages
- Consecutive same raw OCR messages are grouped in the raw OCR tab
- Minimal unknown review UI with reviewed status and correction notes
- IndexedDB save/load for battle logs
- Schema-versioned Battle Log JSON export/import
- Events CSV and Unknown messages CSV export
- Bounded representative crop evidence in saved/exported logs
- Browser-side champout/template JSON import
- Imported template rules are stored in IndexedDB and combined with seed rules for live parsing
- Imported template pack JSON export/delete controls

Statistics and MVP acceptance polish are later milestones described in `AGENTS.md`.

## Commands

Run these from PowerShell in the repository root:

```powershell
npm install
npm run generate:champout-templates
npm run generate:dictionaries
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

## Template Import

PokeChronicle bundles a compact generated champout template pack at build time. The generator reads selected local files from `others/champout/rom-txt/jpn`, verifies the MIT license and source commit, and writes `data/generated/champout-event-rules.ja.json`.

```powershell
npm run generate:champout-templates
```

The runtime app imports only the generated JSON. It does not read `others/champout`, and it does not bundle the full raw dump. Third-party source, license, commit, and notice details are recorded in `THIRD_PARTY_NOTICES.md`.

Use `Template読込` in the review panel to add or test extra user-controlled champout-style JSON files, such as `rom-txt/jpn/btl_std.json` or `rom-txt/jpn/btl_attack_syn.json`.

The app extracts text in the browser, generates safe template candidates, stores only the imported template pack in IndexedDB, and can export/delete that pack. ZIP import is not implemented yet; select JSON files directly.

## GitHub Pages Base Path

`vite.config.ts` uses `VITE_BASE_PATH` when provided and defaults to `/PokeChronicle/`.

For local preview with root-relative paths, run:

```powershell
$env:VITE_BASE_PATH="/"; npm run build; npm run preview
```

## OCR Assets

Tesseract.js runs in a Web Worker. By default the app loads language data from `https://tessdata.projectnaptha.com/4.0.0` and lets Tesseract.js cache it in the browser; battle images are not uploaded.

If you host those assets yourself, relative paths are resolved against `import.meta.env.BASE_URL`:

```powershell
$env:VITE_TESSERACT_LANG_PATH="tessdata"; npm run build
```
