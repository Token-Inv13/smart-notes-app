"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { formatTimestampForDateInput, normalizeAgendaWindowForFirestore, parseLocalDateToTimestamp } from "@/lib/datetime";
import { toUserErrorMessage } from "@/lib/userError";
import type { TaskDoc, TodoDoc } from "@/types/firestore";
import { useRouter } from "next/navigation";
import DictationMicButton from "@/app/(protected)/_components/DictationMicButton";
import { insertTextAtSelection, prepareDictationTextForInsertion } from "@/lib/textInsert";
import Modal from "../../../Modal";

function safeItemId() {
  return `it_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

type TodoItem = NonNullable<TodoDoc["items"]>[number];

function normalizeTodoItems(items: TodoDoc["items"] | null | undefined): TodoItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item): TodoItem | null => {
      if (!item || typeof item !== "object") return null;
      const rawText = typeof item.text === "string" ? item.text : "";
      const text = rawText.trim();
      if (!text) return null;
      return {
        id: typeof item.id === "string" && item.id.trim() ? item.id : safeItemId(),
        text,
        done: item.done === true,
        createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
      };
    })
    .filter((item): item is TodoItem => item !== null);
}

function buildAgendaDescription(todo: TodoDoc) {
  const items = Array.isArray(todo.items) ? todo.items : [];
  if (items.length === 0) return "";

  const lines = ["Checklist:", ""];
  for (const item of items) {
    const text = typeof item?.text === "string" ? item.text.trim() : "";
    if (!text) continue;
    lines.push(`- [${item.done === true ? "x" : " "}] ${text}`);
  }
  return lines.join("\n");
}

function mapChecklistDueDateToAgendaWindow(dueDate: TodoDoc["dueDate"] | null | undefined) {
  const now = new Date();
  if (!dueDate?.toDate) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1, 0, 0, 0, 0);
    return {
      start,
      end,
      allDay: true,
    };
  }

  const base = dueDate.toDate();
  const hasExplicitTime =
    base.getHours() !== 0 ||
    base.getMinutes() !== 0 ||
    base.getSeconds() !== 0 ||
    base.getMilliseconds() !== 0;

  if (hasExplicitTime) {
    const start = new Date(base.getTime());
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return {
      start,
      end,
      allDay: false,
    };
  }

  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1, 0, 0, 0, 0);

  if (
    process.env.NODE_ENV !== "production" &&
    (end.getHours() !== 0 || end.getMinutes() !== 0 || end.getSeconds() !== 0 || end.getMilliseconds() !== 0)
  ) {
    console.warn("[todo->agenda] Invalid all-day end normalization", { start, end });
  }

  return {
    start,
    end,
    allDay: true,
  };
}

export default function TodoDetailModal(props: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const params = use(props.params);
  const todoId: string | undefined = params?.id;

  const [todo, setTodo] = useState<TodoDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [newItemText, setNewItemText] = useState("");

  const itemInputRef = useRef<HTMLInputElement | null>(null);

  const [itemDictationStatus, setItemDictationStatus] = useState<"idle" | "listening" | "stopped" | "error">("idle");
  const [itemDictationError, setItemDictationError] = useState<string | null>(null);

  const [optionsOpen, setOptionsOpen] = useState(false);
  const [doneSectionOpen, setDoneSectionOpen] = useState(false);
  const [dueDateDraft, setDueDateDraft] = useState("");
  const [priorityDraft, setPriorityDraft] = useState<"" | NonNullable<TodoDoc["priority"]>>("");
  const [agendaBusy, setAgendaBusy] = useState(false);
  const [agendaFeedback, setAgendaFeedback] = useState<string | null>(null);
  const [agendaTaskId, setAgendaTaskId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!todoId) {
        setError("ID de checklist manquant.");
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
          throw new Error("Checklist introuvable.");
        }

        const data = snap.data() as TodoDoc;
        if (data.userId !== user.uid) {
          throw new Error("Accès refusé.");
        }

        if (!cancelled) {
          setTodo({
            id: snap.id,
            ...data,
            items: normalizeTodoItems(data.items),
          });
        }
      } catch (e) {
        const msg = toUserErrorMessage(e, "Erreur lors du chargement.", {
          allowMessages: ["Checklist introuvable.", "Accès refusé.", "Tu dois être connecté.", "ID de checklist manquant."],
        });
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
  const totalItems = activeItems.length + doneItems.length;
  const completionPercent = totalItems > 0 ? Math.round((doneItems.length / totalItems) * 100) : 0;

  useEffect(() => {
    if (!todo) return;
    setDueDateDraft(formatTimestampForDateInput(todo.dueDate ?? null));
    setPriorityDraft(todo.priority ?? "");
    if (todo.dueDate || todo.priority) setOptionsOpen(true);
  }, [todo]);

  const persistTodo = async (next: {
    title?: string;
    items?: NonNullable<TodoDoc["items"]>;
    favorite?: boolean;
    completed?: boolean;
    dueDate?: TodoDoc["dueDate"] | null;
    priority?: TodoDoc["priority"] | null;
  }) => {
    if (!todo?.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== todo.userId) return;

    setSaving(true);
    setEditError(null);
    try {
      const nextTitle = typeof next.title === "string" ? next.title : todo.title;
      const nextItems = normalizeTodoItems(next.items ?? (todo.items ?? []));
      const nextFavorite = typeof next.favorite === "boolean" ? next.favorite : todo.favorite === true;
      const nextCompleted = typeof next.completed === "boolean" ? next.completed : todo.completed === true;
      const nextDueDate = typeof next.dueDate !== "undefined" ? next.dueDate : (todo.dueDate ?? null);
      const nextPriority = typeof next.priority !== "undefined" ? next.priority : (todo.priority ?? null);

      await updateDoc(doc(db, "todos", todo.id), {
        userId: todo.userId,
        workspaceId: typeof todo.workspaceId === "string" ? todo.workspaceId : null,
        title: nextTitle,
        completed: nextCompleted,
        favorite: nextFavorite,
        items: nextItems,
        dueDate: nextDueDate,
        priority: nextPriority,
        updatedAt: serverTimestamp(),
      });
      setTodo((prev) =>
        prev
          ? {
              ...prev,
              title: nextTitle,
              items: nextItems,
              favorite: nextFavorite,
              completed: nextCompleted,
              dueDate: nextDueDate,
              priority: nextPriority,
            }
          : prev,
      );
    } catch (e) {
      console.error("Error updating todo items (modal)", e);
      setEditError(toUserErrorMessage(e, "Erreur lors de la mise à jour."));
    } finally {
      setSaving(false);
    }
  };

  const setTitleDraft = (nextTitle: string) => {
    setTodo((prev) => (prev ? { ...prev, title: nextTitle } : prev));
  };

  const commitTitle = async () => {
    if (!todo) return;
    const trimmed = todo.title.trim();
    if (!trimmed) {
      setTitleDraft("Checklist");
      await persistTodo({ title: "Checklist" });
      return;
    }
    if (trimmed !== todo.title) {
      setTitleDraft(trimmed);
    }
    await persistTodo({ title: trimmed });
  };

  const commitDueDate = async () => {
    if (!todo) return;
    const ts = dueDateDraft ? parseLocalDateToTimestamp(dueDateDraft) : null;
    await persistTodo({ dueDate: ts });
  };

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

  const addToAgenda = async () => {
    if (!todo?.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== todo.userId) {
      setEditError("Impossible de modifier cette checklist.");
      return;
    }

    if (agendaBusy) return;

    setAgendaBusy(true);
    setEditError(null);
    setAgendaFeedback(null);

    try {
      const linkedTaskId = typeof todo.agendaTaskId === "string" && todo.agendaTaskId.trim() ? todo.agendaTaskId : null;
      if (linkedTaskId) {
        const linkedSnap = await getDoc(doc(db, "tasks", linkedTaskId));
        if (linkedSnap.exists()) {
          const linkedData = linkedSnap.data() as TaskDoc;
          if (linkedData.userId === user.uid) {
            setAgendaTaskId(linkedTaskId);
            setAgendaFeedback("Déjà ajouté à l’agenda.");
            return;
          }
        }
      }

      const agendaWindow = mapChecklistDueDateToAgendaWindow(todo.dueDate ?? null);
      const normalizedWindow = normalizeAgendaWindowForFirestore(agendaWindow);
      if (!normalizedWindow?.startDate || !normalizedWindow?.dueDate) {
        throw new Error("Date invalide pour l’ajout à l’agenda.");
      }

      const taskPayload: Omit<TaskDoc, "id"> = {
        userId: user.uid,
        workspaceId: typeof todo.workspaceId === "string" ? todo.workspaceId : null,
        title: todo.title?.trim() || "Checklist",
        description: buildAgendaDescription(todo),
        status: "todo",
        allDay: normalizedWindow.allDay,
        startDate: normalizedWindow.startDate,
        dueDate: normalizedWindow.dueDate,
        priority: todo.priority ?? null,
        recurrence: null,
        favorite: false,
        archived: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        sourceTodoId: todo.id,
      };

      const taskRef = await addDoc(collection(db, "tasks"), taskPayload);
      await updateDoc(doc(db, "todos", todo.id), {
        agendaTaskId: taskRef.id,
        updatedAt: serverTimestamp(),
      });

      setAgendaTaskId(taskRef.id);
      setTodo((prev) => (prev ? { ...prev, agendaTaskId: taskRef.id } : prev));
      setAgendaFeedback("Ajouté à l’agenda.");
    } catch (e) {
      console.error("Error adding checklist to agenda", e);
      setEditError(toUserErrorMessage(e, "Impossible de rajouter cette checklist à l’agenda."));
    } finally {
      setAgendaBusy(false);
    }
  };

  const addItem = async () => {
    if (!todo) return;
    const text = newItemText.trim();
    if (!text) return;
    const next = (todo.items ?? []).concat({ id: safeItemId(), text, done: false, createdAt: Date.now() });
    setNewItemText("");
    await persistTodo({ items: next });
  };

  const deleteTodo = async (close: () => void) => {
    if (!todo?.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== todo.userId) return;

    setEditError(null);
    setDeleting(true);
    try {
      await deleteDoc(doc(db, "todos", todo.id));
      setTodo(null);
      close();
    } catch (e) {
      console.error("Error deleting todo (modal)", e);
      setEditError(toUserErrorMessage(e, "Erreur lors de la suppression."));
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  const removeItem = async (itemId: string) => {
    if (!todo) return;
    const next = (todo.items ?? []).filter((x) => x.id !== itemId);
    await persistTodo({ items: next });
  };

  const toggleItemDone = async (itemId: string, nextDone: boolean) => {
    if (!todo) return;
    const next = (todo.items ?? []).map((x) => (x.id === itemId ? { ...x, done: nextDone } : x));
    await persistTodo({ items: next });
  };

  const updateItemTextDraft = (itemId: string, text: string) => {
    if (!todo) return;
    const next = (todo.items ?? []).map((x) => (x.id === itemId ? { ...x, text } : x));
    setTodo((prev) => (prev ? { ...prev, items: next } : prev));
  };

  const commitItemText = async (itemId: string) => {
    if (!todo) return;
    const current = todo.items ?? [];
    const item = current.find((x) => x.id === itemId);
    if (!item) return;

    if (!item.text.trim()) {
      const next = current.filter((x) => x.id !== itemId);
      await persistTodo({ items: next });
      return;
    }

    const next = current.map((x) => (x.id === itemId ? { ...x, text: item.text.trim() } : x));
    setTodo((prev) => (prev ? { ...prev, items: next } : prev));
    await persistTodo({ items: next });
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
            {agendaFeedback && (
              <div className="sn-alert" role="status" aria-live="polite">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{agendaFeedback}</span>
                  {agendaTaskId && (
                    <button
                      type="button"
                      className="sn-text-btn"
                      onClick={() => router.push(`/tasks/${encodeURIComponent(agendaTaskId)}`)}
                    >
                      Modifier
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="sn-card p-4 sm:p-5 space-y-4">
              <div className="space-y-3">
                <div className="sn-modal-header-safe">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Checklist</div>
                    <input
                      value={todo.title}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      onBlur={() => void commitTitle()}
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
                      className="flex-1 w-full bg-transparent text-base sm:text-lg font-semibold leading-tight outline-none"
                      aria-label="Titre de la checklist"
                      disabled={saving}
                    />
                  </div>

                  <div className="sn-modal-header-actions">
                    <button type="button" onClick={close} className="sn-icon-btn" aria-label="Fermer" title="Fermer">
                      ×
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="sn-badge">Actifs: {activeItems.length}</span>
                  <span className="sn-badge">Terminés: {doneItems.length}</span>
                  <span className="sn-badge">Progression: {completionPercent}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden" aria-hidden="true">
                  <div
                    className="h-full bg-primary transition-[width] duration-200"
                    style={{ width: `${completionPercent}%` }}
                  />
                </div>
              </div>

              <div className="rounded-md border border-border/70 bg-background/40 px-3 py-2.5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Action rapide</span>
                  <button
                    type="button"
                    onClick={() => void addToAgenda()}
                    disabled={saving || agendaBusy}
                    className="h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-accent disabled:opacity-50"
                  >
                    {agendaBusy ? "Ajout…" : "Rajouter à l’agenda"}
                  </button>
                </div>
              </div>

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
                    <label className="text-sm font-medium" htmlFor="todo-modal-due">
                      Échéance
                    </label>
                    <input
                      id="todo-modal-due"
                      type="date"
                      value={dueDateDraft}
                      onChange={(e) => setDueDateDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          (e.currentTarget as HTMLInputElement).blur();
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setDueDateDraft(formatTimestampForDateInput(todo.dueDate ?? null));
                          (e.currentTarget as HTMLInputElement).blur();
                        }
                      }}
                      onBlur={() => void commitDueDate()}
                      className={`w-full px-3 py-2 border rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary ${dueDateFeedback?.tone === "error" ? "border-destructive" : "border-input"}`}
                      disabled={saving}
                    />
                    {dueDateFeedback ? (
                      <div className={`text-xs ${dueDateFeedback.tone === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                        {dueDateFeedback.text}
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-medium" htmlFor="todo-modal-priority">
                      Priorité
                    </label>
                    <select
                      id="todo-modal-priority"
                      value={priorityDraft}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "low" || v === "medium" || v === "high") {
                          setPriorityDraft(v);
                          void persistTodo({ priority: v });
                        } else {
                          setPriorityDraft("");
                          void persistTodo({ priority: null });
                        }
                      }}
                      className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      disabled={saving}
                    >
                      <option value="">—</option>
                      <option value="low">Basse</option>
                      <option value="medium">Moyenne</option>
                      <option value="high">Haute</option>
                    </select>
                  </div>
                </div>
              </details>

              <div className="rounded-md border border-border bg-card/80 p-3 space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Ajouter un élément</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 rounded-md border border-input bg-background px-3 py-2">
                    <input
                      ref={itemInputRef}
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
                  </div>
                  <DictationMicButton
                    disabled={saving}
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
                    className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                    onClick={() => void addItem()}
                    disabled={saving || !newItemText.trim()}
                  >
                    Ajouter
                  </button>
                </div>
                {itemDictationStatus === "listening" ? (
                  <div className="text-xs text-muted-foreground">Écoute…</div>
                ) : itemDictationError ? (
                  <div className="text-xs text-destructive">{itemDictationError}</div>
                ) : null}
              </div>

              {activeItems.length === 0 && doneItems.length === 0 && (
                <div className="sn-empty">
                  <div className="sn-empty-title">Checklist vide</div>
                  <div className="sn-empty-desc">Ajoute un premier élément avec + ou le champ ci-dessus.</div>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">À faire</div>
                  <span className="sn-badge">{activeItems.length}</span>
                </div>

                {activeItems.length === 0 ? (
                  <div className="text-sm text-muted-foreground rounded-md border border-dashed border-border p-3">
                    Aucun élément actif.
                  </div>
                ) : (
                  <ul className="space-y-2.5">
                    {activeItems.map((it) => (
                      <li key={`active-${it.id}`} className="rounded-md border border-border bg-card p-3">
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
                            className="mt-0.5"
                          />
                          <input
                            className="w-full bg-transparent text-sm outline-none"
                            value={it.text}
                            placeholder="Nouvel élément"
                            onChange={(e) => updateItemTextDraft(it.id, e.target.value)}
                            onBlur={() => void commitItemText(it.id)}
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
                            disabled={saving}
                            aria-label="Texte de l’élément"
                          />
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
              </div>

              <details
                className="rounded-md border border-border bg-card"
                open={doneSectionOpen}
                onToggle={(e) => setDoneSectionOpen((e.currentTarget as HTMLDetailsElement).open)}
              >
                <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium flex items-center justify-between gap-2">
                  <span>Terminées</span>
                  <span className="sn-badge">{doneItems.length}</span>
                </summary>
                <div className="px-3 pb-3">
                  {doneItems.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Aucun élément terminé.</div>
                  ) : (
                    <ul className="space-y-2">
                      {doneItems.map((it) => (
                        <li key={`done-${it.id}`} className="rounded-md border border-border bg-muted/20 p-3">
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
                              className="mt-0.5"
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
              </details>

              <div className="pt-3 border-t border-border/70">
                {!confirmingDelete && (
                  <button
                    type="button"
                    className="sn-text-btn text-red-500"
                    onClick={() => setConfirmingDelete(true)}
                    disabled={saving || deleting}
                  >
                    Supprimer
                  </button>
                )}

                {confirmingDelete && (
                  <div className="space-y-2">
                    <div className="text-sm text-muted-foreground">
                      Supprimer définitivement cette ToDo ? Cette action est irréversible.
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        className="px-3 py-2 rounded-md text-sm border border-border"
                        onClick={() => setConfirmingDelete(false)}
                        disabled={deleting}
                      >
                        Annuler
                      </button>
                      <button
                        type="button"
                        className="px-3 py-2 rounded-md text-sm bg-red-600 text-white"
                        onClick={() => void deleteTodo(close)}
                        disabled={deleting}
                      >
                        {deleting ? "Suppression…" : "Supprimer définitivement"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      }}
    </Modal>
  );
}
