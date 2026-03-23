"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface ModalProps {
  title?: string;
  children: React.ReactNode | ((ctx: { close: () => void }) => React.ReactNode);
  onBeforeClose?: () => void | boolean | Promise<void | boolean>;
  hideHeader?: boolean;
  fallbackHref?: string;
  fullscreen?: boolean;
}

export default function Modal({
  title,
  children,
  onBeforeClose,
  hideHeader = false,
  fallbackHref = "/dashboard",
  fullscreen = false,
}: ModalProps) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const hasPriorHistoryRef = useRef(false);
  const historyGuardIdRef = useRef(`sn-modal-${Math.random().toString(36).slice(2)}-${Date.now()}`);
  const ignoreNextPopRef = useRef(false);
  const closeInFlightRef = useRef(false);

  const runBeforeClose = useCallback(async () => {
    if (onBeforeClose) {
      try {
        const result = await onBeforeClose();
        return result !== false;
      } catch {
        return false;
      }
    }
    return true;
  }, [onBeforeClose]);

  const navigateAfterClose = useCallback((source: "direct" | "popstate") => {
    if (typeof window === "undefined") {
      router.push(fallbackHref);
      return;
    }

    if (source === "popstate") {
      if (hasPriorHistoryRef.current) {
        ignoreNextPopRef.current = true;
        router.back();
        return;
      }
      router.push(fallbackHref);
      return;
    }

    if (hasPriorHistoryRef.current) {
      ignoreNextPopRef.current = true;
      window.history.go(-2);
      return;
    }

    router.push(fallbackHref);
  }, [fallbackHref, router]);

  const restoreHistoryGuard = useCallback(() => {
    if (typeof window === "undefined") return;
    const state = typeof window.history.state === "object" && window.history.state !== null ? window.history.state : {};
    window.history.pushState(
      { ...state, __snModalGuard: historyGuardIdRef.current },
      "",
      window.location.href,
    );
  }, []);

  const close = useCallback(async (source: "direct" | "popstate" = "direct") => {
    if (closeInFlightRef.current) return;
    closeInFlightRef.current = true;

    try {
      const canClose = await runBeforeClose();
      if (!canClose) {
        if (source === "popstate") {
          restoreHistoryGuard();
        }
        return;
      }

      navigateAfterClose(source);
    } finally {
      closeInFlightRef.current = false;
    }
  }, [navigateAfterClose, restoreHistoryGuard, runBeforeClose]);

  const content = typeof children === "function" ? children({ close: () => void close() }) : children;

  useEffect(() => {
    hasPriorHistoryRef.current = window.history.length > 1;
    restoreHistoryGuard();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        void close();
      }
    };

    const onPopState = () => {
      if (ignoreNextPopRef.current) {
        ignoreNextPopRef.current = false;
        return;
      }

      void close("popstate");
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("popstate", onPopState);
    panelRef.current?.focus();

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("popstate", onPopState);
    };
  }, [close, restoreHistoryGuard]);

  const wrapperClassName = fullscreen
    ? "fixed inset-0 z-50 overflow-y-auto bg-background px-4 py-6"
    : "fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-6 sm:items-center";

  const panelClassName = fullscreen
    ? "my-auto flex h-full max-h-[calc(100dvh-3rem)] w-full flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg outline-none"
    : "my-auto flex w-full max-w-2xl max-h-[calc(100dvh-3rem)] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg outline-none";

  return (
    <div
      className={wrapperClassName}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) void close();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title ?? "Dialog"}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={panelClassName}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {!hideHeader && (
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              {title ? <div className="text-sm font-semibold truncate">{title}</div> : null}
            </div>
            <button
              type="button"
              onClick={() => void close()}
              className="sn-icon-btn"
              aria-label="Fermer"
              title="Fermer"
            >
              ×
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{content}</div>
      </div>
    </div>
  );
}
