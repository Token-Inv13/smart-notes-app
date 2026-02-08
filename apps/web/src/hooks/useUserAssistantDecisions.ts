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
import type { AssistantDecisionDoc } from '@/types/firestore';

type UseUserAssistantDecisionsParams = {
  limit?: number;
};

export function useUserAssistantDecisions(params?: UseUserAssistantDecisionsParams) {
  const { user } = useAuth();
  const userUid = user?.uid;

  const decisionsQuery: Query<AssistantDecisionDoc> | null = useMemo(() => {
    if (!userUid) return null;

    const baseRef = collection(
      db,
      'users',
      userUid,
      'assistantDecisions',
    ) as CollectionReference<AssistantDecisionDoc>;

    const constraints: QueryConstraint[] = [orderBy('createdAt', 'desc')];

    if (params?.limit && params.limit > 0) {
      constraints.push(fsLimit(params.limit));
    }

    return query(baseRef, ...constraints) as Query<AssistantDecisionDoc>;
  }, [userUid, params?.limit]);

  return useCollection<AssistantDecisionDoc>(decisionsQuery);
}
