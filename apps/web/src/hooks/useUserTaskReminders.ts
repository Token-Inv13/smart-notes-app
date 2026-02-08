'use client';

import { useMemo } from 'react';
import {
  collection,
  query,
  where,
  type Query,
  type CollectionReference,
  type QueryConstraint,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { useCollection } from '@/hooks/useCollection';
import type { TaskReminderDoc } from '@/types/firestore';

type UseUserTaskRemindersParams = {
  enabled?: boolean;
};

export function useUserTaskReminders(params?: UseUserTaskRemindersParams) {
  const { user } = useAuth();
  const userUid = user?.uid;
  const enabled = params?.enabled !== false;

  const remindersQuery: Query<TaskReminderDoc> | null = useMemo(() => {
    if (!userUid) return null;
    if (!enabled) return null;

    const baseRef = collection(db, 'taskReminders') as CollectionReference<TaskReminderDoc>;
    const constraints: QueryConstraint[] = [where('userId', '==', userUid)];

    return query(baseRef, ...constraints) as Query<TaskReminderDoc>;
  }, [enabled, userUid]);

  const { data, loading, error, refetch } = useCollection<TaskReminderDoc>(remindersQuery);

  return { reminders: data, loading, error, refetch };
}
