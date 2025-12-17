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
  favoriteOnly?: boolean;
  limit?: number;
}

export function useUserNotes(params?: UseUserNotesParams) {
  const { user } = useAuth();
  const userUid = user?.uid;

  const notesQuery: Query<NoteDoc> | null = useMemo(() => {
    if (!userUid) return null;

    const baseRef = collection(db, 'notes') as CollectionReference<NoteDoc>;
    const constraints: QueryConstraint[] = [where('userId', '==', userUid)];

    if (params?.workspaceId) {
      constraints.push(where('workspaceId', '==', params.workspaceId));
    }

    if (params?.favoriteOnly) {
      constraints.push(where('favorite', '==', true));
    }

    constraints.push(orderBy('updatedAt', 'desc'));

    if (params?.limit && params.limit > 0) {
      constraints.push(fsLimit(params.limit));
    }

    return query(baseRef, ...constraints) as Query<NoteDoc>;
  }, [userUid, params?.workspaceId, params?.favoriteOnly, params?.limit]);

  return useCollection<NoteDoc>(notesQuery);
}
