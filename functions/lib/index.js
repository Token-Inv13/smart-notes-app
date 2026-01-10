"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testSendReminderEmail = exports.cleanupOldReminders = exports.checkAndSendReminders = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
admin.initializeApp();
function getSmtpEnv() {
    var _a, _b, _c, _d, _e, _f;
    const cfg = functions.config();
    const hostCfg = (_a = cfg === null || cfg === void 0 ? void 0 : cfg.smtp) === null || _a === void 0 ? void 0 : _a.host;
    const portCfg = (_b = cfg === null || cfg === void 0 ? void 0 : cfg.smtp) === null || _b === void 0 ? void 0 : _b.port;
    const userCfg = (_c = cfg === null || cfg === void 0 ? void 0 : cfg.smtp) === null || _c === void 0 ? void 0 : _c.user;
    const passCfg = (_d = cfg === null || cfg === void 0 ? void 0 : cfg.smtp) === null || _d === void 0 ? void 0 : _d.pass;
    const fromCfg = (_e = cfg === null || cfg === void 0 ? void 0 : cfg.smtp) === null || _e === void 0 ? void 0 : _e.from;
    const appBaseUrlCfg = (_f = cfg === null || cfg === void 0 ? void 0 : cfg.app) === null || _f === void 0 ? void 0 : _f.base_url;
    const hostEnv = process.env.SMTP_HOST;
    const portEnv = process.env.SMTP_PORT;
    const userEnv = process.env.SMTP_USER;
    const passEnv = process.env.SMTP_PASS;
    const fromEnv = process.env.SMTP_FROM;
    const appBaseUrlEnv = process.env.APP_BASE_URL;
    const host = hostCfg !== null && hostCfg !== void 0 ? hostCfg : hostEnv;
    const portRaw = portCfg !== null && portCfg !== void 0 ? portCfg : portEnv;
    const user = userCfg !== null && userCfg !== void 0 ? userCfg : userEnv;
    const pass = passCfg !== null && passCfg !== void 0 ? passCfg : passEnv;
    const from = fromCfg !== null && fromCfg !== void 0 ? fromCfg : fromEnv;
    const appBaseUrl = appBaseUrlCfg !== null && appBaseUrlCfg !== void 0 ? appBaseUrlCfg : appBaseUrlEnv;
    const source = {
        host: hostCfg ? 'functions.config' : 'process.env',
        port: portCfg ? 'functions.config' : 'process.env',
        user: userCfg ? 'functions.config' : 'process.env',
        pass: passCfg ? 'functions.config' : 'process.env',
        from: fromCfg ? 'functions.config' : 'process.env',
        appBaseUrl: appBaseUrlCfg ? 'functions.config' : 'process.env',
    };
    if (!host || !portRaw || !user || !pass || !from || !appBaseUrl) {
        console.error('SMTP config missing', {
            hasHost: !!host,
            hasPort: !!portRaw,
            hasUser: !!user,
            hasPass: !!pass,
            hasFrom: !!from,
            hasAppBaseUrl: !!appBaseUrl,
            source,
        });
        return null;
    }
    const port = Number(portRaw);
    if (!Number.isFinite(port)) {
        console.error('SMTP config invalid port', { portRaw, source });
        return null;
    }
    return { env: { host, port, user, pass, from, appBaseUrl }, source };
}
function getEmailTestSecret() {
    var _a, _b;
    const cfg = functions.config();
    const secret = (_b = (_a = cfg === null || cfg === void 0 ? void 0 : cfg.email_test) === null || _a === void 0 ? void 0 : _a.secret) !== null && _b !== void 0 ? _b : process.env.EMAIL_TEST_SECRET;
    return secret !== null && secret !== void 0 ? secret : null;
}
async function sendReminderEmail(params) {
    const resolved = getSmtpEnv();
    if (!resolved) {
        throw new Error('SMTP env is not configured');
    }
    const { env, source } = resolved;
    console.log('SMTP config detected', {
        host: env.host,
        port: env.port,
        secure: env.port === 465,
        user: env.user,
        from: env.from,
        appBaseUrl: env.appBaseUrl,
        source,
    });
    const transporter = nodemailer.createTransport({
        host: env.host,
        port: env.port,
        // Hostinger commonly uses:
        // - 465 with implicit TLS (secure=true)
        // - 587 with STARTTLS (secure=false)
        secure: env.port === 465,
        requireTLS: env.port === 587,
        tls: {
            minVersion: 'TLSv1.2',
        },
        auth: {
            user: env.user,
            pass: env.pass,
        },
    });
    const taskUrl = `${env.appBaseUrl.replace(/\/$/, '')}/tasks/${encodeURIComponent(params.taskId)}`;
    const reminderDate = new Date(params.reminderTimeIso);
    const reminderText = Number.isNaN(reminderDate.getTime())
        ? params.reminderTimeIso
        : reminderDate.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
    const subject = '⏰ Rappel de tâche — Smart Notes';
    const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
      <h2 style="margin: 0 0 12px;">⏰ Rappel de tâche</h2>
      <p style="margin: 0 0 8px;"><strong>${escapeHtml(params.taskTitle || 'Tâche')}</strong></p>
      <p style="margin: 0 0 16px;">Rappel : ${escapeHtml(reminderText)}</p>
      <p style="margin: 0 0 16px;">
        <a href="${taskUrl}" style="display: inline-block; padding: 10px 14px; background: #111; color: #fff; text-decoration: none; border-radius: 8px;">Ouvrir la tâche</a>
      </p>
      <p style="margin: 0; color: #555; font-size: 12px;">Smart Notes — ${escapeHtml(env.appBaseUrl)}</p>
    </div>
  `;
    try {
        // Verify connection/auth early for clearer errors.
        await transporter.verify();
    }
    catch (e) {
        console.error('SMTP verify failed', {
            host: env.host,
            port: env.port,
            secure: env.port === 465,
            user: env.user,
            to: params.to,
            error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e,
        });
        throw e;
    }
    try {
        const info = await transporter.sendMail({
            from: env.from,
            to: params.to,
            replyTo: env.from,
            subject,
            html,
        });
        console.log('Email reminder sent', {
            to: params.to,
            messageId: info === null || info === void 0 ? void 0 : info.messageId,
            accepted: info === null || info === void 0 ? void 0 : info.accepted,
            rejected: info === null || info === void 0 ? void 0 : info.rejected,
            response: info === null || info === void 0 ? void 0 : info.response,
        });
    }
    catch (e) {
        console.error('SMTP sendMail failed', {
            host: env.host,
            port: env.port,
            secure: env.port === 465,
            user: env.user,
            from: env.from,
            to: params.to,
            error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e,
        });
        throw e;
    }
}
function escapeHtml(input) {
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
async function claimReminder(params) {
    const { db, ref, now, processingTtlMs, processingBy } = params;
    return db.runTransaction(async (tx) => {
        var _a;
        const snap = await tx.get(ref);
        if (!snap.exists)
            return false;
        const data = snap.data();
        if ((data === null || data === void 0 ? void 0 : data.sent) === true)
            return false;
        const processingAt = (_a = data === null || data === void 0 ? void 0 : data.processingAt) !== null && _a !== void 0 ? _a : null;
        if (processingAt) {
            const ageMs = now.toMillis() - processingAt.toMillis();
            if (ageMs >= 0 && ageMs < processingTtlMs) {
                return false;
            }
        }
        tx.update(ref, {
            processingAt: now,
            processingBy,
        });
        return true;
    });
}
exports.checkAndSendReminders = functions.pubsub
    .schedule('every 1 minutes')
    .onRun(async (context) => {
    const now = new Date();
    const nowIso = now.toISOString();
    const processingTtlMs = 2 * 60 * 1000;
    const processingBy = typeof (context === null || context === void 0 ? void 0 : context.eventId) === 'string' && context.eventId
        ? String(context.eventId)
        : `run:${nowIso}`;
    try {
        const db = admin.firestore();
        const remindersSnapshot = await db
            .collection('taskReminders')
            .where('sent', '==', false)
            .where('reminderTime', '<=', nowIso)
            .orderBy('reminderTime', 'asc')
            .limit(200)
            .get();
        console.log(`checkAndSendReminders: now=${nowIso} reminders=${remindersSnapshot.size}`);
        const reminderPromises = remindersSnapshot.docs.map(async (doc) => {
            var _a, _b;
            const reminder = doc.data();
            const claimed = await claimReminder({
                db,
                ref: doc.ref,
                now: admin.firestore.Timestamp.fromDate(now),
                processingTtlMs,
                processingBy,
            });
            if (!claimed) {
                return;
            }
            // Get the task details
            const taskDoc = await db.collection('tasks').doc(reminder.taskId).get();
            if (!taskDoc.exists) {
                console.log(`Task ${reminder.taskId} not found, skipping reminder`);
                try {
                    await doc.ref.update({ processingAt: admin.firestore.FieldValue.delete(), processingBy: admin.firestore.FieldValue.delete() });
                }
                catch (_c) {
                    // ignore
                }
                return;
            }
            const task = taskDoc.data();
            // Get user's FCM tokens
            const userDoc = await db.collection('users').doc(reminder.userId).get();
            if (!userDoc.exists) {
                console.log(`User ${reminder.userId} not found, skipping reminder`);
                try {
                    await doc.ref.update({ processingAt: admin.firestore.FieldValue.delete(), processingBy: admin.firestore.FieldValue.delete() });
                }
                catch (_d) {
                    // ignore
                }
                return;
            }
            const userData = userDoc.data();
            const fcmTokens = (userData === null || userData === void 0 ? void 0 : userData.fcmTokens) || {};
            const tokens = Object.keys(fcmTokens);
            const pushEnabled = !!((_b = (_a = userData === null || userData === void 0 ? void 0 : userData.settings) === null || _a === void 0 ? void 0 : _a.notifications) === null || _b === void 0 ? void 0 : _b.taskReminders);
            const userEmail = typeof (userData === null || userData === void 0 ? void 0 : userData.email) === 'string' ? userData.email : null;
            // Prepare notification message
            const message = {
                notification: {
                    title: '⏰ Rappel de tâche',
                    body: (task === null || task === void 0 ? void 0 : task.title) ? String(task.title) : 'Tu as une tâche à vérifier.'
                },
                data: {
                    taskId: reminder.taskId,
                    dueDate: reminder.dueDate,
                    url: `/tasks/${reminder.taskId}`
                }
            };
            let delivered = false;
            let deliveryChannel;
            if (pushEnabled && tokens.length > 0) {
                const invalidTokens = new Set();
                let sentAny = false;
                const sendPromises = tokens.map(async (token) => {
                    try {
                        await admin.messaging().send(Object.assign(Object.assign({}, message), { token }));
                        sentAny = true;
                    }
                    catch (error) {
                        const messagingError = error;
                        console.warn(`Failed sending reminder ${doc.id} to token (user=${reminder.userId}) code=${messagingError.code}`);
                        if (messagingError.code === 'messaging/invalid-registration-token' ||
                            messagingError.code === 'messaging/registration-token-not-registered') {
                            invalidTokens.add(token);
                        }
                    }
                });
                await Promise.all(sendPromises);
                if (invalidTokens.size > 0) {
                    try {
                        const nextMap = {};
                        for (const t of tokens) {
                            if (!invalidTokens.has(t))
                                nextMap[t] = true;
                        }
                        await db.collection('users').doc(reminder.userId).update({ fcmTokens: nextMap });
                    }
                    catch (e) {
                        console.warn(`Failed cleaning invalid tokens for user ${reminder.userId}`, e);
                    }
                }
                if (sentAny) {
                    delivered = true;
                    deliveryChannel = 'web_push';
                }
            }
            if (!delivered) {
                if (!userEmail) {
                    console.warn(`No email available for user ${reminder.userId}; cannot send email reminder ${doc.id}`);
                }
                else {
                    try {
                        await sendReminderEmail({
                            to: userEmail,
                            taskTitle: (task === null || task === void 0 ? void 0 : task.title) ? String(task.title) : 'Tâche',
                            reminderTimeIso: reminder.reminderTime,
                            taskId: reminder.taskId,
                        });
                        delivered = true;
                        deliveryChannel = 'email';
                    }
                    catch (e) {
                        console.error(`Email reminder failed for ${doc.id} (user=${reminder.userId})`, e);
                    }
                }
            }
            if (delivered) {
                await doc.ref.update({
                    sent: true,
                    deliveryChannel,
                    processingAt: admin.firestore.FieldValue.delete(),
                    processingBy: admin.firestore.FieldValue.delete(),
                });
            }
            else {
                // Allow retry on next run (but only after TTL, enforced by claimReminder).
                try {
                    await doc.ref.update({ processingAt: admin.firestore.Timestamp.fromDate(now), processingBy });
                }
                catch (_e) {
                    // ignore
                }
            }
        });
        await Promise.all(reminderPromises);
        console.log('Reminder check completed successfully');
    }
    catch (error) {
        console.error('Error processing reminders:', error instanceof Error ? error.message : 'Unknown error');
    }
});
// Optional: Clean up old reminders
exports.cleanupOldReminders = functions.pubsub
    .schedule('every 24 hours')
    .onRun(async (context) => {
    const db = admin.firestore();
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    try {
        const oldReminders = await db
            .collection('taskReminders')
            .where('reminderTime', '<=', twoDaysAgo.toISOString())
            .get();
        const deletePromises = oldReminders.docs.map((doc) => doc.ref.delete());
        await Promise.all(deletePromises);
        console.log(`Cleaned up ${oldReminders.size} old reminders`);
    }
    catch (error) {
        console.error('Error cleaning up old reminders:', error instanceof Error ? error.message : 'Unknown error');
    }
});
exports.testSendReminderEmail = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed. Use POST.' });
        return;
    }
    const secret = getEmailTestSecret();
    if (!secret) {
        res.status(500).json({ error: 'Email test secret is not configured.' });
        return;
    }
    const provided = (req.get('x-email-test-secret') || '').trim();
    if (!provided || provided !== secret) {
        res.status(401).json({ error: 'Unauthorized.' });
        return;
    }
    const body = ((_a = req.body) !== null && _a !== void 0 ? _a : {});
    const reminderId = typeof body.reminderId === 'string' ? body.reminderId : null;
    const userId = typeof body.userId === 'string' ? body.userId : null;
    const toOverride = typeof body.to === 'string' ? body.to : null;
    const db = admin.firestore();
    try {
        const effectiveReminderId = reminderId;
        if (!effectiveReminderId && userId) {
            const snap = await db
                .collection('taskReminders')
                .where('userId', '==', userId)
                .where('sent', '==', false)
                .limit(1)
                .get();
            const doc = (_b = snap.docs[0]) !== null && _b !== void 0 ? _b : null;
            if (!doc) {
                res.status(404).json({ error: 'No pending reminder found for this user.' });
                return;
            }
            const reminderRef = doc.ref;
            const reminder = doc.data();
            const taskSnap = await db.collection('tasks').doc(reminder.taskId).get();
            const taskTitle = taskSnap.exists ? String((_d = (_c = taskSnap.data()) === null || _c === void 0 ? void 0 : _c.title) !== null && _d !== void 0 ? _d : 'Tâche') : 'Tâche';
            const userSnap = await db.collection('users').doc(reminder.userId).get();
            const userEmail = userSnap.exists && typeof ((_e = userSnap.data()) === null || _e === void 0 ? void 0 : _e.email) === 'string' ? userSnap.data().email : null;
            const to = toOverride !== null && toOverride !== void 0 ? toOverride : userEmail;
            if (!to) {
                res.status(400).json({ error: 'No recipient email available. Provide body.to or ensure user.email exists.' });
                return;
            }
            await sendReminderEmail({
                to,
                taskTitle,
                reminderTimeIso: reminder.reminderTime,
                taskId: reminder.taskId,
            });
            await reminderRef.update({ sent: true, deliveryChannel: 'email' });
            res.status(200).json({ ok: true, reminderId: reminderRef.id, to, deliveryChannel: 'email' });
            return;
        }
        if (effectiveReminderId) {
            const reminderRef = db.collection('taskReminders').doc(effectiveReminderId);
            const reminderSnap = await reminderRef.get();
            if (!reminderSnap.exists) {
                res.status(404).json({ error: 'Reminder not found.' });
                return;
            }
            const reminder = reminderSnap.data();
            const taskSnap = await db.collection('tasks').doc(reminder.taskId).get();
            const taskTitle = taskSnap.exists ? String((_g = (_f = taskSnap.data()) === null || _f === void 0 ? void 0 : _f.title) !== null && _g !== void 0 ? _g : 'Tâche') : 'Tâche';
            const userSnap = await db.collection('users').doc(reminder.userId).get();
            const userEmail = userSnap.exists && typeof ((_h = userSnap.data()) === null || _h === void 0 ? void 0 : _h.email) === 'string' ? userSnap.data().email : null;
            const to = toOverride !== null && toOverride !== void 0 ? toOverride : userEmail;
            if (!to) {
                res.status(400).json({ error: 'No recipient email available. Provide body.to or ensure user.email exists.' });
                return;
            }
            await sendReminderEmail({
                to,
                taskTitle,
                reminderTimeIso: reminder.reminderTime,
                taskId: reminder.taskId,
            });
            await reminderRef.update({ sent: true, deliveryChannel: 'email' });
            res.status(200).json({ ok: true, reminderId: effectiveReminderId, to, deliveryChannel: 'email' });
            return;
        }
        // Direct send mode (no Firestore reminder update)
        const to = toOverride;
        const taskId = typeof body.taskId === 'string' ? body.taskId : null;
        const taskTitle = typeof body.taskTitle === 'string' ? body.taskTitle : 'Tâche';
        const reminderTimeIso = typeof body.reminderTimeIso === 'string' ? body.reminderTimeIso : new Date().toISOString();
        if (!to) {
            res.status(400).json({ error: 'Missing body.to' });
            return;
        }
        await sendReminderEmail({
            to,
            taskTitle,
            reminderTimeIso,
            taskId: taskId !== null && taskId !== void 0 ? taskId : 'unknown',
        });
        res.status(200).json({ ok: true, to, taskId: taskId !== null && taskId !== void 0 ? taskId : null });
    }
    catch (e) {
        console.error('testSendReminderEmail failed', e);
        res.status(500).json({
            error: e instanceof Error ? e.message : 'Unknown error',
        });
    }
});
//# sourceMappingURL=index.js.map