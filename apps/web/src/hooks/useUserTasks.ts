'use client';

import { useMemo } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  limit as fsLimit,
  type Query,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { useCollection } from '@/hooks/useCollection';
import type { TaskDoc } from '@/types/firestore';

interface UseUserTasksParams {
  workspaceId?: string;
  status?: 'todo' | 'doing' | 'done';
  limit?: number;
}

export function useUserTasks(params?: UseUserTasksParams) {
  const { user } = useAuth();

  const tasksQuery: Query<TaskDoc> | null = useMemo(() => {
    if (!user) return null;

    const baseRef = collection(db, 'tasks') as unknown as ReturnType<typeof collection<TaskDoc>>;
    const constraints = [where('userId', '==', user.uid)];

    if (params?.workspaceId) {
      constraints.push(where('workspaceId', '==', params.workspaceId));
    }

    // We order by dueDate only (index exists). Fallback by updatedAt will be handled client-side.
    constraints.push(orderBy('dueDate', 'asc'));

    if (params?.limit && params.limit > 0) {
      constraints.push(fsLimit(params.limit));
    }

    return query(baseRef, ...constraints) as Query<TaskDoc>;
  }, [user, params?.workspaceId, params?.limit]);

  if (!user) {
    return { data: [] as TaskDoc[], loading: false, error: null as Error | null, refetch: () => {} };
  }

  return useCollection<TaskDoc>(tasksQuery);
}
