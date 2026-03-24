"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { addDoc, collection, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useUserTasks } from "@/hooks/useUserTasks";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useUserWorkspaces } from "@/hooks/useUserWorkspaces";
import {
  DATETIME_PLACEHOLDER_FR,
  DATE_PLACEHOLDER_FR,
  formatTimestampToDateFr,
  formatTimestampToDateTimeFr,
  getUserTimezone,
  isExactAllDayWindow,
  parseLocalDateTimeToTimestamp,
  parseLocalDateToTimestamp,
} from "@/lib/datetime";
import { toUserErrorMessage } from "@/lib/userError";
import { buildWorkspacePathLabelMap } from "@/lib/workspaces";
import type { TaskDoc } from "@/types/firestore";
import DictationMicButton from "./DictationMicButton";
import { insertTextAtSelection, prepareDictationTextForInsertion } from "@/lib/textInsert";
import {
  createTaskWithPlanGuard,
  FREE_TASK_LIMIT_MESSAGE,
  getPlanLimitMessage,
  serializeTaskRecurrence,
  serializeTimestampMillis,
} from "@/lib/planGuardedMutations";
import {
  TASK_EMPTY_PRIORITY_LABEL,
  TASK_EMPTY_WORKSPACE_LABEL,
  TASK_FIELD_DUE_LABEL,
  TASK_FIELD_PRIORITY_LABEL,
  TASK_FIELD_START_LABEL,
  TASK_FIELD_TITLE_LABEL,
  TASK_FIELD_WORKSPACE_LABEL,
  TASK_PRIORITY_OPTIONS,
} from "./taskModalLabels";

type TaskStatus = "todo" | "doing" | "done";

type Props = {
  initialWorkspaceId?: string;
  initialFavorite?: boolean;
  initialStartDate?: string;
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

function toLocalDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function TaskCreateForm({ initialWorkspaceId, initialFavorite, initialStartDate, onCreated }: Props) {
  const { data: workspaces } = useUserWorkspaces();
  const workspaceOptionLabelById = useMemo(() => buildWorkspacePathLabelMap(workspaces), [workspaces]);
  const { data: userSettings } = useUserSettings();
  const isPro = userSettings?.plan === "pro";
  const freeLimitMessage = FREE_TASK_LIMIT_MESSAGE;

  const { data: allTasksForLimit } = useUserTasks({ limit: 16 });
  const { data: favoriteTasksForLimit } = useUserTasks({ favoriteOnly: true, limit: 16 });

  const [newTitle, setNewTitle] = useState("");
  const [newStatus, setNewStatus] = useState<TaskStatus>("todo");
  const [newWorkspaceId, setNewWorkspaceId] = useState<string>(initialWorkspaceId ?? "");
  const [newStartDate, setNewStartDate] = useState<string>(initialStartDate ?? "");
  const [newDueDate, setNewDueDate] = useState<string>("");
  const [newPriority, setNewPriority] = useState<"" | NonNullable<TaskDoc["priority"]>>("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createFeedback, setCreateFeedback] = useState<string | null>(null);

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
    if (!initialStartDate) return;
    setNewStartDate((prev) => prev || initialStartDate);
  }, [initialStartDate]);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      titleInputRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    if (!createFeedback) return;
    const timer = window.setTimeout(() => setCreateFeedback(null), 1800);
    return () => window.clearTimeout(timer);
  }, [createFeedback]);

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
        text: `Format attendu: ${DATETIME_PLACEHOLDER_FR}.`,
      };
    }
    return {
      tone: "muted" as const,
      text: `Échéance: ${formatTimestampToDateTimeFr(ts)}`,
    };
  }, [newDueDate]);

  const startDateFeedback = useMemo(() => {
    if (!newStartDate) return null;
    const ts = parseLocalDateToTimestamp(newStartDate);
    if (!ts) {
      return {
        tone: "error" as const,
        text: `Format attendu: ${DATE_PLACEHOLDER_FR}.`,
      };
    }
    return {
      tone: "muted" as const,
      text: `Début: ${formatTimestampToDateFr(ts)}`,
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
    setCreateFeedback(null);

    const startTimestamp = validation.data.startDate ? parseLocalDateToTimestamp(validation.data.startDate) : null;
    const dueTimestamp = validation.data.dueDate ? parseLocalDateTimeToTimestamp(validation.data.dueDate) : null;

    if (validation.data.startDate && !startTimestamp) {
      setCreateError(`Date de début invalide (format attendu: ${DATE_PLACEHOLDER_FR}).`);
      return;
    }

    if (validation.data.dueDate && !dueTimestamp) {
      setCreateError(`Date d'échéance invalide (format attendu: ${DATETIME_PLACEHOLDER_FR}).`);
      return;
    }

    setCreating(true);
    try {
      const activeFavoriteCount = favoriteTasksForLimit.filter((t) => t.archived !== true).length;
      const canFavoriteNow =
        initialFavorite === true ? isPro || activeFavoriteCount < 15 : false;

      const explicitAllDay =
        startTimestamp && dueTimestamp
          ? isExactAllDayWindow(startTimestamp.toDate(), dueTimestamp.toDate())
          : false;

      const taskResult = await createTaskWithPlanGuard({
        title: validation.data.title,
        description: "",
        status: validation.data.status,
        workspaceId: validation.data.workspaceId ?? null,
        allDay: explicitAllDay,
        startDateMs: serializeTimestampMillis(startTimestamp),
        dueDateMs: serializeTimestampMillis(dueTimestamp),
        priority: validation.data.priority ?? null,
        calendarKind: "task",
        recurrence: serializeTaskRecurrence(null),
        favorite: canFavoriteNow,
        archived: false,
        sourceType: null,
        sourceTodoId: null,
        sourceTodoItemId: null,
      });

      if (initialFavorite === true && !taskResult.favoriteApplied) {
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

      if (isPro && validation.data.dueDate && !explicitAllDay) {
        const reminderDate = new Date(validation.data.dueDate);
        if (!Number.isNaN(reminderDate.getTime())) {
          try {
            await addDoc(collection(db, "taskReminders"), {
              userId: user.uid,
              taskId: taskResult.taskId,
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

      if (startTimestamp && dueTimestamp) {
        const googleStart = startTimestamp.toDate();
        const googleEnd = dueTimestamp.toDate();
        const googlePayload = explicitAllDay
          ? {
              title: validation.data.title,
              start: toLocalDateInputValue(googleStart),
              end: toLocalDateInputValue(googleEnd),
              allDay: true,
            }
          : {
              title: validation.data.title,
              start: googleStart.toISOString(),
              end: googleEnd.toISOString(),
              allDay: false,
              timeZone: getUserTimezone(),
            };

        void fetch("/api/google/calendar/events", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(googlePayload),
        }).then(async (response) => {
          if (!response.ok) {
            console.warn("agenda.google.create_failed", {
              status: response.status,
              taskId: taskResult.taskId,
            });
            return;
          }

          const data = (await response.json().catch(() => null)) as { created?: unknown; eventId?: unknown } | null;
          const googleEventId =
            data?.created === true && typeof data.eventId === "string" && data.eventId.trim()
              ? data.eventId.trim()
              : null;

          if (!googleEventId) return;

          try {
            await updateDoc(doc(db, "tasks", taskResult.taskId), {
              googleEventId,
              updatedAt: serverTimestamp(),
            });
          } catch (error) {
            console.warn("agenda.google.link_write_failed", {
              taskId: taskResult.taskId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }).catch((error) => {
          console.warn("agenda.google.create_failed", {
            taskId: taskResult.taskId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
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
      setCreateFeedback("Élément ajouté à l’agenda.");

      window.requestAnimationFrame(() => {
        titleInputRef.current?.focus();
      });

      onCreated?.();
    } catch (e) {
      console.error("Error creating task", e);
      setCreateError(getPlanLimitMessage(e) ?? toUserErrorMessage(e, "Impossible de créer l’élément d’agenda."));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-6 gap-3 items-end">
        <div className="space-y-1 lg:col-span-3">
          <label className="text-sm font-medium" htmlFor="task-new-title">
            {TASK_FIELD_TITLE_LABEL}
          </label>
          <div className="flex items-center gap-2">
            <input
              id="task-new-title"
              ref={titleInputRef}
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="flex-1 w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm transition-colors focus-visible:border-primary/60"
              placeholder="Ex : Payer le loyer"
              disabled={creating}
            />
          </div>
          <div className="sn-modal-secondary-controls">
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
            {dictationStatus === "listening" ? (
              <div className="text-xs text-muted-foreground">Écoute…</div>
            ) : dictationError ? (
              <div className="text-xs text-destructive">{dictationError}</div>
            ) : null}
          </div>
        </div>

        <div className="space-y-1 lg:col-span-1">
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

        <div className="space-y-1 lg:col-span-2">
          <label className="text-sm font-medium" htmlFor="task-new-due">
            {TASK_FIELD_DUE_LABEL}
          </label>
          <input
            id="task-new-due"
            type="datetime-local"
            value={newDueDate}
            onChange={(e) => setNewDueDate(e.target.value)}
            placeholder={DATETIME_PLACEHOLDER_FR}
            title={`Format: ${DATETIME_PLACEHOLDER_FR}`}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            className={`w-full min-w-[16rem] px-3 py-2 border rounded-md bg-background text-foreground text-sm ${dateWarning ? "border-destructive" : "border-input"}`}
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
            {TASK_FIELD_START_LABEL}
          </label>
          <input
            id="task-new-start"
            type="date"
            value={newStartDate}
            onChange={(e) => setNewStartDate(e.target.value)}
            placeholder={DATE_PLACEHOLDER_FR}
            title={`Format: ${DATE_PLACEHOLDER_FR}`}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            className={`w-full min-w-[11rem] px-3 py-2 border rounded-md bg-background text-foreground text-sm ${dateWarning ? "border-destructive" : "border-input"}`}
          />
          {startDateFeedback ? (
            <div className={`text-xs ${startDateFeedback.tone === "error" ? "text-destructive" : "text-muted-foreground"}`}>
              {startDateFeedback.text}
            </div>
          ) : null}
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="task-new-priority">
            {TASK_FIELD_PRIORITY_LABEL}
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
            <option value="">{TASK_EMPTY_PRIORITY_LABEL}</option>
            {TASK_PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
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
            {TASK_FIELD_WORKSPACE_LABEL}
          </label>
          <select
            id="task-new-workspace"
            value={newWorkspaceId}
            onChange={(e) => setNewWorkspaceId(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
          >
            <option value="">{TASK_EMPTY_WORKSPACE_LABEL}</option>
            {workspaces.map((ws) => (
              <option key={ws.id ?? ws.name} value={ws.id ?? ""}>
                {workspaceOptionLabelById.get(ws.id ?? "") ?? ws.name}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={handleCreateTask}
          disabled={creating || !canCreate}
          className="h-10 inline-flex items-center justify-center px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {creating ? "Création…" : "Créer dans l’agenda"}
        </button>
      </div>

      {createFeedback && <div className="sn-alert sn-alert--success sn-animate-in" role="status" aria-live="polite">{createFeedback}</div>}
      {createError && <div className="sn-alert sn-alert--error">{createError}</div>}
    </div>
  );
}
