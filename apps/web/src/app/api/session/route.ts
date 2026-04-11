import { NextResponse } from 'next/server';
import { createSessionCookie, getAdminProjectId, isFirebaseAdminServiceError } from '@/lib/firebaseAdmin';

const SESSION_COOKIE_NAME = 'session';
const SESSION_EXPIRES_IN_MS = 1000 * 60 * 60 * 24 * 5; // 5 days

function clearSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}

export async function POST(request: Request) {
  try {
    const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === 'true';
    if (useEmulators && process.env.NODE_ENV !== 'production') {
      // In local emulator mode we don't require server-side session cookies.
      // This avoids needing firebase-admin credentials locally.
      return NextResponse.json({ ok: true, emulators: true });
    }

    const body = await request.json().catch(() => null);
    const idToken = body?.idToken;

    if (!idToken || typeof idToken !== 'string') {
      return clearSessionCookie(
        NextResponse.json(
          { code: 'missing_id_token', error: 'Missing idToken' },
          { status: 400 },
        ),
      );
    }

    const sessionCookie = await createSessionCookie(idToken, SESSION_EXPIRES_IN_MS);

    const res = NextResponse.json({ ok: true });
    res.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: sessionCookie,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(SESSION_EXPIRES_IN_MS / 1000),
    });

    return res;
  } catch (e) {
    const error = e as { code?: string; message?: string };
    let adminProjectId: string | null = null;
    try {
      adminProjectId = getAdminProjectId();
    } catch {
      adminProjectId = null;
    }

    console.error('Error creating session cookie', {
      code: typeof error?.code === 'string' ? error.code : null,
      message: typeof error?.message === 'string' ? error.message : 'Unknown error',
      error: e,
      clientProjectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? null,
      adminProjectId,
      hasAdminJson: Boolean(
        process.env.FIREBASE_ADMIN_JSON ||
          process.env.FIREBASE_ADMIN_CREDENTIALS_JSON ||
          process.env.FIREBASE_ADMIN_CREDENTIALS_BASE64
      ),
    });

    if (isFirebaseAdminServiceError(e)) {
      return clearSessionCookie(
        NextResponse.json(
          {
            code: 'service_unavailable',
            error: 'Configuration serveur Firebase indisponible.',
          },
          { status: 503 },
        ),
      );
    }

    const code = typeof error?.code === 'string' ? error.code : null;
    if (code === 'auth/argument-error' || code === 'auth/id-token-expired' || code === 'auth/invalid-id-token') {
      return clearSessionCookie(
        NextResponse.json(
          {
            code: 'invalid_id_token',
            error: 'Jeton Firebase invalide ou expiré.',
          },
          { status: 401 },
        ),
      );
    }

    return clearSessionCookie(
      NextResponse.json(
        { code: 'internal_error', error: 'Internal server error' },
        { status: 500 },
      ),
    );
  }
}
