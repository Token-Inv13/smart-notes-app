'use client';

import { useEffect, useState } from 'react';
import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type DocumentReference,
  type DocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { invalidateAuthSession, isAuthInvalidError } from '@/lib/authInvalidation';
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
    setData(null);
    setError(null);

    const ref = doc(db, 'users', user.uid) as DocumentReference<UserDoc>;

    const unsubscribe = onSnapshot(
      ref,
      (snapshot: DocumentSnapshot<UserDoc>) => {
        if (snapshot.exists()) {
          setData({ id: snapshot.id, ...(snapshot.data() as UserDoc) });
        } else {
          // First login / legacy accounts: ensure a default user document exists.
          void setDoc(
            ref,
            {
              uid: user.uid,
              email: user.email ?? null,
              displayName: user.displayName ?? null,
              photoURL: user.photoURL ?? null,
              plan: 'free',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              settings: {
                appearance: { mode: 'light', background: 'none' },
                notifications: { taskReminders: false },
              },
            } as unknown as UserDoc,
            { merge: true },
          );
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
