/*
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { httpsCallable } from "firebase/functions";
import { doc, onSnapshot } from "firebase/firestore";
import { ref as storageRef, uploadBytes } from "firebase/storage";
import { db, functions as fbFunctions, storage } from "@/lib/firebase";
import { invalidateAuthSession, isAuthInvalidError } from "@/lib/authInvalidation";
import { useAuth } from "@/hooks/useAuth";
import { toUserErrorMessage } from "@/lib/userError";

type Props = {
  mobileHidden?: boolean;
  renderCustomTrigger?: (args: {
    onClick: () => void;
    ariaLabel: string;
    title: string;
  }) => ReactNode;
};

type ExecuteIntentResponse = {
  intent: {
    kind: "create_todo" | "create_task" | "create_reminder" | "schedule_meeting";
    title: string;
    confidence: number;
    requiresConfirmation: boolean;
    requiresConfirmationReason?: string | null;
    remindAtIso?: string | null;
  };
  executed: boolean;
  needsClarification?: boolean;
  missingFields?: string[];
  clarificationQuestion?: string | null;
  createdCoreObjects: Array<{ type: "task" | "taskReminder" | "calendarEvent" | "todo"; id: string }>;
  message: string;
};

type VoiceFlowStep = "idle" | "listening" | "uploading" | "transcribing" | "review" | "clarify" | "executing" | "done" | "error";
type LocalVoiceActionPlan = {
  kind: "note" | "task" | "checklist" | "search" | "navigation" | "unknown";
  payload: string;
  typeLabel: string;
  proposedAction: string;
  detectedDateLabel: string | null;
  startDate: string | null;
  executable: boolean;
};

type LocalIntentKind = "note" | "task" | "checklist" | "search" | "navigation" | "unknown";

type LocalTemporalMatch = {
  label: string;
};

type LocalVoiceIntentKind = "note" | "task" | "checklist" | "search" | "navigation" | "unknown";

function mapMicrophoneAccessError(err: unknown): string {
  if (err instanceof DOMException) {
    const name = String(err.name || "").toLowerCase();
    const message = String(err.message || "").toLowerCase();
    if (name.includes("notfound") || message.includes("requested device not found") || message.includes("device not found")) {
      return "Aucun micro disponible. Vérifie ton appareil audio puis réessaie.";
    }
    if (name.includes("notallowed") || name.includes("security") || message.includes("permission") || message.includes("denied")) {
      return "Permission micro refusée. Autorise le micro dans ton navigateur puis recharge la page.";
    }
    if (name.includes("notreadable") || message.includes("could not start audio source")) {
      return "Le micro est indisponible (utilisé par une autre application ou bloqué par le système).";
    }
    return err.message || "Impossible d’accéder au micro.";
  }

  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("requested device not found") || msg.includes("device not found")) {
      return "Aucun micro disponible. Vérifie ton appareil audio puis réessaie.";
    }
    if (msg.includes("permission") || msg.includes("notallowed") || msg.includes("denied")) {
      return "Permission micro refusée. Autorise le micro dans ton navigateur puis recharge la page.";
    }
    if (msg.includes("not supported") || msg.includes("unsupported")) {
      return "Enregistrement micro non supporté sur cet appareil.";
    }
    return err.message;
  }

  if (typeof err === "string") {
    const msg = err.toLowerCase();
    if (msg.includes("requested device not found") || msg.includes("device not found")) {
      return "Aucun micro disponible. Vérifie ton appareil audio puis réessaie.";
    }
    if (msg.includes("permission") || msg.includes("notallowed") || msg.includes("denied")) {
      return "Permission micro refusée. Autorise le micro dans ton navigateur puis recharge la page.";
    }
    return `Impossible d’accéder au micro: ${err}`;
  }

  return "Impossible d’accéder au micro.";
}

function extractVoiceErrorCode(err: unknown): string {
  const code = typeof (err as { code?: unknown })?.code === "string" ? String((err as { code?: unknown }).code) : "";
  return code.toLowerCase();
}

function inferVoiceFileExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("ogg") || normalized.includes("opus")) return "ogg";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("x-m4a") || normalized.includes("m4a")) return "m4a";
  if (normalized.includes("mp4") || normalized.includes("aac")) return "mp4";
  return "webm";
}

function mapVoiceFlowError(stage: "create_job" | "upload" | "transcription_request" | "backend_invalid", err: unknown): string {
  const code = extractVoiceErrorCode(err);
  const asMessage = toUserErrorMessage(err, "");
  const message = asMessage.trim().toLowerCase();

  if (code.includes("permission-denied") || message.includes("permission")) {
    return "Permission refusée pour traiter l’audio côté serveur.";
  }
  if (code.includes("resource-exhausted") || message.includes("daily transcription limit")) {
    return "Limite de transcription atteinte pour aujourd’hui.";
  }
  if (code.includes("invalid-argument")) {
    return "Audio invalide pour la transcription.";
  }
  if (code.includes("failed-precondition")) {
    if (message.includes("audio file missing")) return "Fichier audio introuvable après capture.";
    if (message.includes("audio file invalid")) return "Capture audio vide ou invalide.";
    if (message.includes("already in progress")) return "Une transcription est déjà en cours. Réessaie dans quelques secondes.";
  }

  if (stage === "create_job") return "Impossible de préparer l’enregistrement audio.";
  if (stage === "upload") return "Échec d’envoi du fichier audio.";
  if (stage === "transcription_request") return "Échec de la demande de transcription.";
  return "Réponse backend invalide pendant la transcription.";
}

function pickSupportedRecordingMimeType(): string {
  if (typeof window === "undefined") return "";
  const mediaRecorder = window.MediaRecorder as unknown as { isTypeSupported?: (t: string) => boolean } | undefined;
  const can = (value: string) => Boolean(mediaRecorder?.isTypeSupported?.(value));
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  return candidates.find(can) ?? "";
}

function extractVoiceErrorCode(err: unknown): string {
  const code = typeof (err as { code?: unknown })?.code === "string" ? String((err as { code?: unknown }).code) : "";
  return code.toLowerCase();
}

function inferVoiceFileExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("ogg") || normalized.includes("opus")) return "ogg";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("x-m4a") || normalized.includes("m4a")) return "m4a";
  if (normalized.includes("mp4") || normalized.includes("aac")) return "mp4";
  return "webm";
}

function mapVoiceFlowError(stage: "create_job" | "upload" | "transcription_request" | "backend_invalid", err: unknown): string {
  const code = extractVoiceErrorCode(err);
  const asMessage = toUserErrorMessage(err, "");
  const message = asMessage.trim().toLowerCase();

  if (code.includes("permission-denied") || message.includes("permission")) {
    return "Permission refusée pour traiter l’audio côté serveur.";
  }
  if (code.includes("resource-exhausted") || message.includes("daily transcription limit")) {
    return "Limite de transcription atteinte pour aujourd’hui.";
  }
  if (code.includes("invalid-argument")) {
    return "Audio invalide pour la transcription.";
  }
  if (code.includes("failed-precondition")) {
    if (message.includes("audio file missing")) return "Fichier audio introuvable après capture.";
    if (message.includes("audio file invalid")) return "Capture audio vide ou invalide.";
    if (message.includes("already in progress")) return "Une transcription est déjà en cours. Réessaie dans quelques secondes.";
  }

  if (stage === "create_job") return "Impossible de préparer l’enregistrement audio.";
  if (stage === "upload") return "Échec d’envoi du fichier audio.";
  if (stage === "transcription_request") return "Échec de la demande de transcription.";
  return "Réponse backend invalide pendant la transcription.";
}

function pickSupportedRecordingMimeType(): string {
  if (typeof window === "undefined") return "";
  const mediaRecorder = window.MediaRecorder as unknown as { isTypeSupported?: (t: string) => boolean } | undefined;
  const can = (value: string) => Boolean(mediaRecorder?.isTypeSupported?.(value));
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  return candidates.find(can) ?? "";
}

function extractVoiceErrorCode(err: unknown): string {
  const code = typeof (err as { code?: unknown })?.code === "string" ? String((err as { code?: unknown }).code) : "";
  return code.toLowerCase();
}

function inferVoiceFileExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("ogg") || normalized.includes("opus")) return "ogg";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("x-m4a") || normalized.includes("m4a")) return "m4a";
  if (normalized.includes("mp4") || normalized.includes("aac")) return "mp4";
  return "webm";
}

function mapVoiceFlowError(stage: "create_job" | "upload" | "transcription_request" | "backend_invalid", err: unknown): string {
  const code = extractVoiceErrorCode(err);
  const asMessage = toUserErrorMessage(err, "");
  const message = asMessage.trim().toLowerCase();

  if (code.includes("permission-denied") || message.includes("permission")) {
    return "Permission refusée pour traiter l’audio côté serveur.";
  }
  if (code.includes("resource-exhausted") || message.includes("daily transcription limit")) {
    return "Limite de transcription atteinte pour aujourd’hui.";
  }
  if (code.includes("invalid-argument")) {
    return "Audio invalide pour la transcription.";
  }
  if (code.includes("failed-precondition")) {
    if (message.includes("audio file missing")) return "Fichier audio introuvable après capture.";
    if (message.includes("audio file invalid")) return "Capture audio vide ou invalide.";
    if (message.includes("already in progress")) return "Une transcription est déjà en cours. Réessaie dans quelques secondes.";
  }

  if (stage === "create_job") return "Impossible de préparer l’enregistrement audio.";
  if (stage === "upload") return "Échec d’envoi du fichier audio.";
  if (stage === "transcription_request") return "Échec de la demande de transcription.";
  return "Réponse backend invalide pendant la transcription.";
}

function pickSupportedRecordingMimeType(): string {
  if (typeof window === "undefined") return "";
  const mediaRecorder = window.MediaRecorder as unknown as { isTypeSupported?: (t: string) => boolean } | undefined;
  const can = (value: string) => Boolean(mediaRecorder?.isTypeSupported?.(value));
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  return candidates.find(can) ?? "";
}

function normalizeVoiceText(raw: string) {
  return raw
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanIntentPayload(raw: string | undefined) {
  if (!raw) return "";
  return raw.replace(/^[:\s-]+/, "").trim();
}

function parseTaskTemporalLabel(rawText: string): LocalTemporalMatch | null {
  const text = normalizeVoiceText(rawText);
  if (!text) return null;

  const timeMatch =
    /\b(?:a|à|vers)\s+([01]?\d|2[0-3])h(?:([0-5]\d))?\b/i.exec(text) ??
    /\b([01]?\d|2[0-3])h(?:([0-5]\d))\b/i.exec(text);

  const parsedHour = timeMatch?.[1] != null ? Number(timeMatch[1]) : null;
  const parsedMinute = timeMatch?.[2] != null ? Number(timeMatch[2]) : 0;
  const hasTime = parsedHour != null && Number.isFinite(parsedHour) && parsedMinute != null && Number.isFinite(parsedMinute);
  const timeLabel = hasTime
    ? `${String(parsedHour).padStart(2, "0")}:${String(parsedMinute).padStart(2, "0")}`
    : null;

  if (text.includes("ce soir")) {
    return {
      label: `ce soir${timeLabel ? `, ${timeLabel}` : ", 20:00"}`,
    };
  }

  if (text.includes("aujourd'hui") || text.includes("aujourdhui")) {
    if (!timeLabel) return { label: "aujourd’hui" };
    return { label: `aujourd’hui, ${timeLabel}` };
  }

  if (text.includes("demain")) {
    if (!timeLabel) return { label: "demain" };
    return { label: `demain, ${timeLabel}` };
  }

  const weekdays: Array<{ key: string; label: string }> = [
    { key: "lundi", label: "lundi" },
    { key: "mardi", label: "mardi" },
    { key: "mercredi", label: "mercredi" },
    { key: "jeudi", label: "jeudi" },
    { key: "vendredi", label: "vendredi" },
    { key: "samedi", label: "samedi" },
    { key: "dimanche", label: "dimanche" },
  ];

  const day = weekdays.find((w) => new RegExp(`\\b${w.key}\\b`, "i").test(text));
  if (day) {
    if (!timeLabel) return { label: day.label };
    return { label: `${day.label}, ${timeLabel}` };
  }

  return null;
}

function normalizeVoiceTranscript(raw: string) {
  return raw
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanVoicePayload(raw: string | undefined) {
  if (!raw) return "";
  return raw.replace(/^[:\s-]+/, "").trim();
}

function detectLocalVoiceIntent(rawTranscript: string): {
  kind: LocalVoiceIntentKind;
  label: string;
  payload: string;
} {
  const raw = rawTranscript.trim();
  if (!raw) {
    return { kind: "unknown", label: "Commande non reconnue", payload: "" };
  }

  const normalized = normalizeVoiceTranscript(raw);

  const noteMatch =
    /^(?:cr[eé]e(?:r)?|ajoute|note(?:\s+que)?)\s+(?:une?\s+)?note\b[:\s-]*(.*)$/i.exec(raw) ??
    /^(?:cr[eé]e(?:r)?|ajoute|note(?:\s+que)?)\s+(?:une?\s+)?note\b[:\s-]*(.*)$/i.exec(normalized);
  if (noteMatch) {
    return {
      kind: "note",
      label: "Créer une note",
      payload: cleanVoicePayload(noteMatch[1]),
    };
  }

  const checklistMatch =
    /^(?:cr[eé]e(?:r)?|ajoute|fais)\s+(?:une?\s+)?checklist\b[:\s-]*(.*)$/i.exec(raw) ??
    /^(?:cr[eé]e(?:r)?|ajoute|fais)\s+(?:une?\s+)?checklist\b[:\s-]*(.*)$/i.exec(normalized);
  if (checklistMatch) {
    return {
      kind: "checklist",
      label: "Créer une checklist",
      payload: cleanVoicePayload(checklistMatch[1]),
    };
  }

  const taskMatch =
    /^(?:ajoute|cr[eé]e(?:r)?)\s+(?:une?\s+)?t[âa]che\b[:\s-]*(.*)$/i.exec(raw) ??
    /^rappelle[-\s]?moi\b[:\s-]*(.*)$/i.exec(raw) ??
    /^(?:ajoute|mets?)\s+dans\s+l['’]?agenda\b[:\s-]*(.*)$/i.exec(raw) ??
    /^(?:ajoute|cr[eé]e(?:r)?)\s+(?:une?\s+)?t[âa]che\b[:\s-]*(.*)$/i.exec(normalized) ??
    /^rappelle[-\s]?moi\b[:\s-]*(.*)$/i.exec(normalized) ??
    /^(?:ajoute|mets?)\s+dans\s+l['']?agenda\b[:\s-]*(.*)$/i.exec(normalized);
  if (taskMatch) {
    return {
      kind: "task",
      label: "Créer un élément d’agenda",
      payload: cleanVoicePayload(taskMatch[1]),
    };
  }

  const searchMatch =
    /^(?:cherche|trouve|recherche)\b[:\s-]*(.*)$/i.exec(raw) ??
    /^(?:cherche|trouve|recherche)\b[:\s-]*(.*)$/i.exec(normalized);
  if (searchMatch) {
    return {
      kind: "search",
      label: "Lancer une recherche",
      payload: cleanVoicePayload(searchMatch[1]),
    };
  }

  const navMatch =
    /^(?:ouvre|va\s+(?:dans|au|a|à|sur))\s+(?:l['’]|la\s+|le\s+)?(agenda|notes?|checklist|dashboard)\b[:\s-]*(.*)$/i.exec(raw) ??
    /^(?:ouvre|va\s+(?:dans|au|a|à|sur))\s+(?:l['']|la\s+|le\s+)?(agenda|notes?|checklist|dashboard)\b[:\s-]*(.*)$/i.exec(normalized);
  if (navMatch) {
    const targetRaw = (navMatch[1] ?? "").toLowerCase();
    const targetLabel =
      targetRaw === "agenda"
        ? "Agenda"
        : targetRaw.startsWith("note")
          ? "Notes"
          : targetRaw === "checklist"
            ? "Checklist"
            : "Dashboard";
    return {
      kind: "navigation",
      label: `Naviguer vers ${targetLabel}`,
      payload: cleanVoicePayload(navMatch[2]),
    };
  }

  return { kind: "unknown", label: "Commande non reconnue", payload: "" };
}

function buildLocalIntentPreview(intent: { kind: LocalVoiceIntentKind; label: string; payload: string }) {
  if (intent.kind === "unknown") {
    return "Commande non reconnue pour l’instant. Reformule plus simplement (ex: “crée une note …”).";
  }
  if (intent.payload) {
    return `${intent.label} — “${intent.payload}”`;
  }
  return intent.label;
}

export default function VoiceAgentButton({ mobileHidden, renderCustomTrigger }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId") || "";
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [flowStep, setFlowStep] = useState<VoiceFlowStep>("idle");
  const [busyTickMs, setBusyTickMs] = useState<number>(Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [clarificationInput, setClarificationInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExecuteIntentResponse | null>(null);
  const [localPreviewHint, setLocalPreviewHint] = useState<string | null>(null);
  const [localActionPlan, setLocalActionPlan] = useState<LocalVoiceActionPlan | null>(null);
  const [clarificationSubmitting, setClarificationSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const silenceIntervalRef = useRef<number | null>(null);
  const startedAutomaticallyRef = useRef(false);
  const lastVoiceMsRef = useRef<number>(0);
  const heardVoiceRef = useRef(false);
  const analyzedResultIdRef = useRef<string | null>(null);
  const noiseFloorRef = useRef(0.01);
  const calibrationUntilRef = useRef(0);
  const clarificationInputRef = useRef<HTMLInputElement | null>(null);

  const maxDurationMs = 60 * 1000;
  const silenceAutoStopMs = 1000;
  const noVoiceAutoStopMs = 7000;
  const maxBytes = 25 * 1024 * 1024;

  const isCallableUnauthenticated = (err: unknown) => {
    if (isAuthInvalidError(err)) return true;
    const code = typeof (err as { code?: unknown })?.code === "string" ? String((err as { code?: unknown }).code) : "";
    return code.includes("unauthenticated");
  };

  const clearTimer = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const clearSilenceWatcher = () => {
    if (silenceIntervalRef.current) window.clearInterval(silenceIntervalRef.current);
    silenceIntervalRef.current = null;
  };

  const cleanupAudioGraph = () => {
    try {
      sourceRef.current?.disconnect();
    } catch {
      // ignore
    }
    sourceRef.current = null;
    analyserRef.current = null;
    try {
      void audioContextRef.current?.close();
    } catch {
      // ignore
    }
    audioContextRef.current = null;
  };

  const cleanupStream = () => {
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {
      // ignore
    }
    streamRef.current = null;
  };

  const hardStopRecordingResources = () => {
    clearTimer();
    clearSilenceWatcher();
    cleanupAudioGraph();
    cleanupStream();
  };

  const createVoiceJob = async (mimeType: string, fileExtension: string) => {
    const fn = httpsCallable<
      { mode?: string; mimeType?: string; fileExtension?: string },
      { jobId: string; storagePath: string }
    >(fbFunctions, "assistantCreateVoiceJob");
    const res = await fn({ mode: "standalone", mimeType, fileExtension });
    return res.data;
  };

  const requestTranscription = async (id: string) => {
    const fn = httpsCallable<{ jobId: string }, { jobId: string; resultId: string }>(fbFunctions, "assistantRequestVoiceTranscription");
    const res = await fn({ jobId: id });
    return res.data;
  };

  const runIntent = async (execute: boolean, transcriptInput?: string) => {
    const effectiveTranscript = (transcriptInput ?? transcript).trim();
    if (!effectiveTranscript) return;

    setFlowStep(execute ? "executing" : "transcribing");
    setError(null);
    if (!execute) {
      const localIntent = detectLocalVoiceIntent(effectiveTranscript);
      setLocalPreviewHint(buildLocalIntentPreview(localIntent));
    }

    try {
      const fn = httpsCallable<{ transcript: string; execute: boolean }, ExecuteIntentResponse>(fbFunctions, "assistantExecuteIntent");
      const res = await fn({ transcript: effectiveTranscript, execute });
      setResult(res.data);
      setLocalPreviewHint(null);

      if (execute && res.data.executed) {
        setFlowStep("done");
        return;
      }
      if (res.data.needsClarification) {
        setFlowStep("clarify");
        return;
      }
      setFlowStep("review");
    } catch (e) {
      if (isCallableUnauthenticated(e)) {
        void invalidateAuthSession();
        return;
      }
      setError(toUserErrorMessage(e, "Impossible d’exécuter la commande vocale."));
      setFlowStep("error");
    }
  };

  const processBlob = async (blob: Blob) => {
    if (!user?.uid) {
      setError("Tu dois être connecté.");
      setFlowStep("error");
      return;
    }
    if (blob.size <= 0) {
      setError("Audio vide.");
      setFlowStep("error");
      return;
    }
    if (blob.size > maxBytes) {
      setError("Audio trop volumineux (max 25MB).");
      setFlowStep("error");
      return;
    }

    setFlowStep("uploading");

    try {
      const created = await createVoiceJob();
      setJobId(created.jobId);
      const fileRef = storageRef(storage, created.storagePath);
      await uploadBytes(fileRef, blob, { contentType: blob.type || "audio/webm" });
      setFlowStep("transcribing");
      const tr = await requestTranscription(created.jobId);
      setResultId(tr.resultId);
    } catch (e) {
      if (isCallableUnauthenticated(e)) {
        void invalidateAuthSession();
        return;
      }
      setError(toUserErrorMessage(e, "Impossible de traiter l’audio."));
      setFlowStep("error");
    }
  };

  const stopListening = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    try {
      recorder.stop();
    } catch {
      // ignore
    }
  };

  const startListening = async () => {
    if (flowStep === "listening" || flowStep === "uploading" || flowStep === "transcribing" || flowStep === "executing") return;
    if (typeof window === "undefined" || typeof window.MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Enregistrement non supporté sur cet appareil.");
      setFlowStep("error");
      return;
    }

    setError(null);
    setResult(null);
    setClarificationInput("");
    setTranscript("");
    setLocalPreviewHint(null);
    setElapsedMs(0);
    setJobId(null);
    setResultId(null);
    analyzedResultIdRef.current = null;
    noiseFloorRef.current = 0.01;
    calibrationUntilRef.current = Date.now() + 1200;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      heardVoiceRef.current = false;
      lastVoiceMsRef.current = Date.now();

      const recorder = (() => {
        try {
          return new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
        } catch {
          return new MediaRecorder(stream);
        }
      })();
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        clearTimer();
        clearSilenceWatcher();
        cleanupAudioGraph();
        cleanupStream();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        chunksRef.current = [];
        recorderRef.current = null;
        void processBlob(blob);
      };

      recorder.start(350);
      setFlowStep("listening");
      startedAtRef.current = Date.now();

      timerRef.current = window.setInterval(() => {
        const elapsed = Date.now() - startedAtRef.current;
        setElapsedMs(elapsed);
        if (elapsed >= maxDurationMs) {
          stopListening();
        }
      }, 200);

      const audioCtx = new AudioContext();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;
      sourceRef.current = source;

      silenceIntervalRef.current = window.setInterval(() => {
        const an = analyserRef.current;
        if (!an) return;
        const arr = new Uint8Array(an.fftSize);
        an.getByteTimeDomainData(arr);
        let sum = 0;
        for (let i = 0; i < arr.length; i += 1) {
          const sample = arr[i] ?? 128;
          const v = (sample - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / arr.length);
        const now = Date.now();
        if (now < calibrationUntilRef.current) {
          noiseFloorRef.current = Math.max(0.005, noiseFloorRef.current * 0.9 + rms * 0.1);
        } else {
          noiseFloorRef.current = Math.max(0.005, noiseFloorRef.current * 0.98 + rms * 0.02);
        }

        const dynamicThreshold = Math.max(0.018, noiseFloorRef.current * 2.8);
        const speaking = rms > dynamicThreshold;
        if (speaking) {
          heardVoiceRef.current = true;
          lastVoiceMsRef.current = now;
        }

        if (!heardVoiceRef.current && now - startedAtRef.current > noVoiceAutoStopMs) {
          stopListening();
          return;
        }

        if (heardVoiceRef.current && now - lastVoiceMsRef.current > silenceAutoStopMs) {
          stopListening();
        }
      }, 180);
    } catch (e) {
      setError(mapMicrophoneAccessError(e));
      setFlowStep("error");
      hardStopRecordingResources();
    }
  };

  const closeModal = () => {
    setOpen(false);
    startedAutomaticallyRef.current = false;
    hardStopRecordingResources();
    try {
      recorderRef.current?.stop();
    } catch {
      // ignore
    }
    recorderRef.current = null;
  };

  const retryVoice = () => {
    setResult(null);
    setError(null);
    setTranscript("");
    setClarificationInput("");
    setClarificationSubmitting(false);
    setFlowStep("idle");
    void startListening();
  };

  const parseClarificationTimeInput = (input: string): { normalized: string; shortLabel: string; displayLabel: string } | null => {
    const compact = input.trim().replace(/\s+/g, "");
    if (!compact) return null;

    const hourOnly = /^([01]?\d|2[0-3])$/.exec(compact);
    if (hourOnly) {
      const hour = Number(hourOnly[1]);
      return {
        normalized: `${hour}h`,
        shortLabel: `${hour}h`,
        displayLabel: `${hour.toString().padStart(2, "0")}:00`,
      };
    }

    const hourMinute = /^([01]?\d|2[0-3])(?::|h|\.)([0-5]\d)$/.exec(compact);
    if (hourMinute) {
      const hour = Number(hourMinute[1]);
      const minute = hourMinute[2];
      return {
        normalized: `${hour}h${minute}`,
        shortLabel: `${hour}h${minute}`,
        displayLabel: `${hour.toString().padStart(2, "0")}:${minute}`,
      };
    }

    return null;
  };

  const normalizeClarificationTimeInput = (input: string) => {
    const parsed = parseClarificationTimeInput(input);
    if (parsed) return parsed.normalized;

    return input.trim();
  };

  const applyClarification = async () => {
    if (clarificationSubmitting) return;
    const extra = normalizeClarificationTimeInput(clarificationInput);
    if (!extra) return;
    const merged = `${transcript.trim()} ${extra}`.trim();
    setTranscript(merged);
    setClarificationInput("");
    setError(null);
    setClarificationSubmitting(true);
    try {
      await runIntent(true, merged);
    } finally {
      setClarificationSubmitting(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    if (startedAutomaticallyRef.current) return;
    startedAutomaticallyRef.current = true;
    void startListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    stepEnteredAtRef.current = Date.now();
    setBusyTickMs(Date.now());
  }, [flowStep]);

  useEffect(() => {
    if (flowStep !== "uploading" && flowStep !== "transcribing" && flowStep !== "executing") return;
    const id = window.setInterval(() => {
      setBusyTickMs(Date.now());
    }, 300);
    return () => window.clearInterval(id);
  }, [flowStep]);

  useEffect(() => {
    if (!open) return;
    if (!(flowStep === "clarify" || result?.needsClarification === true)) return;
    const id = window.setTimeout(() => {
      clarificationInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [flowStep, open, result?.needsClarification]);

  useEffect(() => {
    if (!open) return;
    return () => {
      hardStopRecordingResources();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!user?.uid || !jobId) return;
    const jobRef = doc(db, "users", user.uid, "assistantVoiceJobs", jobId);
    const unsub = onSnapshot(jobRef, (snap) => {
      const d = snap.exists() ? (snap.data() as { status?: unknown; errorMessage?: unknown }) : null;
      if (d?.status === "error" && typeof d.errorMessage === "string") {
        setError(d.errorMessage);
        setFlowStep("error");
      }
    });
    return () => unsub();
  }, [jobId, user?.uid]);

  useEffect(() => {
    if (!user?.uid || !resultId) return;
    const resultRef = doc(db, "users", user.uid, "assistantVoiceResults", resultId);
    const unsub = onSnapshot(resultRef, (snap) => {
      if (analyzedResultIdRef.current === resultId) return;
      const d = snap.exists() ? (snap.data() as { transcript?: unknown }) : null;
      if (typeof d?.transcript !== "string" || !d.transcript.trim()) return;
      const nextTranscript = d.transcript.trim();
      analyzedResultIdRef.current = resultId;
      setTranscript(nextTranscript);
      setFlowStep("transcribing");
      void runIntent(false, nextTranscript);
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultId, user?.uid]);

  const parsedHint = useMemo(() => {
    if (!result) return null;
    const intent = result.intent;
    const conf = `${Math.round((intent.confidence ?? 0) * 100)}%`;
    if (intent.kind === "create_todo") return `Compris: créer une checklist — “${intent.title}” (${conf}).`;
    if (intent.kind === "create_task") return `Compris: créer un élément d’agenda — “${intent.title}” (${conf}).`;
    if (intent.kind === "create_reminder") {
      return `Compris: créer un rappel — “${intent.title}”${intent.remindAtIso ? ` à ${new Date(intent.remindAtIso).toLocaleString("fr-FR")}` : ""} (${conf}).`;
    }
    return `Compris: planifier une réunion — “${intent.title}” (${conf}).`;
  }, [result]);

  const displayedHint = parsedHint ?? localPreviewHint;
  const clarificationPending = flowStep === "clarify" || result?.needsClarification === true;
  const isBusyStep = flowStep === "listening" || flowStep === "uploading" || flowStep === "transcribing" || flowStep === "executing";
  const flowStateMeta = useMemo(() => {
    if (flowStep === "listening") {
      return {
        label: "En écoute",
        toneClass: "border-primary/40 bg-primary/10 text-primary",
      };
    }
    if (flowStep === "uploading" || flowStep === "transcribing" || flowStep === "executing") {
      return {
        label: "Traitement",
        toneClass: "border-amber-300 bg-amber-50 text-amber-700",
      };
    }
    if (flowStep === "review" || flowStep === "clarify") {
      return {
        label: "Commande détectée",
        toneClass: "border-emerald-300 bg-emerald-50 text-emerald-700",
      };
    }
    if (flowStep === "done") {
      return {
        label: "Terminé",
        toneClass: "border-emerald-300 bg-emerald-50 text-emerald-700",
      };
    }
    if (flowStep === "error") {
      return {
        label: "Erreur",
        toneClass: "border-destructive/40 bg-destructive/10 text-destructive",
      };
    }
    return {
      label: "Prêt",
      toneClass: "border-border bg-muted/30 text-muted-foreground",
    };
  }, [flowStep]);
  const flowStateMeta = useMemo(() => {
    if (flowStep === "listening") {
      return {
        label: "En écoute",
        toneClass: "border-primary/40 bg-primary/10 text-primary",
      };
    }
    if (flowStep === "uploading" || flowStep === "transcribing" || flowStep === "executing") {
      return {
        label: "Traitement",
        toneClass: "border-amber-300 bg-amber-50 text-amber-700",
      };
    }
    if (flowStep === "review" || flowStep === "clarify") {
      return {
        label: "Commande détectée",
        toneClass: "border-emerald-300 bg-emerald-50 text-emerald-700",
      };
    }
    if (flowStep === "done") {
      return {
        label: "Terminé",
        toneClass: "border-emerald-300 bg-emerald-50 text-emerald-700",
      };
    }
    if (flowStep === "error") {
      return {
        label: "Erreur",
        toneClass: "border-destructive/40 bg-destructive/10 text-destructive",
      };
    }
    return {
      label: "Prêt",
      toneClass: "border-border bg-muted/30 text-muted-foreground",
    };
  }, [flowStep]);
  const flowStateMeta = useMemo(() => {
    if (flowStep === "listening") {
      return {
        label: "En écoute",
        toneClass: "border-primary/40 bg-primary/10 text-primary",
      };
    }
    if (flowStep === "uploading" || flowStep === "transcribing" || flowStep === "executing") {
      return {
        label: "Traitement",
        toneClass: "border-amber-300 bg-amber-50 text-amber-700",
      };
    }
    if (flowStep === "review" || flowStep === "clarify") {
      return {
        label: "Commande détectée",
        toneClass: "border-emerald-300 bg-emerald-50 text-emerald-700",
      };
    }
    if (flowStep === "done") {
      return {
        label: "Terminé",
        toneClass: "border-emerald-300 bg-emerald-50 text-emerald-700",
      };
    }
    if (flowStep === "error") {
      return {
        label: "Erreur",
        toneClass: "border-destructive/40 bg-destructive/10 text-destructive",
      };
    }
    return {
      label: "Prêt",
      toneClass: "border-border bg-muted/30 text-muted-foreground",
    };
  }, [flowStep]);
  const stepProgress = useMemo(
    () => [
      { key: "listening", label: "Captation" },
      { key: "uploading", label: "Upload" },
      { key: "transcribing", label: "Transcription" },
      { key: "review", label: "Compréhension" },
      { key: "executing", label: "Exécution" },
    ],
    [],
  );
  const activeProgressIndex = useMemo(() => {
    if (flowStep === "done") return stepProgress.length - 1;
    if (flowStep === "clarify") return 3;
    if (flowStep === "error") return -1;
    const index = stepProgress.findIndex((step) => step.key === flowStep);
    return index;
  }, [flowStep, stepProgress]);
  const slowStepHint = useMemo(() => {
    const elapsed = Math.max(0, busyTickMs - stepEnteredAtRef.current);
    if (flowStep === "transcribing" && elapsed > 3000) {
      return "Transcription plus longue que prévu… je continue.";
    }
    if (flowStep === "executing" && elapsed > 2000) {
      return "Compréhension en cours… encore un instant.";
    }
    if (flowStep === "uploading" && elapsed > 2000) {
      return "Upload en cours… connexion possiblement lente.";
    }
    return null;
  }, [busyTickMs, flowStep]);
  const clarificationButtonDisabled = !clarificationInput.trim() || clarificationSubmitting;
  const parsedClarificationTime = useMemo(() => parseClarificationTimeInput(clarificationInput), [clarificationInput]);
  const clarificationActionLabel = useMemo(() => {
    if (clarificationSubmitting) return "Traitement...";
    if (!parsedClarificationTime) return "OK";
    const at = parsedClarificationTime.shortLabel;
    if (result?.intent.kind === "schedule_meeting") return `Créer la réunion à ${at}`;
    if (result?.intent.kind === "create_task") return `Créer l’élément d’agenda à ${at}`;
    return `Créer le rappel à ${at}`;
  }, [clarificationSubmitting, parsedClarificationTime, result?.intent.kind]);
  const confirmationHint =
    flowStep === "review" && result?.intent?.requiresConfirmation
      ? "Dernière étape: appuie sur Valider pour confirmer la création."
      : null;

  const stepHint = useMemo(() => {
    if (flowStep === "listening") return "Je t’écoute… parle naturellement.";
    if (flowStep === "uploading") return "Envoi de l’audio…";
    if (flowStep === "transcribing") return "Transcription et analyse en cours…";
    if (flowStep === "executing") return "Exécution de l’action…";
    if (flowStep === "done") return "Action terminée ✅";
    if (flowStep === "clarify") return result?.clarificationQuestion ?? "Ajoute l'heure puis appuie sur OK pour créer.";
    if (flowStep === "review") return "Voici mon interprétation. Je lance l’action ?";
    return "Appuie sur le micro pour commencer.";
  }, [flowStep, result?.clarificationQuestion]);
  const helpfulErrorHint = useMemo(() => {
    if (!error) return null;
    const raw = error.toLowerCase();
    if (raw.includes("micro") || raw.includes("permission")) {
      return "Vérifie l’accès micro dans le navigateur, puis réessaie.";
    }
    if (raw.includes("audio")) {
      return "Réessaie avec une commande plus courte et parle clairement.";
    }
    return "Tu peux réessayer ou reformuler la commande plus simplement.";
  }, [error]);
  const helpfulErrorHint = useMemo(() => {
    if (!error) return null;
    const raw = error.toLowerCase();
    if (raw.includes("micro") || raw.includes("permission")) {
      return "Vérifie l’accès micro dans le navigateur, puis réessaie.";
    }
    if (raw.includes("audio")) {
      return "Réessaie avec une commande plus courte et parle clairement.";
    }
    return "Tu peux réessayer ou reformuler la commande plus simplement.";
  }, [error]);
  const helpfulErrorHint = useMemo(() => {
    if (!error) return null;
    const raw = error.toLowerCase();
    if (raw.includes("micro") || raw.includes("permission")) {
      return "Vérifie l’accès micro dans le navigateur, puis réessaie.";
    }
    if (raw.includes("audio")) {
      return "Réessaie avec une commande plus courte et parle clairement.";
    }
    return "Tu peux réessayer ou reformuler la commande plus simplement.";
  }, [error]);

  const customTrigger = renderCustomTrigger
    ? renderCustomTrigger({
        onClick: () => setOpen(true),
        ariaLabel: "Assistant vocal",
        title: "Assistant vocal",
      })
    : null;

  const voiceModal = open ? (
    <div
      className="fixed inset-0 z-[70] bg-background/75 backdrop-blur-[2px] p-0 md:p-4 flex items-end md:items-center md:justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Assistant vocal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <div
        className="w-full md:max-w-[440px] rounded-t-2xl md:rounded-xl border border-border bg-card p-3 md:p-4 space-y-2 md:space-y-3 shadow-2xl max-h-[82vh] overflow-y-auto"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="text-sm font-semibold">Assistant vocal</div>
            <div
              className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                flowStep === "listening"
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : flowStep === "uploading" || flowStep === "transcribing" || flowStep === "executing"
                    ? "border-amber-300 bg-amber-50 text-amber-700"
                    : flowStep === "review" || flowStep === "clarify" || flowStep === "done"
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                      : flowStep === "error"
                        ? "border-destructive/40 bg-destructive/10 text-destructive"
                        : "border-border bg-muted/30 text-muted-foreground"
              }`}
            >
              {flowStep === "listening"
                ? "En écoute"
                : flowStep === "uploading" || flowStep === "transcribing" || flowStep === "executing"
                  ? "Traitement"
                  : flowStep === "review" || flowStep === "clarify"
                    ? "Commande détectée"
                    : flowStep === "done"
                      ? "Terminé"
                      : flowStep === "error"
                        ? "Erreur"
                        : "Prêt"}
            </div>
          </div>
          <button type="button" className="text-sm text-muted-foreground" onClick={closeModal}>
            Fermer
          </button>
        </div>

        <div className="rounded-lg border border-border bg-background/60 p-2 md:p-3">
          <div className="flex flex-col items-center justify-center gap-2 py-1">
          <button
            type="button"
            onClick={() => {
              if (flowStep === "listening") {
                stopListening();
              } else {
                void startListening();
              }
            }}
            className={
              "relative h-20 w-20 md:h-24 md:w-24 rounded-full border border-primary/40 text-2xl md:text-3xl flex items-center justify-center transition-all " +
              (flowStep === "listening" ? "bg-primary/20 animate-pulse" : "bg-primary/10")
            }
            aria-label={flowStep === "listening" ? "Stopper l’écoute" : "Démarrer l’écoute"}
            title={flowStep === "listening" ? "Stop" : "Parler"}
          >
            🎤
          </button>
          {flowStep === "listening" ? <div className="text-xs text-muted-foreground">{Math.max(0, Math.floor(elapsedMs / 1000))}s</div> : null}
          <div className="text-xs text-muted-foreground text-center">{stepHint}</div>
          {slowStepHint ? <div className="text-xs text-amber-600 text-center">{slowStepHint}</div> : null}
          <div className="flex flex-wrap items-center justify-center gap-1 pt-1">
            {stepProgress.map((step, index) => {
              const isDone = activeProgressIndex >= 0 && index < activeProgressIndex;
              const isActive = index === activeProgressIndex;
              return (
                <span
                  key={step.key}
                  className={`rounded-full border px-2 py-0.5 text-[10px] ${
                    isActive
                      ? "border-primary bg-primary/10 text-primary"
                      : isDone
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : "border-border bg-muted/30 text-muted-foreground"
                  }`}
                >
                  {step.label}
                </span>
              );
            })}
          </div>
        </div>

        {transcript ? (
          <div className="rounded-md border border-border bg-background p-2.5 md:p-3 text-sm whitespace-pre-wrap max-h-24 overflow-y-auto">{transcript}</div>
        ) : null}

        {clarificationPending ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void applyClarification();
            }}
          >
            <input
              ref={clarificationInputRef}
              type="text"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              autoFocus
              placeholder="Ex: 9, 9h, 9h30"
              value={clarificationInput}
              onChange={(e) => setClarificationInput(e.target.value)}
            />
            {parsedClarificationTime ? <div className="text-xs text-muted-foreground">Heure détectée : {parsedClarificationTime.displayLabel}</div> : null}
          </form>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {flowStep === "listening" ? (
            <button
              type="button"
              className="px-3 py-2 rounded-md border border-input text-sm"
              onClick={stopListening}
            >
              STOP
            </button>
          ) : null}

          {flowStep === "review" && !clarificationPending ? (
            <>
              <button
                type="button"
                className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm"
                onClick={() => void runIntent(true)}
              >
                Oui
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-md border border-input text-sm"
                onClick={retryVoice}
              >
                Non
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-md border border-input text-sm"
                onClick={closeModal}
              >
                Annuler
              </button>
            </>
          ) : null}

          {clarificationPending ? (
            <>
              <button
                type="button"
                className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
                disabled={clarificationButtonDisabled}
                onClick={() => void applyClarification()}
              >
                {clarificationActionLabel}
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-md border border-border bg-muted/40 text-muted-foreground text-sm"
                onClick={closeModal}
              >
                Annuler
              </button>
            </>
          ) : null}

          {flowStep === "done" ? (
            <button
              type="button"
              className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm"
              onClick={closeModal}
            >
              OK
            </button>
          ) : null}

          {flowStep === "error" ? (
            <>
              <button
                type="button"
                className="px-3 py-2 rounded-md border border-input text-sm"
                onClick={retryVoice}
              >
                Réessayer
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-md border border-input text-sm"
                onClick={closeModal}
              >
                Annuler
              </button>
            </>
          ) : null}

          {flowStep === "idle" ? (
            <button
              type="button"
              className="px-3 py-2 rounded-md border border-input text-sm"
              onClick={() => void startListening()}
            >
              Parler
            </button>
          ) : null}

          <button
            type="button"
            className="px-3 py-2 rounded-md border border-border bg-muted/40 text-muted-foreground text-sm disabled:opacity-50"
            disabled={isBusyStep}
            onClick={retryVoice}
          >
            Nouvelle commande
          </button>
        </div>

        {displayedHint ? <div className="text-sm">{displayedHint}</div> : null}
        {result?.message ? <div className="text-xs text-muted-foreground">{result.message}</div> : null}
        {confirmationHint ? <div className="text-xs text-amber-600">{confirmationHint}</div> : null}
        {error ? <div className="text-xs text-destructive">{error}</div> : null}
      </div>
    </div>
  ) : null;

  return (
    <>
      {renderCustomTrigger ? (
        customTrigger
      ) : (
        <>
          <button
            type="button"
            className="hidden md:inline-flex fixed right-8 bottom-8 z-50 h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
            onClick={() => setOpen(true)}
            aria-label="Assistant vocal"
            title="Assistant vocal"
          >
            🎤
          </button>

          {!mobileHidden ? (
            <button
              type="button"
              className="md:hidden fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
              onClick={() => setOpen(true)}
              aria-label="Assistant vocal"
              title="Assistant vocal"
            >
              🎤
            </button>
          ) : null}
        </>
      )}

*/
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { httpsCallable } from "firebase/functions";
import { doc, onSnapshot } from "firebase/firestore";
import { ref as storageRef, uploadBytes } from "firebase/storage";
import { db, functions as fbFunctions, storage } from "@/lib/firebase";
import { trackEvent } from "@/lib/analytics";
import { invalidateAuthSession, isAuthInvalidError } from "@/lib/authInvalidation";
import { useAuth } from "@/hooks/useAuth";
import { toUserErrorMessage } from "@/lib/userError";

type Props = {
  mobileHidden?: boolean;
  renderCustomTrigger?: (args: {
    onClick: () => void;
    ariaLabel: string;
    title: string;
  }) => ReactNode;
};

type ExecuteIntentResponse = {
  intent: {
    kind: "create_todo" | "create_task" | "create_reminder" | "schedule_meeting";
    title: string;
    confidence: number;
    requiresConfirmation: boolean;
    requiresConfirmationReason?: string | null;
    remindAtIso?: string | null;
  };
  executed: boolean;
  needsClarification?: boolean;
  missingFields?: string[];
  clarificationQuestion?: string | null;
  createdCoreObjects: Array<{ type: "task" | "taskReminder" | "calendarEvent" | "todo"; id: string }>;
  message: string;
};

type VoiceFlowStep = "idle" | "listening" | "uploading" | "transcribing" | "review" | "clarify" | "executing" | "done" | "error";

type LocalVoiceActionPlan = {
  kind: "note" | "task" | "checklist" | "search" | "navigation" | "unknown";
  payload: string;
  typeLabel: string;
  proposedAction: string;
  detectedDateLabel: string | null;
  startDate: string | null;
  executable: boolean;
};

type VoiceTimelineState = {
  recordStartMs: number | null;
  recordStopMs: number | null;
  uploadDoneMs: number | null;
  transcriptReadyMs: number | null;
  intentReadyMs: number | null;
  actionDoneMs: number | null;
  jobId: string | null;
  resultId: string | null;
};

function createVoiceTimelineState(): VoiceTimelineState {
  return {
    recordStartMs: null,
    recordStopMs: null,
    uploadDoneMs: null,
    transcriptReadyMs: null,
    intentReadyMs: null,
    actionDoneMs: null,
    jobId: null,
    resultId: null,
  };
}

function mapMicrophoneAccessError(err: unknown): string {
  if (err instanceof DOMException) {
    const name = String(err.name || "").toLowerCase();
    const message = String(err.message || "").toLowerCase();
    if (name.includes("notfound") || message.includes("requested device not found") || message.includes("device not found")) {
      return "Aucun micro disponible. Vérifie ton appareil audio puis réessaie.";
    }
    if (name.includes("notallowed") || name.includes("security") || message.includes("permission") || message.includes("denied")) {
      return "Permission micro refusée. Autorise le micro dans ton navigateur puis recharge la page.";
    }
    if (name.includes("notreadable") || message.includes("could not start audio source")) {
      return "Le micro est indisponible (utilisé par une autre application ou bloqué par le système).";
    }
    return err.message || "Impossible d’accéder au micro.";
  }

  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("requested device not found") || msg.includes("device not found")) {
      return "Aucun micro disponible. Vérifie ton appareil audio puis réessaie.";
    }
    if (msg.includes("permission") || msg.includes("notallowed") || msg.includes("denied")) {
      return "Permission micro refusée. Autorise le micro dans ton navigateur puis recharge la page.";
    }
    if (msg.includes("not supported") || msg.includes("unsupported")) {
      return "Enregistrement micro non supporté sur cet appareil.";
    }
    return err.message;
  }

  if (typeof err === "string") {
    const msg = err.toLowerCase();
    if (msg.includes("requested device not found") || msg.includes("device not found")) {
      return "Aucun micro disponible. Vérifie ton appareil audio puis réessaie.";
    }
    if (msg.includes("permission") || msg.includes("notallowed") || msg.includes("denied")) {
      return "Permission micro refusée. Autorise le micro dans ton navigateur puis recharge la page.";
    }
    return `Impossible d’accéder au micro: ${err}`;
  }

  return "Impossible d’accéder au micro.";
}

function extractVoiceErrorCode(err: unknown): string {
  const code = typeof (err as { code?: unknown })?.code === "string" ? String((err as { code?: unknown }).code) : "";
  return code.toLowerCase();
}

function inferVoiceFileExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("ogg") || normalized.includes("opus")) return "ogg";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("x-m4a") || normalized.includes("m4a")) return "m4a";
  if (normalized.includes("mp4") || normalized.includes("aac")) return "mp4";
  return "webm";
}

function mapVoiceFlowError(stage: "create_job" | "upload" | "transcription_request" | "backend_invalid", err: unknown): string {
  const code = extractVoiceErrorCode(err);
  const asMessage = toUserErrorMessage(err, "");
  const message = asMessage.trim().toLowerCase();

  if (code.includes("permission-denied") || message.includes("permission")) {
    return "Permission refusée pour traiter l’audio côté serveur.";
  }
  if (code.includes("resource-exhausted") || message.includes("daily transcription limit")) {
    return "Limite de transcription atteinte pour aujourd’hui.";
  }
  if (code.includes("invalid-argument")) {
    return "Audio invalide pour la transcription.";
  }
  if (code.includes("failed-precondition")) {
    if (message.includes("audio file missing")) return "Fichier audio introuvable après capture.";
    if (message.includes("audio file invalid")) return "Capture audio vide ou invalide.";
    if (message.includes("already in progress")) return "Une transcription est déjà en cours. Réessaie dans quelques secondes.";
  }

  if (stage === "create_job") return "Impossible de préparer l’enregistrement audio.";
  if (stage === "upload") return "Échec d’envoi du fichier audio.";
  if (stage === "transcription_request") return "Échec de la demande de transcription.";
  return "Réponse backend invalide pendant la transcription.";
}

function pickSupportedRecordingMimeType(): string {
  if (typeof window === "undefined") return "";
  const mediaRecorder = window.MediaRecorder as unknown as { isTypeSupported?: (t: string) => boolean } | undefined;
  const can = (value: string) => Boolean(mediaRecorder?.isTypeSupported?.(value));
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  return candidates.find(can) ?? "";
}

export default function VoiceAgentButton({ mobileHidden, renderCustomTrigger }: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [flowStep, setFlowStep] = useState<VoiceFlowStep>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [clarificationInput, setClarificationInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExecuteIntentResponse | null>(null);
  const [localPreviewHint, setLocalPreviewHint] = useState<string | null>(null);
  const [localActionPlan, setLocalActionPlan] = useState<LocalVoiceActionPlan | null>(null);
  const [clarificationSubmitting, setClarificationSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const silenceIntervalRef = useRef<number | null>(null);
  const startedAutomaticallyRef = useRef(false);
  const lastVoiceMsRef = useRef<number>(0);
  const heardVoiceRef = useRef(false);
  const analyzedResultIdRef = useRef<string | null>(null);
  const noiseFloorRef = useRef(0.01);
  const calibrationUntilRef = useRef(0);
  const stepEnteredAtRef = useRef<number>(Date.now());
  const clarificationInputRef = useRef<HTMLInputElement | null>(null);
  const voiceTimelineRef = useRef<VoiceTimelineState>(createVoiceTimelineState());

  const maxDurationMs = 60 * 1000;
  const silenceAutoStopMs = 1000;
  const noVoiceAutoStopMs = 7000;
  const maxBytes = 25 * 1024 * 1024;

  const safeDeltaMs = (from: number | null, to: number) => {
    if (from == null) return null;
    return Math.max(0, to - from);
  };

  const trackVoiceFlowEvent = (eventName: string, params?: Record<string, string | number | boolean | null>) => {
    const timeline = voiceTimelineRef.current;
    void trackEvent(eventName, {
      ...params,
      has_job_id: timeline.jobId !== null,
      has_result_id: timeline.resultId !== null,
    });
  };

  const buildLocalIntentPreview = (text: string): string | null => {
    const raw = text.trim();
    if (!raw) return null;
    const normalized = raw
      .toLowerCase()
      .replace(/[’]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    const cleanPayload = (value: string | undefined) => (value ? value.replace(/^[:\s-]+/, "").trim() : "");
    const parseTaskTemporal = (input: string) => {
      const lower = input
        .toLowerCase()
        .replace(/[’]/g, "'")
        .replace(/\s+/g, " ")
        .trim();
      const timeMatch =
        /\b(?:a|à|vers)\s+([01]?\d|2[0-3])h(?:([0-5]\d))?\b/i.exec(lower) ??
        /\b([01]?\d|2[0-3])h(?:([0-5]\d))\b/i.exec(lower);
      const hour = timeMatch?.[1] != null ? Number(timeMatch[1]) : null;
      const minute = timeMatch?.[2] != null ? Number(timeMatch[2]) : 0;
      const hasTime = hour != null && Number.isFinite(hour) && minute != null && Number.isFinite(minute);
      const timeLabel = hasTime ? `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` : null;

      if (lower.includes("ce soir")) return `ce soir${timeLabel ? `, ${timeLabel}` : ", 20:00"}`;
      if (lower.includes("aujourd'hui") || lower.includes("aujourdhui")) return timeLabel ? `aujourd’hui, ${timeLabel}` : "aujourd’hui";
      if (lower.includes("demain")) return timeLabel ? `demain, ${timeLabel}` : "demain";

      const weekdays = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
      const weekday = weekdays.find((d) => new RegExp(`\\b${d}\\b`, "i").test(lower));
      if (!weekday) return null;
      return timeLabel ? `${weekday}, ${timeLabel}` : weekday;
    };

    const noteMatch =
      /^(?:cr[eé]e(?:r)?|ajoute|note(?:\s+que)?)\s+(?:une?\s+)?note\b[:\s-]*(.*)$/i.exec(raw) ??
      /^(?:cr[eé]e(?:r)?|ajoute|note(?:\s+que)?)\s+(?:une?\s+)?note\b[:\s-]*(.*)$/i.exec(normalized);
    const checklistMatch =
      /^(?:cr[eé]e(?:r)?|ajoute|fais)\s+(?:une?\s+)?checklist\b[:\s-]*(.*)$/i.exec(raw) ??
      /^(?:cr[eé]e(?:r)?|ajoute|fais)\s+(?:une?\s+)?checklist\b[:\s-]*(.*)$/i.exec(normalized);
    const taskMatch =
      /^(?:ajoute|cr[eé]e(?:r)?)\s+(?:une?\s+)?t[âa]che\b[:\s-]*(.*)$/i.exec(raw) ??
      /^rappelle[-\s]?moi\b[:\s-]*(.*)$/i.exec(raw) ??
      /^(?:ajoute|mets?)\s+dans\s+l['’]?agenda\b[:\s-]*(.*)$/i.exec(raw) ??
      /^(?:ajoute|cr[eé]e(?:r)?)\s+(?:une?\s+)?t[âa]che\b[:\s-]*(.*)$/i.exec(normalized) ??
      /^rappelle[-\s]?moi\b[:\s-]*(.*)$/i.exec(normalized) ??
      /^(?:ajoute|mets?)\s+dans\s+l['']?agenda\b[:\s-]*(.*)$/i.exec(normalized);
    const searchMatch =
      /^(?:cherche|trouve|recherche)\b[:\s-]*(.*)$/i.exec(raw) ??
      /^(?:cherche|trouve|recherche)\b[:\s-]*(.*)$/i.exec(normalized);
    const navMatch =
      /^(?:ouvre|va\s+(?:dans|au|a|à|sur))\s+(?:l['’]|la\s+|le\s+)?(agenda|notes?|checklist|dashboard)\b[:\s-]*(.*)$/i.exec(raw) ??
      /^(?:ouvre|va\s+(?:dans|au|a|à|sur))\s+(?:l['']|la\s+|le\s+)?(agenda|notes?|checklist|dashboard)\b[:\s-]*(.*)$/i.exec(normalized);

    let detectedKind: "note" | "task" | "checklist" | "search" | "navigation" | "unknown" = "unknown";
    let label = "Commande non reconnue";
    let payload = "";

    if (noteMatch) {
      detectedKind = "note";
      label = "Créer une note";
      payload = cleanPayload(noteMatch[1]);
    } else if (checklistMatch) {
      detectedKind = "checklist";
      label = "Créer une checklist";
      payload = cleanPayload(checklistMatch[1]);
    } else if (taskMatch) {
      detectedKind = "task";
      label = "Créer un élément d’agenda";
      payload = cleanPayload(taskMatch[1]);
    } else if (searchMatch) {
      detectedKind = "search";
      label = "Lancer une recherche";
      payload = cleanPayload(searchMatch[1]);
    } else if (navMatch) {
      detectedKind = "navigation";
      const target = String(navMatch[1] ?? "").toLowerCase();
      const targetLabel =
        target === "agenda"
          ? "Agenda"
          : target.startsWith("note")
            ? "Notes"
            : target === "checklist"
              ? "Checklist"
              : "Dashboard";
      label = `Naviguer vers ${targetLabel}`;
      payload = cleanPayload(navMatch[2]);
    }

    if (detectedKind === "unknown") {
      return "Commande non reconnue pour l’instant. Reformule plus simplement (ex: “rappelle-moi demain à 14h ...”).";
    }

    if (detectedKind !== "task") {
      return payload ? `${label} — “${payload}”` : label;
    }

    const temporal = parseTaskTemporal(raw);
    if (!temporal) {
      return payload ? `${label} — “${payload}”` : label;
    }

    return `${payload ? `${label} — “${payload}”` : label} · Date détectée: ${temporal}`;
  };

  const detectLocalActionPlan = (text: string): LocalVoiceActionPlan => {
    const raw = text.trim();
    if (!raw) {
      return {
        kind: "unknown",
        payload: "",
        typeLabel: "Inconnu",
        proposedAction: "Aucune exécution",
        detectedDateLabel: null,
        startDate: null,
        executable: false,
      };
    }

    const normalized = raw
      .toLowerCase()
      .replace(/[’]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    const cleanPayload = (value: string | undefined) => (value ? value.replace(/^[:\s-]+/, "").trim() : "");
    const toDateInputValue = (date: Date) => {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    };
    const parseTemporal = (input: string): { label: string; startDate: string } | null => {
      const lower = input
        .toLowerCase()
        .replace(/[’]/g, "'")
        .replace(/\s+/g, " ")
        .trim();

      const timeMatch =
        /\b(?:a|à|vers)\s+([01]?\d|2[0-3])h(?:([0-5]\d))?\b/i.exec(lower) ??
        /\b([01]?\d|2[0-3])h(?:([0-5]\d))\b/i.exec(lower);
      const hh = timeMatch?.[1] != null ? Number(timeMatch[1]) : null;
      const mm = timeMatch?.[2] != null ? Number(timeMatch[2]) : 0;
      const hasTime = hh != null && Number.isFinite(hh) && Number.isFinite(mm);
      const timeLabel = hasTime ? `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}` : null;

      const now = new Date();
      const build = (label: string, date: Date) => ({
        label: timeLabel ? `${label}, ${timeLabel}` : label,
        startDate: toDateInputValue(date),
      });

      if (lower.includes("ce soir")) {
        return {
          label: `ce soir, ${timeLabel ?? "20:00"}`,
          startDate: toDateInputValue(now),
        };
      }
      if (lower.includes("aujourd'hui") || lower.includes("aujourdhui")) return build("aujourd’hui", now);
      if (lower.includes("demain")) {
        const d = new Date(now);
        d.setDate(d.getDate() + 1);
        return build("demain", d);
      }

      const weekdays: Array<{ name: string; day: number }> = [
        { name: "lundi", day: 1 },
        { name: "mardi", day: 2 },
        { name: "mercredi", day: 3 },
        { name: "jeudi", day: 4 },
        { name: "vendredi", day: 5 },
        { name: "samedi", day: 6 },
        { name: "dimanche", day: 0 },
      ];
      const weekday = weekdays.find((w) => new RegExp(`\\b${w.name}\\b`, "i").test(lower));
      if (!weekday) return null;
      const d = new Date(now);
      const delta = (weekday.day - now.getDay() + 7) % 7;
      d.setDate(d.getDate() + delta);
      return build(weekday.name, d);
    };

    const noteMatch =
      /^(?:cr[eé]e(?:r)?|ajoute|note(?:\s+que)?)\s+(?:une?\s+)?note\b[:\s-]*(.*)$/i.exec(raw) ??
      /^(?:cr[eé]e(?:r)?|ajoute|note(?:\s+que)?)\s+(?:une?\s+)?note\b[:\s-]*(.*)$/i.exec(normalized);
    if (noteMatch) {
      const payload = cleanPayload(noteMatch[1]);
      return {
        kind: "note",
        payload,
        typeLabel: "Note",
        proposedAction: "Créer une note",
        detectedDateLabel: null,
        startDate: null,
        executable: payload.length > 0,
      };
    }

    const checklistMatch =
      /^(?:cr[eé]e(?:r)?|ajoute|fais)\s+(?:une?\s+)?checklist\b[:\s-]*(.*)$/i.exec(raw) ??
      /^(?:cr[eé]e(?:r)?|ajoute|fais)\s+(?:une?\s+)?checklist\b[:\s-]*(.*)$/i.exec(normalized);
    if (checklistMatch) {
      const payload = cleanPayload(checklistMatch[1]);
      return {
        kind: "checklist",
        payload,
        typeLabel: "Checklist",
        proposedAction: "Créer une checklist",
        detectedDateLabel: null,
        startDate: null,
        executable: payload.length > 0,
      };
    }

    const taskMatch =
      /^(?:ajoute|cr[eé]e(?:r)?)\s+(?:une?\s+)?t[âa]che\b[:\s-]*(.*)$/i.exec(raw) ??
      /^rappelle[-\s]?moi\b[:\s-]*(.*)$/i.exec(raw) ??
      /^(?:ajoute|mets?)\s+dans\s+l['’]?agenda\b[:\s-]*(.*)$/i.exec(raw) ??
      /^(?:ajoute|cr[eé]e(?:r)?)\s+(?:une?\s+)?t[âa]che\b[:\s-]*(.*)$/i.exec(normalized) ??
      /^rappelle[-\s]?moi\b[:\s-]*(.*)$/i.exec(normalized) ??
      /^(?:ajoute|mets?)\s+dans\s+l['']?agenda\b[:\s-]*(.*)$/i.exec(normalized);
    if (taskMatch) {
      const payload = cleanPayload(taskMatch[1]);
      const temporal = parseTemporal(raw);
      return {
        kind: "task",
        payload,
        typeLabel: "Tâche",
        proposedAction: "Créer un élément d’agenda",
        detectedDateLabel: temporal?.label ?? null,
        startDate: temporal?.startDate ?? null,
        executable: payload.length > 0,
      };
    }

    const searchMatch =
      /^(?:cherche|trouve|recherche)\b[:\s-]*(.*)$/i.exec(raw) ??
      /^(?:cherche|trouve|recherche)\b[:\s-]*(.*)$/i.exec(normalized);
    if (searchMatch) {
      return {
        kind: "search",
        payload: cleanPayload(searchMatch[1]),
        typeLabel: "Recherche",
        proposedAction: "Recherche non exécutable dans cette version",
        detectedDateLabel: null,
        startDate: null,
        executable: false,
      };
    }

    const navMatch =
      /^(?:ouvre|va\s+(?:dans|au|a|à|sur))\s+(?:l['’]|la\s+|le\s+)?(agenda|notes?|checklist|dashboard)\b[:\s-]*(.*)$/i.exec(raw) ??
      /^(?:ouvre|va\s+(?:dans|au|a|à|sur))\s+(?:l['']|la\s+|le\s+)?(agenda|notes?|checklist|dashboard)\b[:\s-]*(.*)$/i.exec(normalized);
    if (navMatch) {
      return {
        kind: "navigation",
        payload: cleanPayload(navMatch[2]),
        typeLabel: "Navigation",
        proposedAction: "Navigation non exécutable dans cette version",
        detectedDateLabel: null,
        startDate: null,
        executable: false,
      };
    }

    return {
      kind: "unknown",
      payload: "",
      typeLabel: "Inconnu",
      proposedAction: "Aucune exécution",
      detectedDateLabel: null,
      startDate: null,
      executable: false,
    };
  };

  const isCallableUnauthenticated = (err: unknown) => {
    if (isAuthInvalidError(err)) return true;
    const code = typeof (err as { code?: unknown })?.code === "string" ? String((err as { code?: unknown }).code) : "";
    return code.includes("unauthenticated");
  };

  const clearTimer = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const clearSilenceWatcher = () => {
    if (silenceIntervalRef.current) window.clearInterval(silenceIntervalRef.current);
    silenceIntervalRef.current = null;
  };

  const cleanupAudioGraph = () => {
    try {
      sourceRef.current?.disconnect();
    } catch {
      // ignore
    }
    sourceRef.current = null;
    analyserRef.current = null;
    try {
      void audioContextRef.current?.close();
    } catch {
      // ignore
    }
    audioContextRef.current = null;
  };

  const cleanupStream = () => {
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {
      // ignore
    }
    streamRef.current = null;
  };

  const hardStopRecordingResources = () => {
    clearTimer();
    clearSilenceWatcher();
    cleanupAudioGraph();
    cleanupStream();
  };

  const createVoiceJob = async (mimeType: string, fileExtension: string) => {
    const fn = httpsCallable<
      { mode?: string; mimeType?: string; fileExtension?: string },
      { jobId: string; storagePath: string }
    >(fbFunctions, "assistantCreateVoiceJob");
    const res = await fn({ mode: "standalone", mimeType, fileExtension });
    return res.data;
  };

  const requestTranscription = async (id: string) => {
    const fn = httpsCallable<{ jobId: string }, { jobId: string; resultId: string }>(fbFunctions, "assistantRequestVoiceTranscription");
    const res = await fn({ jobId: id });
    return res.data;
  };

  const runIntent = async (execute: boolean, transcriptInput?: string) => {
    const effectiveTranscript = (transcriptInput ?? transcript).trim();
    if (!effectiveTranscript) return;
    const intentCallStartedMs = Date.now();

    setFlowStep(execute ? "executing" : "transcribing");
    setError(null);
    if (!execute) {
      setLocalActionPlan(detectLocalActionPlan(effectiveTranscript));
      setLocalPreviewHint(buildLocalIntentPreview(effectiveTranscript));
    }

    try {
      const fn = httpsCallable<{ transcript: string; execute: boolean }, ExecuteIntentResponse>(fbFunctions, "assistantExecuteIntent");
      const res = await fn({ transcript: effectiveTranscript, execute });
      setResult(res.data);
      if (execute) {
        setLocalPreviewHint(null);
      }

      if (!execute) {
        const intentReadyMs = Date.now();
        voiceTimelineRef.current.intentReadyMs = intentReadyMs;
        trackVoiceFlowEvent("voice_intent_ready", {
          phase: "voice_intent",
          intent_kind: res.data.intent.kind,
          needs_clarification: res.data.needsClarification === true,
          intent_call_ms: Math.max(0, intentReadyMs - intentCallStartedMs),
          transcript_to_intent_ms: safeDeltaMs(voiceTimelineRef.current.transcriptReadyMs, intentReadyMs),
        });
      }

      if (execute && res.data.executed) {
        const actionDoneMs = Date.now();
        voiceTimelineRef.current.actionDoneMs = actionDoneMs;
        trackVoiceFlowEvent("voice_action_done", {
          phase: "voice_action",
          intent_kind: res.data.intent.kind,
          created_objects_count: res.data.createdCoreObjects.length,
          execute_call_ms: Math.max(0, actionDoneMs - intentCallStartedMs),
          intent_to_action_ms: safeDeltaMs(voiceTimelineRef.current.intentReadyMs, actionDoneMs),
          stop_to_action_ms: safeDeltaMs(voiceTimelineRef.current.recordStopMs, actionDoneMs),
        });
        setFlowStep("done");
        return;
      }
      if (res.data.needsClarification) {
        setFlowStep("clarify");
        return;
      }
      setFlowStep("review");
    } catch (e) {
      if (isCallableUnauthenticated(e)) {
        void invalidateAuthSession();
        return;
      }
      setError(toUserErrorMessage(e, "Impossible d’exécuter la commande vocale."));
      setFlowStep("error");
    }
  };

  const handleConfirmReview = async () => {
    if (!result) {
      setError("Intention non confirmée. Réessaie la commande.");
      return;
    }

    if (result.needsClarification || (result.missingFields?.length ?? 0) > 0) {
      setError(null);
      setFlowStep("clarify");
      return;
    }

    setError(null);
    await runIntent(true, transcript);
  };

  const processBlob = async (blob: Blob) => {
    if (!user?.uid) {
      setError("Tu dois être connecté.");
      setFlowStep("error");
      return;
    }
    if (blob.size <= 0) {
      setError("Audio vide.");
      setFlowStep("error");
      return;
    }
    if (blob.size > maxBytes) {
      setError("Audio trop volumineux (max 25MB).");
      setFlowStep("error");
      return;
    }

    const audioMimeType = (blob.type || "audio/webm").trim();
    const audioExtension = inferVoiceFileExtension(audioMimeType);
    setFlowStep("uploading");

    let created: { jobId: string; storagePath: string };
    try {
      created = await createVoiceJob(audioMimeType, audioExtension);
      setJobId(created.jobId);
      voiceTimelineRef.current.jobId = created.jobId;
    } catch (e) {
      if (isCallableUnauthenticated(e)) {
        void invalidateAuthSession();
        return;
      }
      setError(mapVoiceFlowError("create_job", e));
      setFlowStep("error");
      return;
    }

    try {
      const fileRef = storageRef(storage, created.storagePath);
      await uploadBytes(fileRef, blob, { contentType: audioMimeType || "audio/webm" });
      const uploadDoneMs = Date.now();
      voiceTimelineRef.current.uploadDoneMs = uploadDoneMs;
      trackVoiceFlowEvent("voice_upload_done", {
        phase: "voice_upload",
        audio_bytes: blob.size,
        stop_to_upload_ms: safeDeltaMs(voiceTimelineRef.current.recordStopMs, uploadDoneMs),
      });
      setFlowStep("transcribing");
    } catch (e) {
      if (isCallableUnauthenticated(e)) {
        void invalidateAuthSession();
        return;
      }
      setError(mapVoiceFlowError("upload", e));
      setFlowStep("error");
      return;
    }

    try {
      const tr = await requestTranscription(created.jobId);
      if (!tr?.resultId || typeof tr.resultId !== "string") {
        setError(mapVoiceFlowError("backend_invalid", new Error("missing resultId")));
        setFlowStep("error");
        return;
      }
      setResultId(tr.resultId);
      voiceTimelineRef.current.resultId = tr.resultId;
    } catch (e) {
      if (isCallableUnauthenticated(e)) {
        void invalidateAuthSession();
        return;
      }
      setError(mapVoiceFlowError("transcription_request", e));
      setFlowStep("error");
    }
  };

  const stopListening = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    try {
      recorder.stop();
    } catch {
      // ignore
    }
  };

  const startListening = async () => {
    if (flowStep === "listening" || flowStep === "uploading" || flowStep === "transcribing" || flowStep === "executing") return;
    if (typeof window === "undefined" || typeof window.MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Enregistrement non supporté sur cet appareil.");
      setFlowStep("error");
      return;
    }

    setError(null);
    setResult(null);
    setClarificationInput("");
    setTranscript("");
    setLocalPreviewHint(null);
    setLocalActionPlan(null);
    setElapsedMs(0);
    setJobId(null);
    setResultId(null);
    analyzedResultIdRef.current = null;
    noiseFloorRef.current = 0.01;
    calibrationUntilRef.current = Date.now() + 1200;
    voiceTimelineRef.current = createVoiceTimelineState();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      heardVoiceRef.current = false;
      lastVoiceMsRef.current = Date.now();

      const recorder = (() => {
        const supportedMimeType = pickSupportedRecordingMimeType();
        try {
          if (supportedMimeType) {
            return new MediaRecorder(stream, { mimeType: supportedMimeType });
          }
          return new MediaRecorder(stream);
        } catch {
          return new MediaRecorder(stream);
        }
      })();
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        clearTimer();
        clearSilenceWatcher();
        cleanupAudioGraph();
        cleanupStream();
        const recordStopMs = Date.now();
        voiceTimelineRef.current.recordStopMs = recordStopMs;
        trackVoiceFlowEvent("voice_record_stop", {
          phase: "voice_record",
          heard_voice: heardVoiceRef.current,
          record_duration_ms: safeDeltaMs(voiceTimelineRef.current.recordStartMs, recordStopMs),
        });
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        chunksRef.current = [];
        recorderRef.current = null;
        void processBlob(blob);
      };

      recorder.start(350);
      setFlowStep("listening");
      startedAtRef.current = Date.now();
      voiceTimelineRef.current.recordStartMs = startedAtRef.current;
      trackVoiceFlowEvent("voice_record_start", {
        phase: "voice_record",
        auto_started: startedAutomaticallyRef.current,
      });

      timerRef.current = window.setInterval(() => {
        const elapsed = Date.now() - startedAtRef.current;
        setElapsedMs(elapsed);
        if (elapsed >= maxDurationMs) {
          stopListening();
        }
      }, 200);

      const audioCtx = new AudioContext();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;
      sourceRef.current = source;

      silenceIntervalRef.current = window.setInterval(() => {
        const an = analyserRef.current;
        if (!an) return;
        const arr = new Uint8Array(an.fftSize);
        an.getByteTimeDomainData(arr);
        let sum = 0;
        for (let i = 0; i < arr.length; i += 1) {
          const sample = arr[i] ?? 128;
          const v = (sample - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / arr.length);
        const now = Date.now();
        if (now < calibrationUntilRef.current) {
          noiseFloorRef.current = Math.max(0.005, noiseFloorRef.current * 0.9 + rms * 0.1);
        } else {
          noiseFloorRef.current = Math.max(0.005, noiseFloorRef.current * 0.98 + rms * 0.02);
        }

        const dynamicThreshold = Math.max(0.018, noiseFloorRef.current * 2.8);
        const speaking = rms > dynamicThreshold;
        if (speaking) {
          heardVoiceRef.current = true;
          lastVoiceMsRef.current = now;
        }

        if (!heardVoiceRef.current && now - startedAtRef.current > noVoiceAutoStopMs) {
          stopListening();
          return;
        }

        if (heardVoiceRef.current && now - lastVoiceMsRef.current > silenceAutoStopMs) {
          stopListening();
        }
      }, 180);
    } catch (e) {
      setError(mapMicrophoneAccessError(e));
      setFlowStep("error");
      hardStopRecordingResources();
    }
  };

  const closeModal = () => {
    setOpen(false);
    startedAutomaticallyRef.current = false;
    setLocalActionPlan(null);
    hardStopRecordingResources();
    try {
      recorderRef.current?.stop();
    } catch {
      // ignore
    }
    recorderRef.current = null;
  };

  const retryVoice = () => {
    setResult(null);
    setError(null);
    setTranscript("");
    setLocalActionPlan(null);
    setClarificationInput("");
    setClarificationSubmitting(false);
    setFlowStep("idle");
    void startListening();
  };

  const parseClarificationTimeInput = (input: string): { normalized: string; shortLabel: string; displayLabel: string } | null => {
    const compact = input.trim().replace(/\s+/g, "");
    if (!compact) return null;

    const hourOnly = /^([01]?\d|2[0-3])$/.exec(compact);
    if (hourOnly) {
      const hour = Number(hourOnly[1]);
      return {
        normalized: `${hour}h`,
        shortLabel: `${hour}h`,
        displayLabel: `${hour.toString().padStart(2, "0")}:00`,
      };
    }

    const hourMinute = /^([01]?\d|2[0-3])(?::|h|\.)([0-5]\d)$/.exec(compact);
    if (hourMinute) {
      const hour = Number(hourMinute[1]);
      const minute = hourMinute[2];
      return {
        normalized: `${hour}h${minute}`,
        shortLabel: `${hour}h${minute}`,
        displayLabel: `${hour.toString().padStart(2, "0")}:${minute}`,
      };
    }

    return null;
  };

  const normalizeClarificationTimeInput = (input: string) => {
    const parsed = parseClarificationTimeInput(input);
    if (parsed) return parsed.normalized;

    return input.trim();
  };

  const applyClarification = async () => {
    if (clarificationSubmitting) return;
    const extra = normalizeClarificationTimeInput(clarificationInput);
    if (!extra) return;
    const merged = `${transcript.trim()} ${extra}`.trim();
    setTranscript(merged);
    setClarificationInput("");
    setError(null);
    setClarificationSubmitting(true);
    try {
      await runIntent(true, merged);
    } finally {
      setClarificationSubmitting(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    if (startedAutomaticallyRef.current) return;
    startedAutomaticallyRef.current = true;
    void startListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!(flowStep === "clarify" || result?.needsClarification === true)) return;
    const id = window.setTimeout(() => {
      clarificationInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [flowStep, open, result?.needsClarification]);

  useEffect(() => {
    if (!open) return;
    return () => {
      hardStopRecordingResources();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!user?.uid || !jobId) return;
    const jobRef = doc(db, "users", user.uid, "assistantVoiceJobs", jobId);
    const unsub = onSnapshot(jobRef, (snap) => {
      const d = snap.exists() ? (snap.data() as { status?: unknown; errorMessage?: unknown }) : null;
      if (d?.status === "error" && typeof d.errorMessage === "string") {
        setError(d.errorMessage);
        setFlowStep("error");
      }
    });
    return () => unsub();
  }, [jobId, user?.uid]);

  useEffect(() => {
    if (!user?.uid || !resultId) return;
    const resultRef = doc(db, "users", user.uid, "assistantVoiceResults", resultId);
    const unsub = onSnapshot(resultRef, (snap) => {
      if (analyzedResultIdRef.current === resultId) return;
      const d = snap.exists() ? (snap.data() as { transcript?: unknown }) : null;
      if (typeof d?.transcript !== "string" || !d.transcript.trim()) return;
      const nextTranscript = d.transcript.trim();
      analyzedResultIdRef.current = resultId;
      setTranscript(nextTranscript);
      const transcriptReadyMs = Date.now();
      voiceTimelineRef.current.transcriptReadyMs = transcriptReadyMs;
      trackVoiceFlowEvent("voice_transcript_ready", {
        phase: "voice_transcription",
        transcript_chars: nextTranscript.length,
        upload_to_transcript_ms: safeDeltaMs(voiceTimelineRef.current.uploadDoneMs, transcriptReadyMs),
        stop_to_transcript_ms: safeDeltaMs(voiceTimelineRef.current.recordStopMs, transcriptReadyMs),
      });
      setFlowStep("transcribing");
      void runIntent(false, nextTranscript);
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultId, user?.uid]);

  const parsedHint = useMemo(() => {
    if (!result) return null;
    const intent = result.intent;
    const conf = `${Math.round((intent.confidence ?? 0) * 100)}%`;
    if (intent.kind === "create_todo") return `Compris: créer une checklist — “${intent.title}” (${conf}).`;
    if (intent.kind === "create_task") return `Compris: créer un élément d’agenda — “${intent.title}” (${conf}).`;
    if (intent.kind === "create_reminder") {
      return `Compris: créer un rappel — “${intent.title}”${intent.remindAtIso ? ` à ${new Date(intent.remindAtIso).toLocaleString("fr-FR")}` : ""} (${conf}).`;
    }
    return `Compris: planifier une réunion — “${intent.title}” (${conf}).`;
  }, [result]);

  const displayedHint = parsedHint ?? localPreviewHint;
  const clarificationPending = flowStep === "clarify" || result?.needsClarification === true;
  const isBusyStep = flowStep === "listening" || flowStep === "uploading" || flowStep === "transcribing" || flowStep === "executing";
  const stepProgress = useMemo(
    () => [
      { key: "listening", label: "Captation" },
      { key: "uploading", label: "Upload" },
      { key: "transcribing", label: "Transcription" },
      { key: "review", label: "Compréhension" },
      { key: "executing", label: "Exécution" },
    ],
    [],
  );
  const activeProgressIndex = useMemo(() => {
    if (flowStep === "done") return stepProgress.length - 1;
    if (flowStep === "clarify") return 3;
    if (flowStep === "error") return -1;
    return stepProgress.findIndex((step) => step.key === flowStep);
  }, [flowStep, stepProgress]);
  const clarificationButtonDisabled = !clarificationInput.trim() || clarificationSubmitting;
  const parsedClarificationTime = useMemo(() => parseClarificationTimeInput(clarificationInput), [clarificationInput]);
  const clarificationActionLabel = useMemo(() => {
    if (clarificationSubmitting) return "Traitement...";
    if (!parsedClarificationTime) return "OK";
    const at = parsedClarificationTime.shortLabel;
    if (result?.intent.kind === "schedule_meeting") return `Créer la réunion à ${at}`;
    if (result?.intent.kind === "create_task") return `Créer l’élément d’agenda à ${at}`;
    return `Créer le rappel à ${at}`;
  }, [clarificationSubmitting, parsedClarificationTime, result?.intent.kind]);
  const confirmationHint =
    flowStep === "review" && result?.intent?.requiresConfirmation
      ? "Dernière étape: appuie sur Oui pour confirmer la création."
      : null;

  const stepHint = useMemo(() => {
    if (flowStep === "listening") return "Je t’écoute… parle naturellement.";
    if (flowStep === "uploading") return "Envoi de l’audio…";
    if (flowStep === "transcribing") return "Transcription et analyse en cours…";
    if (flowStep === "executing") return "Exécution de l’action…";
    if (flowStep === "done") return "Action terminée ✅";
    if (flowStep === "clarify") return result?.clarificationQuestion ?? "Ajoute l'heure puis appuie sur OK pour créer.";
    if (flowStep === "review") return "Voici mon interprétation. Je lance l’action ?";
    return "Appuie sur le micro pour commencer.";
  }, [flowStep, result?.clarificationQuestion]);

  const slowStepHint = useMemo(() => {
    const elapsed = Date.now() - stepEnteredAtRef.current;
    if (flowStep === "listening" && elapsed > 3000) return "Parle plus fort ou plus près du micro.";
    if (flowStep === "uploading" && elapsed > 2000) return "Envoi de l’audio en cours…";
    if (flowStep === "transcribing" && elapsed > 3000) return "Analyse de l’audio en cours…";
    if (flowStep === "executing" && elapsed > 2000) return "Exécution de l’action en cours…";
    return null;
  }, [flowStep]);
  const helpfulErrorHint = useMemo(() => {
    if (!error) return null;
    const raw = error.toLowerCase();
    if (raw.includes("permission micro") || raw.includes("accès au micro")) {
      return "Autorise le micro pour Smart Notes dans le navigateur Android puis réessaie.";
    }
    if (raw.includes("audio vide") || raw.includes("capture")) {
      return "Parle plus près du micro pendant 1-2 secondes pour valider la captation.";
    }
    if (raw.includes("envoi") || raw.includes("upload")) {
      return "Vérifie la connexion réseau: l’audio a été capté mais l’upload a échoué.";
    }
    if (raw.includes("transcription")) {
      return "La capture est faite, mais la transcription a échoué côté service vocal.";
    }
    return "Réessaie; si l’erreur persiste, la cause est côté backend vocal.";
  }, [error]);

  const customTrigger = renderCustomTrigger
    ? renderCustomTrigger({
        onClick: () => setOpen(true),
        ariaLabel: "Assistant vocal",
        title: "Assistant vocal",
      })
    : null;

  const voiceModal = open ? (
    <div
      className="fixed inset-0 z-[70] bg-background/75 backdrop-blur-[2px] p-0 md:p-4 flex items-end md:items-center md:justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Assistant vocal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <div
        className="w-full md:max-w-[440px] rounded-t-2xl md:rounded-xl border border-border bg-card p-3 md:p-4 space-y-2 md:space-y-3 shadow-2xl max-h-[82vh] overflow-y-auto"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="text-sm font-semibold">Assistant vocal</div>
            <div
              className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                flowStep === "listening"
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : flowStep === "uploading" || flowStep === "transcribing" || flowStep === "executing"
                    ? "border-amber-300 bg-amber-50 text-amber-700"
                    : flowStep === "review" || flowStep === "clarify" || flowStep === "done"
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                      : flowStep === "error"
                        ? "border-destructive/40 bg-destructive/10 text-destructive"
                        : "border-border bg-muted/30 text-muted-foreground"
              }`}
            >
              {flowStep === "listening"
                ? "En écoute"
                : flowStep === "uploading" || flowStep === "transcribing" || flowStep === "executing"
                  ? "Traitement"
                  : flowStep === "review" || flowStep === "clarify"
                    ? "Commande détectée"
                    : flowStep === "done"
                      ? "Terminé"
                      : flowStep === "error"
                        ? "Erreur"
                        : "Prêt"}
            </div>
          </div>
          <button type="button" className="text-sm text-muted-foreground" onClick={closeModal}>
            Fermer
          </button>
        </div>

        <div className="rounded-lg border border-border bg-background/60 p-2 md:p-3">
          <div className="flex flex-col items-center justify-center gap-2 py-1">
            <button
              type="button"
              onClick={() => {
                if (flowStep === "listening") {
                  stopListening();
                } else {
                  void startListening();
                }
              }}
              className={
                "relative h-20 w-20 md:h-24 md:w-24 rounded-full border border-primary/40 text-2xl md:text-3xl flex items-center justify-center transition-all " +
                (flowStep === "listening" ? "bg-primary/20 animate-pulse" : "bg-primary/10")
              }
              aria-label={flowStep === "listening" ? "Stopper l’écoute" : "Démarrer l’écoute"}
              title={flowStep === "listening" ? "Stop" : "Parler"}
            >
              🎤
            </button>
            {flowStep === "listening" ? <div className="text-xs text-muted-foreground">{Math.max(0, Math.floor(elapsedMs / 1000))}s</div> : null}
            <div className="text-xs text-muted-foreground text-center">{stepHint}</div>
            {slowStepHint ? <div className="text-xs text-amber-600">{slowStepHint}</div> : null}
            <div className="flex flex-wrap items-center justify-center gap-1 pt-1">
              {stepProgress.map((step, index) => {
                const isDone = activeProgressIndex >= 0 && index < activeProgressIndex;
                const isActive = index === activeProgressIndex;
                return (
                  <span
                    key={step.key}
                    className={`rounded-full border px-2 py-0.5 text-[10px] ${
                      isActive
                        ? "border-primary bg-primary/10 text-primary"
                        : isDone
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border-border bg-muted/30 text-muted-foreground"
                    }`}
                  >
                    {step.label}
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Transcription</div>
          <div className="rounded-md border border-border bg-background p-2.5 md:p-3 text-sm whitespace-pre-wrap max-h-28 overflow-y-auto">
            {transcript ? transcript : "La transcription apparaîtra ici dès qu’un audio est capté."}
          </div>
        </div>

        {clarificationPending ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void applyClarification();
            }}
          >
            <input
              ref={clarificationInputRef}
              type="text"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              autoFocus
              placeholder="Ex: 9, 9h, 9h30"
              value={clarificationInput}
              onChange={(e) => setClarificationInput(e.target.value)}
            />
            {parsedClarificationTime ? <div className="text-xs text-muted-foreground">Heure détectée : {parsedClarificationTime.displayLabel}</div> : null}
          </form>
        ) : null}

        {displayedHint ? (
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Action comprise</div>
            <div className="rounded-md border border-emerald-300/70 bg-emerald-50/70 p-2.5 text-sm text-emerald-900">{displayedHint}</div>
          </div>
        ) : null}
        {!result && localActionPlan && (localActionPlan.kind === "note" || localActionPlan.kind === "task" || localActionPlan.kind === "checklist") ? (
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Résumé de confirmation</div>
            <div className="rounded-md border border-border bg-background p-2.5 text-sm space-y-1">
              <div>Type : {localActionPlan.typeLabel}</div>
              <div>Contenu détecté : {localActionPlan.payload ? `“${localActionPlan.payload}”` : "non détecté"}</div>
              {localActionPlan.detectedDateLabel ? <div>Date détectée : {localActionPlan.detectedDateLabel}</div> : null}
              <div>Action proposée : {localActionPlan.proposedAction}</div>
            </div>
          </div>
        ) : null}

        {result?.message ? <div className="text-xs text-muted-foreground">{result.message}</div> : null}
        {confirmationHint ? <div className="text-xs text-amber-600">{confirmationHint}</div> : null}
        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2">
            <div className="text-xs font-medium text-destructive">{error}</div>
            {helpfulErrorHint ? <div className="mt-1 text-xs text-destructive/90">{helpfulErrorHint}</div> : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {flowStep === "listening" ? (
            <button
              type="button"
              className="px-3 py-2 rounded-md border border-input text-sm"
              onClick={stopListening}
            >
              Arrêter l’écoute
            </button>
          ) : null}

          {flowStep === "review" && !clarificationPending ? (
            <>
              <button
                type="button"
                className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm"
                onClick={() => void handleConfirmReview()}
              >
                Valider
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-md border border-input text-sm"
                onClick={retryVoice}
              >
                Réessayer
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-md border border-input text-sm"
                onClick={closeModal}
              >
                Annuler
              </button>
            </>
          ) : null}

          {clarificationPending ? (
            <>
              <button
                type="button"
                className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
                disabled={clarificationButtonDisabled}
                onClick={() => void applyClarification()}
              >
                {clarificationActionLabel}
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-md border border-border bg-muted/40 text-muted-foreground text-sm"
                onClick={closeModal}
              >
                Annuler
              </button>
            </>
          ) : null}

          {flowStep === "done" ? (
            <button
              type="button"
              className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm"
              onClick={closeModal}
            >
              Fermer
            </button>
          ) : null}

          {flowStep === "error" ? (
            <>
              <button
                type="button"
                className="px-3 py-2 rounded-md border border-input text-sm"
                onClick={retryVoice}
              >
                Réessayer
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-md border border-input text-sm"
                onClick={closeModal}
              >
                Annuler
              </button>
            </>
          ) : null}

          {flowStep === "idle" ? (
            <button
              type="button"
              className="px-3 py-2 rounded-md border border-input text-sm"
              onClick={() => void startListening()}
            >
              Démarrer l’écoute
            </button>
          ) : null}

          <button
            type="button"
            className="px-3 py-2 rounded-md border border-border bg-muted/40 text-muted-foreground text-sm disabled:opacity-50"
            disabled={isBusyStep}
            onClick={retryVoice}
          >
            Nouvelle commande
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      {renderCustomTrigger ? (
        customTrigger
      ) : (
        <>
          <button
            type="button"
            className="hidden md:inline-flex fixed right-8 bottom-8 z-50 h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
            onClick={() => setOpen(true)}
            aria-label="Assistant vocal"
            title="Assistant vocal"
          >
            🎤
          </button>

          {!mobileHidden ? (
            <button
              type="button"
              className="md:hidden fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
              onClick={() => setOpen(true)}
              aria-label="Assistant vocal"
              title="Assistant vocal"
            >
              🎤
            </button>
          ) : null}
        </>
      )}

      {voiceModal ? (typeof document !== "undefined" ? createPortal(voiceModal, document.body) : voiceModal) : null}
    </>
  );
}
