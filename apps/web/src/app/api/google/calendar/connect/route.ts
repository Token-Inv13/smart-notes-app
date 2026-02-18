import { NextRequest } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { verifySessionCookie } from "@/lib/firebaseAdmin";
import { hasGoogleTokenEncryptionKey } from "@/lib/googleCalendarCrypto";
import { beginApiObserve, observedError, observedJson } from "@/lib/apiObservability";
import { getServerAppOrigin } from "@/lib/serverOrigin";

const OAUTH_STATE_COOKIE = "gcal_oauth_state";
const OAUTH_VERIFIER_COOKIE = "gcal_oauth_verifier";
const OAUTH_RETURN_TO_COOKIE = "gcal_oauth_return_to";

function sanitizeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/settings";
  }
  return value;
}

function base64url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const obs = beginApiObserve({
    eventName: "google.calendar.connect.get",
    route: "/api/google/calendar/connect",
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
      eventName: "google.calendar.connect.get",
      route: "/api/google/calendar/connect",
      requestId,
      uid: decoded.uid,
    });

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const appOrigin = await getServerAppOrigin();
    const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI ?? `${appOrigin}/api/google/calendar/callback`;

    if (!hasGoogleTokenEncryptionKey()) {
      console.error("google.calendar.connect.service_unavailable", {
        reason: "missing_token_encryption_key",
      });
      return observedJson(
        obsUser,
        {
          code: "service_unavailable",
          error: "Configuration du service indisponible.",
        },
        { status: 503 },
      );
    }

    if (!clientId) {
      console.error("google.calendar.connect.service_unavailable", { reason: "missing_google_client_id" });
      return observedJson(
        obsUser,
        {
          code: "service_unavailable",
          error: "Configuration du service indisponible.",
        },
        { status: 500 },
      );
    }

    const state = `${decoded.uid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash("sha256").update(verifier).digest());

    const returnTo = sanitizeReturnTo(request.nextUrl.searchParams.get("returnTo"));

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: "https://www.googleapis.com/auth/calendar.readonly",
      state,
    });

    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    const response = observedJson(obsUser, { url });
    response.cookies.set({
      name: OAUTH_STATE_COOKIE,
      value: state,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 10,
    });
    response.cookies.set({
      name: OAUTH_VERIFIER_COOKIE,
      value: verifier,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 10,
    });
    response.cookies.set({
      name: OAUTH_RETURN_TO_COOKIE,
      value: returnTo,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 10,
    });

    return response;
  } catch (error) {
    observedError(obs, error);
    return observedJson(obs, { error: "Impossible de lancer la connexion Google Calendar." }, { status: 500 });
  }
}
