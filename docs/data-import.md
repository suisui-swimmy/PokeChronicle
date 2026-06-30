# Data Import

M7 supports two browser-side import/export paths:

- Battle Log JSON import/export for restoring user-owned analysis logs.
- User-selected champout-style JSON import for template rules.

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

## champout/template import

Use `Template読込` in the review panel and select one or more JSON files controlled by the user. Typical files are under a local champout checkout, for example:

- `rom-txt/jpn/btl_std.json`
- `rom-txt/jpn/btl_attack_syn.json`
- other `rom-txt/jpn/btl_*.json` files

The app does not import `others/champout` at runtime. The browser reads only files selected in the file picker.

The importer:

- Parses selected JSON files in the browser.
- Recursively extracts Japanese text strings, including `OriginalText` values.
- Prioritizes battle-related source names, labels, and message keywords.
- Converts numbered placeholders such as `{0}` / `{1}` into matcher placeholders such as `{pokemon}`, `{move}`, and `{text}` when the event type can be inferred safely.
- Keeps source file name, key path, label name, and original text as rule metadata.
- Stores the generated template pack in IndexedDB.
- Combines imported rules with checked-in seed rules for live OCR parsing.
- Exports or deletes the imported template pack from the review panel.

ZIP import is not implemented in M7. Select JSON files directly for now.

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

The app validates `schemaVersion` on import, restores the review state, and saves the imported log into IndexedDB. This import path is only for PokeChronicle Battle Logs.

Events and unknown messages can also be exported as CSV. Unknown CSV includes manual review notes when present.

Imported text templates stay in browser storage or user-controlled exports unless redistribution is explicitly confirmed.

Runtime code must not import from `others/`.
