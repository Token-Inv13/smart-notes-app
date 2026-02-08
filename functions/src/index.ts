import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as nodemailer from 'nodemailer';
import { createHash } from 'crypto';

admin.initializeApp();

interface TaskReminder {
  userId: string;
  taskId: string;
  dueDate: string;
  reminderTime: string;
  sent: boolean;
  deliveryChannel?: 'web_push' | 'email';
}

interface MessagingError {
  code: string;
  [key: string]: any;
}

type AssistantObjectStatus = 'idle' | 'queued' | 'processing' | 'done' | 'error';
type AssistantJobStatus = 'queued' | 'processing' | 'done' | 'error';

type AssistantCoreRef = {
  collection: 'notes';
  id: string;
};

type AssistantObjectDoc = {
  objectId: string;
  type: 'note';
  coreRef: AssistantCoreRef;
  textHash: string;
  pipelineVersion: 1;
  status: AssistantObjectStatus;
  lastAnalyzedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | null;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
};

type AssistantJobDoc = {
  objectId: string;
  jobType: 'analyze_intents_v1';
  pipelineVersion: 1;
  status: AssistantJobStatus;
  attempts: number;
  lockedUntil?: FirebaseFirestore.Timestamp;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
};

type AssistantSuggestionStatus = 'proposed' | 'accepted' | 'rejected' | 'expired';

type AssistantSuggestionKind = 'create_task' | 'create_reminder';

type AssistantSuggestionSource = {
  type: 'note';
  id: string;
};

type AssistantSuggestionPayload = {
  title: string;
  details?: string;
  dueDate?: FirebaseFirestore.Timestamp;
  remindAt?: FirebaseFirestore.Timestamp;
  priority?: 'low' | 'medium' | 'high';
  labels?: string[];
  origin: {
    fromText: string;
  };
  confidence: number;
  explanation: string;
};

type AssistantSuggestionDoc = {
  objectId: string;
  source: AssistantSuggestionSource;
  kind: AssistantSuggestionKind;
  payload: AssistantSuggestionPayload;
  status: AssistantSuggestionStatus;
  pipelineVersion: 1;
  dedupeKey: string;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  expiresAt: FirebaseFirestore.Timestamp;
};

type AssistantDecisionAction = 'accepted' | 'edited_then_accepted' | 'rejected';

type AssistantDecisionCoreObject = {
  type: 'task' | 'taskReminder';
  id: string;
};

type AssistantDecisionDoc = {
  suggestionId: string;
  objectId: string;
  action: AssistantDecisionAction;
  createdCoreObjects: AssistantDecisionCoreObject[];
  beforePayload?: AssistantSuggestionDoc['payload'];
  finalPayload?: AssistantSuggestionDoc['payload'];
  pipelineVersion: 1;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
};

function normalizeAssistantText(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  try {
    return s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return s.toLowerCase().replace(/\s+/g, ' ').trim();
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function clampFromText(raw: string, maxLen: number): string {
  const s = (raw ?? '').trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1).trim()}…`;
}

function normalizeForIntentMatch(raw: string): string {
  return normalizeAssistantText(raw);
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function startOfDay(d: Date): Date {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x;
}

function nextOccurrenceOfWeekday(now: Date, weekday: number): Date {
  const today = now.getDay();
  let delta = (weekday - today + 7) % 7;
  if (delta === 0) delta = 7;
  return addDays(startOfDay(now), delta);
}

function parseTimeInText(text: string): { hours: number; minutes: number; index: number } | null {
  const m1 = text.match(/\b(\d{1,2})\s*h(?:\s*([0-5]\d))?\b/i);
  if (m1 && m1.index != null) {
    const hours = Number(m1[1]);
    const minutes = m1[2] ? Number(m1[2]) : 0;
    if (Number.isFinite(hours) && Number.isFinite(minutes) && hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return { hours, minutes, index: m1.index };
    }
  }

  const m2 = text.match(/\b(\d{1,2}):([0-5]\d)\b/);
  if (m2 && m2.index != null) {
    const hours = Number(m2[1]);
    const minutes = Number(m2[2]);
    if (Number.isFinite(hours) && Number.isFinite(minutes) && hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return { hours, minutes, index: m2.index };
    }
  }

  return null;
}

function parseDateInText(text: string, now: Date): { date: Date; index: number } | null {
  const t = normalizeForIntentMatch(text);

  const idxToday = t.indexOf("aujourd'hui");
  if (idxToday >= 0) {
    return { date: startOfDay(now), index: idxToday };
  }
  const idxTomorrow = t.indexOf('demain');
  if (idxTomorrow >= 0) {
    return { date: startOfDay(addDays(now, 1)), index: idxTomorrow };
  }

  const weekdayMap: Record<string, number> = {
    dimanche: 0,
    lundi: 1,
    mardi: 2,
    mercredi: 3,
    jeudi: 4,
    vendredi: 5,
    samedi: 6,
  };
  for (const [k, v] of Object.entries(weekdayMap)) {
    const idx = t.indexOf(k);
    if (idx >= 0) {
      return { date: nextOccurrenceOfWeekday(now, v), index: idx };
    }
  }

  const m = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m && m.index != null) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    let yyyy: number;
    if (m[3]) {
      const raw = Number(m[3]);
      yyyy = raw < 100 ? 2000 + raw : raw;
    } else {
      yyyy = now.getFullYear();
    }

    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12 && yyyy >= 1970 && yyyy <= 2100) {
      const d = new Date(yyyy, mm - 1, dd, 0, 0, 0, 0);
      if (Number.isFinite(d.getTime())) {
        if (!m[3] && d.getTime() < startOfDay(now).getTime()) {
          d.setFullYear(yyyy + 1);
        }
        return { date: startOfDay(d), index: m.index };
      }
    }
  }

  return null;
}

function composeDateTime(params: {
  now: Date;
  baseDate: Date | null;
  time: { hours: number; minutes: number } | null;
}): Date | null {
  const { now, baseDate, time } = params;

  if (!baseDate && !time) return null;

  const day = baseDate ? startOfDay(baseDate) : startOfDay(now);
  const hours = time ? time.hours : 9;
  const minutes = time ? time.minutes : 0;

  const dt = new Date(day.getTime());
  dt.setHours(hours, minutes, 0, 0);

  if (!baseDate && time) {
    if (dt.getTime() <= now.getTime()) {
      return addDays(dt, 1);
    }
  }

  return dt;
}

type DetectedIntent = {
  intent: 'PAYER' | 'APPELER' | 'PRENDRE_RDV';
  title: string;
  originFromText: string;
  explanation: string;
  kind: AssistantSuggestionKind;
  dueDate?: FirebaseFirestore.Timestamp;
  remindAt?: FirebaseFirestore.Timestamp;
  confidence: number;
  dedupeMinimal: {
    title: string;
    dueDateMs?: number;
    remindAtMs?: number;
  };
};

function buildSuggestionDedupeKey(params: {
  objectId: string;
  kind: AssistantSuggestionKind;
  minimal: DetectedIntent['dedupeMinimal'];
}): string {
  const { objectId, kind, minimal } = params;
  const payloadMinimal = JSON.stringify({
    title: normalizeAssistantText(minimal.title),
    dueDateMs: minimal.dueDateMs ?? null,
    remindAtMs: minimal.remindAtMs ?? null,
  });
  return sha256Hex(`${objectId}|${kind}|${payloadMinimal}`);
}

function detectIntentsV1(params: { title: string; content: string; now: Date }): DetectedIntent[] {
  const { title, content, now } = params;
  const rawText = `${title}\n${content}`;
  const textNorm = normalizeForIntentMatch(rawText);

  const dateHit = parseDateInText(rawText, now);
  const timeHit = parseTimeInText(rawText);
  const dt = composeDateTime({
    now,
    baseDate: dateHit ? dateHit.date : null,
    time: timeHit ? { hours: timeHit.hours, minutes: timeHit.minutes } : null,
  });

  const dtTs = dt ? admin.firestore.Timestamp.fromDate(dt) : null;

  const intents: DetectedIntent[] = [];

  const add = (next: Omit<DetectedIntent, 'dedupeMinimal'> & { dedupeMinimal?: DetectedIntent['dedupeMinimal'] }) => {
    const confidence = next.confidence;
    if (confidence < 0.7) return;
    const minimal: DetectedIntent['dedupeMinimal'] = next.dedupeMinimal ?? {
      title: next.title,
      dueDateMs: next.dueDate ? next.dueDate.toMillis() : undefined,
      remindAtMs: next.remindAt ? next.remindAt.toMillis() : undefined,
    };
    intents.push({ ...next, confidence, dedupeMinimal: minimal });
  };

  const payHasKeyword =
    textNorm.includes('payer') ||
    textNorm.includes('regler') ||
    textNorm.includes('facture') ||
    textNorm.includes('loyer') ||
    textNorm.includes('impots') ||
    textNorm.includes('abonnement');

  const mPay = rawText.match(/\b(payer|r[ée]gler)\b\s+([^\n\r\.,;]+)/i);
  if (mPay || payHasKeyword) {
    const obj = mPay ? String(mPay[2] ?? '').trim() : '';
    const objTitle = obj ? obj : 'facture';
    const sugTitle = `Payer ${objTitle}`.replace(/\s+/g, ' ').trim();
    const kind: AssistantSuggestionKind = dtTs && timeHit ? 'create_reminder' : 'create_task';
    add({
      intent: 'PAYER',
      title: sugTitle,
      originFromText: clampFromText(mPay ? mPay[0] : 'payer', 120),
      explanation: `Détecté une intention de paiement dans la note.`,
      kind,
      dueDate: kind === 'create_task' && dtTs ? dtTs : undefined,
      remindAt: kind === 'create_reminder' && dtTs ? dtTs : undefined,
      confidence: 0.8,
    });
  }

  const mCall = rawText.match(/\b(appeler|t[ée]l[ée]phoner|tel|phone)\b\s+([^\n\r\.,;]+)/i);
  if (mCall) {
    const obj = String(mCall[2] ?? '').trim();
    const objTitle = obj ? obj : 'quelqu’un';
    const sugTitle = `Appeler ${objTitle}`.replace(/\s+/g, ' ').trim();
    const kind: AssistantSuggestionKind = dtTs && timeHit ? 'create_reminder' : 'create_task';
    add({
      intent: 'APPELER',
      title: sugTitle,
      originFromText: clampFromText(mCall[0], 120),
      explanation: `Détecté une intention d’appel dans la note.`,
      kind,
      dueDate: kind === 'create_task' && dtTs ? dtTs : undefined,
      remindAt: kind === 'create_reminder' && dtTs ? dtTs : undefined,
      confidence: 0.8,
    });
  }

  const mRdv = rawText.match(/\b(prendre\s+rdv|prendre\s+rendez-vous|rdv|rendez-vous|r[ée]server)\b\s*([^\n\r\.,;]+)?/i);
  if (mRdv) {
    const obj = String(mRdv[2] ?? '').trim();
    const objTitle = obj ? obj : '';
    const baseTitle = objTitle ? `Prendre RDV ${objTitle}` : 'Prendre RDV';
    const sugTitle = baseTitle.replace(/\s+/g, ' ').trim();
    const kind: AssistantSuggestionKind = dtTs && timeHit ? 'create_reminder' : 'create_task';
    add({
      intent: 'PRENDRE_RDV',
      title: sugTitle,
      originFromText: clampFromText(mRdv[0], 120),
      explanation: `Détecté une intention de rendez-vous dans la note.`,
      kind,
      dueDate: kind === 'create_task' && dtTs ? dtTs : undefined,
      remindAt: kind === 'create_reminder' && dtTs ? dtTs : undefined,
      confidence: 0.8,
    });
  }

  return intents;
}

function assistantObjectIdForNote(noteId: string): string {
  return `note_${noteId}`;
}

async function isAssistantEnabledForUser(db: FirebaseFirestore.Firestore, userId: string): Promise<boolean> {
  const snap = await db
    .collection('users')
    .doc(userId)
    .collection('assistantSettings')
    .doc('main')
    .get();
  return snap.exists && snap.data()?.enabled === true;
}

type SmtpEnv = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  appBaseUrl: string;
};

type SmtpEnvResolved = {
  env: SmtpEnv;
  source: {
    host: 'functions.config' | 'process.env';
    port: 'functions.config' | 'process.env';
    user: 'functions.config' | 'process.env';
    pass: 'functions.config' | 'process.env';
    from: 'functions.config' | 'process.env';
    appBaseUrl: 'functions.config' | 'process.env';
  };
};

function getSmtpEnv(): SmtpEnvResolved | null {
  const cfg = functions.config() as any;

  const hostCfg = cfg?.smtp?.host as string | undefined;
  const portCfg = cfg?.smtp?.port as string | undefined;
  const userCfg = cfg?.smtp?.user as string | undefined;
  const passCfg = cfg?.smtp?.pass as string | undefined;
  const fromCfg = cfg?.smtp?.from as string | undefined;
  const appBaseUrlCfg = cfg?.app?.base_url as string | undefined;

  const hostEnv = process.env.SMTP_HOST;
  const portEnv = process.env.SMTP_PORT;
  const userEnv = process.env.SMTP_USER;
  const passEnv = process.env.SMTP_PASS;
  const fromEnv = process.env.SMTP_FROM;
  const appBaseUrlEnv = process.env.APP_BASE_URL;

  const host = hostCfg ?? hostEnv;
  const portRaw = portCfg ?? portEnv;
  const user = userCfg ?? userEnv;
  const pass = passCfg ?? passEnv;
  const from = fromCfg ?? fromEnv;
  const appBaseUrl = appBaseUrlCfg ?? appBaseUrlEnv;

  const source = {
    host: hostCfg ? 'functions.config' : 'process.env',
    port: portCfg ? 'functions.config' : 'process.env',
    user: userCfg ? 'functions.config' : 'process.env',
    pass: passCfg ? 'functions.config' : 'process.env',
    from: fromCfg ? 'functions.config' : 'process.env',
    appBaseUrl: appBaseUrlCfg ? 'functions.config' : 'process.env',
  } as const;

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

function getEmailTestSecret(): string | null {
  const cfg = functions.config() as any;
  const secret = (cfg?.email_test?.secret as string | undefined) ?? process.env.EMAIL_TEST_SECRET;
  return secret ?? null;
}

async function sendReminderEmail(params: {
  to: string;
  taskTitle: string;
  reminderTimeIso: string;
  taskId: string;
}): Promise<void> {
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
  } catch (e) {
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
      messageId: (info as any)?.messageId,
      accepted: (info as any)?.accepted,
      rejected: (info as any)?.rejected,
      response: (info as any)?.response,
    });
  } catch (e) {
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

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function claimReminder(params: {
  db: FirebaseFirestore.Firestore;
  ref: FirebaseFirestore.DocumentReference;
  now: FirebaseFirestore.Timestamp;
  processingTtlMs: number;
  processingBy: string;
}): Promise<boolean> {
  const { db, ref, now, processingTtlMs, processingBy } = params;

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;

    const data = snap.data() as any;
    if (data?.sent === true) return false;

    const processingAt: FirebaseFirestore.Timestamp | null = data?.processingAt ?? null;
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

export const checkAndSendReminders = functions.pubsub
  .schedule('every 1 minutes')
  .onRun(async (context) => {
    const now = new Date();
    const nowIso = now.toISOString();
    const processingTtlMs = 2 * 60 * 1000;
    const processingBy = typeof (context as any)?.eventId === 'string' && (context as any).eventId
      ? String((context as any).eventId)
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

      console.log(
        `checkAndSendReminders: now=${nowIso} reminders=${remindersSnapshot.size}`,
      );

      const reminderPromises = remindersSnapshot.docs.map(async (doc) => {
        const reminder = doc.data() as TaskReminder;

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
          } catch {
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
          } catch {
            // ignore
          }
          return;
        }
        
        const userData = userDoc.data();
        const fcmTokens = userData?.fcmTokens || {};

        const tokens = Object.keys(fcmTokens);

        const pushEnabled = !!userData?.settings?.notifications?.taskReminders;
        const userEmail = typeof userData?.email === 'string' ? userData.email : null;

        // Prepare notification message
        const message = {
          notification: {
            title: '⏰ Rappel de tâche',
            body: task?.title ? String(task.title) : 'Tu as une tâche à vérifier.'
          },
          data: {
            taskId: reminder.taskId,
            dueDate: reminder.dueDate,
            url: `/tasks/${reminder.taskId}`
          }
        };

        let delivered = false;
        let deliveryChannel: TaskReminder['deliveryChannel'] | undefined;

        if (pushEnabled && tokens.length > 0) {
          const invalidTokens = new Set<string>();
          let sentAny = false;

          const sendPromises = tokens.map(async (token) => {
            try {
              await admin.messaging().send({
                ...message,
                token,
              });
              sentAny = true;
            } catch (error) {
              const messagingError = error as MessagingError;
              console.warn(
                `Failed sending reminder ${doc.id} to token (user=${reminder.userId}) code=${messagingError.code}`,
              );
              if (
                messagingError.code === 'messaging/invalid-registration-token' ||
                messagingError.code === 'messaging/registration-token-not-registered'
              ) {
                invalidTokens.add(token);
              }
            }
          });

          await Promise.all(sendPromises);

          if (invalidTokens.size > 0) {
            try {
              const nextMap: Record<string, boolean> = {};
              for (const t of tokens) {
                if (!invalidTokens.has(t)) nextMap[t] = true;
              }
              await db.collection('users').doc(reminder.userId).update({ fcmTokens: nextMap });
            } catch (e) {
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
          } else {
            try {
              await sendReminderEmail({
                to: userEmail,
                taskTitle: task?.title ? String(task.title) : 'Tâche',
                reminderTimeIso: reminder.reminderTime,
                taskId: reminder.taskId,
              });
              delivered = true;
              deliveryChannel = 'email';
            } catch (e) {
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
        } else {
          // Allow retry on next run (but only after TTL, enforced by claimReminder).
          try {
            await doc.ref.update({ processingAt: admin.firestore.Timestamp.fromDate(now), processingBy });
          } catch {
            // ignore
          }
        }
      });
      
      await Promise.all(reminderPromises);
      
      console.log('Reminder check completed successfully');
    } catch (error) {
      console.error('Error processing reminders:', error instanceof Error ? error.message : 'Unknown error');
    }
  });

// Optional: Clean up old reminders
export const cleanupOldReminders = functions.pubsub
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
    } catch (error) {
      console.error('Error cleaning up old reminders:', error instanceof Error ? error.message : 'Unknown error');
    }
  });

export const testSendReminderEmail = functions.https.onRequest(async (req, res) => {
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

  const body = (req.body ?? {}) as any;
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

      const doc = snap.docs[0] ?? null;
      if (!doc) {
        res.status(404).json({ error: 'No pending reminder found for this user.' });
        return;
      }

      const reminderRef = doc.ref;
      const reminder = doc.data() as TaskReminder;

      const taskSnap = await db.collection('tasks').doc(reminder.taskId).get();
      const taskTitle = taskSnap.exists ? String(taskSnap.data()?.title ?? 'Tâche') : 'Tâche';

      const userSnap = await db.collection('users').doc(reminder.userId).get();
      const userEmail = userSnap.exists && typeof userSnap.data()?.email === 'string' ? (userSnap.data() as any).email : null;

      const to = toOverride ?? userEmail;
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

      const reminder = reminderSnap.data() as TaskReminder;

      const taskSnap = await db.collection('tasks').doc(reminder.taskId).get();
      const taskTitle = taskSnap.exists ? String(taskSnap.data()?.title ?? 'Tâche') : 'Tâche';

      const userSnap = await db.collection('users').doc(reminder.userId).get();
      const userEmail = userSnap.exists && typeof userSnap.data()?.email === 'string' ? (userSnap.data() as any).email : null;

      const to = toOverride ?? userEmail;
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
      taskId: taskId ?? 'unknown',
    });

    res.status(200).json({ ok: true, to, taskId: taskId ?? null });
  } catch (e) {
    console.error('testSendReminderEmail failed', e);
    res.status(500).json({
      error: e instanceof Error ? e.message : 'Unknown error',
    });
  }
});

export const assistantEnqueueNoteJob = functions.firestore
  .document('notes/{noteId}')
  .onWrite(async (change, context) => {
    const after = change.after.exists ? (change.after.data() as any) : null;
    if (!after) return;

    const noteId = typeof context.params.noteId === 'string' ? context.params.noteId : null;
    if (!noteId) return;

    const userId = typeof after.userId === 'string' ? after.userId : null;
    if (!userId) return;

    const db = admin.firestore();

    const enabled = await isAssistantEnabledForUser(db, userId);
    if (!enabled) return;

    const title = typeof after.title === 'string' ? after.title : '';
    const content = typeof after.content === 'string' ? after.content : '';
    const normalized = normalizeAssistantText(`${title}\n${content}`);
    const textHash = sha256Hex(normalized);

    const objectId = assistantObjectIdForNote(noteId);
    const userRef = db.collection('users').doc(userId);
    const objectRef = userRef.collection('assistantObjects').doc(objectId);
    const jobsCol = userRef.collection('assistantJobs');

    const lockedUntilReady = admin.firestore.Timestamp.fromMillis(0);

    await db.runTransaction(async (tx) => {
      const objectSnap = await tx.get(objectRef);
      const prevHash = objectSnap.exists ? (objectSnap.data() as any)?.textHash : null;
      if (typeof prevHash === 'string' && prevHash === textHash) {
        return;
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      const objectPayload: Partial<AssistantObjectDoc> = {
        objectId,
        type: 'note',
        coreRef: { collection: 'notes', id: noteId },
        textHash,
        pipelineVersion: 1,
        status: 'queued',
        updatedAt: now,
      };

      if (!objectSnap.exists) {
        objectPayload.createdAt = now;
        objectPayload.lastAnalyzedAt = null;
      }

      tx.set(objectRef, objectPayload, { merge: true });

      const jobRef = jobsCol.doc();
      const jobPayload: AssistantJobDoc = {
        objectId,
        jobType: 'analyze_intents_v1',
        pipelineVersion: 1,
        status: 'queued',
        attempts: 0,
        lockedUntil: lockedUntilReady,
        createdAt: now,
        updatedAt: now,
      };
      tx.create(jobRef, jobPayload);
    });
  });

const ASSISTANT_JOB_LOCK_MS = 2 * 60 * 1000;
const ASSISTANT_JOB_MAX_ATTEMPTS = 3;

async function claimAssistantJob(params: {
  db: FirebaseFirestore.Firestore;
  ref: FirebaseFirestore.DocumentReference;
  now: FirebaseFirestore.Timestamp;
}): Promise<AssistantJobDoc | null> {
  const { db, ref, now } = params;

  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;

    const data = snap.data() as any;
    const status = data?.status as AssistantJobStatus | undefined;
    if (status !== 'queued') return null;

    const attempts = typeof data?.attempts === 'number' ? data.attempts : 0;
    if (attempts >= ASSISTANT_JOB_MAX_ATTEMPTS) {
      tx.update(ref, {
        status: 'error',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return null;
    }

    const lockedUntil: FirebaseFirestore.Timestamp | null = data?.lockedUntil ?? null;
    if (lockedUntil && lockedUntil.toMillis() > now.toMillis()) return null;

    const nextLocked = admin.firestore.Timestamp.fromMillis(now.toMillis() + ASSISTANT_JOB_LOCK_MS);
    tx.update(ref, {
      status: 'processing',
      attempts: attempts + 1,
      lockedUntil: nextLocked,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return snap.data() as AssistantJobDoc;
  });
}

export const assistantRunJobQueue = functions.pubsub
  .schedule('every 2 minutes')
  .onRun(async (context) => {
    const db = admin.firestore();
    const nowDate = new Date();
    const nowTs = admin.firestore.Timestamp.fromDate(nowDate);

    const snap = await db
      .collectionGroup('assistantJobs')
      .where('status', '==', 'queued')
      .where('lockedUntil', '<=', nowTs)
      .orderBy('lockedUntil', 'asc')
      .limit(25)
      .get();

    if (snap.empty) {
      console.log('assistantRunJobQueue: no queued jobs');
      return;
    }

    console.log(`assistantRunJobQueue: queued=${snap.size}`);

    const tasks = snap.docs.map(async (jobDoc) => {
      const userRef = jobDoc.ref.parent.parent;
      const userId = userRef?.id;
      if (!userId) return;

      const enabled = await isAssistantEnabledForUser(db, userId);
      if (!enabled) return;

      const claimed = await claimAssistantJob({ db, ref: jobDoc.ref, now: nowTs });
      if (!claimed) return;

      const objectId = typeof claimed.objectId === 'string' ? claimed.objectId : null;
      if (!objectId) return;

      const objectRef = db.collection('users').doc(userId).collection('assistantObjects').doc(objectId);
      try {
        await objectRef.set(
          {
            status: 'processing',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      } catch {
        // ignore
      }

      try {
        console.log('assistant job processing', {
          userId,
          jobId: jobDoc.id,
          objectId,
          jobType: claimed.jobType,
          pipelineVersion: claimed.pipelineVersion,
        });

        if (claimed.jobType === 'analyze_intents_v1') {
          const objectSnap = await objectRef.get();
          const objectData = objectSnap.exists ? (objectSnap.data() as any) : null;
          const coreRef = objectData?.coreRef as AssistantCoreRef | undefined;
          const noteId = coreRef?.collection === 'notes' && typeof coreRef?.id === 'string' ? coreRef.id : null;

          if (noteId) {
            const noteSnap = await db.collection('notes').doc(noteId).get();
            const note = noteSnap.exists ? (noteSnap.data() as any) : null;

            const noteUserId = typeof note?.userId === 'string' ? note.userId : null;
            if (note && noteUserId === userId) {
              const noteTitle = typeof note?.title === 'string' ? note.title : '';
              const noteContent = typeof note?.content === 'string' ? note.content : '';

              const detected = detectIntentsV1({ title: noteTitle, content: noteContent, now: nowDate });
              if (detected.length > 0) {
                const suggestionsCol = db.collection('users').doc(userId).collection('assistantSuggestions');
                const expiresAt = admin.firestore.Timestamp.fromMillis(nowDate.getTime() + 14 * 24 * 60 * 60 * 1000);
                const nowServer = admin.firestore.FieldValue.serverTimestamp();

                for (const d of detected) {
                  const dedupeKey = buildSuggestionDedupeKey({ objectId, kind: d.kind, minimal: d.dedupeMinimal });
                  const sugRef = suggestionsCol.doc(dedupeKey);

                  await db.runTransaction(async (tx) => {
                    const existing = await tx.get(sugRef);
                    if (existing.exists) {
                      const st = (existing.data() as any)?.status as AssistantSuggestionStatus | undefined;
                      if (st === 'proposed' || st === 'accepted') return;

                      const payload: AssistantSuggestionPayload = {
                        title: d.title,
                        ...(d.dueDate ? { dueDate: d.dueDate } : {}),
                        ...(d.remindAt ? { remindAt: d.remindAt } : {}),
                        origin: {
                          fromText: d.originFromText,
                        },
                        confidence: d.confidence,
                        explanation: d.explanation,
                      };

                      tx.update(sugRef, {
                        objectId,
                        source: { type: 'note', id: noteId },
                        kind: d.kind,
                        payload,
                        status: 'proposed',
                        pipelineVersion: 1,
                        dedupeKey,
                        updatedAt: nowServer,
                        expiresAt,
                      });
                      return;
                    }

                    const payload: AssistantSuggestionPayload = {
                      title: d.title,
                      ...(d.dueDate ? { dueDate: d.dueDate } : {}),
                      ...(d.remindAt ? { remindAt: d.remindAt } : {}),
                      origin: {
                        fromText: d.originFromText,
                      },
                      confidence: d.confidence,
                      explanation: d.explanation,
                    };

                    const doc: AssistantSuggestionDoc = {
                      objectId,
                      source: { type: 'note', id: noteId },
                      kind: d.kind,
                      payload,
                      status: 'proposed',
                      pipelineVersion: 1,
                      dedupeKey,
                      createdAt: nowServer,
                      updatedAt: nowServer,
                      expiresAt,
                    };

                    tx.create(sugRef, doc);
                  });
                }
              }
            }
          }
        }

        await jobDoc.ref.update({
          status: 'done',
          lockedUntil: admin.firestore.Timestamp.fromMillis(0),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        await objectRef.set(
          {
            status: 'done',
            lastAnalyzedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      } catch (e) {
        console.error('assistant job failed', {
          userId,
          jobId: jobDoc.id,
          error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e,
        });

        try {
          await jobDoc.ref.update({
            status: 'error',
            lockedUntil: admin.firestore.Timestamp.fromMillis(0),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch {
          // ignore
        }

        try {
          const objectRef = db.collection('users').doc(userId).collection('assistantObjects').doc(objectId);
          await objectRef.set(
            {
              status: 'error',
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        } catch {
          // ignore
        }
      }
    });

    await Promise.all(tasks);
  });

export const assistantApplySuggestion = functions.https.onCall(async (data, context) => {
  const userId = context.auth?.uid;
  if (!userId) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const suggestionId = typeof (data as any)?.suggestionId === 'string' ? String((data as any).suggestionId) : null;
  if (!suggestionId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing suggestionId.');
  }

  const overrides =
    typeof (data as any)?.overrides === 'object' && (data as any).overrides
      ? ((data as any).overrides as Record<string, unknown>)
      : null;

  const db = admin.firestore();
  const userRef = db.collection('users').doc(userId);
  const suggestionRef = userRef.collection('assistantSuggestions').doc(suggestionId);
  const decisionsCol = userRef.collection('assistantDecisions');

  const taskRef = db.collection('tasks').doc();
  const reminderRef = db.collection('taskReminders').doc();
  const decisionRef = decisionsCol.doc();

  const nowTs = admin.firestore.Timestamp.now();

  let decisionId: string | null = null;
  const createdCoreObjects: AssistantDecisionCoreObject[] = [];

  await db.runTransaction(async (tx) => {
    createdCoreObjects.length = 0;

    const suggestionSnap = await tx.get(suggestionRef);
    if (!suggestionSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Suggestion not found.');
    }

    const suggestion = suggestionSnap.data() as AssistantSuggestionDoc;

    if (suggestion.status !== 'proposed') {
      throw new functions.https.HttpsError('failed-precondition', 'Suggestion is not proposed.');
    }

    if (!suggestion.expiresAt || suggestion.expiresAt.toMillis() <= nowTs.toMillis()) {
      throw new functions.https.HttpsError('failed-precondition', 'Suggestion expired.');
    }

    const payload = suggestion.payload as any;
    const baseTitle = typeof payload?.title === 'string' ? payload.title.trim() : '';
    if (!baseTitle) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid payload.title');
    }

    const kind = suggestion.kind;
    if (kind !== 'create_task' && kind !== 'create_reminder') {
      throw new functions.https.HttpsError('invalid-argument', 'Unknown suggestion kind.');
    }

    if (overrides) {
      const allowed =
        kind === 'create_task'
          ? new Set(['title', 'dueDate', 'priority'])
          : new Set(['title', 'remindAt', 'priority']);
      for (const key of Object.keys(overrides)) {
        if (!allowed.has(key)) {
          throw new functions.https.HttpsError('invalid-argument', `Invalid overrides key: ${key}`);
        }
      }
    }

    const priority = payload?.priority;
    const basePriorityValue: 'low' | 'medium' | 'high' | null =
      priority === 'low' || priority === 'medium' || priority === 'high' ? priority : null;

    const baseDueDate = payload?.dueDate instanceof admin.firestore.Timestamp ? (payload.dueDate as admin.firestore.Timestamp) : null;
    const baseRemindAt = payload?.remindAt instanceof admin.firestore.Timestamp ? (payload.remindAt as admin.firestore.Timestamp) : null;

    const parseOverrideTimestamp = (value: unknown): admin.firestore.Timestamp | null => {
      if (value === null) return null;
      if (typeof value === 'number' && Number.isFinite(value)) {
        return admin.firestore.Timestamp.fromMillis(value);
      }
      if (typeof value === 'object' && value) {
        const candidate = value as { seconds?: unknown; nanoseconds?: unknown; _seconds?: unknown; _nanoseconds?: unknown };
        const seconds = typeof candidate.seconds === 'number' ? candidate.seconds : typeof candidate._seconds === 'number' ? candidate._seconds : null;
        const nanos = typeof candidate.nanoseconds === 'number' ? candidate.nanoseconds : typeof candidate._nanoseconds === 'number' ? candidate._nanoseconds : 0;
        if (seconds !== null && Number.isFinite(seconds) && Number.isFinite(nanos)) {
          return new admin.firestore.Timestamp(seconds, nanos);
        }
      }
      throw new functions.https.HttpsError('invalid-argument', 'Invalid overrides timestamp value.');
    };

    const overrideTitleRaw = overrides ? overrides.title : undefined;
    const overrideTitle =
      typeof overrideTitleRaw === 'undefined'
        ? undefined
        : typeof overrideTitleRaw === 'string'
          ? overrideTitleRaw.trim()
          : null;
    if (overrideTitle === '') {
      throw new functions.https.HttpsError('invalid-argument', 'overrides.title cannot be empty.');
    }
    if (overrideTitle === null) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid overrides.title');
    }

    const overridePriorityRaw = overrides ? overrides.priority : undefined;
    const overridePriorityValue: 'low' | 'medium' | 'high' | null | undefined =
      typeof overridePriorityRaw === 'undefined'
        ? undefined
        : overridePriorityRaw === null
          ? null
          : overridePriorityRaw === 'low' || overridePriorityRaw === 'medium' || overridePriorityRaw === 'high'
            ? (overridePriorityRaw as 'low' | 'medium' | 'high')
            : null;
    if (
      typeof overridePriorityRaw !== 'undefined' &&
      overridePriorityRaw !== null &&
      overridePriorityRaw !== 'low' &&
      overridePriorityRaw !== 'medium' &&
      overridePriorityRaw !== 'high'
    ) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid overrides.priority');
    }

    const overrideDueDate = overrides && Object.prototype.hasOwnProperty.call(overrides, 'dueDate') ? parseOverrideTimestamp(overrides.dueDate) : undefined;
    const overrideRemindAt = overrides && Object.prototype.hasOwnProperty.call(overrides, 'remindAt') ? parseOverrideTimestamp(overrides.remindAt) : undefined;

    const finalTitle = typeof overrideTitle === 'string' ? overrideTitle : baseTitle;
    const finalDueDate = typeof overrideDueDate === 'undefined' ? baseDueDate : overrideDueDate;
    const finalRemindAt = typeof overrideRemindAt === 'undefined' ? baseRemindAt : overrideRemindAt;
    const finalPriorityValue = typeof overridePriorityValue === 'undefined' ? basePriorityValue : overridePriorityValue;

    const isEdited =
      (typeof overrideTitle !== 'undefined' && overrideTitle !== baseTitle) ||
      (typeof overrideDueDate !== 'undefined' && (overrideDueDate?.toMillis?.() ?? null) !== (baseDueDate?.toMillis?.() ?? null)) ||
      (typeof overrideRemindAt !== 'undefined' && (overrideRemindAt?.toMillis?.() ?? null) !== (baseRemindAt?.toMillis?.() ?? null)) ||
      (typeof overridePriorityValue !== 'undefined' && overridePriorityValue !== basePriorityValue);

    if (kind === 'create_reminder' && !finalRemindAt) {
      throw new functions.https.HttpsError('invalid-argument', 'remindAt is required for reminders.');
    }

    const beforePayload = suggestion.payload as AssistantSuggestionDoc['payload'];
    const finalPayload = (() => {
      if (!isEdited) return null;
      const next: any = { ...(beforePayload as any) };
      next.title = finalTitle;
      if (finalDueDate) next.dueDate = finalDueDate;
      else delete next.dueDate;
      if (finalRemindAt) next.remindAt = finalRemindAt;
      else delete next.remindAt;
      if (finalPriorityValue) next.priority = finalPriorityValue;
      else delete next.priority;
      return next as AssistantSuggestionDoc['payload'];
    })();

    let userPlan: string | null = null;
    const userSnap = await tx.get(userRef);
    if (userSnap.exists) {
      const userData = userSnap.data() as any;
      userPlan = typeof userData?.plan === 'string' ? userData.plan : null;
    }

    const isPro = userPlan === 'pro';

    const createdAt = admin.firestore.FieldValue.serverTimestamp();
    const updatedAt = admin.firestore.FieldValue.serverTimestamp();

    const effectiveTaskDue = kind === 'create_reminder' ? finalRemindAt ?? finalDueDate : finalDueDate;

    tx.create(taskRef, {
      userId,
      title: finalTitle,
      status: 'todo',
      workspaceId: null,
      startDate: null,
      dueDate: effectiveTaskDue,
      priority: finalPriorityValue,
      favorite: false,
      archived: false,
      source: {
        assistant: true,
        suggestionId,
        objectId: suggestion.objectId,
      },
      createdAt,
      updatedAt,
    });

    createdCoreObjects.push({ type: 'task', id: taskRef.id });

    if (kind === 'create_reminder') {
      if (!isPro) {
        throw new functions.https.HttpsError('failed-precondition', 'Plan pro requis pour créer un rappel.');
      }

      const remindAtIso = finalRemindAt!.toDate().toISOString();

      tx.create(reminderRef, {
        userId,
        taskId: taskRef.id,
        dueDate: remindAtIso,
        reminderTime: remindAtIso,
        sent: false,
        createdAt,
        updatedAt,
        source: {
          assistant: true,
          suggestionId,
          objectId: suggestion.objectId,
        },
      });

      createdCoreObjects.push({ type: 'taskReminder', id: reminderRef.id });
    }

    decisionId = decisionRef.id;

    const decisionDoc: AssistantDecisionDoc = {
      suggestionId,
      objectId: suggestion.objectId,
      action: isEdited ? 'edited_then_accepted' : 'accepted',
      createdCoreObjects: [...createdCoreObjects],
      beforePayload,
      finalPayload: finalPayload ?? undefined,
      pipelineVersion: 1,
      createdAt,
      updatedAt,
    };

    tx.create(decisionRef, decisionDoc);

    tx.update(suggestionRef, {
      status: 'accepted',
      updatedAt,
    });
  });

  return {
    createdCoreObjects,
    decisionId,
  };
});

export const assistantRejectSuggestion = functions.https.onCall(async (data, context) => {
  const userId = context.auth?.uid;
  if (!userId) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const suggestionId = typeof (data as any)?.suggestionId === 'string' ? String((data as any).suggestionId) : null;
  if (!suggestionId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing suggestionId.');
  }

  const db = admin.firestore();
  const userRef = db.collection('users').doc(userId);
  const suggestionRef = userRef.collection('assistantSuggestions').doc(suggestionId);
  const decisionsCol = userRef.collection('assistantDecisions');

  const decisionRef = decisionsCol.doc();

  let decisionId: string | null = null;

  await db.runTransaction(async (tx) => {
    const suggestionSnap = await tx.get(suggestionRef);
    if (!suggestionSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Suggestion not found.');
    }

    const suggestion = suggestionSnap.data() as AssistantSuggestionDoc;
    if (suggestion.status !== 'proposed') {
      throw new functions.https.HttpsError('failed-precondition', 'Suggestion is not proposed.');
    }

    const beforePayload = suggestion.payload as AssistantSuggestionDoc['payload'];

    const nowServer = admin.firestore.FieldValue.serverTimestamp();
    decisionId = decisionRef.id;

    const decisionDoc: AssistantDecisionDoc = {
      suggestionId,
      objectId: suggestion.objectId,
      action: 'rejected',
      createdCoreObjects: [],
      beforePayload,
      pipelineVersion: 1,
      createdAt: nowServer,
      updatedAt: nowServer,
    };

    tx.create(decisionRef, decisionDoc);

    tx.update(suggestionRef, {
      status: 'rejected',
      updatedAt: nowServer,
    });
  });

  return { decisionId };
});
