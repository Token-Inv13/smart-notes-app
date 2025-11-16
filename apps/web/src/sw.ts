/// <reference lib="webworker" />

import { initializeApp } from 'firebase/app';
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw';
import { clientsClaim } from 'workbox-core';
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: any };

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

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const firebaseApp = initializeApp(firebaseConfig);
const messaging = getMessaging(firebaseApp);

onBackgroundMessage(messaging, (payload) => {
  const title = payload.notification?.title || 'Notification';
  const body = payload.notification?.body || '';

  const notificationOptions: NotificationOptions = {
    body,
    data: payload.data || {},
  };

  self.registration.showNotification(title, notificationOptions);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data as { taskId?: string } | undefined;
  const taskId = data?.taskId;
  const targetUrl = taskId ? `/tasks?taskId=${taskId}` : '/tasks';

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
