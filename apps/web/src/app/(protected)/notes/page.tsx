"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [workspaceFilter, setWorkspaceFilter] = useState<string>(workspaceId ?? "all");
  const [sortBy, setSortBy] = useState<"updatedAt" | "createdAt">("updatedAt");

  const { data: userSettings } = useUserSettings();
  const isPro = userSettings?.plan === "pro";
  const freeLimitMessage =
    "Limite Free atteinte. Tu peux passer en Pro pour créer plus de notes et utiliser les favoris sans limite.";

  const { data: notes, loading, error } = useUserNotes({
    workspaceId: workspaceFilter === "all" ? undefined : workspaceFilter,
  });
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

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 150);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const [editError, setEditError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const showUpgradeCta = !!editError?.includes("Limite Free atteinte");

  const toMillisSafe = (ts: unknown) => {
    const maybeTs = ts as { toMillis?: () => number };
    if (maybeTs && typeof maybeTs.toMillis === "function") {
      return maybeTs.toMillis();
    }
    return 0;
  };

  const normalizeText = (raw: string) => {
    try {
      return raw
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
    } catch {
      return raw.toLowerCase().trim();
    }
  };

  const workspaceNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const ws of workspaces) {
      if (ws.id) m.set(ws.id, ws.name);
    }
    return m;
  }, [workspaces]);

  useEffect(() => {
    const nextFilter = workspaceId ?? "all";
    if (workspaceFilter !== nextFilter) {
      setWorkspaceFilter(nextFilter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const pushWorkspaceFilterToUrl = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "all") {
        params.delete("workspaceId");
      } else {
        params.set("workspaceId", next);
      }
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, router, searchParams],
  );

  const sortedNotes = useMemo(() => {
    const sorted = notes.slice();
    sorted.sort((a, b) => {
      const aMillis = sortBy === "createdAt" ? toMillisSafe(a.createdAt) : toMillisSafe(a.updatedAt);
      const bMillis = sortBy === "createdAt" ? toMillisSafe(b.createdAt) : toMillisSafe(b.updatedAt);

      if (aMillis !== bMillis) return bMillis - aMillis;

      const aUpdated = toMillisSafe(a.updatedAt);
      const bUpdated = toMillisSafe(b.updatedAt);
      return bUpdated - aUpdated;
    });
    return sorted;
  }, [notes, sortBy]);

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

  const archivedNotesSorted = useMemo(() => {
    if (sortBy === "createdAt") {
      return notes
        .filter((n) => n.archived === true)
        .slice()
        .sort((a, b) => {
          const aCreated = toMillisSafe(a.createdAt);
          const bCreated = toMillisSafe(b.createdAt);
          if (aCreated !== bCreated) return bCreated - aCreated;

          const aUpdated = toMillisSafe(a.updatedAt);
          const bUpdated = toMillisSafe(b.updatedAt);
          return bUpdated - aUpdated;
        });
    }

    return notes
      .filter((n) => n.archived === true)
      .slice()
      .sort((a, b) => {
        const aArchived = toMillisSafe(a.archivedAt ?? a.updatedAt);
        const bArchived = toMillisSafe(b.archivedAt ?? b.updatedAt);
        if (aArchived !== bArchived) return bArchived - aArchived;

        const aUpdated = toMillisSafe(a.updatedAt);
        const bUpdated = toMillisSafe(b.updatedAt);
        return bUpdated - aUpdated;
      });
  }, [notes, sortBy]);

  const visibleNotes = useMemo(() => {
    const base = archiveView === "archived" ? archivedNotesSorted : sortedNotes.filter((n) => n.archived !== true);
    const q = normalizeText(debouncedSearch);

    return base.filter((n) => {
      if (favoriteOnly && n.favorite !== true) return false;

      if (!q) return true;

      const workspaceName = n.workspaceId ? workspaceNameById.get(n.workspaceId) ?? "" : "";
      const text = normalizeText(
        `${n.title}\n${htmlToPlainText(n.content ?? "")}\n${workspaceName}`,
      );
      return text.includes(q);
    });
  }, [archiveView, archivedNotesSorted, debouncedSearch, favoriteOnly, sortedNotes, workspaceNameById]);

  const visibleNotesCount = useMemo(
    () => (archiveView === "archived" ? archivedNotesSorted.length : sortedNotes.filter((n) => n.archived !== true).length),
    [archiveView, archivedNotesSorted.length, sortedNotes],
  );
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

  const restoreArchivedNote = async (note: NoteDoc) => {
    if (!note.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== note.userId) return;

    try {
      await updateDoc(doc(db, "notes", note.id), {
        archived: false,
        archivedAt: null,
        updatedAt: serverTimestamp(),
      });

      setActionFeedback("Note restaurée.");
      window.setTimeout(() => setActionFeedback(null), 1800);
      setArchiveView("active");
    } catch (e) {
      console.error("Error restoring archived note", e);
      setEditError("Erreur lors de la restauration de la note.");
    }
  };

  return (
    <div className="space-y-4">
      {workspaceId && tabs}
      <header className="flex flex-col gap-2 mb-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Notes</h1>
          <div id="sn-create-slot" />
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <h2 className="text-lg font-semibold">Tes notes récentes</h2>
          <div className="inline-flex rounded-md border border-border bg-background overflow-hidden whitespace-nowrap w-fit">
            <button
              type="button"
              onClick={() => setArchiveView("active")}
              className={`px-3 py-1 text-sm ${archiveView === "active" ? "bg-accent" : ""}`}
            >
              Actives ({sortedNotes.filter((n) => n.archived !== true).length})
            </button>
            <button
              type="button"
              onClick={() => setArchiveView("archived")}
              className={`px-3 py-1 text-sm ${archiveView === "archived" ? "bg-accent" : ""}`}
            >
              Archivées ({archivedNotesSorted.length})
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="relative flex-1 min-w-0">
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Rechercher (titre, contenu, dossier)…"
              className="w-full border border-input rounded-md px-3 py-2 pr-10 bg-background text-sm"
              aria-label="Rechercher dans les notes"
            />
            {searchInput.trim().length > 0 && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 sn-icon-btn"
                aria-label="Effacer la recherche"
                title="Effacer"
              >
                ×
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className="inline-flex items-center justify-center h-10 px-3 rounded-md border border-border bg-background hover:bg-accent text-sm"
          >
            Filtrer
          </button>
        </div>

        {filtersOpen && (
          <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Filtres notes">
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              onClick={() => setFiltersOpen(false)}
              aria-label="Fermer les filtres"
            />
            <div className="absolute left-0 right-0 bottom-0 w-full sm:left-1/2 sm:top-1/2 sm:right-auto sm:bottom-auto sm:w-[min(92vw,520px)] sm:-translate-x-1/2 sm:-translate-y-1/2 rounded-t-lg sm:rounded-lg border border-border bg-card shadow-lg max-h-[85dvh] overflow-y-auto">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div className="text-sm font-semibold">Filtres</div>
                <button
                  type="button"
                  onClick={() => setFiltersOpen(false)}
                  className="sn-icon-btn"
                  aria-label="Fermer"
                >
                  ×
                </button>
              </div>
              <div className="p-4 space-y-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={favoriteOnly}
                    onChange={(e) => setFavoriteOnly(e.target.checked)}
                  />
                  <span>Favoris uniquement</span>
                </label>

                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Dossier</div>
                  <select
                    value={workspaceFilter}
                    onChange={(e) => {
                      const next = e.target.value;
                      setWorkspaceFilter(next);
                      pushWorkspaceFilterToUrl(next);
                    }}
                    aria-label="Filtrer par dossier"
                    className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
                  >
                    <option value="all">Tous les dossiers</option>
                    {workspaces.map((ws) => (
                      <option key={ws.id ?? ws.name} value={ws.id ?? ""} disabled={!ws.id}>
                        {ws.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Tri</div>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                    aria-label="Trier les notes"
                    className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
                  >
                    <option value="updatedAt">Dernière modification</option>
                    <option value="createdAt">Date de création</option>
                  </select>
                </div>

                <div className="flex items-center justify-between gap-3 pt-2">
                  <button
                    type="button"
                    className="sn-text-btn"
                    onClick={() => {
                      setFavoriteOnly(false);
                      setSortBy("updatedAt");
                      const base = workspaceId ?? "all";
                      setWorkspaceFilter(base);
                      pushWorkspaceFilterToUrl(base);
                    }}
                  >
                    Réinitialiser
                  </button>

                  <button
                    type="button"
                    className="inline-flex items-center justify-center h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium"
                    onClick={() => setFiltersOpen(false)}
                  >
                    Appliquer
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
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
        {actionFeedback && <div className="mt-2 sn-alert" role="status" aria-live="polite">{actionFeedback}</div>}
        {!isPro && showUpgradeCta && (
          <Link
            href="/upgrade"
            className="mt-2 inline-flex items-center justify-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium"
          >
            Débloquer Pro
          </Link>
        )}

        {!loading && !error && archiveView === "active" && visibleNotes.length === 0 && (
          <div className="sn-empty">
            <div className="sn-empty-title">
              {debouncedSearch || favoriteOnly ? "Aucun résultat" : "Aucune note pour le moment"}
            </div>
            <div className="sn-empty-desc">
              {debouncedSearch || favoriteOnly
                ? "Essaie d’effacer la recherche ou de réinitialiser les filtres."
                : "Commence simple : capture une idée, une liste ou un résumé."}
            </div>
          </div>
        )}
        {!loading && !error && archiveView === "archived" && visibleNotes.length === 0 && (
          <div className="sn-empty">
            <div className="sn-empty-title">
              {debouncedSearch || favoriteOnly ? "Aucun résultat" : "Aucune note archivée"}
            </div>
            <div className="sn-empty-desc">
              {debouncedSearch || favoriteOnly
                ? "Essaie d’effacer la recherche ou de réinitialiser les filtres."
                : "Archive une note pour la retrouver ici et la restaurer plus tard."}
            </div>
          </div>
        )}
        {error && <div className="sn-alert sn-alert--error">Impossible de charger les notes pour le moment.</div>}

        {!loading && !error && archiveView === "archived" && visibleNotes.length > 0 && (
          <ul className="space-y-2">
            {visibleNotes.map((note) => {
              const workspaceName = workspaces.find((ws) => ws.id === note.workspaceId)?.name ?? "—";
              const hrefSuffix = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";

              const archivedLabel = (() => {
                const ts = note.archivedAt ?? note.updatedAt;
                const maybeTs = ts as { toDate?: () => Date };
                if (!maybeTs || typeof maybeTs.toDate !== "function") return null;
                const d = maybeTs.toDate();
                const pad = (n: number) => String(n).padStart(2, "0");
                return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
              })();

              return (
                <li key={note.id}>
                  <div
                    className="sn-card sn-card--note sn-card--muted p-4 cursor-pointer"
                    onClick={() => {
                      if (!note.id) return;
                      router.push(`/notes/${note.id}${hrefSuffix}`);
                    }}
                  >
                    <div className="sn-card-header">
                      <div className="min-w-0">
                        <div className="sn-card-title truncate">{note.title}</div>
                        <div className="sn-card-meta">
                          <span className="sn-badge">{workspaceName}</span>
                          {archivedLabel && <span className="sn-badge">Archivée: {archivedLabel}</span>}
                        </div>
                      </div>

                      <div className="sn-card-actions sn-card-actions-secondary shrink-0">
                        <button
                          type="button"
                          className="sn-text-btn"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            restoreArchivedNote(note);
                          }}
                        >
                          Restaurer
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {!loading && !error && archiveView === "active" && viewMode === "list" && visibleNotes.length > 0 && (
          <ul className="space-y-2">
            {visibleNotes.map((note) => {
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

        {archiveView === "active" && viewMode === "grid" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {visibleNotes.map((note) => {
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
