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
