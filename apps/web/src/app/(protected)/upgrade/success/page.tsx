'use client';

import Link from 'next/link';
import { useUserSettings } from '@/hooks/useUserSettings';

export default function UpgradeSuccessPage() {
  const { data: userSettings, loading } = useUserSettings();
  const isPro = userSettings?.plan === 'pro';

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
