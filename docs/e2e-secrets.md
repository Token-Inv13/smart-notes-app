# E2E secrets and local execution

## 1) GitHub Actions secrets (repository)

In GitHub: **Repository -> Settings -> Secrets and variables -> Actions -> New repository secret**.

Create these keys:

- `E2E_BASE_URL`
- `E2E_OWNER_EMAIL`
- `E2E_OWNER_PASSWORD`
- `E2E_EDITOR_EMAIL`
- `E2E_EDITOR_PASSWORD`
- `E2E_VIEWER_EMAIL`
- `E2E_VIEWER_PASSWORD`

The workflow `.github/workflows/e2e.yml` reads these values and skips cleanly if they are missing/placeholder.

## 2) Local execution

### PowerShell (Windows)

```powershell
$env:E2E_BASE_URL="https://app.tachesnotes.com"
$env:E2E_OWNER_EMAIL="owner@your-domain.test"
$env:E2E_OWNER_PASSWORD="..."
$env:E2E_EDITOR_EMAIL="editor@your-domain.test"
$env:E2E_EDITOR_PASSWORD="..."
$env:E2E_VIEWER_EMAIL="viewer@your-domain.test"
$env:E2E_VIEWER_PASSWORD="..."

pnpm e2e:agenda
```

### bash (macOS/Linux)

```bash
export E2E_BASE_URL="https://app.tachesnotes.com"
export E2E_OWNER_EMAIL="owner@your-domain.test"
export E2E_OWNER_PASSWORD="..."
export E2E_EDITOR_EMAIL="editor@your-domain.test"
export E2E_EDITOR_PASSWORD="..."
export E2E_VIEWER_EMAIL="viewer@your-domain.test"
export E2E_VIEWER_PASSWORD="..."

pnpm e2e:agenda
```

## 3) Local guard behavior

`pnpm e2e`, `pnpm e2e:agenda`, and `pnpm e2e:smoke` run `scripts/e2e-precheck.mjs`.

- If required variables are present and valid -> Playwright runs normally.
- If variables are missing/invalid -> script prints a clear skip message and exits with code `0` (non-failing local skip).

## 4) Template file

Use `.env.e2e.example` as template only. Do not store real credentials in git.
