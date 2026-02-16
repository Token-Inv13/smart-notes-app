"use client";

import { useState } from 'react';
import Link from 'next/link';
import { listErrorLogs } from '@/lib/adminClient';
import type { AdminCursor, AdminErrorLogItem } from '@/types/admin';

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
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Errors (Functions)</h1>
          <p className="text-sm text-muted-foreground">Derniers événements backend stockés dans appErrorLogs.</p>
        </div>
        <Link href="/admin" className="rounded-md border border-input px-3 py-2 text-sm hover:bg-accent">
          Retour Admin
        </Link>
      </header>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="error-category-filter" className="sr-only">
            Filtrer les erreurs par type
          </label>
          <select
            id="error-category-filter"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Filtrer les erreurs par type"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
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
            className="rounded-md border border-input px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
          >
            {loading ? 'Chargement…' : 'Charger erreurs'}
          </button>
          <button
            type="button"
            onClick={() => loadLogs(false)}
            disabled={loading || !cursor}
            className="rounded-md border border-input px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
          >
            Load more
          </button>
        </div>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2">Type</th>
                <th className="px-2 py-2">Scope</th>
                <th className="px-2 py-2">Code</th>
                <th className="px-2 py-2">Message</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr
                  key={log.id}
                  className="cursor-pointer border-b border-border/70 hover:bg-accent/40"
                  onClick={() => setSelected(log)}
                >
                  <td className="px-2 py-2">{formatDateTime(log.createdAtMs)}</td>
                  <td className="px-2 py-2">{log.category}</td>
                  <td className="px-2 py-2">{log.scope}</td>
                  <td className="px-2 py-2">{log.code}</td>
                  <td className="px-2 py-2">{log.message}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-2 py-4 text-center text-muted-foreground">
                    Aucun événement chargé.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selected && (
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Détail erreur</h2>
          <div className="mt-2 space-y-1 text-sm">
            <p><span className="text-muted-foreground">Date:</span> {formatDateTime(selected.createdAtMs)}</p>
            <p><span className="text-muted-foreground">Type:</span> {selected.category}</p>
            <p><span className="text-muted-foreground">Scope:</span> {selected.scope}</p>
            <p><span className="text-muted-foreground">Code:</span> {selected.code}</p>
            <p><span className="text-muted-foreground">Message:</span> {selected.message}</p>
            <pre className="mt-3 overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(selected.context, null, 2)}
            </pre>
          </div>
        </section>
      )}
    </div>
  );
}
