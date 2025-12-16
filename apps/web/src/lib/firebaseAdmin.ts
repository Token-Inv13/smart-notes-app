import admin from 'firebase-admin';

let app: admin.app.App | null = null;

function getAdminApp(): admin.app.App {
  if (app) return app;

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing Firebase Admin environment variables');
  }

  if (admin.apps.length) {
    app = admin.app();
    return app;
  }

  let normalizedPrivateKey = privateKey.trim();
  normalizedPrivateKey = normalizedPrivateKey.replace(/^"|"$/g, "");
  normalizedPrivateKey = normalizedPrivateKey.replace(/,$/, "");
  normalizedPrivateKey = normalizedPrivateKey.replace(/\r\n/g, "\n");
  normalizedPrivateKey = normalizedPrivateKey.replace(/\\n/g, "\n");

  app = admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey: normalizedPrivateKey,
    }),
  });

  return app;
}

export function getAdminAuth(): admin.auth.Auth {
  return getAdminApp().auth();
}

export async function verifySessionCookie(sessionCookie: string) {
  try {
    return await getAdminAuth().verifySessionCookie(sessionCookie, true);
  } catch {
    return null;
  }
}

export async function createSessionCookie(idToken: string, expiresInMs: number) {
  return await getAdminAuth().createSessionCookie(idToken, { expiresIn: expiresInMs });
}
