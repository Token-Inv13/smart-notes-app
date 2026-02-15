"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type {
  DateSelectArg,
  DatesSetArg,
  EventClickArg,
  EventContentArg,
  EventInput,
} from "@fullcalendar/core";
import type { TaskDoc, WorkspaceDoc, Priority, TaskRecurrenceFreq } from "@/types/firestore";

type CalendarViewMode = "dayGridMonth" | "timeGridWeek" | "timeGridDay";
type AgendaDisplayMode = "calendar" | "planning";
type CalendarPriorityFilter = "" | Priority;
type CalendarTimeWindowFilter = "" | "allDay" | "morning" | "afternoon" | "evening";
type CalendarFilterStorage = {
  showRecurringOnly: boolean;
  showConflictsOnly: boolean;
  priorityFilter: CalendarPriorityFilter;
  timeWindowFilter: CalendarTimeWindowFilter;
};

type GoogleCalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
};

const CALENDAR_FILTERS_STORAGE_KEY = "agenda-calendar-filters-v1";

interface CalendarDraft {
  taskId?: string;
  instanceDate?: string;
  title: string;
  startLocal: string;
  endLocal: string;
  allDay: boolean;
  workspaceId: string;
  priority: "" | Priority;
  recurrenceFreq: "" | TaskRecurrenceFreq;
  recurrenceUntil: string;
}

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
}

interface CalendarMutationArg {
  event: {
    id: string;
    start: Date | null;
    end: Date | null;
    allDay: boolean;
    extendedProps: Record<string, unknown>;
  };
  revert: () => void;
}

function toLocalInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toLocalDateInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toHourMinuteLabel(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function parseDateFromDraft(raw: string, allDay: boolean) {
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  if (!allDay) return date;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function priorityColor(priority: Priority | "") {
  if (priority === "high") return "#ef4444";
  if (priority === "medium") return "#f59e0b";
  if (priority === "low") return "#10b981";
  return "#3b82f6";
}

function addRecurrenceStep(base: Date, freq: TaskRecurrenceFreq, interval: number) {
  const next = new Date(base);
  if (freq === "daily") next.setDate(next.getDate() + interval);
  else if (freq === "weekly") next.setDate(next.getDate() + interval * 7);
  else next.setMonth(next.getMonth() + interval);
  return next;
}

function overlapsRange(start: Date, end: Date, rangeStart: Date, rangeEnd: Date) {
  return end.getTime() > rangeStart.getTime() && start.getTime() < rangeEnd.getTime();
}

export default function AgendaCalendar({
  tasks,
  workspaces,
  onCreateEvent,
  onUpdateEvent,
  onSkipOccurrence,
  onOpenTask,
  onVisibleRangeChange,
}: AgendaCalendarProps) {
  const calendarRef = useRef<FullCalendar | null>(null);
  const [viewMode, setViewMode] = useState<CalendarViewMode>("timeGridWeek");
  const [displayMode, setDisplayMode] = useState<AgendaDisplayMode>("calendar");
  const [editScope, setEditScope] = useState<"series" | "occurrence">("series");
  const [showRecurringOnly, setShowRecurringOnly] = useState(false);
  const [showConflictsOnly, setShowConflictsOnly] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<CalendarPriorityFilter>("");
  const [timeWindowFilter, setTimeWindowFilter] = useState<CalendarTimeWindowFilter>("");
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [filtersHydrated, setFiltersHydrated] = useState(false);
  const [visibleRange, setVisibleRange] = useState<{ start: Date; end: Date } | null>(null);
  const [navDate, setNavDate] = useState(toLocalDateInputValue(new Date()));
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<CalendarDraft | null>(null);
  const [selectedPlanningIds, setSelectedPlanningIds] = useState<string[]>([]);
  const [duplicatingPlanning, setDuplicatingPlanning] = useState(false);
  const [showPlanningAvailability, setShowPlanningAvailability] = useState(true);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarPrimaryId, setCalendarPrimaryId] = useState<string | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [calendarMessage, setCalendarMessage] = useState<string | null>(null);
  const [googleCalendarEvents, setGoogleCalendarEvents] = useState<GoogleCalendarEvent[]>([]);

  const loadGoogleCalendarStatus = useCallback(async () => {
    setCalendarLoading(true);
    try {
      const res = await fetch("/api/google/calendar/status", { method: "GET", cache: "no-store" });
      if (!res.ok) {
        setCalendarConnected(false);
        setCalendarPrimaryId(null);
        return;
      }

      const data = (await res.json()) as { connected?: unknown; primaryCalendarId?: unknown };
      setCalendarConnected(data.connected === true);
      setCalendarPrimaryId(typeof data.primaryCalendarId === "string" ? data.primaryCalendarId : null);
    } catch {
      setCalendarConnected(false);
      setCalendarPrimaryId(null);
    } finally {
      setCalendarLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGoogleCalendarStatus();
  }, [loadGoogleCalendarStatus]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const calendarState = params.get("calendar");
    if (!calendarState) return;

    if (calendarState === "connected") {
      setCalendarMessage("Google Calendar connecté.");
      void loadGoogleCalendarStatus();
    } else if (calendarState === "auth_required") {
      setCalendarMessage("Connexion requise pour Google Calendar.");
    } else if (calendarState === "oauth_state_invalid") {
      setCalendarMessage("Échec OAuth Google Calendar (state invalide).");
    } else if (calendarState === "missing_env") {
      setCalendarMessage("Configuration Google Calendar manquante côté serveur.");
    } else if (calendarState === "token_exchange_failed") {
      setCalendarMessage("Impossible d’échanger le code OAuth Google.");
    } else if (calendarState === "token_missing") {
      setCalendarMessage("Token Google Calendar manquant.");
    } else if (calendarState === "error") {
      setCalendarMessage("Erreur de connexion Google Calendar.");
    }

    params.delete("calendar");
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`;
    window.history.replaceState({}, "", nextUrl);
  }, [loadGoogleCalendarStatus]);

  const handleConnectGoogleCalendar = async () => {
    setCalendarBusy(true);
    setCalendarMessage(null);
    try {
      const returnTo =
        typeof window !== "undefined"
          ? `${window.location.pathname}${window.location.search}`
          : "/tasks";
      const encodedReturnTo = encodeURIComponent(returnTo.startsWith("/") ? returnTo : "/tasks");
      const res = await fetch(`/api/google/calendar/connect?returnTo=${encodedReturnTo}`, {
        method: "GET",
        cache: "no-store",
      });
      const data = (await res.json()) as { url?: unknown; error?: unknown };
      if (!res.ok || typeof data.url !== "string") {
        setCalendarMessage(typeof data.error === "string" ? data.error : "Impossible de lancer la connexion Google Calendar.");
        return;
      }

      if (typeof window !== "undefined") {
        window.location.href = data.url;
      }
    } catch {
      setCalendarMessage("Impossible de lancer la connexion Google Calendar.");
    } finally {
      setCalendarBusy(false);
    }
  };

  const loadGoogleCalendarEvents = useCallback(async () => {
    if (!calendarConnected || !visibleRange) {
      setGoogleCalendarEvents([]);
      return;
    }

    try {
      const params = new URLSearchParams({
        timeMin: visibleRange.start.toISOString(),
        timeMax: visibleRange.end.toISOString(),
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
  }, [calendarConnected, visibleRange]);

  useEffect(() => {
    void loadGoogleCalendarEvents();
  }, [loadGoogleCalendarEvents]);

  const handleDisconnectGoogleCalendar = async () => {
    setCalendarBusy(true);
    setCalendarMessage(null);
    try {
      const res = await fetch("/api/google/calendar/disconnect", { method: "POST" });
      const data = (await res.json()) as { ok?: unknown; error?: unknown };
      if (!res.ok || data.ok !== true) {
        setCalendarMessage(typeof data.error === "string" ? data.error : "Impossible de déconnecter Google Calendar.");
        return;
      }

      setCalendarConnected(false);
      setCalendarPrimaryId(null);
      setCalendarMessage("Google Calendar déconnecté.");
    } catch {
      setCalendarMessage("Impossible de déconnecter Google Calendar.");
    } finally {
      setCalendarBusy(false);
    }
  };

  const calendarData = useMemo(() => {
    const rangeStart = visibleRange?.start ?? new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    const rangeEnd = visibleRange?.end ?? new Date(Date.now() + 45 * 24 * 60 * 60 * 1000);

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
        extendedProps: {
          taskId,
          workspaceId: task.workspaceId ?? "",
          workspaceName: workspaces.find((ws) => ws.id === task.workspaceId)?.name ?? "Sans dossier",
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
  }, [priorityFilter, showConflictsOnly, showRecurringOnly, tasks, timeWindowFilter, visibleRange, workspaces]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CALENDAR_FILTERS_STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as Partial<CalendarFilterStorage>;

      if (typeof parsed.showRecurringOnly === "boolean") {
        setShowRecurringOnly(parsed.showRecurringOnly);
      }

      if (typeof parsed.showConflictsOnly === "boolean") {
        setShowConflictsOnly(parsed.showConflictsOnly);
      }

      if (parsed.priorityFilter === "" || parsed.priorityFilter === "low" || parsed.priorityFilter === "medium" || parsed.priorityFilter === "high") {
        setPriorityFilter(parsed.priorityFilter);
      }

      if (
        parsed.timeWindowFilter === "" ||
        parsed.timeWindowFilter === "allDay" ||
        parsed.timeWindowFilter === "morning" ||
        parsed.timeWindowFilter === "afternoon" ||
        parsed.timeWindowFilter === "evening"
      ) {
        setTimeWindowFilter(parsed.timeWindowFilter);
      }
    } catch {
      // ignore invalid persisted payload
    } finally {
      setFiltersHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!filtersHydrated) return;

    const payload: CalendarFilterStorage = {
      showRecurringOnly,
      showConflictsOnly,
      priorityFilter,
      timeWindowFilter,
    };

    try {
      window.localStorage.setItem(CALENDAR_FILTERS_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage write errors
    }
  }, [filtersHydrated, priorityFilter, showConflictsOnly, showRecurringOnly, timeWindowFilter]);

  const openDraftFromSelect = (arg: DateSelectArg) => {
    setEditScope("series");
    setDraft({
      title: "",
      startLocal: arg.allDay ? toLocalDateInputValue(arg.start) : toLocalInputValue(arg.start),
      endLocal: arg.allDay ? toLocalDateInputValue(new Date(arg.end.getTime() - 1)) : toLocalInputValue(arg.end),
      allDay: arg.allDay,
      workspaceId: "",
      priority: "",
      recurrenceFreq: "",
      recurrenceUntil: "",
    });
  };

  const openDraftFromEvent = (arg: EventClickArg) => {
    if (arg.event.extendedProps.source === "google-calendar") {
      return;
    }

    const start = arg.event.start;
    const end = arg.event.end;
    if (!start || !end) return;
    const recurrence = (arg.event.extendedProps.recurrence as TaskDoc["recurrence"] | null) ?? null;
    const instanceDate = (arg.event.extendedProps.instanceDate as string | undefined) ?? undefined;
    setEditScope(recurrence?.freq && instanceDate ? "occurrence" : "series");

    setDraft({
      taskId: ((arg.event.extendedProps.taskId as string) || arg.event.id) as string,
      instanceDate,
      title: arg.event.title,
      startLocal: arg.event.allDay ? toLocalDateInputValue(start) : toLocalInputValue(start),
      endLocal: arg.event.allDay ? toLocalDateInputValue(new Date(end.getTime() - 1)) : toLocalInputValue(end),
      allDay: arg.event.allDay,
      workspaceId: (arg.event.extendedProps.workspaceId as string) ?? "",
      priority: ((arg.event.extendedProps.priority as Priority | "") ?? "") as "" | Priority,
      recurrenceFreq: recurrence?.freq ?? "",
      recurrenceUntil: recurrence?.until?.toDate ? toLocalDateInputValue(recurrence.until.toDate()) : "",
    });
  };

  const saveDraft = async () => {
    if (!draft) return;

    const start = parseDateFromDraft(draft.startLocal, draft.allDay);
    const end = parseDateFromDraft(draft.endLocal, draft.allDay);
    if (!start || !end) {
      setError("Date/heure invalide.");
      return;
    }

    const allDayEnd = draft.allDay
      ? new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1, 0, 0, 0, 0)
      : end;

    if (allDayEnd.getTime() <= start.getTime()) {
      setError("La fin doit être après le début.");
      return;
    }

    if (!draft.title.trim()) {
      setError("Le titre est obligatoire.");
      return;
    }

    const recurrence = draft.recurrenceFreq
      ? {
          freq: draft.recurrenceFreq,
          interval: 1,
          until: draft.recurrenceUntil ? new Date(`${draft.recurrenceUntil}T23:59:59`) : null,
          exceptions: [],
        }
      : null;

    setSaving(true);
    setError(null);
    try {
      if (draft.taskId && draft.instanceDate && draft.recurrenceFreq && editScope === "occurrence") {
        if (!onSkipOccurrence) {
          setError("Impossible d’éditer cette occurrence pour le moment.");
          return;
        }

        await onSkipOccurrence(draft.taskId, draft.instanceDate);
        await onCreateEvent({
          title: draft.title.trim(),
          start,
          end: allDayEnd,
          allDay: draft.allDay,
          workspaceId: draft.workspaceId || null,
          priority: draft.priority || null,
          recurrence: null,
        });
        setDraft(null);
        return;
      }

      if (draft.taskId) {
        await onUpdateEvent({
          taskId: draft.taskId,
          title: draft.title.trim(),
          start,
          end: allDayEnd,
          allDay: draft.allDay,
          workspaceId: draft.workspaceId || null,
          priority: draft.priority || null,
          recurrence,
        });
      } else {
        await onCreateEvent({
          title: draft.title.trim(),
          start,
          end: allDayEnd,
          allDay: draft.allDay,
          workspaceId: draft.workspaceId || null,
          priority: draft.priority || null,
          recurrence,
        });
      }
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de sauvegarde.");
    } finally {
      setSaving(false);
    }
  };

  const handleMoveOrResize = async (arg: CalendarMutationArg) => {
    try {
      const start = arg.event.start;
      const end = arg.event.end;
      const taskId = ((arg.event.extendedProps.taskId as string) || arg.event.id) as string;
      const instanceDate = (arg.event.extendedProps.instanceDate as string | undefined) ?? undefined;
      const recurrence = (arg.event.extendedProps.recurrence as TaskDoc["recurrence"] | null) ?? null;
      if (!taskId || !start || !end) {
        arg.revert();
        return;
      }

      if (instanceDate && recurrence?.freq) {
        if (!onSkipOccurrence) {
          arg.revert();
          setError("Impossible de modifier cette occurrence pour le moment.");
          return;
        }

        await onSkipOccurrence(taskId, instanceDate);
        await onCreateEvent({
          title: typeof arg.event.extendedProps.title === "string" ? (arg.event.extendedProps.title as string) : "Occurrence",
          start,
          end,
          allDay: arg.event.allDay,
          workspaceId: ((arg.event.extendedProps.workspaceId as string) || null),
          priority: ((arg.event.extendedProps.priority as Priority | "") || null),
          recurrence: null,
        });
        return;
      }

      await onUpdateEvent({
        taskId,
        start,
        end,
        allDay: arg.event.allDay,
        workspaceId: ((arg.event.extendedProps.workspaceId as string) || null),
        priority: ((arg.event.extendedProps.priority as Priority | "") || null),
        recurrence: (() => {
          const rec = (arg.event.extendedProps.recurrence as TaskDoc["recurrence"] | null) ?? null;
          if (!rec?.freq) return null;
          return {
            freq: rec.freq,
            interval: rec.interval ?? 1,
            until: rec.until?.toDate ? rec.until.toDate() : null,
            exceptions: Array.isArray(rec.exceptions) ? rec.exceptions : [],
          };
        })(),
      });
    } catch {
      arg.revert();
      setError("Impossible de déplacer/redimensionner cet élément d’agenda.");
    }
  };

  const eventContent = (arg: EventContentArg) => {
    const workspaceName = (arg.event.extendedProps.workspaceName as string) ?? "";
    const priority = ((arg.event.extendedProps.priority as Priority | "") ?? "") as "" | Priority;
    const hasConflict = arg.event.extendedProps.conflict === true;

    return (
      <div className="px-1 py-0.5 text-[11px] leading-tight">
        <div className="font-semibold truncate">{arg.event.title}</div>
        <div className="opacity-90 truncate">{workspaceName}</div>
        {priority && <div className="uppercase tracking-wide text-[10px]">{priority}</div>}
        {hasConflict && <div className="text-[10px] text-red-600">Conflit</div>}
      </div>
    );
  };

  const jump = (action: "prev" | "next" | "today") => {
    const api = calendarRef.current?.getApi();
    if (!api) return;
    if (action === "prev") api.prev();
    if (action === "next") api.next();
    if (action === "today") api.today();
  };

  const openQuickDraft = useCallback(() => {
    setEditScope("series");
    const start = new Date();
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    setDraft({
      title: "",
      startLocal: toLocalInputValue(start),
      endLocal: toLocalInputValue(end),
      allDay: false,
      workspaceId: "",
      priority: "",
      recurrenceFreq: "",
      recurrenceUntil: "",
    });
  }, []);

  const skipOccurrence = async () => {
    if (!draft?.taskId || !draft.instanceDate || !draft.recurrenceFreq || !onSkipOccurrence) return;
    setSaving(true);
    setError(null);
    try {
      await onSkipOccurrence(draft.taskId, draft.instanceDate);
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible d’ignorer cette occurrence.");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showShortcutHelp) {
        e.preventDefault();
        setShowShortcutHelp(false);
        return;
      }

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isEditing = tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable;
      if (isEditing) return;

      if (e.key === "?") {
        e.preventDefault();
        setShowShortcutHelp((prev) => !prev);
        return;
      }

      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        openQuickDraft();
        return;
      }

      if (e.key === "/") {
        e.preventDefault();
        const searchInput = document.getElementById("tasks-search-input") as HTMLInputElement | null;
        searchInput?.focus();
        searchInput?.select();
        return;
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        jump("prev");
        return;
      }

      if (e.key === "ArrowRight") {
        e.preventDefault();
        jump("next");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openQuickDraft, showShortcutHelp]);

  const changeView = (next: CalendarViewMode) => {
    setViewMode(next);
    calendarRef.current?.getApi().changeView(next);
  };

  const onDatesSet = (arg: DatesSetArg) => {
    setLabel(arg.view.title);
    setVisibleRange({ start: arg.start, end: arg.end });
    setNavDate(toLocalDateInputValue(arg.start));
    onVisibleRangeChange?.({ start: arg.start, end: arg.end });
  };

  const googleCalendarEventInputs = useMemo(() => {
    return googleCalendarEvents
      .map((event) => {
        const start = new Date(event.start);
        const end = new Date(event.end);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

        return {
          id: `gcal__${event.id}`,
          title: event.title || "Événement Google",
          start,
          end,
          allDay: event.allDay,
          backgroundColor: "#2563eb",
          borderColor: "#2563eb",
          editable: false,
          extendedProps: {
            workspaceName: "Google Calendar",
            source: "google-calendar",
            conflict: false,
          },
        } as EventInput;
      })
      .filter((event): event is EventInput => Boolean(event));
  }, [googleCalendarEvents]);

  const agendaEvents = useMemo(() => {
    const base = [...calendarData.events, ...googleCalendarEventInputs].sort((a, b) => {
      const aStart = a.start instanceof Date ? a.start.getTime() : 0;
      const bStart = b.start instanceof Date ? b.start.getTime() : 0;
      return aStart - bStart;
    });

    const conflictIds = new Set<string>();
    for (let i = 0; i < base.length; i += 1) {
      const left = base[i];
      if (!(left?.start instanceof Date) || !(left?.end instanceof Date)) continue;
      for (let j = i + 1; j < base.length; j += 1) {
        const right = base[j];
        if (!(right?.start instanceof Date) || !(right?.end instanceof Date)) continue;
        if (right.start.getTime() >= left.end.getTime()) break;
        conflictIds.add(String(left.id));
        conflictIds.add(String(right.id));
      }
    }

    return base.map((event) => {
      const existingConflict = event.extendedProps?.conflict === true;
      const mergedConflict = existingConflict || conflictIds.has(String(event.id));
      return {
        ...event,
        extendedProps: {
          ...(event.extendedProps ?? {}),
          conflict: mergedConflict,
        },
      } as EventInput;
    });
  }, [calendarData.events, googleCalendarEventInputs]);

  const planningSections = useMemo(() => {
    const grouped = new Map<string, EventInput[]>();

    for (const event of agendaEvents) {
      if (!(event.start instanceof Date)) continue;
      const key = toLocalDateInputValue(event.start);
      const existing = grouped.get(key) ?? [];
      existing.push(event);
      grouped.set(key, existing);
    }

    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateKey, events]) => ({
        dateKey,
        events: [...events].sort((a, b) => {
          const aStart = a.start instanceof Date ? a.start.getTime() : 0;
          const bStart = b.start instanceof Date ? b.start.getTime() : 0;
          return aStart - bStart;
        }),
      }));
  }, [agendaEvents]);

  const planningAvailabilityByDate = useMemo(() => {
    const dateMap = new Map<string, EventInput[]>();
    for (const event of agendaEvents) {
      if (!(event.start instanceof Date)) continue;
      const key = toLocalDateInputValue(event.start);
      const existing = dateMap.get(key) ?? [];
      existing.push(event);
      dateMap.set(key, existing);
    }

    const output = new Map<string, Array<{ start: Date; end: Date; durationMinutes: number }>>();
    const todayKey = toLocalDateInputValue(new Date());
    const minSlotMinutes = 30;

    for (const [dateKey, dayEvents] of dateMap.entries()) {
      if (dateKey < todayKey) continue;
      const [year, month, day] = dateKey.split("-").map(Number);
      if (!year || !month || !day) continue;

      const dayStart = new Date(year, month - 1, day, 8, 0, 0, 0);
      const dayEnd = new Date(year, month - 1, day, 20, 0, 0, 0);

      const busyIntervals = dayEvents
        .map((event) => {
          const start = event.start instanceof Date ? event.start : null;
          const end = event.end instanceof Date ? event.end : null;
          if (!start || !end) return null;

          if (event.allDay) {
            return { start: dayStart, end: dayEnd };
          }

          const boundedStart = start.getTime() > dayStart.getTime() ? start : dayStart;
          const boundedEnd = end.getTime() < dayEnd.getTime() ? end : dayEnd;
          if (boundedEnd.getTime() <= boundedStart.getTime()) return null;
          return { start: boundedStart, end: boundedEnd };
        })
        .filter((slot): slot is { start: Date; end: Date } => Boolean(slot))
        .sort((a, b) => a.start.getTime() - b.start.getTime());

      const merged: Array<{ start: Date; end: Date }> = [];
      for (const interval of busyIntervals) {
        const last = merged[merged.length - 1];
        if (!last || interval.start.getTime() > last.end.getTime()) {
          merged.push({ start: new Date(interval.start), end: new Date(interval.end) });
          continue;
        }
        if (interval.end.getTime() > last.end.getTime()) {
          last.end = new Date(interval.end);
        }
      }

      const free: Array<{ start: Date; end: Date; durationMinutes: number }> = [];
      let cursor = new Date(dayStart);
      for (const interval of merged) {
        const gapMs = interval.start.getTime() - cursor.getTime();
        if (gapMs >= minSlotMinutes * 60 * 1000) {
          free.push({
            start: new Date(cursor),
            end: new Date(interval.start),
            durationMinutes: Math.round(gapMs / (60 * 1000)),
          });
        }
        if (interval.end.getTime() > cursor.getTime()) {
          cursor = new Date(interval.end);
        }
      }

      const tailMs = dayEnd.getTime() - cursor.getTime();
      if (tailMs >= minSlotMinutes * 60 * 1000) {
        free.push({
          start: new Date(cursor),
          end: new Date(dayEnd),
          durationMinutes: Math.round(tailMs / (60 * 1000)),
        });
      }

      output.set(dateKey, free.slice(0, 3));
    }

    return output;
  }, [agendaEvents]);

  const planningEventMap = useMemo(() => {
    const map = new Map<string, EventInput>();
    for (const event of calendarData.events) {
      map.set(String(event.id), event);
    }
    return map;
  }, [calendarData.events]);

  useEffect(() => {
    if (displayMode === "calendar" && selectedPlanningIds.length > 0) {
      setSelectedPlanningIds([]);
    }
  }, [displayMode, selectedPlanningIds.length]);

  const togglePlanningSelection = (eventId: string) => {
    setSelectedPlanningIds((prev) =>
      prev.includes(eventId) ? prev.filter((id) => id !== eventId) : [...prev, eventId],
    );
  };

  const duplicatePlanningSelection = async () => {
    if (selectedPlanningIds.length === 0) return;

    setDuplicatingPlanning(true);
    setError(null);
    try {
      for (const id of selectedPlanningIds) {
        const source = planningEventMap.get(id);
        if (!source) continue;
        const start = source.start instanceof Date ? source.start : null;
        const end = source.end instanceof Date ? source.end : null;
        if (!start || !end) continue;

        const nextStart = new Date(start);
        nextStart.setDate(nextStart.getDate() + 1);
        const nextEnd = new Date(end);
        nextEnd.setDate(nextEnd.getDate() + 1);

        await onCreateEvent({
          title: source.title ?? "Élément agenda",
          start: nextStart,
          end: nextEnd,
          allDay: source.allDay === true,
          workspaceId:
            typeof source.extendedProps?.workspaceId === "string" && source.extendedProps.workspaceId
              ? source.extendedProps.workspaceId
              : null,
          priority:
            source.extendedProps?.priority === "low" ||
            source.extendedProps?.priority === "medium" ||
            source.extendedProps?.priority === "high"
              ? (source.extendedProps.priority as Priority)
              : null,
          recurrence: null,
        });
      }

      setSelectedPlanningIds([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de dupliquer la sélection.");
    } finally {
      setDuplicatingPlanning(false);
    }
  };

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
          <div className="inline-flex items-center gap-2">
            <input
              type="date"
              value={navDate}
              onChange={(e) => setNavDate(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              aria-label="Aller à la date"
            />
            <button
              type="button"
              className="px-2 py-1.5 text-xs rounded-md border border-border bg-background"
              onClick={() => {
                if (!navDate) return;
                const date = new Date(`${navDate}T12:00:00`);
                if (Number.isNaN(date.getTime())) return;
                calendarRef.current?.getApi().gotoDate(date);
              }}
            >
              Aller
            </button>
          </div>

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
            disabled={displayMode === "planning"}
          >
            Mois
          </button>
          <button
            type="button"
            className={`px-3 py-1.5 text-sm border-l border-border ${viewMode === "timeGridWeek" ? "bg-accent font-semibold" : ""}`}
            onClick={() => changeView("timeGridWeek")}
            disabled={displayMode === "planning"}
          >
            Semaine
          </button>
          <button
            type="button"
            className={`px-3 py-1.5 text-sm border-l border-border ${viewMode === "timeGridDay" ? "bg-accent font-semibold" : ""}`}
            onClick={() => changeView("timeGridDay")}
            disabled={displayMode === "planning"}
          >
            Jour
          </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowRecurringOnly((prev) => !prev)}
          className={`h-8 px-3 rounded-md border text-xs ${showRecurringOnly ? "border-primary bg-accent" : "border-border bg-background"}`}
        >
          Récurrents
        </button>
        <button
          type="button"
          onClick={() => setShowConflictsOnly((prev) => !prev)}
          className={`h-8 px-3 rounded-md border text-xs ${showConflictsOnly ? "border-primary bg-accent" : "border-border bg-background"}`}
        >
          Conflits
        </button>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as CalendarPriorityFilter)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          aria-label="Filtrer par priorité"
        >
          <option value="">Toutes priorités</option>
          <option value="high">Priorité haute</option>
          <option value="medium">Priorité moyenne</option>
          <option value="low">Priorité basse</option>
        </select>

        <select
          value={timeWindowFilter}
          onChange={(e) => setTimeWindowFilter(e.target.value as CalendarTimeWindowFilter)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          aria-label="Filtrer par plage horaire"
        >
          <option value="">Toutes plages</option>
          <option value="allDay">Toute la journée</option>
          <option value="morning">Matin</option>
          <option value="afternoon">Après-midi</option>
          <option value="evening">Soir</option>
        </select>

        {(showRecurringOnly || showConflictsOnly || priorityFilter || timeWindowFilter) && (
          <button
            type="button"
            onClick={() => {
              setShowRecurringOnly(false);
              setShowConflictsOnly(false);
              setPriorityFilter("");
              setTimeWindowFilter("");
            }}
            className="h-8 px-3 rounded-md border border-border bg-background text-xs"
          >
            Réinitialiser
          </button>
        )}

        <button
          type="button"
          onClick={() => setShowShortcutHelp(true)}
          className="h-8 px-3 rounded-md border border-border bg-background text-xs"
        >
          Aide (?)
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="sn-badge">Affichés: {calendarData.stats.displayed}</span>
        <span className="sn-badge">Total: {calendarData.stats.total}</span>
        <span className="sn-badge">Récurrents: {calendarData.stats.recurring}</span>
        <span className="sn-badge">Conflits: {calendarData.stats.conflicts}</span>
      </div>

      <div className="rounded-md border border-border bg-background px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold">Google Calendar</div>
            <div className="text-xs text-muted-foreground">
              {calendarLoading ? "Chargement…" : calendarConnected ? "Connecté" : "Non connecté"}
            </div>
          </div>

          {!calendarConnected ? (
            <button
              type="button"
              onClick={() => void handleConnectGoogleCalendar()}
              disabled={calendarBusy || calendarLoading}
              className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
            >
              {calendarBusy ? "Connexion…" : "Connecter"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleDisconnectGoogleCalendar()}
              disabled={calendarBusy || calendarLoading}
              className="h-8 px-3 rounded-md border border-input text-xs disabled:opacity-50"
            >
              {calendarBusy ? "Déconnexion…" : "Déconnecter"}
            </button>
          )}
        </div>

        {calendarPrimaryId ? (
          <div className="mt-1 text-xs text-muted-foreground break-all">Calendrier principal: {calendarPrimaryId}</div>
        ) : null}

        {calendarMessage ? <div className="mt-1 text-xs">{calendarMessage}</div> : null}
      </div>

      {error && <div className="sn-alert sn-alert--error">{error}</div>}

      <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden lg:block sn-card p-3 space-y-3 h-fit sticky top-20">
          <div className="text-xs font-semibold">Mini calendrier</div>
          <input
            type="date"
            value={navDate}
            onChange={(e) => setNavDate(e.target.value)}
            className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
            aria-label="Mini calendrier - date"
          />
          <button
            type="button"
            className="w-full h-9 rounded-md border border-border bg-background text-sm"
            onClick={() => {
              if (!navDate) return;
              const date = new Date(`${navDate}T12:00:00`);
              if (Number.isNaN(date.getTime())) return;
              calendarRef.current?.getApi().gotoDate(date);
            }}
          >
            Aller à la date
          </button>
          <div className="grid grid-cols-3 gap-1">
            <button type="button" className="h-8 rounded-md border border-border text-xs" onClick={() => jump("prev")}>Préc.</button>
            <button type="button" className="h-8 rounded-md border border-border text-xs" onClick={() => jump("today")}>Ajd</button>
            <button type="button" className="h-8 rounded-md border border-border text-xs" onClick={() => jump("next")}>Suiv.</button>
          </div>
        </aside>

        <div className="sn-card p-2">
          {displayMode === "calendar" ? (
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
              slotMinTime="06:00:00"
              slotMaxTime="23:30:00"
              events={agendaEvents}
              datesSet={onDatesSet}
              select={openDraftFromSelect}
              dateClick={(arg) =>
                openDraftFromSelect({
                  allDay: true,
                  end: new Date(arg.date.getFullYear(), arg.date.getMonth(), arg.date.getDate() + 1),
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
          ) : (
            <div className="space-y-4 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Sélection: {selectedPlanningIds.length}</span>
                <button
                  type="button"
                  className={`h-8 px-3 rounded-md border text-xs ${showPlanningAvailability ? "border-primary bg-accent" : "border-border bg-background"}`}
                  onClick={() => setShowPlanningAvailability((prev) => !prev)}
                >
                  Disponibilités futures
                </button>
                <button
                  type="button"
                  className="h-8 px-3 rounded-md border border-border bg-background text-xs"
                  onClick={duplicatePlanningSelection}
                  disabled={selectedPlanningIds.length === 0 || duplicatingPlanning}
                >
                  {duplicatingPlanning ? "Duplication…" : "Dupliquer en J+1"}
                </button>
                <button
                  type="button"
                  className="h-8 px-3 rounded-md border border-border bg-background text-xs"
                  onClick={() => setSelectedPlanningIds([])}
                  disabled={selectedPlanningIds.length === 0 || duplicatingPlanning}
                >
                  Vider
                </button>
              </div>

              {planningSections.length === 0 ? (
                <div className="text-sm text-muted-foreground">Aucun élément à afficher dans le planning.</div>
              ) : (
                planningSections.map((section) => (
                  <div key={section.dateKey} className="space-y-2">
                    <div className="text-sm font-semibold">{section.dateKey}</div>
                    <ul className="space-y-2">
                      {section.events.map((event) => {
                        const start = event.start instanceof Date ? event.start : null;
                        const end = event.end instanceof Date ? event.end : null;
                        const workspaceName = typeof event.extendedProps?.workspaceName === "string" ? event.extendedProps.workspaceName : "Sans dossier";
                        const taskId = typeof event.extendedProps?.taskId === "string" ? event.extendedProps.taskId : "";
                        const conflict = event.extendedProps?.conflict === true;
                        const isExternal = !taskId;

                        const timeLabel =
                          start && end
                            ? `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")} - ${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`
                            : "Heure non définie";

                        return (
                          <li key={String(event.id)} className="relative pl-4">
                            <span className="absolute left-0 top-2 h-2 w-2 rounded-full bg-primary" />
                            <div className="flex items-start gap-2 rounded-md border border-border bg-background px-2 py-2">
                              {isExternal ? (
                                <span className="mt-1 inline-flex h-4 min-w-4 items-center justify-center rounded border border-border px-1 text-[10px] text-muted-foreground">
                                  G
                                </span>
                              ) : (
                                <input
                                  type="checkbox"
                                  className="mt-1"
                                  checked={selectedPlanningIds.includes(String(event.id))}
                                  onChange={() => togglePlanningSelection(String(event.id))}
                                  aria-label={`Sélectionner ${event.title}`}
                                />
                              )}
                              <button
                                type="button"
                                className="flex-1 text-left hover:bg-accent rounded-md px-1 py-1"
                                onClick={() => {
                                  if (taskId) onOpenTask(taskId);
                                }}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-sm font-medium truncate">{event.title}</div>
                                  <div className="inline-flex items-center gap-1">
                                    {isExternal && <span className="text-[10px] text-blue-600">Google</span>}
                                    {conflict && <span className="text-[10px] text-red-600">Conflit</span>}
                                  </div>
                                </div>
                                <div className="text-xs text-muted-foreground">{timeLabel}</div>
                                <div className="text-xs text-muted-foreground">{workspaceName}</div>
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>

                    {showPlanningAvailability && (
                      <div className="rounded-md border border-border bg-muted/30 px-2 py-2">
                        <div className="text-[11px] font-semibold text-muted-foreground">Créneaux disponibles (08:00-20:00)</div>
                        {(() => {
                          const slots = planningAvailabilityByDate.get(section.dateKey) ?? [];
                          if (slots.length === 0) {
                            return <div className="text-xs text-muted-foreground mt-1">Aucun créneau futur détecté.</div>;
                          }

                          return (
                            <ul className="mt-1 space-y-1">
                              {slots.map((slot) => (
                                <li key={`${section.dateKey}-${slot.start.toISOString()}-${slot.end.toISOString()}`} className="text-xs text-muted-foreground">
                                  {toHourMinuteLabel(slot.start)} - {toHourMinuteLabel(slot.end)} ({slot.durationMinutes} min)
                                </li>
                              ))}
                            </ul>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        Raccourcis: ? (aide), N (nouvel élément), / (recherche), ←/→ (navigation), Échap (fermer aide).
      </div>

      {showShortcutHelp && (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Aide raccourcis clavier">
          <button
            type="button"
            className="absolute inset-0 bg-black/45"
            onClick={() => setShowShortcutHelp(false)}
            aria-label="Fermer l’aide"
          />
          <div className="absolute top-1/2 left-1/2 w-[min(92vw,520px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card shadow-lg p-4 space-y-3">
            <div className="text-sm font-semibold">Aide des raccourcis</div>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center justify-between gap-3"><span>Ouvrir/fermer cette aide</span><span className="sn-badge">?</span></li>
              <li className="flex items-center justify-between gap-3"><span>Créer un élément agenda</span><span className="sn-badge">N</span></li>
              <li className="flex items-center justify-between gap-3"><span>Focus recherche globale</span><span className="sn-badge">/</span></li>
              <li className="flex items-center justify-between gap-3"><span>Période précédente</span><span className="sn-badge">←</span></li>
              <li className="flex items-center justify-between gap-3"><span>Période suivante</span><span className="sn-badge">→</span></li>
              <li className="flex items-center justify-between gap-3"><span>Fermer l’aide</span><span className="sn-badge">Échap</span></li>
            </ul>
            <div className="flex justify-end">
              <button type="button" className="sn-text-btn" onClick={() => setShowShortcutHelp(false)}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        className="fixed bottom-24 right-4 z-40 sm:hidden h-12 w-12 rounded-full bg-primary text-primary-foreground text-xl shadow-lg"
        onClick={openQuickDraft}
        aria-label="Créer un élément d’agenda"
      >
        +
      </button>

      {draft && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Éditeur agenda">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            onClick={() => setDraft(null)}
            aria-label="Fermer"
          />
          <div className="absolute bottom-0 left-0 right-0 sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:right-auto sm:w-[min(92vw,560px)] sm:-translate-x-1/2 sm:-translate-y-1/2 rounded-t-lg sm:rounded-lg border border-border bg-card shadow-lg p-4 space-y-3">
            <div className="text-sm font-semibold">{draft.taskId ? "Modifier l’élément d’agenda" : "Nouvel élément d’agenda"}</div>

            {draft.taskId && draft.instanceDate && draft.recurrenceFreq && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setEditScope("occurrence")}
                  className={`h-9 rounded-md border text-sm ${editScope === "occurrence" ? "border-primary bg-accent" : "border-border bg-background"}`}
                >
                  Cette occurrence
                </button>
                <button
                  type="button"
                  onClick={() => setEditScope("series")}
                  className={`h-9 rounded-md border text-sm ${editScope === "series" ? "border-primary bg-accent" : "border-border bg-background"}`}
                >
                  Toute la série
                </button>
              </div>
            )}

            <input
              value={draft.title}
              onChange={(e) => setDraft((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
              placeholder="Titre"
              className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
              aria-label="Titre"
            />

            <label className="text-xs flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.allDay}
                onChange={(e) =>
                  setDraft((prev) => {
                    if (!prev) return prev;
                    const start = parseDateFromDraft(prev.startLocal, prev.allDay) ?? new Date();
                    const end = parseDateFromDraft(prev.endLocal, prev.allDay) ?? new Date(start.getTime() + 60 * 60 * 1000);
                    return {
                      ...prev,
                      allDay: e.target.checked,
                      startLocal: e.target.checked ? toLocalDateInputValue(start) : toLocalInputValue(start),
                      endLocal: e.target.checked ? toLocalDateInputValue(end) : toLocalInputValue(end),
                    };
                  })
                }
              />
              Toute la journée
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type={draft.allDay ? "date" : "datetime-local"}
                value={draft.startLocal}
                onChange={(e) => setDraft((prev) => (prev ? { ...prev, startLocal: e.target.value } : prev))}
                className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
                aria-label="Début"
              />
              <input
                type={draft.allDay ? "date" : "datetime-local"}
                value={draft.endLocal}
                onChange={(e) => setDraft((prev) => (prev ? { ...prev, endLocal: e.target.value } : prev))}
                className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
                aria-label="Fin"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select
                value={draft.workspaceId}
                onChange={(e) => setDraft((prev) => (prev ? { ...prev, workspaceId: e.target.value } : prev))}
                className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
                aria-label="Dossier"
              >
                <option value="">Sans dossier</option>
                {workspaces.map((ws) => (
                  <option key={ws.id ?? ws.name} value={ws.id ?? ""} disabled={!ws.id}>
                    {ws.name}
                  </option>
                ))}
              </select>

              <select
                value={draft.priority}
                onChange={(e) => setDraft((prev) => (prev ? { ...prev, priority: e.target.value as "" | Priority } : prev))}
                className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
                aria-label="Priorité"
              >
                <option value="">Priorité</option>
                <option value="low">Basse</option>
                <option value="medium">Moyenne</option>
                <option value="high">Haute</option>
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select
                value={draft.recurrenceFreq}
                onChange={(e) =>
                  setDraft((prev) =>
                    prev ? { ...prev, recurrenceFreq: e.target.value as "" | TaskRecurrenceFreq } : prev,
                  )
                }
                className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
                aria-label="Récurrence"
              >
                <option value="">Sans récurrence</option>
                <option value="daily">Chaque jour</option>
                <option value="weekly">Chaque semaine</option>
                <option value="monthly">Chaque mois</option>
              </select>

              <input
                type="date"
                value={draft.recurrenceUntil}
                onChange={(e) => setDraft((prev) => (prev ? { ...prev, recurrenceUntil: e.target.value } : prev))}
                className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
                aria-label="Récurrence jusqu’au"
                disabled={!draft.recurrenceFreq}
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              {draft.taskId ? (
                <div className="inline-flex items-center gap-3">
                  <button
                    type="button"
                    className="sn-text-btn"
                    onClick={() => {
                      if (!draft.taskId) return;
                      onOpenTask(draft.taskId);
                    }}
                  >
                    Ouvrir le détail
                  </button>
                  {draft.recurrenceFreq && draft.instanceDate && onSkipOccurrence && (
                    <button type="button" className="sn-text-btn" onClick={skipOccurrence}>
                      Ignorer cette occurrence
                    </button>
                  )}
                </div>
              ) : (
                <span />
              )}

              <div className="inline-flex items-center gap-2">
                <button type="button" className="sn-text-btn" onClick={() => setDraft(null)}>
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={saveDraft}
                  disabled={saving}
                  className="inline-flex items-center justify-center h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium"
                >
                  {saving ? "Enregistrement…" : "Enregistrer"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
