import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { AssistantAIJobDoc, AssistantAIResultDoc } from './types';
import { sha256Hex, normalizeAssistantText } from '../services/ai';
import { assistantMetricsRef, metricsIncrements } from '../services/telemetry';

const ASSISTANT_AI_JOB_LOCK_MS = 5 * 60 * 1000;
const ASSISTANT_AI_JOB_MAX_ATTEMPTS = 3;

export async function claimAssistantAIJob(params: {
  db: admin.firestore.Firestore;
  ref: admin.firestore.DocumentReference;
  now: admin.firestore.Timestamp;
}): Promise<AssistantAIJobDoc | null> {
  const { db, ref, now } = params;
  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data() as any;
    const status = data?.status as any;
    if (status !== 'queued') return null;

    const attempts = typeof data?.attempts === 'number' ? data.attempts : 0;
    if (attempts >= ASSISTANT_AI_JOB_MAX_ATTEMPTS) {
      tx.update(ref, { status: 'error', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      return null;
    }

    const lockedUntil: admin.firestore.Timestamp | null = data?.lockedUntil ?? null;
    if (lockedUntil && lockedUntil.toMillis() > now.toMillis()) return null;

    const nextLocked = admin.firestore.Timestamp.fromMillis(now.toMillis() + ASSISTANT_AI_JOB_LOCK_MS);
    tx.update(ref, {
      status: 'processing',
      attempts: attempts + 1,
      lockedUntil: nextLocked,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return snap.data() as AssistantAIJobDoc;
  });
}
