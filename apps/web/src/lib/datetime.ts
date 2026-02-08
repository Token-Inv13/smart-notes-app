import { Timestamp } from 'firebase/firestore';

/**
 * Parse an HTML datetime-local string (e.g. "2025-11-16T20:30")
 * into a Firestore Timestamp. Returns null if empty/invalid.
 */
export function parseLocalDateTimeToTimestamp(value: string): Timestamp | null {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return Timestamp.fromDate(date);
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
  return Timestamp.fromDate(d);
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
