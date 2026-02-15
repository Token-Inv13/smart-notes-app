import type { FieldValue, Timestamp } from 'firebase/firestore';

export type Priority = 'low' | 'medium' | 'high';
export type TaskRecurrenceFreq = 'daily' | 'weekly' | 'monthly';

export interface TaskRecurrenceRule {
  freq: TaskRecurrenceFreq;
  interval?: number;
  until?: Timestamp | null;
  exceptions?: string[];
}

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

export interface AssistantSettingsDoc {
  enabled?: boolean;
  plan?: string;
  autoAnalyze?: boolean;
  consentVersion?: number;
  simpleMode?: 'calm' | 'balanced' | 'auto';
  jtbdPreset?: 'daily_planning' | 'dont_forget' | 'meetings' | 'projects';
  proactivityMode?: 'off' | 'suggestions' | 'proactive';
  quietHours?: {
    start?: string;
    end?: string;
    [key: string]: unknown;
  };
  notificationBudget?: {
    maxPerDay?: number;
    [key: string]: unknown;
  };
  aiPolicy?: {
    enabled?: boolean;
    minimizeData?: boolean;
    allowFullContent?: boolean;
    [key: string]: unknown;
  };
  createdAt?: Timestamp | FieldValue;
  updatedAt?: Timestamp | FieldValue;
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
  startDate?: Timestamp | null;
  dueDate?: Timestamp | null;
  priority?: Priority | null;
  recurrence?: TaskRecurrenceRule | null;
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
  dueDate?: Timestamp | null;
  priority?: Priority | null;
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

export type AssistantSuggestionStatus = 'proposed' | 'accepted' | 'rejected' | 'expired';

export type AssistantSuggestionKind =
  | 'create_task'
  | 'create_reminder'
  | 'create_task_bundle'
  | 'update_task_meta'
  | 'generate_summary'
  | 'rewrite_note'
  | 'generate_hook'
  | 'extract_key_points'
  | 'tag_entities';

export type AssistantTaskBundleMode = 'multiple_tasks';

export type AssistantTaskBundleTask = {
  title: string;
  dueDate?: Timestamp;
  remindAt?: Timestamp;
  priority?: Priority;
  labels?: string[];
  origin?: {
    fromText?: string;
  };
};

export type AssistantSuggestionPayload =
  | {
      title: string;
      details?: string;
      dueDate?: Timestamp;
      remindAt?: Timestamp;
      priority?: Priority;
      labels?: string[];
      taskId?: string;
      favorite?: boolean;
      origin: {
        fromText: string;
      };
      confidence: number;
      explanation: string;
    }
  | {
      title: string;
      tasks: AssistantTaskBundleTask[];
      bundleMode: AssistantTaskBundleMode;
      noteId?: string;
      selectedIndexes?: number[];
      origin: {
        fromText: string;
      };
      confidence: number;
      explanation: string;
    }
  | {
      title: string;
      summaryShort?: string;
      summaryStructured?: { title: string; bullets: string[] }[];
      keyPoints?: string[];
      hooks?: string[];
      rewriteContent?: string;
      entities?: {
        people?: string[];
        orgs?: string[];
        places?: string[];
        products?: string[];
        dates?: string[];
        misc?: string[];
      };
      tags?: string[];
      origin: {
        fromText: string;
      };
      confidence: number;
      explanation: string;
    };

export type AssistantAIJobStatus = 'queued' | 'processing' | 'done' | 'error';

export type AssistantVoiceJobStatus = 'created' | 'transcribing' | 'done' | 'error';

export type AssistantVoiceJobMode = 'append_to_note' | 'standalone';

export interface AssistantAIJobDoc {
  id?: string;
  noteId: string;
  objectId: string;
  status: AssistantAIJobStatus;
  attempts: number;
  model: string;
  modelRequested?: string | null;
  modelFallbackUsed?: string | null;
  modes?: string[];
  schemaVersion: number;
  pendingTextHash?: string | null;
  lockedUntil?: Timestamp;
  resultId?: string | null;
  error?: string | null;
  createdAt?: Timestamp | FieldValue;
  updatedAt?: Timestamp | FieldValue;
  [key: string]: unknown;
}

export interface AssistantAIResultDoc {
  id?: string;
  noteId: string;
  objectId: string;
  textHash: string;
  model: string;
  schemaVersion: number;
  modes?: string[];
  refusal?: string | null;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  output?: {
    summaryShort?: string;
    summaryStructured?: { title: string; bullets: string[] }[];
    keyPoints?: string[];
    hooks?: string[];
    rewriteContent?: string;
    entities?: {
      people?: string[];
      orgs?: string[];
      places?: string[];
      products?: string[];
      dates?: string[];
      misc?: string[];
    };
    tags?: string[];
  };
  createdAt?: Timestamp | FieldValue;
  updatedAt?: Timestamp | FieldValue;
  [key: string]: unknown;
}

export interface AssistantVoiceJobDoc {
  id?: string;
  noteId?: string | null;
  mode: AssistantVoiceJobMode;
  status: AssistantVoiceJobStatus;
  storagePath: string;
  lockedUntil?: Timestamp;
  fileHash?: string | null;
  usageCountedHash?: string | null;
  model?: string | null;
  schemaVersion: number;
  resultId?: string | null;
  errorMessage?: string | null;
  expiresAt: Timestamp;
  createdAt?: Timestamp | FieldValue;
  updatedAt?: Timestamp | FieldValue;
  [key: string]: unknown;
}

export interface AssistantVoiceResultDoc {
  id?: string;
  jobId: string;
  noteId?: string | null;
  mode: AssistantVoiceJobMode;
  storagePath: string;
  fileHash: string;
  model: string;
  schemaVersion: number;
  transcript: string;
  expiresAt: Timestamp;
  createdAt?: Timestamp | FieldValue;
  updatedAt?: Timestamp | FieldValue;
  [key: string]: unknown;
}

export interface AssistantSuggestionDoc {
  id?: string;
  objectId: string;
  source: {
    type: 'note' | 'todo' | 'task';
    id: string;
    fromSuggestionId?: string;
  };
  kind: AssistantSuggestionKind;
  payload: AssistantSuggestionPayload;
  rankScore?: number;
  rankPreset?: 'daily_planning' | 'dont_forget' | 'meetings' | 'projects';
  status: AssistantSuggestionStatus;
  pipelineVersion: 1;
  dedupeKey: string;
  createdAt?: Timestamp | FieldValue;
  updatedAt?: Timestamp | FieldValue;
  expiresAt: Timestamp;
  [key: string]: unknown;
}

export interface AssistantDecisionDoc {
  id?: string;
  suggestionId: string;
  objectId: string;
  action: 'accepted' | 'edited_then_accepted' | 'rejected';
  createdCoreObjects: { type: 'task' | 'taskReminder'; id: string }[];
  beforePayload?: AssistantSuggestionDoc['payload'];
  finalPayload?: AssistantSuggestionDoc['payload'];
  pipelineVersion: 1;
  createdAt?: Timestamp | FieldValue;
  updatedAt?: Timestamp | FieldValue;
  [key: string]: unknown;
}
