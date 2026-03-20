import { useCallback, useState } from "react";
import type { DateSelectArg, EventClickArg } from "@fullcalendar/core";
import { toUserErrorMessage } from "@/lib/userError";
import type { Priority, TaskCalendarKind, TaskDoc, TaskRecurrenceFreq } from "@/types/firestore";
import {
  parseDateFromDraft,
  toLocalDateInputValue,
  toLocalInputValue,
} from "./agendaCalendarUtils";

type CalendarRecurrenceInput = {
  freq: TaskRecurrenceFreq;
  interval?: number;
  until?: Date | null;
  exceptions?: string[];
} | null;

export interface CalendarDraft {
  taskId?: string;
  instanceDate?: string;
  title: string;
  startLocal: string;
  endLocal: string;
  allDay: boolean;
  workspaceId: string;
  priority: "" | Priority;
  calendarKind: TaskCalendarKind;
  recurrenceFreq: "" | TaskRecurrenceFreq;
  recurrenceUntil: string;
  recurrenceInterval: number;
  recurrenceExceptions: string[];
}

type UseAgendaDraftManagerParams = {
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
  setError: (value: string | null) => void;
};

export function useAgendaDraftManager({
  onCreateEvent,
  onUpdateEvent,
  onSkipOccurrence,
  setError,
}: UseAgendaDraftManagerParams) {
  const [draft, setDraft] = useState<CalendarDraft | null>(null);
  const [editScope, setEditScope] = useState<"series" | "occurrence">("series");
  const [saving, setSaving] = useState(false);

  const openDraftFromSelect = useCallback((arg: DateSelectArg) => {
    const isTimeGridSelection = arg.view.type === "timeGridWeek" || arg.view.type === "timeGridDay";
    const allDaySelection = isTimeGridSelection ? false : arg.allDay;
    const normalizedEnd =
      arg.end.getTime() > arg.start.getTime() ? arg.end : new Date(arg.start.getTime() + 60 * 60 * 1000);

    setEditScope("series");
    setDraft({
      title: "",
      startLocal: allDaySelection ? toLocalDateInputValue(arg.start) : toLocalInputValue(arg.start),
      endLocal: allDaySelection
        ? toLocalDateInputValue(new Date(normalizedEnd.getTime() - 1))
        : toLocalInputValue(normalizedEnd),
      allDay: allDaySelection,
      workspaceId: "",
      priority: "",
      calendarKind: "task",
      recurrenceFreq: "",
      recurrenceUntil: "",
      recurrenceInterval: 1,
      recurrenceExceptions: [],
    });
  }, []);

  const openDraftFromEvent = useCallback((arg: EventClickArg) => {
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
      calendarKind: ((arg.event.extendedProps.calendarKind as TaskCalendarKind | null) ?? "task") as TaskCalendarKind,
      recurrenceFreq: recurrence?.freq ?? "",
      recurrenceUntil: recurrence?.until?.toDate ? toLocalDateInputValue(recurrence.until.toDate()) : "",
      recurrenceInterval: Math.max(1, Number(recurrence?.interval ?? 1)),
      recurrenceExceptions: Array.isArray(recurrence?.exceptions) ? recurrence.exceptions : [],
    });
  }, []);

  const saveDraft = useCallback(async () => {
    if (!draft) return;

    const isBirthday = draft.calendarKind === "birthday";
    const effectiveAllDay = isBirthday ? true : draft.allDay;
    const effectiveRecurrenceFreq = isBirthday ? "yearly" : draft.recurrenceFreq;

    const start = parseDateFromDraft(draft.startLocal, effectiveAllDay);
    const end = parseDateFromDraft(draft.endLocal, effectiveAllDay);
    if (!start || !end) {
      setError("Date/heure invalide.");
      return;
    }

    const allDayEnd = effectiveAllDay
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

    const recurrence = effectiveRecurrenceFreq
      ? {
          freq: effectiveRecurrenceFreq,
          interval: Math.max(1, Number(draft.recurrenceInterval || 1)),
          until: draft.recurrenceUntil ? new Date(`${draft.recurrenceUntil}T23:59:59`) : null,
          exceptions: draft.recurrenceExceptions,
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
          allDay: effectiveAllDay,
          workspaceId: draft.workspaceId || null,
          priority: draft.priority || null,
          calendarKind: draft.calendarKind,
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
          allDay: effectiveAllDay,
          workspaceId: draft.workspaceId || null,
          priority: draft.priority || null,
          calendarKind: draft.calendarKind,
          recurrence,
        });
      } else {
        await onCreateEvent({
          title: draft.title.trim(),
          start,
          end: allDayEnd,
          allDay: effectiveAllDay,
          workspaceId: draft.workspaceId || null,
          priority: draft.priority || null,
          calendarKind: draft.calendarKind,
          recurrence,
        });
      }
      setDraft(null);
    } catch (e) {
      setError(toUserErrorMessage(e, "Erreur de sauvegarde."));
    } finally {
      setSaving(false);
    }
  }, [draft, editScope, onCreateEvent, onSkipOccurrence, onUpdateEvent, setError]);

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
      calendarKind: "task",
      recurrenceFreq: "",
      recurrenceUntil: "",
      recurrenceInterval: 1,
      recurrenceExceptions: [],
    });
  }, []);

  const skipOccurrence = useCallback(async () => {
    if (!draft?.taskId || !draft.instanceDate || !draft.recurrenceFreq || !onSkipOccurrence) return;
    setSaving(true);
    setError(null);
    try {
      await onSkipOccurrence(draft.taskId, draft.instanceDate);
      setDraft(null);
    } catch (e) {
      setError(toUserErrorMessage(e, "Impossible d’ignorer cette occurrence."));
    } finally {
      setSaving(false);
    }
  }, [draft, onSkipOccurrence, setError]);

  return {
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
  };
}
