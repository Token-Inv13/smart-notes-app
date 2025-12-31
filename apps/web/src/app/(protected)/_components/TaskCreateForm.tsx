"use client";

import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useUserTasks } from "@/hooks/useUserTasks";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useUserWorkspaces } from "@/hooks/useUserWorkspaces";
import { parseLocalDateTimeToTimestamp } from "@/lib/datetime";
import type { TaskDoc } from "@/types/firestore";

type TaskStatus = "todo" | "doing" | "done";

type Props = {
  initialWorkspaceId?: string;
  onCreated?: () => void;
};

const newTaskSchema = z.object({
  title: z.string().min(1, "Le titre est requis."),
  status: z.union([z.literal("todo"), z.literal("doing"), z.literal("done")]),
  workspaceId: z.string().min(1, "Sélectionne un dossier (workspace)."),
  dueDate: z.string().optional(),
});

export default function TaskCreateForm({ initialWorkspaceId, onCreated }: Props) {
  const { data: workspaces } = useUserWorkspaces();
  const { data: userSettings } = useUserSettings();
  const isPro = userSettings?.plan === "pro";
  const freeLimitMessage =
    "Limite Free atteinte. Passe en Pro pour créer plus de tâches et utiliser les favoris sans limite.";

  const { data: allTasksForLimit } = useUserTasks({ limit: 16 });

  const [newTitle, setNewTitle] = useState("");
  const [newStatus, setNewStatus] = useState<TaskStatus>("todo");
  const [newWorkspaceId, setNewWorkspaceId] = useState<string>(initialWorkspaceId ?? "");
  const [newDueDate, setNewDueDate] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    setNewWorkspaceId(initialWorkspaceId ?? "");
  }, [initialWorkspaceId]);

  const canCreate = useMemo(
    () =>
      newTaskSchema.safeParse({
        title: newTitle,
        status: newStatus,
        workspaceId: newWorkspaceId,
        dueDate: newDueDate || undefined,
      }).success,
    [newTitle, newStatus, newWorkspaceId, newDueDate],
  );

  const handleCreateTask = async () => {
    const user = auth.currentUser;
    if (!user) {
      setCreateError("Connecte-toi pour créer ta première tâche.");
      return;
    }

    if (!isPro && allTasksForLimit.length >= 15) {
      setCreateError(freeLimitMessage);
      return;
    }

    const validation = newTaskSchema.safeParse({
      title: newTitle,
      status: newStatus,
      workspaceId: newWorkspaceId,
      dueDate: newDueDate || undefined,
    });

    if (!validation.success) {
      setCreateError(validation.error.issues[0]?.message ?? "Données invalides.");
      return;
    }

    setCreateError(null);

    const dueTimestamp = validation.data.dueDate ? parseLocalDateTimeToTimestamp(validation.data.dueDate) : null;

    setCreating(true);
    try {
      const payload: Omit<TaskDoc, "id"> = {
        userId: user.uid,
        title: validation.data.title,
        status: validation.data.status,
        workspaceId: validation.data.workspaceId,
        dueDate: dueTimestamp,
        favorite: false,
        archived: false,
        createdAt: serverTimestamp() as unknown as TaskDoc["createdAt"],
        updatedAt: serverTimestamp() as unknown as TaskDoc["updatedAt"],
      };
      const taskRef = await addDoc(collection(db, "tasks"), payload);

      if (validation.data.dueDate) {
        const reminderDate = new Date(validation.data.dueDate);
        if (!Number.isNaN(reminderDate.getTime())) {
          await addDoc(collection(db, "taskReminders"), {
            userId: user.uid,
            taskId: taskRef.id,
            dueDate: dueTimestamp ? dueTimestamp.toDate().toISOString() : "",
            reminderTime: reminderDate.toISOString(),
            sent: false,
            createdAt: serverTimestamp(),
          });
        }
      }

      setNewTitle("");
      setNewStatus("todo");
      setNewWorkspaceId("");
      setNewDueDate("");

      onCreated?.();
    } catch (e) {
      console.error("Error creating task", e);
      setCreateError("Erreur lors de la création de la tâche.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-3">
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
            placeholder="Ex : Payer le loyer"
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
            <option value="todo">À faire</option>
            <option value="doing">En cours</option>
            <option value="done">Terminée</option>
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

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 items-end">
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
          disabled={creating || !canCreate}
          className="h-10 inline-flex items-center justify-center px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {creating ? "Création…" : "Créer la tâche"}
        </button>
      </div>

      {createError && <div className="sn-alert sn-alert--error">{createError}</div>}
    </div>
  );
}
