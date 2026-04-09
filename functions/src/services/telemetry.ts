import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import * as functions from 'firebase-functions/v1';

// --- Types ---

export type ObserveStatus = 'success' | 'error';

export type ObserveFunctionContext = {
  functionName: string;
  requestId: string;
  startMs: number;
  meta?: Record<string, unknown>;
};

export type OpsMetricLabels = Record<string, string>;

export type OpsJobSnapshotInput = {
  functionName: 'checkAndSendReminders' | 'assistantRunJobQueue' | 'assistantRunAIJobQueue';
  requestId: string;
  success: boolean;
  durationMs: number;
  processed: number;
  failed: number;
  backlogSize: number;
  sent?: number;
  shardCount?: number;
  stoppedByBacklogGuard?: boolean;
  stopThresholdHit?: boolean;
};

export type OpsStateDoc = {
  jobName: string;
  lastRunAtMs: number;
  lastSuccessAtMs?: number;
  lastFailureAtMs?: number;
  lastDurationMs: number;
  lastBacklogSize: number;
  lastProcessed: number;
  lastFailed: number;
  lastSent?: number;
  lastShardCount?: number;
  lastStoppedByBacklogGuard?: boolean;
  lastStopThresholdHit?: boolean;
  consecutiveFailures: number;
  backlogAboveThresholdRuns: number;
  updatedAt: admin.firestore.FieldValue;
};

// --- Env Helpers ---

export function readEnvString(name: string): string {
  const raw = process.env[name];
  return typeof raw === 'string' ? raw.trim() : '';
}

export function readEnvNumber(name: string, fallback: number): number {
  const raw = typeof process.env[name] === 'string' ? process.env[name]?.trim() : '';
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

// --- Observation ---

export function beginFunctionObserve(params: {
  functionName: string;
  requestId?: string;
  meta?: Record<string, unknown>;
}): ObserveFunctionContext {
  const ctx: ObserveFunctionContext = {
    functionName: params.functionName,
    requestId: params.requestId ?? crypto.randomUUID(),
    startMs: Date.now(),
    meta: params.meta,
  };

  console.info('ops.function.started', {
    functionName: ctx.functionName,
    requestId: ctx.requestId,
    ...(ctx.meta ?? {}),
  });

  return ctx;
}

export async function writeFunctionErrorLog(params: {
  functionName: string;
  code: string;
  message: string;
  context?: Record<string, unknown>;
}) {
  try {
    const db = admin.firestore();
    await db.collection('appErrorLogs').add({
      source: 'functions',
      category: 'functions',
      scope: params.functionName,
      code: params.code,
      message: params.message,
      context: params.context ?? {},
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch {
    // best effort
  }
}

export async function endFunctionObserve(
  ctx: ObserveFunctionContext,
  status: ObserveStatus,
  extra?: Record<string, unknown>,
) {
  const durationMs = Date.now() - ctx.startMs;
  const payload = {
    functionName: ctx.functionName,
    requestId: ctx.requestId,
    durationMs,
    status,
    ...(ctx.meta ?? {}),
    ...(extra ?? {}),
  };

  if (status === 'error') {
    console.error('ops.function.failed', payload);
    console.warn('ops.metric.functions_error', {
      functionName: ctx.functionName,
      count: 1,
      requestId: ctx.requestId,
      durationMs,
    });
    await writeFunctionErrorLog({
      functionName: ctx.functionName,
      code: 'internal',
      message: 'Function execution failed.',
      context: payload,
    });
    return;
  }

  console.info('ops.function.completed', payload);
}

// --- Metrics & Buckets ---

export function toMinuteBucket(date: Date): string {
  return date.toISOString().slice(0, 16);
}

export function toHourBucket(date: Date): string {
  return date.toISOString().slice(0, 13);
}

export function toDayBucket(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function bucketStartMs(bucket: string): number {
  const iso =
    bucket.length === 16 ? `${bucket}:00.000Z` : bucket.length === 13 ? `${bucket}:00:00.000Z` : `${bucket}T00:00:00.000Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : Date.now();
}

export async function upsertOpsMetricBuckets(params: {
  db: admin.firestore.Firestore;
  metricKey: string;
  value: number;
  labels?: OpsMetricLabels;
  now: Date;
}) {
  const { db, metricKey, labels, now } = params;
  const value = Number.isFinite(params.value) ? params.value : 0;
  const buckets = [toMinuteBucket(now), toHourBucket(now), toDayBucket(now)];

  const batch = db.batch();
  for (const bucket of buckets) {
    const pointRef = db.collection('opsMetrics').doc(metricKey).collection('points').doc(bucket);
    batch.set(
      pointRef,
      {
        metricKey,
        bucket,
        createdAtMs: bucketStartMs(bucket),
        value: admin.firestore.FieldValue.increment(value),
        ...(labels ? { labels } : {}),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  await batch.commit();
}

export async function sumOpsMetricSince(params: {
  db: admin.firestore.Firestore;
  metricKey: string;
  sinceMs: number;
}): Promise<number> {
  const { db, metricKey, sinceMs } = params;
  const snap = await db
    .collection('opsMetrics')
    .doc(metricKey)
    .collection('points')
    .where('createdAtMs', '>=', sinceMs)
    .get();

  return snap.docs.reduce((acc, doc) => {
    const raw = doc.get('value');
    return acc + (typeof raw === 'number' && Number.isFinite(raw) ? raw : 0);
  }, 0);
}

// --- Alerts ---

export function opsAlertCooldownMs(): number {
  return Math.max(60_000, Math.trunc(readEnvNumber('OPS_ALERT_COOLDOWN_MS', 30 * 60 * 1000)));
}

export function opsConsecutiveFailThreshold(): number {
  return Math.max(1, Math.trunc(readEnvNumber('OPS_ALERT_CONSEC_FAIL_THRESHOLD', 3)));
}

export function opsReminderBacklogThreshold(): number {
  return Math.max(1, Math.trunc(readEnvNumber('OPS_ALERT_BACKLOG_THRESHOLD_REMINDERS', 180)));
}

export function opsAssistantBacklogThreshold(): number {
  return Math.max(1, Math.trunc(readEnvNumber('OPS_ALERT_BACKLOG_THRESHOLD_ASSISTANT', 40)));
}

export function opsErrorRateThreshold(): number {
  const ratio = readEnvNumber('OPS_ALERT_ERROR_RATE_THRESHOLD', 0.3);
  if (!Number.isFinite(ratio)) return 0.3;
  return Math.max(0.01, Math.min(1, ratio));
}

export function opsGoogleGuardThreshold(): number {
  return Math.max(1, Math.trunc(readEnvNumber('OPS_ALERT_GOOGLE_GUARD_THRESHOLD', 6)));
}

export function opsRunStaleThresholdMs(): number {
  return Math.max(60_000, Math.trunc(readEnvNumber('OPS_ALERT_STALE_SUCCESS_MS', 15 * 60 * 1000)));
}

export function opsLogsUrl(functionName: string): string {
  const projectId = readEnvString('GCLOUD_PROJECT') || readEnvString('GCP_PROJECT');
  if (!projectId) return 'https://console.cloud.google.com/logs/query';
  return `https://console.cloud.google.com/logs/query?project=${encodeURIComponent(projectId)}&query=${encodeURIComponent(
    `resource.type="cloud_function"\nlabels.function_name="${functionName}"`,
  )}`;
}
