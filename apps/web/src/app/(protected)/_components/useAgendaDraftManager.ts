import { useCallback, useEffect, useRef, useState } from "react";
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
  favorite?: boolean;
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
  const draftRef = useRef<CalendarDraft | null>(null);
  const closedBySaveRef = useRef(false);

  useEffect(() => {
    draftRef.current = draft;
    if (draft) {
      closedBySaveRef.current = false;
    }
  }, [draft]);

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
    if (arg.event.extendedProps.source === "google-calendar" || arg.event.extendedProps.source === "holiday") {
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

    const draftSnapshot = draft;
    const editScopeSnapshot = editScope;

    const isBirthday = draftSnapshot.calendarKind === "birthday";
    const effectiveAllDay = isBirthday ? true : draftSnapshot.allDay;
    const effectiveRecurrenceFreq = isBirthday ? "yearly" : draftSnapshot.recurrenceFreq;

    const start = parseDateFromDraft(draftSnapshot.startLocal, effectiveAllDay);
    const end = parseDateFromDraft(draftSnapshot.endLocal, effectiveAllDay);
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

    if (!draftSnapshot.title.trim()) {
      setError("Le titre est obligatoire.");
      return;
    }

    const recurrence = effectiveRecurrenceFreq
      ? {
          freq: effectiveRecurrenceFreq,
          interval: Math.max(1, Number(draftSnapshot.recurrenceInterval || 1)),
          until: draftSnapshot.recurrenceUntil ? new Date(`${draftSnapshot.recurrenceUntil}T23:59:59`) : null,
          exceptions: draftSnapshot.recurrenceExceptions,
        }
      : null;

    setSaving(true);
    setError(null);
    try {
      if (draftSnapshot.taskId && draftSnapshot.instanceDate && draftSnapshot.recurrenceFreq && editScopeSnapshot === "occurrence") {
        if (!onSkipOccurrence) {
          setError("Impossible d’éditer cette occurrence pour le moment.");
          return;
        }

        closedBySaveRef.current = true;
        setDraft(null);
        await onSkipOccurrence(draftSnapshot.taskId, draftSnapshot.instanceDate);
        await onCreateEvent({
          title: draftSnapshot.title.trim(),
          start,
          end: allDayEnd,
          allDay: effectiveAllDay,
          workspaceId: draftSnapshot.workspaceId || null,
          priority: draftSnapshot.priority || null,
          favorite: draftSnapshot.favorite === true,
          calendarKind: draftSnapshot.calendarKind,
          recurrence: null,
        });
        return;
      }

      closedBySaveRef.current = true;
      setDraft(null);
      if (draftSnapshot.taskId) {
        await onUpdateEvent({
          taskId: draftSnapshot.taskId,
          title: draftSnapshot.title.trim(),
          start,
          end: allDayEnd,
          allDay: effectiveAllDay,
          workspaceId: draftSnapshot.workspaceId || null,
          priority: draftSnapshot.priority || null,
          calendarKind: draftSnapshot.calendarKind,
          recurrence,
        });
      } else {
        await onCreateEvent({
          title: draftSnapshot.title.trim(),
          start,
          end: allDayEnd,
          allDay: effectiveAllDay,
          workspaceId: draftSnapshot.workspaceId || null,
          priority: draftSnapshot.priority || null,
          favorite: draftSnapshot.favorite === true,
          calendarKind: draftSnapshot.calendarKind,
          recurrence,
        });
      }
    } catch (e) {
      if (closedBySaveRef.current) {
        setDraft(draftSnapshot);
        setEditScope(editScopeSnapshot);
        setError(toUserErrorMessage(e, "Erreur de sauvegarde."));
      } else {
        console.warn("agenda.draft_save_failed_after_reopen", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    } finally {
      closedBySaveRef.current = false;
      setSaving(false);
    }
  }, [draft, editScope, onCreateEvent, onSkipOccurrence, onUpdateEvent, setError]);

  const openQuickDraft = useCallback((input?: { startDate?: string | null; workspaceId?: string | null; favorite?: boolean }) => {
    setEditScope("series");
    const draftDate = input?.startDate ? parseDateFromDraft(input.startDate, true) : null;
    const isPrefilledAllDay = Boolean(draftDate);
    const start = draftDate ?? new Date();
    const end = isPrefilledAllDay ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1) : new Date(start.getTime() + 60 * 60 * 1000);
    setDraft({
      title: "",
      startLocal: isPrefilledAllDay ? toLocalDateInputValue(start) : toLocalInputValue(start),
      endLocal: isPrefilledAllDay ? toLocalDateInputValue(new Date(end.getTime() - 1)) : toLocalInputValue(end),
      allDay: isPrefilledAllDay,
      workspaceId: input?.workspaceId ?? "",
      priority: "",
      favorite: input?.favorite === true,
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
