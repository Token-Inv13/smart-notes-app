/// <reference lib="webworker" />

import { clientsClaim } from 'workbox-core';
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';

type ManifestEntry = {
  url: string;
  revision?: string | null;
};

type FirebaseBackgroundPayload = {
  notification?: {
    title?: string;
    body?: string;
  };
  data?: Record<string, string>;
};

type FirebaseCompat = {
  apps?: unknown[];
  initializeApp: (config: {
    apiKey?: string;
    authDomain?: string;
    projectId?: string;
    appId?: string;
    messagingSenderId?: string;
  }) => void;
  messaging: () => {
    onBackgroundMessage: (cb: (payload: FirebaseBackgroundPayload) => void) => void;
  };
};

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: ManifestEntry[];
  importScripts: (...urls: string[]) => void;
  firebase?: FirebaseCompat;
};

declare const process: {
  env: {
    NEXT_PUBLIC_FIREBASE_API_KEY?: string;
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?: string;
    NEXT_PUBLIC_FIREBASE_PROJECT_ID?: string;
    NEXT_PUBLIC_FIREBASE_APP_ID?: string;
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?: string;
  };
};

clientsClaim();

precacheAndRoute(self.__WB_MANIFEST || []);

registerRoute(
  ({ request }) => request.mode === 'navigate',
  new NetworkFirst({ cacheName: 'html-cache' }),
);

registerRoute(
  ({ url }) => url.pathname.startsWith('/_next/'),
  new StaleWhileRevalidate({ cacheName: 'next-static-cache' }),
);

registerRoute(
  ({ url }) => url.pathname.startsWith('/icons/'),
  new StaleWhileRevalidate({ cacheName: 'icons-cache' }),
);

try {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  } as const;

  const missing = Object.values(config).some((v) => !v);
  if (!missing) {
    self.importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
    self.importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

    const firebase = self.firebase;
    if (firebase) {
      if (firebase.apps?.length === 0) {
        firebase.initializeApp(config);
      }

      const messaging = firebase.messaging();
      messaging.onBackgroundMessage((payload) => {
        const title = payload?.notification?.title || 'Notification';
        const body = payload?.notification?.body || '';
        const data = payload?.data || {};

        self.registration.showNotification(title, {
          body,
          data,
        });
      });
    }
  }
} catch {
  // ignore
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data as { url?: string; taskId?: string } | undefined;
  const taskId = data?.taskId;
  const targetUrl = data?.url || (taskId ? `/tasks/${taskId}` : '/tasks');

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existingClient = allClients.find((client) => 'focus' in client);

      if (existingClient && 'focus' in existingClient) {
        existingClient.navigate?.(targetUrl);
        await existingClient.focus();
      } else {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});
