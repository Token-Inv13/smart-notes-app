"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { FirebaseError } from "firebase/app";
import { httpsCallable } from "firebase/functions";
import { doc, getDoc, onSnapshot, serverTimestamp, updateDoc, type Timestamp } from "firebase/firestore";
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

type SectionId = "capture" | "analyze" | "transform";

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
  const base = "px-3 py-2 rounded-md text-sm font-medium disabled:opacity-50";
  const styles =
    variant === "primary"
      ? "bg-primary text-primary-foreground"
      : "border border-input hover:bg-accent";

  return (
    <button
      type="button"
      className={["w-full md:w-auto", base, styles].filter(Boolean).join(" ")}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  );
}

function AssistantSection({
  id,
  title,
  icon,
  mobileCollapsible,
  open,
  setOpen,
  children,
}: {
  id: SectionId;
  title: string;
  icon?: ReactNode;
  mobileCollapsible: boolean;
  open: boolean;
  setOpen: (id: SectionId, next: boolean) => void;
  children: ReactNode;
}) {
  return (
    <section className="border border-border rounded-lg bg-card shadow-sm">
      <button
        type="button"
        className="w-full px-4 py-3 flex items-center justify-between gap-3"
        onClick={() => {
          if (!mobileCollapsible) return;
          setOpen(id, !open);
        }}
      >
        <div className="flex items-center gap-2">
          {icon}
          <div className="text-sm font-semibold">{title}</div>
        </div>
        {mobileCollapsible ? (
          <div className="text-xs text-muted-foreground">{open ? "Réduire" : "Voir"}</div>
        ) : null}
      </button>
      {open ? <div className="px-4 pb-4 space-y-3">{children}</div> : null}
    </section>
  );
}

function AssistantSkeletonCard() {
  return (
    <div className="border border-border rounded-md p-3 bg-background/40">
      <div className="sn-skeleton-line w-1/3" />
      <div className="mt-2 sn-skeleton-line w-5/6" />
      <div className="mt-2 sn-skeleton-line w-2/3" />
    </div>
  );
}

function AssistantResultCard({
  title,
  text,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  onReject,
}: {
  title: string;
  text: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel: string;
  onSecondary: () => void;
  onReject: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border rounded-lg bg-card shadow-sm p-4 space-y-3 sn-animate-in">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-semibold">{title}</div>
        <button type="button" className="sn-text-btn" onClick={onReject}>
          Refuser
        </button>
      </div>

      <div className={"text-sm whitespace-pre-wrap break-words " + (expanded ? "" : "line-clamp-6")}>
        {text}
      </div>

      <div className="flex items-center justify-between gap-3">
        <button type="button" className="sn-text-btn" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Voir moins" : "Voir plus"}
        </button>
        <div className="flex flex-col md:flex-row md:items-center gap-2 w-full md:w-auto">
          <AssistantActionButton label={primaryLabel} onClick={onPrimary} variant="primary" />
          <AssistantActionButton label={secondaryLabel} onClick={onSecondary} variant="secondary" />
        </div>
      </div>
    </div>
  );
}

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

  const [isMobile, setIsMobile] = useState(false);
  const [sectionOpen, setSectionOpen] = useState<Record<SectionId, boolean>>({
    capture: true,
    analyze: true,
    transform: true,
  });

  const [dismissedResultKeys, setDismissedResultKeys] = useState<Record<string, boolean>>({});

  const [textModal, setTextModal] = useState<{
    title: string;
    text: string;
    allowReplaceNote?: boolean;
  } | null>(null);
  const [textModalDraft, setTextModalDraft] = useState<string>("");

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
      setDismissedResultKeys({});
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

  const handleAIAnalyzeWithModes = async (modes: string[] | null) => {
    if (!noteId) return;
    if (busyAIAnalysis) return;

    setBusyAIAnalysis(true);
    setActionMessage(null);
    setActionError(null);

    try {
      const fn = httpsCallable<{ noteId: string; modes?: string[] }, { jobId: string; resultId?: string }>(
        fbFunctions,
        "assistantRequestAIAnalysis",
      );
      const payload: { noteId: string; modes?: string[] } = { noteId };
      if (Array.isArray(modes) && modes.length > 0) payload.modes = modes;
      const res = await fn(payload);
      setDismissedResultKeys({});
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

  const escapeHtml = (text: string) => {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  const plainTextToNoteHtml = (text: string) => {
    const safe = escapeHtml(text);
    const withBreaks = safe.replace(/\r\n|\n|\r/g, "<br />");
    return `<div>${withBreaks}</div>`;
  };

  const handleInsertIntoNote = async (text: string) => {
    if (!noteId) return;
    const t = (text ?? "").trim();
    if (!t) return;

    try {
      const ref = doc(db, "notes", noteId);
      const snap = await getDoc(ref);
      const existing = snap.exists() ? (snap.data() as any) : null;
      const current = typeof existing?.content === "string" ? String(existing.content) : "";
      const next = (current ? `${current}\n` : "") + plainTextToNoteHtml(t);
      await updateDoc(ref, { content: next, updatedAt: serverTimestamp() });
      setActionMessage("Texte inséré dans la note.");
    } catch (e) {
      if (e instanceof FirebaseError) setActionError(`${e.code}: ${e.message}`);
      else if (e instanceof Error) setActionError(e.message);
      else setActionError("Insertion impossible.");
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    try {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    } catch {
      mq.addListener(apply);
      return () => mq.removeListener(apply);
    }
  }, []);

  useEffect(() => {
    setSectionOpen((prev) => {
      const next: Record<SectionId, boolean> = { ...prev };
      if (isMobile) {
        next.capture = true;
        next.analyze = prev.analyze ?? false;
        next.transform = prev.transform ?? false;
      } else {
        next.capture = true;
        next.analyze = true;
        next.transform = true;
      }
      return next;
    });
  }, [isMobile]);

  const setOpen = (id: SectionId, next: boolean) => {
    setSectionOpen((prev) => ({ ...prev, [id]: next }));
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

  const suggestionGroups = useMemo(() => {
    const arr = sorted ?? [];
    const tasks = arr.filter((s) => s.kind === "create_task" || s.kind === "create_reminder" || s.kind === "update_task_meta");
    const bundles = arr.filter((s) => s.kind === "create_task_bundle");
    const content = arr.filter(
      (s) =>
        s.kind === "generate_summary" ||
        s.kind === "extract_key_points" ||
        s.kind === "generate_hook" ||
        s.kind === "tag_entities" ||
        s.kind === "rewrite_note",
    );
    return { tasks, bundles, content };
  }, [sorted]);

  const renderSuggestionCard = (s: AssistantSuggestionDoc) => {
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
      <div key={suggestionId ?? s.dedupeKey} className="border border-border rounded-lg bg-card shadow-sm p-4 space-y-3 sn-animate-in">
        <div className="space-y-1">
          <div className="text-sm font-semibold">
            {s.payload?.title}
            {expired ? <span className="ml-2 text-xs text-muted-foreground">(expirée)</span> : null}
          </div>
          <div className="text-xs text-muted-foreground line-clamp-6">{s.payload?.explanation}</div>
          {s.payload?.origin?.fromText ? (
            <div className="text-xs text-muted-foreground line-clamp-3">Extrait: “{s.payload.origin.fromText}”</div>
          ) : null}
          {!isBundle && dueLabel ? <div className="text-xs text-muted-foreground">Échéance: {dueLabel}</div> : null}
          {!isBundle && remindLabel ? <div className="text-xs text-muted-foreground">Rappel: {remindLabel}</div> : null}
        </div>

        {isBundle ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-muted-foreground">{bundleTasks.length} tâche(s)</div>
              <button type="button" onClick={handleToggleBundle} className="px-2 py-1 rounded-md border border-input text-xs">
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
                {!isPro ? <div className="mt-2 text-xs text-muted-foreground">Disponible avec le plan Pro.</div> : null}
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
                {typeof summaryShort === "string" && summaryShort.trim() ? <div className="line-clamp-6">{summaryShort}</div> : null}
                {structured.length > 0 ? (
                  <div className="space-y-2">
                    {structured.slice(0, 3).map((sec, idx) => {
                      const title = typeof sec?.title === "string" ? sec.title : "";
                      const bullets = Array.isArray(sec?.bullets) ? (sec.bullets as any[]) : [];
                      if (!title && bullets.length === 0) return null;
                      return (
                        <div key={`sum_${suggestionId ?? "x"}_${idx}`}>
                          {title ? <div className="font-medium">{title}</div> : null}
                          {bullets.length > 0 ? (
                            <ul className="list-disc pl-5">
                              {bullets.slice(0, 4).map((b, j) => (
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
                  {keyPoints.slice(0, 8).map((p, idx) => (
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
                  {hooks.slice(0, 8).map((h, idx) => (
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
                    <div className="text-xs text-muted-foreground break-words line-clamp-3">
                      {tags.filter((t) => typeof t === "string").join(", ")}
                    </div>
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
                <div className="border border-border rounded-md p-2 text-sm whitespace-pre-wrap line-clamp-6">{rewriteContent}</div>
                <div className="flex flex-col md:flex-row md:items-center gap-2">
                  <button type="button" onClick={() => void handleCopyToClipboard(rewriteContent)} className="px-3 py-2 rounded-md border border-input text-sm">
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

        <div className="flex flex-col md:flex-row md:items-center gap-2">
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
  };

  const aiCards = useMemo(() => {
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
  }, [aiResult]);

  return (
    <div className="sn-card p-4 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">Assistant</div>
        <button type="button" onClick={handleRefresh} className="px-3 py-2 rounded-md border border-input text-sm hover:bg-accent">
          Rafraîchir
        </button>
      </div>

      {actionMessage && <div className="sn-alert">{actionMessage}</div>}
      {actionError && <div className="sn-alert sn-alert--error">{actionError}</div>}

      <div className="space-y-5">
        <AssistantSection
          id="capture"
          title="Capture"
          mobileCollapsible={isMobile}
          open={sectionOpen.capture}
          setOpen={setOpen}
        >
          <div className="space-y-3">
            <div>
              <VoiceRecorderButton noteId={noteId} mode="append_to_note" />
            </div>
            <div className="flex flex-col md:flex-row md:items-center gap-2">
              <AssistantActionButton
                label={busyAIAnalysis ? "Améliorer…" : "Améliorer le texte"}
                onClick={() => void handleAIAnalyzeWithModes(["rewrite"]) }
                disabled={!noteId || busyAIAnalysis}
                variant="secondary"
              />
            </div>
          </div>
        </AssistantSection>

        <AssistantSection
          id="analyze"
          title="Analyser"
          icon={<Sparkles size={16} className="opacity-70" />}
          mobileCollapsible={isMobile}
          open={sectionOpen.analyze}
          setOpen={setOpen}
        >
          <div className="flex flex-col md:flex-row md:items-center gap-2">
            <AssistantActionButton
              label={busyAIAnalysis ? "Résumé…" : "Résumer"}
              onClick={() => void handleAIAnalyzeWithModes(["summary"]) }
              disabled={!noteId || busyAIAnalysis}
              variant="secondary"
            />
            <AssistantActionButton
              label={busyAIAnalysis ? "Extraction…" : "Extraire tâches"}
              onClick={() => void handleAIAnalyzeWithModes(["actions"]) }
              disabled={!noteId || busyAIAnalysis}
              variant="secondary"
            />
            <AssistantActionButton
              label={busyAIAnalysis ? "Structuration…" : "Structurer"}
              onClick={() => void handleAIAnalyzeWithModes(["entities"]) }
              disabled={!noteId || busyAIAnalysis}
              variant="secondary"
            />
          </div>

          {aiJobStatus === "queued" || aiJobStatus === "processing" ? (
            <div className="space-y-2">
              <AssistantSkeletonCard />
              <AssistantSkeletonCard />
            </div>
          ) : null}

          {aiJobStatus === "error" ? (
            <div className="sn-alert sn-alert--error">
              <div>Analyse IA en erreur.</div>
              {aiModelAccessError ? (
                <div className="text-xs opacity-90 break-words mt-1">
                  Modèle non autorisé pour ce projet OpenAI.
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
          ) : null}

          {aiCards.length > 0 ? (
            <div className="space-y-3">
              {aiCards
                .filter((c) => !dismissedResultKeys[c.key])
                .map((c) => (
                  <AssistantResultCard
                    key={c.key}
                    title={c.title}
                    text={c.text}
                    primaryLabel={"Insérer"}
                    onPrimary={() => {
                      if (c.allowReplaceNote) {
                        void handleReplaceNoteContent(c.text);
                        return;
                      }
                      void handleInsertIntoNote(c.text);
                    }}
                    secondaryLabel="Modifier"
                    onSecondary={() => {
                      setTextModal({ title: c.title, text: c.text, allowReplaceNote: c.allowReplaceNote });
                      setTextModalDraft(c.text);
                    }}
                    onReject={() => setDismissedResultKeys((prev) => ({ ...prev, [c.key]: true }))}
                  />
                ))}
            </div>
          ) : aiJobStatus !== "queued" && aiJobStatus !== "processing" ? (
            <div className="text-sm text-muted-foreground">Aucun résultat pour le moment.</div>
          ) : null}
        </AssistantSection>

        <AssistantSection
          id="transform"
          title="Transformer"
          mobileCollapsible={isMobile}
          open={sectionOpen.transform}
          setOpen={setOpen}
        >
          <div className="flex flex-col md:flex-row md:items-center gap-2">
            <AssistantActionButton
              label={busyReanalysis ? "Création…" : cooldownActive ? "Créer tâches (cooldown)" : "Créer tâches"}
              onClick={() => void handleReanalyze()}
              disabled={!noteId || busyReanalysis || cooldownActive}
              variant="primary"
            />
            <AssistantActionButton
              label="Créer todo"
              onClick={() => {
                window.location.href = "/todo/new";
              }}
              disabled={false}
              variant="secondary"
            />
            <AssistantActionButton
              label={busyAIAnalysis ? "Optimiser…" : "Optimiser texte"}
              onClick={() => void handleAIAnalyzeWithModes(["rewrite"]) }
              disabled={!noteId || busyAIAnalysis}
              variant="secondary"
            />
          </div>

          {jobStatus === "queued" || jobStatus === "processing" ? (
            <div className="space-y-2">
              <AssistantSkeletonCard />
            </div>
          ) : null}
          {jobStatus === "error" ? <div className="sn-alert sn-alert--error">Réanalyse en erreur.</div> : null}
          {doneBannerMessage && <div className="sn-alert">{doneBannerMessage}</div>}

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
                  <button type="button" onClick={handleRefresh} className="px-3 py-2 rounded-md border border-input text-sm">
                    Rafraîchir
                  </button>
                </div>
              );
            })()
          )}

          {showSkeleton ? (
            <div className="space-y-2">
              <AssistantSkeletonCard />
              <AssistantSkeletonCard />
            </div>
          ) : null}

          {!showSkeleton && !suggestionsError && suggestionGroups.tasks.length === 0 && suggestionGroups.bundles.length === 0 && suggestionGroups.content.length === 0 ? (
            <div className="text-sm text-muted-foreground">Aucune suggestion.</div>
          ) : null}

          {!showSkeleton && !suggestionsError && (suggestionGroups.tasks.length > 0 || suggestionGroups.bundles.length > 0 || suggestionGroups.content.length > 0) ? (
            <div className="space-y-3">
              {suggestionGroups.bundles.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-sm font-semibold">Plans / bundles</div>
                  <div className="space-y-3">{suggestionGroups.bundles.map(renderSuggestionCard)}</div>
                </div>
              ) : null}

              {suggestionGroups.tasks.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-sm font-semibold">Tâches</div>
                  <div className="space-y-3">{suggestionGroups.tasks.map(renderSuggestionCard)}</div>
                </div>
              ) : null}

              {suggestionGroups.content.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-sm font-semibold">Contenu</div>
                  <div className="space-y-3">{suggestionGroups.content.map(renderSuggestionCard)}</div>
                </div>
              ) : null}
            </div>
          ) : null}
        </AssistantSection>
      </div>

      {textModal ? (
        <Modal title={textModal.title} onBeforeClose={() => setTextModal(null)}>
          <div className="space-y-3">
            <label htmlFor="assistant-text-modal" className="sr-only">
              Texte
            </label>
            <textarea
              id="assistant-text-modal"
              aria-label="Texte"
              value={textModalDraft}
              onChange={(e) => setTextModalDraft(e.target.value)}
              className="w-full min-h-[180px] px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
            />
            <div className="flex flex-col md:flex-row md:items-center justify-end gap-2">
              <button type="button" onClick={() => setTextModal(null)} className="px-3 py-2 rounded-md border border-input text-sm">
                Fermer
              </button>
              <button
                type="button"
                onClick={() => void handleCopyToClipboard(textModalDraft)}
                className="px-3 py-2 rounded-md border border-input text-sm"
              >
                Copier
              </button>
              {textModal.allowReplaceNote ? (
                <button
                  type="button"
                  onClick={() => void handleReplaceNoteContent(textModalDraft)}
                  disabled={!noteId}
                  className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                >
                  Remplacer la note
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
