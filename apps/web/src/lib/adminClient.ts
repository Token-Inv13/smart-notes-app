import { httpsCallable } from 'firebase/functions';
import { functions as fbFunctions } from '@/lib/firebase';
import type {
  AdminActionResponse,
  AdminAuditLogItem,
  AdminCursor,
  AdminErrorLogItem,
  AdminLookupUserResult,
} from '@/types/admin';

export async function lookupUser(query: string): Promise<AdminLookupUserResult> {
  const fn = httpsCallable<{ query: string }, AdminLookupUserResult>(fbFunctions, 'adminLookupUser');
  const res = await fn({ query });
  return res.data;
}

export async function revokeUserSessions(targetUserUid: string): Promise<AdminActionResponse> {
  const fn = httpsCallable<{ targetUserUid: string }, AdminActionResponse>(fbFunctions, 'adminRevokeUserSessions');
  const res = await fn({ targetUserUid });
  return res.data;
}

export async function enableUserPremium(params: {
  targetUserUid: string;
  durationDays: number;
}): Promise<AdminActionResponse> {
  const fn = httpsCallable<{ targetUserUid: string; durationDays: number }, AdminActionResponse>(
    fbFunctions,
    'adminEnablePremium',
  );
  const res = await fn(params);
  return res.data;
}

export async function disableUserPremium(targetUserUid: string): Promise<AdminActionResponse> {
  const fn = httpsCallable<{ targetUserUid: string }, AdminActionResponse>(fbFunctions, 'adminDisablePremium');
  const res = await fn({ targetUserUid });
  return res.data;
}

export async function resetUserFlags(targetUserUid: string): Promise<AdminActionResponse> {
  const fn = httpsCallable<{ targetUserUid: string }, AdminActionResponse>(fbFunctions, 'adminResetUserFlags');
  const res = await fn({ targetUserUid });
  return res.data;
}

export async function listAuditLogs(params?: {
  limit?: number;
  cursor?: AdminCursor | null;
  targetUserUid?: string;
  action?: string;
}): Promise<{ logs: AdminAuditLogItem[]; nextCursor: AdminCursor | null }> {
  const fn = httpsCallable<
    { limit?: number; cursor?: AdminCursor | null; targetUserUid?: string; action?: string },
    { logs: AdminAuditLogItem[]; nextCursor: AdminCursor | null }
  >(fbFunctions, 'adminListAuditLogs');
  const res = await fn(params ?? {});
  return res.data;
}

export async function listErrorLogs(params?: {
  limit?: number;
  cursor?: AdminCursor | null;
  category?: string;
}): Promise<{ logs: AdminErrorLogItem[]; nextCursor: AdminCursor | null }> {
  const fn = httpsCallable<
    { limit?: number; cursor?: AdminCursor | null; category?: string },
    { logs: AdminErrorLogItem[]; nextCursor: AdminCursor | null }
  >(fbFunctions, 'adminListErrorLogs');
  const res = await fn(params ?? {});
  return res.data;
}
