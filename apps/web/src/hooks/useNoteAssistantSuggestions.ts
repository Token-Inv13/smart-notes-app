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
import type { AssistantSuggestionDoc } from '@/types/firestore';

type UseNoteAssistantSuggestionsParams = {
  limit?: number;
};

export function useNoteAssistantSuggestions(noteId: string | undefined, params?: UseNoteAssistantSuggestionsParams) {
  const { user } = useAuth();
  const userUid = user?.uid;

  const suggestionsQuery: Query<AssistantSuggestionDoc> | null = useMemo(() => {
    if (!userUid) return null;
    if (!noteId) return null;

    const objectId = `note_${noteId}`;

    const baseRef = collection(
      db,
      'users',
      userUid,
      'assistantSuggestions',
    ) as CollectionReference<AssistantSuggestionDoc>;

    const constraints: QueryConstraint[] = [
      where('objectId', '==', objectId),
      where('status', '==', 'proposed'),
      orderBy('updatedAt', 'desc'),
    ];

    if (params?.limit && params.limit > 0) {
      constraints.push(fsLimit(params.limit));
    }

    return query(baseRef, ...constraints) as Query<AssistantSuggestionDoc>;
  }, [userUid, noteId, params?.limit]);

  return useCollection<AssistantSuggestionDoc>(suggestionsQuery);
}
