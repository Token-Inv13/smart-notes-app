import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

function normalizeActivityType(raw: unknown): ActivityEventRecord['type'] | null {
  const value = toOptionalString(raw);
  if (!value) return null;
  if (
    value === 'login' ||
    value === 'note_created' ||
    value === 'task_created' ||
    value === 'todo_created' ||
    value === 'ai_job_started' ||
    value === 'ai_job_failed' ||
    value === 'ai_job_done' ||
    value === 'premium_changed' ||
    value === 'notification_sent' ||
    value === 'error_logged' ||
    value === 'admin_action'
  ) {
    return value;
  }
  return null;
}

function mapActivityEvent(doc: FirebaseFirestore.QueryDocumentSnapshot): {
  id: string;
  uid: string;
  type: string;
  createdAtMs: number | null;
  metadata: Record<string, unknown>;
} {
  const data = doc.data();
  return {
    id: doc.id,
    uid: toOptionalString(data.uid) ?? '',
    type: toOptionalString(data.type) ?? 'unknown',
    createdAtMs: readTimestampMs(data.createdAt),
    metadata: isObject(data.metadata) ? data.metadata : {},
  };
}

function parseUsersCursor(value: unknown): AdminUsersCursor | null {
  if (!isObject(value)) return null;
  const id = toNonEmptyString(value.id);
  const sortValueMsRaw = value.sortValueMs;
  if (!id || typeof sortValueMsRaw !== 'number' || !Number.isFinite(sortValueMsRaw) || sortValueMsRaw < 0) {
    return null;
  }
  return { id, sortValueMs: Math.trunc(sortValueMsRaw) };
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

type ActivityEventRecord = {
  uid: string;
  type:
    | 'login'
    | 'note_created'
    | 'task_created'
    | 'todo_created'
    | 'ai_job_started'
    | 'ai_job_failed'
    | 'ai_job_done'
    | 'premium_changed'
    | 'notification_sent'
    | 'error_logged'
    | 'admin_action';
  metadata: Record<string, unknown>;
  createdAt: FirebaseFirestore.FieldValue;
};

type AdminUserIndexRecord = {
  uid: string;
  email: string | null;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  lastSeenAt: FirebaseFirestore.Timestamp | null;
  plan: 'free' | 'premium';
  premiumUntil: FirebaseFirestore.Timestamp | null;
  status: 'active' | 'blocked';
  tags: string[];
  notesCount?: number;
  tasksCount?: number;
  favoritesCount?: number;
  lastErrorAt?: FirebaseFirestore.Timestamp | null;
  updatedAt: FirebaseFirestore.FieldValue;
};

type AdminUsersCursor = {
  sortValueMs: number;
  id: string;
};

type AdminUsersSortBy = 'createdAt' | 'lastSeenAt' | 'premiumUntil';

type PaginationCursor = {
  createdAtMs: number;
  id: string;
};

const MAX_DURATION_DAYS = 365;
const DEFAULT_PREMIUM_DURATION_DAYS = 30;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 50;
const MAX_SCAN_FACTOR = 5;
const MAX_REBUILD_BATCH_SIZE = 200;

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

async function writeUserActivityEvent(params: {
  uid: string;
  type: ActivityEventRecord['type'];
  metadata?: Record<string, unknown>;
}) {
  const uid = params.uid.trim();
  if (!uid) return;
  const db = admin.firestore();
  const record: ActivityEventRecord = {
    uid,
    type: params.type,
    metadata: params.metadata ?? {},
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await db.collection('userActivityEvents').add(record);
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

function toStringArray(raw: unknown, maxItems = 20): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const value = item.trim();
    if (!value) continue;
    out.push(value.slice(0, 64));
    if (out.length >= maxItems) break;
  }
  return out;
}

function toNonNegativeInteger(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const int = Math.trunc(value);
  return int >= 0 ? int : fallback;
}

function normalizeAdminUsersSortBy(raw: unknown): AdminUsersSortBy {
  const value = toOptionalString(raw);
  if (value === 'lastSeenAt' || value === 'premiumUntil') return value;
  return 'createdAt';
}

function normalizeSearchMode(raw: unknown): 'auto' | 'uid' | 'email_exact' | 'email_prefix' {
  const value = toOptionalString(raw);
  if (value === 'uid' || value === 'email_exact' || value === 'email_prefix') return value;
  return 'auto';
}

function toOptionalTimestamp(value: unknown): FirebaseFirestore.Timestamp | null {
  if (!value || typeof value !== 'object') return null;
  const ts = value as { toMillis?: unknown };
  if (typeof ts.toMillis !== 'function') return null;
  return value as FirebaseFirestore.Timestamp;
}

function parseAuthCreationTime(value: string | undefined): FirebaseFirestore.Timestamp | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return admin.firestore.Timestamp.fromMillis(ms);
}

function normalizeUserPlan(raw: unknown): 'free' | 'premium' {
  const value = toOptionalString(raw);
  return value === 'pro' || value === 'premium' ? 'premium' : 'free';
}

function resolvePremiumUntil(userDoc: Record<string, unknown>): FirebaseFirestore.Timestamp | null {
  const manual = toOptionalTimestamp(userDoc.premiumManualUntil);
  if (manual) return manual;
  const stripe = toOptionalTimestamp(userDoc.stripeSubscriptionCurrentPeriodEnd);
  return stripe;
}

function resolveUserStatus(userDoc: Record<string, unknown>, authDisabled?: boolean): 'active' | 'blocked' {
  if (authDisabled === true) return 'blocked';
  const raw = toOptionalString(userDoc.status);
  return raw === 'blocked' ? 'blocked' : 'active';
}

function mapAdminUserIndex(doc: FirebaseFirestore.QueryDocumentSnapshot): {
  id: string;
  uid: string;
  email: string | null;
  createdAtMs: number | null;
  lastSeenAtMs: number | null;
  plan: 'free' | 'premium';
  premiumUntilMs: number | null;
  status: 'active' | 'blocked';
  tags: string[];
  notesCount?: number;
  tasksCount?: number;
  favoritesCount?: number;
  lastErrorAtMs?: number | null;
} {
  const data = doc.data();
  const statusRaw = toOptionalString(data.status);
  return {
    id: doc.id,
    uid: toOptionalString(data.uid) ?? doc.id,
    email: toOptionalString(data.email),
    createdAtMs: readTimestampMs(data.createdAt),
    lastSeenAtMs: readTimestampMs(data.lastSeenAt),
    plan: normalizeUserPlan(data.plan),
    premiumUntilMs: readTimestampMs(data.premiumUntil),
    status: statusRaw === 'blocked' ? 'blocked' : 'active',
    tags: toStringArray(data.tags),
    notesCount: typeof data.notesCount === 'number' ? toNonNegativeInteger(data.notesCount) : undefined,
    tasksCount: typeof data.tasksCount === 'number' ? toNonNegativeInteger(data.tasksCount) : undefined,
    favoritesCount: typeof data.favoritesCount === 'number' ? toNonNegativeInteger(data.favoritesCount) : undefined,
    lastErrorAtMs: readTimestampMs(data.lastErrorAt),
  };
}

function extractAdminUserIndexFromUserDoc(params: {
  uid: string;
  userDoc: Record<string, unknown>;
  email: string | null;
  authCreatedAt: FirebaseFirestore.Timestamp | null;
  authDisabled?: boolean;
}): AdminUserIndexRecord {
  const createdAtFromUser = toOptionalTimestamp(params.userDoc.createdAt);
  const lastSeenAt = toOptionalTimestamp(params.userDoc.updatedAt);
  const plan = normalizeUserPlan(params.userDoc.plan);
  const premiumUntil = resolvePremiumUntil(params.userDoc);
  const status = resolveUserStatus(params.userDoc, params.authDisabled);
  const tags = toStringArray(params.userDoc.tags ?? params.userDoc.adminTags);
  const notesCount = typeof params.userDoc.notesCount === 'number' ? toNonNegativeInteger(params.userDoc.notesCount) : undefined;
  const tasksCount = typeof params.userDoc.tasksCount === 'number' ? toNonNegativeInteger(params.userDoc.tasksCount) : undefined;
  const favoritesCount =
    typeof params.userDoc.favoritesCount === 'number' ? toNonNegativeInteger(params.userDoc.favoritesCount) : undefined;
  const lastErrorAt = toOptionalTimestamp(params.userDoc.lastErrorAt);

  return {
    uid: params.uid,
    email: params.email,
    createdAt: createdAtFromUser ?? params.authCreatedAt ?? admin.firestore.FieldValue.serverTimestamp(),
    lastSeenAt,
    plan,
    premiumUntil,
    status,
    tags,
    ...(typeof notesCount === 'number' ? { notesCount } : {}),
    ...(typeof tasksCount === 'number' ? { tasksCount } : {}),
    ...(typeof favoritesCount === 'number' ? { favoritesCount } : {}),
    ...(lastErrorAt ? { lastErrorAt } : {}),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

function matchesUsersSearch(params: {
  item: ReturnType<typeof mapAdminUserIndex>;
  query: string | null;
  mode: 'auto' | 'uid' | 'email_exact' | 'email_prefix';
}): boolean {
  const query = params.query?.trim();
  if (!query) return true;
  const q = query.toLowerCase();
  const uid = params.item.uid.toLowerCase();
  const email = (params.item.email ?? '').toLowerCase();

  if (params.mode === 'uid') return uid === q;
  if (params.mode === 'email_exact') return email === q;
  if (params.mode === 'email_prefix') return email.startsWith(q);

  if (q.includes('@')) {
    return email.startsWith(q) || email === q;
  }
  return uid === q || uid.startsWith(q);
}

function matchesUsersFilters(params: {
  item: ReturnType<typeof mapAdminUserIndex>;
  nowMs: number;
  premiumOnly: boolean;
  blockedOnly: boolean;
  newWithinHours: number | null;
  inactiveDays: number | null;
  tags: string[];
}): boolean {
  const item = params.item;
  const nowMs = params.nowMs;

  if (params.premiumOnly) {
    const premiumActive = item.plan === 'premium' || (item.premiumUntilMs != null && item.premiumUntilMs > nowMs);
    if (!premiumActive) return false;
  }

  if (params.blockedOnly && item.status !== 'blocked') return false;

  if (params.newWithinHours != null) {
    if (item.createdAtMs == null) return false;
    const threshold = nowMs - params.newWithinHours * 60 * 60 * 1000;
    if (item.createdAtMs < threshold) return false;
  }

  if (params.inactiveDays != null) {
    const threshold = nowMs - params.inactiveDays * 24 * 60 * 60 * 1000;
    if (item.lastSeenAtMs != null && item.lastSeenAtMs >= threshold) return false;
  }

  if (params.tags.length > 0) {
    const tagsSet = new Set(item.tags.map((tag) => tag.toLowerCase()));
    const hasAny = params.tags.some((tag) => tagsSet.has(tag.toLowerCase()));
    if (!hasAny) return false;
  }

  return true;
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

async function upsertAdminUsersIndexForUid(params: {
  uid: string;
  emailHint?: string | null;
  authRecord?: admin.auth.UserRecord | null;
}): Promise<void> {
  const uid = params.uid.trim();
  if (!uid) return;

  const db = admin.firestore();
  const userSnap = await db.collection('users').doc(uid).get();
  const userDoc = userSnap.exists && isObject(userSnap.data()) ? (userSnap.data() as Record<string, unknown>) : {};

  let authRecord = params.authRecord ?? null;
  if (!authRecord) {
    try {
      authRecord = await admin.auth().getUser(uid);
    } catch {
      authRecord = null;
    }
  }

  const email = toOptionalString(userDoc.email) ?? params.emailHint ?? authRecord?.email ?? null;
  const record = extractAdminUserIndexFromUserDoc({
    uid,
    userDoc,
    email,
    authCreatedAt: parseAuthCreationTime(authRecord?.metadata.creationTime),
    authDisabled: authRecord?.disabled,
  });

  await db.collection('adminUsersIndex').doc(uid).set(record, { merge: true });
}

async function maybeUpdateLastErrorOnUsersIndex(errorDoc: FirebaseFirestore.DocumentSnapshot): Promise<void> {
  const data = errorDoc.data();
  if (!isObject(data)) return;

  const createdAt = toOptionalTimestamp(data.createdAt);
  if (!createdAt) return;

  const context = isObject(data.context) ? data.context : {};
  const uid =
    toOptionalString(data.uid) ??
    toOptionalString(context.uid) ??
    toOptionalString(context.targetUserUid) ??
    null;
  if (!uid) return;

  await admin
    .firestore()
    .collection('adminUsersIndex')
    .doc(uid)
    .set(
      {
        uid,
        lastErrorAt: createdAt,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

  await writeUserActivityEvent({
    uid,
    type: 'error_logged',
    metadata: {
      source: toOptionalString(data.source) ?? 'unknown',
      category: toOptionalString(data.category) ?? 'functions',
      code: toOptionalString(data.code) ?? 'unknown',
      scope: toOptionalString(data.scope) ?? 'unknown',
      errorLogId: errorDoc.id,
    },
  });
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
    const indexSnap = await db.collection('adminUsersIndex').doc(target.uid).get();
    const indexDoc = indexSnap.exists && isObject(indexSnap.data()) ? (indexSnap.data() as Record<string, unknown>) : {};

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
    const premiumUntilMs = readTimestampMs(resolvePremiumUntil(userDoc));
    const status = resolveUserStatus(userDoc, target.disabled);
    const lastErrorAtMs = readTimestampMs(indexDoc.lastErrorAt ?? userDoc.lastErrorAt);

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
      status,
      premiumUntilMs,
      lastErrorAtMs,
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

export const adminUsersIndexOnUserWrite = functions.firestore
  .document('users/{uid}')
  .onWrite(async (change, context) => {
    const uid = toNonEmptyString(context.params.uid);
    if (!uid) return;

    if (!change.after.exists) {
      await admin.firestore().collection('adminUsersIndex').doc(uid).delete().catch(() => undefined);
      return;
    }

    const afterData = change.after.data();
    const emailHint = isObject(afterData) ? toOptionalString(afterData.email) : null;
    await upsertAdminUsersIndexForUid({ uid, emailHint });
  });

export const adminUsersIndexOnAuthCreate = functions.auth.user().onCreate(async (user) => {
  await upsertAdminUsersIndexForUid({
    uid: user.uid,
    emailHint: user.email ?? null,
    authRecord: user,
  });
});

export const adminUsersIndexOnAuthDelete = functions.auth.user().onDelete(async (user) => {
  await admin.firestore().collection('adminUsersIndex').doc(user.uid).delete().catch(() => undefined);
});

export const adminUsersIndexOnErrorLogCreate = functions.firestore
  .document('appErrorLogs/{logId}')
  .onCreate(async (snap) => {
    await maybeUpdateLastErrorOnUsersIndex(snap);
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

    await writeUserActivityEvent({
      uid: targetUserUid,
      type: 'admin_action',
      metadata: {
        action,
        adminUid: actorUid,
      },
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

    await writeUserActivityEvent({
      uid: targetUserUid,
      type: 'premium_changed',
      metadata: {
        action,
        adminUid: actorUid,
        plan: 'premium',
        expiresAtMs,
      },
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

    await writeUserActivityEvent({
      uid: targetUserUid,
      type: 'premium_changed',
      metadata: {
        action,
        adminUid: actorUid,
        plan: 'free',
      },
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

    await writeUserActivityEvent({
      uid: targetUserUid,
      type: 'admin_action',
      metadata: {
        action,
        adminUid: actorUid,
      },
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

export const adminSendUserMessage = functions.https.onCall(async (data, context) => {
  const action = 'send_user_message';
  const payload = isObject(data) ? data : {};
  const adminUid = context.auth?.uid ?? null;

  try {
    const actorUid = assertAdmin(context);
    const targetUserUid = toNonEmptyString(payload.targetUserUid);
    const title = toNonEmptyString(payload.title);
    const body = toNonEmptyString(payload.body);
    const severityRaw = toOptionalString(payload.severity);
    const severity =
      severityRaw === 'warn' || severityRaw === 'critical' || severityRaw === 'info' ? severityRaw : 'info';

    if (!targetUserUid) {
      throw new functions.https.HttpsError('invalid-argument', 'targetUserUid is required.');
    }
    if (!title || title.length > 120) {
      throw new functions.https.HttpsError('invalid-argument', 'title is required and must be <= 120 chars.');
    }
    if (!body || body.length > 4000) {
      throw new functions.https.HttpsError('invalid-argument', 'body is required and must be <= 4000 chars.');
    }

    const db = admin.firestore();
    await db
      .collection('users')
      .doc(targetUserUid)
      .collection('inbox')
      .add({
        title,
        body,
        severity,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        readAt: null,
        createdBy: actorUid,
      });

    await writeAdminAuditLog({
      adminUid: actorUid,
      targetUserUid,
      action,
      payload: {
        title,
        severity,
        bodyLength: body.length,
      },
      status: 'success',
      message: 'Inbox message sent to user.',
    });

    await writeUserActivityEvent({
      uid: targetUserUid,
      type: 'notification_sent',
      metadata: {
        action,
        severity,
        title,
        adminUid: actorUid,
      },
    });

    return {
      ok: true,
      message: 'Message envoyé.',
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

export const adminListUsersIndex = functions.https.onCall(async (data, context) => {
  const action = 'list_users_index';
  const payload = isObject(data) ? data : {};
  const adminUid = context.auth?.uid ?? null;

  try {
    const actorUid = assertAdmin(context);

    const limit = toPositiveInteger(payload.limit, 20, 50);
    const sortBy = normalizeAdminUsersSortBy(payload.sortBy);
    const cursor = parseUsersCursor(payload.cursor);
    const queryRaw = toOptionalString(payload.query);
    const searchMode = normalizeSearchMode(payload.searchMode);
    const premiumOnly = payload.premiumOnly === true;
    const blockedOnly = payload.blockedOnly === true;
    const newWithinHours = payload.newWithinHours == null ? null : toPositiveInteger(payload.newWithinHours, 24, 24 * 365);
    const inactiveDays = payload.inactiveDays == null ? null : toPositiveInteger(payload.inactiveDays, 7, 3650);
    const tags = toStringArray(payload.tags, 10);

    const db = admin.firestore();
    let query = db.collection('adminUsersIndex').orderBy(sortBy, 'desc');
    if (cursor) {
      query = query.startAfter(admin.firestore.Timestamp.fromMillis(cursor.sortValueMs));
    }

    const scanLimit = Math.min(limit * MAX_SCAN_FACTOR, MAX_PAGE_SIZE * MAX_SCAN_FACTOR);
    const snap = await query.limit(scanLimit).get();
    const nowMs = Date.now();

    const users: ReturnType<typeof mapAdminUserIndex>[] = [];
    for (const doc of snap.docs) {
      const item = mapAdminUserIndex(doc);
      const passesSearch = matchesUsersSearch({ item, query: queryRaw, mode: searchMode });
      if (!passesSearch) continue;
      const passesFilters = matchesUsersFilters({
        item,
        nowMs,
        premiumOnly,
        blockedOnly,
        newWithinHours,
        inactiveDays,
        tags,
      });
      if (!passesFilters) continue;
      users.push(item);
      if (users.length >= limit) break;
    }

    const lastScanned = snap.docs[snap.docs.length - 1] ?? null;
    const lastSortValueMs = lastScanned ? readTimestampMs(lastScanned.get(sortBy)) : null;
    const nextCursor =
      lastScanned && snap.size >= scanLimit && typeof lastSortValueMs === 'number'
        ? {
            sortValueMs: lastSortValueMs,
            id: lastScanned.id,
          }
        : null;

    await writeAdminAuditLog({
      adminUid: actorUid,
      targetUserUid: null,
      action,
      payload: {
        limit,
        sortBy,
        query: queryRaw,
        searchMode,
        premiumOnly,
        blockedOnly,
        newWithinHours,
        inactiveDays,
        tags,
      },
      status: 'success',
      message: `Listed ${users.length} user index entries.`,
    });

    return {
      users,
      nextCursor,
    };
  } catch (error) {
    const mapped = toHttpsError(error);
    try {
      await writeAdminAuditLog({
        adminUid,
        targetUserUid: null,
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

export const rebuildAdminUsersIndex = functions.https.onCall(async (data, context) => {
  const action = 'rebuild_users_index';
  const payload = isObject(data) ? data : {};
  const adminUid = context.auth?.uid ?? null;

  try {
    const actorUid = assertAdmin(context);
    const batchSize = toPositiveInteger(payload.batchSize, 100, MAX_REBUILD_BATCH_SIZE);
    const cursorUid = toOptionalString(payload.cursorUid);

    const db = admin.firestore();
    let usersQuery = db.collection('users').orderBy(admin.firestore.FieldPath.documentId()).limit(batchSize);
    if (cursorUid) {
      usersQuery = usersQuery.startAfter(cursorUid);
    }

    const usersSnap = await usersQuery.get();
    const userDocs = usersSnap.docs;

    const authMap = new Map<string, admin.auth.UserRecord>();
    if (userDocs.length > 0) {
      const chunkSize = 100;
      for (let i = 0; i < userDocs.length; i += chunkSize) {
        const chunk = userDocs.slice(i, i + chunkSize).map((doc) => ({ uid: doc.id }));
        const authBatch = await admin.auth().getUsers(chunk);
        for (const rec of authBatch.users) {
          authMap.set(rec.uid, rec);
        }
      }
    }

    const batch = db.batch();
    for (const userDocSnap of userDocs) {
      const uid = userDocSnap.id;
      const userDoc = isObject(userDocSnap.data()) ? (userDocSnap.data() as Record<string, unknown>) : {};
      const authRecord = authMap.get(uid);
      const record = extractAdminUserIndexFromUserDoc({
        uid,
        userDoc,
        email: toOptionalString(userDoc.email) ?? authRecord?.email ?? null,
        authCreatedAt: parseAuthCreationTime(authRecord?.metadata.creationTime),
        authDisabled: authRecord?.disabled,
      });

      batch.set(db.collection('adminUsersIndex').doc(uid), record, { merge: true });
    }

    await batch.commit();

    const lastDoc = userDocs[userDocs.length - 1] ?? null;
    const nextCursorUid = lastDoc && userDocs.length >= batchSize ? lastDoc.id : null;
    const done = nextCursorUid == null;

    await writeAdminAuditLog({
      adminUid: actorUid,
      targetUserUid: null,
      action,
      payload: {
        batchSize,
        cursorUid,
        processed: userDocs.length,
        nextCursorUid,
      },
      status: 'success',
      message: `Rebuilt ${userDocs.length} admin users index entries.`,
    });

    return {
      ok: true,
      processed: userDocs.length,
      nextCursorUid,
      done,
      message: done ? 'Rebuild terminé.' : 'Rebuild partiel terminé. Relancer avec nextCursorUid.',
    };
  } catch (error) {
    const mapped = toHttpsError(error);
    try {
      await writeAdminAuditLog({
        adminUid,
        targetUserUid: null,
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

export const adminListUserActivityEvents = functions.https.onCall(async (data, context) => {
  const action = 'list_user_activity_events';
  const payload = isObject(data) ? data : {};
  const adminUid = context.auth?.uid ?? null;

  try {
    const actorUid = assertAdmin(context);
    const targetUserUid = toNonEmptyString(payload.targetUserUid);
    if (!targetUserUid) {
      throw new functions.https.HttpsError('invalid-argument', 'targetUserUid is required.');
    }

    const limit = toPositiveInteger(payload.limit, 20, 50);
    const cursor = parseCursor(payload.cursor);
    const typeFilter = normalizeActivityType(payload.type);

    const db = admin.firestore();
    let query = db.collection('userActivityEvents').where('uid', '==', targetUserUid).orderBy('createdAt', 'desc');
    if (typeFilter) {
      query = query.where('type', '==', typeFilter);
    }
    if (cursor) {
      query = query.startAfter(admin.firestore.Timestamp.fromMillis(cursor.createdAtMs));
    }

    const scanLimit = Math.min(limit * MAX_SCAN_FACTOR, MAX_PAGE_SIZE * MAX_SCAN_FACTOR);
    const snap = await query.limit(scanLimit).get();

    const events: ReturnType<typeof mapActivityEvent>[] = [];
    for (const doc of snap.docs) {
      events.push(mapActivityEvent(doc));
      if (events.length >= limit) break;
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
      adminUid: actorUid,
      targetUserUid,
      action,
      payload: {
        limit,
        typeFilter,
      },
      status: 'success',
      message: `Listed ${events.length} user activity events.`,
    });

    return {
      events,
      nextCursor: nextCursor?.createdAtMs ? nextCursor : null,
    };
  } catch (error) {
    const mapped = toHttpsError(error);
    try {
      await writeAdminAuditLog({
        adminUid,
        targetUserUid: toOptionalString(payload.targetUserUid),
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
