# Smart Notes

Monorepo avec :

- **Frontend principal** : `apps/web` (Next.js + Firebase + PWA)
- **Backend** : `functions` (Firebase Cloud Functions)
- **Landing** : `landing/` (site statique séparé). Cette landing a sa propre configuration Vercel (`landing/vercel.json`).

## Pré-requis

- Node.js 20
- pnpm

## Commandes (depuis la racine)

- **Développement web** : `pnpm dev`
- **Build web** : `pnpm build`
- **Start web** : `pnpm preview`

Les alias explicites existent aussi :

- `pnpm web:dev`
- `pnpm web:build`
- `pnpm web:start`
- `pnpm web:lint`
- `pnpm web:typecheck`
- `pnpm e2e:install`
- `pnpm e2e`

## E2E Playwright

Le runner E2E lit `E2E_BASE_URL`.

- En local, si `E2E_BASE_URL` est absent, la base URL par défaut est `http://127.0.0.1:3000`.
- En CI (`CI=true`), `E2E_BASE_URL` est **obligatoire** et le workflow échoue si la variable est absente.

Variables requises pour la suite complète:

- `E2E_BASE_URL`
- `E2E_OWNER_EMAIL`
- `E2E_OWNER_PASSWORD`
- `E2E_EDITOR_EMAIL`
- `E2E_EDITOR_PASSWORD`
- `E2E_VIEWER_EMAIL`
- `E2E_VIEWER_PASSWORD`

Exemples d'export local:

PowerShell:

```powershell
$env:E2E_BASE_URL="https://app.tachesnotes.com"
$env:E2E_OWNER_EMAIL="owner@example.com"
$env:E2E_OWNER_PASSWORD="***"
$env:E2E_EDITOR_EMAIL="editor@example.com"
$env:E2E_EDITOR_PASSWORD="***"
$env:E2E_VIEWER_EMAIL="viewer@example.com"
$env:E2E_VIEWER_PASSWORD="***"
```

bash:

```bash
export E2E_BASE_URL="https://app.tachesnotes.com"
export E2E_OWNER_EMAIL="owner@example.com"
export E2E_OWNER_PASSWORD="***"
export E2E_EDITOR_EMAIL="editor@example.com"
export E2E_EDITOR_PASSWORD="***"
export E2E_VIEWER_EMAIL="viewer@example.com"
export E2E_VIEWER_PASSWORD="***"
```

## Cloud Functions

- `pnpm functions:build`
- `pnpm functions:serve`
- `pnpm functions:shell`
- `pnpm functions:logs`
- `pnpm functions:deploy`

## Structure

- `apps/web` : application Next.js (source of truth)
- `functions` : Cloud Functions Firebase
- `landing` : pages statiques marketing (déploiement indépendant)
- `src` (racine) : **legacy Vite**, conservé temporairement pour historique/migration. Ne pas importer ce code depuis `apps/web`.

## Garde-fou migration legacy

- Vérification anti-import legacy : `pnpm audit:legacy-src`
- Cette commande est exécutée en CI pour empêcher toute dépendance accidentelle vers `root/src` depuis `apps/web/src`.

## Déploiement Vercel (`apps/web`)

Créer un projet Vercel pointant ce repository avec :

- **Root Directory**: `apps/web`
- **Install Command**: `pnpm install`
- **Build Command**: `pnpm build`
- **Node.js**: 20.x

Si Vercel affiche un warning runtime Node, vérifier aussi **Project Settings → General → Node.js Version** et forcer `20.x`.

Variables d'environnement à configurer en production :

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` (optionnel)
- `NEXT_PUBLIC_FCM_VAPID_KEY`

⚠️ En production Vercel, **ne pas définir** `NEXT_PUBLIC_USE_EMULATORS=true`.

Un modèle local est disponible dans `apps/web/.env.example`.

## Sécurité des variables d'environnement

- Les fichiers de secrets à la racine (`/.env`, `/.env.*`) sont ignorés par Git.
- Ne jamais committer de secrets dans le repository.
- Vérification dédiée: `pnpm audit:env-secrets` (à exécuter en CI).
- Setup local:
  1. Copier le template: `cp .env.example .env` (ou `Copy-Item .env.example .env` sous PowerShell).
  2. Remplir `.env` avec vos valeurs locales.
- Configuration production:
  - Variables Web/SSR à configurer dans **Vercel Project Settings > Environment Variables**.
  - Variables Firebase Functions à configurer dans l’environnement Firebase (console/secret manager) avant déploiement.

## Observabilité (PR-1)

- Runbook incident: `docs/runbook-observability.md`
- Routes critiques instrumentées: Stripe (`/api/stripe/*`) et Google Calendar (`/api/google/calendar/*`)
- Erreurs frontend capturées via:
  - handlers globaux (`window.onerror`, `unhandledrejection`)
  - boundary React global (`app/global-error.tsx`)
  - endpoint serveur d’ingestion: `POST /api/observability/client-error`
- Signaux santé minimum viables:
  - `ops.metric.api_5xx`
  - `ops.metric.functions_error`
  - `ops.metric.queue_backlog`
  - `ops.metric.google_quota_error`

### Vérification rapide en production

1. Déclencher une erreur frontend volontaire (env de test) et vérifier le log `frontend.client_error.reported`.
2. Vérifier un appel Stripe/Google et confirmer présence de `requestId` dans les logs API.
3. Vérifier les jobs cron (`checkAndSendReminders`, `assistantRunJobQueue`, `assistantRunAIJobQueue`) et la présence des logs `ops.function.*`.
4. Contrôler la section Ops dans `/admin/dashboard` et le runbook.

### Configuration console restante (option Sentry)

Sentry n’est pas encore branché dans ce repo. Si vous activez Sentry:

1. Créer un projet Sentry Web + Server.
2. Définir DSN/env sur Vercel/Firebase.
3. Mapper les alertes P0 du runbook (spike frontend, API 5xx, functions, backlog, quota Google).

## Ops Monitoring & Alerting (PR-12)

- Runbook ops détaillé: `docs/runbook-monitoring.md`
- Collections Firestore utilisées:
  - `opsMetrics/{metricKey}/points/{bucket}`
  - `opsState/{jobName}`
  - `opsAlerts/{alertKey}`
- Jobs instrumentés:
  - `checkAndSendReminders`
  - `assistantRunJobQueue`
  - `assistantRunAIJobQueue`

Variables Functions (server-only) pour l’alerting:

- `OPS_ALERT_EMAIL_TO`
- `OPS_ALERT_COOLDOWN_MS`
- `OPS_ALERT_BACKLOG_THRESHOLD_REMINDERS`
- `OPS_ALERT_BACKLOG_THRESHOLD_ASSISTANT`
- `OPS_ALERT_CONSEC_FAIL_THRESHOLD`
- `OPS_ALERT_ERROR_RATE_THRESHOLD`
- `OPS_ALERT_STALE_SUCCESS_MS`
- `OPS_ALERT_GOOGLE_GUARD_THRESHOLD`
- `SLACK_WEBHOOK_URL` (optionnel)

Ces variables sont documentées avec des valeurs par défaut dans `/.env.example`.
