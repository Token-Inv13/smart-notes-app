"use client";

import { useMemo, useState } from "react";
import { doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions as fbFunctions } from "@/lib/firebase";
import { useAssistantSettings } from "@/hooks/useAssistantSettings";
import { useUserAssistantSuggestions } from "@/hooks/useUserAssistantSuggestions";
import { useUserSettings } from "@/hooks/useUserSettings";
import { invalidateAuthSession, isAuthInvalidError } from "@/lib/authInvalidation";
import { sanitizeAssistantText } from "@/lib/assistantText";
import { toUserErrorMessage } from "@/lib/userError";
import type { AssistantSuggestionDoc } from "@/types/firestore";

const CONSENT_VERSION = 1;

type SuggestionPayload = {
  title?: unknown;
  explanation?: unknown;
  origin?: {
    fromText?: unknown;
    [key: string]: unknown;
  };
  tasks?: Array<{ title?: unknown; [key: string]: unknown }>;
  dueDate?: unknown;
  remindAt?: unknown;
  [key: string]: unknown;
};

function toMillisSafe(ts: unknown) {
  const maybe = ts as { toMillis?: () => number };
  if (maybe && typeof maybe.toMillis === "function") return maybe.toMillis();
  return 0;
}

function formatTs(ts: unknown) {
  const maybe = ts as { toDate?: () => Date };
  if (!maybe || typeof maybe.toDate !== "function") return "";
  try {
    return maybe.toDate().toLocaleString();
  } catch {
    return "";
  }
}

function presetLabel(preset: unknown): string {
  if (preset === "dont_forget") return "Ne rien oublier / suivi";
  if (preset === "meetings") return "Réunions & décisions";
  if (preset === "projects") return "Projets (pilotage)";
  return "Planifier ma journée";
}

function proactivityLabel(mode: unknown): string {
  if (mode === "proactive") return "Proactif (C)";
  if (mode === "suggestions") return "Suggestions (B)";
  return "Off";
}

function kindWeight(kind: string | undefined, preset: unknown): number {
  const k = kind ?? "";
  const p = preset;

  if (p === "dont_forget") {
    if (k === "create_reminder") return 0;
    if (k === "create_task") return 1;
    if (k === "create_task_bundle") return 2;
    return 3;
  }

  if (p === "projects") {
    if (k === "create_task_bundle") return 0;
    if (k === "create_task") return 1;
    if (k === "create_reminder") return 2;
    return 3;
  }

  if (p === "meetings") {
    if (k === "create_task") return 0;
    if (k === "create_task_bundle") return 1;
    if (k === "create_reminder") return 2;
    return 3;
  }

  if (k === "create_task_bundle") return 0;
  if (k === "create_task") return 1;
  if (k === "create_reminder") return 2;
  return 3;
}

export default function AssistantBriefingPage() {
  const { data: assistantSettings, loading: assistantLoading, error: assistantError } = useAssistantSettings();
  const { data: suggestions, loading: suggestionsLoading, error: suggestionsError, refetch } = useUserAssistantSuggestions({ limit: 50 });
  const { data: userSettings } = useUserSettings();

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busySuggestionId, setBusySuggestionId] = useState<string | null>(null);
  const [feedbackBusySuggestionId, setFeedbackBusySuggestionId] = useState<string | null>(null);
  const [feedbackBySuggestionId, setFeedbackBySuggestionId] = useState<Record<string, "useful" | "not_useful">>({});
  const [expandedBundleId, setExpandedBundleId] = useState<string | null>(null);

  const enabled = assistantSettings?.enabled === true;
  const preset = assistantSettings?.jtbdPreset ?? "daily_planning";
  const proactivity = assistantSettings?.proactivityMode ?? "suggestions";

  const plan = useMemo(() => {
    const raw = userSettings?.plan;
    if (raw === "pro") return "pro";
    return "free";
  }, [userSettings?.plan]);

  const isPro = plan === "pro";

  const isCallableUnauthenticated = (err: unknown) => {
    if (isAuthInvalidError(err)) return true;
    const code = typeof (err as { code?: unknown })?.code === "string" ? String((err as { code?: unknown }).code) : "";
    return code.includes("unauthenticated");
  };

  type ApplySuggestionResult = {
    createdCoreObjects?: { type: string; id: string }[];
    decisionId?: string | null;
  };

  const handleEnable = async () => {
    const user = auth.currentUser;
    if (!user) return;

    setSaving(true);
    setMessage(null);

    const refDoc = doc(db, "users", user.uid, "assistantSettings", "main");

    try {
      if (!assistantSettings) {
        await setDoc(
          refDoc,
          {
            enabled: true,
            plan,
            autoAnalyze: false,
            consentVersion: CONSENT_VERSION,
            simpleMode: "balanced",
            jtbdPreset: "daily_planning",
            proactivityMode: "suggestions",
            quietHours: { start: "22:00", end: "08:00" },
            notificationBudget: { maxPerDay: 3 },
            aiPolicy: { enabled: true, minimizeData: true, allowFullContent: false },
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      } else {
        await updateDoc(refDoc, {
          enabled: true,
          plan,
          updatedAt: serverTimestamp(),
        });
      }
      setMessage("Assistant activé.");
    } catch (e) {
      if (isCallableUnauthenticated(e)) {
        void invalidateAuthSession();
        return;
      }
      setMessage("Impossible d’activer l’assistant.");
    } finally {
      setSaving(false);
    }
  };

  const handleFeedback = async (s: AssistantSuggestionDoc, useful: boolean) => {
    const suggestionId = s.id ?? s.dedupeKey;
    if (!suggestionId) return;
    if (feedbackBusySuggestionId) return;

    setFeedbackBusySuggestionId(suggestionId);
    setActionError(null);

    try {
      const fn = httpsCallable<{ suggestionId: string; useful: boolean }, { suggestionId: string; useful: boolean }>(
        fbFunctions,
        "assistantRateSuggestionFeedback",
      );
      await fn({ suggestionId, useful });
      setFeedbackBySuggestionId((prev) => ({
        ...prev,
        [suggestionId]: useful ? "useful" : "not_useful",
      }));
      setActionMessage(useful ? "Merci, noté comme utile." : "Merci, noté comme peu utile.");
    } catch (e) {
      if (isCallableUnauthenticated(e)) {
        void invalidateAuthSession();
        return;
      }
      setActionError(toUserErrorMessage(e, "Impossible d’enregistrer le feedback."));
    } finally {
      setFeedbackBusySuggestionId(null);
    }
  };

  const handleAccept = async (s: AssistantSuggestionDoc) => {
    const suggestionId = s.id ?? s.dedupeKey;
    if (!suggestionId) return;
    if (busySuggestionId) return;

    if (s.kind === "create_task_bundle" && !isPro) {
      window.location.href = "/upgrade";
      return;
    }

    setBusySuggestionId(suggestionId);
    setActionMessage(null);
    setActionError(null);

    try {
      const fn = httpsCallable<{ suggestionId: string }, ApplySuggestionResult>(fbFunctions, "assistantApplySuggestion");
      const res = await fn({ suggestionId });
      const createdCount = Array.isArray(res.data?.createdCoreObjects) ? res.data.createdCoreObjects.length : 0;
      setActionMessage(createdCount > 0 ? `Suggestion acceptée (${createdCount} objet(s) créé(s)).` : "Suggestion acceptée.");
      refetch();
    } catch (e) {
      if (isCallableUnauthenticated(e)) {
        void invalidateAuthSession();
        return;
      }
      setActionError(toUserErrorMessage(e, "Impossible d’accepter la suggestion."));
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
      const fn = httpsCallable(fbFunctions, "assistantRejectSuggestion");
      await fn({ suggestionId });
      setActionMessage("Suggestion refusée.");
      refetch();
    } catch (e) {
      if (isCallableUnauthenticated(e)) {
        void invalidateAuthSession();
        return;
      }
      setActionError(toUserErrorMessage(e, "Impossible de refuser la suggestion."));
    } finally {
      setBusySuggestionId(null);
    }
  };

  const ordered = useMemo(() => {
    const arr = (suggestions ?? []).slice();
    arr.sort((a, b) => {
      const ra = typeof a.rankScore === "number" && Number.isFinite(a.rankScore) ? a.rankScore : Number.NEGATIVE_INFINITY;
      const rb = typeof b.rankScore === "number" && Number.isFinite(b.rankScore) ? b.rankScore : Number.NEGATIVE_INFINITY;
      if (rb !== ra) return rb - ra;

      const wa = kindWeight(a.kind, preset);
      const wb = kindWeight(b.kind, preset);
      if (wa !== wb) return wa - wb;
      return toMillisSafe(b.updatedAt) - toMillisSafe(a.updatedAt);
    });
    return arr;
  }, [suggestions, preset]);

  const proposed = useMemo(() => ordered.filter((s) => s.status === "proposed"), [ordered]);

  const top3 = proposed.slice(0, 3);
  const nowCandidate = proposed[0] ?? null;
  const inbox = proposed.slice(3, 15);

  if (assistantError) {
    return <div className="sn-alert sn-alert--error">Impossible de charger l’assistant.</div>;
  }

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Assistant — Briefing</h1>
          <p className="text-sm text-muted-foreground">
            {assistantLoading ? "Chargement…" : enabled ? `JTBD: ${presetLabel(preset)} · ${proactivityLabel(proactivity)}` : "Assistant désactivé"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/assistant" className="px-3 py-2 rounded-md border border-input text-sm hover:bg-accent">
            Inbox
          </a>
          <a href="/assistant/history" className="px-3 py-2 rounded-md border border-input text-sm hover:bg-accent">
            Historique
          </a>
          <a href="/settings" className="px-3 py-2 rounded-md border border-input text-sm hover:bg-accent">
            Paramètres
          </a>
        </div>
      </div>

      {message && <div className="sn-alert">{message}</div>}
      {actionMessage && <div className="sn-alert">{actionMessage}</div>}
      {actionError && <div className="sn-alert sn-alert--error">{actionError}</div>}

      {!enabled ? (
        <div className="sn-card p-4 space-y-3">
          <div className="text-sm font-medium">Assistant désactivé</div>
          <div className="text-sm text-muted-foreground">Active l’assistant dans tes paramètres pour obtenir ton briefing.</div>
          <div className="flex flex-col md:flex-row md:items-center gap-2">
            <button
              type="button"
              onClick={() => void handleEnable()}
              disabled={assistantLoading || saving}
              className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              {saving ? "Activation…" : "Activer"}
            </button>
            <a href="/settings" className="px-3 py-2 rounded-md border border-input text-sm hover:bg-accent">
              Ouvrir les paramètres
            </a>
          </div>
        </div>
      ) : null}

      <div className="sn-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">Top 3</div>
          <div className="text-xs text-muted-foreground">
            {suggestionsLoading ? "Chargement…" : `${proposed.length} suggestion(s)`}
          </div>
        </div>

        {suggestionsError ? <div className="sn-alert sn-alert--error">Impossible de charger les suggestions.</div> : null}

        {!suggestionsLoading && !suggestionsError && top3.length === 0 ? (
          <div className="text-sm text-muted-foreground">Rien d’urgent pour le moment.</div>
        ) : null}

        <div className="space-y-3">
          {top3.map((s) => {
            const suggestionId = s.id ?? s.dedupeKey;
            const isBusy = !!suggestionId && busySuggestionId === suggestionId;
            const isFeedbackBusy = !!suggestionId && feedbackBusySuggestionId === suggestionId;
            const feedbackValue = suggestionId ? feedbackBySuggestionId[suggestionId] : undefined;

            const payload = s.payload && typeof s.payload === "object" ? (s.payload as SuggestionPayload) : null;
            const title = sanitizeAssistantText(payload?.title, "Suggestion");
            const explanation = sanitizeAssistantText(payload?.explanation);
            const excerpt = sanitizeAssistantText(payload?.origin?.fromText);

            const isBundle = s.kind === "create_task_bundle";
            const bundleTasks = isBundle && Array.isArray(payload?.tasks) ? payload.tasks : [];
            const isExpanded = !!suggestionId && expandedBundleId === suggestionId;

            const dueLabel = s.kind === "create_task" && payload?.dueDate ? formatTs(payload.dueDate) : "";
            const remindLabel = s.kind === "create_reminder" && payload?.remindAt ? formatTs(payload.remindAt) : "";

            return (
              <div key={suggestionId ?? s.dedupeKey} className="border border-border rounded-md p-3 space-y-2">
                <div className="space-y-1">
                  <div className="text-sm font-semibold">{title}</div>
                  {explanation ? <div className="text-xs text-muted-foreground whitespace-pre-line">{explanation}</div> : null}
                  {excerpt ? <div className="text-xs text-muted-foreground whitespace-pre-line">Extrait: “{excerpt}”</div> : null}
                  {dueLabel ? <div className="text-xs text-muted-foreground">Échéance: {dueLabel}</div> : null}
                  {remindLabel ? <div className="text-xs text-muted-foreground">Rappel: {remindLabel}</div> : null}

                  {isBundle ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs text-muted-foreground">{bundleTasks.length} élément(s) d’agenda</div>
                        <button
                          type="button"
                          onClick={() => {
                            if (!suggestionId) return;
                            setExpandedBundleId((prev) => (prev === suggestionId ? null : suggestionId));
                          }}
                          className="px-2 py-1 rounded-md border border-input text-xs"
                        >
                          {isExpanded ? "Réduire" : "Voir"}
                        </button>
                      </div>
                      {isExpanded ? (
                        <ol className="list-decimal pl-5 space-y-1 text-sm">
                          {bundleTasks.slice(0, 6).map((t: { title?: unknown }, idx: number) => (
                            <li key={`${suggestionId ?? "bundle"}_${idx}`}>{sanitizeAssistantText(t?.title, "Élément d’agenda")}</li>
                          ))}
                        </ol>
                      ) : null}
                      {!isPro ? <div className="text-xs text-muted-foreground">Disponible avec le plan Pro.</div> : null}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col md:flex-row md:items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleAccept(s)}
                    disabled={isBusy}
                    className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                  >
                    {isBusy ? "Traitement…" : isBundle ? (isPro ? "Accepter le plan" : "Débloquer avec Pro") : "Accepter"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleReject(s)}
                    disabled={isBusy}
                    className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
                  >
                    Refuser
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleFeedback(s, true)}
                    disabled={isFeedbackBusy}
                    className={`px-3 py-2 rounded-md border text-sm disabled:opacity-50 ${
                      feedbackValue === "useful" ? "border-primary text-primary" : "border-input"
                    }`}
                  >
                    {isFeedbackBusy ? "..." : "Utile"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleFeedback(s, false)}
                    disabled={isFeedbackBusy}
                    className={`px-3 py-2 rounded-md border text-sm disabled:opacity-50 ${
                      feedbackValue === "not_useful" ? "border-primary text-primary" : "border-input"
                    }`}
                  >
                    {isFeedbackBusy ? "..." : "Pas utile"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="sn-card p-4 space-y-2">
        <div className="text-sm font-medium">À faire maintenant</div>
        {!nowCandidate && !suggestionsLoading && !suggestionsError ? (
          <div className="text-sm text-muted-foreground">Rien à traiter.</div>
        ) : null}
        {nowCandidate ? (
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">Traiter la prochaine suggestion de ta liste.</div>
            <button
              type="button"
              onClick={() => void handleAccept(nowCandidate)}
              disabled={busySuggestionId === (nowCandidate.id ?? nowCandidate.dedupeKey)}
              className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              {busySuggestionId === (nowCandidate.id ?? nowCandidate.dedupeKey) ? "Traitement…" : "Accepter"}
            </button>
          </div>
        ) : null}
      </div>

      <div className="sn-card p-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">Inbox</div>
          <a href="/assistant" className="text-xs text-muted-foreground hover:underline">
            Voir tout
          </a>
        </div>
        {inbox.length === 0 && !suggestionsLoading && !suggestionsError ? (
          <div className="text-sm text-muted-foreground">Inbox vide.</div>
        ) : null}
        <div className="space-y-2">
          {inbox.map((s) => {
            const suggestionId = s.id ?? s.dedupeKey;
            const payload = s.payload && typeof s.payload === "object" ? (s.payload as SuggestionPayload) : null;
            const title = sanitizeAssistantText(payload?.title, "Suggestion");
            const explanation = sanitizeAssistantText(payload?.explanation);

            return (
              <div key={suggestionId ?? s.dedupeKey} className="border border-border rounded-md p-3">
                <div className="text-sm font-medium">{title}</div>
                {explanation ? <div className="text-xs text-muted-foreground mt-1 whitespace-pre-line">{explanation}</div> : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
