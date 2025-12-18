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

import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { collection, addDoc, doc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useUserTasks } from "@/hooks/useUserTasks";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useUserWorkspaces } from "@/hooks/useUserWorkspaces";
import { useUserTaskReminders } from "@/hooks/useUserTaskReminders";
import { formatTimestampForInput, formatTimestampToLocalString, parseLocalDateTimeToTimestamp } from "@/lib/datetime";
import type { TaskDoc, TaskReminderDoc } from "@/types/firestore";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type TaskStatus = "todo" | "doing" | "done";
type TaskStatusFilter = "all" | TaskStatus;
type WorkspaceFilter = "all" | string;

const newTaskSchema = z.object({
  title: z.string().min(1, "Title is required"),
  status: z.union([z.literal("todo"), z.literal("doing"), z.literal("done")]),
  workspaceId: z.string().optional(),
  dueDate: z.string().optional(),
});

export default function TasksPage() {
  const { data: tasks, loading, error } = useUserTasks();
  const { data: userSettings } = useUserSettings();
  const isPro = userSettings?.plan === "pro";
  const freeLimitMessage = "Limite Free atteinte. Passe en Pro pour débloquer plus de tâches et favoris.";

  const { data: allTasksForLimit } = useUserTasks({ limit: 16 });
  const { data: favoriteTasksForLimit } = useUserTasks({ favoriteOnly: true, limit: 16 });
  const { data: workspaces } = useUserWorkspaces();
  const {
    reminders,
    loading: remindersLoading,
    error: remindersError,
  } = useUserTaskReminders();

  const [statusFilter, setStatusFilter] = useState<TaskStatusFilter>("all");
  const [workspaceFilter, setWorkspaceFilter] = useState<WorkspaceFilter>("all");

  const [viewMode, setViewMode] = useState<"list" | "grid" | "kanban">("list");
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null);

  // New task form state
  const [newTitle, setNewTitle] = useState("");
  const [newStatus, setNewStatus] = useState<TaskStatus>("todo");
  const [newWorkspaceId, setNewWorkspaceId] = useState<string>("");
  const [newDueDate, setNewDueDate] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editStatus, setEditStatus] = useState<TaskStatus>("todo");
  const [editWorkspaceId, setEditWorkspaceId] = useState<string>("");
  const [editDueDate, setEditDueDate] = useState<string>("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Reminders state
  const [newReminderTimes, setNewReminderTimes] = useState<Record<string, string>>({});
  const [creatingReminderForId, setCreatingReminderForId] = useState<string | null>(null);
  const [reminderError, setReminderError] = useState<string | null>(null);

  const showUpgradeCta =
    !!createError?.includes("Limite Free atteinte") || !!editError?.includes("Limite Free atteinte");
  const [deletingReminderId, setDeletingReminderId] = useState<string | null>(null);

  const searchParams = useSearchParams();
  const highlightedTaskId = searchParams.get("taskId");
  const workspaceIdParam = searchParams.get("workspaceId");
  const workspaceRequired = !workspaceIdParam;

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

  // Keep workspaceFilter and default new workspace in sync with ?workspaceId=... from the sidebar.
  useEffect(() => {
    const nextFilter = workspaceIdParam ?? "all";
    if (workspaceFilter !== nextFilter) {
      setWorkspaceFilter(nextFilter as WorkspaceFilter);
    }

    if (workspaceIdParam && !newWorkspaceId) {
      setNewWorkspaceId(workspaceIdParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceIdParam]);

  const filteredTasks = useMemo(() => {
    let result = tasks;

    if (statusFilter !== "all") {
      result = result.filter((task) => {
        const status = (task.status ?? "todo") as TaskStatus;
        return status === statusFilter;
      });
    }

    if (workspaceFilter !== "all") {
      result = result.filter((task) => task.workspaceId === workspaceFilter);
    }

    return result
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

        const aUpdated = a.updatedAt ? a.updatedAt.toMillis() : 0;
        const bUpdated = b.updatedAt ? b.updatedAt.toMillis() : 0;
        return bUpdated - aUpdated; // updatedAt desc
      });
  }, [tasks, statusFilter, workspaceFilter]);

  const activeTasks = useMemo(
    () => filteredTasks.filter((t) => ((t.status as TaskStatus | undefined) ?? "todo") !== "done"),
    [filteredTasks],
  );

  const completedTasks = useMemo(
    () => {
      // Completed list should respect workspace filter, but ignore statusFilter.
      let result = tasks;
      if (workspaceFilter !== "all") {
        result = result.filter((task) => task.workspaceId === workspaceFilter);
      }
      return result
        .filter((t) => ((t.status as TaskStatus | undefined) ?? "todo") === "done")
        .slice()
        .sort((a, b) => {
          const aUpdated = a.updatedAt ? a.updatedAt.toMillis() : 0;
          const bUpdated = b.updatedAt ? b.updatedAt.toMillis() : 0;
          return bUpdated - aUpdated;
        });
    },
    [tasks, workspaceFilter],
  );

  const handleCreateTask = async () => {
    const user = auth.currentUser;
    if (!user) {
      setCreateError("You must be signed in to create tasks.");
      return;
    }

    if (!isPro && allTasksForLimit.length >= 15) {
      setCreateError(freeLimitMessage);
      return;
    }

    if (workspaceRequired && !newWorkspaceId) {
      setCreateError("Sélectionne un dossier (workspace) dans la sidebar avant de créer une tâche.");
      return;
    }

    setCreateError(null);
    setCreateSuccess(null);

    const validation = newTaskSchema.safeParse({
      title: newTitle,
      status: newStatus,
      workspaceId: newWorkspaceId || undefined,
      dueDate: newDueDate || undefined,
    });

    if (!validation.success) {
      setCreateError(validation.error.issues[0]?.message ?? "Invalid task data.");
      return;
    }

    const { title, status, dueDate } = validation.data;

    const dueTimestamp = dueDate ? parseLocalDateTimeToTimestamp(dueDate) : null;

    setCreating(true);
    try {
      const payload: Omit<TaskDoc, "id"> = {
        userId: user.uid,
        title,
        status,
        workspaceId: newWorkspaceId,
        dueDate: dueTimestamp,
        favorite: false,
        createdAt: serverTimestamp() as unknown as TaskDoc["createdAt"],
        updatedAt: serverTimestamp() as unknown as TaskDoc["updatedAt"],
      };
      await addDoc(collection(db, "tasks"), payload);

      setNewTitle("");
      setNewStatus("todo");
      setNewWorkspaceId("");
      setNewDueDate("");
      setCreateSuccess("Task created.");
    } catch (e) {
      console.error("Error creating task", e);
      setCreateError("Error creating task.");
    } finally {
      setCreating(false);
    }
  };

  const handleMoveTask = async (task: TaskDoc, nextStatus: TaskStatus) => {
    if (!task.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== task.userId) return;

    setMovingTaskId(task.id);
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
      console.error("Error moving task", e);
    } finally {
      setMovingTaskId(null);
    }
  };

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

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData("text/plain", taskId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDrop = async (e: React.DragEvent, status: TaskStatus) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;

    const task = filteredTasks.find((t) => t.id === taskId);
    if (!task) return;

    await handleMoveTask(task, status);
  };

  const allowDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const tasksByStatus = useMemo(() => {
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

  const startEditing = (task: TaskDoc) => {
    setEditingId(task.id ?? null);
    setEditTitle(task.title);
    setEditStatus((task.status as TaskStatus | undefined) ?? "todo");
    setEditWorkspaceId(task.workspaceId ?? "");
    setEditDueDate(formatTimestampForInput(task.dueDate ?? null));
    setEditError(null);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditTitle("");
    setEditStatus("todo");
    setEditWorkspaceId("");
    setEditDueDate("");
    setEditError(null);
  };

  const handleSaveEdit = async (task: TaskDoc) => {
    if (!task.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== task.userId) {
      setEditError("Cannot update this task.");
      return;
    }

    setEditError(null);

    const validation = newTaskSchema.safeParse({
      title: editTitle,
      status: editStatus,
      workspaceId: editWorkspaceId || undefined,
      dueDate: editDueDate || undefined,
    });

    if (!validation.success) {
      setEditError(validation.error.issues[0]?.message ?? "Invalid task data.");
      return;
    }

    const { title, status, workspaceId, dueDate } = validation.data;
    const dueTimestamp = dueDate ? parseLocalDateTimeToTimestamp(dueDate) : null;

    setSavingEdit(true);
    try {
      await updateDoc(doc(db, "tasks", task.id), {
        title,
        status,
        workspaceId: workspaceId ?? null,
        dueDate: dueTimestamp,
        favorite: task.favorite === true,
        updatedAt: serverTimestamp(),
      });
      cancelEditing();
    } catch (e) {
      console.error("Error updating task", e);
      setEditError("Error updating task.");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteTask = async (task: TaskDoc) => {
    if (!task.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== task.userId) {
      return;
    }

    if (!confirm("Delete this task?")) return;

    setDeletingId(task.id);
    try {
      await deleteDoc(doc(db, "tasks", task.id));
    } catch (e) {
      console.error("Error deleting task", e);
    } finally {
      setDeletingId(null);
    }
  };

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

  const handleReminderTimeChange = (taskId: string, value: string) => {
    setNewReminderTimes((prev) => ({ ...prev, [taskId]: value }));
  };

  const handleCreateReminder = async (task: TaskDoc) => {
    if (!task.id) return;
    const user = auth.currentUser;
    if (!user) {
      setReminderError("You must be signed in to create reminders.");
      return;
    }

    const value = newReminderTimes[task.id] ?? "";
    if (!value) {
      setReminderError("Please select a reminder time.");
      return;
    }

    setReminderError(null);
    setCreatingReminderForId(task.id);

    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        setReminderError("Invalid reminder time.");
        setCreatingReminderForId(null);
        return;
      }

      const reminderTimeISO = date.toISOString();
      const dueDateISO = task.dueDate ? task.dueDate.toDate().toISOString() : "";

      await addDoc(collection(db, "taskReminders"), {
        userId: user.uid,
        taskId: task.id,
        dueDate: dueDateISO,
        reminderTime: reminderTimeISO,
        sent: false,
        createdAt: serverTimestamp(),
      });

      setNewReminderTimes((prev) => ({ ...prev, [task.id!]: "" }));
    } catch (e) {
      console.error("Error creating reminder", e);
      setReminderError("Error creating reminder.");
    } finally {
      setCreatingReminderForId(null);
    }
  };

  const handleDeleteReminder = async (reminder: TaskReminderDoc) => {
    if (!reminder.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== reminder.userId) {
      return;
    }

    if (!confirm("Delete this reminder?")) return;

    setDeletingReminderId(reminder.id);
    try {
      await deleteDoc(doc(db, "taskReminders", reminder.id));
    } catch (e) {
      console.error("Error deleting reminder", e);
    } finally {
      setDeletingReminderId(null);
    }
  };

  const canCreate = newTaskSchema.safeParse({
    title: newTitle,
    status: newStatus,
    workspaceId: newWorkspaceId || undefined,
    dueDate: newDueDate || undefined,
  }).success;

  const createWorkspaceMissing = workspaceRequired && !newWorkspaceId;

  useEffect(() => {
    if (!highlightedTaskId) return;
    const el = document.getElementById(`task-${highlightedTaskId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightedTaskId, filteredTasks.length]);

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-2 mb-4">
        <h1 className="text-xl font-semibold">Tasks</h1>
        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-2">
            <span>Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as TaskStatusFilter)}
              className="border border-border rounded px-2 py-1 bg-background"
            >
              <option value="all">All</option>
              <option value="todo">Todo</option>
              <option value="doing">Doing</option>
              <option value="done">Done</option>
            </select>
          </label>

          <label className="flex items-center gap-2">
            <span>Workspace:</span>
            <select
              value={workspaceFilter}
              onChange={(e) => setWorkspaceFilter(e.target.value as WorkspaceFilter)}
              className="border border-border rounded px-2 py-1 bg-background"
            >
              <option value="all">All</option>
              {workspaces.map((ws) => (
                <option key={ws.id ?? ws.name} value={ws.id ?? ""}>
                  {ws.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {/* New Task form */}
      <section className="border border-border rounded-lg bg-card">
        <div className="p-4 flex items-center justify-between gap-3">
          <h2 className="font-semibold">Tâches</h2>
          <button
            type="button"
            onClick={() => setCreateOpen((v) => !v)}
            className="inline-flex items-center justify-center px-3 py-2 rounded-md border border-border bg-background text-sm font-medium hover:bg-accent"
            aria-expanded={createOpen ? "true" : "false"}
            aria-controls="create-task-panel"
          >
            {createOpen ? "Fermer" : "Nouvelle tâche"}
          </button>
        </div>

        {createOpen && (
          <div className="px-4 pb-4 sn-animate-in" id="create-task-panel">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 items-end">
              <div className="space-y-1 lg:col-span-2">
                <label className="text-sm font-medium" htmlFor="task-new-title">
                  Titre
                </label>
                <input
                  id="task-new-title"
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                  placeholder="Ex: Payer le loyer"
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="task-new-status">
                  Statut
                </label>
                <select
                  id="task-new-status"
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value as TaskStatus)}
                  className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                >
                  <option value="todo">Todo</option>
                  <option value="doing">Doing</option>
                  <option value="done">Done</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="task-new-due">
                  Rappel
                </label>
                <input
                  id="task-new-due"
                  type="datetime-local"
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                  className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 items-end">
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="task-new-workspace">
                  Dossier
                </label>
                <select
                  id="task-new-workspace"
                  value={newWorkspaceId}
                  onChange={(e) => setNewWorkspaceId(e.target.value)}
                  className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                >
                  <option value="">—</option>
                  {workspaces.map((ws) => (
                    <option key={ws.id ?? ws.name} value={ws.id ?? ""}>
                      {ws.name}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={handleCreateTask}
                disabled={creating || !canCreate || createWorkspaceMissing}
                className="h-10 inline-flex items-center justify-center px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {creating ? "Création…" : "Créer"}
              </button>
            </div>

            {createWorkspaceMissing && (
              <p className="mt-2 text-sm text-muted-foreground">
                Sélectionne un dossier (workspace) dans la sidebar pour créer des tâches.
              </p>
            )}
            {createError && <p className="mt-2 text-sm text-destructive">{createError}</p>}
            {showUpgradeCta && (
              <Link
                href="/upgrade"
                className="mt-2 inline-flex items-center justify-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium"
              >
                Passer Pro
              </Link>
            )}
            {createSuccess && <p className="mt-2 text-sm">{createSuccess}</p>}
          </div>
        )}
      </section>

      {loading && (
        <div className="sn-empty">
          <div className="mx-auto sn-spinner" />
          <div className="sn-empty-title mt-3">Chargement</div>
          <div className="sn-empty-desc">Récupération de tes tâches…</div>
        </div>
      )}

      {error && (
        <div className="sn-empty">
          <div className="sn-empty-title">Erreur</div>
          <div className="sn-empty-desc">Impossible de charger les tâches pour le moment.</div>
        </div>
      )}

      {!loading && !error && activeTasks.length === 0 && (
        <div className="sn-empty">
          <div className="sn-empty-title">Aucune tâche</div>
          <div className="sn-empty-desc">Crée ta première tâche avec “Nouvelle tâche”.</div>
        </div>
      )}

      {!loading && !error && viewMode === "list" && activeTasks.length > 0 && (
        <ul className="space-y-2">
          {activeTasks.map((task) => {
            const isEditing = editingId === task.id;
            const status = (task.status as TaskStatus | undefined) ?? "todo";
            const workspaceName =
              workspaces.find((ws) => ws.id === task.workspaceId)?.name ?? "—";
            const dueLabel = formatTimestampToLocalString(task.dueDate ?? null);

            const taskReminders = reminders.filter((r) => r.taskId === task.id);

            return (
              <li
                key={task.id}
                id={task.id ? `task-${task.id}` : undefined}
                className={`sn-card sn-card--task ${task.favorite ? " sn-card--favorite" : ""} p-4 ${
                  task.id && task.id === highlightedTaskId ? "border-primary" : ""
                }`}
              >
                {!isEditing && (
                  <>
                    <div className="space-y-3">
                      <div className="sn-card-header">
                        <div className="min-w-0">
                          <div className="sn-card-title truncate">{task.title}</div>
                          <div className="sn-card-meta">
                            <span className="sn-badge">{workspaceName}</span>
                            <span className="sn-badge">{status}</span>
                            {dueLabel && <span className="sn-badge">Rappel: {dueLabel}</span>}
                          </div>
                        </div>

                        <div className="sn-card-actions sn-card-actions-secondary shrink-0">
                          <button
                            type="button"
                            onClick={() => toggleFavorite(task)}
                            className="sn-icon-btn"
                            aria-label={task.favorite ? "Unfavorite" : "Favorite"}
                            title={task.favorite ? "Unfavorite" : "Favorite"}
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
                            onChange={(e) => toggleDone(task, e.target.checked)}
                          />
                          <span className="text-muted-foreground">Terminé</span>
                        </label>

                        <div className="sn-card-actions sn-card-actions-secondary">
                          <button
                            type="button"
                            onClick={() => startEditing(task)}
                            className="sn-text-btn"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteTask(task)}
                            disabled={deletingId === task.id}
                            className="sn-text-btn text-destructive disabled:opacity-50"
                          >
                            {deletingId === task.id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Reminders panel */}
                    <div className="mt-3 space-y-1 text-sm">
                      <div className="font-semibold">Reminders</div>
                      {remindersLoading && <p>Loading reminders...</p>}
                      {remindersError && <p>Error loading reminders.</p>}

                      {!remindersLoading && taskReminders.length === 0 && (
                        <p>No reminders.</p>
                      )}

                      {!remindersLoading && taskReminders.length > 0 && (
                        <ul className="space-y-1">
                          {taskReminders.map((reminder) => (
                            <li key={reminder.id} className="flex items-center gap-2">
                              <span>
                                {new Date(reminder.reminderTime).toLocaleString()} {" "}
                                {reminder.sent ? "(sent)" : "(pending)"}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleDeleteReminder(reminder)}
                                disabled={deletingReminderId === reminder.id}
                                className="sn-text-btn text-destructive disabled:opacity-50"
                              >
                                {deletingReminderId === reminder.id ? "Deleting..." : "Delete"}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}

                      <div className="flex flex-wrap gap-2 items-center">
                        <input
                          type="datetime-local"
                          value={newReminderTimes[task.id ?? ""] ?? ""}
                          onChange={(e) => handleReminderTimeChange(task.id ?? "", e.target.value)}
                          aria-label="Reminder time"
                          className="border border-input rounded-md px-2 py-1 bg-background"
                        />
                        <button
                          type="button"
                          onClick={() => handleCreateReminder(task)}
                          disabled={creatingReminderForId === task.id}
                          className="sn-text-btn"
                        >
                          {creatingReminderForId === task.id ? "Saving..." : "Add reminder"}
                        </button>
                      </div>
                      {reminderError && <p className="text-xs">{reminderError}</p>}
                    </div>
                  </>
                )}

                {isEditing && (
                  <>
                    <div className="flex flex-wrap gap-2 items-center text-sm">
                      <label className="flex flex-col">
                        <span>Title</span>
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="border border-border rounded px-2 py-1 bg-background"
                        />
                      </label>

                      <label className="flex flex-col">
                        <span>Status</span>
                        <select
                          value={editStatus}
                          onChange={(e) => setEditStatus(e.target.value as TaskStatus)}
                          className="border border-border rounded px-2 py-1 bg-background"
                        >
                          <option value="todo">Todo</option>
                          <option value="doing">Doing</option>
                          <option value="done">Done</option>
                        </select>
                      </label>

                      <label className="flex flex-col">
                        <span>Workspace</span>
                        <select
                          value={editWorkspaceId}
                          onChange={(e) => setEditWorkspaceId(e.target.value)}
                          className="border border-border rounded px-2 py-1 bg-background"
                        >
                          <option value="">—</option>
                          {workspaces.map((ws) => (
                            <option key={ws.id ?? ws.name} value={ws.id ?? ""}>
                              {ws.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="flex flex-col">
                        <span>Due date</span>
                        <input
                          type="datetime-local"
                          value={editDueDate}
                          onChange={(e) => setEditDueDate(e.target.value)}
                          className="border border-border rounded px-2 py-1 bg-background"
                        />
                      </label>
                    </div>
                    <div className="mt-2 flex gap-2 text-sm">
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(task)}
                        disabled={savingEdit}
                        className="border border-border rounded px-2 py-1 bg-background"
                      >
                        {savingEdit ? "Saving..." : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditing}
                        className="border border-border rounded px-2 py-1 bg-background"
                      >
                        Cancel
                      </button>
                    </div>
                    {editError && <p className="text-sm mt-1">{editError}</p>}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!loading && !error && viewMode === "grid" && activeTasks.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {activeTasks.map((task) => {
            const isEditing = editingId === task.id;
            const status = (task.status as TaskStatus | undefined) ?? "todo";
            const workspaceName =
              workspaces.find((ws) => ws.id === task.workspaceId)?.name ?? "—";
            const dueLabel = formatTimestampToLocalString(task.dueDate ?? null);
            const taskReminders = reminders.filter((r) => r.taskId === task.id);
            const nextReminder = taskReminders
              .slice()
              .sort((a, b) => new Date(a.reminderTime).getTime() - new Date(b.reminderTime).getTime())[0];

            return (
              <div
                key={task.id}
                id={task.id ? `task-${task.id}` : undefined}
                className={`sn-card sn-card--task ${task.favorite ? " sn-card--favorite" : ""} p-4 min-w-0 ${
                  task.id && task.id === highlightedTaskId ? "border-primary" : ""
                }`}
              >
                {!isEditing && (
                  <>
                    <div className="flex flex-col gap-3">
                      <div className="sn-card-header">
                        <div className="min-w-0">
                          <div className="sn-card-title line-clamp-2">{task.title}</div>
                          <div className="sn-card-meta">
                            <span className="sn-badge">{workspaceName}</span>
                            <span className="sn-badge">{status}</span>
                            {(!!dueLabel || !!nextReminder) && (
                              <span className="sn-badge">
                                {dueLabel
                                  ? `Rappel: ${dueLabel}`
                                  : `Rappel: ${new Date(nextReminder!.reminderTime).toLocaleString()}`}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="sn-card-actions sn-card-actions-secondary shrink-0">
                          <button
                            type="button"
                            onClick={() => toggleFavorite(task)}
                            className="sn-icon-btn"
                            aria-label={task.favorite ? "Unfavorite" : "Favorite"}
                            title={task.favorite ? "Unfavorite" : "Favorite"}
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
                            onChange={(e) => toggleDone(task, e.target.checked)}
                          />
                          <span className="text-muted-foreground">Terminé</span>
                        </label>
                        <div className="sn-card-actions sn-card-actions-secondary">
                          <button type="button" onClick={() => startEditing(task)} className="sn-text-btn">
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteTask(task)}
                            disabled={deletingId === task.id}
                            className="sn-text-btn text-destructive disabled:opacity-50"
                          >
                            {deletingId === task.id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Reminders panel */}
                    <div className="mt-3 space-y-1 text-sm">
                      <div className="font-semibold">Reminders</div>
                      {remindersLoading && <p>Loading reminders...</p>}
                      {remindersError && <p>Error loading reminders.</p>}

                      {!remindersLoading && taskReminders.length === 0 && <p>No reminders.</p>}

                      {!remindersLoading && taskReminders.length > 0 && (
                        <ul className="space-y-1">
                          {taskReminders.map((reminder) => (
                            <li key={reminder.id} className="flex items-center gap-2">
                              <span>
                                {new Date(reminder.reminderTime).toLocaleString()} {" "}
                                {reminder.sent ? "(sent)" : "(pending)"}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleDeleteReminder(reminder)}
                                disabled={deletingReminderId === reminder.id}
                                className="sn-text-btn text-destructive disabled:opacity-50"
                              >
                                {deletingReminderId === reminder.id ? "Deleting..." : "Delete"}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}

                      <div className="flex flex-wrap gap-2 items-center">
                        <input
                          type="datetime-local"
                          value={newReminderTimes[task.id ?? ""] ?? ""}
                          onChange={(e) => handleReminderTimeChange(task.id ?? "", e.target.value)}
                          aria-label="Reminder time"
                          className="border border-input rounded-md px-2 py-1 bg-background"
                        />
                        <button
                          type="button"
                          onClick={() => handleCreateReminder(task)}
                          disabled={creatingReminderForId === task.id}
                          className="sn-text-btn"
                        >
                          {creatingReminderForId === task.id ? "Saving..." : "Add reminder"}
                        </button>
                      </div>
                      {reminderError && <p className="text-xs">{reminderError}</p>}
                    </div>
                  </>
                )}

                {isEditing && (
                  <>
                    <div className="flex flex-wrap gap-2 items-center text-sm">
                      <label className="flex flex-col">
                        <span>Title</span>
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="border border-border rounded px-2 py-1 bg-background"
                        />
                      </label>

                      <label className="flex flex-col">
                        <span>Status</span>
                        <select
                          value={editStatus}
                          onChange={(e) => setEditStatus(e.target.value as TaskStatus)}
                          className="border border-border rounded px-2 py-1 bg-background"
                        >
                          <option value="todo">Todo</option>
                          <option value="doing">Doing</option>
                          <option value="done">Done</option>
                        </select>
                      </label>

                      <label className="flex flex-col">
                        <span>Workspace</span>
                        <select
                          value={editWorkspaceId}
                          onChange={(e) => setEditWorkspaceId(e.target.value)}
                          className="border border-border rounded px-2 py-1 bg-background"
                        >
                          <option value="">—</option>
                          {workspaces.map((ws) => (
                            <option key={ws.id ?? ws.name} value={ws.id ?? ""}>
                              {ws.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="flex flex-col">
                        <span>Due date</span>
                        <input
                          type="datetime-local"
                          value={editDueDate}
                          onChange={(e) => setEditDueDate(e.target.value)}
                          className="border border-border rounded px-2 py-1 bg-background"
                        />
                      </label>
                    </div>
                    <div className="mt-2 flex gap-2 text-sm">
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(task)}
                        disabled={savingEdit}
                        className="border border-border rounded px-2 py-1 bg-background"
                      >
                        {savingEdit ? "Saving..." : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditing}
                        className="border border-border rounded px-2 py-1 bg-background"
                      >
                        Cancel
                      </button>
                    </div>
                    {editError && <p className="text-sm mt-1">{editError}</p>}
                  </>
                )}
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
              onDragOver={allowDrop}
              onDrop={(e) => handleDrop(e, colStatus)}
            >
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold capitalize">{colStatus}</h2>
                <span className="text-xs text-muted-foreground">{tasksByStatus[colStatus].length}</span>
              </div>

              <div className="space-y-2">
                {tasksByStatus[colStatus].map((task) => {
                  const dueLabel = formatTimestampToLocalString(task.dueDate ?? null);
                  const isMoving = movingTaskId === task.id;

                  return (
                    <div
                      key={task.id}
                      draggable={!isMoving}
                      onDragStart={(e) => task.id && handleDragStart(e, task.id)}
                      className={`border border-border rounded-md bg-background p-2 cursor-move transition-shadow ${
                        isMoving ? "opacity-50" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{task.title}</div>
                          {dueLabel && (
                            <div className="text-xs text-muted-foreground mt-0.5">Due: {dueLabel}</div>
                          )}
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
                          <button type="button" onClick={() => startEditing(task)} className="sn-text-btn">
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleFavorite(task)}
                            className="sn-text-btn"
                            aria-label={task.favorite ? "Unfavorite" : "Favorite"}
                          >
                            {task.favorite ? "★" : "☆"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteTask(task)}
                            className="sn-text-btn text-destructive"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {tasksByStatus[colStatus].length === 0 && (
                  <div className="text-sm text-muted-foreground">Dépose une tâche ici</div>
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
