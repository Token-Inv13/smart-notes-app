'use client';

import { useMemo } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  limit as fsLimit,
  type Query,
  type CollectionReference,
  type QueryConstraint,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { useCollection } from '@/hooks/useCollection';
import type { NoteDoc } from '@/types/firestore';

interface UseUserNotesParams {
  workspaceId?: string;
  limit?: number;
}

export function useUserNotes(params?: UseUserNotesParams) {
  const { user } = useAuth();

  const notesQuery: Query<NoteDoc> | null = useMemo(() => {
    if (!user) return null;

    const baseRef = collection(db, 'notes') as CollectionReference<NoteDoc>;
    const constraints: QueryConstraint[] = [where('userId', '==', user.uid)];

    if (params?.workspaceId) {
      constraints.push(where('workspaceId', '==', params.workspaceId));
    }

    constraints.push(orderBy('updatedAt', 'desc'));

    if (params?.limit && params.limit > 0) {
      constraints.push(fsLimit(params.limit));
    }

    return query(baseRef, ...constraints) as Query<NoteDoc>;
  }, [user?.uid, params?.workspaceId, params?.limit]);

  if (!user) {
    return { data: [] as NoteDoc[], loading: false, error: null as Error | null, refetch: () => {} };
  }

  return useCollection<NoteDoc>(notesQuery);
}
