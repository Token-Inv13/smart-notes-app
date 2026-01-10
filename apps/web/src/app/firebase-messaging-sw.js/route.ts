import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export function GET() {
  const sw = `/* eslint-disable */
// Deprecated Firebase Messaging service worker.
// This endpoint is kept for backward compatibility only.
// The app now uses the PWA service worker at /sw.js.

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        await self.registration.unregister();
      } catch (_) {
        // ignore
      }

      try {
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clients) {
          try {
            client.postMessage({ type: 'SW_DEPRECATED', scope: self.registration.scope });
          } catch (_) {
            // ignore
          }
        }
      } catch (_) {
        // ignore
      }
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification?.data || {};
  const targetUrl = (typeof data.url === 'string' && data.url) ? data.url : '/';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existingClient = allClients.find((client) => 'focus' in client);

      if (existingClient && 'focus' in existingClient) {
        try {
          if ('navigate' in existingClient && typeof existingClient.navigate === 'function') {
            await existingClient.navigate(targetUrl);
          }
        } catch (_) {
          // ignore
        }

        await existingClient.focus();
        return;
      }

      await self.clients.openWindow(targetUrl);
    })(),
  );
});
`;

  return new NextResponse(sw, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
