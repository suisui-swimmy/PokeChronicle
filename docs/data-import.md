# Data Import

The MVP supports generated standard template data plus Battle Log import/export paths:

- Build-time generated champout template rules.
- Battle Log JSON import/export for restoring user-owned analysis logs.

## Generated name dictionaries

Pokemon and move name dictionaries are generated at development time from local reference files:

```powershell
npm run generate:dictionaries
```

Inputs:

- `others/pokemon-names/pokemon-names-ja-ui.txt`
- `others/move-names/move-names-ja-ui.txt`

Outputs:

- `src/core/dictionary/generatedBattleDictionary.ts`
- `data/dictionaries/pokemon.generated.json`
- `data/dictionaries/moves.generated.json`

Pokemon source names that only appear with trailing gender markers also generate a genderless base label. This lets OCR text such as `イダイトウ` match even when the local reference list has `イダイトウ♂` and `イダイトウ♀`.

The runtime app imports only generated repo files. It must not read from `others/` directly.

## Seed event rules

M4.5 uses a small checked-in rule file for frequent messages that do not include a move name:

- `data/rules/event_rules.ja.json`
- `src/core/templates/templateMatcher.ts`

These rules are hand-written seed templates, not champout-derived full dumps. They cover representative damage, healing, weather, terrain, ability, and item activation messages.

## Generated champout template rules

The standard champout template pack is generated at development/build time:

```powershell
npm run report:champout
npm run generate:champout-templates
```

Inputs:

- `others/champout/LICENSE`
- `others/champout/.git/HEAD` and the current source commit
- `data/champout/champout-template-sources.ja.json`
- `others/champout/rom-txt/jpn/btl_attack_syn.json`
- `others/champout/rom-txt/jpn/btl_std.json`
- `others/champout/rom-txt/jpn/btl_set.json`

Output:

- `data/generated/champout-event-rules.ja.json`
- `src/core/templates/generatedChampoutTemplateRules.ts` consumes that JSON
- `src/core/templates/standardTemplateRules.ts` combines seed and generated rules

The generator verifies the MIT license and records source commit `d2885a864f041744df1de1b35f4ab3d2e52cf4db` in the generated pack. It keeps source file, key path, label name, and original source text per compact rule. It does not copy the raw dump wholesale.

The current `btl_set.json` allowlist is intentionally narrow. It includes reviewed live categories such as status/faint/effectiveness plus single-stat `RankupLv` / `RankdownLv` Lv1-Lv2 messages, using `{stat}` placeholders resolved by the in-app stat dictionary. Multi-stat rank labels and broader explanation/UI text remain out of the active pack.

The runtime app imports only the generated JSON from the repository. It never reads `others/champout` directly. Third-party source and license details are recorded in `THIRD_PARTY_NOTICES.md`.

## Generated pack expansion workflow

Use the report before adding any new champout source file:

```powershell
npm run report:champout
```

The report reads local `btl_*.json` files, verifies the local MIT checkout and source commit, and prints counts, label distributions, placeholder patterns, event type estimates, and risk hints. It intentionally omits raw `OriginalText` values from committed output.

To expand the standard pack:

- Add at most one new `btl_*.json` source at a time to `data/champout/champout-template-sources.ja.json`.
- Prefer narrow `labelAllowPatterns` and explicit `eventTypeRules` over broad keyword inference.
- Use `slotsByIndex` when champout placeholder indexes skip positions, such as `{0}` for Pokemon and `{4}` for stat names in rank-change messages.
- Add `labelDenyPatterns` or `textDenyHints` for UI, tutorial, explanatory, or ambiguous text.
- Run `npm run generate:champout-templates`; do not hand-edit `data/generated/champout-event-rules.ja.json`.
- Update parser/decoder only for event types that can be accepted without loosening confidence or margin rules broadly.
- Update tests and `THIRD_PARTY_NOTICES.md` so generated metadata and notice source files stay in sync.

## Battle Log export/import

The review workspace can export and import a schema-versioned Battle Log JSON document:

- `schemaVersion`
- app and export metadata
- battle metadata
- media metadata
- ROI profile
- raw OCR messages
- parsed events
- unknown messages
- bounded frame/crop evidence
- manual corrections derived from unknown review notes and reviewed status

The app validates `schemaVersion` on import and restores the review state on the current page. The streamlined MVP UI treats Battle Log JSON as the explicit durable handoff; it does not automatically save imported logs into IndexedDB. This import path is only for PokeChronicle Battle Logs.

Events and unknown messages can also be exported as CSV. Unknown CSV includes manual review notes when present.

Runtime code must not import from `others/`.

## Unknown coverage development report

Use the coverage report when exported logs show many unknown messages:

```powershell
npm run report:unknown-coverage -- path\to\battle-log.json
npm run report:unknown-coverage -- path\to\battle-log.json --json --top 20
npm run report:unknown-coverage -- path\to\battle-log.json --write-proposals tmp\unknown-proposals
```

The Battle Log JSON is the primary input. The script replays `ocrMessages` through the current parser and timeline logic, then compares replay coverage with the previously exported `events` / `unknowns`. `--unknowns <csv>` and `--events <csv>` are optional helper inputs when ID-level CSV exports are available.

The output separates root causes and recommended actions instead of treating every unknown as a new template request. Prefix-only fragments, timer/UI text, near-duplicate partials, and short broken weather lines are routed toward unknown suppression or `hold_review`; generated-rule near misses, dictionary OCR gaps, and safe champout candidates become proposals. `--write-proposals` writes a temporary proposal JSON only and never edits source config, generated data, or browser runtime code.

When `others/champout` is present, the report can compare unknown clusters with local source labels while omitting raw `OriginalText` dumps. Missing `others/champout` only disables that source comparison; replay metrics and parser proposals still run.
