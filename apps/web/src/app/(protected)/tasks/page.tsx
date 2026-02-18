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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDoc, arrayUnion, collection, doc, Timestamp, updateDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useUserTasks } from "@/hooks/useUserTasks";
import { useUserNotes } from "@/hooks/useUserNotes";
import { useUserTodos } from "@/hooks/useUserTodos";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useUserWorkspaces } from "@/hooks/useUserWorkspaces";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import { registerFcmToken } from "@/lib/fcm";
import type { Priority, TaskDoc } from "@/types/firestore";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { getOnboardingFlag, setOnboardingFlag } from "@/lib/onboarding";
import { CALENDAR_PREFERENCES_STORAGE_KEY } from "../_components/agendaCalendarUtils";
import type { AgendaCalendarPreferences } from "../_components/AgendaCalendar";

const AgendaCalendar = dynamic(() => import("../_components/AgendaCalendar"), {
  loading: () => <div className="sn-empty">Chargement du calendrier…</div>,
});

type TaskStatus = "todo" | "doing" | "done";
type TaskStatusFilter = "all" | TaskStatus;
type WorkspaceFilter = "all" | string;
type TaskViewMode = "list" | "grid" | "kanban" | "calendar";
type CalendarRecurrenceInput = {
  freq: "daily" | "weekly" | "monthly";
  interval?: number;
  until?: Date | null;
  exceptions?: string[];
} | null;

type TaskPriorityFilter = "all" | NonNullable<TaskDoc["priority"]>;
type DueFilter = "all" | "today" | "overdue";
type TaskSortBy = "dueDate" | "updatedAt" | "createdAt";

function normalizeAgendaCalendarPreferences(raw: unknown): AgendaCalendarPreferences | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<AgendaCalendarPreferences>;
  if (
    candidate.viewMode !== "dayGridMonth" &&
    candidate.viewMode !== "timeGridWeek" &&
    candidate.viewMode !== "timeGridDay"
  ) {
    return null;
  }
  if (candidate.displayMode !== "calendar" && candidate.displayMode !== "planning") return null;

  const target =
    typeof candidate.planningAvailabilityTargetMinutes === "number" && Number.isFinite(candidate.planningAvailabilityTargetMinutes)
      ? Math.max(15, Math.min(240, Math.round(candidate.planningAvailabilityTargetMinutes)))
      : 45;

  return {
    viewMode: candidate.viewMode,
    displayMode: candidate.displayMode,
    showPlanningAvailability: candidate.showPlanningAvailability !== false,
    planningAvailabilityTargetMinutes: target,
  };
}

export default function TasksPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: allTasks, loading, error } = useUserTasks();
  const searchParams = useSearchParams();
  const highlightedTaskId = searchParams.get("taskId");
  const workspaceIdParam = searchParams.get("workspaceId");
  const createParam = searchParams.get("create");
  const viewParam = searchParams.get("view");
  const { data: userSettings } = useUserSettings();
  const isPro = userSettings?.plan === "pro";
  const freeLimitMessage = "Limite Free atteinte. Passe en Pro pour créer plus d’éléments d’agenda et utiliser les favoris sans limite.";

  const statusLabel = (s: TaskStatus) => {
    if (s === "todo") return "À faire";
    if (s === "doing") return "En cours";
    return "Terminée";
  };

  const formatDueDate = (ts: TaskDoc["dueDate"] | null | undefined) => {
    if (!ts) return "";
    try {
      return ts.toDate().toLocaleString();
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
    recurrence?: CalendarRecurrenceInput;
  }) => {
    const user = auth.currentUser;
    if (!user) {
      setEditError("Connecte-toi pour créer un élément d’agenda.");
      return;
    }

    await addDoc(collection(db, "tasks"), {
      userId: user.uid,
      title: input.title,
      description: "",
      status: "todo",
      startDate: Timestamp.fromDate(input.start),
      dueDate: Timestamp.fromDate(input.end),
      workspaceId: input.workspaceId ?? null,
      priority: input.priority ?? null,
      recurrence: input.recurrence
        ? {
            freq: input.recurrence.freq,
            interval: input.recurrence.interval ?? 1,
            until: input.recurrence.until ? Timestamp.fromDate(input.recurrence.until) : null,
            exceptions: input.recurrence.exceptions ?? [],
          }
        : null,
      favorite: false,
      archived: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  };

  const handleSkipOccurrence = async (taskId: string, occurrenceDate: string) => {
    const user = auth.currentUser;
    const current = allTasks.find((t) => t.id === taskId);
    if (!user || !current || current.userId !== user.uid) {
      setEditError("Impossible de modifier cet élément d’agenda.");
      return;
    }

    if (!current.recurrence?.freq) {
      setEditError("Cette occurrence ne peut pas être ignorée.");
      return;
    }

    await updateDoc(doc(db, "tasks", taskId), {
      "recurrence.exceptions": arrayUnion(occurrenceDate),
      updatedAt: serverTimestamp(),
    });

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
    recurrence?: CalendarRecurrenceInput;
  }) => {
    const user = auth.currentUser;
    const current = allTasks.find((t) => t.id === input.taskId);
    if (!user || !current || current.userId !== user.uid) {
      setEditError("Impossible de modifier cet élément d’agenda.");
      return;
    }

    await updateDoc(doc(db, "tasks", input.taskId), {
      title: input.title ?? current.title,
      startDate: Timestamp.fromDate(input.start),
      dueDate: Timestamp.fromDate(input.end),
      workspaceId: input.workspaceId ?? current.workspaceId ?? null,
      priority: input.priority ?? current.priority ?? null,
      recurrence:
        input.recurrence === undefined
          ? (current.recurrence ?? null)
          : input.recurrence
            ? {
                freq: input.recurrence.freq,
                interval: input.recurrence.interval ?? 1,
                until: input.recurrence.until ? Timestamp.fromDate(input.recurrence.until) : null,
                exceptions: input.recurrence.exceptions ?? [],
              }
            : null,
      updatedAt: serverTimestamp(),
    });
  };

  const formatStartDate = (ts: TaskDoc["startDate"] | null | undefined) => {
    if (!ts) return "";
    try {
      return ts.toDate().toLocaleDateString();
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

  const [viewMode, setViewMode] = useState<TaskViewMode>("list");
  const [calendarRange, setCalendarRange] = useState<{ start: Date; end: Date } | null>(null);
  const [flashHighlightTaskId, setFlashHighlightTaskId] = useState<string | null>(null);

  const [editError, setEditError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const [enablingPush, setEnablingPush] = useState(false);
  const [calendarPrefsLocalFallback, setCalendarPrefsLocalFallback] = useState<AgendaCalendarPreferences | null>(null);
  const calendarPrefsWriteTimerRef = useRef<number | null>(null);
  const hasAppliedViewParamRef = useRef(false);

  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [optimisticStatusById, setOptimisticStatusById] = useState<Record<string, TaskStatus>>({});
  const [kanbanMobileStatus, setKanbanMobileStatus] = useState<TaskStatus>("todo");
  const kanbanScrollRef = useRef<HTMLDivElement | null>(null);

  const calendarRangeFromTs = useMemo(
    () => (calendarRange ? Timestamp.fromDate(calendarRange.start) : undefined),
    [calendarRange],
  );
  const calendarRangeToTs = useMemo(
    () => (calendarRange ? Timestamp.fromDate(calendarRange.end) : undefined),
    [calendarRange],
  );

  const { data: calendarWindowTasks } = useUserTasks({
    enabled: viewMode === "calendar",
    workspaceId: workspaceFilter !== "all" ? workspaceFilter : undefined,
    dueDateFrom: calendarRangeFromTs,
    dueDateTo: calendarRangeToTs,
  });

  const tasks = viewMode === "calendar" ? calendarWindowTasks : allTasks;

  const suppressNextKanbanClickRef = useRef(false);

  const toErrorMessage = (e: unknown, fallback: string) => {
    if (e instanceof Error && e.message) return e.message;
    return fallback;
  };

  const toMillisSafe = (ts: unknown) => {
    const maybeTs = ts as { toMillis?: () => number };
    if (maybeTs && typeof maybeTs.toMillis === "function") {
      return maybeTs.toMillis();
    }
    return 0;
  };

  const normalizeText = (raw: string) => {
    try {
      return raw
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
    } catch {
      return raw.toLowerCase().trim();
    }
  };

  const workspaceNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const ws of workspaces) {
      if (ws.id) m.set(ws.id, ws.name);
    }
    return m;
  }, [workspaces]);

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
      if (raw === "list" || raw === "grid" || raw === "kanban" || raw === "calendar") {
        setViewMode(raw as TaskViewMode);
      }
    } catch {
      // ignore
    }
  }, []);

  const applyViewMode = useCallback((next: TaskViewMode) => {
    setViewMode(next);
    try {
      window.localStorage.setItem("tasksViewMode", next);
    } catch {
      // ignore localStorage errors
    }
  }, []);

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
      applyViewMode(viewParam);
      hasAppliedViewParamRef.current = true;
      return;
    }
    hasAppliedViewParamRef.current = true;
  }, [applyViewMode, viewParam]);

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

  const filteredTasks = useMemo(() => {
    const now = new Date();
    const q = normalizeText(debouncedSearch);

    let result = tasks;

    result = result.filter((t) => (archiveView === "archived" ? t.archived === true : t.archived !== true));

    if (workspaceFilter !== "all") {
      result = result.filter((task) => task.workspaceId === workspaceFilter);
    }

    if (priorityFilter !== "all") {
      result = result.filter((task) => task.priority === priorityFilter);
    }

    if (q) {
      result = result.filter((task) => {
        const workspaceName = task.workspaceId ? workspaceNameById.get(task.workspaceId) ?? "" : "";
        const text = normalizeText(`${task.title}\n${task.description ?? ""}\n${workspaceName}`);
        return text.includes(q);
      });
    }

    if (dueFilter !== "all") {
      result = result.filter((task) => {
        const status = ((task.status as TaskStatus | undefined) ?? "todo") as TaskStatus;
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
        const status = ((task.status as TaskStatus | undefined) ?? "todo") as TaskStatus;
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
  }, [tasks, archiveView, workspaceFilter, priorityFilter, debouncedSearch, dueFilter, statusFilter, sortBy, workspaceNameById]);

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

  const statusForTask = useCallback(
    (task: TaskDoc): TaskStatus => {
      const optimistic = task.id ? optimisticStatusById[task.id] : undefined;
      if (optimistic !== undefined) return optimistic;
      return (((task.status as TaskStatus | undefined) ?? "todo") as TaskStatus) || "todo";
    },
    [optimisticStatusById],
  );

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
    return (
      q.length > 0 ||
      statusFilter !== "all" ||
      priorityFilter !== "all" ||
      dueFilter !== "all" ||
      workspaceFilter !== "all"
    );
  }, [debouncedSearch, dueFilter, priorityFilter, statusFilter, workspaceFilter]);

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

  const activeArchiveCount = useMemo(() => {
    let result = allTasks.filter((t) => t.archived !== true);
    if (workspaceFilter !== "all") {
      result = result.filter((task) => task.workspaceId === workspaceFilter);
    }
    return result.length;
  }, [allTasks, workspaceFilter]);

  const archivedArchiveCount = useMemo(() => {
    let result = allTasks.filter((t) => t.archived === true);
    if (workspaceFilter !== "all") {
      result = result.filter((task) => task.workspaceId === workspaceFilter);
    }
    return result.length;
  }, [allTasks, workspaceFilter]);

  const hrefSuffix = workspaceIdParam ? `?workspaceId=${encodeURIComponent(workspaceIdParam)}` : "";

  const workspaceTabsSwipeHandlers = useSwipeNavigation<HTMLDivElement>({
    onSwipeRight: () => {
      router.push(`/notes${hrefSuffix}`);
    },
    onSwipeLeft: () => {
      router.push(`/todo${hrefSuffix}`);
    },
    ignoreInteractiveTargets: true,
    disabled: !!draggingTaskId || !workspaceIdParam,
  });

  const archiveTabsSwipeHandlers = useSwipeNavigation<HTMLDivElement>({
    onSwipeLeft: () => setArchiveView("archived"),
    onSwipeRight: () => setArchiveView("active"),
    disabled: !!draggingTaskId,
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

  const groupedTasks = useMemo(() => {
    const groups: Record<TaskStatus, TaskDoc[]> = {
      todo: [],
      doing: [],
      done: [],
    };

    for (const task of filteredTasks) {
      const status = statusForTask(task);
      groups[status].push(task);
    }

    return groups;
  }, [filteredTasks, statusForTask]);

  const visibleKanbanStatuses = useMemo<TaskStatus[]>(
    () =>
      statusFilter === "all"
        ? (["todo", "doing", "done"] as TaskStatus[])
        : ([statusFilter] as TaskStatus[]),
    [statusFilter],
  );

  const kanbanSwipeHandlers = useSwipeNavigation<HTMLDivElement>({
    onSwipeLeft: () => {
      setKanbanMobileStatus((prev) => {
        const index = visibleKanbanStatuses.indexOf(prev);
        if (index < 0 || index >= visibleKanbanStatuses.length - 1) return prev;
        return visibleKanbanStatuses[index + 1] ?? prev;
      });
    },
    onSwipeRight: () => {
      setKanbanMobileStatus((prev) => {
        const index = visibleKanbanStatuses.indexOf(prev);
        if (index <= 0) return prev;
        return visibleKanbanStatuses[index - 1] ?? prev;
      });
    },
    disabled: viewMode !== "kanban" || archiveView !== "active" || statusFilter !== "all" || !!draggingTaskId,
  });

  useEffect(() => {
    if (statusFilter !== "all") {
      setKanbanMobileStatus(statusFilter as TaskStatus);
      return;
    }

    if (!visibleKanbanStatuses.includes(kanbanMobileStatus)) {
      setKanbanMobileStatus(visibleKanbanStatuses[0] ?? "todo");
    }
  }, [kanbanMobileStatus, statusFilter, visibleKanbanStatuses]);

  useEffect(() => {
    if (viewMode !== "kanban") return;
    if (archiveView !== "active") return;
    if (statusFilter !== "all") return;

    const container = kanbanScrollRef.current;
    if (!container) return;
    const lane = container.querySelector<HTMLElement>(`[data-kanban-status="${kanbanMobileStatus}"]`);
    if (!lane) return;

    lane.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [archiveView, kanbanMobileStatus, statusFilter, viewMode]);

  const handleKanbanDrop = async (taskId: string, targetStatus: TaskStatus) => {
    const user = auth.currentUser;
    if (!user) {
      setEditError("Connecte-toi pour modifier ton agenda.");
      return;
    }

    const task = allTasks.find((t) => t.id === taskId);
    if (!task || task.userId !== user.uid) {
      setEditError("Impossible de modifier cet élément d’agenda.");
      return;
    }

    const source = statusForTask(task);
    if (source === targetStatus) return;

    setOptimisticStatusById((prev) => ({ ...prev, [taskId]: targetStatus }));
    setEditError(null);

    try {
      await updateDoc(doc(db, "tasks", taskId), {
        status: targetStatus,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error("Error moving task (kanban)", e);
      setOptimisticStatusById((prev) => {
        if (!prev[taskId]) return prev;
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
      setEditError(toErrorMessage(e, "Erreur lors du déplacement de l’élément d’agenda."));
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
      setEditError(toErrorMessage(e, "Erreur lors de la mise à jour des favoris."));
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
    <div className="space-y-4" {...workspaceTabsSwipeHandlers}>
      {workspaceIdParam && tabs}
      <header className="flex flex-col gap-2 mb-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Agenda</h1>
          <div id="sn-create-slot" data-task-view-mode={viewMode} />
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <div
            className="inline-flex rounded-md border border-border bg-background overflow-hidden whitespace-nowrap w-fit"
            {...archiveTabsSwipeHandlers}
          >
            <button
              type="button"
              onClick={() => setArchiveView("active")}
              className={`px-3 py-1 text-sm ${archiveView === "active" ? "bg-accent" : ""}`}
            >
              Actives ({activeArchiveCount})
            </button>
            <button
              type="button"
              onClick={() => setArchiveView("archived")}
              className={`px-3 py-1 text-sm ${archiveView === "archived" ? "bg-accent" : ""}`}
            >
              Archivées ({archivedArchiveCount})
            </button>
          </div>

          <div className="inline-flex rounded-md border border-border bg-background overflow-hidden whitespace-nowrap w-fit">
            <button
              type="button"
              onClick={() => applyViewMode("list")}
              className={`px-3 py-1 text-sm ${viewMode === "list" ? "bg-accent" : ""}`}
            >
              Liste
            </button>
            <button
              type="button"
              onClick={() => applyViewMode("grid")}
              className={`px-3 py-1 text-sm border-l border-border ${viewMode === "grid" ? "bg-accent" : ""}`}
            >
              Grille
            </button>
            <button
              type="button"
              onClick={() => applyViewMode("kanban")}
              className={`px-3 py-1 text-sm border-l border-border ${viewMode === "kanban" ? "bg-accent" : ""}`}
            >
              Kanban
            </button>
            <button
              type="button"
              onClick={() => applyViewMode("calendar")}
              className={`px-3 py-1 text-sm border-l border-border ${viewMode === "calendar" ? "bg-accent" : ""}`}
            >
              Calendrier
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="relative flex-1 min-w-0">
            <input
              id="tasks-search-input"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Rechercher (titre, contenu, dossier)…"
              className="w-full border border-input rounded-md px-3 py-2 pr-10 bg-background text-sm"
              aria-label="Rechercher dans l’agenda"
            />
            {searchInput.trim().length > 0 && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 sn-icon-btn"
                aria-label="Effacer la recherche"
                title="Effacer"
              >
                ×
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className="inline-flex items-center justify-center h-10 px-3 rounded-md border border-border bg-background hover:bg-accent text-sm"
          >
            Filtrer
          </button>
        </div>

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
                    {workspaces.map((ws) => (
                      <option key={ws.id ?? ws.name} value={ws.id ?? ""} disabled={!ws.id}>
                        {ws.name}
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

      {showMicroGuide && (
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
                onClick={() => userId && setOnboardingFlag(userId, "tasks_microguide_v1", true)}
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
        <div className="sn-empty">
          <div className="sn-empty-title">{hasActiveSearchOrFilters ? "Aucun résultat" : "Aucun élément d’agenda pour le moment"}</div>
          <div className="sn-empty-desc">
            {hasActiveSearchOrFilters ? "Essaie d’effacer la recherche ou de réinitialiser les filtres." : "Commence par ajouter un élément à l’agenda."}
          </div>
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
            const workspaceName = workspaces.find((ws) => ws.id === task.workspaceId)?.name ?? "—";
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
              <li key={task.id}>
                <div
                  className="sn-card sn-card--task sn-card--muted p-4 cursor-pointer"
                  onClick={() => {
                    if (!task.id) return;
                    router.push(`/tasks/${task.id}${hrefSuffix}`);
                  }}
                >
                  <div className="sn-card-header">
                    <div className="min-w-0">
                      <div className="sn-card-title truncate">{task.title}</div>
                      <div className="sn-card-meta">
                        <span className="sn-badge">{workspaceName}</span>
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
        <AgendaCalendar
          tasks={mainTasks}
          workspaces={workspaces}
          initialPreferences={calendarInitialPreferences}
          onPreferencesChange={handleAgendaCalendarPreferencesChange}
          onCreateEvent={handleCalendarCreate}
          onUpdateEvent={handleCalendarUpdate}
          onSkipOccurrence={handleSkipOccurrence}
          onVisibleRangeChange={(range) => {
            const bufferedStart = new Date(range.start.getTime() - 7 * 24 * 60 * 60 * 1000);
            const bufferedEnd = new Date(range.end.getTime() + 7 * 24 * 60 * 60 * 1000);
            setCalendarRange({ start: bufferedStart, end: bufferedEnd });
          }}
          onOpenTask={(taskId) => {
            const qs = workspaceIdParam ? `?workspaceId=${encodeURIComponent(workspaceIdParam)}` : "";
            router.push(`/tasks/${taskId}${qs}`);
          }}
        />
      )}

      {!loading && !error && archiveView === "active" && viewMode === "list" && mainTasks.length > 0 && (
        <ul className="space-y-2">
          {mainTasks.map((task) => {
            const status = (task.status as TaskStatus | undefined) ?? "todo";
            const workspaceName =
              workspaces.find((ws) => ws.id === task.workspaceId)?.name ?? "—";
            const hrefSuffix = workspaceIdParam ? `?workspaceId=${encodeURIComponent(workspaceIdParam)}` : "";
            const dueLabel = formatDueDate(task.dueDate ?? null);
            const startLabel = formatStartDate(task.startDate ?? null);

            return (
              <li key={task.id} id={task.id ? `task-${task.id}` : undefined}>
                <div
                  className={`sn-card sn-card--task ${task.favorite ? " sn-card--favorite" : ""} p-4 ${
                    task.id && task.id === highlightedTaskId
                      ? flashHighlightTaskId === task.id
                        ? "border-primary ring-2 ring-primary/40"
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
                        <div className="sn-card-title truncate">{task.title}</div>
                        <div className="sn-card-meta">
                          <span className="sn-badge">{workspaceName}</span>
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

      {!loading && !error && archiveView === "active" && viewMode === "grid" && mainTasks.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {mainTasks.map((task) => {
            const status = (task.status as TaskStatus | undefined) ?? "todo";
            const workspaceName =
              workspaces.find((ws) => ws.id === task.workspaceId)?.name ?? "—";
            const hrefSuffix = workspaceIdParam ? `?workspaceId=${encodeURIComponent(workspaceIdParam)}` : "";
            const dueLabel = formatDueDate(task.dueDate ?? null);
            const startLabel = formatStartDate(task.startDate ?? null);

            return (
              <div
                key={task.id}
                id={task.id ? `task-${task.id}` : undefined}
                className={`sn-card sn-card--task ${task.favorite ? " sn-card--favorite" : ""} p-4 min-w-0 ${
                  task.id && task.id === highlightedTaskId
                    ? flashHighlightTaskId === task.id
                      ? "border-primary ring-2 ring-primary/40"
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
                        <div className="sn-card-title line-clamp-2">{task.title}</div>
                        <div className="sn-card-meta">
                          <span className="sn-badge">{workspaceName}</span>
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

      {!loading && !error && archiveView === "active" && viewMode === "kanban" && (
        <>
          {statusFilter === "all" && (
            <div className="md:hidden">
              <div className="inline-flex rounded-md border border-border bg-background overflow-hidden">
                {visibleKanbanStatuses.map((colStatus) => (
                  <button
                    key={`kanban-tab-${colStatus}`}
                    type="button"
                    onClick={() => setKanbanMobileStatus(colStatus)}
                    className={`px-3 py-1 text-sm ${kanbanMobileStatus === colStatus ? "bg-accent font-semibold" : ""}`}
                  >
                    {statusLabel(colStatus)} ({groupedTasks[colStatus].length})
                  </button>
                ))}
              </div>
            </div>
          )}

          <section
            ref={kanbanScrollRef}
            className="flex gap-3 overflow-x-auto overscroll-x-contain snap-x snap-mandatory pb-1 md:grid md:gap-4 md:grid-cols-3 md:overflow-visible"
            {...kanbanSwipeHandlers}
          >
            {visibleKanbanStatuses.map((colStatus) => (
              <div
                key={colStatus}
                data-kanban-status={colStatus}
                className={`sn-card sn-card--task p-3 min-h-[240px] min-w-[90vw] max-w-[90vw] sm:min-w-[82vw] sm:max-w-[82vw] md:min-w-0 md:max-w-none shrink-0 snap-center overflow-hidden transition-colors ${
                  dragOverStatus === colStatus ? "ring-2 ring-primary/40 bg-accent/30" : ""
                } ${statusFilter === "all" && kanbanMobileStatus !== colStatus ? "max-md:opacity-80" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOverStatus !== colStatus) setDragOverStatus(colStatus);
                }}
                onDragLeave={() => {
                  setDragOverStatus((prev) => (prev === colStatus ? null : prev));
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain");
                  if (!id) return;
                  await handleKanbanDrop(id, colStatus);
                  setDraggingTaskId(null);
                  setDragOverStatus(null);
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-semibold">{statusLabel(colStatus)}</h2>
                  <span className="text-xs text-muted-foreground">{groupedTasks[colStatus].length}</span>
                </div>

                <div className="space-y-2 min-w-0">
                  {groupedTasks[colStatus].map((task) => {
                    const dueLabel = formatDueDate(task.dueDate ?? null);
                    const startLabel = formatStartDate(task.startDate ?? null);
                    const priorityText = task.priority ? priorityLabel(task.priority) : "";

                    const openTaskModal = () => {
                      if (!task.id) return;
                      if (suppressNextKanbanClickRef.current) {
                        suppressNextKanbanClickRef.current = false;
                        return;
                      }
                      const qs = workspaceIdParam ? `?workspaceId=${encodeURIComponent(workspaceIdParam)}` : "";
                      router.push(`/tasks/${task.id}${qs}`);
                    };

                    return (
                      <div
                        key={task.id}
                        id={task.id ? `task-${task.id}` : undefined}
                        draggable={!!task.id}
                        onDragStart={(e) => {
                          if (!task.id) return;
                          e.dataTransfer.setData("text/plain", task.id);
                          e.dataTransfer.effectAllowed = "move";
                          setDraggingTaskId(task.id);
                          suppressNextKanbanClickRef.current = true;
                        }}
                        onDragEnd={() => {
                          setDraggingTaskId(null);
                          setDragOverStatus(null);
                          window.setTimeout(() => {
                            suppressNextKanbanClickRef.current = false;
                          }, 0);
                        }}
                        className={`border border-border rounded-md bg-background p-2 min-w-0 overflow-hidden cursor-move transition-shadow ${
                          draggingTaskId === task.id
                            ? "opacity-60 ring-2 ring-primary/40"
                            : task.id && task.id === highlightedTaskId
                              ? flashHighlightTaskId === task.id
                                ? "border-primary ring-2 ring-primary/40"
                                : "border-primary"
                              : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onClick={openTaskModal}
                            draggable={!!task.id}
                            className="min-w-0 flex-1 text-left bg-transparent p-0 border-0 cursor-move"
                            aria-label={`Ouvrir l’élément d’agenda : ${task.title}`}
                          >
                            <div className="text-sm font-medium truncate">{task.title}</div>
                            {(startLabel || dueLabel || task.priority) && (
                              <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                                {startLabel && (
                                  <span className="inline-flex items-center gap-1">
                                    <span aria-hidden>🟢</span>
                                    <span>{startLabel}</span>
                                  </span>
                                )}
                                {dueLabel && (
                                  <span className="inline-flex items-center gap-1">
                                    <span aria-hidden>📅</span>
                                    <span>{dueLabel}</span>
                                  </span>
                                )}
                                {task.priority && (
                                  <span className="inline-flex items-center gap-1">
                                    <span className={`h-2 w-2 rounded-full ${priorityDotClass(task.priority)}`} aria-hidden />
                                    <span>{priorityText}</span>
                                  </span>
                                )}
                              </div>
                            )}
                          </button>
                          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                            <select
                              className="md:hidden text-xs border border-input rounded px-2 py-1 bg-background"
                              value={statusForTask(task)}
                              disabled={!task.id}
                              aria-label="Déplacer l’élément d’agenda"
                              onChange={async (e) => {
                                if (!task.id) return;
                                await handleKanbanDrop(task.id, e.target.value as TaskStatus);
                              }}
                            >
                              <option value="todo">À faire</option>
                              <option value="doing">En cours</option>
                              <option value="done">Terminée</option>
                            </select>
                            <label className="text-xs flex items-center gap-1">
                              <input
                                type="checkbox"
                                checked={statusForTask(task) === "done"}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => toggleDone(task, e.target.checked)}
                              />
                              Terminé
                            </label>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFavorite(task);
                              }}
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
                    <div className="text-sm text-muted-foreground">Glisse un élément d’agenda ici</div>
                  )}
                </div>
              </div>
            ))}
          </section>
        </>
      )}

      {!loading && !error && archiveView === "active" && viewMode !== "kanban" && viewMode !== "calendar" && statusFilter === "all" && completedTasks.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mt-6 mb-2">Terminées</h2>
          <ul className="space-y-2">
            {completedTasks.map((task) => (
              <li
                key={task.id}
                id={task.id ? `task-${task.id}` : undefined}
                className={`sn-card sn-card--task sn-card--muted p-4 ${task.favorite ? " sn-card--favorite" : ""} ${
                  task.id && task.id === highlightedTaskId
                    ? flashHighlightTaskId === task.id
                      ? "border-primary ring-2 ring-primary/40"
                      : "border-primary"
                    : ""
                }`}
              >
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
