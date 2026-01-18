"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FirebaseError } from "firebase/app";
import {
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useUserNotes } from "@/hooks/useUserNotes";
import { useUserTasks } from "@/hooks/useUserTasks";
import { useUserTodos } from "@/hooks/useUserTodos";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useUserWorkspaces } from "@/hooks/useUserWorkspaces";
import type { NoteDoc } from "@/types/firestore";
import { htmlToPlainText } from "@/lib/richText";
import Link from "next/link";
import { getOnboardingFlag, setOnboardingFlag } from "@/lib/onboarding";

export default function NotesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId") || undefined;
  const createParam = searchParams.get("create");
  const { data: workspaces } = useUserWorkspaces();

  const tabsTouchStartRef = useRef<{ x: number; y: number } | null>(null);

  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [archiveView, setArchiveView] = useState<"active" | "archived">("active");

  const { data: userSettings } = useUserSettings();
  const isPro = userSettings?.plan === "pro";
  const freeLimitMessage =
    "Limite Free atteinte. Tu peux passer en Pro pour créer plus de notes et utiliser les favoris sans limite.";

  const { data: notes, loading, error } = useUserNotes({ workspaceId });
  const { data: favoriteNotesForLimit } = useUserNotes({ favoriteOnly: true, limit: 11 });
  const { data: tasksForCounter } = useUserTasks({ workspaceId });
  const { data: todosForCounter } = useUserTodos({ workspaceId, completed: false });

  const userId = auth.currentUser?.uid;
  const showMicroGuide = !!userId && !getOnboardingFlag(userId, "notes_microguide_v1");

  useEffect(() => {
    if (createParam !== "1") return;
    const href = workspaceId ? `/notes/new?workspaceId=${encodeURIComponent(workspaceId)}` : "/notes/new";
    router.replace(href);
  }, [createParam, router, workspaceId]);

  const [editError, setEditError] = useState<string | null>(null);

  const showUpgradeCta = !!editError?.includes("Limite Free atteinte");

  const toMillisSafe = (ts: unknown) => {
    const maybeTs = ts as { toMillis?: () => number };
    if (maybeTs && typeof maybeTs.toMillis === "function") {
      return maybeTs.toMillis();
    }
    return 0;
  };

  const sortedNotes = useMemo(() => {
    return notes
      .slice()
      .sort((a, b) => {
        const aUpdated = toMillisSafe(a.updatedAt);
        const bUpdated = toMillisSafe(b.updatedAt);
        return bUpdated - aUpdated;
      });
  }, [notes]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("notesViewMode");
      if (raw === "list" || raw === "grid") {
        setViewMode(raw);
      }
    } catch {
      // ignore
    }
  }, []);

  const archivePredicate = useMemo(
    () => (n: NoteDoc) => (archiveView === "archived" ? n.archived === true : n.archived !== true),
    [archiveView],
  );

  const activeNotes = useMemo(() => sortedNotes.filter(archivePredicate), [sortedNotes, archivePredicate]);

  const visibleNotesCount = activeNotes.length;
  const visibleTasksCount = useMemo(
    () => tasksForCounter.filter((t) => t.archived !== true).length,
    [tasksForCounter],
  );

  const visibleTodosCount = useMemo(
    () => todosForCounter.length,
    [todosForCounter.length],
  );

  const hrefSuffix = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
  const tabs = (
    <div
      className="mb-4 max-w-full overflow-x-auto"
      onTouchStart={(e) => {
        const t = e.touches[0];
        if (!t) return;
        tabsTouchStartRef.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        const start = tabsTouchStartRef.current;
        tabsTouchStartRef.current = null;
        const t = e.changedTouches[0];
        if (!start || !t) return;

        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (Math.abs(dx) < 60) return;
        if (Math.abs(dx) < Math.abs(dy)) return;

        if (dx < 0) {
          router.push(`/tasks${hrefSuffix}`);
        }
      }}
    >
      <div className="inline-flex rounded-md border border-border bg-background overflow-hidden whitespace-nowrap">
        <button
          type="button"
          onClick={() => router.push(`/notes${hrefSuffix}`)}
          className={`px-3 py-1 text-sm ${pathname.startsWith("/notes") ? "bg-accent font-semibold" : ""}`}
        >
          Notes ({visibleNotesCount})
        </button>
        <button
          type="button"
          onClick={() => router.push(`/tasks${hrefSuffix}`)}
          className={`px-3 py-1 text-sm ${pathname.startsWith("/tasks") ? "bg-accent font-semibold" : ""}`}
        >
          Tâches ({visibleTasksCount})
        </button>
        <button
          type="button"
          onClick={() => router.push(`/todo${hrefSuffix}`)}
          className={`px-3 py-1 text-sm ${pathname.startsWith("/todo") ? "bg-accent font-semibold" : ""}`}
        >
          ToDo ({visibleTodosCount})
        </button>
      </div>
    </div>
  );

  const toggleFavorite = async (note: NoteDoc) => {
    if (!note.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== note.userId) return;

    if (!isPro && note.favorite !== true && favoriteNotesForLimit.length >= 10) {
      setEditError(freeLimitMessage);
      return;
    }

    try {
      await updateDoc(doc(db, "notes", note.id), {
        favorite: !note.favorite,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error("Error toggling favorite", e);
      if (e instanceof FirebaseError) {
        setEditError(`${e.code}: ${e.message}`);
      }
    }
  };

  return (
    <div className="space-y-8">
      {workspaceId && tabs}
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Notes</h1>
        <div id="sn-create-slot" />
      </header>

      {showMicroGuide && (
        <div>
          <div className="sn-card sn-card--muted p-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold">Astuce</div>
                <div className="text-sm text-muted-foreground">
                  Un titre clair suffit. Tu peux compléter le contenu plus tard et épingler l’essentiel en favori ⭐.
                </div>
              </div>
              <button
                type="button"
                onClick={() => userId && setOnboardingFlag(userId, "notes_microguide_v1", true)}
                className="sn-text-btn shrink-0"
              >
                OK, compris
              </button>
            </div>
          </div>
        </div>
      )}

      <section>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
          <h2 className="text-lg font-semibold">Tes notes récentes</h2>
          <div className="inline-flex rounded-md border border-border bg-background overflow-hidden">
            <button
              type="button"
              onClick={() => setArchiveView("active")}
              className={`px-3 py-1 text-sm ${archiveView === "active" ? "bg-accent" : ""}`}
            >
              Actifs
            </button>
            <button
              type="button"
              onClick={() => setArchiveView("archived")}
              className={`px-3 py-1 text-sm ${archiveView === "archived" ? "bg-accent" : ""}`}
            >
              Archivés
            </button>
          </div>
        </div>
        {loading && (
          <div className="sn-empty sn-animate-in">
            <div className="space-y-3">
              <div className="sn-skeleton-title w-48 mx-auto" />
              <div className="sn-skeleton-line w-72 mx-auto" />
              <div className="sn-skeleton-line w-64 mx-auto" />
            </div>
          </div>
        )}
        {editError && <div className="mt-2 sn-alert sn-alert--error">{editError}</div>}
        {showUpgradeCta && (
          <Link
            href="/upgrade"
            className="mt-2 inline-flex items-center justify-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium"
          >
            Débloquer Pro
          </Link>
        )}

        {!loading && !error && activeNotes.length === 0 && (
          <div className="sn-empty">
            <div className="sn-empty-title">
              {archiveView === "archived" ? "Aucune note archivée" : "Aucune note pour le moment"}
            </div>
            {archiveView !== "archived" && (
              <div className="sn-empty-desc">
                Commence simple : capture une idée, une liste ou un résumé.
              </div>
            )}
          </div>
        )}
        {error && <div className="sn-alert sn-alert--error">Impossible de charger les notes pour le moment.</div>}
        {!loading && !error && viewMode === "list" && activeNotes.length > 0 && (
          <ul className="space-y-2">
            {activeNotes.map((note) => {
              const workspaceName = workspaces.find((ws) => ws.id === note.workspaceId)?.name ?? "—";
              const hrefSuffix = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";

              return (
                <li key={note.id}>
                  <div
                    className={`sn-card sn-card--note ${note.favorite ? " sn-card--favorite" : ""} p-4`}
                    onClick={() => {
                      if (!note.id) return;
                      router.push(`/notes/${note.id}${hrefSuffix}`);
                    }}
                  >
                    <div className="space-y-3">
                      <div className="sn-card-header">
                        <div className="min-w-0">
                          <div className="sn-card-title truncate">{note.title}</div>
                          <div className="sn-card-meta">
                            <span className="sn-badge">{workspaceName}</span>
                            {note.favorite && <span className="sn-badge">Favori</span>}
                          </div>
                        </div>

                        <div className="sn-card-actions sn-card-actions-secondary shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFavorite(note);
                            }}
                            className="sn-icon-btn"
                            aria-label={note.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                            title={note.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                          >
                            {note.favorite ? "★" : "☆"}
                          </button>
                        </div>
                      </div>

                      <div className="sn-card-body line-clamp-4">{htmlToPlainText(note.content ?? "")}</div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {viewMode === "grid" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {activeNotes.map((note) => {
              const workspaceName = workspaces.find((ws) => ws.id === note.workspaceId)?.name ?? "—";
              const hrefSuffix = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";

              return (
                <div
                  key={note.id}
                  className={`sn-card sn-card--note ${note.favorite ? " sn-card--favorite" : ""} p-4 min-w-0`}
                  onClick={() => {
                    if (!note.id) return;
                    router.push(`/notes/${note.id}${hrefSuffix}`);
                  }}
                >
                  <div className="flex flex-col gap-3">
                    <div className="sn-card-header">
                      <div className="min-w-0">
                        <div className="sn-card-title line-clamp-2">{note.title}</div>
                        <div className="sn-card-meta">
                          <span className="sn-badge">{workspaceName}</span>
                          {note.favorite && <span className="sn-badge">Favori</span>}
                        </div>
                      </div>

                      <div className="sn-card-actions sn-card-actions-secondary shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(note);
                          }}
                          className="sn-icon-btn"
                          aria-label={note.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                          title={note.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                        >
                          {note.favorite ? "★" : "☆"}
                        </button>
                      </div>
                    </div>

                    <div className="sn-card-body line-clamp-5">{htmlToPlainText(note.content ?? "")}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
