"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useUserTasks } from "@/hooks/useUserTasks";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useUserWorkspaces } from "@/hooks/useUserWorkspaces";
import { parseLocalDateTimeToTimestamp, parseLocalDateToTimestamp } from "@/lib/datetime";
import { toUserErrorMessage } from "@/lib/userError";
import type { TaskDoc } from "@/types/firestore";
import DictationMicButton from "./DictationMicButton";
import { insertTextAtSelection, prepareDictationTextForInsertion } from "@/lib/textInsert";

type TaskStatus = "todo" | "doing" | "done";

type Props = {
  initialWorkspaceId?: string;
  initialFavorite?: boolean;
  onCreated?: () => void;
};

const newTaskSchema = z.object({
  title: z.string().min(1, "Le titre est requis."),
  status: z.union([z.literal("todo"), z.literal("doing"), z.literal("done")]),
  workspaceId: z.string().optional(),
  startDate: z.string().optional(),
  dueDate: z.string().optional(),
  priority: z.union([z.literal("low"), z.literal("medium"), z.literal("high")]).optional(),
});

export default function TaskCreateForm({ initialWorkspaceId, initialFavorite, onCreated }: Props) {
  const { data: workspaces } = useUserWorkspaces();
  const { data: userSettings } = useUserSettings();
  const isPro = userSettings?.plan === "pro";
  const freeLimitMessage =
    "Limite Free atteinte. Passe en Pro pour créer plus d’éléments d’agenda et utiliser les favoris sans limite.";

  const { data: allTasksForLimit } = useUserTasks({ limit: 16 });
  const { data: favoriteTasksForLimit } = useUserTasks({ favoriteOnly: true, limit: 16 });

  const [newTitle, setNewTitle] = useState("");
  const [newStatus, setNewStatus] = useState<TaskStatus>("todo");
  const [newWorkspaceId, setNewWorkspaceId] = useState<string>(initialWorkspaceId ?? "");
  const [newStartDate, setNewStartDate] = useState<string>("");
  const [newDueDate, setNewDueDate] = useState<string>("");
  const [newPriority, setNewPriority] = useState<"" | NonNullable<TaskDoc["priority"]>>("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const [dictationStatus, setDictationStatus] = useState<"idle" | "listening" | "stopped" | "error">("idle");
  const [dictationError, setDictationError] = useState<string | null>(null);

  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedDraftRef = useRef<string>("");
  const DRAFT_KEY = "smartnotes:draft:new-task";

  useEffect(() => {
    setNewWorkspaceId(initialWorkspaceId ?? "");
  }, [initialWorkspaceId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = window.sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        title?: string;
        status?: TaskStatus;
        workspaceId?: string;
        startDate?: string;
        dueDate?: string;
        priority?: TaskDoc["priority"] | null;
      };

      setNewTitle((prev) => prev || (typeof parsed.title === "string" ? parsed.title : ""));
      setNewStatus((prev) => prev || (parsed.status === "todo" || parsed.status === "doing" || parsed.status === "done" ? parsed.status : prev));
      setNewWorkspaceId((prev) => prev || (typeof parsed.workspaceId === "string" ? parsed.workspaceId : ""));
      setNewStartDate((prev) => prev || (typeof parsed.startDate === "string" ? parsed.startDate : ""));
      setNewDueDate((prev) => prev || (typeof parsed.dueDate === "string" ? parsed.dueDate : ""));
      setNewPriority((prev) => prev || (parsed.priority === "low" || parsed.priority === "medium" || parsed.priority === "high" ? parsed.priority : ""));
      lastSavedDraftRef.current = raw;
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const draft = JSON.stringify({
      title: newTitle,
      status: newStatus,
      workspaceId: newWorkspaceId,
      startDate: newStartDate,
      dueDate: newDueDate,
      priority: newPriority || null,
    });

    if (draft === lastSavedDraftRef.current) return;

    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      try {
        window.sessionStorage.setItem(DRAFT_KEY, draft);
        lastSavedDraftRef.current = draft;
      } catch {
        // ignore
      }
    }, 800);

    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    };
  }, [newTitle, newStatus, newWorkspaceId, newStartDate, newDueDate, newPriority]);

  const canCreate = useMemo(
    () =>
      newTaskSchema.safeParse({
        title: newTitle,
        status: newStatus,
        workspaceId: newWorkspaceId || undefined,
        startDate: newStartDate || undefined,
        dueDate: newDueDate || undefined,
        priority: newPriority || undefined,
      }).success,
    [newTitle, newStatus, newWorkspaceId, newStartDate, newDueDate, newPriority],
  );

  const dateWarning = useMemo(() => {
    if (!newStartDate || !newDueDate) return null;
    const startTs = parseLocalDateToTimestamp(newStartDate);
    const dueTs = parseLocalDateTimeToTimestamp(newDueDate);
    if (!startTs || !dueTs) return null;
    if (startTs.toMillis() > dueTs.toMillis()) return "La date de début est après la date de fin.";
    return null;
  }, [newStartDate, newDueDate]);

  const dueDateFeedback = useMemo(() => {
    if (!newDueDate) return null;
    const ts = parseLocalDateTimeToTimestamp(newDueDate);
    if (!ts) {
      return {
        tone: "error" as const,
        text: "Format attendu: AAAA-MM-JJTHH:MM.",
      };
    }
    return {
      tone: "muted" as const,
      text: `Échéance: ${ts.toDate().toLocaleString("fr-FR")}`,
    };
  }, [newDueDate]);

  const startDateFeedback = useMemo(() => {
    if (!newStartDate) return null;
    const ts = parseLocalDateToTimestamp(newStartDate);
    if (!ts) {
      return {
        tone: "error" as const,
        text: "Format attendu: AAAA-MM-JJ.",
      };
    }
    return {
      tone: "muted" as const,
      text: `Début: ${ts.toDate().toLocaleDateString("fr-FR")}`,
    };
  }, [newStartDate]);

  const handleCreateTask = async () => {
    const user = auth.currentUser;
    if (!user) {
      setCreateError("Connecte-toi pour créer ton premier élément d’agenda.");
      return;
    }

    const activeTasksCount = allTasksForLimit.filter((t) => t.archived !== true).length;
    if (!isPro && activeTasksCount >= 15) {
      setCreateError(freeLimitMessage);
      return;
    }

    const validation = newTaskSchema.safeParse({
      title: newTitle,
      status: newStatus,
      workspaceId: newWorkspaceId || undefined,
      startDate: newStartDate || undefined,
      dueDate: newDueDate || undefined,
      priority: newPriority || undefined,
    });

    if (!validation.success) {
      setCreateError(validation.error.issues[0]?.message ?? "Données invalides.");
      return;
    }

    setCreateError(null);

    const startTimestamp = validation.data.startDate ? parseLocalDateToTimestamp(validation.data.startDate) : null;
    const dueTimestamp = validation.data.dueDate ? parseLocalDateTimeToTimestamp(validation.data.dueDate) : null;

    if (validation.data.startDate && !startTimestamp) {
      setCreateError("Date de début invalide (format attendu: AAAA-MM-JJ).");
      return;
    }

    if (validation.data.dueDate && !dueTimestamp) {
      setCreateError("Date d’échéance invalide (format attendu: AAAA-MM-JJTHH:MM).");
      return;
    }

    setCreating(true);
    try {
      const activeFavoriteCount = favoriteTasksForLimit.filter((t) => t.archived !== true).length;
      const canFavoriteNow =
        initialFavorite === true ? isPro || activeFavoriteCount < 15 : false;

      const payload: Omit<TaskDoc, "id"> = {
        userId: user.uid,
        title: validation.data.title,
        status: validation.data.status,
        workspaceId: validation.data.workspaceId ?? null,
        startDate: startTimestamp,
        dueDate: dueTimestamp,
        priority: validation.data.priority ?? null,
        favorite: canFavoriteNow,
        archived: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const taskRef = await addDoc(collection(db, "tasks"), payload);

      if (initialFavorite === true && !canFavoriteNow) {
        try {
          if (typeof window !== "undefined") {
            window.sessionStorage.setItem(
              "smartnotes:flash",
              "Élément d’agenda créé, mais non épinglé (limite Free). Passe en Pro ou retire un favori.",
            );
          }
        } catch {
          // ignore
        }
      }

      if (isPro && validation.data.dueDate) {
        const reminderDate = new Date(validation.data.dueDate);
        if (!Number.isNaN(reminderDate.getTime())) {
          try {
            await addDoc(collection(db, "taskReminders"), {
              userId: user.uid,
              taskId: taskRef.id,
              dueDate: dueTimestamp ? dueTimestamp.toDate().toISOString() : "",
              reminderTime: reminderDate.toISOString(),
              sent: false,
              createdAt: serverTimestamp(),
            });
          } catch (e) {
            console.error("Error creating task reminder", e);
          }
        }
      }

      try {
        if (typeof window !== "undefined") window.sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        // ignore
      }

      setNewTitle("");
      setNewStatus("todo");
      setNewWorkspaceId("");
      setNewStartDate("");
      setNewDueDate("");
      setNewPriority("");

      onCreated?.();
    } catch (e) {
      console.error("Error creating task", e);
      setCreateError(toUserErrorMessage(e, "Impossible de créer l’élément d’agenda."));
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
          <div className="flex items-center gap-2">
            <input
              id="task-new-title"
              ref={titleInputRef}
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="flex-1 w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
              placeholder="Ex : Payer le loyer"
              disabled={creating}
            />
            <DictationMicButton
              disabled={creating}
              onFinalText={(rawText) => {
                const el = titleInputRef.current;
                const insert = prepareDictationTextForInsertion({
                  value: newTitle,
                  selectionStart: el?.selectionStart ?? null,
                  rawText,
                });
                if (!insert) return;
                const { nextValue, nextCursor } = insertTextAtSelection({
                  value: newTitle,
                  selectionStart: el?.selectionStart ?? null,
                  selectionEnd: el?.selectionEnd ?? null,
                  text: insert,
                });
                setNewTitle(nextValue);
                window.requestAnimationFrame(() => {
                  try {
                    el?.focus();
                    el?.setSelectionRange(nextCursor, nextCursor);
                  } catch {
                    // ignore
                  }
                });
              }}
              onStatusChange={(st, err) => {
                setDictationStatus(st);
                setDictationError(err);
              }}
            />
          </div>
          {dictationStatus === "listening" ? (
            <div className="text-xs text-muted-foreground">Écoute…</div>
          ) : dictationError ? (
            <div className="text-xs text-destructive">{dictationError}</div>
          ) : null}
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
            Date de fin / échéance
          </label>
          <input
            id="task-new-due"
            type="datetime-local"
            value={newDueDate}
            onChange={(e) => setNewDueDate(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            className={`w-full px-3 py-2 border rounded-md bg-background text-foreground text-sm ${dateWarning ? "border-destructive" : "border-input"}`}
          />
          {dueDateFeedback ? (
            <div className={`text-xs ${dueDateFeedback.tone === "error" ? "text-destructive" : "text-muted-foreground"}`}>
              {dueDateFeedback.text}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 items-end">
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="task-new-start">
            Date de début
          </label>
          <input
            id="task-new-start"
            type="date"
            value={newStartDate}
            onChange={(e) => setNewStartDate(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            className={`w-full px-3 py-2 border rounded-md bg-background text-foreground text-sm ${dateWarning ? "border-destructive" : "border-input"}`}
          />
          {startDateFeedback ? (
            <div className={`text-xs ${startDateFeedback.tone === "error" ? "text-destructive" : "text-muted-foreground"}`}>
              {startDateFeedback.text}
            </div>
          ) : null}
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="task-new-priority">
            Priorité
          </label>
          <select
            id="task-new-priority"
            value={newPriority}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "low" || v === "medium" || v === "high") setNewPriority(v);
              else setNewPriority("");
            }}
            className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
          >
            <option value="">—</option>
            <option value="low">Basse</option>
            <option value="medium">Moyenne</option>
            <option value="high">Haute</option>
          </select>
        </div>
      </div>

      {dateWarning && (
        <div className="sn-alert" role="status" aria-live="polite">
          {dateWarning}
        </div>
      )}

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
          {creating ? "Création…" : "Créer dans l’agenda"}
        </button>
      </div>

      {createError && <div className="sn-alert sn-alert--error">{createError}</div>}
    </div>
  );
}
