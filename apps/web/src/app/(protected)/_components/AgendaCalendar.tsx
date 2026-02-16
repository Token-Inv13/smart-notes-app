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
  overlapsRange,
  priorityColor,
  toHourMinuteLabel,
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
import type { TaskDoc, WorkspaceDoc, Priority, TaskRecurrenceFreq } from "@/types/firestore";

type CalendarViewMode = "dayGridMonth" | "timeGridWeek" | "timeGridDay";
type AgendaDisplayMode = "calendar" | "planning";

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
        classNames: ["agenda-event", "agenda-event-local", `agenda-priority-${itemPriority || "none"}`],
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
  });

  const changeView = (next: CalendarViewMode) => {
    setViewMode(next);
    calendarRef.current?.getApi().changeView(next);
  };

  const onDatesSet = (arg: DatesSetArg) => {
    setLabel(arg.view.title);
    setVisibleRange({ start: arg.start, end: arg.end });
    onVisibleRangeChange?.({ start: arg.start, end: arg.end });
  };

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
                <select
                  value={String(planningAvailabilityTargetMinutes)}
                  onChange={(e) => setPlanningAvailabilityTargetMinutes(Number(e.target.value))}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  aria-label="Durée cible des disponibilités"
                >
                  <option value="30">Slots ≥ 30 min</option>
                  <option value="45">Slots ≥ 45 min</option>
                  <option value="60">Slots ≥ 60 min</option>
                  <option value="90">Slots ≥ 90 min</option>
                </select>
                <button
                  type="button"
                  className="h-8 px-3 rounded-md border border-border bg-background text-xs"
                  onClick={() => void duplicatePlanningSelectionByDays(1)}
                  disabled={selectedPlanningIds.length === 0 || duplicatingPlanning}
                >
                  {duplicatingPlanning ? "Duplication…" : "J+1"}
                </button>
                <button
                  type="button"
                  className="h-8 px-3 rounded-md border border-border bg-background text-xs"
                  onClick={() => void duplicatePlanningSelectionByDays(7)}
                  disabled={selectedPlanningIds.length === 0 || duplicatingPlanning}
                >
                  Semaine +1
                </button>
                <input
                  type="date"
                  value={planningDuplicateDate}
                  onChange={(e) => setPlanningDuplicateDate(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  aria-label="Date cible de duplication"
                />
                <button
                  type="button"
                  className="h-8 px-3 rounded-md border border-border bg-background text-xs"
                  onClick={() => void duplicatePlanningSelectionToDate()}
                  disabled={selectedPlanningIds.length === 0 || duplicatingPlanning || !planningDuplicateDate}
                >
                  Copier à date
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
                        const conflictSource = (event.extendedProps?.conflictSource as "local" | "google" | "mix" | null) ?? null;
                        const conflictScore = typeof event.extendedProps?.conflictScore === "number" ? event.extendedProps.conflictScore : 0;
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
                                    {conflict && (
                                      <span className="text-[10px] text-red-600">
                                        Conflit {conflictSource === "google" ? "G" : conflictSource === "mix" ? "M" : "L"} · P{Math.min(9, conflictScore)}
                                      </span>
                                    )}
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
                        <div className="text-[11px] font-semibold text-muted-foreground">Créneaux disponibles (08:00-20:00, ≥ {planningAvailabilityTargetMinutes} min)</div>
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
