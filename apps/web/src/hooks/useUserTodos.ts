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
import type { TodoDoc } from '@/types/firestore';

interface UseUserTodosParams {
  workspaceId?: string;
  favoriteOnly?: boolean;
  completed?: boolean;
  limit?: number;
}

export function useUserTodos(params?: UseUserTodosParams) {
  const { user } = useAuth();
  const userUid = user?.uid;

  const todosQuery: Query<TodoDoc> | null = useMemo(() => {
    if (!userUid) return null;

    const baseRef = collection(db, 'todos') as CollectionReference<TodoDoc>;
    const constraints: QueryConstraint[] = [where('userId', '==', userUid)];

    if (params?.workspaceId) {
      constraints.push(where('workspaceId', '==', params.workspaceId));
    }

    if (params?.favoriteOnly) {
      constraints.push(where('favorite', '==', true));
    }

    if (typeof params?.completed === 'boolean') {
      constraints.push(where('completed', '==', params.completed));
    }

    constraints.push(orderBy('updatedAt', 'desc'));

    if (params?.limit && params.limit > 0) {
      constraints.push(fsLimit(params.limit));
    }

    return query(baseRef, ...constraints) as Query<TodoDoc>;
  }, [userUid, params?.workspaceId, params?.favoriteOnly, params?.completed, params?.limit]);

  return useCollection<TodoDoc>(todosQuery);
}
