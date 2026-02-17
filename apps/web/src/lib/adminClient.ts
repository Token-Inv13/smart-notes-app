import { httpsCallable } from 'firebase/functions';
import { functions as fbFunctions } from '@/lib/firebase';
import type {
  AdminActionResponse,
  AdminAuditLogItem,
  AdminBroadcastPreview,
  AdminCursor,
  AdminErrorLogItem,
  AdminListUsersIndexParams,
  AdminListUsersIndexResponse,
  AdminHealthSummary,
  AdminLookupUserResult,
  AdminOperatorDashboard,
  AdminRebuildUsersIndexResponse,
  AdminUserMessagingStats,
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

export async function softDeleteUser(targetUserUid: string): Promise<AdminActionResponse> {
  const fn = httpsCallable<{ targetUserUid: string }, AdminActionResponse>(fbFunctions, 'adminSoftDeleteUser');
  const res = await fn({ targetUserUid });
  return res.data;
}

export async function hardDeleteUser(params: {
  targetUserUid: string;
  confirmationText: string;
  hardDeleteConfirmed: boolean;
}): Promise<AdminActionResponse> {
  const fn = httpsCallable<
    { targetUserUid: string; confirmationText: string; hardDeleteConfirmed: boolean },
    AdminActionResponse
  >(fbFunctions, 'adminHardDeleteUser');
  const res = await fn(params);
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

export async function previewBroadcastMessage(params: {
  segment: 'all' | 'premium' | 'inactive' | 'tag';
  tag?: string;
}): Promise<AdminBroadcastPreview> {
  const fn = httpsCallable<
    { segment: 'all' | 'premium' | 'inactive' | 'tag'; tag?: string },
    AdminBroadcastPreview
  >(fbFunctions, 'adminPreviewBroadcastMessage');
  const res = await fn(params);
  return res.data;
}

export async function sendBroadcastMessage(params: {
  segment: 'all' | 'premium' | 'inactive' | 'tag';
  tag?: string;
  title: string;
  body: string;
  severity?: 'info' | 'warn' | 'critical';
}): Promise<AdminActionResponse> {
  const fn = httpsCallable<
    {
      segment: 'all' | 'premium' | 'inactive' | 'tag';
      tag?: string;
      title: string;
      body: string;
      severity?: 'info' | 'warn' | 'critical';
    },
    AdminActionResponse
  >(fbFunctions, 'adminSendBroadcastMessage');
  const res = await fn(params);
  return res.data;
}

export async function previewSegmentEmail(params: {
  segment: 'all' | 'premium' | 'inactive' | 'tag';
  tag?: string;
  subject?: string;
}): Promise<AdminBroadcastPreview> {
  const fn = httpsCallable<
    { segment: 'all' | 'premium' | 'inactive' | 'tag'; tag?: string; subject?: string },
    AdminBroadcastPreview
  >(fbFunctions, 'adminPreviewSegmentEmail');
  const res = await fn(params);
  return res.data;
}

export async function sendUserEmail(params: {
  targetUserUid: string;
  subject: string;
  html: string;
}): Promise<AdminActionResponse> {
  const fn = httpsCallable<{ targetUserUid: string; subject: string; html: string }, AdminActionResponse>(
    fbFunctions,
    'adminSendUserEmail',
  );
  const res = await fn(params);
  return res.data;
}

export async function sendSegmentEmail(params: {
  segment: 'all' | 'premium' | 'inactive' | 'tag';
  tag?: string;
  subject: string;
  html: string;
}): Promise<AdminActionResponse> {
  const fn = httpsCallable<
    { segment: 'all' | 'premium' | 'inactive' | 'tag'; tag?: string; subject: string; html: string },
    AdminActionResponse
  >(fbFunctions, 'adminSendSegmentEmail');
  const res = await fn(params);
  return res.data;
}

export async function getUserMessagingStats(params: {
  targetUserUid: string;
  windowHours?: number;
}): Promise<AdminUserMessagingStats> {
  const fn = httpsCallable<{ targetUserUid: string; windowHours?: number }, AdminUserMessagingStats>(
    fbFunctions,
    'adminGetUserMessagingStats',
  );
  const res = await fn(params);
  return res.data;
}

export async function getAdminHealthSummary(params?: {
  windowHours?: number;
}): Promise<AdminHealthSummary> {
  const fn = httpsCallable<{ windowHours?: number }, AdminHealthSummary>(fbFunctions, 'adminGetHealthSummary');
  const res = await fn(params ?? {});
  return res.data;
}

export async function getOperatorDashboard(): Promise<AdminOperatorDashboard> {
  const fn = httpsCallable<Record<string, never>, AdminOperatorDashboard>(fbFunctions, 'adminGetOperatorDashboard');
  const res = await fn({});
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
