"use client";

import { useMemo, useState } from "react";
import { FirebaseError } from "firebase/app";
import { httpsCallable } from "firebase/functions";
import type { Timestamp } from "firebase/firestore";
import { functions as fbFunctions } from "@/lib/firebase";
import { invalidateAuthSession, isAuthInvalidError } from "@/lib/authInvalidation";
import { useAssistantSettings } from "@/hooks/useAssistantSettings";
import { useNoteAssistantSuggestions } from "@/hooks/useNoteAssistantSuggestions";
import { formatTimestampForInput, parseLocalDateTimeToTimestamp } from "@/lib/datetime";
import type { AssistantSuggestionDoc, Priority } from "@/types/firestore";
import Modal from "../Modal";

type Props = {
  noteId?: string;
};

export default function AssistantNotePanel({ noteId }: Props) {
  const {
    data: assistantSettings,
    loading: assistantLoading,
    error: assistantError,
    refetch: refetchAssistant,
  } = useAssistantSettings();
  const enabled = assistantSettings?.enabled === true;

  const {
    data: suggestions,
    loading: suggestionsLoading,
    error: suggestionsError,
    refetch: refetchSuggestions,
  } = useNoteAssistantSuggestions(noteId, { limit: 10 });

  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busySuggestionId, setBusySuggestionId] = useState<string | null>(null);

  const [editing, setEditing] = useState<AssistantSuggestionDoc | null>(null);
  const [editTitle, setEditTitle] = useState<string>("");
  const [editDate, setEditDate] = useState<string>("");
  const [editPriority, setEditPriority] = useState<"" | Priority>("");
  const [editError, setEditError] = useState<string | null>(null);

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

  const isCallableUnauthenticated = (err: unknown) => {
    if (isAuthInvalidError(err)) return true;
    const code = typeof (err as { code?: unknown })?.code === "string" ? String((err as { code?: unknown }).code) : "";
    return code.includes("unauthenticated");
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
    refetchAssistant();
    refetchSuggestions();
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
    setEditing(s);
    setEditError(null);
    setEditTitle(s.payload?.title ?? "");
    if (s.kind === "create_task") {
      setEditDate(formatTimestampForInput(s.payload?.dueDate ?? null));
    } else {
      setEditDate(formatTimestampForInput(s.payload?.remindAt ?? null));
    }
    const p = s.payload?.priority;
    setEditPriority(p === "low" || p === "medium" || p === "high" ? p : "");
  };

  const closeEdit = () => {
    setEditing(null);
    setEditError(null);
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

    if (typeof editing.payload?.priority !== "undefined") {
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
        <div className="sn-alert sn-alert--error">Erreur lors du chargement de l’assistant.</div>
      </div>
    );
  }

  if (!enabled) return null;

  return (
    <div className="sn-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">Assistant</div>
        <div className="text-xs text-muted-foreground">{noteId ? `Note: ${noteId}` : ""}</div>
      </div>

      {actionMessage && <div className="sn-alert">{actionMessage}</div>}
      {actionError && <div className="sn-alert sn-alert--error">{actionError}</div>}

      {suggestionsError && (
        <div className="space-y-2">
          <div className="sn-alert sn-alert--error">Erreur lors du chargement des suggestions.</div>
          <button
            type="button"
            onClick={handleRefresh}
            className="px-3 py-2 rounded-md border border-input text-sm"
          >
            Rafraîchir
          </button>
        </div>
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

            const dueLabel = s.kind === "create_task" ? formatTs(s.payload?.dueDate ?? null) : "";
            const remindLabel = s.kind === "create_reminder" ? formatTs(s.payload?.remindAt ?? null) : "";

            return (
              <div key={suggestionId ?? s.dedupeKey} className="border border-border rounded-md p-3 space-y-2">
                <div className="space-y-1">
                  <div className="text-sm font-semibold">{s.payload?.title}</div>
                  <div className="text-xs text-muted-foreground">{s.payload?.explanation}</div>
                  {s.payload?.origin?.fromText ? (
                    <div className="text-xs text-muted-foreground">Extrait: “{s.payload.origin.fromText}”</div>
                  ) : null}
                  {dueLabel ? <div className="text-xs text-muted-foreground">Échéance: {dueLabel}</div> : null}
                  {remindLabel ? <div className="text-xs text-muted-foreground">Rappel: {remindLabel}</div> : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleAccept(s)}
                    disabled={isBusy}
                    className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                  >
                    {isBusy ? "Traitement…" : "Accepter"}
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
                    onClick={() => openEdit(s)}
                    disabled={isBusy}
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

            {typeof editing.payload?.priority !== "undefined" && (
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
    </div>
  );
}
