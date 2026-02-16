import { httpsCallable } from 'firebase/functions';
import { functions as fbFunctions } from '@/lib/firebase';
import type {
  AdminActionResponse,
  AdminAuditLogItem,
  AdminCursor,
  AdminErrorLogItem,
  AdminListUsersIndexParams,
  AdminListUsersIndexResponse,
  AdminLookupUserResult,
  AdminRebuildUsersIndexResponse,
  AdminUserActivityEvent,
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

export async function listUsersIndex(params?: AdminListUsersIndexParams): Promise<AdminListUsersIndexResponse> {
  const fn = httpsCallable<AdminListUsersIndexParams, AdminListUsersIndexResponse>(fbFunctions, 'adminListUsersIndex');
  const res = await fn(params ?? {});
  return res.data;
}

export async function rebuildUsersIndex(params?: {
  batchSize?: number;
  cursorUid?: string | null;
}): Promise<AdminRebuildUsersIndexResponse> {
  const fn = httpsCallable<{ batchSize?: number; cursorUid?: string | null }, AdminRebuildUsersIndexResponse>(
    fbFunctions,
    'rebuildAdminUsersIndex',
  );
  const res = await fn(params ?? {});
  return res.data;
}

export async function listUserActivityEvents(params: {
  targetUserUid: string;
  limit?: number;
  cursor?: AdminCursor | null;
  type?: string;
}): Promise<{ events: AdminUserActivityEvent[]; nextCursor: AdminCursor | null }> {
  const fn = httpsCallable<
    { targetUserUid: string; limit?: number; cursor?: AdminCursor | null; type?: string },
    { events: AdminUserActivityEvent[]; nextCursor: AdminCursor | null }
  >(fbFunctions, 'adminListUserActivityEvents');
  const res = await fn(params);
  return res.data;
}

export async function sendUserMessage(params: {
  targetUserUid: string;
  title: string;
  body: string;
  severity?: 'info' | 'warn' | 'critical';
}): Promise<AdminActionResponse> {
  const fn = httpsCallable<
    { targetUserUid: string; title: string; body: string; severity?: 'info' | 'warn' | 'critical' },
    AdminActionResponse
  >(fbFunctions, 'adminSendUserMessage');
  const res = await fn(params);
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
