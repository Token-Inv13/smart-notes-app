"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { dispatchCreateTodoEvent } from "./todoEvents";

type CreateContext = "notes" | "tasks";

function getCreateContext(pathname: string): CreateContext {
  if (pathname.startsWith("/notes")) return "notes";
  if (pathname.startsWith("/tasks") || pathname.startsWith("/todo")) return "tasks";
  return "notes";
}

export default function CreateButton() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [desktopSlot, setDesktopSlot] = useState<HTMLElement | null>(null);
  const [favoritesPickerOpen, setFavoritesPickerOpen] = useState(false);

  const context = useMemo(() => getCreateContext(pathname), [pathname]);

  const shouldHide = useMemo(() => {
    if (pathname.startsWith("/notes/new") || pathname.startsWith("/tasks/new")) return true;
    return false;
  }, [pathname]);

  const handleClick = () => {
    if (pathname === "/dashboard") {
      setFavoritesPickerOpen(true);
      return;
    }

    if (pathname.startsWith("/todo")) {
      const todoId = searchParams.get("todoId");
      dispatchCreateTodoEvent(todoId ? "add_item" : "create");
      return;
    }

    const workspaceId = searchParams.get("workspaceId");
    const hrefBase = context === "notes" ? "/notes/new" : "/tasks/new";
    const href = workspaceId ? `${hrefBase}?workspaceId=${encodeURIComponent(workspaceId)}` : hrefBase;
    router.push(href);
  };

  const favoritesPicker = favoritesPickerOpen ? (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4 py-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setFavoritesPickerOpen(false);
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Choisir le type de saisie"
    >
      <div
        className="w-full max-w-xs rounded-lg border border-border bg-card shadow-lg p-3"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-semibold mb-2">Créer…</div>
        <div className="space-y-2">
          <button
            type="button"
            className="w-full px-3 py-2 rounded-md border border-input text-sm text-left"
            onClick={() => {
              const workspaceId = searchParams.get("workspaceId");
              setFavoritesPickerOpen(false);
              const href = workspaceId
                ? `/notes/new?workspaceId=${encodeURIComponent(workspaceId)}`
                : "/notes/new";
              router.push(href);
            }}
          >
            Note
          </button>

          <button
            type="button"
            className="w-full px-3 py-2 rounded-md border border-input text-sm text-left"
            onClick={() => {
              const workspaceId = searchParams.get("workspaceId");
              setFavoritesPickerOpen(false);
              const href = workspaceId
                ? `/tasks/new?workspaceId=${encodeURIComponent(workspaceId)}`
                : "/tasks/new";
              router.push(href);
            }}
          >
            Tâche
          </button>

          <button
            type="button"
            className="w-full px-3 py-2 rounded-md border border-input text-sm text-left"
            onClick={() => {
              const workspaceId = searchParams.get("workspaceId");
              setFavoritesPickerOpen(false);
              const qs = new URLSearchParams();
              qs.set("create", "1");
              if (workspaceId) qs.set("workspaceId", workspaceId);
              router.push(`/todo?${qs.toString()}`);
            }}
          >
            ToDo
          </button>
        </div>

        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => setFavoritesPickerOpen(false)}
            className="px-3 py-2 rounded-md text-sm"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const buttonBaseClass =
    "inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg h-12 w-12 text-2xl font-semibold";

  const desktopButton = (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Créer"
      title="Créer"
      className={`hidden md:inline-flex ${buttonBaseClass}`}
    >
      +
    </button>
  );

  const mobileFab = (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Créer"
      title="Créer"
      className={
        `md:hidden fixed z-50 ${buttonBaseClass} ` +
        "left-1/2 -translate-x-1/2 bottom-[calc(1rem+env(safe-area-inset-bottom))]"
      }
    >
      +
    </button>
  );

  // If a page provides a header slot, render the desktop button inside it (no floating on desktop).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = document.getElementById("sn-create-slot");
    setDesktopSlot(el);
  }, [pathname]);

  const canPortal = !!desktopSlot && desktopSlot.isConnected;

  if (shouldHide) return null;

  if (canPortal) {
    return (
      <>
        {createPortal(desktopButton, desktopSlot)}
        {mobileFab}
        {favoritesPicker}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-label="Créer"
        title="Créer"
        className={
          `fixed z-50 ${buttonBaseClass} ` +
          "right-4 bottom-4 md:bottom-auto md:top-24 md:right-8"
        }
      >
        +
      </button>
      {favoritesPicker}
    </>
  );
}
