"use client";

import { useCallback, useMemo, useState } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { db } from "@/lib/firebase";
import TodoInlineList from "../_components/TodoInlineList";
import { type FolderDragData } from "../_components/folderDnd";
import WorkspaceFolderBrowser from "../_components/WorkspaceFolderBrowser";
import { useUserNotes } from "@/hooks/useUserNotes";
import { useUserTasks } from "@/hooks/useUserTasks";
import { useUserTodos } from "@/hooks/useUserTodos";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import { useUserWorkspaces } from "@/hooks/useUserWorkspaces";
import {
  applyWorkspaceAssignmentOverrides,
  applyWorkspaceParentOverrides,
  canMoveWorkspaceToParent,
  countItemsByWorkspaceId,
  getWorkspaceById,
  getWorkspaceChain,
  getWorkspaceDirectContentIds,
  getWorkspaceDirectChildren,
} from "@/lib/workspaces";
import { toUserErrorMessage } from "@/lib/userError";

export default function TodoPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId") || undefined;
  const { data: workspaces } = useUserWorkspaces();
  const [activeDragItem, setActiveDragItem] = useState<FolderDragData | null>(null);
  const [optimisticWorkspaceIdByTodoId, setOptimisticWorkspaceIdByTodoId] = useState<Record<string, string | null>>({});
  const [optimisticParentIdByWorkspaceId, setOptimisticParentIdByWorkspaceId] = useState<Record<string, string | null>>({});
  const [moveFeedback, setMoveFeedback] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const dndSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const { data: notesForCounter } = useUserNotes();
  const { data: tasksForCounter } = useUserTasks();
  const { data: todosForCounter } = useUserTodos();
  const effectiveWorkspaces = useMemo(
    () => applyWorkspaceParentOverrides(workspaces, optimisticParentIdByWorkspaceId),
    [optimisticParentIdByWorkspaceId, workspaces],
  );
  const effectiveTodosForCounter = useMemo(
    () => applyWorkspaceAssignmentOverrides(todosForCounter, optimisticWorkspaceIdByTodoId),
    [optimisticWorkspaceIdByTodoId, todosForCounter],
  );
  const selectedWorkspaceIds = useMemo(() => getWorkspaceDirectContentIds(workspaceId), [workspaceId]);
  const currentWorkspace = useMemo(() => getWorkspaceById(effectiveWorkspaces, workspaceId), [effectiveWorkspaces, workspaceId]);
  const currentWorkspaceChain = useMemo(() => getWorkspaceChain(effectiveWorkspaces, workspaceId), [effectiveWorkspaces, workspaceId]);
  const directChildWorkspaces = useMemo(() => getWorkspaceDirectChildren(effectiveWorkspaces, workspaceId), [effectiveWorkspaces, workspaceId]);
  const activeNoteCountByWorkspaceId = useMemo(
    () => countItemsByWorkspaceId(notesForCounter, (note) => note.archived !== true),
    [notesForCounter],
  );
  const activeTaskCountByWorkspaceId = useMemo(
    () => countItemsByWorkspaceId(tasksForCounter, (task) => task.archived !== true),
    [tasksForCounter],
  );
  const activeTodoCountByWorkspaceId = useMemo(
    () => countItemsByWorkspaceId(effectiveTodosForCounter, (todo) => todo.completed !== true),
    [effectiveTodosForCounter],
  );
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
          href: `/todo?workspaceId=${encodeURIComponent(workspace.id ?? "")}`,
          counts: {
            notes: activeNoteCountByWorkspaceId.get(workspace.id ?? "") ?? 0,
            tasks: activeTaskCountByWorkspaceId.get(workspace.id ?? "") ?? 0,
            todos: activeTodoCountByWorkspaceId.get(workspace.id ?? "") ?? 0,
          },
        })),
    [activeNoteCountByWorkspaceId, activeTaskCountByWorkspaceId, activeTodoCountByWorkspaceId, directChildWorkspaces],
  );

  const visibleNotesCount = useMemo(
    () =>
      notesForCounter.filter((note) => {
        if (note.archived === true) return false;
        if (!selectedWorkspaceIds) return true;
        return selectedWorkspaceIds.has(note.workspaceId ?? "");
      }).length,
    [notesForCounter, selectedWorkspaceIds],
  );
  const visibleTasksCount = useMemo(
    () =>
      tasksForCounter.filter((task) => {
        if (task.archived === true) return false;
        if (!selectedWorkspaceIds) return true;
        return selectedWorkspaceIds.has(task.workspaceId ?? "");
      }).length,
    [selectedWorkspaceIds, tasksForCounter],
  );
  const visibleTodosCount = useMemo(
    () =>
      effectiveTodosForCounter.filter((todo) => {
        if (todo.completed === true) return false;
        if (!selectedWorkspaceIds) return true;
        return selectedWorkspaceIds.has(todo.workspaceId ?? "");
      }).length,
    [selectedWorkspaceIds, effectiveTodosForCounter],
  );

  const hrefSuffix = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";

  const workspaceTabsSwipeHandlers = useSwipeNavigation<HTMLDivElement>({
    onSwipeRight: () => {
      router.push(`/tasks${hrefSuffix}`);
    },
    onSwipeLeft: () => {
      router.push(`/notes${hrefSuffix}`);
    },
    ignoreInteractiveTargets: true,
    disabled: !workspaceId,
  });

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

  const moveTodoToWorkspace = useCallback(async (todoId: string, targetWorkspaceId: string, currentWorkspaceId: string | null) => {
    if (currentWorkspaceId === targetWorkspaceId) return;

    setOptimisticWorkspaceIdByTodoId((prev) => ({ ...prev, [todoId]: targetWorkspaceId }));
    setMoveFeedback("Checklist deplacee.");
    setMoveError(null);

    try {
      await updateDoc(doc(db, "todos", todoId), {
        workspaceId: targetWorkspaceId,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      setOptimisticWorkspaceIdByTodoId((prev) => {
        const next = { ...prev };
        delete next[todoId];
        return next;
      });
      setMoveError(toUserErrorMessage(error, "Erreur lors du deplacement de la checklist."));
    }
  }, []);

  const moveWorkspaceToParent = useCallback(async (draggedWorkspaceId: string, targetWorkspaceId: string) => {
    if (!canMoveWorkspaceToParent(effectiveWorkspaces, draggedWorkspaceId, targetWorkspaceId)) return;

    setOptimisticParentIdByWorkspaceId((prev) => ({ ...prev, [draggedWorkspaceId]: targetWorkspaceId }));
    setMoveFeedback("Dossier deplace.");
    setMoveError(null);

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
      setMoveError(toUserErrorMessage(error, "Erreur lors du deplacement du dossier."));
    }
  }, [effectiveWorkspaces]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const dragData = event.active.data.current as FolderDragData | undefined;
    setActiveDragItem(dragData ?? null);
    setMoveError(null);
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

      if (dragData.kind === "todo") {
        await moveTodoToWorkspace(dragData.id, dropData.workspaceId, dragData.workspaceId);
        return;
      }

      if (dragData.kind === "workspace") {
        await moveWorkspaceToParent(dragData.id, dropData.workspaceId);
      }
    },
    [isFolderDropDisabled, moveTodoToWorkspace, moveWorkspaceToParent],
  );

  return (
    <DndContext sensors={dndSensors} onDragStart={handleDragStart} onDragCancel={handleDragCancel} onDragEnd={handleDragEnd}>
      <div className="space-y-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] md:pb-4" {...workspaceTabsSwipeHandlers}>
      {workspaceId && tabs}
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Checklist</h1>
        <div id="sn-create-slot" />
      </header>

      {moveError && <div className="sn-alert sn-alert--error">{moveError}</div>}
      {moveFeedback && <div className="sn-alert" role="status" aria-live="polite">{moveFeedback}</div>}

      {workspaceId && currentWorkspace && (
        <WorkspaceFolderBrowser
          sectionHrefBase="/todo"
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
            <div className="text-xs text-muted-foreground">{directWorkspaceCounts.todos} checklist{directWorkspaceCounts.todos > 1 ? "s" : ""}</div>
          </div>
        </section>
      )}

      <TodoInlineList
        workspaceId={workspaceId}
        workspaces={effectiveWorkspaces}
        optimisticWorkspaceIdByTodoId={optimisticWorkspaceIdByTodoId}
      />
      </div>
    </DndContext>
  );
}
