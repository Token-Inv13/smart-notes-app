'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';

type UseAdminGuardState = {
  ready: boolean;
  loading: boolean;
  error: string | null;
};

export function useAdminGuard(): UseAdminGuardState {
  const { user, loading: authLoading, status: authStatus, error: authError } = useAuth();
  const [validatedUid, setValidatedUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (authLoading || !user) {
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const token = await user.getIdTokenResult(true);
        if (cancelled) return;

        if (token.claims.admin !== true) {
          setError('Le compte connecté ne porte pas le claim admin côté client. Rafraîchis la session admin.');
          setValidatedUid(null);
          return;
        }

        setValidatedUid(user.uid);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setValidatedUid(null);
        setError(err instanceof Error ? err.message : 'Impossible de valider la session admin côté client.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  const claimsLoading = Boolean(user?.uid) && validatedUid !== (user?.uid ?? null) && error == null;
  const effectiveError =
    authStatus === 'session-error'
      ? authError ?? 'Session Firebase invalide. Recharge la page puis reconnecte-toi.'
      : !authLoading && !user
        ? 'Session Firebase indisponible. Recharge la page puis reconnecte-toi si besoin.'
        : error;

  return {
    ready: !authLoading && !claimsLoading && !effectiveError,
    loading: authLoading || claimsLoading,
    error: effectiveError,
  };
}
