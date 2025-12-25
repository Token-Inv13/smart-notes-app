'use client';

import { getToken, onMessage } from 'firebase/messaging';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { getMessagingInstance } from './firebase';
import { auth, db } from './firebase';

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

  return Notification.requestPermission();
}

export async function getFcmToken(): Promise<string | null> {
  const permission = await requestNotificationPermission();
  if (permission !== 'granted') {
    return null;
  }

  const messaging = await getMessagingInstance();
  if (!messaging) {
    return null;
  }

  const vapidKey = process.env.NEXT_PUBLIC_FCM_VAPID_KEY;
  if (!vapidKey) {
    console.warn('NEXT_PUBLIC_FCM_VAPID_KEY is not set');
    return null;
  }

  let serviceWorkerRegistration: ServiceWorkerRegistration | undefined;
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      serviceWorkerRegistration = await navigator.serviceWorker.ready;
    } catch (e) {
      console.warn('Service worker is not ready; push notifications may not work in this environment.', e);
    }
  } else {
    console.warn('Service workers are not supported in this environment; push notifications will not work.');
  }

  try {
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration });
    return token || null;
  } catch (error) {
    console.error('Error retrieving FCM token', error);
    return null;
  }
}

export function listenToForegroundMessages() {
  if (typeof window === 'undefined') return;

  getMessagingInstance().then((messaging) => {
    if (!messaging) return;

    onMessage(messaging, (payload) => {
      console.log('Received foreground message', payload);
      // TODO: hook this into a UI toast/notification system
    });
  });
}

export async function registerFcmToken() {
  const user = auth.currentUser;
  if (!user) {
    console.warn('User not authenticated, skipping FCM token registration');
    return;
  }

  const token = await getFcmToken();
  if (!token) {
    console.warn('No FCM token retrieved');
    return;
  }

  try {
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);

    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        email: user.email ?? null,
        fcmTokens: { [token]: true },
      }, { merge: true });
      console.log(`Registered FCM token for new user document ${user.uid}`);
      return;
    }

    const data = snap.data() as { fcmTokens?: Record<string, boolean> };
    const existingTokens = data.fcmTokens ?? {};

    if (existingTokens[token]) {
      console.log('FCM token already registered for this user');
      return;
    }

    await updateDoc(userRef, {
      [`fcmTokens.${token}`]: true,
    });

    console.log(`Registered FCM token ${token} for user ${user.uid}`);
  } catch (error) {
    console.error('Error registering FCM token in Firestore', error);
  }
}
