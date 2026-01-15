"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useUserTasks } from "@/hooks/useUserTasks";
import { useUserWorkspaces } from "@/hooks/useUserWorkspaces";
import type { TaskDoc } from "@/types/firestore";

type TaskStatus = "todo" | "doing" | "done";

export default function TodoPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId") || undefined;

  const { data: tasks, loading, error } = useUserTasks({ workspaceId });
  const { data: workspaces } = useUserWorkspaces();

  const [editError, setEditError] = useState<string | null>(null);

  const todoTasks = useMemo(() => {
    return tasks
      .filter((t) => t.archived !== true)
      .filter((t) => ((t.status as TaskStatus | undefined) ?? "todo") === "todo");
  }, [tasks]);

  const workspaceNameById = useMemo(() => {
    const m = new Map<string, string>();
    workspaces.forEach((w) => {
      if (w.id && w.name) m.set(w.id, w.name);
    });
    return m;
  }, [workspaces]);

  const markDone = async (task: TaskDoc) => {
    if (!task.id) return;

    const user = auth.currentUser;
    if (!user || user.uid !== task.userId) return;

    setEditError(null);

    try {
      await updateDoc(doc(db, "tasks", task.id), {
        title: task.title,
        status: "done",
        workspaceId: typeof task.workspaceId === "string" ? task.workspaceId : null,
        dueDate: task.dueDate ?? null,
        favorite: task.favorite === true,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error("Error marking todo task as done", e);
      setEditError(e instanceof Error ? e.message : "Erreur lors de la mise à jour de la tâche.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">ToDo</h1>
        <button
          type="button"
          onClick={() => router.push(workspaceId ? `/tasks?workspaceId=${encodeURIComponent(workspaceId)}` : "/tasks")}
          className="border border-border rounded px-3 py-2 bg-background text-sm hover:bg-accent"
        >
          Voir toutes les tâches
        </button>
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

      {editError && <div className="sn-alert sn-alert--error">{editError}</div>}

      {error && <div className="sn-alert sn-alert--error">Impossible de charger les tâches pour le moment.</div>}

      {!loading && !error && todoTasks.length === 0 && (
        <div className="sn-empty">
          <div className="sn-empty-title">Aucune tâche à faire</div>
          <div className="sn-empty-desc">Ajoute une tâche puis retrouve-la ici.</div>
        </div>
      )}

      {!loading && !error && todoTasks.length > 0 && (
        <ul className="space-y-2">
          {todoTasks.map((task) => {
            const wsLabel =
              task.workspaceId && typeof task.workspaceId === "string"
                ? workspaceNameById.get(task.workspaceId) ?? task.workspaceId
                : null;

            return (
              <li key={task.id}>
                <div className="sn-card sn-card--task p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="sn-card-title truncate">{task.title}</div>
                      <div className="sn-card-meta">
                        {wsLabel && <span className="sn-badge">{wsLabel}</span>}
                        <span className="sn-badge">À faire</span>
                      </div>
                    </div>

                    <label className="text-xs flex items-center gap-2 shrink-0">
                      <input
                        type="checkbox"
                        checked={false}
                        onChange={() => markDone(task)}
                        aria-label="Marquer comme terminée"
                      />
                      <span className="text-muted-foreground">Terminé</span>
                    </label>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
