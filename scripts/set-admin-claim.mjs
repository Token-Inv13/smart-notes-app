#!/usr/bin/env node
import admin from 'firebase-admin';

function readArg(name) {
  const prefix = `--${name}=`;
  const item = process.argv.find((arg) => arg.startsWith(prefix));
  if (!item) return null;
  return item.slice(prefix.length).trim() || null;
}

function normalizePrivateKey(value) {
  return value.trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '').replace(/\r\n/g, '\n').replace(/\\n/g, '\n');
}

function loadServiceAccount() {
  const rawJsonCandidate =
    process.env.FIREBASE_ADMIN_JSON ??
    process.env.FIREBASE_ADMIN_CREDENTIALS_JSON ??
    process.env.FIREBASE_ADMIN_CREDENTIALS_BASE64;

  if (rawJsonCandidate && rawJsonCandidate.trim()) {
    let raw = rawJsonCandidate.trim().replace(/^"|"$/g, '');
    if (!raw.startsWith('{')) {
      raw = Buffer.from(raw, 'base64').toString('utf8');
    }
    const parsed = JSON.parse(raw);
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      throw new Error('Invalid FIREBASE_ADMIN_JSON payload.');
    }
    return {
      projectId: String(parsed.project_id),
      clientEmail: String(parsed.client_email),
      privateKey: normalizePrivateKey(String(parsed.private_key)),
    };
  }

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return {
    projectId,
    clientEmail,
    privateKey: normalizePrivateKey(privateKey),
  };
}

async function main() {
  const uid = readArg('uid');
  const email = readArg('email');

  if (!uid && !email) {
    throw new Error('Usage: node scripts/set-admin-claim.mjs --uid=<firebase_uid> OR --email=<email> [--disable=true]');
  }

  const disable = readArg('disable') === 'true';
  const creds = loadServiceAccount();

  if (!admin.apps.length) {
    if (creds) {
      admin.initializeApp({
        credential: admin.credential.cert(creds),
      });
    } else {
      // Fallback for local environments already authenticated via firebase/gcloud CLI.
      admin.initializeApp();
    }
  }

  const auth = admin.auth();
  const userRecord = uid ? await auth.getUser(uid) : await auth.getUserByEmail(email);

  const claims = { ...(userRecord.customClaims ?? {}) };
  if (disable) {
    delete claims.admin;
  } else {
    claims.admin = true;
  }

  await auth.setCustomUserClaims(userRecord.uid, claims);

  console.log(
    JSON.stringify(
      {
        ok: true,
        uid: userRecord.uid,
        email: userRecord.email,
        admin: disable ? false : true,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
