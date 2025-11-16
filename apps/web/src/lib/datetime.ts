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
  // YYYY-MM-DDTHH:MM for datetime-local
  const iso = date.toISOString();
  return iso.slice(0, 16);
}
