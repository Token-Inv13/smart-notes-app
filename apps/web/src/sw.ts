/// <reference lib="webworker" />

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
