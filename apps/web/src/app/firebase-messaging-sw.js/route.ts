import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export function GET() {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  };

  const missingKeys = Object.entries(config)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missingKeys.length > 0) {
    return new NextResponse(
      `// Missing Firebase config keys: ${missingKeys.join(', ')}\n`,
      {
        status: 500,
        headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
      },
    );
  }

  const sw = `/* eslint-disable */
// Firebase Cloud Messaging service worker

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp(${JSON.stringify(config)});

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
`;

  return new NextResponse(sw, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
