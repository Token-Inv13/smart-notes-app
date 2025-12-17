import admin from 'firebase-admin';

let app: admin.app.App | null = null;

function getAdminApp(): admin.app.App {
  if (app) return app;

  const rawJsonCandidate =
    process.env.FIREBASE_ADMIN_JSON ??
    process.env.FIREBASE_ADMIN_CREDENTIALS_JSON ??
    process.env.FIREBASE_ADMIN_CREDENTIALS_BASE64;

  const rawJson = rawJsonCandidate?.trim() ? rawJsonCandidate : undefined;

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;

  const normalizePrivateKey = (value: string) => {
    let normalized = value.trim();
    normalized = normalized.replace(/^"|"$/g, '');
    normalized = normalized.replace(/,$/, '');
    normalized = normalized.replace(/\r\n/g, '\n');
    normalized = normalized.replace(/\\n/g, '\n');
    return normalized;
  };

  let credential:
    | admin.credential.Credential
    | { projectId: string; clientEmail: string; privateKey: string };

  if (rawJson) {
    try {
      let raw = rawJson.trim();
      raw = raw.replace(/^"|"$/g, '');
      raw = raw.replace(/,$/, '');

      if (!raw.startsWith('{')) {
        raw = Buffer.from(raw, 'base64').toString('utf8');
      }

      const parsed = JSON.parse(raw) as {
        project_id?: string;
        client_email?: string;
        private_key?: string;
      };

      const jsonProjectId = parsed.project_id;
      const jsonClientEmail = parsed.client_email;
      const jsonPrivateKey = parsed.private_key;

      if (!jsonProjectId || !jsonClientEmail || !jsonPrivateKey) {
        throw new Error('Missing required fields in Firebase Admin JSON');
      }

      credential = {
        projectId: jsonProjectId,
        clientEmail: jsonClientEmail,
        privateKey: normalizePrivateKey(jsonPrivateKey),
      };
    } catch (e) {
      console.error('Failed to parse Firebase Admin JSON', e);
      throw new Error('Invalid Firebase Admin credentials');
    }
  } else {
    if (!projectId || !clientEmail || !privateKey) {
      const missing: string[] = [];
      if (!projectId) missing.push('FIREBASE_ADMIN_PROJECT_ID');
      if (!clientEmail) missing.push('FIREBASE_ADMIN_CLIENT_EMAIL');
      if (!privateKey) missing.push('FIREBASE_ADMIN_PRIVATE_KEY');

      throw new Error(
        `Missing Firebase Admin environment variables: ${missing.join(
          ', '
        )}. Set FIREBASE_ADMIN_JSON (recommended) or provide the 3 variables above.`
      );
    }

    credential = {
      projectId,
      clientEmail,
      privateKey: normalizePrivateKey(privateKey),
    };
  }

  if (admin.apps.length) {
    app = admin.app();
    return app;
  }

  app = admin.initializeApp({
    credential: admin.credential.cert(credential),
  });

  return app;
}

export function getAdminAuth(): admin.auth.Auth {
  return getAdminApp().auth();
}

export function getAdminDb(): admin.firestore.Firestore {
  return getAdminApp().firestore();
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
