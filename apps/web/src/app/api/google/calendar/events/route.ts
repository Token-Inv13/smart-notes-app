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
  summary?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};

type GoogleEventsResponse = {
  items?: GoogleEventItem[];
};

type GoogleCreateEventInput = {
  title?: unknown;
  start?: unknown;
  end?: unknown;
  allDay?: unknown;
  timeZone?: unknown;
};

type GoogleUpdateEventInput = GoogleCreateEventInput & {
  googleEventId?: unknown;
};

type TokenRefreshResponse = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

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
  title: string;
  start: unknown;
  end: unknown;
  allDay: boolean;
  timeZone: string | null;
}) {
  const { title, start, end, allDay, timeZone } = input;

  if (allDay) {
    const startDate = sanitizeDateOnly(start);
    const endDate = sanitizeDateOnly(end);
    if (!startDate || !endDate) return null;
    return {
      summary: title,
      start: { date: startDate },
      end: { date: endDate },
    };
  }

  const startDateTime = sanitizeIso(typeof start === "string" ? start : null);
  const endDateTime = sanitizeIso(typeof end === "string" ? end : null);
  if (!startDateTime || !endDateTime) return null;

  return {
    summary: title,
    start: timeZone ? { dateTime: startDateTime, timeZone } : { dateTime: startDateTime },
    end: timeZone ? { dateTime: endDateTime, timeZone } : { dateTime: endDateTime },
  };
}

async function refreshAccessTokenIfNeeded(input: {
  integration: IntegrationDoc;
  userId: string;
}): Promise<string | null> {
  const { integration, userId } = input;

  if (!hasGoogleTokenEncryptionKey()) {
    console.error("google.calendar.events.service_unavailable", {
      reason: "missing_token_encryption_key",
      uid: userId,
    });
    return null;
  }

  const nowMs = Date.now();

  const currentAccessToken = resolveStoredToken(integration.accessTokenEncrypted);
  const currentRefreshToken = resolveStoredToken(integration.refreshTokenEncrypted);
  const expiresAtMs = typeof integration.accessTokenExpiresAtMs === "number" ? integration.accessTokenExpiresAtMs : null;

  const stillValid = typeof expiresAtMs === "number" && expiresAtMs > nowMs + 30_000;
  if (currentAccessToken && stillValid) {
    return currentAccessToken;
  }

  if (!currentRefreshToken) {
    return currentAccessToken;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    console.error("google.calendar.events.service_unavailable", {
      reason: "missing_google_client_id",
      uid: userId,
    });
    return currentAccessToken;
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
    return currentAccessToken;
  }

  const refreshJson = (await refreshRes.json()) as TokenRefreshResponse;
  const refreshedAccessToken = typeof refreshJson.access_token === "string" ? refreshJson.access_token : null;
  if (!refreshedAccessToken) {
    return currentAccessToken;
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
    return currentAccessToken;
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

  return refreshedAccessToken;
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

    const accessToken = await refreshAccessTokenIfNeeded({ integration, userId: uid });
    if (!accessToken) {
      return observedJson(obsUser, { events: [] });
    }

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
      return observedJson(obsUser, { events: [] });
    }

    const eventsJson = (await eventsRes.json()) as GoogleEventsResponse;
    const events = Array.isArray(eventsJson.items)
      ? eventsJson.items
          .map((item) => {
            const startRaw = item.start?.dateTime ?? item.start?.date;
            const endRaw = item.end?.dateTime ?? item.end?.date;
            if (!startRaw || !endRaw || !item.id) return null;
            return {
              id: item.id,
              title: typeof item.summary === "string" && item.summary.trim() ? item.summary : "Événement Google",
              start: new Date(startRaw).toISOString(),
              end: new Date(endRaw).toISOString(),
              allDay: typeof item.start?.date === "string",
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
    if (!snap.exists) {
      return observedJson(obsUser, { created: false });
    }

    const integration = snap.data() as IntegrationDoc;
    if (integration.connected !== true) {
      return observedJson(obsUser, { created: false });
    }

    const accessToken = await refreshAccessTokenIfNeeded({ integration, userId: uid });
    if (!accessToken) {
      return observedJson(obsUser, { created: false });
    }

    const body = (await request.json()) as GoogleCreateEventInput;
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const allDay = body.allDay === true;
    const timeZone = sanitizeOptionalTimeZone(body.timeZone);

    if (!title) {
      return observedJson(obsUser, { error: "Invalid title" }, { status: 400 });
    }

    const googlePayload = buildGoogleEventPayload({
      title,
      start: body.start,
      end: body.end,
      allDay,
      timeZone,
    });

    if (!googlePayload) {
      return observedJson(obsUser, { error: "Invalid event payload" }, { status: 400 });
    }

    const calendarId = typeof integration.primaryCalendarId === "string" && integration.primaryCalendarId
      ? integration.primaryCalendarId
      : "primary";

    const createRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(googlePayload),
        cache: "no-store",
      },
    );

    if (!createRes.ok) {
      console.warn("google.calendar.events.create_failed", {
        requestId,
        uid,
        status: createRes.status,
      });
      return observedJson(obsUser, { created: false }, { status: 502 });
    }

    const createdJson = (await createRes.json()) as { id?: unknown };
    return observedJson(obsUser, {
      created: true,
      eventId: typeof createdJson.id === "string" ? createdJson.id : null,
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
    if (!snap.exists) {
      return observedJson(obsUser, { updated: false });
    }

    const integration = snap.data() as IntegrationDoc;
    if (integration.connected !== true) {
      return observedJson(obsUser, { updated: false });
    }

    const accessToken = await refreshAccessTokenIfNeeded({ integration, userId: uid });
    if (!accessToken) {
      return observedJson(obsUser, { updated: false });
    }

    const body = (await request.json()) as GoogleUpdateEventInput;
    const googleEventId = typeof body.googleEventId === "string" ? body.googleEventId.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const allDay = body.allDay === true;
    const timeZone = sanitizeOptionalTimeZone(body.timeZone);

    if (!googleEventId) {
      return observedJson(obsUser, { error: "Invalid google event id" }, { status: 400 });
    }

    if (!title) {
      return observedJson(obsUser, { error: "Invalid title" }, { status: 400 });
    }

    const googlePayload = buildGoogleEventPayload({
      title,
      start: body.start,
      end: body.end,
      allDay,
      timeZone,
    });

    if (!googlePayload) {
      return observedJson(obsUser, { error: "Invalid event payload" }, { status: 400 });
    }

    const calendarId = typeof integration.primaryCalendarId === "string" && integration.primaryCalendarId
      ? integration.primaryCalendarId
      : "primary";

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

    if (!updateRes.ok) {
      console.warn("google.calendar.events.update_failed", {
        requestId,
        uid,
        status: updateRes.status,
      });
      return observedJson(obsUser, { updated: false }, { status: 502 });
    }

    const updatedJson = (await updateRes.json()) as { id?: unknown };
    return observedJson(obsUser, {
      updated: true,
      eventId: typeof updatedJson.id === "string" ? updatedJson.id : googleEventId,
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
