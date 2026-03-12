"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import TodoInlineList from "../_components/TodoInlineList";
import { useUserNotes } from "@/hooks/useUserNotes";
import { useUserTasks } from "@/hooks/useUserTasks";
import { useUserTodos } from "@/hooks/useUserTodos";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import { useUserWorkspaces } from "@/hooks/useUserWorkspaces";
import { getWorkspaceSelfAndDescendantIds } from "@/lib/workspaces";

export default function TodoPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId") || undefined;
  const { data: workspaces } = useUserWorkspaces();

  const { data: notesForCounter } = useUserNotes();
  const { data: tasksForCounter } = useUserTasks();
  const { data: todosForCounter } = useUserTodos();
  const selectedWorkspaceIds = useMemo(
    () => getWorkspaceSelfAndDescendantIds(workspaces, workspaceId),
    [workspaceId, workspaces],
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
      todosForCounter.filter((todo) => {
        if (todo.completed === true) return false;
        if (!selectedWorkspaceIds) return true;
        return selectedWorkspaceIds.has(todo.workspaceId ?? "");
      }).length,
    [selectedWorkspaceIds, todosForCounter],
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

  return (
    <div className="space-y-4" {...workspaceTabsSwipeHandlers}>
      {workspaceId && tabs}
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Checklist</h1>
        <div id="sn-create-slot" />
      </header>

      <TodoInlineList workspaceId={workspaceId} />
    </div>
  );
}
