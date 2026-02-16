import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

type AuditStatus = 'success' | 'error' | 'denied';

type AuditLogRecord = {
  adminUid: string | null;
  targetUserUid: string | null;
  action: string;
  payload: Record<string, unknown>;
  status: AuditStatus;
  message: string;
  createdAt: FirebaseFirestore.FieldValue;
};

type ErrorLogRecord = {
  source: 'functions';
  category: 'functions' | 'auth' | 'payments' | 'ai';
  scope: string;
  code: string;
  message: string;
  context: Record<string, unknown>;
  createdAt: FirebaseFirestore.FieldValue;
};

type PaginationCursor = {
  createdAtMs: number;
  id: string;
};

const MAX_DURATION_DAYS = 365;
const DEFAULT_PREMIUM_DURATION_DAYS = 30;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 50;
const MAX_SCAN_FACTOR = 5;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toPositiveInteger(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const int = Math.trunc(value);
  if (int < 1) return fallback;
  return Math.min(int, max);
}

function readTimestampMs(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const ts = value as { toMillis?: unknown };
  if (typeof ts.toMillis !== 'function') return null;
  try {
    return (ts.toMillis as () => number)();
  } catch {
    return null;
  }
}

function parseCursor(value: unknown): PaginationCursor | null {
  if (!isObject(value)) return null;
  const id = toNonEmptyString(value.id);
  const createdAtMsRaw = value.createdAtMs;
  if (!id || typeof createdAtMsRaw !== 'number' || !Number.isFinite(createdAtMsRaw) || createdAtMsRaw <= 0) {
    return null;
  }
  return { createdAtMs: Math.trunc(createdAtMsRaw), id };
}

function mapAuditLog(doc: FirebaseFirestore.QueryDocumentSnapshot): {
  id: string;
  adminUid: string | null;
  targetUserUid: string | null;
  action: string;
  status: string;
  message: string;
  createdAtMs: number | null;
  payload: Record<string, unknown>;
} {
  const data = doc.data();
  return {
    id: doc.id,
    adminUid: toOptionalString(data.adminUid),
    targetUserUid: toOptionalString(data.targetUserUid),
    action: toOptionalString(data.action) ?? 'unknown',
    status: toOptionalString(data.status) ?? 'unknown',
    message: toOptionalString(data.message) ?? '',
    createdAtMs: readTimestampMs(data.createdAt),
    payload: isObject(data.payload) ? data.payload : {},
  };
}

function mapErrorLog(doc: FirebaseFirestore.QueryDocumentSnapshot): {
  id: string;
  category: string;
  scope: string;
  code: string;
  message: string;
  createdAtMs: number | null;
  context: Record<string, unknown>;
} {
  const data = doc.data();
  return {
    id: doc.id,
    category: toOptionalString(data.category) ?? 'functions',
    scope: toOptionalString(data.scope) ?? 'admin',
    code: toOptionalString(data.code) ?? 'internal',
    message: toOptionalString(data.message) ?? 'Unknown error',
    createdAtMs: readTimestampMs(data.createdAt),
    context: isObject(data.context) ? data.context : {},
  };
}

function toHttpsError(err: unknown): functions.https.HttpsError {
  if (err instanceof functions.https.HttpsError) return err;
  if (isObject(err)) {
    const rawCode = toOptionalString(err.code);
    if (rawCode === 'auth/user-not-found') {
      return new functions.https.HttpsError('not-found', 'User not found.');
    }
    if (rawCode?.startsWith('auth/')) {
      return new functions.https.HttpsError('invalid-argument', toOptionalString(err.message) ?? 'Auth operation failed.');
    }
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  return new functions.https.HttpsError('internal', message);
}

async function writeAdminAuditLog(params: {
  adminUid: string | null;
  targetUserUid: string | null;
  action: string;
  payload?: Record<string, unknown>;
  status: AuditStatus;
  message: string;
}) {
  const db = admin.firestore();
  const record: AuditLogRecord = {
    adminUid: params.adminUid,
    targetUserUid: params.targetUserUid,
    action: params.action,
    payload: params.payload ?? {},
    status: params.status,
    message: params.message,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await db.collection('adminAuditLogs').add(record);
}

async function writeAppErrorLog(params: {
  category: ErrorLogRecord['category'];
  scope: string;
  code: string;
  message: string;
  context?: Record<string, unknown>;
}) {
  const db = admin.firestore();
  const record: ErrorLogRecord = {
    source: 'functions',
    category: params.category,
    scope: params.scope,
    code: params.code,
    message: params.message,
    context: params.context ?? {},
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await db.collection('appErrorLogs').add(record);
}

function assertAdmin(context: functions.https.CallableContext): string {
  const uid = context.auth?.uid;
  if (!uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const claims = context.auth?.token as Record<string, unknown> | undefined;
  if (claims?.admin !== true) {
    throw new functions.https.HttpsError('permission-denied', 'Admin claim required.');
  }

  return uid;
}

function sanitizeLookupQuery(raw: string): { mode: 'email' | 'uid'; value: string } {
  const value = raw.trim();
  if (value.includes('@')) {
    return { mode: 'email', value: value.toLowerCase() };
  }
  return { mode: 'uid', value };
}

function normalizeAction(raw: unknown): string | null {
  const value = toOptionalString(raw);
  if (!value) return null;
  return value.slice(0, 64);
}

function normalizeCategory(raw: unknown): ErrorLogRecord['category'] | null {
  const value = toOptionalString(raw);
  if (!value) return null;
  if (value === 'functions' || value === 'auth' || value === 'payments' || value === 'ai') {
    return value;
  }
  return null;
}

function getUserDocDisplay(data: Record<string, unknown>): {
  plan: 'free' | 'pro';
  stripeSubscriptionStatus: string | null;
  createdAtMs: number | null;
  updatedAtMs: number | null;
} {
  const rawPlan = toOptionalString(data.plan);
  const plan: 'free' | 'pro' = rawPlan === 'pro' ? 'pro' : 'free';
  const stripeSubscriptionStatus = toOptionalString(data.stripeSubscriptionStatus);
  const createdAtMs = readTimestampMs(data.createdAt);
  const updatedAtMs = readTimestampMs(data.updatedAt);
  return { plan, stripeSubscriptionStatus, createdAtMs, updatedAtMs };
}

async function countQuery(query: FirebaseFirestore.Query): Promise<number> {
  try {
    const aggregate = await query.count().get();
    return aggregate.data().count;
  } catch {
    const snap = await query.get();
    return snap.size;
  }
}

export const adminLookupUser = functions.https.onCall(async (data, context) => {
  const action = 'user_lookup';
  const adminUid = context.auth?.uid ?? null;
  const payload = isObject(data) ? data : {};

  try {
    const actorUid = assertAdmin(context);

    const queryRaw = toNonEmptyString(payload.query);
    if (!queryRaw) {
      throw new functions.https.HttpsError('invalid-argument', 'query (email or uid) is required.');
    }

    const lookup = sanitizeLookupQuery(queryRaw);
    const auth = admin.auth();
    const target =
      lookup.mode === 'email'
        ? await auth.getUserByEmail(lookup.value)
        : await auth.getUser(lookup.value);

    const db = admin.firestore();
    const userRef = db.collection('users').doc(target.uid);
    const userSnap = await userRef.get();
    const userDoc = userSnap.exists && isObject(userSnap.data()) ? (userSnap.data() as Record<string, unknown>) : {};

    const [notesCount, tasksCount, todosCount, favoriteNotesCount, favoriteTasksCount, favoriteTodosCount] =
      await Promise.all([
        countQuery(db.collection('notes').where('userId', '==', target.uid)),
        countQuery(db.collection('tasks').where('userId', '==', target.uid)),
        countQuery(db.collection('todos').where('userId', '==', target.uid)),
        countQuery(db.collection('notes').where('userId', '==', target.uid).where('favorite', '==', true)),
        countQuery(db.collection('tasks').where('userId', '==', target.uid).where('favorite', '==', true)),
        countQuery(db.collection('todos').where('userId', '==', target.uid).where('favorite', '==', true)),
      ]);

    const meta = target.metadata;
    const createdAtMs = meta.creationTime ? Date.parse(meta.creationTime) : null;
    const lastLoginAtMs = meta.lastSignInTime ? Date.parse(meta.lastSignInTime) : null;

    const userDocInfo = getUserDocDisplay(userDoc);

    await writeAdminAuditLog({
      adminUid: actorUid,
      targetUserUid: target.uid,
      action,
      payload: { query: queryRaw },
      status: 'success',
      message: 'Lookup completed.',
    });

    return {
      uid: target.uid,
      email: target.email ?? null,
      authCreatedAtMs: Number.isFinite(createdAtMs) ? createdAtMs : null,
      lastLoginAtMs: Number.isFinite(lastLoginAtMs) ? lastLoginAtMs : null,
      lastSeenAtMs: userDocInfo.updatedAtMs,
      plan: userDocInfo.plan,
      stripeSubscriptionStatus: userDocInfo.stripeSubscriptionStatus,
      userDocCreatedAtMs: userDocInfo.createdAtMs,
      counts: {
        notes: notesCount,
        tasks: tasksCount,
        todos: todosCount,
        favorites: favoriteNotesCount + favoriteTasksCount + favoriteTodosCount,
      },
    };
  } catch (error) {
    const mapped = toHttpsError(error);
    try {
      await writeAdminAuditLog({
        adminUid,
        targetUserUid: toOptionalString((isObject(payload) ? payload.targetUserUid : null) ?? null),
        action,
        payload,
        status: mapped.code === 'permission-denied' || mapped.code === 'unauthenticated' ? 'denied' : 'error',
        message: mapped.message,
      });
      await writeAppErrorLog({
        category: 'functions',
        scope: action,
        code: mapped.code,
        message: mapped.message,
        context: { adminUid, payload },
      });
    } catch {
      // Ignore logging failures.
    }
    throw mapped;
  }
});

export const adminRevokeUserSessions = functions.https.onCall(async (data, context) => {
  const action = 'revoke_sessions';
  const payload = isObject(data) ? data : {};
  const adminUid = context.auth?.uid ?? null;

  try {
    const actorUid = assertAdmin(context);
    const targetUserUid = toNonEmptyString(payload.targetUserUid);
    if (!targetUserUid) {
      throw new functions.https.HttpsError('invalid-argument', 'targetUserUid is required.');
    }

    await admin.auth().revokeRefreshTokens(targetUserUid);

    await writeAdminAuditLog({
      adminUid: actorUid,
      targetUserUid,
      action,
      payload: {},
      status: 'success',
      message: 'User sessions revoked.',
    });

    return { ok: true, message: 'Sessions révoquées.' };
  } catch (error) {
    const mapped = toHttpsError(error);
    const targetUserUid = toOptionalString(payload.targetUserUid);
    try {
      await writeAdminAuditLog({
        adminUid,
        targetUserUid,
        action,
        payload,
        status: mapped.code === 'permission-denied' || mapped.code === 'unauthenticated' ? 'denied' : 'error',
        message: mapped.message,
      });
      await writeAppErrorLog({
        category: 'auth',
        scope: action,
        code: mapped.code,
        message: mapped.message,
        context: { adminUid, targetUserUid },
      });
    } catch {
      // Ignore logging failures.
    }
    throw mapped;
  }
});

export const adminEnablePremium = functions.https.onCall(async (data, context) => {
  const action = 'enable_premium';
  const payload = isObject(data) ? data : {};
  const adminUid = context.auth?.uid ?? null;

  try {
    const actorUid = assertAdmin(context);
    const targetUserUid = toNonEmptyString(payload.targetUserUid);
    if (!targetUserUid) {
      throw new functions.https.HttpsError('invalid-argument', 'targetUserUid is required.');
    }

    const durationDays = toPositiveInteger(payload.durationDays, DEFAULT_PREMIUM_DURATION_DAYS, MAX_DURATION_DAYS);
    const nowMs = Date.now();
    const expiresAtMs = nowMs + durationDays * 24 * 60 * 60 * 1000;

    const db = admin.firestore();
    await db
      .collection('users')
      .doc(targetUserUid)
      .set(
        {
          plan: 'pro',
          premiumManual: true,
          premiumManualGrantedBy: actorUid,
          premiumManualGrantedAt: admin.firestore.FieldValue.serverTimestamp(),
          premiumManualUntil: admin.firestore.Timestamp.fromMillis(expiresAtMs),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

    await writeAdminAuditLog({
      adminUid: actorUid,
      targetUserUid,
      action,
      payload: { durationDays, expiresAtMs },
      status: 'success',
      message: 'Premium enabled.',
    });

    return {
      ok: true,
      message: `Premium activé pour ${durationDays} jour(s).`,
      expiresAtMs,
    };
  } catch (error) {
    const mapped = toHttpsError(error);
    const targetUserUid = toOptionalString(payload.targetUserUid);
    try {
      await writeAdminAuditLog({
        adminUid,
        targetUserUid,
        action,
        payload,
        status: mapped.code === 'permission-denied' || mapped.code === 'unauthenticated' ? 'denied' : 'error',
        message: mapped.message,
      });
      await writeAppErrorLog({
        category: 'payments',
        scope: action,
        code: mapped.code,
        message: mapped.message,
        context: { adminUid, targetUserUid },
      });
    } catch {
      // Ignore logging failures.
    }
    throw mapped;
  }
});

export const adminDisablePremium = functions.https.onCall(async (data, context) => {
  const action = 'disable_premium';
  const payload = isObject(data) ? data : {};
  const adminUid = context.auth?.uid ?? null;

  try {
    const actorUid = assertAdmin(context);
    const targetUserUid = toNonEmptyString(payload.targetUserUid);
    if (!targetUserUid) {
      throw new functions.https.HttpsError('invalid-argument', 'targetUserUid is required.');
    }

    const db = admin.firestore();
    await db
      .collection('users')
      .doc(targetUserUid)
      .set(
        {
          plan: 'free',
          premiumManual: admin.firestore.FieldValue.delete(),
          premiumManualGrantedBy: admin.firestore.FieldValue.delete(),
          premiumManualGrantedAt: admin.firestore.FieldValue.delete(),
          premiumManualUntil: admin.firestore.FieldValue.delete(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

    await writeAdminAuditLog({
      adminUid: actorUid,
      targetUserUid,
      action,
      payload: {},
      status: 'success',
      message: 'Premium disabled.',
    });

    return { ok: true, message: 'Premium désactivé.' };
  } catch (error) {
    const mapped = toHttpsError(error);
    const targetUserUid = toOptionalString(payload.targetUserUid);
    try {
      await writeAdminAuditLog({
        adminUid,
        targetUserUid,
        action,
        payload,
        status: mapped.code === 'permission-denied' || mapped.code === 'unauthenticated' ? 'denied' : 'error',
        message: mapped.message,
      });
      await writeAppErrorLog({
        category: 'payments',
        scope: action,
        code: mapped.code,
        message: mapped.message,
        context: { adminUid, targetUserUid },
      });
    } catch {
      // Ignore logging failures.
    }
    throw mapped;
  }
});

export const adminResetUserFlags = functions.https.onCall(async (data, context) => {
  const action = 'reset_user_flags';
  const payload = isObject(data) ? data : {};
  const adminUid = context.auth?.uid ?? null;

  try {
    const actorUid = assertAdmin(context);
    const targetUserUid = toNonEmptyString(payload.targetUserUid);
    if (!targetUserUid) {
      throw new functions.https.HttpsError('invalid-argument', 'targetUserUid is required.');
    }

    const db = admin.firestore();
    const userRef = db.collection('users').doc(targetUserUid);
    const assistantSettingsRef = userRef.collection('assistantSettings').doc('main');

    const batch = db.batch();
    batch.set(
      userRef,
      {
        settings: {
          onboarding: admin.firestore.FieldValue.delete(),
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    batch.delete(assistantSettingsRef);
    await batch.commit();

    await writeAdminAuditLog({
      adminUid: actorUid,
      targetUserUid,
      action,
      payload: {
        resetPaths: ['users.settings.onboarding', 'users/{uid}/assistantSettings/main'],
      },
      status: 'success',
      message: 'User flags reset.',
    });

    return {
      ok: true,
      message: 'Onboarding / flags réinitialisés.',
    };
  } catch (error) {
    const mapped = toHttpsError(error);
    const targetUserUid = toOptionalString(payload.targetUserUid);
    try {
      await writeAdminAuditLog({
        adminUid,
        targetUserUid,
        action,
        payload,
        status: mapped.code === 'permission-denied' || mapped.code === 'unauthenticated' ? 'denied' : 'error',
        message: mapped.message,
      });
      await writeAppErrorLog({
        category: 'functions',
        scope: action,
        code: mapped.code,
        message: mapped.message,
        context: { adminUid, targetUserUid },
      });
    } catch {
      // Ignore logging failures.
    }
    throw mapped;
  }
});

export const adminListAuditLogs = functions.https.onCall(async (data, context) => {
  const action = 'list_audit_logs';
  const payload = isObject(data) ? data : {};
  const adminUid = context.auth?.uid ?? null;

  try {
    assertAdmin(context);

    const limit = toPositiveInteger(payload.limit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const cursor = parseCursor(payload.cursor);
    const targetUserUidFilter = toOptionalString(payload.targetUserUid);
    const actionFilter = normalizeAction(payload.action);

    const db = admin.firestore();
    let query = db
      .collection('adminAuditLogs')
      .orderBy('createdAt', 'desc');

    if (cursor) {
      query = query.startAfter(admin.firestore.Timestamp.fromMillis(cursor.createdAtMs));
    }

    const scanLimit = Math.min(limit * MAX_SCAN_FACTOR, MAX_PAGE_SIZE * MAX_SCAN_FACTOR);
    const snap = await query.limit(scanLimit).get();

    const items: ReturnType<typeof mapAuditLog>[] = [];
    for (const doc of snap.docs) {
      const mapped = mapAuditLog(doc);
      if (targetUserUidFilter && mapped.targetUserUid !== targetUserUidFilter) continue;
      if (actionFilter && mapped.action !== actionFilter) continue;
      items.push(mapped);
      if (items.length >= limit) break;
    }

    const lastScanned = snap.docs[snap.docs.length - 1] ?? null;
    const nextCursor =
      lastScanned && snap.size >= scanLimit
        ? {
            createdAtMs: readTimestampMs(lastScanned.get('createdAt')),
            id: lastScanned.id,
          }
        : null;

    await writeAdminAuditLog({
      adminUid: context.auth?.uid ?? null,
      targetUserUid: targetUserUidFilter ?? null,
      action,
      payload: {
        limit,
        filteredByAction: actionFilter,
      },
      status: 'success',
      message: `Listed ${items.length} audit logs.`,
    });

    return {
      logs: items,
      nextCursor: nextCursor?.createdAtMs ? nextCursor : null,
    };
  } catch (error) {
    const mapped = toHttpsError(error);
    try {
      await writeAppErrorLog({
        category: 'functions',
        scope: action,
        code: mapped.code,
        message: mapped.message,
        context: { adminUid, payload },
      });
    } catch {
      // Ignore logging failures.
    }
    throw mapped;
  }
});

export const adminListErrorLogs = functions.https.onCall(async (data, context) => {
  const action = 'list_error_logs';
  const payload = isObject(data) ? data : {};
  const adminUid = context.auth?.uid ?? null;

  try {
    assertAdmin(context);

    const limit = toPositiveInteger(payload.limit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const cursor = parseCursor(payload.cursor);
    const categoryFilter = normalizeCategory(payload.category);

    const db = admin.firestore();
    let query = db
      .collection('appErrorLogs')
      .orderBy('createdAt', 'desc');

    if (cursor) {
      query = query.startAfter(admin.firestore.Timestamp.fromMillis(cursor.createdAtMs));
    }

    const scanLimit = Math.min(limit * MAX_SCAN_FACTOR, MAX_PAGE_SIZE * MAX_SCAN_FACTOR);
    const snap = await query.limit(scanLimit).get();

    const items: ReturnType<typeof mapErrorLog>[] = [];
    for (const doc of snap.docs) {
      const mapped = mapErrorLog(doc);
      if (categoryFilter && mapped.category !== categoryFilter) continue;
      items.push(mapped);
      if (items.length >= limit) break;
    }

    const lastScanned = snap.docs[snap.docs.length - 1] ?? null;
    const nextCursor =
      lastScanned && snap.size >= scanLimit
        ? {
            createdAtMs: readTimestampMs(lastScanned.get('createdAt')),
            id: lastScanned.id,
          }
        : null;

    await writeAdminAuditLog({
      adminUid: context.auth?.uid ?? null,
      targetUserUid: null,
      action,
      payload: {
        limit,
        categoryFilter: categoryFilter ?? null,
      },
      status: 'success',
      message: `Listed ${items.length} app error logs.`,
    });

    return {
      logs: items,
      nextCursor: nextCursor?.createdAtMs ? nextCursor : null,
    };
  } catch (error) {
    const mapped = toHttpsError(error);
    try {
      await writeAppErrorLog({
        category: 'functions',
        scope: action,
        code: mapped.code,
        message: mapped.message,
        context: { adminUid, payload },
      });
    } catch {
      // Ignore logging failures.
    }
    throw mapped;
  }
});
