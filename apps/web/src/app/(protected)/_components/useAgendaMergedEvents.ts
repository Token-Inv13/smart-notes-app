import { useMemo } from "react";
import type { EventInput } from "@fullcalendar/core";
import { priorityConflictWeight } from "./agendaCalendarUtils";

type GoogleCalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
};

type CalendarData = {
  events: EventInput[];
  stats: {
    total: number;
    displayed: number;
    recurring: number;
    conflicts: number;
  };
};

export function useAgendaMergedEvents(params: {
  calendarData: CalendarData;
  googleCalendarEvents: GoogleCalendarEvent[];
}) {
  const { calendarData, googleCalendarEvents } = params;

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
          classNames: ["agenda-event", "agenda-event-google", "agenda-priority-none"],
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

    const conflictById = new Map<string, { local: boolean; google: boolean; score: number }>();

    const bumpConflict = (event: EventInput, source: "local" | "google", withGoogle: boolean) => {
      const key = String(event.id);
      const current = conflictById.get(key) ?? { local: false, google: false, score: 0 };
      if (withGoogle) current.google = true;
      else current.local = true;

      const priorityWeight = source === "local" ? priorityConflictWeight(event.extendedProps?.priority) : 1;
      current.score += priorityWeight + (withGoogle ? 2 : 1);
      conflictById.set(key, current);
    };

    for (let i = 0; i < base.length; i += 1) {
      const left = base[i];
      if (!(left?.start instanceof Date) || !(left?.end instanceof Date)) continue;
      for (let j = i + 1; j < base.length; j += 1) {
        const right = base[j];
        if (!(right?.start instanceof Date) || !(right?.end instanceof Date)) continue;
        if (right.start.getTime() >= left.end.getTime()) break;

        const leftSource = left.extendedProps?.source === "google-calendar" ? "google" : "local";
        const rightSource = right.extendedProps?.source === "google-calendar" ? "google" : "local";
        const mixedSource = leftSource !== rightSource;

        bumpConflict(left, leftSource, mixedSource);
        bumpConflict(right, rightSource, mixedSource);
      }
    }

    return base.map((event) => {
      const conflict = conflictById.get(String(event.id));
      const hasConflict = Boolean(conflict);
      const conflictSource = conflict?.google ? (conflict.local ? "mix" : "google") : conflict?.local ? "local" : null;
      const classNames = Array.isArray(event.classNames) ? [...event.classNames] : [];
      if (hasConflict) classNames.push("agenda-event-conflict");
      if (event.extendedProps?.source === "google-calendar") classNames.push("agenda-source-google");
      else classNames.push("agenda-source-local");
      return {
        ...event,
        classNames,
        extendedProps: {
          ...(event.extendedProps ?? {}),
          conflict: hasConflict,
          conflictSource,
          conflictScore: conflict?.score ?? 0,
        },
      } as EventInput;
    });
  }, [calendarData.events, googleCalendarEventInputs]);

  const agendaConflictCount = useMemo(
    () => agendaEvents.reduce((acc, event) => (event.extendedProps?.conflict === true ? acc + 1 : acc), 0),
    [agendaEvents],
  );

  const isCompactDensity = agendaConflictCount >= 8;

  return {
    agendaEvents,
    agendaConflictCount,
    isCompactDensity,
  };
}
