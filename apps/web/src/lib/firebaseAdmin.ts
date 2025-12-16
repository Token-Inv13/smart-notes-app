import admin from 'firebase-admin';

let app: admin.app.App | null = null;

function getAdminApp(): admin.app.App {
  if (app) return app;

  const credentialsJson = process.env.FIREBASE_ADMIN_CREDENTIALS_JSON;
  const credentialsB64 = process.env.FIREBASE_ADMIN_CREDENTIALS_BASE64;

  let projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  let clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;

  if (credentialsJson || credentialsB64) {
    try {
      const raw = credentialsB64
        ? Buffer.from(credentialsB64, 'base64').toString('utf8')
        : credentialsJson ?? '';
      const parsed = JSON.parse(raw) as {
        project_id?: string;
        client_email?: string;
        private_key?: string;
      };

      projectId = parsed.project_id ?? projectId;
      clientEmail = parsed.client_email ?? clientEmail;
      privateKey = parsed.private_key ?? privateKey;
    } catch (e) {
      console.error('Failed to parse Firebase Admin credentials JSON', e);
      throw new Error('Invalid Firebase Admin credentials');
    }
  }

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
