'use client';

import { useEffect, useState } from 'react';
import {
  type Query,
  type QuerySnapshot,
  onSnapshot,
} from 'firebase/firestore';

interface UseCollectionState<T> {
  data: T[];
  loading: boolean;
  error: Error | null;
}

export function useCollection<T>(query: Query<T> | null): UseCollectionState<T> & { refetch: () => void } {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState<boolean>(!!query);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!query) {
      setData([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    const unsubscribe = onSnapshot(
      query as Query<T>,
      (snapshot: QuerySnapshot<T>) => {
        const docs = snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as T) }));
        setData(docs);
        setLoading(false);
      },
      (err) => {
        setError(err as Error);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [query, version]);

  const refetch = () => setVersion((v) => v + 1);

  return { data, loading, error, refetch };
}

