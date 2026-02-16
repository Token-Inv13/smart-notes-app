"use client";

import { useState } from 'react';
import Link from 'next/link';
import { getAdminHealthSummary, listErrorLogs } from '@/lib/adminClient';
import type { AdminCursor, AdminErrorLogItem, AdminHealthSummary } from '@/types/admin';

function formatDateTime(ms: number | null | undefined) {
  if (!ms || !Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString('fr-FR');
}

const CATEGORY_OPTIONS = [
  { value: '', label: 'Tous types' },
  { value: 'functions', label: 'functions' },
  { value: 'auth', label: 'auth' },
  { value: 'payments', label: 'payments' },
  { value: 'ai', label: 'ai' },
];

export default function AdminErrorsPage() {
  const [logs, setLogs] = useState<AdminErrorLogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<AdminCursor | null>(null);
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState<AdminErrorLogItem | null>(null);
  const [health, setHealth] = useState<AdminHealthSummary | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  const loadHealthSummary = async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const summary = await getAdminHealthSummary({ windowHours: 24 });
      setHealth(summary);
    } catch (e) {
      setHealthError(e instanceof Error ? e.message : 'Impossible de charger les KPI santé.');
    } finally {
      setHealthLoading(false);
    }
  };

  const loadLogs = async (reset: boolean) => {
    setLoading(true);
    setError(null);

    try {
      const res = await listErrorLogs({
        limit: 50,
        cursor: reset ? null : cursor,
        category: category || undefined,
      });
      setLogs((prev) => (reset ? res.logs : [...prev, ...res.logs]));
      setCursor(res.nextCursor);
      if (reset) setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible de charger les erreurs.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Observabilité</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Journal des erreurs</h1>
          <p className="mt-2 text-sm text-slate-600">Derniers événements backend stockés dans appErrorLogs.</p>
        </div>
        <Link
          href="/admin"
          className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
        >
          Retour Admin
        </Link>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">KPI Santé (24h)</h2>
          <button
            type="button"
            onClick={loadHealthSummary}
            disabled={healthLoading}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          >
            {healthLoading ? 'Calcul…' : 'Calculer KPI'}
          </button>
        </div>

        {healthError && <p className="mb-3 text-sm text-destructive">{healthError}</p>}

        <div className="mb-4 grid gap-2 md:grid-cols-5">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">Erreurs total</p><p className="text-lg font-semibold text-slate-900">{health?.totalErrors ?? '—'}</p></div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">Functions</p><p className="text-lg font-semibold text-slate-900">{health?.categoryCounts.functions ?? '—'}</p></div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">Auth</p><p className="text-lg font-semibold text-slate-900">{health?.categoryCounts.auth ?? '—'}</p></div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">Paiement</p><p className="text-lg font-semibold text-slate-900">{health?.categoryCounts.payments ?? '—'}</p></div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">AI jobs failed</p><p className="text-lg font-semibold text-slate-900">{health?.aiJobFailedCount ?? '—'}</p></div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="error-category-filter" className="sr-only">
            Filtrer les erreurs par type
          </label>
          <select
            id="error-category-filter"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Filtrer les erreurs par type"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          >
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => loadLogs(true)}
            disabled={loading}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          >
            {loading ? 'Chargement…' : 'Charger erreurs'}
          </button>
          <button
            type="button"
            onClick={() => loadLogs(false)}
            disabled={loading || !cursor}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          >
            Charger plus
          </button>
        </div>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="border-b border-slate-200 text-left text-slate-600">
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2">Source</th>
                <th className="px-2 py-2">Sévérité</th>
                <th className="px-2 py-2">Type</th>
                <th className="px-2 py-2">Scope</th>
                <th className="px-2 py-2">Code</th>
                <th className="px-2 py-2">Message</th>
                <th className="px-2 py-2">UID</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr
                  key={log.id}
                  className="cursor-pointer border-b border-slate-100 text-slate-800 hover:bg-slate-50"
                  onClick={() => setSelected(log)}
                >
                  <td className="px-2 py-2">{formatDateTime(log.createdAtMs)}</td>
                  <td className="px-2 py-2">{log.source}</td>
                  <td className="px-2 py-2">{log.severity}</td>
                  <td className="px-2 py-2">{log.category}</td>
                  <td className="px-2 py-2">{log.scope}</td>
                  <td className="px-2 py-2">{log.code}</td>
                  <td className="px-2 py-2">{log.message}</td>
                  <td className="px-2 py-2">
                    {log.uid ? (
                      <Link
                        href={`/admin?lookup=${encodeURIComponent(log.uid)}`}
                        className="text-xs font-medium text-blue-700 underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        Ouvrir fiche
                      </Link>
                    ) : '—'}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-2 py-4 text-center text-slate-500">
                    Aucun événement chargé.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selected && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Détail erreur</h2>
          <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
            <p><span className="text-slate-500">Date:</span> {formatDateTime(selected.createdAtMs)}</p>
            <p><span className="text-slate-500">Type:</span> {selected.category}</p>
            <p><span className="text-slate-500">Scope:</span> {selected.scope}</p>
            <p><span className="text-slate-500">Code:</span> {selected.code}</p>
            <p className="md:col-span-2"><span className="text-slate-500">Message:</span> {selected.message}</p>
            <pre className="md:col-span-2 mt-2 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              {JSON.stringify(selected.context, null, 2)}
            </pre>
          </div>
        </section>
      )}
    </div>
  );
}
