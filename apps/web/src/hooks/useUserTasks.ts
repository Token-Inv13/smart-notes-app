'use client';

import { useMemo } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  Timestamp,
  limit as fsLimit,
  type Query,
  type CollectionReference,
  type QueryConstraint,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { useCollection } from '@/hooks/useCollection';
import type { TaskDoc } from '@/types/firestore';

interface UseUserTasksParams {
  enabled?: boolean;
  workspaceId?: string;
  status?: 'todo' | 'doing' | 'done';
  favoriteOnly?: boolean;
  limit?: number;
  dueDateFrom?: Timestamp;
  dueDateTo?: Timestamp;
}

export function useUserTasks(params?: UseUserTasksParams) {
  const { user } = useAuth();
  const userUid = user?.uid;

  const tasksQuery: Query<TaskDoc> | null = useMemo(() => {
    if (params?.enabled === false) return null;
    if (!userUid) return null;

    const baseRef = collection(db, 'tasks') as CollectionReference<TaskDoc>;
    const constraints: QueryConstraint[] = [where('userId', '==', userUid)];

    if (params?.workspaceId) {
      constraints.push(where('workspaceId', '==', params.workspaceId));
    }

    if (params?.favoriteOnly) {
      constraints.push(where('favorite', '==', true));
    }

    if (params?.dueDateFrom) {
      constraints.push(where('dueDate', '>=', params.dueDateFrom));
    }

    if (params?.dueDateTo) {
      constraints.push(where('dueDate', '<=', params.dueDateTo));
    }

    // We order by dueDate only (index exists). Fallback by updatedAt will be handled client-side.
    constraints.push(orderBy('dueDate', 'asc'));

    if (params?.limit && params.limit > 0) {
      constraints.push(fsLimit(params.limit));
    }

    return query(baseRef, ...constraints) as Query<TaskDoc>;
  }, [
    userUid,
    params?.enabled,
    params?.workspaceId,
    params?.favoriteOnly,
    params?.limit,
    params?.dueDateFrom,
    params?.dueDateTo,
  ]);

  return useCollection<TaskDoc>(tasksQuery);
}
