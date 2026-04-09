import * as admin from 'firebase-admin';

export type AssistantObjectStatus = 'idle' | 'queued' | 'processing' | 'done' | 'error';
export type AssistantJobStatus = 'queued' | 'processing' | 'done' | 'error';
export type AssistantAIJobStatus = 'queued' | 'processing' | 'done' | 'error';

export type AssistantCoreRef = {
  collection: 'notes' | 'todos';
  id: string;
};

export type AssistantObjectDoc = {
  objectId: string;
  type: 'note' | 'todo';
  coreRef: AssistantCoreRef;
  textHash: string;
  pendingTextHash?: string | null;
  pipelineVersion: 1;
  status: AssistantObjectStatus;
  lastAnalyzedAt?: admin.firestore.Timestamp | admin.firestore.FieldValue | null;
  createdAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  updatedAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
};

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
  dueDate?: admin.firestore.Timestamp;
  remindAt?: admin.firestore.Timestamp;
  priority?: 'low' | 'medium' | 'high';
  labels?: string[];
  origin?: {
    fromText?: string;
  };
};

export type DetectedBundle = {
  title: string;
  tasks: AssistantTaskBundleTask[];
  bundleMode: AssistantTaskBundleMode;
  originFromText: string;
  explanation: string;
  confidence: number;
  dedupeMinimal: {
    title: string;
    tasksSig: string;
  };
};

export type AssistantSuggestionSource =
  | { type: 'note'; id: string }
  | { type: 'todo'; id: string }
  | { type: 'task'; id: string; fromSuggestionId?: string };

export type AssistantSuggestionPayload = Record<string, any>;

export type AssistantAIJobDoc = {
  noteId: string;
  objectId: string;
  status: AssistantAIJobStatus;
  attempts: number;
  model: string;
  modelRequested?: string | null;
  modelFallbackUsed?: string | null;
  modes?: string[];
  rewriteInstruction?: string | null;
  schemaVersion: number;
  pendingTextHash?: string | null;
  lockedUntil?: admin.firestore.Timestamp;
  resultId?: string | null;
  error?: string | null;
  createdAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  updatedAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
};

export type AssistantAIResultDoc = {
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
  output?: any;
  createdAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  updatedAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
};

export type AssistantSuggestionDoc = {
  objectId: string;
  source: AssistantSuggestionSource;
  kind: AssistantSuggestionKind;
  payload: AssistantSuggestionPayload;
  rankScore?: number;
  rankPreset?: 'daily_planning' | 'dont_forget' | 'meetings' | 'projects';
  status: AssistantSuggestionStatus;
  pipelineVersion: 1;
  dedupeKey: string;
  createdAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  updatedAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  expiresAt: admin.firestore.Timestamp;
};

export type AssistantDecisionDoc = {
  suggestionId: string;
  objectId: string;
  action: 'accepted' | 'edited_then_accepted' | 'rejected';
  createdCoreObjects: Array<{ type: 'task' | 'taskReminder'; id: string }>;
  beforePayload?: AssistantSuggestionPayload;
  finalPayload?: AssistantSuggestionPayload;
  pipelineVersion: 1;
  createdAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  updatedAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
};
