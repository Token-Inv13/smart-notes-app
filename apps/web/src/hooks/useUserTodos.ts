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
  enabled?: boolean;
  workspaceId?: string;
  favoriteOnly?: boolean;
  completed?: boolean;
  limit?: number;
}

export function useUserTodos(params?: UseUserTodosParams) {
  const { user } = useAuth();
  const userUid = user?.uid;
  const enabled = params?.enabled;
  const workspaceId = params?.workspaceId;
  const favoriteOnly = params?.favoriteOnly;
  const completed = params?.completed;
  const queryLimit = params?.limit;

  const todosQuery: Query<TodoDoc> | null = useMemo(() => {
    if (enabled === false) return null;
    if (!userUid) return null;

    const baseRef = collection(db, 'todos') as CollectionReference<TodoDoc>;
    const constraints: QueryConstraint[] = [where('userId', '==', userUid)];

    if (workspaceId) {
      constraints.push(where('workspaceId', '==', workspaceId));
    }

    if (favoriteOnly) {
      constraints.push(where('favorite', '==', true));
    }

    if (typeof completed === 'boolean') {
      constraints.push(where('completed', '==', completed));
    }

    constraints.push(orderBy('updatedAt', 'desc'));

    if (queryLimit && queryLimit > 0) {
      constraints.push(fsLimit(queryLimit));
    }

    return query(baseRef, ...constraints) as Query<TodoDoc>;
  }, [userUid, enabled, workspaceId, favoriteOnly, completed, queryLimit]);

  return useCollection<TodoDoc>(todosQuery);
}
