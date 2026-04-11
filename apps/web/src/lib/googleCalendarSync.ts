import { getUserTimezone } from "@/lib/datetime";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export const GOOGLE_SYNC_FAILED_MESSAGE =
  "Élément enregistré dans TaskNote, mais non synchronisé avec Google Calendar.";
export const GOOGLE_SYNC_INCOMPLETE_WINDOW_MESSAGE =
  "Élément enregistré dans TaskNote, mais non synchronisé avec Google Calendar faute de plage horaire complète.";
export const GOOGLE_SYNC_DETACHED_MESSAGE =
  "Lien Google Calendar retiré, car cet élément n’a plus de plage horaire synchronisable.";
export const GOOGLE_SYNC_DELETE_BLOCKED_MESSAGE =
  "Suppression annulée: Google Calendar n’a pas confirmé la suppression de l’événement lié.";

export type GoogleCalendarSyncResponse = {
  ok: boolean;
  status: number;
  code: string;
  message: string;
  eventId?: string | null;
  created?: boolean;
  updated?: boolean;
  deleted?: boolean;
  alreadyLinked?: boolean;
  reconciled?: boolean;
  recreated?: boolean;
  alreadyMissing?: boolean;
};

const inFlightOperations = new Map<string, Promise<GoogleCalendarSyncResponse>>();

type BaseGoogleCalendarSyncPayload = {
  taskId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  timeZone?: string;
};

type CreatePayload = BaseGoogleCalendarSyncPayload;

type UpdatePayload = BaseGoogleCalendarSyncPayload & {
  googleEventId?: string | null;
};

type DeletePayload = {
  taskId: string;
  googleEventId?: string | null;
};

function toLocalDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildGoogleCalendarSyncPayload(input: {
  taskId: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  googleEventId?: string | null;
}): CreatePayload | UpdatePayload {
  const base = input.allDay
    ? {
        taskId: input.taskId,
        title: input.title,
        start: toLocalDateInputValue(input.start),
        end: toLocalDateInputValue(input.end),
        allDay: true,
      }
    : {
        taskId: input.taskId,
        title: input.title,
        start: input.start.toISOString(),
        end: input.end.toISOString(),
        allDay: false,
        timeZone: getUserTimezone(),
      };

  if (typeof input.googleEventId === "string" && input.googleEventId.trim()) {
    return {
      ...base,
      googleEventId: input.googleEventId.trim(),
    };
  }

  return base;
}

async function parseSyncResponse(response: Response): Promise<GoogleCalendarSyncResponse> {
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const message =
    typeof payload?.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : response.ok
        ? "Synchronisation Google Calendar terminée."
        : GOOGLE_SYNC_FAILED_MESSAGE;

  return {
    ok: response.ok,
    status: response.status,
    code: typeof payload?.code === "string" ? payload.code : response.ok ? "ok" : "google_sync_failed",
    message,
    eventId: typeof payload?.eventId === "string" ? payload.eventId : null,
    created: payload?.created === true,
    updated: payload?.updated === true,
    deleted: payload?.deleted === true,
    alreadyLinked: payload?.alreadyLinked === true,
    reconciled: payload?.reconciled === true,
    recreated: payload?.recreated === true,
    alreadyMissing: payload?.alreadyMissing === true,
  };
}

async function runSyncRequest(input: {
  taskId: string;
  method: "POST" | "PATCH" | "DELETE";
  payload: CreatePayload | UpdatePayload | DeletePayload;
}) {
  const operationKey = `${input.method}:${input.taskId}`;
  const existing = inFlightOperations.get(operationKey);
  if (existing) return existing;

  const requestPromise = (async () => {
    const response = await fetch("/api/google/calendar/events", {
      method: input.method,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input.payload),
    });

    return parseSyncResponse(response);
  })();

  inFlightOperations.set(operationKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    inFlightOperations.delete(operationKey);
  }
}

export async function mirrorGoogleSyncStateOnTask(input: {
  taskId: string;
  eventId?: string | null;
  status: "pending" | "synced" | "error" | "missing_remote";
  error?: string | null;
}) {
  await updateDoc(doc(db, "tasks", input.taskId), {
    googleEventId: input.eventId ?? null,
    googleSyncStatus: input.status,
    googleSyncError: input.error ?? null,
    googleSyncUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function createGoogleCalendarEvent(payload: CreatePayload) {
  return runSyncRequest({
    taskId: payload.taskId,
    method: "POST",
    payload,
  });
}

export async function updateGoogleCalendarEvent(payload: UpdatePayload) {
  return runSyncRequest({
    taskId: payload.taskId,
    method: "PATCH",
    payload,
  });
}

export async function deleteGoogleCalendarEvent(payload: DeletePayload) {
  return runSyncRequest({
    taskId: payload.taskId,
    method: "DELETE",
    payload,
  });
}
