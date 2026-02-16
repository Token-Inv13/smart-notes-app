import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb, verifySessionCookie } from "@/lib/firebaseAdmin";

export async function POST(request: NextRequest) {
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

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Google Calendar disconnect route failed", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
