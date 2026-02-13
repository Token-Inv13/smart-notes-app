"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { FirebaseError } from "firebase/app";
import { deleteDoc, doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions as fbFunctions } from "@/lib/firebase";
import { formatTimestampForDateInput, parseLocalDateToTimestamp } from "@/lib/datetime";
import type { TodoDoc } from "@/types/firestore";
import DictationMicButton from "@/app/(protected)/_components/DictationMicButton";
import { insertTextAtSelection, prepareDictationTextForInsertion } from "@/lib/textInsert";
import Modal from "../../../Modal";

function safeItemId() {
  return `it_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

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

function todoToAssistantText(todo: TodoDoc): string {
  const title = typeof todo.title === "string" && todo.title.trim() ? todo.title.trim() : "ToDo";
  const active = Array.isArray(todo.items) ? todo.items.filter((it) => it?.done !== true) : [];
  const done = Array.isArray(todo.items) ? todo.items.filter((it) => it?.done === true) : [];
  const lines = [title, "", "Éléments actifs:"];
  if (active.length === 0) lines.push("- Aucun");
  for (const item of active) {
    const text = typeof item?.text === "string" ? item.text.trim() : "";
    if (text) lines.push(`- ${text}`);
  }
  if (done.length > 0) {
    lines.push("", "Terminés:");
    for (const item of done) {
      const text = typeof item?.text === "string" ? item.text.trim() : "";
      if (text) lines.push(`- ${text}`);
    }
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
  const title = cleanedTitle || fallbackTitle || "ToDo";

  const bulletItems = lines
    .slice(1)
    .map((line) => line.replace(/^[-*•\d.\s)]+/, "").trim())
    .filter((line) => line.length > 0 && !/^éléments actifs:?$/i.test(line) && !/^terminés:?$/i.test(line) && !/^aucun$/i.test(line));

  const uniq = Array.from(new Set(bulletItems)).slice(0, 60);
  const items = uniq.map((text) => ({ id: safeItemId(), text, done: false, createdAt: Date.now() }));
  return { title, items };
}

export default function TodoDetailModal(props: { params: Promise<{ id: string }> }) {
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

  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const itemInputRef = useRef<HTMLInputElement | null>(null);

  const [dictationStatus, setDictationStatus] = useState<"idle" | "listening" | "stopped" | "error">("idle");
  const [dictationError, setDictationError] = useState<string | null>(null);
  const [itemDictationStatus, setItemDictationStatus] = useState<"idle" | "listening" | "stopped" | "error">("idle");
  const [itemDictationError, setItemDictationError] = useState<string | null>(null);

  const [optionsOpen, setOptionsOpen] = useState(false);
  const [dueDateDraft, setDueDateDraft] = useState("");
  const [priorityDraft, setPriorityDraft] = useState<"" | NonNullable<TodoDoc["priority"]>>("");
  const [assistantMenuOpen, setAssistantMenuOpen] = useState(false);
  const [assistantBusyAction, setAssistantBusyAction] = useState<AssistantActionId | null>(null);
  const [assistantInfo, setAssistantInfo] = useState<string | null>(null);
  const [assistantError, setAssistantError] = useState<string | null>(null);

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
      const nextItems = next.items ?? (todo.items ?? []);
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
      setEditError(e instanceof Error ? e.message : "Erreur lors de la mise à jour.");
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
      setTitleDraft("ToDo");
      await persistTodo({ title: "ToDo" });
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

  const runAssistantAction = async (actionId: AssistantActionId) => {
    if (!todo) return;
    if (assistantBusyAction) return;

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

      const source = todoToAssistantText(todo);
      const response = await fn({ text: source, instruction: action.instruction });
      const transformed = typeof response.data?.text === "string" ? response.data.text.trim() : "";
      if (!transformed) {
        throw new Error("Réponse IA vide.");
      }

      const parsed = parseAssistantTodoText(transformed, todo.title);
      if (parsed.items.length === 0) {
        throw new Error("Aucun élément exploitable détecté.");
      }

      await persistTodo({ title: parsed.title, items: parsed.items, completed: false });
      setAssistantInfo(`${action.label} appliqué.`);
    } catch (e) {
      if (e instanceof FirebaseError) setAssistantError(`${e.code}: ${e.message}`);
      else if (e instanceof Error) setAssistantError(e.message);
      else setAssistantError("Impossible d’appliquer l’action assistant.");
    } finally {
      setAssistantBusyAction(null);
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
      setEditError(e instanceof Error ? e.message : "Erreur lors de la suppression.");
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

            <div className="sn-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <input
                      ref={titleInputRef}
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
                      className="flex-1 w-full bg-transparent text-sm font-semibold outline-none"
                      aria-label="Titre de la ToDo"
                      disabled={saving}
                    />
                    <DictationMicButton
                      disabled={saving}
                      onFinalText={(rawText) => {
                        const el = titleInputRef.current;
                        const insert = prepareDictationTextForInsertion({
                          value: todo.title,
                          selectionStart: el?.selectionStart ?? null,
                          rawText,
                        });
                        if (!insert) return;
                        const { nextValue, nextCursor } = insertTextAtSelection({
                          value: todo.title,
                          selectionStart: el?.selectionStart ?? null,
                          selectionEnd: el?.selectionEnd ?? null,
                          text: insert,
                        });
                        setTitleDraft(nextValue);
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
                  <div className="text-xs text-muted-foreground">
                    Actifs: {activeItems.length} · Terminés: {doneItems.length}
                  </div>
                </div>

                <div className="shrink-0 flex items-center gap-2">
                  <button type="button" onClick={close} className="sn-icon-btn" aria-label="Fermer" title="Fermer">
                    ×
                  </button>
                </div>
              </div>

              <div className="rounded-md border border-border/70 bg-background/40 px-2 py-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground mr-1">Assistant</span>
                  <button
                    type="button"
                    className="px-2 py-1 rounded border border-border text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                    disabled={saving || !!assistantBusyAction}
                    onClick={() => void runAssistantAction("summary")}
                  >
                    {assistantBusyAction === "summary" ? "Résumé…" : "Résumer"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 rounded border border-border text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                    disabled={saving || !!assistantBusyAction}
                    onClick={() => void runAssistantAction("correction")}
                  >
                    {assistantBusyAction === "correction" ? "Correction…" : "Correction"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 rounded border border-border text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                    disabled={saving || !!assistantBusyAction}
                    onClick={() => void runAssistantAction("structure")}
                  >
                    {assistantBusyAction === "structure" ? "Structure…" : "Structurer"}
                  </button>

                  <div className="relative">
                    <button
                      type="button"
                      className="px-2 py-1 rounded border border-border text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                      disabled={saving || !!assistantBusyAction}
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
                      onBlur={() => void commitDueDate()}
                      className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      disabled={saving}
                    />
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

              <div className="sn-card sn-card--muted p-3">
                <div className="flex items-center gap-2">
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
                    className="sn-text-btn"
                    onClick={() => void addItem()}
                    disabled={saving || !newItemText.trim()}
                  >
                    Ajouter
                  </button>
                </div>
                {itemDictationStatus === "listening" ? (
                  <div className="mt-2 text-xs text-muted-foreground">Écoute…</div>
                ) : itemDictationError ? (
                  <div className="mt-2 text-xs text-destructive">{itemDictationError}</div>
                ) : null}
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
