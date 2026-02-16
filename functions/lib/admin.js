"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminListErrorLogs = exports.adminListAuditLogs = exports.rebuildAdminUsersIndex = exports.adminListUsersIndex = exports.adminResetUserFlags = exports.adminDisablePremium = exports.adminEnablePremium = exports.adminRevokeUserSessions = exports.adminUsersIndexOnErrorLogCreate = exports.adminUsersIndexOnAuthDelete = exports.adminUsersIndexOnAuthCreate = exports.adminUsersIndexOnUserWrite = exports.adminLookupUser = void 0;
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
if (!admin.apps.length) {
    admin.initializeApp();
}
function parseUsersCursor(value) {
    if (!isObject(value))
        return null;
    const id = toNonEmptyString(value.id);
    const sortValueMsRaw = value.sortValueMs;
    if (!id || typeof sortValueMsRaw !== 'number' || !Number.isFinite(sortValueMsRaw) || sortValueMsRaw < 0) {
        return null;
    }
    return { id, sortValueMs: Math.trunc(sortValueMsRaw) };
}
const MAX_DURATION_DAYS = 365;
const DEFAULT_PREMIUM_DURATION_DAYS = 30;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 50;
const MAX_SCAN_FACTOR = 5;
const MAX_REBUILD_BATCH_SIZE = 200;
function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function toNonEmptyString(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function toOptionalString(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function toPositiveInteger(value, fallback, max) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return fallback;
    const int = Math.trunc(value);
    if (int < 1)
        return fallback;
    return Math.min(int, max);
}
function readTimestampMs(value) {
    if (!value || typeof value !== 'object')
        return null;
    const ts = value;
    if (typeof ts.toMillis !== 'function')
        return null;
    try {
        return ts.toMillis();
    }
    catch (_a) {
        return null;
    }
}
function parseCursor(value) {
    if (!isObject(value))
        return null;
    const id = toNonEmptyString(value.id);
    const createdAtMsRaw = value.createdAtMs;
    if (!id || typeof createdAtMsRaw !== 'number' || !Number.isFinite(createdAtMsRaw) || createdAtMsRaw <= 0) {
        return null;
    }
    return { createdAtMs: Math.trunc(createdAtMsRaw), id };
}
function mapAuditLog(doc) {
    var _a, _b, _c;
    const data = doc.data();
    return {
        id: doc.id,
        adminUid: toOptionalString(data.adminUid),
        targetUserUid: toOptionalString(data.targetUserUid),
        action: (_a = toOptionalString(data.action)) !== null && _a !== void 0 ? _a : 'unknown',
        status: (_b = toOptionalString(data.status)) !== null && _b !== void 0 ? _b : 'unknown',
        message: (_c = toOptionalString(data.message)) !== null && _c !== void 0 ? _c : '',
        createdAtMs: readTimestampMs(data.createdAt),
        payload: isObject(data.payload) ? data.payload : {},
    };
}
function mapErrorLog(doc) {
    var _a, _b, _c, _d;
    const data = doc.data();
    return {
        id: doc.id,
        category: (_a = toOptionalString(data.category)) !== null && _a !== void 0 ? _a : 'functions',
        scope: (_b = toOptionalString(data.scope)) !== null && _b !== void 0 ? _b : 'admin',
        code: (_c = toOptionalString(data.code)) !== null && _c !== void 0 ? _c : 'internal',
        message: (_d = toOptionalString(data.message)) !== null && _d !== void 0 ? _d : 'Unknown error',
        createdAtMs: readTimestampMs(data.createdAt),
        context: isObject(data.context) ? data.context : {},
    };
}
function toHttpsError(err) {
    var _a;
    if (err instanceof functions.https.HttpsError)
        return err;
    if (isObject(err)) {
        const rawCode = toOptionalString(err.code);
        if (rawCode === 'auth/user-not-found') {
            return new functions.https.HttpsError('not-found', 'User not found.');
        }
        if (rawCode === null || rawCode === void 0 ? void 0 : rawCode.startsWith('auth/')) {
            return new functions.https.HttpsError('invalid-argument', (_a = toOptionalString(err.message)) !== null && _a !== void 0 ? _a : 'Auth operation failed.');
        }
    }
    const message = err instanceof Error ? err.message : 'Internal server error';
    return new functions.https.HttpsError('internal', message);
}
async function writeAdminAuditLog(params) {
    var _a;
    const db = admin.firestore();
    const record = {
        adminUid: params.adminUid,
        targetUserUid: params.targetUserUid,
        action: params.action,
        payload: (_a = params.payload) !== null && _a !== void 0 ? _a : {},
        status: params.status,
        message: params.message,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await db.collection('adminAuditLogs').add(record);
}
async function writeAppErrorLog(params) {
    var _a;
    const db = admin.firestore();
    const record = {
        source: 'functions',
        category: params.category,
        scope: params.scope,
        code: params.code,
        message: params.message,
        context: (_a = params.context) !== null && _a !== void 0 ? _a : {},
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await db.collection('appErrorLogs').add(record);
}
function assertAdmin(context) {
    var _a, _b;
    const uid = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
    }
    const claims = (_b = context.auth) === null || _b === void 0 ? void 0 : _b.token;
    if ((claims === null || claims === void 0 ? void 0 : claims.admin) !== true) {
        throw new functions.https.HttpsError('permission-denied', 'Admin claim required.');
    }
    return uid;
}
function sanitizeLookupQuery(raw) {
    const value = raw.trim();
    if (value.includes('@')) {
        return { mode: 'email', value: value.toLowerCase() };
    }
    return { mode: 'uid', value };
}
function normalizeAction(raw) {
    const value = toOptionalString(raw);
    if (!value)
        return null;
    return value.slice(0, 64);
}
function normalizeCategory(raw) {
    const value = toOptionalString(raw);
    if (!value)
        return null;
    if (value === 'functions' || value === 'auth' || value === 'payments' || value === 'ai') {
        return value;
    }
    return null;
}
function toStringArray(raw, maxItems = 20) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const item of raw) {
        if (typeof item !== 'string')
            continue;
        const value = item.trim();
        if (!value)
            continue;
        out.push(value.slice(0, 64));
        if (out.length >= maxItems)
            break;
    }
    return out;
}
function toNonNegativeInteger(value, fallback = 0) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return fallback;
    const int = Math.trunc(value);
    return int >= 0 ? int : fallback;
}
function normalizeAdminUsersSortBy(raw) {
    const value = toOptionalString(raw);
    if (value === 'lastSeenAt' || value === 'premiumUntil')
        return value;
    return 'createdAt';
}
function normalizeSearchMode(raw) {
    const value = toOptionalString(raw);
    if (value === 'uid' || value === 'email_exact' || value === 'email_prefix')
        return value;
    return 'auto';
}
function toOptionalTimestamp(value) {
    if (!value || typeof value !== 'object')
        return null;
    const ts = value;
    if (typeof ts.toMillis !== 'function')
        return null;
    return value;
}
function parseAuthCreationTime(value) {
    if (!value)
        return null;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms) || ms <= 0)
        return null;
    return admin.firestore.Timestamp.fromMillis(ms);
}
function normalizeUserPlan(raw) {
    const value = toOptionalString(raw);
    return value === 'pro' || value === 'premium' ? 'premium' : 'free';
}
function resolvePremiumUntil(userDoc) {
    const manual = toOptionalTimestamp(userDoc.premiumManualUntil);
    if (manual)
        return manual;
    const stripe = toOptionalTimestamp(userDoc.stripeSubscriptionCurrentPeriodEnd);
    return stripe;
}
function resolveUserStatus(userDoc, authDisabled) {
    if (authDisabled === true)
        return 'blocked';
    const raw = toOptionalString(userDoc.status);
    return raw === 'blocked' ? 'blocked' : 'active';
}
function mapAdminUserIndex(doc) {
    var _a;
    const data = doc.data();
    const statusRaw = toOptionalString(data.status);
    return {
        id: doc.id,
        uid: (_a = toOptionalString(data.uid)) !== null && _a !== void 0 ? _a : doc.id,
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
function extractAdminUserIndexFromUserDoc(params) {
    var _a, _b;
    const createdAtFromUser = toOptionalTimestamp(params.userDoc.createdAt);
    const lastSeenAt = toOptionalTimestamp(params.userDoc.updatedAt);
    const plan = normalizeUserPlan(params.userDoc.plan);
    const premiumUntil = resolvePremiumUntil(params.userDoc);
    const status = resolveUserStatus(params.userDoc, params.authDisabled);
    const tags = toStringArray((_a = params.userDoc.tags) !== null && _a !== void 0 ? _a : params.userDoc.adminTags);
    const notesCount = typeof params.userDoc.notesCount === 'number' ? toNonNegativeInteger(params.userDoc.notesCount) : undefined;
    const tasksCount = typeof params.userDoc.tasksCount === 'number' ? toNonNegativeInteger(params.userDoc.tasksCount) : undefined;
    const favoritesCount = typeof params.userDoc.favoritesCount === 'number' ? toNonNegativeInteger(params.userDoc.favoritesCount) : undefined;
    const lastErrorAt = toOptionalTimestamp(params.userDoc.lastErrorAt);
    return Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ uid: params.uid, email: params.email, createdAt: (_b = createdAtFromUser !== null && createdAtFromUser !== void 0 ? createdAtFromUser : params.authCreatedAt) !== null && _b !== void 0 ? _b : admin.firestore.FieldValue.serverTimestamp(), lastSeenAt,
        plan,
        premiumUntil,
        status,
        tags }, (typeof notesCount === 'number' ? { notesCount } : {})), (typeof tasksCount === 'number' ? { tasksCount } : {})), (typeof favoritesCount === 'number' ? { favoritesCount } : {})), (lastErrorAt ? { lastErrorAt } : {})), { updatedAt: admin.firestore.FieldValue.serverTimestamp() });
}
function matchesUsersSearch(params) {
    var _a, _b;
    const query = (_a = params.query) === null || _a === void 0 ? void 0 : _a.trim();
    if (!query)
        return true;
    const q = query.toLowerCase();
    const uid = params.item.uid.toLowerCase();
    const email = ((_b = params.item.email) !== null && _b !== void 0 ? _b : '').toLowerCase();
    if (params.mode === 'uid')
        return uid === q;
    if (params.mode === 'email_exact')
        return email === q;
    if (params.mode === 'email_prefix')
        return email.startsWith(q);
    if (q.includes('@')) {
        return email.startsWith(q) || email === q;
    }
    return uid === q || uid.startsWith(q);
}
function matchesUsersFilters(params) {
    const item = params.item;
    const nowMs = params.nowMs;
    if (params.premiumOnly) {
        const premiumActive = item.plan === 'premium' || (item.premiumUntilMs != null && item.premiumUntilMs > nowMs);
        if (!premiumActive)
            return false;
    }
    if (params.blockedOnly && item.status !== 'blocked')
        return false;
    if (params.newWithinHours != null) {
        if (item.createdAtMs == null)
            return false;
        const threshold = nowMs - params.newWithinHours * 60 * 60 * 1000;
        if (item.createdAtMs < threshold)
            return false;
    }
    if (params.inactiveDays != null) {
        const threshold = nowMs - params.inactiveDays * 24 * 60 * 60 * 1000;
        if (item.lastSeenAtMs != null && item.lastSeenAtMs >= threshold)
            return false;
    }
    if (params.tags.length > 0) {
        const tagsSet = new Set(item.tags.map((tag) => tag.toLowerCase()));
        const hasAny = params.tags.some((tag) => tagsSet.has(tag.toLowerCase()));
        if (!hasAny)
            return false;
    }
    return true;
}
function getUserDocDisplay(data) {
    const rawPlan = toOptionalString(data.plan);
    const plan = rawPlan === 'pro' ? 'pro' : 'free';
    const stripeSubscriptionStatus = toOptionalString(data.stripeSubscriptionStatus);
    const createdAtMs = readTimestampMs(data.createdAt);
    const updatedAtMs = readTimestampMs(data.updatedAt);
    return { plan, stripeSubscriptionStatus, createdAtMs, updatedAtMs };
}
async function countQuery(query) {
    try {
        const aggregate = await query.count().get();
        return aggregate.data().count;
    }
    catch (_a) {
        const snap = await query.get();
        return snap.size;
    }
}
async function upsertAdminUsersIndexForUid(params) {
    var _a, _b, _c, _d;
    const uid = params.uid.trim();
    if (!uid)
        return;
    const db = admin.firestore();
    const userSnap = await db.collection('users').doc(uid).get();
    const userDoc = userSnap.exists && isObject(userSnap.data()) ? userSnap.data() : {};
    let authRecord = (_a = params.authRecord) !== null && _a !== void 0 ? _a : null;
    if (!authRecord) {
        try {
            authRecord = await admin.auth().getUser(uid);
        }
        catch (_e) {
            authRecord = null;
        }
    }
    const email = (_d = (_c = (_b = toOptionalString(userDoc.email)) !== null && _b !== void 0 ? _b : params.emailHint) !== null && _c !== void 0 ? _c : authRecord === null || authRecord === void 0 ? void 0 : authRecord.email) !== null && _d !== void 0 ? _d : null;
    const record = extractAdminUserIndexFromUserDoc({
        uid,
        userDoc,
        email,
        authCreatedAt: parseAuthCreationTime(authRecord === null || authRecord === void 0 ? void 0 : authRecord.metadata.creationTime),
        authDisabled: authRecord === null || authRecord === void 0 ? void 0 : authRecord.disabled,
    });
    await db.collection('adminUsersIndex').doc(uid).set(record, { merge: true });
}
async function maybeUpdateLastErrorOnUsersIndex(errorDoc) {
    var _a, _b, _c;
    const data = errorDoc.data();
    if (!isObject(data))
        return;
    const createdAt = toOptionalTimestamp(data.createdAt);
    if (!createdAt)
        return;
    const context = isObject(data.context) ? data.context : {};
    const uid = (_c = (_b = (_a = toOptionalString(data.uid)) !== null && _a !== void 0 ? _a : toOptionalString(context.uid)) !== null && _b !== void 0 ? _b : toOptionalString(context.targetUserUid)) !== null && _c !== void 0 ? _c : null;
    if (!uid)
        return;
    await admin
        .firestore()
        .collection('adminUsersIndex')
        .doc(uid)
        .set({
        uid,
        lastErrorAt: createdAt,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
}
exports.adminLookupUser = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d;
    const action = 'user_lookup';
    const adminUid = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid) !== null && _b !== void 0 ? _b : null;
    const payload = isObject(data) ? data : {};
    try {
        const actorUid = assertAdmin(context);
        const queryRaw = toNonEmptyString(payload.query);
        if (!queryRaw) {
            throw new functions.https.HttpsError('invalid-argument', 'query (email or uid) is required.');
        }
        const lookup = sanitizeLookupQuery(queryRaw);
        const auth = admin.auth();
        const target = lookup.mode === 'email'
            ? await auth.getUserByEmail(lookup.value)
            : await auth.getUser(lookup.value);
        const db = admin.firestore();
        const userRef = db.collection('users').doc(target.uid);
        const userSnap = await userRef.get();
        const userDoc = userSnap.exists && isObject(userSnap.data()) ? userSnap.data() : {};
        const [notesCount, tasksCount, todosCount, favoriteNotesCount, favoriteTasksCount, favoriteTodosCount] = await Promise.all([
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
            email: (_c = target.email) !== null && _c !== void 0 ? _c : null,
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
    }
    catch (error) {
        const mapped = toHttpsError(error);
        try {
            await writeAdminAuditLog({
                adminUid,
                targetUserUid: toOptionalString((_d = (isObject(payload) ? payload.targetUserUid : null)) !== null && _d !== void 0 ? _d : null),
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
        }
        catch (_e) {
            // Ignore logging failures.
        }
        throw mapped;
    }
});
exports.adminUsersIndexOnUserWrite = functions.firestore
    .document('users/{uid}')
    .onWrite(async (change, context) => {
    const uid = toNonEmptyString(context.params.uid);
    if (!uid)
        return;
    if (!change.after.exists) {
        await admin.firestore().collection('adminUsersIndex').doc(uid).delete().catch(() => undefined);
        return;
    }
    const afterData = change.after.data();
    const emailHint = isObject(afterData) ? toOptionalString(afterData.email) : null;
    await upsertAdminUsersIndexForUid({ uid, emailHint });
});
exports.adminUsersIndexOnAuthCreate = functions.auth.user().onCreate(async (user) => {
    var _a;
    await upsertAdminUsersIndexForUid({
        uid: user.uid,
        emailHint: (_a = user.email) !== null && _a !== void 0 ? _a : null,
        authRecord: user,
    });
});
exports.adminUsersIndexOnAuthDelete = functions.auth.user().onDelete(async (user) => {
    await admin.firestore().collection('adminUsersIndex').doc(user.uid).delete().catch(() => undefined);
});
exports.adminUsersIndexOnErrorLogCreate = functions.firestore
    .document('appErrorLogs/{logId}')
    .onCreate(async (snap) => {
    await maybeUpdateLastErrorOnUsersIndex(snap);
});
exports.adminRevokeUserSessions = functions.https.onCall(async (data, context) => {
    var _a, _b;
    const action = 'revoke_sessions';
    const payload = isObject(data) ? data : {};
    const adminUid = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid) !== null && _b !== void 0 ? _b : null;
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
    }
    catch (error) {
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
        }
        catch (_c) {
            // Ignore logging failures.
        }
        throw mapped;
    }
});
exports.adminEnablePremium = functions.https.onCall(async (data, context) => {
    var _a, _b;
    const action = 'enable_premium';
    const payload = isObject(data) ? data : {};
    const adminUid = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid) !== null && _b !== void 0 ? _b : null;
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
            .set({
            plan: 'pro',
            premiumManual: true,
            premiumManualGrantedBy: actorUid,
            premiumManualGrantedAt: admin.firestore.FieldValue.serverTimestamp(),
            premiumManualUntil: admin.firestore.Timestamp.fromMillis(expiresAtMs),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
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
    }
    catch (error) {
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
        }
        catch (_c) {
            // Ignore logging failures.
        }
        throw mapped;
    }
});
exports.adminDisablePremium = functions.https.onCall(async (data, context) => {
    var _a, _b;
    const action = 'disable_premium';
    const payload = isObject(data) ? data : {};
    const adminUid = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid) !== null && _b !== void 0 ? _b : null;
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
            .set({
            plan: 'free',
            premiumManual: admin.firestore.FieldValue.delete(),
            premiumManualGrantedBy: admin.firestore.FieldValue.delete(),
            premiumManualGrantedAt: admin.firestore.FieldValue.delete(),
            premiumManualUntil: admin.firestore.FieldValue.delete(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        await writeAdminAuditLog({
            adminUid: actorUid,
            targetUserUid,
            action,
            payload: {},
            status: 'success',
            message: 'Premium disabled.',
        });
        return { ok: true, message: 'Premium désactivé.' };
    }
    catch (error) {
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
        }
        catch (_c) {
            // Ignore logging failures.
        }
        throw mapped;
    }
});
exports.adminResetUserFlags = functions.https.onCall(async (data, context) => {
    var _a, _b;
    const action = 'reset_user_flags';
    const payload = isObject(data) ? data : {};
    const adminUid = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid) !== null && _b !== void 0 ? _b : null;
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
        batch.set(userRef, {
            settings: {
                onboarding: admin.firestore.FieldValue.delete(),
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
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
    }
    catch (error) {
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
        }
        catch (_c) {
            // Ignore logging failures.
        }
        throw mapped;
    }
});
exports.adminListUsersIndex = functions.https.onCall(async (data, context) => {
    var _a, _b, _c;
    const action = 'list_users_index';
    const payload = isObject(data) ? data : {};
    const adminUid = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid) !== null && _b !== void 0 ? _b : null;
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
        const users = [];
        for (const doc of snap.docs) {
            const item = mapAdminUserIndex(doc);
            const passesSearch = matchesUsersSearch({ item, query: queryRaw, mode: searchMode });
            if (!passesSearch)
                continue;
            const passesFilters = matchesUsersFilters({
                item,
                nowMs,
                premiumOnly,
                blockedOnly,
                newWithinHours,
                inactiveDays,
                tags,
            });
            if (!passesFilters)
                continue;
            users.push(item);
            if (users.length >= limit)
                break;
        }
        const lastScanned = (_c = snap.docs[snap.docs.length - 1]) !== null && _c !== void 0 ? _c : null;
        const lastSortValueMs = lastScanned ? readTimestampMs(lastScanned.get(sortBy)) : null;
        const nextCursor = lastScanned && snap.size >= scanLimit && typeof lastSortValueMs === 'number'
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
    }
    catch (error) {
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
        }
        catch (_d) {
            // Ignore logging failures.
        }
        throw mapped;
    }
});
exports.rebuildAdminUsersIndex = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e;
    const action = 'rebuild_users_index';
    const payload = isObject(data) ? data : {};
    const adminUid = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid) !== null && _b !== void 0 ? _b : null;
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
        const authMap = new Map();
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
            const userDoc = isObject(userDocSnap.data()) ? userDocSnap.data() : {};
            const authRecord = authMap.get(uid);
            const record = extractAdminUserIndexFromUserDoc({
                uid,
                userDoc,
                email: (_d = (_c = toOptionalString(userDoc.email)) !== null && _c !== void 0 ? _c : authRecord === null || authRecord === void 0 ? void 0 : authRecord.email) !== null && _d !== void 0 ? _d : null,
                authCreatedAt: parseAuthCreationTime(authRecord === null || authRecord === void 0 ? void 0 : authRecord.metadata.creationTime),
                authDisabled: authRecord === null || authRecord === void 0 ? void 0 : authRecord.disabled,
            });
            batch.set(db.collection('adminUsersIndex').doc(uid), record, { merge: true });
        }
        await batch.commit();
        const lastDoc = (_e = userDocs[userDocs.length - 1]) !== null && _e !== void 0 ? _e : null;
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
    }
    catch (error) {
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
        }
        catch (_f) {
            // Ignore logging failures.
        }
        throw mapped;
    }
});
exports.adminListAuditLogs = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e;
    const action = 'list_audit_logs';
    const payload = isObject(data) ? data : {};
    const adminUid = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid) !== null && _b !== void 0 ? _b : null;
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
        const items = [];
        for (const doc of snap.docs) {
            const mapped = mapAuditLog(doc);
            if (targetUserUidFilter && mapped.targetUserUid !== targetUserUidFilter)
                continue;
            if (actionFilter && mapped.action !== actionFilter)
                continue;
            items.push(mapped);
            if (items.length >= limit)
                break;
        }
        const lastScanned = (_c = snap.docs[snap.docs.length - 1]) !== null && _c !== void 0 ? _c : null;
        const nextCursor = lastScanned && snap.size >= scanLimit
            ? {
                createdAtMs: readTimestampMs(lastScanned.get('createdAt')),
                id: lastScanned.id,
            }
            : null;
        await writeAdminAuditLog({
            adminUid: (_e = (_d = context.auth) === null || _d === void 0 ? void 0 : _d.uid) !== null && _e !== void 0 ? _e : null,
            targetUserUid: targetUserUidFilter !== null && targetUserUidFilter !== void 0 ? targetUserUidFilter : null,
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
            nextCursor: (nextCursor === null || nextCursor === void 0 ? void 0 : nextCursor.createdAtMs) ? nextCursor : null,
        };
    }
    catch (error) {
        const mapped = toHttpsError(error);
        try {
            await writeAppErrorLog({
                category: 'functions',
                scope: action,
                code: mapped.code,
                message: mapped.message,
                context: { adminUid, payload },
            });
        }
        catch (_f) {
            // Ignore logging failures.
        }
        throw mapped;
    }
});
exports.adminListErrorLogs = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e;
    const action = 'list_error_logs';
    const payload = isObject(data) ? data : {};
    const adminUid = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid) !== null && _b !== void 0 ? _b : null;
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
        const items = [];
        for (const doc of snap.docs) {
            const mapped = mapErrorLog(doc);
            if (categoryFilter && mapped.category !== categoryFilter)
                continue;
            items.push(mapped);
            if (items.length >= limit)
                break;
        }
        const lastScanned = (_c = snap.docs[snap.docs.length - 1]) !== null && _c !== void 0 ? _c : null;
        const nextCursor = lastScanned && snap.size >= scanLimit
            ? {
                createdAtMs: readTimestampMs(lastScanned.get('createdAt')),
                id: lastScanned.id,
            }
            : null;
        await writeAdminAuditLog({
            adminUid: (_e = (_d = context.auth) === null || _d === void 0 ? void 0 : _d.uid) !== null && _e !== void 0 ? _e : null,
            targetUserUid: null,
            action,
            payload: {
                limit,
                categoryFilter: categoryFilter !== null && categoryFilter !== void 0 ? categoryFilter : null,
            },
            status: 'success',
            message: `Listed ${items.length} app error logs.`,
        });
        return {
            logs: items,
            nextCursor: (nextCursor === null || nextCursor === void 0 ? void 0 : nextCursor.createdAtMs) ? nextCursor : null,
        };
    }
    catch (error) {
        const mapped = toHttpsError(error);
        try {
            await writeAppErrorLog({
                category: 'functions',
                scope: action,
                code: mapped.code,
                message: mapped.message,
                context: { adminUid, payload },
            });
        }
        catch (_f) {
            // Ignore logging failures.
        }
        throw mapped;
    }
});
//# sourceMappingURL=admin.js.map