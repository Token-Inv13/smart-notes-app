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

export function useUserTaskReminders() {
  const { user } = useAuth();

  const remindersQuery: Query<TaskReminderDoc> | null = useMemo(() => {
    if (!user) return null;

    const baseRef = collection(db, 'taskReminders') as CollectionReference<TaskReminderDoc>;
    const constraints: QueryConstraint[] = [where('userId', '==', user.uid)];

    return query(baseRef, ...constraints) as Query<TaskReminderDoc>;
  }, [user?.uid]);

  if (!user) {
    return {
      reminders: [] as TaskReminderDoc[],
      loading: false,
      error: null as Error | null,
      refetch: () => {},
    };
  }

  const { data, loading, error, refetch } = useCollection<TaskReminderDoc>(remindersQuery);

  return { reminders: data, loading, error, refetch };
}
