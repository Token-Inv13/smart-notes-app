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
  const { data: todos, loading, error } = useUserTodos({ workspaceId, completed: false });
  const [editError, setEditError] = useState<string | null>(null);

  const [isCreating, setIsCreating] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [optimisticItemsByTodoId, setOptimisticItemsByTodoId] = useState<Record<string, TodoDoc["items"]>>({});

  const selectedTodoId = searchParams.get("todoId") || null;
  const selectedTodo = useMemo(() => {
    if (!selectedTodoId) return null;
    return todos.find((t) => t.id === selectedTodoId) ?? null;
  }, [selectedTodoId, todos]);

  const itemsEqual = (a: TodoDoc["items"], b: TodoDoc["items"]) => {
    const aa = a ?? [];
    const bb = b ?? [];
    if (aa.length !== bb.length) return false;
    for (let i = 0; i < aa.length; i++) {
      const ai = aa[i];
      const bi = bb[i];
      if (!ai || !bi) return false;
      if (ai.id !== bi.id) return false;
      if (ai.text !== bi.text) return false;
      if (ai.done !== bi.done) return false;
    }
    return true;
  };

  useEffect(() => {
    setOptimisticItemsByTodoId((prev) => {
      const ids = Object.keys(prev);
      if (ids.length === 0) return prev;

      const byId = new Map<string, TodoDoc>();
      todos.forEach((t) => {
        if (t.id) byId.set(t.id, t);
      });

      let changed = false;
      const next: Record<string, TodoDoc["items"]> = { ...prev };
      for (const id of ids) {
        const todo = byId.get(id);
        if (!todo) {
          delete next[id];
          changed = true;
          continue;
        }
        if (itemsEqual(todo.items, prev[id])) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todos]);

  const itemsForTodo = (todo: TodoDoc): NonNullable<TodoDoc["items"]> => {
    if (!todo.id) return todo.items ?? [];
    const optimistic = optimisticItemsByTodoId[todo.id];
    return (optimistic ?? todo.items ?? []) as NonNullable<TodoDoc["items"]>;
  };

  const setTodoIdInUrl = (todoId: string | null) => {
    const qs = new URLSearchParams(searchParams.toString());
    if (todoId) qs.set("todoId", todoId);
    else qs.delete("todoId");
    const href = qs.toString();
    router.push(href ? `?${href}` : "?");
  };

  useEffect(() => {
    const onCreate = (e: Event) => {
      const mode = ((e as CustomEvent | undefined)?.detail as { mode?: string } | undefined)?.mode;
      const resolvedMode = mode === "add_item" ? "add_item" : "create";

      if (resolvedMode === "add_item") {
        if (!selectedTodo || !selectedTodo.id) {
          setIsCreating(true);
          setDraftTitle("");
          setTimeout(() => inputRef.current?.focus(), 0);
          return;
        }

        void (async () => {
          const user = auth.currentUser;
          if (!user || user.uid !== selectedTodo.userId) return;

          const todoId = selectedTodo.id;
          if (!todoId) return;

          const nextId = `it_${Math.random().toString(36).slice(2)}_${Date.now()}`;
          const nextItems = itemsForTodo(selectedTodo).concat({ id: nextId, text: "", done: false, createdAt: Date.now() });
          setOptimisticItemsByTodoId((prev) => ({ ...prev, [todoId]: nextItems }));
          setEditError(null);
          try {
            await updateDoc(doc(db, "todos", todoId), {
              userId: selectedTodo.userId,
              workspaceId: typeof selectedTodo.workspaceId === "string" ? selectedTodo.workspaceId : null,
              title: selectedTodo.title,
              completed: selectedTodo.completed === true,
              favorite: selectedTodo.favorite === true,
              items: nextItems,
              updatedAt: serverTimestamp(),
            });
            setTimeout(() => {
              const el = document.getElementById(`todo-item-${nextId}`) as HTMLInputElement | null;
              el?.focus();
            }, 0);
          } catch (err) {
            console.error("Error adding todo item (+)", err);
            setOptimisticItemsByTodoId((prev) => {
              const next = { ...prev };
              delete next[todoId];
              return next;
            });
            setEditError(err instanceof Error ? err.message : "Erreur lors de l’ajout de l’élément.");
          }
        })();
        return;
      }

      setIsCreating(true);
      setDraftTitle("");
      setTimeout(() => inputRef.current?.focus(), 0);
    };

    window.addEventListener(TODO_CREATE_EVENT, onCreate);
    return () => window.removeEventListener(TODO_CREATE_EVENT, onCreate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTodoId, selectedTodo, todos, optimisticItemsByTodoId]);

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
      setTodoIdInUrl(ref.id);
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

  const persistItems = async (todo: TodoDoc, nextItems: NonNullable<TodoDoc["items"]>) => {
    if (!todo.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== todo.userId) return;

    setOptimisticItemsByTodoId((prev) => ({ ...prev, [todo.id!]: nextItems }));
    setEditError(null);

    try {
      await updateDoc(doc(db, "todos", todo.id), {
        userId: todo.userId,
        workspaceId: typeof todo.workspaceId === "string" ? todo.workspaceId : null,
        title: todo.title,
        completed: todo.completed === true,
        favorite: todo.favorite === true,
        items: nextItems,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error("Error updating todo items", e);
      setOptimisticItemsByTodoId((prev) => {
        const next = { ...prev };
        delete next[todo.id!];
        return next;
      });
      setEditError(e instanceof Error ? e.message : "Erreur lors de la mise à jour.");
    }
  };

  const ensureSelectedTodo = () => {
    if (selectedTodo && selectedTodo.id) return selectedTodo;
    return null;
  };

  const [newItemText, setNewItemText] = useState("");

  const addItemFromInput = async () => {
    const todo = ensureSelectedTodo();
    if (!todo || !todo.id) return;

    const text = newItemText.trim();
    if (!text) return;

    const nextId = `it_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    const nextItems = itemsForTodo(todo).concat({ id: nextId, text, done: false, createdAt: Date.now() });
    setNewItemText("");
    await persistItems(todo, nextItems);
  };

  const closeDetail = () => {
    setTodoIdInUrl(null);
  };

  const renderTodoDetail = (todo: TodoDoc) => {
    const allItems = itemsForTodo(todo);
    const activeItems = allItems.filter((it) => it.done !== true);
    const doneItems = allItems.filter((it) => it.done === true);

    return (
      <>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-lg font-semibold truncate">{todo.title}</div>
            <div className="text-xs text-muted-foreground">
              Actifs: {activeItems.length} · Terminés: {doneItems.length}
            </div>
          </div>
          <button type="button" className="sn-text-btn shrink-0" onClick={closeDetail}>
            Fermer
          </button>
        </div>

        <div className="sn-card sn-card--muted p-3">
          <div className="flex items-center gap-2">
            <input
              value={newItemText}
              onChange={(e) => setNewItemText(e.target.value)}
              placeholder="Ajouter un élément"
              className="w-full bg-transparent text-sm outline-none"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void addItemFromInput();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setNewItemText("");
                }
              }}
            />
            <button type="button" className="sn-text-btn" onClick={() => void addItemFromInput()}>
              Ajouter
            </button>
          </div>
        </div>

        {activeItems.length === 0 && doneItems.length === 0 && (
          <div className="sn-empty">
            <div className="sn-empty-title">ToDo vide</div>
            <div className="sn-empty-desc">Ajoute un premier élément avec + ou le champ ci-dessus.</div>
          </div>
        )}

        {activeItems.length === 0 && doneItems.length > 0 && (
          <div className="sn-empty">
            <div className="sn-empty-title">Aucun élément actif</div>
            <div className="sn-empty-desc">Tes éléments terminés sont disponibles plus bas.</div>
          </div>
        )}

        {activeItems.length > 0 && (
          <ul className="space-y-2">
            {activeItems.map((it) => (
              <li key={it.id} className="sn-card p-3">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={it.done === true}
                    onChange={(e) => {
                      const next = itemsForTodo(todo).map((x) => (x.id === it.id ? { ...x, done: e.target.checked } : x));
                      void persistItems(todo, next);
                    }}
                    aria-label="Marquer l’élément comme terminé"
                  />

                  <input
                    id={`todo-item-${it.id}`}
                    className="w-full bg-transparent text-sm outline-none"
                    value={it.text}
                    placeholder="Nouvel élément"
                    onChange={(e) => {
                      const next = itemsForTodo(todo).map((x) => (x.id === it.id ? { ...x, text: e.target.value } : x));
                      setOptimisticItemsByTodoId((prev) => ({ ...prev, [todo.id!]: next }));
                    }}
                    onBlur={() => {
                      const current = itemsForTodo(todo);
                      const item = current.find((x) => x.id === it.id);
                      if (!item) return;
                      if (!item.text.trim()) {
                        const next = current.filter((x) => x.id !== it.id);
                        void persistItems(todo, next);
                        return;
                      }
                      void persistItems(todo, current);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        (e.currentTarget as HTMLInputElement).blur();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        (e.currentTarget as HTMLInputElement).blur();
                      }
                    }}
                  />

                  <button
                    type="button"
                    className="sn-icon-btn shrink-0"
                    aria-label="Supprimer l’élément"
                    title="Supprimer"
                    onClick={() => {
                      const next = itemsForTodo(todo).filter((x) => x.id !== it.id);
                      void persistItems(todo, next);
                    }}
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="pt-2">
          <div className="text-sm font-medium mb-2">Terminées</div>

          {doneItems.length === 0 && <div className="text-sm text-muted-foreground">Aucun élément terminé.</div>}

          {doneItems.length > 0 && (
            <ul className="space-y-2">
              {doneItems.map((it) => (
                <li key={it.id} className="sn-card sn-card--muted p-3">
                  <div className="flex items-start gap-3 opacity-80">
                    <input
                      type="checkbox"
                      checked={true}
                      onChange={() => {
                        const next = itemsForTodo(todo).map((x) => (x.id === it.id ? { ...x, done: false } : x));
                        void persistItems(todo, next);
                      }}
                      aria-label="Restaurer l’élément"
                    />

                    <div className="w-full min-w-0">
                      <div className="text-sm line-through text-muted-foreground break-words">{it.text}</div>
                    </div>

                    <button
                      type="button"
                      className="sn-icon-btn shrink-0"
                      aria-label="Supprimer définitivement l’élément"
                      title="Supprimer"
                      onClick={() => {
                        const next = itemsForTodo(todo).filter((x) => x.id !== it.id);
                        void persistItems(todo, next);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </>
    );
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
                    className={`sn-card p-4 ${todo.id && todo.id === selectedTodoId ? "border-primary" : ""} ${
                      todo.id ? "cursor-pointer" : ""
                    }`}
                    onClick={() => {
                      if (!todo.id) return;
                      setTodoIdInUrl(todo.id);
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <input
                          type="checkbox"
                          checked={todo.completed === true}
                          onChange={(e) => toggleCompleted(todo, e.target.checked)}
                          aria-label="Marquer comme terminée"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="truncate select-text">{todo.title}</span>
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleFavorite(todo)}
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

          <aside className="sn-card p-4 min-h-[180px]">
            {!selectedTodoId && (
              <div className="sn-empty">
                <div className="sn-empty-title">Ouvre une ToDo</div>
                <div className="sn-empty-desc">Clique sur une ToDo pour afficher ses éléments.</div>
              </div>
            )}

            {selectedTodoId && !selectedTodo && (
              <div className="sn-empty">
                <div className="sn-empty-title">ToDo introuvable</div>
                <div className="sn-empty-desc">Cette ToDo n’existe plus ou n’est pas accessible.</div>
                <div className="mt-3">
                  <button type="button" className="sn-text-btn" onClick={closeDetail}>
                    Fermer
                  </button>
                </div>
              </div>
            )}

            {selectedTodo && <div className="space-y-4">{renderTodoDetail(selectedTodo)}</div>}
          </aside>
        </div>
      )}
    </div>
  );
}
