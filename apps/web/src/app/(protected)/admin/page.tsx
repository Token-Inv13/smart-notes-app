"use client";

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  disableUserPremium,
  enableUserPremium,
  listAuditLogs,
  lookupUser,
  resetUserFlags,
  revokeUserSessions,
} from '@/lib/adminClient';
import type { AdminAuditLogItem, AdminCursor, AdminLookupUserResult } from '@/types/admin';

function formatDateTime(ms: number | null | undefined) {
  if (!ms || !Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString('fr-FR');
}

function prettyPlan(plan: 'free' | 'pro') {
  return plan === 'pro' ? 'Premium' : 'Free';
}

export default function AdminPage() {
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

  const canActOnUid = lookupResult?.uid ?? null;

  const effectiveUidFilter = useMemo(() => {
    const trimmed = auditFilterUserUid.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, [auditFilterUserUid]);

  const effectiveActionFilter = useMemo(() => {
    const trimmed = auditFilterAction.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, [auditFilterAction]);

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
    } catch (e) {
      setLookupResult(null);
      setLookupError(e instanceof Error ? e.message : 'Lookup impossible.');
    } finally {
      setLookupLoading(false);
    }
  };

  const runAction = async (label: string, callback: () => Promise<{ message: string }>) => {
    if (!canActOnUid) return;

    setActionBusy(label);
    setActionError(null);
    setActionInfo(null);

    try {
      const res = await callback();
      setActionInfo(res.message);
      await loadAuditLogs({ reset: true });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action impossible.');
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
              href="/admin/errors"
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            >
              Journal erreurs
            </Link>
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">User Lookup</h2>
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
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">UID: {lookupResult.uid}</span>
          </div>

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

          <div className="mt-6 border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold text-slate-900">Actions administrateur</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => runAction('revoke', () => revokeUserSessions(lookupResult.uid))}
                disabled={actionBusy !== null}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 transition hover:bg-slate-50 disabled:opacity-60"
              >
                {actionBusy === 'revoke' ? 'Révocation…' : 'Révoquer sessions'}
              </button>

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
                    runAction('enable-premium', () =>
                      enableUserPremium({
                        targetUserUid: lookupResult.uid,
                        durationDays: premiumDays,
                      }),
                    )
                  }
                  disabled={actionBusy !== null}
                  className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-60"
                >
                  {actionBusy === 'enable-premium' ? 'Activation…' : 'Activer premium'}
                </button>
              </div>

              <button
                type="button"
                onClick={() => runAction('disable-premium', () => disableUserPremium(lookupResult.uid))}
                disabled={actionBusy !== null}
                className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 transition hover:bg-amber-100 disabled:opacity-60"
              >
                {actionBusy === 'disable-premium' ? 'Désactivation…' : 'Désactiver premium'}
              </button>

              <button
                type="button"
                onClick={() => runAction('reset-flags', () => resetUserFlags(lookupResult.uid))}
                disabled={actionBusy !== null}
                className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
              >
                {actionBusy === 'reset-flags' ? 'Reset…' : 'Reset onboarding/flags'}
              </button>
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
    </div>
  );
}
