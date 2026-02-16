"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FirebaseError } from "firebase/app";
import { httpsCallable } from "firebase/functions";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db, functions as fbFunctions } from "@/lib/firebase";
import { parseLocalDateToTimestamp } from "@/lib/datetime";
import { toUserErrorMessage } from "@/lib/userError";
import type { TodoDoc } from "@/types/firestore";
import DictationMicButton from "./DictationMicButton";
import { insertTextAtSelection, prepareDictationTextForInsertion } from "@/lib/textInsert";

type AssistantActionId =
  | "summary"
  | "correction"
  | "structure"
  | "translation"
  | "rewrite_pro"
  | "rewrite_humor"
  | "rewrite_short";

const ASSISTANT_ACTIONS: Record<AssistantActionId, { label: string; instruction: string }> = {
  summary: {
    label: "Résumer",
    instruction:
      "Résume ce todo en conservant uniquement l'essentiel. Réponds avec un titre court puis une liste à puces d'actions claires.",
  },
  correction: {
    label: "Correction",
    instruction:
      "Corrige l'orthographe, la grammaire et la ponctuation en français, sans modifier le sens des éléments.",
  },
  structure: {
    label: "Structurer",
    instruction:
      "Réorganise ce todo pour le rendre plus lisible: un titre explicite et une liste d'items ordonnés et actionnables.",
  },
  translation: {
    label: "Traduction",
    instruction:
      "Traduis le todo en anglais naturel, en gardant exactement le même sens et la même structure (titre + liste).",
  },
  rewrite_pro: {
    label: "Reformuler (pro)",
    instruction: "Reformule le todo dans un style professionnel, clair et orienté action.",
  },
  rewrite_humor: {
    label: "Reformuler (humour)",
    instruction: "Reformule le todo avec une touche d'humour légère et positive, tout en restant utile.",
  },
  rewrite_short: {
    label: "Reformuler (succinct)",
    instruction: "Reformule le todo de façon très concise avec des phrases courtes.",
  },
};

function todoDraftToAssistantText(title: string, items: NonNullable<TodoDoc["items"]>): string {
  const safeTitle = title.trim() || "Checklist";
  const lines = [safeTitle, "", "Éléments actifs:"];
  if (items.length === 0) lines.push("- Aucun");
  for (const item of items) {
    const text = typeof item?.text === "string" ? item.text.trim() : "";
    if (text) lines.push(`- ${text}`);
  }
  return lines.join("\n");
}

function parseAssistantTodoText(raw: string, fallbackTitle: string): { title: string; items: NonNullable<TodoDoc["items"]> } {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const first = lines[0] ?? "";
  const cleanedTitle = first.replace(/^[-*•#\d.\s)]+/, "").trim();
  const title = cleanedTitle || fallbackTitle || "Checklist";

  const bulletItems = lines
    .slice(1)
    .map((line) => line.replace(/^[-*•\d.\s)]+/, "").trim())
    .filter((line) => line.length > 0 && !/^éléments actifs:?$/i.test(line) && !/^terminés:?$/i.test(line) && !/^aucun$/i.test(line));

  const uniq = Array.from(new Set(bulletItems)).slice(0, 60);
  const itemsOut = uniq.map((text) => ({ id: `it_${Math.random().toString(36).slice(2)}_${Date.now()}`, text, done: false, createdAt: Date.now() }));
  return { title, items: itemsOut };
}

type Props = {
  initialWorkspaceId?: string;
  initialFavorite?: boolean;
  onCreated?: (todoId: string) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  showActions?: boolean;
};

export default function TodoCreateForm({
  initialWorkspaceId,
  initialFavorite,
  onCreated,
  onCancel,
  autoFocus,
  showActions,
}: Props) {
  const [title, setTitle] = useState("");
  const [newItemText, setNewItemText] = useState("");
  const [itemsDraft, setItemsDraft] = useState<NonNullable<TodoDoc["items"]>>([]);
  const [itemsOpen, setItemsOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [dueDateDraft, setDueDateDraft] = useState("");
  const [priorityDraft, setPriorityDraft] = useState<"" | NonNullable<TodoDoc["priority"]>>("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const itemInputRef = useRef<HTMLInputElement | null>(null);

  const [dictationStatus, setDictationStatus] = useState<"idle" | "listening" | "stopped" | "error">("idle");
  const [dictationError, setDictationError] = useState<string | null>(null);
  const [itemDictationStatus, setItemDictationStatus] = useState<"idle" | "listening" | "stopped" | "error">("idle");
  const [itemDictationError, setItemDictationError] = useState<string | null>(null);
  const [assistantMenuOpen, setAssistantMenuOpen] = useState(false);
  const [assistantBusyAction, setAssistantBusyAction] = useState<AssistantActionId | null>(null);
  const [assistantInfo, setAssistantInfo] = useState<string | null>(null);
  const [assistantError, setAssistantError] = useState<string | null>(null);

  const safeItemId = () => {
    return `it_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  };

  useEffect(() => {
    if (!autoFocus) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [autoFocus]);

  useEffect(() => {
    if (itemsDraft.length > 0) setItemsOpen(true);
  }, [itemsDraft.length]);

  useEffect(() => {
    if (dueDateDraft || priorityDraft) setOptionsOpen(true);
  }, [dueDateDraft, priorityDraft]);

  const canSubmit = useMemo(() => !!title.trim(), [title]);

  const canAddItem = useMemo(() => !!newItemText.trim(), [newItemText]);

  const dueDateFeedback = useMemo(() => {
    if (!dueDateDraft) return null;
    const ts = parseLocalDateToTimestamp(dueDateDraft);
    if (!ts) {
      return {
        tone: "error" as const,
        text: "Format attendu: AAAA-MM-JJ.",
      };
    }
    return {
      tone: "muted" as const,
      text: `Échéance: ${ts.toDate().toLocaleDateString("fr-FR")}`,
    };
  }, [dueDateDraft]);

  const addDraftItem = () => {
    const text = newItemText.trim();
    if (!text) return;

    setItemsDraft((prev) => prev.concat({ id: safeItemId(), text, done: false, createdAt: Date.now() }));
    setNewItemText("");
    window.setTimeout(() => itemInputRef.current?.focus(), 0);
  };

  const removeDraftItem = (id: string) => {
    setItemsDraft((prev) => prev.filter((it) => it.id !== id));
  };

  const runAssistantAction = async (actionId: AssistantActionId) => {
    if (assistantBusyAction || creating) return;
    const action = ASSISTANT_ACTIONS[actionId];

    setAssistantBusyAction(actionId);
    setAssistantInfo(null);
    setAssistantError(null);
    setAssistantMenuOpen(false);

    try {
      const fn = httpsCallable<
        { text: string; instruction: string },
        { text: string; model?: string | null }
      >(fbFunctions, "assistantRewriteText");

      const source = todoDraftToAssistantText(title, itemsDraft);
      const response = await fn({ text: source, instruction: action.instruction });
      const transformed = typeof response.data?.text === "string" ? response.data.text.trim() : "";
      if (!transformed) throw new Error("Réponse IA vide.");

      const parsed = parseAssistantTodoText(transformed, title || "Checklist");
      setTitle(parsed.title);
      if (parsed.items.length > 0) setItemsDraft(parsed.items);
      setAssistantInfo(`${action.label} appliqué.`);
    } catch (e) {
      if (e instanceof FirebaseError) {
        const code = String(e.code || "");
        if (code.includes("internal")) setAssistantError("Aide à la rédaction indisponible pour le moment. Réessaie dans quelques secondes.");
        else setAssistantError(toUserErrorMessage(e, "Impossible d’appliquer l’action assistant."));
      } else {
        setAssistantError("Impossible d’appliquer l’action assistant.");
      }
    } finally {
      setAssistantBusyAction(null);
    }
  };

  const submit = async () => {
    const user = auth.currentUser;
    if (!user) {
      setCreateError("Session expirée ou accès refusé. Recharge la page et reconnecte-toi.");
      return;
    }

    const trimmed = title.trim();
    if (!trimmed) {
      if (!showActions) {
        onCancel?.();
        return;
      }
      setCreateError("Le titre est obligatoire.");
      return;
    }

    setCreateError(null);
    setCreating(true);
    try {
      const dueTimestamp = dueDateDraft ? parseLocalDateToTimestamp(dueDateDraft) : null;

      const payload: Omit<TodoDoc, "id"> = {
        userId: user.uid,
        workspaceId: typeof initialWorkspaceId === "string" ? initialWorkspaceId : null,
        title: trimmed,
        items: itemsDraft,
        dueDate: dueTimestamp,
        priority: priorityDraft || null,
        completed: false,
        favorite: initialFavorite === true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const ref = await addDoc(collection(db, "todos"), payload);
      setTitle("");
      setNewItemText("");
      setItemsDraft([]);
      setDueDateDraft("");
      setPriorityDraft("");
      onCreated?.(ref.id);
    } catch (e) {
      console.error("Error creating todo", e);
      setCreateError(toUserErrorMessage(e, "Impossible de créer la checklist."));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="todo-title">
          Titre
        </label>
        <div className="flex items-center gap-2">
          <input
            id="todo-title"
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex: Préparer la semaine"
            className="flex-1 w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-base font-medium focus:outline-none focus:ring-2 focus:ring-primary"
            disabled={creating}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onCancel?.();
              }
              if (e.key === "Enter") {
                e.preventDefault();
                if (showActions) {
                  itemInputRef.current?.focus();
                  return;
                }
                void submit();
              }
            }}
            onBlur={() => {
              if (showActions) return;
              if (!title.trim()) {
                onCancel?.();
                return;
              }
              void submit();
            }}
          />
          <DictationMicButton
            disabled={creating}
            onFinalText={(rawText) => {
              const el = inputRef.current;
              const insert = prepareDictationTextForInsertion({
                value: title,
                selectionStart: el?.selectionStart ?? null,
                rawText,
              });
              if (!insert) return;
              const { nextValue, nextCursor } = insertTextAtSelection({
                value: title,
                selectionStart: el?.selectionStart ?? null,
                selectionEnd: el?.selectionEnd ?? null,
                text: insert,
              });
              setTitle(nextValue);
              window.requestAnimationFrame(() => {
                try {
                  el?.focus();
                  el?.setSelectionRange(nextCursor, nextCursor);
                } catch {
                  // ignore
                }
              });
            }}
            onStatusChange={(st, err) => {
              setDictationStatus(st);
              setDictationError(err);
            }}
          />
        </div>
        {dictationStatus === "listening" ? (
          <div className="text-xs text-muted-foreground">Écoute…</div>
        ) : dictationError ? (
          <div className="text-xs text-destructive">{dictationError}</div>
        ) : null}
      </div>

      {showActions && (
        <div className="rounded-md border border-border/70 bg-background/40 px-2 py-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground mr-1">Assistant</span>
            <button
              type="button"
              className="px-2 py-1 rounded border border-border text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
              disabled={creating || !!assistantBusyAction}
              onClick={() => void runAssistantAction("summary")}
            >
              {assistantBusyAction === "summary" ? "Résumé…" : "Résumer"}
            </button>
            <button
              type="button"
              className="px-2 py-1 rounded border border-border text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
              disabled={creating || !!assistantBusyAction}
              onClick={() => void runAssistantAction("correction")}
            >
              {assistantBusyAction === "correction" ? "Correction…" : "Correction"}
            </button>
            <button
              type="button"
              className="px-2 py-1 rounded border border-border text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
              disabled={creating || !!assistantBusyAction}
              onClick={() => void runAssistantAction("structure")}
            >
              {assistantBusyAction === "structure" ? "Structure…" : "Structurer"}
            </button>
            <div className="relative">
              <button
                type="button"
                className="px-2 py-1 rounded border border-border text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                disabled={creating || !!assistantBusyAction}
                onClick={() => setAssistantMenuOpen((v) => !v)}
              >
                Plus
              </button>
              {assistantMenuOpen ? (
                <div className="absolute right-0 mt-1 z-20 min-w-[210px] rounded-md border border-border bg-card shadow-lg p-1">
                  <button type="button" className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-accent" onClick={() => void runAssistantAction("translation")}>Traduction</button>
                  <button type="button" className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-accent" onClick={() => void runAssistantAction("rewrite_pro")}>Reformuler (pro)</button>
                  <button type="button" className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-accent" onClick={() => void runAssistantAction("rewrite_humor")}>Reformuler (humour)</button>
                  <button type="button" className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-accent" onClick={() => void runAssistantAction("rewrite_short")}>Reformuler (succinct)</button>
                </div>
              ) : null}
            </div>
          </div>
          {assistantInfo ? <div className="mt-1 text-[11px] text-muted-foreground">{assistantInfo}</div> : null}
          {assistantError ? <div className="mt-1 text-[11px] text-destructive">{assistantError}</div> : null}
        </div>
      )}

      {showActions && (
        <details
          className="rounded-md border border-border bg-card"
          open={optionsOpen}
          onToggle={(e) => setOptionsOpen((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
            Options
            <span className="text-muted-foreground font-normal"> (planification)</span>
          </summary>

          <div className="px-3 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="todo-due-date">
                Échéance
              </label>
              <input
                id="todo-due-date"
                type="date"
                value={dueDateDraft}
                onChange={(e) => setDueDateDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
                className={`w-full px-3 py-2 border rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary ${dueDateFeedback?.tone === "error" ? "border-destructive" : "border-input"}`}
                disabled={creating}
              />
              {dueDateFeedback ? (
                <div className={`text-xs ${dueDateFeedback.tone === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                  {dueDateFeedback.text}
                </div>
              ) : null}
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="todo-priority">
                Priorité
              </label>
              <select
                id="todo-priority"
                value={priorityDraft}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "low" || v === "medium" || v === "high") setPriorityDraft(v);
                  else setPriorityDraft("");
                }}
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={creating}
              >
                <option value="">—</option>
                <option value="low">Basse</option>
                <option value="medium">Moyenne</option>
                <option value="high">Haute</option>
              </select>
            </div>
          </div>
        </details>
      )}

      {showActions && (
        <details
          className="rounded-md border border-border bg-card"
          open={itemsOpen}
          onToggle={(e) => setItemsOpen((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
            Ajouter des éléments
            <span className="text-muted-foreground font-normal"> (optionnel)</span>
            {itemsDraft.length > 0 ? <span className="text-muted-foreground font-normal"> · {itemsDraft.length}</span> : null}
          </summary>

          <div className="px-3 pb-3 space-y-2">
            <div className="flex items-center gap-2">
              <input
                ref={itemInputRef}
                value={newItemText}
                onChange={(e) => setNewItemText(e.target.value)}
                placeholder="Ex: Appeler le client"
                className="flex-1 px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={creating}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addDraftItem();
                  }
                }}
              />
              <DictationMicButton
                disabled={creating}
                onFinalText={(rawText) => {
                  const el = itemInputRef.current;
                  const insert = prepareDictationTextForInsertion({
                    value: newItemText,
                    selectionStart: el?.selectionStart ?? null,
                    rawText,
                  });
                  if (!insert) return;
                  const { nextValue, nextCursor } = insertTextAtSelection({
                    value: newItemText,
                    selectionStart: el?.selectionStart ?? null,
                    selectionEnd: el?.selectionEnd ?? null,
                    text: insert,
                  });
                  setNewItemText(nextValue);
                  window.requestAnimationFrame(() => {
                    try {
                      el?.focus();
                      el?.setSelectionRange(nextCursor, nextCursor);
                    } catch {
                      // ignore
                    }
                  });
                }}
                onStatusChange={(st, err) => {
                  setItemDictationStatus(st);
                  setItemDictationError(err);
                }}
              />
              <button
                type="button"
                onClick={addDraftItem}
                disabled={creating || !canAddItem}
                className="h-10 inline-flex items-center justify-center px-3 rounded-md border border-input text-sm disabled:opacity-50"
              >
                Ajouter
              </button>
            </div>

            {itemDictationStatus === "listening" ? (
              <div className="text-xs text-muted-foreground">Écoute…</div>
            ) : itemDictationError ? (
              <div className="text-xs text-destructive">{itemDictationError}</div>
            ) : null}

            {itemsDraft.length > 0 && (
              <div className="space-y-2">
                {itemsDraft.map((it) => (
                  <div
                    key={it.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                  >
                    <div className="text-sm min-w-0 flex-1 truncate">{it.text}</div>
                    <button
                      type="button"
                      onClick={() => removeDraftItem(it.id)}
                      disabled={creating}
                      className="sn-text-btn"
                      aria-label="Supprimer l’élément"
                    >
                      Supprimer
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
      )}

      {showActions && (
        <div className="flex justify-end gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="h-10 inline-flex items-center justify-center px-4 rounded-md border border-input text-sm"
            >
              Annuler
            </button>
          )}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={creating || !canSubmit}
            className="h-10 inline-flex items-center justify-center px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? "Création…" : "Créer"}
          </button>
        </div>
      )}

      {createError && <div className="sn-alert sn-alert--error">{createError}</div>}
    </div>
  );
}
