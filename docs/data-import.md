# Data Import

M6 supports browser-side Battle Log JSON import/export for restoring user-owned analysis logs. Browser-side champout/template import is still a later milestone.

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

These rules are hand-written seed templates, not champout-derived full dumps. They cover representative damage, healing, weather, terrain, ability, and item activation messages. Future champout import should feed the same matcher through user-selected files and browser storage.

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

Future milestones will add browser-side import for user-selected champout-derived JSON or ZIP files. Imported text templates must be stored in browser storage or user-controlled exports unless redistribution is explicitly confirmed.

Runtime code must not import from `others/`.
