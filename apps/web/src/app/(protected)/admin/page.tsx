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
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Admin Back-office</h1>
          <p className="text-sm text-muted-foreground">Lookup utilisateur, actions sensibles via Functions, journal d’audit.</p>
        </div>
        <Link href="/admin/errors" className="rounded-md border border-input px-3 py-2 text-sm hover:bg-accent">
          Ouvrir Errors
        </Link>
      </header>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">User Lookup</h2>
        <form className="mt-3 flex flex-col gap-3 md:flex-row" onSubmit={handleLookup}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Email ou UID"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={lookupLoading}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {lookupLoading ? 'Recherche…' : 'Chercher'}
          </button>
        </form>
        {lookupError && <p className="mt-3 text-sm text-destructive">{lookupError}</p>}
      </section>

      {lookupResult && (
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Fiche utilisateur</h2>
          <div className="mt-3 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-3">
            <div><span className="text-muted-foreground">UID:</span> {lookupResult.uid}</div>
            <div><span className="text-muted-foreground">Email:</span> {lookupResult.email ?? '—'}</div>
            <div><span className="text-muted-foreground">Inscription (Auth):</span> {formatDateTime(lookupResult.authCreatedAtMs)}</div>
            <div><span className="text-muted-foreground">Inscription (Firestore):</span> {formatDateTime(lookupResult.userDocCreatedAtMs)}</div>
            <div><span className="text-muted-foreground">Dernier login:</span> {formatDateTime(lookupResult.lastLoginAtMs)}</div>
            <div><span className="text-muted-foreground">Last seen:</span> {formatDateTime(lookupResult.lastSeenAtMs)}</div>
            <div><span className="text-muted-foreground">Plan:</span> {prettyPlan(lookupResult.plan)}</div>
            <div><span className="text-muted-foreground">Subscription status:</span> {lookupResult.stripeSubscriptionStatus ?? '—'}</div>
            <div><span className="text-muted-foreground">Notes / Tâches / Checklist:</span> {lookupResult.counts.notes} / {lookupResult.counts.tasks} / {lookupResult.counts.todos}</div>
            <div><span className="text-muted-foreground">Favoris total:</span> {lookupResult.counts.favorites}</div>
          </div>

          <div className="mt-5 border-t border-border pt-4">
            <h3 className="text-sm font-semibold">Actions admin</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => runAction('revoke', () => revokeUserSessions(lookupResult.uid))}
                disabled={actionBusy !== null}
                className="rounded-md border border-input px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
              >
                {actionBusy === 'revoke' ? 'Révocation…' : 'Révoquer sessions'}
              </button>

              <div className="flex items-center gap-2 rounded-md border border-border p-1">
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
                  className="w-20 rounded-md border border-input bg-background px-2 py-1 text-sm"
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
                  className="rounded-md border border-input px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
                >
                  {actionBusy === 'enable-premium' ? 'Activation…' : 'Activer premium'}
                </button>
              </div>

              <button
                type="button"
                onClick={() => runAction('disable-premium', () => disableUserPremium(lookupResult.uid))}
                disabled={actionBusy !== null}
                className="rounded-md border border-input px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
              >
                {actionBusy === 'disable-premium' ? 'Désactivation…' : 'Désactiver premium'}
              </button>

              <button
                type="button"
                onClick={() => runAction('reset-flags', () => resetUserFlags(lookupResult.uid))}
                disabled={actionBusy !== null}
                className="rounded-md border border-input px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
              >
                {actionBusy === 'reset-flags' ? 'Reset…' : 'Reset onboarding/flags'}
              </button>
            </div>

            {actionInfo && <p className="mt-3 text-sm text-emerald-600">{actionInfo}</p>}
            {actionError && <p className="mt-3 text-sm text-destructive">{actionError}</p>}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Admin Audit Logs</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <input
            value={auditFilterUserUid}
            onChange={(e) => setAuditFilterUserUid(e.target.value)}
            placeholder="Filtre UID cible"
            aria-label="Filtre par UID utilisateur"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <input
            value={auditFilterAction}
            onChange={(e) => setAuditFilterAction(e.target.value)}
            placeholder="Filtre action"
            aria-label="Filtre par action"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => loadAuditLogs({ reset: true })}
            disabled={auditLoading}
            className="rounded-md border border-input px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
          >
            {auditLoading ? 'Chargement…' : 'Charger logs'}
          </button>
        </div>

        {auditError && <p className="mt-3 text-sm text-destructive">{auditError}</p>}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
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
                <tr key={log.id} className="border-b border-border/70">
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
                  <td colSpan={6} className="px-2 py-4 text-center text-muted-foreground">
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
            className="rounded-md border border-input px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
          >
            Load more
          </button>
        </div>
      </section>
    </div>
  );
}
