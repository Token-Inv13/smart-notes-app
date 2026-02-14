"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FirebaseError } from "firebase/app";
import { httpsCallable } from "firebase/functions";
import { doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
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
  currentNoteContent?: string;
};

function AssistantActionButton({
  label,
  onClick,
  disabled,
  variant,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
}) {
  const base = "px-2.5 py-1.5 rounded-md text-xs md:text-sm font-medium whitespace-nowrap disabled:opacity-50 transition-colors";
  const styles =
    variant === "primary"
      ? "bg-primary text-primary-foreground"
      : "border border-input bg-background hover:bg-accent";

  return (
    <button
      type="button"
      className={["w-auto", base, styles].filter(Boolean).join(" ")}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  );
}

export default function AssistantNotePanel({ noteId, currentNoteContent }: Props) {
  const { user } = useAuth();
  const {
    data: assistantSettings,
    loading: assistantLoading,
    error: assistantError,
    refetch: refetchAssistant,
  } = useAssistantSettings();
  const enabled = assistantSettings?.enabled === true;
  const isPro = assistantSettings?.plan === "pro";

  const {
    data: suggestions,
    loading: suggestionsLoading,
    error: suggestionsError,
    refetch: refetchSuggestions,
  } = useNoteAssistantSuggestions(noteId, { limit: 10, includeExpired: false });

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
  const [aiResult, setAIResult] = useState<AssistantAIResultDoc | null>(null);
  const [busyAIAnalysis, setBusyAIAnalysis] = useState(false);

  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [advancedActionsOpen, setAdvancedActionsOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState<Record<"structure" | "clarity" | "content", boolean>>({
    structure: false,
    clarity: false,
    content: false,
  });
  const [pendingPreviewAction, setPendingPreviewAction] = useState<string | null>(null);

  const [textModal, setTextModal] = useState<{
    title: string;
    text: string;
    originalText?: string;
    allowReplaceNote?: boolean;
  } | null>(null);
  const [textModalDraft, setTextModalDraft] = useState<string>("");

  const [editing, setEditing] = useState<AssistantSuggestionDoc | null>(null);
  const [editTitle, setEditTitle] = useState<string>("");
  const [editDate, setEditDate] = useState<string>("");
  const [editPriority, setEditPriority] = useState<"" | Priority>("");
  const [editError, setEditError] = useState<string | null>(null);

  const [bundleCustomizeSuggestion, setBundleCustomizeSuggestion] = useState<AssistantSuggestionDoc | null>(null);
  const previewTextareaRef = useRef<HTMLTextAreaElement | null>(null);

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

        setAIJobStatus(nextStatus ?? null);
        setAIJobResultId(nextResultId);
        setAIJobError(nextError);
      },
      () => {
        setAIJobStatus(null);
        setAIJobResultId(null);
        setAIJobError(null);
      },
    );

    return () => {
      unsub();
    };
  }, [enabled, noteId, user?.uid]);

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

  const handleAIAnalyzeWithModes = async (modes: string[] | null, rewriteInstruction?: string | null, actionLabel?: string) => {
    if (!noteId) return;
    if (busyAIAnalysis) return;

    const expectsRewrite =
      (Array.isArray(modes) && modes.includes("rewrite")) || (typeof rewriteInstruction === "string" && rewriteInstruction.trim().length > 0);

    setBusyAIAnalysis(true);
    setActionMessage(null);
    setActionError(null);
    setPendingPreviewAction(expectsRewrite ? actionLabel || "Transformation" : null);

    try {
      const fn = httpsCallable<{ noteId: string; modes?: string[]; rewriteInstruction?: string }, { jobId: string; resultId?: string }>(
        fbFunctions,
        "assistantRequestAIAnalysis",
      );
      const payload: { noteId: string; modes?: string[]; rewriteInstruction?: string } = { noteId };
      if (Array.isArray(modes) && modes.length > 0) payload.modes = modes;
      const instruction = typeof rewriteInstruction === "string" ? rewriteInstruction.trim() : "";
      if (instruction) payload.rewriteInstruction = instruction;
      const res = await fn(payload);
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
      setTextModal(null);
    } catch (e) {
      if (e instanceof FirebaseError) setActionError(`${e.code}: ${e.message}`);
      else if (e instanceof Error) setActionError(e.message);
      else setActionError("Impossible de remplacer le contenu.");
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
    if (s.kind === "rewrite_note") {
      openSuggestionModify(s);
      return;
    }

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

  const openEdit = (s: AssistantSuggestionDoc) => {
    if (s.kind !== "create_task" && s.kind !== "create_reminder") return;
    setEditing(s);
    setEditError(null);
    const payload = s.payload;
    const payloadObj = payload && typeof payload === "object" ? (payload as any) : null;
    setEditTitle(typeof payloadObj?.title === "string" ? String(payloadObj.title) : "");
    if (s.kind === "create_task") {
      setEditDate(payloadObj && "dueDate" in payloadObj ? formatTimestampForInput(payloadObj.dueDate ?? null) : "");
    } else {
      setEditDate(payloadObj && "remindAt" in payloadObj ? formatTimestampForInput(payloadObj.remindAt ?? null) : "");
    }
    const p = payloadObj && "priority" in payloadObj ? payloadObj.priority : undefined;
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

    const editingPayloadObj = editing.payload && typeof editing.payload === "object" ? (editing.payload as any) : null;
    if (editingPayloadObj && "priority" in editingPayloadObj) {
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

  const getSuggestionCategory = (s: AssistantSuggestionDoc): "structure" | "clarity" | "content" => {
    if (s.kind === "rewrite_note" || s.kind === "tag_entities" || s.kind === "create_task_bundle") return "structure";
    if (s.kind === "generate_summary" || s.kind === "extract_key_points" || s.kind === "generate_hook" || s.kind === "update_task_meta") {
      return "clarity";
    }
    return "content";
  };

  const suggestionGroups = (() => {
    const grouped: Record<"structure" | "clarity" | "content", AssistantSuggestionDoc[]> = {
      structure: [],
      clarity: [],
      content: [],
    };
    for (const s of sorted) {
      grouped[getSuggestionCategory(s)].push(s);
    }
    return grouped;
  })();

  const visibleSuggestionsCount = suggestionsLoading || suggestionsError
    ? 0
    : suggestionGroups.structure.length + suggestionGroups.clarity.length + suggestionGroups.content.length;

  const openSuggestionModify = (s: AssistantSuggestionDoc) => {
    if (s.kind === "create_task" || s.kind === "create_reminder") {
      openEdit(s);
      return;
    }
    if (s.kind === "create_task_bundle") {
      if (!isPro) {
        window.location.href = "/upgrade";
        return;
      }
      setBundleCustomizeSuggestion(s);
      return;
    }
    if (s.kind === "rewrite_note") {
      const payloadObj = s.payload && typeof s.payload === "object" ? (s.payload as any) : null;
      const rewriteContent = typeof payloadObj?.rewriteContent === "string" ? String(payloadObj.rewriteContent) : "";
      if (!rewriteContent.trim()) return;
      setTextModal({ title: "Prévisualisation avant remplacement", text: rewriteContent, originalText: currentNoteContent ?? "", allowReplaceNote: true });
      setTextModalDraft(rewriteContent);
    }
  };

  const renderSuggestionPreview = (s: AssistantSuggestionDoc) => {
    const payloadObj = s.payload && typeof s.payload === "object" ? (s.payload as any) : null;
    const explanation = typeof payloadObj?.explanation === "string" ? String(payloadObj.explanation).trim() : "";
    const title = typeof payloadObj?.title === "string" ? String(payloadObj.title).trim() : "";
    const rewriteContent = typeof payloadObj?.rewriteContent === "string" ? String(payloadObj.rewriteContent).trim() : "";
    if (explanation) return explanation;
    if (rewriteContent) return rewriteContent;
    return title || "Suggestion prête à appliquer.";
  };

  const renderSuggestionCard = (s: AssistantSuggestionDoc) => {
    const suggestionId = s.id ?? s.dedupeKey;
    const isBusy = !!suggestionId && busySuggestionId === suggestionId;
    const expired = s.status === "expired";
    const canModify = s.kind === "create_task" || s.kind === "create_reminder" || s.kind === "create_task_bundle" || s.kind === "rewrite_note";

    return (
      <div key={suggestionId ?? s.dedupeKey} className="border border-border rounded-md bg-card p-2.5 space-y-2">
        <div className="space-y-1">
          <div className="text-sm font-medium leading-snug">
            {s.payload?.title || "Suggestion"}
            {expired ? <span className="ml-2 text-[11px] text-muted-foreground">(expirée)</span> : null}
          </div>
          <div className="text-[11px] text-muted-foreground line-clamp-3">{renderSuggestionPreview(s)}</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              if (s.kind === "create_task_bundle" && !isPro) {
                window.location.href = "/upgrade";
                return;
              }
              void handleAccept(s);
            }}
            disabled={isBusy || expired}
            className="px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-[11px] font-medium disabled:opacity-50"
          >
            {isBusy ? "Application…" : s.kind === "rewrite_note" ? "Prévisualiser" : "Appliquer"}
          </button>
          <button
            type="button"
            onClick={() => openSuggestionModify(s)}
            disabled={!canModify || isBusy || expired}
            className="px-2.5 py-1 rounded-md border border-input text-[11px] disabled:opacity-50"
          >
            Modifier
          </button>
        </div>
      </div>
    );
  };

  const aiCards = (() => {
    if (!aiResult) return [] as Array<{ key: string; title: string; text: string; allowReplaceNote?: boolean }>;
    const out = (aiResult as any)?.output ?? null;
    const refusal = typeof (aiResult as any)?.refusal === "string" ? String((aiResult as any).refusal) : "";
    if (refusal) {
      return [{ key: `refusal_${aiResult.id ?? "x"}`, title: "Refus", text: refusal }];
    }

    const summaryShort = typeof out?.summaryShort === "string" ? String(out.summaryShort) : "";
    const summaryStructured = Array.isArray(out?.summaryStructured) ? (out.summaryStructured as any[]) : [];
    const keyPoints = Array.isArray(out?.keyPoints) ? (out.keyPoints as any[]) : [];
    const hooks = Array.isArray(out?.hooks) ? (out.hooks as any[]) : [];
    const tags = Array.isArray(out?.tags) ? (out.tags as any[]) : [];
    const entities = out?.entities && typeof out.entities === "object" ? (out.entities as any) : null;
    const rewriteContent = typeof out?.rewriteContent === "string" ? String(out.rewriteContent) : "";

    const cards: Array<{ key: string; title: string; text: string; allowReplaceNote?: boolean }> = [];

    if (summaryShort.trim()) {
      cards.push({ key: `summary_${aiResult.id ?? "x"}`, title: "Résumé", text: summaryShort });
    }

    if (summaryStructured.length > 0) {
      const lines: string[] = [];
      for (const sec of summaryStructured) {
        const title = typeof sec?.title === "string" ? sec.title : "";
        const bullets = Array.isArray(sec?.bullets) ? (sec.bullets as any[]) : [];
        if (title) lines.push(title);
        for (const b of bullets) {
          if (typeof b === "string" && b.trim()) lines.push(`- ${b}`);
        }
        if ((title || bullets.length > 0) && lines.length > 0) lines.push("");
      }
      const txt = lines.join("\n").trim();
      if (txt) cards.push({ key: `plan_${aiResult.id ?? "x"}`, title: "Plan d’action", text: txt });
    }

    if (keyPoints.length > 0) {
      const txt = keyPoints.filter((x) => typeof x === "string").slice(0, 50).map((x) => `- ${x}`).join("\n");
      if (txt.trim()) cards.push({ key: `keypoints_${aiResult.id ?? "x"}`, title: "Points clés", text: txt });
    }

    if (hooks.length > 0) {
      const txt = hooks.filter((x) => typeof x === "string").slice(0, 50).map((x) => `- ${x}`).join("\n");
      if (txt.trim()) cards.push({ key: `hooks_${aiResult.id ?? "x"}`, title: "Hooks", text: txt });
    }

    if (tags.length > 0 || entities) {
      const lines: string[] = [];
      if (tags.length > 0) {
        lines.push(`Tags: ${tags.filter((t) => typeof t === "string").join(", ")}`);
      }
      if (entities) {
        for (const [k, v] of Object.entries(entities)) {
          if (!Array.isArray(v) || v.length === 0) continue;
          const joined = (v as any[]).filter((x) => typeof x === "string").join(", ");
          if (joined) lines.push(`${k}: ${joined}`);
        }
      }
      const txt = lines.join("\n").trim();
      if (txt) cards.push({ key: `struct_${aiResult.id ?? "x"}`, title: "Structuration", text: txt });
    }

    if (rewriteContent.trim()) {
      cards.push({
        key: `rewrite_${aiResult.id ?? "x"}`,
        title: "Optimisation du texte",
        text: rewriteContent,
        allowReplaceNote: true,
      });
    }

    return cards;
  })();

  const aiOverviewText = (() => {
    const summaryCard = aiCards.find((c) => c.title === "Résumé");
    if (summaryCard?.text?.trim()) return summaryCard.text.trim();
    if (doneBannerMessage) return doneBannerMessage;
    if (aiJobStatus === "processing" || aiJobStatus === "queued") return "Analyse IA en cours.";
    if (visibleSuggestionsCount === 0) return "Pas d’amélioration détectée pour le moment.";
    return `${visibleSuggestionsCount} amélioration(s) détectée(s).`;
  })();

  const aiRecommendations = (() => {
    const list: string[] = [];
    if (suggestionGroups.structure.length > 0) list.push("Clarifier la structure globale de la note.");
    if (suggestionGroups.clarity.length > 0) list.push("Améliorer la lisibilité et la formulation.");
    if (suggestionGroups.content.length > 0) list.push("Compléter le contenu avec actions et éléments concrets.");
    return list.slice(0, 3);
  })();

  useEffect(() => {
    if (!pendingPreviewAction) return;
    const rewriteCard = aiCards.find((card) => card.allowReplaceNote && card.text.trim().length > 0);
    if (!rewriteCard) {
      if (aiJobStatus === "done" || aiJobStatus === "error") {
        setPendingPreviewAction(null);
      }
      return;
    }

    setTextModal({
      title: `Prévisualisation · ${pendingPreviewAction}`,
      text: rewriteCard.text,
      originalText: currentNoteContent ?? "",
      allowReplaceNote: true,
    });
    setTextModalDraft(rewriteCard.text);
    setPendingPreviewAction(null);
  }, [aiCards, aiJobStatus, currentNoteContent, pendingPreviewAction]);

  return (
    <>
      <div className="h-full border border-border rounded-xl bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 shadow-sm p-3 md:p-4 space-y-3 overflow-y-auto">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">Assistant IA</div>
          <button type="button" onClick={() => setSuggestionsOpen((v) => !v)} className="px-2 py-1 rounded-md border border-input text-[11px]">
            {suggestionsOpen ? "Masquer les suggestions" : "Voir les suggestions"}
          </button>
        </div>

        {actionMessage ? <div className="sn-alert">{actionMessage}</div> : null}
        {actionError ? <div className="sn-alert sn-alert--error">{actionError}</div> : null}

        <section className="space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Actions principales</div>
          <div className="flex flex-wrap gap-1.5">
            <AssistantActionButton
              label={busyAIAnalysis ? "Résumé…" : "Résumer"}
              onClick={() => void handleAIAnalyzeWithModes(["summary"], null, "Résumé")}
              disabled={!noteId || busyAIAnalysis}
              variant="secondary"
            />
            <AssistantActionButton
              label={busyAIAnalysis ? "Amélioration…" : "Améliorer"}
              onClick={() => void handleAIAnalyzeWithModes(["rewrite"], null, "Amélioration")}
              disabled={!noteId || busyAIAnalysis}
              variant="secondary"
            />
            <AssistantActionButton
              label={busyReanalysis ? "Création…" : "Créer tâches"}
              onClick={() => void handleReanalyze()}
              disabled={!noteId || busyReanalysis || cooldownActive}
              variant="primary"
            />
            <button
              type="button"
              onClick={() => setAdvancedActionsOpen((v) => !v)}
              className="px-2 py-1 rounded-md border border-input text-[11px] whitespace-nowrap"
            >
              {advancedActionsOpen ? "Masquer avancé" : "Actions avancées"}
            </button>
          </div>
        </section>

        {advancedActionsOpen ? (
          <section className="border border-border rounded-lg p-2 space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Transformations (preview obligatoire)</div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() =>
                  void handleAIAnalyzeWithModes(["rewrite"], "Traduis le texte en anglais de façon naturelle, fidèle au sens, sans ajouter d'informations.", "Traduction")
                }
                disabled={!noteId || busyAIAnalysis}
                className="px-2 py-1 rounded-md border border-input text-[11px] whitespace-nowrap disabled:opacity-50"
              >
                Traduction
              </button>
              <button
                type="button"
                onClick={() =>
                  void handleAIAnalyzeWithModes(["rewrite"], "Corrige l'orthographe, la grammaire et la ponctuation en français. Conserve le fond et le ton.", "Correction")
                }
                disabled={!noteId || busyAIAnalysis}
                className="px-2 py-1 rounded-md border border-input text-[11px] whitespace-nowrap disabled:opacity-50"
              >
                Correction
              </button>
              <button
                type="button"
                onClick={() =>
                  void handleAIAnalyzeWithModes(
                    ["summary", "entities", "rewrite"],
                    "Réécris le texte en le structurant avec des sections claires, des transitions nettes et une meilleure lisibilité.",
                    "Structuration",
                  )
                }
                disabled={!noteId || busyAIAnalysis}
                className="px-2 py-1 rounded-md border border-input text-[11px] whitespace-nowrap disabled:opacity-50"
              >
                Structurer
              </button>
              <button
                type="button"
                onClick={() =>
                  void handleAIAnalyzeWithModes(["rewrite"], "Reformule en style professionnel, clair, factuel et orienté action.", "Reformulation pro")
                }
                disabled={!noteId || busyAIAnalysis}
                className="px-2 py-1 rounded-md border border-input text-[11px] whitespace-nowrap disabled:opacity-50"
              >
                Reformuler (pro)
              </button>
            </div>
            <VoiceRecorderButton noteId={noteId} mode="append_to_note" showInternalActions={false} showTranscript={false} />
          </section>
        ) : null}

        <section className="border border-border rounded-lg bg-background/60 p-2.5 space-y-1.5">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Synthèse</div>
          <div className="text-sm leading-relaxed">{aiOverviewText}</div>
          {aiRecommendations.length > 0 ? (
            <ul className="text-[11px] text-muted-foreground list-disc pl-4 space-y-0.5">
              {aiRecommendations.map((item, idx) => (
                <li key={`rec_${idx}`}>{item}</li>
              ))}
            </ul>
          ) : null}
        </section>

        {suggestionsOpen ? (
          <section className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Suggestions</div>
            {(["structure", "clarity", "content"] as const).map((cat) => {
              const items = suggestionGroups[cat];
              const title = cat === "structure" ? "Structure" : cat === "clarity" ? "Clarté" : "Contenu";
              const isOpen = categoryOpen[cat];
              return (
                <div key={cat} className="border border-border rounded-lg bg-card">
                  <button
                    type="button"
                    className="w-full flex items-center justify-between gap-3 px-3 py-1.5 text-sm"
                    onClick={() => setCategoryOpen((prev) => ({ ...prev, [cat]: !prev[cat] }))}
                  >
                    <span>{title}</span>
                    <span className="text-[11px] text-muted-foreground">{items.length} · {isOpen ? "Masquer" : "Voir"}</span>
                  </button>
                  {isOpen ? (
                    <div className="px-3 pb-2.5 space-y-1.5">
                      {items.length === 0 ? <div className="text-[11px] text-muted-foreground">Aucune amélioration détectée.</div> : null}
                      {items.map(renderSuggestionCard)}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </section>
        ) : null}

        {aiJobStatus === "queued" || aiJobStatus === "processing" || jobStatus === "queued" || jobStatus === "processing" ? (
          <div className="text-xs text-muted-foreground">En cours…</div>
        ) : null}
        {aiJobStatus === "error" ? <div className="text-xs text-destructive">Analyse IA en erreur{aiJobError ? `: ${aiJobError}` : ""}.</div> : null}
        {jobStatus === "error" ? <div className="text-xs text-destructive">Réanalyse en erreur.</div> : null}
        {doneBannerMessage ? <div className="text-xs text-muted-foreground">{doneBannerMessage}</div> : null}
      </div>

      {textModal ? (
        <Modal title={textModal.title} onBeforeClose={() => setTextModal(null)}>
          <div className="space-y-3">
            {textModal.originalText ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Avant</div>
                  <textarea
                    aria-label="Texte original"
                    value={textModal.originalText}
                    readOnly
                    className="w-full min-h-[180px] px-3 py-2 border border-input rounded-md bg-muted/30 text-foreground text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Après (modifiable)</div>
                  <textarea
                    id="assistant-text-modal"
                    aria-label="Proposition IA"
                    ref={previewTextareaRef}
                    value={textModalDraft}
                    onChange={(e) => setTextModalDraft(e.target.value)}
                    className="w-full min-h-[180px] px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                  />
                </div>
              </div>
            ) : (
              <textarea
                id="assistant-text-modal"
                aria-label="Proposition IA"
                ref={previewTextareaRef}
                value={textModalDraft}
                onChange={(e) => setTextModalDraft(e.target.value)}
                className="w-full min-h-[180px] px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
              />
            )}
            <div className="flex flex-col md:flex-row md:items-center justify-end gap-2">
              <button type="button" onClick={() => setTextModal(null)} className="px-3 py-2 rounded-md border border-input text-sm">
                Annuler
              </button>
              <button
                type="button"
                onClick={() => {
                  previewTextareaRef.current?.focus();
                }}
                className="px-3 py-2 rounded-md border border-input text-sm"
              >
                Modifier manuellement
              </button>
              {textModal.allowReplaceNote ? (
                <button
                  type="button"
                  onClick={() => void handleReplaceNoteContent(textModalDraft)}
                  disabled={!noteId}
                  className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                >
                  Remplacer le contenu
                </button>
              ) : null}
            </div>
          </div>
        </Modal>
      ) : null}

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

            {editing.payload && typeof editing.payload === "object" && "priority" in (editing.payload as any) && (
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
    </>
  );
}
