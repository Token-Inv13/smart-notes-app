'use client';

import { useCallback, useEffect, useState } from 'react';
import { useUserSettings } from '@/hooks/useUserSettings';
import { isAndroidNative } from '@/lib/runtimePlatform';
import type { UserDoc } from '@/types/firestore';

export default function UpgradePage() {
  const { data: userSettings, loading: userLoading, refetch } = useUserSettings();
  const isPro = userSettings?.plan === 'pro';
  const stripeCustomerId = (userSettings as UserDoc | undefined)?.stripeCustomerId;
  const stripeSubscriptionStatus = (userSettings as UserDoc | undefined)?.stripeSubscriptionStatus;
  const stripeSubscriptionId = (userSettings as UserDoc | undefined)?.stripeSubscriptionId;
  const hasActiveStripeSubscription = stripeSubscriptionStatus === 'active' || stripeSubscriptionStatus === 'trialing';
  const hasStripeSubscriptionData = !!stripeSubscriptionStatus || !!stripeSubscriptionId || !!stripeCustomerId;
  const isAndroid = isAndroidNative();
  const googlePlayManageUrl = 'https://play.google.com/store/account/subscriptions';

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  const [syncLoading, setSyncLoading] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleSync = useCallback(async () => {
    if (isAndroid) return;
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
  }, [isAndroid, refetch]);

  useEffect(() => {
    if (isAndroid) return;
    if (userLoading) return;
    if (!userSettings) return;
    if (!isPro) return;
    if (!hasStripeSubscriptionData) return;
    if (hasActiveStripeSubscription) return;
    void handleSync();
  }, [handleSync, hasActiveStripeSubscription, hasStripeSubscriptionData, isAndroid, isPro, userLoading, userSettings]);

  const handleCheckout = async () => {
    if (isAndroid) {
      setError('Ton abonnement est géré via Google Play.');
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/stripe/checkout', { method: 'POST', credentials: 'include' });
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
    if (isAndroid) {
      setPortalError('Ton abonnement est géré via Google Play.');
      return;
    }
    setPortalLoading(true);
    setPortalError(null);

    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const lower = text.toLowerCase();

        if (res.status === 401) {
          throw new Error('SESSION_EXPIRED');
        }
        if (res.status === 400 && lower.includes('return_url_not_allowed')) {
          throw new Error('RETURN_URL_NOT_ALLOWED');
        }
        if (res.status === 400 && lower.includes('no_such_customer')) {
          throw new Error('NO_SUCH_CUSTOMER');
        }
        if (res.status === 400 && lower.includes('stripecustomerid')) {
          throw new Error('MISSING_CUSTOMER');
        }
        if (res.status === 500 && lower.includes('portal_not_enabled')) {
          throw new Error('PORTAL_NOT_ENABLED');
        }
        if (res.status === 500) {
          throw new Error('PORTAL_UNAVAILABLE');
        }

        throw new Error(text || `PORTAL_HTTP_${res.status}`);
      }

      const json = (await res.json()) as { url?: string };
      if (!json.url) throw new Error('Missing portal url');
      window.location.href = json.url;
    } catch (e) {
      console.error('Portal error', e);
      const message = e instanceof Error ? e.message : '';
      if (message === 'SESSION_EXPIRED') {
        setPortalError('Ta session a expiré. Rafraîchis la page et reconnecte-toi si besoin.');
      } else if (message === 'RETURN_URL_NOT_ALLOWED') {
        setPortalError(
          'Configuration Stripe requise: ajoute https://app.tachesnotes.com/upgrade dans les URLs de retour autorisées du portail client, puis réessaie.',
        );
      } else if (message === 'NO_SUCH_CUSTOMER') {
        setPortalError(
          'Ce compte Stripe est introuvable (souvent un mismatch test/live). Vérifie que STRIPE_SECRET_KEY et le customerId utilisent le même mode.',
        );
      } else if (message === 'MISSING_CUSTOMER') {
        setPortalError(
          'La gestion de l’abonnement n’est pas encore disponible pour ce compte. Contacte le support si le problème persiste.',
        );
      } else if (message === 'PORTAL_NOT_ENABLED') {
        setPortalError('Active le portail client dans Stripe (Billing > Customer portal), puis réessaie.');
      } else if (message === 'PORTAL_UNAVAILABLE') {
        setPortalError('Le portail Stripe est temporairement indisponible. Réessaie dans quelques instants.');
      } else {
        setPortalError('Impossible d’ouvrir la gestion de l’abonnement. Vérifie ta connexion et réessaie.');
      }
    } finally {
      setPortalLoading(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Abonnement</h1>
        {isAndroid ? (
          <p className="text-sm text-muted-foreground">Ton abonnement est géré via Google Play.</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Choisis le plan qui te convient. Tu peux annuler à tout moment depuis le portail sécurisé Stripe.
          </p>
        )}
      </div>

      <div className="border border-border rounded-lg p-4 bg-card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">
            <span className="font-medium">Statut actuel:</span>{' '}
            <span>
              {userLoading ? 'Chargement…' : isPro ? (hasActiveStripeSubscription ? 'Pro' : 'Pro (à confirmer)') : 'Free'}
            </span>
          </div>
          <div
            className={`text-xs px-2 py-1 rounded-full border ${
              isPro && hasActiveStripeSubscription
                ? 'border-primary/30 bg-primary/10 text-foreground'
                : 'border-border bg-background text-muted-foreground'
            }`}
          >
            {isPro ? (hasActiveStripeSubscription ? 'Plan actif' : 'Statut à vérifier') : 'Plan de base'}
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
              <li>Import vidéos (jusqu’à 350 Mo)</li>
              <li>Rappels activés</li>
              <li>Accès prioritaire aux futures fonctionnalités</li>
            </ul>
            <div className="text-sm font-medium pt-1">1,99€ / mois</div>
          </div>
        </div>

        <div className="space-y-2">
          {isAndroid ? (
            <div className="rounded-lg border border-border bg-background p-3 space-y-2">
              <div className="text-sm font-medium">Abonnement Android</div>
              <div className="text-xs text-muted-foreground">Ton abonnement est géré via Google Play.</div>
              <a
                href={googlePlayManageUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center px-4 py-2 rounded-md border border-border bg-background text-sm font-medium"
              >
                Ouvrir Google Play
              </a>
            </div>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={handleCheckout}
                  disabled={loading || (isPro && hasActiveStripeSubscription)}
                  className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                >
                  {isPro && hasActiveStripeSubscription ? 'Pro activé' : loading ? 'Redirection…' : 'Passer à Pro'}
                </button>
              </div>

              {!isPro && (
                <div className="text-xs text-muted-foreground">
                  La gestion de l’abonnement est disponible après activation du plan Pro.
                </div>
              )}

              {!isPro && (
                <div className="rounded-lg border border-border bg-background p-3 space-y-2">
                  <div className="text-sm font-medium">Déjà abonné ?</div>
                  <div className="text-xs text-muted-foreground">
                    Si ton paiement Stripe a été confirmé mais que ton statut est encore Free, rafraîchis le statut.
                  </div>
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

              {isPro && hasActiveStripeSubscription && (
                <div className="rounded-lg border border-border bg-background p-3 space-y-2">
                  <div className="text-sm font-medium">Gérer mon abonnement (Stripe sécurisé)</div>
                  <div className="text-xs text-muted-foreground">
                    Accède au portail Stripe pour modifier ton moyen de paiement, télécharger tes factures, ou annuler.
                  </div>
                  <button
                    type="button"
                    onClick={handleOpenPortal}
                    disabled={portalLoading}
                    className="inline-flex items-center justify-center px-4 py-2 rounded-md border border-border bg-background text-sm font-medium disabled:opacity-50"
                  >
                    {portalLoading ? 'Ouverture…' : 'Ouvrir le portail Stripe'}
                  </button>
                  <button
                    type="button"
                    onClick={handleSync}
                    disabled={syncLoading}
                    className="inline-flex items-center justify-center px-4 py-2 rounded-md border border-border bg-background text-sm font-medium disabled:opacity-50"
                  >
                    {syncLoading ? 'Rafraîchissement…' : 'Rafraîchir le statut'}
                  </button>
                  {!stripeCustomerId && (
                    <div className="text-xs text-muted-foreground">
                      Ce compte n’est pas encore relié à Stripe. Si tu viens de t’abonner, attends quelques instants puis réessaie.
                    </div>
                  )}
                  {syncError && <p className="text-sm text-destructive">{syncError}</p>}
                </div>
              )}

              {isPro && !hasActiveStripeSubscription && (
                <div className="rounded-lg border border-border bg-background p-3 space-y-2">
                  <div className="text-sm font-medium">Abonnement Stripe</div>
                  <div className="text-xs text-muted-foreground">
                    Ton abonnement Stripe ne semble plus actif. Le plan sera remis à jour automatiquement.
                  </div>
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

              <div className="text-xs text-muted-foreground">
                Paiement sécurisé par Stripe. Annulation en un clic, sans engagement. Le statut Pro est mis à jour automatiquement.
              </div>
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          {portalError && <p className="text-sm text-destructive">{portalError}</p>}
        </div>
      </div>
    </div>
  );
}
