'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { trackEventBeforeNavigation } from '@/lib/analytics';
import { useUserSettings } from '@/hooks/useUserSettings';
import { isAndroidNative } from '@/lib/runtimePlatform';
import type { UserDoc } from '@/types/firestore';

const FREE_FEATURES = [
  'JusquÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã‚Â  15 notes',
  'JusquÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã‚Â  10 notes favorites',
  'JusquÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã‚Â  5 piÃƒÆ’Ã‚Â¨ces jointes par note',
  'Images et PDF uniquement',
  'JusquÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã‚Â  20 Mo par fichier joint',
  'JusquÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã‚Â  15 tÃƒÆ’Ã‚Â¢ches agenda actives',
  'JusquÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã‚Â  15 tÃƒÆ’Ã‚Â¢ches favorites actives',
  'Rappels dÃƒÆ’Ã‚Â©sactivÃƒÆ’Ã‚Â©s',
  'Assistant disponible avec quotas Free',
];

const PRO_FEATURES = [
  'Notes et favoris sans limite',
  'JusquÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã‚Â  10 piÃƒÆ’Ã‚Â¨ces jointes par note',
  'Images, PDF et vidÃƒÆ’Ã‚Â©os',
  'JusquÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã‚Â  350 Mo par fichier joint',
  'TÃƒÆ’Ã‚Â¢ches agenda actives et favorites sans limite',
  'Rappels activÃƒÆ’Ã‚Â©s',
  'Quotas assistant ÃƒÆ’Ã‚Â©tendus',
  'CrÃƒÆ’Ã‚Â©ation de rappels et bundles assistant avancÃƒÆ’Ã‚Â©s',
];

const FEATURE_MATRIX = [
  { label: 'Notes', free: '15 max', pro: 'Sans limite' },
  { label: 'Notes favorites', free: '10 max', pro: 'Sans limite' },
  { label: 'PiÃƒÆ’Ã‚Â¨ces jointes par note', free: '5 max', pro: '10 max' },
  { label: 'Types de fichiers', free: 'Images + PDF', pro: 'Images + PDF + vidÃƒÆ’Ã‚Â©os' },
  { label: 'Taille max par piÃƒÆ’Ã‚Â¨ce jointe', free: '20 Mo', pro: '350 Mo' },
  { label: 'TÃƒÆ’Ã‚Â¢ches agenda actives', free: '15 max', pro: 'Sans limite' },
  { label: 'TÃƒÆ’Ã‚Â¢ches favorites actives', free: '15 max', pro: 'Sans limite' },
  { label: 'Rappels agenda', free: 'Non', pro: 'Oui' },
  { label: 'Checklist', free: 'Inclus', pro: 'Inclus' },
  { label: 'Analyse IA de notes', free: '2 / jour', pro: '100 / jour' },
  { label: 'RÃƒÆ’Ã‚Â©analyse assistant', free: '10 / jour', pro: '200 / jour' },
  { label: 'Assistant: crÃƒÆ’Ã‚Â©er un rappel', free: 'Non', pro: 'Oui' },
  { label: 'Assistant: bundle multi-actions', free: 'Non', pro: 'Oui' },
];

const PENDING_SUBSCRIBE_TRACKING_KEY = "tasknote_pending_subscribe_tracking";

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
          `Aucun abonnement Stripe nÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢a ÃƒÆ’Ã‚Â©tÃƒÆ’Ã‚Â© retrouvÃƒÆ’Ã‚Â© pour ce compte (mode Stripe: ${mode}). Si la souscription est visible dans lÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢autre mode (test/live), corrige STRIPE_SECRET_KEY.`,
        );
        return;
      }

      refetch();
    } catch (e) {
      console.error('Sync error', e);
      setSyncError('Impossible de rafraÃƒÆ’Ã‚Â®chir le statut pour le moment. RÃƒÆ’Ã‚Â©essaie dans quelques instants.');
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
    setPortalReturnFeedback('Retour Stripe dÃƒÆ’Ã‚Â©tectÃƒÆ’Ã‚Â©. TaskNote actualise ton statut dÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢abonnement.');
    const timer = window.setTimeout(() => setPortalReturnFeedback(null), 5000);
    return () => window.clearTimeout(timer);
  }, [portalReturnDetected]);

  const handleCheckout = async () => {
    if (isAndroid) {
      setError('Ton abonnement est gÃƒÆ’Ã‚Â©rÃƒÆ’Ã‚Â© via Google Play.');
      return;
    }
    setLoading(true);
    setError(null);

    try {
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(PENDING_SUBSCRIBE_TRACKING_KEY, String(Date.now()));
      }
      await trackEventBeforeNavigation("upgrade_click", {
        source: "app",
        plan: "pro",
      });
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
      setError("Impossible dÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ouvrir le paiement pour le moment. RÃƒÆ’Ã‚Â©essaie dans quelques instants.");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenPortal = async () => {
    if (isAndroid) {
      setPortalError('Ton abonnement est gÃƒÆ’Ã‚Â©rÃƒÆ’Ã‚Â© via Google Play.');
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
        setPortalError('Ta session a expirÃƒÆ’Ã‚Â©. RafraÃƒÆ’Ã‚Â®chis la page et reconnecte-toi si besoin.');
      } else if (message === 'RETURN_URL_NOT_ALLOWED') {
        const upgradeUrl =
          typeof window !== 'undefined' && window.location?.origin
            ? `${window.location.origin}/upgrade?portal=return`
            : 'https://app.tasknote.io/upgrade?portal=return';
        setPortalError(
          `Configuration Stripe requise: ajoute ${upgradeUrl} dans les URLs de retour autorisÃƒÆ’Ã‚Â©es du portail client, puis rÃƒÆ’Ã‚Â©essaie.`,
        );
      } else if (message === 'NO_SUCH_CUSTOMER') {
        setPortalError(
          'Ce compte Stripe est introuvable (souvent un mismatch test/live). VÃƒÆ’Ã‚Â©rifie que STRIPE_SECRET_KEY et le customerId utilisent le mÃƒÆ’Ã‚Âªme mode.',
        );
      } else if (message === 'MISSING_CUSTOMER') {
        setPortalError(
          'La gestion de lÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢abonnement nÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢est pas encore disponible pour ce compte. Contacte le support si le problÃƒÆ’Ã‚Â¨me persiste.',
        );
      } else if (message === 'PORTAL_NOT_ENABLED') {
        setPortalError('Active le portail client dans Stripe (Billing > Customer portal), puis rÃƒÆ’Ã‚Â©essaie.');
      } else if (message === 'PORTAL_UNAVAILABLE') {
        setPortalError('Le portail Stripe est temporairement indisponible. RÃƒÆ’Ã‚Â©essaie dans quelques instants.');
      } else {
        setPortalError('Impossible dÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ouvrir la gestion de lÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢abonnement. VÃƒÆ’Ã‚Â©rifie ta connexion et rÃƒÆ’Ã‚Â©essaie.');
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
          <p className="text-sm text-muted-foreground">Ton abonnement est gÃƒÆ’Ã‚Â©rÃƒÆ’Ã‚Â© via Google Play.</p>
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
              {userLoading ? 'ChargementÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦' : isPro ? (hasActiveStripeSubscription ? 'Pro' : 'Pro (ÃƒÆ’Ã‚Â  confirmer)') : 'Free'}
            </span>
          </div>
          <div
            className={`text-xs px-2 py-1 rounded-full border ${
              isPro && hasActiveStripeSubscription
                ? 'border-primary/30 bg-primary/10 text-foreground'
                : 'border-border bg-background text-muted-foreground'
            }`}
          >
            {isPro ? (hasActiveStripeSubscription ? 'Plan actif' : 'Statut ÃƒÆ’Ã‚Â  vÃƒÆ’Ã‚Â©rifier') : 'Plan de base'}
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
              LÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢essentiel pour organiser tes notes, ton agenda et tes checklists avec des limites claires.
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
              Plus de libertÃƒÆ’Ã‚Â©, des quotas ÃƒÆ’Ã‚Â©largis et les fonctionnalitÃƒÆ’Ã‚Â©s avancÃƒÆ’Ã‚Â©es rÃƒÆ’Ã‚Â©ellement disponibles aujourdÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢hui.
            </p>
            <ul className="text-sm text-muted-foreground space-y-1">
              {PRO_FEATURES.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <div className="text-sm font-medium pt-1">1,99ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ / mois</div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-background p-4 space-y-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">Comparatif Free / Pro</div>
            <div className="text-xs text-muted-foreground">
              Cette grille reflÃƒÆ’Ã‚Â¨te les limites et accÃƒÆ’Ã‚Â¨s rÃƒÆ’Ã‚Â©ellement appliquÃƒÆ’Ã‚Â©s dans TaskNote aujourdÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢hui.
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2 pr-4 font-medium">FonctionnalitÃƒÆ’Ã‚Â©</th>
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
            Les checklists restent disponibles sur les deux plans, sans quota dÃƒÆ’Ã‚Â©diÃƒÆ’Ã‚Â© supplÃƒÆ’Ã‚Â©mentaire affichÃƒÆ’Ã‚Â© aujourdÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢hui.
          </div>
        </div>

        <div className="space-y-2">
          {isAndroid ? (
            <div className="rounded-lg border border-border bg-background p-3 space-y-2">
              <div className="text-sm font-medium">Abonnement Android</div>
              <div className="text-xs text-muted-foreground">Ton abonnement est gÃƒÆ’Ã‚Â©rÃƒÆ’Ã‚Â© via Google Play.</div>
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
                  {isPro && hasActiveStripeSubscription ? 'Pro activÃƒÆ’Ã‚Â©' : loading ? 'RedirectionÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦' : 'Passer ÃƒÆ’Ã‚Â  Pro'}
                </button>
              </div>

              {!isPro && (
                <div className="text-xs text-muted-foreground">
                  La gestion de lÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢abonnement est disponible aprÃƒÆ’Ã‚Â¨s activation du plan Pro.
                </div>
              )}

              {!isPro && (
                <div className="rounded-lg border border-border bg-background p-3 space-y-2">
                  <div className="text-sm font-medium">Deja abonne ?</div>
                  <div className="text-xs text-muted-foreground">
                    Si ton paiement Stripe a ÃƒÆ’Ã‚Â©tÃƒÆ’Ã‚Â© confirmÃƒÆ’Ã‚Â© mais que ton statut est encore Free, rafraÃƒÆ’Ã‚Â®chis le statut.
                  </div>
                  <button
                    type="button"
                    onClick={handleSync}
                    disabled={syncLoading}
                    className="inline-flex items-center justify-center px-4 py-2 rounded-md border border-border bg-background text-sm font-medium disabled:opacity-50"
                  >
                    {syncLoading ? 'RafraÃƒÆ’Ã‚Â®chissementÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦' : 'RafraÃƒÆ’Ã‚Â®chir le statut'}
                  </button>
                  {syncError && <p className="text-sm text-destructive">{syncError}</p>}
                </div>
              )}

              {isPro && hasActiveStripeSubscription && (
                <div className="rounded-lg border border-border bg-background p-3 space-y-2">
                  <div className="text-sm font-medium">GÃƒÆ’Ã‚Â©rer mon abonnement</div>
                  <div className="text-xs text-muted-foreground">
                    Tout se fait dans le portail Stripe sÃƒÆ’Ã‚Â©curisÃƒÆ’Ã‚Â©. Tu peux y modifier ton moyen de paiement, tÃƒÆ’Ã‚Â©lÃƒÆ’Ã‚Â©charger tes factures ou annuler.
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      type="button"
                      onClick={handleOpenPortal}
                      disabled={portalLoading}
                      className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                    >
                      {portalLoading ? 'OuvertureÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦' : 'GÃƒÆ’Ã‚Â©rer mon abonnement'}
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenPortal}
                      disabled={portalLoading}
                      className="inline-flex items-center justify-center px-4 py-2 rounded-md border border-destructive/30 bg-destructive/5 text-sm font-medium text-destructive disabled:opacity-50"
                    >
                      {portalLoading ? 'OuvertureÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦' : 'Annuler lÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢abonnement'}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleSync}
                    disabled={syncLoading}
                    className="inline-flex items-center justify-center px-4 py-2 rounded-md border border-border bg-background text-sm font-medium disabled:opacity-50"
                  >
                    {syncLoading ? 'RafraÃƒÆ’Ã‚Â®chissementÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦' : 'RafraÃƒÆ’Ã‚Â®chir le statut'}
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
                    {syncLoading ? 'RafraÃƒÆ’Ã‚Â®chissementÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦' : 'RafraÃƒÆ’Ã‚Â®chir le statut'}
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
