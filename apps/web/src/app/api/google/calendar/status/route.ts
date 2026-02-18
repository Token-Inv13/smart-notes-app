import { NextRequest } from "next/server";
import { getAdminDb, verifySessionCookie } from "@/lib/firebaseAdmin";
import { beginApiObserve, observedError, observedJson } from "@/lib/apiObservability";

type IntegrationDoc = {
  connected?: boolean;
  primaryCalendarId?: string;
  lastConnectedAt?: unknown;
  updatedAt?: unknown;
};

function hasToMillis(value: unknown): value is { toMillis: () => number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "toMillis" in value &&
    typeof (value as { toMillis?: unknown }).toMillis === "function"
  );
}

function toMillisSafe(value: unknown): number | null {
  if (hasToMillis(value)) {
    return value.toMillis();
  }
  return null;
}

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const obs = beginApiObserve({
    eventName: "google.calendar.status.get",
    route: "/api/google/calendar/status",
    requestId,
    uid: "anonymous",
  });

  try {
    const sessionCookie = request.cookies.get("session")?.value;
    if (!sessionCookie) {
      return observedJson(obs, { error: "Not authenticated" }, { status: 401 });
    }

    const decoded = await verifySessionCookie(sessionCookie);
    if (!decoded?.uid) {
      return observedJson(obs, { error: "Not authenticated" }, { status: 401 });
    }

    const obsUser = beginApiObserve({
      eventName: "google.calendar.status.get",
      route: "/api/google/calendar/status",
      requestId,
      uid: decoded.uid,
    });

    const db = getAdminDb();
    const ref = db.collection("users").doc(decoded.uid).collection("assistantIntegrations").doc("googleCalendar");
    const snap = await ref.get();

    if (!snap.exists) {
      return observedJson(obsUser, { connected: false });
    }

    const data = snap.data() as IntegrationDoc;
    return observedJson(obsUser, {
      connected: data?.connected === true,
      primaryCalendarId: typeof data?.primaryCalendarId === "string" ? data.primaryCalendarId : null,
      lastConnectedAtMs: toMillisSafe(data?.lastConnectedAt),
      updatedAtMs: toMillisSafe(data?.updatedAt),
    });
  } catch (e) {
    observedError(obs, e);
    console.error("Google calendar status error", e);
    return observedJson(obs, { error: "Failed to load status" }, { status: 500 });
  }
}
