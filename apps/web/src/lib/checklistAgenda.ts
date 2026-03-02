import {
  collection,
  doc,
  setDoc,
  serverTimestamp,
  type Firestore,
  type Timestamp,
  type WriteBatch,
} from "firebase/firestore";
import { normalizeAgendaWindowForFirestore, parseLocalDateToTimestamp } from "@/lib/datetime";
import type { TaskDoc, TodoDoc } from "@/types/firestore";

export type ChecklistItemScheduleData = {
  date: string;
  time?: string;
  allDay: boolean;
  timezone: "Europe/Paris";
};

export type ChecklistAgendaPlan = {
  taskId: string;
  allDay: boolean;
  startDate: Timestamp | null;
  dueDate: Timestamp | null;
};

type ScheduleChecklistItemInput = {
  db: Firestore;
  userId: string;
  todoId: string;
  todoTitle: string;
  workspaceId?: string | null;
  priority?: TodoDoc["priority"] | null;
  item: { id: string; text: string; done: boolean };
  schedule: ChecklistItemScheduleData;
  batch?: WriteBatch;
};

function parseDateAndTime(dateRaw: string, timeRaw: string): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateRaw);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeRaw);
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
  if (parsed.getHours() !== hour || parsed.getMinutes() !== minute) return null;
  return parsed;
}

export async function scheduleChecklistItem(input: ScheduleChecklistItemInput): Promise<ChecklistAgendaPlan> {
  const { db, userId, todoId, todoTitle, workspaceId, priority, item, schedule, batch } = input;

  // Manual test hook for PR-UX-1c: force a scheduling error before commit.
  if (process.env.NODE_ENV !== "production" && item.text.includes("[SIMULATE_SCHEDULING_ERROR]")) {
    throw new Error("Erreur de planification simulee.");
  }

  if (schedule.timezone !== "Europe/Paris") {
    throw new Error("Fuseau horaire non supporte.");
  }

  const dayTs = parseLocalDateToTimestamp(schedule.date);
  const day = dayTs?.toDate?.() ?? null;
  if (!day) {
    throw new Error("Date invalide.");
  }

  let start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
  let end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1, 0, 0, 0, 0);
  if (!schedule.allDay) {
    const timedStart = parseDateAndTime(schedule.date, schedule.time ?? "09:00");
    if (!timedStart) {
      throw new Error("Heure invalide.");
    }
    start = timedStart;
    end = new Date(timedStart.getTime() + 60 * 60 * 1000);
  }

  const normalizedWindow = normalizeAgendaWindowForFirestore({
    start,
    end,
    allDay: schedule.allDay,
  });
  if (!normalizedWindow?.startDate || !normalizedWindow?.dueDate) {
    throw new Error("Date invalide.");
  }

  const taskRef = doc(collection(db, "tasks"));
  const payload: Omit<TaskDoc, "id"> = {
    userId,
    workspaceId: typeof workspaceId === "string" ? workspaceId : null,
    title: item.text.trim() || "Checklist item",
    description: `Checklist: ${todoTitle}`,
    status: item.done ? "done" : "todo",
    allDay: normalizedWindow.allDay,
    startDate: normalizedWindow.startDate,
    dueDate: normalizedWindow.dueDate,
    priority: priority ?? null,
    recurrence: null,
    favorite: false,
    archived: false,
    sourceType: "checklist_item",
    sourceTodoId: todoId,
    sourceTodoItemId: item.id,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (batch) {
    batch.set(taskRef, payload);
  } else {
    await setDoc(taskRef, payload);
  }

  return {
    taskId: taskRef.id,
    allDay: normalizedWindow.allDay,
    startDate: normalizedWindow.startDate,
    dueDate: normalizedWindow.dueDate,
  };
}
