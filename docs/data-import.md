# Data Import

Browser-side data import is not implemented yet.

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

The runtime app imports only generated repo files. It must not read from `others/` directly.

Future milestones will add browser-side import for user-selected champout-derived JSON or ZIP files. Imported text templates must be stored in browser storage or user-controlled exports unless redistribution is explicitly confirmed.

Runtime code must not import from `others/`.
