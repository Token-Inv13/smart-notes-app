"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FirebaseError } from "firebase/app";
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: todos, loading, error } = useUserTodos({ workspaceId });
  const [editError, setEditError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [todoView, setTodoView] = useState<"active" | "completed">("active");

  const [isCreating, setIsCreating] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const activeTodos = useMemo(() => todos.filter((t) => t.completed !== true), [todos]);
  const completedTodos = useMemo(() => todos.filter((t) => t.completed === true), [todos]);

  const visibleTodos = useMemo(() => {
    return todoView === "completed" ? completedTodos : activeTodos;
  }, [activeTodos, completedTodos, todoView]);

  useEffect(() => {
    const onCreate = () => {
      setIsCreating(true);
      setTodoView("active");
      setDraftTitle("");
      setTimeout(() => inputRef.current?.focus(), 0);
    };

    window.addEventListener(TODO_CREATE_EVENT, onCreate);
    return () => window.removeEventListener(TODO_CREATE_EVENT, onCreate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sortedTodos = useMemo(() => {
    return visibleTodos.slice();
  }, [visibleTodos]);

  const cancelCreate = () => {
    setIsCreating(false);
    setDraftTitle("");
  };

  const submitCreate = async () => {
    const user = auth.currentUser;
    if (!user) {
      setEditError("Tu dois être connecté.");
      return;
    }

    const title = draftTitle.trim();
    if (!title) {
      cancelCreate();
      return;
    }

    setEditError(null);
    try {
      const ref = await addDoc(collection(db, "todos"), {
        userId: user.uid,
        workspaceId: typeof workspaceId === "string" ? workspaceId : null,
        title,
        items: [],
        completed: false,
        favorite: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      cancelCreate();
      const qs = new URLSearchParams(searchParams.toString());
      if (workspaceId) qs.set("workspaceId", workspaceId);
      else qs.delete("workspaceId");
      const href = qs.toString();
      router.push(`/todo/${encodeURIComponent(ref.id)}${href ? `?${href}` : ""}`);
    } catch (e) {
      console.error("Error creating todo", e);
      if (e instanceof FirebaseError) {
        setEditError(`${e.code}: ${e.message}`);
      } else if (e instanceof Error) {
        setEditError(e.message);
      } else {
        setEditError("Erreur lors de la création de la ToDo.");
      }
    }
  };

  const toggleCompleted = async (todo: TodoDoc, nextCompleted: boolean) => {
    if (!todo.id) return;
    const user = auth.currentUser;
    if (!user) {
      setEditError("Tu dois être connecté.");
      return;
    }
    if (user.uid !== todo.userId) return;

    setEditError(null);
    setActionFeedback(null);

    try {
      await updateDoc(doc(db, "todos", todo.id), {
        userId: todo.userId,
        workspaceId: typeof todo.workspaceId === "string" ? todo.workspaceId : null,
        title: todo.title,
        favorite: todo.favorite === true,
        completed: nextCompleted,
        updatedAt: serverTimestamp(),
      });

      setActionFeedback(nextCompleted ? "ToDo terminée." : "ToDo restaurée.");
      window.setTimeout(() => setActionFeedback(null), 1800);
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
      {actionFeedback && <div className="sn-alert" role="status" aria-live="polite">{actionFeedback}</div>}
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
          <div className="sn-empty-title">{todoView === "completed" ? "Aucune ToDo terminée" : "Aucune ToDo"}</div>
          <div className="sn-empty-desc">
            {todoView === "completed" ? "Marque une ToDo comme terminée pour la retrouver ici." : "Appuie sur + pour en créer une."}
          </div>
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-4">
          <div className="inline-flex rounded-md border border-border bg-background overflow-hidden">
            <button
              type="button"
              onClick={() => setTodoView("active")}
              className={`px-3 py-1 text-sm ${todoView === "active" ? "bg-accent" : ""}`}
            >
              Actives ({activeTodos.length})
            </button>
            <button
              type="button"
              onClick={() => setTodoView("completed")}
              className={`px-3 py-1 text-sm ${todoView === "completed" ? "bg-accent" : ""}`}
            >
              Terminées ({completedTodos.length})
            </button>
          </div>

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
                  if (!draftTitle.trim()) {
                    cancelCreate();
                    return;
                  }
                  submitCreate();
                }}
              />
            </div>
          )}

          {sortedTodos.length > 0 && (
            <ul className="space-y-2">
              {sortedTodos.map((todo) => (
                <li key={todo.id}>
                  <div
                    className={`sn-card p-4 relative ${todo.completed ? "opacity-80" : ""} ${todo.id ? "cursor-pointer" : ""}`}
                  >
                    <button
                      type="button"
                      className="absolute inset-0 rounded-[inherit] z-0"
                      aria-label="Ouvrir la ToDo"
                      onClick={() => {
                        if (!todo.id) return;
                        const qs = new URLSearchParams(searchParams.toString());
                        if (workspaceId) qs.set("workspaceId", workspaceId);
                        else qs.delete("workspaceId");
                        const href = qs.toString();
                        router.push(`/todo/${encodeURIComponent(todo.id)}${href ? `?${href}` : ""}`);
                      }}
                    />

                    <div className="flex items-center justify-between gap-3 relative z-10">
                      <div className="flex items-center gap-3 min-w-0">
                        <input
                          type="checkbox"
                          checked={todo.completed === true}
                          onChange={(e) => toggleCompleted(todo, e.target.checked)}
                          aria-label="Marquer comme terminée"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className={`truncate select-text ${todo.completed ? "line-through text-muted-foreground" : ""}`}>{todo.title}</span>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(todo);
                        }}
                        className="sn-icon-btn shrink-0"
                        aria-label={todo.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                        title={todo.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                        onMouseDown={(e) => e.stopPropagation()}
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
