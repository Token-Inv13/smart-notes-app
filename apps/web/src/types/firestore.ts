export interface UserDoc {
  uid: string;
  email: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  createdAt?: string;
  updatedAt?: string;
  fcmTokens?: Record<string, boolean>;
  settings?: {
    notifications?: {
      taskReminders?: boolean;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface NoteDoc {
  id?: string;
  userId: string;
  workspaceId?: string | null;
  title: string;
  content: string;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

import type { Timestamp } from 'firebase/firestore';

export interface TaskDoc {
  id?: string;
  userId: string;
  workspaceId?: string | null;
  title: string;
  description?: string;
  status?: 'todo' | 'doing' | 'done';
  dueDate?: Timestamp | null;
  completed?: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  [key: string]: unknown;
}

export interface WorkspaceDoc {
  id?: string;
  ownerId: string;
  name: string;
  members?: string[];
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface TaskReminderDoc {
  id?: string;
  userId: string;
  taskId: string;
  dueDate: string;
  reminderTime: string;
  sent: boolean;
  [key: string]: unknown;
}
