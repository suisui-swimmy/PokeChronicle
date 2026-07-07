---
name: pokechronicle-unknown-coverage
description: Use this skill when working on PokeChronicle battle-log exports to improve Japanese battle message coverage: analyzing Battle Log JSON, optional unknowns/events CSVs, running report:unknown-coverage, interpreting replay/proposal output, safely extending champout generated template coverage, parser/dictionary/constrained decoder behavior, tests, build verification, and PROGRESS.md updates.
---

# PokeChronicle Unknown Coverage

## Purpose

Use this skill to turn real PokeChronicle battle-log exports into safe, reproducible parser coverage improvements. Treat the report output as guidance, not as an automatic patch.

Keep user-facing instructions, progress notes, and final reports in Japanese when the surrounding thread is Japanese.

## Inputs

Expect one primary input:

- Battle Log JSON exported from PokeChronicle.

Optionally accept:

- `unknowns.csv`
- `events.csv`
- user notes, screenshots, or copied battle messages

Use the Battle Log JSON as the source of truth. Use CSVs only as auxiliary evidence when IDs or timestamps line up.

## First Pass

1. Read current project context before editing:
   - `AGENTS.md`
   - `PROGRESS.md`
   - `data/champout/champout-template-sources.ja.json`
   - relevant parser/template/canonical/stat tests
2. Run the unknown coverage report from the repo root:

```powershell
npm run report:unknown-coverage -- <battle-log.json> --top 20
```

3. If CSVs are available, include them:

```powershell
npm run report:unknown-coverage -- <battle-log.json> --unknowns <unknowns.csv> --events <events.csv> --top 20
```

4. For machine-readable review or handoff:

```powershell
npm run report:unknown-coverage -- <battle-log.json> --json
npm run report:unknown-coverage -- <battle-log.json> --write-proposals tmp/unknown-proposals
```

Do not commit temporary proposal JSON.

## How To Read Proposals

Inspect `rootCauses[]`, `recommendedActions[]`, `risk`, `weightedLoss`, `champoutCandidates`, and negative test suggestions together. Do not rank by count alone.

Prefer actions in this order when evidence supports them:

1. unknown gating or duplicate suppression for noise, fragments, prefix-only text, near accepted events, timer/UI fragments
2. normalizer or dictionary patch for repeated OCR confusions with low semantic risk
3. existing enabled champout source allowlist expansion, especially narrow `btl_set.json` categories
4. constrained decoder expansion only for narrow surfaces and stable event shapes
5. new `btl_*.json` source file only when explicitly requested and safely reviewed one file at a time
6. `hold_review` when actor/target/placeholder meaning is unclear or false positives are plausible

Treat `champout_config_patch` proposals as candidates requiring human judgment. Never auto-apply them.

## Champout Rules

Maintain the static browser-app boundary:

- Do not read `others/champout` from runtime browser code.
- Do not import Node `fs` or `path` from `src/`.
- Do not commit raw dump files, large reports, screenshots, videos, or unrestricted `OriginalText` dumps.
- Do not hand-edit `data/generated/champout-event-rules.ja.json`.
- Regenerate generated champout data from config/scripts.

Before changing champout coverage:

1. Check current enabled sources and allowlists in `data/champout/champout-template-sources.ja.json`.
2. Prefer extending an already-enabled source with narrow label allow patterns.
3. Add placeholder policy only when the placeholder meaning is clear.
4. Keep ambiguous categories, explanation files, UI/menu/data/tutorial files, and fragmentary weather/effect text in review.
5. Run:

```powershell
npm run report:champout
npm run generate:champout-templates
```

Verify generated source files, rule count, per-file stats, and event type distribution after generation.

## Parser And Decoder Changes

Keep changes general, not one-off special cases for a single OCR log.

Use parser/constrained decoder changes when:

- the message shape is common in live battles
- dictionary or generated template evidence already narrows the meaning
- negative tests can show nearby UI/noise does not become an event

Do not loosen constrained decoder thresholds broadly. Add only event-type-specific surface gates and evidence checks.

If the Battle Log JSON lacks enough trace data to explain misses, propose an export trace schema patch instead of guessing.

## Tests

Add focused tests before accepting a coverage change:

- parser tests for representative clean and noisy text
- generated rules tests when champout config changes
- constrained decoder tests when decoder surfaces change
- canonical/stat/export/timeline tests when event shape, display, dedupe, or counting changes
- negative tests for UI text, prefix-only fragments, partial weather/effect text, and unsafe near misses

Use small synthetic fixtures for script tests. Do not commit real full logs unless explicitly approved and bounded.

## Validation

Run the narrowest relevant tests first, then full validation when implementation changes are complete:

```powershell
npm run report:unknown-coverage -- <battle-log.json> --top 20
npm run test -- <changed-test-files>
npm run test
npm run build
git diff --check
rg -n "others/champout|rom-txt|node:fs|node:path|fs\.|path\." src
```

If champout config changed, also run:

```powershell
npm run report:champout
npm run generate:champout-templates
npm run test -- src/core/templates/generatedChampoutTemplateRules.test.ts
```

Record sandbox or permission limitations honestly.

## Progress Entry

Update `PROGRESS.md` at the end, preferably using the progress-update skill when available. Include:

- date and sequence number
- status
- goal
- changed files
- what changed
- report command and key replay counts
- generated rule count change if any
- added source labels or reason for hold
- tests/build results
- remaining issues
- next step

Mention that runtime still does not read `others/champout`.
