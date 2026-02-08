'use client';

import { useMemo } from 'react';
import {
  collection,
  query,
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

type UseUserAssistantSuggestionsParams = {
  limit?: number;
};

export function useUserAssistantSuggestions(params?: UseUserAssistantSuggestionsParams) {
  const { user } = useAuth();
  const userUid = user?.uid;

  const suggestionsQuery: Query<AssistantSuggestionDoc> | null = useMemo(() => {
    if (!userUid) return null;

    const baseRef = collection(
      db,
      'users',
      userUid,
      'assistantSuggestions',
    ) as CollectionReference<AssistantSuggestionDoc>;

    const constraints: QueryConstraint[] = [orderBy('updatedAt', 'desc')];

    if (params?.limit && params.limit > 0) {
      constraints.push(fsLimit(params.limit));
    }

    return query(baseRef, ...constraints) as Query<AssistantSuggestionDoc>;
  }, [userUid, params?.limit]);

  return useCollection<AssistantSuggestionDoc>(suggestionsQuery);
}
