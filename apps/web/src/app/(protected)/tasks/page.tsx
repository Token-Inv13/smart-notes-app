"use client";

/**
 * Tasks page
 * - Read data via useUserTasks/useUserWorkspaces (Firestore onSnapshot)
 * - Local filters: status + workspaceId (in-memory only)
 * - CRUD:
 *   - Create: callable plan guard + Firestore writes
 *   - Update: updateDoc("tasks/{id}") with updatedAt: serverTimestamp()
 *   - Delete: deleteDoc("tasks/{id}") after confirm()
 * All writes must respect Firestore rules: user can only modify their own tasks.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { arrayUnion, deleteDoc, doc, Timestamp, updateDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useUserTasks } from "@/hooks/useUserTasks";
import { useUserNotes } from "@/hooks/useUserNotes";
import { useUserTodos } from "@/hooks/useUserTodos";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useUserWorkspaces } from "@/hooks/useUserWorkspaces";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import {
  formatTimestampToDateFr,
  formatTimestampToDateTimeFr,
  getUserTimezone,
  normalizeAgendaWindowForFirestore,
  normalizeDateForFirestore,
} from "@/lib/datetime";
import { FEATURE_FLAGS } from "@/lib/featureFlags";
import { getFcmRegistrationFailureMessage, registerFcmToken } from "@/lib/fcm";
import { trackEvent } from "@/lib/analytics";
import { normalizeDisplayText } from "@/lib/normalizeText";
import { DraggableCard, type FolderDragData } from "../_components/folderDnd";
import WorkspaceFolderBrowser from "../_components/WorkspaceFolderBrowser";
import {
  applyWorkspaceAssignmentOverrides,
  applyWorkspaceParentOverrides,
  buildWorkspacePathLabelMap,
  canMoveWorkspaceToParent,
  countItemsByWorkspaceId,
  getWorkspaceById,
  getWorkspaceChain,
  getWorkspaceDirectContentIds,
  getWorkspaceDirectChildren,
  getWorkspaceSelfAndDescendantIds,
} from "@/lib/workspaces";
import type { Priority, TaskCalendarKind, TaskDoc } from "@/types/firestore";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { getOnboardingFlag, setOnboardingFlag } from "@/lib/onboarding";
import { CALENDAR_PREFERENCES_STORAGE_KEY } from "../_components/agendaCalendarUtils";
import type { AgendaCalendarPreferences } from "../_components/AgendaCalendar";
import AgendaActionBar from "../_components/AgendaActionBar";
import {
  createTaskWithPlanGuard,
  FREE_TASK_LIMIT_MESSAGE,
  getPlanLimitMessage,
  serializeTaskRecurrence,
  serializeTimestampMillis,
  setTaskFavoriteWithPlanGuard,
} from "@/lib/planGuardedMutations";

const AgendaCalendar = dynamic(() => import("../_components/AgendaCalendar"), {
  loading: () => <div className="sn-empty">Chargement de l’Agenda…</div>,
});

type TaskStatus = "todo" | "doing" | "done";
type TaskStatusFilter = "all" | TaskStatus;
type WorkspaceFilter = "all" | string;
type TaskViewMode = "list" | "grid" | "calendar";
const AGENDA_GRID_ENABLED = FEATURE_FLAGS.agendaGridEnabled;
type CalendarRecurrenceInput = {
  freq: "daily" | "weekly" | "monthly" | "yearly";
  interval?: number;
  until?: Date | null;
  exceptions?: string[];
} | null;

type TaskPriorityFilter = "all" | NonNullable<TaskDoc["priority"]>;
type DueFilter = "all" | "today" | "overdue";
type TaskSortBy = "dueDate" | "updatedAt" | "createdAt";
const GOOGLE_SYNC_FAILED_MESSAGE =
  "Élément enregistré dans TaskNote, mais non synchronisé avec Google Calendar.";

function toTimestampOrNull(date: Date | null) {
  return date ? Timestamp.fromDate(date) : null;
}

function toLocalDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function taskMatchesSnapshot(current: TaskDoc, optimistic: TaskDoc) {
  const currentStart = current.startDate?.toMillis?.() ?? null;
  const optimisticStart = optimistic.startDate?.toMillis?.() ?? null;
  const currentDue = current.dueDate?.toMillis?.() ?? null;
  const optimisticDue = optimistic.dueDate?.toMillis?.() ?? null;
  const currentUntil = current.recurrence?.until?.toMillis?.() ?? null;
  const optimisticUntil = optimistic.recurrence?.until?.toMillis?.() ?? null;
  const currentExceptions = Array.isArray(current.recurrence?.exceptions) ? current.recurrence.exceptions : [];
  const optimisticExceptions = Array.isArray(optimistic.recurrence?.exceptions) ? optimistic.recurrence.exceptions : [];
  const currentGoogleEventId = current.googleEventId ?? null;
  const optimisticGoogleEventId = optimistic.googleEventId ?? null;

  return (
    current.title === optimistic.title &&
    (current.allDay ?? false) === (optimistic.allDay ?? false) &&
    (current.workspaceId ?? null) === (optimistic.workspaceId ?? null) &&
    (current.priority ?? null) === (optimistic.priority ?? null) &&
    (current.calendarKind ?? "task") === (optimistic.calendarKind ?? "task") &&
    currentGoogleEventId === optimisticGoogleEventId &&
    currentStart === optimisticStart &&
    currentDue === optimisticDue &&
    (current.recurrence?.freq ?? null) === (optimistic.recurrence?.freq ?? null) &&
    (current.recurrence?.interval ?? 1) === (optimistic.recurrence?.interval ?? 1) &&
    currentUntil === optimisticUntil &&
    currentExceptions.length === optimisticExceptions.length &&
    currentExceptions.every((value, index) => value === optimisticExceptions[index])
  );
}

function mergeTaskCollections(
  baseTasks: TaskDoc[],
  optimisticTaskById: Record<string, TaskDoc>,
  optimisticCreatedTasks: TaskDoc[],
  deletedTaskIds: Record<string, true>,
) {
  const byId = new Map<string, TaskDoc>();

  for (const task of baseTasks) {
    if (!task.id) continue;
    if (deletedTaskIds[task.id]) continue;
    byId.set(task.id, task);
  }

  for (const [taskId, task] of Object.entries(optimisticTaskById)) {
    if (deletedTaskIds[taskId]) continue;
    byId.set(taskId, task);
  }

  for (const task of optimisticCreatedTasks) {
    if (!task.id) continue;
    if (deletedTaskIds[task.id]) continue;
    byId.set(task.id, task);
  }

  return Array.from(byId.values());
}

function normalizeAgendaCalendarPreferences(raw: unknown): AgendaCalendarPreferences | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<AgendaCalendarPreferences> & { displayMode?: unknown };
  if (
    candidate.viewMode !== "dayGridMonth" &&
    candidate.viewMode !== "timeGridWeek" &&
    candidate.viewMode !== "timeGridDay"
  ) {
    return null;
  }
  if (candidate.displayMode !== "calendar" && candidate.displayMode !== "planning") return null;

  return {
    viewMode: candidate.viewMode,
    displayMode: "calendar",
  };
}

function parseDateOnlyParam(raw: string | null): Date | null {
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

export default function TasksPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: allTasks, loading, error } = useUserTasks();
  const searchParams = useSearchParams();
  const highlightedTaskId = searchParams.get("taskId");
  const focusDateParam = searchParams.get("focusDate");
  const workspaceIdParam = searchParams.get("workspaceId");
  const createParam = searchParams.get("create");
  const favoriteParam = searchParams.get("favorite");
  const viewParam = searchParams.get("view");
  const dueParam = searchParams.get("due");
  const { data: userSettings } = useUserSettings();
  const isPro = userSettings?.plan === "pro";
  const freeLimitMessage = FREE_TASK_LIMIT_MESSAGE;

  const statusLabel = (s: TaskStatus) => {
    if (s === "todo") return "À faire";
    if (s === "doing") return "En cours";
    return "Terminée";
  };

  const formatDueDate = (ts: TaskDoc["dueDate"] | null | undefined) => {
    if (!ts) return "";
    try {
      return formatTimestampToDateTimeFr(ts);
    } catch {
      return "";
    }
  };

  const handleCalendarCreate = async (input: {
    title: string;
    start: Date;
    end: Date;
    allDay: boolean;
    workspaceId?: string | null;
    priority?: Priority | null;
    favorite?: boolean;
    calendarKind?: TaskCalendarKind | null;
    recurrence?: CalendarRecurrenceInput;
  }) => {
    const user = auth.currentUser;
    if (!user) {
      setEditError("Connecte-toi pour créer un élément d’agenda.");
      return;
    }

    const normalizedWindow = normalizeAgendaWindowForFirestore({
      start: input.start,
      end: input.end,
      allDay: input.allDay,
    });
    if (!normalizedWindow?.startDate || !normalizedWindow?.dueDate) {
      setEditError("Date invalide pour cet élément d’agenda.");
      return;
    }

    try {
      const createdResult = await createTaskWithPlanGuard({
        title: input.title,
        description: "",
        status: "todo",
        allDay: normalizedWindow.allDay,
        startDateMs: serializeTimestampMillis(normalizedWindow.startDate),
        dueDateMs: serializeTimestampMillis(normalizedWindow.dueDate),
        workspaceId: input.workspaceId ?? null,
        priority: input.priority ?? null,
        calendarKind: input.calendarKind ?? "task",
        recurrence: input.recurrence
          ? {
              freq: input.recurrence.freq,
              interval: input.recurrence.interval ?? 1,
              untilMs: input.recurrence.until ? input.recurrence.until.getTime() : null,
              exceptions: input.recurrence.exceptions ?? [],
            }
          : serializeTaskRecurrence(null),
        favorite: input.favorite === true,
        archived: false,
        sourceType: null,
        sourceTodoId: null,
        sourceTodoItemId: null,
      });

      void trackEvent("create_task", {
        source: "app",
        surface: "agenda_inline",
        all_day: normalizedWindow.allDay,
        priority: input.priority ?? null,
        workspace_bound: Boolean(input.workspaceId ?? null),
      });

      const optimisticCreatedTask: TaskDoc = {
        id: createdResult.taskId,
        userId: user.uid,
        title: input.title,
        description: "",
        status: "todo",
        allDay: normalizedWindow.allDay,
        startDate: normalizedWindow.startDate,
        dueDate: normalizedWindow.dueDate,
        workspaceId: input.workspaceId ?? null,
        priority: input.priority ?? null,
        calendarKind: input.calendarKind ?? "task",
        recurrence: input.recurrence
          ? {
              freq: input.recurrence.freq,
              interval: input.recurrence.interval ?? 1,
              until: toTimestampOrNull(input.recurrence.until ?? null),
              exceptions: input.recurrence.exceptions ?? [],
            }
          : null,
        favorite: input.favorite === true,
        googleEventId: null,
        archived: false,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };

      setOptimisticCreatedAgendaTasks((prev) => [
        ...prev.filter((task) => task.id !== createdResult.taskId),
        optimisticCreatedTask,
      ]);

      const googleStart = normalizedWindow.startDate.toDate();
      const googleEnd = normalizedWindow.dueDate.toDate();
      const googlePayload = normalizedWindow.allDay
        ? {
            title: input.title,
            start: toLocalDateInputValue(googleStart),
            end: toLocalDateInputValue(googleEnd),
            allDay: true,
          }
        : {
            title: input.title,
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
            taskId: createdResult.taskId,
          });
          showActionFeedback(GOOGLE_SYNC_FAILED_MESSAGE);
          return;
        }

        const data = (await response.json().catch(() => null)) as { created?: unknown; eventId?: unknown } | null;
        const googleEventId =
          data?.created === true && typeof data.eventId === "string" && data.eventId.trim()
            ? data.eventId.trim()
            : null;

        if (!googleEventId) {
          showActionFeedback(GOOGLE_SYNC_FAILED_MESSAGE);
          return;
        }

        try {
          await updateDoc(doc(db, "tasks", createdResult.taskId), {
            googleEventId,
            updatedAt: serverTimestamp(),
          });

          setOptimisticCreatedAgendaTasks((prev) =>
            prev.map((task) =>
              task.id === createdResult.taskId
                ? {
                    ...task,
                    googleEventId,
                    updatedAt: Timestamp.now(),
                  }
                : task,
            ),
          );
        } catch {
          console.warn("agenda.google.link_write_failed", {
            taskId: createdResult.taskId,
          });
        }
      }).catch(() => {
        console.warn("agenda.google.create_failed", {
          taskId: createdResult.taskId,
        });
        showActionFeedback(GOOGLE_SYNC_FAILED_MESSAGE);
      });
    } catch (error) {
      setEditError(getPlanLimitMessage(error) ?? toErrorMessage(error, "Impossible de créer cet élément d’agenda."));
    }
  };

  const handleSkipOccurrence = async (taskId: string, occurrenceDate: string) => {
    const user = auth.currentUser;
    const current = effectiveAllTasks.find((t) => t.id === taskId);
    if (!user || !current || current.userId !== user.uid) {
      setEditError("Impossible de modifier cet élément d’agenda.");
      return;
    }

    if (!current.recurrence?.freq) {
      setEditError("Cette occurrence ne peut pas être ignorée.");
      return;
    }

    const currentRecurrence = current.recurrence;
    const currentExceptions = Array.isArray(currentRecurrence?.exceptions) ? currentRecurrence.exceptions : [];
    const nextExceptions = currentExceptions.includes(occurrenceDate)
      ? currentExceptions
      : [...currentExceptions, occurrenceDate];

    setOptimisticAgendaTaskById((prev) => ({
      ...prev,
      [taskId]: {
        ...current,
        recurrence: {
          freq: currentRecurrence.freq,
          interval: currentRecurrence.interval ?? 1,
          until: currentRecurrence.until ?? null,
          exceptions: nextExceptions,
        },
        updatedAt: Timestamp.now(),
      },
    }));

    try {
      await updateDoc(doc(db, "tasks", taskId), {
        "recurrence.exceptions": arrayUnion(occurrenceDate),
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      setOptimisticAgendaTaskById((prev) => {
        if (!prev[taskId]) return prev;
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
      throw e;
    }

    setActionFeedback("Occurrence ignorée.");
    window.setTimeout(() => setActionFeedback(null), 1800);
  };

  const handleCalendarUpdate = async (input: {
    taskId: string;
    title?: string;
    start: Date;
    end: Date;
    allDay: boolean;
    workspaceId?: string | null;
    priority?: Priority | null;
    calendarKind?: TaskCalendarKind | null;
    recurrence?: CalendarRecurrenceInput;
  }) => {
    const user = auth.currentUser;
    const current = effectiveAllTasks.find((t) => t.id === input.taskId);
    if (!user || !current || current.userId !== user.uid) {
      setEditError("Impossible de modifier cet élément d’agenda.");
      return;
    }

    const normalizedWindow = normalizeAgendaWindowForFirestore({
      start: input.start,
      end: input.end,
      allDay: input.allDay,
    });
    if (!normalizedWindow?.startDate || !normalizedWindow?.dueDate) {
      setEditError("Date invalide pour cet élément d’agenda.");
      return;
    }

    const nextRecurrence =
      input.recurrence === undefined
        ? (current.recurrence ?? null)
        : input.recurrence
          ? {
              freq: input.recurrence.freq,
              interval: input.recurrence.interval ?? 1,
              until: normalizeDateForFirestore(input.recurrence.until ?? null),
              exceptions: input.recurrence.exceptions ?? [],
            }
          : null;

    const optimisticTask: TaskDoc = {
      ...current,
      title: input.title ?? current.title,
      allDay: normalizedWindow.allDay,
      startDate: normalizedWindow.startDate,
      dueDate: normalizedWindow.dueDate,
      workspaceId: input.workspaceId ?? current.workspaceId ?? null,
      priority: input.priority ?? current.priority ?? null,
      calendarKind: input.calendarKind ?? current.calendarKind ?? "task",
      recurrence: nextRecurrence,
      updatedAt: Timestamp.now(),
    };

    setOptimisticAgendaTaskById((prev) => ({ ...prev, [input.taskId]: optimisticTask }));

    try {
      await updateDoc(doc(db, "tasks", input.taskId), {
        title: optimisticTask.title,
        allDay: optimisticTask.allDay,
        startDate: optimisticTask.startDate ?? null,
        dueDate: optimisticTask.dueDate ?? null,
        workspaceId: optimisticTask.workspaceId ?? null,
        priority: optimisticTask.priority ?? null,
        calendarKind: optimisticTask.calendarKind ?? "task",
        recurrence: optimisticTask.recurrence ?? null,
        updatedAt: serverTimestamp(),
      });

      if (current.googleEventId) {
        const googleStart = normalizedWindow.startDate.toDate();
        const googleEnd = normalizedWindow.dueDate.toDate();
        const googlePayload = normalizedWindow.allDay
          ? {
              googleEventId: current.googleEventId,
              title: optimisticTask.title,
              start: toLocalDateInputValue(googleStart),
              end: toLocalDateInputValue(googleEnd),
              allDay: true,
            }
          : {
              googleEventId: current.googleEventId,
              title: optimisticTask.title,
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
              status: response.status,
              taskId: input.taskId,
            });
          }
        }).catch(() => {
          console.warn("agenda.google.update_failed", {
            taskId: input.taskId,
          });
        });
      }
    } catch (e) {
      setOptimisticAgendaTaskById((prev) => {
        if (!prev[input.taskId]) return prev;
        const next = { ...prev };
        delete next[input.taskId];
        return next;
      });
      throw e;
    }
  };

  const handleCalendarDelete = async (taskId: string) => {
    const user = auth.currentUser;
    const current = effectiveAllTasks.find((t) => t.id === taskId);
    const wasOptimisticCreated = optimisticCreatedAgendaTasks.some((task) => task.id === taskId);
    if (!user || !current || current.userId !== user.uid) {
      setEditError("Impossible de supprimer cet élément d’agenda.");
      return;
    }

    setEditError(null);
    setOptimisticDeletedAgendaTaskIds((prev) => ({ ...prev, [taskId]: true }));
    if (current.googleEventId) {
      setOptimisticDeletedGoogleEventIds((prev) => ({ ...prev, [current.googleEventId as string]: true }));
    }
    setOptimisticAgendaTaskById((prev) => {
      if (!prev[taskId]) return prev;
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
    setOptimisticCreatedAgendaTasks((prev) => prev.filter((task) => task.id !== taskId));

    try {
      if (current.googleEventId) {
        void fetch("/api/google/calendar/events", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ googleEventId: current.googleEventId }),
        }).then((response) => {
          if (!response.ok) {
            console.warn("agenda.google.delete_failed", {
              status: response.status,
              taskId,
            });
          }
        }).catch(() => {
          console.warn("agenda.google.delete_failed", {
            taskId,
          });
        });
      }

      await deleteDoc(doc(db, "tasks", taskId));
      setActionFeedback("Élément d’agenda supprimé.");
      window.setTimeout(() => setActionFeedback(null), 1800);
    } catch (error) {
      setOptimisticDeletedAgendaTaskIds((prev) => {
        if (!prev[taskId]) return prev;
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
      if (current.googleEventId) {
        setOptimisticDeletedGoogleEventIds((prev) => {
          if (!prev[current.googleEventId as string]) return prev;
          const next = { ...prev };
          delete next[current.googleEventId as string];
          return next;
        });
      }
      if (wasOptimisticCreated) {
        setOptimisticCreatedAgendaTasks((prev) => {
          if (prev.some((task) => task.id === taskId)) return prev;
          return [...prev, current];
        });
      }
      setEditError(toErrorMessage(error, "Erreur lors de la suppression de l’élément d’agenda."));
    }
  };

  const formatStartDate = (ts: TaskDoc["startDate"] | null | undefined) => {
    if (!ts) return "";
    try {
      return formatTimestampToDateFr(ts);
    } catch {
      return "";
    }
  };

  const priorityLabel = (p: NonNullable<TaskDoc["priority"]>) => {
    if (p === "high") return "Haute";
    if (p === "medium") return "Moyenne";
    return "Basse";
  };

  const priorityDotClass = (p: NonNullable<TaskDoc["priority"]>) => {
    if (p === "high") return "bg-red-500/80";
    if (p === "medium") return "bg-amber-500/80";
    return "bg-emerald-500/80";
  };

  const { data: favoriteTasksForLimit } = useUserTasks({ favoriteOnly: true, limit: 16 });
  const { data: workspaces } = useUserWorkspaces();

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<TaskStatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<TaskPriorityFilter>("all");
  const [dueFilter, setDueFilter] = useState<DueFilter>("all");
  const [sortBy, setSortBy] = useState<TaskSortBy>("dueDate");

  const [workspaceFilter, setWorkspaceFilter] = useState<WorkspaceFilter>("all");
  const [archiveView, setArchiveView] = useState<"active" | "archived">("active");

  const [viewMode, setViewMode] = useState<TaskViewMode>("calendar");
  const [calendarRange, setCalendarRange] = useState<{ start: Date; end: Date } | null>(null);
  const [flashHighlightTaskId, setFlashHighlightTaskId] = useState<string | null>(null);

  const handleCalendarVisibleRangeChange = useCallback((range: { start: Date; end: Date }) => {
    const bufferedStart = new Date(range.start.getTime() - 7 * 24 * 60 * 60 * 1000);
    const bufferedEnd = new Date(range.end.getTime() + 7 * 24 * 60 * 60 * 1000);

    setCalendarRange((prev) => {
      if (
        prev &&
        prev.start.getTime() === bufferedStart.getTime() &&
        prev.end.getTime() === bufferedEnd.getTime()
      ) {
        return prev;
      }
      return { start: bufferedStart, end: bufferedEnd };
    });
  }, []);

  const [editError, setEditError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [activeDragItem, setActiveDragItem] = useState<FolderDragData | null>(null);
  const [optimisticWorkspaceIdByTaskId, setOptimisticWorkspaceIdByTaskId] = useState<Record<string, string | null>>({});
  const [optimisticParentIdByWorkspaceId, setOptimisticParentIdByWorkspaceId] = useState<Record<string, string | null>>({});
  const [optimisticAgendaTaskById, setOptimisticAgendaTaskById] = useState<Record<string, TaskDoc>>({});
  const [optimisticCreatedAgendaTasks, setOptimisticCreatedAgendaTasks] = useState<TaskDoc[]>([]);
  const [optimisticDeletedAgendaTaskIds, setOptimisticDeletedAgendaTaskIds] = useState<Record<string, true>>({});
  const [optimisticDeletedGoogleEventIds, setOptimisticDeletedGoogleEventIds] = useState<Record<string, true>>({});
  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const [enablingPush, setEnablingPush] = useState(false);
  const [calendarPrefsLocalFallback, setCalendarPrefsLocalFallback] = useState<AgendaCalendarPreferences | null>(null);
  const calendarPrefsWriteTimerRef = useRef<number | null>(null);
  const hasAppliedViewParamRef = useRef(false);

  const [optimisticStatusById, setOptimisticStatusById] = useState<Record<string, TaskStatus>>({});
  const isCalendarView = viewMode === "calendar";

  const initialCalendarAnchorDate = useMemo(() => parseDateOnlyParam(focusDateParam), [focusDateParam]);

  const calendarRangeFromTs = useMemo(
    () => (calendarRange ? (normalizeDateForFirestore(calendarRange.start) ?? undefined) : undefined),
    [calendarRange],
  );
  const calendarRangeToTs = useMemo(
    () => (calendarRange ? (normalizeDateForFirestore(calendarRange.end) ?? undefined) : undefined),
    [calendarRange],
  );

  const { data: calendarWindowDueTasks } = useUserTasks({
    enabled: viewMode === "calendar",
    workspaceId: workspaceFilter !== "all" ? workspaceFilter : undefined,
    dueDateFrom: calendarRangeFromTs,
    dueDateTo: calendarRangeToTs,
    limit: 500,
  });

  const { data: calendarWindowStartTasks } = useUserTasks({
    enabled: viewMode === "calendar",
    workspaceId: workspaceFilter !== "all" ? workspaceFilter : undefined,
    startDateFrom: calendarRangeFromTs,
    startDateTo: calendarRangeToTs,
    limit: 500,
  });

  const { data: recurringCalendarTasks } = useUserTasks({
    enabled: viewMode === "calendar",
    workspaceId: workspaceFilter !== "all" ? workspaceFilter : undefined,
    recurrenceFreqs: ["daily", "weekly", "monthly", "yearly"],
    limit: 500,
  });

  const calendarWindowTasks = useMemo(() => {
    const byId = new Map<string, TaskDoc>();
    for (const task of calendarWindowDueTasks) {
      if (!task.id) continue;
      byId.set(task.id, task);
    }
    for (const task of calendarWindowStartTasks) {
      if (!task.id) continue;
      byId.set(task.id, task);
    }
    for (const task of recurringCalendarTasks) {
      if (!task.id) continue;
      byId.set(task.id, task);
    }

    return Array.from(byId.values());
  }, [calendarWindowDueTasks, calendarWindowStartTasks, recurringCalendarTasks]);

  const optimisticAllTasks = useMemo(
    () => mergeTaskCollections(allTasks, optimisticAgendaTaskById, optimisticCreatedAgendaTasks, optimisticDeletedAgendaTaskIds),
    [allTasks, optimisticAgendaTaskById, optimisticCreatedAgendaTasks, optimisticDeletedAgendaTaskIds],
  );

  const optimisticCalendarWindowTasks = useMemo(
    () => mergeTaskCollections(calendarWindowTasks, optimisticAgendaTaskById, optimisticCreatedAgendaTasks, optimisticDeletedAgendaTaskIds),
    [calendarWindowTasks, optimisticAgendaTaskById, optimisticCreatedAgendaTasks, optimisticDeletedAgendaTaskIds],
  );

  const effectiveCalendarWindowTasks = useMemo(
    () => applyWorkspaceAssignmentOverrides(optimisticCalendarWindowTasks, optimisticWorkspaceIdByTaskId),
    [optimisticCalendarWindowTasks, optimisticWorkspaceIdByTaskId],
  );

  const dndSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const toErrorMessage = (e: unknown, fallback: string) => {
    if (e instanceof Error && e.message) return e.message;
    return fallback;
  };

  const showActionFeedback = useCallback((message: string) => {
    setActionFeedback(message);
    window.setTimeout(() => setActionFeedback(null), 1800);
  }, []);

  const toMillisSafe = (ts: unknown) => {
    const maybeTs = ts as { toMillis?: () => number };
    if (maybeTs && typeof maybeTs.toMillis === "function") {
      return maybeTs.toMillis();
    }
    return 0;
  };

  const normalizeSearchText = (raw: string) => {
    try {
      return normalizeDisplayText(raw)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
    } catch {
      return normalizeDisplayText(raw).toLowerCase().trim();
    }
  };

  const effectiveWorkspaces = useMemo(
    () => applyWorkspaceParentOverrides(workspaces, optimisticParentIdByWorkspaceId),
    [optimisticParentIdByWorkspaceId, workspaces],
  );
  const effectiveAllTasks = useMemo(
    () => applyWorkspaceAssignmentOverrides(optimisticAllTasks, optimisticWorkspaceIdByTaskId),
    [optimisticAllTasks, optimisticWorkspaceIdByTaskId],
  );
  const tasks = viewMode === "calendar" ? effectiveCalendarWindowTasks : effectiveAllTasks;

  useEffect(() => {
    setOptimisticAgendaTaskById((prev) => {
      const entries = Object.entries(prev);
      if (entries.length === 0) return prev;

      const nextEntries = entries.filter(([taskId, optimisticTask]) => {
        const current = allTasks.find((task) => task.id === taskId);
        if (!current) return true;
        return !taskMatchesSnapshot(current, optimisticTask);
      });

      if (nextEntries.length === entries.length) return prev;
      return Object.fromEntries(nextEntries);
    });
  }, [allTasks]);

  useEffect(() => {
    setOptimisticCreatedAgendaTasks((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.filter((task) => !allTasks.some((current) => current.id === task.id));
      return next.length === prev.length ? prev : next;
    });
  }, [allTasks]);

  useEffect(() => {
    setOptimisticDeletedAgendaTaskIds((prev) => {
      const entries = Object.entries(prev);
      if (entries.length === 0) return prev;

      const nextEntries = entries.filter(([taskId]) => allTasks.some((task) => task.id === taskId));
      if (nextEntries.length === entries.length) return prev;
      return Object.fromEntries(nextEntries);
    });
  }, [allTasks]);

  const workspaceNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const ws of effectiveWorkspaces) {
      if (ws.id) m.set(ws.id, normalizeDisplayText(ws.name));
    }
    return m;
  }, [effectiveWorkspaces]);
  const { data: notesForCounter } = useUserNotes();
  const { data: todosForCounter } = useUserTodos({ completed: false });
  const workspaceOptionLabelById = useMemo(() => buildWorkspacePathLabelMap(effectiveWorkspaces), [effectiveWorkspaces]);
  const currentWorkspace = useMemo(() => getWorkspaceById(effectiveWorkspaces, workspaceIdParam), [effectiveWorkspaces, workspaceIdParam]);
  const currentWorkspaceChain = useMemo(() => getWorkspaceChain(effectiveWorkspaces, workspaceIdParam), [effectiveWorkspaces, workspaceIdParam]);
  const directChildWorkspaces = useMemo(
    () => getWorkspaceDirectChildren(effectiveWorkspaces, workspaceIdParam),
    [effectiveWorkspaces, workspaceIdParam],
  );
  const activeNoteCountByWorkspaceId = useMemo(
    () => countItemsByWorkspaceId(notesForCounter, (note) => note.archived !== true),
    [notesForCounter],
  );
  const activeTaskCountByWorkspaceId = useMemo(
    () => countItemsByWorkspaceId(effectiveAllTasks, (task) => task.archived !== true),
    [effectiveAllTasks],
  );
  const activeTodoCountByWorkspaceId = useMemo(
    () => countItemsByWorkspaceId(todosForCounter),
    [todosForCounter],
  );
  const selectedWorkspaceIds = useMemo(
    () =>
      workspaceFilter === "all"
        ? null
        : workspaceIdParam && workspaceFilter === workspaceIdParam
          ? new Set([workspaceIdParam])
          : getWorkspaceSelfAndDescendantIds(effectiveWorkspaces, workspaceFilter),
    [workspaceFilter, workspaceIdParam, effectiveWorkspaces],
  );
  const tabWorkspaceIds = useMemo(() => getWorkspaceDirectContentIds(workspaceIdParam), [workspaceIdParam]);
  const directWorkspaceCounts = useMemo(
    () => ({
      notes: workspaceIdParam ? activeNoteCountByWorkspaceId.get(workspaceIdParam) ?? 0 : 0,
      tasks: workspaceIdParam ? activeTaskCountByWorkspaceId.get(workspaceIdParam) ?? 0 : 0,
      todos: workspaceIdParam ? activeTodoCountByWorkspaceId.get(workspaceIdParam) ?? 0 : 0,
    }),
    [activeNoteCountByWorkspaceId, activeTaskCountByWorkspaceId, activeTodoCountByWorkspaceId, workspaceIdParam],
  );
  const childWorkspaceCards = useMemo(
    () =>
      directChildWorkspaces
        .filter((workspace) => workspace.id)
        .map((workspace) => ({
          workspace,
          href: `/tasks?workspaceId=${encodeURIComponent(workspace.id ?? "")}`,
          counts: {
            notes: activeNoteCountByWorkspaceId.get(workspace.id ?? "") ?? 0,
            tasks: activeTaskCountByWorkspaceId.get(workspace.id ?? "") ?? 0,
            todos: activeTodoCountByWorkspaceId.get(workspace.id ?? "") ?? 0,
          },
        })),
    [activeNoteCountByWorkspaceId, activeTaskCountByWorkspaceId, activeTodoCountByWorkspaceId, directChildWorkspaces],
  );

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 150);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const pushWorkspaceFilterToUrl = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "all") {
        params.delete("workspaceId");
      } else {
        params.set("workspaceId", next);
      }
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, router, searchParams],
  );

  const userId = auth.currentUser?.uid;
  const [showMicroGuide, setShowMicroGuide] = useState(false);

  useEffect(() => {
    if (!userId) {
      setShowMicroGuide(false);
      return;
    }
    setShowMicroGuide(!getOnboardingFlag(userId, "tasks_microguide_v1"));
  }, [userId]);

  const handleDismissMicroGuide = useCallback(() => {
    if (!userId) return;
    setOnboardingFlag(userId, "tasks_microguide_v1", true);
    setShowMicroGuide(false);
  }, [userId]);

  const agendaCreateRequest = useMemo(
    () =>
      createParam === "1"
        ? {
            requestKey: `${createParam}|${searchParams.get("startDate") ?? ""}|${workspaceIdParam ?? ""}|${favoriteParam ?? ""}`,
            startDate: searchParams.get("startDate"),
            workspaceId: workspaceIdParam,
            favorite: favoriteParam === "1",
          }
        : null,
    [createParam, favoriteParam, searchParams, workspaceIdParam],
  );

  const handleAgendaCreateRequestHandled = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("create");
    params.delete("startDate");
    params.delete("favorite");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!highlightedTaskId) return;
    const target = allTasks.find((t) => t.id === highlightedTaskId);
    if (!target) return;

    setArchiveView(target.archived === true ? "archived" : "active");
    setStatusFilter("all");
    setPriorityFilter("all");
    setDueFilter("all");
    setSearchInput("");
    setFlashHighlightTaskId(highlightedTaskId);

    const timer = window.setTimeout(() => {
      setFlashHighlightTaskId((prev) => (prev === highlightedTaskId ? null : prev));
    }, 2600);

    return () => window.clearTimeout(timer);
  }, [highlightedTaskId, allTasks]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("tasksViewMode");
      if (raw === "list" || raw === "grid" || raw === "calendar" || raw === "kanban") {
        const normalized = raw === "kanban" ? "calendar" : raw;
        const next = normalized === "grid" && !AGENDA_GRID_ENABLED ? "calendar" : normalized;
        setViewMode(next as TaskViewMode);
      }
    } catch {
      // ignore
    }
  }, []);

  const applyViewMode = useCallback((next: TaskViewMode) => {
    const safeNext = next === "grid" && !AGENDA_GRID_ENABLED ? "calendar" : next;
    setViewMode(safeNext);
    try {
      window.localStorage.setItem("tasksViewMode", safeNext);
    } catch {
      // ignore localStorage errors
    }
  }, []);

  useEffect(() => {
    if (createParam !== "1") return;
    setArchiveView("active");
    applyViewMode("calendar");
  }, [applyViewMode, createParam]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CALENDAR_PREFERENCES_STORAGE_KEY);
      if (!raw) return;
      const parsed = normalizeAgendaCalendarPreferences(JSON.parse(raw));
      if (!parsed) return;
      setCalendarPrefsLocalFallback(parsed);
    } catch {
      // ignore
    }
  }, []);

  const calendarPrefsFromUser = useMemo(
    () => normalizeAgendaCalendarPreferences(userSettings?.settings?.agendaCalendarPreferences),
    [userSettings?.settings?.agendaCalendarPreferences],
  );

  const calendarInitialPreferences = calendarPrefsFromUser ?? calendarPrefsLocalFallback;

  const handleAgendaCalendarPreferencesChange = useCallback((prefs: AgendaCalendarPreferences) => {
    setCalendarPrefsLocalFallback(prefs);

    try {
      window.localStorage.setItem(CALENDAR_PREFERENCES_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // ignore
    }

    const uid = auth.currentUser?.uid;
    if (!uid) return;

    if (calendarPrefsWriteTimerRef.current) {
      window.clearTimeout(calendarPrefsWriteTimerRef.current);
    }

    calendarPrefsWriteTimerRef.current = window.setTimeout(() => {
      void updateDoc(doc(db, "users", uid), {
        "settings.agendaCalendarPreferences": prefs,
        updatedAt: serverTimestamp(),
      }).catch((e) => {
        console.error("Error saving agenda calendar preferences", e);
      });
      calendarPrefsWriteTimerRef.current = null;
    }, 450);
  }, []);

  useEffect(() => {
    return () => {
      if (calendarPrefsWriteTimerRef.current) {
        window.clearTimeout(calendarPrefsWriteTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (hasAppliedViewParamRef.current) return;
    if (viewParam === "calendar" || viewParam === "list" || viewParam === "grid" || viewParam === "kanban") {
      const normalized = viewParam === "kanban" ? "calendar" : viewParam;
      const safeFromQuery = normalized === "grid" && !AGENDA_GRID_ENABLED ? "calendar" : normalized;
      applyViewMode(safeFromQuery);
      hasAppliedViewParamRef.current = true;
      return;
    }
    hasAppliedViewParamRef.current = true;
  }, [applyViewMode, viewParam]);

  useEffect(() => {
    if (dueParam === "today" || dueParam === "overdue") {
      setDueFilter(dueParam);
      return;
    }
    if (dueParam === "all" || dueParam === null) {
      setDueFilter("all");
    }
  }, [dueParam]);

  // Keep workspaceFilter in sync with ?workspaceId=... from the sidebar.
  useEffect(() => {
    const nextFilter = workspaceIdParam ?? "all";
    if (workspaceFilter !== nextFilter) {
      setWorkspaceFilter(nextFilter as WorkspaceFilter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceIdParam]);

  const isSameLocalDay = (a: Date, b: Date) => {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  };

  const statusForTask = useCallback(
    (task: TaskDoc): TaskStatus => {
      const optimistic = task.id ? optimisticStatusById[task.id] : undefined;
      if (optimistic !== undefined) return optimistic;
      return (((task.status as TaskStatus | undefined) ?? "todo") as TaskStatus) || "todo";
    },
    [optimisticStatusById],
  );

  const filteredTasks = useMemo(() => {
    const now = new Date();
    const q = normalizeSearchText(debouncedSearch);

    let result = tasks;

    result = result.filter((t) => (archiveView === "archived" ? t.archived === true : t.archived !== true));

    if (selectedWorkspaceIds) {
      result = result.filter((task) => selectedWorkspaceIds.has(task.workspaceId ?? ""));
    }

    if (priorityFilter !== "all") {
      result = result.filter((task) => task.priority === priorityFilter);
    }

    if (q) {
      result = result.filter((task) => {
        const workspaceName = task.workspaceId ? workspaceNameById.get(task.workspaceId) ?? "" : "";
        const status = statusForTask(task);
        const priority = task.priority ? priorityLabel(task.priority) : "";
        const startLabel = formatStartDate(task.startDate ?? null);
        const dueLabel = formatDueDate(task.dueDate ?? null);
        const sourceLabel = task.sourceType === "checklist_item" ? "checklist" : "tache";
        const text = normalizeSearchText(
          `${normalizeDisplayText(task.title)}\n${task.description ?? ""}\n${workspaceName}\n${statusLabel(status)}\n${priority}\n${startLabel}\n${dueLabel}\n${sourceLabel}`,
        );
        return text.includes(q);
      });
    }

    if (dueFilter !== "all") {
      result = result.filter((task) => {
        const status = statusForTask(task);
        if (status === "done") return false;
        if (!task.dueDate) return false;
        let due: Date;
        try {
          due = task.dueDate.toDate();
        } catch {
          return false;
        }

        if (dueFilter === "today") return isSameLocalDay(due, now);
        return due.getTime() < now.getTime();
      });
    }

    if (statusFilter !== "all") {
      result = result.filter((task) => {
        const status = statusForTask(task);
        return status === statusFilter;
      });
    }

    const sorted = result.slice().sort((a, b) => {
      if (sortBy === "dueDate") {
        const aDue = a.dueDate ? a.dueDate.toMillis() : null;
        const bDue = b.dueDate ? b.dueDate.toMillis() : null;

        const aHasDue = aDue !== null;
        const bHasDue = bDue !== null;

        if (aHasDue && bHasDue) return aDue! - bDue!;
        if (aHasDue && !bHasDue) return -1;
        if (!aHasDue && bHasDue) return 1;

        const aUpdated = toMillisSafe(a.updatedAt);
        const bUpdated = toMillisSafe(b.updatedAt);
        return bUpdated - aUpdated;
      }

      const aMillis = sortBy === "createdAt" ? toMillisSafe(a.createdAt) : toMillisSafe(a.updatedAt);
      const bMillis = sortBy === "createdAt" ? toMillisSafe(b.createdAt) : toMillisSafe(b.updatedAt);
      if (aMillis !== bMillis) return bMillis - aMillis;

      const aDue = a.dueDate ? a.dueDate.toMillis() : null;
      const bDue = b.dueDate ? b.dueDate.toMillis() : null;
      if (aDue !== null && bDue !== null && aDue !== bDue) return aDue - bDue;
      if (aDue !== null && bDue === null) return -1;
      if (aDue === null && bDue !== null) return 1;
      return 0;
    });

    return sorted;
  }, [tasks, archiveView, selectedWorkspaceIds, priorityFilter, debouncedSearch, dueFilter, statusFilter, sortBy, workspaceNameById, statusForTask]);

  useEffect(() => {
    setOptimisticStatusById((prev) => {
      const ids = Object.keys(prev);
      if (ids.length === 0) return prev;

      const byId = new Map<string, TaskDoc>();
      tasks.forEach((t) => {
        if (t.id) byId.set(t.id, t);
      });

      let changed = false;
      const next: Record<string, TaskStatus> = { ...prev };
      for (const id of ids) {
        const task = byId.get(id);
        if (!task) {
          delete next[id];
          changed = true;
          continue;
        }
        const actual = ((task.status as TaskStatus | undefined) ?? "todo") as TaskStatus;
        if (actual === prev[id]) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [tasks]);

  const activeTasks = useMemo(() => {
    return filteredTasks.filter((t) => statusForTask(t) !== "done");
  }, [filteredTasks, statusForTask]);

  const completedTasks = useMemo(() => {
    return filteredTasks.filter((t) => statusForTask(t) === "done");
  }, [filteredTasks, statusForTask]);

  const mainTasks = useMemo(() => {
    if (statusFilter === "done") return completedTasks;
    return activeTasks;
  }, [activeTasks, completedTasks, statusFilter]);

  const hasActiveSearchOrFilters = useMemo(() => {
    const q = debouncedSearch.trim();
    const baselineWorkspace = workspaceIdParam ?? "all";
    return (
      q.length > 0 ||
      statusFilter !== "all" ||
      priorityFilter !== "all" ||
      dueFilter !== "all" ||
      workspaceFilter !== baselineWorkspace
    );
  }, [debouncedSearch, dueFilter, priorityFilter, statusFilter, workspaceFilter, workspaceIdParam]);
  const activeSearchLabel = useMemo(() => debouncedSearch.trim().slice(0, 60), [debouncedSearch]);

  const visibleTasksCount = useMemo(
    () => activeTasks.length + completedTasks.length,
    [activeTasks.length, completedTasks.length],
  );

  const visibleNotesCount = useMemo(
    () =>
      notesForCounter.filter((note) => {
        if (note.archived === true) return false;
        if (!tabWorkspaceIds) return true;
        return tabWorkspaceIds.has(note.workspaceId ?? "");
      }).length,
    [notesForCounter, tabWorkspaceIds],
  );

  const visibleTodosCount = useMemo(
    () =>
      todosForCounter.filter((todo) => {
        if (!tabWorkspaceIds) return true;
        return tabWorkspaceIds.has(todo.workspaceId ?? "");
      }).length,
    [tabWorkspaceIds, todosForCounter],
  );

  const hrefSuffix = workspaceIdParam ? `?workspaceId=${encodeURIComponent(workspaceIdParam)}` : "";

  const workspaceTabsSwipeHandlers = useSwipeNavigation<HTMLDivElement>({
    onSwipeRight: () => {
      router.push(`/notes${hrefSuffix}`);
    },
    onSwipeLeft: () => {
      router.push(`/todo${hrefSuffix}`);
    },
    ignoreInteractiveTargets: true,
    disabled: !workspaceIdParam,
  });

  const archiveTabsSwipeHandlers = useSwipeNavigation<HTMLDivElement>({
    onSwipeLeft: () => setArchiveView("archived"),
    onSwipeRight: () => setArchiveView("active"),
    disabled: false,
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

  const toggleDone = async (task: TaskDoc, nextDone: boolean) => {
    if (!task.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== task.userId) {
      setEditError("Impossible de modifier cet élément d’agenda.");
      return;
    }

    const nextStatus: TaskStatus = nextDone ? "done" : "todo";
    setEditError(null);
    setOptimisticStatusById((prev) => ({ ...prev, [task.id!]: nextStatus }));
    try {
      await updateDoc(doc(db, "tasks", task.id), {
        title: task.title,
        status: nextStatus,
        workspaceId: typeof task.workspaceId === "string" ? task.workspaceId : null,
        dueDate: task.dueDate ?? null,
        favorite: task.favorite === true,
        updatedAt: serverTimestamp(),
      });

      if (!nextDone) {
        setActionFeedback("Élément d’agenda restauré.");
        window.setTimeout(() => setActionFeedback(null), 1800);
      }
    } catch (e) {
      console.error("Error toggling done", e);
      setOptimisticStatusById((prev) => {
        const next = { ...prev };
        delete next[task.id!];
        return next;
      });
      setEditError(toErrorMessage(e, "Erreur lors de la mise à jour de l’élément d’agenda."));
    }
  };

  const archivedTasks = useMemo(() => {
    if (archiveView !== "archived") return [] as TaskDoc[];

    return filteredTasks
      .slice()
      .sort((a, b) => {
        const aArchived = toMillisSafe(a.archivedAt);
        const bArchived = toMillisSafe(b.archivedAt);
        if (aArchived !== bArchived) return bArchived - aArchived;

        const aUpdated = toMillisSafe(a.updatedAt);
        const bUpdated = toMillisSafe(b.updatedAt);
        return bUpdated - aUpdated;
      });
  }, [archiveView, filteredTasks]);

  const restoreArchivedTask = async (task: TaskDoc) => {
    if (!task.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== task.userId) {
      setEditError("Impossible de modifier cet élément d’agenda.");
      return;
    }

    setEditError(null);
    try {
      await updateDoc(doc(db, "tasks", task.id), {
        archived: false,
        archivedAt: null,
        updatedAt: serverTimestamp(),
      });

      setActionFeedback("Élément d’agenda restauré.");
      window.setTimeout(() => setActionFeedback(null), 1800);
      setArchiveView("active");
    } catch (e) {
      console.error("Error restoring archived task", e);
      setEditError(toErrorMessage(e, "Erreur lors de la restauration de l’élément d’agenda."));
    }
  };

  const toggleFavorite = async (task: TaskDoc) => {
    if (!task.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== task.userId) {
      setEditError("Impossible de modifier cet élément d’agenda.");
      return;
    }

    const favoriteActiveCount = favoriteTasksForLimit.filter((t) => t.archived !== true).length;
    if (!isPro && task.favorite !== true && favoriteActiveCount >= 15) {
      setEditError(freeLimitMessage);
      return;
    }

    setEditError(null);
    try {
      await setTaskFavoriteWithPlanGuard(task.id, !(task.favorite === true));
    } catch (e) {
      console.error("Error toggling favorite", e);
      setEditError(getPlanLimitMessage(e) ?? toErrorMessage(e, "Erreur lors de la mise à jour des favoris."));
    }
  };

  const isFolderDropDisabled = useCallback(
    (targetWorkspaceId: string, dragItem: FolderDragData | null) => {
      if (!dragItem) return false;
      if (dragItem.kind === "workspace") {
        return !canMoveWorkspaceToParent(effectiveWorkspaces, dragItem.id, targetWorkspaceId);
      }
      return dragItem.workspaceId === targetWorkspaceId;
    },
    [effectiveWorkspaces],
  );

  const moveTaskToWorkspace = useCallback(async (taskId: string, targetWorkspaceId: string, currentWorkspaceId: string | null) => {
    if (currentWorkspaceId === targetWorkspaceId) return;

    setOptimisticWorkspaceIdByTaskId((prev) => ({ ...prev, [taskId]: targetWorkspaceId }));
    setActionFeedback("Element d'agenda deplace.");
    window.setTimeout(() => setActionFeedback(null), 1800);

    try {
      await updateDoc(doc(db, "tasks", taskId), {
        workspaceId: targetWorkspaceId,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      setOptimisticWorkspaceIdByTaskId((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
      setEditError(toErrorMessage(error, "Erreur lors du deplacement de l'element d'agenda."));
    }
  }, []);

  const moveWorkspaceToParent = useCallback(async (draggedWorkspaceId: string, targetWorkspaceId: string) => {
    if (!canMoveWorkspaceToParent(effectiveWorkspaces, draggedWorkspaceId, targetWorkspaceId)) return;

    setOptimisticParentIdByWorkspaceId((prev) => ({ ...prev, [draggedWorkspaceId]: targetWorkspaceId }));
    setActionFeedback("Dossier deplace.");
    window.setTimeout(() => setActionFeedback(null), 1800);

    try {
      await updateDoc(doc(db, "workspaces", draggedWorkspaceId), {
        parentId: targetWorkspaceId,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      setOptimisticParentIdByWorkspaceId((prev) => {
        const next = { ...prev };
        delete next[draggedWorkspaceId];
        return next;
      });
      setEditError(toErrorMessage(error, "Erreur lors du deplacement du dossier."));
    }
  }, [effectiveWorkspaces]);

  const handleFolderDragStart = useCallback((event: DragStartEvent) => {
    const dragData = event.active.data.current as FolderDragData | undefined;
    setActiveDragItem(dragData ?? null);
    setEditError(null);
  }, []);

  const handleFolderDragCancel = useCallback(() => {
    setActiveDragItem(null);
  }, []);

  const handleFolderDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const dragData = event.active.data.current as FolderDragData | undefined;
      const dropData = event.over?.data.current as { kind?: string; workspaceId?: string } | undefined;

      setActiveDragItem(null);

      if (!dragData || dropData?.kind !== "folder-target" || !dropData.workspaceId) return;
      if (isFolderDropDisabled(dropData.workspaceId, dragData)) return;

      if (dragData.kind === "task") {
        await moveTaskToWorkspace(dragData.id, dropData.workspaceId, dragData.workspaceId);
        return;
      }

      if (dragData.kind === "workspace") {
        await moveWorkspaceToParent(dragData.id, dropData.workspaceId);
      }
    },
    [isFolderDropDisabled, moveTaskToWorkspace, moveWorkspaceToParent],
  );

  const notificationPermission: NotificationPermission | "unsupported" = (() => {
    if (typeof window === "undefined") return "unsupported";
    if (!("Notification" in window)) return "unsupported";
    return Notification.permission;
  })();

  const handleEnableNotifications = async () => {
    setPushStatus("Activation des notifications…");
    setEnablingPush(true);
    try {
      const registrationResult = await registerFcmToken();
      if (registrationResult.ok) {
        setPushStatus("✓ Notifications activées");
      } else {
        setPushStatus(getFcmRegistrationFailureMessage(registrationResult.reason));
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
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 12;

    const tryScroll = () => {
      if (cancelled) return;
      const el = document.getElementById(`task-${highlightedTaskId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      attempts += 1;
      if (attempts < maxAttempts) {
        window.setTimeout(tryScroll, 120);
      }
    };

    tryScroll();

    return () => {
      cancelled = true;
    };
  }, [highlightedTaskId, archiveView, viewMode, filteredTasks.length]);

  return (
    <DndContext
      sensors={dndSensors}
      onDragStart={handleFolderDragStart}
      onDragCancel={handleFolderDragCancel}
      onDragEnd={handleFolderDragEnd}
    >
      <div
        className={isCalendarView ? "flex min-h-0 flex-1 flex-col gap-2 md:gap-2" : "space-y-3 md:space-y-2"}
        {...workspaceTabsSwipeHandlers}
      >
      {workspaceIdParam && tabs}
      <header className={isCalendarView ? "flex flex-col gap-1.5 mb-1 md:mb-1" : "flex flex-col gap-2 mb-2 md:mb-2"}>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Agenda</h1>
        </div>

        <div className="w-full" {...archiveTabsSwipeHandlers}>
          <AgendaActionBar
            archiveView={archiveView}
            viewMode={viewMode}
            onArchiveViewChange={setArchiveView}
            onViewModeChange={applyViewMode}
            searchValue={searchInput}
            onSearchChange={setSearchInput}
            onFilterToggle={() => setFiltersOpen(true)}
            trailingSlot={<div id="sn-create-slot" data-task-view-mode={viewMode} />}
          />
        </div>

        {activeSearchLabel && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="sn-badge">Recherche: “{activeSearchLabel}”</span>
            <span className="sn-badge">Résultats: {filteredTasks.length}</span>
          </div>
        )}

        {filtersOpen && (
          <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Filtres agenda">
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              onClick={() => setFiltersOpen(false)}
              aria-label="Fermer les filtres"
            />
            <div className="absolute left-0 right-0 bottom-0 w-full sm:left-1/2 sm:top-1/2 sm:right-auto sm:bottom-auto sm:w-[min(92vw,520px)] sm:-translate-x-1/2 sm:-translate-y-1/2 rounded-t-lg sm:rounded-lg border border-border bg-card shadow-lg max-h-[85dvh] overflow-y-auto">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div className="text-sm font-semibold">Filtres</div>
                <button
                  type="button"
                  onClick={() => setFiltersOpen(false)}
                  className="sn-icon-btn"
                  aria-label="Fermer"
                >
                  ×
                </button>
              </div>
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Statut</div>
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value as TaskStatusFilter)}
                      aria-label="Filtrer par statut"
                      className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
                    >
                      <option value="all">Tous</option>
                      <option value="todo">À faire</option>
                      <option value="doing">En cours</option>
                      <option value="done">Terminée</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Priorité</div>
                    <select
                      value={priorityFilter}
                      onChange={(e) => setPriorityFilter(e.target.value as TaskPriorityFilter)}
                      aria-label="Filtrer par priorité"
                      className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
                    >
                      <option value="all">Toutes</option>
                      <option value="high">Haute</option>
                      <option value="medium">Moyenne</option>
                      <option value="low">Basse</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Échéance</div>
                    <select
                      value={dueFilter}
                      onChange={(e) => setDueFilter(e.target.value as DueFilter)}
                      aria-label="Filtrer par échéance"
                      className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
                    >
                      <option value="all">Toutes</option>
                      <option value="today">Aujourd’hui</option>
                      <option value="overdue">En retard</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Tri</div>
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as TaskSortBy)}
                      aria-label="Trier l’agenda"
                      className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
                    >
                      <option value="dueDate">Échéance</option>
                      <option value="updatedAt">Dernière modification</option>
                      <option value="createdAt">Date de création</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Dossier</div>
                  <select
                    value={workspaceFilter}
                    onChange={(e) => {
                      const next = e.target.value;
                      setWorkspaceFilter(next as WorkspaceFilter);
                      pushWorkspaceFilterToUrl(next);
                    }}
                    aria-label="Filtrer par dossier"
                    className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
                  >
                    <option value="all">Tous les dossiers</option>
                    {effectiveWorkspaces.map((ws) => (
                      <option key={ws.id ?? ws.name} value={ws.id ?? ""} disabled={!ws.id}>
                        {workspaceOptionLabelById.get(ws.id ?? "") ?? normalizeDisplayText(ws.name)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between gap-3 pt-2">
                  <button
                    type="button"
                    className="sn-text-btn"
                    onClick={() => {
                      setStatusFilter("all");
                      setPriorityFilter("all");
                      setDueFilter("all");
                      setSortBy("dueDate");
                      const base = workspaceIdParam ?? "all";
                      setWorkspaceFilter(base as WorkspaceFilter);
                      pushWorkspaceFilterToUrl(base);
                    }}
                  >
                    Réinitialiser
                  </button>

                  <button
                    type="button"
                    className="inline-flex items-center justify-center h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium"
                    onClick={() => setFiltersOpen(false)}
                  >
                    Appliquer
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {notificationPermission !== "granted" && (
          <div className="space-y-2">
            {notificationPermission === "unsupported" && (
              <div className="sn-alert sn-alert--info">✕ Navigateur non compatible avec les notifications.</div>
            )}

            {notificationPermission === "denied" && (
              <div className="sn-alert sn-alert--info">
                Permission refusee. Tu peux reactiver les notifications depuis les parametres de ton navigateur.
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

      {workspaceIdParam && currentWorkspace && (
        <WorkspaceFolderBrowser
          sectionHrefBase="/tasks"
          allWorkspaces={effectiveWorkspaces}
          workspaceChain={currentWorkspaceChain}
          childFolders={childWorkspaceCards}
          currentCounts={directWorkspaceCounts}
          activeDragItem={activeDragItem}
          isFolderDropDisabled={isFolderDropDisabled}
        />
      )}

      {workspaceIdParam && currentWorkspace && (
        <section className="rounded-xl border-t border-border/60 pt-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Contenu direct</div>
            <div className="text-xs text-muted-foreground">{directWorkspaceCounts.tasks} élément{directWorkspaceCounts.tasks > 1 ? "s" : ""}</div>
          </div>
        </section>
      )}

      {showMicroGuide && !workspaceIdParam && (
        <div>
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
                onClick={handleDismissMicroGuide}
                className="sn-text-btn shrink-0"
              >
                Compris
              </button>
            </div>
          </div>
        </div>
      )}

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

      {actionFeedback && <div className="sn-alert" role="status" aria-live="polite">{actionFeedback}</div>}

      {error && <div className="sn-alert sn-alert--error">Impossible de charger l’agenda pour le moment.</div>}

      {!loading && !error && archiveView === "active" && mainTasks.length === 0 && (
        <div className="sn-empty sn-empty--premium sn-animate-in">
          <div className="sn-empty-title">
            {hasActiveSearchOrFilters ? "Aucun résultat" : workspaceIdParam ? "Aucun élément direct dans ce dossier" : "Aucun élément d’agenda pour le moment"}
          </div>
          <div className="sn-empty-desc">
            {hasActiveSearchOrFilters
              ? activeSearchLabel
                ? `Aucun element ne correspond a "${activeSearchLabel}" avec les filtres actuels.`
                : "Aucun élément ne correspond à ta recherche ou à tes filtres actuels."
              : workspaceIdParam
                ? "Ajoute un élément ici ou ouvre un sous-dossier."
                : "Commence par ajouter un élément à l’agenda."}
          </div>
          {hasActiveSearchOrFilters ? (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => {
                  setStatusFilter("all");
                  setPriorityFilter("all");
                  setDueFilter("all");
                  setSearchInput("");
                  setDebouncedSearch("");
                  setWorkspaceFilter((workspaceIdParam ?? "all") as WorkspaceFilter);
                }}
                className="inline-flex items-center justify-center h-10 px-4 rounded-md border border-border bg-background text-sm font-medium hover:bg-accent/60"
              >
                Réinitialiser les filtres
              </button>
            </div>
          ) : (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => {
                  const params = new URLSearchParams();
                  if (workspaceIdParam) params.set("workspaceId", workspaceIdParam);
                  params.set("create", "1");
                  params.set("startDate", toLocalDateInputValue(new Date()));
                  const qs = params.toString();
                  router.push(qs ? `/tasks?${qs}` : "/tasks");
                }}
                className="inline-flex items-center justify-center h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-95 transition-opacity"
              >
                Créer une tâche
              </button>
            </div>
          )}
        </div>
      )}

      {!loading && !error && archiveView === "archived" && archivedTasks.length === 0 && (
        <div className="sn-empty">
          <div className="sn-empty-title">Aucun élément d’agenda archivé</div>
          <div className="sn-empty-desc">Archive un élément d’agenda pour le retrouver ici et le restaurer plus tard.</div>
        </div>
      )}

      {!loading && !error && archiveView === "archived" && archivedTasks.length > 0 && (
        <ul className="space-y-2">
          {archivedTasks.map((task) => {
            const status = (task.status as TaskStatus | undefined) ?? "todo";
            const workspaceName = effectiveWorkspaces.find((ws) => ws.id === task.workspaceId)?.name ?? "—";
            const hrefSuffix = workspaceIdParam ? `?workspaceId=${encodeURIComponent(workspaceIdParam)}` : "";
            const dueLabel = formatDueDate(task.dueDate ?? null);
            const startLabel = formatStartDate(task.startDate ?? null);

            const archivedLabel = (() => {
              const ts = task.archivedAt ?? task.updatedAt;
              const maybeTs = ts as { toDate?: () => Date };
              if (!maybeTs || typeof maybeTs.toDate !== "function") return null;
              const d = maybeTs.toDate();
              const pad = (n: number) => String(n).padStart(2, "0");
              return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
            })();

            return (
              <li key={task.id ?? `archived-${task.title}-${toMillisSafe(task.updatedAt)}`}>
                <div
                  className="sn-card sn-card--task sn-card--muted p-4 cursor-pointer"
                  onClick={() => {
                    if (!task.id) return;
                    router.push(`/tasks/${task.id}${hrefSuffix}`);
                  }}
                >
                  <div className="sn-card-header">
                    <div className="min-w-0">
                      <div className="sn-card-title truncate">{normalizeDisplayText(task.title)}</div>
                      <div className="sn-card-meta">
                        <span className="sn-badge">{normalizeDisplayText(workspaceName)}</span>
                        <span className="sn-badge">{statusLabel(status)}</span>
                        {startLabel && <span className="sn-badge">Début: {startLabel}</span>}
                        {dueLabel && <span className="sn-badge">Échéance: {dueLabel}</span>}
                        {task.priority && (
                          <span className="sn-badge inline-flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${priorityDotClass(task.priority)}`} aria-hidden />
                            <span>Priorité: {priorityLabel(task.priority)}</span>
                          </span>
                        )}
                        {archivedLabel && <span className="sn-badge">Archivée: {archivedLabel}</span>}
                      </div>
                    </div>

                    <div className="sn-card-actions sn-card-actions-secondary shrink-0">
                      <button
                        type="button"
                        className="sn-text-btn"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          restoreArchivedTask(task);
                        }}
                      >
                        Restaurer
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!loading && !error && archiveView === "active" && viewMode === "calendar" && (
        <div className="min-h-0 flex-1">
          <AgendaCalendar
            tasks={mainTasks}
            todos={todosForCounter}
            workspaces={effectiveWorkspaces}
            initialAnchorDate={initialCalendarAnchorDate}
            initialPreferences={calendarInitialPreferences}
            onPreferencesChange={handleAgendaCalendarPreferencesChange}
            createRequest={agendaCreateRequest}
            onCreateRequestHandled={handleAgendaCreateRequestHandled}
            onCreateEvent={handleCalendarCreate}
            onDeleteEvent={handleCalendarDelete}
            hiddenGoogleEventIds={optimisticDeletedGoogleEventIds}
            onUpdateEvent={handleCalendarUpdate}
            onSkipOccurrence={handleSkipOccurrence}
            onVisibleRangeChange={handleCalendarVisibleRangeChange}
            onOpenTask={(taskId) => {
              const qs = workspaceIdParam ? `?workspaceId=${encodeURIComponent(workspaceIdParam)}` : "";
              router.push(`/tasks/${taskId}${qs}`);
            }}
          />
        </div>
      )}

      {!loading && !error && archiveView === "active" && viewMode === "list" && mainTasks.length > 0 && (
        <ul className="space-y-2">
          {mainTasks.map((task) => {
            const status = (task.status as TaskStatus | undefined) ?? "todo";
            const workspaceName =
              effectiveWorkspaces.find((ws) => ws.id === task.workspaceId)?.name ?? "—";
            const hrefSuffix = workspaceIdParam ? `?workspaceId=${encodeURIComponent(workspaceIdParam)}` : "";
            const dueLabel = formatDueDate(task.dueDate ?? null);
            const startLabel = formatStartDate(task.startDate ?? null);
            const taskWorkspaceId =
              typeof task.workspaceId === "string" && task.workspaceId.trim() ? task.workspaceId : null;

            return (
              <li key={task.id ?? `list-${task.title}-${toMillisSafe(task.updatedAt)}`} id={task.id ? `task-${task.id}` : undefined}>
                <DraggableCard
                  dragData={{ kind: "task", id: task.id ?? "", workspaceId: taskWorkspaceId }}
                  disabled={!task.id}
                >
                  {({ dragHandle }) => (
                    <div
                      className={`sn-card sn-card--task ${task.favorite ? " sn-card--favorite" : ""} p-4 ${
                        task.id && task.id === highlightedTaskId
                          ? flashHighlightTaskId === task.id
                            ? "sn-highlight-soft"
                            : "border-primary"
                          : ""
                      }`}
                      onClick={() => {
                        if (!task.id) return;
                        router.push(`/tasks/${task.id}${hrefSuffix}`);
                      }}
                    >
                      <div className="space-y-3">
                        <div className="sn-card-header">
                          <div className="min-w-0">
                            <div className="sn-card-title truncate">{normalizeDisplayText(task.title)}</div>
                            <div className="sn-card-meta">
                              <span className="sn-badge">{normalizeDisplayText(workspaceName)}</span>
                              <span className="sn-badge">{statusLabel(status)}</span>
                              {startLabel && <span className="sn-badge">Début: {startLabel}</span>}
                              {dueLabel && <span className="sn-badge">Échéance: {dueLabel}</span>}
                              {task.priority && (
                                <span className="sn-badge inline-flex items-center gap-2">
                                  <span className={`h-2 w-2 rounded-full ${priorityDotClass(task.priority)}`} aria-hidden />
                                  <span>Priorité: {priorityLabel(task.priority)}</span>
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="sn-card-actions sn-card-actions-secondary shrink-0">
                            {dragHandle}
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
                  )}
                </DraggableCard>
              </li>
            );
          })}
        </ul>
      )}

      {!loading && !error && archiveView === "active" && AGENDA_GRID_ENABLED && viewMode === "grid" && mainTasks.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {mainTasks.map((task) => {
            const status = (task.status as TaskStatus | undefined) ?? "todo";
            const workspaceName =
              effectiveWorkspaces.find((ws) => ws.id === task.workspaceId)?.name ?? "—";
            const hrefSuffix = workspaceIdParam ? `?workspaceId=${encodeURIComponent(workspaceIdParam)}` : "";
            const dueLabel = formatDueDate(task.dueDate ?? null);
            const startLabel = formatStartDate(task.startDate ?? null);

            return (
              <div
                key={task.id ?? `grid-${task.title}-${toMillisSafe(task.updatedAt)}`}
                id={task.id ? `task-${task.id}` : undefined}
                className={`sn-card sn-card--task ${task.favorite ? " sn-card--favorite" : ""} p-4 min-w-0 ${
                  task.id && task.id === highlightedTaskId
                    ? flashHighlightTaskId === task.id
                      ? "sn-highlight-soft"
                      : "border-primary"
                    : ""
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
                        <div className="sn-card-title line-clamp-2">{normalizeDisplayText(task.title)}</div>
                        <div className="sn-card-meta">
                          <span className="sn-badge">{normalizeDisplayText(workspaceName)}</span>
                          <span className="sn-badge">{statusLabel(status)}</span>
                          {startLabel && <span className="sn-badge">Début: {startLabel}</span>}
                          {dueLabel && <span className="sn-badge">Échéance: {dueLabel}</span>}
                          {task.priority && (
                            <span className="sn-badge inline-flex items-center gap-2">
                              <span className={`h-2 w-2 rounded-full ${priorityDotClass(task.priority)}`} aria-hidden />
                              <span>Priorité: {priorityLabel(task.priority)}</span>
                            </span>
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

      {!loading && !error && archiveView === "active" && viewMode !== "calendar" && statusFilter === "all" && completedTasks.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mt-6 mb-2">Terminées</h2>
          <ul className="space-y-2">
            {completedTasks.map((task) => (
              <li
                key={task.id ?? `completed-${task.title}-${toMillisSafe(task.updatedAt)}`}
                id={task.id ? `task-${task.id}` : undefined}
                className={`sn-card sn-card--task sn-card--muted p-4 ${task.favorite ? " sn-card--favorite" : ""} ${
                  task.id && task.id === highlightedTaskId
                    ? flashHighlightTaskId === task.id
                      ? "sn-highlight-soft"
                      : "border-primary"
                    : ""
                }`}
              >
                <div className="sn-card-header">
                  <div className="min-w-0">
                    <div className="sn-card-title truncate">{normalizeDisplayText(task.title)}</div>
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
    </DndContext>
  );
}
