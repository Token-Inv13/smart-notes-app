# Smart Notes / Tasks – Contexte Projet (Windsurf)

## Résumé du projet

Smart Notes / Tasks est une application de prise de notes et de gestion de tâches, orientée productivité personnelle, avec rappels et notifications push.

Objectifs principaux :
- **Migration / modernisation** d’un ancien projet vers un stack moderne.
- **Expérience multi‑devices** (desktop / mobile) avec PWA installable.
- **Notifications intelligentes** pour les tâches via Firebase Cloud Messaging (FCM) et Cloud Functions.


## Stack technique

- **Framework Web** : Next.js 15 (App Router, `app/`, `use client`)
- **Langage** : TypeScript strict
- **UI / Styling** : Tailwind CSS, base minimaliste (pas de design complexe imposé)
- **Backend as a Service** : Firebase (SDK modulaire uniquement)
  - Auth (Email/Password, etc.)
  - Firestore (base principale : users, notes, tasks, workspaces, taskReminders)
  - Storage
  - Cloud Messaging (FCM Web Push)
  - Analytics (optionnel)
- **Cloud Functions** : Node 18 (ou équivalent supporté) pour logique serveur (rappels, nettoyage…)
- **PWA** :
  - Workbox (pré‑cache, stratégies de cache)
  - Service Worker custom (`apps/web/src/sw.ts`)
  - Manifest Web App (icônes, name, start_url…)


## Structure du monorepo

Racine du repo : `smart-notes-app/`

- **`pnpm-workspace.yaml`** : déclare les workspaces pnpm
- **`apps/web`** : application Next.js 15 (front + PWA)
  - `src/app` : App Router (public / protected)
  - `src/lib` : Firebase init, datetime helpers, FCM utils, etc.
  - `src/hooks` : hooks d’accès Firestore et auth
- **`functions`** : Cloud Functions Firebase (rappels, nettoyage, logique serveur)

Cette structure est **validée** et ne doit plus être re‑inventée.


## Fonctionnalités déjà terminées

### 1. Auth Firebase
- Initialisation Firebase SDK modulaire dans `apps/web/src/lib/firebase.ts`.
- Hook `useAuth` pour suivre l’état utilisateur.
- Layout `(protected)` qui protège les routes privées et redirige vers le login si non authentifié.

### 2. Hooks Firestore
- **Notes** : `useUserNotes` (filtrage par userId, éventuellement workspaceId).
- **Tasks** : `useUserTasks` (filtrage par userId + tri sur `dueDate`).
- **Workspaces** : `useUserWorkspaces` (workspaces possédés et/ou partagés, dédoublonnés).
- **Settings** : `useUserSettings` (doc utilisateur, préférences, etc.).
- Hook générique `useCollection` basé sur Firestore `onSnapshot`.

### 3. Pages App Router (lecture OK)
- **Dashboard** :
  - Affiche un aperçu des notes et tâches récentes.
  - Gère les états `loading / error / empty`.
- **Tasks** :
  - Liste des tâches de l’utilisateur.
  - Filtres locaux : statut (todo/doing/done) + workspace.
  - Tri local : priorise `dueDate`, fallback sur `updatedAt`.
- **Settings** :
  - Affiche les préférences / infos utilisateur.
  - Intègre le toggle des notifications (voir ci‑dessous).

### 4. Settings : notifications & FCM token
- Bouton **toggle / switch** pour activer/désactiver les rappels / notifications dans les préférences utilisateur.
- Bouton **"Enable push notifications"** :
  - Demande la permission de notification au navigateur.
  - Récupère le token FCM Web.
  - Enregistre ce token dans Firestore dans le document `users/{uid}` (champ `fcmTokens`).

### 5. PWA & Service Worker
- Manifest PWA configuré dans `apps/web/src/app/layout.tsx` + `public/`.
- Service Worker personnalisé `apps/web/src/sw.ts` avec :
  - Workbox (precache, routes HTML / `_next/` / icônes).
  - Initialisation de Firebase dans le SW via SDK modulaire `firebase/messaging/sw`.
  - **Notifications foreground** (via client) et **background** (via SW).
  - Deep‑link : lors du `notificationclick`, navigation vers `/tasks?taskId=...` (ou `/tasks` en fallback).

### 6. Cloud Functions
- **`checkAndSendReminders`** :
  - Lit la collection `taskReminders` (schema : `userId`, `taskId`, `dueDate` ISO, `reminderTime` ISO, `sent`).
  - Sélectionne les rappels à envoyer dans une fenêtre de temps donnée.
  - Récupère le document `tasks/{taskId}` et le doc `users/{userId}` pour les tokens FCM.
  - Envoie les notifications FCM avec `data: { taskId, dueDate }`.
  - Marque `sent: true` après envoi.
- **`cleanupOldReminders`** :
  - Nettoie les anciens rappels déjà envoyés / expirés selon une politique définie.

### 7. Helpers datetime
- Fichier `apps/web/src/lib/datetime.ts` :
  - Convertit des valeurs d’input `datetime-local` en `Timestamp` Firestore.
  - Formate les `Timestamp` en texte local lisible.
  - Formate les `Timestamp` pour pré‑remplir les champs `datetime-local`.


## État d’avancement actuel

- **CRUD Tasks** :
  - Create / Update / Delete quasi terminés sur la page `/tasks`.
  - Utilisation de `addDoc` / `updateDoc` / `deleteDoc` avec `userId == auth.currentUser.uid`.
  - `updatedAt` mis à jour avec `serverTimestamp()`.
- **Helpers datetime** :
  - En place et utilisés pour `dueDate` (conversion Timestamp ↔ `datetime-local`).
- **Validation Zod** :
  - Schemas prévus / en cours pour valider les données de tâches avant écriture Firestore.
- **Tri local** :
  - Les tâches sont triées côté client sur `dueDate` (ascendant), puis sur `updatedAt` (descendant).
- **UI Reminders** :
  - Panel "Reminders" par tâche planifié / en cours d’intégration.
  - Lecture + création + suppression de rappels basées sur la collection `taskReminders`.
- **Navigation depuis notifications** :
  - Deep‑link vers `/tasks?taskId=...` intégré côté SW et côté page (scroll & surlignage légers).


## Prochaines étapes

1. **Finaliser complètement le CRUD Tasks**
   - Vérifier tous les cas d’erreur (auth absente, Firestore down, validation Zod invalide).
   - S’assurer que les filtres (statut / workspace) et le tri restent corrects après chaque écriture.

2. **Intégrer / stabiliser l’UI des Reminders par tâche**
   - Hook `useUserTaskReminders` pour charger tous les rappels utilisateur.
   - Pour chaque tâche :
     - Lister les rappels existants (heure, statut sent/pending).
     - Ajouter un formulaire minimal `datetime-local` + bouton "Add reminder".
     - Permettre la suppression d’un rappel (bouton + `confirm`).

3. **Finaliser la navigation depuis les notifications**
   - S’assurer que le SW :
     - Passe bien `payload.data` dans `notification.data`.
     - Ouvre `/tasks?taskId=...` en foreground/background.
   - Côté `/tasks` :
     - Lire `taskId` via `useSearchParams()`.
     - Scroller vers la tâche correspondante et la surligner.

4. **Préparer et valider le déploiement Vercel**
   - Créer/configurer le projet Vercel avec `Root Directory: apps/web`.
   - Configurer les commandes : `pnpm install` + `pnpm build`.
   - Définir les variables d’environnement en Production :
     - `NEXT_PUBLIC_FIREBASE_API_KEY`
     - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
     - `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
     - `NEXT_PUBLIC_FIREBASE_APP_ID`
     - `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
     - `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` (optionnel)
     - `NEXT_PUBLIC_FCM_VAPID_KEY`
     - **Ne pas** définir `NEXT_PUBLIC_USE_EMULATORS` en prod.

5. **Tests end‑to‑end FCM (foreground / background)**
   - Enregistrer un token FCM via la page Settings.
   - Créer une tâche + un rappel (quelques minutes à l’avance).
   - Vérifier :
     - Logs de `checkAndSendReminders` dans Firebase.
     - Réception des notifications lorsque l’app est ouverte (fg) et en arrière‑plan (bg).
     - Deep‑link correct vers `/tasks?taskId=...` et mise en évidence de la tâche.

6. **Agenda / vue calendrier (étape future)**
   - Après stabilisation des rappels :
     - Concevoir une vue "Agenda" ou "Calendrier" pour visualiser tâches + rappels.
     - Réutiliser les mêmes collections (tasks, taskReminders) et règles Firestore.


## Conventions de travail pour Windsurf

Pour toute future session d’édition / développement avec Windsurf :

1. **Charger ce fichier en premier**
   - Toujours lire `docs/windsurf-context.md` pour obtenir le contexte projet avant toute modification.

2. **Ne pas recréer le projet**
   - Ne pas ré‑initialiser Next.js, Firebase ou pnpm.
   - Ne pas modifier la structure du monorepo (`apps/web`, `functions`).

3. **Ne pas toucher aux Firestore Rules ni aux Cloud Functions**
   - Considérer les règles Firestore et les Cloud Functions existantes comme **source de vérité** backend.
   - Toute évolution côté backend doit être discutée/validée explicitement avant d’être modifiée.

4. **Prioriser les tâches listées dans "Prochaines étapes"**
   - D’abord finir/cranter le CRUD Tasks + Reminders + navigation notifs.
   - Ensuite seulement aborder des features plus avancées (Agenda, améliorations UI, etc.).

5. **Génération de code**
   - Ne générer du code que lorsque l’utilisateur le demande explicitement.
   - Dans les autres cas, fournir :
     - une analyse claire,
     - un plan d’implémentation,
     - des recommandations techniques.


## But de ce fichier

Ce fichier sert de **source de vérité durable** pour le projet Smart Notes / Tasks :
- Donne le contexte technique minimal mais suffisant.
- Permet de reprendre le travail depuis n’importe quel environnement (Mac / Windows) sans ré‑expliquer tout l’historique.
- Évite de re‑dessiner l’architecture ou de casser les invariants déjà validés (Next 15, Firebase modulaire, PWA, Cloud Functions existantes).


## Checklist déploiement prod (résumé)

- **Vercel**
  - Créer le projet, `Root Directory = apps/web`.
  - Configurer `Install: pnpm install`, `Build: pnpm build`.
  - Vérifier que Node (Vercel) est en 18 ou 20.

- **Variables d'environnement (Vercel)**
  - Renseigner :
    - `NEXT_PUBLIC_FIREBASE_API_KEY`
    - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
    - `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
    - `NEXT_PUBLIC_FIREBASE_APP_ID`
    - `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
    - `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` (optionnel)
    - `NEXT_PUBLIC_FCM_VAPID_KEY`
  - Ne **pas** définir `NEXT_PUBLIC_USE_EMULATORS`.

- **Firebase backend**
  - (Si nécessaire) `pnpm --filter functions build`.
  - `firebase deploy --only functions,firestore,storage`.

- **Tests rapides après déploiement**
  - Vérifier PWA (manifest + SW actif, site installable).
  - Tester login + accès aux pages protégées.
  - Tester `/tasks` : CRUD + Reminders.
  - Tester `/settings` : toggle + "Enable push notifications".
  - Créer une tâche + reminder et vérifier la notif FCM fg/bg + deep-link `/tasks?taskId=...`.
