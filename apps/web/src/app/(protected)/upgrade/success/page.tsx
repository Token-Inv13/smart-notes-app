'use client';

import Link from 'next/link';
import { useUserSettings } from '@/hooks/useUserSettings';
import { useCallback, useEffect, useState } from 'react';

export default function UpgradeSuccessPage() {
  const { data: userSettings, loading, refetch } = useUserSettings();
  const isPro = userSettings?.plan === 'pro';

  const [syncLoading, setSyncLoading] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleSync = useCallback(async () => {
    setSyncLoading(true);
    setSyncError(null);

    try {
      const res = await fetch('/api/stripe/sync', { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || 'SYNC_FAILED');
      }
      refetch();
    } catch (e) {
      console.error('Sync error', e);
      setSyncError('Impossible de rafraîchir le statut pour le moment. Réessaie dans quelques instants.');
    } finally {
      setSyncLoading(false);
    }
  }, [refetch]);

  useEffect(() => {
    if (loading) return;
    if (isPro) return;
    void handleSync();
  }, [handleSync, isPro, loading]);

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-xl font-semibold">Paiement confirmé</h1>
      <p className="text-sm text-muted-foreground">
        Merci. Ton abonnement est actif. Si ton statut n’est pas encore à jour, attends quelques secondes : la mise à
        jour se fait automatiquement via le webhook Stripe.
      </p>

      <div className="border border-border rounded-lg p-4 bg-card text-sm">
        <span className="font-medium">Statut actuel:</span>{' '}
        <span>{loading ? 'Chargement…' : isPro ? 'Pro' : 'Free'}</span>
      </div>

      {!isPro && (
        <div className="rounded-lg border border-border bg-background p-4 space-y-2">
          <div className="text-sm font-medium">Statut pas encore à jour ?</div>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncLoading}
            className="inline-flex items-center justify-center px-4 py-2 rounded-md border border-border bg-background text-sm font-medium disabled:opacity-50"
          >
            {syncLoading ? 'Rafraîchissement…' : 'Rafraîchir le statut'}
          </button>
          {syncError && <p className="text-sm text-destructive">{syncError}</p>}
        </div>
      )}

      <div className="flex gap-2">
        <Link
          href="/upgrade"
          className="inline-flex items-center justify-center px-4 py-2 rounded-md border border-border bg-background text-sm font-medium"
        >
          Voir Pro
        </Link>
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium"
        >
          Retour au dashboard
        </Link>
        <Link
          href="/settings"
          className="inline-flex items-center justify-center px-4 py-2 rounded-md border border-border bg-background text-sm font-medium"
        >
          Paramètres
        </Link>
      </div>
    </div>
  );
}
