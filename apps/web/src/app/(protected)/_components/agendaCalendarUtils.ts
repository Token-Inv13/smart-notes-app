import type { Priority, TaskRecurrenceFreq } from "@/types/firestore";

export const CALENDAR_FILTERS_STORAGE_KEY = "agenda-calendar-filters-v1";
export const CALENDAR_PREFERENCES_STORAGE_KEY = "agenda-calendar-preferences-v1";

export function toLocalInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function toLocalDateInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toHourMinuteLabel(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function parseLocalDateOnly(raw: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return null;

  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  if (!Number.isFinite(yyyy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null;

  const date = new Date(yyyy, mm - 1, dd, 0, 0, 0, 0);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== yyyy ||
    date.getMonth() !== mm - 1 ||
    date.getDate() !== dd
  ) {
    return null;
  }

  return date;
}

function parseLocalDateTime(raw: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (!m) return null;

  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  const hh = Number(m[4]);
  const min = Number(m[5]);
  const ss = m[6] ? Number(m[6]) : 0;
  if (
    !Number.isFinite(yyyy) ||
    !Number.isFinite(mm) ||
    !Number.isFinite(dd) ||
    !Number.isFinite(hh) ||
    !Number.isFinite(min) ||
    !Number.isFinite(ss)
  ) {
    return null;
  }

  const date = new Date(yyyy, mm - 1, dd, hh, min, ss, 0);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== yyyy ||
    date.getMonth() !== mm - 1 ||
    date.getDate() !== dd ||
    date.getHours() !== hh ||
    date.getMinutes() !== min ||
    date.getSeconds() !== ss
  ) {
    return null;
  }

  return date;
}

export function parseDateFromDraft(raw: string, allDay: boolean) {
  if (!raw) return null;

  const parsed = allDay ? parseLocalDateOnly(raw) : parseLocalDateTime(raw);
  if (!parsed && process.env.NODE_ENV !== "production") {
    console.warn("[agendaCalendar] Invalid draft date", { raw, allDay });
  }
  return parsed;
}

export function priorityColor(priority: Priority | "") {
  if (priority === "high") return "#ef4444";
  if (priority === "medium") return "#f59e0b";
  if (priority === "low") return "#10b981";
  return "#3b82f6";
}

export function addRecurrenceStep(base: Date, freq: TaskRecurrenceFreq, interval: number) {
  const next = new Date(base);
  if (freq === "daily") next.setDate(next.getDate() + interval);
  else if (freq === "weekly") next.setDate(next.getDate() + interval * 7);
  else next.setMonth(next.getMonth() + interval);
  return next;
}

export function overlapsRange(start: Date, end: Date, rangeStart: Date, rangeEnd: Date) {
  return end.getTime() > rangeStart.getTime() && start.getTime() < rangeEnd.getTime();
}

export function priorityConflictWeight(priority: unknown) {
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}
