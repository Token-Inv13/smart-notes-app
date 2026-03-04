"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { DateSelectArg, DatesSetArg, EventInput } from "@fullcalendar/core";
import type { DateClickArg } from "@fullcalendar/interaction";
import {
  CALENDAR_PREFERENCES_STORAGE_KEY,
  toLocalDateInputValue,
  toLocalInputValue,
} from "./agendaCalendarUtils";
import { useAgendaCalendarFilters } from "./useAgendaCalendarFilters";
import { useAgendaPlanningData } from "./useAgendaPlanningData";
import { useAgendaPlanningSelection } from "./useAgendaPlanningSelection";
import { useAgendaDraftManager } from "./useAgendaDraftManager";
import { useAgendaEventMutation } from "./useAgendaEventMutation";
import { useAgendaCalendarNavigation } from "./useAgendaCalendarNavigation";
import { useAgendaMergedEvents } from "./useAgendaMergedEvents";
import { getFolderColor } from "./agendaColors";
import { renderAgendaCalendarEventContent } from "./AgendaCalendarEventContent";
import AgendaCalendarFiltersBar from "./AgendaCalendarFiltersBar";
import AgendaCalendarDraftModal from "./AgendaCalendarDraftModal";
import AgendaCalendarPlanningView from "./AgendaCalendarPlanningView";
import CreateButton from "./CreateButton";
import VoiceAgentButton from "./assistant/VoiceAgentButton";
import { projectTasksToEvents } from "@/lib/agenda/taskEventProjector";
import { getUserTimezone } from "@/lib/datetime";
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

type QuickAddDraft = {
  title: string;
  start: Date;
  end: Date;
  anchorX: number;
  anchorY: number;
};

type EventHoverPreview = {
  eventId: string;
  title: string;
  timeLabel: string;
  workspaceLabel: string;
  sourceLabel: "LOCAL" | "Google";
  left: number;
  top: number;
};

const QUICK_ADD_DEFAULT_DURATION_MS = 60 * 60 * 1000;
const DOUBLE_CLICK_DELAY_MS = 240;

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
    return `Semaine ${startLabel} â†’ ${endLabel}`;
  }

  return windowRange.start.toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function buildScrollTimeForNow(reference: Date) {
  const hourOffset = reference.getHours() - 2;
  if (hourOffset <= 0) return "00:00:00";
  if (hourOffset >= 23) return "23:00:00";
  return `${pad2(hourOffset)}:${pad2(reference.getMinutes())}:00`;
}

function toTimeInputValue(date: Date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function mergeDateWithTime(baseDate: Date, timeValue: string) {
  const [hoursRaw, minutesRaw] = timeValue.split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

  const merged = new Date(baseDate);
  merged.setHours(clamp(Math.floor(hours), 0, 23), clamp(Math.floor(minutes), 0, 59), 0, 0);
  return merged;
}

function formatEventPreviewTime(start: Date | null, end: Date | null, allDay: boolean) {
  if (allDay) return "Journee complete";
  if (!(start instanceof Date)) return "Horaire";

  const formatClock = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const startLabel = formatClock.format(start);
  if (!(end instanceof Date) || end.getTime() <= start.getTime()) return startLabel;
  return `${startLabel}-${formatClock.format(end)}`;
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
  const optionsPanelRef = useRef<HTMLDivElement | null>(null);
  const optionsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const quickAddPanelRef = useRef<HTMLDivElement | null>(null);
  const quickAddTitleRef = useRef<HTMLInputElement | null>(null);
  const timeGridDateClickTimerRef = useRef<number | null>(null);
  const lastTimeGridDateClickRef = useRef<{ timestamp: number; dateMs: number; viewType: string } | null>(null);
  const dragHoverCellRef = useRef<HTMLElement | null>(null);
  const dragMoveRafRef = useRef<number | null>(null);
  const autoScrollPendingRef = useRef(true);
  const autoScrollTimeRef = useRef<string>(buildScrollTimeForNow(new Date()));
  const initialScrollTime = useMemo(() => buildScrollTimeForNow(new Date()), []);
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
  const [userTimezone, setUserTimezone] = useState<string>("UTC");
  const [focusPulseActive, setFocusPulseActive] = useState(false);
  const [viewTransitioning, setViewTransitioning] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [quickAddDraft, setQuickAddDraft] = useState<QuickAddDraft | null>(null);
  const [quickAddError, setQuickAddError] = useState<string | null>(null);
  const [eventHoverPreview, setEventHoverPreview] = useState<EventHoverPreview | null>(null);
  const [eventDragging, setEventDragging] = useState(false);

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
      const itemHasConflict = conflictIds.has(eventId);
      const itemIsRecurring = Boolean(recurrence?.freq);
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

      const fcStart = allDay ? toLocalDateInputValue(start) : start;
      const fcEnd = allDay ? toLocalDateInputValue(end) : end;
      const workspaceName = (task.workspaceId ? workspaceNameById.get(task.workspaceId) : null) ?? "Sans dossier";
      const folderColor = getFolderColor(task.workspaceId ?? "", workspaceName);

      output.push({
        id: eventId,
        title: task.title,
        start: fcStart,
        end: fcEnd,
        allDay,
        backgroundColor: folderColor.backgroundColor,
        borderColor: folderColor.borderColor,
        textColor: folderColor.textColor,
        classNames: ["agenda-event", "agenda-event-local", `agenda-priority-${itemPriority || "none"}`],
        extendedProps: {
          taskId,
          workspaceId: task.workspaceId ?? "",
          workspaceName,
          priority: itemPriority,
          recurrence,
          instanceDate,
          conflict: itemHasConflict,
          source: "local",
          textTone: folderColor.textTone,
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
    onBeforeJump: () => {
      if (displayMode !== "calendar") return;
      autoScrollPendingRef.current = true;
      autoScrollTimeRef.current = buildScrollTimeForNow(new Date());
    },
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

  const closeQuickAdd = useCallback(() => {
    setQuickAddDraft(null);
    setQuickAddError(null);
    calendarRef.current?.getApi().unselect();
    if (timeGridDateClickTimerRef.current !== null) {
      window.clearTimeout(timeGridDateClickTimerRef.current);
      timeGridDateClickTimerRef.current = null;
    }
    lastTimeGridDateClickRef.current = null;
  }, []);

  const openQuickAddFromRange = useCallback(
    (start: Date, end: Date, jsEvent?: MouseEvent | null) => {
      const shellRect = calendarShellRef.current?.getBoundingClientRect();
      const fallbackX = shellRect ? shellRect.width - 28 : 420;
      const fallbackY = shellRect ? 180 : 180;
      const anchorX = jsEvent && shellRect ? clamp(jsEvent.clientX - shellRect.left, 18, shellRect.width - 18) : fallbackX;
      const anchorY = jsEvent && shellRect ? clamp(jsEvent.clientY - shellRect.top, 18, shellRect.height - 18) : fallbackY;

      const normalizedEnd = end.getTime() > start.getTime() ? end : new Date(start.getTime() + QUICK_ADD_DEFAULT_DURATION_MS);
      setQuickAddError(null);
      setQuickAddDraft({
        title: "",
        start: new Date(start),
        end: new Date(normalizedEnd),
        anchorX,
        anchorY,
      });
    },
    [],
  );

  const openFullDraftFromQuickAdd = useCallback(() => {
    if (!quickAddDraft) return;
    setEditScope("series");
    setDraft({
      title: quickAddDraft.title,
      startLocal: toLocalInputValue(quickAddDraft.start),
      endLocal: toLocalInputValue(quickAddDraft.end),
      allDay: false,
      workspaceId: "",
      priority: "",
      recurrenceFreq: "",
      recurrenceUntil: "",
    });
    closeQuickAdd();
  }, [closeQuickAdd, quickAddDraft, setDraft, setEditScope]);

  const submitQuickAdd = useCallback(async () => {
    if (!quickAddDraft) return;
    const title = quickAddDraft.title.trim();
    if (!title) {
      setQuickAddError("Le titre est obligatoire.");
      return;
    }
    if (quickAddDraft.end.getTime() <= quickAddDraft.start.getTime()) {
      setQuickAddError("La fin doit etre apres le debut.");
      return;
    }

    try {
      setError(null);
      await onCreateEvent({
        title,
        start: quickAddDraft.start,
        end: quickAddDraft.end,
        allDay: false,
        workspaceId: null,
        priority: null,
        recurrence: null,
      });
      closeQuickAdd();
    } catch {
      setQuickAddError("Impossible de creer cet element rapidement.");
    }
  }, [closeQuickAdd, onCreateEvent, quickAddDraft, setError]);

  const handleCalendarSelect = useCallback(
    (arg: DateSelectArg) => {
      if (timeGridDateClickTimerRef.current !== null) {
        window.clearTimeout(timeGridDateClickTimerRef.current);
        timeGridDateClickTimerRef.current = null;
      }
      lastTimeGridDateClickRef.current = null;
      const isTimeGridSelection = arg.view.type === "timeGridWeek" || arg.view.type === "timeGridDay";
      if (!arg.allDay && isTimeGridSelection) {
        openQuickAddFromRange(arg.start, arg.end, arg.jsEvent as MouseEvent | null);
        return;
      }
      openDraftFromSelect(arg);
    },
    [openDraftFromSelect, openQuickAddFromRange],
  );

  const handleCalendarDateClick = useCallback(
    (arg: DateClickArg) => {
      const isTimeGridSelection = arg.view.type === "timeGridWeek" || arg.view.type === "timeGridDay";
      if (!arg.allDay && isTimeGridSelection) {
        const mouseEvent = arg.jsEvent as MouseEvent | null;
        const now = Date.now();
        const dateMs = arg.date.getTime();
        const clickDetail = typeof mouseEvent?.detail === "number" ? mouseEvent.detail : 1;
        const lastClick = lastTimeGridDateClickRef.current;
        const sameSlotAsPrevious =
          lastClick &&
          lastClick.dateMs === dateMs &&
          lastClick.viewType === arg.view.type &&
          now - lastClick.timestamp <= DOUBLE_CLICK_DELAY_MS;

        if (timeGridDateClickTimerRef.current !== null) {
          window.clearTimeout(timeGridDateClickTimerRef.current);
          timeGridDateClickTimerRef.current = null;
        }

        if (clickDetail >= 2 || sameSlotAsPrevious) {
          lastTimeGridDateClickRef.current = null;
          openQuickAddFromRange(arg.date, new Date(arg.date.getTime() + QUICK_ADD_DEFAULT_DURATION_MS), mouseEvent);
          return;
        }

        lastTimeGridDateClickRef.current = {
          timestamp: now,
          dateMs,
          viewType: arg.view.type,
        };
        timeGridDateClickTimerRef.current = window.setTimeout(() => {
          openQuickAddFromRange(arg.date, new Date(arg.date.getTime() + QUICK_ADD_DEFAULT_DURATION_MS), mouseEvent);
          timeGridDateClickTimerRef.current = null;
          lastTimeGridDateClickRef.current = null;
        }, DOUBLE_CLICK_DELAY_MS);
        return;
      }

      openDraftFromSelect({
        allDay: arg.allDay,
        end: arg.allDay
          ? new Date(arg.date.getFullYear(), arg.date.getMonth(), arg.date.getDate() + 1)
          : new Date(arg.date.getTime() + QUICK_ADD_DEFAULT_DURATION_MS),
        endStr: "",
        jsEvent: arg.jsEvent,
        start: arg.date,
        startStr: "",
        view: arg.view,
      } as DateSelectArg);
    },
    [openDraftFromSelect, openQuickAddFromRange],
  );

  const changeView = (next: CalendarViewMode) => {
    triggerViewTransition();
    setViewMode(next);
    if (displayMode === "calendar" && next !== "dayGridMonth") {
      autoScrollPendingRef.current = true;
      autoScrollTimeRef.current = buildScrollTimeForNow(new Date());
    }
    if (displayMode === "calendar") {
      calendarRef.current?.getApi().changeView(next);
    }
  };

  const clearDragHoverCell = useCallback(() => {
    dragHoverCellRef.current?.classList.remove("agenda-drop-hover-cell", "agenda-drop-hover-col");
    dragHoverCellRef.current = null;
  }, []);

  const onDatesSet = (arg: DatesSetArg) => {
    setLabel(arg.view.title);
    setVisibleRange({ start: arg.start, end: arg.end });
    setPlanningAnchorDate(arg.start);
    onVisibleRangeChange?.({ start: arg.start, end: arg.end });

    const isTimeGridView = arg.view.type === "timeGridWeek" || arg.view.type === "timeGridDay";
    if (isTimeGridView && autoScrollPendingRef.current) {
      const scrollTarget = autoScrollTimeRef.current || buildScrollTimeForNow(new Date());
      window.requestAnimationFrame(() => {
        const api = calendarRef.current?.getApi();
        if (!api) return;
        api.scrollToTime(scrollTarget);
      });
      autoScrollPendingRef.current = false;
    }
    window.setTimeout(() => setViewTransitioning(false), 80);
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

  useEffect(() => {
    autoScrollPendingRef.current = true;
    autoScrollTimeRef.current = buildScrollTimeForNow(new Date());
  }, []);

  useEffect(() => {
    if (!quickAddDraft) return;
    window.requestAnimationFrame(() => quickAddTitleRef.current?.focus());
  }, [quickAddDraft]);

  useEffect(() => {
    if (!quickAddDraft) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && quickAddPanelRef.current?.contains(target)) return;
      closeQuickAdd();
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [closeQuickAdd, quickAddDraft]);

  useEffect(() => {
    if (!optionsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && optionsPanelRef.current?.contains(target)) return;
      if (target && optionsTriggerRef.current?.contains(target)) return;
      setOptionsOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [optionsOpen]);

  useEffect(() => {
    if (!eventDragging) return;

    const onPointerMove = (event: PointerEvent) => {
      if (dragMoveRafRef.current !== null) return;
      dragMoveRafRef.current = window.requestAnimationFrame(() => {
        dragMoveRafRef.current = null;
        const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
        const hoveredCell = target?.closest(".fc-timegrid-slot-lane, .fc-timegrid-col, .fc-daygrid-day") as HTMLElement | null;
        if (!hoveredCell || hoveredCell === dragHoverCellRef.current) return;

        clearDragHoverCell();
        hoveredCell.classList.add("agenda-drop-hover-cell");
        if (hoveredCell.classList.contains("fc-timegrid-col") || hoveredCell.classList.contains("fc-daygrid-day")) {
          hoveredCell.classList.add("agenda-drop-hover-col");
        }
        dragHoverCellRef.current = hoveredCell;
      });
    };

    window.addEventListener("pointermove", onPointerMove);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      if (dragMoveRafRef.current !== null) {
        window.cancelAnimationFrame(dragMoveRafRef.current);
        dragMoveRafRef.current = null;
      }
      clearDragHoverCell();
    };
  }, [clearDragHoverCell, eventDragging]);

  useEffect(() => {
    return () => {
      if (timeGridDateClickTimerRef.current !== null) {
        window.clearTimeout(timeGridDateClickTimerRef.current);
        timeGridDateClickTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!quickAddDraft) return;
    setEventHoverPreview(null);
  }, [quickAddDraft]);

  const { agendaEvents, agendaConflictCount, isCompactDensity } = useAgendaMergedEvents({
    calendarData,
    googleCalendarEvents,
  });

  const eventContent = useCallback(
    (arg: Parameters<typeof renderAgendaCalendarEventContent>[0]) =>
      renderAgendaCalendarEventContent(arg, isCompactDensity),
    [isCompactDensity],
  );

  const handleEventDidMount = useCallback((arg: { el: HTMLElement; event: { id: string } }) => {
    arg.el.setAttribute("data-agenda-event-id", String(arg.event.id));
  }, []);

  const handleEventMouseEnter = useCallback((arg: {
    event: {
      id: string;
      title: string;
      start: Date | null;
      end: Date | null;
      allDay: boolean;
      extendedProps: Record<string, unknown>;
    };
    el: HTMLElement;
    jsEvent: MouseEvent;
  }) => {
    const workspaceName = typeof arg.event.extendedProps.workspaceName === "string" ? arg.event.extendedProps.workspaceName : "";
    const sourceLabel = arg.event.extendedProps.source === "google-calendar" ? "Google" : "LOCAL";
    const workspaceLabel = workspaceName.trim() || "Sans dossier";
    const timeLabel = formatEventPreviewTime(arg.event.start, arg.event.end, arg.event.allDay);

    const bounds = arg.el.getBoundingClientRect();
    const pointerX = Number.isFinite(arg.jsEvent?.clientX) ? arg.jsEvent.clientX : bounds.left + bounds.width / 2;
    const pointerY = Number.isFinite(arg.jsEvent?.clientY) ? arg.jsEvent.clientY : bounds.top + bounds.height / 2;
    const tooltipWidth = Math.min(260, window.innerWidth - 16);
    const tooltipHeight = 98;
    const left = clamp(pointerX + 10, 8, Math.max(8, window.innerWidth - tooltipWidth - 8));
    const suggestedTop = pointerY + 10;
    const top = suggestedTop + tooltipHeight <= window.innerHeight - 8
      ? clamp(suggestedTop, 8, Math.max(8, window.innerHeight - tooltipHeight - 8))
      : clamp(bounds.top - tooltipHeight - 10, 8, Math.max(8, window.innerHeight - tooltipHeight - 8));

    setEventHoverPreview({
      eventId: arg.event.id,
      title: arg.event.title,
      timeLabel,
      workspaceLabel,
      sourceLabel,
      left,
      top,
    });
  }, []);

  const handleEventMouseLeave = useCallback(() => {
    setEventHoverPreview(null);
  }, []);

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

  const quickAddPosition = quickAddDraft
    ? {
        left: clamp(quickAddDraft.anchorX + 8, 8, Math.max(8, (calendarShellRef.current?.clientWidth ?? 360) - 300)),
        top: clamp(quickAddDraft.anchorY + 8, 8, Math.max(8, (calendarShellRef.current?.clientHeight ?? 640) - 200)),
      }
    : { left: 16, top: 16 };

  return (
    <section ref={calendarShellRef} className="space-y-3 overflow-x-hidden">
      <div className="relative flex flex-wrap items-center gap-1 rounded-md border border-border bg-background p-1">
        <div className="inline-flex max-w-full overflow-hidden rounded-md border border-border bg-background">
          <button
            type="button"
            className="px-2 py-1 text-xs transition-colors hover:bg-accent/60"
            onClick={() => {
              triggerViewTransition();
              jump("today");
            }}
          >
            Aujourd'hui
          </button>
          <button
            type="button"
            className="border-l border-border px-2 py-1 text-xs transition-colors hover:bg-accent/60"
            onClick={() => {
              triggerViewTransition();
              jump("prev");
            }}
            aria-label="Periode precedente"
          >
            Prev
          </button>
          <button
            type="button"
            className="border-l border-border px-2 py-1 text-xs transition-colors hover:bg-accent/60"
            onClick={() => {
              triggerViewTransition();
              jump("next");
            }}
            aria-label="Periode suivante"
          >
            Next
          </button>
        </div>

        <div className="min-w-[120px] flex-1 px-1 text-xs font-semibold sm:text-sm">{label}</div>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
          <div className="inline-flex items-center overflow-hidden rounded-md border border-border bg-background/90 shadow-sm">
            {displayMode === "calendar" ? (
              <>
                <VoiceAgentButton
                  renderCustomTrigger={({ onClick, ariaLabel, title }) => (
                    <button
                      type="button"
                      onClick={onClick}
                      aria-label={ariaLabel}
                      title={title}
                      className="h-7 w-8 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                    >
                      Mic
                    </button>
                  )}
                />
                <div className="h-5 w-px bg-border" aria-hidden="true" />
              </>
            ) : null}
            <CreateButton
              renderCustomTrigger={({ onClick, ariaLabel, title }) => (
                <button
                  type="button"
                  onClick={onClick}
                  aria-label={ariaLabel}
                  title={title}
                  className="h-7 w-8 text-base font-semibold leading-none text-primary transition-colors hover:bg-primary/10"
                >
                  +
                </button>
              )}
            />
          </div>

          <div className="inline-flex max-w-full overflow-hidden rounded-md border border-border bg-background">
            <button
              type="button"
              className={`px-2 py-1 text-xs transition-colors ${displayMode === "calendar" ? "bg-accent font-semibold" : "hover:bg-accent/60"}`}
              onClick={() => {
                triggerViewTransition();
                autoScrollPendingRef.current = viewMode !== "dayGridMonth";
                autoScrollTimeRef.current = buildScrollTimeForNow(new Date());
                setDisplayMode("calendar");
              }}
            >
              Agenda
            </button>
            <button
              type="button"
              className={`border-l border-border px-2 py-1 text-xs transition-colors ${displayMode === "planning" ? "bg-accent font-semibold" : "hover:bg-accent/60"}`}
              onClick={() => {
                triggerViewTransition();
                closeQuickAdd();
                setDisplayMode("planning");
              }}
            >
              Planning
            </button>
          </div>

          <div className="inline-flex max-w-full overflow-hidden rounded-md border border-border bg-background">
            <button
              type="button"
              className={`px-2 py-1 text-xs transition-colors ${viewMode === "dayGridMonth" ? "bg-accent font-semibold" : "hover:bg-accent/60"}`}
              onClick={() => changeView("dayGridMonth")}
            >
              Mois
            </button>
            <button
              type="button"
              className={`border-l border-border px-2 py-1 text-xs transition-colors ${viewMode === "timeGridWeek" ? "bg-accent font-semibold" : "hover:bg-accent/60"}`}
              onClick={() => changeView("timeGridWeek")}
            >
              Semaine
            </button>
            <button
              type="button"
              className={`border-l border-border px-2 py-1 text-xs transition-colors ${viewMode === "timeGridDay" ? "bg-accent font-semibold" : "hover:bg-accent/60"}`}
              onClick={() => changeView("timeGridDay")}
            >
              Jour
            </button>
          </div>

          <button
            ref={optionsTriggerRef}
            type="button"
            className={`inline-flex h-7 items-center rounded-md border border-border px-2 text-xs transition-colors ${optionsOpen ? "bg-accent font-medium" : "bg-background hover:bg-accent/60"}`}
            onClick={() => setOptionsOpen((prev) => !prev)}
            aria-expanded={optionsOpen}
            aria-label="Afficher les options agenda"
          >
            Options
          </button>
        </div>

        {optionsOpen && (
          <div
            ref={optionsPanelRef}
            className="absolute left-1 right-1 top-[calc(100%+0.3rem)] z-20 rounded-md border border-border bg-card p-2 shadow-lg sm:left-auto sm:w-[min(94vw,520px)]"
          >
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
            <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <span className="sn-badge">Affiches: {agendaEvents.length}</span>
              <span className="sn-badge">Conflits: {agendaConflictCount}</span>
              <span className="sn-badge">Local: {calendarData.stats.total}</span>
              <span className="sn-badge">Google: {googleCalendarEvents.length}</span>
              <span className="sn-badge">Recurrents: {calendarData.stats.recurring}</span>
              {isCompactDensity && <span className="sn-badge">Mode compact auto</span>}
            </div>
          </div>
        )}
      </div>
      {error && <div className="sn-alert sn-alert--error">{error}</div>}

      {!error && displayMode === "calendar" && agendaEvents.length === 0 && (
        <div className="sn-empty sn-empty--premium sn-animate-in">
          <div className="sn-empty-title">Aucun Ã©vÃ©nement dans cette fenÃªtre</div>
          <div className="sn-empty-desc">Ajoute un Ã©lÃ©ment pour dÃ©marrer, ou navigue vers une autre pÃ©riode.</div>
          <div className="mt-3">
            <button
              type="button"
              className="inline-flex items-center justify-center h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-95 transition-opacity"
              onClick={openQuickDraft}
            >
              CrÃ©er une tÃ¢che
            </button>
          </div>
        </div>
      )}

      <div className="space-y-0">
        <div className="sn-card p-2 bg-[radial-gradient(900px_circle_at_100%_-10%,rgba(59,130,246,0.08),transparent_50%),linear-gradient(180deg,rgba(15,23,42,0.14),transparent_42%)]">
          {displayMode === "calendar" ? (
            <div
              className={`agenda-premium-calendar relative ${isCompactDensity ? "agenda-density-compact" : "agenda-density-comfort"} ${viewMode === "dayGridMonth" ? "agenda-view-month" : "agenda-view-timegrid"} ${viewTransitioning ? "agenda-transitioning" : ""} ${focusPulseActive ? "sn-highlight-soft" : ""} ${eventDragging ? "agenda-dragging" : ""}`}
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
              nowIndicator={viewMode !== "dayGridMonth"}
              selectable
              selectMirror
              editable
              eventDurationEditable
              eventResizableFromStart
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
              select={handleCalendarSelect}
              dateClick={handleCalendarDateClick}
              eventClick={openDraftFromEvent}
              eventDragStart={() => {
                setEventHoverPreview(null);
                setEventDragging(true);
              }}
              eventDragStop={() => {
                setEventDragging(false);
                clearDragHoverCell();
              }}
              eventDrop={handleMoveOrResize}
              eventResize={handleMoveOrResize}
              eventDidMount={handleEventDidMount}
              eventMouseEnter={handleEventMouseEnter}
              eventMouseLeave={handleEventMouseLeave}
              eventContent={eventContent}
              timeZone={userTimezone}
              />
              {quickAddDraft && (
                <div
                  ref={quickAddPanelRef}
                  className="absolute z-30 w-[min(92vw,290px)] rounded-md border border-border bg-card p-3 shadow-xl"
                  style={{ left: `${quickAddPosition.left}px`, top: `${quickAddPosition.top}px` }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      closeQuickAdd();
                      return;
                    }
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void submitQuickAdd();
                    }
                  }}
                  data-no-calendar-swipe
                >
                  <div className="text-xs font-semibold">Nouvelle tache rapide</div>
                  <input
                    ref={quickAddTitleRef}
                    value={quickAddDraft.title}
                    onChange={(event) => {
                      const nextTitle = event.target.value;
                      setQuickAddDraft((prev) => (prev ? { ...prev, title: nextTitle } : prev));
                      if (quickAddError) setQuickAddError(null);
                    }}
                    placeholder="Titre"
                    className="mt-2 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                    aria-label="Titre de la tache rapide"
                  />
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <input
                      type="time"
                      value={toTimeInputValue(quickAddDraft.start)}
                      onChange={(event) => {
                        const nextTime = mergeDateWithTime(quickAddDraft.start, event.target.value);
                        if (!nextTime) return;
                        setQuickAddDraft((prev) => {
                          if (!prev) return prev;
                          let nextEnd = prev.end;
                          if (nextEnd.getTime() <= nextTime.getTime()) {
                            nextEnd = new Date(nextTime.getTime() + 60 * 60 * 1000);
                          }
                          return { ...prev, start: nextTime, end: nextEnd };
                        });
                      }}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                      aria-label="Heure de debut"
                    />
                    <input
                      type="time"
                      value={toTimeInputValue(quickAddDraft.end)}
                      onChange={(event) => {
                        const nextTime = mergeDateWithTime(quickAddDraft.end, event.target.value);
                        if (!nextTime) return;
                        setQuickAddDraft((prev) => {
                          if (!prev) return prev;
                          const safeEnd = nextTime.getTime() <= prev.start.getTime() ? new Date(prev.start.getTime() + 60 * 60 * 1000) : nextTime;
                          return { ...prev, end: safeEnd };
                        });
                      }}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                      aria-label="Heure de fin"
                    />
                  </div>
                  {quickAddError && <div className="mt-2 text-[11px] text-red-500">{quickAddError}</div>}
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={openFullDraftFromQuickAdd}
                      className="text-xs text-muted-foreground underline underline-offset-2"
                    >
                      Plus d'options
                    </button>
                    <div className="inline-flex items-center gap-2">
                      <button type="button" onClick={closeQuickAdd} className="text-xs text-muted-foreground">
                        Annuler
                      </button>
                      <button
                        type="button"
                        onClick={() => void submitQuickAdd()}
                        className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"
                      >
                        Creer
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {eventHoverPreview && (
                <div
                  className="pointer-events-none fixed z-40 w-[min(92vw,260px)] rounded-md border border-border bg-card/95 px-2.5 py-2 text-[11px] text-foreground shadow-xl backdrop-blur-sm"
                  style={{ left: `${eventHoverPreview.left}px`, top: `${eventHoverPreview.top}px` }}
                  aria-hidden="true"
                >
                  <div className="truncate text-xs font-semibold">{eventHoverPreview.title || "Sans titre"}</div>
                  <div className="mt-1 text-[10px] text-muted-foreground">{eventHoverPreview.timeLabel}</div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="truncate text-[10px] text-muted-foreground">{eventHoverPreview.workspaceLabel}</span>
                    <span className="rounded-full border border-border bg-background/90 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide">
                      {eventHoverPreview.sourceLabel}
                    </span>
                  </div>
                </div>
              )}
              <p className="mt-2 px-1 text-[11px] text-muted-foreground md:hidden">
                Astuce: glissez gauche/droite pour changer de pÃ©riode.
              </p>
            </div>
          ) : (
            <AgendaCalendarPlanningView
              planningSections={planningSections}
              planningAvailabilityByDate={planningAvailabilityByDate}
              onSwitchToCalendar={() => {
                triggerViewTransition();
                autoScrollPendingRef.current = viewMode !== "dayGridMonth";
                autoScrollTimeRef.current = buildScrollTimeForNow(new Date());
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
        Raccourcis: N (nouvel Ã©lÃ©ment), / (recherche), â†/â†’ (navigation).
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

