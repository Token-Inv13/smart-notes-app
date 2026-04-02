"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
  where,
} from "firebase/firestore";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { auth, db } from "@/lib/firebase";
import type { TaskDoc, TaskReminderDoc, TodoDoc } from "@/types/firestore";
import { useUserWorkspaces } from "@/hooks/useUserWorkspaces";
import { useUserSettings } from "@/hooks/useUserSettings";
import { exportTaskPdf } from "@/lib/pdf/exportPdf";
import { invalidateAuthSession, isAuthInvalidError } from "@/lib/authInvalidation";
import {
  DATETIME_PLACEHOLDER_FR,
  DATE_PLACEHOLDER_FR,
  formatDateTimeFr,
  formatTimestampToDateFr,
  formatTimestampToDateTimeFr,
  formatTimestampForDateInput,
  formatTimestampForInput,
  getUserTimezone,
  isExactAllDayWindow,
  parseLocalDateTimeToTimestamp,
  parseLocalDateToTimestamp,
} from "@/lib/datetime";
import { toUserErrorMessage } from "@/lib/userError";
import { buildWorkspacePathLabelMap } from "@/lib/workspaces";
import { normalizeDisplayText } from "@/lib/normalizeText";
import DictationMicButton from "@/app/(protected)/_components/DictationMicButton";
import { insertTextAtSelection, prepareDictationTextForInsertion } from "@/lib/textInsert";
import Modal from "../../../Modal";
import ItemActionsMenu from "../../../ItemActionsMenu";
import {
  TASK_EMPTY_PRIORITY_LABEL,
  TASK_EMPTY_WORKSPACE_LABEL,
  TASK_FIELD_DUE_LABEL,
  TASK_FIELD_PRIORITY_LABEL,
  TASK_FIELD_START_LABEL,
  TASK_FIELD_TITLE_LABEL,
  TASK_FIELD_WORKSPACE_LABEL,
  TASK_MODAL_DETAIL_TITLE,
  TASK_MODAL_EDIT_TITLE,
  TASK_PRIORITY_OPTIONS,
} from "../../../_components/taskModalLabels";

function formatFrDateTime(ts?: TaskDoc["dueDate"] | null) {
  return formatTimestampToDateTimeFr(ts ?? null);
}

function formatTaskBoundary(ts: TaskDoc["startDate"] | TaskDoc["dueDate"] | null | undefined, allDay: boolean) {
  return allDay ? formatTimestampToDateFr(ts ?? null) : formatTimestampToDateTimeFr(ts ?? null);
}

function formatIsoForDateTimeInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function formatReminderDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Date invalide";
  return formatDateTimeFr(date);
}

function toLocalDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getReminderRestrictionMessage(task: TaskDoc | null | undefined): string | null {
  if (task?.recurrence?.freq) {
    return "Les rappels ne sont pas pris en charge pour les tâches récurrentes.";
  }
  if (task?.allDay) {
    return "Les rappels sont disponibles uniquement pour les tâches avec heure.";
  }
  return null;
}

const GOOGLE_SYNC_INCOMPLETE_WINDOW_MESSAGE =
  "Élément enregistré dans TaskNote, mais non synchronisé avec Google Calendar faute de plage horaire complète.";

function priorityLabel(p?: TaskDoc["priority"] | null) {
  if (p === "high") return "Haute";
  if (p === "medium") return "Moyenne";
  if (p === "low") return "Basse";
  return "";
}

function statusLabel(s?: TaskDoc["status"] | null) {
  if (s === "doing") return "En cours";
  if (s === "done") return "Terminée";
  return "À faire";
}

type TaskStatus = "todo" | "doing" | "done";

type NavigatorWithShare = {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
};

type ChecklistSourceState = {
  loading: boolean;
  title: string | null;
  itemText: string | null;
  notFound: boolean;
};

function downloadBlobFile(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    window.open(objectUrl, "_blank", "noopener,noreferrer");
  } finally {
    window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 30_000);
  }
}

const editTaskSchema = z.object({
  title: z.string().min(1, "Le titre est requis."),
  status: z.union([z.literal("todo"), z.literal("doing"), z.literal("done")]),
  workspaceId: z.string().optional(),
  startDate: z.string().optional(),
  dueDate: z.string().optional(),
  priority: z.union([z.literal("low"), z.literal("medium"), z.literal("high")]).optional(),
});

export default function TaskDetailModal(props: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = use(props.params);
  const taskId: string | undefined = params?.id;
  const workspaceId = searchParams.get("workspaceId");
  const returnToParam = searchParams.get("returnTo");
  const fallbackHref = returnToParam && returnToParam.startsWith("/") && !returnToParam.startsWith("//")
    ? returnToParam
    : workspaceId
      ? `/tasks?workspaceId=${encodeURIComponent(workspaceId)}`
      : "/tasks";

  const { data: workspaces } = useUserWorkspaces();
  const workspaceOptionLabelById = useMemo(() => buildWorkspacePathLabelMap(workspaces), [workspaces]);
  const { data: userSettings } = useUserSettings();
  const isPro = userSettings?.plan === "pro";

  const [task, setTask] = useState<TaskDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<"view" | "edit">("view");
  const [editTitle, setEditTitle] = useState("");
  const [editStatus, setEditStatus] = useState<TaskStatus>("todo");
  const [editWorkspaceId, setEditWorkspaceId] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editPriority, setEditPriority] = useState<"" | NonNullable<TaskDoc["priority"]>>("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [sharedUrl, setSharedUrl] = useState<string | null>(null);
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);
  const [snoozing, setSnoozing] = useState(false);
  const [snoozeFeedback, setSnoozeFeedback] = useState<string | null>(null);
  const [taskReminders, setTaskReminders] = useState<TaskReminderDoc[]>([]);
  const [checklistSource, setChecklistSource] = useState<ChecklistSourceState>({
    loading: false,
    title: null,
    itemText: null,
    notFound: false,
  });
  const [remindersLoading, setRemindersLoading] = useState(false);
  const [addingReminder, setAddingReminder] = useState(false);
  const [busyReminderId, setBusyReminderId] = useState<string | null>(null);
  const [reminderDraft, setReminderDraft] = useState("");
  const [reminderFeedback, setReminderFeedback] = useState<string | null>(null);
  const [googleCalendarConnected, setGoogleCalendarConnected] = useState(false);

  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const [dictationStatus, setDictationStatus] = useState<"idle" | "listening" | "stopped" | "error">("idle");
  const [dictationError, setDictationError] = useState<string | null>(null);

  const [, setIsDirty] = useState(false);
  const isDirtyRef = useRef(false);
  const lastSavedSnapshotRef = useRef<string>("");
  const isMountedRef = useRef(true);
  const reminderSyncTokenRef = useRef(0);
  const isTimedTask = task?.allDay !== true;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!syncFeedback) return;
    const timer = window.setTimeout(() => setSyncFeedback(null), 2400);
    return () => window.clearTimeout(timer);
  }, [syncFeedback]);

  useEffect(() => {
    let cancelled = false;

    const loadGoogleCalendarStatus = async () => {
      try {
        const res = await fetch("/api/google/calendar/status", { method: "GET", cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) setGoogleCalendarConnected(false);
          return;
        }

        const data = (await res.json()) as { connected?: unknown };
        if (!cancelled) {
          setGoogleCalendarConnected(data.connected === true);
        }
      } catch {
        if (!cancelled) setGoogleCalendarConnected(false);
      }
    };

    void loadGoogleCalendarStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  const setDirty = (next: boolean) => {
    isDirtyRef.current = next;
    setIsDirty(next);
  };

  const loadTaskReminders = async (opts?: { keepDraft?: boolean }) => {
    if (!task?.id) {
      setTaskReminders([]);
      if (!opts?.keepDraft) setReminderDraft("");
      return;
    }

    const user = auth.currentUser;
    if (!user || user.uid !== task.userId) {
      setTaskReminders([]);
      if (!opts?.keepDraft) setReminderDraft("");
      return;
    }

    setRemindersLoading(true);
    try {
      const remindersRef = collection(db, "taskReminders");
      const remindersSnap = await getDocs(
        query(
          remindersRef,
          where("userId", "==", user.uid),
          where("taskId", "==", task.id),
        ),
      );

      const reminders = remindersSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() as TaskReminderDoc) }))
        .sort((a, b) => {
          const aTs = new Date(a.reminderTime ?? "").getTime();
          const bTs = new Date(b.reminderTime ?? "").getTime();
          const safeA = Number.isNaN(aTs) ? Number.MAX_SAFE_INTEGER : aTs;
          const safeB = Number.isNaN(bTs) ? Number.MAX_SAFE_INTEGER : bTs;
          return safeA - safeB;
        });

      setTaskReminders(reminders);

      if (!opts?.keepDraft) {
        if (!remindersSupported) {
          setReminderDraft("");
        } else if (reminders[0]?.reminderTime) {
          setReminderDraft(formatIsoForDateTimeInput(reminders[0].reminderTime));
        } else if (task.dueDate) {
          setReminderDraft(formatTimestampForInput(task.dueDate));
        } else {
          setReminderDraft("");
        }
      }
    } catch (e) {
      console.error("Error loading task reminders", e);
      setEditError(toUserErrorMessage(e, "Erreur lors du chargement des rappels."));
      setTaskReminders([]);
    } finally {
      setRemindersLoading(false);
    }
  };

  const syncTaskRemindersAfterSave = async (input: {
    taskId: string;
    userId: string;
    dueTimestamp: ReturnType<typeof parseLocalDateTimeToTimestamp>;
    dueDateRaw: string | undefined;
    remindersAllowedForTask: boolean;
  }) => {
    const { taskId, userId, dueTimestamp, dueDateRaw, remindersAllowedForTask } = input;
    const syncToken = ++reminderSyncTokenRef.current;

    try {
      const remindersRef = collection(db, "taskReminders");
      const remindersSnap = await getDocs(
        query(
          remindersRef,
          where("userId", "==", userId),
          where("taskId", "==", taskId),
        ),
      );

      const existingDocs = remindersSnap.docs;

      if (!remindersAllowedForTask) {
        if (existingDocs.length > 0) {
          const batch = writeBatch(db);
          existingDocs.forEach((reminderDoc) => {
            batch.delete(reminderDoc.ref);
          });
          await batch.commit();
          if (isMountedRef.current && reminderSyncTokenRef.current === syncToken) {
            setReminderFeedback("Rappels supprimés: cette tâche ne prend pas en charge les rappels.");
            setReminderDraft("");
          }
        }
      } else if (dueDateRaw) {
        const reminderDate = new Date(dueDateRaw);
        if (!Number.isNaN(reminderDate.getTime())) {
          const primary = existingDocs.find((d) => {
            const data = d.data() as TaskReminderDoc;
            return data.dueDate === data.reminderTime;
          }) ?? existingDocs[0] ?? null;
          if (primary) {
            await updateDoc(primary.ref, {
              dueDate: dueTimestamp ? dueTimestamp.toDate().toISOString() : "",
              reminderTime: reminderDate.toISOString(),
              sent: false,
            });
          } else {
            await addDoc(remindersRef, {
              userId,
              taskId,
              dueDate: dueTimestamp ? dueTimestamp.toDate().toISOString() : "",
              reminderTime: reminderDate.toISOString(),
              sent: false,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        }
      }
    } catch (e) {
      console.warn("task.modal.reminder_sync_failed", {
        taskId,
        error: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    if (!isMountedRef.current || reminderSyncTokenRef.current !== syncToken) return;

    try {
      await loadTaskReminders({ keepDraft: true });
    } catch (e) {
      console.warn("task.modal.reminder_reload_failed", {
        taskId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!taskId) {
        setError("ID d’élément d’agenda manquant.");
        setLoading(false);
        return;
      }

      const user = auth.currentUser;
      if (!user) {
        setError("Tu dois être connecté.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const snap = await getDoc(doc(db, "tasks", taskId));
        if (!snap.exists()) {
          throw new Error("Élément d’agenda introuvable.");
        }

        const data = snap.data() as TaskDoc;
        if (data.userId !== user.uid) {
          throw new Error("Accès refusé.");
        }

        if (!cancelled) {
          setTask({ id: snap.id, ...data });
          setMode("view");
        }
      } catch (e) {
        if (isAuthInvalidError(e)) {
          void invalidateAuthSession();
          return;
        }
        const msg = toUserErrorMessage(e, "Erreur lors du chargement.", {
          allowMessages: ["Élément d’agenda introuvable.", "Accès refusé.", "Tu dois être connecté.", "ID d’élément d’agenda manquant."],
        });
        if (!cancelled) setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const handleExportPdf = async () => {
    if (!task?.id) return;

    setEditError(null);
    setExportFeedback(null);

    try {
      const workspaceName = workspaces.find((ws) => ws.id === task.workspaceId)?.name ?? null;
      await exportTaskPdf(task, workspaceName);
      setExportFeedback("PDF téléchargé.");
    } catch (e) {
      setEditError(toUserErrorMessage(e, "Erreur lors de l’export PDF."));
    }
  };

  const handleExport = async () => {
    if (!task?.id) return;

    setEditError(null);
    setExportFeedback(null);

    const sanitize = (raw: string) => {
      const base = raw
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();
      return base || "sans-titre";
    };

    const workspaceName = workspaces.find((ws) => ws.id === task.workspaceId)?.name ?? null;
    const status = (task.status as TaskStatus | undefined) ?? "todo";

    const lines: string[] = [];
    lines.push(`# ${task.title ?? ""}`);
    lines.push(`Statut: ${statusLabel(status)}`);
    if (task.dueDate) lines.push(`Échéance: ${formatFrDateTime(task.dueDate)}`);
    if (workspaceName) lines.push(`Dossier: ${workspaceName}`);
    lines.push("");
    if (task.description) {
      lines.push(task.description);
      lines.push("");
    }

    const md = `${lines.join("\n")}\n`;
    const filename = `tasknote-task-${sanitize(task.title ?? "")}.md`;

    try {
      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      downloadBlobFile(blob, filename);

      setExportFeedback("Export téléchargé.");
    } catch (e) {
      setEditError(toUserErrorMessage(e, "Erreur lors de l’export."));
    }
  };

  const handleShare = async () => {
    if (!task?.id) return;

    setEditError(null);
    setShareFeedback(null);

    const origin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "https://app.tasknote.io";
    const url = `${origin}/tasks/${encodeURIComponent(task.id)}`;
    setSharedUrl(url);

    try {
      const nav = typeof navigator !== "undefined" ? (navigator as NavigatorWithShare) : null;
      if (typeof nav?.share === "function") {
        await nav.share({ title: task.title ?? "Élément d’agenda", url });
        setShareFeedback("Partage ouvert.");
        return;
      }

      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setShareFeedback("Lien copié.");
        return;
      }

      throw new Error("Partage non supporté sur cet appareil.");
    } catch (e) {
      setEditError(toUserErrorMessage(e, "Erreur lors du partage.", { allowMessages: ["Partage non supporté sur cet appareil."] }));
    }
  };

  useEffect(() => {
    if (!task) return;
    setEditTitle(task.title ?? "");
    setEditStatus(((task.status as TaskStatus | undefined) ?? "todo") as TaskStatus);
    setEditWorkspaceId(typeof task.workspaceId === "string" ? task.workspaceId : "");
    setEditStartDate(task.allDay === true ? formatTimestampForDateInput(task.startDate ?? null) : formatTimestampForInput(task.startDate ?? null));
    setEditDueDate(formatTimestampForInput(task.dueDate ?? null));
    setEditPriority(task.priority ?? "");
    setEditError(null);
    setShareFeedback(null);
    setSharedUrl(null);
    setExportFeedback(null);
    setSnoozeFeedback(null);
    setReminderFeedback(null);

    lastSavedSnapshotRef.current = JSON.stringify({
      title: task.title ?? "",
      status: ((task.status as TaskStatus | undefined) ?? "todo") as TaskStatus,
      workspaceId: typeof task.workspaceId === "string" ? task.workspaceId : "",
      startDate: task.allDay === true ? formatTimestampForDateInput(task.startDate ?? null) : formatTimestampForInput(task.startDate ?? null),
      dueDate: formatTimestampForInput(task.dueDate ?? null),
      priority: task.priority ?? "",
    });
    setDirty(false);
  }, [task]);

  useEffect(() => {
    let cancelled = false;

    async function loadChecklistSource() {
      if (task?.sourceType !== "checklist_item" || !task.sourceTodoId) {
        setChecklistSource({
          loading: false,
          title: null,
          itemText: null,
          notFound: false,
        });
        return;
      }

      setChecklistSource((prev) => ({
        ...prev,
        loading: true,
        notFound: false,
      }));

      try {
        const snap = await getDoc(doc(db, "todos", task.sourceTodoId));
        if (!snap.exists()) {
          throw new Error("Checklist source introuvable.");
        }

        const data = snap.data() as TodoDoc;
        if (data.userId !== task.userId) {
          throw new Error("Accès refusé à la checklist source.");
        }

        const sourceItem =
          task.sourceTodoItemId && Array.isArray(data.items)
            ? data.items.find((item) => item.id === task.sourceTodoItemId) ?? null
            : null;

        if (!cancelled) {
          setChecklistSource({
            loading: false,
            title: data.title?.trim() || "Checklist",
            itemText: sourceItem?.text?.trim() || task.title?.trim() || null,
            notFound: false,
          });
        }
      } catch (e) {
        console.error("Error loading checklist source for task modal", e);
        if (!cancelled) {
          setChecklistSource({
            loading: false,
            title: null,
            itemText: task.title?.trim() || null,
            notFound: true,
          });
        }
      }
    }

    void loadChecklistSource();

    return () => {
      cancelled = true;
    };
  }, [task?.sourceTodoId, task?.sourceTodoItemId, task?.sourceType, task?.title, task?.userId]);

  const dueLabel = useMemo(
    () => formatTaskBoundary(task?.dueDate ?? null, task?.allDay === true),
    [task?.allDay, task?.dueDate],
  );
  const startLabel = useMemo(
    () => formatTaskBoundary(task?.startDate ?? null, task?.allDay === true),
    [task?.allDay, task?.startDate],
  );
  const reminderRestrictionMessage = useMemo(() => getReminderRestrictionMessage(task), [task]);
  const remindersSupported = !reminderRestrictionMessage;
  useEffect(() => {
    if (!isPro) {
      setTaskReminders([]);
      setReminderDraft("");
      return;
    }
    void loadTaskReminders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPro, remindersSupported, task?.id]);

  const checklistSourceHref = useMemo(() => {
    if (task?.sourceType !== "checklist_item" || !task.sourceTodoId) return null;
    const searchParams = new URLSearchParams();
    if (typeof task.workspaceId === "string" && task.workspaceId) {
      searchParams.set("workspaceId", task.workspaceId);
    }
    const suffix = searchParams.toString();
    return `/todo/${encodeURIComponent(task.sourceTodoId)}${suffix ? `?${suffix}` : ""}`;
  }, [task?.sourceTodoId, task?.sourceType, task?.workspaceId]);
  const editDateWarning = useMemo(() => {
    if (!editStartDate || !editDueDate) return null;
    const startTs = isTimedTask ? parseLocalDateTimeToTimestamp(editStartDate) : parseLocalDateToTimestamp(editStartDate);
    const dueTs = parseLocalDateTimeToTimestamp(editDueDate);
    if (!startTs || !dueTs) return null;
    if (isTimedTask && dueTs.toMillis() <= startTs.toMillis()) return "La fin doit être après le début.";
    if (!isTimedTask && startTs.toMillis() > dueTs.toMillis()) return "La date de début est après la date de fin.";
    return null;
  }, [editDueDate, editStartDate, isTimedTask]);

  const editDueDateFeedback = useMemo(() => {
    if (!editDueDate) return null;
    const ts = parseLocalDateTimeToTimestamp(editDueDate);
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
  }, [editDueDate]);

  const editStartDateFeedback = useMemo(() => {
    if (!editStartDate) return null;
    const ts = isTimedTask ? parseLocalDateTimeToTimestamp(editStartDate) : parseLocalDateToTimestamp(editStartDate);
    if (!ts) {
      return {
        tone: "error" as const,
        text: `Format attendu: ${isTimedTask ? DATETIME_PLACEHOLDER_FR : DATE_PLACEHOLDER_FR}.`,
      };
    }
    return {
      tone: "muted" as const,
      text: `Début: ${isTimedTask ? formatTimestampToDateTimeFr(ts) : formatTimestampToDateFr(ts)}`,
    };
  }, [editStartDate, isTimedTask]);

  const handleSnooze = async (preset: '10m' | '1h' | 'tomorrow') => {
    if (!task?.id) return;
    if (!isPro) return;
    if (!remindersSupported) {
      setEditError(reminderRestrictionMessage ?? "Les rappels ne sont pas disponibles pour cet élément d’agenda.");
      return;
    }

    const user = auth.currentUser;
    if (!user || user.uid !== task.userId) {
      setEditError("Impossible de modifier cet élément d’agenda.");
      return;
    }

    setSnoozing(true);
    setEditError(null);
    setSnoozeFeedback(null);
    setReminderFeedback(null);

    try {
      const remindersRef = collection(db, 'taskReminders');
      const remindersSnap = await getDocs(
        query(
          remindersRef,
          where('userId', '==', user.uid),
          where('taskId', '==', task.id),
        ),
      );

      const reminderDoc = remindersSnap.docs[0] ?? null;
      if (!reminderDoc) {
        setEditError('Aucun rappel existant pour cet élément d’agenda.');
        return;
      }

      const reminder = reminderDoc.data() as { reminderTime?: string };
      const baseDate = (() => {
        const fromReminder = typeof reminder.reminderTime === 'string' ? new Date(reminder.reminderTime) : null;
        if (fromReminder && !Number.isNaN(fromReminder.getTime())) return fromReminder;
        if (task.dueDate) return task.dueDate.toDate();
        return new Date();
      })();

      const now = new Date();
      const effectiveBaseDate = baseDate.getTime() < now.getTime() ? now : baseDate;

      const nextDate = new Date(effectiveBaseDate.getTime());
      if (preset === '10m') nextDate.setMinutes(nextDate.getMinutes() + 10);
      if (preset === '1h') nextDate.setHours(nextDate.getHours() + 1);
      if (preset === 'tomorrow') nextDate.setDate(nextDate.getDate() + 1);

      await updateDoc(reminderDoc.ref, {
        reminderTime: nextDate.toISOString(),
        sent: false,
      });

      setSnoozeFeedback('Rappel reprogrammé.');
      setReminderDraft(formatIsoForDateTimeInput(nextDate.toISOString()));
      await loadTaskReminders({ keepDraft: true });
    } catch (e) {
      console.error('Error snoozing reminder', e);
      setEditError(toUserErrorMessage(e, 'Erreur lors du snooze du rappel.'));
    } finally {
      setSnoozing(false);
    }
  };

  const handleAddReminder = async () => {
    if (!task?.id) return;
    if (!isPro) return;
    if (!remindersSupported) {
      setEditError(reminderRestrictionMessage ?? "Les rappels ne sont pas disponibles pour cet élément d’agenda.");
      return;
    }

    const user = auth.currentUser;
    if (!user || user.uid !== task.userId) {
      setEditError("Impossible de modifier cet élément d’agenda.");
      return;
    }

    if (!reminderDraft) {
      setEditError("Choisis une date de rappel.");
      return;
    }

    const reminderDate = new Date(reminderDraft);
    if (Number.isNaN(reminderDate.getTime())) {
      setEditError(`Date de rappel invalide (format attendu: ${DATETIME_PLACEHOLDER_FR}).`);
      return;
    }

    setAddingReminder(true);
    setEditError(null);
    setSnoozeFeedback(null);
    setReminderFeedback(null);
    try {
      await addDoc(collection(db, "taskReminders"), {
        userId: user.uid,
        taskId: task.id,
        dueDate: task.dueDate ? task.dueDate.toDate().toISOString() : reminderDate.toISOString(),
        reminderTime: reminderDate.toISOString(),
        sent: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setReminderFeedback("Rappel ajouté.");
      await loadTaskReminders({ keepDraft: true });
    } catch (e) {
      console.error("Error adding task reminder", e);
      setEditError(toUserErrorMessage(e, "Erreur lors de l’ajout du rappel."));
    } finally {
      setAddingReminder(false);
    }
  };

  const handleDeleteReminder = async (reminderId: string) => {
    if (!task?.id) return;
    if (!isPro) return;
    if (!confirm("Supprimer ce rappel ?")) return;

    const user = auth.currentUser;
    if (!user || user.uid !== task.userId) {
      setEditError("Impossible de modifier cet élément d’agenda.");
      return;
    }

    setBusyReminderId(reminderId);
    setEditError(null);
    setSnoozeFeedback(null);
    setReminderFeedback(null);
    try {
      await deleteDoc(doc(db, "taskReminders", reminderId));
      setReminderFeedback("Rappel supprimé.");
      await loadTaskReminders({ keepDraft: true });
    } catch (e) {
      console.error("Error deleting task reminder", e);
      setEditError(toUserErrorMessage(e, "Erreur lors de la suppression du rappel."));
    } finally {
      setBusyReminderId(null);
    }
  };

  const startEdit = () => {
    if (!task) return;
    setMode("edit");
    setEditError(null);
    setDirty(false);
  };

  const cancelEdit = () => {
    if (!task) return;
    setMode("view");
    setEditTitle(task.title ?? "");
    setEditStatus(((task.status as TaskStatus | undefined) ?? "todo") as TaskStatus);
    setEditWorkspaceId(typeof task.workspaceId === "string" ? task.workspaceId : "");
    setEditStartDate(task.allDay === true ? formatTimestampForDateInput(task.startDate ?? null) : formatTimestampForInput(task.startDate ?? null));
    setEditDueDate(formatTimestampForInput(task.dueDate ?? null));
    setEditPriority(task.priority ?? "");
    setEditError(null);
    setDirty(false);
  };

  const saveEdits = async (opts?: { setView?: boolean }): Promise<boolean> => {
    if (!task?.id) return false;
    if (saving) return false;

    const user = auth.currentUser;
    if (!user || user.uid !== task.userId) {
      setEditError("Impossible de modifier cet élément d’agenda.");
      console.warn("[task modal] saveEdits blocked: unauth or not owner", {
        hasUser: Boolean(user),
        userId: user?.uid,
        taskUserId: task.userId,
        taskId: task.id,
      });
      return false;
    }

    const validation = editTaskSchema.safeParse({
      title: editTitle,
      status: editStatus,
      workspaceId: editWorkspaceId || undefined,
      startDate: editStartDate || undefined,
      dueDate: editDueDate || undefined,
      priority: editPriority || undefined,
    });

    if (!validation.success) {
      setEditError(validation.error.issues[0]?.message ?? "Données invalides.");
      console.warn("[task modal] saveEdits blocked: validation failed", {
        issues: validation.error.issues,
        taskId: task.id,
      });
      return false;
    }

    const nextSnapshot = JSON.stringify({
      title: validation.data.title,
      status: validation.data.status,
      workspaceId: validation.data.workspaceId ?? "",
      startDate: editStartDate,
      dueDate: editDueDate,
      priority: editPriority,
    });

    if (lastSavedSnapshotRef.current === nextSnapshot) {
      console.info("[task modal] saveEdits noop: snapshot unchanged", { taskId: task.id });
      if (opts?.setView) setMode("view");
      setDirty(false);
      return true;
    }

    const startTimestamp = validation.data.startDate
      ? (isTimedTask ? parseLocalDateTimeToTimestamp(validation.data.startDate) : parseLocalDateToTimestamp(validation.data.startDate))
      : null;
    const dueTimestamp = validation.data.dueDate
      ? parseLocalDateTimeToTimestamp(validation.data.dueDate)
      : null;

    if (validation.data.startDate && !startTimestamp) {
      setEditError(`Date de début invalide (format attendu: ${isTimedTask ? DATETIME_PLACEHOLDER_FR : DATE_PLACEHOLDER_FR}).`);
      return false;
    }

    if (validation.data.dueDate && !dueTimestamp) {
      setEditError(`Date d'échéance invalide (format attendu: ${DATETIME_PLACEHOLDER_FR}).`);
      return false;
    }

    if (isTimedTask && startTimestamp && dueTimestamp && dueTimestamp.toMillis() <= startTimestamp.toMillis()) {
      setEditError("La fin doit être après le début.");
      return false;
    }

    const explicitAllDay =
      startTimestamp && dueTimestamp
        ? isExactAllDayWindow(startTimestamp.toDate(), dueTimestamp.toDate())
        : false;
    const priority = validation.data.priority ?? null;

    setSaving(true);
    setEditError(null);
    setSyncFeedback(null);
    console.info("[task modal] saveEdits start", {
      taskId: task.id,
      workspaceId: validation.data.workspaceId,
      status: validation.data.status,
    });

    const shouldSwitchToView = opts?.setView === true;
    const previousTask = task;
    const previousMode = mode;
    const previousSnapshot = lastSavedSnapshotRef.current;
    const previousDirty = isDirtyRef.current;
    const optimisticTask = {
      ...task,
      title: validation.data.title,
      status: validation.data.status,
      workspaceId: validation.data.workspaceId ?? null,
      allDay: explicitAllDay,
      startDate: startTimestamp,
      dueDate: dueTimestamp,
      priority,
    };

    setTask(optimisticTask);
    if (shouldSwitchToView) {
      setMode("view");
    }
    lastSavedSnapshotRef.current = nextSnapshot;
    setDirty(false);

    try {
      await updateDoc(doc(db, "tasks", task.id), {
        title: validation.data.title,
        status: validation.data.status,
        workspaceId: validation.data.workspaceId ?? null,
        allDay: explicitAllDay,
        startDate: startTimestamp,
        dueDate: dueTimestamp,
        priority,
        updatedAt: serverTimestamp(),
      });

      console.info("[task modal] saveEdits success", { taskId: task.id });

      if (
        typeof task.googleEventId === "string" &&
        task.googleEventId.trim() &&
        startTimestamp &&
        dueTimestamp
      ) {
        const googleStart = startTimestamp.toDate();
        const googleEnd = dueTimestamp.toDate();
        const googlePayload = explicitAllDay
          ? {
              googleEventId: task.googleEventId,
              title: validation.data.title,
              start: toLocalDateInputValue(googleStart),
              end: toLocalDateInputValue(googleEnd),
              allDay: true,
            }
          : {
              googleEventId: task.googleEventId,
              title: validation.data.title,
              start: googleStart.toISOString(),
              end: googleEnd.toISOString(),
              allDay: false,
              timeZone: getUserTimezone(),
            };

        void fetch("/api/google/calendar/events", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(googlePayload),
        }).then((response) => {
          if (!response.ok) {
            console.warn("agenda.google.update_failed", {
              taskId: task.id,
              status: response.status,
            });
          }
        }).catch((error) => {
          console.warn("agenda.google.update_failed", {
            taskId: task.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      } else if (
        typeof task.googleEventId === "string" &&
        task.googleEventId.trim() &&
        googleCalendarConnected &&
        (!startTimestamp || !dueTimestamp)
      ) {
        setSyncFeedback(GOOGLE_SYNC_INCOMPLETE_WINDOW_MESSAGE);
      }

      if (isPro) {
        const remindersAllowedForTask = !task.recurrence?.freq && !explicitAllDay;
        void syncTaskRemindersAfterSave({
          taskId: task.id,
          userId: user.uid,
          dueTimestamp,
          dueDateRaw: validation.data.dueDate,
          remindersAllowedForTask,
        });
      }

      return true;
    } catch (e) {
      console.error("Error updating task (modal)", e);
      if (isMountedRef.current) {
        setTask(previousTask);
        setMode(previousMode);
        lastSavedSnapshotRef.current = previousSnapshot;
        setDirty(previousDirty);
        setEditError(toUserErrorMessage(e, "Erreur lors de la modification de l’élément d’agenda."));
      }
      return false;
    } finally {
      if (isMountedRef.current) {
        setSaving(false);
      }
    }
  };

  const handleSave = async () => {
    const ok = await saveEdits({ setView: true });
    if (!ok) {
      console.warn("[task modal] handleSave: save failed (staying in edit mode)", { taskId: task?.id });
    }
  };

  useEffect(() => {
    if (mode !== "edit") return;

    const flush = () => {
      if (!isDirtyRef.current) return;
      void saveEdits({ setView: false });
    };

    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);

    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const handleToggleArchive = async () => {
    if (!task?.id) return;

    const user = auth.currentUser;
    if (!user || user.uid !== task.userId) {
      setEditError("Impossible d’archiver cet élément d’agenda.");
      return;
    }

    setSaving(true);
    setEditError(null);
    try {
      const nextArchived = !(task.archived === true);
      await updateDoc(doc(db, "tasks", task.id), {
        archived: nextArchived,
        archivedAt: nextArchived ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      });
      router.back();
    } catch (e) {
      console.error("Error archiving task (modal)", e);
      setEditError(toUserErrorMessage(e, "Erreur lors de l’archivage de l’élément d’agenda."));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!task?.id) return;

    const user = auth.currentUser;
    if (!user || user.uid !== task.userId) {
      setEditError("Impossible de supprimer cet élément d’agenda.");
      return;
    }

    setDeleting(true);
    setEditError(null);

    try {
      const remindersRef = collection(db, "taskReminders");
      const remindersSnap = await getDocs(
        query(
          remindersRef,
          where("userId", "==", user.uid),
          where("taskId", "==", task.id),
        ),
      );

      const batch = writeBatch(db);
      for (const reminderDoc of remindersSnap.docs) {
        batch.delete(reminderDoc.ref);
      }
      batch.delete(doc(db, "tasks", task.id));
      await batch.commit();
      if (typeof task.googleEventId === "string" && task.googleEventId.trim()) {
        void fetch("/api/google/calendar/events", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            googleEventId: task.googleEventId,
          }),
        }).then(async (response) => {
          if (!response.ok) {
            console.warn("agenda.google.delete_failed", {
              taskId: task.id,
              status: response.status,
            });
          }
        }).catch((error) => {
          console.warn("agenda.google.delete_failed", {
            taskId: task.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
      router.back();
    } catch (e) {
      console.error("Error deleting task (modal)", e);
      setEditError(toUserErrorMessage(e, "Erreur lors de la suppression de l’élément d’agenda."));
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  const openDeleteConfirmation = () => {
    setEditError(null);
    setConfirmingDelete(true);
  };

  return (
    <Modal
      ariaLabel={mode === "edit" ? TASK_MODAL_EDIT_TITLE : TASK_MODAL_DETAIL_TITLE}
      hideHeader
      fallbackHref={fallbackHref}
      onBeforeClose={async () => {
        if (mode !== "edit") return true;

        if (!isDirtyRef.current) return true;
        return await saveEdits({ setView: false });
      }}
    >
      {({ close }: { close: () => void }) => {
        if (loading) {
          return (
            <div className="sn-skeleton-card space-y-3">
              <div className="sn-skeleton-title w-56" />
              <div className="sn-skeleton-line w-72" />
              <div className="sn-skeleton-line w-64" />
              <div className="sn-skeleton-block-md w-full" />
            </div>
          );
        }

        if (error) {
          return <div className="sn-alert sn-alert--error">{error}</div>;
        }

        if (!task) return null;

        return (
        <div className="space-y-4">
          {shareFeedback && <div className="sn-alert">{shareFeedback}</div>}
          {saving ? <div className="sn-alert" role="status" aria-live="polite">Enregistrement en cours…</div> : null}
          {syncFeedback && <div className="sn-alert" role="status" aria-live="polite">{syncFeedback}</div>}
          {sharedUrl && (
            <div className="sn-card p-3">
              <div className="text-xs text-muted-foreground mb-1">Lien de partage</div>
              <div className="flex items-center gap-2">
                <input
                  value={sharedUrl}
                  readOnly
                  className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                  aria-label="Lien de partage généré"
                />
                <button
                  type="button"
                  className="px-3 py-2 rounded-md border border-input text-sm"
                  onClick={() => {
                    if (!sharedUrl) return;
                    void navigator.clipboard.writeText(sharedUrl).then(
                      () => setShareFeedback("Lien copié."),
                      () => setEditError("Impossible de copier le lien."),
                    );
                  }}
                >
                  Copier
                </button>
              </div>
            </div>
          )}
          {exportFeedback && <div className="sn-alert">{exportFeedback}</div>}
          {snoozeFeedback && <div className="sn-alert">{snoozeFeedback}</div>}
          {reminderFeedback && <div className="sn-alert">{reminderFeedback}</div>}
          {editError && <div className="sn-alert sn-alert--error">{editError}</div>}
          {confirmingDelete && (
            <div className="sn-card border border-red-300 bg-red-50 p-3 space-y-2">
              <div className="text-sm text-red-800">
                Supprimer définitivement cette tâche ? Cette action est irréversible.
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="px-3 py-2 rounded-md text-sm border border-border bg-background"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleting}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  className="px-3 py-2 rounded-md text-sm bg-red-600 text-white disabled:opacity-50"
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                >
                  {deleting ? "Suppression…" : "Supprimer définitivement"}
                </button>
              </div>
            </div>
          )}
            <div className="sn-card p-4 space-y-3">
              <div className="sn-modal-header-safe">
                <div className="min-w-0 flex-1">
                  {mode === "view" ? (
                    <div className="space-y-1 min-w-0">
                      <div className="text-sm font-semibold">{TASK_MODAL_DETAIL_TITLE}</div>
                      <div className="text-sm text-muted-foreground truncate">{normalizeDisplayText(task.title)}</div>
                    </div>
                  ) : (
                    <div className="text-sm font-semibold">{TASK_MODAL_EDIT_TITLE}</div>
                  )}
                </div>

              <div className="sn-modal-header-actions">
                {mode === "view" ? (
                  <ItemActionsMenu
                    onEdit={startEdit}
                    onToggleArchive={handleToggleArchive}
                    onShare={handleShare}
                    onExportPdf={handleExportPdf}
                    onExportMarkdown={handleExport}
                    archived={task.archived === true}
                    onDelete={openDeleteConfirmation}
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={saving}
                      className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saving}
                      className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                    >
                      {saving ? "Enregistrement…" : "Enregistrer"}
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={close}
                  className="sn-icon-btn"
                  aria-label="Fermer"
                  title="Fermer"
                >
                  ×
                </button>
              </div>
            </div>

            {mode === "view" ? (
              <>
                {task.sourceType === "checklist_item" && (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50/80 p-3 text-sm text-emerald-950 space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                      Provenance checklist
                    </div>
                    <div>Cette tâche agenda provient d’un item de checklist planifié.</div>
                    <div>
                      <span className="font-medium">Checklist:</span>{" "}
                      {checklistSource.loading
                        ? "Chargement…"
                        : checklistSource.title ?? (checklistSource.notFound ? "Checklist source indisponible" : "—")}
                    </div>
                    <div>
                      <span className="font-medium">Élément source:</span>{" "}
                      {checklistSource.loading ? "Chargement…" : checklistSource.itemText ?? "—"}
                    </div>
                    {checklistSourceHref && (
                      <button
                        type="button"
                        onClick={() => {
                          close();
                          router.push(checklistSourceHref);
                        }}
                        className="px-3 py-2 rounded-md border border-emerald-300 bg-white/70 text-sm font-medium text-emerald-900"
                      >
                        Ouvrir la checklist source
                      </button>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="font-medium">Statut:</span> {statusLabel(task.status ?? null)}
                  </div>
                  <div>
                    <span className="font-medium">Date de fin / échéance:</span> {dueLabel || "—"}
                    {isPro && dueLabel && remindersSupported && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-sm">Rappeler plus tard</summary>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleSnooze('10m')}
                            disabled={snoozing}
                            className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
                          >
                            +10 minutes
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSnooze('1h')}
                            disabled={snoozing}
                            className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
                          >
                            +1 heure
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSnooze('tomorrow')}
                            disabled={snoozing}
                            className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
                          >
                            Demain
                          </button>
                        </div>
                      </details>
                    )}
                  </div>
                  <div>
                    <span className="font-medium">Date de début:</span> {startLabel || "—"}
                  </div>
                  <div>
                    <span className="font-medium">Priorité:</span> {priorityLabel(task.priority ?? null) || "—"}
                  </div>
                </div>
                <div className="text-sm">
                  <span className="font-medium">Dossier:</span>{" "}
                  {workspaces.find((ws) => ws.id === task.workspaceId)?.name ?? "—"}
                </div>

                {isPro && (
                    <div className="rounded-md border border-border/70 bg-background/40 p-3 space-y-2">
                      <div className="text-sm font-medium">Rappels</div>

                    {reminderRestrictionMessage ? (
                      <div className="text-xs text-muted-foreground">{reminderRestrictionMessage}</div>
                    ) : (
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2">
                        <div className="space-y-1 flex-1">
                          <label className="text-xs text-muted-foreground" htmlFor="task-reminder-draft">
                            Date et heure du rappel
                          </label>
                          <input
                            id="task-reminder-draft"
                            type="datetime-local"
                            value={reminderDraft}
                            onChange={(e) => setReminderDraft(e.target.value)}
                            placeholder={DATETIME_PLACEHOLDER_FR}
                            title={`Format: ${DATETIME_PLACEHOLDER_FR}`}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void handleAddReminder();
                              }
                            }}
                            className="w-full min-w-[16rem] px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                            disabled={addingReminder || Boolean(busyReminderId) || saving}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleAddReminder()}
                          disabled={addingReminder || !reminderDraft || Boolean(busyReminderId) || saving}
                          className="h-10 px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
                        >
                          {addingReminder ? "Ajout…" : "Ajouter"}
                        </button>
                      </div>
                    )}

                    {remindersLoading ? (
                      <div className="text-xs text-muted-foreground">Chargement des rappels…</div>
                    ) : taskReminders.length === 0 ? (
                      <div className="text-xs text-muted-foreground">Aucun rappel pour cet élément d’agenda.</div>
                    ) : (
                      <div className="space-y-2">
                        {taskReminders.map((reminder) => (
                          <div
                            key={reminder.id}
                            className="flex items-center justify-between gap-3 rounded-md border border-input px-3 py-2"
                          >
                            <div className="min-w-0">
                              <div className="text-sm">{formatReminderDate(reminder.reminderTime)}</div>
                              <div className="text-xs text-muted-foreground">
                                Statut: {reminder.sent === true ? "envoyé" : "en attente"}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                if (!reminder.id) return;
                                void handleDeleteReminder(reminder.id);
                              }}
                              disabled={!reminder.id || busyReminderId === reminder.id || addingReminder || saving}
                              className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
                            >
                              {busyReminderId === reminder.id ? "Suppression…" : "Supprimer"}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 items-end">
                  <div className="space-y-1 lg:col-span-2">
                    <label className="text-sm font-medium" htmlFor="task-modal-title">
                      {TASK_FIELD_TITLE_LABEL}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id="task-modal-title"
                        ref={titleInputRef}
                        type="text"
                        value={editTitle}
                        onChange={(e) => {
                          const nextTitle = e.target.value;
                          setEditTitle(nextTitle);
                          const snap = JSON.stringify({
                            title: nextTitle,
                            status: editStatus,
                            workspaceId: editWorkspaceId,
                            startDate: editStartDate,
                            dueDate: editDueDate,
                            priority: editPriority,
                          });
                          setDirty(snap !== lastSavedSnapshotRef.current);
                        }}
                        className="flex-1 w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                        placeholder="Ex : Payer le loyer"
                        disabled={saving}
                      />
                      <DictationMicButton
                        disabled={saving}
                        onFinalText={(rawText) => {
                          const el = titleInputRef.current;
                          const insert = prepareDictationTextForInsertion({
                            value: editTitle,
                            selectionStart: el?.selectionStart ?? null,
                            rawText,
                          });
                          if (!insert) return;
                          const { nextValue, nextCursor } = insertTextAtSelection({
                            value: editTitle,
                            selectionStart: el?.selectionStart ?? null,
                            selectionEnd: el?.selectionEnd ?? null,
                            text: insert,
                          });
                          setEditTitle(nextValue);
                          const snap = JSON.stringify({
                            title: nextValue,
                            status: editStatus,
                            workspaceId: editWorkspaceId,
                            startDate: editStartDate,
                            dueDate: editDueDate,
                            priority: editPriority,
                          });
                          setDirty(snap !== lastSavedSnapshotRef.current);
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
                    <label className="text-sm font-medium" htmlFor="task-modal-status">
                      Statut
                    </label>
                    <select
                      id="task-modal-status"
                      value={editStatus}
                      onChange={(e) => {
                        const nextStatus = e.target.value as TaskStatus;
                        setEditStatus(nextStatus);
                        const snap = JSON.stringify({
                          title: editTitle,
                          status: nextStatus,
                          workspaceId: editWorkspaceId,
                          startDate: editStartDate,
                          dueDate: editDueDate,
                          priority: editPriority,
                        });
                        setDirty(snap !== lastSavedSnapshotRef.current);
                      }}
                      className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                    >
                      <option value="todo">À faire</option>
                      <option value="doing">En cours</option>
                      <option value="done">Terminée</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-medium" htmlFor="task-modal-due">
                      {TASK_FIELD_DUE_LABEL}
                    </label>
                    <input
                      id="task-modal-due"
                      type="datetime-local"
                      value={editDueDate}
                      onChange={(e) => {
                        const nextDueDate = e.target.value;
                        setEditDueDate(nextDueDate);
                        const snap = JSON.stringify({
                          title: editTitle,
                          status: editStatus,
                          workspaceId: editWorkspaceId,
                          startDate: editStartDate,
                          dueDate: nextDueDate,
                          priority: editPriority,
                        });
                        setDirty(snap !== lastSavedSnapshotRef.current);
                      }}
                      placeholder={DATETIME_PLACEHOLDER_FR}
                      title={`Format: ${DATETIME_PLACEHOLDER_FR}`}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          (e.currentTarget as HTMLInputElement).blur();
                        }
                      }}
                      className={`w-full min-w-[16rem] px-3 py-2 border rounded-md bg-background text-foreground text-sm ${editDateWarning ? "border-destructive" : "border-input"}`}
                    />
                    {editDueDateFeedback ? (
                      <div className={`text-xs ${editDueDateFeedback.tone === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                        {editDueDateFeedback.text}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 items-end">
                  <div className="space-y-1">
                    <label className="text-sm font-medium" htmlFor="task-modal-start">
                      {TASK_FIELD_START_LABEL}
                    </label>
                    <input
                      id="task-modal-start"
                      type={isTimedTask ? "datetime-local" : "date"}
                      value={editStartDate}
                      onChange={(e) => {
                        const nextStartDate = e.target.value;
                        setEditStartDate(nextStartDate);
                        const snap = JSON.stringify({
                          title: editTitle,
                          status: editStatus,
                          workspaceId: editWorkspaceId,
                          startDate: nextStartDate,
                          dueDate: editDueDate,
                          priority: editPriority,
                        });
                        setDirty(snap !== lastSavedSnapshotRef.current);
                      }}
                      placeholder={isTimedTask ? DATETIME_PLACEHOLDER_FR : DATE_PLACEHOLDER_FR}
                      title={`Format: ${isTimedTask ? DATETIME_PLACEHOLDER_FR : DATE_PLACEHOLDER_FR}`}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          (e.currentTarget as HTMLInputElement).blur();
                        }
                      }}
                      className={`w-full min-w-[11rem] px-3 py-2 border rounded-md bg-background text-foreground text-sm ${editDateWarning ? "border-destructive" : "border-input"}`}
                    />
                    {editStartDateFeedback ? (
                      <div className={`text-xs ${editStartDateFeedback.tone === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                        {editStartDateFeedback.text}
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-medium" htmlFor="task-modal-priority">
                      {TASK_FIELD_PRIORITY_LABEL}
                    </label>
                    <select
                      id="task-modal-priority"
                      value={editPriority}
                      onChange={(e) => {
                        const v = e.target.value;
                        const nextPriority = v === "low" || v === "medium" || v === "high" ? v : "";
                        setEditPriority(nextPriority);
                        const snap = JSON.stringify({
                          title: editTitle,
                          status: editStatus,
                          workspaceId: editWorkspaceId,
                          startDate: editStartDate,
                          dueDate: editDueDate,
                          priority: nextPriority,
                        });
                        setDirty(snap !== lastSavedSnapshotRef.current);
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

                {editDateWarning && (
                  <div className="sn-alert" role="status" aria-live="polite">
                    {editDateWarning}
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 items-end">
                  <div className="space-y-1">
                    <label className="text-sm font-medium" htmlFor="task-modal-workspace">
                      {TASK_FIELD_WORKSPACE_LABEL}
                    </label>
                    <select
                      id="task-modal-workspace"
                      value={editWorkspaceId}
                      onChange={(e) => {
                        const nextWorkspaceId = e.target.value;
                        setEditWorkspaceId(nextWorkspaceId);
                        const snap = JSON.stringify({
                          title: editTitle,
                          status: editStatus,
                          workspaceId: nextWorkspaceId,
                          startDate: editStartDate,
                          dueDate: editDueDate,
                          priority: editPriority,
                        });
                        setDirty(snap !== lastSavedSnapshotRef.current);
                      }}
                      className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                    >
                      <option value="">{TASK_EMPTY_WORKSPACE_LABEL}</option>
                      {workspaces.map((ws) => (
                        <option key={ws.id ?? ws.name} value={ws.id ?? ""}>
                          {workspaceOptionLabelById.get(ws.id ?? "") ?? normalizeDisplayText(ws.name)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="h-10 inline-flex items-center justify-center px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    {saving ? "Enregistrement…" : "Enregistrer"}
                  </button>
                </div>

                {editError && <div className="sn-alert sn-alert--error">{editError}</div>}
              </>
            )}
          </div>
        </div>
        );
      }}
    </Modal>
  );
}
