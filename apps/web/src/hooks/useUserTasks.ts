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
import type { TaskDoc, TaskRecurrenceFreq } from '@/types/firestore';

interface UseUserTasksParams {
  enabled?: boolean;
  workspaceId?: string;
  status?: 'todo' | 'doing' | 'done';
  favoriteOnly?: boolean;
  limit?: number;
  startDateFrom?: Timestamp;
  startDateTo?: Timestamp;
  dueDateFrom?: Timestamp;
  dueDateTo?: Timestamp;
  recurrenceFreqs?: TaskRecurrenceFreq[];
}

export function useUserTasks(params?: UseUserTasksParams) {
  const { user } = useAuth();
  const userUid = user?.uid;
  const enabled = params?.enabled;
  const workspaceId = params?.workspaceId;
  const status = params?.status;
  const favoriteOnly = params?.favoriteOnly;
  const queryLimit = params?.limit;
  const startDateFrom = params?.startDateFrom;
  const startDateTo = params?.startDateTo;
  const dueDateFrom = params?.dueDateFrom;
  const dueDateTo = params?.dueDateTo;
  const recurrenceFreqs = params?.recurrenceFreqs;

  const tasksQuery: Query<TaskDoc> | null = useMemo(() => {
    if (enabled === false) return null;
    if (!userUid) return null;

    const baseRef = collection(db, 'tasks') as CollectionReference<TaskDoc>;
    const constraints: QueryConstraint[] = [where('userId', '==', userUid)];

    if (workspaceId) {
      constraints.push(where('workspaceId', '==', workspaceId));
    }

    if (favoriteOnly) {
      constraints.push(where('favorite', '==', true));
    }

    if (status) {
      constraints.push(where('status', '==', status));
    }

    if (startDateFrom) {
      constraints.push(where('startDate', '>=', startDateFrom));
    }

    if (startDateTo) {
      constraints.push(where('startDate', '<=', startDateTo));
    }

    if (dueDateFrom) {
      constraints.push(where('dueDate', '>=', dueDateFrom));
    }

    if (dueDateTo) {
      constraints.push(where('dueDate', '<=', dueDateTo));
    }

    if (recurrenceFreqs?.length) {
      constraints.push(where('recurrence.freq', 'in', recurrenceFreqs));
    }

    const shouldOrderByStart = startDateFrom || startDateTo;
    const shouldOrderByDue = dueDateFrom || dueDateTo || !recurrenceFreqs?.length;
    if (shouldOrderByStart) {
      constraints.push(orderBy('startDate', 'asc'));
    } else if (shouldOrderByDue) {
      constraints.push(orderBy('dueDate', 'asc'));
    }

    if (queryLimit && queryLimit > 0) {
      constraints.push(fsLimit(queryLimit));
    }

    return query(baseRef, ...constraints) as Query<TaskDoc>;
  }, [
    userUid,
    enabled,
    workspaceId,
    favoriteOnly,
    status,
    queryLimit,
    startDateFrom,
    startDateTo,
    dueDateFrom,
    dueDateTo,
    recurrenceFreqs,
  ]);

  return useCollection<TaskDoc>(tasksQuery);
}
