"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assistantRunAIJobQueue = exports.assistantRequestAIAnalysis = exports.assistantRequestReanalysis = exports.assistantRejectSuggestion = exports.assistantApplySuggestion = exports.assistantRunJobQueue = exports.assistantEnqueueNoteJob = exports.testSendReminderEmail = exports.cleanupOldReminders = exports.assistantPurgeExpiredSuggestions = exports.assistantExpireSuggestions = exports.checkAndSendReminders = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
const crypto_1 = require("crypto");
admin.initializeApp();
const ASSISTANT_REANALYSIS_FREE_DAILY_LIMIT = 10;
const ASSISTANT_REANALYSIS_PRO_DAILY_LIMIT = 200;
const ASSISTANT_AI_ANALYSIS_FREE_DAILY_LIMIT = 2;
const ASSISTANT_AI_ANALYSIS_PRO_DAILY_LIMIT = 100;
const ASSISTANT_FOLLOWUP_REJECT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
function utcDayKey(d) {
    return d.toISOString().slice(0, 10);
}
function assistantCurrentJobIdForObject(objectId) {
    return `current_${objectId}`;
}
function assistantMetricsRef(db, userId) {
    return db.collection('users').doc(userId).collection('assistantMetrics').doc('main');
}
function assistantMemoryLiteRef(db, userId) {
    return db.collection('users').doc(userId).collection('assistantMemoryLite').doc('main');
}
function assistantUsageRef(db, userId, dayKey) {
    return db.collection('users').doc(userId).collection('assistantUsage').doc(dayKey);
}
function assistantAIJobIdForNote(noteId) {
    return `current_note_${noteId}`;
}
function metricsIncrements(inc) {
    const out = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    for (const [k, v] of Object.entries(inc)) {
        if (typeof v === 'number' && Number.isFinite(v) && v !== 0) {
            out[k] = admin.firestore.FieldValue.increment(v);
        }
    }
    return out;
}
function normalizeAssistantText(raw) {
    const s = typeof raw === 'string' ? raw : '';
    try {
        return s
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }
    catch (_a) {
        return s.toLowerCase().replace(/\s+/g, ' ').trim();
    }
}
function sha256Hex(input) {
    return (0, crypto_1.createHash)('sha256').update(input).digest('hex');
}
function clampFromText(raw, maxLen) {
    const s = (raw !== null && raw !== void 0 ? raw : '').trim();
    if (s.length <= maxLen)
        return s;
    return `${s.slice(0, maxLen - 1).trim()}…`;
}
function normalizeForIntentMatch(raw) {
    return normalizeAssistantText(raw);
}
function parsePriorityInText(text) {
    const t = normalizeForIntentMatch(text);
    if (t.includes('pas urgent') || t.includes('non urgent') || t.includes('facultatif'))
        return 'low';
    if (t.includes('urgent') || t.includes('prioritaire'))
        return 'high';
    if (t.includes('important'))
        return 'medium';
    return null;
}
function hasReminderKeyword(text) {
    const t = normalizeForIntentMatch(text);
    return t.includes('rappel') || t.includes('rappeler') || t.includes('me rappeler');
}
function addDays(d, days) {
    const next = new Date(d.getTime());
    next.setDate(next.getDate() + days);
    return next;
}
function startOfDay(d) {
    const x = new Date(d.getTime());
    x.setHours(0, 0, 0, 0);
    return x;
}
function nextOccurrenceOfWeekday(now, weekday) {
    const today = now.getDay();
    let delta = (weekday - today + 7) % 7;
    if (delta === 0)
        delta = 7;
    return addDays(startOfDay(now), delta);
}
function parseTimeInText(text) {
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
function parseDateInText(text, now) {
    const t = normalizeForIntentMatch(text);
    const idxToday = t.indexOf("aujourd'hui");
    if (idxToday >= 0) {
        return { date: startOfDay(now), index: idxToday };
    }
    const idxTomorrow = t.indexOf('demain');
    if (idxTomorrow >= 0) {
        return { date: startOfDay(addDays(now, 1)), index: idxTomorrow };
    }
    const weekdayMap = {
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
        let yyyy;
        if (m[3]) {
            const raw = Number(m[3]);
            yyyy = raw < 100 ? 2000 + raw : raw;
        }
        else {
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
function composeDateTime(params) {
    const { now, baseDate, time } = params;
    if (!baseDate && !time)
        return null;
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
function buildSuggestionDedupeKey(params) {
    var _a, _b;
    const { objectId, kind, minimal } = params;
    const payloadMinimal = JSON.stringify({
        title: normalizeAssistantText(minimal.title),
        dueDateMs: (_a = minimal.dueDateMs) !== null && _a !== void 0 ? _a : null,
        remindAtMs: (_b = minimal.remindAtMs) !== null && _b !== void 0 ? _b : null,
    });
    return sha256Hex(`${objectId}|${kind}|${payloadMinimal}`);
}
function buildBundleDedupeKey(params) {
    const { objectId, minimal } = params;
    const payloadMinimal = JSON.stringify({
        title: normalizeAssistantText(minimal.title),
        tasksSig: minimal.tasksSig,
    });
    return sha256Hex(`${objectId}|create_task_bundle|${payloadMinimal}`);
}
function buildFollowupDedupeKey(params) {
    const payloadMinimal = JSON.stringify(params.minimal);
    return sha256Hex(`task_${params.taskId}|${params.kind}|${payloadMinimal}`);
}
function buildContentDedupeKey(params) {
    const payloadMinimal = JSON.stringify(params.minimal);
    return sha256Hex(`${params.objectId}|${params.kind}|${payloadMinimal}`);
}
function parseIsoToTimestamp(iso) {
    if (typeof iso !== 'string')
        return undefined;
    const s = iso.trim();
    if (!s)
        return undefined;
    const d = new Date(s);
    if (!Number.isFinite(d.getTime()))
        return undefined;
    return admin.firestore.Timestamp.fromDate(d);
}
function getOpenAIApiKey() {
    const envKey = typeof process.env.OPENAI_API_KEY === 'string' ? process.env.OPENAI_API_KEY.trim() : '';
    if (envKey)
        return envKey;
    throw new functions.https.HttpsError('failed-precondition', 'Missing OpenAI API key configuration.');
}
function getAssistantAIDefaultModel() {
    const raw = typeof process.env.ASSISTANT_AI_MODEL === 'string' ? process.env.ASSISTANT_AI_MODEL.trim() : '';
    return raw || 'gpt-4o-mini';
}
function normalizeAssistantAIModel(rawModel) {
    const s = typeof rawModel === 'string' ? rawModel.trim() : '';
    if (!s)
        return getAssistantAIDefaultModel();
    return s.slice(0, 64);
}
function isOpenAIModelAccessError(err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg)
        return false;
    return msg.includes('model_not_found') || msg.includes('does not have access to model');
}
const ASSISTANT_AI_SCHEMA_VERSION = 1;
const ASSISTANT_AI_OUTPUT_SCHEMA_V1 = {
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
async function callOpenAIResponsesJsonSchema(params) {
    var _a, _b, _c;
    const apiKey = getOpenAIApiKey();
    const body = {
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
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`OpenAI error: ${res.status} ${t}`.slice(0, 800));
    }
    const json = (await res.json());
    const usage = json && typeof (json === null || json === void 0 ? void 0 : json.usage) === 'object' && json.usage
        ? {
            inputTokens: typeof ((_a = json.usage) === null || _a === void 0 ? void 0 : _a.input_tokens) === 'number' ? Number(json.usage.input_tokens) : undefined,
            outputTokens: typeof ((_b = json.usage) === null || _b === void 0 ? void 0 : _b.output_tokens) === 'number' ? Number(json.usage.output_tokens) : undefined,
            totalTokens: typeof ((_c = json.usage) === null || _c === void 0 ? void 0 : _c.total_tokens) === 'number' ? Number(json.usage.total_tokens) : undefined,
        }
        : null;
    let refusal = null;
    const output = Array.isArray(json === null || json === void 0 ? void 0 : json.output) ? json.output : [];
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
    let outputText = typeof (json === null || json === void 0 ? void 0 : json.output_text) === 'string' ? String(json.output_text) : null;
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
            if (outputText)
                break;
        }
    }
    if (!outputText) {
        return { parsed: null, refusal, usage };
    }
    const parsed = JSON.parse(outputText);
    return { parsed, refusal, usage };
}
function extractBundleTaskTitlesFromText(rawText) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const out = [];
    const add = (title, originFromText) => {
        const t = title.replace(/\s+/g, ' ').trim();
        if (!t)
            return;
        out.push({ title: t, originFromText: clampFromText(originFromText, 120) });
    };
    const payRe = /\b(payer|r[ée]gler)\b\s+([^\n\r\.,;]+)/gi;
    for (const m of rawText.matchAll(payRe)) {
        const obj = String((_a = m[2]) !== null && _a !== void 0 ? _a : '').trim();
        add(`Payer ${obj || 'facture'}`, String((_b = m[0]) !== null && _b !== void 0 ? _b : 'payer'));
    }
    const callRe = /\b(appeler|t[ée]l[ée]phoner|t[ée]l[ée]phone|tel|phone)\b\s+([^\n\r\.,;]+)/gi;
    for (const m of rawText.matchAll(callRe)) {
        const obj = String((_c = m[2]) !== null && _c !== void 0 ? _c : '').trim();
        add(`Appeler ${obj || 'quelqu’un'}`, String((_d = m[0]) !== null && _d !== void 0 ? _d : 'appeler'));
    }
    const rdvRe = /\b(prendre\s+rdv|prendre\s+rendez-vous|rdv|rendez-vous|r[ée]server)\b\s*([^\n\r\.,;]+)?/gi;
    for (const m of rawText.matchAll(rdvRe)) {
        const obj = String((_e = m[2]) !== null && _e !== void 0 ? _e : '').trim();
        const base = obj ? `Prendre RDV ${obj}` : 'Prendre RDV';
        add(base, String((_f = m[0]) !== null && _f !== void 0 ? _f : 'rdv'));
    }
    const freeActionRe = /\b(je\s+dois|il\s+faut|a\s+faire|à\s+faire|objectif\s*:|pour\s+but|pour\s+objectif)\b\s*(?:d'|de\s+)?([^\n\r\.,;]+)/gi;
    for (const m of rawText.matchAll(freeActionRe)) {
        const action = String((_g = m[2]) !== null && _g !== void 0 ? _g : '').trim();
        if (!action)
            continue;
        add(action, String((_h = m[0]) !== null && _h !== void 0 ? _h : action));
    }
    const lines = rawText.split(/\r?\n/);
    for (const lineRaw of lines) {
        const line = lineRaw.trim();
        if (!line)
            continue;
        const todoLike = /^\s*([-*•]|\d+[\.)]|\[ \]|\[x\]|\[X\]|todo\s*:)/i.test(line) ||
            /\bTODO\b/i.test(line);
        if (todoLike) {
            const cleaned = line
                .replace(/^\s*([-*•]|\d+[\.)]|\[ \]|\[x\]|\[X\]|todo\s*:)+\s*/i, '')
                .trim();
            if (!cleaned)
                continue;
            const normalized = cleaned.replace(/^[\-–—]+\s*/, '').trim();
            if (!normalized)
                continue;
            add(normalized, lineRaw);
            continue;
        }
        // Roadmap-like lines (common in notes): "Implémentation ...", "Ajout ...", etc.
        // Keep this conservative to avoid turning metadata into tasks.
        if (/^cr[ée]e?\s+le\b/i.test(line))
            continue;
        if (/^derni[eè]re\s+mise\s+[àa]\s+jour\b/i.test(line))
            continue;
        const roadmapMatch = line.match(/^\s*(impl[ée]mentation|implementation|ajout|ajouter|cr[ée]ation|cr[ée]er|cr[ée]e|corriger|correction|fix|mise\s+[àa]\s+jour|mettre\s+[àa]\s+jour|d[ée]ployer|d[ée]ploiement|refactor|refonte|optimisation)\b\s*(?::\s*)?(.*)$/i);
        if (!roadmapMatch)
            continue;
        const rawPrefix = String((_j = roadmapMatch[1]) !== null && _j !== void 0 ? _j : '').toLowerCase();
        const restRaw = String((_k = roadmapMatch[2]) !== null && _k !== void 0 ? _k : '').trim();
        // Avoid lines that are basically just dates/metadata.
        if (restRaw && /^(le\s+\d|\d{1,2}\/\d{1,2}\/\d{2,4})/i.test(restRaw))
            continue;
        const verb = (() => {
            if (rawPrefix.startsWith('impl'))
                return 'Implémenter';
            if (rawPrefix.startsWith('implement'))
                return 'Implémenter';
            if (rawPrefix.startsWith('ajout') || rawPrefix.startsWith('ajouter'))
                return 'Ajouter';
            if (rawPrefix.startsWith('cr'))
                return 'Créer';
            if (rawPrefix.startsWith('corr'))
                return 'Corriger';
            if (rawPrefix.startsWith('fix'))
                return 'Corriger';
            if (rawPrefix.includes('mise') || rawPrefix.startsWith('mettre'))
                return 'Mettre à jour';
            if (rawPrefix.startsWith('d') && rawPrefix.includes('ploi'))
                return 'Déployer';
            if (rawPrefix.startsWith('refactor') || rawPrefix.startsWith('refonte'))
                return 'Refactorer';
            if (rawPrefix.startsWith('optim'))
                return 'Optimiser';
            return 'Faire';
        })();
        const rest = restRaw.replace(/^[\-–—]+\s*/, '').trim();
        const title = rest ? `${verb} ${rest}` : verb;
        add(title, lineRaw);
    }
    const seen = new Set();
    const deduped = [];
    for (const item of out) {
        const key = normalizeAssistantText(item.title);
        if (!key)
            continue;
        if (seen.has(key))
            continue;
        seen.add(key);
        deduped.push(item);
    }
    return deduped;
}
function detectIntentsV2(params) {
    var _a, _b, _c, _d, _e;
    const { title, content, now } = params;
    const memory = params.memory;
    const rawText = `${title}\n${content}`;
    const priorityInText = parsePriorityInText(rawText);
    const reminderKeyword = hasReminderKeyword(rawText);
    const items = extractBundleTaskTitlesFromText(rawText);
    if (items.length === 0) {
        const v1 = detectIntentsV1({ title, content, now, memory });
        if (v1.length >= 1)
            return { single: v1[0], bundle: null };
        return { single: null, bundle: null };
    }
    if (items.length === 1) {
        const v1 = detectIntentsV1({ title, content, now, memory });
        if (v1.length === 1)
            return { single: v1[0], bundle: null };
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
        if (dt && dtHit && !timeHit && reminderKeyword && typeof (memory === null || memory === void 0 ? void 0 : memory.defaultReminderHour) === 'number') {
            const h = Math.trunc(memory.defaultReminderHour);
            if (Number.isFinite(h) && h >= 0 && h <= 23) {
                const next = new Date(startOfDay(dtHit.date).getTime());
                next.setHours(h, 0, 0, 0);
                dt = next;
                appliedDefaultReminderHour = true;
            }
        }
        const dtTs = dt ? admin.firestore.Timestamp.fromDate(dt) : null;
        const kind = dtTs && (timeHit || reminderKeyword) ? 'create_reminder' : 'create_task';
        const appliedDefaultPriority = !priorityInText && !!(memory === null || memory === void 0 ? void 0 : memory.defaultPriority);
        const finalPriority = priorityInText !== null && priorityInText !== void 0 ? priorityInText : ((_a = memory === null || memory === void 0 ? void 0 : memory.defaultPriority) !== null && _a !== void 0 ? _a : undefined);
        const single = Object.assign(Object.assign(Object.assign(Object.assign({ intent: 'PAYER', title: sugTitle, originFromText: only.originFromText, explanation: `Détecté une action dans la note.`, kind, dueDate: kind === 'create_task' && dtTs ? dtTs : undefined, remindAt: kind === 'create_reminder' && dtTs ? dtTs : undefined }, (finalPriority ? { priority: finalPriority } : {})), (appliedDefaultPriority ? { appliedDefaultPriority: true } : {})), (appliedDefaultReminderHour ? { appliedDefaultReminderHour: true } : {})), { confidence: 0.75, dedupeMinimal: {
                title: sugTitle,
                dueDateMs: kind === 'create_task' && dtTs ? dtTs.toMillis() : undefined,
                remindAtMs: kind === 'create_reminder' && dtTs ? dtTs.toMillis() : undefined,
            } });
        return { single, bundle: null };
    }
    const limited = items.slice(0, 6);
    const extraCount = Math.max(0, items.length - limited.length);
    const appliedDefaultPriority = !priorityInText && !!(memory === null || memory === void 0 ? void 0 : memory.defaultPriority);
    const tasks = limited.map((it) => (Object.assign(Object.assign({ title: it.title }, (appliedDefaultPriority && (memory === null || memory === void 0 ? void 0 : memory.defaultPriority) ? { priority: memory.defaultPriority } : {})), { origin: { fromText: it.originFromText } })));
    const bundleTitle = `Plan d’action — ${(_c = (_b = limited[0]) === null || _b === void 0 ? void 0 : _b.title) !== null && _c !== void 0 ? _c : 'Votre note'}`;
    const tasksSig = sha256Hex(limited.map((t) => normalizeAssistantText(t.title)).join('|'));
    const explanation = extraCount > 0 ? `Plan d’action détecté (+${extraCount} autres).` : `Plan d’action détecté.`;
    const bundle = Object.assign(Object.assign({ title: bundleTitle, tasks, bundleMode: 'multiple_tasks', originFromText: (_e = (_d = limited[0]) === null || _d === void 0 ? void 0 : _d.originFromText) !== null && _e !== void 0 ? _e : clampFromText(rawText, 120), explanation, confidence: 0.8 }, (appliedDefaultPriority ? { appliedDefaultPriority: true } : {})), { dedupeMinimal: {
            title: bundleTitle,
            tasksSig,
        } });
    return { single: null, bundle };
}
function detectIntentsV1(params) {
    var _a, _b, _c, _d;
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
    if (dtFinal && dateHit && !timeHit && reminderKeyword && typeof (memory === null || memory === void 0 ? void 0 : memory.defaultReminderHour) === 'number') {
        const h = Math.trunc(memory.defaultReminderHour);
        if (Number.isFinite(h) && h >= 0 && h <= 23) {
            const next = new Date(startOfDay(dateHit.date).getTime());
            next.setHours(h, 0, 0, 0);
            dtFinal = next;
            appliedDefaultReminderHour = true;
        }
    }
    const dtTs = dtFinal ? admin.firestore.Timestamp.fromDate(dtFinal) : null;
    const intents = [];
    const add = (next) => {
        var _a;
        const confidence = next.confidence;
        if (confidence < 0.7)
            return;
        const minimal = (_a = next.dedupeMinimal) !== null && _a !== void 0 ? _a : {
            title: next.title,
            dueDateMs: next.dueDate ? next.dueDate.toMillis() : undefined,
            remindAtMs: next.remindAt ? next.remindAt.toMillis() : undefined,
        };
        intents.push(Object.assign(Object.assign({}, next), { confidence, dedupeMinimal: minimal }));
    };
    const appliedDefaultPriority = !priorityInText && !!(memory === null || memory === void 0 ? void 0 : memory.defaultPriority);
    const finalPriority = priorityInText !== null && priorityInText !== void 0 ? priorityInText : ((_a = memory === null || memory === void 0 ? void 0 : memory.defaultPriority) !== null && _a !== void 0 ? _a : undefined);
    const payHasKeyword = textNorm.includes('payer') ||
        textNorm.includes('regler') ||
        textNorm.includes('facture') ||
        textNorm.includes('loyer') ||
        textNorm.includes('impots') ||
        textNorm.includes('abonnement');
    const mPay = rawText.match(/\b(payer|r[ée]gler)\b\s+([^\n\r\.,;]+)/i);
    if (mPay || payHasKeyword) {
        const obj = mPay ? String((_b = mPay[2]) !== null && _b !== void 0 ? _b : '').trim() : '';
        const objTitle = obj ? obj : 'facture';
        const sugTitle = `Payer ${objTitle}`.replace(/\s+/g, ' ').trim();
        const kind = dtTs && (timeHit || reminderKeyword) ? 'create_reminder' : 'create_task';
        add(Object.assign(Object.assign(Object.assign(Object.assign({ intent: 'PAYER', title: sugTitle, originFromText: clampFromText(mPay ? mPay[0] : 'payer', 120), explanation: `Détecté une intention de paiement dans la note.`, kind, dueDate: kind === 'create_task' && dtTs ? dtTs : undefined, remindAt: kind === 'create_reminder' && dtTs ? dtTs : undefined }, (finalPriority ? { priority: finalPriority } : {})), (appliedDefaultPriority ? { appliedDefaultPriority: true } : {})), (appliedDefaultReminderHour ? { appliedDefaultReminderHour: true } : {})), { confidence: 0.8 }));
    }
    const mCall = rawText.match(/\b(appeler|t[ée]l[ée]phoner|tel|phone)\b\s+([^\n\r\.,;]+)/i);
    if (mCall) {
        const obj = String((_c = mCall[2]) !== null && _c !== void 0 ? _c : '').trim();
        const objTitle = obj ? obj : 'quelqu’un';
        const sugTitle = `Appeler ${objTitle}`.replace(/\s+/g, ' ').trim();
        const kind = dtTs && (timeHit || reminderKeyword) ? 'create_reminder' : 'create_task';
        add(Object.assign(Object.assign(Object.assign(Object.assign({ intent: 'APPELER', title: sugTitle, originFromText: clampFromText(mCall[0], 120), explanation: `Détecté une intention d’appel dans la note.`, kind, dueDate: kind === 'create_task' && dtTs ? dtTs : undefined, remindAt: kind === 'create_reminder' && dtTs ? dtTs : undefined }, (finalPriority ? { priority: finalPriority } : {})), (appliedDefaultPriority ? { appliedDefaultPriority: true } : {})), (appliedDefaultReminderHour ? { appliedDefaultReminderHour: true } : {})), { confidence: 0.8 }));
    }
    const mRdv = rawText.match(/\b(prendre\s+rdv|prendre\s+rendez-vous|rdv|rendez-vous|r[ée]server)\b\s*([^\n\r\.,;]+)?/i);
    if (mRdv) {
        const obj = String((_d = mRdv[2]) !== null && _d !== void 0 ? _d : '').trim();
        const objTitle = obj ? obj : '';
        const baseTitle = objTitle ? `Prendre RDV ${objTitle}` : 'Prendre RDV';
        const sugTitle = baseTitle.replace(/\s+/g, ' ').trim();
        const kind = dtTs && (timeHit || reminderKeyword) ? 'create_reminder' : 'create_task';
        add(Object.assign(Object.assign(Object.assign(Object.assign({ intent: 'PRENDRE_RDV', title: sugTitle, originFromText: clampFromText(mRdv[0], 120), explanation: `Détecté une intention de rendez-vous dans la note.`, kind, dueDate: kind === 'create_task' && dtTs ? dtTs : undefined, remindAt: kind === 'create_reminder' && dtTs ? dtTs : undefined }, (finalPriority ? { priority: finalPriority } : {})), (appliedDefaultPriority ? { appliedDefaultPriority: true } : {})), (appliedDefaultReminderHour ? { appliedDefaultReminderHour: true } : {})), { confidence: 0.8 }));
    }
    return intents;
}
function assistantObjectIdForNote(noteId) {
    return `note_${noteId}`;
}
async function isAssistantEnabledForUser(db, userId) {
    var _a;
    const snap = await db
        .collection('users')
        .doc(userId)
        .collection('assistantSettings')
        .doc('main')
        .get();
    return snap.exists && ((_a = snap.data()) === null || _a === void 0 ? void 0 : _a.enabled) === true;
}
function getSmtpEnv() {
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
    };
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
function getEmailTestSecret() {
    const secret = process.env.EMAIL_TEST_SECRET;
    return secret !== null && secret !== void 0 ? secret : null;
}
async function sendReminderEmail(params) {
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
    }
    catch (e) {
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
            messageId: info === null || info === void 0 ? void 0 : info.messageId,
            accepted: info === null || info === void 0 ? void 0 : info.accepted,
            rejected: info === null || info === void 0 ? void 0 : info.rejected,
            response: info === null || info === void 0 ? void 0 : info.response,
        });
    }
    catch (e) {
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
function escapeHtml(input) {
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
async function claimReminder(params) {
    const { db, ref, now, processingTtlMs, processingBy } = params;
    return db.runTransaction(async (tx) => {
        var _a;
        const snap = await tx.get(ref);
        if (!snap.exists)
            return false;
        const data = snap.data();
        if ((data === null || data === void 0 ? void 0 : data.sent) === true)
            return false;
        const processingAt = (_a = data === null || data === void 0 ? void 0 : data.processingAt) !== null && _a !== void 0 ? _a : null;
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
exports.checkAndSendReminders = functions.pubsub
    .schedule('every 1 minutes')
    .onRun(async (context) => {
    const now = new Date();
    const nowIso = now.toISOString();
    const processingTtlMs = 2 * 60 * 1000;
    const processingBy = typeof (context === null || context === void 0 ? void 0 : context.eventId) === 'string' && context.eventId
        ? String(context.eventId)
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
        console.log(`checkAndSendReminders: now=${nowIso} reminders=${remindersSnapshot.size}`);
        const reminderPromises = remindersSnapshot.docs.map(async (doc) => {
            var _a, _b;
            const reminder = doc.data();
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
                }
                catch (_c) {
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
                }
                catch (_d) {
                    // ignore
                }
                return;
            }
            const userData = userDoc.data();
            const fcmTokens = (userData === null || userData === void 0 ? void 0 : userData.fcmTokens) || {};
            const tokens = Object.keys(fcmTokens);
            const pushEnabled = !!((_b = (_a = userData === null || userData === void 0 ? void 0 : userData.settings) === null || _a === void 0 ? void 0 : _a.notifications) === null || _b === void 0 ? void 0 : _b.taskReminders);
            const userEmail = typeof (userData === null || userData === void 0 ? void 0 : userData.email) === 'string' ? userData.email : null;
            // Prepare notification message
            const message = {
                notification: {
                    title: '⏰ Rappel de tâche',
                    body: (task === null || task === void 0 ? void 0 : task.title) ? String(task.title) : 'Tu as une tâche à vérifier.'
                },
                data: {
                    taskId: reminder.taskId,
                    dueDate: reminder.dueDate,
                    url: `/tasks/${reminder.taskId}`
                }
            };
            let delivered = false;
            let deliveryChannel;
            if (pushEnabled && tokens.length > 0) {
                const invalidTokens = new Set();
                let sentAny = false;
                const sendPromises = tokens.map(async (token) => {
                    try {
                        await admin.messaging().send(Object.assign(Object.assign({}, message), { token }));
                        sentAny = true;
                    }
                    catch (error) {
                        const messagingError = error;
                        console.warn(`Failed sending reminder ${doc.id} to token (user=${reminder.userId}) code=${messagingError.code}`);
                        if (messagingError.code === 'messaging/invalid-registration-token' ||
                            messagingError.code === 'messaging/registration-token-not-registered') {
                            invalidTokens.add(token);
                        }
                    }
                });
                await Promise.all(sendPromises);
                if (invalidTokens.size > 0) {
                    try {
                        const nextMap = {};
                        for (const t of tokens) {
                            if (!invalidTokens.has(t))
                                nextMap[t] = true;
                        }
                        await db.collection('users').doc(reminder.userId).update({ fcmTokens: nextMap });
                    }
                    catch (e) {
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
                }
                else {
                    try {
                        await sendReminderEmail({
                            to: userEmail,
                            taskTitle: (task === null || task === void 0 ? void 0 : task.title) ? String(task.title) : 'Tâche',
                            reminderTimeIso: reminder.reminderTime,
                            taskId: reminder.taskId,
                        });
                        delivered = true;
                        deliveryChannel = 'email';
                    }
                    catch (e) {
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
            }
            else {
                // Allow retry on next run (but only after TTL, enforced by claimReminder).
                try {
                    await doc.ref.update({ processingAt: admin.firestore.Timestamp.fromDate(now), processingBy });
                }
                catch (_e) {
                    // ignore
                }
            }
        });
        await Promise.all(reminderPromises);
        console.log('Reminder check completed successfully');
    }
    catch (error) {
        console.error('Error processing reminders:', error instanceof Error ? error.message : 'Unknown error');
    }
});
exports.assistantExpireSuggestions = functions.pubsub
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
        if (snap.empty)
            break;
        const batch = db.batch();
        for (const d of snap.docs) {
            batch.update(d.ref, { status: 'expired', updatedAt: nowServer });
        }
        await batch.commit();
        expiredCount += snap.size;
        if (snap.size < 500)
            break;
    }
    console.log('assistantExpireSuggestions done', { expiredCount });
});
exports.assistantPurgeExpiredSuggestions = functions.pubsub
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
        if (snap.empty)
            break;
        const batch = db.batch();
        for (const d of snap.docs) {
            batch.delete(d.ref);
        }
        await batch.commit();
        deletedCount += snap.size;
        if (snap.size < 500)
            break;
    }
    console.log('assistantPurgeExpiredSuggestions done', { deletedCount });
});
// Optional: Clean up old reminders
exports.cleanupOldReminders = functions.pubsub
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
    }
    catch (error) {
        console.error('Error cleaning up old reminders:', error instanceof Error ? error.message : 'Unknown error');
    }
});
exports.testSendReminderEmail = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h;
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
    const body = ((_a = req.body) !== null && _a !== void 0 ? _a : {});
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
            const doc = (_b = snap.docs[0]) !== null && _b !== void 0 ? _b : null;
            if (!doc) {
                res.status(404).json({ error: 'No pending reminder found for this user.' });
                return;
            }
            const reminderRef = doc.ref;
            const reminder = doc.data();
            const taskSnap = await db.collection('tasks').doc(reminder.taskId).get();
            const taskTitle = taskSnap.exists ? String((_d = (_c = taskSnap.data()) === null || _c === void 0 ? void 0 : _c.title) !== null && _d !== void 0 ? _d : 'Tâche') : 'Tâche';
            const userSnap = await db.collection('users').doc(reminder.userId).get();
            const userEmail = userSnap.exists && typeof ((_e = userSnap.data()) === null || _e === void 0 ? void 0 : _e.email) === 'string' ? userSnap.data().email : null;
            const to = toOverride !== null && toOverride !== void 0 ? toOverride : userEmail;
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
            const reminder = reminderSnap.data();
            const taskSnap = await db.collection('tasks').doc(reminder.taskId).get();
            const taskTitle = taskSnap.exists ? String((_g = (_f = taskSnap.data()) === null || _f === void 0 ? void 0 : _f.title) !== null && _g !== void 0 ? _g : 'Tâche') : 'Tâche';
            const userSnap = await db.collection('users').doc(reminder.userId).get();
            const userEmail = userSnap.exists && typeof ((_h = userSnap.data()) === null || _h === void 0 ? void 0 : _h.email) === 'string' ? userSnap.data().email : null;
            const to = toOverride !== null && toOverride !== void 0 ? toOverride : userEmail;
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
            taskId: taskId !== null && taskId !== void 0 ? taskId : 'unknown',
        });
        res.status(200).json({ ok: true, to, taskId: taskId !== null && taskId !== void 0 ? taskId : null });
    }
    catch (e) {
        console.error('testSendReminderEmail failed', e);
        res.status(500).json({
            error: e instanceof Error ? e.message : 'Unknown error',
        });
    }
});
exports.assistantEnqueueNoteJob = functions.firestore
    .document('notes/{noteId}')
    .onWrite(async (change, context) => {
    const after = change.after.exists ? change.after.data() : null;
    if (!after)
        return;
    const noteId = typeof context.params.noteId === 'string' ? context.params.noteId : null;
    if (!noteId)
        return;
    const userId = typeof after.userId === 'string' ? after.userId : null;
    if (!userId)
        return;
    const db = admin.firestore();
    const enabled = await isAssistantEnabledForUser(db, userId);
    if (!enabled)
        return;
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
        const objectData = objectSnap.exists ? objectSnap.data() : null;
        const prevHash = objectData && typeof (objectData === null || objectData === void 0 ? void 0 : objectData.pendingTextHash) === 'string'
            ? objectData.pendingTextHash
            : objectData && typeof (objectData === null || objectData === void 0 ? void 0 : objectData.textHash) === 'string'
                ? objectData.textHash
                : null;
        if (typeof prevHash === 'string' && prevHash === textHash) {
            return;
        }
        const jobRef = jobsCol.doc(assistantCurrentJobIdForObject(objectId));
        const jobSnap = await tx.get(jobRef);
        if (jobSnap.exists) {
            const data = jobSnap.data();
            const st = data === null || data === void 0 ? void 0 : data.status;
            const pending = typeof (data === null || data === void 0 ? void 0 : data.pendingTextHash) === 'string' ? data.pendingTextHash : null;
            if ((st === 'queued' || st === 'processing') && pending === textHash) {
                // Already enqueued for this content.
                return;
            }
            if (st === 'queued' || st === 'processing') {
                // Already has an active job; don't create a second one.
                // But keep the newest content hash so the current job effectively targets the latest version.
                tx.set(objectRef, {
                    pendingTextHash: textHash,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                }, { merge: true });
                tx.set(jobRef, {
                    pendingTextHash: textHash,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                }, { merge: true });
                return;
            }
        }
        const now = admin.firestore.FieldValue.serverTimestamp();
        const existingTextHash = objectData && typeof (objectData === null || objectData === void 0 ? void 0 : objectData.textHash) === 'string' ? objectData.textHash : null;
        const objectPayload = {
            objectId,
            type: 'note',
            coreRef: { collection: 'notes', id: noteId },
            textHash: existingTextHash !== null && existingTextHash !== void 0 ? existingTextHash : textHash,
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
        const jobPayload = {
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
        }
        else {
            tx.create(jobRef, jobPayload);
        }
    });
});
const ASSISTANT_JOB_LOCK_MS = 2 * 60 * 1000;
const ASSISTANT_JOB_MAX_ATTEMPTS = 3;
async function claimAssistantJob(params) {
    const { db, ref, now } = params;
    return await db.runTransaction(async (tx) => {
        var _a;
        const snap = await tx.get(ref);
        if (!snap.exists)
            return null;
        const data = snap.data();
        const status = data === null || data === void 0 ? void 0 : data.status;
        if (status !== 'queued')
            return null;
        const attempts = typeof (data === null || data === void 0 ? void 0 : data.attempts) === 'number' ? data.attempts : 0;
        if (attempts >= ASSISTANT_JOB_MAX_ATTEMPTS) {
            tx.update(ref, {
                status: 'error',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            return null;
        }
        const lockedUntil = (_a = data === null || data === void 0 ? void 0 : data.lockedUntil) !== null && _a !== void 0 ? _a : null;
        if (lockedUntil && lockedUntil.toMillis() > now.toMillis())
            return null;
        const nextLocked = admin.firestore.Timestamp.fromMillis(now.toMillis() + ASSISTANT_JOB_LOCK_MS);
        tx.update(ref, {
            status: 'processing',
            attempts: attempts + 1,
            lockedUntil: nextLocked,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return snap.data();
    });
}
exports.assistantRunJobQueue = functions.pubsub
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
        var _a;
        const userRef = jobDoc.ref.parent.parent;
        const userId = userRef === null || userRef === void 0 ? void 0 : userRef.id;
        if (!userId)
            return;
        const enabled = await isAssistantEnabledForUser(db, userId);
        if (!enabled)
            return;
        const claimed = await claimAssistantJob({ db, ref: jobDoc.ref, now: nowTs });
        if (!claimed)
            return;
        const objectId = typeof claimed.objectId === 'string' ? claimed.objectId : null;
        if (!objectId)
            return;
        const objectRef = db.collection('users').doc(userId).collection('assistantObjects').doc(objectId);
        try {
            await objectRef.set({
                status: 'processing',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
        }
        catch (_b) {
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
            let processedTextHash = typeof (claimed === null || claimed === void 0 ? void 0 : claimed.pendingTextHash) === 'string' ? String(claimed.pendingTextHash) : null;
            let resultCandidates = 0;
            let resultCreated = 0;
            let resultUpdated = 0;
            let resultSkippedProposed = 0;
            let resultSkippedAccepted = 0;
            if (claimed.jobType === 'analyze_intents_v1' || claimed.jobType === 'analyze_intents_v2') {
                const objectSnap = await objectRef.get();
                const objectData = objectSnap.exists ? objectSnap.data() : null;
                const coreRef = objectData === null || objectData === void 0 ? void 0 : objectData.coreRef;
                const noteId = (coreRef === null || coreRef === void 0 ? void 0 : coreRef.collection) === 'notes' && typeof (coreRef === null || coreRef === void 0 ? void 0 : coreRef.id) === 'string' ? coreRef.id : null;
                if (noteId) {
                    const noteSnap = await db.collection('notes').doc(noteId).get();
                    const note = noteSnap.exists ? noteSnap.data() : null;
                    const noteUserId = typeof (note === null || note === void 0 ? void 0 : note.userId) === 'string' ? note.userId : null;
                    if (note && noteUserId === userId) {
                        const noteTitle = typeof (note === null || note === void 0 ? void 0 : note.title) === 'string' ? note.title : '';
                        const noteContent = typeof (note === null || note === void 0 ? void 0 : note.content) === 'string' ? note.content : '';
                        const normalized = normalizeAssistantText(`${noteTitle}\n${noteContent}`);
                        processedTextHash = sha256Hex(normalized);
                        let memoryDefaults = undefined;
                        try {
                            const memSnap = await assistantMemoryLiteRef(db, userId).get();
                            if (memSnap.exists) {
                                const mem = memSnap.data();
                                const dp = mem === null || mem === void 0 ? void 0 : mem.defaultPriority;
                                const drh = mem === null || mem === void 0 ? void 0 : mem.defaultReminderHour;
                                memoryDefaults = Object.assign(Object.assign({}, (dp === 'low' || dp === 'medium' || dp === 'high' ? { defaultPriority: dp } : {})), (typeof drh === 'number' && Number.isFinite(drh) ? { defaultReminderHour: Math.trunc(drh) } : {}));
                            }
                        }
                        catch (_c) {
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
                            const candidates = [];
                            if (detectedBundle) {
                                const dedupeKey = buildBundleDedupeKey({ objectId, minimal: detectedBundle.dedupeMinimal });
                                const payload = {
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
                            }
                            else {
                                for (const d of detectedSingle) {
                                    const dedupeKey = buildSuggestionDedupeKey({ objectId, kind: d.kind, minimal: d.dedupeMinimal });
                                    const payload = Object.assign(Object.assign(Object.assign(Object.assign({ title: d.title }, (d.dueDate ? { dueDate: d.dueDate } : {})), (d.remindAt ? { remindAt: d.remindAt } : {})), (d.priority ? { priority: d.priority } : {})), { origin: {
                                            fromText: d.originFromText,
                                        }, confidence: d.confidence, explanation: d.explanation });
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
                                    var _a;
                                    const existing = await tx.get(sugRef);
                                    if (existing.exists) {
                                        const st = (_a = existing.data()) === null || _a === void 0 ? void 0 : _a.status;
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
                                    const doc = {
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
                        await objectRef.set({
                            textHash: processedTextHash,
                        }, { merge: true });
                    }
                }
            }
            const objectAfter = await objectRef.get();
            const pendingAfter = objectAfter.exists && typeof ((_a = objectAfter.data()) === null || _a === void 0 ? void 0 : _a.pendingTextHash) === 'string'
                ? String(objectAfter.data().pendingTextHash)
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
                await objectRef.set({
                    status: 'queued',
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                }, { merge: true });
            }
            else {
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
                await objectRef.set({
                    status: 'done',
                    lastAnalyzedAt: admin.firestore.FieldValue.serverTimestamp(),
                    pendingTextHash: null,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                }, { merge: true });
            }
            try {
                await metricsRef.set(metricsIncrements({ jobsProcessed: 1 }), { merge: true });
            }
            catch (_d) {
                // ignore
            }
        }
        catch (e) {
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
            }
            catch (_e) {
                // ignore
            }
            try {
                const objectRef = db.collection('users').doc(userId).collection('assistantObjects').doc(objectId);
                await objectRef.set({
                    status: 'error',
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                }, { merge: true });
            }
            catch (_f) {
                // ignore
            }
            try {
                const metricsRef = assistantMetricsRef(db, userId);
                await metricsRef.set(metricsIncrements({ jobsProcessed: 1, jobErrors: 1 }), { merge: true });
            }
            catch (_g) {
                // ignore
            }
        }
    });
    await Promise.all(tasks);
});
exports.assistantApplySuggestion = functions.https.onCall(async (data, context) => {
    var _a;
    const userId = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!userId) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
    }
    const suggestionId = typeof (data === null || data === void 0 ? void 0 : data.suggestionId) === 'string' ? String(data.suggestionId) : null;
    if (!suggestionId) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing suggestionId.');
    }
    const overrides = typeof (data === null || data === void 0 ? void 0 : data.overrides) === 'object' && data.overrides
        ? data.overrides
        : null;
    const db = admin.firestore();
    const userRef = db.collection('users').doc(userId);
    const suggestionRef = userRef.collection('assistantSuggestions').doc(suggestionId);
    const decisionsCol = userRef.collection('assistantDecisions');
    const metricsRef = assistantMetricsRef(db, userId);
    const memoryLiteRef = assistantMemoryLiteRef(db, userId);
    const decisionRef = decisionsCol.doc();
    const nowTs = admin.firestore.Timestamp.now();
    let decisionId = null;
    const createdCoreObjects = [];
    let followupTasks = [];
    let followupIsPro = false;
    let followupReminderHour = null;
    let followupEnabled = false;
    let followupObjectId = '';
    await db.runTransaction(async (tx) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0;
        createdCoreObjects.length = 0;
        const memoryPriorityUses = [];
        const memoryReminderHourUses = [];
        const suggestionSnap = await tx.get(suggestionRef);
        if (!suggestionSnap.exists) {
            throw new functions.https.HttpsError('not-found', 'Suggestion not found.');
        }
        const suggestion = suggestionSnap.data();
        followupObjectId = typeof (suggestion === null || suggestion === void 0 ? void 0 : suggestion.objectId) === 'string' ? suggestion.objectId : '';
        const [userSnap, memorySnap] = await Promise.all([
            tx.get(userRef),
            tx.get(memoryLiteRef),
        ]);
        const userPlan = userSnap.exists && typeof ((_a = userSnap.data()) === null || _a === void 0 ? void 0 : _a.plan) === 'string' ? String(userSnap.data().plan) : null;
        const isPro = userPlan === 'pro';
        followupIsPro = isPro;
        followupEnabled = suggestion.source.type === 'note';
        const existingMemory = memorySnap.exists ? memorySnap.data() : {};
        const existingMemoryHourRaw = existingMemory === null || existingMemory === void 0 ? void 0 : existingMemory.defaultReminderHour;
        const existingMemoryHour = typeof existingMemoryHourRaw === 'number' && Number.isFinite(existingMemoryHourRaw) ? Math.trunc(existingMemoryHourRaw) : null;
        followupReminderHour = existingMemoryHour !== null && existingMemoryHour >= 0 && existingMemoryHour <= 23 ? existingMemoryHour : null;
        if (suggestion.status !== 'proposed') {
            throw new functions.https.HttpsError('failed-precondition', 'Suggestion is not proposed.');
        }
        if (!suggestion.expiresAt || suggestion.expiresAt.toMillis() <= nowTs.toMillis()) {
            throw new functions.https.HttpsError('failed-precondition', 'Suggestion expired.');
        }
        const suggestionCreatedAt = (suggestion === null || suggestion === void 0 ? void 0 : suggestion.createdAt) instanceof admin.firestore.Timestamp ? suggestion.createdAt : null;
        const timeToDecisionMs = suggestionCreatedAt ? Math.max(0, nowTs.toMillis() - suggestionCreatedAt.toMillis()) : null;
        const payload = suggestion.payload;
        const baseTitle = typeof (payload === null || payload === void 0 ? void 0 : payload.title) === 'string' ? payload.title.trim() : '';
        if (!baseTitle) {
            throw new functions.https.HttpsError('invalid-argument', 'Invalid payload.title');
        }
        const kind = suggestion.kind;
        const isActionKind = kind === 'create_task' || kind === 'create_reminder' || kind === 'create_task_bundle' || kind === 'update_task_meta';
        const isContentKind = kind === 'generate_summary' || kind === 'rewrite_note' || kind === 'generate_hook' || kind === 'extract_key_points' || kind === 'tag_entities';
        if (!isActionKind && !isContentKind) {
            throw new functions.https.HttpsError('invalid-argument', 'Unknown suggestion kind.');
        }
        const overridesRaw = overrides && typeof overrides === 'object' ? overrides : null;
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
        const priority = payload === null || payload === void 0 ? void 0 : payload.priority;
        const basePriorityValue = priority === 'low' || priority === 'medium' || priority === 'high' ? priority : null;
        const baseDueDate = (payload === null || payload === void 0 ? void 0 : payload.dueDate) instanceof admin.firestore.Timestamp ? payload.dueDate : null;
        const baseRemindAt = (payload === null || payload === void 0 ? void 0 : payload.remindAt) instanceof admin.firestore.Timestamp ? payload.remindAt : null;
        const parseOverrideTimestamp = (value) => {
            if (value === null)
                return null;
            if (typeof value === 'number' && Number.isFinite(value)) {
                return admin.firestore.Timestamp.fromMillis(value);
            }
            if (typeof value === 'object' && value) {
                const candidate = value;
                const seconds = typeof candidate.seconds === 'number' ? candidate.seconds : typeof candidate._seconds === 'number' ? candidate._seconds : null;
                const nanos = typeof candidate.nanoseconds === 'number' ? candidate.nanoseconds : typeof candidate._nanoseconds === 'number' ? candidate._nanoseconds : 0;
                if (seconds !== null && Number.isFinite(seconds) && Number.isFinite(nanos)) {
                    return new admin.firestore.Timestamp(seconds, nanos);
                }
            }
            throw new functions.https.HttpsError('invalid-argument', 'Invalid overrides timestamp value.');
        };
        const overrideTitleRaw = overrides ? overrides.title : undefined;
        const overrideTitle = typeof overrideTitleRaw === 'undefined'
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
        const overridePriorityValue = typeof overridePriorityRaw === 'undefined'
            ? undefined
            : overridePriorityRaw === null
                ? null
                : overridePriorityRaw === 'low' || overridePriorityRaw === 'medium' || overridePriorityRaw === 'high'
                    ? overridePriorityRaw
                    : null;
        if (typeof overridePriorityRaw !== 'undefined' &&
            overridePriorityRaw !== null &&
            overridePriorityRaw !== 'low' &&
            overridePriorityRaw !== 'medium' &&
            overridePriorityRaw !== 'high') {
            throw new functions.https.HttpsError('invalid-argument', 'Invalid overrides.priority');
        }
        const overrideDueDate = overrides && Object.prototype.hasOwnProperty.call(overrides, 'dueDate') ? parseOverrideTimestamp(overrides.dueDate) : undefined;
        const overrideRemindAt = overrides && Object.prototype.hasOwnProperty.call(overrides, 'remindAt') ? parseOverrideTimestamp(overrides.remindAt) : undefined;
        const finalTitle = typeof overrideTitle === 'string' ? overrideTitle : baseTitle;
        const finalDueDate = typeof overrideDueDate === 'undefined' ? baseDueDate : overrideDueDate;
        const finalRemindAt = typeof overrideRemindAt === 'undefined' ? baseRemindAt : overrideRemindAt;
        const finalPriorityValue = typeof overridePriorityValue === 'undefined' ? basePriorityValue : overridePriorityValue;
        const isEdited = (typeof overrideTitle !== 'undefined' && overrideTitle !== baseTitle) ||
            (typeof overrideDueDate !== 'undefined' && ((_c = (_b = overrideDueDate === null || overrideDueDate === void 0 ? void 0 : overrideDueDate.toMillis) === null || _b === void 0 ? void 0 : _b.call(overrideDueDate)) !== null && _c !== void 0 ? _c : null) !== ((_e = (_d = baseDueDate === null || baseDueDate === void 0 ? void 0 : baseDueDate.toMillis) === null || _d === void 0 ? void 0 : _d.call(baseDueDate)) !== null && _e !== void 0 ? _e : null)) ||
            (typeof overrideRemindAt !== 'undefined' && ((_g = (_f = overrideRemindAt === null || overrideRemindAt === void 0 ? void 0 : overrideRemindAt.toMillis) === null || _f === void 0 ? void 0 : _f.call(overrideRemindAt)) !== null && _g !== void 0 ? _g : null) !== ((_j = (_h = baseRemindAt === null || baseRemindAt === void 0 ? void 0 : baseRemindAt.toMillis) === null || _h === void 0 ? void 0 : _h.call(baseRemindAt)) !== null && _j !== void 0 ? _j : null)) ||
            (typeof overridePriorityValue !== 'undefined' && overridePriorityValue !== basePriorityValue);
        if (kind === 'create_reminder' && !finalRemindAt) {
            const taskId = typeof (payload === null || payload === void 0 ? void 0 : payload.taskId) === 'string' ? String(payload.taskId) : null;
            const isTaskFollowup = ((_k = suggestion.source) === null || _k === void 0 ? void 0 : _k.type) === 'task' && typeof ((_l = suggestion.source) === null || _l === void 0 ? void 0 : _l.id) === 'string';
            if (!taskId && !isTaskFollowup) {
                throw new functions.https.HttpsError('invalid-argument', 'remindAt is required for reminders.');
            }
        }
        if (kind === 'update_task_meta') {
            const createdAt = admin.firestore.FieldValue.serverTimestamp();
            const updatedAt = admin.firestore.FieldValue.serverTimestamp();
            const taskId = typeof (payload === null || payload === void 0 ? void 0 : payload.taskId) === 'string' ? String(payload.taskId) : null;
            if (!taskId) {
                throw new functions.https.HttpsError('invalid-argument', 'Invalid payload.taskId');
            }
            const favoriteRaw = payload === null || payload === void 0 ? void 0 : payload.favorite;
            if (typeof favoriteRaw !== 'boolean') {
                throw new functions.https.HttpsError('invalid-argument', 'Invalid payload.favorite');
            }
            const taskRef = db.collection('tasks').doc(taskId);
            const taskSnap = await tx.get(taskRef);
            if (!taskSnap.exists) {
                throw new functions.https.HttpsError('not-found', 'Task not found.');
            }
            const taskData = taskSnap.data();
            if (typeof (taskData === null || taskData === void 0 ? void 0 : taskData.userId) !== 'string' || taskData.userId !== userId) {
                throw new functions.https.HttpsError('permission-denied', 'Task does not belong to user.');
            }
            tx.update(taskRef, {
                favorite: favoriteRaw,
                updatedAt,
            });
            createdCoreObjects.push({ type: 'task', id: taskId });
            decisionId = decisionRef.id;
            const beforePayload = suggestion.payload;
            const decisionDoc = {
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
            tx.set(metricsRef, metricsIncrements({
                suggestionsAccepted: 1,
                followupSuggestionsAccepted: suggestion.source.type === 'task' ? 1 : 0,
                decisionsCount: 1,
                totalTimeToDecisionMs: timeToDecisionMs ? timeToDecisionMs : 0,
            }), { merge: true });
            tx.update(suggestionRef, {
                status: 'accepted',
                updatedAt,
            });
            return;
        }
        const beforePayload = suggestion.payload;
        const finalPayload = (() => {
            if (!isEdited)
                return null;
            const next = Object.assign({}, beforePayload);
            next.title = finalTitle;
            if (finalDueDate)
                next.dueDate = finalDueDate;
            else
                delete next.dueDate;
            if (finalRemindAt)
                next.remindAt = finalRemindAt;
            else
                delete next.remindAt;
            if (finalPriorityValue)
                next.priority = finalPriorityValue;
            else
                delete next.priority;
            return next;
        })();
        const createdAt = admin.firestore.FieldValue.serverTimestamp();
        const updatedAt = admin.firestore.FieldValue.serverTimestamp();
        if (isContentKind) {
            decisionId = decisionRef.id;
            const decisionDoc = {
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
            tx.set(metricsRef, metricsIncrements({
                suggestionsAccepted: 1,
                decisionsCount: 1,
                totalTimeToDecisionMs: timeToDecisionMs ? timeToDecisionMs : 0,
            }), { merge: true });
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
            const tasks = Array.isArray(payload === null || payload === void 0 ? void 0 : payload.tasks) ? payload.tasks : null;
            if (!tasks || tasks.length < 2) {
                throw new functions.https.HttpsError('invalid-argument', 'Invalid payload.tasks');
            }
            const limitedOriginal = tasks.slice(0, 6);
            const originalCount = limitedOriginal.length;
            const selectedIndexesRaw = overridesRaw && Array.isArray(overridesRaw.selectedIndexes) ? overridesRaw.selectedIndexes : null;
            const selectedIndexes = (selectedIndexesRaw !== null && selectedIndexesRaw !== void 0 ? selectedIndexesRaw : limitedOriginal.map((_, idx) => idx))
                .map((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : NaN))
                .filter((v) => Number.isFinite(v));
            const selectedUnique = [];
            const selectedSet = new Set();
            for (const i of selectedIndexes) {
                if (i < 0 || i >= originalCount) {
                    throw new functions.https.HttpsError('invalid-argument', 'Invalid selectedIndexes.');
                }
                if (selectedSet.has(i))
                    continue;
                selectedSet.add(i);
                selectedUnique.push(i);
            }
            if (selectedUnique.length === 0) {
                throw new functions.https.HttpsError('failed-precondition', 'At least one item must be selected.');
            }
            const tasksOverridesRaw = overridesRaw && typeof overridesRaw.tasksOverrides === 'object' && overridesRaw.tasksOverrides ? overridesRaw.tasksOverrides : null;
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
            const finalTasks = [];
            const createdTaskInfos = [];
            let anyEdit = selectedUnique.length !== originalCount;
            for (const i of selectedUnique) {
                const t = limitedOriginal[i];
                const baseTaskTitle = typeof (t === null || t === void 0 ? void 0 : t.title) === 'string' ? String(t.title).trim() : '';
                const baseTaskDue = (t === null || t === void 0 ? void 0 : t.dueDate) instanceof admin.firestore.Timestamp ? t.dueDate : null;
                const baseTaskRemind = (t === null || t === void 0 ? void 0 : t.remindAt) instanceof admin.firestore.Timestamp ? t.remindAt : null;
                const baseTaskPriority = (t === null || t === void 0 ? void 0 : t.priority) === 'low' || (t === null || t === void 0 ? void 0 : t.priority) === 'medium' || (t === null || t === void 0 ? void 0 : t.priority) === 'high' ? t.priority : null;
                const baseTaskOrigin = (t === null || t === void 0 ? void 0 : t.origin) && typeof (t === null || t === void 0 ? void 0 : t.origin) === 'object' ? t.origin : undefined;
                const o = tasksOverridesRaw ? tasksOverridesRaw[String(i)] : null;
                const nextTitleRaw = typeof (o === null || o === void 0 ? void 0 : o.title) === 'string' ? String(o.title).trim() : null;
                const nextTitle = nextTitleRaw !== null ? nextTitleRaw : baseTaskTitle;
                if (!nextTitle) {
                    throw new functions.https.HttpsError('invalid-argument', 'Task title cannot be empty.');
                }
                const overrideDue = o && Object.prototype.hasOwnProperty.call(o, 'dueDate') ? parseOverrideTimestamp(o.dueDate) : undefined;
                const overrideRemind = o && Object.prototype.hasOwnProperty.call(o, 'remindAt') ? parseOverrideTimestamp(o.remindAt) : undefined;
                const nextDue = typeof overrideDue === 'undefined' ? baseTaskDue : overrideDue;
                const nextRemind = typeof overrideRemind === 'undefined' ? baseTaskRemind : overrideRemind;
                const nextPriorityRaw = o === null || o === void 0 ? void 0 : o.priority;
                const nextPriority = typeof nextPriorityRaw === 'undefined'
                    ? baseTaskPriority
                    : nextPriorityRaw === null
                        ? null
                        : nextPriorityRaw === 'low' || nextPriorityRaw === 'medium' || nextPriorityRaw === 'high'
                            ? nextPriorityRaw
                            : null;
                if (typeof nextPriorityRaw !== 'undefined' && nextPriorityRaw !== null && nextPriority === null) {
                    throw new functions.https.HttpsError('invalid-argument', 'Invalid task priority.');
                }
                if (nextTitle !== baseTaskTitle)
                    anyEdit = true;
                if (((_o = (_m = nextDue === null || nextDue === void 0 ? void 0 : nextDue.toMillis) === null || _m === void 0 ? void 0 : _m.call(nextDue)) !== null && _o !== void 0 ? _o : null) !== ((_q = (_p = baseTaskDue === null || baseTaskDue === void 0 ? void 0 : baseTaskDue.toMillis) === null || _p === void 0 ? void 0 : _p.call(baseTaskDue)) !== null && _q !== void 0 ? _q : null))
                    anyEdit = true;
                if (((_s = (_r = nextRemind === null || nextRemind === void 0 ? void 0 : nextRemind.toMillis) === null || _r === void 0 ? void 0 : _r.call(nextRemind)) !== null && _s !== void 0 ? _s : null) !== ((_u = (_t = baseTaskRemind === null || baseTaskRemind === void 0 ? void 0 : baseTaskRemind.toMillis) === null || _t === void 0 ? void 0 : _t.call(baseTaskRemind)) !== null && _u !== void 0 ? _u : null))
                    anyEdit = true;
                if (nextPriority !== baseTaskPriority)
                    anyEdit = true;
                const taskRef = tasksCol.doc();
                const effectiveDue = nextRemind !== null && nextRemind !== void 0 ? nextRemind : nextDue;
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
                    if (Number.isFinite(h) && h >= 0 && h <= 23)
                        memoryReminderHourUses.push(h);
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
                finalTasks.push(Object.assign(Object.assign(Object.assign(Object.assign({ title: nextTitle }, (nextDue ? { dueDate: nextDue } : {})), (nextRemind ? { remindAt: nextRemind } : {})), (nextPriority ? { priority: nextPriority } : {})), (baseTaskOrigin ? { origin: baseTaskOrigin } : {})));
            }
            if (createdCoreObjects.length < 2) {
                throw new functions.https.HttpsError('failed-precondition', 'No valid tasks to create.');
            }
            followupTasks = createdTaskInfos.map((t) => ({ taskId: t.taskId, dueDate: t.dueDate, hasReminder: t.hasReminder }));
            const beforePayload = suggestion.payload;
            const finalPayload = Object.assign(Object.assign({}, beforePayload), { tasks: finalTasks, selectedIndexes: selectedUnique });
            decisionId = decisionRef.id;
            const decisionDoc = {
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
            tx.set(metricsRef, metricsIncrements({
                bundlesAccepted: anyEdit ? 0 : 1,
                bundlesEditedAccepted: anyEdit ? 1 : 0,
                tasksCreatedViaBundle: finalTasks.length,
                bundleItemsCreated: finalTasks.length,
                bundleItemsDeselected: itemsDeselected,
                decisionsCount: 1,
                totalTimeToDecisionMs: timeToDecisionMs ? timeToDecisionMs : 0,
            }), { merge: true });
            if (memoryPriorityUses.length > 0 || memoryReminderHourUses.length > 0) {
                const existing = existingMemory;
                const prevPriorityCounts = (_v = existing === null || existing === void 0 ? void 0 : existing.stats) === null || _v === void 0 ? void 0 : _v.priorityCounts;
                const nextPriorityCounts = {
                    low: typeof (prevPriorityCounts === null || prevPriorityCounts === void 0 ? void 0 : prevPriorityCounts.low) === 'number' && Number.isFinite(prevPriorityCounts.low) ? prevPriorityCounts.low : 0,
                    medium: typeof (prevPriorityCounts === null || prevPriorityCounts === void 0 ? void 0 : prevPriorityCounts.medium) === 'number' && Number.isFinite(prevPriorityCounts.medium) ? prevPriorityCounts.medium : 0,
                    high: typeof (prevPriorityCounts === null || prevPriorityCounts === void 0 ? void 0 : prevPriorityCounts.high) === 'number' && Number.isFinite(prevPriorityCounts.high) ? prevPriorityCounts.high : 0,
                };
                const prevReminderCounts = (_w = existing === null || existing === void 0 ? void 0 : existing.stats) === null || _w === void 0 ? void 0 : _w.reminderHourCounts;
                const nextReminderCounts = Object.assign({}, (prevReminderCounts && typeof prevReminderCounts === 'object' ? prevReminderCounts : {}));
                let changed = false;
                for (const p of memoryPriorityUses) {
                    nextPriorityCounts[p] = ((_x = nextPriorityCounts[p]) !== null && _x !== void 0 ? _x : 0) + 1;
                    changed = true;
                }
                for (const hour of memoryReminderHourUses) {
                    const k = String(hour);
                    const prev = typeof nextReminderCounts[k] === 'number' && Number.isFinite(nextReminderCounts[k]) ? nextReminderCounts[k] : 0;
                    nextReminderCounts[k] = prev + 1;
                    changed = true;
                }
                const totalP = nextPriorityCounts.low + nextPriorityCounts.medium + nextPriorityCounts.high;
                const topP = nextPriorityCounts.high >= nextPriorityCounts.medium && nextPriorityCounts.high >= nextPriorityCounts.low
                    ? { p: 'high', c: nextPriorityCounts.high }
                    : nextPriorityCounts.medium >= nextPriorityCounts.low
                        ? { p: 'medium', c: nextPriorityCounts.medium }
                        : { p: 'low', c: nextPriorityCounts.low };
                const nextDefaultPriority = totalP >= 5 && topP.c / totalP > 0.6 ? topP.p : existing === null || existing === void 0 ? void 0 : existing.defaultPriority;
                if (typeof nextDefaultPriority !== 'undefined' && nextDefaultPriority !== (existing === null || existing === void 0 ? void 0 : existing.defaultPriority)) {
                    changed = true;
                }
                let nextDefaultReminderHour = existing === null || existing === void 0 ? void 0 : existing.defaultReminderHour;
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
                if (typeof nextDefaultReminderHour !== 'undefined' && nextDefaultReminderHour !== (existing === null || existing === void 0 ? void 0 : existing.defaultReminderHour)) {
                    changed = true;
                }
                if (typeof nextDefaultReminderHour === 'number' && Number.isFinite(nextDefaultReminderHour)) {
                    const h = Math.trunc(nextDefaultReminderHour);
                    if (h >= 0 && h <= 23)
                        followupReminderHour = h;
                }
                if (changed) {
                    tx.set(memoryLiteRef, Object.assign(Object.assign(Object.assign({}, (typeof nextDefaultPriority !== 'undefined' ? { defaultPriority: nextDefaultPriority } : {})), (typeof nextDefaultReminderHour !== 'undefined' ? { defaultReminderHour: nextDefaultReminderHour } : {})), { stats: {
                            priorityCounts: nextPriorityCounts,
                            reminderHourCounts: nextReminderCounts,
                        }, updatedAt }), { merge: true });
                    tx.set(metricsRef, metricsIncrements({ memoryUpdatesCount: 1 }), { merge: true });
                }
            }
            tx.update(suggestionRef, {
                status: 'accepted',
                updatedAt,
            });
            return;
        }
        else {
            const isTaskFollowup = suggestion.source.type === 'task';
            if (kind === 'create_reminder' && isTaskFollowup) {
                const taskId = typeof (payload === null || payload === void 0 ? void 0 : payload.taskId) === 'string' ? String(payload.taskId) : suggestion.source.id;
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
                const taskData = taskSnap.data();
                if (typeof (taskData === null || taskData === void 0 ? void 0 : taskData.userId) !== 'string' || taskData.userId !== userId) {
                    throw new functions.https.HttpsError('permission-denied', 'Task does not belong to user.');
                }
                const h = finalRemindAt.toDate().getHours();
                if (Number.isFinite(h) && h >= 0 && h <= 23)
                    memoryReminderHourUses.push(h);
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
            }
            else {
                const effectiveTaskDue = kind === 'create_reminder' ? finalRemindAt !== null && finalRemindAt !== void 0 ? finalRemindAt : finalDueDate : finalDueDate;
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
                    if (Number.isFinite(h) && h >= 0 && h <= 23)
                        memoryReminderHourUses.push(h);
                }
                let hasReminder = false;
                if (kind === 'create_reminder') {
                    if (!isPro) {
                        throw new functions.https.HttpsError('failed-precondition', 'Plan pro requis pour créer un rappel.');
                    }
                    const remindAtIso = finalRemindAt.toDate().toISOString();
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
                followupTasks = [{ taskId: taskRef.id, dueDate: finalDueDate !== null && finalDueDate !== void 0 ? finalDueDate : null, hasReminder }];
            }
        }
        decisionId = decisionRef.id;
        const decisionDoc = {
            suggestionId,
            objectId: suggestion.objectId,
            action: isEdited ? 'edited_then_accepted' : 'accepted',
            createdCoreObjects: [...createdCoreObjects],
            beforePayload,
            finalPayload: finalPayload !== null && finalPayload !== void 0 ? finalPayload : undefined,
            pipelineVersion: 1,
            createdAt,
            updatedAt,
        };
        tx.create(decisionRef, decisionDoc);
        tx.set(metricsRef, metricsIncrements({
            suggestionsAccepted: isEdited ? 0 : 1,
            suggestionsEditedAccepted: isEdited ? 1 : 0,
            followupSuggestionsAccepted: suggestion.source.type === 'task' ? 1 : 0,
            decisionsCount: 1,
            totalTimeToDecisionMs: timeToDecisionMs ? timeToDecisionMs : 0,
        }), { merge: true });
        if (memoryPriorityUses.length > 0 || memoryReminderHourUses.length > 0) {
            const existing = existingMemory;
            const prevPriorityCounts = (_y = existing === null || existing === void 0 ? void 0 : existing.stats) === null || _y === void 0 ? void 0 : _y.priorityCounts;
            const nextPriorityCounts = {
                low: typeof (prevPriorityCounts === null || prevPriorityCounts === void 0 ? void 0 : prevPriorityCounts.low) === 'number' && Number.isFinite(prevPriorityCounts.low) ? prevPriorityCounts.low : 0,
                medium: typeof (prevPriorityCounts === null || prevPriorityCounts === void 0 ? void 0 : prevPriorityCounts.medium) === 'number' && Number.isFinite(prevPriorityCounts.medium) ? prevPriorityCounts.medium : 0,
                high: typeof (prevPriorityCounts === null || prevPriorityCounts === void 0 ? void 0 : prevPriorityCounts.high) === 'number' && Number.isFinite(prevPriorityCounts.high) ? prevPriorityCounts.high : 0,
            };
            const prevReminderCounts = (_z = existing === null || existing === void 0 ? void 0 : existing.stats) === null || _z === void 0 ? void 0 : _z.reminderHourCounts;
            const nextReminderCounts = Object.assign({}, (prevReminderCounts && typeof prevReminderCounts === 'object' ? prevReminderCounts : {}));
            let changed = false;
            for (const p of memoryPriorityUses) {
                nextPriorityCounts[p] = ((_0 = nextPriorityCounts[p]) !== null && _0 !== void 0 ? _0 : 0) + 1;
                changed = true;
            }
            for (const hour of memoryReminderHourUses) {
                const k = String(hour);
                const prev = typeof nextReminderCounts[k] === 'number' && Number.isFinite(nextReminderCounts[k]) ? nextReminderCounts[k] : 0;
                nextReminderCounts[k] = prev + 1;
                changed = true;
            }
            const totalP = nextPriorityCounts.low + nextPriorityCounts.medium + nextPriorityCounts.high;
            const topP = nextPriorityCounts.high >= nextPriorityCounts.medium && nextPriorityCounts.high >= nextPriorityCounts.low
                ? { p: 'high', c: nextPriorityCounts.high }
                : nextPriorityCounts.medium >= nextPriorityCounts.low
                    ? { p: 'medium', c: nextPriorityCounts.medium }
                    : { p: 'low', c: nextPriorityCounts.low };
            const nextDefaultPriority = totalP >= 5 && topP.c / totalP > 0.6 ? topP.p : existing === null || existing === void 0 ? void 0 : existing.defaultPriority;
            if (typeof nextDefaultPriority !== 'undefined' && nextDefaultPriority !== (existing === null || existing === void 0 ? void 0 : existing.defaultPriority)) {
                changed = true;
            }
            let nextDefaultReminderHour = existing === null || existing === void 0 ? void 0 : existing.defaultReminderHour;
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
            if (typeof nextDefaultReminderHour !== 'undefined' && nextDefaultReminderHour !== (existing === null || existing === void 0 ? void 0 : existing.defaultReminderHour)) {
                changed = true;
            }
            if (typeof nextDefaultReminderHour === 'number' && Number.isFinite(nextDefaultReminderHour)) {
                const h = Math.trunc(nextDefaultReminderHour);
                if (h >= 0 && h <= 23)
                    followupReminderHour = h;
            }
            if (changed) {
                tx.set(memoryLiteRef, Object.assign(Object.assign(Object.assign({}, (typeof nextDefaultPriority !== 'undefined' ? { defaultPriority: nextDefaultPriority } : {})), (typeof nextDefaultReminderHour !== 'undefined' ? { defaultReminderHour: nextDefaultReminderHour } : {})), { stats: {
                        priorityCounts: nextPriorityCounts,
                        reminderHourCounts: nextReminderCounts,
                    }, updatedAt }), { merge: true });
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
        const createFavorite = async (taskId) => {
            const favoriteKey = buildFollowupDedupeKey({
                taskId,
                kind: 'update_task_meta',
                minimal: { favorite: true },
            });
            const favoriteRef = suggestionsCol.doc(favoriteKey);
            await db.runTransaction(async (tx) => {
                var _a, _b;
                const existing = await tx.get(favoriteRef);
                const status = existing.exists ? (_a = existing.data()) === null || _a === void 0 ? void 0 : _a.status : undefined;
                const updatedAtExisting = existing.exists ? (_b = existing.data()) === null || _b === void 0 ? void 0 : _b.updatedAt : null;
                const rejectedTooRecent = status === 'rejected' && updatedAtExisting instanceof admin.firestore.Timestamp
                    ? nowTs.toMillis() - updatedAtExisting.toMillis() < ASSISTANT_FOLLOWUP_REJECT_COOLDOWN_MS
                    : false;
                const createdAt = admin.firestore.FieldValue.serverTimestamp();
                const updatedAt = admin.firestore.FieldValue.serverTimestamp();
                if (!existing.exists) {
                    const doc = {
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
        const createReminder = async (params) => {
            if (!followupIsPro)
                return;
            if (followupReminderHour === null)
                return;
            const due = params.dueDate.toDate();
            const remind = new Date(due.getTime());
            remind.setDate(remind.getDate() - 1);
            remind.setHours(followupReminderHour, 0, 0, 0);
            if (!Number.isFinite(remind.getTime()) || remind.getTime() <= nowTs.toMillis())
                return;
            const remindAt = admin.firestore.Timestamp.fromDate(remind);
            const reminderKey = buildFollowupDedupeKey({
                taskId: params.taskId,
                kind: 'create_reminder',
                minimal: { remindAtMs: remindAt.toMillis() },
            });
            const reminderRef = suggestionsCol.doc(reminderKey);
            await db.runTransaction(async (tx) => {
                var _a, _b;
                const existing = await tx.get(reminderRef);
                const status = existing.exists ? (_a = existing.data()) === null || _a === void 0 ? void 0 : _a.status : undefined;
                const updatedAtExisting = existing.exists ? (_b = existing.data()) === null || _b === void 0 ? void 0 : _b.updatedAt : null;
                const rejectedTooRecent = status === 'rejected' && updatedAtExisting instanceof admin.firestore.Timestamp
                    ? nowTs.toMillis() - updatedAtExisting.toMillis() < ASSISTANT_FOLLOWUP_REJECT_COOLDOWN_MS
                    : false;
                const createdAt = admin.firestore.FieldValue.serverTimestamp();
                const updatedAt = admin.firestore.FieldValue.serverTimestamp();
                const title = `Ajouter un rappel la veille à ${followupReminderHour}h ?`;
                if (!existing.exists) {
                    const doc = {
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
        await Promise.all(followupTasks.flatMap((t) => {
            const ops = [createFavorite(t.taskId)];
            if (t.dueDate && !t.hasReminder) {
                ops.push(createReminder({ taskId: t.taskId, dueDate: t.dueDate }));
            }
            return ops;
        }));
    }
    return {
        createdCoreObjects,
        decisionId,
    };
});
exports.assistantRejectSuggestion = functions.https.onCall(async (data, context) => {
    var _a;
    const userId = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!userId) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
    }
    const suggestionId = typeof (data === null || data === void 0 ? void 0 : data.suggestionId) === 'string' ? String(data.suggestionId) : null;
    if (!suggestionId) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing suggestionId.');
    }
    const db = admin.firestore();
    const userRef = db.collection('users').doc(userId);
    const suggestionRef = userRef.collection('assistantSuggestions').doc(suggestionId);
    const decisionsCol = userRef.collection('assistantDecisions');
    const metricsRef = assistantMetricsRef(db, userId);
    const decisionRef = decisionsCol.doc();
    let decisionId = null;
    await db.runTransaction(async (tx) => {
        const suggestionSnap = await tx.get(suggestionRef);
        if (!suggestionSnap.exists) {
            throw new functions.https.HttpsError('not-found', 'Suggestion not found.');
        }
        const suggestion = suggestionSnap.data();
        if (suggestion.status !== 'proposed') {
            throw new functions.https.HttpsError('failed-precondition', 'Suggestion is not proposed.');
        }
        const nowTs = admin.firestore.Timestamp.now();
        const suggestionCreatedAt = (suggestion === null || suggestion === void 0 ? void 0 : suggestion.createdAt) instanceof admin.firestore.Timestamp ? suggestion.createdAt : null;
        const timeToDecisionMs = suggestionCreatedAt ? Math.max(0, nowTs.toMillis() - suggestionCreatedAt.toMillis()) : null;
        const beforePayload = suggestion.payload;
        const nowServer = admin.firestore.FieldValue.serverTimestamp();
        decisionId = decisionRef.id;
        const decisionDoc = {
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
        tx.set(metricsRef, metricsIncrements({
            suggestionsRejected: 1,
            decisionsCount: 1,
            totalTimeToDecisionMs: timeToDecisionMs ? timeToDecisionMs : 0,
        }), { merge: true });
        tx.update(suggestionRef, {
            status: 'rejected',
            updatedAt: nowServer,
        });
    });
    return { decisionId };
});
exports.assistantRequestReanalysis = functions.https.onCall(async (data, context) => {
    var _a;
    const userId = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!userId) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
    }
    const noteId = typeof (data === null || data === void 0 ? void 0 : data.noteId) === 'string' ? String(data.noteId) : null;
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
    const note = noteSnap.data();
    const noteUserId = typeof (note === null || note === void 0 ? void 0 : note.userId) === 'string' ? note.userId : null;
    if (noteUserId !== userId) {
        throw new functions.https.HttpsError('permission-denied', 'Not allowed.');
    }
    const title = typeof (note === null || note === void 0 ? void 0 : note.title) === 'string' ? note.title : '';
    const content = typeof (note === null || note === void 0 ? void 0 : note.content) === 'string' ? note.content : '';
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
        var _a, _b;
        const jobSnap = await tx.get(jobRef);
        const jobData = jobSnap.exists ? jobSnap.data() : null;
        const st = jobData === null || jobData === void 0 ? void 0 : jobData.status;
        const pending = typeof (jobData === null || jobData === void 0 ? void 0 : jobData.pendingTextHash) === 'string' ? jobData.pendingTextHash : null;
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
        const plan = userSnap.exists && typeof ((_a = userSnap.data()) === null || _a === void 0 ? void 0 : _a.plan) === 'string' ? String(userSnap.data().plan) : 'free';
        const dailyLimit = plan === 'pro' ? ASSISTANT_REANALYSIS_PRO_DAILY_LIMIT : ASSISTANT_REANALYSIS_FREE_DAILY_LIMIT;
        const prevCount = usageSnap.exists && typeof ((_b = usageSnap.data()) === null || _b === void 0 ? void 0 : _b.reanalysisCount) === 'number' ? Number(usageSnap.data().reanalysisCount) : 0;
        if (prevCount >= dailyLimit) {
            throw new functions.https.HttpsError('resource-exhausted', 'Daily reanalysis limit reached.');
        }
        const objectData = objectSnap.exists ? objectSnap.data() : null;
        const existingTextHash = objectData && typeof (objectData === null || objectData === void 0 ? void 0 : objectData.textHash) === 'string' ? objectData.textHash : null;
        tx.set(usageRef, {
            reanalysisCount: admin.firestore.FieldValue.increment(1),
            lastUpdatedAt: nowServer,
        }, { merge: true });
        tx.set(metricsRef, metricsIncrements({ reanalysisRequested: 1 }), { merge: true });
        // If a job is already active, we only update pendingTextHash (no duplicate job).
        if (isActive) {
            tx.set(objectRef, {
                pendingTextHash: textHash,
                updatedAt: nowServer,
            }, { merge: true });
            tx.set(jobRef, {
                pendingTextHash: textHash,
                updatedAt: nowServer,
            }, { merge: true });
            return;
        }
        const objectPayload = {
            objectId,
            type: 'note',
            coreRef: { collection: 'notes', id: noteId },
            textHash: existingTextHash !== null && existingTextHash !== void 0 ? existingTextHash : textHash,
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
        const jobPayload = {
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
        }
        else {
            tx.create(jobRef, jobPayload);
        }
    });
    return { jobId: jobRef.id };
});
exports.assistantRequestAIAnalysis = functions.https.onCall(async (data, context) => {
    var _a;
    const userId = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!userId) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
    }
    const noteId = typeof (data === null || data === void 0 ? void 0 : data.noteId) === 'string' ? String(data.noteId) : null;
    if (!noteId) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing noteId.');
    }
    const modesRaw = Array.isArray(data === null || data === void 0 ? void 0 : data.modes) ? data.modes : null;
    const allowedModes = new Set(['summary', 'actions', 'hooks', 'rewrite', 'entities']);
    const modes = modesRaw
        ? modesRaw
            .filter((m) => typeof m === 'string')
            .map((m) => String(m))
            .filter((m) => allowedModes.has(m))
        : ['summary', 'actions', 'hooks', 'rewrite', 'entities'];
    const model = normalizeAssistantAIModel(data === null || data === void 0 ? void 0 : data.model);
    const db = admin.firestore();
    const enabled = await isAssistantEnabledForUser(db, userId);
    if (!enabled) {
        throw new functions.https.HttpsError('failed-precondition', 'Assistant disabled.');
    }
    const noteSnap = await db.collection('notes').doc(noteId).get();
    if (!noteSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Note not found.');
    }
    const note = noteSnap.data();
    const noteUserId = typeof (note === null || note === void 0 ? void 0 : note.userId) === 'string' ? note.userId : null;
    if (noteUserId !== userId) {
        throw new functions.https.HttpsError('permission-denied', 'Not allowed.');
    }
    const title = typeof (note === null || note === void 0 ? void 0 : note.title) === 'string' ? note.title : '';
    const content = typeof (note === null || note === void 0 ? void 0 : note.content) === 'string' ? note.content : '';
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
        var _a, _b;
        const [userSnap, usageSnap, jobSnap, resultSnap] = await Promise.all([
            tx.get(userRef),
            tx.get(usageRef),
            tx.get(jobRef),
            tx.get(resultRef),
        ]);
        if (resultSnap.exists) {
            tx.set(jobRef, {
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
            }, { merge: true });
            return;
        }
        const plan = userSnap.exists && typeof ((_a = userSnap.data()) === null || _a === void 0 ? void 0 : _a.plan) === 'string' ? String(userSnap.data().plan) : 'free';
        const dailyLimit = plan === 'pro' ? ASSISTANT_AI_ANALYSIS_PRO_DAILY_LIMIT : ASSISTANT_AI_ANALYSIS_FREE_DAILY_LIMIT;
        const prevCount = usageSnap.exists && typeof ((_b = usageSnap.data()) === null || _b === void 0 ? void 0 : _b.aiAnalysisCount) === 'number' ? Number(usageSnap.data().aiAnalysisCount) : 0;
        if (prevCount >= dailyLimit) {
            throw new functions.https.HttpsError('resource-exhausted', 'Daily AI analysis limit reached.');
        }
        const jobData = jobSnap.exists ? jobSnap.data() : null;
        const st = jobData === null || jobData === void 0 ? void 0 : jobData.status;
        const pending = typeof (jobData === null || jobData === void 0 ? void 0 : jobData.pendingTextHash) === 'string' ? jobData.pendingTextHash : null;
        const isActive = st === 'queued' || st === 'processing';
        if (isActive && pending === textHash && (jobData === null || jobData === void 0 ? void 0 : jobData.model) === model) {
            return;
        }
        tx.set(usageRef, {
            aiAnalysisCount: admin.firestore.FieldValue.increment(1),
            lastUpdatedAt: nowServer,
        }, { merge: true });
        tx.set(metricsRef, metricsIncrements({ aiAnalysesRequested: 1 }), { merge: true });
        const payload = {
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
        }
        else {
            tx.create(jobRef, payload);
        }
    });
    return { jobId: jobRef.id, resultId };
});
const ASSISTANT_AI_JOB_LOCK_MS = 5 * 60 * 1000;
const ASSISTANT_AI_JOB_MAX_ATTEMPTS = 3;
async function claimAssistantAIJob(params) {
    const { db, ref, now } = params;
    return await db.runTransaction(async (tx) => {
        var _a;
        const snap = await tx.get(ref);
        if (!snap.exists)
            return null;
        const data = snap.data();
        const status = data === null || data === void 0 ? void 0 : data.status;
        if (status !== 'queued')
            return null;
        const attempts = typeof (data === null || data === void 0 ? void 0 : data.attempts) === 'number' ? data.attempts : 0;
        if (attempts >= ASSISTANT_AI_JOB_MAX_ATTEMPTS) {
            tx.update(ref, { status: 'error', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
            return null;
        }
        const lockedUntil = (_a = data === null || data === void 0 ? void 0 : data.lockedUntil) !== null && _a !== void 0 ? _a : null;
        if (lockedUntil && lockedUntil.toMillis() > now.toMillis())
            return null;
        const nextLocked = admin.firestore.Timestamp.fromMillis(now.toMillis() + ASSISTANT_AI_JOB_LOCK_MS);
        tx.update(ref, {
            status: 'processing',
            attempts: attempts + 1,
            lockedUntil: nextLocked,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return snap.data();
    });
}
async function processAssistantAIJob(params) {
    var _a, _b, _c;
    const { db, userId, jobDoc, nowDate, nowTs } = params;
    const claimed = await claimAssistantAIJob({ db, ref: jobDoc.ref, now: nowTs });
    if (!claimed)
        return;
    const noteId = typeof (claimed === null || claimed === void 0 ? void 0 : claimed.noteId) === 'string' ? String(claimed.noteId) : null;
    const objectId = typeof claimed.objectId === 'string' ? claimed.objectId : null;
    const defaultModel = getAssistantAIDefaultModel();
    const model = normalizeAssistantAIModel(claimed === null || claimed === void 0 ? void 0 : claimed.model);
    const schemaVersion = typeof claimed.schemaVersion === 'number' ? Math.trunc(claimed.schemaVersion) : ASSISTANT_AI_SCHEMA_VERSION;
    const modes = Array.isArray(claimed === null || claimed === void 0 ? void 0 : claimed.modes) ? claimed.modes.filter((m) => typeof m === 'string').map((m) => String(m)) : [];
    if (!noteId || !objectId)
        return;
    const metricsRef = assistantMetricsRef(db, userId);
    const userRef = db.collection('users').doc(userId);
    try {
        const noteSnap = await db.collection('notes').doc(noteId).get();
        const note = noteSnap.exists ? noteSnap.data() : null;
        const noteUserId = typeof (note === null || note === void 0 ? void 0 : note.userId) === 'string' ? note.userId : null;
        if (!note || noteUserId !== userId) {
            await jobDoc.ref.update({ status: 'error', lockedUntil: admin.firestore.Timestamp.fromMillis(0), error: 'Note not accessible', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
            return;
        }
        const title = typeof (note === null || note === void 0 ? void 0 : note.title) === 'string' ? note.title : '';
        const content = typeof (note === null || note === void 0 ? void 0 : note.content) === 'string' ? note.content : '';
        const normalized = normalizeAssistantText(`${title}\n${content}`);
        const textHash = sha256Hex(normalized);
        const modesSig = modes.slice().sort().join(',');
        const resultIdForModel = (m) => sha256Hex(`${objectId}|${textHash}|${m}|schema:${schemaVersion}|modes:${modesSig}`);
        const requestedResultId = resultIdForModel(model);
        const requestedResultRef = userRef.collection('assistantAIResults').doc(requestedResultId);
        const fallbackResultId = model !== defaultModel ? resultIdForModel(defaultModel) : null;
        const fallbackResultRef = fallbackResultId ? userRef.collection('assistantAIResults').doc(fallbackResultId) : null;
        const [existingRequested, existingFallback] = await Promise.all([
            requestedResultRef.get(),
            fallbackResultRef ? fallbackResultRef.get() : Promise.resolve(null),
        ]);
        if (existingRequested.exists) {
            await jobDoc.ref.update({ status: 'done', lockedUntil: admin.firestore.Timestamp.fromMillis(0), pendingTextHash: null, resultId: requestedResultId, model, error: null, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
            return;
        }
        if (fallbackResultRef && existingFallback && existingFallback.exists) {
            await jobDoc.ref.update({ status: 'done', lockedUntil: admin.firestore.Timestamp.fromMillis(0), pendingTextHash: null, resultId: fallbackResultId, model: defaultModel, error: null, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
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
        let usedModel = model;
        let llm = await callOpenAIResponsesJsonSchema({ model: usedModel, instructions, inputText, schema: ASSISTANT_AI_OUTPUT_SCHEMA_V1 }).catch(async (e) => {
            if (usedModel !== defaultModel && isOpenAIModelAccessError(e)) {
                usedModel = defaultModel;
                return await callOpenAIResponsesJsonSchema({ model: usedModel, instructions, inputText, schema: ASSISTANT_AI_OUTPUT_SCHEMA_V1 });
            }
            throw e;
        });
        const usedResultId = resultIdForModel(usedModel);
        const usedResultRef = userRef.collection('assistantAIResults').doc(usedResultId);
        const nowServer = admin.firestore.FieldValue.serverTimestamp();
        const resultDoc = {
            noteId,
            objectId,
            textHash,
            model: usedModel,
            schemaVersion,
            modes,
            refusal: llm.refusal,
            usage: llm.usage ? { inputTokens: llm.usage.inputTokens, outputTokens: llm.usage.outputTokens, totalTokens: llm.usage.totalTokens } : undefined,
            output: (_a = llm.parsed) !== null && _a !== void 0 ? _a : undefined,
            createdAt: nowServer,
            updatedAt: nowServer,
        };
        await usedResultRef.create(resultDoc);
        const inc = {
            aiAnalysesCompleted: 1,
            aiResultsCreated: 1,
        };
        if ((_b = llm.usage) === null || _b === void 0 ? void 0 : _b.inputTokens)
            inc.aiTokensIn = llm.usage.inputTokens;
        if ((_c = llm.usage) === null || _c === void 0 ? void 0 : _c.outputTokens)
            inc.aiTokensOut = llm.usage.outputTokens;
        await metricsRef.set(metricsIncrements(inc), { merge: true });
        const suggestionsCol = userRef.collection('assistantSuggestions');
        const expiresAt = admin.firestore.Timestamp.fromMillis(nowDate.getTime() + 14 * 24 * 60 * 60 * 1000);
        const outputObj = llm.parsed && typeof llm.parsed === 'object' ? llm.parsed : null;
        const contentSuggestions = [];
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
            const payload = Object.assign(Object.assign({ title: cs.title }, cs.payloadExtra), { origin: { fromText: 'Analyse IA' }, confidence: 0.7, explanation: 'Suggestion générée par IA.' });
            await db.runTransaction(async (tx) => {
                var _a;
                const existingSug = await tx.get(sugRef);
                if (existingSug.exists) {
                    const st = (_a = existingSug.data()) === null || _a === void 0 ? void 0 : _a.status;
                    if (st === 'proposed' || st === 'accepted')
                        return;
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
                const doc = {
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
        const actions = outputObj && Array.isArray(outputObj.actions) ? outputObj.actions : [];
        for (const a of actions) {
            const kind = typeof (a === null || a === void 0 ? void 0 : a.kind) === 'string' ? String(a.kind) : '';
            const titleA = typeof (a === null || a === void 0 ? void 0 : a.title) === 'string' ? String(a.title).trim() : '';
            if (!titleA)
                continue;
            if (kind === 'create_task_bundle') {
                const tasksRaw = Array.isArray(a === null || a === void 0 ? void 0 : a.tasks) ? a.tasks : [];
                const tasks = [];
                for (const t of tasksRaw) {
                    const tt = typeof (t === null || t === void 0 ? void 0 : t.title) === 'string' ? String(t.title).trim() : '';
                    if (!tt)
                        continue;
                    const dueDate = parseIsoToTimestamp(t === null || t === void 0 ? void 0 : t.dueDateIso);
                    const remindAt = parseIsoToTimestamp(t === null || t === void 0 ? void 0 : t.remindAtIso);
                    const pr = (t === null || t === void 0 ? void 0 : t.priority) === 'low' || (t === null || t === void 0 ? void 0 : t.priority) === 'medium' || (t === null || t === void 0 ? void 0 : t.priority) === 'high' ? t.priority : undefined;
                    tasks.push(Object.assign(Object.assign(Object.assign(Object.assign({ title: tt }, (dueDate ? { dueDate } : {})), (remindAt ? { remindAt } : {})), (pr ? { priority: pr } : {})), { origin: { fromText: 'Analyse IA' } }));
                }
                if (tasks.length === 0)
                    continue;
                const tasksSig = tasks
                    .map((t) => `${normalizeAssistantText(t.title)}|${t.dueDate ? t.dueDate.toMillis() : ''}|${t.remindAt ? t.remindAt.toMillis() : ''}`)
                    .join('||');
                const dedupeKey = buildBundleDedupeKey({ objectId, minimal: { title: titleA, tasksSig } });
                const sugRef = suggestionsCol.doc(dedupeKey);
                const payload = {
                    title: titleA,
                    tasks,
                    bundleMode: 'multiple_tasks',
                    noteId,
                    origin: { fromText: 'Analyse IA' },
                    confidence: 0.7,
                    explanation: 'Suggestion générée par IA.',
                };
                await db.runTransaction(async (tx) => {
                    var _a;
                    const existingSug = await tx.get(sugRef);
                    if (existingSug.exists) {
                        const st = (_a = existingSug.data()) === null || _a === void 0 ? void 0 : _a.status;
                        if (st === 'proposed' || st === 'accepted')
                            return;
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
                    const doc = {
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
                const dueDate = parseIsoToTimestamp(a === null || a === void 0 ? void 0 : a.dueDateIso);
                const remindAt = parseIsoToTimestamp(a === null || a === void 0 ? void 0 : a.remindAtIso);
                const pr = (a === null || a === void 0 ? void 0 : a.priority) === 'low' || (a === null || a === void 0 ? void 0 : a.priority) === 'medium' || (a === null || a === void 0 ? void 0 : a.priority) === 'high' ? a.priority : undefined;
                const dedupeKey = buildSuggestionDedupeKey({
                    objectId,
                    kind: kind,
                    minimal: {
                        title: titleA,
                        dueDateMs: dueDate ? dueDate.toMillis() : null,
                        remindAtMs: remindAt ? remindAt.toMillis() : null,
                    },
                });
                const sugRef = suggestionsCol.doc(dedupeKey);
                const payload = Object.assign(Object.assign(Object.assign(Object.assign({ title: titleA }, (dueDate ? { dueDate } : {})), (remindAt ? { remindAt } : {})), (pr ? { priority: pr } : {})), { origin: { fromText: 'Analyse IA' }, confidence: 0.7, explanation: 'Suggestion générée par IA.' });
                await db.runTransaction(async (tx) => {
                    var _a;
                    const existingSug = await tx.get(sugRef);
                    if (existingSug.exists) {
                        const st = (_a = existingSug.data()) === null || _a === void 0 ? void 0 : _a.status;
                        if (st === 'proposed' || st === 'accepted')
                            return;
                        tx.update(sugRef, {
                            objectId,
                            source: { type: 'note', id: noteId },
                            kind: kind,
                            payload,
                            status: 'proposed',
                            pipelineVersion: 1,
                            dedupeKey,
                            updatedAt: nowServer,
                            expiresAt,
                        });
                        return;
                    }
                    const doc = {
                        objectId,
                        source: { type: 'note', id: noteId },
                        kind: kind,
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
            error: null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    catch (e) {
        try {
            console.error('assistant AI job failed', {
                userId,
                jobId: jobDoc.id,
                message: e instanceof Error ? e.message : String(e),
                stack: e instanceof Error ? e.stack : undefined,
            });
        }
        catch (_d) {
            // ignore
        }
        await jobDoc.ref.update({
            status: 'error',
            lockedUntil: admin.firestore.Timestamp.fromMillis(0),
            error: e instanceof Error ? e.message : 'AI job error',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        try {
            await metricsRef.set(metricsIncrements({ aiAnalysesErrored: 1 }), { merge: true });
        }
        catch (_e) {
            // ignore
        }
    }
}
exports.assistantRunAIJobQueue = functions.pubsub
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
        const userId = userRef === null || userRef === void 0 ? void 0 : userRef.id;
        if (!userId)
            return;
        const enabled = await isAssistantEnabledForUser(db, userId);
        if (!enabled)
            return;
        await processAssistantAIJob({ db, userId, jobDoc, nowDate, nowTs });
    });
    await Promise.all(tasks);
});
//# sourceMappingURL=index.js.map