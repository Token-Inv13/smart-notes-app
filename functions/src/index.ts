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
  collection: 'notes';
  id: string;
};

type AssistantObjectDoc = {
  objectId: string;
  type: 'note';
  coreRef: AssistantCoreRef;
  textHash: string;
  pendingTextHash?: string | null;
  pipelineVersion: 1;
  status: AssistantObjectStatus;
  lastAnalyzedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | null;
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

  const body: Record<string, any> = {
    model: params.model,
    instructions: params.instructions,
    input: params.inputText,
    text: {
      format: {
        type: 'json_schema',
        strict: true,
        schema: params.schema,
      },
    },
    temperature: 0.2,
    store: false,
  };

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`OpenAI error: ${res.status} ${t}`.slice(0, 800));
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

async function isAssistantEnabledForUser(db: FirebaseFirestore.Firestore, userId: string): Promise<boolean> {
  const snap = await db
    .collection('users')
    .doc(userId)
    .collection('assistantSettings')
    .doc('main')
    .get();
  return snap.exists && snap.data()?.enabled === true;
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

      const enabled = await isAssistantEnabledForUser(db, userId);
      if (!enabled) return;

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
          const noteId = coreRef?.collection === 'notes' && typeof coreRef?.id === 'string' ? coreRef.id : null;

          if (noteId) {
            const noteSnap = await db.collection('notes').doc(noteId).get();
            const note = noteSnap.exists ? (noteSnap.data() as any) : null;

            const noteUserId = typeof note?.userId === 'string' ? note.userId : null;
            if (note && noteUserId === userId) {
              const noteTitle = typeof note?.title === 'string' ? note.title : '';
              const noteContent = typeof note?.content === 'string' ? note.content : '';

              const normalized = normalizeAssistantText(`${noteTitle}\n${noteContent}`);
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

              const v2 = detectIntentsV2({ title: noteTitle, content: noteContent, now: nowDate, memory: memoryDefaults });
              const detectedSingle = v2.single ? [v2.single] : [];
              const detectedBundle = v2.bundle;

              console.log('assistant intents detected', {
                userId,
                noteId,
                objectId,
                hasSingle: detectedSingle.length > 0,
                hasBundle: !!detectedBundle,
              });

              if (detectedSingle.length > 0 || detectedBundle) {
                const suggestionsCol = db.collection('users').doc(userId).collection('assistantSuggestions');
                const expiresAt = admin.firestore.Timestamp.fromMillis(nowDate.getTime() + 14 * 24 * 60 * 60 * 1000);
                const nowServer = admin.firestore.FieldValue.serverTimestamp();

                const candidates: Array<{ kind: AssistantSuggestionKind; payload: AssistantSuggestionPayload; dedupeKey: string; metricsInc: Partial<Record<keyof AssistantMetricsDoc, number>> }> = [];

                if (detectedBundle) {
                  const dedupeKey = buildBundleDedupeKey({ objectId, minimal: detectedBundle.dedupeMinimal });
                  const payload: AssistantSuggestionPayload = {
                    title: detectedBundle.title,
                    tasks: detectedBundle.tasks,
                    bundleMode: detectedBundle.bundleMode,
                    noteId,
                    origin: { fromText: detectedBundle.originFromText },
                    confidence: detectedBundle.confidence,
                    explanation: detectedBundle.explanation,
                  };
                  candidates.push({
                    kind: 'create_task_bundle',
                    payload,
                    dedupeKey,
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
                    candidates.push({
                      kind: d.kind,
                      payload,
                      dedupeKey,
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
                  noteId,
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
                        source: { type: 'note', id: noteId },
                        kind: c.kind,
                        payload: c.payload,
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
                      source: { type: 'note', id: noteId },
                      kind: c.kind,
                      payload: c.payload,
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
    followupEnabled = suggestion.source.type === 'note';

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

  const modelRaw = typeof (data as any)?.model === 'string' ? String((data as any).model) : '';
  const model = modelRaw === 'gpt-5' || modelRaw === 'gpt-5-mini' ? modelRaw : 'gpt-5-mini';

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
  const model = typeof claimed.model === 'string' ? claimed.model : 'gpt-5-mini';
  const schemaVersion = typeof claimed.schemaVersion === 'number' ? Math.trunc(claimed.schemaVersion) : ASSISTANT_AI_SCHEMA_VERSION;
  const modes = Array.isArray((claimed as any)?.modes) ? ((claimed as any).modes as unknown[]).filter((m) => typeof m === 'string').map((m) => String(m)) : [];

  if (!noteId || !objectId) return;

  const metricsRef = assistantMetricsRef(db, userId);
  const userRef = db.collection('users').doc(userId);

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
    const resultId = sha256Hex(`${objectId}|${textHash}|${model}|schema:${schemaVersion}|modes:${modesSig}`);
    const resultRef = userRef.collection('assistantAIResults').doc(resultId);

    const existing = await resultRef.get();
    if (existing.exists) {
      await jobDoc.ref.update({ status: 'done', lockedUntil: admin.firestore.Timestamp.fromMillis(0), pendingTextHash: null, resultId, error: null, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
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

    const llm = await callOpenAIResponsesJsonSchema({ model, instructions, inputText, schema: ASSISTANT_AI_OUTPUT_SCHEMA_V1 });

    const nowServer = admin.firestore.FieldValue.serverTimestamp();
    const resultDoc: AssistantAIResultDoc = {
      noteId,
      objectId,
      textHash,
      model,
      schemaVersion,
      modes,
      refusal: llm.refusal,
      usage: llm.usage ? { inputTokens: llm.usage.inputTokens, outputTokens: llm.usage.outputTokens, totalTokens: llm.usage.totalTokens } : undefined,
      output: llm.parsed ?? undefined,
      createdAt: nowServer,
      updatedAt: nowServer,
    };

    await resultRef.create(resultDoc);

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
      resultId,
      error: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    await jobDoc.ref.update({
      status: 'error',
      lockedUntil: admin.firestore.Timestamp.fromMillis(0),
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
