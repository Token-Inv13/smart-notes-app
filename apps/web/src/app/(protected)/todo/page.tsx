"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import TodoInlineList from "../_components/TodoInlineList";
import { dispatchCreateTodoEvent } from "../_components/todoEvents";
import { useUserNotes } from "@/hooks/useUserNotes";
import { useUserTasks } from "@/hooks/useUserTasks";
import { useUserTodos } from "@/hooks/useUserTodos";

export default function TodoPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId") || undefined;
  const createParam = searchParams.get("create");

  const tabsTouchStartRef = useRef<{ x: number; y: number } | null>(null);

  const { data: notesForCounter } = useUserNotes({ workspaceId });
  const { data: tasksForCounter } = useUserTasks({ workspaceId });
  const { data: todosForCounter } = useUserTodos({ workspaceId, completed: false });

  const visibleNotesCount = useMemo(
    () => notesForCounter.filter((n) => n.archived !== true).length,
    [notesForCounter],
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

        // Order: Notes -> Tasks -> ToDo
        if (dx > 0) {
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

  useEffect(() => {
    if (createParam !== "1") return;

    const nextHref = workspaceId ? `/todo?workspaceId=${encodeURIComponent(workspaceId)}` : "/todo";
    const t = window.setTimeout(() => {
      dispatchCreateTodoEvent();
      router.replace(nextHref);
    }, 0);

    return () => window.clearTimeout(t);
  }, [createParam, router, workspaceId]);

  return (
    <div className="space-y-4">
      {workspaceId && tabs}
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">ToDo</h1>
        <div id="sn-create-slot" />
      </header>

      <TodoInlineList workspaceId={workspaceId} />
    </div>
  );
}
