"use client";

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useUserNotes } from '@/hooks/useUserNotes';
import { useUserTasks } from '@/hooks/useUserTasks';
import { useUserTodos } from '@/hooks/useUserTodos';
import { useUserWorkspaces } from '@/hooks/useUserWorkspaces';
import { useUserSettings } from '@/hooks/useUserSettings';
import type { NoteDoc, TaskDoc, TodoDoc } from '@/types/firestore';
import Link from 'next/link';

function formatFrDateTime(ts?: unknown | null) {
  if (!ts) return '';
  const maybeTs = ts as { toDate?: () => Date };
  if (typeof maybeTs?.toDate !== 'function') return '';
  const d = maybeTs.toDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

export default function DashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspaceId') || undefined;
  const suffix = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';

  const {
    data: notes,
    loading: notesLoading,
    error: notesError,
  } = useUserNotes({ workspaceId, favoriteOnly: true, limit: 20 });

  const { data: userSettings } = useUserSettings();
  const isPro = userSettings?.plan === 'pro';
  const freeLimitMessage = 'Limite Free atteinte. Passe en Pro pour épingler plus de favoris.';

  const { data: favoriteNotesForLimit } = useUserNotes({ favoriteOnly: true, limit: 11 });
  const { data: favoriteTasksForLimit } = useUserTasks({ favoriteOnly: true, limit: 16 });
  const { data: favoriteTodos } = useUserTodos({ favoriteOnly: true, completed: false, limit: 50 });

  const { data: workspaces } = useUserWorkspaces();

  const workspaceNameById = useMemo(() => {
    const m = new Map<string, string>();
    workspaces.forEach((w) => {
      if (w.id && w.name) m.set(w.id, w.name);
    });
    return m;
  }, [workspaces]);

  const {
    data: tasks,
    loading: tasksLoading,
    error: tasksError,
  } = useUserTasks({ workspaceId, favoriteOnly: true, limit: 20 });

  const activeFavoriteNotes = notes.filter((n) => n.completed !== true && n.archived !== true);
  const activeFavoriteTasks = tasks.filter((t) => (t.status ?? 'todo') !== 'done' && t.archived !== true);

  const [noteActionError, setNoteActionError] = useState<string | null>(null);
  const [taskActionError, setTaskActionError] = useState<string | null>(null);

  const toggleNoteFavorite = async (note: NoteDoc) => {
    if (!note.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== note.userId) return;

    if (!isPro && note.favorite !== true && favoriteNotesForLimit.length >= 10) {
      setNoteActionError(freeLimitMessage);
      return;
    }

    try {
      await updateDoc(doc(db, 'notes', note.id), {
        favorite: !note.favorite,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error('Error toggling note favorite', e);
    }
  };

  const toggleTodoCompleted = async (todo: TodoDoc, nextCompleted: boolean) => {
    if (!todo.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== todo.userId) return;

    try {
      await updateDoc(doc(db, 'todos', todo.id), {
        userId: todo.userId,
        workspaceId: typeof todo.workspaceId === 'string' ? todo.workspaceId : null,
        title: todo.title,
        favorite: todo.favorite === true,
        completed: nextCompleted,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error('Error toggling todo completed', e);
    }
  };

  const toggleTaskFavorite = async (task: TaskDoc) => {
    if (!task.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== task.userId) return;

    if (!isPro && task.favorite !== true && favoriteTasksForLimit.length >= 15) {
      setTaskActionError(freeLimitMessage);
      return;
    }

    try {
      await updateDoc(doc(db, 'tasks', task.id), {
        title: task.title,
        status: (task.status ?? 'todo') as TaskDoc['status'],
        workspaceId: typeof task.workspaceId === 'string' ? task.workspaceId : null,
        dueDate: task.dueDate ?? null,
        favorite: !(task.favorite === true),
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error('Error toggling task favorite', e);
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold mb-2">Tes notes importantes</h2>
        {notesLoading && (
          <div className="sn-empty sn-animate-in">
            <div className="space-y-3">
              <div className="mx-auto sn-skeleton-avatar" />
              <div className="sn-skeleton-title w-40 mx-auto" />
              <div className="sn-skeleton-line w-64 mx-auto" />
              <div className="sn-skeleton-line w-56 mx-auto" />
            </div>
          </div>
        )}
        {notesError && <div className="sn-alert sn-alert--error">Impossible de charger les notes favorites.</div>}
        {noteActionError && (
          <div className="space-y-2">
            <div className="sn-alert sn-alert--error" role="status" aria-live="polite">
              {noteActionError}
            </div>
            {noteActionError.includes('Limite Free atteinte') && (
              <Link
                href="/upgrade"
                className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium"
              >
                Débloquer Pro
              </Link>
            )}
          </div>
        )}
        {!notesLoading && !notesError && activeFavoriteNotes.length === 0 && (
          <div className="sn-empty">
            <div className="sn-empty-title">Aucun favori pour l’instant</div>
            <div className="sn-empty-desc">Depuis Notes, épingle les éléments à garder sous la main ⭐.</div>
          </div>
        )}
        {!notesLoading && !notesError && activeFavoriteNotes.length > 0 && (
          <ul className="space-y-1">
            {activeFavoriteNotes.map((note) => {
              const href = note.id ? `/notes/${encodeURIComponent(note.id)}${suffix}` : null;
              return (
                <li
                  key={note.id}
                  className={`sn-card sn-card--note ${note.favorite ? " sn-card--favorite" : ""} p-4 relative ${
                    note.id ? "cursor-pointer" : ""
                  }`}
                  tabIndex={href ? 0 : undefined}
                  onClick={() => {
                    if (!href) return;
                    router.push(href);
                  }}
                  onKeyDown={(e) => {
                    if (!href) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      router.push(href);
                    }
                  }}
                >
                  <div className="space-y-3">
                    <div className="sn-card-header">
                      <div className="min-w-0 relative z-10">
                        <div className="sn-card-title truncate">{note.title}</div>
                        <div className="sn-card-meta">
                          {note.workspaceId && typeof note.workspaceId === "string" && (
                            <span className="sn-badge">
                              {workspaceNameById.get(note.workspaceId) ?? note.workspaceId}
                            </span>
                          )}
                          {note.favorite && <span className="sn-badge">Favori</span>}
                        </div>
                      </div>

                      <div className="sn-card-actions sn-card-actions-secondary shrink-0 relative z-20">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleNoteFavorite(note);
                          }}
                          className="sn-icon-btn"
                          aria-label={note.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                          title={note.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                        >
                          {note.favorite ? "★" : "☆"}
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Tes ToDo importantes</h2>
        {favoriteTodos.length === 0 && (
          <div className="sn-empty">
            <div className="sn-empty-title">Aucun favori pour l’instant</div>
            <div className="sn-empty-desc">Depuis ToDo, épingle les éléments à garder sous la main ⭐.</div>
          </div>
        )}
        {favoriteTodos.length > 0 && (
          <ul className="space-y-1">
            {favoriteTodos.map((todo) => (
              <li key={todo.id} className="sn-card sn-card--task sn-card--favorite p-4">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-sm flex items-center gap-3 min-w-0">
                    <input
                      type="checkbox"
                      checked={todo.completed === true}
                      onChange={(e) => toggleTodoCompleted(todo, e.target.checked)}
                      aria-label="Marquer comme terminée"
                    />
                    <span className="truncate">{todo.title}</span>
                  </label>
                  <span className="sn-badge">Favori</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Tes tâches importantes</h2>
        {tasksLoading && (
          <div className="sn-empty sn-animate-in">
            <div className="space-y-3">
              <div className="mx-auto sn-skeleton-avatar" />
              <div className="sn-skeleton-title w-40 mx-auto" />
              <div className="sn-skeleton-line w-64 mx-auto" />
              <div className="sn-skeleton-line w-56 mx-auto" />
            </div>
          </div>
        )}
        {tasksError && <div className="sn-alert sn-alert--error">Impossible de charger les tâches favorites.</div>}
        {taskActionError && (
          <div className="space-y-2">
            <div className="sn-alert sn-alert--error" role="status" aria-live="polite">
              {taskActionError}
            </div>
            {taskActionError.includes('Limite Free atteinte') && (
              <Link
                href="/upgrade"
                className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium"
              >
                Débloquer Pro
              </Link>
            )}
          </div>
        )}
        {!tasksLoading && !tasksError && activeFavoriteTasks.length === 0 && (
          <div className="sn-empty">
            <div className="sn-empty-title">Aucun favori pour l’instant</div>
            <div className="sn-empty-desc">Depuis Tâches, épingle les priorités ⭐ pour les retrouver ici.</div>
          </div>
        )}
        {!tasksLoading && !tasksError && activeFavoriteTasks.length > 0 && (
          <ul className="space-y-1">
            {activeFavoriteTasks.map((task) => {
              const href = task.id ? `/tasks/${encodeURIComponent(task.id)}${suffix}` : null;
              const dueLabel = formatFrDateTime(task.dueDate ?? null);
              return (
                <li
                  key={task.id}
                  className={`sn-card sn-card--task ${task.favorite ? " sn-card--favorite" : ""} p-4 relative ${
                    task.id ? "cursor-pointer" : ""
                  }`}
                  tabIndex={href ? 0 : undefined}
                  onClick={() => {
                    if (!href) return;
                    router.push(href);
                  }}
                  onKeyDown={(e) => {
                    if (!href) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      router.push(href);
                    }
                  }}
                >
                  <div className="space-y-3">
                    <div className="sn-card-header">
                      <div className="min-w-0 relative z-10">
                        <div className="sn-card-title truncate">{task.title}</div>
                        <div className="sn-card-meta">
                          {task.workspaceId && typeof task.workspaceId === "string" && (
                            <span className="sn-badge">
                              {workspaceNameById.get(task.workspaceId) ?? task.workspaceId}
                            </span>
                          )}
                          <span className="sn-badge">{dueLabel || "Aucun rappel"}</span>
                          {task.favorite && <span className="sn-badge">Favori</span>}
                        </div>
                      </div>

                      <div className="sn-card-actions sn-card-actions-secondary shrink-0 relative z-20">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleTaskFavorite(task);
                          }}
                          className="sn-icon-btn"
                          aria-label={task.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                          title={task.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                        >
                          {task.favorite ? "★" : "☆"}
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
