'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot, type DocumentSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import type { UserDoc } from '@/types/firestore';

interface UseUserSettingsState {
  data: UserDoc | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useUserSettings(): UseUserSettingsState {
  const { user } = useAuth();
  const [data, setData] = useState<UserDoc | null>(null);
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

    const ref = doc(db, 'users', user.uid);

    const unsubscribe = onSnapshot(
      ref as any,
      (snapshot: DocumentSnapshot<UserDoc>) => {
        if (snapshot.exists()) {
          setData({ id: snapshot.id, ...(snapshot.data() as UserDoc) });
        } else {
          setData(null);
        }
        setLoading(false);
      },
      (err) => {
        setError(err as Error);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [user, version]);

  const refetch = () => setVersion((v) => v + 1);

  return { data, loading, error, refetch };
}
