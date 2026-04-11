import { NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { decryptGoogleToken, encryptGoogleToken, hasGoogleTokenEncryptionKey } from "@/lib/googleCalendarCrypto";
import { getAdminDb, verifySessionCookie } from "@/lib/firebaseAdmin";
import { beginApiObserve, observedError, observedJson } from "@/lib/apiObservability";

type IntegrationDoc = {
  connected?: boolean;
  primaryCalendarId?: string;
  tokenStorageMode?: "encrypted";
  accessTokenEncrypted?: string;
  refreshTokenEncrypted?: string;
  accessTokenExpiresAtMs?: number;
};

type GoogleEventItem = {
  id?: string;
  status?: string;
  summary?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  extendedProperties?: {
    private?: Record<string, string | undefined>;
  };
};

type GoogleEventsResponse = {
  items?: GoogleEventItem[];
};

type GoogleCreateEventInput = {
  taskId?: unknown;
  title?: unknown;
  start?: unknown;
  end?: unknown;
  allDay?: unknown;
  timeZone?: unknown;
};

type GoogleUpdateEventInput = GoogleCreateEventInput & {
  googleEventId?: unknown;
};

type GoogleDeleteEventInput = {
  taskId?: unknown;
  googleEventId?: unknown;
};

type TokenRefreshResponse = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
};

type TokenRefreshResult =
  | { ok: true; accessToken: string }
  | { ok: false; code: "service_unavailable" | "token_missing" | "token_invalid"; message: string };

type OwnedTaskRecord = {
  ref: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>;
  data: Record<string, unknown>;
};

function taskSyncSuccessPayload(input: {
  eventId?: string | null;
  googleSyncStatus?: "synced" | "pending" | "error" | "missing_remote" | null;
  googleSyncError?: string | null;
}) {
  return {
    ...(input.eventId !== undefined ? { googleEventId: input.eventId } : {}),
    googleSyncStatus: input.googleSyncStatus ?? null,
    googleSyncError: input.googleSyncError ?? null,
    googleSyncUpdatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function sanitizeTaskId(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function resolveStoredToken(encryptedValue: string | undefined): string | null {
  if (typeof encryptedValue === "string" && encryptedValue.length > 0) {
    return decryptGoogleToken(encryptedValue);
  }
  return null;
}

function sanitizeIso(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function sanitizeDateOnly(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function sanitizeOptionalTimeZone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function buildGoogleEventPayload(input: {
  taskId?: string | null;
  title: string;
  start: unknown;
  end: unknown;
  allDay: boolean;
  timeZone: string | null;
}) {
  const { taskId, title, start, end, allDay, timeZone } = input;
  const extendedProperties = taskId
    ? {
        extendedProperties: {
          private: {
            taskId,
          },
        },
      }
    : {};

  if (allDay) {
    const startDate = sanitizeDateOnly(start);
    const endDate = sanitizeDateOnly(end);
    if (!startDate || !endDate) return null;
    return {
      summary: title,
      start: { date: startDate },
      end: { date: endDate },
      ...extendedProperties,
    };
  }

  const startDateTime = sanitizeIso(typeof start === "string" ? start : null);
  const endDateTime = sanitizeIso(typeof end === "string" ? end : null);
  if (!startDateTime || !endDateTime) return null;

  return {
    summary: title,
    start: timeZone ? { dateTime: startDateTime, timeZone } : { dateTime: startDateTime },
    end: timeZone ? { dateTime: endDateTime, timeZone } : { dateTime: endDateTime },
    ...extendedProperties,
  };
}

async function refreshAccessTokenIfNeeded(input: {
  integration: IntegrationDoc;
  userId: string;
}): Promise<TokenRefreshResult> {
  const { integration, userId } = input;

  if (!hasGoogleTokenEncryptionKey()) {
    console.error("google.calendar.events.service_unavailable", {
      reason: "missing_token_encryption_key",
      uid: userId,
    });
    return {
      ok: false,
      code: "service_unavailable",
      message: "Configuration du service indisponible.",
    };
  }

  const nowMs = Date.now();

  const currentAccessToken = resolveStoredToken(integration.accessTokenEncrypted);
  const currentRefreshToken = resolveStoredToken(integration.refreshTokenEncrypted);
  const expiresAtMs = typeof integration.accessTokenExpiresAtMs === "number" ? integration.accessTokenExpiresAtMs : null;

  const stillValid = typeof expiresAtMs === "number" && expiresAtMs > nowMs + 30_000;
  if (currentAccessToken && stillValid) {
    return { ok: true, accessToken: currentAccessToken };
  }

  if (!currentRefreshToken) {
    if (currentAccessToken) {
      return {
        ok: false,
        code: "token_invalid",
        message: "Le jeton Google Calendar a expiré et ne peut pas être renouvelé.",
      };
    }
    return {
      ok: false,
      code: "token_missing",
      message: "Aucun jeton Google Calendar disponible.",
    };
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    console.error("google.calendar.events.service_unavailable", {
      reason: "missing_google_client_id",
      uid: userId,
    });
    return {
      ok: false,
      code: "service_unavailable",
      message: "Configuration Google Calendar indisponible.",
    };
  }

  const refreshPayload = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: currentRefreshToken,
  });
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (clientSecret) {
    refreshPayload.set("client_secret", clientSecret);
  }

  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: refreshPayload.toString(),
    cache: "no-store",
  });

  if (!refreshRes.ok) {
    const invalidGrant = refreshRes.status === 400 || refreshRes.status === 401;
    return {
      ok: false,
      code: invalidGrant ? "token_invalid" : "service_unavailable",
      message: invalidGrant
        ? "Le compte Google Calendar doit être reconnecté."
        : "Le renouvellement du jeton Google Calendar a échoué.",
    };
  }

  const refreshJson = (await refreshRes.json()) as TokenRefreshResponse;
  if (refreshJson.error === "invalid_grant") {
    return {
      ok: false,
      code: "token_invalid",
      message: "Le compte Google Calendar doit être reconnecté.",
    };
  }
  const refreshedAccessToken = typeof refreshJson.access_token === "string" ? refreshJson.access_token : null;
  if (!refreshedAccessToken) {
    return {
      ok: false,
      code: "service_unavailable",
      message: "Impossible de récupérer un jeton Google Calendar valide.",
    };
  }

  const expiresIn = typeof refreshJson.expires_in === "number" ? refreshJson.expires_in : 3600;
  const updatedExpiresAtMs = Date.now() + Math.max(60, expiresIn) * 1000;

  const db = getAdminDb();
  const ref = db.collection("users").doc(userId).collection("assistantIntegrations").doc("googleCalendar");

  const encryptedAccessToken = encryptGoogleToken(refreshedAccessToken);
  const encryptedRefreshToken = encryptGoogleToken(currentRefreshToken);
  if (!encryptedAccessToken) {
    console.error("google.calendar.events.service_unavailable", {
      reason: "token_encryption_failed",
      uid: userId,
    });
    return {
      ok: false,
      code: "service_unavailable",
      message: "Le chiffrement des jetons Google Calendar a échoué.",
    };
  }

  const tokenPayload = {
    tokenStorageMode: "encrypted",
    accessTokenEncrypted: encryptedAccessToken,
    ...(encryptedRefreshToken ? { refreshTokenEncrypted: encryptedRefreshToken } : {}),
    accessToken: FieldValue.delete(),
    refreshToken: FieldValue.delete(),
  };

  await ref.set(
    {
      ...tokenPayload,
      accessTokenExpiresAtMs: updatedExpiresAtMs,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { ok: true, accessToken: refreshedAccessToken };
}

async function getAuthenticatedIntegration(request: NextRequest, requestId: string, eventName: string) {
  const obs = beginApiObserve({
    eventName,
    route: "/api/google/calendar/events",
    requestId,
    uid: "anonymous",
  });

  if (!hasGoogleTokenEncryptionKey()) {
    console.error("google.calendar.events.service_unavailable", {
      reason: "missing_token_encryption_key",
      requestId,
    });
    return {
      kind: "response" as const,
      response: observedJson(obs, { error: "Configuration du service indisponible." }, { status: 503 }),
    };
  }

  const sessionCookie = request.cookies.get("session")?.value;
  if (!sessionCookie) {
    return {
      kind: "response" as const,
      response: observedJson(obs, { error: "Not authenticated" }, { status: 401 }),
    };
  }

  const decoded = await verifySessionCookie(sessionCookie);
  if (!decoded?.uid) {
    return {
      kind: "response" as const,
      response: observedJson(obs, { error: "Not authenticated" }, { status: 401 }),
    };
  }

  const obsUser = beginApiObserve({
    eventName,
    route: "/api/google/calendar/events",
    requestId,
    uid: decoded.uid,
  });

  const db = getAdminDb();
  const ref = db.collection("users").doc(decoded.uid).collection("assistantIntegrations").doc("googleCalendar");
  const snap = await ref.get();

  return {
    kind: "ok" as const,
    uid: decoded.uid,
    ref,
    snap,
    obs: obsUser,
  };
}

async function getOwnedTaskRecord(userId: string, taskId: string): Promise<OwnedTaskRecord | null> {
  const db = getAdminDb();
  const ref = db.collection("tasks").doc(taskId);
  const snap = await ref.get();
  if (!snap.exists) return null;

  const data = snap.data();
  if (!data || data.userId !== userId) return null;

  return { ref, data };
}

async function setTaskGoogleSyncState(
  taskRecord: OwnedTaskRecord | null,
  input: {
    eventId?: string | null;
    googleSyncStatus?: "pending" | "synced" | "error" | "missing_remote" | null;
    googleSyncError?: string | null;
  },
) {
  if (!taskRecord) return;
  await taskRecord.ref.set(taskSyncSuccessPayload(input), { merge: true });
}

async function findExistingGoogleEventByTaskId(input: {
  accessToken: string;
  calendarId: string;
  taskId: string;
}) {
  const params = new URLSearchParams({
    privateExtendedProperty: `taskId=${input.taskId}`,
    showDeleted: "true",
    singleEvents: "false",
    maxResults: "10",
  });

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
      },
      cache: "no-store",
    },
  );

  if (!response.ok) return null;

  const payload = (await response.json()) as GoogleEventsResponse;
  const items = Array.isArray(payload.items) ? payload.items : [];
  return items.find((item) => item.id && item.status !== "cancelled") ?? null;
}

async function createGoogleEventForTask(input: {
  accessToken: string;
  calendarId: string;
  taskId: string;
  title: string;
  start: unknown;
  end: unknown;
  allDay: boolean;
  timeZone: string | null;
}) {
  const googlePayload = buildGoogleEventPayload({
    taskId: input.taskId,
    title: input.title,
    start: input.start,
    end: input.end,
    allDay: input.allDay,
    timeZone: input.timeZone,
  });

  if (!googlePayload) {
    return {
      ok: false as const,
      code: "invalid_payload",
      message: "Plage horaire Google Calendar invalide.",
      status: 400,
    };
  }

  const createRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(googlePayload),
      cache: "no-store",
    },
  );

  if (!createRes.ok) {
    return {
      ok: false as const,
      code: createRes.status === 401 || createRes.status === 403 ? "token_invalid" : "create_failed",
      message:
        createRes.status === 401 || createRes.status === 403
          ? "Le compte Google Calendar doit être reconnecté."
          : "La création Google Calendar a échoué.",
      status: createRes.status === 401 || createRes.status === 403 ? 401 : 502,
    };
  }

  const createdJson = (await createRes.json()) as { id?: unknown };
  return {
    ok: true as const,
    eventId: typeof createdJson.id === "string" ? createdJson.id : null,
  };
}

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  try {
    const auth = await getAuthenticatedIntegration(request, requestId, "google.calendar.events.get");
    if (auth.kind === "response") return auth.response;

    const { uid, snap, obs: obsUser } = auth;

    const timeMin = sanitizeIso(request.nextUrl.searchParams.get("timeMin"));
    const timeMax = sanitizeIso(request.nextUrl.searchParams.get("timeMax"));
    if (!timeMin || !timeMax) {
      return observedJson(obsUser, { error: "Invalid time range" }, { status: 400 });
    }

    if (!snap.exists) {
      return observedJson(obsUser, { events: [] });
    }

    const integration = snap.data() as IntegrationDoc;
    if (integration.connected !== true) {
      return observedJson(obsUser, { events: [] });
    }

    const accessTokenResult = await refreshAccessTokenIfNeeded({ integration, userId: uid });
    if (!accessTokenResult.ok) {
      return observedJson(
        obsUser,
        { error: accessTokenResult.message, code: accessTokenResult.code },
        { status: accessTokenResult.code === "token_invalid" ? 401 : 503 },
      );
    }
    const accessToken = accessTokenResult.accessToken;

    const calendarId = typeof integration.primaryCalendarId === "string" && integration.primaryCalendarId
      ? integration.primaryCalendarId
      : "primary";

    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
    });

    const eventsRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
      },
    );

    if (!eventsRes.ok) {
      if (eventsRes.status === 429) {
        console.warn("ops.metric.google_quota_error", {
          requestId,
          uid,
          route: "/api/google/calendar/events",
          status: 429,
          count: 1,
        });
      }
      return observedJson(
        obsUser,
        { error: "Google Calendar unavailable" },
        { status: eventsRes.status === 429 ? 429 : 503 },
      );
    }

    const eventsJson = (await eventsRes.json()) as GoogleEventsResponse;
    const events = Array.isArray(eventsJson.items)
      ? eventsJson.items
          .map((item) => {
            const startRaw = item.start?.dateTime ?? item.start?.date;
            const endRaw = item.end?.dateTime ?? item.end?.date;
            if (!startRaw || !endRaw || !item.id) return null;
            const isAllDay = typeof item.start?.date === "string";
            return {
              id: item.id,
              title: typeof item.summary === "string" && item.summary.trim() ? item.summary : "Événement Google",
              start: isAllDay ? startRaw : new Date(startRaw).toISOString(),
              end: isAllDay ? endRaw : new Date(endRaw).toISOString(),
              allDay: isAllDay,
            };
          })
          .filter((item) => Boolean(item))
      : [];

    return observedJson(obsUser, { events });
  } catch (e) {
    const obs = beginApiObserve({
      eventName: "google.calendar.events.get",
      route: "/api/google/calendar/events",
      requestId,
      uid: "anonymous",
    });
    observedError(obs, e);
    console.error("Google Calendar events route failed", e);
    return observedJson(obs, { error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  try {
    const auth = await getAuthenticatedIntegration(request, requestId, "google.calendar.events.create");
    if (auth.kind === "response") return auth.response;

    const { uid, snap, obs: obsUser } = auth;
    const body = (await request.json()) as GoogleCreateEventInput;
    const taskId = sanitizeTaskId(body.taskId);
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const allDay = body.allDay === true;
    const timeZone = sanitizeOptionalTimeZone(body.timeZone);

    if (!taskId) {
      return observedJson(obsUser, { error: "Invalid task id", code: "invalid_task_id" }, { status: 400 });
    }

    const taskRecord = await getOwnedTaskRecord(uid, taskId);
    if (!taskRecord) {
      return observedJson(obsUser, { error: "Task not found", code: "task_not_found" }, { status: 404 });
    }

    if (!snap.exists) {
      await setTaskGoogleSyncState(taskRecord, {
        eventId: null,
        googleSyncStatus: "error",
        googleSyncError: "Google Calendar n’est pas connecté.",
      });
      return observedJson(
        obsUser,
        {
          created: false,
          code: "integration_not_connected",
          message: "Google Calendar n’est pas connecté.",
        },
        { status: 409 },
      );
    }

    const integration = snap.data() as IntegrationDoc;
    if (integration.connected !== true) {
      await setTaskGoogleSyncState(taskRecord, {
        eventId: null,
        googleSyncStatus: "error",
        googleSyncError: "Google Calendar n’est pas connecté.",
      });
      return observedJson(
        obsUser,
        {
          created: false,
          code: "integration_not_connected",
          message: "Google Calendar n’est pas connecté.",
        },
        { status: 409 },
      );
    }

    const accessTokenResult = await refreshAccessTokenIfNeeded({ integration, userId: uid });
    if (!accessTokenResult.ok) {
      await setTaskGoogleSyncState(taskRecord, {
        eventId: taskRecord.data.googleEventId as string | null | undefined,
        googleSyncStatus: "error",
        googleSyncError: accessTokenResult.message,
      });
      return observedJson(
        obsUser,
        {
          created: false,
          code: accessTokenResult.code,
          message: accessTokenResult.message,
        },
        { status: accessTokenResult.code === "token_invalid" ? 401 : 503 },
      );
    }
    const accessToken = accessTokenResult.accessToken;

    if (!title) {
      return observedJson(obsUser, { error: "Invalid title", code: "invalid_title" }, { status: 400 });
    }

    if (typeof taskRecord.data.googleEventId === "string" && taskRecord.data.googleEventId.trim()) {
      await setTaskGoogleSyncState(taskRecord, {
        eventId: taskRecord.data.googleEventId.trim(),
        googleSyncStatus: "synced",
        googleSyncError: null,
      });
      return observedJson(obsUser, {
        created: true,
        alreadyLinked: true,
        eventId: taskRecord.data.googleEventId.trim(),
        code: "already_linked",
        message: "L’événement Google Calendar est déjà lié à cette tâche.",
      });
    }

    const calendarId = typeof integration.primaryCalendarId === "string" && integration.primaryCalendarId
      ? integration.primaryCalendarId
      : "primary";

    const existingEvent = await findExistingGoogleEventByTaskId({
      accessToken,
      calendarId,
      taskId,
    });
    if (existingEvent?.id) {
      await setTaskGoogleSyncState(taskRecord, {
        eventId: existingEvent.id,
        googleSyncStatus: "synced",
        googleSyncError: null,
      });
      return observedJson(obsUser, {
        created: true,
        reconciled: true,
        eventId: existingEvent.id,
        code: "reconciled_existing_event",
        message: "Lien Google Calendar réconcilié avec un événement existant.",
      });
    }

    const created = await createGoogleEventForTask({
      accessToken,
      calendarId,
      taskId,
      title,
      start: body.start,
      end: body.end,
      allDay,
      timeZone,
    });
    if (!created.ok) {
      await setTaskGoogleSyncState(taskRecord, {
        eventId: null,
        googleSyncStatus: "error",
        googleSyncError: created.message,
      });
      console.warn("google.calendar.events.create_failed", {
        requestId,
        uid,
        taskId,
        code: created.code,
      });
      return observedJson(
        obsUser,
        { created: false, code: created.code, message: created.message },
        { status: created.status },
      );
    }

    await setTaskGoogleSyncState(taskRecord, {
      eventId: created.eventId,
      googleSyncStatus: "synced",
      googleSyncError: null,
    });

    return observedJson(obsUser, {
      created: true,
      eventId: created.eventId,
      code: "created",
      message: "Événement Google Calendar créé.",
    });
  } catch (e) {
    const obs = beginApiObserve({
      eventName: "google.calendar.events.create",
      route: "/api/google/calendar/events",
      requestId,
      uid: "anonymous",
    });
    observedError(obs, e);
    console.error("Google Calendar event create failed", e);
    return observedJson(obs, { created: false }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  try {
    const auth = await getAuthenticatedIntegration(request, requestId, "google.calendar.events.update");
    if (auth.kind === "response") return auth.response;

    const { uid, snap, obs: obsUser } = auth;
    const body = (await request.json()) as GoogleUpdateEventInput;
    const taskId = sanitizeTaskId(body.taskId);
    const requestedGoogleEventId = typeof body.googleEventId === "string" ? body.googleEventId.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const allDay = body.allDay === true;
    const timeZone = sanitizeOptionalTimeZone(body.timeZone);

    if (!taskId) {
      return observedJson(obsUser, { error: "Invalid task id", code: "invalid_task_id" }, { status: 400 });
    }

    const taskRecord = await getOwnedTaskRecord(uid, taskId);
    if (!taskRecord) {
      return observedJson(obsUser, { error: "Task not found", code: "task_not_found" }, { status: 404 });
    }

    if (!snap.exists) {
      await setTaskGoogleSyncState(taskRecord, {
        eventId: taskRecord.data.googleEventId as string | null | undefined,
        googleSyncStatus: "error",
        googleSyncError: "Google Calendar n’est pas connecté.",
      });
      return observedJson(
        obsUser,
        { updated: false, code: "integration_not_connected", message: "Google Calendar n’est pas connecté." },
        { status: 409 },
      );
    }

    const integration = snap.data() as IntegrationDoc;
    if (integration.connected !== true) {
      await setTaskGoogleSyncState(taskRecord, {
        eventId: taskRecord.data.googleEventId as string | null | undefined,
        googleSyncStatus: "error",
        googleSyncError: "Google Calendar n’est pas connecté.",
      });
      return observedJson(
        obsUser,
        { updated: false, code: "integration_not_connected", message: "Google Calendar n’est pas connecté." },
        { status: 409 },
      );
    }

    const accessTokenResult = await refreshAccessTokenIfNeeded({ integration, userId: uid });
    if (!accessTokenResult.ok) {
      await setTaskGoogleSyncState(taskRecord, {
        eventId: taskRecord.data.googleEventId as string | null | undefined,
        googleSyncStatus: "error",
        googleSyncError: accessTokenResult.message,
      });
      return observedJson(
        obsUser,
        { updated: false, code: accessTokenResult.code, message: accessTokenResult.message },
        { status: accessTokenResult.code === "token_invalid" ? 401 : 503 },
      );
    }
    const accessToken = accessTokenResult.accessToken;

    if (!title) {
      return observedJson(obsUser, { error: "Invalid title", code: "invalid_title" }, { status: 400 });
    }

    const calendarId = typeof integration.primaryCalendarId === "string" && integration.primaryCalendarId
      ? integration.primaryCalendarId
      : "primary";
    const googleEventId =
      requestedGoogleEventId ||
      (typeof taskRecord.data.googleEventId === "string" && taskRecord.data.googleEventId.trim()
        ? taskRecord.data.googleEventId.trim()
        : "");

    if (!googleEventId) {
      const created = await createGoogleEventForTask({
        accessToken,
        calendarId,
        taskId,
        title,
        start: body.start,
        end: body.end,
        allDay,
        timeZone,
      });
      if (!created.ok) {
        await setTaskGoogleSyncState(taskRecord, {
          eventId: null,
          googleSyncStatus: "error",
          googleSyncError: created.message,
        });
        return observedJson(
          obsUser,
          { updated: false, code: created.code, message: created.message },
          { status: created.status },
        );
      }

      await setTaskGoogleSyncState(taskRecord, {
        eventId: created.eventId,
        googleSyncStatus: "synced",
        googleSyncError: null,
      });
      return observedJson(obsUser, {
        updated: true,
        recreated: true,
        eventId: created.eventId,
        code: "created_from_missing_link",
        message: "Événement Google Calendar recréé pour cette tâche.",
      });
    }

    const googlePayload = buildGoogleEventPayload({
      taskId,
      title,
      start: body.start,
      end: body.end,
      allDay,
      timeZone,
    });

    if (!googlePayload) {
      await setTaskGoogleSyncState(taskRecord, {
        eventId: null,
        googleSyncStatus: "error",
        googleSyncError: "Plage horaire Google Calendar invalide.",
      });
      return observedJson(
        obsUser,
        { error: "Invalid event payload", code: "invalid_event_payload", message: "Plage horaire Google Calendar invalide." },
        { status: 400 },
      );
    }

    const updateRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(googlePayload),
        cache: "no-store",
      },
    );

    if (updateRes.status === 404 || updateRes.status === 410) {
      const existingEvent = await findExistingGoogleEventByTaskId({
        accessToken,
        calendarId,
        taskId,
      });

      if (existingEvent?.id) {
        const retryRes = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(existingEvent.id)}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(googlePayload),
            cache: "no-store",
          },
        );

        if (retryRes.ok) {
          await setTaskGoogleSyncState(taskRecord, {
            eventId: existingEvent.id,
            googleSyncStatus: "synced",
            googleSyncError: null,
          });
          return observedJson(obsUser, {
            updated: true,
            reconciled: true,
            eventId: existingEvent.id,
            code: "relinked_existing_event",
            message: "Événement Google Calendar relinké puis mis à jour.",
          });
        }
      }

      const recreated = await createGoogleEventForTask({
        accessToken,
        calendarId,
        taskId,
        title,
        start: body.start,
        end: body.end,
        allDay,
        timeZone,
      });
      if (!recreated.ok) {
        await setTaskGoogleSyncState(taskRecord, {
          eventId: null,
          googleSyncStatus: "missing_remote",
          googleSyncError: recreated.message,
        });
        return observedJson(
          obsUser,
          { updated: false, code: "remote_missing", message: "L’événement Google lié n’existe plus et la recréation a échoué." },
          { status: 409 },
        );
      }

      await setTaskGoogleSyncState(taskRecord, {
        eventId: recreated.eventId,
        googleSyncStatus: "synced",
        googleSyncError: null,
      });
      return observedJson(obsUser, {
        updated: true,
        recreated: true,
        eventId: recreated.eventId,
        code: "recreated_after_remote_missing",
        message: "L’événement Google manquant a été recréé.",
      });
    }

    if (!updateRes.ok) {
      const message =
        updateRes.status === 401 || updateRes.status === 403
          ? "Le compte Google Calendar doit être reconnecté."
          : "La mise à jour Google Calendar a échoué.";
      await setTaskGoogleSyncState(taskRecord, {
        eventId: googleEventId,
        googleSyncStatus: "error",
        googleSyncError: message,
      });
      console.warn("google.calendar.events.update_failed", {
        requestId,
        uid,
        status: updateRes.status,
        taskId,
      });
      return observedJson(
        obsUser,
        { updated: false, code: updateRes.status === 401 || updateRes.status === 403 ? "token_invalid" : "update_failed", message },
        { status: updateRes.status === 401 || updateRes.status === 403 ? 401 : 502 },
      );
    }

    const updatedJson = (await updateRes.json()) as { id?: unknown };
    const updatedEventId = typeof updatedJson.id === "string" ? updatedJson.id : googleEventId;
    await setTaskGoogleSyncState(taskRecord, {
      eventId: updatedEventId,
      googleSyncStatus: "synced",
      googleSyncError: null,
    });
    return observedJson(obsUser, {
      updated: true,
      eventId: updatedEventId,
      code: "updated",
      message: "Événement Google Calendar mis à jour.",
    });
  } catch (e) {
    const obs = beginApiObserve({
      eventName: "google.calendar.events.update",
      route: "/api/google/calendar/events",
      requestId,
      uid: "anonymous",
    });
    observedError(obs, e);
    console.error("Google Calendar event update failed", e);
    return observedJson(obs, { updated: false }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  try {
    const auth = await getAuthenticatedIntegration(request, requestId, "google.calendar.events.delete");
    if (auth.kind === "response") return auth.response;

    const { uid, snap, obs: obsUser } = auth;
    const body = (await request.json()) as GoogleDeleteEventInput;
    const taskId = sanitizeTaskId((body as GoogleDeleteEventInput & { taskId?: unknown }).taskId);
    if (!taskId) {
      return observedJson(obsUser, { error: "Invalid task id", code: "invalid_task_id" }, { status: 400 });
    }

    const taskRecord = await getOwnedTaskRecord(uid, taskId);
    if (!taskRecord) {
      return observedJson(obsUser, { error: "Task not found", code: "task_not_found" }, { status: 404 });
    }

    if (!snap.exists) {
      await setTaskGoogleSyncState(taskRecord, {
        eventId: taskRecord.data.googleEventId as string | null | undefined,
        googleSyncStatus: "error",
        googleSyncError: "Google Calendar n’est pas connecté.",
      });
      return observedJson(
        obsUser,
        { deleted: false, code: "integration_not_connected", message: "Google Calendar n’est pas connecté." },
        { status: 409 },
      );
    }

    const integration = snap.data() as IntegrationDoc;
    if (integration.connected !== true) {
      await setTaskGoogleSyncState(taskRecord, {
        eventId: taskRecord.data.googleEventId as string | null | undefined,
        googleSyncStatus: "error",
        googleSyncError: "Google Calendar n’est pas connecté.",
      });
      return observedJson(
        obsUser,
        { deleted: false, code: "integration_not_connected", message: "Google Calendar n’est pas connecté." },
        { status: 409 },
      );
    }

    const accessTokenResult = await refreshAccessTokenIfNeeded({ integration, userId: uid });
    if (!accessTokenResult.ok) {
      await setTaskGoogleSyncState(taskRecord, {
        eventId: taskRecord.data.googleEventId as string | null | undefined,
        googleSyncStatus: "error",
        googleSyncError: accessTokenResult.message,
      });
      return observedJson(
        obsUser,
        { deleted: false, code: accessTokenResult.code, message: accessTokenResult.message },
        { status: accessTokenResult.code === "token_invalid" ? 401 : 503 },
      );
    }
    const accessToken = accessTokenResult.accessToken;

    const requestedGoogleEventId = typeof body.googleEventId === "string" ? body.googleEventId.trim() : "";
    const googleEventId =
      requestedGoogleEventId ||
      (typeof taskRecord.data.googleEventId === "string" && taskRecord.data.googleEventId.trim()
        ? taskRecord.data.googleEventId.trim()
        : "");
    if (!googleEventId) {
      await setTaskGoogleSyncState(taskRecord, {
        eventId: null,
        googleSyncStatus: "error",
        googleSyncError: null,
      });
      return observedJson(obsUser, {
        deleted: true,
        alreadyMissing: true,
        code: "already_unlinked",
        message: "Aucun événement Google Calendar n’était lié à cette tâche.",
      });
    }

    const calendarId = typeof integration.primaryCalendarId === "string" && integration.primaryCalendarId
      ? integration.primaryCalendarId
      : "primary";

    const deleteRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
      },
    );

    if (deleteRes.status === 404 || deleteRes.status === 410) {
      await setTaskGoogleSyncState(taskRecord, {
        eventId: null,
        googleSyncStatus: "missing_remote",
        googleSyncError: "L’événement Google Calendar était déjà absent.",
      });
      console.warn("google.calendar.events.delete_missing", {
        requestId,
        uid,
        status: deleteRes.status,
      });
      return observedJson(obsUser, {
        deleted: true,
        alreadyMissing: true,
        code: "already_missing",
        message: "L’événement Google Calendar était déjà absent.",
      });
    }

    if (!deleteRes.ok) {
      const message =
        deleteRes.status === 401 || deleteRes.status === 403
          ? "Le compte Google Calendar doit être reconnecté."
          : "La suppression Google Calendar a échoué.";
      await setTaskGoogleSyncState(taskRecord, {
        eventId: googleEventId,
        googleSyncStatus: "error",
        googleSyncError: message,
      });
      console.warn("google.calendar.events.delete_failed", {
        requestId,
        uid,
        status: deleteRes.status,
      });
      return observedJson(
        obsUser,
        { deleted: false, code: deleteRes.status === 401 || deleteRes.status === 403 ? "token_invalid" : "delete_failed", message },
        { status: deleteRes.status === 401 || deleteRes.status === 403 ? 401 : 502 },
      );
    }

    await setTaskGoogleSyncState(taskRecord, {
      eventId: null,
      googleSyncStatus: "synced",
      googleSyncError: null,
    });

    return observedJson(obsUser, {
      deleted: true,
      code: "deleted",
      message: "Événement Google Calendar supprimé.",
    });
  } catch (e) {
    const obs = beginApiObserve({
      eventName: "google.calendar.events.delete",
      route: "/api/google/calendar/events",
      requestId,
      uid: "anonymous",
    });
    observedError(obs, e);
    console.error("Google Calendar event delete failed", e);
    return observedJson(obs, { deleted: false }, { status: 500 });
  }
}
