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

  const context = useMemo(() => getCreateContext(pathname), [pathname]);

  const shouldHide = useMemo(() => {
    if (pathname.startsWith("/notes/new") || pathname.startsWith("/tasks/new")) return true;
    return false;
  }, [pathname]);

  const handleClick = () => {
    if (pathname.startsWith("/todo")) {
      dispatchCreateTodoEvent();
      return;
    }

    const workspaceId = searchParams.get("workspaceId");
    const hrefBase = context === "notes" ? "/notes/new" : "/tasks/new";
    const href = workspaceId ? `${hrefBase}?workspaceId=${encodeURIComponent(workspaceId)}` : hrefBase;
    router.push(href);
  };

  if (shouldHide) return null;

  const buttonBaseClass =
    "inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg h-12 w-12 text-2xl font-semibold";

  const desktopButton = (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Créer"
      title="Créer"
      className={`hidden md:${buttonBaseClass}`}
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

  if (desktopSlot) {
    return (
      <>
        {createPortal(desktopButton, desktopSlot)}
        {mobileFab}
      </>
    );
  }

  return (
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
  );
}
