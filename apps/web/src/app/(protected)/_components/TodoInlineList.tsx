"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useUserTodos } from "@/hooks/useUserTodos";
import { useUserWorkspaces } from "@/hooks/useUserWorkspaces";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import { toUserErrorMessage } from "@/lib/userError";
import type { TodoDoc } from "@/types/firestore";

interface TodoInlineListProps {
  workspaceId?: string;
  showTabsHeader?: boolean;
}

export default function TodoInlineList({ workspaceId }: TodoInlineListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: todos, loading, error } = useUserTodos({ workspaceId });
  const { data: workspaces } = useUserWorkspaces();
  const [editError, setEditError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [todoView, setTodoView] = useState<"active" | "completed">("active");

  const todoTabsSwipeHandlers = useSwipeNavigation<HTMLDivElement>({
    onSwipeLeft: () => setTodoView("completed"),
    onSwipeRight: () => setTodoView("active"),
  });

  type TodoPriorityFilter = "all" | NonNullable<TodoDoc["priority"]>;
  type DueFilter = "all" | "today" | "overdue";
  type TodoSortBy = "updatedAt" | "createdAt" | "dueDate";

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [workspaceFilter, setWorkspaceFilter] = useState<string>(workspaceId ?? "all");
  const [priorityFilter, setPriorityFilter] = useState<TodoPriorityFilter>("all");
  const [dueFilter, setDueFilter] = useState<DueFilter>("all");
  const [sortBy, setSortBy] = useState<TodoSortBy>("updatedAt");

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

  const openTodoDetail = (todoId?: string) => {
    if (!todoId) return;
    const qs = new URLSearchParams(searchParams.toString());
    if (workspaceId) qs.set("workspaceId", workspaceId);
    else qs.delete("workspaceId");
    const href = qs.toString();
    router.push(`/todo/${encodeURIComponent(todoId)}${href ? `?${href}` : ""}`);
  };

  const isSameLocalDay = (a: Date, b: Date) => {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  };

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 150);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    const nextFilter = workspaceId ?? "all";
    if (workspaceFilter !== nextFilter) {
      setWorkspaceFilter(nextFilter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const workspaceNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const ws of workspaces) {
      if (ws.id) m.set(ws.id, ws.name);
    }
    return m;
  }, [workspaces]);

  const formatDueDate = (ts: TodoDoc["dueDate"] | null | undefined) => {
    if (!ts) return "";
    try {
      return ts.toDate().toLocaleDateString();
    } catch {
      return "";
    }
  };

  const priorityLabel = (p: NonNullable<TodoDoc["priority"]>) => {
    if (p === "high") return "Haute";
    if (p === "medium") return "Moyenne";
    return "Basse";
  };

  const priorityDotClass = (p: NonNullable<TodoDoc["priority"]>) => {
    if (p === "high") return "bg-red-500/80";
    if (p === "medium") return "bg-amber-500/80";
    return "bg-emerald-500/80";
  };

  const activeTodos = useMemo(() => todos.filter((t) => t.completed !== true), [todos]);
  const completedTodos = useMemo(() => todos.filter((t) => t.completed === true), [todos]);

  const filteredTodos = useMemo(() => {
    const now = new Date();
    const q = normalizeText(debouncedSearch);
    let result = todoView === "completed" ? completedTodos : activeTodos;

    if (workspaceFilter !== "all") {
      result = result.filter((t) => t.workspaceId === workspaceFilter);
    }

    if (priorityFilter !== "all") {
      result = result.filter((t) => t.priority === priorityFilter);
    }

    if (q) {
      result = result.filter((t) => {
        const workspaceName = t.workspaceId ? workspaceNameById.get(t.workspaceId) ?? "" : "";
        const itemsText = (t.items ?? []).map((i) => i.text ?? "").join("\n");
        const text = normalizeText(`${t.title}\n${itemsText}\n${workspaceName}`);
        return text.includes(q);
      });
    }

    if (dueFilter !== "all") {
      result = result.filter((t) => {
        if (!t.dueDate) return false;
        let due: Date;
        try {
          due = t.dueDate.toDate();
        } catch {
          return false;
        }
        if (dueFilter === "today") return isSameLocalDay(due, now);
        return due.getTime() < now.getTime();
      });
    }

    const sorted = result.slice().sort((a, b) => {
      if (sortBy === "dueDate") {
        const aDue = a.dueDate ? a.dueDate.toMillis() : null;
        const bDue = b.dueDate ? b.dueDate.toMillis() : null;

        const aHasDue = aDue !== null;
        const bHasDue = bDue !== null;

        if (aHasDue && bHasDue) return aDue! - bDue!;
        if (aHasDue && !bHasDue) return -1;
        if (!aHasDue && bHasDue) return 1;

        const aUpdated = toMillisSafe(a.updatedAt);
        const bUpdated = toMillisSafe(b.updatedAt);
        return bUpdated - aUpdated;
      }

      const aMillis = sortBy === "createdAt" ? toMillisSafe(a.createdAt) : toMillisSafe(a.updatedAt);
      const bMillis = sortBy === "createdAt" ? toMillisSafe(b.createdAt) : toMillisSafe(b.updatedAt);
      return bMillis - aMillis;
    });

    return sorted;
  }, [activeTodos, completedTodos, debouncedSearch, dueFilter, priorityFilter, sortBy, todoView, workspaceFilter, workspaceNameById]);

  const hasActiveSearchOrFilters = useMemo(() => {
    const q = debouncedSearch.trim();
    return q.length > 0 || workspaceFilter !== "all" || priorityFilter !== "all" || dueFilter !== "all" || sortBy !== "updatedAt";
  }, [debouncedSearch, dueFilter, priorityFilter, sortBy, workspaceFilter]);

  const toggleCompleted = async (todo: TodoDoc, nextCompleted: boolean) => {
    if (!todo.id) return;
    const user = auth.currentUser;
    if (!user) {
      setEditError("Tu dois être connecté.");
      return;
    }
    if (user.uid !== todo.userId) return;

    setEditError(null);
    setActionFeedback(null);

    try {
      await updateDoc(doc(db, "todos", todo.id), {
        userId: todo.userId,
        workspaceId: typeof todo.workspaceId === "string" ? todo.workspaceId : null,
        title: todo.title,
        favorite: todo.favorite === true,
        completed: nextCompleted,
        updatedAt: serverTimestamp(),
      });

      setActionFeedback(nextCompleted ? "Checklist terminée." : "Checklist restaurée.");
      window.setTimeout(() => setActionFeedback(null), 1800);
    } catch (e) {
      console.error("Error toggling todo completed", e);
      setEditError(toUserErrorMessage(e, "Erreur lors de la mise à jour."));
    }
  };

  const toggleFavorite = async (todo: TodoDoc) => {
    if (!todo.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== todo.userId) return;

    setEditError(null);

    try {
      await updateDoc(doc(db, "todos", todo.id), {
        userId: todo.userId,
        workspaceId: typeof todo.workspaceId === "string" ? todo.workspaceId : null,
        title: todo.title,
        completed: todo.completed === true,
        favorite: !(todo.favorite === true),
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error("Error toggling todo favorite", e);
      setEditError(toUserErrorMessage(e, "Erreur lors de la mise à jour."));
    }
  };

  return (
    <div className="space-y-4">
      {editError && <div className="sn-alert sn-alert--error">{editError}</div>}
      {actionFeedback && <div className="sn-alert" role="status" aria-live="polite">{actionFeedback}</div>}
      {error && (
        <div className="sn-alert sn-alert--error">
          Impossible de charger la checklist pour le moment.
          {error.message ? ` (${error.message})` : ""}
        </div>
      )}

      {loading && (
        <div className="sn-empty sn-animate-in">
          <div className="space-y-3">
            <div className="sn-skeleton-title w-48 mx-auto" />
            <div className="sn-skeleton-line w-72 mx-auto" />
            <div className="sn-skeleton-line w-64 mx-auto" />
          </div>
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-4">
          <div
            className="inline-flex rounded-md border border-border bg-background overflow-hidden"
            {...todoTabsSwipeHandlers}
          >
            <button
              type="button"
              onClick={() => setTodoView("active")}
              className={`px-3 py-1 text-sm ${todoView === "active" ? "bg-accent" : ""}`}
            >
              Actives ({activeTodos.length})
            </button>
            <button
              type="button"
              onClick={() => setTodoView("completed")}
              className={`px-3 py-1 text-sm ${todoView === "completed" ? "bg-accent" : ""}`}
            >
              Terminées ({completedTodos.length})
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="relative flex-1 min-w-0">
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Rechercher (titre, items, dossier)…"
                className="w-full border border-input rounded-md px-3 py-2 pr-10 bg-background text-sm"
                aria-label="Rechercher dans la checklist"
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
            <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Filtres checklist">
              <button
                type="button"
                className="absolute inset-0 bg-black/40"
                onClick={() => setFiltersOpen(false)}
                aria-label="Fermer les filtres"
              />
              <div className="absolute left-0 right-0 bottom-0 w-full sm:left-1/2 sm:top-1/2 sm:right-auto sm:bottom-auto sm:w-[min(92vw,520px)] sm:-translate-x-1/2 sm:-translate-y-1/2 rounded-t-lg sm:rounded-lg border border-border bg-card shadow-lg max-h-[85dvh] overflow-y-auto">
                <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                  <div className="text-sm font-semibold">Filtres</div>
                  <button type="button" onClick={() => setFiltersOpen(false)} className="sn-icon-btn" aria-label="Fermer">
                    ×
                  </button>
                </div>
                <div className="p-4 space-y-4">
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Dossier</div>
                    <select
                      value={workspaceFilter}
                      onChange={(e) => setWorkspaceFilter(e.target.value)}
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

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">Priorité</div>
                      <select
                        value={priorityFilter}
                        onChange={(e) => setPriorityFilter(e.target.value as TodoPriorityFilter)}
                        aria-label="Filtrer par priorité"
                        className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
                      >
                        <option value="all">Toutes</option>
                        <option value="high">Haute</option>
                        <option value="medium">Moyenne</option>
                        <option value="low">Basse</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">Échéance</div>
                      <select
                        value={dueFilter}
                        onChange={(e) => setDueFilter(e.target.value as DueFilter)}
                        aria-label="Filtrer par échéance"
                        className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
                      >
                        <option value="all">Toutes</option>
                        <option value="today">Aujourd’hui</option>
                        <option value="overdue">En retard</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Tri</div>
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as TodoSortBy)}
                      aria-label="Trier la checklist"
                      className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
                    >
                      <option value="updatedAt">Dernière modification</option>
                      <option value="createdAt">Date de création</option>
                      <option value="dueDate">Échéance</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-2">
                    <button
                      type="button"
                      className="sn-text-btn"
                      onClick={() => {
                        setWorkspaceFilter(workspaceId ?? "all");
                        setPriorityFilter("all");
                        setDueFilter("all");
                        setSortBy("updatedAt");
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

          {filteredTodos.length === 0 && (
            <div className="sn-empty">
              <div className="sn-empty-title">
                {hasActiveSearchOrFilters ? "Aucun résultat" : todoView === "completed" ? "Aucune checklist terminée" : "Aucune checklist"}
              </div>
              <div className="sn-empty-desc">
                {hasActiveSearchOrFilters
                  ? "Essaie d’effacer la recherche ou de réinitialiser les filtres."
                  : todoView === "completed"
                    ? "Marque une checklist comme terminée pour la retrouver ici."
                    : "Appuie sur + pour en créer une."}
              </div>
            </div>
          )}

          {filteredTodos.length > 0 && (
            <ul className="space-y-2">
              {filteredTodos.map((todo) => (
                <li key={todo.id}>
                  <div
                    className={`sn-card p-4 relative ${todo.completed ? "opacity-80" : ""} ${todo.id ? "cursor-pointer" : ""} ${todo.id ? "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" : ""}`}
                    aria-label={todo.id ? `Ouvrir la checklist ${todo.title}` : undefined}
                    onClick={() => openTodoDetail(todo.id)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <input
                          type="checkbox"
                          checked={todo.completed === true}
                          onChange={(e) => toggleCompleted(todo, e.target.checked)}
                          aria-label="Marquer comme terminée"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          className="pointer-events-auto"
                        />
                        <div className="min-w-0">
                          <div className={`truncate select-text ${todo.completed ? "line-through text-muted-foreground" : ""}`}>{todo.title}</div>
                          {(todo.dueDate || todo.priority) && (
                            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                              {todo.dueDate && (
                                <span title={`Échéance: ${formatDueDate(todo.dueDate)}`} className="inline-flex items-center gap-1">
                                  <span aria-hidden>📅</span>
                                  <span>{formatDueDate(todo.dueDate)}</span>
                                </span>
                              )}
                              {todo.priority && (
                                <span title={`Priorité: ${priorityLabel(todo.priority)}`} className="inline-flex items-center gap-1">
                                  <span className={`h-2 w-2 rounded-full ${priorityDotClass(todo.priority)}`} aria-hidden />
                                  <span>{priorityLabel(todo.priority)}</span>
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(todo);
                        }}
                        className="sn-icon-btn shrink-0 pointer-events-auto"
                        aria-label={todo.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                        title={todo.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                        onMouseDown={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        {todo.favorite ? "★" : "☆"}
                      </button>

                      {todo.completed === true && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void toggleCompleted(todo, false);
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          className="sn-text-btn shrink-0"
                          aria-label="Restaurer la checklist"
                          title="Restaurer"
                        >
                          Restaurer
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
