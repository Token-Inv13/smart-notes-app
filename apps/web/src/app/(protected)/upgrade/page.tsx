'use client';

import { useState } from 'react';
import { useUserSettings } from '@/hooks/useUserSettings';

export default function UpgradePage() {
  const { data: userSettings } = useUserSettings();
  const isPro = userSettings?.plan === 'pro';
  const stripeCustomerId = (userSettings as any)?.stripeCustomerId as string | null | undefined;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

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

  const handleOpenPortal = async () => {
    setPortalLoading(true);
    setPortalError(null);

    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || 'Failed to open portal');
      }

      const json = (await res.json()) as { url?: string };
      if (!json.url) throw new Error('Missing portal url');
      window.location.href = json.url;
    } catch (e) {
      console.error('Portal error', e);
      setPortalError(e instanceof Error ? e.message : 'Erreur lors de l’ouverture du portail.');
      setPortalLoading(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Passer à Pro</h1>
        <p className="text-sm text-muted-foreground">
          Débloque toutes les limites et active les alertes pour 1,99€/mois.
        </p>
      </div>

      <div className="border border-border rounded-lg p-4 bg-card space-y-3">
        <div className="text-sm">
          <span className="font-medium">Statut actuel:</span> <span>{isPro ? 'Pro' : 'Free'}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="border border-border rounded-lg p-4 bg-background space-y-2">
            <div className="font-semibold">Free</div>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>15 notes max</li>
              <li>15 tâches max</li>
              <li>10 notes favorites max</li>
              <li>15 tâches favorites max</li>
              <li>Pas d’alertes</li>
            </ul>
          </div>

          <div className="border border-border rounded-lg p-4 bg-background space-y-2">
            <div className="font-semibold">Pro (1,99€/mois)</div>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>Notes &amp; tâches illimitées</li>
              <li>Favoris illimités</li>
              <li>Alertes activées</li>
            </ul>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={handleCheckout}
            disabled={loading || isPro}
            className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            {isPro ? 'Déjà Pro' : loading ? 'Redirection…' : 'Passer Pro'}
          </button>

          {isPro && (
            <button
              type="button"
              onClick={handleOpenPortal}
              disabled={portalLoading || !stripeCustomerId}
              className="inline-flex items-center justify-center px-4 py-2 rounded-md border border-border bg-background text-sm font-medium disabled:opacity-50"
            >
              {portalLoading ? 'Ouverture…' : 'Gérer l’abonnement'}
            </button>
          )}
        </div>

        {isPro && !stripeCustomerId && (
          <p className="text-sm text-muted-foreground">
            Gérer l’abonnement n’est pas disponible pour ce compte.
          </p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        {portalError && <p className="text-sm text-destructive">{portalError}</p>}
      </div>
    </div>
  );
}
