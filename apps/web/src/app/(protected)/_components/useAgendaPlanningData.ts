import { useMemo } from "react";
import type { EventInput } from "@fullcalendar/core";
import { toLocalDateInputValue } from "./agendaCalendarUtils";

export type PlanningSection = {
  dateKey: string;
  events: EventInput[];
};

export type PlanningAvailabilitySlot = {
  start: Date;
  end: Date;
  durationMinutes: number;
};

export function useAgendaPlanningData(params: {
  agendaEvents: EventInput[];
  planningAvailabilityTargetMinutes: number;
  planningWindow: { start: Date; end: Date } | null;
}) {
  const { agendaEvents, planningAvailabilityTargetMinutes, planningWindow } = params;

  const scopedEvents = useMemo(() => {
    if (!planningWindow) return agendaEvents;
    const windowStart = planningWindow.start.getTime();
    const windowEnd = planningWindow.end.getTime();
    if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd) || windowEnd <= windowStart) return agendaEvents;

    return agendaEvents.filter((event) => {
      const start = event.start instanceof Date ? event.start.getTime() : Number.NaN;
      const end = event.end instanceof Date ? event.end.getTime() : Number.NaN;
      if (!Number.isFinite(start)) return false;

      const safeEnd = Number.isFinite(end) && end > start ? end : start + 1;
      return start < windowEnd && safeEnd > windowStart;
    });
  }, [agendaEvents, planningWindow]);

  const planningSections = useMemo<PlanningSection[]>(() => {
    const grouped = new Map<string, EventInput[]>();

    for (const event of scopedEvents) {
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
  }, [scopedEvents]);

  const planningAvailabilityByDate = useMemo<Map<string, PlanningAvailabilitySlot[]>>(() => {
    const dateMap = new Map<string, EventInput[]>();
    for (const event of scopedEvents) {
      if (!(event.start instanceof Date)) continue;
      const key = toLocalDateInputValue(event.start);
      const existing = dateMap.get(key) ?? [];
      existing.push(event);
      dateMap.set(key, existing);
    }

    const output = new Map<string, PlanningAvailabilitySlot[]>();
    const todayKey = toLocalDateInputValue(new Date());
    const minSlotMinutes = planningAvailabilityTargetMinutes;

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

      const free: PlanningAvailabilitySlot[] = [];
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
  }, [planningAvailabilityTargetMinutes, scopedEvents]);

  return {
    planningSections,
    planningAvailabilityByDate,
  };
}
