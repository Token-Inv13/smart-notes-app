'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useUserSettings } from '@/hooks/useUserSettings';
import { isAndroidNative } from '@/lib/runtimePlatform';
import type { UserDoc } from '@/types/firestore';

const FREE_FEATURES = [
  'JusquÃ¢â‚¬â„¢ÃƒÂ  15 notes',
  'JusquÃ¢â‚¬â„¢ÃƒÂ  10 notes favorites',
  'JusquÃ¢â‚¬â„¢ÃƒÂ  5 piÃƒÂ¨ces jointes par note',
  'Images et PDF uniquement',
  'JusquÃ¢â‚¬â„¢ÃƒÂ  20 Mo par fichier joint',
  'JusquÃ¢â‚¬â„¢ÃƒÂ  15 tÃƒÂ¢ches agenda actives',
  'JusquÃ¢â‚¬â„¢ÃƒÂ  15 tÃƒÂ¢ches favorites actives',
  'Rappels dÃƒÂ©sactivÃƒÂ©s',
  'Assistant disponible avec quotas Free',
];

const PRO_FEATURES = [
  'Notes et favoris sans limite',
  'JusquÃ¢â‚¬â„¢ÃƒÂ  10 piÃƒÂ¨ces jointes par note',
  'Images, PDF et vidÃƒÂ©os',
  'JusquÃ¢â‚¬â„¢ÃƒÂ  350 Mo par fichier joint',
  'TÃƒÂ¢ches agenda actives et favorites sans limite',
  'Rappels activÃƒÂ©s',
  'Quotas assistant ÃƒÂ©tendus',
  'CrÃƒÂ©ation de rappels et bundles assistant avancÃƒÂ©s',
];

const FEATURE_MATRIX = [
  { label: 'Notes', free: '15 max', pro: 'Sans limite' },
  { label: 'Notes favorites', free: '10 max', pro: 'Sans limite' },
  { label: 'PiÃƒÂ¨ces jointes par note', free: '5 max', pro: '10 max' },
  { label: 'Types de fichiers', free: 'Images + PDF', pro: 'Images + PDF + vidÃƒÂ©os' },
  { label: 'Taille max par piÃƒÂ¨ce jointe', free: '20 Mo', pro: '350 Mo' },
  { label: 'TÃƒÂ¢ches agenda actives', free: '15 max', pro: 'Sans limite' },
  { label: 'TÃƒÂ¢ches favorites actives', free: '15 max', pro: 'Sans limite' },
  { label: 'Rappels agenda', free: 'Non', pro: 'Oui' },
  { label: 'Checklist', free: 'Inclus', pro: 'Inclus' },
  { label: 'Analyse IA de notes', free: '2 / jour', pro: '100 / jour' },
  { label: 'RÃƒÂ©analyse assistant', free: '10 / jour', pro: '200 / jour' },
  { label: 'Assistant: crÃƒÂ©er un rappel', free: 'Non', pro: 'Oui' },
  { label: 'Assistant: bundle multi-actions', free: 'Non', pro: 'Oui' },
];

export default function UpgradePage() {
  const searchParams = useSearchParams();
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
  const portalReturnDetected = searchParams.get('portal') === 'return';
  const [portalReturnFeedback, setPortalReturnFeedback] = useState<string | null>(null);

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
      const json = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            found?: boolean;
            stripeMode?: 'live' | 'test' | 'unknown';
            attempts?: Array<{ step: string; ok: boolean; detail?: string }>;
            plan?: 'free' | 'pro';
          }
        | null;


      if (json && json.found === false) {
        const mode = json.stripeMode ?? 'unknown';
        setSyncError(
          `Aucun abonnement Stripe nÃ¢â‚¬â„¢a ÃƒÂ©tÃƒÂ© retrouvÃƒÂ© pour ce compte (mode Stripe: ${mode}). Si la souscription est visible dans lÃ¢â‚¬â„¢autre mode (test/live), corrige STRIPE_SECRET_KEY.`,
        );
        return;
      }

      refetch();
    } catch (e) {
      console.error('Sync error', e);
      setSyncError('Impossible de rafraÃƒÂ®chir le statut pour le moment. RÃƒÂ©essaie dans quelques instants.');
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

  useEffect(() => {
    if (!portalReturnDetected) return;
    setPortalReturnFeedback('Retour Stripe dÃƒÂ©tectÃƒÂ©. TaskNote actualise ton statut dÃ¢â‚¬â„¢abonnement.');
    const timer = window.setTimeout(() => setPortalReturnFeedback(null), 5000);
    return () => window.clearTimeout(timer);
  }, [portalReturnDetected]);

  const handleCheckout = async () => {
    if (isAndroid) {
      setError('Ton abonnement est gÃƒÂ©rÃƒÂ© via Google Play.');
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
      setError("Impossible dÃ¢â‚¬â„¢ouvrir le paiement pour le moment. RÃƒÂ©essaie dans quelques instants.");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenPortal = async () => {
    if (isAndroid) {
      setPortalError('Ton abonnement est gÃƒÂ©rÃƒÂ© via Google Play.');
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
        setPortalError('Ta session a expirÃƒÂ©. RafraÃƒÂ®chis la page et reconnecte-toi si besoin.');
      } else if (message === 'RETURN_URL_NOT_ALLOWED') {
        const upgradeUrl =
          typeof window !== 'undefined' && window.location?.origin
            ? `${window.location.origin}/upgrade?portal=return`
            : 'https://app.tasknote.io/upgrade?portal=return';
        setPortalError(
          `Configuration Stripe requise: ajoute ${upgradeUrl} dans les URLs de retour autorisÃƒÂ©es du portail client, puis rÃƒÂ©essaie.`,
        );
      } else if (message === 'NO_SUCH_CUSTOMER') {
        setPortalError(
          'Ce compte Stripe est introuvable (souvent un mismatch test/live). VÃƒÂ©rifie que STRIPE_SECRET_KEY et le customerId utilisent le mÃƒÂªme mode.',
        );
      } else if (message === 'MISSING_CUSTOMER') {
        setPortalError(
          'La gestion de lÃ¢â‚¬â„¢abonnement nÃ¢â‚¬â„¢est pas encore disponible pour ce compte. Contacte le support si le problÃƒÂ¨me persiste.',
        );
      } else if (message === 'PORTAL_NOT_ENABLED') {
        setPortalError('Active le portail client dans Stripe (Billing > Customer portal), puis rÃƒÂ©essaie.');
      } else if (message === 'PORTAL_UNAVAILABLE') {
        setPortalError('Le portail Stripe est temporairement indisponible. RÃƒÂ©essaie dans quelques instants.');
      } else {
        setPortalError('Impossible dÃ¢â‚¬â„¢ouvrir la gestion de lÃ¢â‚¬â„¢abonnement. VÃƒÂ©rifie ta connexion et rÃƒÂ©essaie.');
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
          <p className="text-sm text-muted-foreground">Ton abonnement est gÃƒÂ©rÃƒÂ© via Google Play.</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Compare les limites reellement appliquees entre Free et Pro. Tu peux annuler a tout moment depuis le portail securise Stripe.
          </p>
        )}
      </div>

      {portalReturnFeedback && (
        <div className="sn-alert sn-alert--success" role="status" aria-live="polite">
          {portalReturnFeedback}
        </div>
      )}

      <div className="border border-border rounded-lg p-4 bg-card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">
            <span className="font-medium">Statut actuel:</span>{' '}
            <span>
              {userLoading ? 'ChargementÃ¢â‚¬Â¦' : isPro ? (hasActiveStripeSubscription ? 'Pro' : 'Pro (ÃƒÂ  confirmer)') : 'Free'}
            </span>
          </div>
          <div
            className={`text-xs px-2 py-1 rounded-full border ${
              isPro && hasActiveStripeSubscription
                ? 'border-primary/30 bg-primary/10 text-foreground'
                : 'border-border bg-background text-muted-foreground'
            }`}
          >
            {isPro ? (hasActiveStripeSubscription ? 'Plan actif' : 'Statut ÃƒÂ  vÃƒÂ©rifier') : 'Plan de base'}
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
              LÃ¢â‚¬â„¢essentiel pour organiser tes notes, ton agenda et tes checklists avec des limites claires.
            </p>
            <ul className="text-sm text-muted-foreground space-y-1">
              {FREE_FEATURES.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
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
              Plus de libertÃƒÂ©, des quotas ÃƒÂ©largis et les fonctionnalitÃƒÂ©s avancÃƒÂ©es rÃƒÂ©ellement disponibles aujourdÃ¢â‚¬â„¢hui.
            </p>
            <ul className="text-sm text-muted-foreground space-y-1">
              {PRO_FEATURES.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <div className="text-sm font-medium pt-1">1,99Ã¢â€šÂ¬ / mois</div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-background p-4 space-y-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">Comparatif Free / Pro</div>
            <div className="text-xs text-muted-foreground">
              Cette grille reflÃƒÂ¨te les limites et accÃƒÂ¨s rÃƒÂ©ellement appliquÃƒÂ©s dans TaskNote aujourdÃ¢â‚¬â„¢hui.
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2 pr-4 font-medium">FonctionnalitÃƒÂ©</th>
                  <th className="py-2 pr-4 font-medium">Free</th>
                  <th className="py-2 font-medium">Pro</th>
                </tr>
              </thead>
              <tbody>
                {FEATURE_MATRIX.map((row) => (
                  <tr key={row.label} className="border-b border-border/60 align-top">
                    <td className="py-2 pr-4 font-medium text-foreground">{row.label}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{row.free}</td>
                    <td className="py-2 text-muted-foreground">{row.pro}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-muted-foreground">
            Les checklists restent disponibles sur les deux plans, sans quota dÃƒÂ©diÃƒÂ© supplÃƒÂ©mentaire affichÃƒÂ© aujourdÃ¢â‚¬â„¢hui.
          </div>
        </div>

        <div className="space-y-2">
          {isAndroid ? (
            <div className="rounded-lg border border-border bg-background p-3 space-y-2">
              <div className="text-sm font-medium">Abonnement Android</div>
              <div className="text-xs text-muted-foreground">Ton abonnement est gÃƒÂ©rÃƒÂ© via Google Play.</div>
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
                  {isPro && hasActiveStripeSubscription ? 'Pro activÃƒÂ©' : loading ? 'RedirectionÃ¢â‚¬Â¦' : 'Passer ÃƒÂ  Pro'}
                </button>
              </div>

              {!isPro && (
                <div className="text-xs text-muted-foreground">
                  La gestion de lÃ¢â‚¬â„¢abonnement est disponible aprÃƒÂ¨s activation du plan Pro.
                </div>
              )}

              {!isPro && (
                <div className="rounded-lg border border-border bg-background p-3 space-y-2">
                  <div className="text-sm font-medium">Deja abonne ?</div>
                  <div className="text-xs text-muted-foreground">
                    Si ton paiement Stripe a ÃƒÂ©tÃƒÂ© confirmÃƒÂ© mais que ton statut est encore Free, rafraÃƒÂ®chis le statut.
                  </div>
                  <button
                    type="button"
                    onClick={handleSync}
                    disabled={syncLoading}
                    className="inline-flex items-center justify-center px-4 py-2 rounded-md border border-border bg-background text-sm font-medium disabled:opacity-50"
                  >
                    {syncLoading ? 'RafraÃƒÂ®chissementÃ¢â‚¬Â¦' : 'RafraÃƒÂ®chir le statut'}
                  </button>
                  {syncError && <p className="text-sm text-destructive">{syncError}</p>}
                </div>
              )}

              {isPro && hasActiveStripeSubscription && (
                <div className="rounded-lg border border-border bg-background p-3 space-y-2">
                  <div className="text-sm font-medium">GÃƒÂ©rer mon abonnement</div>
                  <div className="text-xs text-muted-foreground">
                    Tout se fait dans le portail Stripe sÃƒÂ©curisÃƒÂ©. Tu peux y modifier ton moyen de paiement, tÃƒÂ©lÃƒÂ©charger tes factures ou annuler.
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      type="button"
                      onClick={handleOpenPortal}
                      disabled={portalLoading}
                      className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                    >
                      {portalLoading ? 'OuvertureÃ¢â‚¬Â¦' : 'GÃƒÂ©rer mon abonnement'}
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenPortal}
                      disabled={portalLoading}
                      className="inline-flex items-center justify-center px-4 py-2 rounded-md border border-destructive/30 bg-destructive/5 text-sm font-medium text-destructive disabled:opacity-50"
                    >
                      {portalLoading ? 'OuvertureÃ¢â‚¬Â¦' : 'Annuler lÃ¢â‚¬â„¢abonnement'}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleSync}
                    disabled={syncLoading}
                    className="inline-flex items-center justify-center px-4 py-2 rounded-md border border-border bg-background text-sm font-medium disabled:opacity-50"
                  >
                    {syncLoading ? 'RafraÃƒÂ®chissementÃ¢â‚¬Â¦' : 'RafraÃƒÂ®chir le statut'}
                  </button>
                  {!stripeCustomerId && (
                    <div className="text-xs text-muted-foreground">
                      Ce compte n'est pas encore relie a Stripe. Si tu viens de t'abonner, attends quelques instants puis reessaie.
                    </div>
                  )}
                  {syncError && <p className="text-sm text-destructive">{syncError}</p>}
                </div>
              )}

              {isPro && !hasActiveStripeSubscription && (
                <div className="rounded-lg border border-border bg-background p-3 space-y-2">
                  <div className="text-sm font-medium">Abonnement Stripe</div>
                  <div className="text-xs text-muted-foreground">
                    Ton abonnement Stripe ne semble plus actif. Le plan sera remis a jour automatiquement.
                  </div>
                  <button
                    type="button"
                    onClick={handleSync}
                    disabled={syncLoading}
                    className="inline-flex items-center justify-center px-4 py-2 rounded-md border border-border bg-background text-sm font-medium disabled:opacity-50"
                  >
                    {syncLoading ? 'RafraÃƒÂ®chissementÃ¢â‚¬Â¦' : 'RafraÃƒÂ®chir le statut'}
                  </button>
                  {syncError && <p className="text-sm text-destructive">{syncError}</p>}
                </div>
              )}

              <div className="text-xs text-muted-foreground">
                Paiement securise par Stripe. Annulation en un clic, sans engagement. Le statut Pro est mis a jour automatiquement.
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
