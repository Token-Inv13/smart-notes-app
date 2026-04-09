import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import * as functions from 'firebase-functions/v1';

/**
 * OpenAI Custom Error
 */
export class OpenAIHttpError extends Error {
  status: number;
  code: string | null;
  type: string | null;
  param: string | null;
  requestId: string | null;
  projectHeader: string | null;

  constructor(params: {
    status: number;
    message: string;
    code: string | null;
    type: string | null;
    param: string | null;
    requestId: string | null;
    projectHeader: string | null;
  }) {
    super(params.message);
    this.name = 'OpenAIHttpError';
    this.status = params.status;
    this.code = params.code;
    this.type = params.type;
    this.param = params.param;
    this.requestId = params.requestId;
    this.projectHeader = params.projectHeader;
  }
}

// --- Types ---

export type AssistantSuggestionKind =
  | 'create_task'
  | 'create_reminder'
  | 'create_task_bundle'
  | 'update_task_meta'
  | 'suggest_workspace'
  | 'summarize_note';

export type AssistantSuggestionPayload = Record<string, any>;

export type AssistantJtbdPreset = 'daily_planning' | 'dont_forget' | 'meetings' | 'projects';

export type AssistantSettingsLite = {
  enabled: boolean;
  jtbdPreset: AssistantJtbdPreset;
};

export type AssistantMemoryLiteDefaults = {
  defaultPriority?: 'low' | 'medium' | 'high';
  defaultReminderHour?: number;
};

export type AssistantTaskBundleTask = {
  title: string;
  priority?: 'low' | 'medium' | 'high';
  origin: { fromText: string };
};

export type DetectedIntent = {
  intent: 'PAYER' | 'APPELER' | 'PRENDRE_RDV';
  title: string;
  originFromText: string;
  explanation: string;
  kind: AssistantSuggestionKind;
  dueDate?: admin.firestore.Timestamp;
  remindAt?: admin.firestore.Timestamp;
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

export type DetectedBundle = {
  title: string;
  tasks: AssistantTaskBundleTask[];
  bundleMode: 'multiple_tasks';
  originFromText: string;
  explanation: string;
  confidence: number;
  dedupeMinimal: {
    title: string;
    tasksSig: string;
  };
};

// --- Helpers ---

export function normalizeAssistantText(raw: unknown): string {
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

export function decodeBasicHtmlEntities(raw: string): string {
  return raw
    .replace(/&(nbsp|amp|lt|gt|#39|apos|quot);/gi, (match) => {
      const k = match.toLowerCase();
      if (k === '&nbsp;') return ' ';
      if (k === '&amp;') return '&';
      if (k === '&lt;') return '<';
      if (k === '&gt;') return '>';
      if (k === '&#39;' || k === '&apos;') return "'";
      if (k === '&quot;') return '"';
      return match;
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = Number(dec);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '';
      return String.fromCodePoint(code);
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '';
      return String.fromCodePoint(code);
    });
}

export function sanitizeAssistantSnippet(raw: unknown): string {
  const input = typeof raw === 'string' ? raw : '';
  const decoded = decodeBasicHtmlEntities(input.replace(/\r\n?/g, '\n'));
  return decoded
    .replace(/<style[\s\S]*?(<\/style>|$)/gi, ' ')
    .replace(/<script[\s\S]*?(<\/script>|$)/gi, ' ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/?\s*(div|p|li|h[1-6]|section|article|blockquote|pre|ul|ol|tr)\b[^>]*>/gi, '\n')
    .replace(/<\/?[a-z][^>\n]*>/gi, ' ')
    .replace(/<\/?[a-z][^>\n]*$/gim, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function clampFromText(raw: string, maxLen: number): string {
  const s = sanitizeAssistantSnippet(raw ?? '');
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1).trim()}…`;
}

export function normalizeForIntentMatch(raw: string): string {
  return normalizeAssistantText(raw);
}

export function parsePriorityInText(text: string): 'low' | 'medium' | 'high' | null {
  const t = normalizeForIntentMatch(text);
  if (t.includes('pas urgent') || t.includes('non urgent') || t.includes('facultatif')) return 'low';
  if (t.includes('urgent') || t.includes('prioritaire')) return 'high';
  if (t.includes('important')) return 'medium';
  return null;
}

export function hasReminderKeyword(text: string): boolean {
  const t = normalizeForIntentMatch(text);
  return t.includes('rappel') || t.includes('rappeler') || t.includes('me rappeler');
}

export function addDays(d: Date, days: number): Date {
  const next = new Date(d.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

export function startOfDay(d: Date): Date {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x;
}

export function composeDateTime(params: {
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

export function parseTimeInText(text: string): { hours: number; minutes: number; index: number } | null {
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

export function parseDateInText(text: string, now: Date): { date: Date; index: number } | null {
  const t = normalizeForIntentMatch(text);
  const idxToday = t.indexOf("aujourd'hui");
  if (idxToday >= 0) return { date: startOfDay(now), index: idxToday };
  const idxTomorrow = t.indexOf('demain');
  if (idxTomorrow >= 0) return { date: addDays(startOfDay(now), 1), index: idxTomorrow };
  // Add more logic here if needed from the original file
  return null;
}

// --- OpenAI API Calls ---

// --- Interfaces ---

interface OpenAIError {
  message?: string;
  code?: string;
  type?: string;
  param?: string;
}

interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface OpenAIResponse {
  output_text: string;
  refusal?: string | null;
  usage?: OpenAIUsage;
}

// --- OpenAI API Calls ---

function getOpenAIApiKey(): string {
  const envKey = typeof process.env.OPENAI_API_KEY === "string" ? process.env.OPENAI_API_KEY.trim() : "";
  if (envKey) return envKey;
  throw new functions.https.HttpsError("failed-precondition", "Missing OpenAI API key configuration.");
}

function getOpenAIProjectHeader(): string | null {
  const raw = typeof process.env.OPENAI_PROJECT === "string" ? process.env.OPENAI_PROJECT.trim() : "";
  return raw ? raw : null;
}

export async function callOpenAIResponsesJson(params: {
  model: string;
  instructions: string;
  inputText: string;
}): Promise<{ parsed: any; refusal: string | null; usage: OpenAIUsage | null }> {
  const apiKey = getOpenAIApiKey();
  const projectHeader = getOpenAIProjectHeader();

  const body = {
    model: params.model,
    instructions: params.instructions,
    input: [{ role: "user", content: params.inputText }],
    response_format: { type: "json_object" },
    store: false,
  };

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(projectHeader ? { "OpenAI-Project": projectHeader } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const requestId = res.headers.get("x-request-id");
    const errObj = (await res.json().catch(() => ({}))) as { error?: OpenAIError };
    const errInner = errObj?.error || {};
    throw new OpenAIHttpError({
      status: res.status,
      message: `OpenAI error: ${res.status} ${errInner.message || "Unknown error"}`.slice(0, 800),
      code: errInner.code || null,
      type: errInner.type || null,
      param: errInner.param || null,
      requestId,
      projectHeader,
    });
  }

  const json = (await res.json()) as OpenAIResponse;
  const outputText = json?.output_text || "";
  return {
    parsed: outputText ? JSON.parse(outputText) : null,
    refusal: json?.refusal || null,
    usage: json?.usage || null,
  };
}

// --- Intent Detection ---

export function extractBundleTaskTitlesFromText(rawText: string): { title: string; originFromText: string }[] {
  const out: { title: string; originFromText: string }[] = [];
  const add = (title: string, originFromText: string) => {
    const t = sanitizeAssistantSnippet(title).replace(/\s+/g, " ").trim();
    if (!t) return;
    out.push({ title: t, originFromText: clampFromText(originFromText, 120) });
  };

  const lines = rawText.split(/\r?\n/);
  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line) continue;
    if (/^cr[ée]e?\s+le\b/i.test(line)) continue;
    const todoLike = /^\s*([-*•]|\d+[\.)]|\[ \]|\[x\]|\[X\]|todo\s*:)/i.test(line);
    if (todoLike) {
      const cleaned = line.replace(/^\s*([-*•]|\d+[\.)]|\[ \]|\[x\]|\[X\]|todo\s*:)+\s*/i, "").trim();
      if (cleaned) add(cleaned, lineRaw);
    }
  }
  return out;
}

export function detectIntentsV1(params: { title: string; content: string; now: Date; memory?: AssistantMemoryLiteDefaults }): DetectedIntent[] {
  const { title, content, now } = params;
  const memory = params.memory;
  const rawText = `${title}\n${content}`;
  const textNorm = normalizeForIntentMatch(rawText);

  const priorityInText = parsePriorityInText(rawText);
  const reminderKeyword = hasReminderKeyword(rawText);
  const dateHit = parseDateInText(rawText, now);
  const timeHit = parseTimeInText(rawText);
  const dtFinal = composeDateTime({
    now,
    baseDate: dateHit ? dateHit.date : null,
    time: timeHit ? { hours: timeHit.hours, minutes: timeHit.minutes } : null,
  });

  const dtTs = dtFinal ? admin.firestore.Timestamp.fromDate(dtFinal) : null;
  const intents: DetectedIntent[] = [];
  const finalPriority = priorityInText ?? (memory?.defaultPriority ?? undefined);

  if (textNorm.includes("payer") || textNorm.includes("regler")) {
    const kind: AssistantSuggestionKind = dtTs && (timeHit || reminderKeyword) ? "create_reminder" : "create_task";
    const sugTitle = "Payer facture";
    intents.push({
      intent: "PAYER",
      title: sugTitle,
      originFromText: "payer",
      explanation: "Détecté une intention de paiement dans la note.",
      kind,
      dueDate: kind === "create_task" && dtTs ? dtTs : undefined,
      remindAt: kind === "create_reminder" && dtTs ? dtTs : undefined,
      ...(finalPriority ? { priority: finalPriority } : {}),
      confidence: 0.8,
      dedupeMinimal: { title: sugTitle, dueDateMs: dtTs?.toMillis(), remindAtMs: dtTs?.toMillis() },
    });
  }

  return intents;
}

export function detectIntentsV2(params: {
  title: string;
  content: string;
  now: Date;
  memory?: AssistantMemoryLiteDefaults;
}): { single: DetectedIntent | null; bundle: DetectedBundle | null } {
  const { title, content, now } = params;
  const rawText = `${title}\n${content}`;
  const items = extractBundleTaskTitlesFromText(rawText);

  if (items.length === 0) {
    const v1 = detectIntentsV1({ title, content, now, memory: params.memory });
    return { single: v1[0] || null, bundle: null };
  }

  if (items.length > 1) {
    const limited = items.slice(0, 6);
    const bundle: DetectedBundle = {
      title: "Plan d’action",
      tasks: limited.map((it) => ({ title: it.title, origin: { fromText: it.originFromText } })),
      bundleMode: "multiple_tasks",
      originFromText: limited[0].originFromText,
      explanation: "Plusieurs tâches détectées.",
      confidence: 0.8,
      dedupeMinimal: { title: "Plan d’action", tasksSig: sha256Hex(limited.map((l) => l.title).join("|")) },
    };
    return { single: null, bundle };
  }

  return { single: null, bundle: null };
}

// --- Status & Settings ---

export async function getAssistantSettingsForUser(db: admin.firestore.Firestore, userId: string): Promise<AssistantSettingsLite> {
  const snap = await db.collection("users").doc(userId).collection("assistantSettings").doc("main").get();
  if (!snap.exists) return { enabled: false, jtbdPreset: "daily_planning" };
  const data = snap.data() as { enabled?: boolean; jtbdPreset?: AssistantJtbdPreset };
  return {
    enabled: data?.enabled === true,
    jtbdPreset: data?.jtbdPreset || "daily_planning",
  };
}

export function assistantObjectIdForNote(noteId: string): string {
  return `note_${noteId}`;
}

export function computeAssistantSuggestionRankScore(params: {
  jtbdPreset: AssistantJtbdPreset;
  kind: AssistantSuggestionKind;
  sourceType: 'note' | 'todo';
  payload: AssistantSuggestionPayload;
}): number {
  return 50; // Simplified for now
}
