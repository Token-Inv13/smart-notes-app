import { NextResponse } from 'next/server';
import { logServerError, logServerInfo, logServerWarn } from '@/lib/observability';

type ApiObserveContext = {
  eventName: string;
  route: string;
  requestId: string;
  startMs: number;
  uid: string;
};

function safeString(value: unknown, fallback = 'unknown') {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

export function beginApiObserve(input: {
  eventName: string;
  route: string;
  requestId?: string | null;
  uid?: string | null;
}) {
  const ctx: ApiObserveContext = {
    eventName: safeString(input.eventName),
    route: safeString(input.route),
    requestId: safeString(input.requestId, crypto.randomUUID()),
    startMs: Date.now(),
    uid: safeString(input.uid, 'anonymous'),
  };

  logServerInfo('api.request.started', {
    eventName: ctx.eventName,
    route: ctx.route,
    requestId: ctx.requestId,
    uid: ctx.uid,
  });

  return ctx;
}

export function endApiObserve(ctx: ApiObserveContext, status: number, extra?: Record<string, unknown>) {
  const durationMs = Date.now() - ctx.startMs;
  const payload = {
    eventName: ctx.eventName,
    route: ctx.route,
    requestId: ctx.requestId,
    uid: ctx.uid,
    status,
    durationMs,
    ...(extra ?? {}),
  };

  if (status >= 500) {
    logServerError('api.request.failed', payload);
    logServerWarn('ops.metric.api_5xx', {
      route: ctx.route,
      eventName: ctx.eventName,
      requestId: ctx.requestId,
      uid: ctx.uid,
      status,
      durationMs,
      count: 1,
    });
    return;
  }

  if (status >= 400) {
    logServerWarn('api.request.warn', payload);
    return;
  }

  logServerInfo('api.request.completed', payload);
}

export function observedJson<T>(ctx: ApiObserveContext, body: T, init?: ResponseInit, extra?: Record<string, unknown>) {
  const status = typeof init?.status === 'number' ? init.status : 200;
  endApiObserve(ctx, status, extra);
  return NextResponse.json(body, init);
}

export function observedText(ctx: ApiObserveContext, body: string, init?: ResponseInit, extra?: Record<string, unknown>) {
  const status = typeof init?.status === 'number' ? init.status : 200;
  endApiObserve(ctx, status, extra);
  return new NextResponse(body, init);
}

export function observedError(ctx: ApiObserveContext, error: unknown, extra?: Record<string, unknown>) {
  logServerError('api.request.exception', {
    eventName: ctx.eventName,
    route: ctx.route,
    requestId: ctx.requestId,
    uid: ctx.uid,
    error,
    ...(extra ?? {}),
  });
}
