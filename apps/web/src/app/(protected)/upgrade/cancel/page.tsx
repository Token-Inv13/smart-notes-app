'use client';

import Link from 'next/link';

export default function UpgradeCancelPage() {
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-xl font-semibold">Paiement annulé</h1>
      <p className="text-sm text-muted-foreground">
        Le paiement a été annulé. Aucun changement n’a été appliqué. Tu peux réessayer quand tu veux.
      </p>
      <div className="flex gap-2">
        <Link
          href="/upgrade"
          className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium"
        >
          Réessayer
        </Link>
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center px-4 py-2 rounded-md border border-border bg-background text-sm font-medium"
        >
          Retour au dashboard
        </Link>
      </div>
    </div>
  );
}
