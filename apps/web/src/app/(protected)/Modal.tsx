"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface ModalProps {
  title?: string;
  children: React.ReactNode;
}

export default function Modal({ title, children }: ModalProps) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement | null>(null);

  const close = () => {
    if (typeof window !== "undefined" && window.history.length <= 1) {
      router.push("/dashboard");
      return;
    }
    router.back();
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();

    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title ?? "Dialog"}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-full max-w-2xl rounded-lg border border-border bg-card shadow-lg outline-none"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            {title ? <div className="text-sm font-semibold truncate">{title}</div> : null}
          </div>
          <button
            type="button"
            onClick={close}
            className="sn-icon-btn"
            aria-label="Fermer"
            title="Fermer"
          >
            ×
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
