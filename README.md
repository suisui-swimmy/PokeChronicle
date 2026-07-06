# PokeChronicle

PokeChronicle is a static browser app for turning observed Pokémon Champions battle messages into reviewable battle logs.

The MVP is intentionally browser-only: capture or loaded media stays local, OCR runs in the browser, and logs can be reviewed and exported without a runtime server.

## Current Status

The M8 MVP is closed on top of the static app foundation:

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
- Constrained champout decoding that projects noisy OCR onto template + Pokemon dictionary + move dictionary candidates when confidence and margin are safe
- OCR log entries show the current parser classification candidate
- Event timeline and unknown bucket views fed by the real-time OCR stream
- Review tabs for timeline, resolved events, unknowns, raw OCR, and system logs so the live page does not grow with every log category
- Near-frame duplicate suppression for repeated timeline messages
- Consecutive same raw OCR messages are grouped in the raw OCR tab
- Minimal unknown review UI with reviewed status and correction notes
- IndexedDB storage adapters remain available internally; the MVP UI focuses on explicit Battle Log JSON restore/export
- Schema-versioned Battle Log JSON export/import
- Events CSV and Unknown messages CSV export
- Bounded representative crop evidence in saved/exported logs
- MVP statistics for observed moves, Pokemon action count, switches, faints, unknown rate, effectiveness, and critical hits

The MVP is intentionally scoped to observed battle messages. It does not record `selected_action` unless a future UI can prove the selected action directly.

## Commands

Run these from PowerShell in the repository root:

```powershell
npm install
npm run report:champout
npm run report:unknown-coverage -- scripts/fixtures/unknown-coverage-battle-log.json --json
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

## Generated Template Pack

PokeChronicle bundles a compact generated champout template pack at build time. The report script scans local `others/champout/rom-txt/jpn/btl_*.json` files without writing raw dumps, then the generator reads only enabled source files from `data/champout/champout-template-sources.ja.json`.

```powershell
npm run report:champout
npm run generate:champout-templates
```

The current enabled source files are `btl_attack_syn.json`, `btl_std.json`, and the narrowly selected `btl_set.json`. Add more `btl_*.json` files one at a time only after checking the scan report, label allow/deny patterns, event type distribution, parser behavior, and tests.

The runtime app imports only `data/generated/champout-event-rules.ja.json`. It does not read `others/champout`, and it does not bundle the full raw dump. Source files, source commit, license, and notice details are recorded in the generated JSON and `THIRD_PARTY_NOTICES.md`.

## Unknown Coverage Report

Exported Battle Log JSON can be replayed against the current parser to find safe coverage improvement candidates:

```powershell
npm run report:unknown-coverage -- path\to\battle-log.json
npm run report:unknown-coverage -- path\to\battle-log.json --json --top 20
npm run report:unknown-coverage -- path\to\battle-log.json --write-proposals tmp\unknown-proposals
```

The report re-parses `ocrMessages` with the current normalizer, dictionaries, generated champout rules, parser, timeline dedupe, and unknown gating. Previous exported `events` / `unknowns` are used only as a before snapshot. Optional `--unknowns <csv>` and `--events <csv>` can add ID-count hints when the CSV exports are available.

If local `others/champout` exists, the report also checks source-label candidates such as not-yet-enabled `btl_set.json` categories without dumping raw `OriginalText` values. If `others/champout` is missing, source matching is skipped with a warning and replay coverage still works. The script does not auto-edit `data/champout`, `data/generated`, or `src`; proposals are review inputs for the next focused parser/config change.

## GitHub Pages Base Path

`vite.config.ts` uses `VITE_BASE_PATH` when provided and defaults to `/PokeChronicle/`.

For local preview with root-relative paths, run:

```powershell
$env:VITE_BASE_PATH="/"; npm run build; npm run preview
```

## GitHub Pages Deploy

This repository uses the official GitHub Pages Actions workflow in `.github/workflows/pages.yml`. Push to `main` or run the workflow manually, then set GitHub Pages source to **GitHub Actions** in the repository settings.

The workflow runs `npm ci`, `npm run test`, and `npm run build`, then deploys `dist/`. It does not regenerate dictionaries or champout templates in CI because those scripts depend on local `others/` reference checkouts.

## OCR Assets

Tesseract.js runs in a Web Worker. By default the app loads language data from `https://tessdata.projectnaptha.com/4.0.0` and lets Tesseract.js cache it in the browser; battle images are not uploaded.

If you host those assets yourself, relative paths are resolved against `import.meta.env.BASE_URL`:

```powershell
$env:VITE_TESSERACT_LANG_PATH="tessdata"; npm run build
```
