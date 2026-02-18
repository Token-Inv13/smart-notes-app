# Runbook incident - Observabilite Smart Notes

## 1) Ou voir les erreurs

### Frontend (Web)

- Source: endpoint d'ingestion `POST /api/observability/client-error`
- Traces serveur: logs JSON `frontend.client_error.reported`
- Contexte inclus: `uidHash`, `route`, `env`, `appVersion`, `requestId`

### Backend Next API

- Logs structures via `apiObservability`:
  - `api.request.started`
  - `api.request.completed`
  - `api.request.warn`
  - `api.request.failed`
  - `api.request.exception`
- Correlation: `requestId` present sur toutes les routes critiques Stripe/Google

### Cloud Functions

- Logs structures:
  - `ops.function.started`
  - `ops.function.completed`
  - `ops.function.failed`
- Jobs couverts (minimum viable):
  - `checkAndSendReminders`
  - `assistantRunJobQueue`
  - `assistantRunAIJobQueue`
  - callable `assistantExecuteIntent`

## 2) Signaux de sante (MVP)

### API 5xx rate

- Signal log: `ops.metric.api_5xx`
- Champs: `route`, `eventName`, `status`, `durationMs`, `requestId`

### Functions error rate

- Signal log: `ops.metric.functions_error`
- Champs: `functionName`, `count`, `durationMs`, `requestId`

### Queue backlog estimation

- Signal log: `ops.metric.queue_backlog`
- Queues: `taskReminders`, `assistantJobs`, `assistantAIJobs`
- Champs: `pending`, `oldestAgeMs`

### Google quota/rate-limit

- Signal log: `ops.metric.google_quota_error`
- Declenche sur status `429` Google Calendar events

## 3) Triage rapide (ordre recommande)

1. **Auth/session**
   - Verifier pics `401/403` sur routes API
   - Verifier erreurs `frontend.auth_settings_snapshot_error`
2. **Stripe (checkout/portal/webhook/sync)**
   - Filtrer par `route` `/api/stripe/*`
   - Correlier avec `requestId`
3. **Google Calendar**
   - Filtrer `/api/google/calendar/*`
   - Chercher `ops.metric.google_quota_error`
4. **Reminders / assistant queues**
   - Verifier `ops.metric.queue_backlog`
   - Si `pending` augmente et `oldestAgeMs` grimpe, priorite P0

## 4) Alerting P0 a configurer (console observabilite)

Configurer des alertes sur fenetre glissante 5-15 min:

1. **Frontend errors spike**
   - Condition: `frontend.client_error.reported` > 20 / 5 min
2. **API 5xx spike**
   - Condition: `ops.metric.api_5xx` > 10 / 5 min
3. **Functions errors spike**
   - Condition: `ops.metric.functions_error` > 5 / 10 min
4. **Queue backlog critique**
   - Condition: `ops.metric.queue_backlog.pending` > 200
   - OU `oldestAgeMs` > 15 min
5. **Google quota errors repetes**
   - Condition: `ops.metric.google_quota_error` >= 5 / 10 min

## 5) Actions de mitigation immediate

- **Stripe indisponible**: masquer temporairement CTA upgrade/portal dans l'interface admin si necessaire.
- **Google quota**: desactiver temporairement affichage agenda Google cote UI et informer utilisateur.
- **Queue saturation**: reduire traitements non critiques (jobs assistant) et prioriser reminders.
- **Incident auth**: forcer re-auth (`invalidateAuthSession`) pour nettoyer sessions invalidees.

## 6) Rollback checklist

1. Identifier le dernier commit de prod stable.
2. Revert ciblé des changements observabilite si bruit excessif (sans toucher flux produit).
3. Verifier:
   - login
   - notes/tasks/todo
   - checkout/portal
   - agenda Google
4. Confirmer baisse des alertes et stabilite 30 min.
