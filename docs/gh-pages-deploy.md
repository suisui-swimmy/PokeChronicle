# GitHub Pages Deploy

PokeChronicle deploys as a static Vite build. The deployed site is the contents of `dist/`; no application server is required at runtime.

## Adopted Workflow

This MVP uses the official GitHub Pages Actions flow in `.github/workflows/pages.yml`.

The workflow runs on pushes to `main` and on manual dispatch:

```text
npm ci
npm run test
npm run build
upload dist/
deploy to GitHub Pages
```

Repository setup:

1. Open the repository on GitHub.
2. Go to **Settings** -> **Pages**.
3. Set **Source** to **GitHub Actions**.
4. Push to `main`, or run **Deploy GitHub Pages** from the Actions tab.

## Base Path

`vite.config.ts` defaults to the repository path:

```text
/PokeChronicle/
```

The workflow also sets:

```text
VITE_BASE_PATH=/PokeChronicle/
```

For a fork or renamed repository, change the workflow environment value or build locally with:

```powershell
$env:VITE_BASE_PATH="/custom-repo-name/"; npm run build
```

For local root-path preview:

```powershell
$env:VITE_BASE_PATH="/"; npm run build; npm run preview
```

## Generated Data Boundary

The deploy workflow does not run:

```text
npm run generate:champout-templates
npm run generate:dictionaries
```

Those scripts depend on local `others/` reference checkouts that are not part of the repository. Commit reviewed generated outputs before deploying, and keep `others/` out of runtime imports.
