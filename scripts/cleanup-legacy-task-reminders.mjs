#!/usr/bin/env node
import admin from 'firebase-admin';
import fs from 'node:fs';
import path from 'node:path';

function readFlag(name) {
  return process.argv.includes(`--${name}`);
}

function normalizePrivateKey(value) {
  return value.trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '').replace(/\r\n/g, '\n').replace(/\\n/g, '\n');
}

function loadServiceAccount() {
  const rawJsonCandidate =
    process.env.FIREBASE_ADMIN_JSON ??
    process.env.FIREBASE_ADMIN_CREDENTIALS_JSON ??
    process.env.FIREBASE_ADMIN_CREDENTIALS_BASE64;

  if (rawJsonCandidate && rawJsonCandidate.trim()) {
    let raw = rawJsonCandidate.trim().replace(/^"|"$/g, '');
    if (!raw.startsWith('{')) {
      raw = Buffer.from(raw, 'base64').toString('utf8');
    }
    const parsed = JSON.parse(raw);
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      throw new Error('Invalid FIREBASE_ADMIN_JSON payload.');
    }
    return {
      projectId: String(parsed.project_id),
      clientEmail: String(parsed.client_email),
      privateKey: normalizePrivateKey(String(parsed.private_key)),
    };
  }

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return {
    projectId,
    clientEmail,
    privateKey: normalizePrivateKey(privateKey),
  };
}

function loadDefaultProjectId() {
  try {
    const firebasercPath = path.resolve(process.cwd(), '.firebaserc');
    const raw = fs.readFileSync(firebasercPath, 'utf8');
    const parsed = JSON.parse(raw);
    const projectId = parsed?.projects?.default;
    return typeof projectId === 'string' && projectId ? projectId : null;
  } catch {
    return null;
  }
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function classifyTask(taskData) {
  const allDay = taskData?.allDay === true;
  const recurrenceFreq =
    taskData &&
    typeof taskData === 'object' &&
    taskData.recurrence &&
    typeof taskData.recurrence === 'object' &&
    typeof taskData.recurrence.freq === 'string'
      ? taskData.recurrence.freq
      : null;

  return {
    unsupported: allDay || Boolean(recurrenceFreq),
    allDay,
    recurring: Boolean(recurrenceFreq),
    recurrenceFreq,
  };
}

async function initAdmin() {
  const creds = loadServiceAccount();
  const projectId = creds?.projectId ?? loadDefaultProjectId() ?? undefined;
  if (!admin.apps.length) {
    if (creds) {
      admin.initializeApp({
        credential: admin.credential.cert(creds),
        projectId,
      });
    } else {
      admin.initializeApp({ projectId });
    }
  }
  return admin.firestore();
}

async function fetchAllTaskReminders(db) {
  const remindersRef = db.collection('taskReminders');
  const snapshots = [];
  let query = remindersRef.orderBy(admin.firestore.FieldPath.documentId()).limit(500);

  while (true) {
    const snap = await query.get();
    if (snap.empty) break;
    snapshots.push(...snap.docs);
    const last = snap.docs[snap.docs.length - 1];
    query = remindersRef
      .orderBy(admin.firestore.FieldPath.documentId())
      .startAfter(last.id)
      .limit(500);
  }

  return snapshots;
}

async function collectLegacyReminders(db) {
  const reminderDocs = await fetchAllTaskReminders(db);
  const taskIds = [...new Set(reminderDocs.map((doc) => doc.get('taskId')).filter((value) => typeof value === 'string' && value))];
  const taskRefs = taskIds.map((taskId) => db.collection('tasks').doc(taskId));
  const taskSnapshots = [];

  for (const taskRefChunk of chunk(taskRefs, 200)) {
    const docs = await db.getAll(...taskRefChunk);
    taskSnapshots.push(...docs);
  }

  const taskMap = new Map(taskSnapshots.map((doc) => [doc.id, doc]));
  const matches = [];
  let missingTaskReminderCount = 0;

  for (const reminderDoc of reminderDocs) {
    const taskId = reminderDoc.get('taskId');
    if (typeof taskId !== 'string' || !taskId) continue;

    const taskDoc = taskMap.get(taskId);
    if (!taskDoc || !taskDoc.exists) {
      missingTaskReminderCount += 1;
      continue;
    }

    const classification = classifyTask(taskDoc.data());
    if (!classification.unsupported) continue;

    matches.push({
      reminderId: reminderDoc.id,
      taskId,
      title: typeof taskDoc.get('title') === 'string' ? taskDoc.get('title') : null,
      userId: typeof reminderDoc.get('userId') === 'string' ? reminderDoc.get('userId') : null,
      reminderTime: typeof reminderDoc.get('reminderTime') === 'string' ? reminderDoc.get('reminderTime') : null,
      allDay: classification.allDay,
      recurring: classification.recurring,
      recurrenceFreq: classification.recurrenceFreq,
      ref: reminderDoc.ref,
    });
  }

  const summary = {
    scannedReminders: reminderDocs.length,
    scannedTasks: taskIds.length,
    unsupportedReminderCount: matches.length,
    allDayOnlyCount: matches.filter((item) => item.allDay && !item.recurring).length,
    recurringOnlyCount: matches.filter((item) => !item.allDay && item.recurring).length,
    allDayAndRecurringCount: matches.filter((item) => item.allDay && item.recurring).length,
    missingTaskReminderCount,
  };

  return { matches, summary };
}

async function deleteLegacyReminders(matches) {
  let deleted = 0;
  for (const batchChunk of chunk(matches, 450)) {
    const batch = admin.firestore().batch();
    batchChunk.forEach((item) => {
      batch.delete(item.ref);
    });
    await batch.commit();
    deleted += batchChunk.length;
  }
  return deleted;
}

async function main() {
  const apply = readFlag('apply');
  const db = await initAdmin();
  const { matches, summary } = await collectLegacyReminders(db);

  const payload = {
    mode: apply ? 'apply' : 'dry-run',
    summary,
    sample: matches.slice(0, 20).map(({ ref, ...rest }) => rest),
  };

  if (!apply) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const deletedCount = await deleteLegacyReminders(matches);
  const post = await collectLegacyReminders(db);

  console.log(
    JSON.stringify(
      {
        ...payload,
        deletedCount,
        after: post.summary,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
