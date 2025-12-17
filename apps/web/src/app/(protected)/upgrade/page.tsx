'use client';

import { useState } from 'react';
import { useUserSettings } from '@/hooks/useUserSettings';

export default function UpgradePage() {
  const { data: userSettings } = useUserSettings();
  const isPro = userSettings?.plan === 'pro';

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCheckout = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/stripe/checkout', { method: 'POST' });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || 'Failed to start checkout');
      }

      const json = (await res.json()) as { url?: string };
      if (!json.url) throw new Error('Missing checkout url');

      window.location.href = json.url;
    } catch (e) {
      console.error('Checkout error', e);
      setError(e instanceof Error ? e.message : 'Erreur lors du paiement.');
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-xl font-semibold">Passer Pro</h1>

      <div className="border border-border rounded-lg p-4 bg-card space-y-2">
        <div className="text-sm">
          <span className="font-medium">Statut actuel:</span> <span>{isPro ? 'Pro' : 'Free'}</span>
        </div>
        <p className="text-sm text-muted-foreground">
          Le plan Pro débloque les limites Free (notes/tâches/favoris).
        </p>

        <button
          type="button"
          onClick={handleCheckout}
          disabled={loading || isPro}
          className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
        >
          {isPro ? 'Déjà Pro' : loading ? 'Redirection…' : 'Passer Pro (abonnement mensuel)'}
        </button>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}
