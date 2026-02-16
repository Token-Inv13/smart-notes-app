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
