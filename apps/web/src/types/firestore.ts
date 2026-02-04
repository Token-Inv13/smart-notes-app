import type { FieldValue, Timestamp } from 'firebase/firestore';

export interface UserDoc {
  uid: string;
  email: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  plan?: 'free' | 'pro';
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeSubscriptionStatus?: string | null;
  stripeSubscriptionCancelAtPeriodEnd?: boolean | null;
  stripeSubscriptionCurrentPeriodEnd?: Timestamp | FieldValue | null;
  createdAt?: Timestamp | FieldValue;
  updatedAt?: Timestamp | FieldValue;
  fcmTokens?: Record<string, boolean>;
  settings?: {
    appearance?: {
      mode?: 'light' | 'dark';
      background?: 'none' | 'dots' | 'grid';
      [key: string]: unknown;
    };
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
  attachments?: NoteAttachment[];
  favorite?: boolean;
  completed?: boolean;
  archived?: boolean;
  archivedAt?: Timestamp | FieldValue | null;
  tags?: string[];
  createdAt?: Timestamp | FieldValue;
  updatedAt?: Timestamp | FieldValue;
  [key: string]: unknown;
}

export interface NoteAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  storagePath: string;
  addedAt: Timestamp;
}

export interface TaskDoc {
  id?: string;
  userId: string;
  workspaceId?: string | null;
  title: string;
  description?: string;
  status?: 'todo' | 'doing' | 'done';
  dueDate?: Timestamp | null;
  favorite?: boolean;
  completed?: boolean;
  archived?: boolean;
  archivedAt?: Timestamp | FieldValue | null;
  createdAt?: Timestamp | FieldValue;
  updatedAt?: Timestamp | FieldValue;
  [key: string]: unknown;
}

export interface TodoDoc {
  id?: string;
  userId: string;
  workspaceId?: string | null;
  title: string;
  items?: {
    id: string;
    text: string;
    done: boolean;
    createdAt?: number;
  }[];
  completed?: boolean;
  favorite?: boolean;
  createdAt?: Timestamp | FieldValue;
  updatedAt?: Timestamp | FieldValue;
  [key: string]: unknown;
}

export interface WorkspaceDoc {
  id?: string;
  ownerId: string;
  name: string;
  order?: number;
  members?: string[];
  createdAt?: Timestamp | FieldValue;
  updatedAt?: Timestamp | FieldValue;
  [key: string]: unknown;
}

export interface TaskReminderDoc {
  id?: string;
  userId: string;
  taskId: string;
  dueDate: string;
  reminderTime: string;
  sent: boolean;
  deliveryChannel?: 'web_push' | 'email';
  createdAt?: Timestamp | FieldValue;
  updatedAt?: Timestamp | FieldValue;
  processingAt?: Timestamp | FieldValue;
  processingBy?: string;
  [key: string]: unknown;
}
