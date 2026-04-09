"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { arrayUnion, deleteDoc, doc, Timestamp, updateDoc, serverTimestamp } from "firebase/firestore";
import { trackEvent } from "@/lib/analytics";
import { 
  getUserTimezone, 
  normalizeAgendaWindowForFirestore, 
  normalizeDateForFirestore,
  formatTimestampToDateTimeFr,
  formatTimestampToDateFr
} from "@/lib/datetime";
import { registerFcmToken, getFcmRegistrationFailureMessage } from "@/lib/fcm";
import { 
  createTaskWithPlanGuard, 
  getPlanLimitMessage, 
  serializeTaskRecurrence, 
  serializeTimestampMillis,
  setTaskFavoriteWithPlanGuard
} from "@/lib/planGuardedMutations";
import type { Priority, TaskCalendarKind, TaskDoc, WorkspaceDoc } from "@/types/firestore";
import type { AgendaCalendarPreferences } from "../_components/AgendaCalendar";
import { canMoveWorkspaceToParent, applyWorkspaceAssignmentOverrides, applyWorkspaceParentOverrides, getWorkspaceById, getWorkspaceChain, getWorkspaceDirectChildren, countItemsByWorkspaceId, buildWorkspacePathLabelMap, getWorkspaceSelfAndDescendantIds, getWorkspaceDirectContentIds } from "@/lib/workspaces";
import { getOnboardingFlag, setOnboardingFlag } from "@/lib/onboarding";
import { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { FolderDragData } from "../_components/folderDnd";
import { normalizeDisplayText } from "@/lib/normalizeText";
import { CALENDAR_PREFERENCES_STORAGE_KEY } from "../_components/agendaCalendarUtils";

export type TaskViewMode = "list" | "grid" | "calendar";
export type TaskStatusFilter = "all" | "todo" | "doing" | "done";
export type TaskPriorityFilter = "all" | "low" | "medium" | "high";
export type DueFilter = "all" | "today" | "overdue";
export type TaskSortBy = "dueDate" | "updatedAt" | "createdAt";

const GOOGLE_SYNC_FAILED_MESSAGE = "Élément enregistré dans TaskNote, mais non synchronisé avec Google Calendar.";
const AGENDA_GRID_ENABLED = true; // FEATURE_FLAGS.agendaGridEnabled;

export function useAgendaController(params: {
  allTasks: TaskDoc[];
  calendarWindowTasks: TaskDoc[];
  workspaces: WorkspaceDoc[];
  userSettings: any;
  notesForCounter: any[];
  todosForCounter: any[];
}) {
  const { allTasks, calendarWindowTasks, workspaces, userSettings, notesForCounter, todosForCounter } = params;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isPro = userSettings?.plan === "pro";
  const highlightedTaskId = searchParams.get("taskId");
  const focusDateParam = searchParams.get("focusDate");
  const workspaceIdParam = searchParams.get("workspaceId");

  // --- Filter State ---
  const [statusFilter, setStatusFilter] = useState<TaskStatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<TaskPriorityFilter>("all");
  const [dueFilter, setDueFilter] = useState<DueFilter>("all");
  const [sortBy, setSortBy] = useState<TaskSortBy>("dueDate");
  const [workspaceFilter, setWorkspaceFilter] = useState<string>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [archiveView, setArchiveView] = useState<"active" | "archived">("active");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // --- View State ---
  const [viewMode, setViewMode] = useState<TaskViewMode>("calendar");
  const [calendarRange, setCalendarRange] = useState<{ start: Date; end: Date } | null>(null);
  const [flashHighlightTaskId, setFlashHighlightTaskId] = useState<string | null>(null);

  // --- Optimistic UI State ---
  const [optimisticAgendaTaskById, setOptimisticAgendaTaskById] = useState<Record<string, TaskDoc>>({});
  const [optimisticCreatedAgendaTasks, setOptimisticCreatedAgendaTasks] = useState<TaskDoc[]>([]);
  const [optimisticDeletedAgendaTaskIds, setOptimisticDeletedAgendaTaskIds] = useState<Record<string, true>>({});
  const [optimisticDeletedGoogleEventIds, setOptimisticDeletedGoogleEventIds] = useState<Record<string, true>>({});
  const [optimisticStatusById, setOptimisticStatusById] = useState<Record<string, "todo" | "doing" | "done">>({});
  const [optimisticWorkspaceIdByTaskId, setOptimisticWorkspaceIdByTaskId] = useState<Record<string, string | null>>({});
  const [optimisticParentIdByWorkspaceId, setOptimisticParentIdByWorkspaceId] = useState<Record<string, string | null>>({});

  // --- Notifications State ---
  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const [enablingPush, setEnablingPush] = useState(false);

  // --- Feedback ---
  const [editError, setEditError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // --- Drag & Drop State ---
  const [activeDragItem, setActiveDragItem] = useState<FolderDragData | null>(null);

  const calendarPrefsWriteTimerRef = useRef<number | null>(null);

  // --- Helpers ---
  const showActionFeedback = useCallback((message: string) => {
    setActionFeedback(message);
    window.setTimeout(() => setActionFeedback(null), 1800);
  }, []);

  const toErrorMessage = (e: unknown, fallback: string) => {
    if (e instanceof Error && e.message) return e.message;
    return fallback;
  };

  const toMillisSafe = (ts: any) => {
    if (ts && typeof ts.toMillis === "function") return ts.toMillis();
    return 0;
  };

  const normalizeSearchText = useCallback((raw: string) => {
    try {
      return normalizeDisplayText(raw).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    } catch {
      return normalizeDisplayText(raw).toLowerCase().trim();
    }
  }, []);

  const toTimestampOrNull = (date: Date | null) => date ? Timestamp.fromDate(date) : null;
  const toLocalDateInputValue = (date: Date) => {
    const y = date.getFullYear();
    const m = `${date.getMonth() + 1}`.padStart(2, "0");
    const d = `${date.getDate()}`.padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  // --- Memos & Computed Values ---
  const effectiveWorkspaces = useMemo(
    () => applyWorkspaceParentOverrides(workspaces, optimisticParentIdByWorkspaceId),
    [workspaces, optimisticParentIdByWorkspaceId]
  );

  function mergeCollections(base: TaskDoc[], optById: Record<string, TaskDoc>, optCreated: TaskDoc[], deletedIds: Record<string, true>) {
    const byId = new Map<string, TaskDoc>();
    base.forEach(t => { if (t.id && !deletedIds[t.id]) byId.set(t.id, t); });
    Object.entries(optById).forEach(([id, t]) => { if (!deletedIds[id]) byId.set(id, t); });
    optCreated.forEach(t => { if (t.id && !deletedIds[t.id]) byId.set(t.id, t); });
    return Array.from(byId.values());
  }

  const optimisticAllTasks = useMemo(
    () => mergeCollections(allTasks, optimisticAgendaTaskById, optimisticCreatedAgendaTasks, optimisticDeletedAgendaTaskIds),
    [allTasks, optimisticAgendaTaskById, optimisticCreatedAgendaTasks, optimisticDeletedAgendaTaskIds]
  );

  const effectiveAllTasks = useMemo(
    () => applyWorkspaceAssignmentOverrides(optimisticAllTasks, optimisticWorkspaceIdByTaskId),
    [optimisticAllTasks, optimisticWorkspaceIdByTaskId]
  );

  const statusForTask = useCallback((task: TaskDoc): "todo" | "doing" | "done" => {
    if (task.id && optimisticStatusById[task.id]) return optimisticStatusById[task.id];
    return (task.status as any) || "todo";
  }, [optimisticStatusById]);

  const taskSearchTextById = useMemo(() => {
    const m = new Map<string, string>();
    const workspaceLabels = buildWorkspacePathLabelMap(effectiveWorkspaces);
    effectiveAllTasks.forEach(task => {
      if (!task.id) return;
      const ws = task.workspaceId ? workspaceLabels.get(task.workspaceId) ?? "" : "";
      const status = statusForTask(task);
      const text = `${task.title}\n${task.description || ""}\n${ws}\n${status}`;
      m.set(task.id, normalizeSearchText(text));
    });
    return m;
  }, [effectiveAllTasks, effectiveWorkspaces, statusForTask, normalizeSearchText]);

  const filteredTasks = useMemo(() => {
    const now = new Date();
    const q = normalizeSearchText(debouncedSearch);
    let result = effectiveAllTasks;

    result = result.filter(t => (archiveView === "archived" ? t.archived === true : t.archived !== true));

    if (workspaceFilter !== "all") {
      const descendantIds = getWorkspaceSelfAndDescendantIds(effectiveWorkspaces, workspaceFilter);
      result = result.filter(t => descendantIds.has(t.workspaceId ?? ""));
    }

    if (priorityFilter !== "all") result = result.filter(t => t.priority === priorityFilter);
    if (statusFilter !== "all") result = result.filter(t => statusForTask(t) === statusFilter);

    if (q) result = result.filter(t => t.id && (taskSearchTextById.get(t.id) ?? "").includes(q));

    if (dueFilter !== "all") {
      result = result.filter(t => {
        if (statusForTask(t) === "done" || !t.dueDate) return false;
        const due = t.dueDate.toDate();
        if (dueFilter === "today") return due.toDateString() === now.toDateString();
        return due < now;
      });
    }

    return result;
  }, [effectiveAllTasks, archiveView, workspaceFilter, effectiveWorkspaces, priorityFilter, statusFilter, statusForTask, debouncedSearch, taskSearchTextById, dueFilter, sortBy, normalizeSearchText]);

  const activeTasks = useMemo(() => filteredTasks.filter(t => statusForTask(t) !== "done"), [filteredTasks, statusForTask]);
  const completedTasks = useMemo(() => filteredTasks.filter(t => statusForTask(t) === "done"), [filteredTasks, statusForTask]);
  const visibleTasksCount = useMemo(() => activeTasks.length + completedTasks.length, [activeTasks.length, completedTasks.length]);

  const activeNoteCount = useMemo(() => notesForCounter.filter(n => n.archived !== true).length, [notesForCounter]);
  const activeTodoCount = useMemo(() => todosForCounter.length, [todosForCounter]);

  const activeSearchLabel = useMemo(() => debouncedSearch.trim().slice(0, 60), [debouncedSearch]);

  const statusLabel = (s: "todo" | "doing" | "done") => {
    if (s === "todo") return "À faire";
    if (s === "doing") return "En cours";
    return "Terminée";
  };

  const priorityLabel = (p: Priority) => {
    if (p === "high") return "Haute";
    if (p === "medium") return "Moyenne";
    return "Basse";
  };

  const priorityDotClass = (p: Priority) => {
    if (p === "high") return "bg-red-500/80";
    if (p === "medium") return "bg-amber-500/80";
    return "bg-emerald-500/80";
  };

  const formatDueDate = (ts: any) => {
    if (!ts) return "";
    try { return formatTimestampToDateTimeFr(ts); } catch { return ""; }
  };

  const formatStartDate = (ts: any) => {
    if (!ts) return "";
    try { return formatTimestampToDateFr(ts); } catch { return ""; }
  };

  // --- Handlers ---
  const pushWorkspaceFilterToUrl = useCallback((id: string) => {
    const params = new URLSearchParams(searchParams);
    if (id === "all") params.delete("workspaceId");
    else params.set("workspaceId", id);
    router.replace(`${pathname}?${params.toString()}`);
  }, [searchParams, pathname, router]);

  const handleEnableNotifications = async () => {
    setPushStatus("Activation...");
    setEnablingPush(true);
    try {
      const res = await registerFcmToken();
      setPushStatus(res.ok ? "✓ Activé" : getFcmRegistrationFailureMessage(res.reason));
    } catch {
      setPushStatus("Erreur");
    } finally {
      setEnablingPush(false);
    }
  };

  const handleCalendarCreate = async (input: any) => {
    const user = auth.currentUser;
    if (!user) return;
    const window = normalizeAgendaWindowForFirestore(input);
    if (!window?.startDate) return;

    try {
      const res = await createTaskWithPlanGuard({
        ...input,
        startDateMs: window.startDate.toMillis(),
        dueDateMs: window.dueDate.toMillis(),
        allDay: window.allDay,
        status: "todo",
        archived: false,
      });
      showActionFeedback("Créé");
    } catch (e) {
      setEditError(getPlanLimitMessage(e) ?? "Erreur");
    }
  };

  const handleCalendarUpdate = async (taskId: string, input: any, currentTask: TaskDoc) => {
    const window = normalizeAgendaWindowForFirestore(input);
    if (!window?.startDate) return;
    setOptimisticAgendaTaskById(p => ({ ...p, [taskId]: { ...currentTask, ...input, ...window } }));
    try {
      await updateDoc(doc(db, "tasks", taskId), { ...input, ...window, updatedAt: serverTimestamp() });
    } catch {
      setOptimisticAgendaTaskById(p => { const next = { ...p }; delete next[taskId]; return next; });
    }
  };

  const handleCalendarDelete = async (taskId: string) => {
    setOptimisticDeletedAgendaTaskIds(p => ({ ...p, [taskId]: true }));
    try {
      await deleteDoc(doc(db, "tasks", taskId));
      showActionFeedback("Supprimé");
    } catch {
      setOptimisticDeletedAgendaTaskIds(p => { const next = { ...p }; delete next[taskId]; return next; });
    }
  };

  const toggleDone = async (task: TaskDoc, done: boolean) => {
    if (!task.id) return;
    const next: "todo" | "done" = done ? "done" : "todo";
    setOptimisticStatusById(p => ({ ...p, [task.id!]: next }));
    try {
      await updateDoc(doc(db, "tasks", task.id), { status: next, updatedAt: serverTimestamp() });
    } catch {
      setOptimisticStatusById(p => { const next = { ...p }; delete next[task.id!]; return next; });
    }
  };

  const toggleFavorite = async (task: TaskDoc) => {
    if (!task.id) return;
    try {
      await setTaskFavoriteWithPlanGuard(task.id, !task.favorite);
    } catch (e) {
      setEditError(getPlanLimitMessage(e) ?? "Erreur");
    }
  };

  const restoreArchivedTask = async (task: TaskDoc) => {
    if (!task.id) return;
    try {
      await updateDoc(doc(db, "tasks", task.id), { archived: false, archivedAt: null, updatedAt: serverTimestamp() });
      showActionFeedback("Restauré");
    } catch {
      setEditError("Erreur");
    }
  };

  const resetFilters = () => {
    setStatusFilter("all");
    setPriorityFilter("all");
    setDueFilter("all");
    setSortBy("dueDate");
    setSearchInput("");
    setWorkspaceFilter(workspaceIdParam ?? "all");
    pushWorkspaceFilterToUrl(workspaceIdParam ?? "all");
  };

  const handleWorkspaceFilterChange = (id: string) => {
    setWorkspaceFilter(id);
    pushWorkspaceFilterToUrl(id);
  };

  const handleFolderDragEnd = useCallback(async (event: DragEndEvent) => {
    const dragData = event.active.data.current as FolderDragData;
    const dropData = event.over?.data.current as any;
    if (!dragData || dropData?.kind !== "folder-target") return;

    if (dragData.kind === "task") {
      setOptimisticWorkspaceIdByTaskId(p => ({ ...p, [dragData.id]: dropData.workspaceId }));
      await updateDoc(doc(db, "tasks", dragData.id), { workspaceId: dropData.workspaceId, updatedAt: serverTimestamp() });
    } else if (dragData.kind === "workspace") {
      setOptimisticParentIdByWorkspaceId(p => ({ ...p, [dragData.id]: dropData.workspaceId }));
      await updateDoc(doc(db, "workspaces", dragData.id), { parentId: dropData.workspaceId, updatedAt: serverTimestamp() });
    }
  }, []);

  // --- Effects ---
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), 150);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (highlightedTaskId) {
      const target = allTasks.find(t => t.id === highlightedTaskId);
      if (target) {
        setArchiveView(target.archived ? "archived" : "active");
        setFlashHighlightTaskId(highlightedTaskId);
        setTimeout(() => setFlashHighlightTaskId(null), 2600);
      }
    }
  }, [highlightedTaskId, allTasks]);

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

  const applyViewMode = useCallback((next: TaskViewMode) => {
    setViewMode(next);
    try { window.localStorage.setItem("tasksViewMode", next); } catch {}
  }, []);

  return {
    statusFilter, setStatusFilter,
    priorityFilter, setPriorityFilter,
    dueFilter, setDueFilter,
    sortBy, setSortBy,
    workspaceFilter, setWorkspaceFilter,
    filtersOpen, setFiltersOpen,
    archiveView, setArchiveView,
    searchInput, setSearchInput,
    viewMode, setViewMode,
    calendarRange, setCalendarRange,
    flashHighlightTaskId,
    pushStatus, enablingPush,
    editError, setEditError,
    actionFeedback,
    activeDragItem, setActiveDragItem,
    effectiveWorkspaces,
    activeTasks, completedTasks,
    visibleTasksCount, activeNoteCount, activeTodoCount,
    activeSearchLabel,
    statusLabel, priorityLabel, priorityDotClass,
    formatDueDate, formatStartDate,
    handleEnableNotifications,
    handleCalendarCreate, handleCalendarUpdate, handleCalendarDelete,
    toggleDone, toggleFavorite, restoreArchivedTask,
    resetFilters,
    handleWorkspaceFilterChange,
    showMicroGuide, handleDismissMicroGuide,
    applyViewMode,
    handleFolderDragStart: (e: DragStartEvent) => setActiveDragItem(e.active.data.current as any),
    handleFolderDragCancel: () => setActiveDragItem(null),
    handleFolderDragEnd,
    pushWorkspaceFilterToUrl,
    toMillisSafe,
    isFolderDropDisabled: (targetId: string, item: FolderDragData | null) => {
      if (!item) return false;
      if (item.kind === "workspace") return !canMoveWorkspaceToParent(effectiveWorkspaces, item.id, targetId);
      return item.workspaceId === targetId;
    }
  };
}
