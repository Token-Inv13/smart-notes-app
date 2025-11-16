'use client';

import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, type QuerySnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import type { WorkspaceDoc } from '@/types/firestore';

interface UseUserWorkspacesState {
  data: WorkspaceDoc[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useUserWorkspaces(): UseUserWorkspacesState {
  const { user } = useAuth();
  const [data, setData] = useState<WorkspaceDoc[]>([]);
  const [loading, setLoading] = useState<boolean>(!!user);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!user) {
      setData([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);

    const ownerRef = query(
      collection(db, 'workspaces'),
      where('ownerId', '==', user.uid),
    );

    const memberRef = query(
      collection(db, 'workspaces'),
      where('members', 'array-contains', user.uid),
    );

    const unsubscribeOwners = onSnapshot(
      ownerRef,
      (snapshot: QuerySnapshot<WorkspaceDoc>) => {
        const ownerDocs = snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as WorkspaceDoc) }));
        setData((prev) => {
          const memberOnly = prev.filter((w) => w.ownerId !== user.uid);
          return [...ownerDocs, ...memberOnly];
        });
        setLoading(false);
      },
      (err) => {
        setError(err as Error);
        setLoading(false);
      },
    );

    const unsubscribeMembers = onSnapshot(
      memberRef,
      (snapshot: QuerySnapshot<WorkspaceDoc>) => {
        const memberDocs = snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as WorkspaceDoc) }));
        setData((prev) => {
          const ownerOnly = prev.filter((w) => w.ownerId === user.uid);
          const byId = new Map<string, WorkspaceDoc>();
          [...ownerOnly, ...memberDocs].forEach((w) => {
            if (w.id) byId.set(w.id, w);
          });
          return Array.from(byId.values());
        });
        setLoading(false);
      },
      (err) => {
        setError(err as Error);
        setLoading(false);
      },
    );

    return () => {
      unsubscribeOwners();
      unsubscribeMembers();
    };
  }, [user, version]);

  const refetch = () => setVersion((v) => v + 1);

  return { data, loading, error, refetch };
}
