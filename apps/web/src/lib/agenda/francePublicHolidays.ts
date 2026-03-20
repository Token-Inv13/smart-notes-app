import type { EventInput } from "@fullcalendar/core";

type HolidayDefinition = {
  name: string;
  month: number;
  day: number;
};

const FIXED_FRANCE_PUBLIC_HOLIDAYS: HolidayDefinition[] = [
  { name: "Jour de l’An", month: 0, day: 1 },
  { name: "Fête du Travail", month: 4, day: 1 },
  { name: "Victoire 1945", month: 4, day: 8 },
  { name: "Fête nationale", month: 6, day: 14 },
  { name: "Assomption", month: 7, day: 15 },
  { name: "Toussaint", month: 10, day: 1 },
  { name: "Armistice 1918", month: 10, day: 11 },
  { name: "Noël", month: 11, day: 25 },
];

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function computeEasterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function buildHolidayEvent(id: string, title: string, start: Date): EventInput {
  return {
    id,
    title,
    start,
    end: addDays(start, 1),
    allDay: true,
    editable: false,
    startEditable: false,
    durationEditable: false,
    backgroundColor: "#64748b",
    borderColor: "#64748b",
    classNames: ["agenda-event", "agenda-event-holiday", "agenda-priority-none"],
    extendedProps: {
      workspaceName: "Jour férié",
      source: "holiday",
      conflict: false,
    },
  } satisfies EventInput;
}

export function buildFrancePublicHolidayEvents(window: { start: Date; end: Date }): EventInput[] {
  const startYear = window.start.getFullYear();
  const endYear = window.end.getFullYear();
  const windowStart = startOfDay(window.start).getTime();
  const windowEnd = startOfDay(window.end).getTime();
  const events: EventInput[] = [];

  for (let year = startYear; year <= endYear; year += 1) {
    for (const holiday of FIXED_FRANCE_PUBLIC_HOLIDAYS) {
      const start = new Date(year, holiday.month, holiday.day, 0, 0, 0, 0);
      const startMs = start.getTime();
      if (startMs < windowStart || startMs >= windowEnd) continue;
      events.push(buildHolidayEvent(`holiday__fr__${year}__${holiday.month + 1}-${holiday.day}`, holiday.name, start));
    }

    const easterSunday = computeEasterSunday(year);
    const movingHolidays = [
      { name: "Lundi de Pâques", start: addDays(easterSunday, 1) },
      { name: "Ascension", start: addDays(easterSunday, 39) },
      { name: "Lundi de Pentecôte", start: addDays(easterSunday, 50) },
    ];

    for (const holiday of movingHolidays) {
      const start = holiday.start;
      const startMs = start.getTime();
      if (startMs < windowStart || startMs >= windowEnd) continue;
      events.push(
        buildHolidayEvent(
          `holiday__fr__${year}__${start.getMonth() + 1}-${start.getDate()}`,
          holiday.name,
          start,
        ),
      );
    }
  }

  return events.sort((a, b) => {
    const aStart = a.start instanceof Date ? a.start.getTime() : 0;
    const bStart = b.start instanceof Date ? b.start.getTime() : 0;
    return aStart - bStart;
  });
}
