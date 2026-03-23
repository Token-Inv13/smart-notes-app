"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface ModalProps {
  title?: string;
  ariaLabel?: string;
  children: React.ReactNode | ((ctx: { close: () => void }) => React.ReactNode);
  onBeforeClose?: () => void | boolean | Promise<void | boolean>;
  hideHeader?: boolean;
  fallbackHref?: string;
  fullscreen?: boolean;
}

export default function Modal({
  title,
  ariaLabel,
  children,
  onBeforeClose,
  hideHeader = false,
  fallbackHref = "/dashboard",
  fullscreen = false,
}: ModalProps) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement | null>(null);

  const close = async () => {
    if (onBeforeClose) {
      try {
        const result = await onBeforeClose();
        if (result === false) return;
      } catch {
        return;
      }
    }

    if (typeof window !== "undefined" && window.history.length <= 1) {
      router.push(fallbackHref);
      return;
    }
    router.back();
  };

  const content = typeof children === "function" ? children({ close: () => void close() }) : children;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        void close();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();

    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      aria-label={ariaLabel ?? title ?? "Dialog"}
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
