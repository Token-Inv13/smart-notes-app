"use client";

import { useEffect, useState } from "react";
import { PanelLeft, Menu, X } from "lucide-react";
import SidebarWorkspaces from "./SidebarWorkspaces";
import PwaInstallCta from "./_components/PwaInstallCta";

const STORAGE_KEY = "sidebarCollapsed";

export default function SidebarShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === "true" || raw === "false") {
        setCollapsed(raw === "true");
      }
    } catch {
      // ignore
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const closeMobile = () => setMobileOpen(false);

  const sidebarWidthClass = collapsed ? "w-16" : "w-64";

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className={`hidden md:flex ${sidebarWidthClass} border-r border-border`}>
        <div className="w-full flex flex-col">
          <div className="p-3 flex items-center justify-between gap-2">
            <div className="min-w-0 flex items-center gap-2">
              <img
                src="/favicon.svg"
                alt="Smart Notes"
                className="h-8 w-8 rounded-md border border-border bg-background"
              />
              {!collapsed && <div className="text-sm font-semibold truncate">Smart Notes</div>}
            </div>
            <button
              type="button"
              onClick={toggleCollapsed}
              className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-border bg-background hover:bg-accent"
              aria-label={collapsed ? "Agrandir la sidebar" : "Réduire la sidebar"}
              title={collapsed ? "Agrandir" : "Réduire"}
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          </div>
          <div className="px-3 pb-3 overflow-y-auto">
            <SidebarWorkspaces
              collapsed={collapsed}
              onRequestExpand={collapsed ? () => setCollapsed(false) : undefined}
            />
          </div>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <button
            type="button"
            className="sn-drawer-backdrop absolute inset-0 bg-black/40"
            aria-label="Fermer le menu"
            onClick={closeMobile}
          />
          <div className="sn-drawer-panel absolute left-0 top-0 h-full w-72 bg-background border-r border-border">
            <div className="p-3 flex items-center justify-between border-b border-border">
              <div className="text-sm font-medium">Menu</div>
              <button
                type="button"
                onClick={closeMobile}
                className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-border bg-background hover:bg-accent"
                aria-label="Fermer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-3 overflow-y-auto h-[calc(100%-52px)]">
              <SidebarWorkspaces collapsed={false} onNavigate={closeMobile} />
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile topbar */}
        <div className="md:hidden border-b border-border p-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-border bg-background hover:bg-accent"
            aria-label="Ouvrir le menu"
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex items-center gap-2">
            <img
              src="/favicon.svg"
              alt="Smart Notes"
              className="h-7 w-7 rounded-md border border-border bg-background"
            />
            <div className="text-sm font-medium truncate">Smart Notes</div>
          </div>
        </div>

        <main className="flex-1 p-4 min-w-0">
          <PwaInstallCta />
          {children}
        </main>
      </div>
    </div>
  );
}
