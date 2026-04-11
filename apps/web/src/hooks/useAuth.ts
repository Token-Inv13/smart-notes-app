'use client';

import { useSyncExternalStore } from 'react';
import { auth, onAuthStateChanged, type User } from '../lib/firebase';
import {
  clearAuthInvalidationState,
  getAuthInvalidationSnapshot,
  subscribeAuthInvalidation,
} from '@/lib/authInvalidation';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'session-error';

export interface UseAuthState {
  user: User | null;
  status: AuthStatus;
  loading: boolean;
  error: string | null;
}

type AuthSnapshot = UseAuthState;

const listeners = new Set<() => void>();

let authObserverStarted = false;
let authInvalidationUnsubscribe: (() => void) | null = null;
let authObserverUnsubscribe: (() => void) | null = null;
let currentUser: User | null = auth.currentUser;
let authResolved = false;
let authObserverError: string | null = null;
let cachedSnapshot: AuthSnapshot = {
  user: currentUser,
  status: currentUser ? 'authenticated' : 'loading',
  loading: currentUser == null,
  error: null,
};

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function computeSnapshot(): AuthSnapshot {
  const invalidation = getAuthInvalidationSnapshot();
  let nextSnapshot: AuthSnapshot;

  if (!authResolved) {
    nextSnapshot = {
      user: currentUser,
      status: 'loading',
      loading: true,
      error: null,
    };
  } else {
    const sessionError = invalidation.error ?? authObserverError;
    if (sessionError) {
      nextSnapshot = {
        user: currentUser,
        status: 'session-error',
        loading: false,
        error: sessionError,
      };
    } else if (currentUser) {
      nextSnapshot = {
        user: currentUser,
        status: 'authenticated',
        loading: false,
        error: null,
      };
    } else {
      nextSnapshot = {
        user: null,
        status: 'unauthenticated',
        loading: false,
        error: null,
      };
    }
  }

  if (
    cachedSnapshot.user === nextSnapshot.user &&
    cachedSnapshot.status === nextSnapshot.status &&
    cachedSnapshot.loading === nextSnapshot.loading &&
    cachedSnapshot.error === nextSnapshot.error
  ) {
    return cachedSnapshot;
  }

  cachedSnapshot = nextSnapshot;
  return cachedSnapshot;
}

function resetSnapshotCache() {
  cachedSnapshot = {
    user: currentUser,
    status: currentUser ? 'authenticated' : 'loading',
    loading: currentUser == null,
    error: null,
  };
}

function startAuthObserver() {
  if (authObserverStarted) return;
  authObserverStarted = true;

  authObserverUnsubscribe = onAuthStateChanged(
    auth,
    (user) => {
      currentUser = user;
      authResolved = true;
      authObserverError = null;
      if (user) {
        clearAuthInvalidationState();
      }
      emitChange();
    },
    (error) => {
      currentUser = auth.currentUser;
      authResolved = true;
      authObserverError = error instanceof Error ? error.message : 'Firebase Auth unavailable';
      emitChange();
    },
  );

  authInvalidationUnsubscribe = subscribeAuthInvalidation(() => {
    emitChange();
  });
}

function subscribe(callback: () => void) {
  startAuthObserver();
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
    if (listeners.size === 0) {
      if (authInvalidationUnsubscribe) {
        authInvalidationUnsubscribe();
        authInvalidationUnsubscribe = null;
      }
      if (authObserverUnsubscribe) {
        authObserverUnsubscribe();
        authObserverUnsubscribe = null;
      }
      authObserverStarted = false;
      authResolved = auth.currentUser != null;
      currentUser = auth.currentUser;
      authObserverError = null;
      resetSnapshotCache();
    }
  };
}

function getSnapshot(): AuthSnapshot {
  startAuthObserver();
  return computeSnapshot();
}

export function useAuth(): UseAuthState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
