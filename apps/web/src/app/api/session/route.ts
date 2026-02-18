import { NextResponse } from 'next/server';
import { createSessionCookie } from '@/lib/firebaseAdmin';

const SESSION_COOKIE_NAME = 'session';
const SESSION_EXPIRES_IN_MS = 1000 * 60 * 60 * 24 * 5; // 5 days

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
      return new NextResponse('Missing idToken', { status: 400 });
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
    console.error('Error creating session cookie', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
