"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type {
  DateSelectArg,
  DatesSetArg,
  EventInput,
} from "@fullcalendar/core";
import {
  CALENDAR_PREFERENCES_STORAGE_KEY,
  priorityColor,
  toLocalDateInputValue,
} from "./agendaCalendarUtils";
import { useAgendaCalendarFilters } from "./useAgendaCalendarFilters";
import { useAgendaPlanningData } from "./useAgendaPlanningData";
import { useAgendaPlanningSelection } from "./useAgendaPlanningSelection";
import { useAgendaDraftManager } from "./useAgendaDraftManager";
import { useAgendaEventMutation } from "./useAgendaEventMutation";
import { useAgendaCalendarNavigation } from "./useAgendaCalendarNavigation";
import { useAgendaMergedEvents } from "./useAgendaMergedEvents";
import AgendaCalendarFiltersBar from "./AgendaCalendarFiltersBar";
import AgendaCalendarDraftModal from "./AgendaCalendarDraftModal";
import AgendaCalendarPlanningView from "./AgendaCalendarPlanningView";
import CreateButton from "./CreateButton";
import VoiceAgentButton from "./assistant/VoiceAgentButton";
import { projectTasksToEvents } from "@/lib/agenda/taskEventProjector";
import { getUserTimezone } from "@/lib/datetime";
import type { TaskCalendarKind, TaskDoc, WorkspaceDoc, Priority, TaskRecurrenceFreq } from "@/types/firestore";

type CalendarViewMode = "dayGridMonth" | "timeGridWeek" | "timeGridDay";
type AgendaDisplayMode = "calendar" | "planning";

const MONTH_OPTIONS = [
  { value: 0, label: "Janvier" },
  { value: 1, label: "Fevrier" },
  { value: 2, label: "Mars" },
  { value: 3, label: "Avril" },
  { value: 4, label: "Mai" },
  { value: 5, label: "Juin" },
  { value: 6, label: "Juillet" },
  { value: 7, label: "Aout" },
  { value: 8, label: "Septembre" },
  { value: 9, label: "Octobre" },
  { value: 10, label: "Novembre" },
  { value: 11, label: "Decembre" },
] as const;

export type AgendaCalendarPreferences = {
  viewMode: CalendarViewMode;
  displayMode: AgendaDisplayMode;
  showPlanningAvailability: boolean;
  planningAvailabilityTargetMinutes: number;
};

type GoogleCalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
};

type CalendarRecurrenceInput = {
  freq: TaskRecurrenceFreq;
  interval?: number;
  until?: Date | null;
  exceptions?: string[];
} | null;

interface AgendaCalendarProps {
  tasks: TaskDoc[];
  workspaces: WorkspaceDoc[];
  onCreateEvent: (input: {
    title: string;
    start: Date;
    end: Date;
    allDay: boolean;
    workspaceId?: string | null;
    priority?: Priority | null;
    calendarKind?: TaskCalendarKind | null;
    recurrence?: CalendarRecurrenceInput;
  }) => Promise<void>;
  onUpdateEvent: (input: {
    taskId: string;
    title?: string;
    start: Date;
    end: Date;
    allDay: boolean;
    workspaceId?: string | null;
    priority?: Priority | null;
    calendarKind?: TaskCalendarKind | null;
    recurrence?: CalendarRecurrenceInput;
  }) => Promise<void>;
  onSkipOccurrence?: (taskId: string, occurrenceDate: string) => Promise<void>;
  onOpenTask: (taskId: string) => void;
  onVisibleRangeChange?: (range: { start: Date; end: Date }) => void;
  initialPreferences?: Partial<AgendaCalendarPreferences> | null;
  onPreferencesChange?: (prefs: AgendaCalendarPreferences) => void;
  initialAnchorDate?: Date | null;
}

function normalizePreferences(raw: Partial<AgendaCalendarPreferences> | null | undefined): AgendaCalendarPreferences | null {
  if (!raw || typeof raw !== "object") return null;
  const mode = raw.viewMode;
  const displayMode = raw.displayMode;
  const targetMinutesRaw = raw.planningAvailabilityTargetMinutes;

  if (mode !== "dayGridMonth" && mode !== "timeGridWeek" && mode !== "timeGridDay") return null;
  if (displayMode !== "calendar" && displayMode !== "planning") return null;

  const planningAvailabilityTargetMinutes =
    typeof targetMinutesRaw === "number" && Number.isFinite(targetMinutesRaw)
      ? Math.max(15, Math.min(240, Math.round(targetMinutesRaw)))
      : 45;

  return {
    viewMode: mode,
    displayMode,
    showPlanningAvailability: raw.showPlanningAvailability !== false,
    planningAvailabilityTargetMinutes,
  };
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function startOfWeekMonday(date: Date) {
  const dayStart = startOfDay(date);
  const day = dayStart.getDay();
  const offset = (day + 6) % 7;
  dayStart.setDate(dayStart.getDate() - offset);
  return dayStart;
}

function clampDateToMonth(year: number, month: number, referenceDate: Date) {
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  const safeDay = Math.min(referenceDate.getDate(), lastDayOfMonth);
  return new Date(
    year,
    month,
    safeDay,
    referenceDate.getHours(),
    referenceDate.getMinutes(),
    referenceDate.getSeconds(),
    referenceDate.getMilliseconds(),
  );
}

function isSameDateValue(left: Date | null | undefined, right: Date | null | undefined) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.getTime() === right.getTime();
}

function isSameRangeValue(
  left: { start: Date; end: Date } | null | undefined,
  right: { start: Date; end: Date } | null | undefined,
) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return isSameDateValue(left.start, right.start) && isSameDateValue(left.end, right.end);
}

function computePlanningWindow(anchorDate: Date, mode: CalendarViewMode) {
  if (mode === "timeGridDay") {
    const start = startOfDay(anchorDate);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }

  if (mode === "timeGridWeek") {
    const start = startOfWeekMonday(anchorDate);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end };
  }

  const start = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start, end };
}

function formatPlanningLabel(windowRange: { start: Date; end: Date }, mode: CalendarViewMode) {
  if (mode === "timeGridDay") {
    return windowRange.start.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  if (mode === "timeGridWeek") {
    const endInclusive = new Date(windowRange.end.getTime() - 1);
    const startLabel = windowRange.start.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    const endLabel = endInclusive.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
    return `Semaine ${startLabel} → ${endLabel}`;
  }

  return windowRange.start.toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });
}

function formatCalendarLabel(windowRange: { start: Date; end: Date }, mode: CalendarViewMode) {
  if (mode === "timeGridDay") {
    return windowRange.start.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  if (mode === "timeGridWeek") {
    const endInclusive = new Date(windowRange.end.getTime() - 1);
    const sameYear = windowRange.start.getFullYear() === endInclusive.getFullYear();
    const sameMonth = sameYear && windowRange.start.getMonth() === endInclusive.getMonth();
    const startDay = windowRange.start.toLocaleDateString("fr-FR", { day: "numeric" });
    const endDay = endInclusive.toLocaleDateString("fr-FR", { day: "numeric" });

    if (sameMonth) {
      const monthYear = endInclusive.toLocaleDateString("fr-FR", {
        month: "long",
        year: "numeric",
      });
      return `${startDay} – ${endDay} ${monthYear}`;
    }

    if (sameYear) {
      const startMonth = windowRange.start.toLocaleDateString("fr-FR", { month: "long" });
      const endMonthYear = endInclusive.toLocaleDateString("fr-FR", {
        month: "long",
        year: "numeric",
      });
      return `${startDay} ${startMonth} – ${endDay} ${endMonthYear}`;
    }

    const startLabel = windowRange.start.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const endLabel = endInclusive.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    return `${startLabel} – ${endLabel}`;
  }

  return windowRange.start.toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });
}

export default function AgendaCalendar({
  tasks,
  workspaces,
  onCreateEvent,
  onUpdateEvent,
  onSkipOccurrence,
  onOpenTask,
  onVisibleRangeChange,
  initialPreferences,
  onPreferencesChange,
  initialAnchorDate,
}: AgendaCalendarProps) {
  const calendarRef = useRef<FullCalendar | null>(null);
  const calendarShellRef = useRef<HTMLElement | null>(null);
  const datesSetRafRef = useRef<number | null>(null);
  const [viewMode, setViewMode] = useState<CalendarViewMode>("timeGridWeek");
  const [displayMode, setDisplayMode] = useState<AgendaDisplayMode>("calendar");
  const [prefsHydrated, setPrefsHydrated] = useState(false);
  const {
    showRecurringOnly,
    setShowRecurringOnly,
    showConflictsOnly,
    setShowConflictsOnly,
    priorityFilter,
    setPriorityFilter,
    timeWindowFilter,
    setTimeWindowFilter,
    showClassicTasks,
    setShowClassicTasks,
    showChecklistItems,
    setShowChecklistItems,
    statusFilter,
    setStatusFilter,
    clearFilters,
  } = useAgendaCalendarFilters();
  const [visibleRange, setVisibleRange] = useState<{ start: Date; end: Date } | null>(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showPlanningAvailability, setShowPlanningAvailability] = useState(true);
  const [planningAvailabilityTargetMinutes, setPlanningAvailabilityTargetMinutes] = useState(45);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [googleCalendarEvents, setGoogleCalendarEvents] = useState<GoogleCalendarEvent[]>([]);
  const [planningAnchorDate, setPlanningAnchorDate] = useState<Date>(new Date());
  const [userTimezone, setUserTimezone] = useState<string>("UTC");
  const [focusPulseActive, setFocusPulseActive] = useState(false);
  const [viewTransitioning, setViewTransitioning] = useState(false);
  const initialScrollTime = useMemo(() => {
    const now = new Date();
    const hour = Math.max(6, Math.min(22, now.getHours() - 1));
    return `${String(hour).padStart(2, "0")}:00:00`;
  }, []);

  const navigationAnchorDate = useMemo(() => {
    if (displayMode === "planning") return planningAnchorDate;
    return visibleRange?.start ?? initialAnchorDate ?? new Date();
  }, [displayMode, initialAnchorDate, planningAnchorDate, visibleRange]);

  const navigationYearOptions = useMemo(() => {
    const currentYear = navigationAnchorDate.getFullYear();
    return Array.from({ length: 15 }, (_, index) => currentYear - 5 + index);
  }, [navigationAnchorDate]);

  const planningWindow = useMemo(
    () => computePlanningWindow(planningAnchorDate, viewMode),
    [planningAnchorDate, viewMode],
  );

  const effectiveVisibleRange = useMemo<{ start: Date; end: Date } | null>(
    () => (displayMode === "planning" ? planningWindow : visibleRange),
    [displayMode, planningWindow, visibleRange],
  );

  useEffect(() => {
    setUserTimezone(getUserTimezone());
  }, []);

  useEffect(() => {
    return () => {
      if (datesSetRafRef.current !== null) {
        window.cancelAnimationFrame(datesSetRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CALENDAR_PREFERENCES_STORAGE_KEY);
      if (!raw) return;
      const parsed = normalizePreferences(JSON.parse(raw) as Partial<AgendaCalendarPreferences>);
      if (!parsed) return;

      setViewMode(parsed.viewMode);
      setDisplayMode(parsed.displayMode);
      setShowPlanningAvailability(parsed.showPlanningAvailability);
      setPlanningAvailabilityTargetMinutes(parsed.planningAvailabilityTargetMinutes);
    } catch {
      // ignore invalid payload
    } finally {
      setPrefsHydrated(true);
    }
  }, []);

  useEffect(() => {
    const parsed = normalizePreferences(initialPreferences);
    if (!parsed) return;
    setViewMode(parsed.viewMode);
    setDisplayMode(parsed.displayMode);
    setShowPlanningAvailability(parsed.showPlanningAvailability);
    setPlanningAvailabilityTargetMinutes(parsed.planningAvailabilityTargetMinutes);
    setPrefsHydrated(true);
  }, [initialPreferences]);

  const normalizedPreferences = useMemo<AgendaCalendarPreferences>(
    () => ({
      viewMode,
      displayMode,
      showPlanningAvailability,
      planningAvailabilityTargetMinutes,
    }),
    [displayMode, planningAvailabilityTargetMinutes, showPlanningAvailability, viewMode],
  );

  useEffect(() => {
    if (!prefsHydrated) return;

    try {
      window.localStorage.setItem(CALENDAR_PREFERENCES_STORAGE_KEY, JSON.stringify(normalizedPreferences));
    } catch {
      // ignore write errors
    }

    onPreferencesChange?.(normalizedPreferences);
  }, [normalizedPreferences, onPreferencesChange, prefsHydrated]);

  const workspaceNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const workspace of workspaces) {
      if (!workspace.id) continue;
      map.set(workspace.id, workspace.name);
    }
    return map;
  }, [workspaces]);

  useEffect(() => {
    let cancelled = false;

    const loadGoogleCalendarStatus = async () => {
      try {
        const res = await fetch("/api/google/calendar/status", { method: "GET", cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) setCalendarConnected(false);
          return;
        }

        const data = (await res.json()) as { connected?: unknown };
        if (!cancelled) {
          setCalendarConnected(data.connected === true);
        }
      } catch {
        if (!cancelled) setCalendarConnected(false);
      }
    };

    void loadGoogleCalendarStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadGoogleCalendarEvents = useCallback(async () => {
    if (!calendarConnected || !effectiveVisibleRange) {
      setGoogleCalendarEvents([]);
      return;
    }

    try {
      const params = new URLSearchParams({
        timeMin: effectiveVisibleRange.start.toISOString(),
        timeMax: effectiveVisibleRange.end.toISOString(),
      });
      const res = await fetch(`/api/google/calendar/events?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      if (!res.ok) {
        setGoogleCalendarEvents([]);
        return;
      }

      const data = (await res.json()) as { events?: GoogleCalendarEvent[] };
      setGoogleCalendarEvents(Array.isArray(data.events) ? data.events : []);
    } catch {
      setGoogleCalendarEvents([]);
    }
  }, [calendarConnected, effectiveVisibleRange]);

  useEffect(() => {
    void loadGoogleCalendarEvents();
  }, [loadGoogleCalendarEvents]);

  useEffect(() => {
    if (!initialAnchorDate || Number.isNaN(initialAnchorDate.getTime())) return;

    setPlanningAnchorDate(initialAnchorDate);
    if (displayMode === "calendar") {
      calendarRef.current?.getApi().gotoDate(initialAnchorDate);
    }

    calendarShellRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [displayMode, initialAnchorDate]);

  useEffect(() => {
    if (!initialAnchorDate || Number.isNaN(initialAnchorDate.getTime())) return;
    if (displayMode !== "calendar") return;

    setFocusPulseActive(true);
    const timer = window.setTimeout(() => setFocusPulseActive(false), 2100);
    return () => window.clearTimeout(timer);
  }, [displayMode, initialAnchorDate]);

  const triggerViewTransition = useCallback(() => {
    setViewTransitioning(true);
    window.setTimeout(() => setViewTransitioning(false), 220);
  }, []);

  const calendarData = useMemo(() => {
    const rangeStart = effectiveVisibleRange?.start ?? new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    const rangeEnd = effectiveVisibleRange?.end ?? new Date(Date.now() + 45 * 24 * 60 * 60 * 1000);

    const projected = projectTasksToEvents({
      tasks,
      window: { start: rangeStart, end: rangeEnd },
    });
    const withDates = [...projected.events];

    withDates.sort((a, b) => a.start.getTime() - b.start.getTime());

    const conflictIds = new Set<string>();
    for (let i = 0; i < withDates.length; i += 1) {
      const left = withDates[i];
      if (!left) continue;
      for (let j = i + 1; j < withDates.length; j += 1) {
        const right = withDates[j];
        if (!right) continue;
        if (right.start.getTime() >= left.end.getTime()) break;
        conflictIds.add(left.eventId);
        conflictIds.add(right.eventId);
      }
    }

    const output: EventInput[] = [];
    for (const item of withDates) {
      const { task, start, end, allDay, recurrence, taskId, eventId, instanceDate } = item;
      const itemPriority = (task.priority ?? "") as Priority | "";
      const itemCalendarKind = (task.calendarKind ?? "task") as TaskCalendarKind;
      const itemHasConflict = conflictIds.has(eventId);
      const itemIsRecurring = Boolean(recurrence?.freq);
      const itemIsChecklist = task.sourceType === "checklist_item";
      const itemIsDone = task.completed === true || task.status === "done";
      const startHour = start.getHours();

      const matchesTimeWindow = (() => {
        if (!timeWindowFilter) return true;
        if (timeWindowFilter === "allDay") return allDay;
        if (allDay) return false;
        if (timeWindowFilter === "morning") return startHour >= 6 && startHour < 12;
        if (timeWindowFilter === "afternoon") return startHour >= 12 && startHour < 18;
        if (timeWindowFilter === "evening") return startHour >= 18 || startHour < 6;
        return true;
      })();

      if (showRecurringOnly && !itemIsRecurring) continue;
      if (showConflictsOnly && !itemHasConflict) continue;
      if (priorityFilter && itemPriority !== priorityFilter) continue;
      if (!matchesTimeWindow) continue;
      if (!showClassicTasks && !itemIsChecklist) continue;
      if (!showChecklistItems && itemIsChecklist) continue;
      if (statusFilter === "open" && itemIsDone) continue;
      if (statusFilter === "done" && !itemIsDone) continue;

      const fcStart = allDay ? toLocalDateInputValue(start) : start;
      const fcEnd = allDay ? toLocalDateInputValue(end) : end;

      output.push({
        id: eventId,
        title: task.title,
        start: fcStart,
        end: fcEnd,
        allDay,
        backgroundColor: itemCalendarKind === "birthday" ? "#db2777" : priorityColor(itemPriority),
        borderColor: itemCalendarKind === "birthday" ? "#db2777" : priorityColor(itemPriority),
        classNames: [
          "agenda-event",
          "agenda-event-local",
          `agenda-priority-${itemPriority || "none"}`,
          `agenda-kind-${itemCalendarKind}`,
        ],
        extendedProps: {
          taskId,
          workspaceId: task.workspaceId ?? "",
          workspaceName: (task.workspaceId ? workspaceNameById.get(task.workspaceId) : null) ?? "Sans dossier",
          priority: itemPriority,
          calendarKind: itemCalendarKind,
          sourceType: task.sourceType ?? null,
          sourceTodoId: task.sourceTodoId ?? null,
          sourceTodoItemId: task.sourceTodoItemId ?? null,
          recurrence,
          instanceDate,
          conflict: itemHasConflict,
        },
      });
    }
    const total = withDates.length;
    const recurring = withDates.filter((item) => Boolean(item.recurrence?.freq)).length;
    const conflicts = conflictIds.size;

    return {
      events: output,
      stats: {
        total,
        displayed: output.length,
        recurring,
        conflicts,
      },
    };
  }, [
    effectiveVisibleRange,
    priorityFilter,
    showChecklistItems,
    showClassicTasks,
    showConflictsOnly,
    showRecurringOnly,
    statusFilter,
    tasks,
    timeWindowFilter,
    workspaceNameById,
  ]);

  const { handleMoveOrResize } = useAgendaEventMutation({
    onCreateEvent,
    onUpdateEvent,
    onSkipOccurrence,
    setError,
  });

  const {
    draft,
    setDraft,
    editScope,
    setEditScope,
    saving,
    openDraftFromSelect,
    openDraftFromEvent,
    saveDraft,
    skipOccurrence,
  } = useAgendaDraftManager({
    onCreateEvent,
    onUpdateEvent,
    onSkipOccurrence,
    setError,
  });

  const {
    jump,
    handleCalendarTouchStart,
    handleCalendarTouchEnd,
  } = useAgendaCalendarNavigation({
    calendarRef,
    displayMode,
    onPlanningJump: (action) => {
      setPlanningAnchorDate((prev) => {
        if (action === "today") return new Date();
        const next = new Date(prev);
        if (viewMode === "dayGridMonth") {
          next.setMonth(next.getMonth() + (action === "next" ? 1 : -1));
          return next;
        }
        if (viewMode === "timeGridWeek") {
          next.setDate(next.getDate() + (action === "next" ? 7 : -7));
          return next;
        }
        next.setDate(next.getDate() + (action === "next" ? 1 : -1));
        return next;
      });
    },
  });

  const changeView = (next: CalendarViewMode) => {
    triggerViewTransition();
    setViewMode(next);
    if (displayMode === "calendar") {
      calendarRef.current?.getApi().changeView(next);
    }
  };

  const jumpToAnchorDate = useCallback(
    (nextDate: Date) => {
      triggerViewTransition();
      if (displayMode === "planning") {
        setPlanningAnchorDate(nextDate);
        return;
      }

      calendarRef.current?.getApi().gotoDate(nextDate);
    },
    [displayMode, triggerViewTransition],
  );

  const updateNavigationMonth = useCallback(
    (month: number) => {
      jumpToAnchorDate(clampDateToMonth(navigationAnchorDate.getFullYear(), month, navigationAnchorDate));
    },
    [jumpToAnchorDate, navigationAnchorDate],
  );

  const updateNavigationYear = useCallback(
    (year: number) => {
      jumpToAnchorDate(clampDateToMonth(year, navigationAnchorDate.getMonth(), navigationAnchorDate));
    },
    [jumpToAnchorDate, navigationAnchorDate],
  );

  const onDatesSet = (arg: DatesSetArg) => {
    const currentMode: CalendarViewMode =
      arg.view.type === "dayGridMonth" || arg.view.type === "timeGridWeek" || arg.view.type === "timeGridDay"
        ? arg.view.type
        : viewMode;
    const nextLabel = formatCalendarLabel({ start: arg.start, end: arg.end }, currentMode);
    const nextRange = { start: arg.start, end: arg.end };

    if (datesSetRafRef.current !== null) {
      window.cancelAnimationFrame(datesSetRafRef.current);
    }

    datesSetRafRef.current = window.requestAnimationFrame(() => {
      setLabel((prev) => (prev === nextLabel ? prev : nextLabel));
      setVisibleRange((prev) => (isSameRangeValue(prev, nextRange) ? prev : nextRange));
      setPlanningAnchorDate((prev) => (isSameDateValue(prev, arg.start) ? prev : arg.start));
      onVisibleRangeChange?.(nextRange);
      window.setTimeout(() => setViewTransitioning(false), 80);
      datesSetRafRef.current = null;
    });
  };

  useEffect(() => {
    if (displayMode !== "planning") return;
    const nextLabel = formatPlanningLabel(planningWindow, viewMode);
    setLabel((prev) => (prev === nextLabel ? prev : nextLabel));
  }, [displayMode, planningWindow, viewMode]);

  useEffect(() => {
    if (displayMode !== "planning") return;
    setVisibleRange((prev) => (isSameRangeValue(prev, planningWindow) ? prev : planningWindow));
    onVisibleRangeChange?.(planningWindow);
  }, [displayMode, onVisibleRangeChange, planningWindow]);

  useEffect(() => {
    if (displayMode !== "calendar") return;
    calendarRef.current?.getApi().changeView(viewMode);
  }, [displayMode, viewMode]);

  const { agendaEvents, isCompactDensity } = useAgendaMergedEvents({
    calendarData,
    googleCalendarEvents,
    visibleRange: effectiveVisibleRange,
  });
  const hasActiveAgendaFilters =
    showRecurringOnly ||
    showConflictsOnly ||
    Boolean(priorityFilter) ||
    timeWindowFilter !== "" ||
    !showClassicTasks ||
    !showChecklistItems ||
    statusFilter !== "all";

  const { planningSections, planningAvailabilityByDate } = useAgendaPlanningData({
    agendaEvents,
    planningAvailabilityTargetMinutes,
    planningWindow: displayMode === "planning" ? planningWindow : null,
  });

  const planningEventMap = useMemo(() => {
    const map = new Map<string, EventInput>();
    for (const event of calendarData.events) {
      map.set(String(event.id), event);
    }
    return map;
  }, [calendarData.events]);

  const {
    selectedPlanningIds,
    setSelectedPlanningIds,
    duplicatingPlanning,
    planningDuplicateDate,
    setPlanningDuplicateDate,
    togglePlanningSelection,
    duplicatePlanningSelectionByDays,
    duplicatePlanningSelectionToDate,
  } = useAgendaPlanningSelection({
    displayMode,
    planningEventMap,
    onCreateEvent,
    setError,
  });

  return (
    <section ref={calendarShellRef} className="space-y-3 overflow-x-hidden">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex rounded-md border border-border bg-background overflow-hidden w-fit max-w-full">
            <button type="button" className="px-3 py-1.5 text-sm hover:bg-accent/60 transition-colors" onClick={() => {
              triggerViewTransition();
              jump("prev");
            }}>←</button>
            <button type="button" className="px-3 py-1.5 text-sm border-l border-border hover:bg-accent/60 transition-colors" onClick={() => {
              triggerViewTransition();
              jump("today");
            }}>Aujourd’hui</button>
            <button type="button" className="px-3 py-1.5 text-sm border-l border-border hover:bg-accent/60 transition-colors" onClick={() => {
              triggerViewTransition();
              jump("next");
            }}>→</button>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <div className="hidden sm:flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1">
              <select
                value={navigationAnchorDate.getMonth()}
                onChange={(event) => updateNavigationMonth(Number(event.target.value))}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                aria-label="Choisir le mois de l’agenda"
              >
                {MONTH_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                value={navigationAnchorDate.getFullYear()}
                onChange={(event) => updateNavigationYear(Number(event.target.value))}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                aria-label="Choisir l’annee de l’agenda"
              >
                {navigationYearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
            <div className="inline-flex items-center rounded-md border border-border bg-background/90 shadow-sm overflow-hidden">
              {displayMode === "calendar" ? (
                <>
                  <VoiceAgentButton
                    renderCustomTrigger={({ onClick, ariaLabel, title }) => (
                      <button
                        type="button"
                        onClick={onClick}
                        aria-label={ariaLabel}
                        title={title}
                        className="h-9 w-10 text-base text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
                      >
                        🎤
                      </button>
                    )}
                  />
                  <div className="h-6 w-px bg-border" aria-hidden="true" />
                </>
              ) : null}
              <CreateButton
                renderCustomTrigger={({ onClick, ariaLabel, title }) => (
                  <button
                    type="button"
                    onClick={onClick}
                    aria-label={ariaLabel}
                    title={title}
                    className="h-9 w-10 text-lg font-semibold leading-none text-primary hover:bg-primary/10 transition-colors"
                  >
                    +
                  </button>
                )}
              />
            </div>
          </div>
        </div>

        <div className="text-sm font-semibold">{label}</div>

        <div className="sm:hidden grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-[11px] text-muted-foreground">Affichage</span>
            <select
              value={displayMode}
              onChange={(event) => {
                triggerViewTransition();
                setDisplayMode(event.target.value as AgendaDisplayMode);
              }}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              aria-label="Choisir le mode d’affichage agenda"
            >
              <option value="calendar">Agenda</option>
              <option value="planning">Liste du jour</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-muted-foreground">Période</span>
            <select
              value={viewMode}
              onChange={(event) => changeView(event.target.value as CalendarViewMode)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              aria-label="Choisir la période de l’agenda"
            >
              <option value="dayGridMonth">Mois</option>
              <option value="timeGridWeek">Semaine</option>
              <option value="timeGridDay">Jour</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-muted-foreground">Mois</span>
            <select
              value={navigationAnchorDate.getMonth()}
              onChange={(event) => updateNavigationMonth(Number(event.target.value))}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              aria-label="Choisir le mois de l’agenda"
            >
              {MONTH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-muted-foreground">Annee</span>
            <select
              value={navigationAnchorDate.getFullYear()}
              onChange={(event) => updateNavigationYear(Number(event.target.value))}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              aria-label="Choisir l’annee de l’agenda"
            >
              {navigationYearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="hidden sm:flex items-center gap-2 flex-wrap justify-end">
          <div className="inline-flex rounded-md border border-border bg-background overflow-hidden w-fit max-w-full">
          <button
            type="button"
            className={`px-3 py-1.5 text-sm transition-colors ${displayMode === "calendar" ? "bg-accent font-semibold" : "hover:bg-accent/60"}`}
            onClick={() => {
              triggerViewTransition();
              setDisplayMode("calendar");
            }}
          >
            Agenda
          </button>
          <button
            type="button"
            className={`px-3 py-1.5 text-sm border-l border-border transition-colors ${displayMode === "planning" ? "bg-accent font-semibold" : "hover:bg-accent/60"}`}
            onClick={() => {
              triggerViewTransition();
              setDisplayMode("planning");
            }}
          >
            Liste du jour (lecture)
          </button>
          </div>

          <div className="inline-flex rounded-md border border-border bg-background overflow-hidden w-fit max-w-full">
          <button
            type="button"
            className={`px-3 py-1.5 text-sm transition-colors ${viewMode === "dayGridMonth" ? "bg-accent font-semibold" : "hover:bg-accent/60"}`}
            onClick={() => changeView("dayGridMonth")}
          >
            Mois
          </button>
          <button
            type="button"
            className={`px-3 py-1.5 text-sm border-l border-border transition-colors ${viewMode === "timeGridWeek" ? "bg-accent font-semibold" : "hover:bg-accent/60"}`}
            onClick={() => changeView("timeGridWeek")}
          >
            Semaine
          </button>
          <button
            type="button"
            className={`px-3 py-1.5 text-sm border-l border-border transition-colors ${viewMode === "timeGridDay" ? "bg-accent font-semibold" : "hover:bg-accent/60"}`}
            onClick={() => changeView("timeGridDay")}
          >
            Jour
          </button>
          </div>
        </div>
      </div>

      <AgendaCalendarFiltersBar
        showRecurringOnly={showRecurringOnly}
        showConflictsOnly={showConflictsOnly}
        priorityFilter={priorityFilter}
        timeWindowFilter={timeWindowFilter}
        showClassicTasks={showClassicTasks}
        showChecklistItems={showChecklistItems}
        statusFilter={statusFilter}
        onToggleRecurringOnly={() => setShowRecurringOnly((prev) => !prev)}
        onToggleConflictsOnly={() => setShowConflictsOnly((prev) => !prev)}
        onToggleClassicTasks={() => setShowClassicTasks((prev) => !prev)}
        onToggleChecklistItems={() => setShowChecklistItems((prev) => !prev)}
        onStatusFilterChange={setStatusFilter}
        onPriorityFilterChange={setPriorityFilter}
        onTimeWindowFilterChange={setTimeWindowFilter}
        onReset={clearFilters}
      />

      {error && <div className="sn-alert sn-alert--error">{error}</div>}

      {!error && displayMode === "calendar" && agendaEvents.length === 0 && (
        <div className="sn-empty sn-empty--premium sn-animate-in">
          {hasActiveAgendaFilters ? (
            <>
              <div className="sn-empty-title">Aucun résultat avec ces filtres</div>
              <div className="sn-empty-desc">
                Essaie de réinitialiser les filtres de l’agenda pour afficher plus d’éléments.
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  className="inline-flex items-center justify-center h-10 px-4 rounded-md border border-border bg-background text-sm font-medium hover:bg-accent/60"
                  onClick={clearFilters}
                >
                  Réinitialiser les filtres
                </button>
              </div>
            </>
          ) : (
            <div className="sn-empty-title">Aucune tâche planifiée</div>
          )}
        </div>
      )}

      <div className="space-y-0">
        <div className="sn-card p-2 bg-[radial-gradient(900px_circle_at_100%_-10%,rgba(59,130,246,0.08),transparent_50%),linear-gradient(180deg,rgba(15,23,42,0.14),transparent_42%)]">
          {displayMode === "calendar" ? (
            <div
              className={`agenda-premium-calendar ${isCompactDensity ? "agenda-density-compact" : "agenda-density-comfort"} ${viewMode === "dayGridMonth" ? "agenda-view-month" : "agenda-view-timegrid"} ${viewTransitioning ? "agenda-transitioning" : ""} ${focusPulseActive ? "sn-highlight-soft" : ""}`}
              data-user-timezone={userTimezone}
              onTouchStart={handleCalendarTouchStart}
              onTouchEnd={handleCalendarTouchEnd}
            >
              <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
              initialView={viewMode}
              headerToolbar={false}
              locale="fr"
              firstDay={1}
              nowIndicator
              selectable
              selectMirror
              editable
              dayMaxEvents
              allDayMaintainDuration
              eventDisplay="block"
              eventMinHeight={24}
              eventShortHeight={22}
              slotMinTime="06:00:00"
              slotMaxTime="23:30:00"
              scrollTime={initialScrollTime}
              scrollTimeReset={false}
              events={agendaEvents}
              datesSet={onDatesSet}
              select={openDraftFromSelect}
              dateClick={(arg) =>
                openDraftFromSelect({
                  allDay: arg.allDay,
                  end: arg.allDay
                    ? new Date(arg.date.getFullYear(), arg.date.getMonth(), arg.date.getDate() + 1)
                    : new Date(arg.date.getTime() + 60 * 60 * 1000),
                  endStr: "",
                  jsEvent: arg.jsEvent,
                  start: arg.date,
                  startStr: "",
                  view: arg.view,
                } as DateSelectArg)
              }
              eventClick={openDraftFromEvent}
              eventDrop={handleMoveOrResize}
              eventResize={handleMoveOrResize}
              timeZone={userTimezone}
              />
              <p className="mt-2 px-1 text-[11px] text-muted-foreground md:hidden">
                Astuce: glissez gauche/droite pour changer de période.
              </p>
            </div>
          ) : (
            <AgendaCalendarPlanningView
              planningSections={planningSections}
              planningAvailabilityByDate={planningAvailabilityByDate}
              onSwitchToCalendar={() => {
                triggerViewTransition();
                setDisplayMode("calendar");
              }}
              showPlanningAvailability={showPlanningAvailability}
              planningAvailabilityTargetMinutes={planningAvailabilityTargetMinutes}
              onTogglePlanningAvailability={() => setShowPlanningAvailability((prev) => !prev)}
              planningDuplicateDate={planningDuplicateDate}
              onPlanningDuplicateDateChange={setPlanningDuplicateDate}
              selectedPlanningIds={selectedPlanningIds}
              onClearSelection={() => setSelectedPlanningIds([])}
              onTogglePlanningSelection={togglePlanningSelection}
              onDuplicateByDays={duplicatePlanningSelectionByDays}
              onDuplicateToDate={duplicatePlanningSelectionToDate}
              duplicatingPlanning={duplicatingPlanning}
              onPlanningAvailabilityTargetMinutesChange={setPlanningAvailabilityTargetMinutes}
              onOpenTask={onOpenTask}
            />
          )}
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        Raccourcis: N (nouvel élément), / (recherche), ←/→ (navigation).
      </div>

      <AgendaCalendarDraftModal
        draft={draft}
        setDraft={setDraft}
        editScope={editScope}
        setEditScope={setEditScope}
        workspaces={workspaces}
        onOpenTask={onOpenTask}
        onSkipOccurrence={onSkipOccurrence}
        skipOccurrence={skipOccurrence}
        saveDraft={saveDraft}
        saving={saving}
      />
    </section>
  );
}
