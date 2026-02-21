# Release checklist V1 (freeze)

Use this checklist before every production release.

## 1) CI preflight

Run from repository root:

- `pnpm web:typecheck`
- `pnpm web:lint`
- `pnpm web:build`
- `pnpm e2e --grep agenda` (runs only when E2E vars are valid, otherwise clean skip)

Expected: no failing command.

## 2) Vercel preflight

- Node runtime pinned to **20.x**.
- Root Directory for app project: `apps/web`.
- Environment variables present in Vercel for Production/Preview:
  - `NEXT_PUBLIC_FIREBASE_API_KEY`
  - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
  - `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
  - `NEXT_PUBLIC_FIREBASE_APP_ID`
  - `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
  - `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` (optional)
  - `NEXT_PUBLIC_FCM_VAPID_KEY`
  - `NEXT_PUBLIC_APP_URL` (recommended)
- Domain split is explicit:
  - **App/API host**: `app.tachesnotes.com`
  - **Marketing host**: `tachesnotes.com` / `www.tachesnotes.com`
- Confirm app host serves `/api/*`; apex/www should not be used for API calls.

## 3) Firebase preflight

- Confirm current status of:
  - Firestore rules
  - Firestore indexes
  - Cloud Functions
- Confirm ops dashboards and runbooks from PR-12 are accessible and up to date:
  - `docs/runbook-monitoring.md`
  - `docs/runbook-observability.md`
- If no rules/indexes/functions change in the release, skip Firebase deploy.

## 4) Stripe sanity

On **app host** (`app.tachesnotes.com`):

- `/api/stripe/checkout` should not return 404/500 for basic method/auth checks.
- `/api/stripe/portal` should not return 404/500 for basic method/auth checks.
- `/api/stripe/webhook` should not return 404 (method/auth-specific statuses are acceptable).
- Verify Stripe dashboard:
  - webhook endpoint configured and recent deliveries healthy
  - Checkout and Portal products/prices active

## 5) Google Calendar sanity

On **app host** (`app.tachesnotes.com`):

- `GET /api/google/calendar/status` returns 200/401/403, never 404.
- OAuth flow endpoints are reachable:
  - `/api/google/calendar/connect`
  - `/api/google/calendar/callback`

## 6) Rollback plan (urgent)

1. Identify last known stable commit on `main`.
2. Re-deploy that commit on Vercel.
3. If incident involves background workloads, temporarily disable schedulers/jobs in Firebase until issue is understood.
4. Monitor:
   - API 5xx rate
   - function error rates
   - backlog metrics / quota guards
5. Add incident note in runbook after stabilization.
