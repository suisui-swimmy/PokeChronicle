# Architecture

PokeChronicle is a static browser application. The runtime app must work from the built `dist/` directory without an application server.

## MVP Pipeline

```text
capture / video / screenshot
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

## M0 Boundary

M0 only establishes the app foundation:

- React + TypeScript + Vite shell
- test/build wiring
- initial schema types
- documentation skeleton

Capture, OCR, parser, IndexedDB, and champout import are later milestones.

## Runtime Constraints

- Browser-only processing by default.
- `others/` is a local reference area, not a runtime dependency.
- `rawText` from OCR is preserved and normalized text is treated as derived data.
- Unknown messages are first-class data for review and future rule creation.

