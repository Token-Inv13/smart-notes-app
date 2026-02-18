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

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const obs = beginApiObserve({
    eventName: "google.calendar.events.get",
    route: "/api/google/calendar/events",
    requestId,
    uid: "anonymous",
  });

  try {
    if (!hasGoogleTokenEncryptionKey()) {
      console.error("google.calendar.events.service_unavailable", {
        reason: "missing_token_encryption_key",
        requestId,
      });
      return observedJson(obs, { error: "Configuration du service indisponible." }, { status: 503 });
    }

    const sessionCookie = request.cookies.get("session")?.value;
    if (!sessionCookie) {
      return observedJson(obs, { error: "Not authenticated" }, { status: 401 });
    }

    const decoded = await verifySessionCookie(sessionCookie);
    if (!decoded?.uid) {
      return observedJson(obs, { error: "Not authenticated" }, { status: 401 });
    }

    const obsUser = beginApiObserve({
      eventName: "google.calendar.events.get",
      route: "/api/google/calendar/events",
      requestId,
      uid: decoded.uid,
    });

    const timeMin = sanitizeIso(request.nextUrl.searchParams.get("timeMin"));
    const timeMax = sanitizeIso(request.nextUrl.searchParams.get("timeMax"));
    if (!timeMin || !timeMax) {
      return observedJson(obsUser, { error: "Invalid time range" }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = db.collection("users").doc(decoded.uid).collection("assistantIntegrations").doc("googleCalendar");
    const snap = await ref.get();
    if (!snap.exists) {
      return observedJson(obsUser, { events: [] });
    }

    const integration = snap.data() as IntegrationDoc;
    if (integration.connected !== true) {
      return observedJson(obsUser, { events: [] });
    }

    const accessToken = await refreshAccessTokenIfNeeded({ integration, userId: decoded.uid });
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
          uid: decoded.uid,
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
    observedError(obs, e);
    console.error("Google Calendar events route failed", e);
    return observedJson(obs, { error: "Internal server error" }, { status: 500 });
  }
}
