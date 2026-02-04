'use client';

import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';

let invalidationInFlight = false;

function getErrorCode(err: unknown): string | null {
  if (typeof err !== 'object' || !err) return null;
  const candidate = (err as { code?: unknown }).code;
  return typeof candidate === 'string' ? candidate : null;
}

export function isAuthInvalidError(err: unknown): boolean {
  const code = getErrorCode(err);
  return code === 'permission-denied' || code === 'unauthenticated';
}

export async function invalidateAuthSession(): Promise<void> {
  if (invalidationInFlight) return;
  invalidationInFlight = true;

  try {
    await fetch('/api/logout', { method: 'POST' }).catch(() => null);
  } finally {
    try {
      await signOut(auth);
    } catch {
      // ignore
    }

    if (typeof window !== 'undefined') {
      window.location.replace('/login');
    }
  }
}
