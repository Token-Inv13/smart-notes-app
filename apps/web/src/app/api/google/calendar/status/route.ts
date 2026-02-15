import { NextRequest, NextResponse } from "next/server";
import { getAdminDb, verifySessionCookie } from "@/lib/firebaseAdmin";

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
    console.error("Google calendar status error", e);
    return NextResponse.json({ error: "Failed to load status" }, { status: 500 });
  }
}
