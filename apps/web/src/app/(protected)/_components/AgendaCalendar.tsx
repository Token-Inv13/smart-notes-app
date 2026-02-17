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
  addRecurrenceStep,
  CALENDAR_PREFERENCES_STORAGE_KEY,
  overlapsRange,
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
import { renderAgendaCalendarEventContent } from "./AgendaCalendarEventContent";
import AgendaCalendarFiltersBar from "./AgendaCalendarFiltersBar";
import AgendaCalendarDraftModal from "./AgendaCalendarDraftModal";
import AgendaCalendarPlanningView from "./AgendaCalendarPlanningView";
import CreateButton from "./CreateButton";
import VoiceAgentButton from "./assistant/VoiceAgentButton";
import type { TaskDoc, WorkspaceDoc, Priority, TaskRecurrenceFreq } from "@/types/firestore";

type CalendarViewMode = "dayGridMonth" | "timeGridWeek" | "timeGridDay";
type AgendaDisplayMode = "calendar" | "planning";

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
    recurrence?: CalendarRecurrenceInput;
  }) => Promise<void>;
  onSkipOccurrence?: (taskId: string, occurrenceDate: string) => Promise<void>;
  onOpenTask: (taskId: string) => void;
  onVisibleRangeChange?: (range: { start: Date; end: Date }) => void;
  initialPreferences?: Partial<AgendaCalendarPreferences> | null;
  onPreferencesChange?: (prefs: AgendaCalendarPreferences) => void;
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
}: AgendaCalendarProps) {
  const calendarRef = useRef<FullCalendar | null>(null);
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

  const planningWindow = useMemo(
    () => computePlanningWindow(planningAnchorDate, viewMode),
    [planningAnchorDate, viewMode],
  );

  const effectiveVisibleRange = useMemo<{ start: Date; end: Date } | null>(
    () => (displayMode === "planning" ? planningWindow : visibleRange),
    [displayMode, planningWindow, visibleRange],
  );

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

  const calendarData = useMemo(() => {
    const rangeStart = effectiveVisibleRange?.start ?? new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    const rangeEnd = effectiveVisibleRange?.end ?? new Date(Date.now() + 45 * 24 * 60 * 60 * 1000);

    const withDates = [] as Array<{
      eventId: string;
      taskId: string;
      task: TaskDoc;
      start: Date;
      end: Date;
      recurrence: TaskDoc["recurrence"] | null;
      instanceDate?: string;
    }>;

    for (const task of tasks) {
      if (!task.id) continue;
      const start = task.startDate?.toDate?.() ?? task.dueDate?.toDate?.();
      if (!start) continue;

      const due = task.dueDate?.toDate?.();
      const fallbackEnd = new Date(start.getTime() + 60 * 60 * 1000);
      const end = due && due.getTime() > start.getTime() ? due : fallbackEnd;

      const recurrence = task.recurrence ?? null;
      if (!recurrence?.freq) {
        if (overlapsRange(start, end, rangeStart, rangeEnd)) {
          withDates.push({
            eventId: task.id,
            taskId: task.id,
            task,
            start,
            end,
            recurrence: null,
          });
        }
        continue;
      }

      const interval = Math.max(1, Number(recurrence.interval ?? 1));
      const until = recurrence.until?.toDate?.() ?? null;
      const exceptions = new Set(Array.isArray(recurrence.exceptions) ? recurrence.exceptions : []);

      let cursorStart = new Date(start);
      let cursorEnd = new Date(end);
      for (let i = 0; i < 400; i += 1) {
        if (until && cursorStart.getTime() > until.getTime()) break;
        if (cursorStart.getTime() > rangeEnd.getTime()) break;

        const instanceDate = toLocalDateInputValue(cursorStart);
        if (!exceptions.has(instanceDate) && overlapsRange(cursorStart, cursorEnd, rangeStart, rangeEnd)) {
          withDates.push({
            eventId: `${task.id}__${cursorStart.toISOString()}`,
            taskId: task.id,
            task,
            start: new Date(cursorStart),
            end: new Date(cursorEnd),
            recurrence,
            instanceDate,
          });
        }

        cursorStart = addRecurrenceStep(cursorStart, recurrence.freq, interval);
        cursorEnd = addRecurrenceStep(cursorEnd, recurrence.freq, interval);
      }
    }

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
      const { task, start, end, recurrence, taskId, eventId, instanceDate } = item;
      const itemPriority = (task.priority ?? "") as Priority | "";
      const itemHasConflict = conflictIds.has(eventId);
      const itemIsRecurring = Boolean(recurrence?.freq);
      const looksAllDay =
        start.getHours() === 0 &&
        start.getMinutes() === 0 &&
        end.getHours() === 0 &&
        end.getMinutes() === 0;
      const startHour = start.getHours();

      const matchesTimeWindow = (() => {
        if (!timeWindowFilter) return true;
        if (timeWindowFilter === "allDay") return looksAllDay;
        if (looksAllDay) return false;
        if (timeWindowFilter === "morning") return startHour >= 6 && startHour < 12;
        if (timeWindowFilter === "afternoon") return startHour >= 12 && startHour < 18;
        if (timeWindowFilter === "evening") return startHour >= 18 || startHour < 6;
        return true;
      })();

      if (showRecurringOnly && !itemIsRecurring) continue;
      if (showConflictsOnly && !itemHasConflict) continue;
      if (priorityFilter && itemPriority !== priorityFilter) continue;
      if (!matchesTimeWindow) continue;

      output.push({
        id: eventId,
        title: task.title,
        start,
        end,
        allDay: looksAllDay,
        backgroundColor: priorityColor(itemPriority),
        borderColor: priorityColor(itemPriority),
        classNames: ["agenda-event", "agenda-event-local", `agenda-priority-${itemPriority || "none"}`],
        extendedProps: {
          taskId,
          workspaceId: task.workspaceId ?? "",
          workspaceName: (task.workspaceId ? workspaceNameById.get(task.workspaceId) : null) ?? "Sans dossier",
          priority: itemPriority,
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
  }, [effectiveVisibleRange, priorityFilter, showConflictsOnly, showRecurringOnly, tasks, timeWindowFilter, workspaceNameById]);

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

  const {
    jump,
    handleCalendarTouchStart,
    handleCalendarTouchEnd,
  } = useAgendaCalendarNavigation({
    calendarRef,
    displayMode,
    openQuickDraft,
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
    setViewMode(next);
    if (displayMode === "calendar") {
      calendarRef.current?.getApi().changeView(next);
    }
  };

  const onDatesSet = (arg: DatesSetArg) => {
    setLabel(arg.view.title);
    setVisibleRange({ start: arg.start, end: arg.end });
    setPlanningAnchorDate(arg.start);
    onVisibleRangeChange?.({ start: arg.start, end: arg.end });
  };

  useEffect(() => {
    if (displayMode !== "planning") return;
    setLabel(formatPlanningLabel(planningWindow, viewMode));
  }, [displayMode, planningWindow, viewMode]);

  useEffect(() => {
    if (displayMode !== "planning") return;
    setVisibleRange(planningWindow);
    onVisibleRangeChange?.(planningWindow);
  }, [displayMode, onVisibleRangeChange, planningWindow]);

  useEffect(() => {
    if (displayMode !== "calendar") return;
    calendarRef.current?.getApi().changeView(viewMode);
  }, [displayMode, viewMode]);

  const { agendaEvents, agendaConflictCount, isCompactDensity } = useAgendaMergedEvents({
    calendarData,
    googleCalendarEvents,
  });

  const eventContent = useCallback(
    (arg: Parameters<typeof renderAgendaCalendarEventContent>[0]) =>
      renderAgendaCalendarEventContent(arg, isCompactDensity),
    [isCompactDensity],
  );

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
    <section className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-md border border-border bg-background overflow-hidden w-fit">
          <button type="button" className="px-3 py-1.5 text-sm" onClick={() => jump("today")}>Aujourd’hui</button>
          <button type="button" className="px-3 py-1.5 text-sm border-l border-border" onClick={() => jump("prev")}>←</button>
          <button type="button" className="px-3 py-1.5 text-sm border-l border-border" onClick={() => jump("next")}>→</button>
        </div>

        <div className="text-sm font-semibold">{label}</div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {displayMode === "calendar" ? (
            <div className="inline-flex items-center rounded-md border border-border bg-background/90 shadow-sm overflow-hidden">
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
          ) : null}

          <div className="inline-flex rounded-md border border-border bg-background overflow-hidden w-fit">
          <button
            type="button"
            className={`px-3 py-1.5 text-sm ${displayMode === "calendar" ? "bg-accent font-semibold" : ""}`}
            onClick={() => setDisplayMode("calendar")}
          >
            Calendrier
          </button>
          <button
            type="button"
            className={`px-3 py-1.5 text-sm border-l border-border ${displayMode === "planning" ? "bg-accent font-semibold" : ""}`}
            onClick={() => setDisplayMode("planning")}
          >
            Planning
          </button>
          </div>

          <div className="inline-flex rounded-md border border-border bg-background overflow-hidden w-fit">
          <button
            type="button"
            className={`px-3 py-1.5 text-sm ${viewMode === "dayGridMonth" ? "bg-accent font-semibold" : ""}`}
            onClick={() => changeView("dayGridMonth")}
          >
            Mois
          </button>
          <button
            type="button"
            className={`px-3 py-1.5 text-sm border-l border-border ${viewMode === "timeGridWeek" ? "bg-accent font-semibold" : ""}`}
            onClick={() => changeView("timeGridWeek")}
          >
            Semaine
          </button>
          <button
            type="button"
            className={`px-3 py-1.5 text-sm border-l border-border ${viewMode === "timeGridDay" ? "bg-accent font-semibold" : ""}`}
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
        onToggleRecurringOnly={() => setShowRecurringOnly((prev) => !prev)}
        onToggleConflictsOnly={() => setShowConflictsOnly((prev) => !prev)}
        onPriorityFilterChange={setPriorityFilter}
        onTimeWindowFilterChange={setTimeWindowFilter}
        onReset={clearFilters}
      />

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="sn-badge">Affichés: {agendaEvents.length}</span>
        <span className="sn-badge">Conflits: {agendaConflictCount}</span>
        <span className="sn-badge hidden sm:inline-flex">Total local: {calendarData.stats.total}</span>
        <span className="sn-badge hidden sm:inline-flex">Google: {googleCalendarEvents.length}</span>
        <span className="sn-badge hidden sm:inline-flex">Récurrents: {calendarData.stats.recurring}</span>
        {isCompactDensity && (
          <span className="sn-badge">Auto compact (conflits élevés)</span>
        )}
      </div>

      {error && <div className="sn-alert sn-alert--error">{error}</div>}

      <div className="space-y-0">
        <div className="sn-card p-2 bg-[radial-gradient(900px_circle_at_100%_-10%,rgba(59,130,246,0.08),transparent_50%),linear-gradient(180deg,rgba(15,23,42,0.14),transparent_42%)]">
          {displayMode === "calendar" ? (
            <div
              className={`agenda-premium-calendar ${isCompactDensity ? "agenda-density-compact" : "agenda-density-comfort"} ${viewMode === "dayGridMonth" ? "agenda-view-month" : "agenda-view-timegrid"}`}
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
              eventContent={eventContent}
              timeZone="Europe/Paris"
              />
              <p className="mt-2 px-1 text-[11px] text-muted-foreground md:hidden">
                Astuce: glissez gauche/droite pour changer de période.
              </p>
            </div>
          ) : (
            <AgendaCalendarPlanningView
              planningSections={planningSections}
              planningAvailabilityByDate={planningAvailabilityByDate}
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
