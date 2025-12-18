"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { formatTimestampForInput, parseLocalDateTimeToTimestamp } from '@/lib/datetime';
import { useUserNotes } from '@/hooks/useUserNotes';
import { useUserTasks } from '@/hooks/useUserTasks';
import { useUserWorkspaces } from '@/hooks/useUserWorkspaces';
import { useUserSettings } from '@/hooks/useUserSettings';
import type { NoteDoc, TaskDoc } from '@/types/firestore';
import Link from 'next/link';
import { getOnboardingFlag, setOnboardingFlag } from '@/lib/onboarding';

function formatFrDateTime(ts?: { toDate: () => Date } | null) {
  if (!ts) return '';
  const d = ts.toDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

const newNoteSchema = z.object({
  title: z.string().min(1, 'Le titre est requis.'),
  content: z.string().optional(),
});

const newTaskSchema = z.object({
  title: z.string().min(1, 'Le titre est requis.'),
  dueDate: z.string().optional(),
});

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

  const { data: workspaces } = useUserWorkspaces();

  const { data: anyNotes, loading: anyNotesLoading } = useUserNotes({ workspaceId, limit: 1 });
  const { data: anyTasks, loading: anyTasksLoading } = useUserTasks({ workspaceId, limit: 1 });

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

  const activeFavoriteNotes = notes.filter((n) => n.completed !== true);
  const activeFavoriteTasks = tasks.filter((t) => (t.status ?? 'todo') !== 'done');

  const userId = auth.currentUser?.uid;
  const hasAnyContent = (anyNotes?.length ?? 0) > 0 || (anyTasks?.length ?? 0) > 0;
  const emptyStateReady = !anyNotesLoading && !anyTasksLoading;
  const shouldShowWelcome = emptyStateReady && !hasAnyContent;

  const preferredWorkspaceId = useMemo(() => {
    if (workspaceId) return workspaceId;
    const first = workspaces.find((w) => !!w.id)?.id;
    return first || '';
  }, [workspaceId, workspaces]);

  const notesCreateHref = preferredWorkspaceId
    ? `/notes?workspaceId=${encodeURIComponent(preferredWorkspaceId)}&create=1`
    : '/notes?create=1';

  const tasksCreateHref = preferredWorkspaceId
    ? `/tasks?workspaceId=${encodeURIComponent(preferredWorkspaceId)}&create=1`
    : '/tasks?create=1';

  useEffect(() => {
    if (!userId) return;
    if (!emptyStateReady) return;
    if (hasAnyContent) {
      if (!getOnboardingFlag(userId, 'welcome_dismissed')) {
        setOnboardingFlag(userId, 'welcome_dismissed', true);
      }
      return;
    }

    const alreadySeeded = getOnboardingFlag(userId, 'seed_v1');
    if (alreadySeeded) return;
    if (!preferredWorkspaceId) return;

    const seed = async () => {
      try {
        await addDoc(collection(db, 'notes'), {
          userId,
          workspaceId: preferredWorkspaceId,
          title: 'Bienvenue 👋',
          content:
            "Tu peux commencer en écrivant une note rapide ici.\n\nAstuce : utilise les favoris ⭐ pour retrouver l’essentiel.",
          favorite: true,
          completed: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        await addDoc(collection(db, 'tasks'), {
          userId,
          workspaceId: preferredWorkspaceId,
          title: 'Ta première tâche',
          status: 'todo',
          dueDate: null,
          favorite: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        setOnboardingFlag(userId, 'seed_v1', true);
      } catch (e) {
        console.error('Error seeding onboarding content', e);
      }
    };

    seed();
  }, [userId, emptyStateReady, hasAnyContent, preferredWorkspaceId]);

  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteTitle, setEditNoteTitle] = useState('');
  const [editNoteContent, setEditNoteContent] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [noteActionError, setNoteActionError] = useState<string | null>(null);

  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTaskTitle, setEditTaskTitle] = useState('');
  const [editTaskDueDate, setEditTaskDueDate] = useState('');
  const [savingTask, setSavingTask] = useState(false);
  const [taskActionError, setTaskActionError] = useState<string | null>(null);

  const startEditNote = (note: NoteDoc) => {
    setEditingNoteId(note.id ?? null);
    setEditNoteTitle(note.title);
    setEditNoteContent(note.content ?? '');
    setNoteActionError(null);
  };

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

  const cancelEditNote = () => {
    setEditingNoteId(null);
    setEditNoteTitle('');
    setEditNoteContent('');
    setNoteActionError(null);
  };

  const handleSaveNote = async (note: NoteDoc) => {
    if (!note.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== note.userId) {
      setNoteActionError('Impossible de modifier cette note.');
      return;
    }

    setNoteActionError(null);
    const validation = newNoteSchema.safeParse({ title: editNoteTitle, content: editNoteContent });
    if (!validation.success) {
      setNoteActionError(validation.error.issues[0]?.message ?? 'Données invalides.');
      return;
    }

    setSavingNote(true);
    try {
      await updateDoc(doc(db, 'notes', note.id), {
        title: validation.data.title,
        content: validation.data.content ?? '',
        workspaceId: typeof note.workspaceId === 'string' ? note.workspaceId : null,
        favorite: note.favorite === true,
        completed: note.completed === true,
        updatedAt: serverTimestamp(),
      });
      cancelEditNote();
    } catch (e) {
      console.error('Error updating note', e);
      setNoteActionError('Erreur lors de la modification de la note.');
    } finally {
      setSavingNote(false);
    }
  };

  const handleDeleteNote = async (note: NoteDoc) => {
    if (!note.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== note.userId) return;
    if (!confirm('Supprimer cette note ?')) return;

    setNoteActionError(null);
    try {
      await deleteDoc(doc(db, 'notes', note.id));
      if (editingNoteId === note.id) {
        cancelEditNote();
      }
    } catch (e) {
      console.error('Error deleting note', e);
      setNoteActionError('Erreur lors de la suppression de la note.');
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

  const startEditTask = (task: TaskDoc) => {
    setEditingTaskId(task.id ?? null);
    setEditTaskTitle(task.title);
    setEditTaskDueDate(formatTimestampForInput(task.dueDate ?? null));
    setTaskActionError(null);
  };

  const cancelEditTask = () => {
    setEditingTaskId(null);
    setEditTaskTitle('');
    setEditTaskDueDate('');
    setTaskActionError(null);
  };

  const handleSaveTask = async (task: TaskDoc) => {
    if (!task.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== task.userId) {
      setTaskActionError('Impossible de modifier cette tâche.');
      return;
    }

    setTaskActionError(null);
    const validation = newTaskSchema.safeParse({
      title: editTaskTitle,
      dueDate: editTaskDueDate || undefined,
    });
    if (!validation.success) {
      setTaskActionError(validation.error.issues[0]?.message ?? 'Données invalides.');
      return;
    }

    const dueTimestamp = validation.data.dueDate
      ? parseLocalDateTimeToTimestamp(validation.data.dueDate)
      : null;

    setSavingTask(true);
    try {
      await updateDoc(doc(db, 'tasks', task.id), {
        title: validation.data.title,
        status: (task.status ?? 'todo') as TaskDoc['status'],
        workspaceId: typeof task.workspaceId === 'string' ? task.workspaceId : null,
        dueDate: dueTimestamp,
        favorite: task.favorite === true,
        updatedAt: serverTimestamp(),
      });
      cancelEditTask();
    } catch (e) {
      console.error('Error updating task', e);
      setTaskActionError('Erreur lors de la modification de la tâche.');
    } finally {
      setSavingTask(false);
    }
  };

  const handleDeleteTask = async (task: TaskDoc) => {
    if (!task.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== task.userId) return;
    if (!confirm('Supprimer cette tâche ?')) return;

    setTaskActionError(null);
    try {
      await deleteDoc(doc(db, 'tasks', task.id));
      if (editingTaskId === task.id) {
        cancelEditTask();
      }
    } catch (e) {
      console.error('Error deleting task', e);
      setTaskActionError('Erreur lors de la suppression de la tâche.');
    }
  };

  return (
    <div className="space-y-6">
      {shouldShowWelcome && (
        <section className="sn-card p-6">
          <div className="space-y-3">
            <div className="text-sm font-semibold">Bienvenue 👋</div>
            <div className="text-sm text-muted-foreground">
              Commence en moins d’une minute : capture une note ou planifie une tâche. Un exemple a été ajouté pour te
              guider.
            </div>

            {!preferredWorkspaceId && (
              <div className="text-sm text-muted-foreground">
                Commence par créer un dossier dans la sidebar, puis reviens ici.
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2">
              <Link
                href={notesCreateHref}
                className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium"
              >
                Capturer une note
              </Link>
              <Link
                href={tasksCreateHref}
                className="inline-flex items-center justify-center px-4 py-2 rounded-md border border-input text-sm font-medium hover:bg-accent"
              >
                Planifier une tâche
              </Link>
            </div>
          </div>
        </section>
      )}

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
              const isEditing = !!note.id && note.id === editingNoteId;
              return (
                <li
                  key={note.id}
                  className={`sn-card sn-card--note ${note.favorite ? " sn-card--favorite" : ""} p-4`}
                >
                  {!isEditing ? (
                    <div className="space-y-3">
                      <div className="sn-card-header">
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() =>
                              note.id && router.push(`/notes/${encodeURIComponent(note.id)}${suffix}`)
                            }
                            className="min-w-0 text-left"
                            aria-label={`Ouvrir la note ${note.title}`}
                            disabled={!note.id}
                          >
                            <div className="sn-card-title truncate">{note.title}</div>
                            <div className="sn-card-meta">
                              {note.workspaceId && typeof note.workspaceId === "string" && (
                                <span className="sn-badge">
                                  {workspaceNameById.get(note.workspaceId) ?? note.workspaceId}
                                </span>
                              )}
                              {note.favorite && <span className="sn-badge">Favori</span>}
                            </div>
                          </button>
                        </div>

                        <div className="sn-card-actions sn-card-actions-secondary shrink-0">
                          <button
                            type="button"
                            onClick={() => toggleNoteFavorite(note)}
                            className="sn-icon-btn"
                            aria-label={note.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                            title={note.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                          >
                            {note.favorite ? "★" : "☆"}
                          </button>
                        </div>
                      </div>

                      <div className="sn-card-actions sn-card-actions-secondary">
                        <button type="button" onClick={() => startEditNote(note)} className="sn-text-btn">
                          Modifier
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteNote(note)}
                          className="sn-text-btn text-destructive"
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <input
                        value={editNoteTitle}
                        onChange={(e) => setEditNoteTitle(e.target.value)}
                        aria-label="Titre de la note"
                        placeholder="Titre"
                        className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                      />
                      <textarea
                        value={editNoteContent}
                        onChange={(e) => setEditNoteContent(e.target.value)}
                        aria-label="Contenu de la note"
                        placeholder="Contenu"
                        className="w-full min-h-[80px] px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={savingNote}
                          onClick={() => handleSaveNote(note)}
                          className="px-3 py-1 rounded-md bg-primary text-primary-foreground text-xs disabled:opacity-50"
                        >
                          {savingNote ? 'Enregistrement…' : 'Enregistrer'}
                        </button>
                        <button
                          type="button"
                          disabled={savingNote}
                          onClick={cancelEditNote}
                          className="px-3 py-1 rounded-md border border-input text-xs disabled:opacity-50"
                        >
                          Annuler
                        </button>
                      </div>

                      <div className="sn-card-actions sn-card-actions-secondary">
                        <button type="button" onClick={() => toggleNoteFavorite(note)} className="sn-text-btn">
                          {note.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteNote(note)}
                          className="sn-text-btn text-destructive"
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
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
              const isEditing = !!task.id && task.id === editingTaskId;
              const dueLabel = formatFrDateTime(task.dueDate ?? null);
              return (
                <li
                  key={task.id}
                  className={`sn-card sn-card--task ${task.favorite ? " sn-card--favorite" : ""} p-4`}
                >
                  {!isEditing ? (
                    <div className="space-y-3">
                      <div className="sn-card-header">
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() =>
                              task.id && router.push(`/tasks/${encodeURIComponent(task.id)}${suffix}`)
                            }
                            className="min-w-0 text-left"
                            aria-label={`Ouvrir la tâche ${task.title}`}
                            disabled={!task.id}
                          >
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
                          </button>
                        </div>

                        <div className="sn-card-actions sn-card-actions-secondary shrink-0">
                          <button
                            type="button"
                            onClick={() => toggleTaskFavorite(task)}
                            className="sn-icon-btn"
                            aria-label={task.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                            title={task.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                          >
                            {task.favorite ? "★" : "☆"}
                          </button>
                        </div>
                      </div>

                      <div className="sn-card-actions sn-card-actions-secondary">
                        <button type="button" onClick={() => startEditTask(task)} className="sn-text-btn">
                          Modifier
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTask(task)}
                          className="sn-text-btn text-destructive"
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <input
                        value={editTaskTitle}
                        onChange={(e) => setEditTaskTitle(e.target.value)}
                        aria-label="Titre de la tâche"
                        placeholder="Titre"
                        className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                      />
                      <input
                        type="datetime-local"
                        value={editTaskDueDate}
                        onChange={(e) => setEditTaskDueDate(e.target.value)}
                        aria-label="Échéance de la tâche"
                        className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={savingTask}
                          onClick={() => handleSaveTask(task)}
                          className="px-3 py-1 rounded-md bg-primary text-primary-foreground text-xs disabled:opacity-50"
                        >
                          {savingTask ? 'Enregistrement…' : 'Enregistrer'}
                        </button>
                        <button
                          type="button"
                          disabled={savingTask}
                          onClick={cancelEditTask}
                          className="px-3 py-1 rounded-md border border-input text-xs disabled:opacity-50"
                        >
                          Annuler
                        </button>
                      </div>

                      <div className="sn-card-actions sn-card-actions-secondary">
                        <button type="button" onClick={() => toggleTaskFavorite(task)} className="sn-text-btn">
                          {task.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTask(task)}
                          className="sn-text-btn text-destructive"
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
