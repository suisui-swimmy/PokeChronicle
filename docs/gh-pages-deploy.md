# GitHub Pages Deploy

GitHub Pages deployment is prepared through Vite static build output.

`vite.config.ts` defaults to:

```text
/PokeChronicle/
```

Override it with `VITE_BASE_PATH` when needed:

```powershell
$env:VITE_BASE_PATH="/custom-path/"; npm run build
```

The final deployment workflow will be completed in a later milestone.

