import admin from "firebase-admin";

const projectId = process.env.FIREBASE_PROJECT_ID || "noandta-28cc8";
const userId = process.env.TEST_USER_ID || "test-user";

function assertFiniteDate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${String(d)}`);
  }
}

function isMidnightLocal(d) {
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0;
}

function isMultipleOfDaysMs(ms) {
  const dayMs = 24 * 60 * 60 * 1000;
  return ms > 0 && ms % dayMs === 0;
}

function taskToAgendaEventWindow(task) {
  const startRaw = task.startDate?.toDate?.() ?? null;
  const dueRaw = task.dueDate?.toDate?.() ?? null;

  const start = startRaw ?? dueRaw;
  if (!start) return { start: null, end: null, allDay: false };

  const fallbackTimedEnd = new Date(start.getTime() + 60 * 60 * 1000);
  const fallbackAllDayEnd = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  const end = dueRaw && dueRaw.getTime() > start.getTime() ? dueRaw : fallbackTimedEnd;

  const inferredAllDay = (() => {
    if (!startRaw || !dueRaw) return false;
    if (!isMidnightLocal(startRaw) || !isMidnightLocal(dueRaw)) return false;
    return isMultipleOfDaysMs(dueRaw.getTime() - startRaw.getTime());
  })();

  const finalEnd = inferredAllDay ? (dueRaw && dueRaw.getTime() > start.getTime() ? dueRaw : fallbackAllDayEnd) : end;

  return { start, end: finalEnd, allDay: inferredAllDay };
}

function mapChecklistDueDateToAgendaWindow(dueDateTs) {
  const now = new Date();

  if (!dueDateTs?.toDate) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1, 0, 0, 0, 0);
    return { start, end, allDay: true };
  }

  const base = dueDateTs.toDate();
  const hasExplicitTime =
    base.getHours() !== 0 ||
    base.getMinutes() !== 0 ||
    base.getSeconds() !== 0 ||
    base.getMilliseconds() !== 0;

  if (hasExplicitTime) {
    const start = new Date(base.getTime());
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return { start, end, allDay: false };
  }

  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1, 0, 0, 0, 0);
  return { start, end, allDay: true };
}

function fmt(ts) {
  if (!ts?.toDate) return "<null>";
  const d = ts.toDate();
  return `${d.toISOString()} (local ${d.toLocaleString("fr-FR")})`;
}

function fmtDate(d) {
  if (!d) return "<null>";
  return `${d.toISOString()} (local ${d.toLocaleString("fr-FR")})`;
}

async function main() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      "FIRESTORE_EMULATOR_HOST is not set. Start firebase emulators and set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080",
    );
  }

  if (admin.apps.length === 0) {
    admin.initializeApp({ projectId });
  }

  const db = admin.firestore();

  const day = new Date(2026, 1, 21, 0, 0, 0, 0);
  const endOfMonthDay = new Date(2026, 1, 28, 0, 0, 0, 0);
  const timed2330 = new Date(2026, 1, 21, 23, 30, 0, 0);
  assertFiniteDate(day);
  assertFiniteDate(endOfMonthDay);
  assertFiniteDate(timed2330);

  const todoRef = db.collection("todos").doc();
  const todoDueTs = admin.firestore.Timestamp.fromDate(day);
  await todoRef.set({
    userId,
    title: "Todo 21/02",
    dueDate: todoDueTs,
    priority: null,
    completed: false,
    favorite: false,
    items: [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const taskCRef = db.collection("tasks").doc();
  await taskCRef.set({
    userId,
    workspaceId: null,
    title: "C - End-of-month all-day",
    description: "",
    status: "todo",
    startDate: admin.firestore.Timestamp.fromDate(endOfMonthDay),
    dueDate: admin.firestore.Timestamp.fromDate(new Date(2026, 2, 1, 0, 0, 0, 0)),
    priority: null,
    recurrence: null,
    favorite: false,
    archived: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const agendaWindowA = mapChecklistDueDateToAgendaWindow(todoDueTs);
  const taskARef = db.collection("tasks").doc();
  await taskARef.set({
    userId,
    workspaceId: null,
    title: "A - Checklist→Agenda",
    description: "",
    status: "todo",
    startDate: admin.firestore.Timestamp.fromDate(agendaWindowA.start),
    dueDate: admin.firestore.Timestamp.fromDate(agendaWindowA.end),
    priority: null,
    recurrence: null,
    favorite: false,
    archived: false,
    sourceTodoId: todoRef.id,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await todoRef.update({ agendaTaskId: taskARef.id, updatedAt: admin.firestore.FieldValue.serverTimestamp() });

  const taskBRef = db.collection("tasks").doc();
  await taskBRef.set({
    userId,
    workspaceId: null,
    title: "B - Agenda all-day",
    description: "",
    status: "todo",
    startDate: admin.firestore.Timestamp.fromDate(day),
    dueDate: admin.firestore.Timestamp.fromDate(new Date(2026, 1, 22, 0, 0, 0, 0)),
    priority: null,
    recurrence: null,
    favorite: false,
    archived: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const taskDRef = db.collection("tasks").doc();
  await taskDRef.set({
    userId,
    workspaceId: null,
    title: "D - Timed 23:30",
    description: "",
    status: "todo",
    startDate: admin.firestore.Timestamp.fromDate(timed2330),
    dueDate: admin.firestore.Timestamp.fromDate(new Date(timed2330.getTime() + 60 * 60 * 1000)),
    priority: null,
    recurrence: null,
    favorite: false,
    archived: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const [todoSnap, taskASnap, taskBSnap, taskCSnap, taskDSnap] = await Promise.all([
    todoRef.get(),
    taskARef.get(),
    taskBRef.get(),
    taskCRef.get(),
    taskDRef.get(),
  ]);

  const todo = todoSnap.data();
  const taskA = taskASnap.data();
  const taskB = taskBSnap.data();
  const taskC = taskCSnap.data();
  const taskD = taskDSnap.data();

  const winA = taskToAgendaEventWindow(taskA);
  const winB = taskToAgendaEventWindow(taskB);
  const winC = taskToAgendaEventWindow(taskC);
  const winD = taskToAgendaEventWindow(taskD);

  const table = [
    {
      cas: "A (Checklist→Agenda, all-day)",
      ui: "21/02",
      firestore: {
        todo_dueDate: fmt(todo?.dueDate),
        task_startDate: fmt(taskA?.startDate),
        task_dueDate: fmt(taskA?.dueDate),
      },
      derived: {
        start: fmtDate(winA.start),
        end: fmtDate(winA.end),
        allDay: String(winA.allDay),
      },
    },
    {
      cas: "B (Agenda create all-day)",
      ui: "21/02",
      firestore: {
        task_startDate: fmt(taskB?.startDate),
        task_dueDate: fmt(taskB?.dueDate),
      },
      derived: {
        start: fmtDate(winB.start),
        end: fmtDate(winB.end),
        allDay: String(winB.allDay),
      },
    },
    {
      cas: "C (All-day end-of-month)",
      ui: "28/02",
      firestore: {
        task_startDate: fmt(taskC?.startDate),
        task_dueDate: fmt(taskC?.dueDate),
      },
      derived: {
        start: fmtDate(winC.start),
        end: fmtDate(winC.end),
        allDay: String(winC.allDay),
      },
    },
    {
      cas: "D (Agenda timed 23:30)",
      ui: "21/02 23:30",
      firestore: {
        task_startDate: fmt(taskD?.startDate),
        task_dueDate: fmt(taskD?.dueDate),
      },
      derived: {
        start: fmtDate(winD.start),
        end: fmtDate(winD.end),
        allDay: String(winD.allDay),
      },
    },
  ];

  process.stdout.write(`\nTZ=${process.env.TZ || "<unset>"}\n`);
  process.stdout.write(`Firestore emulator host=${process.env.FIRESTORE_EMULATOR_HOST}\n`);
  process.stdout.write(`\n--- A/B/D repro table (Firestore + derived window) ---\n`);
  for (const row of table) {
    process.stdout.write(`\n${row.cas}\n`);
    process.stdout.write(`- UI: ${row.ui}\n`);
    process.stdout.write(`- Firestore:\n`);
    for (const [k, v] of Object.entries(row.firestore)) {
      process.stdout.write(`  - ${k}: ${v}\n`);
    }
    process.stdout.write(`- Derived (taskToAgendaEventWindow):\n`);
    for (const [k, v] of Object.entries(row.derived)) {
      process.stdout.write(`  - ${k}: ${v}\n`);
    }
  }

  process.stdout.write("\nDocs created:\n");
  process.stdout.write(`- todoId=${todoRef.id}\n`);
  process.stdout.write(`- taskAId=${taskARef.id}\n`);
  process.stdout.write(`- taskBId=${taskBRef.id}\n`);
  process.stdout.write(`- taskCId=${taskCRef.id}\n`);
  process.stdout.write(`- taskDId=${taskDRef.id}\n`);
}

main().catch((e) => {
  process.stderr.write(`${e?.stack || e}\n`);
  process.exit(1);
});
