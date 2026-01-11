# Smart Notes — Landing (statique)

Landing page **totalement indépendante** de l’application principale.

- Zéro dépendance
- HTML/CSS statique
- Déploiement simple (idéal Vercel)

## Contenu

- `index.html`
- `styles.css`
- `logo.svg`, `favicon.svg`

## Déploiement sur Vercel

Option A (recommandée) : créer un projet Vercel qui pointe sur le dossier `landing/`.

- Framework preset : **Other**
- Build command : *(vide)*
- Output directory : `landing`

Option B : si tu utilises un mono-repo, configure le projet Vercel avec "Root Directory" = `landing`.

## Modifier les CTA

Dans `index.html`, section `#cta`, remplace :

- `https://app.tachesnotes.com`

par ton domaine de prod (si besoin).
