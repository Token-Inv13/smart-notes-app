# Firebase configuration for `apps/web`

This document explains how to configure Firebase for the Next.js app in `apps/web` using the modern SDK (v10+), without compat or CDN imports.

## 1. Environment variables (`.env.local`)

Create a file `apps/web/.env.local` (not committed) with at least:

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id

# Optional: Google Analytics
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-XXXXXXXXXX

# Whether to use local Firebase emulators (auth/firestore/storage)
NEXT_PUBLIC_USE_EMULATORS=true

# Web push key for FCM (VAPID key)
NEXT_PUBLIC_FCM_VAPID_KEY=your-fcm-vapid-key
```

These values can be copied from the Firebase console (project settings) or from your existing configuration.

## 2. Firebase initialization

The app uses a single initialization module:

- `apps/web/src/lib/firebase.ts`
  - Initializes `app`, `auth`, `db`, `storage` using the modern modular SDK.
  - Exposes helpers for Messaging (`getMessagingInstance`) and Analytics (`getAnalyticsInstance`).
  - Connects to emulators when `NEXT_PUBLIC_USE_EMULATORS=true`.

## 3. Emulators

At the root of the repository (`smart-notes-app`), you already have a Firebase configuration:

- `firebase.json` with emulators for:
  - Auth: `127.0.0.1:9099`
  - Firestore: `127.0.0.1:8080`
  - Storage: `127.0.0.1:9199`

### 3.1 Start emulators

From the project root:

```bash
pnpm emulators
```

This uses the existing npm script:

```json
"emulators": "firebase emulators:start --import=./emulator-data --export-on-exit"
```

Ensure you have `firebase-tools` installed globally or via pnpm.

### 3.2 Use emulators from the web app

In `apps/web/.env.local`:

```bash
NEXT_PUBLIC_USE_EMULATORS=true
```

Then run the Next.js dev server for the web app:

```bash
pnpm --filter web dev
```

The app will connect to:

- Auth emulator on `http://localhost:9099`
- Firestore emulator on `localhost:8080`
- Storage emulator on `localhost:9199`

When you want to use production Firebase instead, set:

```bash
NEXT_PUBLIC_USE_EMULATORS=false
```

(or remove the variable) and restart the dev server.

## 4. Hooks

Two React client hooks are available in `apps/web/src/hooks`:

- `useAuth()`
  - Subscribes to Firebase Auth state using `onAuthStateChanged`.
  - Returns `{ user, loading }`.
- `useCollection<T>(query)`
  - Listens to a Firestore `Query<T>` using `onSnapshot`.
  - Returns `{ data, loading, error }` where `data` includes `id` merged into each document.

These are intentionally generic and contain no application-specific business logic.
