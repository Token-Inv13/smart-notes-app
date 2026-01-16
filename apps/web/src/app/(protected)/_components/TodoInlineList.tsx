"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { addDoc, collection, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useUserTodos } from "@/hooks/useUserTodos";
import type { TodoDoc } from "@/types/firestore";
import { TODO_CREATE_EVENT } from "./todoEvents";

interface TodoInlineListProps {
  workspaceId?: string;
  showTabsHeader?: boolean;
}

export default function TodoInlineList({ workspaceId }: TodoInlineListProps) {
  const { data: todos, loading, error } = useUserTodos({ workspaceId, completed: false });
  const [editError, setEditError] = useState<string | null>(null);

  const [isCreating, setIsCreating] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onCreate = () => {
      setIsCreating(true);
      setDraftTitle("");
      setTimeout(() => inputRef.current?.focus(), 0);
    };

    window.addEventListener(TODO_CREATE_EVENT, onCreate);
    return () => window.removeEventListener(TODO_CREATE_EVENT, onCreate);
  }, []);

  const sortedTodos = useMemo(() => {
    return todos.slice();
  }, [todos]);

  const cancelCreate = () => {
    setIsCreating(false);
    setDraftTitle("");
  };

  const submitCreate = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const title = draftTitle.trim();
    if (!title) {
      cancelCreate();
      return;
    }

    setEditError(null);
    try {
      await addDoc(collection(db, "todos"), {
        userId: user.uid,
        workspaceId: typeof workspaceId === "string" ? workspaceId : null,
        title,
        completed: false,
        favorite: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      cancelCreate();
    } catch (e) {
      console.error("Error creating todo", e);
      setEditError(e instanceof Error ? e.message : "Erreur lors de la création de la ToDo.");
    }
  };

  const toggleCompleted = async (todo: TodoDoc, nextCompleted: boolean) => {
    if (!todo.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== todo.userId) return;

    setEditError(null);

    try {
      await updateDoc(doc(db, "todos", todo.id), {
        userId: todo.userId,
        workspaceId: typeof todo.workspaceId === "string" ? todo.workspaceId : null,
        title: todo.title,
        favorite: todo.favorite === true,
        completed: nextCompleted,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error("Error toggling todo completed", e);
      setEditError(e instanceof Error ? e.message : "Erreur lors de la mise à jour.");
    }
  };

  const toggleFavorite = async (todo: TodoDoc) => {
    if (!todo.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== todo.userId) return;

    setEditError(null);

    try {
      await updateDoc(doc(db, "todos", todo.id), {
        userId: todo.userId,
        workspaceId: typeof todo.workspaceId === "string" ? todo.workspaceId : null,
        title: todo.title,
        completed: todo.completed === true,
        favorite: !(todo.favorite === true),
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error("Error toggling todo favorite", e);
      setEditError(e instanceof Error ? e.message : "Erreur lors de la mise à jour.");
    }
  };

  return (
    <div className="space-y-4">
      {editError && <div className="sn-alert sn-alert--error">{editError}</div>}
      {error && (
        <div className="sn-alert sn-alert--error">
          Impossible de charger les ToDo pour le moment.
          {error.message ? ` (${error.message})` : ""}
        </div>
      )}

      {loading && (
        <div className="sn-empty sn-animate-in">
          <div className="space-y-3">
            <div className="sn-skeleton-title w-48 mx-auto" />
            <div className="sn-skeleton-line w-72 mx-auto" />
            <div className="sn-skeleton-line w-64 mx-auto" />
          </div>
        </div>
      )}

      {!loading && !error && sortedTodos.length === 0 && !isCreating && (
        <div className="sn-empty">
          <div className="sn-empty-title">Aucune ToDo</div>
          <div className="sn-empty-desc">Appuie sur + pour en créer une.</div>
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-2">
          {isCreating && (
            <div className="sn-card p-3">
              <input
                ref={inputRef}
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="Nouvelle ToDo"
                className="w-full bg-background text-foreground text-sm outline-none"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    cancelCreate();
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitCreate();
                  }
                }}
                onBlur={() => {
                  if (!draftTitle.trim()) cancelCreate();
                }}
              />
            </div>
          )}

          {sortedTodos.length > 0 && (
            <ul className="space-y-2">
              {sortedTodos.map((todo) => (
                <li key={todo.id}>
                  <div className="sn-card p-4">
                    <div className="flex items-center justify-between gap-3">
                      <label className="flex items-center gap-3 min-w-0">
                        <input
                          type="checkbox"
                          checked={todo.completed === true}
                          onChange={(e) => toggleCompleted(todo, e.target.checked)}
                          aria-label="Marquer comme terminée"
                        />
                        <span className="truncate">{todo.title}</span>
                      </label>

                      <button
                        type="button"
                        onClick={() => toggleFavorite(todo)}
                        className="sn-icon-btn shrink-0"
                        aria-label={todo.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                        title={todo.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                      >
                        {todo.favorite ? "★" : "☆"}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
