"use client";

import { use, useEffect, useMemo, useState } from "react";
import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { useRouter, useSearchParams } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import type { TodoDoc } from "@/types/firestore";
import Modal from "../../../Modal";

function safeItemId() {
  return `it_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

export default function TodoDetailModal(props: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = use(props.params);
  const todoId: string | undefined = params?.id;

  const workspaceId = searchParams.get("workspaceId");

  const [todo, setTodo] = useState<TodoDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [newItemText, setNewItemText] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!todoId) {
        setError("ID de ToDo manquant.");
        setLoading(false);
        return;
      }

      const user = auth.currentUser;
      if (!user) {
        setError("Tu dois être connecté.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const snap = await getDoc(doc(db, "todos", todoId));
        if (!snap.exists()) {
          throw new Error("ToDo introuvable.");
        }

        const data = snap.data() as TodoDoc;
        if (data.userId !== user.uid) {
          throw new Error("Accès refusé.");
        }

        if (!cancelled) {
          setTodo({ id: snap.id, ...data });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erreur lors du chargement.";
        if (!cancelled) setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [todoId]);

  const items = useMemo(() => todo?.items ?? [], [todo?.items]);
  const activeItems = useMemo(() => items.filter((it) => it.done !== true), [items]);
  const doneItems = useMemo(() => items.filter((it) => it.done === true), [items]);

  const persistItems = async (nextItems: NonNullable<TodoDoc["items"]>) => {
    if (!todo?.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== todo.userId) return;

    setSaving(true);
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
      setTodo((prev) => (prev ? { ...prev, items: nextItems } : prev));
    } catch (e) {
      console.error("Error updating todo items (modal)", e);
      setEditError(e instanceof Error ? e.message : "Erreur lors de la mise à jour.");
    } finally {
      setSaving(false);
    }
  };

  const addItem = async () => {
    if (!todo) return;
    const text = newItemText.trim();
    if (!text) return;
    const next = (todo.items ?? []).concat({ id: safeItemId(), text, done: false, createdAt: Date.now() });
    setNewItemText("");
    await persistItems(next);
  };

  const removeItem = async (itemId: string) => {
    if (!todo) return;
    const next = (todo.items ?? []).filter((x) => x.id !== itemId);
    await persistItems(next);
  };

  const toggleItemDone = async (itemId: string, nextDone: boolean) => {
    if (!todo) return;
    const next = (todo.items ?? []).map((x) => (x.id === itemId ? { ...x, done: nextDone } : x));
    await persistItems(next);
  };

  return (
    <Modal hideHeader>
      {({ close }: { close: () => void }) => {
        if (loading) {
          return (
            <div className="sn-skeleton-card space-y-3">
              <div className="sn-skeleton-title w-56" />
              <div className="sn-skeleton-line w-72" />
              <div className="sn-skeleton-line w-64" />
              <div className="sn-skeleton-block-md w-full" />
            </div>
          );
        }

        if (error) {
          return <div className="sn-alert sn-alert--error">{error}</div>;
        }

        if (!todo) return null;

        return (
          <div className="space-y-4 max-h-[90svh] md:max-h-[90vh] overflow-y-auto">
            {editError && <div className="sn-alert sn-alert--error">{editError}</div>}

            <div className="sn-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{todo.title}</div>
                  <div className="text-xs text-muted-foreground">
                    Actifs: {activeItems.length} · Terminés: {doneItems.length}
                  </div>
                </div>

                <div className="shrink-0 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const qs = new URLSearchParams();
                      qs.set("todoId", String(todo.id));
                      if (workspaceId) qs.set("workspaceId", workspaceId);
                      router.push(`/todo?${qs.toString()}`);
                    }}
                    className="px-3 py-2 rounded-md border border-input text-sm"
                  >
                    Ouvrir
                  </button>
                  <button type="button" onClick={close} className="sn-icon-btn" aria-label="Fermer" title="Fermer">
                    ×
                  </button>
                </div>
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
                        void addItem();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setNewItemText("");
                      }
                    }}
                    disabled={saving}
                  />
                  <button
                    type="button"
                    className="sn-text-btn"
                    onClick={() => void addItem()}
                    disabled={saving || !newItemText.trim()}
                  >
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

              {activeItems.length > 0 && (
                <ul className="space-y-2">
                  {activeItems.map((it) => (
                    <li key={`active-${it.id}`} className="sn-card p-3">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={it.done === true}
                          onChange={(e) => {
                            e.currentTarget.blur();
                            void toggleItemDone(it.id, e.target.checked);
                          }}
                          aria-label="Marquer l’élément comme terminé"
                          disabled={saving}
                        />
                        <div className="w-full min-w-0">
                          <div className="text-sm break-words">{it.text}</div>
                        </div>
                        <button
                          type="button"
                          className="sn-icon-btn shrink-0"
                          aria-label="Supprimer l’élément"
                          title="Supprimer"
                          onClick={() => void removeItem(it.id)}
                          disabled={saving}
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
                      <li key={`done-${it.id}`} className="sn-card sn-card--muted p-3">
                        <div className="flex items-start gap-3 opacity-80">
                          <input
                            type="checkbox"
                            checked={true}
                            onChange={() => {
                              (document.activeElement as HTMLElement | null)?.blur?.();
                              void toggleItemDone(it.id, false);
                            }}
                            aria-label="Restaurer l’élément"
                            disabled={saving}
                          />
                          <div className="w-full min-w-0">
                            <div className="text-sm line-through text-muted-foreground break-words">{it.text}</div>
                          </div>
                          <button
                            type="button"
                            className="sn-icon-btn shrink-0"
                            aria-label="Supprimer définitivement l’élément"
                            title="Supprimer"
                            onClick={() => void removeItem(it.id)}
                            disabled={saving}
                          >
                            ✕
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        );
      }}
    </Modal>
  );
}
