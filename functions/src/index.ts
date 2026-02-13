import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as nodemailer from 'nodemailer';
import { createHash } from 'crypto';

admin.initializeApp();

interface TaskReminder {
  userId: string;
  taskId: string;
  dueDate: string;
  reminderTime: string;
  sent: boolean;
  deliveryChannel?: 'web_push' | 'email';
}

interface MessagingError {
  code: string;
  [key: string]: any;
}

type AssistantObjectStatus = 'idle' | 'queued' | 'processing' | 'done' | 'error';
type AssistantJobStatus = 'queued' | 'processing' | 'done' | 'error';

type AssistantAIJobStatus = 'queued' | 'processing' | 'done' | 'error';

type AssistantCoreRef = {
  collection: 'notes' | 'todos';
  id: string;
};

type AssistantObjectDoc = {
  objectId: string;
  type: 'note' | 'todo';
  coreRef: AssistantCoreRef;
  textHash: string;
  pendingTextHash?: string | null;
  pipelineVersion: 1;
  status: AssistantObjectStatus;
  lastAnalyzedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | null;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
};

type AssistantSuggestionFeedbackDoc = {
  suggestionId: string;
  objectId: string;
  kind: AssistantSuggestionKind;
  useful: boolean;
  sourceType: 'note' | 'todo' | 'task';
  rankScore?: number;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
};

type AssistantVoiceJobStatus = 'created' | 'transcribing' | 'done' | 'error';

type AssistantVoiceJobMode = 'append_to_note' | 'standalone';

type AssistantVoiceJobDoc = {
  noteId?: string | null;
  mode: AssistantVoiceJobMode;
  status: AssistantVoiceJobStatus;
  storagePath: string;
  lockedUntil?: FirebaseFirestore.Timestamp;
  fileHash?: string | null;
  usageCountedHash?: string | null;
  model?: string | null;
  schemaVersion: number;
  resultId?: string | null;
  errorMessage?: string | null;
  expiresAt: FirebaseFirestore.Timestamp;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
};

type AssistantVoiceResultDoc = {
  jobId: string;
  noteId?: string | null;
  mode: AssistantVoiceJobMode;
  storagePath: string;
  fileHash: string;
  model: string;
  schemaVersion: number;
  transcript: string;
  expiresAt: FirebaseFirestore.Timestamp;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
};

type AssistantJobDoc = {
  objectId: string;
  jobType: 'analyze_intents_v1' | 'analyze_intents_v2';
  pipelineVersion: 1;
  status: AssistantJobStatus;
  attempts: number;
  pendingTextHash?: string | null;
  lockedUntil?: FirebaseFirestore.Timestamp;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
};

type AssistantSuggestionStatus = 'proposed' | 'accepted' | 'rejected' | 'expired';

type AssistantSuggestionKind =
  | 'create_task'
  | 'create_reminder'
  | 'create_task_bundle'
  | 'update_task_meta'
  | 'generate_summary'
  | 'rewrite_note'
  | 'generate_hook'
  | 'extract_key_points'
  | 'tag_entities';

type AssistantTaskBundleMode = 'multiple_tasks';

type AssistantTaskBundleTask = {
  title: string;
  dueDate?: FirebaseFirestore.Timestamp;
  remindAt?: FirebaseFirestore.Timestamp;
  priority?: 'low' | 'medium' | 'high';
  labels?: string[];
  origin?: {
    fromText?: string;
  };
};

type DetectedBundle = {
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

type AssistantSuggestionSource =
  | {
      type: 'note';
      id: string;
    }
  | {
      type: 'todo';
      id: string;
    }
  | {
      type: 'task';
      id: string;
      fromSuggestionId?: string;
    };

type AssistantSuggestionPayload =
  | {
      title: string;
      details?: string;
      dueDate?: FirebaseFirestore.Timestamp;
      remindAt?: FirebaseFirestore.Timestamp;
      priority?: 'low' | 'medium' | 'high';
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
      summaryStructured?: Array<{ title: string; bullets: string[] }>;
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

type AssistantAIJobDoc = {
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
  lockedUntil?: FirebaseFirestore.Timestamp;
  resultId?: string | null;
  error?: string | null;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
};

type AssistantAIResultDoc = {
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
    summaryStructured?: Array<{ title: string; bullets: string[] }>;
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
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
};

type AssistantSuggestionDoc = {
  objectId: string;
  source: AssistantSuggestionSource;
  kind: AssistantSuggestionKind;
  payload: AssistantSuggestionPayload;
  rankScore?: number;
  rankPreset?: 'daily_planning' | 'dont_forget' | 'meetings' | 'projects';
  status: AssistantSuggestionStatus;
  pipelineVersion: 1;
  dedupeKey: string;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  expiresAt: FirebaseFirestore.Timestamp;
};

type AssistantDecisionAction = 'accepted' | 'edited_then_accepted' | 'rejected';

type AssistantDecisionCoreObject = {
  type: 'task' | 'taskReminder';
  id: string;
};

type AssistantDecisionDoc = {
  suggestionId: string;
  objectId: string;
  action: AssistantDecisionAction;
  createdCoreObjects: AssistantDecisionCoreObject[];
  beforePayload?: AssistantSuggestionDoc['payload'];
  finalPayload?: AssistantSuggestionDoc['payload'];
  pipelineVersion: 1;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
};

const ASSISTANT_REANALYSIS_FREE_DAILY_LIMIT = 10;
const ASSISTANT_REANALYSIS_PRO_DAILY_LIMIT = 200;
const ASSISTANT_AI_ANALYSIS_FREE_DAILY_LIMIT = 2;
const ASSISTANT_AI_ANALYSIS_PRO_DAILY_LIMIT = 100;
const ASSISTANT_VOICE_TRANSCRIPT_FREE_DAILY_LIMIT = 10;
const ASSISTANT_VOICE_TRANSCRIPT_PRO_DAILY_LIMIT = 200;
const ASSISTANT_VOICE_MAX_BYTES = 25 * 1024 * 1024;
const ASSISTANT_VOICE_SCHEMA_VERSION = 1;
const ASSISTANT_FOLLOWUP_REJECT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function assistantCurrentJobIdForObject(objectId: string): string {
  return `current_${objectId}`;
}

function assistantMetricsRef(db: FirebaseFirestore.Firestore, userId: string) {
  return db.collection('users').doc(userId).collection('assistantMetrics').doc('main');
}

function assistantMemoryLiteRef(db: FirebaseFirestore.Firestore, userId: string) {
  return db.collection('users').doc(userId).collection('assistantMemoryLite').doc('main');
}

function assistantUsageRef(db: FirebaseFirestore.Firestore, userId: string, dayKey: string) {
  return db.collection('users').doc(userId).collection('assistantUsage').doc(dayKey);
}

function assistantAIJobIdForNote(noteId: string) {
  return `current_note_${noteId}`;
}

function assistantVoiceJobIdForNote(noteId: string) {
  return `current_voice_note_${noteId}`;
}

type AssistantMetricsDoc = {
  suggestionsCreated?: number;
  bundlesCreated?: number;
  suggestionsAccepted?: number;
  suggestionsRejected?: number;
  suggestionsEditedAccepted?: number;
  bundlesAccepted?: number;
  bundlesEditedAccepted?: number;
  tasksCreatedViaBundle?: number;
  bundleItemsCreated?: number;
  bundleItemsDeselected?: number;
  followupSuggestionsCreated?: number;
  followupSuggestionsAccepted?: number;
  memoryUpdatesCount?: number;
  defaultPriorityAppliedCount?: number;
  defaultReminderHourAppliedCount?: number;
  reanalysisRequested?: number;
  decisionsCount?: number;
  totalTimeToDecisionMs?: number;
  jobsProcessed?: number;
  jobErrors?: number;
  aiAnalysesRequested?: number;
  aiAnalysesCompleted?: number;
  aiAnalysesErrored?: number;
  aiTokensIn?: number;
  aiTokensOut?: number;
  aiResultsCreated?: number;
  updatedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
};

type AssistantMemoryLiteDoc = {
  defaultPriority?: 'low' | 'medium' | 'high';
  defaultReminderHour?: number;
  lastUsedLabels?: string[];
  stats?: {
    priorityCounts?: { low: number; medium: number; high: number };
    reminderHourCounts?: Record<string, number>;
  };
  updatedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
};

function metricsIncrements(inc: Partial<Record<keyof AssistantMetricsDoc, number>>) {
  const out: Record<string, any> = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  for (const [k, v] of Object.entries(inc)) {
    if (typeof v === 'number' && Number.isFinite(v) && v !== 0) {
      out[k] = admin.firestore.FieldValue.increment(v);
    }
  }
  return out;
}

function normalizeAssistantText(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  try {
    return s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return s.toLowerCase().replace(/\s+/g, ' ').trim();
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function sha256HexBuffer(input: Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

async function callOpenAIWhisperTranscription(params: {
  buffer: Buffer;
  filename: string;
  contentType: string;
  language?: string | null;
}): Promise<{ text: string }> {
  const apiKey = getOpenAIApiKey();
  const projectHeader = getOpenAIProjectHeader();

  const form = new FormData();
  const blob = new Blob([params.buffer], { type: params.contentType });
  form.append('file', blob, params.filename);
  form.append('model', 'whisper-1');
  if (params.language) form.append('language', params.language);

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(projectHeader ? { 'OpenAI-Project': projectHeader } : {}),
    },
    body: form as any,
  });

  if (!res.ok) {
    const requestId = res.headers.get('x-request-id');
    let parsedErr: any = null;
    let textBody = '';
    try {
      parsedErr = await res.json();
    } catch {
      textBody = await res.text().catch(() => '');
    }
    const errObj = parsedErr && typeof parsedErr === 'object' ? parsedErr : null;
    const errInner = errObj && typeof errObj?.error === 'object' ? errObj.error : null;
    const message = errInner && typeof errInner?.message === 'string' ? String(errInner.message) : textBody || JSON.stringify(errObj || {});
    const code = errInner && typeof errInner?.code === 'string' ? String(errInner.code) : null;
    const type = errInner && typeof errInner?.type === 'string' ? String(errInner.type) : null;
    const param = errInner && typeof errInner?.param === 'string' ? String(errInner.param) : null;
    throw new OpenAIHttpError({
      status: res.status,
      message: `OpenAI error: ${res.status} ${message}`.slice(0, 800),
      code,
      type,
      param,
      requestId,
      projectHeader,
    });
  }

  const json = (await res.json()) as any;
  const text = typeof json?.text === 'string' ? String(json.text) : '';
  return { text };
}

function clampFromText(raw: string, maxLen: number): string {
  const s = (raw ?? '').trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1).trim()}…`;
}

function normalizeForIntentMatch(raw: string): string {
  return normalizeAssistantText(raw);
}

function parsePriorityInText(text: string): 'low' | 'medium' | 'high' | null {
  const t = normalizeForIntentMatch(text);

  if (t.includes('pas urgent') || t.includes('non urgent') || t.includes('facultatif')) return 'low';
  if (t.includes('urgent') || t.includes('prioritaire')) return 'high';
  if (t.includes('important')) return 'medium';

  return null;
}

function hasReminderKeyword(text: string): boolean {
  const t = normalizeForIntentMatch(text);
  return t.includes('rappel') || t.includes('rappeler') || t.includes('me rappeler');
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function startOfDay(d: Date): Date {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x;
}

function nextOccurrenceOfWeekday(now: Date, weekday: number): Date {
  const today = now.getDay();
  let delta = (weekday - today + 7) % 7;
  if (delta === 0) delta = 7;
  return addDays(startOfDay(now), delta);
}

function parseTimeInText(text: string): { hours: number; minutes: number; index: number } | null {
  const m1 = text.match(/\b(\d{1,2})\s*h(?:\s*([0-5]\d))?\b/i);
  if (m1 && m1.index != null) {
    const hours = Number(m1[1]);
    const minutes = m1[2] ? Number(m1[2]) : 0;
    if (Number.isFinite(hours) && Number.isFinite(minutes) && hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return { hours, minutes, index: m1.index };
    }
  }

  const m2 = text.match(/\b(\d{1,2}):([0-5]\d)\b/);
  if (m2 && m2.index != null) {
    const hours = Number(m2[1]);
    const minutes = Number(m2[2]);
    if (Number.isFinite(hours) && Number.isFinite(minutes) && hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return { hours, minutes, index: m2.index };
    }
  }

  return null;
}

function parseDateInText(text: string, now: Date): { date: Date; index: number } | null {
  const t = normalizeForIntentMatch(text);

  const idxToday = t.indexOf("aujourd'hui");
  if (idxToday >= 0) {
    return { date: startOfDay(now), index: idxToday };
  }
  const idxTomorrow = t.indexOf('demain');
  if (idxTomorrow >= 0) {
    return { date: startOfDay(addDays(now, 1)), index: idxTomorrow };
  }

  const weekdayMap: Record<string, number> = {
    dimanche: 0,
    lundi: 1,
    mardi: 2,
    mercredi: 3,
    jeudi: 4,
    vendredi: 5,
    samedi: 6,
  };
  for (const [k, v] of Object.entries(weekdayMap)) {
    const idx = t.indexOf(k);
    if (idx >= 0) {
      return { date: nextOccurrenceOfWeekday(now, v), index: idx };
    }
  }

  const m = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m && m.index != null) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    let yyyy: number;
    if (m[3]) {
      const raw = Number(m[3]);
      yyyy = raw < 100 ? 2000 + raw : raw;
    } else {
      yyyy = now.getFullYear();
    }

    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12 && yyyy >= 1970 && yyyy <= 2100) {
      const d = new Date(yyyy, mm - 1, dd, 0, 0, 0, 0);
      if (Number.isFinite(d.getTime())) {
        if (!m[3] && d.getTime() < startOfDay(now).getTime()) {
          d.setFullYear(yyyy + 1);
        }
        return { date: startOfDay(d), index: m.index };
      }
    }
  }

  return null;
}

function composeDateTime(params: {
  now: Date;
  baseDate: Date | null;
  time: { hours: number; minutes: number } | null;
}): Date | null {
  const { now, baseDate, time } = params;

  if (!baseDate && !time) return null;

  const day = baseDate ? startOfDay(baseDate) : startOfDay(now);
  const hours = time ? time.hours : 9;
  const minutes = time ? time.minutes : 0;

  const dt = new Date(day.getTime());
  dt.setHours(hours, minutes, 0, 0);

  if (!baseDate && time) {
    if (dt.getTime() <= now.getTime()) {
      return addDays(dt, 1);
    }
  }

  return dt;
}

type DetectedIntent = {
  intent: 'PAYER' | 'APPELER' | 'PRENDRE_RDV';
  title: string;
  originFromText: string;
  explanation: string;
  kind: AssistantSuggestionKind;
  dueDate?: FirebaseFirestore.Timestamp;
  remindAt?: FirebaseFirestore.Timestamp;
  priority?: 'low' | 'medium' | 'high';
  appliedDefaultPriority?: boolean;
  appliedDefaultReminderHour?: boolean;
  confidence: number;
  dedupeMinimal: {
    title: string;
    dueDateMs?: number;
    remindAtMs?: number;
  };
};

function buildSuggestionDedupeKey(params: {
  objectId: string;
  kind: AssistantSuggestionKind;
  minimal: DetectedIntent['dedupeMinimal'];
}): string {
  const { objectId, kind, minimal } = params;
  const payloadMinimal = JSON.stringify({
    title: normalizeAssistantText(minimal.title),
    dueDateMs: minimal.dueDateMs ?? null,
    remindAtMs: minimal.remindAtMs ?? null,
  });
  return sha256Hex(`${objectId}|${kind}|${payloadMinimal}`);
}

function buildBundleDedupeKey(params: {
  objectId: string;
  minimal: DetectedBundle['dedupeMinimal'];
}): string {
  const { objectId, minimal } = params;
  const payloadMinimal = JSON.stringify({
    title: normalizeAssistantText(minimal.title),
    tasksSig: minimal.tasksSig,
  });
  return sha256Hex(`${objectId}|create_task_bundle|${payloadMinimal}`);
}

function buildFollowupDedupeKey(params: {
  taskId: string;
  kind: 'create_reminder' | 'update_task_meta';
  minimal: Record<string, unknown>;
}): string {
  const payloadMinimal = JSON.stringify(params.minimal);
  return sha256Hex(`task_${params.taskId}|${params.kind}|${payloadMinimal}`);
}

function buildContentDedupeKey(params: { objectId: string; kind: Exclude<AssistantSuggestionKind, 'create_task' | 'create_reminder' | 'create_task_bundle' | 'update_task_meta'>; minimal: Record<string, unknown> }): string {
  const payloadMinimal = JSON.stringify(params.minimal);
  return sha256Hex(`${params.objectId}|${params.kind}|${payloadMinimal}`);
}

function parseIsoToTimestamp(iso: unknown): FirebaseFirestore.Timestamp | undefined {
  if (typeof iso !== 'string') return undefined;
  const s = iso.trim();
  if (!s) return undefined;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return undefined;
  return admin.firestore.Timestamp.fromDate(d);
}

function getOpenAIApiKey(): string {
  const envKey = typeof process.env.OPENAI_API_KEY === 'string' ? process.env.OPENAI_API_KEY.trim() : '';
  if (envKey) return envKey;

  throw new functions.https.HttpsError('failed-precondition', 'Missing OpenAI API key configuration.');
}

function getOpenAIProjectHeader(): string | null {
  const raw = typeof process.env.OPENAI_PROJECT === 'string' ? process.env.OPENAI_PROJECT.trim() : '';
  return raw ? raw : null;
}

function getAssistantAIPreferredModelEnv(): string | null {
  const raw = typeof process.env.OPENAI_MODEL === 'string' ? process.env.OPENAI_MODEL.trim() : '';
  if (raw) return raw;
  const legacy = typeof process.env.ASSISTANT_AI_MODEL === 'string' ? process.env.ASSISTANT_AI_MODEL.trim() : '';
  return legacy ? legacy : null;
}

const ASSISTANT_AI_MODEL_SHORTLIST: string[] = ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4.1'];

let openAIModelsCache:
  | {
      ids: string[];
      expiresAtMs: number;
      fetchedAtMs: number;
    }
  | null = null;
let openAIModelsLoggedForInstance = false;

class OpenAIHttpError extends Error {
  status: number;
  code: string | null;
  type: string | null;
  param: string | null;
  requestId: string | null;
  projectHeader: string | null;
  constructor(params: { status: number; message: string; code?: string | null; type?: string | null; param?: string | null; requestId?: string | null; projectHeader?: string | null }) {
    super(params.message);
    this.status = params.status;
    this.code = params.code ?? null;
    this.type = params.type ?? null;
    this.param = params.param ?? null;
    this.requestId = params.requestId ?? null;
    this.projectHeader = params.projectHeader ?? null;
  }
}

async function listAvailableModelsCached(params?: { forceRefresh?: boolean }): Promise<string[]> {
  const forceRefresh = params?.forceRefresh === true;
  const now = Date.now();
  const ttlMs = 10 * 60 * 1000;
  if (!forceRefresh && openAIModelsCache && openAIModelsCache.expiresAtMs > now && Array.isArray(openAIModelsCache.ids) && openAIModelsCache.ids.length > 0) {
    return openAIModelsCache.ids;
  }

  const apiKey = getOpenAIApiKey();
  const projectHeader = getOpenAIProjectHeader();

  const fetchWith = async (useProject: boolean) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
    };
    if (useProject && projectHeader) headers['OpenAI-Project'] = projectHeader;
    const res = await fetch('https://api.openai.com/v1/models', { method: 'GET', headers });
    return res;
  };

  let res = await fetchWith(true);
  let requestId = res.headers.get('x-request-id');
  if (!res.ok && projectHeader) {
    const t = await res.text().catch(() => '');
    console.error('openai.models_list_failed', {
      status: res.status,
      requestId,
      projectHeader,
      attempt: 'with_project',
      body: t.slice(0, 800),
    });
    res = await fetchWith(false);
    requestId = res.headers.get('x-request-id');
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    console.error('openai.models_list_failed', {
      status: res.status,
      requestId,
      projectHeader,
      attempt: projectHeader ? 'without_project' : 'no_project',
      body: t.slice(0, 800),
    });
    throw new OpenAIHttpError({ status: res.status, message: `OpenAI models list failed: ${res.status} ${t}`.slice(0, 500), requestId, projectHeader });
  }

  const json = (await res.json()) as any;
  const dataArr = Array.isArray(json?.data) ? (json.data as any[]) : [];
  const isOReasoning = (id: string) => {
    if (!id.startsWith('o')) return false;
    const ch = id.slice(1, 2);
    return ch >= '0' && ch <= '9';
  };
  const ids = dataArr
    .map((m) => (m && typeof m.id === 'string' ? String(m.id) : ''))
    .filter((id) => !!id)
    .filter((id) => id.startsWith('gpt-') || isOReasoning(id) || id.startsWith('chatgpt-'))
    .sort();

  openAIModelsCache = { ids, fetchedAtMs: now, expiresAtMs: now + ttlMs };

  if (!openAIModelsLoggedForInstance) {
    openAIModelsLoggedForInstance = true;
    const preferred = getAssistantAIPreferredModelEnv();
    const shortlistAvailable = ASSISTANT_AI_MODEL_SHORTLIST.map((m) => resolveModelFromAvailable(ids, m)).filter((m): m is string => typeof m === 'string');
    const preview = ids.slice(0, 40);
    console.log('openai.models_list_ok', {
      count: ids.length,
      requestId,
      projectHeader,
      preferred,
      shortlistAvailable,
      preview,
    });
  }

  return ids;
}

function normalizeAssistantAIModel(rawModel: unknown): string {
  const s = typeof rawModel === 'string' ? rawModel.trim() : '';
  if (!s) return '';
  return s.slice(0, 64);
}

function resolveModelFromAvailable(availableIds: string[], candidate: string): string | null {
  const c = candidate.trim();
  if (!c) return null;
  if (availableIds.includes(c)) return c;
  const prefix = `${c}-`;
  const isVariantCandidate = /-(mini|nano|preview|instruct|turbo)\b/.test(c);
  const isVersionedOfBase = (id: string) => {
    if (!id.startsWith(prefix)) return false;
    const next = id.slice(prefix.length, prefix.length + 1);
    return next >= '0' && next <= '9';
  };

  for (let i = availableIds.length - 1; i >= 0; i--) {
    const id = availableIds[i];
    if (id === c) return id;
    if (isVariantCandidate && id.startsWith(prefix)) return id;
    if (!isVariantCandidate && isVersionedOfBase(id)) return id;
  }
  return null;
}

function pickDefaultAvailableModel(availableIds: string[]): string {
  const structuredPreferred = availableIds.filter((m) => isStructuredOutputsCandidateModel(m));
  for (const base of ASSISTANT_AI_MODEL_SHORTLIST) {
    const resolved = resolveModelFromAvailable(structuredPreferred.length > 0 ? structuredPreferred : availableIds, base);
    if (resolved) return resolved;
  }
  if (structuredPreferred.length > 0) return structuredPreferred[0];
  if (availableIds.length > 0) return availableIds[0];
  return '';
}

function isStructuredOutputsCandidateModel(modelId: string): boolean {
  const m = modelId.trim();
  if (!m) return false;
  if (m.startsWith('gpt-3.5')) return false;
  if (m.startsWith('gpt-4')) return true;
  if (m.startsWith('gpt-5')) return true;
  if (m.startsWith('o')) {
    const ch = m.slice(1, 2);
    return ch >= '0' && ch <= '9';
  }
  if (m.startsWith('chatgpt-')) return true;
  return false;
}

function isOpenAIUnsupportedJsonSchemaError(err: unknown): boolean {
  if (err instanceof OpenAIHttpError) {
    const msg = (err.message || '').toLowerCase();
    return err.status === 400 && msg.includes('text.format') && msg.includes('json_schema') && msg.includes('not supported');
  }
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes("text.format") && msg.includes('json_schema') && msg.includes('not supported');
}

function validateAssistantAIOutputV1(parsed: any): { ok: true } | { ok: false; error: string } {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'Output must be an object.' };

  const hasStringOrNull = (v: any) => v === null || typeof v === 'string';
  const isStringArray = (v: any) => Array.isArray(v) && v.every((x) => typeof x === 'string');

  if (!hasStringOrNull((parsed as any).summaryShort)) return { ok: false, error: 'summaryShort must be string|null.' };
  if (!Array.isArray((parsed as any).summaryStructured)) return { ok: false, error: 'summaryStructured must be array.' };
  for (const it of (parsed as any).summaryStructured) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) return { ok: false, error: 'summaryStructured item must be object.' };
    if (typeof (it as any).title !== 'string') return { ok: false, error: 'summaryStructured.title must be string.' };
    if (!isStringArray((it as any).bullets)) return { ok: false, error: 'summaryStructured.bullets must be string[].' };
  }

  if (!isStringArray((parsed as any).keyPoints)) return { ok: false, error: 'keyPoints must be string[].' };
  if (!isStringArray((parsed as any).hooks)) return { ok: false, error: 'hooks must be string[].' };
  if (!hasStringOrNull((parsed as any).rewriteContent)) return { ok: false, error: 'rewriteContent must be string|null.' };
  if (!isStringArray((parsed as any).tags)) return { ok: false, error: 'tags must be string[].' };

  const entities = (parsed as any).entities;
  if (!entities || typeof entities !== 'object' || Array.isArray(entities)) return { ok: false, error: 'entities must be object.' };
  for (const k of ['people', 'orgs', 'places', 'products', 'dates', 'misc']) {
    if (!isStringArray((entities as any)[k])) return { ok: false, error: `entities.${k} must be string[].` };
  }

  if (!Array.isArray((parsed as any).actions)) return { ok: false, error: 'actions must be array.' };
  return { ok: true };
}

function sanitizeAssistantAIOutputV1(raw: any): any {
  const out: any = {};
  const toStringOrNull = (v: any): string | null => {
    if (v === null) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (v && typeof v === 'object') {
      const maybeText = (v as any).text;
      if (typeof maybeText === 'string') return maybeText;
    }
    return null;
  };
  const toStringArray = (v: any): string[] => {
    if (!Array.isArray(v)) return [];
    return v.map((x) => (typeof x === 'string' ? x : x == null ? '' : String(x))).map((s) => s.trim()).filter((s) => !!s);
  };

  out.summaryShort = toStringOrNull(raw?.summaryShort);

  const ss = Array.isArray(raw?.summaryStructured) ? raw.summaryStructured : [];
  out.summaryStructured = ss
    .filter((it: any) => it && typeof it === 'object' && !Array.isArray(it))
    .map((it: any) => ({
      title: typeof it.title === 'string' ? it.title : String(it.title ?? '').trim() || 'Section',
      bullets: toStringArray(it.bullets),
    }));

  out.keyPoints = toStringArray(raw?.keyPoints);
  out.hooks = toStringArray(raw?.hooks);
  out.rewriteContent = toStringOrNull(raw?.rewriteContent);
  out.tags = toStringArray(raw?.tags);

  const e = raw?.entities;
  const entities: any = e && typeof e === 'object' && !Array.isArray(e) ? e : {};
  out.entities = {
    people: toStringArray(entities.people),
    orgs: toStringArray(entities.orgs),
    places: toStringArray(entities.places),
    products: toStringArray(entities.products),
    dates: toStringArray(entities.dates),
    misc: toStringArray(entities.misc),
  };

  out.actions = Array.isArray(raw?.actions) ? raw.actions.filter((a: any) => a && typeof a === 'object' && !Array.isArray(a)) : [];
  return out;
}

function selectDeterministicModel(params: { availableIds: string[]; preferredEnv: string | null; preferredRequested: string | null }): string {
  const { availableIds, preferredEnv, preferredRequested } = params;
  const req = preferredRequested ? preferredRequested.trim() : '';
  const env = preferredEnv ? preferredEnv.trim() : '';

  if (!Array.isArray(availableIds) || availableIds.length === 0) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Le projet OpenAI associé à cette clé n’a accès à aucun modèle compatible. Vérifie le Project sélectionné et les permissions.',
    );
  }

  const candidates: string[] = [];
  if (req) candidates.push(req);
  if (env && env !== req) candidates.push(env);
  for (const m of ASSISTANT_AI_MODEL_SHORTLIST) {
    if (!candidates.includes(m)) candidates.push(m);
  }

  for (const c of candidates) {
    const resolved = resolveModelFromAvailable(availableIds, c);
    if (resolved) return resolved;
  }

  return pickDefaultAvailableModel(availableIds);
}

function isOpenAIModelAccessError(err: unknown): boolean {
  if (err instanceof OpenAIHttpError) {
    const msg = err.message || '';
    const code = err.code || '';
    return err.status === 403 && (code === 'model_not_found' || msg.includes('does not have access to model') || msg.includes('model_not_found'));
  }
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('model_not_found') || msg.includes('does not have access to model');
}

const ASSISTANT_AI_SCHEMA_VERSION = 1;

const ASSISTANT_AI_OUTPUT_SCHEMA_V1: Record<string, any> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summaryShort: { type: ['string', 'null'] },
    summaryStructured: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          bullets: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'bullets'],
      },
    },
    keyPoints: { type: 'array', items: { type: 'string' } },
    hooks: { type: 'array', items: { type: 'string' } },
    rewriteContent: { type: ['string', 'null'] },
    tags: { type: 'array', items: { type: 'string' } },
    entities: {
      type: 'object',
      additionalProperties: false,
      properties: {
        people: { type: 'array', items: { type: 'string' } },
        orgs: { type: 'array', items: { type: 'string' } },
        places: { type: 'array', items: { type: 'string' } },
        products: { type: 'array', items: { type: 'string' } },
        dates: { type: 'array', items: { type: 'string' } },
        misc: { type: 'array', items: { type: 'string' } },
      },
      required: ['people', 'orgs', 'places', 'products', 'dates', 'misc'],
    },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['create_task', 'create_reminder', 'create_task_bundle'] },
          title: { type: 'string' },
          dueDateIso: { type: ['string', 'null'] },
          remindAtIso: { type: ['string', 'null'] },
          priority: { type: ['string', 'null'], enum: ['low', 'medium', 'high', null] },
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string' },
                dueDateIso: { type: ['string', 'null'] },
                remindAtIso: { type: ['string', 'null'] },
                priority: { type: ['string', 'null'], enum: ['low', 'medium', 'high', null] },
              },
              required: ['title', 'dueDateIso', 'remindAtIso', 'priority'],
            },
          },
        },
        required: ['kind', 'title', 'dueDateIso', 'remindAtIso', 'priority', 'tasks'],
      },
    },
  },
  required: ['summaryShort', 'summaryStructured', 'keyPoints', 'hooks', 'rewriteContent', 'tags', 'entities', 'actions'],
};

async function callOpenAIResponsesJsonSchema(params: {
  model: string;
  instructions: string;
  inputText: string;
  schema: Record<string, any>;
}): Promise<{ parsed: any; refusal: string | null; usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null }> {
  const apiKey = getOpenAIApiKey();
  const projectHeader = getOpenAIProjectHeader();

  const body: Record<string, any> = {
    model: params.model,
    instructions: params.instructions,
    input: [{ role: 'user', content: params.inputText }],
    text: {
      format: {
        type: 'json_schema',
        name: 'assistant_ai_output_v1',
        strict: true,
        schema: params.schema,
      },
    },
    store: false,
  };

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(projectHeader ? { 'OpenAI-Project': projectHeader } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const requestId = res.headers.get('x-request-id');
    let parsedErr: any = null;
    let textBody = '';
    try {
      parsedErr = await res.json();
    } catch {
      textBody = await res.text().catch(() => '');
    }
    const errObj = parsedErr && typeof parsedErr === 'object' ? parsedErr : null;
    const errInner = errObj && typeof errObj?.error === 'object' ? errObj.error : null;
    const message = errInner && typeof errInner?.message === 'string' ? String(errInner.message) : textBody || JSON.stringify(errObj || {});
    const code = errInner && typeof errInner?.code === 'string' ? String(errInner.code) : null;
    const type = errInner && typeof errInner?.type === 'string' ? String(errInner.type) : null;
    const param = errInner && typeof errInner?.param === 'string' ? String(errInner.param) : null;
    throw new OpenAIHttpError({ status: res.status, message: `OpenAI error: ${res.status} ${message}`.slice(0, 800), code, type, param, requestId, projectHeader });
  }

  const json = (await res.json()) as any;
  const usage = json && typeof json?.usage === 'object' && json.usage
    ? {
        inputTokens: typeof json.usage?.input_tokens === 'number' ? Number(json.usage.input_tokens) : undefined,
        outputTokens: typeof json.usage?.output_tokens === 'number' ? Number(json.usage.output_tokens) : undefined,
        totalTokens: typeof json.usage?.total_tokens === 'number' ? Number(json.usage.total_tokens) : undefined,
      }
    : null;

  let refusal: string | null = null;
  const output = Array.isArray(json?.output) ? (json.output as any[]) : [];
  for (const item of output) {
    if (item && item.type === 'message') {
      const content = Array.isArray(item.content) ? item.content : [];
      for (const part of content) {
        if (part && part.type === 'refusal' && typeof part.refusal === 'string') {
          refusal = part.refusal;
        }
      }
    }
  }

  let outputText: string | null = typeof json?.output_text === 'string' ? String(json.output_text) : null;
  if (!outputText) {
    for (const item of output) {
      if (item && item.type === 'message') {
        const content = Array.isArray(item.content) ? item.content : [];
        for (const part of content) {
          if (part && part.type === 'output_text' && typeof part.text === 'string') {
            outputText = String(part.text);
            break;
          }
        }
      }
      if (outputText) break;
    }
  }

  if (!outputText) {
    return { parsed: null, refusal, usage };
  }

  const parsed = JSON.parse(outputText);
  return { parsed, refusal, usage };
}

async function callOpenAIResponsesLooseJson(params: {
  model: string;
  instructions: string;
  inputText: string;
}): Promise<{ parsed: any; refusal: string | null; usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null }> {
  const apiKey = getOpenAIApiKey();
  const projectHeader = getOpenAIProjectHeader();

  const body: Record<string, any> = {
    model: params.model,
    instructions: [
      params.instructions,
      'Return ONLY valid JSON (no markdown, no extra text).',
      'JSON must follow the assistant_ai_output_v1 structure (same keys, same types).',
    ].join('\n'),
    input: [{ role: 'user', content: params.inputText }],
    store: false,
  };

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(projectHeader ? { 'OpenAI-Project': projectHeader } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const requestId = res.headers.get('x-request-id');
    let parsedErr: any = null;
    let textBody = '';
    try {
      parsedErr = await res.json();
    } catch {
      textBody = await res.text().catch(() => '');
    }
    const errObj = parsedErr && typeof parsedErr === 'object' ? parsedErr : null;
    const errInner = errObj && typeof errObj?.error === 'object' ? errObj.error : null;
    const message = errInner && typeof errInner?.message === 'string' ? String(errInner.message) : textBody || JSON.stringify(errObj || {});
    const code = errInner && typeof errInner?.code === 'string' ? String(errInner.code) : null;
    const type = errInner && typeof errInner?.type === 'string' ? String(errInner.type) : null;
    const param = errInner && typeof errInner?.param === 'string' ? String(errInner.param) : null;
    throw new OpenAIHttpError({ status: res.status, message: `OpenAI error: ${res.status} ${message}`.slice(0, 800), code, type, param, requestId, projectHeader });
  }

  const json = (await res.json()) as any;
  const usage = json && typeof json?.usage === 'object' && json.usage
    ? {
        inputTokens: typeof json.usage?.input_tokens === 'number' ? Number(json.usage.input_tokens) : undefined,
        outputTokens: typeof json.usage?.output_tokens === 'number' ? Number(json.usage.output_tokens) : undefined,
        totalTokens: typeof json.usage?.total_tokens === 'number' ? Number(json.usage.total_tokens) : undefined,
      }
    : null;

  let refusal: string | null = null;
  const output = Array.isArray(json?.output) ? (json.output as any[]) : [];
  for (const item of output) {
    if (item && item.type === 'message') {
      const content = Array.isArray(item.content) ? item.content : [];
      for (const part of content) {
        if (part && part.type === 'refusal' && typeof part.refusal === 'string') {
          refusal = part.refusal;
        }
      }
    }
  }

  let outputText: string | null = typeof json?.output_text === 'string' ? String(json.output_text) : null;
  if (!outputText) {
    for (const item of output) {
      if (item && item.type === 'message') {
        const content = Array.isArray(item.content) ? item.content : [];
        for (const part of content) {
          if (part && part.type === 'output_text' && typeof part.text === 'string') {
            outputText = String(part.text);
            break;
          }
        }
      }
      if (outputText) break;
    }
  }

  if (!outputText) {
    return { parsed: null, refusal, usage };
  }

  const parsedRaw = JSON.parse(outputText);
  const parsed = sanitizeAssistantAIOutputV1(parsedRaw);
  const v = validateAssistantAIOutputV1(parsed);
  if (!v.ok) {
    throw new Error(`AI output validation failed: ${v.error}`);
  }

  return { parsed, refusal, usage };
}

function extractBundleTaskTitlesFromText(rawText: string): { title: string; originFromText: string }[] {
  const out: { title: string; originFromText: string }[] = [];

  const add = (title: string, originFromText: string) => {
    const t = title.replace(/\s+/g, ' ').trim();
    if (!t) return;
    out.push({ title: t, originFromText: clampFromText(originFromText, 120) });
  };

  const payRe = /\b(payer|r[ée]gler)\b\s+([^\n\r\.,;]+)/gi;
  for (const m of rawText.matchAll(payRe)) {
    const obj = String(m[2] ?? '').trim();
    add(`Payer ${obj || 'facture'}`, String(m[0] ?? 'payer'));
  }

  const callRe = /\b(appeler|t[ée]l[ée]phoner|t[ée]l[ée]phone|tel|phone)\b\s+([^\n\r\.,;]+)/gi;
  for (const m of rawText.matchAll(callRe)) {
    const obj = String(m[2] ?? '').trim();
    add(`Appeler ${obj || 'quelqu’un'}`, String(m[0] ?? 'appeler'));
  }

  const rdvRe = /\b(prendre\s+rdv|prendre\s+rendez-vous|rdv|rendez-vous|r[ée]server)\b\s*([^\n\r\.,;]+)?/gi;
  for (const m of rawText.matchAll(rdvRe)) {
    const obj = String(m[2] ?? '').trim();
    const base = obj ? `Prendre RDV ${obj}` : 'Prendre RDV';
    add(base, String(m[0] ?? 'rdv'));
  }

  const freeActionRe = /\b(je\s+dois|il\s+faut|a\s+faire|à\s+faire|objectif\s*:|pour\s+but|pour\s+objectif)\b\s*(?:d'|de\s+)?([^\n\r\.,;]+)/gi;
  for (const m of rawText.matchAll(freeActionRe)) {
    const action = String(m[2] ?? '').trim();
    if (!action) continue;
    add(action, String(m[0] ?? action));
  }

  const lines = rawText.split(/\r?\n/);
  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line) continue;

    const todoLike =
      /^\s*([-*•]|\d+[\.)]|\[ \]|\[x\]|\[X\]|todo\s*:)/i.test(line) ||
      /\bTODO\b/i.test(line);

    if (todoLike) {
      const cleaned = line
        .replace(/^\s*([-*•]|\d+[\.)]|\[ \]|\[x\]|\[X\]|todo\s*:)+\s*/i, '')
        .trim();
      if (!cleaned) continue;

      const normalized = cleaned.replace(/^[\-–—]+\s*/, '').trim();
      if (!normalized) continue;
      add(normalized, lineRaw);
      continue;
    }

    // Roadmap-like lines (common in notes): "Implémentation ...", "Ajout ...", etc.
    // Keep this conservative to avoid turning metadata into tasks.
    if (/^cr[ée]e?\s+le\b/i.test(line)) continue;
    if (/^derni[eè]re\s+mise\s+[àa]\s+jour\b/i.test(line)) continue;

    const roadmapMatch = line.match(
      /^\s*(impl[ée]mentation|implementation|ajout|ajouter|cr[ée]ation|cr[ée]er|cr[ée]e|corriger|correction|fix|mise\s+[àa]\s+jour|mettre\s+[àa]\s+jour|d[ée]ployer|d[ée]ploiement|refactor|refonte|optimisation)\b\s*(?::\s*)?(.*)$/i,
    );
    if (!roadmapMatch) continue;

    const rawPrefix = String(roadmapMatch[1] ?? '').toLowerCase();
    const restRaw = String(roadmapMatch[2] ?? '').trim();

    // Avoid lines that are basically just dates/metadata.
    if (restRaw && /^(le\s+\d|\d{1,2}\/\d{1,2}\/\d{2,4})/i.test(restRaw)) continue;

    const verb = (() => {
      if (rawPrefix.startsWith('impl')) return 'Implémenter';
      if (rawPrefix.startsWith('implement')) return 'Implémenter';
      if (rawPrefix.startsWith('ajout') || rawPrefix.startsWith('ajouter')) return 'Ajouter';
      if (rawPrefix.startsWith('cr')) return 'Créer';
      if (rawPrefix.startsWith('corr')) return 'Corriger';
      if (rawPrefix.startsWith('fix')) return 'Corriger';
      if (rawPrefix.includes('mise') || rawPrefix.startsWith('mettre')) return 'Mettre à jour';
      if (rawPrefix.startsWith('d') && rawPrefix.includes('ploi')) return 'Déployer';
      if (rawPrefix.startsWith('refactor') || rawPrefix.startsWith('refonte')) return 'Refactorer';
      if (rawPrefix.startsWith('optim')) return 'Optimiser';
      return 'Faire';
    })();

    const rest = restRaw.replace(/^[\-–—]+\s*/, '').trim();
    const title = rest ? `${verb} ${rest}` : verb;
    add(title, lineRaw);
  }

  const seen = new Set<string>();
  const deduped: { title: string; originFromText: string }[] = [];
  for (const item of out) {
    const key = normalizeAssistantText(item.title);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

type AssistantMemoryLiteDefaults = {
  defaultPriority?: 'low' | 'medium' | 'high';
  defaultReminderHour?: number;
};

function detectIntentsV2(params: {
  title: string;
  content: string;
  now: Date;
  memory?: AssistantMemoryLiteDefaults;
}): { single: DetectedIntent | null; bundle: (DetectedBundle & { appliedDefaultPriority?: boolean }) | null } {
  const { title, content, now } = params;
  const memory = params.memory;
  const rawText = `${title}\n${content}`;

  const priorityInText = parsePriorityInText(rawText);
  const reminderKeyword = hasReminderKeyword(rawText);

  const items = extractBundleTaskTitlesFromText(rawText);
  if (items.length === 0) {
    const v1 = detectIntentsV1({ title, content, now, memory });
    if (v1.length >= 1) return { single: v1[0], bundle: null };
    return { single: null, bundle: null };
  }

  if (items.length === 1) {
    const v1 = detectIntentsV1({ title, content, now, memory });
    if (v1.length === 1) return { single: v1[0], bundle: null };
    const only = items[0];
    const sugTitle = only.title;
    const dtHit = parseDateInText(rawText, now);
    const timeHit = parseTimeInText(rawText);

    let dt = composeDateTime({
      now,
      baseDate: dtHit ? dtHit.date : null,
      time: timeHit ? { hours: timeHit.hours, minutes: timeHit.minutes } : null,
    });

    let appliedDefaultReminderHour = false;
    if (dt && dtHit && !timeHit && reminderKeyword && typeof memory?.defaultReminderHour === 'number') {
      const h = Math.trunc(memory.defaultReminderHour);
      if (Number.isFinite(h) && h >= 0 && h <= 23) {
        const next = new Date(startOfDay(dtHit.date).getTime());
        next.setHours(h, 0, 0, 0);
        dt = next;
        appliedDefaultReminderHour = true;
      }
    }

    const dtTs = dt ? admin.firestore.Timestamp.fromDate(dt) : null;
    const kind: AssistantSuggestionKind = dtTs && (timeHit || reminderKeyword) ? 'create_reminder' : 'create_task';

    const appliedDefaultPriority = !priorityInText && !!memory?.defaultPriority;
    const finalPriority = priorityInText ?? (memory?.defaultPriority ?? undefined);
    const single: DetectedIntent = {
      intent: 'PAYER',
      title: sugTitle,
      originFromText: only.originFromText,
      explanation: `Détecté une action dans la note.`,
      kind,
      dueDate: kind === 'create_task' && dtTs ? dtTs : undefined,
      remindAt: kind === 'create_reminder' && dtTs ? dtTs : undefined,
      ...(finalPriority ? { priority: finalPriority } : {}),
      ...(appliedDefaultPriority ? { appliedDefaultPriority: true } : {}),
      ...(appliedDefaultReminderHour ? { appliedDefaultReminderHour: true } : {}),
      confidence: 0.75,
      dedupeMinimal: {
        title: sugTitle,
        dueDateMs: kind === 'create_task' && dtTs ? dtTs.toMillis() : undefined,
        remindAtMs: kind === 'create_reminder' && dtTs ? dtTs.toMillis() : undefined,
      },
    };
    return { single, bundle: null };
  }

  const limited = items.slice(0, 6);
  const extraCount = Math.max(0, items.length - limited.length);

  const appliedDefaultPriority = !priorityInText && !!memory?.defaultPriority;
  const tasks: AssistantTaskBundleTask[] = limited.map((it) => ({
    title: it.title,
    ...(appliedDefaultPriority && memory?.defaultPriority ? { priority: memory.defaultPriority } : {}),
    origin: { fromText: it.originFromText },
  }));
  const bundleTitle = `Plan d’action — ${limited[0]?.title ?? 'Votre note'}`;
  const tasksSig = sha256Hex(limited.map((t) => normalizeAssistantText(t.title)).join('|'));
  const explanation = extraCount > 0 ? `Plan d’action détecté (+${extraCount} autres).` : `Plan d’action détecté.`;

  const bundle: DetectedBundle & { appliedDefaultPriority?: boolean } = {
    title: bundleTitle,
    tasks,
    bundleMode: 'multiple_tasks',
    originFromText: limited[0]?.originFromText ?? clampFromText(rawText, 120),
    explanation,
    confidence: 0.8,
    ...(appliedDefaultPriority ? { appliedDefaultPriority: true } : {}),
    dedupeMinimal: {
      title: bundleTitle,
      tasksSig,
    },
  };

  return { single: null, bundle };
}

function detectIntentsV1(params: { title: string; content: string; now: Date; memory?: AssistantMemoryLiteDefaults }): DetectedIntent[] {
  const { title, content, now } = params;
  const memory = params.memory;
  const rawText = `${title}\n${content}`;
  const textNorm = normalizeForIntentMatch(rawText);

  const priorityInText = parsePriorityInText(rawText);
  const reminderKeyword = hasReminderKeyword(rawText);

  const dateHit = parseDateInText(rawText, now);
  const timeHit = parseTimeInText(rawText);
  const dt = composeDateTime({
    now,
    baseDate: dateHit ? dateHit.date : null,
    time: timeHit ? { hours: timeHit.hours, minutes: timeHit.minutes } : null,
  });

  let dtFinal = dt;
  let appliedDefaultReminderHour = false;
  if (dtFinal && dateHit && !timeHit && reminderKeyword && typeof memory?.defaultReminderHour === 'number') {
    const h = Math.trunc(memory.defaultReminderHour);
    if (Number.isFinite(h) && h >= 0 && h <= 23) {
      const next = new Date(startOfDay(dateHit.date).getTime());
      next.setHours(h, 0, 0, 0);
      dtFinal = next;
      appliedDefaultReminderHour = true;
    }
  }

  const dtTs = dtFinal ? admin.firestore.Timestamp.fromDate(dtFinal) : null;

  const intents: DetectedIntent[] = [];

  const add = (next: Omit<DetectedIntent, 'dedupeMinimal'> & { dedupeMinimal?: DetectedIntent['dedupeMinimal'] }) => {
    const confidence = next.confidence;
    if (confidence < 0.7) return;
    const minimal: DetectedIntent['dedupeMinimal'] = next.dedupeMinimal ?? {
      title: next.title,
      dueDateMs: next.dueDate ? next.dueDate.toMillis() : undefined,
      remindAtMs: next.remindAt ? next.remindAt.toMillis() : undefined,
    };
    intents.push({ ...next, confidence, dedupeMinimal: minimal });
  };

  const appliedDefaultPriority = !priorityInText && !!memory?.defaultPriority;
  const finalPriority = priorityInText ?? (memory?.defaultPriority ?? undefined);

  const payHasKeyword =
    textNorm.includes('payer') ||
    textNorm.includes('regler') ||
    textNorm.includes('facture') ||
    textNorm.includes('loyer') ||
    textNorm.includes('impots') ||
    textNorm.includes('abonnement');

  const mPay = rawText.match(/\b(payer|r[ée]gler)\b\s+([^\n\r\.,;]+)/i);
  if (mPay || payHasKeyword) {
    const obj = mPay ? String(mPay[2] ?? '').trim() : '';
    const objTitle = obj ? obj : 'facture';
    const sugTitle = `Payer ${objTitle}`.replace(/\s+/g, ' ').trim();
    const kind: AssistantSuggestionKind = dtTs && (timeHit || reminderKeyword) ? 'create_reminder' : 'create_task';
    add({
      intent: 'PAYER',
      title: sugTitle,
      originFromText: clampFromText(mPay ? mPay[0] : 'payer', 120),
      explanation: `Détecté une intention de paiement dans la note.`,
      kind,
      dueDate: kind === 'create_task' && dtTs ? dtTs : undefined,
      remindAt: kind === 'create_reminder' && dtTs ? dtTs : undefined,
      ...(finalPriority ? { priority: finalPriority } : {}),
      ...(appliedDefaultPriority ? { appliedDefaultPriority: true } : {}),
      ...(appliedDefaultReminderHour ? { appliedDefaultReminderHour: true } : {}),
      confidence: 0.8,
    });
  }

  const mCall = rawText.match(/\b(appeler|t[ée]l[ée]phoner|tel|phone)\b\s+([^\n\r\.,;]+)/i);
  if (mCall) {
    const obj = String(mCall[2] ?? '').trim();
    const objTitle = obj ? obj : 'quelqu’un';
    const sugTitle = `Appeler ${objTitle}`.replace(/\s+/g, ' ').trim();
    const kind: AssistantSuggestionKind = dtTs && (timeHit || reminderKeyword) ? 'create_reminder' : 'create_task';
    add({
      intent: 'APPELER',
      title: sugTitle,
      originFromText: clampFromText(mCall[0], 120),
      explanation: `Détecté une intention d’appel dans la note.`,
      kind,
      dueDate: kind === 'create_task' && dtTs ? dtTs : undefined,
      remindAt: kind === 'create_reminder' && dtTs ? dtTs : undefined,
      ...(finalPriority ? { priority: finalPriority } : {}),
      ...(appliedDefaultPriority ? { appliedDefaultPriority: true } : {}),
      ...(appliedDefaultReminderHour ? { appliedDefaultReminderHour: true } : {}),
      confidence: 0.8,
    });
  }

  const mRdv = rawText.match(/\b(prendre\s+rdv|prendre\s+rendez-vous|rdv|rendez-vous|r[ée]server)\b\s*([^\n\r\.,;]+)?/i);
  if (mRdv) {
    const obj = String(mRdv[2] ?? '').trim();
    const objTitle = obj ? obj : '';
    const baseTitle = objTitle ? `Prendre RDV ${objTitle}` : 'Prendre RDV';
    const sugTitle = baseTitle.replace(/\s+/g, ' ').trim();
    const kind: AssistantSuggestionKind = dtTs && (timeHit || reminderKeyword) ? 'create_reminder' : 'create_task';
    add({
      intent: 'PRENDRE_RDV',
      title: sugTitle,
      originFromText: clampFromText(mRdv[0], 120),
      explanation: `Détecté une intention de rendez-vous dans la note.`,
      kind,
      dueDate: kind === 'create_task' && dtTs ? dtTs : undefined,
      remindAt: kind === 'create_reminder' && dtTs ? dtTs : undefined,
      ...(finalPriority ? { priority: finalPriority } : {}),
      ...(appliedDefaultPriority ? { appliedDefaultPriority: true } : {}),
      ...(appliedDefaultReminderHour ? { appliedDefaultReminderHour: true } : {}),
      confidence: 0.8,
    });
  }

  return intents;
}

function assistantObjectIdForNote(noteId: string): string {
  return `note_${noteId}`;
}

function assistantObjectIdForTodo(todoId: string): string {
  return `todo_${todoId}`;
}

type AssistantJtbdPreset = 'daily_planning' | 'dont_forget' | 'meetings' | 'projects';

type AssistantSettingsLite = {
  enabled: boolean;
  jtbdPreset: AssistantJtbdPreset;
};

async function getAssistantSettingsForUser(db: FirebaseFirestore.Firestore, userId: string): Promise<AssistantSettingsLite> {
  const snap = await db
    .collection('users')
    .doc(userId)
    .collection('assistantSettings')
    .doc('main')
    .get();

  if (!snap.exists) {
    return { enabled: false, jtbdPreset: 'daily_planning' };
  }

  const data = snap.data() as { enabled?: unknown; jtbdPreset?: unknown };
  const rawPreset = data?.jtbdPreset;
  const jtbdPreset: AssistantJtbdPreset =
    rawPreset === 'dont_forget' || rawPreset === 'meetings' || rawPreset === 'projects' || rawPreset === 'daily_planning'
      ? rawPreset
      : 'daily_planning';

  return {
    enabled: data?.enabled === true,
    jtbdPreset,
  };
}

async function isAssistantEnabledForUser(db: FirebaseFirestore.Firestore, userId: string): Promise<boolean> {
  const settings = await getAssistantSettingsForUser(db, userId);
  return settings.enabled;
}

function buildTodoAssistantText(todo: { title?: unknown; items?: unknown[] }): string {
  const title = typeof todo.title === 'string' ? todo.title : '';
  const itemsRaw = Array.isArray(todo.items) ? todo.items : [];

  const lines = itemsRaw
    .map((it) => {
      const row = it && typeof it === 'object' ? (it as { text?: unknown; done?: unknown }) : null;
      const text = typeof row?.text === 'string' ? row.text.trim() : '';
      const done = row?.done === true;
      if (!text || done) return null;
      return `- ${text}`;
    })
    .filter((v): v is string => !!v);

  return `${title}\n${lines.join('\n')}`;
}

function computeAssistantSuggestionRankScore(params: {
  jtbdPreset: AssistantJtbdPreset;
  kind: AssistantSuggestionKind;
  sourceType: 'note' | 'todo';
  payload: AssistantSuggestionPayload;
}): number {
  const { jtbdPreset, kind, sourceType, payload } = params;

  const byPreset = (() => {
    if (jtbdPreset === 'dont_forget') {
      if (kind === 'create_reminder') return 95;
      if (kind === 'create_task') return 88;
      if (kind === 'create_task_bundle') return 78;
      return 60;
    }
    if (jtbdPreset === 'meetings') {
      if (kind === 'create_task') return 92;
      if (kind === 'create_task_bundle') return 84;
      if (kind === 'create_reminder') return 74;
      return 60;
    }
    if (jtbdPreset === 'projects') {
      if (kind === 'create_task_bundle') return 96;
      if (kind === 'create_task') return 89;
      if (kind === 'create_reminder') return 71;
      return 60;
    }
    if (kind === 'create_task_bundle') return 93;
    if (kind === 'create_task') return 87;
    if (kind === 'create_reminder') return 80;
    return 60;
  })();

  const confidenceRaw = (payload as { confidence?: unknown })?.confidence;
  const confidence = typeof confidenceRaw === 'number' && Number.isFinite(confidenceRaw) ? confidenceRaw : 0;

  const dueDateBonus = (payload as { dueDate?: unknown })?.dueDate ? 2 : 0;
  const remindAtBonus = (payload as { remindAt?: unknown })?.remindAt ? 3 : 0;
  const sourceBonus = sourceType === 'todo' ? 1 : 0;

  return byPreset + Math.round(confidence * 10) + dueDateBonus + remindAtBonus + sourceBonus;
}

type SmtpEnv = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  appBaseUrl: string;
};

type SmtpEnvResolved = {
  env: SmtpEnv;
  source: {
    host: 'process.env';
    port: 'process.env';
    user: 'process.env';
    pass: 'process.env';
    from: 'process.env';
    appBaseUrl: 'process.env';
  };
};

function getSmtpEnv(): SmtpEnvResolved | null {
  const hostEnv = process.env.SMTP_HOST;
  const portEnv = process.env.SMTP_PORT;
  const userEnv = process.env.SMTP_USER;
  const passEnv = process.env.SMTP_PASS;
  const fromEnv = process.env.SMTP_FROM;
  const appBaseUrlEnv = process.env.APP_BASE_URL;

  const host = hostEnv;
  const portRaw = portEnv;
  const user = userEnv;
  const pass = passEnv;
  const from = fromEnv;
  const appBaseUrl = appBaseUrlEnv;

  const source = {
    host: 'process.env',
    port: 'process.env',
    user: 'process.env',
    pass: 'process.env',
    from: 'process.env',
    appBaseUrl: 'process.env',
  } as const;

  if (!host || !portRaw || !user || !pass || !from || !appBaseUrl) {
    console.error('SMTP config missing', {
      hasHost: !!host,
      hasPort: !!portRaw,
      hasUser: !!user,
      hasPass: !!pass,
      hasFrom: !!from,
      hasAppBaseUrl: !!appBaseUrl,
      source,
    });
    return null;
  }

  const port = Number(portRaw);
  if (!Number.isFinite(port)) {
    console.error('SMTP config invalid port', { portRaw, source });
    return null;
  }

  return { env: { host, port, user, pass, from, appBaseUrl }, source };
}

function getEmailTestSecret(): string | null {
  const secret = process.env.EMAIL_TEST_SECRET;
  return secret ?? null;
}

async function sendReminderEmail(params: {
  to: string;
  taskTitle: string;
  reminderTimeIso: string;
  taskId: string;
}): Promise<void> {
  const resolved = getSmtpEnv();
  if (!resolved) {
    throw new Error('SMTP env is not configured');
  }

  const { env, source } = resolved;

  console.log('SMTP config detected', {
    host: env.host,
    port: env.port,
    secure: env.port === 465,
    user: env.user,
    from: env.from,
    appBaseUrl: env.appBaseUrl,
    source,
  });

  const transporter = nodemailer.createTransport({
    host: env.host,
    port: env.port,
    // Hostinger commonly uses:
    // - 465 with implicit TLS (secure=true)
    // - 587 with STARTTLS (secure=false)
    secure: env.port === 465,
    requireTLS: env.port === 587,
    tls: {
      minVersion: 'TLSv1.2',
    },
    auth: {
      user: env.user,
      pass: env.pass,
    },
  });

  const taskUrl = `${env.appBaseUrl.replace(/\/$/, '')}/tasks/${encodeURIComponent(params.taskId)}`;
  const reminderDate = new Date(params.reminderTimeIso);
  const reminderText = Number.isNaN(reminderDate.getTime())
    ? params.reminderTimeIso
    : reminderDate.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });

  const subject = '⏰ Rappel de tâche — Smart Notes';
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
      <h2 style="margin: 0 0 12px;">⏰ Rappel de tâche</h2>
      <p style="margin: 0 0 8px;"><strong>${escapeHtml(params.taskTitle || 'Tâche')}</strong></p>
      <p style="margin: 0 0 16px;">Rappel : ${escapeHtml(reminderText)}</p>
      <p style="margin: 0 0 16px;">
        <a href="${taskUrl}" style="display: inline-block; padding: 10px 14px; background: #111; color: #fff; text-decoration: none; border-radius: 8px;">Ouvrir la tâche</a>
      </p>
      <p style="margin: 0; color: #555; font-size: 12px;">Smart Notes — ${escapeHtml(env.appBaseUrl)}</p>
    </div>
  `;

  try {
    // Verify connection/auth early for clearer errors.
    await transporter.verify();
  } catch (e) {
    console.error('SMTP verify failed', {
      host: env.host,
      port: env.port,
      secure: env.port === 465,
      user: env.user,
      to: params.to,
      error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e,
    });
    throw e;
  }

  try {
    const info = await transporter.sendMail({
      from: env.from,
      to: params.to,
      replyTo: env.from,
      subject,
      html,
    });

    console.log('Email reminder sent', {
      to: params.to,
      messageId: (info as any)?.messageId,
      accepted: (info as any)?.accepted,
      rejected: (info as any)?.rejected,
      response: (info as any)?.response,
    });
  } catch (e) {
    console.error('SMTP sendMail failed', {
      host: env.host,
      port: env.port,
      secure: env.port === 465,
      user: env.user,
      from: env.from,
      to: params.to,
      error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e,
    });
    throw e;
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function claimReminder(params: {
  db: FirebaseFirestore.Firestore;
  ref: FirebaseFirestore.DocumentReference;
  now: FirebaseFirestore.Timestamp;
  processingTtlMs: number;
  processingBy: string;
}): Promise<boolean> {
  const { db, ref, now, processingTtlMs, processingBy } = params;

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;

    const data = snap.data() as any;
    if (data?.sent === true) return false;

    const processingAt: FirebaseFirestore.Timestamp | null = data?.processingAt ?? null;
    if (processingAt) {
      const ageMs = now.toMillis() - processingAt.toMillis();
      if (ageMs >= 0 && ageMs < processingTtlMs) {
        return false;
      }
    }

    tx.update(ref, {
      processingAt: now,
      processingBy,
    });
    return true;
  });
}

export const checkAndSendReminders = functions.pubsub
  .schedule('every 1 minutes')
  .onRun(async (context) => {
    const now = new Date();
    const nowIso = now.toISOString();
    const processingTtlMs = 2 * 60 * 1000;
    const processingBy = typeof (context as any)?.eventId === 'string' && (context as any).eventId
      ? String((context as any).eventId)
      : `run:${nowIso}`;

    try {
      const db = admin.firestore();
      const remindersSnapshot = await db
        .collection('taskReminders')
        .where('sent', '==', false)
        .where('reminderTime', '<=', nowIso)
        .orderBy('reminderTime', 'asc')
        .limit(200)
        .get();

      console.log(
        `checkAndSendReminders: now=${nowIso} reminders=${remindersSnapshot.size}`,
      );

      const reminderPromises = remindersSnapshot.docs.map(async (doc) => {
        const reminder = doc.data() as TaskReminder;

        const claimed = await claimReminder({
          db,
          ref: doc.ref,
          now: admin.firestore.Timestamp.fromDate(now),
          processingTtlMs,
          processingBy,
        });
        if (!claimed) {
          return;
        }
        
        // Get the task details
        const taskDoc = await db.collection('tasks').doc(reminder.taskId).get();
        if (!taskDoc.exists) {
          console.log(`Task ${reminder.taskId} not found, skipping reminder`);
          try {
            await doc.ref.update({ processingAt: admin.firestore.FieldValue.delete(), processingBy: admin.firestore.FieldValue.delete() });
          } catch {
            // ignore
          }
          return;
        }
        
        const task = taskDoc.data();
        
        // Get user's FCM tokens
        const userDoc = await db.collection('users').doc(reminder.userId).get();
        if (!userDoc.exists) {
          console.log(`User ${reminder.userId} not found, skipping reminder`);
          try {
            await doc.ref.update({ processingAt: admin.firestore.FieldValue.delete(), processingBy: admin.firestore.FieldValue.delete() });
          } catch {
            // ignore
          }
          return;
        }
        
        const userData = userDoc.data();
        const fcmTokens = userData?.fcmTokens || {};

        const tokens = Object.keys(fcmTokens);

        const pushEnabled = !!userData?.settings?.notifications?.taskReminders;
        const userEmail = typeof userData?.email === 'string' ? userData.email : null;

        // Prepare notification message
        const message = {
          notification: {
            title: '⏰ Rappel de tâche',
            body: task?.title ? String(task.title) : 'Tu as une tâche à vérifier.'
          },
          data: {
            taskId: reminder.taskId,
            dueDate: reminder.dueDate,
            url: `/tasks/${reminder.taskId}`
          }
        };

        let delivered = false;
        let deliveryChannel: TaskReminder['deliveryChannel'] | undefined;

        if (pushEnabled && tokens.length > 0) {
          const invalidTokens = new Set<string>();
          let sentAny = false;

          const sendPromises = tokens.map(async (token) => {
            try {
              await admin.messaging().send({
                ...message,
                token,
              });
              sentAny = true;
            } catch (error) {
              const messagingError = error as MessagingError;
              console.warn(
                `Failed sending reminder ${doc.id} to token (user=${reminder.userId}) code=${messagingError.code}`,
              );
              if (
                messagingError.code === 'messaging/invalid-registration-token' ||
                messagingError.code === 'messaging/registration-token-not-registered'
              ) {
                invalidTokens.add(token);
              }
            }
          });

          await Promise.all(sendPromises);

          if (invalidTokens.size > 0) {
            try {
              const nextMap: Record<string, boolean> = {};
              for (const t of tokens) {
                if (!invalidTokens.has(t)) nextMap[t] = true;
              }
              await db.collection('users').doc(reminder.userId).update({ fcmTokens: nextMap });
            } catch (e) {
              console.warn(`Failed cleaning invalid tokens for user ${reminder.userId}`, e);
            }
          }

          if (sentAny) {
            delivered = true;
            deliveryChannel = 'web_push';
          }
        }

        if (!delivered) {
          if (!userEmail) {
            console.warn(`No email available for user ${reminder.userId}; cannot send email reminder ${doc.id}`);
          } else {
            try {
              await sendReminderEmail({
                to: userEmail,
                taskTitle: task?.title ? String(task.title) : 'Tâche',
                reminderTimeIso: reminder.reminderTime,
                taskId: reminder.taskId,
              });
              delivered = true;
              deliveryChannel = 'email';
            } catch (e) {
              console.error(`Email reminder failed for ${doc.id} (user=${reminder.userId})`, e);
            }
          }
        }

        if (delivered) {
          await doc.ref.update({
            sent: true,
            deliveryChannel,
            processingAt: admin.firestore.FieldValue.delete(),
            processingBy: admin.firestore.FieldValue.delete(),
          });
        } else {
          // Allow retry on next run (but only after TTL, enforced by claimReminder).
          try {
            await doc.ref.update({ processingAt: admin.firestore.Timestamp.fromDate(now), processingBy });
          } catch {
            // ignore
          }
        }
      });
      
      await Promise.all(reminderPromises);
      
      console.log('Reminder check completed successfully');
    } catch (error) {
      console.error('Error processing reminders:', error instanceof Error ? error.message : 'Unknown error');
    }
  });

export const assistantExpireSuggestions = functions.pubsub
  .schedule('every 24 hours')
  .onRun(async (context) => {
    const db = admin.firestore();
    const nowTs = admin.firestore.Timestamp.now();
    const nowServer = admin.firestore.FieldValue.serverTimestamp();

    let expiredCount = 0;

    while (true) {
      const snap = await db
        .collectionGroup('assistantSuggestions')
        .where('status', '==', 'proposed')
        .where('expiresAt', '<=', nowTs)
        .orderBy('expiresAt', 'asc')
        .limit(500)
        .get();

      if (snap.empty) break;

      const batch = db.batch();
      for (const d of snap.docs) {
        batch.update(d.ref, { status: 'expired', updatedAt: nowServer });
      }
      await batch.commit();
      expiredCount += snap.size;

      if (snap.size < 500) break;
    }

    console.log('assistantExpireSuggestions done', { expiredCount });
  });

export const assistantPurgeExpiredSuggestions = functions.pubsub
  .schedule('every monday 02:00')
  .onRun(async (context) => {
    const db = admin.firestore();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffTs = admin.firestore.Timestamp.fromDate(cutoff);

    let deletedCount = 0;

    while (true) {
      const snap = await db
        .collectionGroup('assistantSuggestions')
        .where('status', '==', 'expired')
        .where('updatedAt', '<=', cutoffTs)
        .orderBy('updatedAt', 'asc')
        .limit(500)
        .get();

      if (snap.empty) break;

      const batch = db.batch();
      for (const d of snap.docs) {
        batch.delete(d.ref);
      }
      await batch.commit();
      deletedCount += snap.size;

      if (snap.size < 500) break;
    }

    console.log('assistantPurgeExpiredSuggestions done', { deletedCount });
  });

// Optional: Clean up old reminders
export const cleanupOldReminders = functions.pubsub
  .schedule('every 24 hours')
  .onRun(async (context) => {
    const db = admin.firestore();
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    
    try {
      const oldReminders = await db
        .collection('taskReminders')
        .where('reminderTime', '<=', twoDaysAgo.toISOString())
        .get();
      
      const deletePromises = oldReminders.docs.map((doc) => doc.ref.delete());
      await Promise.all(deletePromises);
      
      console.log(`Cleaned up ${oldReminders.size} old reminders`);
    } catch (error) {
      console.error('Error cleaning up old reminders:', error instanceof Error ? error.message : 'Unknown error');
    }
  });

export const testSendReminderEmail = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  const secret = getEmailTestSecret();
  if (!secret) {
    res.status(500).json({ error: 'Email test secret is not configured.' });
    return;
  }

  const provided = (req.get('x-email-test-secret') || '').trim();
  if (!provided || provided !== secret) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  const body = (req.body ?? {}) as any;
  const reminderId = typeof body.reminderId === 'string' ? body.reminderId : null;
  const userId = typeof body.userId === 'string' ? body.userId : null;
  const toOverride = typeof body.to === 'string' ? body.to : null;

  const db = admin.firestore();

  try {
    const effectiveReminderId = reminderId;

    if (!effectiveReminderId && userId) {
      const snap = await db
        .collection('taskReminders')
        .where('userId', '==', userId)
        .where('sent', '==', false)
        .limit(1)
        .get();

      const doc = snap.docs[0] ?? null;
      if (!doc) {
        res.status(404).json({ error: 'No pending reminder found for this user.' });
        return;
      }

      const reminderRef = doc.ref;
      const reminder = doc.data() as TaskReminder;

      const taskSnap = await db.collection('tasks').doc(reminder.taskId).get();
      const taskTitle = taskSnap.exists ? String(taskSnap.data()?.title ?? 'Tâche') : 'Tâche';

      const userSnap = await db.collection('users').doc(reminder.userId).get();
      const userEmail = userSnap.exists && typeof userSnap.data()?.email === 'string' ? (userSnap.data() as any).email : null;

      const to = toOverride ?? userEmail;
      if (!to) {
        res.status(400).json({ error: 'No recipient email available. Provide body.to or ensure user.email exists.' });
        return;
      }

      await sendReminderEmail({
        to,
        taskTitle,
        reminderTimeIso: reminder.reminderTime,
        taskId: reminder.taskId,
      });

      await reminderRef.update({ sent: true, deliveryChannel: 'email' });

      res.status(200).json({ ok: true, reminderId: reminderRef.id, to, deliveryChannel: 'email' });
      return;
    }

    if (effectiveReminderId) {
      const reminderRef = db.collection('taskReminders').doc(effectiveReminderId);
      const reminderSnap = await reminderRef.get();
      if (!reminderSnap.exists) {
        res.status(404).json({ error: 'Reminder not found.' });
        return;
      }

      const reminder = reminderSnap.data() as TaskReminder;

      const taskSnap = await db.collection('tasks').doc(reminder.taskId).get();
      const taskTitle = taskSnap.exists ? String(taskSnap.data()?.title ?? 'Tâche') : 'Tâche';

      const userSnap = await db.collection('users').doc(reminder.userId).get();
      const userEmail = userSnap.exists && typeof userSnap.data()?.email === 'string' ? (userSnap.data() as any).email : null;

      const to = toOverride ?? userEmail;
      if (!to) {
        res.status(400).json({ error: 'No recipient email available. Provide body.to or ensure user.email exists.' });
        return;
      }

      await sendReminderEmail({
        to,
        taskTitle,
        reminderTimeIso: reminder.reminderTime,
        taskId: reminder.taskId,
      });

      await reminderRef.update({ sent: true, deliveryChannel: 'email' });

      res.status(200).json({ ok: true, reminderId: effectiveReminderId, to, deliveryChannel: 'email' });
      return;
    }

    // Direct send mode (no Firestore reminder update)
    const to = toOverride;
    const taskId = typeof body.taskId === 'string' ? body.taskId : null;
    const taskTitle = typeof body.taskTitle === 'string' ? body.taskTitle : 'Tâche';
    const reminderTimeIso = typeof body.reminderTimeIso === 'string' ? body.reminderTimeIso : new Date().toISOString();

    if (!to) {
      res.status(400).json({ error: 'Missing body.to' });
      return;
    }

    await sendReminderEmail({
      to,
      taskTitle,
      reminderTimeIso,
      taskId: taskId ?? 'unknown',
    });

    res.status(200).json({ ok: true, to, taskId: taskId ?? null });
  } catch (e) {
    console.error('testSendReminderEmail failed', e);
    res.status(500).json({
      error: e instanceof Error ? e.message : 'Unknown error',
    });
  }
});

export const assistantEnqueueNoteJob = functions.firestore
  .document('notes/{noteId}')
  .onWrite(async (change, context) => {
    const after = change.after.exists ? (change.after.data() as any) : null;
    if (!after) return;

    const noteId = typeof context.params.noteId === 'string' ? context.params.noteId : null;
    if (!noteId) return;

    const userId = typeof after.userId === 'string' ? after.userId : null;
    if (!userId) return;

    const db = admin.firestore();

    const enabled = await isAssistantEnabledForUser(db, userId);
    if (!enabled) return;

    const title = typeof after.title === 'string' ? after.title : '';
    const content = typeof after.content === 'string' ? after.content : '';
    const normalized = normalizeAssistantText(`${title}\n${content}`);
    const textHash = sha256Hex(normalized);

    const objectId = assistantObjectIdForNote(noteId);
    const userRef = db.collection('users').doc(userId);
    const objectRef = userRef.collection('assistantObjects').doc(objectId);
    const jobsCol = userRef.collection('assistantJobs');

    const lockedUntilReady = admin.firestore.Timestamp.fromMillis(0);

    await db.runTransaction(async (tx) => {
      const objectSnap = await tx.get(objectRef);
      const objectData = objectSnap.exists ? (objectSnap.data() as any) : null;
      const prevHash =
        objectData && typeof objectData?.pendingTextHash === 'string'
          ? (objectData.pendingTextHash as string)
          : objectData && typeof objectData?.textHash === 'string'
            ? (objectData.textHash as string)
            : null;
      if (typeof prevHash === 'string' && prevHash === textHash) {
        return;
      }

      const jobRef = jobsCol.doc(assistantCurrentJobIdForObject(objectId));
      const jobSnap = await tx.get(jobRef);
      if (jobSnap.exists) {
        const data = jobSnap.data() as any;
        const st = data?.status as AssistantJobStatus | undefined;
        const pending = typeof data?.pendingTextHash === 'string' ? (data.pendingTextHash as string) : null;
        if ((st === 'queued' || st === 'processing') && pending === textHash) {
          // Already enqueued for this content.
          return;
        }
        if (st === 'queued' || st === 'processing') {
          // Already has an active job; don't create a second one.
          // But keep the newest content hash so the current job effectively targets the latest version.
          tx.set(
            objectRef,
            {
              pendingTextHash: textHash,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
          tx.set(
            jobRef,
            {
              pendingTextHash: textHash,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
          return;
        }
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      const existingTextHash = objectData && typeof objectData?.textHash === 'string' ? (objectData.textHash as string) : null;
      const objectPayload: Partial<AssistantObjectDoc> = {
        objectId,
        type: 'note',
        coreRef: { collection: 'notes', id: noteId },
        textHash: existingTextHash ?? textHash,
        pendingTextHash: textHash,
        pipelineVersion: 1,
        status: 'queued',
        updatedAt: now,
      };

      if (!objectSnap.exists) {
        objectPayload.createdAt = now;
        objectPayload.lastAnalyzedAt = null;
      }

      tx.set(objectRef, objectPayload, { merge: true });

      const jobPayload: AssistantJobDoc = {
        objectId,
        jobType: 'analyze_intents_v2',
        pipelineVersion: 1,
        status: 'queued',
        attempts: 0,
        pendingTextHash: textHash,
        lockedUntil: lockedUntilReady,
        createdAt: now,
        updatedAt: now,
      };

      if (jobSnap.exists) {
        tx.set(jobRef, jobPayload, { merge: true });
      } else {
        tx.create(jobRef, jobPayload);
      }
    });
  });

export const assistantEnqueueTodoJob = functions.firestore
  .document('todos/{todoId}')
  .onWrite(async (change, context) => {
    const after = change.after.exists ? (change.after.data() as any) : null;
    if (!after) return;

    const todoId = typeof context.params.todoId === 'string' ? context.params.todoId : null;
    if (!todoId) return;

    const userId = typeof after.userId === 'string' ? after.userId : null;
    if (!userId) return;

    const db = admin.firestore();

    const enabled = await isAssistantEnabledForUser(db, userId);
    if (!enabled) return;

    const rawText = buildTodoAssistantText(after as { title?: unknown; items?: unknown[] });
    const normalized = normalizeAssistantText(rawText);
    const textHash = sha256Hex(normalized);

    const objectId = assistantObjectIdForTodo(todoId);
    const userRef = db.collection('users').doc(userId);
    const objectRef = userRef.collection('assistantObjects').doc(objectId);
    const jobsCol = userRef.collection('assistantJobs');

    const lockedUntilReady = admin.firestore.Timestamp.fromMillis(0);

    await db.runTransaction(async (tx) => {
      const objectSnap = await tx.get(objectRef);
      const objectData = objectSnap.exists ? (objectSnap.data() as any) : null;
      const prevHash =
        objectData && typeof objectData?.pendingTextHash === 'string'
          ? (objectData.pendingTextHash as string)
          : objectData && typeof objectData?.textHash === 'string'
            ? (objectData.textHash as string)
            : null;
      if (typeof prevHash === 'string' && prevHash === textHash) {
        return;
      }

      const jobRef = jobsCol.doc(assistantCurrentJobIdForObject(objectId));
      const jobSnap = await tx.get(jobRef);
      if (jobSnap.exists) {
        const data = jobSnap.data() as any;
        const st = data?.status as AssistantJobStatus | undefined;
        const pending = typeof data?.pendingTextHash === 'string' ? (data.pendingTextHash as string) : null;
        if ((st === 'queued' || st === 'processing') && pending === textHash) {
          return;
        }
        if (st === 'queued' || st === 'processing') {
          tx.set(
            objectRef,
            {
              pendingTextHash: textHash,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
          tx.set(
            jobRef,
            {
              pendingTextHash: textHash,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
          return;
        }
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      const existingTextHash = objectData && typeof objectData?.textHash === 'string' ? (objectData.textHash as string) : null;
      const objectPayload: Partial<AssistantObjectDoc> = {
        objectId,
        type: 'todo',
        coreRef: { collection: 'todos', id: todoId },
        textHash: existingTextHash ?? textHash,
        pendingTextHash: textHash,
        pipelineVersion: 1,
        status: 'queued',
        updatedAt: now,
      };

      if (!objectSnap.exists) {
        objectPayload.createdAt = now;
        objectPayload.lastAnalyzedAt = null;
      }

      tx.set(objectRef, objectPayload, { merge: true });

      const jobPayload: AssistantJobDoc = {
        objectId,
        jobType: 'analyze_intents_v2',
        pipelineVersion: 1,
        status: 'queued',
        attempts: 0,
        pendingTextHash: textHash,
        lockedUntil: lockedUntilReady,
        createdAt: now,
        updatedAt: now,
      };

      if (jobSnap.exists) {
        tx.set(jobRef, jobPayload, { merge: true });
      } else {
        tx.create(jobRef, jobPayload);
      }
    });
  });

const ASSISTANT_JOB_LOCK_MS = 2 * 60 * 1000;
const ASSISTANT_JOB_MAX_ATTEMPTS = 3;

async function claimAssistantJob(params: {
  db: FirebaseFirestore.Firestore;
  ref: FirebaseFirestore.DocumentReference;
  now: FirebaseFirestore.Timestamp;
}): Promise<AssistantJobDoc | null> {
  const { db, ref, now } = params;

  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;

    const data = snap.data() as any;
    const status = data?.status as AssistantJobStatus | undefined;
    if (status !== 'queued') return null;

    const attempts = typeof data?.attempts === 'number' ? data.attempts : 0;
    if (attempts >= ASSISTANT_JOB_MAX_ATTEMPTS) {
      tx.update(ref, {
        status: 'error',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return null;
    }

    const lockedUntil: FirebaseFirestore.Timestamp | null = data?.lockedUntil ?? null;
    if (lockedUntil && lockedUntil.toMillis() > now.toMillis()) return null;

    const nextLocked = admin.firestore.Timestamp.fromMillis(now.toMillis() + ASSISTANT_JOB_LOCK_MS);
    tx.update(ref, {
      status: 'processing',
      attempts: attempts + 1,
      lockedUntil: nextLocked,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return snap.data() as AssistantJobDoc;
  });
}

export const assistantRunJobQueue = functions.pubsub
  .schedule('every 1 minutes')
  .onRun(async (context) => {
    const db = admin.firestore();
    const nowDate = new Date();
    const nowTs = admin.firestore.Timestamp.fromDate(nowDate);

    const snap = await db
      .collectionGroup('assistantJobs')
      .where('status', '==', 'queued')
      .where('lockedUntil', '<=', nowTs)
      .orderBy('lockedUntil', 'asc')
      .limit(25)
      .get();

    if (snap.empty) {
      console.log('assistantRunJobQueue: no queued jobs');
      return;
    }

    console.log(`assistantRunJobQueue: queued=${snap.size}`);

    const tasks = snap.docs.map(async (jobDoc) => {
      const userRef = jobDoc.ref.parent.parent;
      const userId = userRef?.id;
      if (!userId) return;

      const assistantSettings = await getAssistantSettingsForUser(db, userId);
      if (!assistantSettings.enabled) return;
      const jtbdPreset = assistantSettings.jtbdPreset;

      const claimed = await claimAssistantJob({ db, ref: jobDoc.ref, now: nowTs });
      if (!claimed) return;

      const objectId = typeof claimed.objectId === 'string' ? claimed.objectId : null;
      if (!objectId) return;

      const objectRef = db.collection('users').doc(userId).collection('assistantObjects').doc(objectId);
      try {
        await objectRef.set(
          {
            status: 'processing',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      } catch {
        // ignore
      }

      try {
        console.log('assistant job processing', {
          userId,
          jobId: jobDoc.id,
          objectId,
          jobType: claimed.jobType,
          pipelineVersion: claimed.pipelineVersion,
        });

        const metricsRef = assistantMetricsRef(db, userId);

        let processedTextHash: string | null =
          typeof (claimed as any)?.pendingTextHash === 'string' ? String((claimed as any).pendingTextHash) : null;

        let resultCandidates = 0;
        let resultCreated = 0;
        let resultUpdated = 0;
        let resultSkippedProposed = 0;
        let resultSkippedAccepted = 0;

        if (claimed.jobType === 'analyze_intents_v1' || claimed.jobType === 'analyze_intents_v2') {
          const objectSnap = await objectRef.get();
          const objectData = objectSnap.exists ? (objectSnap.data() as any) : null;
          const coreRef = objectData?.coreRef as AssistantCoreRef | undefined;
          const sourceCollection = coreRef?.collection;
          const sourceId = typeof coreRef?.id === 'string' ? coreRef.id : null;

          if ((sourceCollection === 'notes' || sourceCollection === 'todos') && sourceId) {
            const sourceType: 'note' | 'todo' = sourceCollection === 'todos' ? 'todo' : 'note';

            let sourceText = '';
            if (sourceType === 'note') {
              const noteSnap = await db.collection('notes').doc(sourceId).get();
              const note = noteSnap.exists ? (noteSnap.data() as any) : null;
              const noteUserId = typeof note?.userId === 'string' ? note.userId : null;
              if (note && noteUserId === userId) {
                const noteTitle = typeof note?.title === 'string' ? note.title : '';
                const noteContent = typeof note?.content === 'string' ? note.content : '';
                sourceText = `${noteTitle}\n${noteContent}`;
              }
            } else {
              const todoSnap = await db.collection('todos').doc(sourceId).get();
              const todo = todoSnap.exists ? (todoSnap.data() as any) : null;
              const todoUserId = typeof todo?.userId === 'string' ? todo.userId : null;
              if (todo && todoUserId === userId) {
                sourceText = buildTodoAssistantText(todo as { title?: unknown; items?: unknown[] });
              }
            }

            if (sourceText) {
              const [sourceTitle, ...restLines] = sourceText.split('\n');
              const sourceContent = restLines.join('\n');

              const normalized = normalizeAssistantText(sourceText);
              processedTextHash = sha256Hex(normalized);

              let memoryDefaults: AssistantMemoryLiteDefaults | undefined = undefined;
              try {
                const memSnap = await assistantMemoryLiteRef(db, userId).get();
                if (memSnap.exists) {
                  const mem = memSnap.data() as AssistantMemoryLiteDoc;
                  const dp = mem?.defaultPriority;
                  const drh = mem?.defaultReminderHour;
                  memoryDefaults = {
                    ...(dp === 'low' || dp === 'medium' || dp === 'high' ? { defaultPriority: dp } : {}),
                    ...(typeof drh === 'number' && Number.isFinite(drh) ? { defaultReminderHour: Math.trunc(drh) } : {}),
                  };
                }
              } catch {
                // ignore
              }

              const v2 = detectIntentsV2({ title: sourceTitle ?? '', content: sourceContent, now: nowDate, memory: memoryDefaults });
              const detectedSingle = v2.single ? [v2.single] : [];
              const detectedBundle = v2.bundle;

              console.log('assistant intents detected', {
                userId,
                sourceType,
                sourceId,
                objectId,
                hasSingle: detectedSingle.length > 0,
                hasBundle: !!detectedBundle,
              });

              if (detectedSingle.length > 0 || detectedBundle) {
                const suggestionsCol = db.collection('users').doc(userId).collection('assistantSuggestions');
                const expiresAt = admin.firestore.Timestamp.fromMillis(nowDate.getTime() + 14 * 24 * 60 * 60 * 1000);
                const nowServer = admin.firestore.FieldValue.serverTimestamp();

                const candidates: Array<{
                  kind: AssistantSuggestionKind;
                  payload: AssistantSuggestionPayload;
                  dedupeKey: string;
                  rankScore: number;
                  metricsInc: Partial<Record<keyof AssistantMetricsDoc, number>>;
                }> = [];

                if (detectedBundle) {
                  const dedupeKey = buildBundleDedupeKey({ objectId, minimal: detectedBundle.dedupeMinimal });
                  const payload: AssistantSuggestionPayload = {
                    title: detectedBundle.title,
                    tasks: detectedBundle.tasks,
                    bundleMode: detectedBundle.bundleMode,
                    ...(sourceType === 'note' ? { noteId: sourceId } : {}),
                    origin: { fromText: detectedBundle.originFromText },
                    confidence: detectedBundle.confidence,
                    explanation: detectedBundle.explanation,
                  };
                  const rankScore = computeAssistantSuggestionRankScore({
                    jtbdPreset,
                    kind: 'create_task_bundle',
                    sourceType,
                    payload,
                  });
                  candidates.push({
                    kind: 'create_task_bundle',
                    payload,
                    dedupeKey,
                    rankScore,
                    metricsInc: {
                      bundlesCreated: 1,
                      defaultPriorityAppliedCount: detectedBundle.appliedDefaultPriority ? 1 : 0,
                    },
                  });
                } else {
                  for (const d of detectedSingle) {
                    const dedupeKey = buildSuggestionDedupeKey({ objectId, kind: d.kind, minimal: d.dedupeMinimal });
                    const payload: AssistantSuggestionPayload = {
                      title: d.title,
                      ...(d.dueDate ? { dueDate: d.dueDate } : {}),
                      ...(d.remindAt ? { remindAt: d.remindAt } : {}),
                      ...(d.priority ? { priority: d.priority } : {}),
                      origin: {
                        fromText: d.originFromText,
                      },
                      confidence: d.confidence,
                      explanation: d.explanation,
                    };
                    const rankScore = computeAssistantSuggestionRankScore({
                      jtbdPreset,
                      kind: d.kind,
                      sourceType,
                      payload,
                    });
                    candidates.push({
                      kind: d.kind,
                      payload,
                      dedupeKey,
                      rankScore,
                      metricsInc: {
                        suggestionsCreated: 1,
                        defaultPriorityAppliedCount: d.appliedDefaultPriority ? 1 : 0,
                        defaultReminderHourAppliedCount: d.appliedDefaultReminderHour ? 1 : 0,
                      },
                    });
                  }
                }

                console.log('assistant suggestions candidates', {
                  userId,
                  sourceType,
                  sourceId,
                  objectId,
                  candidates: candidates.length,
                  bundleMode: !!detectedBundle ? detectedBundle.bundleMode : null,
                });

                resultCandidates = candidates.length;

                for (const c of candidates) {
                  const sugRef = suggestionsCol.doc(c.dedupeKey);

                  await db.runTransaction(async (tx) => {
                    const existing = await tx.get(sugRef);
                    if (existing.exists) {
                      const st = (existing.data() as any)?.status as AssistantSuggestionStatus | undefined;
                      if (st === 'proposed') {
                        resultSkippedProposed += 1;
                        return;
                      }
                      if (st === 'accepted') {
                        resultSkippedAccepted += 1;
                        return;
                      }

                      tx.update(sugRef, {
                        objectId,
                        source: { type: sourceType, id: sourceId },
                        kind: c.kind,
                        payload: c.payload,
                        rankScore: c.rankScore,
                        rankPreset: jtbdPreset,
                        status: 'proposed',
                        pipelineVersion: 1,
                        dedupeKey: c.dedupeKey,
                        updatedAt: nowServer,
                        expiresAt,
                      });

                      resultUpdated += 1;

                      tx.set(metricsRef, metricsIncrements(c.metricsInc), { merge: true });
                      return;
                    }

                    const doc: AssistantSuggestionDoc = {
                      objectId,
                      source: { type: sourceType, id: sourceId },
                      kind: c.kind,
                      payload: c.payload,
                      rankScore: c.rankScore,
                      rankPreset: jtbdPreset,
                      status: 'proposed',
                      pipelineVersion: 1,
                      dedupeKey: c.dedupeKey,
                      createdAt: nowServer,
                      updatedAt: nowServer,
                      expiresAt,
                    };

                    tx.create(sugRef, doc);
                    resultCreated += 1;
                    tx.set(metricsRef, metricsIncrements(c.metricsInc), { merge: true });
                  });
                }
              }

              await objectRef.set(
                {
                  textHash: processedTextHash,
                },
                { merge: true },
              );
            }
          }
        }

        const objectAfter = await objectRef.get();
        const pendingAfter =
          objectAfter.exists && typeof (objectAfter.data() as any)?.pendingTextHash === 'string'
            ? String((objectAfter.data() as any).pendingTextHash)
            : null;

        if (pendingAfter && (!processedTextHash || pendingAfter !== processedTextHash)) {
          await jobDoc.ref.update({
            status: 'queued',
            lockedUntil: admin.firestore.Timestamp.fromMillis(0),
            pendingTextHash: pendingAfter,
            result: {
              candidates: resultCandidates,
              created: resultCreated,
              updated: resultUpdated,
              skippedProposed: resultSkippedProposed,
              skippedAccepted: resultSkippedAccepted,
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          await objectRef.set(
            {
              status: 'queued',
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        } else {
          await jobDoc.ref.update({
            status: 'done',
            lockedUntil: admin.firestore.Timestamp.fromMillis(0),
            pendingTextHash: null,
            result: {
              candidates: resultCandidates,
              created: resultCreated,
              updated: resultUpdated,
              skippedProposed: resultSkippedProposed,
              skippedAccepted: resultSkippedAccepted,
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          await objectRef.set(
            {
              status: 'done',
              lastAnalyzedAt: admin.firestore.FieldValue.serverTimestamp(),
              pendingTextHash: null,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        }

        try {
          await metricsRef.set(metricsIncrements({ jobsProcessed: 1 }), { merge: true });
        } catch {
          // ignore
        }
      } catch (e) {
        console.error('assistant job failed', {
          userId,
          jobId: jobDoc.id,
          error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e,
        });

        try {
          await jobDoc.ref.update({
            status: 'error',
            lockedUntil: admin.firestore.Timestamp.fromMillis(0),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch {
          // ignore
        }

        try {
          const objectRef = db.collection('users').doc(userId).collection('assistantObjects').doc(objectId);
          await objectRef.set(
            {
              status: 'error',
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        } catch {
          // ignore
        }

        try {
          const metricsRef = assistantMetricsRef(db, userId);
          await metricsRef.set(metricsIncrements({ jobsProcessed: 1, jobErrors: 1 }), { merge: true });
        } catch {
          // ignore
        }
      }
    });

    await Promise.all(tasks);
  });

export const assistantApplySuggestion = functions.https.onCall(async (data, context) => {
  const userId = context.auth?.uid;
  if (!userId) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const suggestionId = typeof (data as any)?.suggestionId === 'string' ? String((data as any).suggestionId) : null;
  if (!suggestionId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing suggestionId.');
  }

  const overrides =
    typeof (data as any)?.overrides === 'object' && (data as any).overrides
      ? ((data as any).overrides as Record<string, unknown>)
      : null;

  const db = admin.firestore();
  const userRef = db.collection('users').doc(userId);
  const suggestionRef = userRef.collection('assistantSuggestions').doc(suggestionId);
  const decisionsCol = userRef.collection('assistantDecisions');
  const metricsRef = assistantMetricsRef(db, userId);
  const memoryLiteRef = assistantMemoryLiteRef(db, userId);

  const decisionRef = decisionsCol.doc();

  const nowTs = admin.firestore.Timestamp.now();

  let decisionId: string | null = null;
  const createdCoreObjects: AssistantDecisionCoreObject[] = [];

  let followupTasks: Array<{ taskId: string; dueDate: admin.firestore.Timestamp | null; hasReminder: boolean }> = [];
  let followupIsPro = false;
  let followupReminderHour: number | null = null;
  let followupEnabled = false;
  let followupObjectId = '';

  await db.runTransaction(async (tx) => {
    createdCoreObjects.length = 0;

    const memoryPriorityUses: Array<'low' | 'medium' | 'high'> = [];
    const memoryReminderHourUses: number[] = [];

    const suggestionSnap = await tx.get(suggestionRef);
    if (!suggestionSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Suggestion not found.');
    }

    const suggestion = suggestionSnap.data() as AssistantSuggestionDoc;
    followupObjectId = typeof suggestion?.objectId === 'string' ? suggestion.objectId : '';

    const [userSnap, memorySnap] = await Promise.all([
      tx.get(userRef),
      tx.get(memoryLiteRef),
    ]);

    const userPlan = userSnap.exists && typeof (userSnap.data() as any)?.plan === 'string' ? String((userSnap.data() as any).plan) : null;
    const isPro = userPlan === 'pro';
    followupIsPro = isPro;
    followupEnabled = suggestion.source.type === 'note' || suggestion.source.type === 'todo';

    const existingMemory = memorySnap.exists ? (memorySnap.data() as AssistantMemoryLiteDoc) : ({} as AssistantMemoryLiteDoc);
    const existingMemoryHourRaw = existingMemory?.defaultReminderHour;
    const existingMemoryHour = typeof existingMemoryHourRaw === 'number' && Number.isFinite(existingMemoryHourRaw) ? Math.trunc(existingMemoryHourRaw) : null;
    followupReminderHour = existingMemoryHour !== null && existingMemoryHour >= 0 && existingMemoryHour <= 23 ? existingMemoryHour : null;

    if (suggestion.status !== 'proposed') {
      throw new functions.https.HttpsError('failed-precondition', 'Suggestion is not proposed.');
    }

    if (!suggestion.expiresAt || suggestion.expiresAt.toMillis() <= nowTs.toMillis()) {
      throw new functions.https.HttpsError('failed-precondition', 'Suggestion expired.');
    }

    const suggestionCreatedAt = (suggestion as any)?.createdAt instanceof admin.firestore.Timestamp ? ((suggestion as any).createdAt as admin.firestore.Timestamp) : null;
    const timeToDecisionMs = suggestionCreatedAt ? Math.max(0, nowTs.toMillis() - suggestionCreatedAt.toMillis()) : null;

    const payload = suggestion.payload as any;
    const baseTitle = typeof payload?.title === 'string' ? payload.title.trim() : '';
    if (!baseTitle) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid payload.title');
    }

    const kind = suggestion.kind;
    const isActionKind = kind === 'create_task' || kind === 'create_reminder' || kind === 'create_task_bundle' || kind === 'update_task_meta';
    const isContentKind = kind === 'generate_summary' || kind === 'rewrite_note' || kind === 'generate_hook' || kind === 'extract_key_points' || kind === 'tag_entities';
    if (!isActionKind && !isContentKind) {
      throw new functions.https.HttpsError('invalid-argument', 'Unknown suggestion kind.');
    }

    const overridesRaw = overrides && typeof overrides === 'object' ? (overrides as Record<string, unknown>) : null;

    if (overrides && kind !== 'create_task_bundle') {
      if (kind === 'update_task_meta') {
        throw new functions.https.HttpsError('invalid-argument', 'overrides not supported for this suggestion kind.');
      }
      if (isContentKind) {
        throw new functions.https.HttpsError('invalid-argument', 'overrides not supported for this suggestion kind.');
      }
      const allowed = kind === 'create_task' ? new Set(['title', 'dueDate', 'priority']) : new Set(['title', 'remindAt', 'priority']);
      for (const key of Object.keys(overrides)) {
        if (!allowed.has(key)) {
          throw new functions.https.HttpsError('invalid-argument', `Invalid overrides key: ${key}`);
        }
      }
    }

    const priority = payload?.priority;
    const basePriorityValue: 'low' | 'medium' | 'high' | null =
      priority === 'low' || priority === 'medium' || priority === 'high' ? priority : null;

    const baseDueDate = payload?.dueDate instanceof admin.firestore.Timestamp ? (payload.dueDate as admin.firestore.Timestamp) : null;
    const baseRemindAt = payload?.remindAt instanceof admin.firestore.Timestamp ? (payload.remindAt as admin.firestore.Timestamp) : null;

    const parseOverrideTimestamp = (value: unknown): admin.firestore.Timestamp | null => {
      if (value === null) return null;
      if (typeof value === 'number' && Number.isFinite(value)) {
        return admin.firestore.Timestamp.fromMillis(value);
      }
      if (typeof value === 'object' && value) {
        const candidate = value as { seconds?: unknown; nanoseconds?: unknown; _seconds?: unknown; _nanoseconds?: unknown };
        const seconds = typeof candidate.seconds === 'number' ? candidate.seconds : typeof candidate._seconds === 'number' ? candidate._seconds : null;
        const nanos = typeof candidate.nanoseconds === 'number' ? candidate.nanoseconds : typeof candidate._nanoseconds === 'number' ? candidate._nanoseconds : 0;
        if (seconds !== null && Number.isFinite(seconds) && Number.isFinite(nanos)) {
          return new admin.firestore.Timestamp(seconds, nanos);
        }
      }
      throw new functions.https.HttpsError('invalid-argument', 'Invalid overrides timestamp value.');
    };

    const overrideTitleRaw = overrides ? overrides.title : undefined;
    const overrideTitle =
      typeof overrideTitleRaw === 'undefined'
        ? undefined
        : typeof overrideTitleRaw === 'string'
          ? overrideTitleRaw.trim()
          : null;
    if (overrideTitle === '') {
      throw new functions.https.HttpsError('invalid-argument', 'overrides.title cannot be empty.');
    }
    if (overrideTitle === null) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid overrides.title');
    }

    const overridePriorityRaw = overrides ? overrides.priority : undefined;
    const overridePriorityValue: 'low' | 'medium' | 'high' | null | undefined =
      typeof overridePriorityRaw === 'undefined'
        ? undefined
        : overridePriorityRaw === null
          ? null
          : overridePriorityRaw === 'low' || overridePriorityRaw === 'medium' || overridePriorityRaw === 'high'
            ? (overridePriorityRaw as 'low' | 'medium' | 'high')
            : null;
    if (
      typeof overridePriorityRaw !== 'undefined' &&
      overridePriorityRaw !== null &&
      overridePriorityRaw !== 'low' &&
      overridePriorityRaw !== 'medium' &&
      overridePriorityRaw !== 'high'
    ) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid overrides.priority');
    }

    const overrideDueDate = overrides && Object.prototype.hasOwnProperty.call(overrides, 'dueDate') ? parseOverrideTimestamp(overrides.dueDate) : undefined;
    const overrideRemindAt = overrides && Object.prototype.hasOwnProperty.call(overrides, 'remindAt') ? parseOverrideTimestamp(overrides.remindAt) : undefined;

    const finalTitle = typeof overrideTitle === 'string' ? overrideTitle : baseTitle;
    const finalDueDate = typeof overrideDueDate === 'undefined' ? baseDueDate : overrideDueDate;
    const finalRemindAt = typeof overrideRemindAt === 'undefined' ? baseRemindAt : overrideRemindAt;
    const finalPriorityValue = typeof overridePriorityValue === 'undefined' ? basePriorityValue : overridePriorityValue;

    const isEdited =
      (typeof overrideTitle !== 'undefined' && overrideTitle !== baseTitle) ||
      (typeof overrideDueDate !== 'undefined' && (overrideDueDate?.toMillis?.() ?? null) !== (baseDueDate?.toMillis?.() ?? null)) ||
      (typeof overrideRemindAt !== 'undefined' && (overrideRemindAt?.toMillis?.() ?? null) !== (baseRemindAt?.toMillis?.() ?? null)) ||
      (typeof overridePriorityValue !== 'undefined' && overridePriorityValue !== basePriorityValue);

    if (kind === 'create_reminder' && !finalRemindAt) {
      const taskId = typeof payload?.taskId === 'string' ? String(payload.taskId) : null;
      const isTaskFollowup = (suggestion.source as any)?.type === 'task' && typeof (suggestion.source as any)?.id === 'string';
      if (!taskId && !isTaskFollowup) {
        throw new functions.https.HttpsError('invalid-argument', 'remindAt is required for reminders.');
      }
    }

    if (kind === 'update_task_meta') {
      const createdAt = admin.firestore.FieldValue.serverTimestamp();
      const updatedAt = admin.firestore.FieldValue.serverTimestamp();

      const taskId = typeof payload?.taskId === 'string' ? String(payload.taskId) : null;
      if (!taskId) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid payload.taskId');
      }
      const favoriteRaw = (payload as any)?.favorite;
      if (typeof favoriteRaw !== 'boolean') {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid payload.favorite');
      }

      const taskRef = db.collection('tasks').doc(taskId);
      const taskSnap = await tx.get(taskRef);
      if (!taskSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Task not found.');
      }
      const taskData = taskSnap.data() as any;
      if (typeof taskData?.userId !== 'string' || taskData.userId !== userId) {
        throw new functions.https.HttpsError('permission-denied', 'Task does not belong to user.');
      }

      tx.update(taskRef, {
        favorite: favoriteRaw,
        updatedAt,
      });

      createdCoreObjects.push({ type: 'task', id: taskId });

      decisionId = decisionRef.id;
      const beforePayload = suggestion.payload as AssistantSuggestionDoc['payload'];
      const decisionDoc: AssistantDecisionDoc = {
        suggestionId,
        objectId: suggestion.objectId,
        action: 'accepted',
        createdCoreObjects: [...createdCoreObjects],
        beforePayload,
        pipelineVersion: 1,
        createdAt,
        updatedAt,
      };
      tx.create(decisionRef, decisionDoc);

      tx.set(
        metricsRef,
        metricsIncrements({
          suggestionsAccepted: 1,
          followupSuggestionsAccepted: suggestion.source.type === 'task' ? 1 : 0,
          decisionsCount: 1,
          totalTimeToDecisionMs: timeToDecisionMs ? timeToDecisionMs : 0,
        }),
        { merge: true },
      );

      tx.update(suggestionRef, {
        status: 'accepted',
        updatedAt,
      });

      return;
    }

    const beforePayload = suggestion.payload as AssistantSuggestionDoc['payload'];
    const finalPayload = (() => {
      if (!isEdited) return null;
      const next: any = { ...(beforePayload as any) };
      next.title = finalTitle;
      if (finalDueDate) next.dueDate = finalDueDate;
      else delete next.dueDate;
      if (finalRemindAt) next.remindAt = finalRemindAt;
      else delete next.remindAt;
      if (finalPriorityValue) next.priority = finalPriorityValue;
      else delete next.priority;
      return next as AssistantSuggestionDoc['payload'];
    })();

    const createdAt = admin.firestore.FieldValue.serverTimestamp();
    const updatedAt = admin.firestore.FieldValue.serverTimestamp();

    if (isContentKind) {
      decisionId = decisionRef.id;

      const decisionDoc: AssistantDecisionDoc = {
        suggestionId,
        objectId: suggestion.objectId,
        action: 'accepted',
        createdCoreObjects: [],
        beforePayload,
        finalPayload: beforePayload,
        pipelineVersion: 1,
        createdAt,
        updatedAt,
      };
      tx.create(decisionRef, decisionDoc);

      tx.set(
        metricsRef,
        metricsIncrements({
          suggestionsAccepted: 1,
          decisionsCount: 1,
          totalTimeToDecisionMs: timeToDecisionMs ? timeToDecisionMs : 0,
        }),
        { merge: true },
      );

      tx.update(suggestionRef, {
        status: 'accepted',
        updatedAt,
      });

      return;
    }

    if (kind === 'create_task_bundle') {
      if (!isPro) {
        throw new functions.https.HttpsError('failed-precondition', 'Plan pro requis pour accepter un plan d’action.');
      }

      const tasks = Array.isArray(payload?.tasks) ? (payload.tasks as any[]) : null;
      if (!tasks || tasks.length < 2) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid payload.tasks');
      }

      const limitedOriginal = tasks.slice(0, 6);
      const originalCount = limitedOriginal.length;

      const selectedIndexesRaw = overridesRaw && Array.isArray((overridesRaw as any).selectedIndexes) ? ((overridesRaw as any).selectedIndexes as unknown[]) : null;
      const selectedIndexes = (selectedIndexesRaw ?? limitedOriginal.map((_, idx) => idx))
        .map((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : NaN))
        .filter((v) => Number.isFinite(v));

      const selectedUnique: number[] = [];
      const selectedSet = new Set<number>();
      for (const i of selectedIndexes) {
        if (i < 0 || i >= originalCount) {
          throw new functions.https.HttpsError('invalid-argument', 'Invalid selectedIndexes.');
        }
        if (selectedSet.has(i)) continue;
        selectedSet.add(i);
        selectedUnique.push(i);
      }

      if (selectedUnique.length === 0) {
        throw new functions.https.HttpsError('failed-precondition', 'At least one item must be selected.');
      }

      const tasksOverridesRaw = overridesRaw && typeof (overridesRaw as any).tasksOverrides === 'object' && (overridesRaw as any).tasksOverrides ? ((overridesRaw as any).tasksOverrides as Record<string, any>) : null;
      if (tasksOverridesRaw) {
        for (const k of Object.keys(tasksOverridesRaw)) {
          const idx = Number(k);
          if (!Number.isFinite(idx) || Math.trunc(idx) !== idx || idx < 0 || idx >= originalCount) {
            throw new functions.https.HttpsError('invalid-argument', 'Invalid tasksOverrides index.');
          }
        }
      }

      const tasksCol = db.collection('tasks');
      const reminderCol = db.collection('taskReminders');

      const finalTasks: AssistantTaskBundleTask[] = [];
      const createdTaskInfos: Array<{ taskId: string; dueDate: admin.firestore.Timestamp | null; hasReminder: boolean }> = [];
      let anyEdit = selectedUnique.length !== originalCount;

      for (const i of selectedUnique) {
        const t = limitedOriginal[i];
        const baseTaskTitle = typeof t?.title === 'string' ? String(t.title).trim() : '';
        const baseTaskDue = t?.dueDate instanceof admin.firestore.Timestamp ? (t.dueDate as admin.firestore.Timestamp) : null;
        const baseTaskRemind = t?.remindAt instanceof admin.firestore.Timestamp ? (t.remindAt as admin.firestore.Timestamp) : null;
        const baseTaskPriority: 'low' | 'medium' | 'high' | null =
          t?.priority === 'low' || t?.priority === 'medium' || t?.priority === 'high' ? (t.priority as any) : null;
        const baseTaskOrigin = t?.origin && typeof t?.origin === 'object' ? t.origin : undefined;

        const o = tasksOverridesRaw ? tasksOverridesRaw[String(i)] : null;
        const nextTitleRaw = typeof o?.title === 'string' ? String(o.title).trim() : null;
        const nextTitle = nextTitleRaw !== null ? nextTitleRaw : baseTaskTitle;
        if (!nextTitle) {
          throw new functions.https.HttpsError('invalid-argument', 'Task title cannot be empty.');
        }

        const overrideDue = o && Object.prototype.hasOwnProperty.call(o, 'dueDate') ? parseOverrideTimestamp(o.dueDate) : undefined;
        const overrideRemind = o && Object.prototype.hasOwnProperty.call(o, 'remindAt') ? parseOverrideTimestamp(o.remindAt) : undefined;
        const nextDue = typeof overrideDue === 'undefined' ? baseTaskDue : overrideDue;
        const nextRemind = typeof overrideRemind === 'undefined' ? baseTaskRemind : overrideRemind;

        const nextPriorityRaw = o?.priority;
        const nextPriority: 'low' | 'medium' | 'high' | null =
          typeof nextPriorityRaw === 'undefined'
            ? baseTaskPriority
            : nextPriorityRaw === null
              ? null
              : nextPriorityRaw === 'low' || nextPriorityRaw === 'medium' || nextPriorityRaw === 'high'
                ? (nextPriorityRaw as any)
                : null;
        if (typeof nextPriorityRaw !== 'undefined' && nextPriorityRaw !== null && nextPriority === null) {
          throw new functions.https.HttpsError('invalid-argument', 'Invalid task priority.');
        }

        if (nextTitle !== baseTaskTitle) anyEdit = true;
        if ((nextDue?.toMillis?.() ?? null) !== (baseTaskDue?.toMillis?.() ?? null)) anyEdit = true;
        if ((nextRemind?.toMillis?.() ?? null) !== (baseTaskRemind?.toMillis?.() ?? null)) anyEdit = true;
        if (nextPriority !== baseTaskPriority) anyEdit = true;

        const taskRef = tasksCol.doc();
        const effectiveDue = nextRemind ?? nextDue;
        tx.create(taskRef, {
          userId,
          title: nextTitle,
          status: 'todo',
          workspaceId: null,
          startDate: null,
          dueDate: effectiveDue,
          priority: nextPriority,
          favorite: false,
          archived: false,
          source: {
            assistant: true,
            suggestionId,
            objectId: suggestion.objectId,
          },
          createdAt,
          updatedAt,
        });
        createdCoreObjects.push({ type: 'task', id: taskRef.id });
        createdTaskInfos.push({ taskId: taskRef.id, dueDate: nextDue, hasReminder: !!nextRemind });

        if (nextPriority) {
          memoryPriorityUses.push(nextPriority);
        }
        if (nextRemind) {
          const h = nextRemind.toDate().getHours();
          if (Number.isFinite(h) && h >= 0 && h <= 23) memoryReminderHourUses.push(h);
        }

        if (nextRemind) {
          const remindAtIso = nextRemind.toDate().toISOString();
          const reminderRef = reminderCol.doc();
          tx.create(reminderRef, {
            userId,
            taskId: taskRef.id,
            dueDate: remindAtIso,
            reminderTime: remindAtIso,
            sent: false,
            createdAt,
            updatedAt,
            source: {
              assistant: true,
              suggestionId,
              objectId: suggestion.objectId,
            },
          });
          createdCoreObjects.push({ type: 'taskReminder', id: reminderRef.id });
        }

        finalTasks.push({
          title: nextTitle,
          ...(nextDue ? { dueDate: nextDue } : {}),
          ...(nextRemind ? { remindAt: nextRemind } : {}),
          ...(nextPriority ? { priority: nextPriority } : {}),
          ...(baseTaskOrigin ? { origin: baseTaskOrigin } : {}),
        });
      }

      if (createdCoreObjects.length < 2) {
        throw new functions.https.HttpsError('failed-precondition', 'No valid tasks to create.');
      }

      followupTasks = createdTaskInfos.map((t) => ({ taskId: t.taskId, dueDate: t.dueDate, hasReminder: t.hasReminder }));

      const beforePayload = suggestion.payload as AssistantSuggestionDoc['payload'];
      const finalPayload: AssistantSuggestionDoc['payload'] = {
        ...(beforePayload as any),
        tasks: finalTasks,
        selectedIndexes: selectedUnique,
      };

      decisionId = decisionRef.id;
      const decisionDoc: AssistantDecisionDoc = {
        suggestionId,
        objectId: suggestion.objectId,
        action: anyEdit ? 'edited_then_accepted' : 'accepted',
        createdCoreObjects: [...createdCoreObjects],
        beforePayload,
        finalPayload,
        pipelineVersion: 1,
        createdAt,
        updatedAt,
      };
      tx.create(decisionRef, decisionDoc);

      const itemsDeselected = originalCount - selectedUnique.length;
      tx.set(
        metricsRef,
        metricsIncrements({
          bundlesAccepted: anyEdit ? 0 : 1,
          bundlesEditedAccepted: anyEdit ? 1 : 0,
          tasksCreatedViaBundle: finalTasks.length,
          bundleItemsCreated: finalTasks.length,
          bundleItemsDeselected: itemsDeselected,
          decisionsCount: 1,
          totalTimeToDecisionMs: timeToDecisionMs ? timeToDecisionMs : 0,
        }),
        { merge: true },
      );

      if (memoryPriorityUses.length > 0 || memoryReminderHourUses.length > 0) {
        const existing = existingMemory;
        const prevPriorityCounts = existing?.stats?.priorityCounts;
        const nextPriorityCounts: { low: number; medium: number; high: number } = {
          low: typeof prevPriorityCounts?.low === 'number' && Number.isFinite(prevPriorityCounts.low) ? prevPriorityCounts.low : 0,
          medium: typeof prevPriorityCounts?.medium === 'number' && Number.isFinite(prevPriorityCounts.medium) ? prevPriorityCounts.medium : 0,
          high: typeof prevPriorityCounts?.high === 'number' && Number.isFinite(prevPriorityCounts.high) ? prevPriorityCounts.high : 0,
        };

        const prevReminderCounts = existing?.stats?.reminderHourCounts;
        const nextReminderCounts: Record<string, number> = { ...(prevReminderCounts && typeof prevReminderCounts === 'object' ? prevReminderCounts : {}) };

        let changed = false;

        for (const p of memoryPriorityUses) {
          nextPriorityCounts[p] = (nextPriorityCounts[p] ?? 0) + 1;
          changed = true;
        }

        for (const hour of memoryReminderHourUses) {
          const k = String(hour);
          const prev = typeof nextReminderCounts[k] === 'number' && Number.isFinite(nextReminderCounts[k]) ? nextReminderCounts[k] : 0;
          nextReminderCounts[k] = prev + 1;
          changed = true;
        }

        const totalP = nextPriorityCounts.low + nextPriorityCounts.medium + nextPriorityCounts.high;
        const topP: { p: 'low' | 'medium' | 'high'; c: number } =
          nextPriorityCounts.high >= nextPriorityCounts.medium && nextPriorityCounts.high >= nextPriorityCounts.low
            ? { p: 'high', c: nextPriorityCounts.high }
            : nextPriorityCounts.medium >= nextPriorityCounts.low
              ? { p: 'medium', c: nextPriorityCounts.medium }
              : { p: 'low', c: nextPriorityCounts.low };
        const nextDefaultPriority = totalP >= 5 && topP.c / totalP > 0.6 ? topP.p : existing?.defaultPriority;
        if (typeof nextDefaultPriority !== 'undefined' && nextDefaultPriority !== existing?.defaultPriority) {
          changed = true;
        }

        let nextDefaultReminderHour: number | undefined = existing?.defaultReminderHour;
        const reminderEntries = Object.entries(nextReminderCounts)
          .map(([k, v]) => ({ hour: Number(k), count: v }))
          .filter((x) => Number.isFinite(x.hour) && x.hour >= 0 && x.hour <= 23 && typeof x.count === 'number' && Number.isFinite(x.count));
        const totalR = reminderEntries.reduce((acc, x) => acc + x.count, 0);
        if (totalR >= 5) {
          reminderEntries.sort((a, b) => b.count - a.count);
          const top = reminderEntries[0];
          if (top && top.count / totalR > 0.6) {
            nextDefaultReminderHour = top.hour;
          }
        }
        if (typeof nextDefaultReminderHour !== 'undefined' && nextDefaultReminderHour !== existing?.defaultReminderHour) {
          changed = true;
        }

        if (typeof nextDefaultReminderHour === 'number' && Number.isFinite(nextDefaultReminderHour)) {
          const h = Math.trunc(nextDefaultReminderHour);
          if (h >= 0 && h <= 23) followupReminderHour = h;
        }

        if (changed) {
          tx.set(
            memoryLiteRef,
            {
              ...(typeof nextDefaultPriority !== 'undefined' ? { defaultPriority: nextDefaultPriority } : {}),
              ...(typeof nextDefaultReminderHour !== 'undefined' ? { defaultReminderHour: nextDefaultReminderHour } : {}),
              stats: {
                priorityCounts: nextPriorityCounts,
                reminderHourCounts: nextReminderCounts,
              },
              updatedAt,
            } satisfies AssistantMemoryLiteDoc,
            { merge: true },
          );

          tx.set(metricsRef, metricsIncrements({ memoryUpdatesCount: 1 }), { merge: true });
        }
      }

      tx.update(suggestionRef, {
        status: 'accepted',
        updatedAt,
      });
      return;
    } else {
      const isTaskFollowup = suggestion.source.type === 'task';

      if (kind === 'create_reminder' && isTaskFollowup) {
        const taskId = typeof payload?.taskId === 'string' ? String(payload.taskId) : suggestion.source.id;
        if (!taskId) {
          throw new functions.https.HttpsError('invalid-argument', 'Invalid payload.taskId');
        }
        if (!finalRemindAt) {
          throw new functions.https.HttpsError('invalid-argument', 'remindAt is required for reminders.');
        }
        if (!isPro) {
          throw new functions.https.HttpsError('failed-precondition', 'Plan pro requis pour créer un rappel.');
        }

        const taskRef = db.collection('tasks').doc(taskId);
        const taskSnap = await tx.get(taskRef);
        if (!taskSnap.exists) {
          throw new functions.https.HttpsError('not-found', 'Task not found.');
        }
        const taskData = taskSnap.data() as any;
        if (typeof taskData?.userId !== 'string' || taskData.userId !== userId) {
          throw new functions.https.HttpsError('permission-denied', 'Task does not belong to user.');
        }

        const h = finalRemindAt.toDate().getHours();
        if (Number.isFinite(h) && h >= 0 && h <= 23) memoryReminderHourUses.push(h);

        const remindAtIso = finalRemindAt.toDate().toISOString();
        const reminderRef = db.collection('taskReminders').doc();
        tx.create(reminderRef, {
          userId,
          taskId,
          dueDate: remindAtIso,
          reminderTime: remindAtIso,
          sent: false,
          createdAt,
          updatedAt,
          source: {
            assistant: true,
            suggestionId,
            objectId: suggestion.objectId,
          },
        });

        createdCoreObjects.push({ type: 'task', id: taskId });
        createdCoreObjects.push({ type: 'taskReminder', id: reminderRef.id });
      } else {
        const effectiveTaskDue = kind === 'create_reminder' ? finalRemindAt ?? finalDueDate : finalDueDate;
        const taskRef = db.collection('tasks').doc();
        tx.create(taskRef, {
          userId,
          title: finalTitle,
          status: 'todo',
          workspaceId: null,
          startDate: null,
          dueDate: effectiveTaskDue,
          priority: finalPriorityValue,
          favorite: false,
          archived: false,
          source: {
            assistant: true,
            suggestionId,
            objectId: suggestion.objectId,
          },
          createdAt,
          updatedAt,
        });

        createdCoreObjects.push({ type: 'task', id: taskRef.id });

        if (finalPriorityValue) {
          memoryPriorityUses.push(finalPriorityValue);
        }
        if (finalRemindAt) {
          const h = finalRemindAt.toDate().getHours();
          if (Number.isFinite(h) && h >= 0 && h <= 23) memoryReminderHourUses.push(h);
        }

        let hasReminder = false;
        if (kind === 'create_reminder') {
          if (!isPro) {
            throw new functions.https.HttpsError('failed-precondition', 'Plan pro requis pour créer un rappel.');
          }

          const remindAtIso = finalRemindAt!.toDate().toISOString();

          const reminderRef = db.collection('taskReminders').doc();
          tx.create(reminderRef, {
            userId,
            taskId: taskRef.id,
            dueDate: remindAtIso,
            reminderTime: remindAtIso,
            sent: false,
            createdAt,
            updatedAt,
            source: {
              assistant: true,
              suggestionId,
              objectId: suggestion.objectId,
            },
          });

          createdCoreObjects.push({ type: 'taskReminder', id: reminderRef.id });
          hasReminder = true;
        }

        followupTasks = [{ taskId: taskRef.id, dueDate: finalDueDate ?? null, hasReminder }];

      }
    }

    decisionId = decisionRef.id;

    const decisionDoc: AssistantDecisionDoc = {
      suggestionId,
      objectId: suggestion.objectId,
      action: isEdited ? 'edited_then_accepted' : 'accepted',
      createdCoreObjects: [...createdCoreObjects],
      beforePayload,
      finalPayload: finalPayload ?? undefined,
      pipelineVersion: 1,
      createdAt,
      updatedAt,
    };

    tx.create(decisionRef, decisionDoc);

    tx.set(
      metricsRef,
      metricsIncrements(
        {
          suggestionsAccepted: isEdited ? 0 : 1,
          suggestionsEditedAccepted: isEdited ? 1 : 0,
          followupSuggestionsAccepted: suggestion.source.type === 'task' ? 1 : 0,
          decisionsCount: 1,
          totalTimeToDecisionMs: timeToDecisionMs ? timeToDecisionMs : 0,
        },
      ),
      { merge: true },
    );

    if (memoryPriorityUses.length > 0 || memoryReminderHourUses.length > 0) {
      const existing = existingMemory;
      const prevPriorityCounts = existing?.stats?.priorityCounts;
      const nextPriorityCounts: { low: number; medium: number; high: number } = {
        low: typeof prevPriorityCounts?.low === 'number' && Number.isFinite(prevPriorityCounts.low) ? prevPriorityCounts.low : 0,
        medium: typeof prevPriorityCounts?.medium === 'number' && Number.isFinite(prevPriorityCounts.medium) ? prevPriorityCounts.medium : 0,
        high: typeof prevPriorityCounts?.high === 'number' && Number.isFinite(prevPriorityCounts.high) ? prevPriorityCounts.high : 0,
      };

      const prevReminderCounts = existing?.stats?.reminderHourCounts;
      const nextReminderCounts: Record<string, number> = { ...(prevReminderCounts && typeof prevReminderCounts === 'object' ? prevReminderCounts : {}) };

      let changed = false;

      for (const p of memoryPriorityUses) {
        nextPriorityCounts[p] = (nextPriorityCounts[p] ?? 0) + 1;
        changed = true;
      }

      for (const hour of memoryReminderHourUses) {
        const k = String(hour);
        const prev = typeof nextReminderCounts[k] === 'number' && Number.isFinite(nextReminderCounts[k]) ? nextReminderCounts[k] : 0;
        nextReminderCounts[k] = prev + 1;
        changed = true;
      }

      const totalP = nextPriorityCounts.low + nextPriorityCounts.medium + nextPriorityCounts.high;
      const topP: { p: 'low' | 'medium' | 'high'; c: number } =
        nextPriorityCounts.high >= nextPriorityCounts.medium && nextPriorityCounts.high >= nextPriorityCounts.low
          ? { p: 'high', c: nextPriorityCounts.high }
          : nextPriorityCounts.medium >= nextPriorityCounts.low
            ? { p: 'medium', c: nextPriorityCounts.medium }
            : { p: 'low', c: nextPriorityCounts.low };
      const nextDefaultPriority = totalP >= 5 && topP.c / totalP > 0.6 ? topP.p : existing?.defaultPriority;
      if (typeof nextDefaultPriority !== 'undefined' && nextDefaultPriority !== existing?.defaultPriority) {
        changed = true;
      }

      let nextDefaultReminderHour: number | undefined = existing?.defaultReminderHour;
      const reminderEntries = Object.entries(nextReminderCounts)
        .map(([k, v]) => ({ hour: Number(k), count: v }))
        .filter((x) => Number.isFinite(x.hour) && x.hour >= 0 && x.hour <= 23 && typeof x.count === 'number' && Number.isFinite(x.count));
      const totalR = reminderEntries.reduce((acc, x) => acc + x.count, 0);
      if (totalR >= 5) {
        reminderEntries.sort((a, b) => b.count - a.count);
        const top = reminderEntries[0];
        if (top && top.count / totalR > 0.6) {
          nextDefaultReminderHour = top.hour;
        }
      }
      if (typeof nextDefaultReminderHour !== 'undefined' && nextDefaultReminderHour !== existing?.defaultReminderHour) {
        changed = true;
      }

      if (typeof nextDefaultReminderHour === 'number' && Number.isFinite(nextDefaultReminderHour)) {
        const h = Math.trunc(nextDefaultReminderHour);
        if (h >= 0 && h <= 23) followupReminderHour = h;
      }

      if (changed) {
        tx.set(
          memoryLiteRef,
          {
            ...(typeof nextDefaultPriority !== 'undefined' ? { defaultPriority: nextDefaultPriority } : {}),
            ...(typeof nextDefaultReminderHour !== 'undefined' ? { defaultReminderHour: nextDefaultReminderHour } : {}),
            stats: {
              priorityCounts: nextPriorityCounts,
              reminderHourCounts: nextReminderCounts,
            },
            updatedAt,
          } satisfies AssistantMemoryLiteDoc,
          { merge: true },
        );

        tx.set(metricsRef, metricsIncrements({ memoryUpdatesCount: 1 }), { merge: true });
      }
    }

    tx.update(suggestionRef, {
      status: 'accepted',
      updatedAt,
    });
  });

  if (followupEnabled && followupTasks.length > 0) {
    if (!followupObjectId) {
      throw new functions.https.HttpsError('internal', 'Missing followup objectId.');
    }

    const suggestionsCol = userRef.collection('assistantSuggestions');
    const expiresAt = admin.firestore.Timestamp.fromMillis(nowTs.toMillis() + 14 * 24 * 60 * 60 * 1000);

    const createFavorite = async (taskId: string) => {
      const favoriteKey = buildFollowupDedupeKey({
        taskId,
        kind: 'update_task_meta',
        minimal: { favorite: true },
      });
      const favoriteRef = suggestionsCol.doc(favoriteKey);

      await db.runTransaction(async (tx) => {
        const existing = await tx.get(favoriteRef);
        const status = existing.exists ? ((existing.data() as any)?.status as AssistantSuggestionStatus | undefined) : undefined;
        const updatedAtExisting = existing.exists ? ((existing.data() as any)?.updatedAt as admin.firestore.Timestamp | null) : null;
        const rejectedTooRecent =
          status === 'rejected' && updatedAtExisting instanceof admin.firestore.Timestamp
            ? nowTs.toMillis() - updatedAtExisting.toMillis() < ASSISTANT_FOLLOWUP_REJECT_COOLDOWN_MS
            : false;

        const createdAt = admin.firestore.FieldValue.serverTimestamp();
        const updatedAt = admin.firestore.FieldValue.serverTimestamp();

        if (!existing.exists) {
          const doc: AssistantSuggestionDoc = {
            objectId: followupObjectId,
            source: { type: 'task', id: taskId, fromSuggestionId: suggestionId },
            kind: 'update_task_meta',
            payload: {
              title: 'Marquer cette tâche comme favorite ?',
              taskId,
              favorite: true,
              origin: { fromText: 'follow-up' },
              confidence: 0.9,
              explanation: 'Suggestion de suivi (optionnelle).',
            },
            status: 'proposed',
            pipelineVersion: 1,
            dedupeKey: favoriteKey,
            createdAt,
            updatedAt,
            expiresAt,
          };
          tx.create(favoriteRef, doc);
          tx.set(metricsRef, metricsIncrements({ followupSuggestionsCreated: 1 }), { merge: true });
          return;
        }

        if (status !== 'proposed' && status !== 'accepted' && !rejectedTooRecent) {
          tx.update(favoriteRef, {
            objectId: followupObjectId,
            source: { type: 'task', id: taskId, fromSuggestionId: suggestionId },
            kind: 'update_task_meta',
            payload: {
              title: 'Marquer cette tâche comme favorite ?',
              taskId,
              favorite: true,
              origin: { fromText: 'follow-up' },
              confidence: 0.9,
              explanation: 'Suggestion de suivi (optionnelle).',
            },
            status: 'proposed',
            pipelineVersion: 1,
            dedupeKey: favoriteKey,
            updatedAt,
            expiresAt,
          });
          tx.set(metricsRef, metricsIncrements({ followupSuggestionsCreated: 1 }), { merge: true });
        }
      });
    };

    const createReminder = async (params: { taskId: string; dueDate: admin.firestore.Timestamp }) => {
      if (!followupIsPro) return;
      if (followupReminderHour === null) return;

      const due = params.dueDate.toDate();
      const remind = new Date(due.getTime());
      remind.setDate(remind.getDate() - 1);
      remind.setHours(followupReminderHour, 0, 0, 0);
      if (!Number.isFinite(remind.getTime()) || remind.getTime() <= nowTs.toMillis()) return;

      const remindAt = admin.firestore.Timestamp.fromDate(remind);
      const reminderKey = buildFollowupDedupeKey({
        taskId: params.taskId,
        kind: 'create_reminder',
        minimal: { remindAtMs: remindAt.toMillis() },
      });
      const reminderRef = suggestionsCol.doc(reminderKey);

      await db.runTransaction(async (tx) => {
        const existing = await tx.get(reminderRef);
        const status = existing.exists ? ((existing.data() as any)?.status as AssistantSuggestionStatus | undefined) : undefined;
        const updatedAtExisting = existing.exists ? ((existing.data() as any)?.updatedAt as admin.firestore.Timestamp | null) : null;
        const rejectedTooRecent =
          status === 'rejected' && updatedAtExisting instanceof admin.firestore.Timestamp
            ? nowTs.toMillis() - updatedAtExisting.toMillis() < ASSISTANT_FOLLOWUP_REJECT_COOLDOWN_MS
            : false;

        const createdAt = admin.firestore.FieldValue.serverTimestamp();
        const updatedAt = admin.firestore.FieldValue.serverTimestamp();

        const title = `Ajouter un rappel la veille à ${followupReminderHour}h ?`;

        if (!existing.exists) {
          const doc: AssistantSuggestionDoc = {
            objectId: followupObjectId,
            source: { type: 'task', id: params.taskId, fromSuggestionId: suggestionId },
            kind: 'create_reminder',
            payload: {
              title,
              taskId: params.taskId,
              remindAt,
              origin: { fromText: 'follow-up' },
              confidence: 0.9,
              explanation: 'Suggestion de suivi (optionnelle).',
            },
            status: 'proposed',
            pipelineVersion: 1,
            dedupeKey: reminderKey,
            createdAt,
            updatedAt,
            expiresAt,
          };
          tx.create(reminderRef, doc);
          tx.set(metricsRef, metricsIncrements({ followupSuggestionsCreated: 1 }), { merge: true });
          return;
        }

        if (status !== 'proposed' && status !== 'accepted' && !rejectedTooRecent) {
          tx.update(reminderRef, {
            objectId: followupObjectId,
            source: { type: 'task', id: params.taskId, fromSuggestionId: suggestionId },
            kind: 'create_reminder',
            payload: {
              title,
              taskId: params.taskId,
              remindAt,
              origin: { fromText: 'follow-up' },
              confidence: 0.9,
              explanation: 'Suggestion de suivi (optionnelle).',
            },
            status: 'proposed',
            pipelineVersion: 1,
            dedupeKey: reminderKey,
            updatedAt,
            expiresAt,
          });
          tx.set(metricsRef, metricsIncrements({ followupSuggestionsCreated: 1 }), { merge: true });
        }
      });
    };

    await Promise.all(
      followupTasks.flatMap((t) => {
        const ops: Array<Promise<void>> = [createFavorite(t.taskId)];
        if (t.dueDate && !t.hasReminder) {
          ops.push(createReminder({ taskId: t.taskId, dueDate: t.dueDate }));
        }
        return ops;
      }),
    );
  }

  return {
    createdCoreObjects,
    decisionId,
  };
});

export const assistantRejectSuggestion = functions.https.onCall(async (data, context) => {
  const userId = context.auth?.uid;
  if (!userId) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const suggestionId = typeof (data as any)?.suggestionId === 'string' ? String((data as any).suggestionId) : null;
  if (!suggestionId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing suggestionId.');
  }

  const db = admin.firestore();
  const userRef = db.collection('users').doc(userId);
  const suggestionRef = userRef.collection('assistantSuggestions').doc(suggestionId);
  const decisionsCol = userRef.collection('assistantDecisions');
  const metricsRef = assistantMetricsRef(db, userId);

  const decisionRef = decisionsCol.doc();

  let decisionId: string | null = null;

  await db.runTransaction(async (tx) => {
    const suggestionSnap = await tx.get(suggestionRef);
    if (!suggestionSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Suggestion not found.');
    }

    const suggestion = suggestionSnap.data() as AssistantSuggestionDoc;
    if (suggestion.status !== 'proposed') {
      throw new functions.https.HttpsError('failed-precondition', 'Suggestion is not proposed.');
    }

    const nowTs = admin.firestore.Timestamp.now();
    const suggestionCreatedAt = (suggestion as any)?.createdAt instanceof admin.firestore.Timestamp ? ((suggestion as any).createdAt as admin.firestore.Timestamp) : null;
    const timeToDecisionMs = suggestionCreatedAt ? Math.max(0, nowTs.toMillis() - suggestionCreatedAt.toMillis()) : null;

    const beforePayload = suggestion.payload as AssistantSuggestionDoc['payload'];

    const nowServer = admin.firestore.FieldValue.serverTimestamp();
    decisionId = decisionRef.id;

    const decisionDoc: AssistantDecisionDoc = {
      suggestionId,
      objectId: suggestion.objectId,
      action: 'rejected',
      createdCoreObjects: [],
      beforePayload,
      pipelineVersion: 1,
      createdAt: nowServer,
      updatedAt: nowServer,
    };

    tx.create(decisionRef, decisionDoc);

    tx.set(
      metricsRef,
      metricsIncrements({
        suggestionsRejected: 1,
        decisionsCount: 1,
        totalTimeToDecisionMs: timeToDecisionMs ? timeToDecisionMs : 0,
      }),
      { merge: true },
    );

    tx.update(suggestionRef, {
      status: 'rejected',
      updatedAt: nowServer,
    });
  });

  return { decisionId };
});

export const assistantRateSuggestionFeedback = functions.https.onCall(async (data, context) => {
  const userId = context.auth?.uid;
  if (!userId) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const suggestionId = typeof (data as any)?.suggestionId === 'string' ? String((data as any).suggestionId) : null;
  if (!suggestionId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing suggestionId.');
  }

  const usefulRaw = (data as any)?.useful;
  if (typeof usefulRaw !== 'boolean') {
    throw new functions.https.HttpsError('invalid-argument', 'Missing useful boolean.');
  }

  const db = admin.firestore();
  const userRef = db.collection('users').doc(userId);
  const suggestionRef = userRef.collection('assistantSuggestions').doc(suggestionId);
  const feedbackRef = userRef.collection('assistantFeedback').doc(suggestionId);

  await db.runTransaction(async (tx) => {
    const suggestionSnap = await tx.get(suggestionRef);
    if (!suggestionSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Suggestion not found.');
    }

    const suggestion = suggestionSnap.data() as AssistantSuggestionDoc;
    const sourceTypeRaw = suggestion?.source?.type;
    const sourceType: 'note' | 'todo' | 'task' =
      sourceTypeRaw === 'todo' || sourceTypeRaw === 'task' || sourceTypeRaw === 'note' ? sourceTypeRaw : 'note';

    const nowServer = admin.firestore.FieldValue.serverTimestamp();
    const doc: AssistantSuggestionFeedbackDoc = {
      suggestionId,
      objectId: suggestion.objectId,
      kind: suggestion.kind,
      useful: usefulRaw,
      sourceType,
      ...(typeof suggestion.rankScore === 'number' && Number.isFinite(suggestion.rankScore) ? { rankScore: suggestion.rankScore } : {}),
      createdAt: nowServer,
      updatedAt: nowServer,
    };

    tx.set(feedbackRef, doc, { merge: true });
  });

  return { suggestionId, useful: usefulRaw };
});

export const assistantRequestReanalysis = functions.https.onCall(async (data, context) => {
  const userId = context.auth?.uid;
  if (!userId) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const noteId = typeof (data as any)?.noteId === 'string' ? String((data as any).noteId) : null;
  if (!noteId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing noteId.');
  }

  const db = admin.firestore();
  const enabled = await isAssistantEnabledForUser(db, userId);
  if (!enabled) {
    throw new functions.https.HttpsError('failed-precondition', 'Assistant disabled.');
  }

  const noteSnap = await db.collection('notes').doc(noteId).get();
  if (!noteSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Note not found.');
  }

  const note = noteSnap.data() as any;
  const noteUserId = typeof note?.userId === 'string' ? note.userId : null;
  if (noteUserId !== userId) {
    throw new functions.https.HttpsError('permission-denied', 'Not allowed.');
  }

  const title = typeof note?.title === 'string' ? note.title : '';
  const content = typeof note?.content === 'string' ? note.content : '';
  const normalized = normalizeAssistantText(`${title}\n${content}`);
  const textHash = sha256Hex(normalized);

  const nowDate = new Date();
  const dayKey = utcDayKey(nowDate);

  const userRef = db.collection('users').doc(userId);
  const objectId = assistantObjectIdForNote(noteId);
  const objectRef = userRef.collection('assistantObjects').doc(objectId);
  const jobRef = userRef.collection('assistantJobs').doc(assistantCurrentJobIdForObject(objectId));
  const usageRef = assistantUsageRef(db, userId, dayKey);
  const metricsRef = assistantMetricsRef(db, userId);

  const lockedUntilReady = admin.firestore.Timestamp.fromMillis(0);
  const nowServer = admin.firestore.FieldValue.serverTimestamp();

  await db.runTransaction(async (tx) => {
    const jobSnap = await tx.get(jobRef);
    const jobData = jobSnap.exists ? (jobSnap.data() as any) : null;
    const st = jobData?.status as AssistantJobStatus | undefined;
    const pending = typeof jobData?.pendingTextHash === 'string' ? (jobData.pendingTextHash as string) : null;
    const isActive = st === 'queued' || st === 'processing';

    // Double click / already scheduled for the same content.
    if (isActive && pending === textHash) {
      return;
    }

    // IMPORTANT: Firestore requires that all reads happen before any writes in a transaction.
    // So we fetch all documents we may need upfront.
    const [userSnap, usageSnap, objectSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(usageRef),
      tx.get(objectRef),
    ]);

    const plan = userSnap.exists && typeof (userSnap.data() as any)?.plan === 'string' ? String((userSnap.data() as any).plan) : 'free';
    const dailyLimit = plan === 'pro' ? ASSISTANT_REANALYSIS_PRO_DAILY_LIMIT : ASSISTANT_REANALYSIS_FREE_DAILY_LIMIT;

    const prevCount = usageSnap.exists && typeof (usageSnap.data() as any)?.reanalysisCount === 'number' ? Number((usageSnap.data() as any).reanalysisCount) : 0;
    if (prevCount >= dailyLimit) {
      throw new functions.https.HttpsError('resource-exhausted', 'Daily reanalysis limit reached.');
    }

    const objectData = objectSnap.exists ? (objectSnap.data() as any) : null;
    const existingTextHash = objectData && typeof objectData?.textHash === 'string' ? (objectData.textHash as string) : null;

    tx.set(
      usageRef,
      {
        reanalysisCount: admin.firestore.FieldValue.increment(1),
        lastUpdatedAt: nowServer,
      },
      { merge: true },
    );

    tx.set(metricsRef, metricsIncrements({ reanalysisRequested: 1 }), { merge: true });

    // If a job is already active, we only update pendingTextHash (no duplicate job).
    if (isActive) {
      tx.set(
        objectRef,
        {
          pendingTextHash: textHash,
          updatedAt: nowServer,
        },
        { merge: true },
      );
      tx.set(
        jobRef,
        {
          pendingTextHash: textHash,
          updatedAt: nowServer,
        },
        { merge: true },
      );
      return;
    }

    const objectPayload: Partial<AssistantObjectDoc> = {
      objectId,
      type: 'note',
      coreRef: { collection: 'notes', id: noteId },
      textHash: existingTextHash ?? textHash,
      pendingTextHash: textHash,
      pipelineVersion: 1,
      status: 'queued',
      updatedAt: nowServer,
    };
    if (!objectSnap.exists) {
      objectPayload.createdAt = nowServer;
      objectPayload.lastAnalyzedAt = null;
    }
    tx.set(objectRef, objectPayload, { merge: true });

    const jobPayload: AssistantJobDoc = {
      objectId,
      jobType: 'analyze_intents_v2',
      pipelineVersion: 1,
      status: 'queued',
      attempts: 0,
      pendingTextHash: textHash,
      lockedUntil: lockedUntilReady,
      createdAt: nowServer,
      updatedAt: nowServer,
    };

    if (jobSnap.exists) {
      tx.set(jobRef, jobPayload);
    } else {
      tx.create(jobRef, jobPayload);
    }
  });

  return { jobId: jobRef.id };
});

export const assistantRequestAIAnalysis = functions.https.onCall(async (data, context) => {
  const userId = context.auth?.uid;
  if (!userId) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const noteId = typeof (data as any)?.noteId === 'string' ? String((data as any).noteId) : null;
  if (!noteId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing noteId.');
  }

  const modesRaw = Array.isArray((data as any)?.modes) ? ((data as any).modes as unknown[]) : null;
  const allowedModes = new Set(['summary', 'actions', 'hooks', 'rewrite', 'entities']);
  const modes = modesRaw
    ? modesRaw
        .filter((m) => typeof m === 'string')
        .map((m) => String(m))
        .filter((m) => allowedModes.has(m))
    : ['summary', 'actions', 'hooks', 'rewrite', 'entities'];

  const requestedModel = normalizeAssistantAIModel((data as any)?.model);
  const preferredEnv = getAssistantAIPreferredModelEnv();
  let model = '';
  try {
    const available = await listAvailableModelsCached();
    model = selectDeterministicModel({ availableIds: available, preferredEnv, preferredRequested: requestedModel || null });
  } catch (e) {
    const cached = openAIModelsCache && Array.isArray(openAIModelsCache.ids) ? openAIModelsCache.ids : [];
    if (cached.length > 0) {
      model = selectDeterministicModel({ availableIds: cached, preferredEnv, preferredRequested: requestedModel || null });
    } else {
      model = requestedModel || preferredEnv || '';
      try {
        console.error('openai.model_select_failed', {
          requestedModel: requestedModel || null,
          preferredEnv,
          selected: model || null,
          message: e instanceof Error ? e.message : String(e),
        });
      } catch (err) {
        void err;
      }
      if (!model) {
        model = ASSISTANT_AI_MODEL_SHORTLIST[0] ?? '';
        if (!model) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'Découverte des modèles OpenAI impossible (endpoint /v1/models). Configure OPENAI_MODEL/ASSISTANT_AI_MODEL ou vérifie la clé et le Project OpenAI.',
          );
        }
        try {
          console.warn('openai.model_select_no_discovery', {
            requestedModel: requestedModel || null,
            preferredEnv,
            selected: model,
            note: 'Proceeding with deterministic shortlist fallback because /v1/models is unavailable and no model was configured.',
          });
        } catch {
          // ignore
        }
      }
    }
  }

  try {
    console.log('openai.model_selected', {
      requestedModel: requestedModel || null,
      preferredEnv,
      selected: model,
    });
  } catch (err) {
    void err;
  }

  if (!model) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Impossible de sélectionner un modèle OpenAI. Vérifie OPENAI_MODEL/ASSISTANT_AI_MODEL et les permissions du Project OpenAI.',
    );
  }

  const db = admin.firestore();
  const enabled = await isAssistantEnabledForUser(db, userId);
  if (!enabled) {
    throw new functions.https.HttpsError('failed-precondition', 'Assistant disabled.');
  }

  const noteSnap = await db.collection('notes').doc(noteId).get();
  if (!noteSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Note not found.');
  }

  const note = noteSnap.data() as any;
  const noteUserId = typeof note?.userId === 'string' ? note.userId : null;
  if (noteUserId !== userId) {
    throw new functions.https.HttpsError('permission-denied', 'Not allowed.');
  }

  const title = typeof note?.title === 'string' ? note.title : '';
  const content = typeof note?.content === 'string' ? note.content : '';
  const normalized = normalizeAssistantText(`${title}\n${content}`);
  const textHash = sha256Hex(normalized);

  const nowDate = new Date();
  const dayKey = utcDayKey(nowDate);

  const userRef = db.collection('users').doc(userId);
  const objectId = assistantObjectIdForNote(noteId);
  const jobRef = userRef.collection('assistantAIJobs').doc(assistantAIJobIdForNote(noteId));

  const schemaVersion = ASSISTANT_AI_SCHEMA_VERSION;
  const modesSig = modes.slice().sort().join(',');
  const resultId = sha256Hex(`${objectId}|${textHash}|${model}|schema:${schemaVersion}|modes:${modesSig}`);
  const resultRef = userRef.collection('assistantAIResults').doc(resultId);

  const usageRef = assistantUsageRef(db, userId, dayKey);
  const metricsRef = assistantMetricsRef(db, userId);
  const lockedUntilReady = admin.firestore.Timestamp.fromMillis(0);
  const nowServer = admin.firestore.FieldValue.serverTimestamp();

  await db.runTransaction(async (tx) => {
    const [userSnap, usageSnap, jobSnap, resultSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(usageRef),
      tx.get(jobRef),
      tx.get(resultRef),
    ]);

    if (resultSnap.exists) {
      tx.set(
        jobRef,
        {
          noteId,
          objectId,
          status: 'done',
          model,
          modelRequested: requestedModel || null,
          modes,
          schemaVersion,
          resultId,
          pendingTextHash: null,
          lockedUntil: lockedUntilReady,
          updatedAt: nowServer,
        },
        { merge: true },
      );
      return;
    }

    const plan = userSnap.exists && typeof (userSnap.data() as any)?.plan === 'string' ? String((userSnap.data() as any).plan) : 'free';
    const dailyLimit = plan === 'pro' ? ASSISTANT_AI_ANALYSIS_PRO_DAILY_LIMIT : ASSISTANT_AI_ANALYSIS_FREE_DAILY_LIMIT;
    const prevCount = usageSnap.exists && typeof (usageSnap.data() as any)?.aiAnalysisCount === 'number' ? Number((usageSnap.data() as any).aiAnalysisCount) : 0;
    if (prevCount >= dailyLimit) {
      throw new functions.https.HttpsError('resource-exhausted', 'Daily AI analysis limit reached.');
    }

    const jobData = jobSnap.exists ? (jobSnap.data() as any) : null;
    const st = jobData?.status as AssistantAIJobStatus | undefined;
    const pending = typeof jobData?.pendingTextHash === 'string' ? (jobData.pendingTextHash as string) : null;
    const isActive = st === 'queued' || st === 'processing';
    if (isActive && pending === textHash && jobData?.model === model) {
      return;
    }

    tx.set(
      usageRef,
      {
        aiAnalysisCount: admin.firestore.FieldValue.increment(1),
        lastUpdatedAt: nowServer,
      },
      { merge: true },
    );

    tx.set(metricsRef, metricsIncrements({ aiAnalysesRequested: 1 }), { merge: true });

    const payload: AssistantAIJobDoc = {
      noteId,
      objectId,
      status: 'queued',
      attempts: 0,
      model,
      modelRequested: requestedModel || null,
      modelFallbackUsed: null,
      modes,
      schemaVersion,
      pendingTextHash: textHash,
      lockedUntil: lockedUntilReady,
      resultId: null,
      error: null,
      createdAt: nowServer,
      updatedAt: nowServer,
    };

    if (jobSnap.exists) {
      tx.set(jobRef, payload, { merge: true });
    } else {
      tx.create(jobRef, payload);
    }
  });

  return { jobId: jobRef.id, resultId };
});

export const assistantCreateVoiceJob = functions.https.onCall(async (data, context) => {
  const userId = context.auth?.uid;
  if (!userId) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const noteId = typeof (data as any)?.noteId === 'string' ? String((data as any).noteId) : null;
  const modeRaw = typeof (data as any)?.mode === 'string' ? String((data as any).mode) : null;
  const mode: AssistantVoiceJobMode = modeRaw === 'append_to_note' || modeRaw === 'standalone' ? (modeRaw as AssistantVoiceJobMode) : noteId ? 'append_to_note' : 'standalone';

  const db = admin.firestore();
  const enabled = await isAssistantEnabledForUser(db, userId);
  if (!enabled) {
    throw new functions.https.HttpsError('failed-precondition', 'Assistant disabled.');
  }

  if (noteId) {
    const noteSnap = await db.collection('notes').doc(noteId).get();
    if (!noteSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Note not found.');
    }
    const note = noteSnap.data() as any;
    const noteUserId = typeof note?.userId === 'string' ? note.userId : null;
    if (noteUserId !== userId) {
      throw new functions.https.HttpsError('permission-denied', 'Not allowed.');
    }
  }

  const userRef = db.collection('users').doc(userId);
  const jobsCol = userRef.collection('assistantVoiceJobs');
  const jobRef = noteId ? jobsCol.doc(assistantVoiceJobIdForNote(noteId)) : jobsCol.doc();

  const jobId = jobRef.id;
  const storagePath = `users/${userId}/voice/${jobId}.webm`;
  const nowServer = admin.firestore.FieldValue.serverTimestamp();
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const lockedUntilReady = admin.firestore.Timestamp.fromMillis(0);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (snap.exists) {
      const existing = snap.data() as any;
      const status = existing?.status as AssistantVoiceJobStatus | undefined;
      const lockedUntil = (existing?.lockedUntil as FirebaseFirestore.Timestamp | undefined) ?? null;
      if (status === 'transcribing' && lockedUntil && lockedUntil.toMillis() > Date.now()) {
        // Don't reset an active transcription.
        tx.set(jobRef, { updatedAt: nowServer }, { merge: true });
        return;
      }

      tx.set(
        jobRef,
        {
          noteId: noteId ? noteId : null,
          mode,
          status: 'created',
          storagePath,
          lockedUntil: lockedUntilReady,
          fileHash: null,
          usageCountedHash: null,
          model: null,
          schemaVersion: ASSISTANT_VOICE_SCHEMA_VERSION,
          resultId: null,
          errorMessage: null,
          expiresAt,
          updatedAt: nowServer,
        },
        { merge: true },
      );
      return;
    }
    const payload: AssistantVoiceJobDoc = {
      noteId: noteId ? noteId : null,
      mode,
      status: 'created',
      storagePath,
      lockedUntil: lockedUntilReady,
      fileHash: null,
      usageCountedHash: null,
      model: null,
      schemaVersion: ASSISTANT_VOICE_SCHEMA_VERSION,
      resultId: null,
      errorMessage: null,
      expiresAt,
      createdAt: nowServer,
      updatedAt: nowServer,
    };
    tx.create(jobRef, payload);
  });

  return { jobId, storagePath };
});

export const assistantRequestVoiceTranscription = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onCall(async (data, context) => {
    const userId = context.auth?.uid;
    if (!userId) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
    }

    const jobId = typeof (data as any)?.jobId === 'string' ? String((data as any).jobId) : null;
    if (!jobId) {
      throw new functions.https.HttpsError('invalid-argument', 'Missing jobId.');
    }

    const db = admin.firestore();
    const enabled = await isAssistantEnabledForUser(db, userId);
    if (!enabled) {
      throw new functions.https.HttpsError('failed-precondition', 'Assistant disabled.');
    }

    const userRef = db.collection('users').doc(userId);
    const jobRef = userRef.collection('assistantVoiceJobs').doc(jobId);

    const jobSnap = await jobRef.get();
    if (!jobSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Voice job not found.');
    }

    const jobData = jobSnap.data() as AssistantVoiceJobDoc;
    const storagePath = typeof (jobData as any)?.storagePath === 'string' ? String((jobData as any).storagePath) : '';
    if (!storagePath) {
      throw new functions.https.HttpsError('failed-precondition', 'Missing storagePath.');
    }

    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);

    let meta: any;
    try {
      const arr = await file.getMetadata();
      meta = Array.isArray(arr) ? arr[0] : null;
    } catch (e) {
      throw new functions.https.HttpsError('failed-precondition', 'Audio file missing.');
    }

    const size = typeof meta?.size === 'string' ? Number(meta.size) : typeof meta?.size === 'number' ? Number(meta.size) : null;
    if (!size || !Number.isFinite(size) || size <= 0) {
      throw new functions.https.HttpsError('failed-precondition', 'Audio file invalid.');
    }
    if (size > ASSISTANT_VOICE_MAX_BYTES) {
      throw new functions.https.HttpsError('invalid-argument', 'Audio file too large.');
    }

    const contentType = typeof meta?.contentType === 'string' ? String(meta.contentType) : 'audio/webm';

    const dl = await file.download();
    const buffer = Array.isArray(dl) ? (dl[0] as Buffer) : (dl as any as Buffer);
    const fileHash = sha256HexBuffer(buffer);

    const model = 'whisper-1';
    const schemaVersion = ASSISTANT_VOICE_SCHEMA_VERSION;
    const resultId = sha256Hex(`${jobId}|${fileHash}|${model}|schema:${schemaVersion}`);
    const resultRef = userRef.collection('assistantVoiceResults').doc(resultId);

    const nowDate = new Date();
    const dayKey = utcDayKey(nowDate);
    const usageRef = assistantUsageRef(db, userId, dayKey);

    const nowTs = admin.firestore.Timestamp.fromDate(nowDate);
    const lockMs = 6 * 60 * 1000;
    const lockedUntilNext = admin.firestore.Timestamp.fromMillis(nowTs.toMillis() + lockMs);
    const lockedUntilReady = admin.firestore.Timestamp.fromMillis(0);
    const nowServer = admin.firestore.FieldValue.serverTimestamp();
    const expiresAt = admin.firestore.Timestamp.fromMillis(nowDate.getTime() + 7 * 24 * 60 * 60 * 1000);

    let shouldTranscribe = true;

    await db.runTransaction(async (tx) => {
      const [userSnap, usageSnap, freshJobSnap, existingResultSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(usageRef),
        tx.get(jobRef),
        tx.get(resultRef),
      ]);

      if (existingResultSnap.exists) {
        tx.set(
          jobRef,
          {
            status: 'done',
            lockedUntil: lockedUntilReady,
            fileHash,
            model,
            schemaVersion,
            resultId,
            errorMessage: null,
            updatedAt: nowServer,
          },
          { merge: true },
        );
        shouldTranscribe = false;
        return;
      }

      const job = freshJobSnap.exists ? (freshJobSnap.data() as any) : null;
      const st = job?.status as AssistantVoiceJobStatus | undefined;
      const lockedUntil = (job?.lockedUntil as FirebaseFirestore.Timestamp | undefined) ?? null;
      if ((st === 'transcribing') && lockedUntil && lockedUntil.toMillis() > nowTs.toMillis()) {
        throw new functions.https.HttpsError('failed-precondition', 'Transcription already in progress.');
      }

      const plan = userSnap.exists && typeof (userSnap.data() as any)?.plan === 'string' ? String((userSnap.data() as any).plan) : 'free';
      const dailyLimit = plan === 'pro' ? ASSISTANT_VOICE_TRANSCRIPT_PRO_DAILY_LIMIT : ASSISTANT_VOICE_TRANSCRIPT_FREE_DAILY_LIMIT;
      const prevCount = usageSnap.exists && typeof (usageSnap.data() as any)?.aiTranscriptionsCount === 'number' ? Number((usageSnap.data() as any).aiTranscriptionsCount) : 0;

      const countedHash = typeof job?.usageCountedHash === 'string' ? String(job.usageCountedHash) : null;
      const needCount = countedHash !== fileHash;
      if (needCount && prevCount >= dailyLimit) {
        throw new functions.https.HttpsError('resource-exhausted', 'Daily transcription limit reached.');
      }

      if (needCount) {
        tx.set(
          usageRef,
          {
            aiTranscriptionsCount: admin.firestore.FieldValue.increment(1),
            lastUpdatedAt: nowServer,
          },
          { merge: true },
        );
      }

      tx.set(
        jobRef,
        {
          status: 'transcribing',
          lockedUntil: lockedUntilNext,
          fileHash,
          usageCountedHash: fileHash,
          model,
          schemaVersion,
          errorMessage: null,
          updatedAt: nowServer,
          expiresAt,
        },
        { merge: true },
      );
    });

    if (!shouldTranscribe) {
      return { jobId, resultId };
    }

    try {
      console.log('assistant.voice.transcription_start', { userId, jobId, storagePath, bytes: size, contentType });
    } catch {
      // ignore
    }

    try {
      const whisper = await callOpenAIWhisperTranscription({
        buffer,
        filename: `${jobId}.webm`,
        contentType,
        language: null,
      });

      const transcript = clampFromText(whisper.text ?? '', 20_000);

      const resultDoc: AssistantVoiceResultDoc = {
        jobId,
        noteId: (jobData as any)?.noteId ?? null,
        mode: (jobData as any)?.mode === 'append_to_note' ? 'append_to_note' : 'standalone',
        storagePath,
        fileHash,
        model,
        schemaVersion,
        transcript,
        expiresAt,
        createdAt: nowServer,
        updatedAt: nowServer,
      };

      try {
        await resultRef.create(resultDoc);
      } catch {
        // already exists
      }

      await jobRef.set(
        {
          status: 'done',
          lockedUntil: lockedUntilReady,
          resultId,
          errorMessage: null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      try {
        console.log('assistant.voice.transcription_done', { userId, jobId, resultId, chars: transcript.length });
      } catch {
        // ignore
      }

      return { jobId, resultId };
    } catch (e) {
      try {
        console.error('assistant.voice.transcription_failed', {
          userId,
          jobId,
          message: e instanceof Error ? e.message : String(e),
          stack: e instanceof Error ? e.stack : undefined,
        });
      } catch {
        // ignore
      }

      await jobRef.set(
        {
          status: 'error',
          lockedUntil: lockedUntilReady,
          errorMessage: e instanceof Error ? e.message : 'Voice transcription error',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      throw new functions.https.HttpsError('internal', e instanceof Error ? e.message : 'Voice transcription error');
    }
  });

type AssistantVoiceIntentKind = 'create_task' | 'create_reminder' | 'schedule_meeting';
type AssistantVoiceMissingField = 'time';

type AssistantVoiceIntent = {
  kind: AssistantVoiceIntentKind;
  title: string;
  confidence: number;
  requiresConfirmation: boolean;
  requiresConfirmationReason?: string;
  remindAt?: admin.firestore.Timestamp | null;
  missingFields?: AssistantVoiceMissingField[];
  clarificationQuestion?: string;
};

function stripVoiceCommandPrefix(input: string): string {
  return input
    .trim()
    .replace(/^(stp\s+|s'il te plait\s+|please\s+)/i, '')
    .replace(/^(ajoute|ajouter|crée|créer|cree|creer|planifie|program(me|mer)|rappelle\s*-?\s*moi\s+de|pense\s+à|note)\s+/i, '')
    .trim();
}

function inferReminderTime(text: string, now: Date): {
  remindAt: admin.firestore.Timestamp | null;
  missingFields: AssistantVoiceMissingField[];
} {
  const lower = text.toLowerCase();
  const hasTomorrow = lower.includes('demain');
  const hasEvening = lower.includes('ce soir') || lower.includes('soir');
  const hasMorning = lower.includes('matin');
  const hasAfternoon = lower.includes('après-midi') || lower.includes('apres-midi');

  const timeMatch = /\b([01]?\d|2[0-3])(?:[:h]([0-5]\d)?)\b/.exec(lower);
  if (timeMatch) {
    const h = Number(timeMatch[1]);
    const m = Number(timeMatch[2] ?? 0);
    const d = new Date(now);
    d.setSeconds(0, 0);
    if (hasTomorrow) {
      d.setDate(d.getDate() + 1);
    }
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= now.getTime()) {
      d.setDate(d.getDate() + 1);
    }
    return { remindAt: admin.firestore.Timestamp.fromDate(d), missingFields: [] };
  }

  if (hasTomorrow && hasMorning) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return { remindAt: admin.firestore.Timestamp.fromDate(d), missingFields: [] };
  }

  if (hasTomorrow && hasAfternoon) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(14, 0, 0, 0);
    return { remindAt: admin.firestore.Timestamp.fromDate(d), missingFields: [] };
  }

  if (hasEvening) {
    const d = new Date(now);
    d.setHours(18, 0, 0, 0);
    if (d.getTime() <= now.getTime()) {
      d.setDate(d.getDate() + 1);
    }
    return { remindAt: admin.firestore.Timestamp.fromDate(d), missingFields: [] };
  }

  if (hasTomorrow) {
    return { remindAt: null, missingFields: ['time'] };
  }

  if (hasMorning) {
    const d = new Date(now);
    d.setHours(9, 0, 0, 0);
    if (d.getTime() <= now.getTime()) {
      d.setDate(d.getDate() + 1);
    }
    return { remindAt: admin.firestore.Timestamp.fromDate(d), missingFields: [] };
  }

  if (hasAfternoon) {
    const d = new Date(now);
    d.setHours(14, 0, 0, 0);
    if (d.getTime() <= now.getTime()) {
      d.setDate(d.getDate() + 1);
    }
    return { remindAt: admin.firestore.Timestamp.fromDate(d), missingFields: [] };
  }

  return { remindAt: null, missingFields: ['time'] };
}

function parseAssistantVoiceIntent(transcript: string, now: Date): AssistantVoiceIntent {
  const raw = transcript.trim();
  const lower = raw.toLowerCase();
  const cleaned = stripVoiceCommandPrefix(raw);

  const meetingLike =
    lower.includes('réunion') ||
    lower.includes('reunion') ||
    lower.includes('meeting') ||
    lower.includes('rendez-vous') ||
    lower.includes('rdv') ||
    lower.includes('agenda') ||
    lower.includes('calendrier');

  if (meetingLike) {
    const inferred = inferReminderTime(raw, now);
    const missingFields = inferred.missingFields;
    return {
      kind: 'schedule_meeting',
      title: cleaned || 'Nouvelle réunion',
      confidence: 0.74,
      requiresConfirmation: true,
      requiresConfirmationReason: 'Confirme pour créer la réunion.',
      remindAt: inferred.remindAt,
      missingFields,
      clarificationQuestion: missingFields.length > 0 ? 'À quelle heure veux-tu planifier la réunion ?' : undefined,
    };
  }

  const reminderLike =
    lower.includes('rappel') ||
    lower.includes('rappelle') ||
    lower.includes('souviens') ||
    lower.includes("n'oublie") ||
    lower.includes('n oublie');

  if (reminderLike) {
    const inferred = inferReminderTime(raw, now);
    const missingFields = inferred.missingFields;
    return {
      kind: 'create_reminder',
      title: cleaned || 'Rappel',
      confidence: 0.81,
      requiresConfirmation: false,
      remindAt: inferred.remindAt,
      missingFields,
      clarificationQuestion: missingFields.length > 0 ? 'Je peux le faire. À quelle heure veux-tu ce rappel ?' : undefined,
    };
  }

  return {
    kind: 'create_task',
    title: cleaned || raw || 'Nouvelle tâche',
    confidence: 0.86,
    requiresConfirmation: false,
    remindAt: null,
  };
}

export const assistantExecuteIntent = functions.https.onCall(async (data, context) => {
  const userId = context.auth?.uid;
  if (!userId) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const transcriptRaw = typeof (data as any)?.transcript === 'string' ? String((data as any).transcript) : '';
  const transcript = transcriptRaw.trim();
  if (!transcript) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing transcript.');
  }
  if (transcript.length > 4000) {
    throw new functions.https.HttpsError('invalid-argument', 'Transcript too long.');
  }

  const execute = (data as any)?.execute === true;

  const db = admin.firestore();
  const enabled = await isAssistantEnabledForUser(db, userId);
  if (!enabled) {
    throw new functions.https.HttpsError('failed-precondition', 'Assistant disabled.');
  }

  const now = new Date();
  const parsed = parseAssistantVoiceIntent(transcript, now);
  const remindAtIso = parsed.remindAt ? parsed.remindAt.toDate().toISOString() : null;
  const missingFields = Array.isArray(parsed.missingFields) ? parsed.missingFields : [];
  const needsClarification = missingFields.length > 0;

  const responseBase = {
    intent: {
      kind: parsed.kind,
      title: parsed.title,
      confidence: parsed.confidence,
      requiresConfirmation: parsed.requiresConfirmation,
      requiresConfirmationReason: parsed.requiresConfirmationReason ?? null,
      remindAtIso,
    },
    needsClarification,
    missingFields,
    clarificationQuestion: parsed.clarificationQuestion ?? null,
    executed: false,
    createdCoreObjects: [] as Array<{ type: 'task' | 'taskReminder' | 'calendarEvent'; id: string }>,
    message: needsClarification
      ? (parsed.clarificationQuestion ?? 'Il me manque une information.')
      : !execute && parsed.kind === 'schedule_meeting'
        ? (parsed.requiresConfirmationReason ?? 'Confirme pour créer la réunion.')
      : execute
        ? 'Action non exécutée.'
        : 'Intention analysée. Prête à exécuter.',
  };

  if (!execute) {
    return responseBase;
  }

  if (needsClarification) {
    return {
      ...responseBase,
      executed: false,
      message: parsed.clarificationQuestion ?? 'Il me manque une information pour exécuter cette action.',
    };
  }

  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  const userPlan = userSnap.exists && typeof (userSnap.data() as any)?.plan === 'string' ? String((userSnap.data() as any).plan) : 'free';
  const isPro = userPlan === 'pro';
  const createdAt = admin.firestore.FieldValue.serverTimestamp();
  const updatedAt = admin.firestore.FieldValue.serverTimestamp();

  if (parsed.kind === 'create_task') {
    const taskRef = db.collection('tasks').doc();
    await taskRef.create({
      userId,
      title: parsed.title,
      status: 'todo',
      workspaceId: null,
      startDate: null,
      dueDate: null,
      priority: null,
      favorite: false,
      archived: false,
      source: {
        assistant: true,
        channel: 'voice_intent',
      },
      createdAt,
      updatedAt,
    });

    return {
      ...responseBase,
      executed: true,
      createdCoreObjects: [{ type: 'task' as const, id: taskRef.id }],
      message: 'Tâche créée.',
    };
  }

  if (parsed.kind === 'create_reminder') {
    if (!isPro) {
      return {
        ...responseBase,
        executed: false,
        message: 'Le rappel automatique nécessite le plan Pro.',
      };
    }

    const remindAt = parsed.remindAt ?? admin.firestore.Timestamp.fromDate(new Date(Date.now() + 60 * 60 * 1000));
    const remindAtIsoEffective = remindAt.toDate().toISOString();

    const taskRef = db.collection('tasks').doc();
    const reminderRef = db.collection('taskReminders').doc();

    const batch = db.batch();
    batch.create(taskRef, {
      userId,
      title: parsed.title,
      status: 'todo',
      workspaceId: null,
      startDate: null,
      dueDate: remindAt,
      priority: null,
      favorite: false,
      archived: false,
      source: {
        assistant: true,
        channel: 'voice_intent',
      },
      createdAt,
      updatedAt,
    });
    batch.create(reminderRef, {
      userId,
      taskId: taskRef.id,
      dueDate: remindAtIsoEffective,
      reminderTime: remindAtIsoEffective,
      sent: false,
      createdAt,
      updatedAt,
      source: {
        assistant: true,
        channel: 'voice_intent',
      },
    });
    await batch.commit();

    return {
      ...responseBase,
      executed: true,
      createdCoreObjects: [
        { type: 'task' as const, id: taskRef.id },
        { type: 'taskReminder' as const, id: reminderRef.id },
      ],
      message: 'Rappel créé.',
    };
  }

  if (parsed.kind === 'schedule_meeting') {
    const taskRef = db.collection('tasks').doc();
    await taskRef.create({
      userId,
      title: `Réunion: ${parsed.title}`,
      status: 'todo',
      workspaceId: null,
      startDate: parsed.remindAt ?? null,
      dueDate: parsed.remindAt ?? null,
      priority: null,
      favorite: false,
      archived: false,
      source: {
        assistant: true,
        channel: 'voice_intent',
      },
      createdAt,
      updatedAt,
    });

    return {
      ...responseBase,
      executed: true,
      createdCoreObjects: [{ type: 'task' as const, id: taskRef.id }],
      message: 'Réunion préparée. Tu peux la retrouver dans tes tâches.',
    };
  }

  return responseBase;
});

export const assistantPurgeExpiredVoiceData = functions.pubsub
  .schedule('every monday 03:00')
  .onRun(async () => {
    const db = admin.firestore();
    const bucket = admin.storage().bucket();
    const nowTs = admin.firestore.Timestamp.now();

    const purgeColGroup = async (collectionId: 'assistantVoiceJobs' | 'assistantVoiceResults') => {
      const snap = await db
        .collectionGroup(collectionId)
        .where('expiresAt', '<=', nowTs)
        .orderBy('expiresAt', 'asc')
        .limit(50)
        .get();

      if (snap.empty) return 0;

      const tasks = snap.docs.map(async (docSnap) => {
        const data = docSnap.data() as any;
        const storagePath = typeof data?.storagePath === 'string' ? String(data.storagePath) : '';
        if (storagePath) {
          try {
            await bucket.file(storagePath).delete({ ignoreNotFound: true } as any);
          } catch {
            // ignore
          }
        }
        try {
          await docSnap.ref.delete();
        } catch {
          // ignore
        }
      });

      await Promise.all(tasks);
      return snap.size;
    };

    const purgedJobs = await purgeColGroup('assistantVoiceJobs');
    const purgedResults = await purgeColGroup('assistantVoiceResults');

    try {
      console.log('assistant.voice.purge', { purgedJobs, purgedResults });
    } catch {
      // ignore
    }
  });

const ASSISTANT_AI_JOB_LOCK_MS = 5 * 60 * 1000;
const ASSISTANT_AI_JOB_MAX_ATTEMPTS = 3;

async function claimAssistantAIJob(params: {
  db: FirebaseFirestore.Firestore;
  ref: FirebaseFirestore.DocumentReference;
  now: FirebaseFirestore.Timestamp;
}): Promise<AssistantAIJobDoc | null> {
  const { db, ref, now } = params;
  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data() as any;
    const status = data?.status as AssistantAIJobStatus | undefined;
    if (status !== 'queued') return null;

    const attempts = typeof data?.attempts === 'number' ? data.attempts : 0;
    if (attempts >= ASSISTANT_AI_JOB_MAX_ATTEMPTS) {
      tx.update(ref, { status: 'error', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      return null;
    }

    const lockedUntil: FirebaseFirestore.Timestamp | null = data?.lockedUntil ?? null;
    if (lockedUntil && lockedUntil.toMillis() > now.toMillis()) return null;

    const nextLocked = admin.firestore.Timestamp.fromMillis(now.toMillis() + ASSISTANT_AI_JOB_LOCK_MS);
    tx.update(ref, {
      status: 'processing',
      attempts: attempts + 1,
      lockedUntil: nextLocked,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return snap.data() as AssistantAIJobDoc;
  });
}

async function processAssistantAIJob(params: {
  db: FirebaseFirestore.Firestore;
  userId: string;
  jobDoc: FirebaseFirestore.QueryDocumentSnapshot;
  nowDate: Date;
  nowTs: FirebaseFirestore.Timestamp;
}): Promise<void> {
  const { db, userId, jobDoc, nowDate, nowTs } = params;
  const claimed = await claimAssistantAIJob({ db, ref: jobDoc.ref, now: nowTs });
  if (!claimed) return;

  const noteId = typeof (claimed as any)?.noteId === 'string' ? String((claimed as any).noteId) : null;
  const objectId = typeof claimed.objectId === 'string' ? claimed.objectId : null;
  const requestedModel = normalizeAssistantAIModel((claimed as any)?.model);
  const schemaVersion = typeof claimed.schemaVersion === 'number' ? Math.trunc(claimed.schemaVersion) : ASSISTANT_AI_SCHEMA_VERSION;
  const modes = Array.isArray((claimed as any)?.modes) ? ((claimed as any).modes as unknown[]).filter((m) => typeof m === 'string').map((m) => String(m)) : [];

  if (!noteId || !objectId) return;

  const metricsRef = assistantMetricsRef(db, userId);
  const userRef = db.collection('users').doc(userId);

  let primaryModel: string | null = null;
  let fallbackModel: string | null = null;
  let usedModel: string | null = null;
  let fallbackUsed: string | null = null;

  try {
    const noteSnap = await db.collection('notes').doc(noteId).get();
    const note = noteSnap.exists ? (noteSnap.data() as any) : null;
    const noteUserId = typeof note?.userId === 'string' ? note.userId : null;
    if (!note || noteUserId !== userId) {
      await jobDoc.ref.update({ status: 'error', lockedUntil: admin.firestore.Timestamp.fromMillis(0), error: 'Note not accessible', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      return;
    }

    const title = typeof note?.title === 'string' ? note.title : '';
    const content = typeof note?.content === 'string' ? note.content : '';
    const normalized = normalizeAssistantText(`${title}\n${content}`);
    const textHash = sha256Hex(normalized);

    const modesSig = modes.slice().sort().join(',');
    const resultIdForModel = (m: string) => sha256Hex(`${objectId}|${textHash}|${m}|schema:${schemaVersion}|modes:${modesSig}`);

    let availableIds: string[] = [];
    try {
      availableIds = await listAvailableModelsCached();
    } catch (err) {
      const cached = openAIModelsCache && Array.isArray(openAIModelsCache.ids) ? openAIModelsCache.ids : [];
      if (cached.length > 0) {
        availableIds = cached;
      } else {
        availableIds = [];
      }
    }

    const preferredEnv = getAssistantAIPreferredModelEnv();
    const candidatesBase: string[] = [];
    if (requestedModel) candidatesBase.push(requestedModel);
    if (preferredEnv && preferredEnv !== requestedModel) candidatesBase.push(preferredEnv);
    for (const m of ASSISTANT_AI_MODEL_SHORTLIST) {
      if (!candidatesBase.includes(m)) candidatesBase.push(m);
    }

    if (!Array.isArray(availableIds) || availableIds.length === 0) {
      const direct = requestedModel || preferredEnv || '';
      if (!direct) {
        primaryModel = ASSISTANT_AI_MODEL_SHORTLIST[0] ?? '';
        fallbackModel = ASSISTANT_AI_MODEL_SHORTLIST.length > 1 ? ASSISTANT_AI_MODEL_SHORTLIST[1] : null;
        if (!primaryModel) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'Découverte des modèles OpenAI impossible (endpoint /v1/models). Configure OPENAI_MODEL/ASSISTANT_AI_MODEL ou vérifie la clé et le Project OpenAI.',
          );
        }
        try {
          console.warn('openai.model_select_no_discovery', {
            userId,
            jobId: jobDoc.id,
            requestedModel: requestedModel || null,
            preferredEnv,
            selected: primaryModel,
            fallback: fallbackModel,
            note: 'Proceeding with deterministic shortlist fallback because /v1/models is unavailable and no model was configured.',
          });
        } catch {
          // ignore
        }
      } else {
        primaryModel = direct;
        fallbackModel = null;
      }
    }

    if (!primaryModel) {
      const resolvedCandidates: string[] = [];
      for (const c of candidatesBase) {
        const resolved = resolveModelFromAvailable(availableIds, c);
        if (resolved && !resolvedCandidates.includes(resolved)) {
          resolvedCandidates.push(resolved);
        }
      }

      if (resolvedCandidates.length === 0) {
        primaryModel = pickDefaultAvailableModel(availableIds);
        const second = availableIds.find((m) => m !== primaryModel) ?? null;
        fallbackModel = second;
      } else {
        primaryModel = resolvedCandidates[0];
        const second = resolvedCandidates.length > 1 ? resolvedCandidates[1] : availableIds.find((m) => m !== primaryModel) ?? null;
        fallbackModel = second;
      }
    }

    const primaryResultId = resultIdForModel(primaryModel);
    const primaryResultRef = userRef.collection('assistantAIResults').doc(primaryResultId);
    const fallbackResultId = fallbackModel ? resultIdForModel(fallbackModel) : null;
    const fallbackResultRef = fallbackResultId ? userRef.collection('assistantAIResults').doc(fallbackResultId) : null;

    const [existingPrimary, existingFallback] = await Promise.all([
      primaryResultRef.get(),
      fallbackResultRef ? fallbackResultRef.get() : Promise.resolve(null as any),
    ]);

    if (existingPrimary.exists) {
      await jobDoc.ref.update({
        status: 'done',
        lockedUntil: admin.firestore.Timestamp.fromMillis(0),
        pendingTextHash: null,
        resultId: primaryResultId,
        model: primaryModel,
        modelRequested: requestedModel || null,
        modelFallbackUsed: null,
        error: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return;
    }
    if (fallbackResultRef && existingFallback && existingFallback.exists) {
      await jobDoc.ref.update({
        status: 'done',
        lockedUntil: admin.firestore.Timestamp.fromMillis(0),
        pendingTextHash: null,
        resultId: fallbackResultId,
        model: fallbackModel,
        modelRequested: requestedModel || null,
        modelFallbackUsed: fallbackModel,
        error: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return;
    }

    const instructions = [
      'You are SmartNote Assistant AI.',
      'You must return ONLY JSON that matches the provided JSON Schema.',
      'Suggest actions and content improvements for the note, but never claim you executed anything.',
      `Current datetime (Europe/Paris): ${nowDate.toISOString()}`,
      'If you infer dates/times, output ISO 8601 strings with timezone offsets when possible.',
      'Keep text concise and in French.',
    ].join('\n');

    const inputText = `Titre:\n${title}\n\nContenu:\n${content}`;

    const runForModel = async (model: string) => {
      try {
        return await callOpenAIResponsesJsonSchema({ model, instructions, inputText, schema: ASSISTANT_AI_OUTPUT_SCHEMA_V1 });
      } catch (err) {
        if (isOpenAIUnsupportedJsonSchemaError(err)) {
          console.warn('openai.structured_outputs_unsupported', {
            userId,
            jobId: jobDoc.id,
            model,
            message: err instanceof Error ? err.message : String(err),
          });
          return await callOpenAIResponsesLooseJson({ model, instructions, inputText });
        }
        throw err;
      }
    };

    usedModel = primaryModel;
    fallbackUsed = null;
    let llm = await runForModel(usedModel).catch(async (e) => {
      if (fallbackModel && isOpenAIModelAccessError(e)) {
        fallbackUsed = fallbackModel;
        usedModel = fallbackModel;
        return await runForModel(usedModel);
      }
      throw e;
    });

    const usedResultId = resultIdForModel(usedModel);
    const usedResultRef = userRef.collection('assistantAIResults').doc(usedResultId);

    const nowServer = admin.firestore.FieldValue.serverTimestamp();
    const resultDoc: AssistantAIResultDoc = {
      noteId,
      objectId,
      textHash,
      model: usedModel,
      schemaVersion,
      modes,
      refusal: llm.refusal,
      usage: llm.usage ? { inputTokens: llm.usage.inputTokens, outputTokens: llm.usage.outputTokens, totalTokens: llm.usage.totalTokens } : undefined,
      output: llm.parsed ?? undefined,
      createdAt: nowServer,
      updatedAt: nowServer,
    };

    await usedResultRef.create(resultDoc);

    const inc: Partial<Record<keyof AssistantMetricsDoc, number>> = {
      aiAnalysesCompleted: 1,
      aiResultsCreated: 1,
    };
    if (llm.usage?.inputTokens) inc.aiTokensIn = llm.usage.inputTokens;
    if (llm.usage?.outputTokens) inc.aiTokensOut = llm.usage.outputTokens;
    await metricsRef.set(metricsIncrements(inc), { merge: true });

    const suggestionsCol = userRef.collection('assistantSuggestions');
    const expiresAt = admin.firestore.Timestamp.fromMillis(nowDate.getTime() + 14 * 24 * 60 * 60 * 1000);

    const outputObj = llm.parsed && typeof llm.parsed === 'object' ? (llm.parsed as any) : null;

    const contentSuggestions: Array<{ kind: Exclude<AssistantSuggestionKind, 'create_task' | 'create_reminder' | 'create_task_bundle' | 'update_task_meta'>; title: string; payloadExtra: Record<string, any> }> = [];

    if (outputObj) {
      const summaryShort = typeof outputObj.summaryShort === 'string' ? String(outputObj.summaryShort) : '';
      const summaryStructured = Array.isArray(outputObj.summaryStructured) ? outputObj.summaryStructured : null;
      const keyPoints = Array.isArray(outputObj.keyPoints) ? outputObj.keyPoints : null;
      const hooks = Array.isArray(outputObj.hooks) ? outputObj.hooks : null;
      const rewriteContent = typeof outputObj.rewriteContent === 'string' ? String(outputObj.rewriteContent) : '';
      const tags = Array.isArray(outputObj.tags) ? outputObj.tags : null;
      const entities = outputObj.entities && typeof outputObj.entities === 'object' ? outputObj.entities : null;

      if (summaryShort || (Array.isArray(summaryStructured) && summaryStructured.length > 0)) {
        contentSuggestions.push({
          kind: 'generate_summary',
          title: 'Résumé',
          payloadExtra: { summaryShort: summaryShort || undefined, summaryStructured: summaryStructured || undefined },
        });
      }
      if (Array.isArray(keyPoints) && keyPoints.length > 0) {
        contentSuggestions.push({ kind: 'extract_key_points', title: 'Points clés', payloadExtra: { keyPoints } });
      }
      if (Array.isArray(hooks) && hooks.length > 0) {
        contentSuggestions.push({ kind: 'generate_hook', title: 'Hooks', payloadExtra: { hooks } });
      }
      if (rewriteContent) {
        contentSuggestions.push({ kind: 'rewrite_note', title: 'Reformulation', payloadExtra: { rewriteContent } });
      }
      if ((entities && typeof entities === 'object') || (Array.isArray(tags) && tags.length > 0)) {
        contentSuggestions.push({ kind: 'tag_entities', title: 'Entités & tags', payloadExtra: { entities: entities || undefined, tags: tags || undefined } });
      }
    }

    for (const cs of contentSuggestions) {
      const dedupeKey = buildContentDedupeKey({ objectId, kind: cs.kind, minimal: { title: cs.title, v: schemaVersion, h: sha256Hex(JSON.stringify(cs.payloadExtra)) } });
      const sugRef = suggestionsCol.doc(dedupeKey);
      const payload: AssistantSuggestionPayload = {
        title: cs.title,
        ...cs.payloadExtra,
        origin: { fromText: 'Analyse IA' },
        confidence: 0.7,
        explanation: 'Suggestion générée par IA.',
      } as any;

      await db.runTransaction(async (tx) => {
        const existingSug = await tx.get(sugRef);
        if (existingSug.exists) {
          const st = (existingSug.data() as any)?.status as AssistantSuggestionStatus | undefined;
          if (st === 'proposed' || st === 'accepted') return;
          tx.update(sugRef, {
            objectId,
            source: { type: 'note', id: noteId },
            kind: cs.kind,
            payload,
            status: 'proposed',
            pipelineVersion: 1,
            dedupeKey,
            updatedAt: nowServer,
            expiresAt,
          });
          return;
        }

        const doc: AssistantSuggestionDoc = {
          objectId,
          source: { type: 'note', id: noteId },
          kind: cs.kind,
          payload,
          status: 'proposed',
          pipelineVersion: 1,
          dedupeKey,
          createdAt: nowServer,
          updatedAt: nowServer,
          expiresAt,
        };
        tx.create(sugRef, doc);
      });
    }

    const actions = outputObj && Array.isArray(outputObj.actions) ? (outputObj.actions as any[]) : [];
    for (const a of actions) {
      const kind = typeof a?.kind === 'string' ? String(a.kind) : '';
      const titleA = typeof a?.title === 'string' ? String(a.title).trim() : '';
      if (!titleA) continue;

      if (kind === 'create_task_bundle') {
        const tasksRaw = Array.isArray(a?.tasks) ? (a.tasks as any[]) : [];
        const tasks: AssistantTaskBundleTask[] = [];
        for (const t of tasksRaw) {
          const tt = typeof t?.title === 'string' ? String(t.title).trim() : '';
          if (!tt) continue;
          const dueDate = parseIsoToTimestamp(t?.dueDateIso);
          const remindAt = parseIsoToTimestamp(t?.remindAtIso);
          const pr = t?.priority === 'low' || t?.priority === 'medium' || t?.priority === 'high' ? (t.priority as any) : undefined;
          tasks.push({ title: tt, ...(dueDate ? { dueDate } : {}), ...(remindAt ? { remindAt } : {}), ...(pr ? { priority: pr } : {}), origin: { fromText: 'Analyse IA' } });
        }
        if (tasks.length === 0) continue;

        const tasksSig = tasks
          .map((t) => `${normalizeAssistantText(t.title)}|${t.dueDate ? t.dueDate.toMillis() : ''}|${t.remindAt ? t.remindAt.toMillis() : ''}`)
          .join('||');

        const dedupeKey = buildBundleDedupeKey({ objectId, minimal: { title: titleA, tasksSig } as any });
        const sugRef = suggestionsCol.doc(dedupeKey);
        const payload: AssistantSuggestionPayload = {
          title: titleA,
          tasks,
          bundleMode: 'multiple_tasks',
          noteId,
          origin: { fromText: 'Analyse IA' },
          confidence: 0.7,
          explanation: 'Suggestion générée par IA.',
        } as any;

        await db.runTransaction(async (tx) => {
          const existingSug = await tx.get(sugRef);
          if (existingSug.exists) {
            const st = (existingSug.data() as any)?.status as AssistantSuggestionStatus | undefined;
            if (st === 'proposed' || st === 'accepted') return;
            tx.update(sugRef, {
              objectId,
              source: { type: 'note', id: noteId },
              kind: 'create_task_bundle',
              payload,
              status: 'proposed',
              pipelineVersion: 1,
              dedupeKey,
              updatedAt: nowServer,
              expiresAt,
            });
            return;
          }
          const doc: AssistantSuggestionDoc = {
            objectId,
            source: { type: 'note', id: noteId },
            kind: 'create_task_bundle',
            payload,
            status: 'proposed',
            pipelineVersion: 1,
            dedupeKey,
            createdAt: nowServer,
            updatedAt: nowServer,
            expiresAt,
          };
          tx.create(sugRef, doc);
        });
        continue;
      }

      if (kind === 'create_task' || kind === 'create_reminder') {
        const dueDate = parseIsoToTimestamp(a?.dueDateIso);
        const remindAt = parseIsoToTimestamp(a?.remindAtIso);
        const pr = a?.priority === 'low' || a?.priority === 'medium' || a?.priority === 'high' ? (a.priority as any) : undefined;

        const dedupeKey = buildSuggestionDedupeKey({
          objectId,
          kind: kind as any,
          minimal: {
            title: titleA,
            dueDateMs: dueDate ? dueDate.toMillis() : null,
            remindAtMs: remindAt ? remindAt.toMillis() : null,
          } as any,
        });
        const sugRef = suggestionsCol.doc(dedupeKey);

        const payload: AssistantSuggestionPayload = {
          title: titleA,
          ...(dueDate ? { dueDate } : {}),
          ...(remindAt ? { remindAt } : {}),
          ...(pr ? { priority: pr } : {}),
          origin: { fromText: 'Analyse IA' },
          confidence: 0.7,
          explanation: 'Suggestion générée par IA.',
        } as any;

        await db.runTransaction(async (tx) => {
          const existingSug = await tx.get(sugRef);
          if (existingSug.exists) {
            const st = (existingSug.data() as any)?.status as AssistantSuggestionStatus | undefined;
            if (st === 'proposed' || st === 'accepted') return;
            tx.update(sugRef, {
              objectId,
              source: { type: 'note', id: noteId },
              kind: kind as any,
              payload,
              status: 'proposed',
              pipelineVersion: 1,
              dedupeKey,
              updatedAt: nowServer,
              expiresAt,
            });
            return;
          }
          const doc: AssistantSuggestionDoc = {
            objectId,
            source: { type: 'note', id: noteId },
            kind: kind as any,
            payload,
            status: 'proposed',
            pipelineVersion: 1,
            dedupeKey,
            createdAt: nowServer,
            updatedAt: nowServer,
            expiresAt,
          };
          tx.create(sugRef, doc);
        });
      }
    }

    await jobDoc.ref.update({
      status: 'done',
      lockedUntil: admin.firestore.Timestamp.fromMillis(0),
      pendingTextHash: null,
      resultId: usedResultId,
      model: usedModel,
      modelRequested: requestedModel || null,
      modelFallbackUsed: fallbackUsed,
      error: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    if (e instanceof OpenAIHttpError) {
      console.error('openai.request_failed', {
        userId,
        jobId: jobDoc.id,
        modelRequested: requestedModel || null,
        modelPrimary: typeof primaryModel === 'string' ? primaryModel : null,
        modelFallback: typeof fallbackModel === 'string' ? fallbackModel : null,
        modelUsed: typeof usedModel === 'string' ? usedModel : null,
        modelFallbackUsed: fallbackUsed,
        status: e.status,
        code: e.code,
        type: e.type,
        message: e.message,
        requestId: e.requestId,
        projectHeader: e.projectHeader,
      });
    }
    try {
      console.error('assistant AI job failed', {
        userId,
        jobId: jobDoc.id,
        message: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
      });
    } catch {
      // ignore
    }
    await jobDoc.ref.update({
      status: 'error',
      lockedUntil: admin.firestore.Timestamp.fromMillis(0),
      ...(requestedModel ? { modelRequested: requestedModel } : {}),
      ...(fallbackUsed ? { modelFallbackUsed: fallbackUsed } : {}),
      ...(usedModel ? { model: usedModel } : {}),
      error: e instanceof Error ? e.message : 'AI job error',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    try {
      await metricsRef.set(metricsIncrements({ aiAnalysesErrored: 1 }), { merge: true });
    } catch {
      // ignore
    }
  }
}

export const assistantRunAIJobQueue = functions.pubsub
  .schedule('every 1 minutes')
  .onRun(async () => {
    const db = admin.firestore();
    const nowDate = new Date();
    const nowTs = admin.firestore.Timestamp.fromDate(nowDate);

    const snap = await db
      .collectionGroup('assistantAIJobs')
      .where('status', '==', 'queued')
      .where('lockedUntil', '<=', nowTs)
      .orderBy('lockedUntil', 'asc')
      .limit(10)
      .get();

    if (snap.empty) {
      return;
    }

    const tasks = snap.docs.map(async (jobDoc) => {
      const userRef = jobDoc.ref.parent.parent;
      const userId = userRef?.id;
      if (!userId) return;

      const enabled = await isAssistantEnabledForUser(db, userId);
      if (!enabled) return;

      await processAssistantAIJob({ db, userId, jobDoc, nowDate, nowTs });
    });

    await Promise.all(tasks);
  });
