"use client";

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getOperatorDashboard } from '@/lib/adminClient';
import type { AdminOperatorDashboard } from '@/types/admin';

function formatDateTime(ms?: number) {
  if (!ms || !Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString('fr-FR');
}

function buildPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return '';
  return points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}

export default function AdminDashboardPage() {
  const [data, setData] = useState<AdminOperatorDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getOperatorDashboard();
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible de charger le dashboard opérateur.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const chart = useMemo(() => {
    if (!data || data.usersSeries30d.length === 0) return null;
    const width = 760;
    const height = 220;
    const paddingX = 28;
    const paddingY = 18;
    const counts = data.usersSeries30d.map((p) => p.count);
    const maxValue = Math.max(1, ...counts);
    const minValue = Math.min(0, ...counts);
    const valueRange = Math.max(1, maxValue - minValue);

    const points = data.usersSeries30d.map((item, index) => {
      const ratioX = data.usersSeries30d.length > 1 ? index / (data.usersSeries30d.length - 1) : 0;
      const x = paddingX + ratioX * (width - paddingX * 2);
      const ratioY = (item.count - minValue) / valueRange;
      const y = height - paddingY - ratioY * (height - paddingY * 2);
      return { x, y, label: item.date, value: item.count };
    });

    return {
      width,
      height,
      points,
      path: buildPath(points),
      maxValue,
    };
  }, [data]);

  const cards = data
    ? [
        { label: 'Users total', value: data.usersTotal },
        { label: 'Nouveaux 24h', value: data.usersNew24h },
        { label: 'Premium actifs', value: data.premiumActive },
        { label: 'Inactifs 7j', value: data.inactive7d },
        { label: 'Erreurs 24h', value: data.errors24h },
        { label: 'Jobs IA failed 24h', value: data.aiJobsFailed24h },
        { label: 'Taux lecture inbox', value: `${data.inboxReadRatePercent}%` },
      ]
    : [];

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Back-office V3</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">Dashboard opérateur</h1>
            <p className="mt-2 text-sm text-slate-600">Vue consolidée exploitation SaaS (KPI + tendance acquisition).</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Retour admin
            </Link>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {loading ? 'Chargement…' : 'Rafraîchir'}
            </button>
          </div>
        </div>
      </header>

      <div className="sticky top-0 z-10 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 shadow-sm">
        État: {loading ? 'mise à jour en cours…' : error ? 'erreur de chargement' : 'opérationnel'} · Dernière génération: {formatDateTime(data?.generatedAtMs)}
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <article key={card.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{card.label}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{card.value}</p>
          </article>
        ))}
        {!loading && !error && cards.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">Aucune donnée disponible.</div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Users 30j</h2>
        <p className="mt-1 text-xs text-slate-500">Nombre de nouveaux utilisateurs par jour.</p>
        <div className="mt-4 overflow-x-auto">
          {chart ? (
            <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="h-[220px] min-w-[760px] w-full" role="img" aria-label="Courbe users 30 jours">
              <rect x="0" y="0" width={chart.width} height={chart.height} fill="#f8fafc" rx="10" />
              <path d={chart.path} fill="none" stroke="#0f172a" strokeWidth="2.5" />
              {chart.points.map((point) => (
                <g key={point.label}>
                  <circle cx={point.x} cy={point.y} r="3" fill="#0f172a" />
                </g>
              ))}
              <text x="12" y="16" fill="#475569" fontSize="11">max: {chart.maxValue}</text>
              <text x={chart.width - 120} y={chart.height - 8} fill="#475569" fontSize="11">30 derniers jours</text>
            </svg>
          ) : (
            <p className="text-sm text-slate-500">Pas de série disponible.</p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Ops / Santé</h2>
        <p className="mt-1 text-xs text-slate-500">Accès rapide aux signaux critiques d’exploitation.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Link
            href="/admin/errors"
            className="rounded-lg border border-slate-200 px-3 py-3 text-sm text-slate-700 hover:bg-slate-50"
          >
            Logs erreurs (24h)
          </Link>
          <a
            href="/docs/runbook-observability.md"
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-200 px-3 py-3 text-sm text-slate-700 hover:bg-slate-50"
          >
            Runbook incident
          </a>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-slate-200 px-3 py-3 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            Rafraîchir métriques santé
          </button>
        </div>
      </section>
    </div>
  );
}
