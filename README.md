# PokeChronicle

PokeChronicle is a static browser app for turning observed Pokémon Champions battle messages into reviewable battle logs.

The MVP is intentionally browser-only: capture or loaded media stays local, OCR runs in the browser, and logs can be reviewed and exported without a runtime server.

## Current Status

M0 is the static app foundation:

- React + TypeScript + Vite
- Vitest + React Testing Library
- Static GitHub Pages-ready build settings
- Initial battle log, OCR message, event, and unknown schemas
- Initial docs for architecture and Windows setup

Capture, OCR, parsing, storage, statistics, and champout import are later milestones described in `AGENTS.md`.

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

