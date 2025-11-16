"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        <div>Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <aside className="w-64 border-r border-border p-4">Sidebar</aside>
      <div className="flex-1 flex flex-col">
        <header className="h-14 border-b border-border px-4 flex items-center justify-between">
          <div>Topbar</div>
        </header>
        <main className="flex-1 p-4">{children}</main>
      </div>
    </div>
  );
}
