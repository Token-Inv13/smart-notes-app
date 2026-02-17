import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

function normalizeBroadcastSegment(raw: unknown): BroadcastSegment {
  const value = toOptionalString(raw);
  if (value === 'premium' || value === 'inactive' || value === 'tag') return value;
  return 'all';
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
    value === 'notification_read' ||
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

type AdminEmailLogRecord = {
  adminUid: string | null;
  targetUserUid: string | null;
  segment: BroadcastSegment | null;
  recipientEmail: string | null;
  subject: string;
  status: 'success' | 'error' | 'throttled' | 'preview';
  provider: 'resend';
  providerMessageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
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
    | 'notification_read'
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
  status: 'active' | 'blocked' | 'deleted';
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
type BroadcastSegment = 'all' | 'premium' | 'inactive' | 'tag';

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
const INBOX_MESSAGE_TTL_DAYS = 30;
const INBOX_DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

function normalizeInboxText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

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
  source: string;
  severity: string;
  category: string;
  scope: string;
  code: string;
  message: string;
  uid: string | null;
  createdAtMs: number | null;
  context: Record<string, unknown>;
} {
  const data = doc.data();
  const context = isObject(data.context) ? data.context : {};
  const uid =
    toOptionalString(data.uid) ??
    toOptionalString(context.uid) ??
    toOptionalString(context.targetUserUid) ??
    null;
  return {
    id: doc.id,
    source: toOptionalString(data.source) ?? 'functions',
    severity: toOptionalString(data.severity) ?? 'error',
    category: toOptionalString(data.category) ?? 'functions',
    scope: toOptionalString(data.scope) ?? 'admin',
    code: toOptionalString(data.code) ?? 'internal',
    message: toOptionalString(data.message) ?? 'Unknown error',
    uid,
    createdAtMs: readTimestampMs(data.createdAt),
    context,
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

async function writeAdminEmailLog(params: {
  adminUid: string | null;
  targetUserUid?: string | null;
  segment?: BroadcastSegment | null;
  recipientEmail?: string | null;
  subject: string;
  status: AdminEmailLogRecord['status'];
  providerMessageId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}) {
  const db = admin.firestore();
  const record: AdminEmailLogRecord = {
    adminUid: params.adminUid,
    targetUserUid: params.targetUserUid ?? null,
    segment: params.segment ?? null,
    recipientEmail: params.recipientEmail ?? null,
    subject: params.subject,
    status: params.status,
    provider: 'resend',
    providerMessageId: params.providerMessageId ?? null,
    errorCode: params.errorCode ?? null,
    errorMessage: params.errorMessage ?? null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await db.collection('adminEmailLogs').add(record);
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

function resolveUserStatus(userDoc: Record<string, unknown>, authDisabled?: boolean): 'active' | 'blocked' | 'deleted' {
  const raw = toOptionalString(userDoc.status);
  if (raw === 'deleted') return 'deleted';
  if (authDisabled === true) return 'blocked';
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
  status: 'active' | 'blocked' | 'deleted';
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
    status: statusRaw === 'deleted' ? 'deleted' : statusRaw === 'blocked' ? 'blocked' : 'active',
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

async function resolveBroadcastTargetUids(params: {
  db: FirebaseFirestore.Firestore;
  segment: BroadcastSegment;
  tag?: string | null;
}): Promise<string[]> {
  const usersIndex = params.db.collection('adminUsersIndex');
  const unique = new Set<string>();

  const collectFromSnapshot = (snap: FirebaseFirestore.QuerySnapshot) => {
    for (const doc of snap.docs) {
      const uid = toOptionalString(doc.get('uid')) ?? doc.id;
      const status = toOptionalString(doc.get('status')) ?? 'active';
      if (!uid) continue;
      if (status !== 'active') continue;
      unique.add(uid);
    }
  };

  if (params.segment === 'all') {
    collectFromSnapshot(await usersIndex.get());
  } else if (params.segment === 'premium') {
    collectFromSnapshot(await usersIndex.where('plan', '==', 'premium').get());
  } else if (params.segment === 'inactive') {
    const thresholdTs = admin.firestore.Timestamp.fromMillis(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [seenSnap, neverSeenSnap] = await Promise.all([
      usersIndex.where('lastSeenAt', '<', thresholdTs).get(),
      usersIndex.where('lastSeenAt', '==', null).get(),
    ]);
    collectFromSnapshot(seenSnap);
    collectFromSnapshot(neverSeenSnap);
  } else {
    const tag = params.tag?.trim().toLowerCase();
    if (!tag) {
      throw new functions.https.HttpsError('invalid-argument', 'tag is required for segment=tag.');
    }
    collectFromSnapshot(await usersIndex.where('tags', 'array-contains', tag).get());
  }

  return Array.from(unique);
}

async function assertEmailThrottle(params: { adminUid: string; scope: string; limit: number; windowMinutes: number }) {
  const thresholdTs = admin.firestore.Timestamp.fromMillis(Date.now() - params.windowMinutes * 60 * 1000);
  const recent = await countQuery(
    admin
      .firestore()
      .collection('adminEmailLogs')
      .where('adminUid', '==', params.adminUid)
      .where('createdAt', '>=', thresholdTs)
      .where('status', '==', 'success'),
  );
  if (recent >= params.limit) {
    throw new functions.https.HttpsError(
      'resource-exhausted',
      `Email throttle reached for ${params.scope}. Retry in a few minutes.`,
    );
  }
}

async function sendEmailViaResend(params: { to: string; subject: string; html: string }): Promise<string | null> {
  const apiKey = toOptionalString(process.env.RESEND_API_KEY);
  const from = toOptionalString(process.env.RESEND_FROM_EMAIL);
  if (!apiKey || !from) {
    throw new functions.https.HttpsError('failed-precondition', 'RESEND_API_KEY and RESEND_FROM_EMAIL are required.');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [params.to],
      subject: params.subject,
      html: params.html,
    }),
  });

  const json = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
  if (!response.ok) {
    const message = json?.message ?? `Resend request failed with status ${response.status}`;
    throw new functions.https.HttpsError('internal', message);
  }

  return toOptionalString(json?.id);
}

async function resolveSegmentTargetEmails(params: {
  db: FirebaseFirestore.Firestore;
  segment: BroadcastSegment;
  tag?: string | null;
}): Promise<Array<{ uid: string; email: string }>> {
  const uids = await resolveBroadcastTargetUids(params);
  if (uids.length === 0) return [];

  const refs = uids.map((uid) => params.db.collection('adminUsersIndex').doc(uid));
  const snaps = await params.db.getAll(...refs);
  const out: Array<{ uid: string; email: string }> = [];
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const email = toOptionalString(snap.get('email'));
    if (!email) continue;
    out.push({ uid: snap.id, email });
  }
  return out;
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

export const adminSoftDeleteUser = functions.https.onCall(async (data, context) => {
  const action = 'soft_delete_user';
  const payload = isObject(data) ? data : {};
  const adminUid = context.auth?.uid ?? null;

  try {
    const actorUid = assertAdmin(context);
    const targetUserUid = toNonEmptyString(payload.targetUserUid);
    if (!targetUserUid) {
      throw new functions.https.HttpsError('invalid-argument', 'targetUserUid is required.');
    }

    const db = admin.firestore();
    const nowTs = admin.firestore.FieldValue.serverTimestamp();

    await Promise.all([
      admin.auth().revokeRefreshTokens(targetUserUid),
      admin.auth().updateUser(targetUserUid, { disabled: true }),
      db
        .collection('users')
        .doc(targetUserUid)
        .set(
          {
            status: 'deleted',
            plan: 'free',
            premiumManualUntil: admin.firestore.FieldValue.delete(),
            stripeSubscriptionStatus: 'canceled_by_admin',
            stripeSubscriptionCancelAtPeriodEnd: true,
            stripeSubscriptionCurrentPeriodEnd: admin.firestore.FieldValue.delete(),
            updatedAt: nowTs,
          },
          { merge: true },
        ),
      db
        .collection('adminUsersIndex')
        .doc(targetUserUid)
        .set(
          {
            uid: targetUserUid,
            status: 'deleted',
            plan: 'free',
            premiumUntil: null,
            updatedAt: nowTs,
          },
          { merge: true },
        ),
    ]);

    await writeAdminAuditLog({
      adminUid: actorUid,
      targetUserUid,
      action,
      payload: {
        revokeTokens: true,
        authDisabled: true,
        premiumRemoved: true,
      },
      status: 'success',
      message: 'User soft deleted (status=deleted, login blocked, premium removed).',
    });

    await writeUserActivityEvent({
      uid: targetUserUid,
      type: 'admin_action',
      metadata: {
        action,
        adminUid: actorUid,
      },
    });

    return { ok: true, message: 'Utilisateur supprimé (soft delete).' };
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

export const adminHardDeleteUser = functions.https.onCall(async (data, context) => {
  const action = 'hard_delete_user';
  const payload = isObject(data) ? data : {};
  const adminUid = context.auth?.uid ?? null;

  try {
    const actorUid = assertAdmin(context);
    const targetUserUid = toNonEmptyString(payload.targetUserUid);
    const confirmationText = toOptionalString(payload.confirmationText);
    const hardDeleteConfirmed = payload.hardDeleteConfirmed === true;
    if (!targetUserUid) {
      throw new functions.https.HttpsError('invalid-argument', 'targetUserUid is required.');
    }
    if (!hardDeleteConfirmed || confirmationText !== 'SUPPRIMER') {
      throw new functions.https.HttpsError('failed-precondition', 'Hard delete confirmation is required.');
    }

    const db = admin.firestore();
    const userRef = db.collection('users').doc(targetUserUid);
    const indexRef = db.collection('adminUsersIndex').doc(targetUserUid);

    await db.recursiveDelete(userRef);
    await indexRef.delete().catch(() => undefined);

    try {
      await admin.auth().deleteUser(targetUserUid);
    } catch (err) {
      const code = isObject(err) ? toOptionalString(err.code) : null;
      if (code !== 'auth/user-not-found') {
        throw err;
      }
    }

    await writeAdminAuditLog({
      adminUid: actorUid,
      targetUserUid,
      action,
      payload: {
        recursiveDeleteUserDoc: true,
        deleteAuthUser: true,
        deleteAdminIndex: true,
      },
      status: 'success',
      message: 'User hard deleted (auth + firestore data removed).',
    });

    return { ok: true, message: 'Utilisateur supprimé définitivement (hard delete).' };
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

export const adminGetUserMessagingStats = functions.https.onCall(async (data, context) => {
  const action = 'get_user_messaging_stats';
  const payload = isObject(data) ? data : {};
  const adminUid = context.auth?.uid ?? null;

  try {
    const actorUid = assertAdmin(context);
    const targetUserUid = toNonEmptyString(payload.targetUserUid);
    if (!targetUserUid) {
      throw new functions.https.HttpsError('invalid-argument', 'targetUserUid is required.');
    }

    const windowHours = toPositiveInteger(payload.windowHours, 24 * 7, 24 * 90);
    const thresholdTs = admin.firestore.Timestamp.fromMillis(Date.now() - windowHours * 60 * 60 * 1000);
    const db = admin.firestore();

    const [sentCount, readCount, unreadSnap, lastSentSnap, lastReadSnap] = await Promise.all([
      countQuery(
        db
          .collection('userActivityEvents')
          .where('uid', '==', targetUserUid)
          .where('type', '==', 'notification_sent')
          .where('createdAt', '>=', thresholdTs)
          .orderBy('createdAt', 'desc'),
      ),
      countQuery(
        db
          .collection('userActivityEvents')
          .where('uid', '==', targetUserUid)
          .where('type', '==', 'notification_read')
          .where('createdAt', '>=', thresholdTs)
          .orderBy('createdAt', 'desc'),
      ),
      db.collection('users').doc(targetUserUid).collection('inbox').where('readAt', '==', null).get(),
      db
        .collection('userActivityEvents')
        .where('uid', '==', targetUserUid)
        .where('type', '==', 'notification_sent')
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get(),
      db
        .collection('userActivityEvents')
        .where('uid', '==', targetUserUid)
        .where('type', '==', 'notification_read')
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get(),
    ]);

    const lastSentAtMs = lastSentSnap.empty ? null : readTimestampMs(lastSentSnap.docs[0]?.get('createdAt'));
    const lastReadAtMs = lastReadSnap.empty ? null : readTimestampMs(lastReadSnap.docs[0]?.get('createdAt'));
    const readRatePercent = sentCount > 0 ? Math.min(100, Math.round((readCount / sentCount) * 100)) : 0;

    await writeAdminAuditLog({
      adminUid: actorUid,
      targetUserUid,
      action,
      payload: { windowHours },
      status: 'success',
      message: 'Computed user messaging stats.',
    });

    return {
      windowHours,
      sentCount,
      readCount,
      unreadCount: unreadSnap.size,
      readRatePercent,
      lastSentAtMs,
      lastReadAtMs,
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

export const adminUserInboxOnRead = functions.firestore
  .document('users/{uid}/inbox/{messageId}')
  .onUpdate(async (change, context) => {
    const uid = toNonEmptyString(context.params.uid);
    const messageId = toNonEmptyString(context.params.messageId);
    if (!uid || !messageId) return;

    const beforeReadAtMs = readTimestampMs(change.before.get('readAt'));
    const afterReadAtMs = readTimestampMs(change.after.get('readAt'));
    if (beforeReadAtMs != null || afterReadAtMs == null) return;

    await writeUserActivityEvent({
      uid,
      type: 'notification_read',
      metadata: {
        messageId,
        severity: toOptionalString(change.after.get('severity')) ?? 'info',
        createdBy: toOptionalString(change.after.get('createdBy')),
        readAtMs: afterReadAtMs,
      },
    });
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
    const inboxRef = db.collection('users').doc(targetUserUid).collection('inbox');
    const recentMessagesSnap = await inboxRef.orderBy('createdAt', 'desc').limit(10).get();

    const normalizedTitle = normalizeInboxText(title);
    const normalizedBody = normalizeInboxText(body);
    const nowMs = Date.now();

    const hasRecentDuplicate = recentMessagesSnap.docs.some((doc) => {
      const createdAtMs = readTimestampMs(doc.get('createdAt'));
      if (createdAtMs == null || nowMs - createdAtMs > INBOX_DUPLICATE_WINDOW_MS) return false;
      if (readTimestampMs(doc.get('readAt')) != null) return false;
      if (toOptionalString(doc.get('createdBy')) !== actorUid) return false;

      const existingTitle = toOptionalString(doc.get('title'));
      const existingBody = toOptionalString(doc.get('body'));
      if (!existingTitle || !existingBody) return false;

      return normalizeInboxText(existingTitle) === normalizedTitle && normalizeInboxText(existingBody) === normalizedBody;
    });

    if (hasRecentDuplicate) {
      return {
        ok: true,
        message: 'Message déjà envoyé (doublon détecté, envoi ignoré).',
      };
    }

    await inboxRef.add({
      title,
      body,
      severity,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromMillis(nowMs + INBOX_MESSAGE_TTL_DAYS * 24 * 60 * 60 * 1000),
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

export const adminGetHealthSummary = functions.https.onCall(async (data, context) => {
  const action = 'get_health_summary';
  const payload = isObject(data) ? data : {};
  const adminUid = context.auth?.uid ?? null;

  try {
    const actorUid = assertAdmin(context);
    const windowHours = toPositiveInteger(payload.windowHours, 24, 24 * 30);
    const nowMs = Date.now();
    const thresholdMs = nowMs - windowHours * 60 * 60 * 1000;
    const thresholdTs = admin.firestore.Timestamp.fromMillis(thresholdMs);

    const db = admin.firestore();

    const [totalErrors, functionsErrors, authErrors, paymentErrors, aiErrors, aiJobFailedCount] = await Promise.all([
      countQuery(db.collection('appErrorLogs').where('createdAt', '>=', thresholdTs)),
      countQuery(db.collection('appErrorLogs').where('createdAt', '>=', thresholdTs).where('category', '==', 'functions')),
      countQuery(db.collection('appErrorLogs').where('createdAt', '>=', thresholdTs).where('category', '==', 'auth')),
      countQuery(db.collection('appErrorLogs').where('createdAt', '>=', thresholdTs).where('category', '==', 'payments')),
      countQuery(db.collection('appErrorLogs').where('createdAt', '>=', thresholdTs).where('category', '==', 'ai')),
      countQuery(
        db
          .collection('userActivityEvents')
          .where('createdAt', '>=', thresholdTs)
          .where('type', '==', 'ai_job_failed'),
      ),
    ]);

    await writeAdminAuditLog({
      adminUid: actorUid,
      targetUserUid: null,
      action,
      payload: { windowHours },
      status: 'success',
      message: 'Computed admin health summary.',
    });

    return {
      windowHours,
      totalErrors,
      categoryCounts: {
        functions: functionsErrors,
        auth: authErrors,
        payments: paymentErrors,
        ai: aiErrors,
      },
      aiJobFailedCount,
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

export const adminGetOperatorDashboard = functions.https.onCall(async (data, context) => {
  const action = 'get_operator_dashboard';
  const payload = isObject(data) ? data : {};
  const adminUid = context.auth?.uid ?? null;

  try {
    const actorUid = assertAdmin(context);
    const db = admin.firestore();
    const nowMs = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const last24hTs = admin.firestore.Timestamp.fromMillis(nowMs - dayMs);
    const inactive7dTs = admin.firestore.Timestamp.fromMillis(nowMs - 7 * dayMs);

    const [totalUsers, newUsers24h, premiumActiveUsers, inactiveUsers7dSeen, inactiveUsers7dNeverSeen, errors24h, aiJobsFailed24h] =
      await Promise.all([
        countQuery(db.collection('adminUsersIndex')),
        countQuery(db.collection('adminUsersIndex').where('createdAt', '>=', last24hTs)),
        countQuery(db.collection('adminUsersIndex').where('plan', '==', 'premium')),
        countQuery(db.collection('adminUsersIndex').where('lastSeenAt', '<', inactive7dTs)),
        countQuery(db.collection('adminUsersIndex').where('lastSeenAt', '==', null)),
        countQuery(db.collection('appErrorLogs').where('createdAt', '>=', last24hTs)),
        countQuery(
          db
            .collection('userActivityEvents')
            .where('createdAt', '>=', last24hTs)
            .where('type', '==', 'ai_job_failed')
            .orderBy('createdAt', 'desc'),
        ),
      ]);

    const [inboxSent24h, inboxRead24h] = await Promise.all([
      countQuery(
        db
          .collection('userActivityEvents')
          .where('createdAt', '>=', last24hTs)
          .where('type', '==', 'notification_sent')
          .orderBy('createdAt', 'desc'),
      ),
      countQuery(
        db
          .collection('userActivityEvents')
          .where('createdAt', '>=', last24hTs)
          .where('type', '==', 'notification_read')
          .orderBy('createdAt', 'desc'),
      ),
    ]);

    const inboxReadRatePercent = inboxSent24h > 0 ? Math.min(100, Math.round((inboxRead24h / inboxSent24h) * 100)) : 0;

    const startTodayMs = new Date(new Date(nowMs).toDateString()).getTime();
    const usersSeries30d = await Promise.all(
      Array.from({ length: 30 }, async (_, index) => {
        const dayOffset = 29 - index;
        const fromMs = startTodayMs - dayOffset * dayMs;
        const toMs = fromMs + dayMs;
        const fromTs = admin.firestore.Timestamp.fromMillis(fromMs);
        const toTs = admin.firestore.Timestamp.fromMillis(toMs);
        const count = await countQuery(
          db.collection('adminUsersIndex').where('createdAt', '>=', fromTs).where('createdAt', '<', toTs),
        );
        const date = new Date(fromMs).toISOString().slice(0, 10);
        return { date, count };
      }),
    );

    await writeAdminAuditLog({
      adminUid: actorUid,
      targetUserUid: null,
      action,
      payload: { windowDays: 30 },
      status: 'success',
      message: 'Computed operator dashboard metrics.',
    });

    return {
      generatedAtMs: nowMs,
      usersTotal: totalUsers,
      usersNew24h: newUsers24h,
      premiumActive: premiumActiveUsers,
      inactive7d: inactiveUsers7dSeen + inactiveUsers7dNeverSeen,
      errors24h,
      aiJobsFailed24h,
      inboxReadRatePercent,
      usersSeries30d,
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

export const adminPreviewBroadcastMessage = functions.https.onCall(async (data, context) => {
  const action = 'preview_broadcast_message';
  const payload = isObject(data) ? data : {};
  const adminUid = context.auth?.uid ?? null;

  try {
    const actorUid = assertAdmin(context);
    const segment = normalizeBroadcastSegment(payload.segment);
    const tag = toOptionalString(payload.tag);
    const targetUids = await resolveBroadcastTargetUids({
      db: admin.firestore(),
      segment,
      tag,
    });

    await writeAdminAuditLog({
      adminUid: actorUid,
      targetUserUid: null,
      action,
      payload: { segment, tag: tag ?? null, recipients: targetUids.length },
      status: 'success',
      message: 'Computed broadcast preview.',
    });

    return {
      segment,
      tag: tag ?? null,
      recipients: targetUids.length,
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

export const adminSendBroadcastMessage = functions.https.onCall(async (data, context) => {
  const action = 'send_broadcast_message';
  const payload = isObject(data) ? data : {};
  const adminUid = context.auth?.uid ?? null;

  try {
    const actorUid = assertAdmin(context);
    const segment = normalizeBroadcastSegment(payload.segment);
    const tag = toOptionalString(payload.tag);
    const title = toNonEmptyString(payload.title);
    const body = toNonEmptyString(payload.body);
    const severityRaw = toOptionalString(payload.severity);
    const severity =
      severityRaw === 'warn' || severityRaw === 'critical' || severityRaw === 'info' ? severityRaw : 'info';

    if (!title || title.length > 120) {
      throw new functions.https.HttpsError('invalid-argument', 'title is required and must be <= 120 chars.');
    }
    if (!body || body.length > 4000) {
      throw new functions.https.HttpsError('invalid-argument', 'body is required and must be <= 4000 chars.');
    }

    const db = admin.firestore();
    const targetUids = await resolveBroadcastTargetUids({ db, segment, tag });
    if (targetUids.length === 0) {
      return {
        ok: true,
        message: 'Aucun destinataire pour ce segment.',
        recipients: 0,
      };
    }

    const nowMs = Date.now();
    const expiresAt = admin.firestore.Timestamp.fromMillis(nowMs + INBOX_MESSAGE_TTL_DAYS * 24 * 60 * 60 * 1000);

    let sentCount = 0;
    const batchSize = 250;
    for (let i = 0; i < targetUids.length; i += batchSize) {
      const slice = targetUids.slice(i, i + batchSize);
      const batch = db.batch();
      for (const uid of slice) {
        const inboxRef = db.collection('users').doc(uid).collection('inbox').doc();
        batch.set(inboxRef, {
          title,
          body,
          severity,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          expiresAt,
          readAt: null,
          createdBy: actorUid,
          source: 'broadcast',
          segment,
        });

        const eventRef = db.collection('userActivityEvents').doc();
        batch.set(eventRef, {
          uid,
          type: 'notification_sent',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          metadata: {
            action,
            severity,
            title,
            adminUid: actorUid,
            segment,
            broadcast: true,
          },
        });
      }
      await batch.commit();
      sentCount += slice.length;
    }

    await writeAdminAuditLog({
      adminUid: actorUid,
      targetUserUid: null,
      action,
      payload: {
        segment,
        tag: tag ?? null,
        severity,
        title,
        bodyLength: body.length,
        recipients: sentCount,
      },
      status: 'success',
      message: `Broadcast envoyé à ${sentCount} utilisateur(s).`,
    });

    return {
      ok: true,
      message: `Broadcast envoyé à ${sentCount} utilisateur(s).`,
      recipients: sentCount,
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

export const adminPreviewSegmentEmail = functions.https.onCall(async (data, context) => {
  const action = 'preview_segment_email';
  const payload = isObject(data) ? data : {};
  const adminUid = context.auth?.uid ?? null;

  try {
    const actorUid = assertAdmin(context);
    const segment = normalizeBroadcastSegment(payload.segment);
    const tag = toOptionalString(payload.tag);
    const recipients = await resolveSegmentTargetEmails({
      db: admin.firestore(),
      segment,
      tag,
    });

    await writeAdminAuditLog({
      adminUid: actorUid,
      targetUserUid: null,
      action,
      payload: { segment, tag: tag ?? null, recipients: recipients.length },
      status: 'success',
      message: 'Computed segment email preview.',
    });

    await writeAdminEmailLog({
      adminUid: actorUid,
      segment,
      recipientEmail: null,
      subject: toOptionalString(payload.subject) ?? '[preview]',
      status: 'preview',
    });

    return {
      segment,
      tag: tag ?? null,
      recipients: recipients.length,
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

export const adminSendUserEmail = functions.https.onCall(async (data, context) => {
  const action = 'send_user_email';
  const payload = isObject(data) ? data : {};
  const adminUid = context.auth?.uid ?? null;

  try {
    const actorUid = assertAdmin(context);
    const targetUserUid = toNonEmptyString(payload.targetUserUid);
    const subject = toNonEmptyString(payload.subject);
    const html = toNonEmptyString(payload.html);
    if (!targetUserUid || !subject || !html) {
      throw new functions.https.HttpsError('invalid-argument', 'targetUserUid, subject and html are required.');
    }
    if (subject.length > 200 || html.length > 50000) {
      throw new functions.https.HttpsError('invalid-argument', 'subject/html too large.');
    }

    await assertEmailThrottle({ adminUid: actorUid, scope: action, limit: 20, windowMinutes: 10 });

    const db = admin.firestore();
    const indexSnap = await db.collection('adminUsersIndex').doc(targetUserUid).get();
    const recipientEmail = toOptionalString(indexSnap.get('email'));
    if (!recipientEmail) {
      throw new functions.https.HttpsError('not-found', 'No recipient email found for this user.');
    }

    const messageId = await sendEmailViaResend({
      to: recipientEmail,
      subject,
      html,
    });

    await writeAdminEmailLog({
      adminUid: actorUid,
      targetUserUid,
      recipientEmail,
      subject,
      status: 'success',
      providerMessageId: messageId,
    });

    await writeAdminAuditLog({
      adminUid: actorUid,
      targetUserUid,
      action,
      payload: { recipientEmail, subject },
      status: 'success',
      message: 'User email sent.',
    });

    return { ok: true, message: 'Email envoyé.', recipients: 1 };
  } catch (error) {
    const mapped = toHttpsError(error);
    const targetUserUid = toOptionalString(payload.targetUserUid);
    try {
      await writeAdminEmailLog({
        adminUid,
        targetUserUid,
        recipientEmail: null,
        subject: toOptionalString(payload.subject) ?? '[unknown-subject]',
        status: mapped.code === 'resource-exhausted' ? 'throttled' : 'error',
        errorCode: mapped.code,
        errorMessage: mapped.message,
      });
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

export const adminSendSegmentEmail = functions.https.onCall(async (data, context) => {
  const action = 'send_segment_email';
  const payload = isObject(data) ? data : {};
  const adminUid = context.auth?.uid ?? null;

  try {
    const actorUid = assertAdmin(context);
    const segment = normalizeBroadcastSegment(payload.segment);
    const tag = toOptionalString(payload.tag);
    const subject = toNonEmptyString(payload.subject);
    const html = toNonEmptyString(payload.html);
    if (!subject || !html) {
      throw new functions.https.HttpsError('invalid-argument', 'subject and html are required.');
    }
    if (subject.length > 200 || html.length > 50000) {
      throw new functions.https.HttpsError('invalid-argument', 'subject/html too large.');
    }

    await assertEmailThrottle({ adminUid: actorUid, scope: action, limit: 200, windowMinutes: 10 });

    const recipients = await resolveSegmentTargetEmails({
      db: admin.firestore(),
      segment,
      tag,
    });
    if (recipients.length === 0) {
      return { ok: true, message: 'Aucun destinataire email.', recipients: 0 };
    }

    let sent = 0;
    for (const recipient of recipients) {
      try {
        const messageId = await sendEmailViaResend({ to: recipient.email, subject, html });
        await writeAdminEmailLog({
          adminUid: actorUid,
          targetUserUid: recipient.uid,
          segment,
          recipientEmail: recipient.email,
          subject,
          status: 'success',
          providerMessageId: messageId,
        });
        sent += 1;
      } catch (err) {
        const mapped = toHttpsError(err);
        await writeAdminEmailLog({
          adminUid: actorUid,
          targetUserUid: recipient.uid,
          segment,
          recipientEmail: recipient.email,
          subject,
          status: mapped.code === 'resource-exhausted' ? 'throttled' : 'error',
          errorCode: mapped.code,
          errorMessage: mapped.message,
        });
      }
    }

    await writeAdminAuditLog({
      adminUid: actorUid,
      targetUserUid: null,
      action,
      payload: { segment, tag: tag ?? null, requested: recipients.length, sent, subject },
      status: 'success',
      message: `Segment email sent to ${sent}/${recipients.length} recipients.`,
    });

    return {
      ok: true,
      message: `Email segment envoyé à ${sent}/${recipients.length} destinataires.`,
      recipients: sent,
    };
  } catch (error) {
    const mapped = toHttpsError(error);
    try {
      await writeAdminEmailLog({
        adminUid,
        segment: normalizeBroadcastSegment(payload.segment),
        subject: toOptionalString(payload.subject) ?? '[unknown-subject]',
        status: mapped.code === 'resource-exhausted' ? 'throttled' : 'error',
        errorCode: mapped.code,
        errorMessage: mapped.message,
      });
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
