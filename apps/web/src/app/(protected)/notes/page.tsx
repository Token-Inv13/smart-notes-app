"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
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
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import { DraggableCard, type FolderDragData } from "../_components/folderDnd";
import WorkspaceFolderBrowser from "../_components/WorkspaceFolderBrowser";
import {
  applyWorkspaceAssignmentOverrides,
  applyWorkspaceParentOverrides,
  buildWorkspacePathLabelMap,
  canMoveWorkspaceToParent,
  countItemsByWorkspaceId,
  getWorkspaceById,
  getWorkspaceChain,
  getWorkspaceDirectContentIds,
  getWorkspaceDirectChildren,
  getWorkspaceSelfAndDescendantIds,
} from "@/lib/workspaces";
import type { NoteDoc } from "@/types/firestore";
import { htmlToPlainText } from "@/lib/richText";
import { toUserErrorMessage } from "@/lib/userError";
import Link from "next/link";
import { getOnboardingFlag, setOnboardingFlag } from "@/lib/onboarding";
import { FREE_NOTE_LIMIT_MESSAGE, getPlanLimitMessage, setNoteFavoriteWithPlanGuard } from "@/lib/planGuardedMutations";

export default function NotesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId") || undefined;
  const createParam = searchParams.get("create");
  const { data: workspaces } = useUserWorkspaces();

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
  const freeLimitMessage = FREE_NOTE_LIMIT_MESSAGE;

  const { data: notes, loading, error } = useUserNotes();
  const { data: favoriteNotesForLimit } = useUserNotes({ favoriteOnly: true, limit: 11 });
  const { data: tasksForCounter } = useUserTasks();
  const { data: todosForCounter } = useUserTodos({ completed: false });

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
  const [activeDragItem, setActiveDragItem] = useState<FolderDragData | null>(null);
  const [optimisticWorkspaceIdByNoteId, setOptimisticWorkspaceIdByNoteId] = useState<Record<string, string | null>>({});
  const [optimisticFavoriteByNoteId, setOptimisticFavoriteByNoteId] = useState<Record<string, boolean | null>>({});
  const [optimisticParentIdByWorkspaceId, setOptimisticParentIdByWorkspaceId] = useState<Record<string, string | null>>({});
  const favoriteFeedbackTimerRef = useRef<number | null>(null);

  const dndSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

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

  const effectiveWorkspaces = useMemo(
    () => applyWorkspaceParentOverrides(workspaces, optimisticParentIdByWorkspaceId),
    [optimisticParentIdByWorkspaceId, workspaces],
  );
  const effectiveNotes = useMemo(
    () => applyWorkspaceAssignmentOverrides(notes, optimisticWorkspaceIdByNoteId),
    [notes, optimisticWorkspaceIdByNoteId],
  );
  const effectiveNotesWithFavoriteOverrides = useMemo(
    () =>
      effectiveNotes.map((note) => {
        if (!note.id || !Object.prototype.hasOwnProperty.call(optimisticFavoriteByNoteId, note.id)) return note;
        return {
          ...note,
          favorite: optimisticFavoriteByNoteId[note.id],
        };
      }),
    [effectiveNotes, optimisticFavoriteByNoteId],
  );

  useEffect(() => {
    setOptimisticFavoriteByNoteId((prev) => {
      const entries = Object.entries(prev);
      if (entries.length === 0) return prev;

      const nextEntries = entries.filter(([noteId, optimisticFavorite]) => {
        const current = notes.find((note) => note.id === noteId);
        if (!current) return false;
        return (current.favorite === true) !== optimisticFavorite;
      });

      if (nextEntries.length === entries.length) return prev;
      return Object.fromEntries(nextEntries);
    });
  }, [notes]);

  const workspaceNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const ws of effectiveWorkspaces) {
      if (ws.id) m.set(ws.id, ws.name);
    }
    return m;
  }, [effectiveWorkspaces]);
  const workspaceOptionLabelById = useMemo(() => buildWorkspacePathLabelMap(effectiveWorkspaces), [effectiveWorkspaces]);
  const currentWorkspace = useMemo(() => getWorkspaceById(effectiveWorkspaces, workspaceId), [effectiveWorkspaces, workspaceId]);
  const currentWorkspaceChain = useMemo(() => getWorkspaceChain(effectiveWorkspaces, workspaceId), [effectiveWorkspaces, workspaceId]);
  const directChildWorkspaces = useMemo(
    () => getWorkspaceDirectChildren(effectiveWorkspaces, workspaceId),
    [effectiveWorkspaces, workspaceId],
  );
  const activeNoteCountByWorkspaceId = useMemo(
    () => countItemsByWorkspaceId(effectiveNotes, (note) => note.archived !== true),
    [effectiveNotes],
  );
  const activeTaskCountByWorkspaceId = useMemo(
    () => countItemsByWorkspaceId(tasksForCounter, (task) => task.archived !== true),
    [tasksForCounter],
  );
  const activeTodoCountByWorkspaceId = useMemo(
    () => countItemsByWorkspaceId(todosForCounter),
    [todosForCounter],
  );
  const selectedWorkspaceIds = useMemo(
    () =>
      workspaceFilter === "all"
        ? null
        : workspaceId && workspaceFilter === workspaceId
          ? new Set([workspaceId])
          : getWorkspaceSelfAndDescendantIds(effectiveWorkspaces, workspaceFilter),
    [workspaceFilter, workspaceId, effectiveWorkspaces],
  );
  const tabWorkspaceIds = useMemo(() => getWorkspaceDirectContentIds(workspaceId), [workspaceId]);
  const directWorkspaceCounts = useMemo(
    () => ({
      notes: workspaceId ? activeNoteCountByWorkspaceId.get(workspaceId) ?? 0 : 0,
      tasks: workspaceId ? activeTaskCountByWorkspaceId.get(workspaceId) ?? 0 : 0,
      todos: workspaceId ? activeTodoCountByWorkspaceId.get(workspaceId) ?? 0 : 0,
    }),
    [activeNoteCountByWorkspaceId, activeTaskCountByWorkspaceId, activeTodoCountByWorkspaceId, workspaceId],
  );
  const childWorkspaceCards = useMemo(
    () =>
      directChildWorkspaces
        .filter((workspace) => workspace.id)
        .map((workspace) => ({
          workspace,
          href: `/notes?workspaceId=${encodeURIComponent(workspace.id ?? "")}`,
          counts: {
            notes: activeNoteCountByWorkspaceId.get(workspace.id ?? "") ?? 0,
            tasks: activeTaskCountByWorkspaceId.get(workspace.id ?? "") ?? 0,
            todos: activeTodoCountByWorkspaceId.get(workspace.id ?? "") ?? 0,
          },
        })),
    [activeNoteCountByWorkspaceId, activeTaskCountByWorkspaceId, activeTodoCountByWorkspaceId, directChildWorkspaces],
  );

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
    const sorted = effectiveNotesWithFavoriteOverrides
      .filter((note) => {
        if (!selectedWorkspaceIds) return true;
        return selectedWorkspaceIds.has(note.workspaceId ?? "");
      })
      .slice();
    sorted.sort((a, b) => {
      const aMillis = sortBy === "createdAt" ? toMillisSafe(a.createdAt) : toMillisSafe(a.updatedAt);
      const bMillis = sortBy === "createdAt" ? toMillisSafe(b.createdAt) : toMillisSafe(b.updatedAt);

      if (aMillis !== bMillis) return bMillis - aMillis;

      const aUpdated = toMillisSafe(a.updatedAt);
      const bUpdated = toMillisSafe(b.updatedAt);
      return bUpdated - aUpdated;
    });
    return sorted;
  }, [effectiveNotesWithFavoriteOverrides, selectedWorkspaceIds, sortBy]);

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
      return effectiveNotes
        .filter((n) => {
          if (n.archived !== true) return false;
          if (!selectedWorkspaceIds) return true;
          return selectedWorkspaceIds.has(n.workspaceId ?? "");
        })
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

    return effectiveNotesWithFavoriteOverrides
      .filter((n) => {
        if (n.archived !== true) return false;
        if (!selectedWorkspaceIds) return true;
        return selectedWorkspaceIds.has(n.workspaceId ?? "");
      })
      .slice()
      .sort((a, b) => {
        const aArchived = toMillisSafe(a.archivedAt ?? a.updatedAt);
        const bArchived = toMillisSafe(b.archivedAt ?? b.updatedAt);
        if (aArchived !== bArchived) return bArchived - aArchived;

        const aUpdated = toMillisSafe(a.updatedAt);
        const bUpdated = toMillisSafe(b.updatedAt);
        return bUpdated - aUpdated;
      });
  }, [effectiveNotesWithFavoriteOverrides, selectedWorkspaceIds, sortBy]);

  const visibleNotes = useMemo(() => {
    const base = archiveView === "archived" ? archivedNotesSorted : sortedNotes.filter((n) => n.archived !== true);
    const q = normalizeText(debouncedSearch);

    return base.filter((n) => {
      if (selectedWorkspaceIds && !selectedWorkspaceIds.has(n.workspaceId ?? "")) return false;
      if (favoriteOnly && n.favorite !== true) return false;

      if (!q) return true;

      const workspaceName = n.workspaceId ? workspaceNameById.get(n.workspaceId) ?? "" : "";
      const tagsText = Array.isArray(n.tags) ? n.tags.join(" ") : "";
      const text = normalizeText(
        `${n.title}\n${htmlToPlainText(n.content ?? "")}\n${workspaceName}\n${tagsText}`,
      );
      return text.includes(q);
    });
  }, [archiveView, archivedNotesSorted, debouncedSearch, favoriteOnly, selectedWorkspaceIds, sortedNotes, workspaceNameById]);

  const visibleNotesCount = useMemo(
    () => (archiveView === "archived" ? archivedNotesSorted.length : sortedNotes.filter((n) => n.archived !== true).length),
    [archiveView, archivedNotesSorted.length, sortedNotes],
  );
  const hasActiveSearchOrFilters = useMemo(() => {
    const q = debouncedSearch.trim();
    const baselineWorkspace = workspaceId ?? "all";
    return q.length > 0 || favoriteOnly || workspaceFilter !== baselineWorkspace;
  }, [debouncedSearch, favoriteOnly, workspaceFilter, workspaceId]);
  const activeSearchLabel = useMemo(() => debouncedSearch.trim().slice(0, 60), [debouncedSearch]);
  const visibleTasksCount = useMemo(
    () =>
      tasksForCounter.filter((t) => {
        if (t.archived === true) return false;
        if (!tabWorkspaceIds) return true;
        return tabWorkspaceIds.has(t.workspaceId ?? "");
      }).length,
    [tabWorkspaceIds, tasksForCounter],
  );

  const visibleTodosCount = useMemo(
    () =>
      todosForCounter.filter((todo) => {
        if (!tabWorkspaceIds) return true;
        return tabWorkspaceIds.has(todo.workspaceId ?? "");
      }).length,
    [tabWorkspaceIds, todosForCounter],
  );

  const hrefSuffix = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";

  const workspaceTabsSwipeHandlers = useSwipeNavigation<HTMLDivElement>({
    onSwipeLeft: () => {
      router.push(`/tasks${hrefSuffix}`);
    },
    onSwipeRight: () => {
      router.push(`/todo${hrefSuffix}`);
    },
    ignoreInteractiveTargets: true,
    disabled: !workspaceId,
  });

  const archiveTabsSwipeHandlers = useSwipeNavigation<HTMLDivElement>({
    onSwipeLeft: () => setArchiveView("archived"),
    onSwipeRight: () => setArchiveView("active"),
  });

  const openNoteModal = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("noteId", id);
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, router, searchParams],
  );

  const resetSearchAndFilters = useCallback(() => {
    setSearchInput("");
    setDebouncedSearch("");
    setFavoriteOnly(false);
    setSortBy("updatedAt");
    const base = workspaceId ?? "all";
    setWorkspaceFilter(base);
    pushWorkspaceFilterToUrl(base);
  }, [pushWorkspaceFilterToUrl, workspaceId]);
  const tabs = (
    <div className="mb-4 max-w-full overflow-x-auto">
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
          Agenda ({visibleTasksCount})
        </button>
        <button
          type="button"
          onClick={() => router.push(`/todo${hrefSuffix}`)}
          className={`px-3 py-1 text-sm ${pathname.startsWith("/todo") ? "bg-accent font-semibold" : ""}`}
        >
          Checklist ({visibleTodosCount})
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

    const nextFavorite = !(note.favorite === true);
    setEditError(null);
    setOptimisticFavoriteByNoteId((prev) => ({ ...prev, [note.id!]: nextFavorite }));
    setActionFeedback(nextFavorite ? "Note ajoutée aux favoris." : "Favori retiré.");
    if (favoriteFeedbackTimerRef.current) {
      window.clearTimeout(favoriteFeedbackTimerRef.current);
    }
    favoriteFeedbackTimerRef.current = window.setTimeout(() => {
      setActionFeedback(null);
      favoriteFeedbackTimerRef.current = null;
    }, 1800);

    try {
      await setNoteFavoriteWithPlanGuard(note.id, nextFavorite);
    } catch (e) {
      console.error("Error toggling favorite", e);
      setOptimisticFavoriteByNoteId((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, note.id!)) return prev;
        const next = { ...prev };
        delete next[note.id!];
        return next;
      });
      setEditError(getPlanLimitMessage(e) ?? toUserErrorMessage(e, "Erreur lors de la mise à jour des favoris."));
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

  const isFolderDropDisabled = useCallback(
    (targetWorkspaceId: string, dragItem: FolderDragData | null) => {
      if (!dragItem) return false;
      if (dragItem.kind === "workspace") {
        return !canMoveWorkspaceToParent(effectiveWorkspaces, dragItem.id, targetWorkspaceId);
      }
      return dragItem.workspaceId === targetWorkspaceId;
    },
    [effectiveWorkspaces],
  );

  const moveNoteToWorkspace = useCallback(async (noteId: string, targetWorkspaceId: string, currentWorkspaceId: string | null) => {
    if (currentWorkspaceId === targetWorkspaceId) return;

    setOptimisticWorkspaceIdByNoteId((prev) => ({ ...prev, [noteId]: targetWorkspaceId }));
    setActionFeedback("Note deplacee.");
    window.setTimeout(() => setActionFeedback(null), 1800);

    try {
      await updateDoc(doc(db, "notes", noteId), {
        workspaceId: targetWorkspaceId,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      setOptimisticWorkspaceIdByNoteId((prev) => {
        const next = { ...prev };
        delete next[noteId];
        return next;
      });
      setEditError(toUserErrorMessage(error, "Erreur lors du deplacement de la note."));
    }
  }, []);

  const moveWorkspaceToParent = useCallback(async (draggedWorkspaceId: string, targetWorkspaceId: string) => {
    if (!canMoveWorkspaceToParent(effectiveWorkspaces, draggedWorkspaceId, targetWorkspaceId)) return;

    setOptimisticParentIdByWorkspaceId((prev) => ({ ...prev, [draggedWorkspaceId]: targetWorkspaceId }));
    setActionFeedback("Dossier deplace.");
    window.setTimeout(() => setActionFeedback(null), 1800);

    try {
      await updateDoc(doc(db, "workspaces", draggedWorkspaceId), {
        parentId: targetWorkspaceId,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      setOptimisticParentIdByWorkspaceId((prev) => {
        const next = { ...prev };
        delete next[draggedWorkspaceId];
        return next;
      });
      setEditError(toUserErrorMessage(error, "Erreur lors du deplacement du dossier."));
    }
  }, [effectiveWorkspaces]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const dragData = event.active.data.current as FolderDragData | undefined;
    setActiveDragItem(dragData ?? null);
    setEditError(null);
  }, []);

  const handleDragCancel = useCallback(() => {
    setActiveDragItem(null);
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const dragData = event.active.data.current as FolderDragData | undefined;
      const dropData = event.over?.data.current as { kind?: string; workspaceId?: string } | undefined;

      setActiveDragItem(null);

      if (!dragData || dropData?.kind !== "folder-target" || !dropData.workspaceId) return;
      if (isFolderDropDisabled(dropData.workspaceId, dragData)) return;

      if (dragData.kind === "note") {
        await moveNoteToWorkspace(dragData.id, dropData.workspaceId, dragData.workspaceId);
        return;
      }

      if (dragData.kind === "workspace") {
        await moveWorkspaceToParent(dragData.id, dropData.workspaceId);
      }
    },
    [isFolderDropDisabled, moveNoteToWorkspace, moveWorkspaceToParent],
  );

  return (
    <DndContext sensors={dndSensors} onDragStart={handleDragStart} onDragCancel={handleDragCancel} onDragEnd={handleDragEnd}>
      <div className="space-y-4" {...workspaceTabsSwipeHandlers}>
      {workspaceId && tabs}
      <header className="mb-3 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Notes</h1>
          <div id="sn-create-slot" />
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <div
            className="inline-flex rounded-md border border-border bg-background overflow-hidden whitespace-nowrap w-fit"
            {...archiveTabsSwipeHandlers}
          >
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
              id="notes-search-input"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Rechercher (titre, texte, dossier)…"
              className="h-9 w-full rounded-md border border-input bg-background px-3 pr-10 text-sm"
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
            className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-3 text-sm hover:bg-accent"
          >
            Filtrer
          </button>
        </div>

        {activeSearchLabel && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="sn-badge">Recherche: “{activeSearchLabel}”</span>
            <span className="sn-badge">Résultats: {visibleNotes.length}</span>
          </div>
        )}

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
                    {effectiveWorkspaces.map((ws) => (
                      <option key={ws.id ?? ws.name} value={ws.id ?? ""} disabled={!ws.id}>
                        {workspaceOptionLabelById.get(ws.id ?? "") ?? ws.name}
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

      {workspaceId && currentWorkspace && (
        <WorkspaceFolderBrowser
          sectionHrefBase="/notes"
          allWorkspaces={effectiveWorkspaces}
          workspaceChain={currentWorkspaceChain}
          childFolders={childWorkspaceCards}
          currentCounts={directWorkspaceCounts}
          activeDragItem={activeDragItem}
          isFolderDropDisabled={isFolderDropDisabled}
        />
      )}

      {workspaceId && currentWorkspace && (
        <section className="rounded-xl border-t border-border/60 pt-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Contenu direct</div>
            <div className="text-xs text-muted-foreground">{directWorkspaceCounts.notes} note{directWorkspaceCounts.notes > 1 ? "s" : ""}</div>
          </div>
        </section>
      )}

      {showMicroGuide && !workspaceId && (
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
              {hasActiveSearchOrFilters ? "Aucun résultat" : workspaceId ? "Aucune note directe dans ce dossier" : "Aucune note pour le moment"}
            </div>
            <div className="sn-empty-desc">
              {hasActiveSearchOrFilters
                ? activeSearchLabel
                  ? `Aucune note ne correspond à “${activeSearchLabel}” avec les filtres actuels.`
                  : "Aucune note ne correspond à ta recherche ou à tes filtres actuels."
                : workspaceId
                  ? "Crée une note ici ou ouvre un sous-dossier."
                  : "Commence simple : capture une idée, une liste ou un résumé."}
            </div>
            <div className="mt-3">
              {hasActiveSearchOrFilters ? (
                <button
                  type="button"
                  onClick={resetSearchAndFilters}
                  className="inline-flex items-center justify-center h-10 px-4 rounded-md border border-border bg-background text-sm font-medium hover:bg-accent/60"
                >
                  Réinitialiser les filtres
                </button>
              ) : (
                <Link
                  href={workspaceId ? `/notes/new?workspaceId=${encodeURIComponent(workspaceId)}` : "/notes/new"}
                  className="inline-flex items-center justify-center h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-95 transition-opacity"
                >
                  Créer une note
                </Link>
              )}
            </div>
          </div>
        )}
        {!loading && !error && archiveView === "archived" && visibleNotes.length === 0 && (
          <div className="sn-empty">
            <div className="sn-empty-title">
              {hasActiveSearchOrFilters ? "Aucun résultat" : "Aucune note archivée"}
            </div>
            <div className="sn-empty-desc">
              {hasActiveSearchOrFilters
                ? activeSearchLabel
                  ? `Aucune note archivée ne correspond à “${activeSearchLabel}”.`
                  : "Aucune note archivée ne correspond à ta recherche ou à tes filtres actuels."
                : "Archive une note pour la retrouver ici et la restaurer plus tard."}
            </div>
            {hasActiveSearchOrFilters && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={resetSearchAndFilters}
                  className="inline-flex items-center justify-center h-10 px-4 rounded-md border border-border bg-background text-sm font-medium hover:bg-accent/60"
                >
                  Réinitialiser les filtres
                </button>
              </div>
            )}
          </div>
        )}
        {error && <div className="sn-alert sn-alert--error">Impossible de charger les notes pour le moment.</div>}

        {!loading && !error && archiveView === "archived" && visibleNotes.length > 0 && (
          <ul className="space-y-2">
            {visibleNotes.map((note) => {
              const workspaceName = effectiveWorkspaces.find((ws) => ws.id === note.workspaceId)?.name ?? "—";

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
                    className="sn-card sn-card--note sn-card--muted p-3 cursor-pointer"
                    onClick={() => {
                      if (!note.id) return;
                      openNoteModal(note.id);
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
              const workspaceName = effectiveWorkspaces.find((ws) => ws.id === note.workspaceId)?.name ?? "—";
              const noteWorkspaceId =
                typeof note.workspaceId === "string" && note.workspaceId.trim() ? note.workspaceId : null;

              return (
                <li key={note.id}>
                  <DraggableCard
                    dragData={{ kind: "note", id: note.id ?? "", workspaceId: noteWorkspaceId }}
                    disabled={!note.id}
                  >
                    {({ dragHandle }) => (
                      <div
                        className={`sn-card sn-card--note ${note.favorite ? " sn-card--favorite" : ""} p-3`}
                        onClick={() => {
                          if (!note.id) return;
                          openNoteModal(note.id);
                        }}
                      >
                        <div className="space-y-2">
                          <div className="sn-card-header">
                            <div className="min-w-0">
                              <div className="sn-card-title truncate">{note.title}</div>
                              <div className="sn-card-meta">
                                <span className="sn-badge">{workspaceName}</span>
                                {note.favorite && <span className="sn-badge">Favori</span>}
                              </div>
                            </div>

                            <div className="sn-card-actions sn-card-actions-secondary shrink-0">
                              {dragHandle}
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
                    )}
                  </DraggableCard>
                </li>
              );
            })}
          </ul>
        )}

        {archiveView === "active" && viewMode === "grid" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {visibleNotes.map((note) => {
              const workspaceName = effectiveWorkspaces.find((ws) => ws.id === note.workspaceId)?.name ?? "—";

              return (
                <div
                  key={note.id}
                  className={`sn-card sn-card--note ${note.favorite ? " sn-card--favorite" : ""} p-4 min-w-0`}
                  onClick={() => {
                    if (!note.id) return;
                    openNoteModal(note.id);
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
    </DndContext>
  );
}
