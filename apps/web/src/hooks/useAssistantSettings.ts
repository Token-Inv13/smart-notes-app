'use client';

import { useEffect, useState } from 'react';
import {
  doc,
  onSnapshot,
  type DocumentReference,
  type DocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { invalidateAuthSession, isAuthInvalidError } from '@/lib/authInvalidation';
import type { AssistantSettingsDoc } from '@/types/firestore';

interface UseAssistantSettingsState {
  data: AssistantSettingsDoc | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useAssistantSettings(): UseAssistantSettingsState {
  const { user } = useAuth();
  const [data, setData] = useState<AssistantSettingsDoc | null>(null);
  const [loading, setLoading] = useState<boolean>(!!user);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!user) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setData(null);
    setError(null);

    const ref = doc(db, 'users', user.uid, 'assistantSettings', 'main') as DocumentReference<AssistantSettingsDoc>;

    const unsubscribe = onSnapshot(
      ref,
      (snapshot: DocumentSnapshot<AssistantSettingsDoc>) => {
        if (snapshot.exists()) {
          setData(snapshot.data() as AssistantSettingsDoc);
        } else {
          setData(null);
        }
        setLoading(false);
      },
      (err) => {
        setError(err as Error);
        setLoading(false);
        if (isAuthInvalidError(err)) {
          void invalidateAuthSession();
        }
      },
    );

    return () => unsubscribe();
  }, [user, version]);

  const refetch = () => setVersion((v) => v + 1);

  return { data, loading, error, refetch };
}
