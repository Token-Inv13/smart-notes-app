import { NextRequest, NextResponse } from "next/server";
import { getAdminDb, verifySessionCookie } from "@/lib/firebaseAdmin";

type IntegrationDoc = {
  connected?: boolean;
  primaryCalendarId?: string | null;
  lastConnectedAt?: { toMillis?: () => number };
  updatedAt?: { toMillis?: () => number };
};

function toMillisSafe(value: unknown): number | null {
  const ts = value as { toMillis?: () => number };
  if (ts && typeof ts.toMillis === "function") {
    return ts.toMillis();
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const sessionCookie = request.cookies.get("session")?.value;
    if (!sessionCookie) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const decoded = await verifySessionCookie(sessionCookie);
    if (!decoded?.uid) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const db = getAdminDb();
    const ref = db.collection("users").doc(decoded.uid).collection("assistantIntegrations").doc("googleCalendar");
    const snap = await ref.get();

    if (!snap.exists) {
      return NextResponse.json({ connected: false });
    }

    const data = snap.data() as IntegrationDoc;
    return NextResponse.json({
      connected: data?.connected === true,
      primaryCalendarId: typeof data?.primaryCalendarId === "string" ? data.primaryCalendarId : null,
      lastConnectedAtMs: toMillisSafe(data?.lastConnectedAt),
      updatedAtMs: toMillisSafe(data?.updatedAt),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
