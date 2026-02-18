import type { Priority, TaskDoc, TaskRecurrenceFreq } from "@/types/firestore";

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

function isMidnightLocal(d: Date) {
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0;
}

function isMultipleOfDaysMs(ms: number) {
  const dayMs = 24 * 60 * 60 * 1000;
  return ms > 0 && ms % dayMs === 0;
}

export function taskToAgendaEventWindow(task: TaskDoc): { start: Date | null; end: Date | null; allDay: boolean } {
  const startRaw = task.startDate?.toDate?.() ?? null;
  const dueRaw = task.dueDate?.toDate?.() ?? null;

  const start = startRaw ?? dueRaw;
  if (!start) return { start: null, end: null, allDay: false };

  const fallbackTimedEnd = new Date(start.getTime() + 60 * 60 * 1000);
  const fallbackAllDayEnd = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  const end = dueRaw && dueRaw.getTime() > start.getTime() ? dueRaw : fallbackTimedEnd;

  const inferredAllDay = (() => {
    if (!startRaw || !dueRaw) return false;
    if (!isMidnightLocal(startRaw) || !isMidnightLocal(dueRaw)) return false;
    return isMultipleOfDaysMs(dueRaw.getTime() - startRaw.getTime());
  })();

  const finalEnd = inferredAllDay ? (dueRaw && dueRaw.getTime() > start.getTime() ? dueRaw : fallbackAllDayEnd) : end;

  if (process.env.NODE_ENV !== "production") {
    if (startRaw === null && dueRaw !== null) {
      // Legacy/incorrect docs: dueDate used as start.
      console.warn("[agendaCalendar] Task missing startDate; falling back to dueDate as start", {
        taskId: task.id,
        dueDate: dueRaw,
      });
    }
  }

  return {
    start,
    end: finalEnd,
    allDay: inferredAllDay,
  };
}

export function priorityConflictWeight(priority: unknown) {
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}
