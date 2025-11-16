'use client';

import { useEffect, useState } from 'react';
import { auth, onAuthStateChanged, type User } from '../lib/firebase';

interface UseAuthState {
  user: User | null;
  loading: boolean;
}

export function useAuth(): UseAuthState {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return { user, loading };
}
