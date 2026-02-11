"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FirebaseError } from "firebase/app";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { parseLocalDateToTimestamp } from "@/lib/datetime";
import type { TodoDoc } from "@/types/firestore";
import DictationMicButton from "./DictationMicButton";
import { insertTextAtSelection, prepareDictationTextForInsertion } from "@/lib/textInsert";

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

  const submit = async () => {
    const user = auth.currentUser;
    if (!user) {
      setCreateError("Tu dois être connecté.");
      return;
    }

    const trimmed = title.trim();
    if (!trimmed) {
      if (!showActions) {
        onCancel?.();
        return;
      }
      setCreateError("Le titre est requis.");
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
      if (e instanceof FirebaseError) {
        setCreateError(`${e.code}: ${e.message}`);
      } else if (e instanceof Error) {
        setCreateError(e.message);
      } else {
        setCreateError("Erreur lors de la création de la ToDo.");
      }
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
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={creating}
              />
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
            Ajouter des sous-tâches
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
