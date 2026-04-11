import * as admin from 'firebase-admin';
import { OpsJobSnapshotInput, OpsStateDoc } from '../core/types';
import { 
  opsReminderBacklogThreshold, 
  opsAssistantBacklogThreshold,
} from './telemetry';

export async function writeOpsJobSnapshot(params: OpsJobSnapshotInput) {
  const db = admin.firestore();
  const { functionName, requestId, success, durationMs, processed, failed, backlogSize } = params;

  const snapshotRef = db.collection('opsJobSnapshots').doc(requestId);
  await snapshotRef.set({
    ...params,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const stateRef = db.collection('opsJobStates').doc(functionName);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(stateRef);
    const nowMs = Date.now();
    let state: OpsStateDoc;

    if (!snap.exists) {
      state = {
        jobName: functionName,
        lastRunAtMs: nowMs,
        lastSuccessAtMs: success ? nowMs : undefined,
        lastFailureAtMs: success ? undefined : nowMs,
        lastDurationMs: durationMs,
        lastBacklogSize: backlogSize,
        lastProcessed: processed,
        lastFailed: failed,
        consecutiveFailures: success ? 0 : 1,
        backlogAboveThresholdRuns: 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
    } else {
      const data = snap.data() as OpsStateDoc;
      const threshold = functionName === 'checkAndSendReminders' ? opsReminderBacklogThreshold() : opsAssistantBacklogThreshold();

      state = {
        ...data,
        lastRunAtMs: nowMs,
        lastSuccessAtMs: success ? nowMs : data.lastSuccessAtMs,
        lastFailureAtMs: success ? data.lastFailureAtMs : nowMs,
        lastDurationMs: durationMs,
        lastBacklogSize: backlogSize,
        lastProcessed: processed,
        lastFailed: failed,
        consecutiveFailures: success ? 0 : data.consecutiveFailures + 1,
        backlogAboveThresholdRuns: backlogSize > threshold ? data.backlogAboveThresholdRuns + 1 : 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
    }

    tx.set(stateRef, state);
  });
}

export function backlogOldestAgeMs(docs: admin.firestore.QueryDocumentSnapshot[], field = 'createdAt'): number {
  if (docs.length === 0) return 0;
  const now = Date.now();
  let oldestMs = now;

  for (const doc of docs) {
    const ts = doc.get(field);
    if (ts && typeof ts.toMillis === 'function') {
      const ms = ts.toMillis();
      if (ms < oldestMs) oldestMs = ms;
    }
  }

  return now - oldestMs;
}
