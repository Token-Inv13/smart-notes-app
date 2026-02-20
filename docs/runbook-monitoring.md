# Runbook Monitoring & Alerting (PR-12)

## 1) Périmètre couvert

Le monitoring léger PR-12 couvre:

- Scheduler reminders: `checkAndSendReminders`
- Queue assistant intents: `assistantRunJobQueue`
- Queue assistant IA: `assistantRunAIJobQueue`
- Backlog des queues (reminders + assistant)
- Alerting opérationnel (email + Slack optionnel)

## 2) Schémas Firestore

### `opsMetrics/{metricKey}/points/{bucket}`

```json
{
  "metricKey": "ops.job.assistantRunJobQueue.processed",
  "bucket": "2026-02-20T16:51",
  "createdAtMs": 1771606260000,
  "value": 12,
  "labels": { "jobName": "assistantRunJobQueue" },
  "updatedAt": "serverTimestamp()"
}
```

- Buckets écrits automatiquement en minute/heure/jour.
- Les valeurs sont agrégées (`increment`) pour éviter le spam de documents.

### `opsState/{jobName}`

État courant par job:

- `lastRunAtMs`
- `lastSuccessAtMs`
- `lastFailureAtMs`
- `consecutiveFailures`
- `backlogAboveThresholdRuns`
- `lastBacklogSize`
- `lastDurationMs`

### `opsAlerts/{alertKey}`

Anti-spam/cooldown des alertes:

- `lastSentAtMs`
- `sentCount`
- `lastTitle`
- `lastMessage`
- `jobName`

## 3) Seuils par défaut

Variables Functions (voir `.env.example`):

- `OPS_ALERT_COOLDOWN_MS=1800000` (30 min)
- `OPS_ALERT_BACKLOG_THRESHOLD_REMINDERS=180`
- `OPS_ALERT_BACKLOG_THRESHOLD_ASSISTANT=40`
- `OPS_ALERT_CONSEC_FAIL_THRESHOLD=3`
- `OPS_ALERT_ERROR_RATE_THRESHOLD=0.3` (30% sur 10 min)
- `OPS_ALERT_STALE_SUCCESS_MS=900000` (15 min)
- `OPS_ALERT_GOOGLE_GUARD_THRESHOLD=6`

## 4) Conditions d’alerte V1

Une alerte est émise si:

1. `errorRate` sur 10 min > `OPS_ALERT_ERROR_RATE_THRESHOLD`
2. `backlogSize` > seuil pendant >= 3 runs consécutifs
3. `consecutiveFailures` >= `OPS_ALERT_CONSEC_FAIL_THRESHOLD`
4. pas de succès depuis plus de `OPS_ALERT_STALE_SUCCESS_MS`
5. `ops.metric.google_quota.globalGuardHits` élevé (si ce signal est alimenté)

Canaux:

- Email si `OPS_ALERT_EMAIL_TO` et SMTP configurés
- Slack si `SLACK_WEBHOOK_URL` est présent

## 5) Vérifications rapides

### Logs Functions

```bash
firebase functions:log --only checkAndSendReminders -n 50
firebase functions:log --only assistantRunJobQueue -n 50
firebase functions:log --only assistantRunAIJobQueue -n 50
```

Chercher:

- `ops.function.started`
- `ops.function.completed`
- `ops.function.failed`
- `ops.alert.dispatched`

### Firestore (console)

- `opsState/*` → vérifier `lastSuccessAtMs`, `consecutiveFailures`, `lastBacklogSize`
- `opsAlerts/*` → vérifier cooldown et dernier envoi
- `opsMetrics/*/points/*` → vérifier présence des buckets minute/heure/jour

## 6) Procédures d'incident

### Backlog élevé persistant

1. Vérifier `opsState/{job}.lastBacklogSize`
2. Vérifier erreurs `ops.function.failed`
3. Vérifier quotas SMTP/OpenAI/Firebase
4. Si nécessaire réduire cadence entrante et relancer manuellement la queue

### Plus de succès depuis > 15 min

1. Vérifier deploy Functions et schedulers actifs
2. Vérifier erreurs runtime (`functions:log`)
3. Vérifier règles/index Firestore déployés

### Email/Slack d’alerte non reçu

1. Vérifier `OPS_ALERT_EMAIL_TO`
2. Vérifier variables SMTP (`SMTP_*`, `APP_BASE_URL`)
3. Vérifier `SLACK_WEBHOOK_URL` (optionnel)
4. Vérifier `opsAlerts/*` (cooldown peut bloquer un renvoi)

## 7) Déploiement ops

Si modifications ops PR-12:

```bash
firebase deploy --only firestore:rules
firebase deploy --only functions
```

(Indexes: uniquement si requis par nouvelle requête Firestore)
