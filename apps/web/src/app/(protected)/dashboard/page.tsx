"use client";

import { useMemo, useState } from "react";
import { Timestamp, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useUserNotes } from "@/hooks/useUserNotes";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useUserTasks } from "@/hooks/useUserTasks";
import { useUserTodos } from "@/hooks/useUserTodos";
import { useUserWorkspaces } from "@/hooks/useUserWorkspaces";
import { projectTaskToEvent } from "@/lib/agenda/taskEventProjector";
import { auth, db } from "@/lib/firebase";
import { toUserErrorMessage } from "@/lib/userError";
import { buildWorkspacePathLabelMap } from "@/lib/workspaces";
import type { TaskDoc, TodoDoc } from "@/types/firestore";

type TaskStatus = "todo" | "doing" | "done";
type TaskOptimisticPatch = Pick<TaskDoc, "status" | "favorite" | "startDate" | "dueDate">;

function readTimestampMs(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const ts = value as { toMillis?: unknown; toDate?: unknown };
  if (typeof ts.toMillis === "function") {
    try {
      return (ts.toMillis as () => number)();
    } catch {
      return null;
    }
  }
  if (typeof ts.toDate === "function") {
    try {
      return (ts.toDate as () => Date)().getTime();
    } catch {
      return null;
    }
  }
  return null;
}

function formatFrDate(ts?: unknown | null) {
  if (!ts) return "";
  const maybeTs = ts as { toDate?: () => Date };
  if (typeof maybeTs?.toDate !== "function") return "";
  const d = maybeTs.toDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatFrDateTime(ts?: unknown | null) {
  if (!ts) return "";
  const maybeTs = ts as { toDate?: () => Date };
  if (typeof maybeTs?.toDate !== "function") return "";
  const d = maybeTs.toDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toLocalDateParam(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatTaskTiming(task: TaskDoc) {
  const dueLabel = formatFrDateTime(task.dueDate ?? null);
  if (dueLabel) return dueLabel;
  const startLabel = formatFrDate(task.startDate ?? null);
  if (startLabel) return startLabel;
  return "Sans date";
}

function taskPriorityLabel(priority?: TaskDoc["priority"] | null) {
  if (priority === "high") return "Haute";
  if (priority === "medium") return "Moyenne";
  if (priority === "low") return "Basse";
  return "";
}

function priorityDotClass(priority?: TaskDoc["priority"] | TodoDoc["priority"] | null) {
  if (priority === "high") return "bg-red-500/80";
  if (priority === "medium") return "bg-amber-500/80";
  if (priority === "low") return "bg-emerald-500/80";
  return "bg-muted-foreground/40";
}

function taskStatus(task: TaskDoc, optimisticStatus?: TaskStatus): TaskStatus {
  if (optimisticStatus) return optimisticStatus;
  return (task.status as TaskStatus | undefined) ?? (task.completed ? "done" : "todo");
}

function addDaysToTimestamp(ts: TaskDoc["dueDate"] | TaskDoc["startDate"], days: number) {
  if (!ts || typeof ts.toDate !== "function") return null;
  const next = ts.toDate();
  next.setDate(next.getDate() + days);
  return Timestamp.fromDate(next);
}

type TaskBucket = "overdue" | "today" | "upcoming";

export default function DashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId") || undefined;
  const suffix = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
  const notesHref = useMemo(() => {
    return workspaceId ? `/notes?workspaceId=${encodeURIComponent(workspaceId)}` : "/notes";
  }, [workspaceId]);
  const tasksCalendarHref = useMemo(() => {
    const params = new URLSearchParams();
    if (workspaceId) params.set("workspaceId", workspaceId);
    params.set("view", "calendar");
    const qs = params.toString();
    return qs ? `/tasks?${qs}` : "/tasks";
  }, [workspaceId]);
  const todayAgendaHref = useMemo(() => {
    const params = new URLSearchParams();
    if (workspaceId) params.set("workspaceId", workspaceId);
    params.set("view", "calendar");
    params.set("focusDate", toLocalDateParam(new Date()));
    return `/tasks?${params.toString()}`;
  }, [workspaceId]);
  const overdueAgendaHref = useMemo(() => {
    const params = new URLSearchParams();
    if (workspaceId) params.set("workspaceId", workspaceId);
    params.set("view", "list");
    params.set("due", "overdue");
    return `/tasks?${params.toString()}`;
  }, [workspaceId]);
  const activeChecklistHref = useMemo(() => {
    return workspaceId ? `/todo?workspaceId=${encodeURIComponent(workspaceId)}` : "/todo";
  }, [workspaceId]);

  const {
    data: favoriteNotesRaw,
    loading: notesLoading,
    error: notesError,
  } = useUserNotes({ workspaceId, favoriteOnly: true });
  const {
    data: dashboardTasks,
    loading: tasksLoading,
    error: tasksError,
  } = useUserTasks({ workspaceId, limit: 300 });
  const { data: favoriteTasksForLimit } = useUserTasks({ workspaceId, favoriteOnly: true, limit: 16 });
  const { data: userSettings } = useUserSettings();
  const {
    data: activeTodos,
  } = useUserTodos({ workspaceId, completed: false, limit: 8 });
  const {
    data: favoriteTodosRaw,
    loading: todosLoading,
    error: todosError,
  } = useUserTodos({ workspaceId, favoriteOnly: true });
  const { data: workspaces } = useUserWorkspaces();

  const [flashMessage] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.sessionStorage.getItem("smartnotes:flash");
      if (!raw) return null;
      window.sessionStorage.removeItem("smartnotes:flash");
      return raw;
    } catch {
      return null;
    }
  });
  const [todoActionError, setTodoActionError] = useState<string | null>(null);
  const [todoActionFeedback, setTodoActionFeedback] = useState<string | null>(null);
  const [pendingTodoId, setPendingTodoId] = useState<string | null>(null);
  const [taskActionError, setTaskActionError] = useState<string | null>(null);
  const [taskActionFeedback, setTaskActionFeedback] = useState<string | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [optimisticTaskById, setOptimisticTaskById] = useState<Record<string, TaskOptimisticPatch>>({});
  const isPro = userSettings?.plan === "pro";
  const freeLimitMessage = "Limite Free atteinte. Passe en Pro pour créer plus d’éléments d’agenda et utiliser les favoris sans limite.";

  const workspaceLabelById = useMemo(() => buildWorkspacePathLabelMap(workspaces), [workspaces]);

  const favoriteNotes = useMemo(
    () => favoriteNotesRaw.filter((note) => note.archived !== true && note.completed !== true),
    [favoriteNotesRaw],
  );

  const favoriteTodos = useMemo(
    () => favoriteTodosRaw.filter((todo) => todo.completed !== true),
    [favoriteTodosRaw],
  );

  const favoriteActiveCount = useMemo(() => {
    const serverFavoriteIds = new Set(favoriteTasksForLimit.filter((task) => task.archived !== true).map((task) => task.id).filter(Boolean));
    for (const [taskId, patch] of Object.entries(optimisticTaskById)) {
      if (!taskId) continue;
      if (patch.favorite === true) serverFavoriteIds.add(taskId);
      if (patch.favorite === false) serverFavoriteIds.delete(taskId);
    }
    return serverFavoriteIds.size;
  }, [favoriteTasksForLimit, optimisticTaskById]);

  const displayDashboardTasks = useMemo(
    () =>
      dashboardTasks.map((task) => {
        if (!task.id) return task;
        const patch = optimisticTaskById[task.id];
        return patch ? { ...task, ...patch } : task;
      }),
    [dashboardTasks, optimisticTaskById],
  );

  const toggleTodoCompleted = async (todo: TodoDoc, nextCompleted: boolean) => {
    if (!todo.id) return;
    const user = auth.currentUser;
    if (!user) {
      setTodoActionError("Tu dois être connecté.");
      return;
    }
    if (user.uid !== todo.userId || pendingTodoId === todo.id) return;

    setTodoActionError(null);
    setTodoActionFeedback(null);
    setPendingTodoId(todo.id);

    try {
      await updateDoc(doc(db, "todos", todo.id), {
        userId: todo.userId,
        workspaceId: typeof todo.workspaceId === "string" ? todo.workspaceId : null,
        title: todo.title,
        favorite: todo.favorite === true,
        completed: nextCompleted,
        updatedAt: serverTimestamp(),
      });

      setTodoActionFeedback(nextCompleted ? "Checklist terminée." : "Checklist restaurée.");
      window.setTimeout(() => setTodoActionFeedback(null), 1800);
    } catch (e) {
      console.error("Error toggling todo completed", e);
      setTodoActionError(toUserErrorMessage(e, "Erreur lors de la mise à jour."));
    } finally {
      setPendingTodoId((current) => (current === todo.id ? null : current));
    }
  };

  const toggleTaskDone = async (task: TaskDoc, nextDone: boolean) => {
    if (!task.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== task.userId) {
      setTaskActionError("Impossible de modifier cet élément d’agenda.");
      return;
    }
    if (pendingTaskId === task.id) return;

    const nextStatus: TaskStatus = nextDone ? "done" : "todo";
    setTaskActionError(null);
    setTaskActionFeedback(null);
    setPendingTaskId(task.id);
    setOptimisticTaskById((prev) => ({
      ...prev,
      [task.id!]: { ...(prev[task.id!] ?? {}), status: nextStatus },
    }));

    try {
      await updateDoc(doc(db, "tasks", task.id), {
        title: task.title,
        status: nextStatus,
        workspaceId: typeof task.workspaceId === "string" ? task.workspaceId : null,
        dueDate: task.dueDate ?? null,
        favorite: task.favorite === true,
        updatedAt: serverTimestamp(),
      });

      setTaskActionFeedback(nextDone ? "Élément d’agenda terminé." : "Élément d’agenda restauré.");
      window.setTimeout(() => setTaskActionFeedback(null), 1800);
    } catch (e) {
      console.error("Error toggling dashboard task done", e);
      setOptimisticTaskById((prev) => {
        const next = { ...prev };
        const current = next[task.id!];
        if (!current) return prev;
        delete current.status;
        if (Object.keys(current).length === 0) delete next[task.id!];
        else next[task.id!] = current;
        return next;
      });
      setTaskActionError(toUserErrorMessage(e, "Erreur lors de la mise à jour de l’élément d’agenda."));
    } finally {
      setPendingTaskId((current) => (current === task.id ? null : current));
    }
  };

  const toggleTaskFavorite = async (task: TaskDoc) => {
    if (!task.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== task.userId) {
      setTaskActionError("Impossible de modifier cet élément d’agenda.");
      return;
    }
    if (pendingTaskId === task.id) return;

    const nextFavorite = !(task.favorite === true);
    if (!isPro && nextFavorite && favoriteActiveCount >= 15) {
      setTaskActionError(freeLimitMessage);
      return;
    }

    setTaskActionError(null);
    setTaskActionFeedback(null);
    setPendingTaskId(task.id);
    setOptimisticTaskById((prev) => ({
      ...prev,
      [task.id!]: { ...(prev[task.id!] ?? {}), favorite: nextFavorite },
    }));

    try {
      await updateDoc(doc(db, "tasks", task.id), {
        title: task.title,
        status: (task.status ?? "todo") as TaskDoc["status"],
        workspaceId: typeof task.workspaceId === "string" ? task.workspaceId : null,
        dueDate: task.dueDate ?? null,
        favorite: nextFavorite,
        updatedAt: serverTimestamp(),
      });

      setTaskActionFeedback(nextFavorite ? "Ajouté aux favoris." : "Retiré des favoris.");
      window.setTimeout(() => setTaskActionFeedback(null), 1800);
    } catch (e) {
      console.error("Error toggling dashboard task favorite", e);
      setOptimisticTaskById((prev) => {
        const next = { ...prev };
        const current = next[task.id!];
        if (!current) return prev;
        delete current.favorite;
        if (Object.keys(current).length === 0) delete next[task.id!];
        else next[task.id!] = current;
        return next;
      });
      setTaskActionError(toUserErrorMessage(e, "Erreur lors de la mise à jour des favoris."));
    } finally {
      setPendingTaskId((current) => (current === task.id ? null : current));
    }
  };

  const postponeTaskToTomorrow = async (task: TaskDoc) => {
    if (!task.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== task.userId) {
      setTaskActionError("Impossible de modifier cet élément d’agenda.");
      return;
    }
    if (pendingTaskId === task.id) return;

    const nextDueDate = addDaysToTimestamp(task.dueDate ?? null, 1);
    const nextStartDate = addDaysToTimestamp(task.startDate ?? null, 1);
    if (!nextDueDate && !nextStartDate) {
      setTaskActionError("Impossible de reporter cet élément sans date.");
      return;
    }

    setTaskActionError(null);
    setTaskActionFeedback(null);
    setPendingTaskId(task.id);
    setOptimisticTaskById((prev) => ({
      ...prev,
      [task.id!]: {
        ...(prev[task.id!] ?? {}),
        startDate: nextStartDate ?? undefined,
        dueDate: nextDueDate ?? undefined,
      },
    }));

    try {
      await updateDoc(doc(db, "tasks", task.id), {
        title: task.title,
        status: (task.status ?? "todo") as TaskDoc["status"],
        workspaceId: typeof task.workspaceId === "string" ? task.workspaceId : null,
        startDate: nextStartDate ?? null,
        dueDate: nextDueDate ?? null,
        favorite: task.favorite === true,
        updatedAt: serverTimestamp(),
      });

      setTaskActionFeedback("Reporté à demain.");
      window.setTimeout(() => setTaskActionFeedback(null), 1800);
    } catch (e) {
      console.error("Error postponing dashboard task", e);
      setOptimisticTaskById((prev) => {
        const next = { ...prev };
        const current = next[task.id!];
        if (!current) return prev;
        delete current.startDate;
        delete current.dueDate;
        if (Object.keys(current).length === 0) delete next[task.id!];
        else next[task.id!] = current;
        return next;
      });
      setTaskActionError(toUserErrorMessage(e, "Erreur lors du report de l’élément d’agenda."));
    } finally {
      setPendingTaskId((current) => (current === task.id ? null : current));
    }
  };

  const dashboardData = useMemo(() => {
    const now = new Date();
    const nowMs = now.getTime();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    const nextWeekStart = new Date(todayStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const activeTasks = displayDashboardTasks.filter((displayTask) => {
      const status = taskStatus(displayTask, displayTask.status as TaskStatus | undefined);
      return displayTask.archived !== true && status !== "done";
    });

    const urgentTasks = activeTasks
      .map((task) => {
        const projected = projectTaskToEvent(task).event;
        const taskDate = projected?.start?.getTime() ?? readTimestampMs(task.dueDate) ?? readTimestampMs(task.startDate);
        if (taskDate == null) return null;

        let bucket: TaskBucket | null = null;
        if ((readTimestampMs(task.dueDate) ?? taskDate) < nowMs) {
          bucket = "overdue";
        } else if (taskDate >= todayStart.getTime() && taskDate < tomorrowStart.getTime()) {
          bucket = "today";
        } else if (taskDate < nextWeekStart.getTime()) {
          bucket = "upcoming";
        }

        if (!bucket) return null;

        return {
          task,
          bucket,
          taskDate,
        };
      })
      .filter((item): item is { task: TaskDoc; bucket: TaskBucket; taskDate: number } => item !== null)
      .sort((a, b) => {
        const rank = { overdue: 0, today: 1, upcoming: 2 };
        if (rank[a.bucket] !== rank[b.bucket]) return rank[a.bucket] - rank[b.bucket];
        return a.taskDate - b.taskDate;
      })
      .slice(0, 6);

    const tasksToday = activeTasks.filter((task) => {
      const projected = projectTaskToEvent(task).event;
      if (!projected) return false;
      const startMs = projected.start.getTime();
      return startMs >= todayStart.getTime() && startMs < tomorrowStart.getTime();
    }).length;

    const overdueTasks = activeTasks.filter((task) => {
      const dueMs = readTimestampMs(task.dueDate);
      return dueMs != null && dueMs < nowMs;
    }).length;

    const upcomingTasks = urgentTasks.filter((item) => item.bucket === "upcoming").length;

    return {
      tasksToday,
      overdueTasks,
      upcomingTasks,
      urgentTasks,
    };
  }, [displayDashboardTasks]);

  const quickLinks = [
    { href: workspaceId ? `/notes/new?workspaceId=${encodeURIComponent(workspaceId)}` : "/notes/new", label: "Nouvelle note" },
    { href: workspaceId ? `/tasks/new?workspaceId=${encodeURIComponent(workspaceId)}` : "/tasks/new", label: "Nouvelle tâche" },
    { href: tasksCalendarHref, label: "Ouvrir l’agenda" },
    { href: workspaceId ? `/todo?workspaceId=${encodeURIComponent(workspaceId)}` : "/todo", label: "Voir checklist" },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Accueil</h1>
          <p className="text-sm text-muted-foreground">Vue rapide pour savoir quoi faire maintenant.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {quickLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex items-center justify-center rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-accent/60"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </header>

      {flashMessage && (
        <div className="sn-alert sn-alert--info" role="status" aria-live="polite">
          {flashMessage}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        <Link
          href={todayAgendaHref}
          aria-label="Ouvrir l’agenda sur aujourd’hui"
          className="sn-card block p-4 transition hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <div className="text-sm text-muted-foreground">Aujourd’hui</div>
          <div className="mt-1 text-2xl font-semibold">{dashboardData.tasksToday}</div>
          <div className="mt-1 text-xs text-muted-foreground">tâche(s) prévues</div>
        </Link>
        <Link
          href={overdueAgendaHref}
          aria-label="Ouvrir l’agenda pour traiter les tâches en retard"
          className="sn-card block p-4 transition hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <div className="text-sm text-muted-foreground">À rattraper</div>
          <div className="mt-1 text-2xl font-semibold">{dashboardData.overdueTasks}</div>
          <div className="mt-1 text-xs text-muted-foreground">tâche(s) en retard</div>
        </Link>
        <Link
          href={activeChecklistHref}
          aria-label="Ouvrir la checklist active"
          className="sn-card block p-4 transition hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <div className="text-sm text-muted-foreground">Checklist active</div>
          <div className="mt-1 text-2xl font-semibold">{activeTodos.length}</div>
          <div className="mt-1 text-xs text-muted-foreground">élément(s) en cours</div>
        </Link>
      </section>

      <section className="sn-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">À traiter maintenant</h2>
            <p className="text-sm text-muted-foreground">En retard, aujourd’hui, puis dans les prochains jours.</p>
          </div>
          <Link href={tasksCalendarHref} className="sn-text-btn text-sm">
            Voir l’agenda
          </Link>
        </div>

        {tasksLoading && <div className="sn-empty"><div className="sn-empty-title">Chargement des tâches…</div></div>}
        {tasksError && <div className="sn-alert sn-alert--error">Impossible de charger les tâches du dashboard.</div>}
        {taskActionError && <div className="sn-alert sn-alert--error">{taskActionError}</div>}
        {taskActionFeedback && <div className="sn-alert" role="status" aria-live="polite">{taskActionFeedback}</div>}
        {!tasksLoading && !tasksError && dashboardData.urgentTasks.length === 0 && (
          <div className="sn-empty sn-empty--premium">
            <div className="sn-empty-title">Rien d’urgent</div>
            <div className="sn-empty-desc">Aucune tâche en retard ou proche à traiter pour le moment.</div>
          </div>
        )}
        {!tasksLoading && !tasksError && dashboardData.urgentTasks.length > 0 && (
          <div className="max-h-80 overflow-y-auto pr-1 sm:max-h-96">
          <ul className="space-y-2">
            {dashboardData.urgentTasks.map(({ task, bucket, taskDate }) => {
              const href = task.id ? `/tasks/${encodeURIComponent(task.id)}${suffix}` : null;
              const bucketLabel =
                bucket === "overdue" ? "En retard" : bucket === "today" ? "Aujourd’hui" : "À venir";
              return (
                <li
                  key={task.id ?? `${task.title}-${taskDate}`}
                  className={`sn-card sn-card--task p-4 ${href ? "cursor-pointer" : ""} ${pendingTaskId === task.id ? "opacity-70" : ""}`}
                  role={href ? "link" : undefined}
                  aria-label={href ? `Ouvrir l’élément d’agenda ${task.title}` : undefined}
                  tabIndex={href ? 0 : undefined}
                  onClick={() => {
                    if (href) router.push(href);
                  }}
                  onKeyDown={(e) => {
                    if (!href) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(href);
                    }
                  }}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <input
                      type="checkbox"
                      checked={taskStatus(task, task.status as TaskStatus | undefined) === "done"}
                      disabled={pendingTaskId === task.id}
                      aria-label={`Marquer l’élément d’agenda ${task.title} comme terminé`}
                      onChange={(e) => void toggleTaskDone(task, e.target.checked)}
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="mt-1 h-4 w-4 shrink-0 cursor-pointer"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="sn-card-title truncate">{task.title}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void toggleTaskFavorite(task);
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            disabled={pendingTaskId === task.id}
                            className="sn-icon-btn"
                            aria-label={task.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                            title={task.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                          >
                            {task.favorite ? "★" : "☆"}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void postponeTaskToTomorrow(task);
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            disabled={pendingTaskId === task.id}
                            className="rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-accent/60 disabled:opacity-50"
                            aria-label={`Reporter ${task.title} à demain`}
                            title="Reporter à demain"
                          >
                            Demain
                          </button>
                        </div>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="sn-badge">{bucketLabel}</span>
                        <span className="sn-badge">{formatTaskTiming(task)}</span>
                        {task.workspaceId && (
                          <span className="sn-badge">
                            {workspaceLabelById.get(task.workspaceId) ?? task.workspaceId}
                          </span>
                        )}
                        {task.priority && (
                          <span className="sn-badge inline-flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${priorityDotClass(task.priority)}`} aria-hidden />
                            <span>{taskPriorityLabel(task.priority)}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section className="sn-card min-w-0 p-4">
          <div
            className="-m-4 mb-3 cursor-pointer rounded-t-[inherit] p-4 pb-3 transition hover:bg-accent/30 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            role="link"
            tabIndex={0}
            aria-label="Ouvrir la section notes"
            onClick={() => router.push(notesHref)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                router.push(notesHref);
              }
            }}
          >
            <div>
              <h2 className="text-lg font-semibold">Notes favorites</h2>
              <p className="text-sm text-muted-foreground">Tes notes épinglées, prêtes à rouvrir rapidement.</p>
            </div>
          </div>

          {notesLoading && <div className="sn-empty"><div className="sn-empty-title">Chargement des notes…</div></div>}
          {notesError && <div className="sn-alert sn-alert--error">Impossible de charger les notes favorites.</div>}
          {!notesLoading && !notesError && favoriteNotes.length === 0 && (
            <div className="sn-empty">
              <div className="sn-empty-title">Aucune note favorite</div>
              <div className="sn-empty-desc">Ajoute une note en favori pour la retrouver rapidement ici.</div>
            </div>
          )}
          {!notesLoading && !notesError && favoriteNotes.length > 0 && (
            <div className="max-h-80 overflow-y-auto pr-1 sm:max-h-96" onClick={(e) => e.stopPropagation()}>
              <ul className="space-y-2">
                {favoriteNotes.map((note) => {
                  const href = note.id
                    ? (() => {
                        const params = new URLSearchParams();
                        if (workspaceId) params.set("workspaceId", workspaceId);
                        params.set("noteId", note.id);
                        const qs = params.toString();
                        return qs ? `/notes?${qs}` : "/notes";
                      })()
                    : null;
                  return (
                    <li
                      key={note.id ?? note.title}
                      className={`sn-card sn-card--note min-w-0 overflow-hidden p-4 ${href ? "cursor-pointer" : ""}`}
                      role={href ? "link" : undefined}
                      aria-label={href ? `Ouvrir la note ${note.title}` : undefined}
                      tabIndex={href ? 0 : undefined}
                      onClick={() => {
                        if (href) router.push(href);
                      }}
                      onKeyDown={(e) => {
                        if (!href) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          router.push(href);
                        }
                      }}
                    >
                      <div className="min-w-0">
                        <div className="sn-card-title break-words [overflow-wrap:anywhere]">{note.title}</div>
                        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {note.workspaceId && (
                            <span className="sn-badge max-w-full whitespace-normal text-left [overflow-wrap:anywhere]">
                              {workspaceLabelById.get(note.workspaceId) ?? note.workspaceId}
                            </span>
                          )}
                          <span className="sn-badge max-w-full whitespace-normal text-left [overflow-wrap:anywhere]">
                            Mise à jour: {formatFrDateTime(note.updatedAt ?? null)}
                          </span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>

        <section className="sn-card min-w-0 p-4">
          <div
            className="-m-4 mb-3 cursor-pointer rounded-t-[inherit] p-4 pb-3 transition hover:bg-accent/30 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            role="link"
            tabIndex={0}
            aria-label="Ouvrir la section checklist"
            onClick={() => router.push(activeChecklistHref)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                router.push(activeChecklistHref);
              }
            }}
          >
            <div>
              <h2 className="text-lg font-semibold">Checklists favorites</h2>
              <p className="text-sm text-muted-foreground">Tes checklists épinglées, prêtes à reprendre rapidement.</p>
            </div>
          </div>

          {todosLoading && <div className="sn-empty"><div className="sn-empty-title">Chargement de la checklist…</div></div>}
          {todosError && <div className="sn-alert sn-alert--error">Impossible de charger les checklists favorites.</div>}
          {todoActionError && <div className="sn-alert sn-alert--error">{todoActionError}</div>}
          {todoActionFeedback && <div className="sn-alert" role="status" aria-live="polite">{todoActionFeedback}</div>}
          {!todosLoading && !todosError && favoriteTodos.length === 0 && (
            <div className="sn-empty">
              <div className="sn-empty-title">Aucune checklist favorite</div>
              <div className="sn-empty-desc">Ajoute une checklist active en favori pour la retrouver rapidement ici.</div>
            </div>
          )}
          {!todosLoading && !todosError && favoriteTodos.length > 0 && (
            <div className="max-h-80 overflow-y-auto pr-1 sm:max-h-96" onClick={(e) => e.stopPropagation()}>
              <ul className="space-y-2">
                {favoriteTodos.map((todo) => {
                  const href = todo.id ? `/todo/${encodeURIComponent(todo.id)}${suffix}` : null;
                  return (
                    <li
                      key={todo.id ?? todo.title}
                      className={`sn-card sn-card--task min-w-0 overflow-hidden p-4 ${href ? "cursor-pointer" : ""}`}
                      role={href ? "link" : undefined}
                      aria-label={href ? `Ouvrir la checklist ${todo.title}` : undefined}
                      tabIndex={href ? 0 : undefined}
                      onClick={() => {
                        if (href) router.push(href);
                      }}
                      onKeyDown={(e) => {
                        if (!href) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          router.push(href);
                        }
                      }}
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <input
                          type="checkbox"
                          checked={todo.completed === true}
                          disabled={pendingTodoId === todo.id}
                          aria-label={`Marquer la checklist ${todo.title} comme terminée`}
                          onChange={(e) => void toggleTodoCompleted(todo, e.target.checked)}
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          className="mt-1 h-4 w-4 shrink-0 cursor-pointer"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium break-words [overflow-wrap:anywhere]">{todo.title}</div>
                          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {todo.workspaceId && (
                              <span className="sn-badge max-w-full whitespace-normal text-left [overflow-wrap:anywhere]">
                                {workspaceLabelById.get(todo.workspaceId) ?? todo.workspaceId}
                              </span>
                            )}
                            {todo.dueDate && (
                              <span className="sn-badge max-w-full whitespace-normal text-left [overflow-wrap:anywhere]">
                                Échéance: {formatFrDate(todo.dueDate)}
                              </span>
                            )}
                            {todo.priority && (
                              <span className="sn-badge inline-flex max-w-full items-center gap-2 whitespace-normal text-left [overflow-wrap:anywhere]">
                                <span className={`h-2 w-2 rounded-full ${priorityDotClass(todo.priority)}`} aria-hidden />
                                <span>{taskPriorityLabel(todo.priority)}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
