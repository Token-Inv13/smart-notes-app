"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { PanelLeft, Menu, X } from "lucide-react";
import SidebarWorkspaces from "./SidebarWorkspaces";
import PwaInstallCta from "./_components/PwaInstallCta";
import CreateButton from "./_components/CreateButton";
import SmartActionDock from "./_components/SmartActionDock";
import VoiceAgentButton from "./_components/assistant/VoiceAgentButton";
import { useUserWorkspaces } from "@/hooks/useUserWorkspaces";
import { useAuth } from "@/hooks/useAuth";
import { invalidateAuthSession } from "@/lib/authInvalidation";
import { useAssistantSettings } from "@/hooks/useAssistantSettings";
import { useUserAssistantSuggestions } from "@/hooks/useUserAssistantSuggestions";
import type { WorkspaceDoc } from "@/types/firestore";

const STORAGE_KEY = "sidebarCollapsed";
const ASSISTANT_NOTIF_STORAGE_KEY = "assistantProactiveNotifications";
function isActionableKind(kind: string): kind is "create_task" | "create_reminder" | "create_task_bundle" {
  return kind === "create_task" || kind === "create_reminder" || kind === "create_task_bundle";
}

type ProactiveSuggestionBanner = {
  suggestionId: string;
  title: string;
  explanation: string;
};

function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toMinutes(hhmm: string, fallback: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return fallback;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return fallback;
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return fallback;
  return h * 60 + mm;
}

function isWithinQuietHours(now: Date, startRaw?: string, endRaw?: string): boolean {
  const start = toMinutes(typeof startRaw === "string" ? startRaw : "22:00", 22 * 60);
  const end = toMinutes(typeof endRaw === "string" ? endRaw : "08:00", 8 * 60);
  const current = now.getHours() * 60 + now.getMinutes();
  if (start === end) return false;
  if (start < end) {
    return current >= start && current < end;
  }
  return current >= start || current < end;
}

function reserveDailyNotificationBudget(suggestionId: string, maxPerDay: number): boolean {
  const today = localDayKey(new Date());
  try {
    const raw = window.localStorage.getItem(ASSISTANT_NOTIF_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as { dayKey?: unknown; shownIds?: unknown; count?: unknown }) : null;

    const dayKey = parsed && typeof parsed.dayKey === "string" ? parsed.dayKey : today;
    const shownIds = parsed && Array.isArray(parsed.shownIds) ? parsed.shownIds.filter((v): v is string => typeof v === "string") : [];
    const countRaw = parsed && typeof parsed.count === "number" && Number.isFinite(parsed.count) ? parsed.count : shownIds.length;

    const resetForToday = dayKey !== today;
    const baseIds = resetForToday ? [] : shownIds;
    const baseCount = resetForToday ? 0 : Math.max(0, Math.trunc(countRaw));

    if (baseIds.includes(suggestionId)) return false;
    if (baseCount >= maxPerDay) return false;

    const next = {
      dayKey: today,
      shownIds: [...baseIds, suggestionId],
      count: baseCount + 1,
    };
    window.localStorage.setItem(ASSISTANT_NOTIF_STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

export default function SidebarShell({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const workspaceId = searchParams.get("workspaceId");
  const { user, loading: authLoading } = useAuth();
  const { data: assistantSettings } = useAssistantSettings();
  const { data: assistantSuggestions } = useUserAssistantSuggestions({ limit: 20 });
  const [authInvalidating, setAuthInvalidating] = useState(false);
  const { data: workspaces, loading: workspacesLoading, error: workspacesError } = useUserWorkspaces();
  const [proactiveBanner, setProactiveBanner] = useState<ProactiveSuggestionBanner | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (user) return;
    setAuthInvalidating(true);
    void invalidateAuthSession();
  }, [authLoading, user]);

  const baseSortedWorkspaces = useMemo(() => {
    return workspaces
      .slice()
      .sort((a, b) => {
        const ao = typeof a.order === "number" ? a.order : null;
        const bo = typeof b.order === "number" ? b.order : null;
        if (ao !== null && bo !== null && ao !== bo) return ao - bo;
        if (ao !== null && bo === null) return -1;
        if (ao === null && bo !== null) return 1;
        return (a.name || "").localeCompare(b.name || "");
      });
  }, [workspaces]);

  // Hotfix: DnD disabled (dnd-kit). We keep a sorted list only.
  const localWorkspaces: WorkspaceDoc[] = baseSortedWorkspaces;

  const currentWorkspaceName = (() => {
    if (!workspaceId) return null;
    return workspaces.find((w) => w.id === workspaceId)?.name ?? workspaceId;
  })();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dockHiddenOnScroll, setDockHiddenOnScroll] = useState(false);
  const [dockDesktopTopClass, setDockDesktopTopClass] = useState("md:top-32");
  const isSettingsRoute = pathname.startsWith("/settings");
  const isAgendaRoute = pathname.startsWith("/tasks");

  useEffect(() => {
    if (!mobileOpen) return;
    // Close the drawer on navigation to avoid stale overlay states.
    setMobileOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, workspaceId]);

  useEffect(() => {
    if (!mobileOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  useEffect(() => {
    if (mobileOpen) {
      setDockHiddenOnScroll(false);
      return;
    }

    let lastY = window.scrollY;
    let ticking = false;

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        const nextY = window.scrollY;
        const delta = nextY - lastY;

        if (nextY < 24) {
          setDockHiddenOnScroll(false);
        } else if (delta > 10) {
          setDockHiddenOnScroll(true);
        } else if (delta < -10) {
          setDockHiddenOnScroll(false);
        }

        lastY = nextY;
        ticking = false;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [mobileOpen]);

  useEffect(() => {
    let rafId: number | null = null;

    const toTopClass = (px: number) => {
      if (px <= 96) return "md:top-24";
      if (px <= 112) return "md:top-28";
      if (px <= 128) return "md:top-32";
      if (px <= 144) return "md:top-36";
      if (px <= 160) return "md:top-40";
      return "md:top-44";
    };

    const recomputeDockTopOffset = () => {
      if (typeof window === "undefined") return;
      if (window.innerWidth < 768) {
        setDockDesktopTopClass("md:top-32");
        return;
      }

      const mainEl = document.querySelector("main");
      if (!mainEl) {
        setDockDesktopTopClass("md:top-32");
        return;
      }

      const candidates = Array.from(mainEl.querySelectorAll<HTMLElement>(".sticky, [data-dock-avoid]"));
      let maxBottom = 112;

      for (const el of candidates) {
        const style = window.getComputedStyle(el);
        const position = style.position;
        if (position !== "sticky" && position !== "fixed") continue;

        const rect = el.getBoundingClientRect();
        if (rect.height <= 0 || rect.bottom <= 0 || rect.top >= window.innerHeight) continue;

        if (position === "sticky") {
          const topPx = Number.parseFloat(style.top || "0");
          const stickyTop = Number.isFinite(topPx) ? topPx : 0;
          if (rect.top <= stickyTop + 2) {
            maxBottom = Math.max(maxBottom, rect.bottom);
          }
          continue;
        }

        if (position === "fixed" && rect.top < 220) {
          maxBottom = Math.max(maxBottom, rect.bottom);
        }
      }

      setDockDesktopTopClass(toTopClass(Math.round(maxBottom + 12)));
    };

    const scheduleRecompute = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        recomputeDockTopOffset();
      });
    };

    recomputeDockTopOffset();
    window.addEventListener("resize", scheduleRecompute, { passive: true });
    window.addEventListener("scroll", scheduleRecompute, { passive: true });

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", scheduleRecompute);
      window.removeEventListener("scroll", scheduleRecompute);
    };
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;

    // Prevent background scroll (iOS-friendly approach).
    const scrollY = window.scrollY;
    const prevOverflow = document.body.style.overflow;
    const prevPosition = document.body.style.position;
    const prevTop = document.body.style.top;
    const prevWidth = document.body.style.width;

    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";

    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.position = prevPosition;
      document.body.style.top = prevTop;
      document.body.style.width = prevWidth;
      window.scrollTo(0, scrollY);
    };
  }, [mobileOpen]);

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

  const topActionableSuggestion = useMemo(() => {
    const arr = (assistantSuggestions ?? [])
      .filter((s) => s.status === "proposed" && isActionableKind(s.kind))
      .slice();
    arr.sort((a, b) => {
      const ra = typeof a.rankScore === "number" && Number.isFinite(a.rankScore) ? a.rankScore : Number.NEGATIVE_INFINITY;
      const rb = typeof b.rankScore === "number" && Number.isFinite(b.rankScore) ? b.rankScore : Number.NEGATIVE_INFINITY;
      if (rb !== ra) return rb - ra;
      const ta = typeof (a.updatedAt as { toMillis?: unknown })?.toMillis === "function" ? (a.updatedAt as { toMillis: () => number }).toMillis() : 0;
      const tb = typeof (b.updatedAt as { toMillis?: unknown })?.toMillis === "function" ? (b.updatedAt as { toMillis: () => number }).toMillis() : 0;
      return tb - ta;
    });
    return arr[0] ?? null;
  }, [assistantSuggestions]);

  useEffect(() => {
    if (assistantSettings?.enabled !== true) {
      setProactiveBanner(null);
      return;
    }
    if (assistantSettings?.proactivityMode !== "proactive") {
      setProactiveBanner(null);
      return;
    }

    const now = new Date();
    const quietStart = typeof assistantSettings?.quietHours?.start === "string" ? assistantSettings.quietHours.start : "22:00";
    const quietEnd = typeof assistantSettings?.quietHours?.end === "string" ? assistantSettings.quietHours.end : "08:00";
    if (isWithinQuietHours(now, quietStart, quietEnd)) {
      setProactiveBanner(null);
      return;
    }

    const candidate = topActionableSuggestion;
    if (!candidate) {
      setProactiveBanner(null);
      return;
    }

    const suggestionId = candidate.id ?? candidate.dedupeKey;
    if (!suggestionId) {
      setProactiveBanner(null);
      return;
    }

    const maxRaw = assistantSettings?.notificationBudget?.maxPerDay;
    const maxPerDay = typeof maxRaw === "number" && Number.isFinite(maxRaw) ? Math.max(0, Math.trunc(maxRaw)) : 3;
    if (maxPerDay <= 0) {
      setProactiveBanner(null);
      return;
    }

    if (!reserveDailyNotificationBudget(suggestionId, maxPerDay)) {
      setProactiveBanner(null);
      return;
    }

    const payload = candidate.payload && typeof candidate.payload === "object" ? (candidate.payload as { title?: unknown; explanation?: unknown }) : null;
    setProactiveBanner({
      suggestionId,
      title: typeof payload?.title === "string" ? payload.title : "Suggestion",
      explanation: typeof payload?.explanation === "string" ? payload.explanation : "Tu as une nouvelle action prioritaire.",
    });
  }, [assistantSettings, topActionableSuggestion]);

  if (authLoading || authInvalidating || !user) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background text-foreground">
        <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
      </div>
    );
  }

  return (
    <div
      key={user.uid}
      className="min-h-[100dvh] flex bg-background text-foreground overflow-x-hidden pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
    >
      {/* Desktop sidebar */}
      <aside className={`hidden md:flex ${sidebarWidthClass} border-r border-border/60 bg-background/95`}>
        <div className="w-full flex flex-col">
          <div
            className={
              collapsed
                ? "p-3 flex flex-col items-center gap-2 border-b border-border/40"
                : "p-3 flex items-center justify-between gap-2 border-b border-border/40"
            }
          >
            <div className={collapsed ? "flex flex-col items-center gap-2" : "min-w-0 flex items-center gap-2"}>
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
              className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-border bg-background hover:bg-accent transition-colors"
              aria-label={collapsed ? "Agrandir la sidebar" : "Réduire la sidebar"}
              title={collapsed ? "Agrandir" : "Réduire"}
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          </div>
          <div className="px-3 py-3 overflow-y-auto">
            <SidebarWorkspaces
              collapsed={collapsed}
              onRequestExpand={collapsed ? () => setCollapsed(false) : undefined}
              workspaces={localWorkspaces}
              loading={workspacesLoading}
              error={workspacesError}
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
          <div
            className="sn-drawer-panel absolute left-0 top-0 h-full w-72 bg-background border-r border-border pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
          >
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
              <SidebarWorkspaces
                collapsed={false}
                onNavigate={closeMobile}
                workspaces={localWorkspaces}
                loading={workspacesLoading}
                error={workspacesError}
              />
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
            className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-border bg-background hover:bg-accent transition-colors"
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
          {currentWorkspaceName && (
            <div className="ml-auto text-xs text-muted-foreground truncate max-w-[45%]">
              📁 {currentWorkspaceName}
            </div>
          )}
        </div>

        <main className="flex-1 p-4 min-w-0 pb-[calc(6.5rem+env(safe-area-inset-bottom))] md:pb-20">
          <PwaInstallCta />
          {proactiveBanner ? (
            <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-primary">Assistant proactif</div>
                  <div className="text-sm font-semibold truncate">{proactiveBanner.title}</div>
                  <div className="text-xs text-muted-foreground line-clamp-2">{proactiveBanner.explanation}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <a href="/assistant/briefing" className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-xs font-medium">
                    Traiter
                  </a>
                  <button
                    type="button"
                    onClick={() => setProactiveBanner(null)}
                    className="px-3 py-2 rounded-md border border-input text-xs"
                  >
                    Masquer
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {currentWorkspaceName && (
            <div className="mb-4 text-sm text-muted-foreground truncate">📁 {currentWorkspaceName}</div>
          )}
          {children}
          <SmartActionDock
            mobileHidden={mobileOpen}
            hiddenOnScroll={dockHiddenOnScroll}
            desktopTopClass={dockDesktopTopClass}
            subtleIdle={isAgendaRoute}
            voiceAction={
              isSettingsRoute
                ? undefined
                : (
                    <VoiceAgentButton
                      mobileHidden={mobileOpen}
                      renderCustomTrigger={({ onClick, ariaLabel, title }) => (
                        <button
                          type="button"
                          onClick={onClick}
                          aria-label={ariaLabel}
                          title={title}
                          className="h-10 w-10 rounded-full border border-white/10 bg-white/5 text-white/85 text-lg transition-transform duration-150 hover:scale-[1.04] hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 active:scale-95"
                        >
                          🎤
                        </button>
                      )}
                    />
                  )
            }
            createAction={(
              <CreateButton
                mobileHidden={mobileOpen}
                renderCustomTrigger={({ onClick, ariaLabel, title }) => (
                  <button
                    type="button"
                    onClick={onClick}
                    aria-label={ariaLabel}
                    title={title}
                    className="h-11 w-11 rounded-full bg-primary text-primary-foreground text-2xl font-semibold leading-none transition-transform duration-150 hover:scale-[1.04] hover:shadow-[0_0_16px_rgba(59,130,246,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 active:scale-95"
                  >
                    +
                  </button>
                )}
              />
            )}
          />
        </main>
      </div>
    </div>
  );
}
