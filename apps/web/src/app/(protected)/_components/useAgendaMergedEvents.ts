import { useMemo } from "react";
import type { EventInput } from "@fullcalendar/core";
import { priorityConflictWeight } from "./agendaCalendarUtils";
import { buildFrancePublicHolidayEvents } from "@/lib/agenda/francePublicHolidays";

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

function parseEventBoundary(raw: string, allDay: boolean) {
  if (allDay && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function toEventSortTime(value: EventInput["start"]) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(`${value}T00:00:00`).getTime();
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
  }
  return 0;
}

export function useAgendaMergedEvents(params: {
  calendarData: CalendarData;
  googleCalendarEvents: GoogleCalendarEvent[];
  showGoogleCalendar: boolean;
  visibleRange: { start: Date; end: Date } | null;
}) {
  const { calendarData, googleCalendarEvents, showGoogleCalendar, visibleRange } = params;

  const googleCalendarEventInputs = useMemo(() => {
    if (!showGoogleCalendar) return [];
    return googleCalendarEvents
      .map((event) => {
        const start = parseEventBoundary(event.start, event.allDay);
        const end = parseEventBoundary(event.end, event.allDay);
        if (!start || !end) return null;

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
  }, [googleCalendarEvents, showGoogleCalendar]);

  const holidayEventInputs = useMemo(() => {
    if (!visibleRange) return [];
    return buildFrancePublicHolidayEvents(visibleRange);
  }, [visibleRange]);

  const agendaEvents = useMemo(() => {
    const base = Array.from(
      [...calendarData.events, ...googleCalendarEventInputs, ...holidayEventInputs].reduce((map, event) => {
        const key = String(event.id ?? "");
        if (!key || map.has(key)) return map;
        map.set(key, event);
        return map;
      }, new Map<string, EventInput>()).values(),
    ).sort((a, b) => {
      const startDiff = toEventSortTime(a.start) - toEventSortTime(b.start);
      if (startDiff !== 0) return startDiff;

      const leftId = String(a.id ?? "");
      const rightId = String(b.id ?? "");
      return leftId.localeCompare(rightId);
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

        const leftSource =
          left.extendedProps?.source === "google-calendar"
            ? "google"
            : left.extendedProps?.source === "holiday"
              ? "holiday"
              : "local";
        const rightSource =
          right.extendedProps?.source === "google-calendar"
            ? "google"
            : right.extendedProps?.source === "holiday"
              ? "holiday"
              : "local";
        if (leftSource === "holiday" || rightSource === "holiday") continue;
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
      else if (event.extendedProps?.source === "holiday") classNames.push("agenda-source-holiday");
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
  }, [calendarData.events, googleCalendarEventInputs, holidayEventInputs]);

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
