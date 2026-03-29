import * as admin from 'firebase-admin';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ENC_PREFIX = 'v1:';

type IntegrationDoc = {
  connected?: boolean;
  primaryCalendarId?: string;
  tokenStorageMode?: 'encrypted';
  accessTokenEncrypted?: string;
  refreshTokenEncrypted?: string;
  accessTokenExpiresAtMs?: number;
};

type TokenRefreshResponse = {
  access_token?: string;
  expires_in?: number;
};

function getRawSecret(): string | null {
  const direct = typeof process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY === 'string'
    ? process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY.trim()
    : '';
  if (direct) return direct;

  const fallback = typeof process.env.APP_SECRET === 'string' ? process.env.APP_SECRET.trim() : '';
  return fallback || null;
}

function getEncryptionKey(): Buffer | null {
  const raw = getRawSecret();
  if (!raw) return null;
  return createHash('sha256').update(raw).digest();
}

function hasGoogleTokenEncryptionKey(): boolean {
  return Boolean(getEncryptionKey());
}

function decryptGoogleToken(value: string): string | null {
  if (!value || !value.startsWith(ENC_PREFIX)) return null;

  const key = getEncryptionKey();
  if (!key) return null;

  const raw = value.slice(ENC_PREFIX.length);
  const [ivB64, authTagB64, dataB64] = raw.split(':');
  if (!ivB64 || !authTagB64 || !dataB64) return null;

  try {
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

function encryptGoogleToken(value: string): string | null {
  if (!value) return null;

  const key = getEncryptionKey();
  if (!key) return null;

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENC_PREFIX}${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

function resolveStoredToken(encryptedValue: string | undefined): string | null {
  if (typeof encryptedValue === 'string' && encryptedValue.length > 0) {
    return decryptGoogleToken(encryptedValue);
  }
  return null;
}

function sanitizeIso(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function sanitizeDateOnly(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function sanitizeOptionalTimeZone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function buildGoogleEventPayload(input: {
  title: string;
  start: unknown;
  end: unknown;
  allDay: boolean;
  timeZone: string | null;
}) {
  const { title, start, end, allDay, timeZone } = input;

  if (allDay) {
    const startDate = sanitizeDateOnly(start);
    const endDate = sanitizeDateOnly(end);
    if (!startDate || !endDate) return null;
    return {
      summary: title,
      start: { date: startDate },
      end: { date: endDate },
    };
  }

  const startDateTime = sanitizeIso(typeof start === 'string' ? start : null);
  const endDateTime = sanitizeIso(typeof end === 'string' ? end : null);
  if (!startDateTime || !endDateTime) return null;

  return {
    summary: title,
    start: timeZone ? { dateTime: startDateTime, timeZone } : { dateTime: startDateTime },
    end: timeZone ? { dateTime: endDateTime, timeZone } : { dateTime: endDateTime },
  };
}

async function refreshAccessTokenIfNeeded(input: {
  integration: IntegrationDoc;
  userId: string;
  requestId?: string;
  contextLabel: string;
}): Promise<string | null> {
  const { integration, userId, requestId, contextLabel } = input;

  if (!hasGoogleTokenEncryptionKey()) {
    console.error('google.calendar.task_sync.service_unavailable', {
      reason: 'missing_token_encryption_key',
      uid: userId,
      requestId,
      contextLabel,
    });
    return null;
  }

  const nowMs = Date.now();
  const currentAccessToken = resolveStoredToken(integration.accessTokenEncrypted);
  const currentRefreshToken = resolveStoredToken(integration.refreshTokenEncrypted);
  const expiresAtMs = typeof integration.accessTokenExpiresAtMs === 'number' ? integration.accessTokenExpiresAtMs : null;

  const stillValid = typeof expiresAtMs === 'number' && expiresAtMs > nowMs + 30_000;
  if (currentAccessToken && stillValid) {
    return currentAccessToken;
  }

  if (!currentRefreshToken) {
    return currentAccessToken;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    console.error('google.calendar.task_sync.service_unavailable', {
      reason: 'missing_google_client_id',
      uid: userId,
      requestId,
      contextLabel,
    });
    return currentAccessToken;
  }

  const refreshPayload = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: currentRefreshToken,
  });
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (clientSecret) {
    refreshPayload.set('client_secret', clientSecret);
  }

  const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: refreshPayload.toString(),
    cache: 'no-store',
  });

  if (!refreshRes.ok) {
    console.warn('google.calendar.task_sync.refresh_failed', {
      uid: userId,
      requestId,
      contextLabel,
      status: refreshRes.status,
    });
    return currentAccessToken;
  }

  const refreshJson = (await refreshRes.json()) as TokenRefreshResponse;
  const refreshedAccessToken = typeof refreshJson.access_token === 'string' ? refreshJson.access_token : null;
  if (!refreshedAccessToken) {
    console.warn('google.calendar.task_sync.refresh_missing_token', {
      uid: userId,
      requestId,
      contextLabel,
    });
    return currentAccessToken;
  }

  const expiresIn = typeof refreshJson.expires_in === 'number' ? refreshJson.expires_in : 3600;
  const updatedExpiresAtMs = Date.now() + Math.max(60, expiresIn) * 1000;

  const db = admin.firestore();
  const ref = db.collection('users').doc(userId).collection('assistantIntegrations').doc('googleCalendar');

  const encryptedAccessToken = encryptGoogleToken(refreshedAccessToken);
  const encryptedRefreshToken = encryptGoogleToken(currentRefreshToken);
  if (!encryptedAccessToken) {
    console.error('google.calendar.task_sync.service_unavailable', {
      reason: 'token_encryption_failed',
      uid: userId,
      requestId,
      contextLabel,
    });
    return currentAccessToken;
  }

  await ref.set(
    {
      tokenStorageMode: 'encrypted',
      accessTokenEncrypted: encryptedAccessToken,
      ...(encryptedRefreshToken ? { refreshTokenEncrypted: encryptedRefreshToken } : {}),
      accessToken: admin.firestore.FieldValue.delete(),
      refreshToken: admin.firestore.FieldValue.delete(),
      accessTokenExpiresAtMs: updatedExpiresAtMs,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return refreshedAccessToken;
}

export async function syncTaskToGoogleCalendar(params: {
  userId: string;
  title: string;
  start: unknown;
  end: unknown;
  allDay: boolean;
  timeZone?: unknown;
  taskId: string;
  requestId?: string;
  contextLabel: string;
}): Promise<{ created: boolean; eventId: string | null }> {
  const { userId, title, start, end, allDay, timeZone, taskId, requestId, contextLabel } = params;

  const db = admin.firestore();
  const ref = db.collection('users').doc(userId).collection('assistantIntegrations').doc('googleCalendar');
  const snap = await ref.get();

  if (!snap.exists) {
    return { created: false, eventId: null };
  }

  const integration = snap.data() as IntegrationDoc;
  if (integration.connected !== true) {
    return { created: false, eventId: null };
  }

  const accessToken = await refreshAccessTokenIfNeeded({ integration, userId, requestId, contextLabel });
  if (!accessToken) {
    return { created: false, eventId: null };
  }

  const googlePayload = buildGoogleEventPayload({
    title: title.trim(),
    start,
    end,
    allDay,
    timeZone: sanitizeOptionalTimeZone(timeZone),
  });

  if (!googlePayload) {
    console.warn('google.calendar.task_sync.invalid_payload', {
      uid: userId,
      requestId,
      contextLabel,
      taskId,
    });
    return { created: false, eventId: null };
  }

  const calendarId = typeof integration.primaryCalendarId === 'string' && integration.primaryCalendarId
    ? integration.primaryCalendarId
    : 'primary';

  const createRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(googlePayload),
      cache: 'no-store',
    },
  );

  if (!createRes.ok) {
    console.warn('google.calendar.task_sync.create_failed', {
      uid: userId,
      requestId,
      contextLabel,
      taskId,
      status: createRes.status,
    });
    return { created: false, eventId: null };
  }

  const createdJson = (await createRes.json()) as { id?: unknown };
  const eventId = typeof createdJson.id === 'string' && createdJson.id.trim() ? createdJson.id.trim() : null;
  if (!eventId) {
    console.warn('google.calendar.task_sync.create_missing_event_id', {
      uid: userId,
      requestId,
      contextLabel,
      taskId,
    });
    return { created: false, eventId: null };
  }

  console.info('google.calendar.task_sync.created', {
    uid: userId,
    requestId,
    contextLabel,
    taskId,
    eventId,
  });

  return { created: true, eventId };
}
