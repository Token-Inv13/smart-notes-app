import { Timestamp } from 'firebase/firestore';

export function getUserTimezone(): string {
  if (typeof window !== 'undefined') {
    const maybeWindow = window as Window & { __SMARTNOTES_TEST_TIMEZONE__?: unknown };
    if (typeof maybeWindow.__SMARTNOTES_TEST_TIMEZONE__ === 'string' && maybeWindow.__SMARTNOTES_TEST_TIMEZONE__.trim()) {
      return maybeWindow.__SMARTNOTES_TEST_TIMEZONE__;
    }
  }

  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof tz === 'string' && tz.trim()) return tz;
  } catch {
    // ignore runtime Intl issues
  }

  return 'UTC';
}

export function normalizeDateForFirestore(date: Date | null | undefined): Timestamp | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  return Timestamp.fromDate(new Date(date.getTime()));
}

export function isExactAllDayWindow(start: Date, end: Date) {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  if (start.getHours() !== 0 || start.getMinutes() !== 0 || start.getSeconds() !== 0 || start.getMilliseconds() !== 0) {
    return false;
  }
  if (end.getHours() !== 0 || end.getMinutes() !== 0 || end.getSeconds() !== 0 || end.getMilliseconds() !== 0) {
    return false;
  }
  return end.getTime() - start.getTime() === 24 * 60 * 60 * 1000;
}

export function normalizeAgendaWindowForFirestore(input: { start: Date; end: Date; allDay: boolean }) {
  const { start, end, allDay } = input;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  if (allDay) {
    const normalizedStart = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
    const normalizedEnd = new Date(normalizedStart.getTime() + 24 * 60 * 60 * 1000);
    return {
      startDate: normalizeDateForFirestore(normalizedStart),
      dueDate: normalizeDateForFirestore(normalizedEnd),
      allDay: true,
    };
  }

  const normalizedEnd = end.getTime() > start.getTime() ? new Date(end.getTime()) : new Date(start.getTime() + 60 * 60 * 1000);
  return {
    startDate: normalizeDateForFirestore(start),
    dueDate: normalizeDateForFirestore(normalizedEnd),
    allDay: false,
  };
}

/**
 * Parse an HTML datetime-local string (e.g. "2025-11-16T20:30")
 * into a Firestore Timestamp. Returns null if empty/invalid.
 */
export function parseLocalDateTimeToTimestamp(value: string): Timestamp | null {
  if (!value) return null;

  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
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

  return normalizeDateForFirestore(date);
}

/**
 * Format a Firestore Timestamp into a human-readable local string.
 * Returns an empty string if the timestamp is null/undefined.
 */
export function formatTimestampToLocalString(ts: Timestamp | null | undefined): string {
  if (!ts) return '';
  return ts.toDate().toLocaleString();
}

/**
 * Format a Timestamp into the value expected by an <input type="datetime-local">.
 */
export function formatTimestampForInput(ts: Timestamp | null | undefined): string {
  if (!ts) return '';
  const date = ts.toDate();

  // datetime-local expects a *local* date/time string (no timezone).
  // Using toISOString() would convert to UTC and shift the displayed time.
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

export function parseLocalDateToTimestamp(value: string): Timestamp | null {
  if (!value) return null;
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value);
  if (!m) return null;
  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  if (!yyyy || !mm || !dd) return null;
  const d = new Date(yyyy, mm - 1, dd, 0, 0, 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  return normalizeDateForFirestore(d);
}

export function formatTimestampForDateInput(ts: Timestamp | null | undefined): string {
  if (!ts) return '';
  const date = ts.toDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  return `${yyyy}-${mm}-${dd}`;
}
