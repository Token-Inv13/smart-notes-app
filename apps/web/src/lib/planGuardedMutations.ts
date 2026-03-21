import { FirebaseError } from "firebase/app";
import { Timestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { functions as fbFunctions } from "@/lib/firebase";
import type { Priority, TaskCalendarKind, TaskRecurrenceRule, TodoDoc, TodoItemDoc } from "@/types/firestore";

export const FREE_NOTE_LIMIT_MESSAGE =
  "Limite Free atteinte. Tu peux passer en Pro pour créer plus de notes et utiliser les favoris sans limite.";

export const FREE_TASK_LIMIT_MESSAGE =
  "Limite Free atteinte. Passe en Pro pour créer plus d’éléments d’agenda et utiliser les favoris sans limite.";

type NoteCreateCallableInput = {
  title: string;
  content: string;
  workspaceId: string | null;
  favorite: boolean;
};

type NoteCreateCallableOutput = {
  noteId: string;
  favoriteApplied: boolean;
};

type TaskCreateCallableInput = {
  title: string;
  description?: string | null;
  status: "todo" | "doing" | "done";
  workspaceId: string | null;
  allDay: boolean;
  startDateMs: number | null;
  dueDateMs: number | null;
  priority: Priority | null;
  calendarKind: TaskCalendarKind | null;
  recurrence:
    | {
        freq: TaskRecurrenceRule["freq"];
        interval: number;
        untilMs: number | null;
        exceptions: string[];
      }
    | null;
  favorite: boolean;
  archived: boolean;
  sourceType?: "checklist_item" | null;
  sourceTodoId?: string | null;
  sourceTodoItemId?: string | null;
};

type TaskCreateCallableOutput = {
  taskId: string;
  favoriteApplied: boolean;
};

type SetFavoriteCallableOutput = {
  favorite: boolean;
};

export type ChecklistItemScheduleData = {
  date: string;
  time?: string;
  allDay: boolean;
  timezone: "Europe/Paris";
};

type ChecklistScheduleCallableInput = {
  todoId: string;
  itemId: string;
  schedule: ChecklistItemScheduleData;
};

type ChecklistScheduleCallableOutput = {
  agendaPlan: {
    taskId: string;
    allDay: boolean;
    startDateMs: number | null;
    dueDateMs: number | null;
  };
};

type TodoCreateWithSchedulesCallableInput = {
  workspaceId: string | null;
  title: string;
  dueDateMs: number | null;
  priority: TodoDoc["priority"] | null;
  favorite: boolean;
  items: Array<{
    id: string;
    text: string;
    done: boolean;
    createdAt?: number;
    draftSchedule?: ChecklistItemScheduleData | null;
  }>;
};

type TodoCreateWithSchedulesCallableOutput = {
  todoId: string;
};

function callableCode(error: unknown): string {
  if (error instanceof FirebaseError) return String(error.code || "").toLowerCase();
  const maybeCode = (error as { code?: unknown } | null | undefined)?.code;
  return typeof maybeCode === "string" ? maybeCode.toLowerCase() : "";
}

function callableMessage(error: unknown): string {
  return error instanceof Error ? error.message.trim() : "";
}

export function getPlanLimitMessage(error: unknown): string | null {
  const code = callableCode(error);
  if (!code.includes("resource-exhausted") && !code.includes("failed-precondition")) {
    return null;
  }

  const message = callableMessage(error);
  return message || "Limite Free atteinte.";
}

export async function createNoteWithPlanGuard(input: NoteCreateCallableInput): Promise<NoteCreateCallableOutput> {
  const fn = httpsCallable<NoteCreateCallableInput, NoteCreateCallableOutput>(fbFunctions, "createNoteWithPlanGuard");
  const result = await fn(input);
  return result.data;
}

export async function createTaskWithPlanGuard(input: TaskCreateCallableInput): Promise<TaskCreateCallableOutput> {
  const fn = httpsCallable<TaskCreateCallableInput, TaskCreateCallableOutput>(fbFunctions, "createTaskWithPlanGuard");
  const result = await fn(input);
  return result.data;
}

export async function setNoteFavoriteWithPlanGuard(noteId: string, favorite: boolean): Promise<SetFavoriteCallableOutput> {
  const fn = httpsCallable<{ noteId: string; favorite: boolean }, SetFavoriteCallableOutput>(
    fbFunctions,
    "setNoteFavoriteWithPlanGuard",
  );
  const result = await fn({ noteId, favorite });
  return result.data;
}

export async function setTaskFavoriteWithPlanGuard(taskId: string, favorite: boolean): Promise<SetFavoriteCallableOutput> {
  const fn = httpsCallable<{ taskId: string; favorite: boolean }, SetFavoriteCallableOutput>(
    fbFunctions,
    "setTaskFavoriteWithPlanGuard",
  );
  const result = await fn({ taskId, favorite });
  return result.data;
}

export async function scheduleChecklistItemWithPlanGuard(
  input: ChecklistScheduleCallableInput,
): Promise<ChecklistScheduleCallableOutput["agendaPlan"]> {
  const fn = httpsCallable<ChecklistScheduleCallableInput, ChecklistScheduleCallableOutput>(
    fbFunctions,
    "scheduleChecklistItemWithPlanGuard",
  );
  const result = await fn(input);
  return result.data.agendaPlan;
}

export async function createTodoWithScheduledItemsPlanGuard(
  input: TodoCreateWithSchedulesCallableInput,
): Promise<TodoCreateWithSchedulesCallableOutput> {
  const fn = httpsCallable<TodoCreateWithSchedulesCallableInput, TodoCreateWithSchedulesCallableOutput>(
    fbFunctions,
    "createTodoWithScheduledItemsPlanGuard",
  );
  const result = await fn(input);
  return result.data;
}

export function serializeTaskRecurrence(
  recurrence: TaskRecurrenceRule | null | undefined,
): TaskCreateCallableInput["recurrence"] {
  if (!recurrence?.freq) return null;
  return {
    freq: recurrence.freq,
    interval: recurrence.interval ?? 1,
    untilMs: recurrence.until?.toMillis?.() ?? null,
    exceptions: Array.isArray(recurrence.exceptions) ? recurrence.exceptions : [],
  };
}

export function serializeTimestampMillis(
  value: { toMillis?: () => number } | Date | null | undefined,
): number | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.getTime() : null;
  }
  if (typeof value.toMillis === "function") {
    try {
      return value.toMillis();
    } catch {
      return null;
    }
  }
  return null;
}

export function hydrateChecklistAgendaPlan(
  agendaPlan: ChecklistScheduleCallableOutput["agendaPlan"],
): NonNullable<TodoItemDoc["agendaPlan"]> {
  return {
    taskId: agendaPlan.taskId,
    allDay: agendaPlan.allDay,
    startDate: agendaPlan.startDateMs == null ? null : Timestamp.fromMillis(agendaPlan.startDateMs),
    dueDate: agendaPlan.dueDateMs == null ? null : Timestamp.fromMillis(agendaPlan.dueDateMs),
  };
}
