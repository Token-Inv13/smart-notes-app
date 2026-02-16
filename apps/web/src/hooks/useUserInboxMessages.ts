'use client';

import { useMemo } from 'react';
import { collection, limit, orderBy, query, type CollectionReference } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { useCollection } from '@/hooks/useCollection';
import type { UserInboxMessageDoc } from '@/types/firestore';

interface UseUserInboxMessagesOptions {
  limit?: number;
}

export function useUserInboxMessages(options?: UseUserInboxMessagesOptions) {
  const { user } = useAuth();
  const pageSize = options?.limit ?? 10;

  const inboxQuery = useMemo(() => {
    if (!user?.uid) return null;
    return query(
      collection(db, 'users', user.uid, 'inbox') as CollectionReference<UserInboxMessageDoc>,
      orderBy('createdAt', 'desc'),
      limit(pageSize),
    );
  }, [pageSize, user?.uid]);

  return useCollection<UserInboxMessageDoc>(inboxQuery);
}
