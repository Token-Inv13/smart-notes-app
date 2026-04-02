'use client';

import { getToken, onMessage } from 'firebase/messaging';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { getMessagingInstance } from './firebase';
import { auth, db } from './firebase';

export type RegisterFcmTokenResult =
  | { ok: true; token: string; alreadyRegistered: boolean }
  | {
      ok: false;
      reason:
        | 'unauthenticated'
        | 'permission-denied'
        | 'permission-default'
        | 'unsupported'
        | 'messaging-unavailable'
        | 'missing-vapid-key'
        | 'service-worker-not-ready'
        | 'token-unavailable'
        | 'firestore-write-failed';
      error?: unknown;
    };

type RegisterFcmFailureReason = Extract<RegisterFcmTokenResult, { ok: false }>['reason'];

export function getFcmRegistrationFailureMessage(reason: RegisterFcmFailureReason) {
  switch (reason) {
    case 'permission-denied':
      return 'Permission refusée. Active les notifications dans les paramètres du navigateur.';
    case 'permission-default':
      return 'Permission non accordée. Autorise les notifications pour terminer l’activation.';
    case 'unsupported':
      return 'Les notifications web push ne sont pas disponibles sur ce navigateur.';
    case 'messaging-unavailable':
      return 'Firebase Messaging n’est pas disponible dans cet environnement.';
    case 'missing-vapid-key':
      return 'La clé VAPID FCM est absente en production.';
    case 'service-worker-not-ready':
      return 'Le service worker push n’est pas encore actif. Réessaie dans quelques secondes.';
    case 'token-unavailable':
      return 'Impossible de récupérer un token push pour cet appareil.';
    case 'firestore-write-failed':
      return 'Le token push a été obtenu, mais son enregistrement a échoué.';
    case 'unauthenticated':
      return 'Tu dois être connecté pour activer les notifications.';
    default:
      return 'Impossible d’activer les notifications pour le moment.';
  }
}

function toTasksQueryUrl(raw?: string | null, taskIdFallback?: string | null): string | undefined {
  const fallback =
    typeof taskIdFallback === 'string' && taskIdFallback
      ? `/tasks?taskId=${encodeURIComponent(taskIdFallback)}`
      : undefined;

  if (!raw) return fallback;

  const absolute = raw.startsWith('http://') || raw.startsWith('https://');
  if (absolute) return raw;

  if (raw.startsWith('/tasks?')) return raw;

  const taskPathMatch = raw.match(/^\/tasks\/([^/?#]+)/);
  if (taskPathMatch?.[1]) {
    return `/tasks?taskId=${encodeURIComponent(taskPathMatch[1])}`;
  }

  return raw || fallback;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function waitForServiceWorkerActivation(
  registration: ServiceWorkerRegistration,
  timeoutMs = 15000,
): Promise<ServiceWorkerRegistration> {
  const sw = registration.active ?? registration.waiting ?? registration.installing;
  if (!sw) return registration;
  if (sw.state === 'activated') return registration;

  await withTimeout(
    new Promise<void>((resolve) => {
      const onStateChange = () => {
        if (sw.state === 'activated') {
          sw.removeEventListener('statechange', onStateChange);
          resolve();
        }
      };
      sw.addEventListener('statechange', onStateChange);
    }),
    timeoutMs,
    'service worker activation',
  );

  return registration;
}

function hasActivatedServiceWorker(registration?: ServiceWorkerRegistration | null) {
  return registration?.active?.state === 'activated';
}

async function getActiveRootServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  const expectedScope = new URL('/', window.location.origin).href;
  const matchesRootScope = (registration?: ServiceWorkerRegistration | null) =>
    !!registration && registration.scope === expectedScope;

  let registration = await navigator.serviceWorker.getRegistration('/');

  if (!registration) {
    registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  }

  await registration.update().catch(() => {
    // Ignore transient update failures; readiness is checked below.
  });

  if (hasActivatedServiceWorker(registration) && matchesRootScope(registration)) {
    return registration;
  }

  const readyRegistration = await withTimeout(
    navigator.serviceWorker.ready,
    15000,
    'navigator.serviceWorker.ready',
  );

  const candidate = matchesRootScope(readyRegistration) ? readyRegistration : registration;
  if (!candidate || !matchesRootScope(candidate)) {
    throw new Error(`service worker scope mismatch: expected ${expectedScope}, got ${candidate?.scope ?? 'none'}`);
  }

  await waitForServiceWorkerActivation(candidate, 15000);

  if (!hasActivatedServiceWorker(candidate)) {
    throw new Error('service worker is not active after readiness check');
  }

  return candidate;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }

  if (Notification.permission === 'granted') {
    return 'granted';
  }

  if (Notification.permission === 'denied') {
    return 'denied';
  }

  try {
    // Some browsers can keep the permission promise pending if the prompt is blocked/hidden.
    const next = await withTimeout(
      Promise.resolve(Notification.requestPermission()),
      15000,
      'Notification.requestPermission',
    );
    return next;
  } catch (e) {
    console.warn('Notification permission request did not resolve in time', e);
    // Keep "default" so the UI can ask the user to retry.
    return 'default';
  }
}

export async function getFcmToken(): Promise<RegisterFcmTokenResult> {
  const permission = await requestNotificationPermission();
  if (permission === 'denied') {
    return { ok: false, reason: 'permission-denied' };
  }

  if (permission !== 'granted') {
    return { ok: false, reason: 'permission-default' };
  }

  const messaging = await getMessagingInstance();
  if (!messaging) {
    return { ok: false, reason: 'messaging-unavailable' };
  }

  const vapidKey = process.env.NEXT_PUBLIC_FCM_VAPID_KEY;
  if (!vapidKey) {
    console.warn('NEXT_PUBLIC_FCM_VAPID_KEY is not set');
    return { ok: false, reason: 'missing-vapid-key' };
  }

  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    console.warn('Service workers are not supported in this environment; push notifications will not work.');
    return { ok: false, reason: 'unsupported' };
  }

  let serviceWorkerRegistration: ServiceWorkerRegistration | null;
  try {
    serviceWorkerRegistration = await getActiveRootServiceWorkerRegistration();
    if (!serviceWorkerRegistration) {
      return { ok: false, reason: 'service-worker-not-ready' };
    }
  } catch (error) {
    console.warn('Service worker is not active yet; aborting FCM token retrieval.', error);
    return { ok: false, reason: 'service-worker-not-ready', error };
  }

  try {
    const token = await withTimeout(
      getToken(messaging, { vapidKey, serviceWorkerRegistration }),
      15000,
      'firebase.messaging.getToken',
    );

    if (!token) {
      return { ok: false, reason: 'token-unavailable' };
    }

    return { ok: true, token, alreadyRegistered: false };
  } catch (error) {
    console.error('Error retrieving FCM token', error);
    return { ok: false, reason: 'token-unavailable', error };
  }
}

export function listenToForegroundMessages() {
  if (typeof window === 'undefined') return;

  getMessagingInstance().then((messaging) => {
    if (!messaging) return;

    onMessage(messaging, (payload) => {
      const title = payload.notification?.title || 'Notification';
      const body = payload.notification?.body || '';
      const data = payload.data as { url?: string; taskId?: string } | undefined;
      const url = toTasksQueryUrl(data?.url, data?.taskId);

      if (typeof Notification === 'undefined') {
        console.log('Received foreground message', payload);
        return;
      }

      if (Notification.permission !== 'granted') {
        console.log('Received foreground message (no permission)', payload);
        return;
      }

      try {
        const n = new Notification(title, {
          body,
          data: { url },
        });

        n.onclick = () => {
          try {
            if (url) {
              window.open(url, '_blank', 'noopener,noreferrer');
            }
          } catch {
            // ignore
          }
        };
      } catch (e) {
        console.log('Received foreground message (notification failed)', payload, e);
      }
    });
  });
}

export async function registerFcmToken() {
  const user = auth.currentUser;
  if (!user) {
    console.warn('User not authenticated, skipping FCM token registration');
    return { ok: false, reason: 'unauthenticated' } satisfies RegisterFcmTokenResult;
  }

  const tokenResult = await getFcmToken();
  if (!tokenResult.ok) {
    console.warn('No FCM token retrieved');
    return tokenResult;
  }

  const token = tokenResult.token;

  try {
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);

    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        email: user.email ?? null,
        fcmTokens: { [token]: true },
        updatedAt: serverTimestamp(),
      }, { merge: true });
      console.log(`Registered FCM token for new user document ${user.uid}`);
      return { ok: true, token, alreadyRegistered: false } satisfies RegisterFcmTokenResult;
    }

    const data = snap.data() as { fcmTokens?: Record<string, boolean> };
    const existingTokens = data.fcmTokens ?? {};

    if (existingTokens[token]) {
      console.log('FCM token already registered for this user');
      return { ok: true, token, alreadyRegistered: true } satisfies RegisterFcmTokenResult;
    }

    // Avoid using the raw token in a field path (tokens can contain '.', ':', etc.).
    // Instead, update the whole map.
    await updateDoc(userRef, {
      fcmTokens: { ...existingTokens, [token]: true },
      updatedAt: serverTimestamp(),
    });

    console.log(`Registered FCM token for user ${user.uid}`);
    return { ok: true, token, alreadyRegistered: false } satisfies RegisterFcmTokenResult;
  } catch (error) {
    console.error('Error registering FCM token in Firestore', error);
    return { ok: false, reason: 'firestore-write-failed', error } satisfies RegisterFcmTokenResult;
  }
}
