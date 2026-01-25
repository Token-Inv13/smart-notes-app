'use client';

import { useState } from 'react';
import { useUserSettings } from '@/hooks/useUserSettings';
import type { UserDoc } from '@/types/firestore';

export default function UpgradePage() {
  const { data: userSettings, loading: userLoading } = useUserSettings();
  const isPro = userSettings?.plan === 'pro';
  const stripeCustomerId = (userSettings as UserDoc | undefined)?.stripeCustomerId;

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
      setError("Impossible d’ouvrir le paiement pour le moment. Réessaie dans quelques instants.");
    } finally {
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
      setPortalError("Impossible d’ouvrir la gestion de l’abonnement. Réessaie dans quelques instants.");
    } finally {
      setPortalLoading(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Abonnement</h1>
        <p className="text-sm text-muted-foreground">
          Choisis le plan qui te convient. Tu peux annuler à tout moment depuis le portail sécurisé Stripe.
        </p>
      </div>

      <div className="border border-border rounded-lg p-4 bg-card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">
            <span className="font-medium">Statut actuel:</span>{' '}
            <span>{userLoading ? 'Chargement…' : isPro ? 'Pro' : 'Free'}</span>
          </div>
          <div
            className={`text-xs px-2 py-1 rounded-full border ${
              isPro ? 'border-primary/30 bg-primary/10 text-foreground' : 'border-border bg-background text-muted-foreground'
            }`}
          >
            {isPro ? 'Plan actif' : 'Plan de base'}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div
            className={`rounded-lg p-4 space-y-2 border ${
              !isPro ? 'border-primary/40 bg-primary/5' : 'border-border bg-background'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold">Free</div>
              {!isPro && <div className="text-xs font-medium text-primary">Actuel</div>}
            </div>
            <p className="text-sm text-muted-foreground">
              L’essentiel pour organiser tes notes au quotidien.
            </p>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>Notes, tâches et todo</li>
              <li>Import images &amp; PDF (jusqu’à 20 Mo)</li>
              <li>Rappels désactivés</li>
            </ul>
          </div>

          <div
            className={`rounded-lg p-4 space-y-2 border ${
              isPro ? 'border-primary/40 bg-primary/5' : 'border-border bg-background'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold">Pro</div>
              {isPro && <div className="text-xs font-medium text-primary">Actuel</div>}
            </div>
            <p className="text-sm text-muted-foreground">
              Plus de liberté et des fonctionnalités avancées.
            </p>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>Import vidéos (jusqu’à 120 Mo)</li>
              <li>Rappels activés</li>
              <li>Accès prioritaire aux futures fonctionnalités</li>
            </ul>
            <div className="text-sm font-medium pt-1">1,99€ / mois</div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={handleCheckout}
              disabled={loading || isPro}
              className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              {isPro ? 'Pro activé' : loading ? 'Redirection…' : 'Passer à Pro'}
            </button>

            <button
              type="button"
              onClick={handleOpenPortal}
              disabled={portalLoading || !isPro || !stripeCustomerId}
              className="inline-flex items-center justify-center px-4 py-2 rounded-md border border-border bg-background text-sm font-medium disabled:opacity-50"
            >
              {portalLoading ? 'Ouverture…' : 'Gérer l’abonnement'}
            </button>
          </div>

          {!isPro && (
            <div className="text-xs text-muted-foreground">
              La gestion de l’abonnement est disponible après activation du plan Pro.
            </div>
          )}

          <div className="text-xs text-muted-foreground">
            Paiement sécurisé par Stripe. Annulation en un clic, sans engagement. Le statut Pro est mis à jour automatiquement.
          </div>

          {isPro && !stripeCustomerId && (
            <p className="text-sm text-muted-foreground">
              La gestion de l’abonnement n’est pas disponible pour ce compte pour le moment.
            </p>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          {portalError && <p className="text-sm text-destructive">{portalError}</p>}
        </div>
      </div>
    </div>
  );
}
