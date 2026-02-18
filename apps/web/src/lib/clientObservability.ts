"use client";

import { auth } from "@/lib/firebase";

type ClientSeverity = "error" | "warn";

type ClientErrorPayload = {
  eventName: string;
  severity?: ClientSeverity;
  message: string;
  stack?: string;
  route?: string;
  uidHash?: string;
  source?: string;
  kind?: string;
  env?: string;
  appVersion?: string;
  meta?: Record<string, unknown>;
};

const APP_VERSION =
  process.env.NEXT_PUBLIC_APP_VERSION ?? process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "dev";

function currentRoute() {
  if (typeof window === "undefined") return "server";
  return `${window.location.pathname}${window.location.search}`;
}

function hashUid(uid: string): string {
  let hash = 2166136261;
  for (let i = 0; i < uid.length; i += 1) {
    hash ^= uid.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return `u_${(hash >>> 0).toString(16)}`;
}

function getUidHash() {
  const uid = auth.currentUser?.uid;
  if (!uid) return "anonymous";
  return hashUid(uid);
}

function normalizeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: typeof error === "string" ? error : "Unknown client error",
  };
}

export async function captureClientError(input: ClientErrorPayload) {
  const payload = {
    eventName: input.eventName,
    severity: input.severity ?? "error",
    message: input.message,
    stack: input.stack,
    route: input.route ?? currentRoute(),
    uidHash: input.uidHash ?? getUidHash(),
    source: input.source ?? "web",
    kind: input.kind ?? "client",
    env: input.env ?? (process.env.NODE_ENV ?? "development"),
    appVersion: input.appVersion ?? APP_VERSION,
    meta: input.meta ?? {},
  };

  if (payload.severity === "error") {
    console.error("client.error", payload);
  } else {
    console.warn("client.warn", payload);
  }

  try {
    await fetch("/api/observability/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Best effort only.
  }
}

export async function observeCaughtError(eventName: string, error: unknown, meta?: Record<string, unknown>) {
  const normalized = normalizeError(error);
  await captureClientError({
    eventName,
    message: normalized.message,
    stack: normalized.stack,
    meta,
  });
}

export function installGlobalErrorHandlers() {
  if (typeof window === "undefined") {
    return () => {
      // noop
    };
  }

  const onError = (event: ErrorEvent) => {
    void captureClientError({
      eventName: "frontend.window_error",
      kind: "window.onerror",
      message: event.message || "Unhandled window error",
      stack: event.error instanceof Error ? event.error.stack : undefined,
      meta: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const normalized = normalizeError(event.reason);
    void captureClientError({
      eventName: "frontend.unhandled_rejection",
      kind: "unhandledrejection",
      message: normalized.message,
      stack: normalized.stack,
    });
  };

  const nativeFetch = window.fetch.bind(window);
  const observedFetch: typeof window.fetch = async (input, init) => {
    const startedAt = Date.now();
    const response = await nativeFetch(input, init);

    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const isCritical =
        url.includes("/api/stripe") ||
        url.includes("/api/google/calendar") ||
        url.includes("cloudfunctions.net") ||
        url.includes("assistant");

      if (isCritical && response.status >= 500) {
        void captureClientError({
          eventName: "frontend.network_critical_5xx",
          kind: "fetch",
          message: `Critical network request failed with ${response.status}`,
          meta: {
            status: response.status,
            url,
            durationMs: Date.now() - startedAt,
          },
        });
      }
    } catch {
      // ignore
    }

    return response;
  };

  window.fetch = observedFetch;
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  return () => {
    window.fetch = nativeFetch;
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}
