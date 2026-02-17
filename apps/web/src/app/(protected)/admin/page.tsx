"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  disableUserPremium,
  enableUserPremium,
  getUserMessagingStats,
  listAuditLogs,
  listUserActivityEvents,
  listUsersIndex,
  lookupUser,
  rebuildUsersIndex,
  sendUserMessage,
  softDeleteUser,
  hardDeleteUser,
  resetUserFlags,
  revokeUserSessions,
} from '@/lib/adminClient';
import type {
  AdminAuditLogItem,
  AdminCursor,
  AdminLookupUserResult,
  AdminUserMessagingStats,
  AdminUserActivityEvent,
  AdminUserIndexItem,
  AdminUsersCursor,
  AdminUsersSortBy,
} from '@/types/admin';
import { trackEvent } from '@/lib/analytics';

function formatDateTime(ms: number | null | undefined) {
  if (!ms || !Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString('fr-FR');
}

function prettyPlan(plan: 'free' | 'pro') {
  return plan === 'pro' ? 'Premium' : 'Free';
}

function computeAccountHealth(user: AdminLookupUserResult): {
  label: 'Sain' | 'Inactif' | 'Erreurs' | 'Bloqué' | 'Supprimé' | 'Premium';
  toneClass: string;
  description: string;
} {
  const nowMs = Date.now();
  const premiumActive = user.premiumUntilMs != null && user.premiumUntilMs > nowMs;
  const inactiveThreshold = nowMs - 7 * 24 * 60 * 60 * 1000;
  const errorsThreshold = nowMs - 24 * 60 * 60 * 1000;
  const isInactive = user.lastSeenAtMs == null || user.lastSeenAtMs < inactiveThreshold;
  const hasRecentErrors = user.lastErrorAtMs != null && user.lastErrorAtMs >= errorsThreshold;

  if (user.status === 'deleted') {
    return {
      label: 'Supprimé',
      toneClass: 'bg-slate-900 text-white',
      description: 'Compte supprimé logiquement (soft delete).',
    };
  }
  if (user.status === 'blocked') {
    return {
      label: 'Bloqué',
      toneClass: 'bg-rose-100 text-rose-800',
      description: 'Compte bloqué: accès utilisateur restreint.',
    };
  }
  if (hasRecentErrors) {
    return {
      label: 'Erreurs',
      toneClass: 'bg-amber-100 text-amber-800',
      description: 'Erreurs récentes détectées (< 24h).',
    };
  }
  if (isInactive) {
    return {
      label: 'Inactif',
      toneClass: 'bg-slate-200 text-slate-700',
      description: 'Aucune activité récente (> 7 jours).',
    };
  }
  if (premiumActive || user.plan === 'pro') {
    return {
      label: 'Premium',
      toneClass: 'bg-violet-100 text-violet-800',
      description: 'Compte premium actif.',
    };
  }

  return {
    label: 'Sain',
    toneClass: 'bg-emerald-100 text-emerald-800',
    description: 'Compte actif sans anomalie récente.',
  };
}

export default function AdminPage() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupResult, setLookupResult] = useState<AdminLookupUserResult | null>(null);

  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [premiumDays, setPremiumDays] = useState(30);

  const [auditLogs, setAuditLogs] = useState<AdminAuditLogItem[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditCursor, setAuditCursor] = useState<AdminCursor | null>(null);
  const [auditFilterUserUid, setAuditFilterUserUid] = useState('');
  const [auditFilterAction, setAuditFilterAction] = useState('');

  const [activityEvents, setActivityEvents] = useState<AdminUserActivityEvent[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityCursor, setActivityCursor] = useState<AdminCursor | null>(null);
  const [activityTypeFilter, setActivityTypeFilter] = useState('');

  const [messageTitle, setMessageTitle] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [messageSeverity, setMessageSeverity] = useState<'info' | 'warn' | 'critical'>('info');
  const [messageSending, setMessageSending] = useState(false);
  const [messageInfo, setMessageInfo] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [messageStats, setMessageStats] = useState<AdminUserMessagingStats | null>(null);
  const [messageStatsLoading, setMessageStatsLoading] = useState(false);
  const [messageStatsError, setMessageStatsError] = useState<string | null>(null);

  const [recentUsers, setRecentUsers] = useState<string[]>([]);

  const [users, setUsers] = useState<AdminUserIndexItem[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [usersCursor, setUsersCursor] = useState<AdminUsersCursor | null>(null);
  const [usersSortBy, setUsersSortBy] = useState<AdminUsersSortBy>('createdAt');
  const [usersPageSize, setUsersPageSize] = useState<20 | 50>(20);
  const [usersQuery, setUsersQuery] = useState('');
  const [usersPremiumOnly, setUsersPremiumOnly] = useState(false);
  const [usersBlockedOnly, setUsersBlockedOnly] = useState(false);
  const [usersNewWithinHours, setUsersNewWithinHours] = useState('');
  const [usersInactiveDays, setUsersInactiveDays] = useState('');
  const [usersTagsInput, setUsersTagsInput] = useState('');
  const [rebuildLoading, setRebuildLoading] = useState(false);
  const [rebuildInfo, setRebuildInfo] = useState<string | null>(null);
  const [rebuildError, setRebuildError] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ open: boolean; title: string; message: string }>({
    open: false,
    title: '',
    message: '',
  });
  const confirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const [hardDeleteModalOpen, setHardDeleteModalOpen] = useState(false);
  const [hardDeleteText, setHardDeleteText] = useState('');
  const [hardDeleteChecked, setHardDeleteChecked] = useState(false);

  const canActOnUid = lookupResult?.uid ?? null;
  const accountHealth = lookupResult ? computeAccountHealth(lookupResult) : null;

  const effectiveUidFilter = useMemo(() => {
    const trimmed = auditFilterUserUid.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, [auditFilterUserUid]);

  const effectiveActionFilter = useMemo(() => {
    const trimmed = auditFilterAction.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, [auditFilterAction]);

  const effectiveUsersQuery = useMemo(() => {
    const trimmed = usersQuery.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, [usersQuery]);

  const effectiveUsersTags = useMemo(
    () => usersTagsInput.split(',').map((s) => s.trim()).filter((s) => s.length > 0),
    [usersTagsInput],
  );

  const effectiveUsersNewWithinHours = useMemo(() => {
    const value = Number.parseInt(usersNewWithinHours, 10);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }, [usersNewWithinHours]);

  const effectiveUsersInactiveDays = useMemo(() => {
    const value = Number.parseInt(usersInactiveDays, 10);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }, [usersInactiveDays]);

  const lookupFromUrl = useMemo(() => {
    const raw = searchParams.get('lookup');
    const trimmed = raw?.trim() ?? '';
    return trimmed.length > 0 ? trimmed : null;
  }, [searchParams]);

  const loadUsers = async (options?: { reset?: boolean }) => {
    const reset = options?.reset === true;
    setUsersLoading(true);
    setUsersError(null);

    try {
      const res = await listUsersIndex({
        limit: usersPageSize,
        cursor: reset ? null : usersCursor,
        sortBy: usersSortBy,
        query: effectiveUsersQuery,
        premiumOnly: usersPremiumOnly,
        blockedOnly: usersBlockedOnly,
        newWithinHours: effectiveUsersNewWithinHours,
        inactiveDays: effectiveUsersInactiveDays,
        tags: effectiveUsersTags.length > 0 ? effectiveUsersTags : undefined,
      });

      setUsers((prev) => (reset ? res.users : [...prev, ...res.users]));
      setUsersCursor(res.nextCursor);
    } catch (e) {
      setUsersError(e instanceof Error ? e.message : 'Impossible de charger la liste utilisateurs.');
    } finally {
      setUsersLoading(false);
    }
  };

  const rememberRecentUser = (uid: string) => {
    if (!uid) return;
    setRecentUsers((prev) => {
      const next = [uid, ...prev.filter((item) => item !== uid)].slice(0, 8);
      try {
        window.localStorage.setItem('admin_recent_users', JSON.stringify(next));
      } catch {
        // ignore localStorage failures
      }
      return next;
    });
  };

  const handleSendMessage = async () => {
    if (!lookupResult) return;
    const title = messageTitle.trim();
    const body = messageBody.trim();
    if (!title || !body) {
      setMessageError('Titre et contenu requis.');
      return;
    }

    setMessageSending(true);
    setMessageError(null);
    setMessageInfo(null);
    try {
      const res = await sendUserMessage({
        targetUserUid: lookupResult.uid,
        title,
        body,
        severity: messageSeverity,
      });
      setMessageInfo(res.message);
      setMessageBody('');
      void loadMessagingStats(lookupResult.uid);
      void trackEvent('admin_send_user_message_success', {
        severity: messageSeverity,
        target_uid_hash_hint: lookupResult.uid.slice(0, 6),
      });
    } catch (e) {
      setMessageError(e instanceof Error ? e.message : 'Envoi impossible.');
      void trackEvent('admin_send_user_message_error', {
        severity: messageSeverity,
      });
    } finally {
      setMessageSending(false);
    }
  };

  const loadMessagingStats = async (targetUserUid: string) => {
    setMessageStatsLoading(true);
    setMessageStatsError(null);
    try {
      const stats = await getUserMessagingStats({ targetUserUid, windowHours: 24 * 7 });
      setMessageStats(stats);
    } catch (e) {
      setMessageStatsError(e instanceof Error ? e.message : 'Impossible de charger les métriques de messagerie.');
      setMessageStats(null);
    } finally {
      setMessageStatsLoading(false);
    }
  };

  const loadActivityEvents = async (targetUserUid: string, options?: { reset?: boolean }) => {
    const reset = options?.reset === true;
    setActivityLoading(true);
    setActivityError(null);

    try {
      const res = await listUserActivityEvents({
        targetUserUid,
        limit: 20,
        cursor: reset ? null : activityCursor,
        type: activityTypeFilter.trim() || undefined,
      });
      setActivityEvents((prev) => (reset ? res.events : [...prev, ...res.events]));
      setActivityCursor(res.nextCursor);
    } catch (e) {
      setActivityError(e instanceof Error ? e.message : 'Impossible de charger la timeline utilisateur.');
    } finally {
      setActivityLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usersSortBy, usersPageSize]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('admin_recent_users');
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        setRecentUsers(arr.filter((v): v is string => typeof v === 'string').slice(0, 8));
      }
    } catch {
      // ignore localStorage parse errors
    }
  }, []);

  useEffect(() => {
    if (!lookupFromUrl) return;
    setQuery(lookupFromUrl);
    void openUserFromIndex(lookupFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookupFromUrl]);

  const loadAuditLogs = async (options?: { reset?: boolean }) => {
    const reset = options?.reset === true;
    setAuditLoading(true);
    setAuditError(null);

    try {
      const res = await listAuditLogs({
        limit: 50,
        cursor: reset ? null : auditCursor,
        targetUserUid: effectiveUidFilter,
        action: effectiveActionFilter,
      });

      setAuditLogs((prev) => (reset ? res.logs : [...prev, ...res.logs]));
      setAuditCursor(res.nextCursor);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Impossible de charger les logs d’audit.';
      setAuditError(message);
    } finally {
      setAuditLoading(false);
    }
  };

  const openUserFromIndex = async (uid: string) => {
    setQuery(uid);
    setLookupLoading(true);
    setLookupError(null);
    setActionInfo(null);
    setActionError(null);

    try {
      const user = await lookupUser(uid);
      setLookupResult(user);
      setAuditFilterUserUid(user.uid);
      rememberRecentUser(user.uid);
      setActivityCursor(null);
      await Promise.all([loadActivityEvents(user.uid, { reset: true }), loadMessagingStats(user.uid)]);
    } catch (e) {
      setLookupResult(null);
      setLookupError(e instanceof Error ? e.message : 'Lookup impossible.');
    } finally {
      setLookupLoading(false);
    }
  };

  const copyToClipboard = async (value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // ignore clipboard failures
    }
  };

  const runRebuildUsersIndex = async () => {
    setRebuildLoading(true);
    setRebuildError(null);
    setRebuildInfo(null);

    try {
      const res = await rebuildUsersIndex({ batchSize: 200 });
      setRebuildInfo(res.message);
      await loadUsers({ reset: true });
    } catch (e) {
      setRebuildError(e instanceof Error ? e.message : 'Rebuild impossible.');
    } finally {
      setRebuildLoading(false);
    }
  };

  const handleLookup = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      setLookupError('Renseigne un email ou un UID.');
      return;
    }

    setLookupLoading(true);
    setLookupError(null);
    setActionInfo(null);
    setActionError(null);

    try {
      const user = await lookupUser(trimmed);
      setLookupResult(user);
      setAuditFilterUserUid(user.uid);
      rememberRecentUser(user.uid);
      setActivityCursor(null);
      await loadActivityEvents(user.uid, { reset: true });
    } catch (e) {
      setLookupResult(null);
      setLookupError(e instanceof Error ? e.message : 'Lookup impossible.');
    } finally {
      setLookupLoading(false);
    }
  };

  const runAction = async (params: {
    label: string;
    callback: () => Promise<{ message: string }>;
    confirmText?: string;
  }) => {
    if (!canActOnUid) return;

    if (params.confirmText) {
      const confirmed = await new Promise<boolean>((resolve) => {
        confirmResolverRef.current = resolve;
        setConfirmModal({
          open: true,
          title: 'Confirmation requise',
          message: params.confirmText ?? '',
        });
      });
      if (!confirmed) return;
    }

    setActionBusy(params.label);
    setActionError(null);
    setActionInfo(null);

    try {
      const res = await params.callback();
      setActionInfo(res.message);
      await loadAuditLogs({ reset: true });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action impossible.');
    } finally {
      setActionBusy(null);
    }
  };

  const closeConfirmModal = (confirmed: boolean) => {
    setConfirmModal((prev) => ({ ...prev, open: false }));
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    resolver?.(confirmed);
  };

  const openHardDeleteFlow = async () => {
    if (!lookupResult) return;
    const confirmed = await new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmModal({
        open: true,
        title: 'Suppression définitive',
        message: `Cette action est irréversible pour ${lookupResult.uid}. Continuer ?`,
      });
    });
    if (!confirmed) return;
    setHardDeleteText('');
    setHardDeleteChecked(false);
    setHardDeleteModalOpen(true);
  };

  const submitHardDelete = async () => {
    if (!lookupResult) return;
    if (hardDeleteText.trim() !== 'SUPPRIMER' || !hardDeleteChecked) {
      setActionError('Confirme avec la case et la saisie exacte "SUPPRIMER".');
      return;
    }

    setActionBusy('hard-delete');
    setActionError(null);
    setActionInfo(null);
    try {
      const res = await hardDeleteUser({
        targetUserUid: lookupResult.uid,
        confirmationText: hardDeleteText.trim(),
        hardDeleteConfirmed: hardDeleteChecked,
      });
      setActionInfo(res.message);
      setHardDeleteModalOpen(false);
      setLookupResult(null);
      await Promise.all([loadUsers({ reset: true }), loadAuditLogs({ reset: true })]);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Suppression définitive impossible.');
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Administration interne</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">SmartNote Back-office</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Recherche utilisateur, opérations sensibles via Cloud Functions et suivi des actions en audit.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">Mode sécurisé</span>
            <Link
              href="/admin/dashboard"
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            >
              Dashboard opérateur
            </Link>
            <Link
              href="/admin/errors"
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            >
              Journal erreurs
            </Link>
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Users index</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={runRebuildUsersIndex}
              disabled={rebuildLoading}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            >
              {rebuildLoading ? 'Rebuild…' : 'Rebuild index'}
            </button>
            <button
              type="button"
              onClick={() => loadUsers({ reset: true })}
              disabled={usersLoading}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            >
              {usersLoading ? 'Chargement…' : 'Rafraîchir'}
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-3 xl:grid-cols-4">
          <input
            value={usersQuery}
            onChange={(e) => setUsersQuery(e.target.value)}
            placeholder="UID ou email (prefix)"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          />
          <input
            value={usersTagsInput}
            onChange={(e) => setUsersTagsInput(e.target.value)}
            placeholder="Tags (csv)"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          />
          <select
            value={usersSortBy}
            onChange={(e) => setUsersSortBy(e.target.value as AdminUsersSortBy)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            aria-label="Tri users index"
          >
            <option value="createdAt">Tri: inscription</option>
            <option value="lastSeenAt">Tri: dernière activité</option>
            <option value="premiumUntil">Tri: premium jusqu'au</option>
          </select>
          <select
            value={String(usersPageSize)}
            onChange={(e) => setUsersPageSize(e.target.value === '50' ? 50 : 20)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            aria-label="Taille de page users index"
          >
            <option value="20">20 / page</option>
            <option value="50">50 / page</option>
          </select>
        </div>

        <div className="mt-2 grid gap-2 md:grid-cols-4">
          <input
            value={usersNewWithinHours}
            onChange={(e) => setUsersNewWithinHours(e.target.value)}
            placeholder="Nouveaux (heures)"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          />
          <input
            value={usersInactiveDays}
            onChange={(e) => setUsersInactiveDays(e.target.value)}
            placeholder="Inactifs (jours)"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          />
          <label className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={usersPremiumOnly}
              onChange={(e) => setUsersPremiumOnly(e.target.checked)}
            />
            Premium only
          </label>
          <label className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={usersBlockedOnly}
              onChange={(e) => setUsersBlockedOnly(e.target.checked)}
            />
            Blocked only
          </label>
        </div>

        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => loadUsers({ reset: true })}
            disabled={usersLoading}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            Appliquer filtres
          </button>
        </div>

        {rebuildInfo && <p className="mt-3 text-sm text-emerald-600">{rebuildInfo}</p>}
        {rebuildError && <p className="mt-3 text-sm text-destructive">{rebuildError}</p>}
        {usersError && <p className="mt-3 text-sm text-destructive">{usersError}</p>}

        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="border-b border-slate-200 text-left text-slate-600">
                <th className="px-2 py-2">UID</th>
                <th className="px-2 py-2">Email</th>
                <th className="px-2 py-2">Plan</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Créé le</th>
                <th className="px-2 py-2">Last seen</th>
                <th className="px-2 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.uid} className="border-b border-slate-100 text-slate-800">
                  <td className="px-2 py-2 font-mono text-xs">{user.uid}</td>
                  <td className="px-2 py-2">{user.email ?? '—'}</td>
                  <td className="px-2 py-2">{user.plan}</td>
                  <td className="px-2 py-2">{user.status}</td>
                  <td className="px-2 py-2">{formatDateTime(user.createdAtMs)}</td>
                  <td className="px-2 py-2">{formatDateTime(user.lastSeenAtMs)}</td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        onClick={() => void openUserFromIndex(user.uid)}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                      >
                        Ouvrir fiche
                      </button>
                      <button
                        type="button"
                        onClick={() => void copyToClipboard(user.uid)}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                      >
                        Copier UID
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-4 text-center text-slate-500">
                    Aucun utilisateur indexé avec ces filtres.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => loadUsers({ reset: false })}
            disabled={usersLoading || !usersCursor}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          >
            Charger plus
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">User Lookup</h2>
        {recentUsers.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {recentUsers.map((uid) => (
              <button
                key={uid}
                type="button"
                onClick={() => void openUserFromIndex(uid)}
                className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                {uid.slice(0, 10)}…
              </button>
            ))}
          </div>
        )}
        <form className="mt-4 flex flex-col gap-3 md:flex-row" onSubmit={handleLookup}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Email ou UID"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          />
          <button
            type="submit"
            disabled={lookupLoading}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {lookupLoading ? 'Recherche…' : 'Rechercher'}
          </button>
        </form>
        {lookupError && <p className="mt-3 text-sm text-destructive">{lookupError}</p>}
      </section>

      {lookupResult && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-900">Fiche utilisateur</h2>
            <div className="flex items-center gap-2">
              {accountHealth && (
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${accountHealth.toneClass}`}>
                  {accountHealth.label}
                </span>
              )}
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">UID: {lookupResult.uid}</span>
            </div>
          </div>

          {accountHealth && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <span className="font-semibold">Diagnostic compte:</span> {accountHealth.description}
            </div>
          )}

          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">Email</p><p className="mt-1 font-medium text-slate-900">{lookupResult.email ?? '—'}</p></div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">Plan</p><p className="mt-1 font-medium text-slate-900">{prettyPlan(lookupResult.plan)}</p></div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">Subscription</p><p className="mt-1 font-medium text-slate-900">{lookupResult.stripeSubscriptionStatus ?? '—'}</p></div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">Favoris</p><p className="mt-1 font-medium text-slate-900">{lookupResult.counts.favorites}</p></div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">Inscription (Auth)</p><p className="mt-1 font-medium text-slate-900">{formatDateTime(lookupResult.authCreatedAtMs)}</p></div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">Inscription (Firestore)</p><p className="mt-1 font-medium text-slate-900">{formatDateTime(lookupResult.userDocCreatedAtMs)}</p></div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">Dernier login</p><p className="mt-1 font-medium text-slate-900">{formatDateTime(lookupResult.lastLoginAtMs)}</p></div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">Last seen</p><p className="mt-1 font-medium text-slate-900">{formatDateTime(lookupResult.lastSeenAtMs)}</p></div>
          </div>

          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            Notes / Tâches / Checklist: <span className="font-semibold text-slate-900">{lookupResult.counts.notes} / {lookupResult.counts.tasks} / {lookupResult.counts.todos}</span>
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Activité récente</h3>
              <div className="flex items-center gap-2">
                <select
                  value={activityTypeFilter}
                  onChange={(e) => setActivityTypeFilter(e.target.value)}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
                  aria-label="Filtrer les événements activité"
                >
                  <option value="">Tous types</option>
                  <option value="admin_action">admin_action</option>
                  <option value="premium_changed">premium_changed</option>
                  <option value="error_logged">error_logged</option>
                  <option value="login">login</option>
                  <option value="note_created">note_created</option>
                  <option value="task_created">task_created</option>
                  <option value="todo_created">todo_created</option>
                  <option value="ai_job_started">ai_job_started</option>
                  <option value="ai_job_failed">ai_job_failed</option>
                  <option value="ai_job_done">ai_job_done</option>
                  <option value="notification_sent">notification_sent</option>
                  <option value="notification_read">notification_read</option>
                </select>
                <button
                  type="button"
                  onClick={() => loadActivityEvents(lookupResult.uid, { reset: true })}
                  disabled={activityLoading}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {activityLoading ? 'Chargement…' : 'Rafraîchir'}
                </button>
              </div>
            </div>

            {activityError && <p className="mt-2 text-xs text-destructive">{activityError}</p>}

            <div className="mt-2 space-y-2">
              {activityEvents.map((event) => (
                <div key={event.id} className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="rounded bg-slate-200 px-2 py-0.5 font-medium text-slate-800">{event.type}</span>
                    <span className="text-slate-500">{formatDateTime(event.createdAtMs)}</span>
                  </div>
                  <pre className="mt-2 overflow-auto text-[11px] text-slate-600">{JSON.stringify(event.metadata, null, 2)}</pre>
                </div>
              ))}

              {activityEvents.length === 0 && (
                <p className="text-xs text-slate-500">Aucun événement sur cette période/filtre.</p>
              )}
            </div>

            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={() => loadActivityEvents(lookupResult.uid, { reset: false })}
                disabled={activityLoading || !activityCursor}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Charger plus
              </button>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
            <h3 className="text-sm font-semibold text-slate-900">Message in-app (support)</h3>
            <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
              {messageStatsLoading && <p>Analyse messagerie…</p>}
              {!messageStatsLoading && messageStats && (
                <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                  <p>Envoyés (7j): <strong>{messageStats.sentCount}</strong></p>
                  <p>Lus (7j): <strong>{messageStats.readCount}</strong></p>
                  <p>Non lus: <strong>{messageStats.unreadCount}</strong></p>
                  <p>Taux de lecture: <strong>{messageStats.readRatePercent}%</strong></p>
                  <p>Dernier envoi: <strong>{formatDateTime(messageStats.lastSentAtMs)}</strong></p>
                  <p>Dernière lecture: <strong>{formatDateTime(messageStats.lastReadAtMs)}</strong></p>
                </div>
              )}
              {!messageStatsLoading && !messageStats && !messageStatsError && (
                <p>Aucune métrique disponible pour le moment.</p>
              )}
              {messageStatsError && <p className="text-destructive">{messageStatsError}</p>}
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              <input
                value={messageTitle}
                onChange={(e) => setMessageTitle(e.target.value)}
                placeholder="Titre"
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 md:col-span-2"
              />
              <select
                value={messageSeverity}
                onChange={(e) => setMessageSeverity(e.target.value as 'info' | 'warn' | 'critical')}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                aria-label="Sévérité message"
              >
                <option value="info">info</option>
                <option value="warn">warn</option>
                <option value="critical">critical</option>
              </select>
            </div>
            <textarea
              value={messageBody}
              onChange={(e) => setMessageBody(e.target.value)}
              placeholder="Contenu du message"
              rows={3}
              className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={handleSendMessage}
                disabled={messageSending}
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {messageSending ? 'Envoi…' : 'Envoyer message'}
              </button>
            </div>
            {messageInfo && <p className="mt-2 text-xs text-emerald-600">{messageInfo}</p>}
            {messageError && <p className="mt-2 text-xs text-destructive">{messageError}</p>}
          </div>

          <div className="mt-6 border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold text-slate-900">Actions administrateur</h3>
            <div className="mt-3 space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Accès</p>
                <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  runAction({
                    label: 'revoke',
                    callback: () => revokeUserSessions(lookupResult.uid),
                    confirmText: `Confirmer la révocation des sessions pour ${lookupResult.uid} ?`,
                  })
                }
                disabled={actionBusy !== null}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 transition hover:bg-slate-50 disabled:opacity-60"
              >
                {actionBusy === 'revoke' ? 'Révocation…' : 'Révoquer sessions'}
              </button>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Abonnement</p>
                <div className="mt-2 flex flex-wrap gap-2">

              <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-1">
                <label htmlFor="premium-days" className="sr-only">
                  Durée premium en jours
                </label>
                <input
                  id="premium-days"
                  type="number"
                  min={1}
                  max={365}
                  value={premiumDays}
                  onChange={(e) => setPremiumDays(Number.parseInt(e.target.value, 10) || 30)}
                  aria-label="Durée premium en jours"
                  className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
                />
                <button
                  type="button"
                  onClick={() =>
                    runAction({
                      label: 'enable-premium',
                      callback: () =>
                        enableUserPremium({
                          targetUserUid: lookupResult.uid,
                          durationDays: premiumDays,
                        }),
                      confirmText: `Activer premium ${premiumDays} jours pour ${lookupResult.uid} ?`,
                    })
                  }
                  disabled={actionBusy !== null}
                  className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-60"
                >
                  {actionBusy === 'enable-premium' ? 'Activation…' : 'Activer premium'}
                </button>
              </div>

              <button
                type="button"
                onClick={() =>
                  runAction({
                    label: 'disable-premium',
                    callback: () => disableUserPremium(lookupResult.uid),
                    confirmText: `Désactiver premium pour ${lookupResult.uid} ?`,
                  })
                }
                disabled={actionBusy !== null}
                className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 transition hover:bg-amber-100 disabled:opacity-60"
              >
                {actionBusy === 'disable-premium' ? 'Désactivation…' : 'Désactiver premium'}
              </button>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Maintenance</p>
                <div className="mt-2 flex flex-wrap gap-2">

              <button
                type="button"
                onClick={() =>
                  runAction({
                    label: 'reset-flags',
                    callback: () => resetUserFlags(lookupResult.uid),
                    confirmText: `Confirmer le reset onboarding/flags pour ${lookupResult.uid} ?`,
                  })
                }
                disabled={actionBusy !== null}
                className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
              >
                {actionBusy === 'reset-flags' ? 'Reset…' : 'Reset onboarding/flags'}
              </button>

              <button
                type="button"
                onClick={() =>
                  runAction({
                    label: 'soft-delete',
                    callback: () => softDeleteUser(lookupResult.uid),
                    confirmText: `Soft delete de ${lookupResult.uid} (blocage login + revoke sessions + plan free) ?`,
                  })
                }
                disabled={actionBusy !== null}
                className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 transition hover:bg-amber-100 disabled:opacity-60"
              >
                {actionBusy === 'soft-delete' ? 'Suppression soft…' : 'Soft delete utilisateur'}
              </button>

              <button
                type="button"
                onClick={() => void openHardDeleteFlow()}
                disabled={actionBusy !== null}
                className="rounded-md border border-rose-400 bg-rose-100 px-3 py-2 text-sm font-semibold text-rose-900 transition hover:bg-rose-200 disabled:opacity-60"
              >
                {actionBusy === 'hard-delete' ? 'Suppression hard…' : 'Hard delete (avancé)'}
              </button>
                </div>
              </div>
            </div>

            {actionInfo && <p className="mt-3 text-sm text-emerald-600">{actionInfo}</p>}
            {actionError && <p className="mt-3 text-sm text-destructive">{actionError}</p>}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900">Admin Audit Logs</h2>
          <button
            type="button"
            onClick={() => loadAuditLogs({ reset: true })}
            disabled={auditLoading}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          >
            {auditLoading ? 'Chargement…' : 'Rafraîchir'}
          </button>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <input
            value={auditFilterUserUid}
            onChange={(e) => setAuditFilterUserUid(e.target.value)}
            placeholder="Filtre UID cible"
            aria-label="Filtre par UID utilisateur"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          />
          <input
            value={auditFilterAction}
            onChange={(e) => setAuditFilterAction(e.target.value)}
            placeholder="Filtre action"
            aria-label="Filtre par action"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          />
        </div>

        {auditError && <p className="mt-3 text-sm text-destructive">{auditError}</p>}

        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="border-b border-slate-200 text-left text-slate-600">
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2">Admin UID</th>
                <th className="px-2 py-2">Target UID</th>
                <th className="px-2 py-2">Action</th>
                <th className="px-2 py-2">Statut</th>
                <th className="px-2 py-2">Message</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log) => (
                <tr key={log.id} className="border-b border-slate-100 text-slate-800">
                  <td className="px-2 py-2">{formatDateTime(log.createdAtMs)}</td>
                  <td className="px-2 py-2">{log.adminUid ?? '—'}</td>
                  <td className="px-2 py-2">{log.targetUserUid ?? '—'}</td>
                  <td className="px-2 py-2">{log.action}</td>
                  <td className="px-2 py-2">{log.status}</td>
                  <td className="px-2 py-2">{log.message}</td>
                </tr>
              ))}
              {auditLogs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-4 text-center text-slate-500">
                    Aucun log chargé.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => loadAuditLogs({ reset: false })}
            disabled={auditLoading || !auditCursor}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          >
            Charger plus
          </button>
        </div>
      </section>

      {confirmModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-slate-900">{confirmModal.title}</h3>
            <p className="mt-2 text-sm text-slate-700">{confirmModal.message}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => closeConfirmModal(false)}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => closeConfirmModal(true)}
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}

      {hardDeleteModalOpen && lookupResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-rose-950/70 p-4">
          <div className="w-full max-w-lg rounded-xl border border-rose-300 bg-white p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-rose-900">Hard delete utilisateur</h3>
            <p className="mt-2 text-sm text-slate-700">
              Suppression définitive de <span className="font-mono">{lookupResult.uid}</span> (Auth + Firestore + index).
            </p>
            <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={hardDeleteChecked}
                onChange={(e) => setHardDeleteChecked(e.target.checked)}
              />
              Je confirme que cette action est irréversible.
            </label>
            <label className="mt-3 block text-sm text-slate-700">
              Tape <span className="font-semibold">SUPPRIMER</span> pour confirmer
              <input
                value={hardDeleteText}
                onChange={(e) => setHardDeleteText(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setHardDeleteModalOpen(false)}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => void submitHardDelete()}
                disabled={actionBusy === 'hard-delete'}
                className="rounded-md bg-rose-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {actionBusy === 'hard-delete' ? 'Suppression…' : 'Supprimer définitivement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
