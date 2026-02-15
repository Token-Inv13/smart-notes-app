import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb, verifySessionCookie } from "@/lib/firebaseAdmin";
import { encryptGoogleToken, hasGoogleTokenEncryptionKey } from "@/lib/googleCalendarCrypto";
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

export async function GET(request: NextRequest) {
  const returnTo = sanitizeReturnTo(request.cookies.get(OAUTH_RETURN_TO_COOKIE)?.value ?? null);
  const redirectBase = new URL(returnTo, request.nextUrl.origin);

  try {
    const sessionCookie = request.cookies.get("session")?.value;
    if (!sessionCookie) {
      redirectBase.searchParams.set("calendar", "auth_required");
      return NextResponse.redirect(redirectBase);
    }

    const decoded = await verifySessionCookie(sessionCookie);
    if (!decoded?.uid) {
      redirectBase.searchParams.set("calendar", "auth_required");
      return NextResponse.redirect(redirectBase);
    }

    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");
    const stateCookie = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
    const verifier = request.cookies.get(OAUTH_VERIFIER_COOKIE)?.value;

    if (!code || !state || !stateCookie || state !== stateCookie || !state.startsWith(`${decoded.uid}:`)) {
      redirectBase.searchParams.set("calendar", "oauth_state_invalid");
      const res = NextResponse.redirect(redirectBase);
      res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
      res.cookies.set(OAUTH_VERIFIER_COOKIE, "", { path: "/", maxAge: 0 });
      res.cookies.set(OAUTH_RETURN_TO_COOKIE, "", { path: "/", maxAge: 0 });
      return res;
    }

    const clientId = process.env.GOOGLE_CLIENT_ID ?? process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const appOrigin = await getServerAppOrigin();
    const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI ?? `${appOrigin}/api/google/calendar/callback`;

    if (!clientId) {
      redirectBase.searchParams.set("calendar", "missing_env");
      const res = NextResponse.redirect(redirectBase);
      res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
      res.cookies.set(OAUTH_VERIFIER_COOKIE, "", { path: "/", maxAge: 0 });
      res.cookies.set(OAUTH_RETURN_TO_COOKIE, "", { path: "/", maxAge: 0 });
      return res;
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
      redirectBase.searchParams.set("calendar", "token_exchange_failed");
      const res = NextResponse.redirect(redirectBase);
      res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
      res.cookies.set(OAUTH_VERIFIER_COOKIE, "", { path: "/", maxAge: 0 });
      res.cookies.set(OAUTH_RETURN_TO_COOKIE, "", { path: "/", maxAge: 0 });
      return res;
    }

    const tokenJson = (await tokenResp.json()) as TokenResponse;
    const accessToken = typeof tokenJson.access_token === "string" ? tokenJson.access_token : null;
    const refreshToken = typeof tokenJson.refresh_token === "string" ? tokenJson.refresh_token : null;
    const expiresIn = typeof tokenJson.expires_in === "number" ? tokenJson.expires_in : 3600;

    if (!accessToken) {
      redirectBase.searchParams.set("calendar", "token_missing");
      const res = NextResponse.redirect(redirectBase);
      res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
      res.cookies.set(OAUTH_VERIFIER_COOKIE, "", { path: "/", maxAge: 0 });
      res.cookies.set(OAUTH_RETURN_TO_COOKIE, "", { path: "/", maxAge: 0 });
      return res;
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
    const shouldUseEncryptedStorage = hasGoogleTokenEncryptionKey() && Boolean(encryptedAccessToken);

    const tokenPayload = shouldUseEncryptedStorage
      ? {
          tokenStorageMode: "encrypted",
          accessTokenEncrypted: encryptedAccessToken,
          ...(encryptedRefreshToken ? { refreshTokenEncrypted: encryptedRefreshToken } : {}),
          accessToken: FieldValue.delete(),
          refreshToken: FieldValue.delete(),
        }
      : {
          tokenStorageMode: "plain",
          accessToken,
          ...(refreshToken ? { refreshToken } : {}),
          accessTokenEncrypted: FieldValue.delete(),
          refreshTokenEncrypted: FieldValue.delete(),
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

    redirectBase.searchParams.set("calendar", "connected");
    const response = NextResponse.redirect(redirectBase);
    response.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    response.cookies.set(OAUTH_VERIFIER_COOKIE, "", { path: "/", maxAge: 0 });
    response.cookies.set(OAUTH_RETURN_TO_COOKIE, "", { path: "/", maxAge: 0 });
    return response;
  } catch {
    redirectBase.searchParams.set("calendar", "error");
    const response = NextResponse.redirect(redirectBase);
    response.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    response.cookies.set(OAUTH_VERIFIER_COOKIE, "", { path: "/", maxAge: 0 });
    response.cookies.set(OAUTH_RETURN_TO_COOKIE, "", { path: "/", maxAge: 0 });
    return response;
  }
}
