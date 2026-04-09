import * as admin from 'firebase-admin';

export type UserPlan = 'free' | 'pro';

export const FREE_NOTE_LIMIT = 15;
export const FREE_ACTIVE_TASK_LIMIT = 15;
export const FREE_FAVORITE_NOTES_LIMIT = 10;
export const FREE_FAVORITE_TASKS_LIMIT = 15;

export const FREE_NOTE_LIMIT_MESSAGE =
  'Limite Free atteinte. Tu peux passer en Pro pour créer plus de notes et utiliser les favoris sans limite.';
export const FREE_TASK_LIMIT_MESSAGE =
  'Limite Free atteinte. Passe en Pro pour créer plus d’éléments d’agenda et utiliser les favoris sans limite.';

export type ServerTaskRecurrenceInput = {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;
  untilMs?: number | null;
  exceptions?: string[];
} | null;

export type ServerTaskCreateInput = {
  userId: string;
  title: string;
  description?: string | null;
  status: 'todo' | 'doing' | 'done';
  workspaceId: string | null;
  allDay: boolean;
  startDateMs: number | null;
  dueDateMs: number | null;
  priority: 'low' | 'medium' | 'high' | null;
  calendarKind?: 'task' | 'birthday' | null;
  recurrence?: ServerTaskRecurrenceInput;
  favorite: boolean;
  archived: boolean;
  sourceType?: 'checklist_item' | null;
  sourceTodoId?: string | null;
  sourceTodoItemId?: string | null;
  source?: Record<string, unknown>;
};

export type ChecklistScheduleInput = {
  date: string;
  time?: string;
  allDay: boolean;
  timezone: 'Europe/Paris';
};

export type OpsMetricLabels = Record<string, string>;

export type OpsJobSnapshotInput = {
  functionName: 'checkAndSendReminders' | 'assistantRunJobQueue' | 'assistantRunAIJobQueue';
  requestId: string;
  success: boolean;
  durationMs: number;
  processed: number;
  failed: number;
  backlogSize: number;
  sent?: number;
  shardCount?: number;
  stoppedByBacklogGuard?: boolean;
  stopThresholdHit?: boolean;
};

export type OpsStateDoc = {
  jobName: string;
  lastRunAtMs: number;
  lastSuccessAtMs?: number;
  lastFailureAtMs?: number;
  lastDurationMs: number;
  lastBacklogSize: number;
  lastProcessed: number;
  lastFailed: number;
  lastSent?: number;
  lastShardCount?: number;
  lastStoppedByBacklogGuard?: boolean;
  lastStopThresholdHit?: boolean;
  consecutiveFailures: number;
  backlogAboveThresholdRuns: number;
  updatedAt: admin.firestore.FieldValue;
};
