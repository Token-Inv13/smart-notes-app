"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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

  const context = useMemo(() => getCreateContext(pathname), [pathname]);

  const shouldHide = useMemo(() => {
    if (pathname.startsWith("/notes/new") || pathname.startsWith("/tasks/new")) return true;
    return false;
  }, [pathname]);

  const handleClick = () => {
    const workspaceId = searchParams.get("workspaceId");
    const hrefBase = context === "notes" ? "/notes/new" : "/tasks/new";
    const href = workspaceId ? `${hrefBase}?workspaceId=${encodeURIComponent(workspaceId)}` : hrefBase;
    router.push(href);
  };

  if (shouldHide) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Créer"
      title="Créer"
      className={
        "fixed z-50 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg " +
        "h-12 w-12 text-2xl font-semibold " +
        "right-4 bottom-4 md:bottom-auto md:top-24 md:right-8"
      }
    >
      +
    </button>
  );
}
