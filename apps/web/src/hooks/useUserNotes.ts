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
  enabled?: boolean;
  workspaceId?: string;
  favoriteOnly?: boolean;
  limit?: number;
}

export function useUserNotes(params?: UseUserNotesParams) {
  const { user } = useAuth();
  const userUid = user?.uid;
  const enabled = params?.enabled;
  const workspaceId = params?.workspaceId;
  const favoriteOnly = params?.favoriteOnly;
  const queryLimit = params?.limit;

  const notesQuery: Query<NoteDoc> | null = useMemo(() => {
    if (enabled === false) return null;
    if (!userUid) return null;

    const baseRef = collection(db, 'notes') as CollectionReference<NoteDoc>;
    const constraints: QueryConstraint[] = [where('userId', '==', userUid)];

    if (workspaceId) {
      constraints.push(where('workspaceId', '==', workspaceId));
    }

    if (favoriteOnly) {
      constraints.push(where('favorite', '==', true));
    }

    constraints.push(orderBy('updatedAt', 'desc'));

    if (queryLimit && queryLimit > 0) {
      constraints.push(fsLimit(queryLimit));
    }

    return query(baseRef, ...constraints) as Query<NoteDoc>;
  }, [userUid, enabled, workspaceId, favoriteOnly, queryLimit]);

  return useCollection<NoteDoc>(notesQuery);
}
