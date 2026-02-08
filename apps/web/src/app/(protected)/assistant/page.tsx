"use client";

import { useMemo, useState } from "react";
import { FirebaseError } from "firebase/app";
import { doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions as fbFunctions } from "@/lib/firebase";
import { useAssistantSettings } from "@/hooks/useAssistantSettings";
import { useUserAssistantSuggestions } from "@/hooks/useUserAssistantSuggestions";
import { useUserSettings } from "@/hooks/useUserSettings";
import { invalidateAuthSession, isAuthInvalidError } from "@/lib/authInvalidation";
import type { AssistantSuggestionDoc } from "@/types/firestore";

const CONSENT_VERSION = 1;

export default function AssistantPage() {
  const { data: assistantSettings, loading: assistantLoading, error: assistantError } = useAssistantSettings();
  const {
    data: suggestions,
    loading: suggestionsLoading,
    error: suggestionsError,
  } = useUserAssistantSuggestions({ limit: 50 });
  const { data: userSettings } = useUserSettings();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busySuggestionId, setBusySuggestionId] = useState<string | null>(null);
  const [showAllStatuses, setShowAllStatuses] = useState(false);

  const enabled = assistantSettings?.enabled === true;

  const plan = useMemo(() => {
    const raw = userSettings?.plan;
    if (raw === "pro") return "pro";
    return "free";
  }, [userSettings?.plan]);

  const handleEnable = async () => {
    const user = auth.currentUser;
    if (!user) return;

    setSaving(true);
    setMessage(null);

    const ref = doc(db, "users", user.uid, "assistantSettings", "main");

    try {
      if (!assistantSettings) {
        await setDoc(
          ref,
          {
            enabled: true,
            plan,
            autoAnalyze: false,
            consentVersion: CONSENT_VERSION,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      } else {
        await updateDoc(ref, {
          enabled: true,
          plan,
          updatedAt: serverTimestamp(),
        });
      }
      setMessage("Assistant activé.");
    } catch (e) {
      if (isAuthInvalidError(e)) {
        void invalidateAuthSession();
        return;
      }
      setMessage("Impossible d’activer l’assistant.");
    } finally {
      setSaving(false);
    }
  };

  const toMillisSafe = (ts: unknown) => {
    const maybe = ts as { toMillis?: () => number };
    if (maybe && typeof maybe.toMillis === "function") return maybe.toMillis();
    return 0;
  };

  const formatTs = (ts: unknown) => {
    const maybe = ts as { toDate?: () => Date };
    if (!maybe || typeof maybe.toDate !== "function") return "";
    try {
      return maybe.toDate().toLocaleString();
    } catch {
      return "";
    }
  };

  const isCallableUnauthenticated = (err: unknown) => {
    if (isAuthInvalidError(err)) return true;
    const code = typeof (err as { code?: unknown })?.code === "string" ? String((err as { code?: unknown }).code) : "";
    return code.includes("unauthenticated");
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
      const createdCount = Array.isArray(res.data?.createdCoreObjects) ? res.data.createdCoreObjects.length : 0;
      setActionMessage(createdCount > 0 ? `Suggestion acceptée (${createdCount} objet(s) créé(s)).` : "Suggestion acceptée.");
    } catch (e) {
      if (isCallableUnauthenticated(e)) {
        void invalidateAuthSession();
        return;
      }
      if (e instanceof FirebaseError) {
        setActionError(`${e.code}: ${e.message}`);
      } else if (e instanceof Error) {
        setActionError(e.message);
      } else {
        setActionError("Impossible d’accepter la suggestion.");
      }
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
    } catch (e) {
      if (isCallableUnauthenticated(e)) {
        void invalidateAuthSession();
        return;
      }
      if (e instanceof FirebaseError) {
        setActionError(`${e.code}: ${e.message}`);
      } else if (e instanceof Error) {
        setActionError(e.message);
      } else {
        setActionError("Impossible de refuser la suggestion.");
      }
    } finally {
      setBusySuggestionId(null);
    }
  };

  const sorted = useMemo(() => {
    const arr = (suggestions ?? []).slice();
    arr.sort((a, b) => toMillisSafe(b.updatedAt) - toMillisSafe(a.updatedAt));
    return arr;
  }, [suggestions]);

  const visible = useMemo(() => {
    if (showAllStatuses) return sorted;
    return sorted.filter((s) => s.status === "proposed");
  }, [sorted, showAllStatuses]);

  if (assistantError) {
    return <div className="sn-alert sn-alert--error">Impossible de charger l’assistant.</div>;
  }

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Assistant</h1>
          <p className="text-sm text-muted-foreground">
            {assistantLoading ? "Chargement…" : enabled ? "Assistant activé" : "Assistant désactivé"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/assistant/history"
            className="px-3 py-2 rounded-md border border-input text-sm hover:bg-accent"
          >
            Historique
          </a>
          <button
            type="button"
            onClick={() => void handleEnable()}
            disabled={assistantLoading || saving || enabled}
            className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            {saving ? "Activation…" : enabled ? "Activé" : "Activer l’assistant"}
          </button>
        </div>
      </div>

      {message && <div className="sn-alert">{message}</div>}

      {actionMessage && <div className="sn-alert">{actionMessage}</div>}
      {actionError && <div className="sn-alert sn-alert--error">{actionError}</div>}

      <div className="sn-card p-4 space-y-2">
        <div className="text-sm font-medium">Statut</div>
        <div className="text-sm text-muted-foreground">Plan: {plan}</div>
        <div className="text-sm text-muted-foreground">Auto-analyse: désactivée</div>
      </div>

      <div className="sn-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">Inbox</div>
          <div className="text-xs text-muted-foreground">
            {suggestionsLoading ? "Chargement…" : `${visible.length} suggestion(s)`}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showAllStatuses}
            onChange={(e) => setShowAllStatuses(e.target.checked)}
          />
          Afficher aussi les acceptées/refusées
        </label>

        {suggestionsError && (
          <div className="sn-alert sn-alert--error">Impossible de charger les suggestions.</div>
        )}

        {!suggestionsLoading && !suggestionsError && visible.length === 0 && (
          <div className="text-sm text-muted-foreground">Aucune suggestion pour le moment.</div>
        )}

        <div className="space-y-3">
          {visible.map((s) => {
            const suggestionId = s.id ?? s.dedupeKey;
            const isBusy = !!suggestionId && busySuggestionId === suggestionId;
            const proposed = s.status === "proposed";

            const dueLabel = s.payload?.dueDate ? formatTs(s.payload.dueDate) : "";
            const remindLabel = s.payload?.remindAt ? formatTs(s.payload.remindAt) : "";

            return (
              <div key={suggestionId ?? s.dedupeKey} className="border border-border rounded-md p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold">{s.payload?.title}</div>
                    <div className="text-xs text-muted-foreground">{s.payload?.explanation}</div>
                    {s.payload?.origin?.fromText ? (
                      <div className="text-xs text-muted-foreground">Extrait: “{s.payload.origin.fromText}”</div>
                    ) : null}
                    {dueLabel ? <div className="text-xs text-muted-foreground">Échéance: {dueLabel}</div> : null}
                    {remindLabel ? <div className="text-xs text-muted-foreground">Rappel: {remindLabel}</div> : null}
                    <div className="text-xs text-muted-foreground">Statut: {s.status}</div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleAccept(s)}
                      disabled={!proposed || isBusy}
                      className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                    >
                      {isBusy && proposed ? "Traitement…" : "Accepter"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleReject(s)}
                      disabled={!proposed || isBusy}
                      className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
                    >
                      Refuser
                    </button>
                    <button
                      type="button"
                      disabled
                      className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
                      aria-disabled="true"
                      title="Édition en PR-4"
                    >
                      Modifier
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
