import { NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb, verifySessionCookie } from "@/lib/firebaseAdmin";
import { beginApiObserve, observedError, observedJson } from "@/lib/apiObservability";

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const obs = beginApiObserve({
    eventName: "google.calendar.disconnect.post",
    route: "/api/google/calendar/disconnect",
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
      eventName: "google.calendar.disconnect.post",
      route: "/api/google/calendar/disconnect",
      requestId,
      uid: decoded.uid,
    });

    const db = getAdminDb();
    const ref = db.collection("users").doc(decoded.uid).collection("assistantIntegrations").doc("googleCalendar");

    await ref.set(
      {
        connected: false,
        primaryCalendarId: null,
        tokenStorageMode: FieldValue.delete(),
        accessToken: FieldValue.delete(),
        refreshToken: FieldValue.delete(),
        accessTokenEncrypted: FieldValue.delete(),
        refreshTokenEncrypted: FieldValue.delete(),
        accessTokenExpiresAtMs: FieldValue.delete(),
        scope: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return observedJson(obsUser, { ok: true });
  } catch (e) {
    observedError(obs, e);
    console.error("Google Calendar disconnect route failed", e);
    return observedJson(obs, { error: "Internal server error" }, { status: 500 });
  }
}
