"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FirebaseError } from "firebase/app";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { TodoDoc } from "@/types/firestore";

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
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const itemInputRef = useRef<HTMLInputElement | null>(null);

  const safeItemId = () => {
    return `it_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  };

  useEffect(() => {
    if (!autoFocus) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [autoFocus]);

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
      const payload: Omit<TodoDoc, "id"> = {
        userId: user.uid,
        workspaceId: typeof initialWorkspaceId === "string" ? initialWorkspaceId : null,
        title: trimmed,
        items: itemsDraft,
        completed: false,
        favorite: initialFavorite === true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const ref = await addDoc(collection(db, "todos"), payload);
      setTitle("");
      setNewItemText("");
      setItemsDraft([]);
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
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Nouvelle ToDo"
        className="w-full bg-background text-foreground text-sm outline-none"
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

      {showActions && (
        <div className="space-y-2">
          <div className="text-sm font-semibold">Sous-tâches / éléments</div>
          <div className="flex items-center gap-2">
            <input
              ref={itemInputRef}
              value={newItemText}
              onChange={(e) => setNewItemText(e.target.value)}
              placeholder="Ajouter un élément"
              className="flex-1 bg-background text-foreground text-sm outline-none"
              disabled={creating}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addDraftItem();
                }
              }}
            />
            <button
              type="button"
              onClick={addDraftItem}
              disabled={creating || !canAddItem}
              className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
            >
              Ajouter
            </button>
          </div>

          {itemsDraft.length > 0 && (
            <div className="space-y-2">
              {itemsDraft.map((it) => (
                <div key={it.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
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
      )}

      {showActions && (
        <div className="flex justify-end gap-2">
          {onCancel && (
            <button type="button" onClick={onCancel} className="px-3 py-2 rounded-md border border-input text-sm">
              Annuler
            </button>
          )}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={creating || !canSubmit}
            className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
          >
            {creating ? "Création…" : "Créer"}
          </button>
        </div>
      )}

      {createError && <div className="sn-alert sn-alert--error">{createError}</div>}
    </div>
  );
}
