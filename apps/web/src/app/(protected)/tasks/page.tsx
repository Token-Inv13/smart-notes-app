"use client";

/**
 * Tasks page
 * - Read data via useUserTasks/useUserWorkspaces (Firestore onSnapshot)
 * - Local filters: status + workspaceId (in-memory only)
 * - CRUD:
 *   - Create: addDoc("tasks") with userId == auth.currentUser.uid
 *   - Update: updateDoc("tasks/{id}") with updatedAt: serverTimestamp()
 *   - Delete: deleteDoc("tasks/{id}") after confirm()
 * All writes must respect Firestore rules: user can only modify their own tasks.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useUserTasks } from "@/hooks/useUserTasks";
import { useUserNotes } from "@/hooks/useUserNotes";
import { useUserTodos } from "@/hooks/useUserTodos";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useUserWorkspaces } from "@/hooks/useUserWorkspaces";
import { useUserTaskReminders } from "@/hooks/useUserTaskReminders";
import { registerFcmToken } from "@/lib/fcm";
import type { TaskDoc } from "@/types/firestore";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getOnboardingFlag, setOnboardingFlag } from "@/lib/onboarding";

type TaskStatus = "todo" | "doing" | "done";
type TaskStatusFilter = "all" | TaskStatus;
type WorkspaceFilter = "all" | string;

export default function TasksPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: tasks, loading, error } = useUserTasks();
  const searchParams = useSearchParams();
  const highlightedTaskId = searchParams.get("taskId");
  const workspaceIdParam = searchParams.get("workspaceId");
  const createParam = searchParams.get("create");
  const { data: userSettings } = useUserSettings();
  const isPro = userSettings?.plan === "pro";
  const freeLimitMessage = "Limite Free atteinte. Passe en Pro pour créer plus de tâches et utiliser les favoris sans limite.";

  const statusLabel = (s: TaskStatus) => {
    if (s === "todo") return "À faire";
    if (s === "doing") return "En cours";
    return "Terminée";
  };

  const { data: favoriteTasksForLimit } = useUserTasks({ favoriteOnly: true, limit: 16 });
  const { data: workspaces } = useUserWorkspaces();
  const {
    reminders,
  } = useUserTaskReminders();

  const [statusFilter] = useState<TaskStatusFilter>("all");
  const [workspaceFilter, setWorkspaceFilter] = useState<WorkspaceFilter>("all");
  const [archiveView] = useState<"active" | "archived">("active");

  const [viewMode, setViewMode] = useState<"list" | "grid" | "kanban">("list");

  const [editError, setEditError] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const [enablingPush, setEnablingPush] = useState(false);

  const tabsTouchStartRef = useRef<{ x: number; y: number } | null>(null);

  const toMillisSafe = (ts: unknown) => {
    const maybeTs = ts as { toMillis?: () => number };
    if (maybeTs && typeof maybeTs.toMillis === "function") {
      return maybeTs.toMillis();
    }
    return 0;
  };

  const userId = auth.currentUser?.uid;
  const showMicroGuide = !!userId && !getOnboardingFlag(userId, "tasks_microguide_v1");

  const { data: notesForCounter } = useUserNotes({ workspaceId: workspaceIdParam ?? undefined });
  const { data: todosForCounter } = useUserTodos({ workspaceId: workspaceIdParam ?? undefined, completed: false });

  useEffect(() => {
    if (createParam !== "1") return;
    const href = workspaceIdParam
      ? `/tasks/new?workspaceId=${encodeURIComponent(workspaceIdParam)}`
      : "/tasks/new";
    router.replace(href);
  }, [createParam, router, workspaceIdParam]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("tasksViewMode");
      if (raw === "list" || raw === "grid" || raw === "kanban") {
        setViewMode(raw);
      }
    } catch {
      // ignore
    }
  }, []);

  // Keep workspaceFilter in sync with ?workspaceId=... from the sidebar.
  useEffect(() => {
    const nextFilter = workspaceIdParam ?? "all";
    if (workspaceFilter !== nextFilter) {
      setWorkspaceFilter(nextFilter as WorkspaceFilter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceIdParam]);

  const filteredTasks = useMemo(() => {
    let result = tasks;

    result = result.filter((t) => (archiveView === "archived" ? t.archived === true : t.archived !== true));

    if (statusFilter !== "all") {
      result = result.filter((task) => {
        const status = (task.status ?? "todo") as TaskStatus;
        return status === statusFilter;
      });
    }

    if (workspaceFilter !== "all") {
      result = result.filter((task) => task.workspaceId === workspaceFilter);
    }

    const sorted = result
      .slice()
      .sort((a, b) => {
        const aDue = a.dueDate ? a.dueDate.toMillis() : null;
        const bDue = b.dueDate ? b.dueDate.toMillis() : null;

        const aHasDue = aDue !== null;
        const bHasDue = bDue !== null;

        if (aHasDue && bHasDue) {
          return aDue! - bDue!; // dueDate asc
        }

        if (aHasDue && !bHasDue) return -1;
        if (!aHasDue && bHasDue) return 1;

        const aUpdated = toMillisSafe(a.updatedAt);
        const bUpdated = toMillisSafe(b.updatedAt);
        return bUpdated - aUpdated; // updatedAt desc
      });

    return sorted;
  }, [tasks, statusFilter, workspaceFilter, archiveView]);

  const activeTasks = useMemo(
    () => filteredTasks.filter((t) => ((t.status as TaskStatus | undefined) ?? "todo") !== "done"),
    [filteredTasks],
  );

  const completedTasks = useMemo(
    () => {
      // Completed list should respect workspace filter, but ignore statusFilter.
      let result = tasks;

      result = result.filter((t) => (archiveView === "archived" ? t.archived === true : t.archived !== true));

      if (workspaceFilter !== "all") {
        result = result.filter((task) => task.workspaceId === workspaceFilter);
      }
      return result
        .filter((t) => ((t.status as TaskStatus | undefined) ?? "todo") === "done")
        .slice()
        .sort((a, b) => {
          const aUpdated = toMillisSafe(a.updatedAt);
          const bUpdated = toMillisSafe(b.updatedAt);
          return bUpdated - aUpdated;
        });
    },
    [tasks, workspaceFilter, archiveView],
  );

  const visibleTasksCount = useMemo(
    () => activeTasks.length + completedTasks.length,
    [activeTasks.length, completedTasks.length],
  );
  const visibleNotesCount = useMemo(
    () => notesForCounter.filter((n) => n.archived !== true).length,
    [notesForCounter],
  );

  const visibleTodosCount = useMemo(
    () => todosForCounter.length,
    [todosForCounter.length],
  );

  const hrefSuffix = workspaceIdParam ? `?workspaceId=${encodeURIComponent(workspaceIdParam)}` : "";
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

        if (dx > 0) {
          router.push(`/notes${hrefSuffix}`);
        }

        if (dx < 0) {
          router.push(`/todo${hrefSuffix}`);
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

  const toggleDone = async (task: TaskDoc, nextDone: boolean) => {
    if (!task.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== task.userId) return;

    const nextStatus: TaskStatus = nextDone ? "done" : "todo";
    try {
      await updateDoc(doc(db, "tasks", task.id), {
        title: task.title,
        status: nextStatus,
        workspaceId: typeof task.workspaceId === "string" ? task.workspaceId : null,
        dueDate: task.dueDate ?? null,
        favorite: task.favorite === true,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error("Error toggling done", e);
    }
  };

  const groupedTasks = useMemo(() => {
    const groups: Record<TaskStatus, TaskDoc[]> = {
      todo: [],
      doing: [],
      done: [],
    };

    for (const task of filteredTasks) {
      const status = ((task.status as TaskStatus | undefined) ?? "todo") as TaskStatus;
      groups[status].push(task);
    }

    return groups;
  }, [filteredTasks]);

  const toggleFavorite = async (task: TaskDoc) => {
    if (!task.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== task.userId) return;

    if (!isPro && task.favorite !== true && favoriteTasksForLimit.length >= 15) {
      setEditError(freeLimitMessage);
      return;
    }

    try {
      await updateDoc(doc(db, "tasks", task.id), {
        title: task.title,
        status: (task.status ?? "todo") as TaskDoc["status"],
        workspaceId: typeof task.workspaceId === "string" ? task.workspaceId : null,
        dueDate: task.dueDate ?? null,
        favorite: !(task.favorite === true),
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error("Error toggling favorite", e);
    }
  };

  const notificationPermission: NotificationPermission | "unsupported" = (() => {
    if (typeof window === "undefined") return "unsupported";
    if (!("Notification" in window)) return "unsupported";
    return Notification.permission;
  })();

  const handleEnableNotifications = async () => {
    setPushStatus("Activation des notifications…");
    setEnablingPush(true);
    try {
      await registerFcmToken();
      const nextPermission = ("Notification" in window ? Notification.permission : "denied") as NotificationPermission;
      if (nextPermission === "granted") {
        setPushStatus("✅ Notifications activées");
      } else if (nextPermission === "denied") {
        setPushStatus("⚠️ Permission refusée. Tu peux réactiver depuis les paramètres du navigateur.");
      } else {
        setPushStatus("Permission non accordée.");
      }
    } catch (e) {
      console.error("Error enabling notifications", e);
      setPushStatus("Impossible d’activer les notifications pour le moment.");
    } finally {
      setEnablingPush(false);
    }
  };

  useEffect(() => {
    if (!highlightedTaskId) return;
    const el = document.getElementById(`task-${highlightedTaskId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightedTaskId, filteredTasks.length]);

  return (
    <div className="space-y-4">
      {workspaceIdParam && tabs}
      <header className="flex flex-col gap-2 mb-4">
        <h1 className="text-xl font-semibold">Tes tâches</h1>
        {notificationPermission !== "granted" && (
          <div className="space-y-2">
            {notificationPermission === "unsupported" && (
              <div className="sn-alert sn-alert--info">❌ Navigateur non compatible avec les notifications.</div>
            )}

            {notificationPermission === "denied" && (
              <div className="sn-alert sn-alert--info">
                ⚠️ Permission refusée. Tu peux réactiver les notifications depuis les paramètres de ton navigateur.
              </div>
            )}

            {notificationPermission === "default" && (
              <div className="sn-alert sn-alert--info">🔔 Pour recevoir les rappels, active les notifications.</div>
            )}

            {notificationPermission !== "unsupported" && notificationPermission !== "denied" && (
              <button
                type="button"
                onClick={handleEnableNotifications}
                disabled={enablingPush}
                className="sn-text-btn"
              >
                {enablingPush ? "Activation…" : "Activer les notifications"}
              </button>
            )}

            {pushStatus && <div className="text-xs text-muted-foreground">{pushStatus}</div>}
          </div>
        )}
      </header>

      {/* New Task form */}
      <section className="border border-border rounded-lg bg-card">
        <div className="p-4 flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Tes tâches</h1>
        </div>

        {showMicroGuide && (
          <div className="px-4 pb-4">
            <div className="sn-card sn-card--muted p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">Astuce</div>
                  <div className="text-sm text-muted-foreground">
                    Ajoute un titre simple, puis un rappel si besoin. Tu peux épingler l’essentiel en favori ⭐.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => userId && setOnboardingFlag(userId, "tasks_microguide_v1", true)}
                  className="sn-text-btn shrink-0"
                >
                  Compris
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

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

      {!loading && !error && activeTasks.length === 0 && (
        <div className="sn-empty">
          <div className="sn-empty-title">
            {archiveView === "archived" ? "Aucune tâche archivée" : "Aucune tâche pour le moment"}
          </div>
          {archiveView !== "archived" && (
            <div className="sn-empty-desc">Commence par créer une tâche.</div>
          )}
        </div>
      )}

      {!loading && !error && viewMode === "list" && activeTasks.length > 0 && (
        <ul className="space-y-2">
          {activeTasks.map((task) => {
            const status = (task.status as TaskStatus | undefined) ?? "todo";
            const workspaceName =
              workspaces.find((ws) => ws.id === task.workspaceId)?.name ?? "—";
            const taskReminders = reminders.filter((r) => r.taskId === task.id);
            const nextReminder = taskReminders
              .slice()
              .sort((a, b) => new Date(a.reminderTime).getTime() - new Date(b.reminderTime).getTime())[0];
            const reminderLabel = nextReminder ? new Date(nextReminder.reminderTime).toLocaleString() : null;

            const hrefSuffix = workspaceIdParam ? `?workspaceId=${encodeURIComponent(workspaceIdParam)}` : "";

            return (
              <li key={task.id} id={task.id ? `task-${task.id}` : undefined}>
                <div
                  className={`sn-card sn-card--task ${task.favorite ? " sn-card--favorite" : ""} p-4 ${
                    task.id && task.id === highlightedTaskId ? "border-primary" : ""
                  }`}
                  onClick={() => {
                    if (!task.id) return;
                    router.push(`/tasks/${task.id}${hrefSuffix}`);
                  }}
                >
                  <div className="space-y-3">
                    <div className="sn-card-header">
                      <div className="min-w-0">
                        <div className="sn-card-title truncate">{task.title}</div>
                        <div className="sn-card-meta">
                          <span className="sn-badge">{workspaceName}</span>
                          <span className="sn-badge">{statusLabel(status)}</span>
                          {reminderLabel ? (
                            <span className="sn-badge">Rappel: {reminderLabel}</span>
                          ) : (
                            <span className="sn-badge">Aucun rappel</span>
                          )}
                        </div>
                      </div>

                      <div className="sn-card-actions sn-card-actions-secondary shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(task);
                          }}
                          className="sn-icon-btn"
                          aria-label={task.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                          title={task.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                        >
                          {task.favorite ? "★" : "☆"}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <label className="text-xs flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={status === "done"}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => toggleDone(task, e.target.checked)}
                        />
                        <span className="text-muted-foreground">Terminé</span>
                      </label>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!loading && !error && viewMode === "grid" && activeTasks.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {activeTasks.map((task) => {
            const status = (task.status as TaskStatus | undefined) ?? "todo";
            const workspaceName =
              workspaces.find((ws) => ws.id === task.workspaceId)?.name ?? "—";
            const hrefSuffix = workspaceIdParam ? `?workspaceId=${encodeURIComponent(workspaceIdParam)}` : "";
            const taskReminders = reminders.filter((r) => r.taskId === task.id);
            const nextReminder = taskReminders
              .slice()
              .sort((a, b) => new Date(a.reminderTime).getTime() - new Date(b.reminderTime).getTime())[0];
            const reminderLabel = nextReminder ? new Date(nextReminder.reminderTime).toLocaleString() : null;

            return (
              <div
                key={task.id}
                id={task.id ? `task-${task.id}` : undefined}
                className={`sn-card sn-card--task ${task.favorite ? " sn-card--favorite" : ""} p-4 min-w-0 ${
                  task.id && task.id === highlightedTaskId ? "border-primary" : ""
                }`}
                onClick={() => {
                  if (!task.id) return;
                  router.push(`/tasks/${task.id}${hrefSuffix}`);
                }}
              >
                <>
                  <div className="flex flex-col gap-3">
                    <div className="sn-card-header">
                      <div className="min-w-0">
                        <div className="sn-card-title line-clamp-2">{task.title}</div>
                        <div className="sn-card-meta">
                          <span className="sn-badge">{workspaceName}</span>
                          <span className="sn-badge">{statusLabel(status)}</span>
                          {reminderLabel ? (
                            <span className="sn-badge">Rappel: {reminderLabel}</span>
                          ) : (
                            <span className="sn-badge">Aucun rappel</span>
                          )}
                        </div>
                      </div>
                      <div className="sn-card-actions sn-card-actions-secondary shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(task);
                          }}
                          className="sn-icon-btn"
                          aria-label={task.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                          title={task.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                        >
                          {task.favorite ? "★" : "☆"}
                        </button>
                      </div>
                    </div>

                    <div className="mt-auto flex items-center justify-between gap-3">
                      <label className="text-xs flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={status === "done"}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => toggleDone(task, e.target.checked)}
                        />
                        <span className="text-muted-foreground">Terminé</span>
                      </label>
                    </div>
                  </div>
                </>
              </div>
            );
          })}
        </div>
      )}

      {!loading && !error && viewMode === "kanban" && (
        <section className="grid gap-4 md:grid-cols-3">
          {(statusFilter === "all"
            ? (["todo", "doing", "done"] as TaskStatus[])
            : ([statusFilter] as TaskStatus[])
          ).map((colStatus) => (
            <div
              key={colStatus}
              className="sn-card sn-card--task p-3 min-h-[240px]"
            >
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold">{statusLabel(colStatus)}</h2>
                <span className="text-xs text-muted-foreground">{groupedTasks[colStatus].length}</span>
              </div>

              <div className="space-y-2">
                {groupedTasks[colStatus].map((task) => {
                  const taskReminders = reminders.filter((r) => r.taskId === task.id);
                  const nextReminder = taskReminders
                    .slice()
                    .sort((a, b) => new Date(a.reminderTime).getTime() - new Date(b.reminderTime).getTime())[0];
                  const reminderLabel = nextReminder ? new Date(nextReminder.reminderTime).toLocaleString() : null;

                  return (
                    <div
                      key={task.id}
                      className={`border border-border rounded-md bg-background p-2 cursor-move transition-shadow ${
                        ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{task.title}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {reminderLabel ? `Rappel : ${reminderLabel}` : "Aucun rappel"}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <label className="text-xs flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={((task.status as TaskStatus | undefined) ?? "todo") === "done"}
                              onChange={(e) => toggleDone(task, e.target.checked)}
                            />
                            Terminé
                          </label>
                          <button
                            type="button"
                            onClick={() => toggleFavorite(task)}
                            className="sn-text-btn"
                            aria-label={task.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                          >
                            {task.favorite ? "★" : "☆"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {groupedTasks[colStatus].length === 0 && (
                  <div className="text-sm text-muted-foreground">Glisse une tâche ici</div>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      {!loading && !error && completedTasks.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mt-6 mb-2">Terminées</h2>
          <ul className="space-y-2">
            {completedTasks.map((task) => (
              <li key={task.id} className={`sn-card sn-card--task sn-card--muted p-4 ${task.favorite ? " sn-card--favorite" : ""}`}>
                <div className="sn-card-header">
                  <div className="min-w-0">
                    <div className="sn-card-title truncate">{task.title}</div>
                    <div className="sn-card-meta">
                      <span className="sn-badge">Terminée</span>
                    </div>
                  </div>
                  <div className="sn-card-actions sn-card-actions-secondary shrink-0">
                    <button type="button" onClick={() => toggleDone(task, false)} className="sn-text-btn">
                      Restaurer
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
