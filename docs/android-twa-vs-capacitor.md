---
description: TWA vs Capacitor pour un widget Android
---

# Objectif

Comparer **TWA (Trusted Web Activity)** et **Capacitor** pour intégrer Smart Notes sur Android, avec un focus sur la faisabilité d’un **widget Android** (home screen).

# TWA (Trusted Web Activity)

## Ce que c’est

- Publication Android d’une **PWA** via Chrome (l’app ouvre le site en mode plein écran, avec une expérience “app-like”).

## Avantages

- Time-to-market très rapide.
- Codebase unique (web).
- Très bon fit pour une app “PWA-first”.

## Limites (importantes pour un widget)

- Un widget Android est un composant **natif** (RemoteViews + AppWidgetProvider).
- Une TWA **ne permet pas** d’implémenter un widget Android en pur web.
- Pour un widget, il faut de toute façon:
  - du code natif,
  - des services/receivers,
  - éventuellement de la synchro locale.

## Conclusion TWA

- **Parfait** pour distribuer rapidement la webapp.
- **Insuffisant** pour un vrai widget Android, sauf à ajouter une app native compagnon (ce qui réduit l’intérêt de TWA-only).

# Capacitor

## Ce que c’est

- Un runtime mobile “native shell” autour de la webapp.
- Donne accès aux APIs Android/iOS via plugins.

## Avantages

- Permet d’ajouter du **code Android natif** dans le même projet (widget, intents, background tasks, notifications avancées…).
- Intégration plus flexible avec le système Android.

## Limites

- Complexité build/release plus élevée qu’une TWA.
- Maintenance de code natif (Android Studio / Gradle).
- Packaging + distribution à gérer.

## Conclusion Capacitor

- **Recommandé** si l’objectif inclut un **widget Android**.

# Recommandation pragmatique

- Si l’objectif court terme est juste “app installable” + mobile-first: **TWA**.
- Si l’objectif inclut un **widget Android** (home screen): **Capacitor** (ou une app native dédiée) est le choix le plus réaliste.
