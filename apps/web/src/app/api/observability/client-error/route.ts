import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebaseAdmin';
import { logServerError, logServerWarn } from '@/lib/observability';

type ClientErrorPayload = {
  eventName?: unknown;
  severity?: unknown;
  message?: unknown;
  stack?: unknown;
  route?: unknown;
  uidHash?: unknown;
  source?: unknown;
  kind?: unknown;
  env?: unknown;
  appVersion?: unknown;
  meta?: unknown;
};

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function clampString(value: string, max = 2000) {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export async function POST(request: Request) {
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
  try {
    const raw = (await request.json()) as ClientErrorPayload;

    const severity = asString(raw.severity, 'error') === 'warn' ? 'warn' : 'error';
    const eventName = clampString(asString(raw.eventName, 'frontend.client_error'), 120);
    const message = clampString(asString(raw.message, 'Unknown client error'));
    const route = clampString(asString(raw.route, 'unknown'), 300);
    const uidHash = clampString(asString(raw.uidHash, 'anonymous'), 80);
    const source = clampString(asString(raw.source, 'web'), 80);
    const kind = clampString(asString(raw.kind, 'client'), 80);
    const env = clampString(asString(raw.env, process.env.NODE_ENV ?? 'development'), 40);
    const appVersion = clampString(asString(raw.appVersion, 'unknown'), 120);
    const stack = clampString(asString(raw.stack, ''), 4000);
    const meta = asObject(raw.meta);

    const payload = {
      requestId,
      eventName,
      severity,
      message,
      route,
      uidHash,
      source,
      kind,
      env,
      appVersion,
      stack,
      meta,
    };

    if (severity === 'warn') {
      logServerWarn('frontend.client_error.reported', payload);
    } else {
      logServerError('frontend.client_error.reported', payload);
    }

    const db = getAdminDb();
    await db.collection('appErrorLogs').add({
      source: 'web',
      category: 'functions',
      scope: eventName,
      code: kind,
      message,
      severity,
      context: {
        requestId,
        route,
        uidHash,
        source,
        env,
        appVersion,
        stack,
        meta,
      },
      createdAt: new Date(),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logServerError('frontend.client_error.ingest_failed', { requestId, error });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
