import * as admin from 'firebase-admin';
import { UserPlan } from './types';

export function readEnvNumber(name: string, fallback: number): number {
  const raw = typeof process.env[name] === 'string' ? process.env[name]?.trim() : '';
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

export function readEnvString(name: string): string {
  const raw = process.env[name];
  return typeof raw === 'string' ? raw.trim() : '';
}

export function toFirestoreTimestamp(ms: number | null | undefined): admin.firestore.Timestamp | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  return admin.firestore.Timestamp.fromMillis(ms);
}

export function readUserPlan(userSnap: FirebaseFirestore.DocumentSnapshot): UserPlan {
  const plan = userSnap.exists && typeof userSnap.data()?.plan === 'string' ? String(userSnap.data()?.plan) : 'free';
  return plan === 'pro' ? 'pro' : 'free';
}

export async function getUserPlanInTransaction(
  tx: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  userId: string,
): Promise<UserPlan> {
  const userSnap = await tx.get(db.collection('users').doc(userId));
  return readUserPlan(userSnap);
}

export function parseChecklistScheduleDate(dateRaw: string, timeRaw: string): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateRaw);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeRaw);
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
  if (parsed.getHours() !== hour || parsed.getMinutes() !== minute) return null;
  return parsed;
}

export function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
