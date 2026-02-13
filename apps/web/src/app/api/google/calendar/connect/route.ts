import { NextRequest, NextResponse } from "next/server";
import { verifySessionCookie } from "@/lib/firebaseAdmin";

const OAUTH_STATE_COOKIE = "gcal_oauth_state";

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

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI ?? `${request.nextUrl.origin}/api/google/calendar/callback`;

    if (!clientId) {
      return NextResponse.json({ error: "Missing GOOGLE_CLIENT_ID" }, { status: 500 });
    }

    const state = `${decoded.uid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      scope: [
        "openid",
        "email",
        "https://www.googleapis.com/auth/calendar.readonly",
      ].join(" "),
      state,
    });

    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    const response = NextResponse.json({ url });
    response.cookies.set({
      name: OAUTH_STATE_COOKIE,
      value: state,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 10,
    });

    return response;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create Google OAuth URL";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
