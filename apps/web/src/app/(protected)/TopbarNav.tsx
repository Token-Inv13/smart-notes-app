"use client";

import { usePathname, useSearchParams } from "next/navigation";

export default function TopbarNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId");
  const suffix = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";

  const isActive = (href: string) => pathname.startsWith(href);

  return (
    <nav className="flex items-center gap-2">
      <a
        className={`border border-border rounded px-3 py-1 bg-background ${
          isActive("/dashboard") ? "font-semibold" : ""
        }`}
        href={`/dashboard${suffix}`}
      >
        Dashboard
      </a>
      <a
        className={`border border-border rounded px-3 py-1 bg-background ${
          isActive("/notes") ? "font-semibold" : ""
        }`}
        href={`/notes${suffix}`}
      >
        Notes
      </a>
      <a
        className={`border border-border rounded px-3 py-1 bg-background ${
          isActive("/tasks") ? "font-semibold" : ""
        }`}
        href={`/tasks${suffix}`}
      >
        Tasks
      </a>
    </nav>
  );
}
