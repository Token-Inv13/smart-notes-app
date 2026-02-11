"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FirebaseError } from "firebase/app";
import { httpsCallable } from "firebase/functions";
import { doc, onSnapshot, serverTimestamp, updateDoc, type Timestamp } from "firebase/firestore";
import { db, functions as fbFunctions } from "@/lib/firebase";
import { invalidateAuthSession, isAuthInvalidError } from "@/lib/authInvalidation";
import { useAssistantSettings } from "@/hooks/useAssistantSettings";
import { useNoteAssistantSuggestions } from "@/hooks/useNoteAssistantSuggestions";
import { useAuth } from "@/hooks/useAuth";
import { formatTimestampForInput, parseLocalDateTimeToTimestamp } from "@/lib/datetime";
import type { AssistantAIResultDoc, AssistantSuggestionDoc, Priority } from "@/types/firestore";
import Modal from "../Modal";
import BundleCustomizeModal from "./assistant/BundleCustomizeModal";
import VoiceRecorderButton from "./assistant/VoiceRecorderButton";

type Props = {
  noteId?: string;
};

export default function AssistantNotePanel({ noteId }: Props) {
  const { user } = useAuth();
  const {
    data: assistantSettings,
    loading: assistantLoading,
    error: assistantError,
    refetch: refetchAssistant,
  } = useAssistantSettings();
  const enabled = assistantSettings?.enabled === true;
  const isPro = assistantSettings?.plan === "pro";

  const [showExpired, setShowExpired] = useState(false);

  const {
    data: suggestions,
    loading: suggestionsLoading,
    error: suggestionsError,
    refetch: refetchSuggestions,
  } = useNoteAssistantSuggestions(noteId, { limit: 10, includeExpired: showExpired });

  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busySuggestionId, setBusySuggestionId] = useState<string | null>(null);
  const [busyReanalysis, setBusyReanalysis] = useState(false);
  const [reanalyzeCooldownUntil, setReanalyzeCooldownUntil] = useState<number>(0);

  const [jobStatus, setJobStatus] = useState<"queued" | "processing" | "done" | "error" | null>(null);
  const lastJobStatusRef = useRef<typeof jobStatus>(null);

  type JobResult = {
    candidates?: number;
    created?: number;
    updated?: number;
    skippedProposed?: number;
    skippedAccepted?: number;
  };

  const [jobResult, setJobResult] = useState<JobResult | null>(null);

  const [aiJobStatus, setAIJobStatus] = useState<"queued" | "processing" | "done" | "error" | null>(null);
  const [aiJobResultId, setAIJobResultId] = useState<string | null>(null);
  const [aiJobError, setAIJobError] = useState<string | null>(null);
  const [aiJobModel, setAIJobModel] = useState<string | null>(null);
  const [aiJobModelRequested, setAIJobModelRequested] = useState<string | null>(null);
  const [aiJobModelFallbackUsed, setAIJobModelFallbackUsed] = useState<string | null>(null);
  const [aiResult, setAIResult] = useState<AssistantAIResultDoc | null>(null);
  const [busyAIAnalysis, setBusyAIAnalysis] = useState(false);

  const [editing, setEditing] = useState<AssistantSuggestionDoc | null>(null);
  const [editTitle, setEditTitle] = useState<string>("");
  const [editDate, setEditDate] = useState<string>("");
  const [editPriority, setEditPriority] = useState<"" | Priority>("");
  const [editError, setEditError] = useState<string | null>(null);
  const [expandedBundleSuggestionId, setExpandedBundleSuggestionId] = useState<string | null>(null);

  const [bundleCustomizeSuggestion, setBundleCustomizeSuggestion] = useState<AssistantSuggestionDoc | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (!noteId) return;
    if (!user?.uid) return;

    const jobId = `current_note_${noteId}`;
    const jobRef = doc(db, "users", user.uid, "assistantJobs", jobId);

    const unsub = onSnapshot(
      jobRef,
      (snap) => {
        const data = snap.exists() ? (snap.data() as any) : null;
        const nextStatus = data ? ((data?.status as typeof jobStatus) ?? null) : null;
        const nextResult = data && typeof data?.result === "object" && data.result ? (data.result as JobResult) : null;

        setJobStatus(nextStatus ?? null);
        setJobResult(nextResult);

        const prev = lastJobStatusRef.current;
        lastJobStatusRef.current = nextStatus ?? null;

        if ((nextStatus === "done" || nextStatus === "error") && prev !== "done" && prev !== "error") {
          setActionMessage(null);
          if (nextStatus === "error") setActionError("Réanalyse en erreur.");
          refetchSuggestions();
        }
      },
      () => {
        setJobStatus(null);
        setJobResult(null);
      },
    );

    return () => {
      unsub();
    };
  }, [enabled, noteId, user?.uid, refetchSuggestions]);

  useEffect(() => {
    if (!enabled) return;
    if (!noteId) return;
    if (!user?.uid) return;

    const jobId = `current_note_${noteId}`;
    const jobRef = doc(db, "users", user.uid, "assistantAIJobs", jobId);

    const unsub = onSnapshot(
      jobRef,
      (snap) => {
        const data = snap.exists() ? (snap.data() as any) : null;
        const nextStatus = data ? ((data?.status as typeof aiJobStatus) ?? null) : null;
        const nextResultId = data && typeof data?.resultId === "string" ? String(data.resultId) : null;
        const nextError = data && typeof data?.error === "string" ? String(data.error) : null;
        const nextModel = data && typeof data?.model === "string" ? String(data.model) : null;
        const nextModelRequested = data && typeof data?.modelRequested === "string" ? String(data.modelRequested) : null;
        const nextModelFallbackUsed = data && typeof data?.modelFallbackUsed === "string" ? String(data.modelFallbackUsed) : null;

        setAIJobStatus(nextStatus ?? null);
        setAIJobResultId(nextResultId);
        setAIJobError(nextError);
        setAIJobModel(nextModel);
        setAIJobModelRequested(nextModelRequested);
        setAIJobModelFallbackUsed(nextModelFallbackUsed);
      },
      () => {
        setAIJobStatus(null);
        setAIJobResultId(null);
        setAIJobError(null);
        setAIJobModel(null);
        setAIJobModelRequested(null);
        setAIJobModelFallbackUsed(null);
      },
    );

    return () => {
      unsub();
    };
  }, [enabled, noteId, user?.uid]);

  const showAIDebug = process.env.NEXT_PUBLIC_ASSISTANT_AI_DEBUG === "1";

  const aiModelAccessError = useMemo(() => {
    const msg = (aiJobError ?? "").toLowerCase();
    if (!msg) return false;
    return msg.includes("model_not_found") || msg.includes("does not have access to model") || msg.includes("n’a accès à aucun modèle");
  }, [aiJobError]);

  useEffect(() => {
    if (!enabled) return;
    if (!user?.uid) return;
    if (!aiJobResultId) {
      setAIResult(null);
      return;
    }

    const resultRef = doc(db, "users", user.uid, "assistantAIResults", aiJobResultId);
    const unsub = onSnapshot(
      resultRef,
      (snap) => {
        const data = snap.exists() ? (snap.data() as any) : null;
        if (!data) {
          setAIResult(null);
          return;
        }
        setAIResult({ ...(data as AssistantAIResultDoc), id: snap.id });
      },
      () => {
        setAIResult(null);
      },
    );

    return () => {
      unsub();
    };
  }, [enabled, user?.uid, aiJobResultId]);

  const sorted = useMemo(() => {
    const arr = (suggestions ?? []).slice();
    const toMillisSafe = (ts: unknown) => {
      const maybe = ts as { toMillis?: () => number };
      if (maybe && typeof maybe.toMillis === "function") return maybe.toMillis();
      return 0;
    };
    arr.sort((a, b) => toMillisSafe(b.updatedAt) - toMillisSafe(a.updatedAt));
    return arr;
  }, [suggestions]);

  const showSkeleton = suggestionsLoading;

  const doneBannerMessage = useMemo(() => {
    if (jobStatus !== "done") return null;
    if (suggestionsLoading) return null;
    if ((sorted?.length ?? 0) > 0) return null;

    const r = jobResult;
    const candidates = typeof r?.candidates === "number" ? r.candidates : null;
    const created = typeof r?.created === "number" ? r.created : 0;
    const updated = typeof r?.updated === "number" ? r.updated : 0;
    const skippedProposed = typeof r?.skippedProposed === "number" ? r.skippedProposed : 0;
    const skippedAccepted = typeof r?.skippedAccepted === "number" ? r.skippedAccepted : 0;

    if (candidates === 0) return "Aucune suggestion détectée.";

    if (created + updated === 0) {
      if (skippedAccepted > 0 || skippedProposed > 0) return "Aucune nouvelle suggestion (déjà traitée).";
      return "Aucune nouvelle suggestion.";
    }

    return null;
  }, [jobStatus, jobResult, sorted?.length, suggestionsLoading]);

  const isCallableUnauthenticated = (err: unknown) => {
    if (isAuthInvalidError(err)) return true;
    const code = typeof (err as { code?: unknown })?.code === "string" ? String((err as { code?: unknown }).code) : "";
    return code.includes("unauthenticated");
  };

  const handleAIAnalyze = async () => {
    if (!noteId) return;
    if (busyAIAnalysis) return;

    setBusyAIAnalysis(true);
    setActionMessage(null);
    setActionError(null);

    try {
      const fn = httpsCallable<{ noteId: string }, { jobId: string; resultId?: string }>(fbFunctions, "assistantRequestAIAnalysis");
      const res = await fn({ noteId });
      setActionMessage(`Analyse IA demandée (job: ${res.data.jobId}).`);
    } catch (e) {
      if (isCallableUnauthenticated(e)) {
        void invalidateAuthSession();
        return;
      }
      if (e instanceof FirebaseError) setActionError(`${e.code}: ${e.message}`);
      else if (e instanceof Error) setActionError(e.message);
      else setActionError("Impossible de lancer l’analyse IA.");
    } finally {
      setBusyAIAnalysis(false);
    }
  };

  const handleCopyToClipboard = async (text: string) => {
    const t = (text ?? "").trim();
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t);
      setActionMessage("Copié dans le presse-papiers.");
    } catch {
      setActionError("Impossible de copier.");
    }
  };

  const handleReplaceNoteContent = async (nextContent: string) => {
    if (!noteId) return;
    const t = (nextContent ?? "").trim();
    if (!t) {
      setActionError("Contenu proposé vide.");
      return;
    }
    const ok = window.confirm("Remplacer le contenu de la note par la proposition IA ?");
    if (!ok) return;

    try {
      await updateDoc(doc(db, "notes", noteId), {
        content: t,
        updatedAt: serverTimestamp(),
      });
      setActionMessage("Contenu remplacé.");
    } catch (e) {
      if (e instanceof FirebaseError) setActionError(`${e.code}: ${e.message}`);
      else if (e instanceof Error) setActionError(e.message);
      else setActionError("Impossible de remplacer le contenu.");
    }
  };

  const formatTs = (ts: Timestamp | null | undefined) => {
    if (!ts) return "";
    try {
      return ts.toDate().toLocaleString();
    } catch {
      return "";
    }
  };

  const handleRefresh = () => {
    setActionMessage(null);
    setActionError(null);
    setEditError(null);
    refetchAssistant();
    refetchSuggestions();
  };

  const cooldownActive = Date.now() < reanalyzeCooldownUntil;

  const handleReanalyze = async () => {
    if (!noteId) return;
    if (busyReanalysis) return;
    if (cooldownActive) return;

    setBusyReanalysis(true);
    setActionMessage(null);
    setActionError(null);

    try {
      const fn = httpsCallable<{ noteId: string }, { jobId: string }>(fbFunctions, "assistantRequestReanalysis");
      const res = await fn({ noteId });
      setActionMessage(`Réanalyse demandée (job: ${res.data.jobId}).`);
      setReanalyzeCooldownUntil(Date.now() + 30_000);
    } catch (e) {
      if (isCallableUnauthenticated(e)) {
        void invalidateAuthSession();
        return;
      }
      if (e instanceof FirebaseError) setActionError(`${e.code}: ${e.message}`);
      else if (e instanceof Error) setActionError(e.message);
      else setActionError("Impossible de lancer la réanalyse.");
    } finally {
      setBusyReanalysis(false);
    }
  };

  type ApplySuggestionResult = {
    createdCoreObjects?: { type: string; id: string }[];
    decisionId?: string | null;
  };

  const handleAccept = async (s: AssistantSuggestionDoc) => {
    const suggestionId = s.id ?? s.dedupeKey;
    if (!suggestionId) return;
    if (busySuggestionId) return;

    setBusySuggestionId(suggestionId);
    setActionMessage(null);
    setActionError(null);

    try {
      const fn = httpsCallable<{ suggestionId: string }, ApplySuggestionResult>(fbFunctions, "assistantApplySuggestion");
      const res = await fn({ suggestionId });
      const count = Array.isArray(res.data?.createdCoreObjects) ? res.data.createdCoreObjects.length : 0;
      setActionMessage(count > 0 ? `Suggestion acceptée (${count} objet(s) créé(s)).` : "Suggestion acceptée.");
    } catch (e) {
      if (isCallableUnauthenticated(e)) {
        void invalidateAuthSession();
        return;
      }
      if (e instanceof FirebaseError) setActionError(`${e.code}: ${e.message}`);
      else if (e instanceof Error) setActionError(e.message);
      else setActionError("Impossible d’accepter la suggestion.");
    } finally {
      setBusySuggestionId(null);
    }
  };

  const handleReject = async (s: AssistantSuggestionDoc) => {
    const suggestionId = s.id ?? s.dedupeKey;
    if (!suggestionId) return;
    if (busySuggestionId) return;

    setBusySuggestionId(suggestionId);
    setActionMessage(null);
    setActionError(null);

    try {
      const fn = httpsCallable<{ suggestionId: string }, { decisionId?: string | null }>(fbFunctions, "assistantRejectSuggestion");
      await fn({ suggestionId });
      setActionMessage("Suggestion refusée.");
    } catch (e) {
      if (isCallableUnauthenticated(e)) {
        void invalidateAuthSession();
        return;
      }
      if (e instanceof FirebaseError) setActionError(`${e.code}: ${e.message}`);
      else if (e instanceof Error) setActionError(e.message);
      else setActionError("Impossible de refuser la suggestion.");
    } finally {
      setBusySuggestionId(null);
    }
  };

  const openEdit = (s: AssistantSuggestionDoc) => {
    if (s.kind !== "create_task" && s.kind !== "create_reminder") return;
    setEditing(s);
    setEditError(null);
    const payload = s.payload;
    setEditTitle(payload?.title ?? "");
    if (s.kind === "create_task") {
      setEditDate("dueDate" in payload ? formatTimestampForInput(payload.dueDate ?? null) : "");
    } else {
      setEditDate("remindAt" in payload ? formatTimestampForInput(payload.remindAt ?? null) : "");
    }
    const p = "priority" in payload ? payload.priority : undefined;
    setEditPriority(p === "low" || p === "medium" || p === "high" ? p : "");
  };

  const closeEdit = () => {
    setEditing(null);
    setEditError(null);
  };

  const handleConfirmBundleCustomize = async (overrides: { selectedIndexes: number[]; tasksOverrides?: Record<number, Record<string, unknown>> }) => {
    const suggestion = bundleCustomizeSuggestion;
    if (!suggestion) return;
    const suggestionId = suggestion.id ?? suggestion.dedupeKey;
    if (!suggestionId) return;
    if (busySuggestionId) return;

    setBusySuggestionId(suggestionId);
    setActionMessage(null);
    setActionError(null);

    try {
      const fn = httpsCallable<
        { suggestionId: string; overrides: { selectedIndexes: number[]; tasksOverrides?: Record<number, Record<string, unknown>> } },
        ApplySuggestionResult
      >(fbFunctions, "assistantApplySuggestion");
      const res = await fn({ suggestionId, overrides });
      const count = Array.isArray(res.data?.createdCoreObjects) ? res.data.createdCoreObjects.length : 0;
      setActionMessage(count > 0 ? `Plan créé (${count} objet(s) créé(s)).` : "Plan créé.");
      setBundleCustomizeSuggestion(null);
    } catch (e) {
      if (isCallableUnauthenticated(e)) {
        void invalidateAuthSession();
        return;
      }
      if (e instanceof FirebaseError) throw new Error(`${e.code}: ${e.message}`);
      if (e instanceof Error) throw e;
      throw new Error("Impossible de créer le plan.");
    } finally {
      setBusySuggestionId(null);
    }
  };

  const handleAcceptEdited = async () => {
    if (!editing) return;
    const suggestionId = editing.id ?? editing.dedupeKey;
    if (!suggestionId) return;
    if (busySuggestionId) return;

    const title = editTitle.trim();
    if (!title) {
      setEditError("Le titre est requis.");
      return;
    }

    const dt = editDate ? parseLocalDateTimeToTimestamp(editDate) : null;
    if (editing.kind === "create_reminder" && !dt) {
      setEditError("La date/heure de rappel est requise.");
      return;
    }

    const overrides: Record<string, unknown> = {
      title,
    };

    if (editing.kind === "create_task") {
      overrides.dueDate = dt ? dt.toMillis() : null;
    } else {
      overrides.remindAt = dt ? dt.toMillis() : null;
    }

    if ("priority" in editing.payload) {
      overrides.priority = editPriority ? editPriority : null;
    }

    setBusySuggestionId(suggestionId);
    setActionMessage(null);
    setActionError(null);
    setEditError(null);

    try {
      const fn = httpsCallable<{ suggestionId: string; overrides: Record<string, unknown> }, ApplySuggestionResult>(
        fbFunctions,
        "assistantApplySuggestion",
      );
      const res = await fn({ suggestionId, overrides });
      const count = Array.isArray(res.data?.createdCoreObjects) ? res.data.createdCoreObjects.length : 0;
      setActionMessage(count > 0 ? `Suggestion acceptée (${count} objet(s) créé(s)).` : "Suggestion acceptée.");
      closeEdit();
    } catch (e) {
      if (isCallableUnauthenticated(e)) {
        void invalidateAuthSession();
        return;
      }
      if (e instanceof FirebaseError) setEditError(`${e.code}: ${e.message}`);
      else if (e instanceof Error) setEditError(e.message);
      else setEditError("Impossible d’accepter la suggestion.");
    } finally {
      setBusySuggestionId(null);
    }
  };

  if (assistantLoading) {
    return (
      <div className="sn-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold">Assistant</div>
          <div className="text-xs text-muted-foreground">{noteId ? `Note: ${noteId}` : ""}</div>
        </div>
        <div className="sn-skeleton-card space-y-2">
          <div className="sn-skeleton-line w-2/3" />
          <div className="sn-skeleton-line w-1/2" />
          <div className="sn-skeleton-line w-5/6" />
        </div>
      </div>
    );
  }

  if (assistantError) {
    const assistantErrorLabel = (() => {
      if (assistantError instanceof FirebaseError) return `${assistantError.code}: ${assistantError.message}`;
      if (assistantError instanceof Error) return assistantError.message;
      return "";
    })();

    return (
      <div className="sn-card p-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold">Assistant</div>
          <button
            type="button"
            onClick={handleRefresh}
            className="px-3 py-2 rounded-md border border-input text-sm"
          >
            Rafraîchir
          </button>
        </div>
        <div className="sn-alert sn-alert--error">
          Erreur lors du chargement de l’assistant.
          {assistantErrorLabel ? <div className="mt-1 text-xs opacity-80">{assistantErrorLabel}</div> : null}
        </div>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="sn-card p-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold">Assistant</div>
          <a href="/assistant" className="px-3 py-2 rounded-md border border-input text-sm hover:bg-accent">
            Activer
          </a>
        </div>
        <div className="text-sm text-muted-foreground">Assistant désactivé.</div>
      </div>
    );
  }

  return (
    <div className="sn-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">Assistant</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            className="px-3 py-2 rounded-md border border-input text-sm hover:bg-accent"
          >
            Rafraîchir
          </button>
          <button
            type="button"
            onClick={() => void handleReanalyze()}
            disabled={!noteId || busyReanalysis || cooldownActive}
            className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
          >
            {busyReanalysis ? "Réanalyse…" : cooldownActive ? "Réanalyser (cooldown)" : "Réanalyser"}
          </button>
          <button
            type="button"
            onClick={() => void handleAIAnalyze()}
            disabled={!noteId || busyAIAnalysis}
            className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
          >
            {busyAIAnalysis ? "IA…" : "Analyser avec IA"}
          </button>
          <div className="text-xs text-muted-foreground">{noteId ? `Note: ${noteId}` : ""}</div>
        </div>
      </div>

      {actionMessage && <div className="sn-alert">{actionMessage}</div>}
      {actionError && <div className="sn-alert sn-alert--error">{actionError}</div>}

      {jobStatus === "queued" && <div className="sn-alert">Analyse en attente…</div>}
      {jobStatus === "processing" && <div className="sn-alert">Analyse en cours…</div>}
      {jobStatus === "error" && <div className="sn-alert sn-alert--error">Réanalyse en erreur.</div>}
      {doneBannerMessage && <div className="sn-alert">{doneBannerMessage}</div>}

      <div className="border border-border rounded-md p-3 space-y-2">
        <div className="text-sm font-semibold">Voix</div>
        <div className="text-xs text-muted-foreground">
          Enregistre un mémo vocal, puis transcription côté serveur.
        </div>
        <VoiceRecorderButton noteId={noteId} mode="append_to_note" />
      </div>

      <div className="border border-border rounded-md p-3 space-y-2">
        <div className="text-sm font-semibold">IA</div>
        {aiJobStatus === "queued" && <div className="sn-alert">Analyse IA en attente…</div>}
        {aiJobStatus === "processing" && <div className="sn-alert">Analyse IA en cours…</div>}
        {aiJobStatus === "error" && (
          <div className="sn-alert sn-alert--error">
            <div>Analyse IA en erreur.</div>
            {aiModelAccessError ? (
              <div className="text-xs opacity-90 break-words mt-1">
                Modèle non autorisé pour ce projet OpenAI. Vérifie le Project OpenAI associé à la clé et/ou configure un modèle autorisé.
              </div>
            ) : null}
            {aiJobError ? <div className="text-xs opacity-90 break-words mt-1">{aiJobError}</div> : null}
            {showAIDebug ? (
              <div className="text-[11px] opacity-70 break-words mt-1">
                <div>model: {aiJobModel ?? "(inconnu)"}</div>
                <div>modelRequested: {aiJobModelRequested ?? "(aucun)"}</div>
                <div>modelFallbackUsed: {aiJobModelFallbackUsed ?? "(aucun)"}</div>
              </div>
            ) : null}
          </div>
        )}

        {aiResult ? (
          (() => {
            const out = (aiResult as any)?.output ?? null;
            const refusal = typeof (aiResult as any)?.refusal === "string" ? String((aiResult as any).refusal) : "";

            const summaryShort = typeof out?.summaryShort === "string" ? String(out.summaryShort) : "";
            const summaryStructured = Array.isArray(out?.summaryStructured) ? (out.summaryStructured as any[]) : [];
            const keyPoints = Array.isArray(out?.keyPoints) ? (out.keyPoints as any[]) : [];
            const hooks = Array.isArray(out?.hooks) ? (out.hooks as any[]) : [];
            const tags = Array.isArray(out?.tags) ? (out.tags as any[]) : [];
            const entities = out?.entities && typeof out.entities === "object" ? (out.entities as any) : null;

            const hasAny =
              !!summaryShort ||
              summaryStructured.length > 0 ||
              keyPoints.length > 0 ||
              hooks.length > 0 ||
              tags.length > 0 ||
              !!entities;

            return (
              <div className="space-y-2">
                {refusal ? <div className="sn-alert sn-alert--error">Refus IA: {refusal}</div> : null}
                {!hasAny ? <div className="text-sm text-muted-foreground">IA n’a rien détecté.</div> : null}

                {summaryShort ? <div className="text-sm">{summaryShort}</div> : null}

                {summaryStructured.length > 0 ? (
                  <div className="space-y-2">
                    {summaryStructured.map((sec, idx) => {
                      const title = typeof sec?.title === "string" ? sec.title : "";
                      const bullets = Array.isArray(sec?.bullets) ? (sec.bullets as any[]) : [];
                      if (!title && bullets.length === 0) return null;
                      return (
                        <div key={`ai_struct_${idx}`} className="text-sm">
                          {title ? <div className="font-medium">{title}</div> : null}
                          {bullets.length > 0 ? (
                            <ul className="list-disc pl-5">
                              {bullets.slice(0, 8).map((b, j) => (
                                <li key={`ai_struct_${idx}_${j}`}>{typeof b === "string" ? b : ""}</li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {keyPoints.length > 0 ? (
                  <div className="text-sm">
                    <div className="font-medium">Points clés</div>
                    <ul className="list-disc pl-5">
                      {keyPoints.slice(0, 10).map((p, idx) => (
                        <li key={`ai_kp_${idx}`}>{typeof p === "string" ? p : ""}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {hooks.length > 0 ? (
                  <div className="text-sm">
                    <div className="font-medium">Hooks</div>
                    <ul className="list-disc pl-5">
                      {hooks.slice(0, 10).map((h, idx) => (
                        <li key={`ai_hook_${idx}`}>{typeof h === "string" ? h : ""}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {tags.length > 0 ? (
                  <div className="text-sm">
                    <div className="font-medium">Tags</div>
                    <div className="text-xs text-muted-foreground break-words">{tags.filter((t) => typeof t === "string").join(", ")}</div>
                  </div>
                ) : null}

                {entities ? (
                  <div className="text-sm">
                    <div className="font-medium">Entités</div>
                    <div className="text-xs text-muted-foreground space-y-1">
                      {Object.entries(entities).map(([k, v]) => {
                        if (!Array.isArray(v) || v.length === 0) return null;
                        return (
                          <div key={`ai_ent_${k}`}>
                            {k}: {v.filter((x) => typeof x === "string").join(", ")}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })()
        ) : (
          <div className="text-sm text-muted-foreground">Lance une analyse IA pour afficher un résumé et des insights.</div>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={showExpired} onChange={(e) => setShowExpired(e.target.checked)} />
        Afficher expirées
      </label>

      {suggestionsError && (
        (() => {
          const suggestionsErrorLabel = (() => {
            if (suggestionsError instanceof FirebaseError) return `${suggestionsError.code}: ${suggestionsError.message}`;
            if (suggestionsError instanceof Error) return suggestionsError.message;
            return "";
          })();

          return (
        <div className="space-y-2">
          <div className="sn-alert sn-alert--error">
            Erreur lors du chargement des suggestions.
            {suggestionsErrorLabel ? <div className="mt-1 text-xs opacity-80">{suggestionsErrorLabel}</div> : null}
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            className="px-3 py-2 rounded-md border border-input text-sm"
          >
            Rafraîchir
          </button>
        </div>
          );
        })()
      )}

      {showSkeleton && (
        <div className="sn-skeleton-card space-y-2">
          <div className="sn-skeleton-line w-2/3" />
          <div className="sn-skeleton-line w-1/2" />
          <div className="sn-skeleton-line w-5/6" />
        </div>
      )}

      {!showSkeleton && !suggestionsError && sorted.length === 0 && (
        <div className="text-sm text-muted-foreground">Aucune suggestion pour cette note.</div>
      )}

      {!showSkeleton && !suggestionsError && sorted.length > 0 && (
        <div className="space-y-3">
          {sorted.map((s) => {
            const suggestionId = s.id ?? s.dedupeKey;
            const isBusy = !!suggestionId && busySuggestionId === suggestionId;

            const isBundle = s.kind === "create_task_bundle";
            const isContent =
              s.kind === "generate_summary" ||
              s.kind === "rewrite_note" ||
              s.kind === "generate_hook" ||
              s.kind === "extract_key_points" ||
              s.kind === "tag_entities";
            const payload = s.payload;
            const dueLabel = s.kind === "create_task" && "dueDate" in payload ? formatTs(payload.dueDate ?? null) : "";
            const remindLabel = s.kind === "create_reminder" && "remindAt" in payload ? formatTs(payload.remindAt ?? null) : "";
            const expired = s.status === "expired";

            const bundleTasks = isBundle && "tasks" in payload ? payload.tasks : [];
            const isBundleExpanded = expandedBundleSuggestionId === (suggestionId ?? null);

            const handleAcceptClick = () => {
              if (isBundle && !isPro) {
                window.location.href = "/upgrade";
                return;
              }
              void handleAccept(s);
            };

            const handleToggleBundle = () => {
              if (!suggestionId) return;
              setExpandedBundleSuggestionId((prev) => (prev === suggestionId ? null : suggestionId));
            };

            return (
              <div key={suggestionId ?? s.dedupeKey} className="border border-border rounded-md p-3 space-y-2">
                <div className="space-y-1">
                  <div className="text-sm font-semibold">
                    {s.payload?.title}
                    {expired ? <span className="ml-2 text-xs text-muted-foreground">(expirée)</span> : null}
                  </div>
                  <div className="text-xs text-muted-foreground">{s.payload?.explanation}</div>
                  {s.payload?.origin?.fromText ? (
                    <div className="text-xs text-muted-foreground">Extrait: “{s.payload.origin.fromText}”</div>
                  ) : null}
                  {!isBundle && dueLabel ? <div className="text-xs text-muted-foreground">Échéance: {dueLabel}</div> : null}
                  {!isBundle && remindLabel ? <div className="text-xs text-muted-foreground">Rappel: {remindLabel}</div> : null}
                  {isBundle ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs text-muted-foreground">{bundleTasks.length} tâche(s)</div>
                        <button
                          type="button"
                          onClick={handleToggleBundle}
                          className="px-2 py-1 rounded-md border border-input text-xs"
                        >
                          {isBundleExpanded ? "Réduire" : "Voir"}
                        </button>
                      </div>
                      {isBundleExpanded ? (
                        <div className="text-sm">
                          <ol className="list-decimal pl-5 space-y-1">
                            {bundleTasks.slice(0, 6).map((t, idx) => (
                              <li key={`${suggestionId ?? "bundle"}_${idx}`}>{typeof t?.title === "string" ? t.title : ""}</li>
                            ))}
                          </ol>
                          {!isPro ? (
                            <div className="mt-2 text-xs text-muted-foreground">Disponible avec le plan Pro.</div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {isContent && s.kind === "generate_summary" ? (
                    (() => {
                      const summaryShort = (payload as any)?.summaryShort;
                      const structured = Array.isArray((payload as any)?.summaryStructured) ? ((payload as any).summaryStructured as any[]) : [];
                      return (
                        <div className="text-sm space-y-2">
                          {typeof summaryShort === "string" && summaryShort.trim() ? <div>{summaryShort}</div> : null}
                          {structured.length > 0 ? (
                            <div className="space-y-2">
                              {structured.slice(0, 6).map((sec, idx) => {
                                const title = typeof sec?.title === "string" ? sec.title : "";
                                const bullets = Array.isArray(sec?.bullets) ? (sec.bullets as any[]) : [];
                                if (!title && bullets.length === 0) return null;
                                return (
                                  <div key={`sum_${suggestionId ?? "x"}_${idx}`}>
                                    {title ? <div className="font-medium">{title}</div> : null}
                                    {bullets.length > 0 ? (
                                      <ul className="list-disc pl-5">
                                        {bullets.slice(0, 8).map((b, j) => (
                                          <li key={`sum_${suggestionId ?? "x"}_${idx}_${j}`}>{typeof b === "string" ? b : ""}</li>
                                        ))}
                                      </ul>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    })()
                  ) : null}

                  {isContent && s.kind === "extract_key_points" ? (
                    (() => {
                      const keyPoints = Array.isArray((payload as any)?.keyPoints) ? ((payload as any).keyPoints as any[]) : [];
                      if (keyPoints.length === 0) return null;
                      return (
                        <div className="text-sm">
                          <ul className="list-disc pl-5">
                            {keyPoints.slice(0, 10).map((p, idx) => (
                              <li key={`kp_${suggestionId ?? "x"}_${idx}`}>{typeof p === "string" ? p : ""}</li>
                            ))}
                          </ul>
                        </div>
                      );
                    })()
                  ) : null}

                  {isContent && s.kind === "generate_hook" ? (
                    (() => {
                      const hooks = Array.isArray((payload as any)?.hooks) ? ((payload as any).hooks as any[]) : [];
                      if (hooks.length === 0) return null;
                      return (
                        <div className="text-sm">
                          <ul className="list-disc pl-5">
                            {hooks.slice(0, 10).map((h, idx) => (
                              <li key={`hook_${suggestionId ?? "x"}_${idx}`}>{typeof h === "string" ? h : ""}</li>
                            ))}
                          </ul>
                        </div>
                      );
                    })()
                  ) : null}

                  {isContent && s.kind === "tag_entities" ? (
                    (() => {
                      const tags = Array.isArray((payload as any)?.tags) ? ((payload as any).tags as any[]) : [];
                      const entities = (payload as any)?.entities && typeof (payload as any).entities === "object" ? ((payload as any).entities as any) : null;
                      const hasAny = tags.length > 0 || !!entities;
                      if (!hasAny) return null;
                      return (
                        <div className="text-sm space-y-2">
                          {tags.length > 0 ? (
                            <div>
                              <div className="font-medium">Tags</div>
                              <div className="text-xs text-muted-foreground break-words">{tags.filter((t) => typeof t === "string").join(", ")}</div>
                            </div>
                          ) : null}
                          {entities ? (
                            <div>
                              <div className="font-medium">Entités</div>
                              <div className="text-xs text-muted-foreground space-y-1">
                                {Object.entries(entities).map(([k, v]) => {
                                  if (!Array.isArray(v) || v.length === 0) return null;
                                  return (
                                    <div key={`ent_${suggestionId ?? "x"}_${k}`}>
                                      {k}: {v.filter((x) => typeof x === "string").join(", ")}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })()
                  ) : null}

                  {isContent && s.kind === "rewrite_note" ? (
                    (() => {
                      const rewriteContent = typeof (payload as any)?.rewriteContent === "string" ? String((payload as any).rewriteContent) : "";
                      if (!rewriteContent.trim()) return null;
                      return (
                        <div className="space-y-2">
                          <div className="text-xs text-muted-foreground">Proposition</div>
                          <div className="border border-border rounded-md p-2 text-sm whitespace-pre-wrap">{rewriteContent}</div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void handleCopyToClipboard(rewriteContent)}
                              className="px-3 py-2 rounded-md border border-input text-sm"
                            >
                              Copier
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleReplaceNoteContent(rewriteContent)}
                              disabled={!noteId}
                              className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
                            >
                              Remplacer le contenu
                            </button>
                          </div>
                        </div>
                      );
                    })()
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleAcceptClick}
                    disabled={isBusy || expired}
                    className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                  >
                    {isBusy ? "Traitement…" : isBundle ? (isPro ? "Accepter le plan" : "Débloquer avec Pro") : "Accepter"}
                  </button>
                  {isBundle && isPro ? (
                    <button
                      type="button"
                      onClick={() => setBundleCustomizeSuggestion(s)}
                      disabled={isBusy || expired}
                      className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
                    >
                      Personnaliser
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void handleReject(s)}
                    disabled={isBusy || expired}
                    className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
                  >
                    Refuser
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(s)}
                    disabled={isBusy || expired || isBundle || isContent}
                    className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
                  >
                    Modifier
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <Modal title="Modifier la suggestion" onBeforeClose={() => { closeEdit(); }}>
          <div className="space-y-3">
            {editError && <div className="sn-alert sn-alert--error">{editError}</div>}

            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="assistant-edit-title">
                Titre
              </label>
              <input
                id="assistant-edit-title"
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="assistant-edit-date">
                {editing.kind === "create_task" ? "Échéance" : "Rappel"}
              </label>
              <input
                id="assistant-edit-date"
                type="datetime-local"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
              />
              <div className="text-xs text-muted-foreground">
                {editing.kind === "create_reminder" ? "Requis pour un rappel" : "Optionnel"}
              </div>
            </div>

            {"priority" in editing.payload && (
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="assistant-edit-priority">
                  Priorité
                </label>
                <select
                  id="assistant-edit-priority"
                  value={editPriority}
                  onChange={(e) => setEditPriority(e.target.value as "" | Priority)}
                  className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                >
                  <option value="">Aucune</option>
                  <option value="low">Basse</option>
                  <option value="medium">Moyenne</option>
                  <option value="high">Haute</option>
                </select>
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeEdit}
                className="px-3 py-2 rounded-md border border-input text-sm"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => void handleAcceptEdited()}
                disabled={busySuggestionId === (editing.id ?? editing.dedupeKey)}
                className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
              >
                Accepter avec modifications
              </button>
            </div>
          </div>
        </Modal>
      )}

      <BundleCustomizeModal
        open={!!bundleCustomizeSuggestion}
        onClose={() => setBundleCustomizeSuggestion(null)}
        suggestion={bundleCustomizeSuggestion}
        isPro={isPro}
        loading={!!bundleCustomizeSuggestion && busySuggestionId === (bundleCustomizeSuggestion.id ?? bundleCustomizeSuggestion.dedupeKey)}
        onConfirm={handleConfirmBundleCustomize}
      />
    </div>
  );
}
