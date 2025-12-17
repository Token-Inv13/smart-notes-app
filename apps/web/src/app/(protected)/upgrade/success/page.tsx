'use client';

import Link from 'next/link';

export default function UpgradeSuccessPage() {
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-xl font-semibold">Paiement confirmé</h1>
      <p className="text-sm text-muted-foreground">
        Merci. Ton abonnement est actif. Ton compte passera automatiquement en Pro dès réception du webhook Stripe.
      </p>
      <div className="flex gap-2">
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
