# SmartNote Admin Back-office (V2)

Ce document décrit l’admin interne SmartNote (V2), orienté exploitation SaaS.

## 1) Accès au back-office

- URL: `/admin`
- Prérequis:
  - session Firebase valide (cookie `session`)
  - custom claim Firebase Auth: `admin: true`
- Si non-admin:
  - accès bloqué
  - redirection vers `/access-denied`

La garde est appliquée côté server sur le layout admin:
- `apps/web/src/app/(protected)/admin/layout.tsx`

## 2) Attribution du claim `admin=true` (compte propriétaire uniquement)

Script fourni:
- `scripts/set-admin-claim.mjs`

### Activer admin

```bash
pnpm admin:set-claim --email=votre-email@domaine.com
# ou
pnpm admin:set-claim --uid=FIREBASE_UID
```

### Retirer admin

```bash
pnpm admin:set-claim --email=votre-email@domaine.com --disable=true
```

### Variables requises (Admin SDK)

Configurer **une** des options:
1. `FIREBASE_ADMIN_JSON` (recommandé)
2. ou `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY`

Après changement de claim, forcer une reconnexion si le cookie de session est déjà établi.

## 3) Fonctions admin (Cloud Functions callable)

Implémentation:
- `functions/src/admin.ts`
- export depuis `functions/src/index.ts`

Fonctions disponibles:
- `adminLookupUser`
- `adminRevokeUserSessions`
- `adminEnablePremium`
- `adminDisablePremium`
- `adminResetUserFlags`
- `adminSendUserMessage`
- `adminListUsersIndex`
- `rebuildAdminUsersIndex`
- `adminListUserActivityEvents`
- `adminGetHealthSummary`
- `adminListAuditLogs`
- `adminListErrorLogs`

Règles de sécurité côté Functions:
- hard check sur `context.auth`
- hard check sur `context.auth.token.admin === true`
- validation d’input (UID, query, durée premium)
- garde max premium = 365 jours

## 4) Journal d’audit admin

Collection Firestore:
- `adminAuditLogs`

Chaque action admin écrit:
- `adminUid`
- `targetUserUid`
- `action`
- `payload`
- `status`
- `message`
- `createdAt`

## 5) Collections admin (V2)

- `adminUsersIndex/{uid}`
  - `uid`, `email`, `createdAt`, `lastSeenAt`, `plan`, `premiumUntil`, `status`, `tags`
  - optionnels: `notesCount`, `tasksCount`, `favoritesCount`, `lastErrorAt`
- `adminAuditLogs/{id}`
- `appErrorLogs/{id}`
- `userActivityEvents/{id}`

## 6) Journal d’erreurs backend

Collection Firestore:
- `appErrorLogs`

Format minimal:
- `source` (`functions`)
- `category` (`functions`, `auth`, `payments`, `ai`)
- `scope`
- `code`
- `message`
- `context`
- `createdAt`

Page admin:
- `/admin/errors`
- filtre type + détails d’un événement

## 7) Modules back-office V2

- Users Index: table paginée/filtrable/triable + ouverture fiche
- Diagnostic compte: badge santé (`Sain`, `Inactif`, `Erreurs`, `Bloqué`, `Premium`)
- Timeline utilisateur: événements récents + filtre type
- Messages in-app: envoi d’un message support vers `users/{uid}/inbox`
- Santé opérateur: KPI 24h + liste erreurs + lien rapide vers fiche user
- UX anti-erreur: confirmations actions sensibles, historique users récents, actions groupées

## 8) Firestore Rules (sécurité)

Les collections user restent user-scoped.

Ajouts:
- helper `isAdmin()` basé sur custom claim
- `adminUsersIndex`: lecture admin uniquement, write client interdit
- `adminAuditLogs`: lecture admin uniquement, write client interdit
- `appErrorLogs`: lecture admin uniquement, write client interdit

Fichier:
- `firestore.rules`

## 9) Variables d’environnement (Vercel + Functions)

### Web (Vercel: `apps/web`)

Déjà existantes pour Firebase web SDK + session API.

Admin nécessite aussi côté server routes/layout:
- `FIREBASE_ADMIN_JSON` (ou triplet `FIREBASE_ADMIN_*`)

### Firebase Functions

Dans l’environnement Functions:
- `OPENAI_API_KEY` etc. (déjà existant selon votre setup)
- pas de variable spéciale supplémentaire pour admin V1 (hors credentials Firebase par défaut runtime)

## 10) Déploiement

### 8.1 Vérifications locales

```bash
pnpm web:lint
pnpm web:typecheck
pnpm web:build
pnpm functions:build
pnpm functions:test
```

### 8.2 Déploiement Firebase

- Functions:
  - `pnpm functions:deploy`
- Rules:
  - `firebase deploy --only firestore:rules`

### 8.3 Déploiement Vercel

Déployer `apps/web` avec variables server/admin correctement définies.

## 11) Checklist sécurité rapide

- [ ] seul votre compte a `admin: true`
- [ ] `/admin` inaccessible sans claim
- [ ] aucune action sensible depuis front (tout passe par callable)
- [ ] `adminAuditLogs` alimenté à chaque action
- [ ] `appErrorLogs` alimenté sur erreurs backend admin
- [ ] `adminUsersIndex` alimenté (triggers + rebuild callable)
- [ ] actions sensibles confirmées côté UI admin
- [ ] `firestore.rules` en prod autorise lecture admin seulement sur collections admin

