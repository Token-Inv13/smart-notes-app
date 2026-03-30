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
import { useAgendaDraftManager } from "./useAgendaDraftManager";
import { useAgendaEventMutation } from "./useAgendaEventMutation";
import { useAgendaCalendarNavigation } from "./useAgendaCalendarNavigation";
import { useAgendaMergedEvents } from "./useAgendaMergedEvents";
import AgendaCalendarFiltersBar from "./AgendaCalendarFiltersBar";
import AgendaCalendarDraftModal from "./AgendaCalendarDraftModal";
import { projectTasksToEvents } from "@/lib/agenda/taskEventProjector";
import { projectTodosToAgendaEvents } from "@/lib/agenda/todoEventProjector";
import { getUserTimezone } from "@/lib/datetime";
import type { TaskCalendarKind, TaskDoc, WorkspaceDoc, Priority, TaskRecurrenceFreq, TodoDoc } from "@/types/firestore";

type CalendarViewMode = "dayGridMonth" | "timeGridWeek" | "timeGridDay";
type AgendaDisplayMode = "calendar";

const MONTH_OPTIONS = [
  { value: 1, label: "Janvier" },
  { value: 2, label: "Fevrier" },
  { value: 3, label: "Mars" },
  { value: 4, label: "Avril" },
  { value: 5, label: "Mai" },
  { value: 6, label: "Juin" },
  { value: 7, label: "Juillet" },
  { value: 8, label: "Aout" },
  { value: 9, label: "Septembre" },
  { value: 10, label: "Octobre" },
  { value: 11, label: "Novembre" },
  { value: 12, label: "Decembre" },
] as const;

export type AgendaCalendarPreferences = {
  viewMode: CalendarViewMode;
  displayMode: AgendaDisplayMode;
};

type GoogleCalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
};

type GoogleCalendarFetchState = "idle" | "loading" | "success" | "error";

type CalendarRecurrenceInput = {
  freq: TaskRecurrenceFreq;
  interval?: number;
  until?: Date | null;
  exceptions?: string[];
} | null;

interface AgendaCalendarProps {
  tasks: TaskDoc[];
  todos: TodoDoc[];
  workspaces: WorkspaceDoc[];
  onCreateEvent: (input: {
    title: string;
    start: Date;
    end: Date;
    allDay: boolean;
    workspaceId?: string | null;
    priority?: Priority | null;
    favorite?: boolean;
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
  createRequest?: {
    requestKey: string;
    startDate?: string | null;
    workspaceId?: string | null;
    favorite?: boolean;
  } | null;
  onCreateRequestHandled?: () => void;
}

function normalizePreferences(raw: Partial<AgendaCalendarPreferences> | null | undefined): AgendaCalendarPreferences | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<AgendaCalendarPreferences> & { displayMode?: unknown };
  const mode = candidate.viewMode;
  const displayMode = candidate.displayMode;

  if (mode !== "dayGridMonth" && mode !== "timeGridWeek" && mode !== "timeGridDay") return null;
  if (displayMode !== "calendar" && displayMode !== "planning") return null;

  return {
    viewMode: mode,
    displayMode: "calendar",
  };
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function normalizeCalendarAnchorDate(date: Date) {
  return startOfDay(date);
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
  todos,
  workspaces,
  onCreateEvent,
  onUpdateEvent,
  onSkipOccurrence,
  onOpenTask,
  onVisibleRangeChange,
  initialPreferences,
  onPreferencesChange,
  initialAnchorDate,
  createRequest,
  onCreateRequestHandled,
}: AgendaCalendarProps) {
  const calendarRef = useRef<FullCalendar | null>(null);
  const datesSetRafRef = useRef<number | null>(null);
  const handledCreateRequestRef = useRef<string | null>(null);
  const [viewMode, setViewMode] = useState<CalendarViewMode>("timeGridWeek");
  const displayMode: AgendaDisplayMode = "calendar";
  const [prefsHydrated, setPrefsHydrated] = useState(false);
  const {
    priorityFilter,
    setPriorityFilter,
    timeWindowFilter,
    setTimeWindowFilter,
    clearFilters,
  } = useAgendaCalendarFilters();
  const [visibleRange, setVisibleRange] = useState<{ start: Date; end: Date } | null>(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [googleCalendarEvents, setGoogleCalendarEvents] = useState<GoogleCalendarEvent[]>([]);
  const [googleCalendarFetchState, setGoogleCalendarFetchState] = useState<GoogleCalendarFetchState>("idle");
  const [calendarAnchorDate, setCalendarAnchorDate] = useState<Date>(initialAnchorDate ?? new Date());
  const [userTimezone, setUserTimezone] = useState<string>("UTC");
  const [focusPulseActive, setFocusPulseActive] = useState(false);
  const [viewTransitioning, setViewTransitioning] = useState(false);
  const initialScrollTime = useMemo(() => {
    const now = new Date();
    const hour = Math.max(6, Math.min(22, now.getHours() - 1));
    return `${String(hour).padStart(2, "0")}:00:00`;
  }, []);

  const navigationAnchorDate = calendarAnchorDate;

  const navigationYearOptions = useMemo(() => {
    const currentYear = navigationAnchorDate.getFullYear();
    return Array.from({ length: 15 }, (_, index) => currentYear - 5 + index);
  }, [navigationAnchorDate]);

  const effectiveVisibleRange = visibleRange;

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
    setPrefsHydrated(true);
  }, [initialPreferences]);

  const normalizedPreferences = useMemo<AgendaCalendarPreferences>(
    () => ({
      viewMode,
      displayMode,
    }),
    [displayMode, viewMode],
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
      setGoogleCalendarFetchState("idle");
      return;
    }

    try {
      setGoogleCalendarFetchState("loading");
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
        setGoogleCalendarFetchState("error");
        return;
      }

      const data = (await res.json()) as { events?: GoogleCalendarEvent[] };
      setGoogleCalendarEvents(Array.isArray(data.events) ? data.events : []);
      setGoogleCalendarFetchState("success");
    } catch {
      setGoogleCalendarEvents([]);
      setGoogleCalendarFetchState("error");
    }
  }, [calendarConnected, effectiveVisibleRange]);

  useEffect(() => {
    void loadGoogleCalendarEvents();
  }, [loadGoogleCalendarEvents]);

  useEffect(() => {
    if (!initialAnchorDate || Number.isNaN(initialAnchorDate.getTime())) return;

    setCalendarAnchorDate(initialAnchorDate);
    calendarRef.current?.getApi().gotoDate(initialAnchorDate);
  }, [initialAnchorDate]);

  useEffect(() => {
    if (!initialAnchorDate || Number.isNaN(initialAnchorDate.getTime())) return;

    setFocusPulseActive(true);
    const timer = window.setTimeout(() => setFocusPulseActive(false), 2100);
    return () => window.clearTimeout(timer);
  }, [initialAnchorDate]);

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
    const projectedTodos = projectTodosToAgendaEvents({
      todos,
      window: { start: rangeStart, end: rangeEnd },
    });
    const todoProjected = projectedTodos.map((item) => ({
      eventId: item.eventId,
      taskId: item.eventId,
      task: {
        title: item.todo.title,
        workspaceId: item.todo.workspaceId ?? null,
        priority: item.todo.priority ?? null,
        calendarKind: "task",
        sourceType: null,
        sourceTodoId: item.todoId,
        sourceTodoItemId: null,
      } as TaskDoc,
      start: item.start,
      end: item.end,
      allDay: item.allDay,
      recurrence: null,
      instanceDate: undefined,
      todoEvent: true as const,
    }));
    const withDates = [...projected.events, ...todoProjected];

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
      const isTodoEvent = "todoEvent" in item && item.todoEvent === true;
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

      if (priorityFilter && itemPriority !== priorityFilter) continue;
      if (!matchesTimeWindow) continue;

      const fcStart = allDay ? toLocalDateInputValue(start) : start;
      const fcEnd = allDay ? toLocalDateInputValue(end) : end;

      output.push({
        id: eventId,
        title: task.title,
        start: fcStart,
        end: fcEnd,
        allDay,
        editable: isTodoEvent ? false : undefined,
        backgroundColor: itemCalendarKind === "birthday" ? "#db2777" : priorityColor(itemPriority),
        borderColor: itemCalendarKind === "birthday" ? "#db2777" : priorityColor(itemPriority),
        classNames: [
          "agenda-event",
          "agenda-event-local",
          `agenda-priority-${itemPriority || "none"}`,
          `agenda-kind-${itemCalendarKind}`,
          ...(isTodoEvent ? ["agenda-kind-todo"] : []),
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
          todoEvent: isTodoEvent,
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
    tasks,
    timeWindowFilter,
    workspaceNameById,
    todos,
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
    openQuickDraft,
    skipOccurrence,
  } = useAgendaDraftManager({
    onCreateEvent,
    onUpdateEvent,
    onSkipOccurrence,
    setError,
  });

  const handleEventClick = useCallback(
    (arg: import("@fullcalendar/core").EventClickArg) => {
      if (arg.event.extendedProps.todoEvent === true) return;
      openDraftFromEvent(arg);
    },
    [openDraftFromEvent],
  );

  useEffect(() => {
    if (!createRequest) {
      handledCreateRequestRef.current = null;
      return;
    }
    if (handledCreateRequestRef.current === createRequest.requestKey) return;
    handledCreateRequestRef.current = createRequest.requestKey;
    openQuickDraft({
      startDate: createRequest.startDate ?? null,
      workspaceId: createRequest.workspaceId ?? null,
      favorite: createRequest.favorite === true,
    });
    onCreateRequestHandled?.();
  }, [createRequest, onCreateRequestHandled, openQuickDraft]);

  const {
    jump,
    handleCalendarTouchStart,
    handleCalendarTouchEnd,
  } = useAgendaCalendarNavigation({
    calendarRef,
    displayMode,
  });

  const changeView = (next: CalendarViewMode) => {
    triggerViewTransition();
    setViewMode(next);
    calendarRef.current?.getApi().changeView(next);
  };

  const jumpToAnchorDate = useCallback(
    (nextDate: Date) => {
      triggerViewTransition();
      setCalendarAnchorDate(nextDate);
      calendarRef.current?.getApi().gotoDate(nextDate);
    },
    [triggerViewTransition],
  );

  const updateNavigationMonth = useCallback(
    (month: number) => {
      // months are 0-based internally (JS Date convention)
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
    const currentRange = {
      start: arg.view.currentStart,
      end: arg.view.currentEnd,
    };
    const nextLabel = formatCalendarLabel(currentRange, currentMode);
    const nextRange = { start: arg.start, end: arg.end };
    // FullCalendar week/day views can start in the previous month. Keep the navigation
    // anchor aligned with the calendar's current date so the month/year selects reflect
    // the month the user actually navigated to.
    const nextCalendarAnchor = normalizeCalendarAnchorDate(arg.view.calendar.getDate());

    if (datesSetRafRef.current !== null) {
      window.cancelAnimationFrame(datesSetRafRef.current);
    }

    datesSetRafRef.current = window.requestAnimationFrame(() => {
      setLabel((prev) => (prev === nextLabel ? prev : nextLabel));
      setVisibleRange((prev) => (isSameRangeValue(prev, nextRange) ? prev : nextRange));
      setCalendarAnchorDate((prev) => (isSameDateValue(prev, nextCalendarAnchor) ? prev : nextCalendarAnchor));
      onVisibleRangeChange?.(nextRange);
      window.setTimeout(() => setViewTransitioning(false), 80);
      datesSetRafRef.current = null;
    });
  };

  useEffect(() => {
    calendarRef.current?.getApi().changeView(viewMode);
  }, [viewMode]);

  const { agendaEvents, isCompactDensity } = useAgendaMergedEvents({
    calendarData,
    googleCalendarEvents,
    showGoogleCalendar: true,
    visibleRange: effectiveVisibleRange,
  });
  const hasActiveAgendaFilters =
    Boolean(priorityFilter) ||
    timeWindowFilter !== "";

  const showNoGoogleEventsMessage =
    calendarConnected &&
    effectiveVisibleRange !== null &&
    googleCalendarFetchState === "success" &&
    googleCalendarEvents.length === 0;

  return (
    <section className="space-y-3 overflow-x-hidden">
      <div className="rounded-xl border border-border bg-card/60 p-2.5 sm:p-3">
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="inline-flex rounded-xl border border-input bg-background overflow-hidden w-fit max-w-full">
              <button
                type="button"
                className="px-3 py-2 text-sm hover:bg-accent/60 transition-colors"
                onClick={() => {
                  triggerViewTransition();
                  jump("prev");
                }}
              >
                ←
              </button>
              <button
                type="button"
                className="px-3 py-2 text-sm border-l border-input hover:bg-accent/60 transition-colors"
                onClick={() => {
                  triggerViewTransition();
                  jump("today");
                }}
              >
                Aujourd’hui
              </button>
              <button
                type="button"
                className="px-3 py-2 text-sm border-l border-input hover:bg-accent/60 transition-colors"
                onClick={() => {
                  triggerViewTransition();
                  jump("next");
                }}
              >
                →
              </button>
            </div>

            <div className="hidden min-w-0 text-sm font-semibold sm:block">{label}</div>
          </div>

          <div className="text-sm font-semibold sm:hidden">{label}</div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,11rem)_minmax(0,10rem)_minmax(0,7rem)_minmax(0,1fr)] md:items-end">
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Période</span>
              <select
                value={viewMode}
                onChange={(event) => changeView(event.target.value as CalendarViewMode)}
                className="h-9 w-full rounded-xl border border-input bg-background px-3 text-sm"
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
                value={navigationAnchorDate.getMonth() + 1}
                onChange={(event) => updateNavigationMonth(Number(event.target.value) - 1)}
                className="h-9 w-full rounded-xl border border-input bg-background px-3 text-sm"
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
              <span className="text-[11px] text-muted-foreground">Année</span>
              <select
                value={navigationAnchorDate.getFullYear()}
                onChange={(event) => updateNavigationYear(Number(event.target.value))}
                className="h-9 w-full rounded-xl border border-input bg-background px-3 text-sm"
                aria-label="Choisir l’année de l’agenda"
              >
                {navigationYearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
            <div className="space-y-1">
              <span className="block text-[11px] text-muted-foreground md:invisible">Filtres</span>
              <AgendaCalendarFiltersBar
                priorityFilter={priorityFilter}
                timeWindowFilter={timeWindowFilter}
                onPriorityFilterChange={setPriorityFilter}
                onTimeWindowFilterChange={setTimeWindowFilter}
                onReset={clearFilters}
              />
            </div>
          </div>
        </div>
      </div>

      {error && <div className="sn-alert sn-alert--error">{error}</div>}

      {!error && showNoGoogleEventsMessage ? (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Google Calendar est connecté, mais aucun événement n’existe sur la plage affichée.
        </div>
      ) : null}

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
              eventClick={handleEventClick}
            />
            <p className="mt-2 px-1 text-[11px] text-muted-foreground md:hidden">
              Astuce: glissez gauche/droite pour changer de période.
            </p>
          </div>
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
