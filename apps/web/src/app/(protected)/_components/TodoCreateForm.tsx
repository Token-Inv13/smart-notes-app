"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FirebaseError } from "firebase/app";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { TodoDoc } from "@/types/firestore";

type Props = {
  initialWorkspaceId?: string;
  onCreated?: (todoId: string) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  showActions?: boolean;
};

export default function TodoCreateForm({
  initialWorkspaceId,
  onCreated,
  onCancel,
  autoFocus,
  showActions,
}: Props) {
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!autoFocus) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [autoFocus]);

  const canSubmit = useMemo(() => !!title.trim(), [title]);

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
        items: [],
        completed: false,
        favorite: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const ref = await addDoc(collection(db, "todos"), payload);
      setTitle("");
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
