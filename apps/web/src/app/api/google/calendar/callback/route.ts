import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb, verifySessionCookie } from "@/lib/firebaseAdmin";
import { encryptGoogleToken, hasGoogleTokenEncryptionKey } from "@/lib/googleCalendarCrypto";
import { beginApiObserve, endApiObserve, observedError } from "@/lib/apiObservability";
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

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
};

type CalendarListResponse = {
  items?: Array<{
    id?: string;
    summary?: string;
    primary?: boolean;
  }>;
};

function redirectWithCalendarState(base: URL, state: string) {
  base.searchParams.set("calendar", state);
  const res = NextResponse.redirect(base);
  res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(OAUTH_VERIFIER_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(OAUTH_RETURN_TO_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const obs = beginApiObserve({
    eventName: "google.calendar.callback.get",
    route: "/api/google/calendar/callback",
    requestId,
    uid: "anonymous",
  });

  const returnTo = sanitizeReturnTo(request.cookies.get(OAUTH_RETURN_TO_COOKIE)?.value ?? null);
  const redirectBase = new URL(returnTo, request.nextUrl.origin);

  const redirectWithStateObserved = (state: string, status = 302, uid = "anonymous") => {
    const response = redirectWithCalendarState(redirectBase, state);
    endApiObserve(obs, status, {
      requestId,
      uid,
      oauthState: state,
    });
    return response;
  };

  try {
    const sessionCookie = request.cookies.get("session")?.value;
    if (!sessionCookie) {
      return redirectWithStateObserved("auth_required", 302, "anonymous");
    }

    const decoded = await verifySessionCookie(sessionCookie);
    if (!decoded?.uid) {
      return redirectWithStateObserved("auth_required", 302, "anonymous");
    }

    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");
    const stateCookie = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
    const verifier = request.cookies.get(OAUTH_VERIFIER_COOKIE)?.value;

    if (!code || !state || !stateCookie || state !== stateCookie || !state.startsWith(`${decoded.uid}:`)) {
      return redirectWithStateObserved("oauth_state_invalid", 302, decoded.uid);
    }

    if (!hasGoogleTokenEncryptionKey()) {
      console.error("google.calendar.callback.service_unavailable", {
        reason: "missing_token_encryption_key",
        uid: decoded.uid,
      });
      return redirectWithStateObserved("service_unavailable", 302, decoded.uid);
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const appOrigin = await getServerAppOrigin();
    const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI ?? `${appOrigin}/api/google/calendar/callback`;

    if (!clientId) {
      console.error("google.calendar.callback.service_unavailable", {
        reason: "missing_google_client_id",
        uid: decoded.uid,
      });
      return redirectWithStateObserved("service_unavailable", 302, decoded.uid);
    }

    const tokenBody = new URLSearchParams({
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    if (clientSecret) {
      tokenBody.set("client_secret", clientSecret);
    } else if (typeof verifier === "string" && verifier.length > 0) {
      tokenBody.set("code_verifier", verifier);
    }

    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
      cache: "no-store",
    });

    if (!tokenResp.ok) {
      return redirectWithStateObserved("token_exchange_failed", 302, decoded.uid);
    }

    const tokenJson = (await tokenResp.json()) as TokenResponse;
    const accessToken = typeof tokenJson.access_token === "string" ? tokenJson.access_token : null;
    const refreshToken = typeof tokenJson.refresh_token === "string" ? tokenJson.refresh_token : null;
    const expiresIn = typeof tokenJson.expires_in === "number" ? tokenJson.expires_in : 3600;

    if (!accessToken) {
      return redirectWithStateObserved("token_missing", 302, decoded.uid);
    }

    const calendarResp = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    });

    let primaryCalendarId: string | null = null;
    if (calendarResp.ok) {
      const json = (await calendarResp.json()) as CalendarListResponse;
      const primary = Array.isArray(json.items) ? json.items.find((c) => c?.primary) : null;
      primaryCalendarId = typeof primary?.id === "string" ? primary.id : null;
    }

    const db = getAdminDb();
    const ref = db.collection("users").doc(decoded.uid).collection("assistantIntegrations").doc("googleCalendar");

    const nowMs = Date.now();
    const expiresAtMs = nowMs + Math.max(60, expiresIn) * 1000;
    const encryptedAccessToken = encryptGoogleToken(accessToken);
    const encryptedRefreshToken = refreshToken ? encryptGoogleToken(refreshToken) : null;
    if (!encryptedAccessToken) {
      console.error("google.calendar.callback.service_unavailable", {
        reason: "token_encryption_failed",
        uid: decoded.uid,
      });
      return redirectWithStateObserved("service_unavailable", 302, decoded.uid);
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
        provider: "google_calendar",
        connected: true,
        primaryCalendarId,
        ...tokenPayload,
        accessTokenExpiresAtMs: expiresAtMs,
        scope: typeof tokenJson.scope === "string" ? tokenJson.scope : "",
        lastConnectedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return redirectWithStateObserved("connected", 302, decoded.uid);
  } catch (error) {
    observedError(obs, error, { requestId });
    console.error("google.calendar.callback.failed", error);
    return redirectWithStateObserved("error", 302, "anonymous");
  }
}
