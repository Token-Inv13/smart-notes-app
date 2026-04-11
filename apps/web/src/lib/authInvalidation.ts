'use client';

import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';

type AuthInvalidationState = {
  inFlight: boolean;
  error: string | null;
  reason: string | null;
};

const listeners = new Set<() => void>();

let invalidationState: AuthInvalidationState = {
  inFlight: false,
  error: null,
  reason: null,
};

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function setInvalidationState(next: Partial<AuthInvalidationState>) {
  invalidationState = {
    ...invalidationState,
    ...next,
  };
  emitChange();
}

function getErrorCode(err: unknown): string | null {
  if (typeof err !== 'object' || !err) return null;
  const candidate = (err as { code?: unknown }).code;
  return typeof candidate === 'string' ? candidate : null;
}

export function subscribeAuthInvalidation(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAuthInvalidationSnapshot(): AuthInvalidationState {
  return invalidationState;
}

export function clearAuthInvalidationState() {
  if (!invalidationState.inFlight && !invalidationState.error && !invalidationState.reason) return;
  invalidationState = {
    inFlight: false,
    error: null,
    reason: null,
  };
  emitChange();
}

export function isAuthInvalidError(err: unknown): boolean {
  const code = getErrorCode(err);
  return code === 'unauthenticated' || code === 'auth/session-cookie-expired' || code === 'auth/user-token-expired';
}

export async function invalidateAuthSession(options?: {
  reason?: string;
  message?: string;
  redirectTo?: string;
}): Promise<void> {
  if (invalidationState.inFlight) return;

  const reason = options?.reason ?? 'session-invalid';
  const message = options?.message ?? 'Session invalide ou expirée. Reconnecte-toi.';
  const redirectTarget = options?.redirectTo ?? `/login?reason=${encodeURIComponent(reason)}`;

  setInvalidationState({
    inFlight: true,
    reason,
    error: message,
  });

  try {
    await fetch('/api/logout', { method: 'POST' }).catch(() => null);
    await signOut(auth).catch(() => null);
  } finally {
    setInvalidationState({ inFlight: false });
    if (typeof window !== 'undefined') {
      window.location.replace(redirectTarget);
    }
  }
}
