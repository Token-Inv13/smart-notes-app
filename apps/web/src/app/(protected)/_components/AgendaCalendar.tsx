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

interface CalendarDraft {
  taskId?: string;
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
  onOpenTask,
  onVisibleRangeChange,
}: AgendaCalendarProps) {
  const calendarRef = useRef<FullCalendar | null>(null);
  const [viewMode, setViewMode] = useState<CalendarViewMode>("timeGridWeek");
  const [visibleRange, setVisibleRange] = useState<{ start: Date; end: Date } | null>(null);
  const [navDate, setNavDate] = useState(toLocalDateInputValue(new Date()));
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<CalendarDraft | null>(null);

  const events = useMemo(() => {
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

      const looksAllDay =
        start.getHours() === 0 &&
        start.getMinutes() === 0 &&
        end.getHours() === 0 &&
        end.getMinutes() === 0;

      output.push({
        id: eventId,
        title: task.title,
        start,
        end,
        allDay: looksAllDay,
        backgroundColor: priorityColor((task.priority ?? "") as Priority | ""),
        borderColor: priorityColor((task.priority ?? "") as Priority | ""),
        extendedProps: {
          taskId,
          workspaceId: task.workspaceId ?? "",
          workspaceName: workspaces.find((ws) => ws.id === task.workspaceId)?.name ?? "Sans dossier",
          priority: (task.priority ?? "") as Priority | "",
          recurrence,
          instanceDate,
          conflict: conflictIds.has(eventId),
        },
      });
    }
    return output;
  }, [tasks, visibleRange, workspaces]);

  const openDraftFromSelect = (arg: DateSelectArg) => {
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
    const start = arg.event.start;
    const end = arg.event.end;
    if (!start || !end) return;
    const recurrence = (arg.event.extendedProps.recurrence as TaskDoc["recurrence"] | null) ?? null;

    setDraft({
      taskId: ((arg.event.extendedProps.taskId as string) || arg.event.id) as string,
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
      if (!taskId || !start || !end) {
        arg.revert();
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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isEditing = tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable;
      if (isEditing) return;

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
  }, [openQuickDraft]);

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

      {error && <div className="sn-alert sn-alert--error">{error}</div>}

      <div className="sn-card p-2">
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
          events={events}
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
      </div>

      <div className="text-xs text-muted-foreground">
        Raccourcis: N (nouvel élément), / (recherche), ←/→ (navigation).
      </div>

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
