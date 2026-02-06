"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { dispatchCreateTodoEvent } from "./todoEvents";

type CreateContext = "notes" | "tasks";

type Props = {
  mobileHidden?: boolean;
};

function getCreateContext(pathname: string): CreateContext {
  if (pathname.startsWith("/notes")) return "notes";
  if (pathname.startsWith("/tasks")) return "tasks";
  return "notes";
}

export default function CreateButton({ mobileHidden }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [desktopSlot, setDesktopSlot] = useState<HTMLElement | null>(null);
  const [favoritesPickerOpen, setFavoritesPickerOpen] = useState(false);

  const context = useMemo(() => getCreateContext(pathname), [pathname]);

  const shouldHide = useMemo(() => {
    if (pathname.startsWith("/notes/new") || pathname.startsWith("/tasks/new") || pathname.startsWith("/todo/new")) return true;
    if (pathname.startsWith("/settings")) return true;
    return false;
  }, [pathname]);

  const getDashboardSlideIndex = () => {
    if (typeof document === "undefined") return null;
    const el = document.getElementById("sn-create-slot");
    const raw = el?.getAttribute("data-dashboard-slide-index");
    if (raw === "0" || raw === "1" || raw === "2") return Number(raw) as 0 | 1 | 2;
    return null;
  };

  const handleClick = () => {
    if (pathname === "/dashboard") {
      const idx = getDashboardSlideIndex();
      const workspaceId = searchParams.get("workspaceId");

      if (idx === 0) {
        const qs = new URLSearchParams();
        if (workspaceId) qs.set("workspaceId", workspaceId);
        qs.set("favorite", "1");
        const href = qs.toString();
        router.push(href ? `/todo/new?${href}` : "/todo/new");
        return;
      }

      if (idx === 1) {
        const qs = new URLSearchParams();
        if (workspaceId) qs.set("workspaceId", workspaceId);
        qs.set("favorite", "1");
        const href = qs.toString();
        router.push(href ? `/notes/new?${href}` : "/notes/new");
        return;
      }

      if (idx === 2) {
        const qs = new URLSearchParams();
        if (workspaceId) qs.set("workspaceId", workspaceId);
        qs.set("favorite", "1");
        const href = qs.toString();
        router.push(href ? `/tasks/new?${href}` : "/tasks/new");
        return;
      }

      setFavoritesPickerOpen(true);
      return;
    }

    if (pathname.startsWith("/todo")) {
      dispatchCreateTodoEvent("create");
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
              const qs = new URLSearchParams();
              if (workspaceId) qs.set("workspaceId", workspaceId);
              qs.set("favorite", "1");
              const href = qs.toString();
              router.push(href ? `/notes/new?${href}` : "/notes/new");
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
              const qs = new URLSearchParams();
              if (workspaceId) qs.set("workspaceId", workspaceId);
              qs.set("favorite", "1");
              const href = qs.toString();
              router.push(href ? `/tasks/new?${href}` : "/tasks/new");
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
              if (workspaceId) qs.set("workspaceId", workspaceId);
              qs.set("favorite", "1");
              const href = qs.toString();
              router.push(href ? `/todo/new?${href}` : "/todo/new");
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
    "inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg h-12 w-12 text-2xl font-semibold select-none transition-transform active:scale-95";

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
    <div className="md:hidden fixed z-50 left-1/2 -translate-x-1/2 bottom-[calc(1rem+env(safe-area-inset-bottom))]">
      <button type="button" onClick={handleClick} aria-label="Créer" title="Créer" className={buttonBaseClass}>
        +
      </button>
    </div>
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
        {!mobileHidden && mobileFab}
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
          "hidden md:inline-flex right-8 top-24"
        }
      >
        +
      </button>
      {!mobileHidden && mobileFab}
      {favoritesPicker}
    </>
  );
}
