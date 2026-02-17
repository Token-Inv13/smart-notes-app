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

export function parseDateFromDraft(raw: string, allDay: boolean) {
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  if (!allDay) return date;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
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
