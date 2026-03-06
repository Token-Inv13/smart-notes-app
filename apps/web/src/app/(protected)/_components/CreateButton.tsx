"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

type Props = {
  mobileHidden?: boolean;
  renderCustomTrigger?: (args: {
    onClick: () => void;
    className: string;
    ariaLabel: string;
    title: string;
  }) => ReactNode;
};

function toLocalDateInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isMainCreationView(pathname: string) {
  return pathname === "/dashboard" || pathname === "/notes" || pathname === "/tasks" || pathname === "/todo";
}

export default function CreateButton({ mobileHidden, renderCustomTrigger }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [favoritesPickerOpen, setFavoritesPickerOpen] = useState(false);

  const shouldHide = (() => {
    if (pathname.startsWith("/notes/new") || pathname.startsWith("/tasks/new") || pathname.startsWith("/todo/new")) return true;
    if (pathname.startsWith("/settings")) return true;
    if (pathname.startsWith("/upgrade")) return true;
    return false;
  })();

  const handleClick = () => {
    if (isMainCreationView(pathname)) {
      setFavoritesPickerOpen(true);
      return;
    }

    if (pathname.startsWith("/todo")) {
      const workspaceId = searchParams.get("workspaceId");
      const qs = new URLSearchParams();
      if (workspaceId) qs.set("workspaceId", workspaceId);
      const href = qs.toString();
      router.push(href ? `/todo/new?${href}` : "/todo/new");
      return;
    }

    const workspaceId = searchParams.get("workspaceId");
    const qs = new URLSearchParams();
    if (workspaceId) qs.set("workspaceId", workspaceId);
    const href = qs.toString();
    router.push(href ? `/notes/new?${href}` : "/notes/new");
  };

  const favoritesPicker = favoritesPickerOpen ? (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background/75 backdrop-blur-[2px] px-4 py-6"
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
              if (pathname === "/dashboard") qs.set("favorite", "1");
              const href = qs.toString();
              router.push(href ? `/notes/new?${href}` : "/notes/new");
            }}
          >
            Nouvelle note
          </button>

          <button
            type="button"
            className="w-full px-3 py-2 rounded-md border border-input text-sm text-left"
            onClick={() => {
              const workspaceId = searchParams.get("workspaceId");
              setFavoritesPickerOpen(false);
              const qs = new URLSearchParams();
              if (workspaceId) qs.set("workspaceId", workspaceId);
              if (pathname === "/dashboard") qs.set("favorite", "1");
              if (pathname.startsWith("/tasks")) {
                qs.set("startDate", toLocalDateInputValue(new Date()));
              }
              const href = qs.toString();
              router.push(href ? `/tasks/new?${href}` : "/tasks/new");
            }}
          >
            Nouvelle tâche
          </button>

          <button
            type="button"
            className="w-full px-3 py-2 rounded-md border border-input text-sm text-left"
            onClick={() => {
              const workspaceId = searchParams.get("workspaceId");
              setFavoritesPickerOpen(false);
              const qs = new URLSearchParams();
              if (workspaceId) qs.set("workspaceId", workspaceId);
              if (pathname === "/dashboard") qs.set("favorite", "1");
              const href = qs.toString();
              router.push(href ? `/todo/new?${href}` : "/todo/new");
            }}
          >
            Nouvelle checklist
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

  const customTrigger = renderCustomTrigger
    ? renderCustomTrigger({
        onClick: handleClick,
        className: buttonBaseClass,
        ariaLabel: "Créer",
        title: "Créer",
      })
    : null;

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

  const desktopSlot = (() => {
    if (typeof document === "undefined") return null;
    return document.getElementById("sn-create-slot");
  })();
  const canPortal = !!desktopSlot && desktopSlot.isConnected;

  if (shouldHide) return null;

  if (renderCustomTrigger) {
    return (
      <>
        {customTrigger}
        {favoritesPicker}
      </>
    );
  }

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
