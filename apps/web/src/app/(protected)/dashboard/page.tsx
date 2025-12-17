"use client";

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod';
import {
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
import type { NoteDoc, TaskDoc } from '@/types/firestore';

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
  content: z.string().min(1, 'Le contenu est requis.'),
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

  const activeFavoriteNotes = notes.filter((n) => n.completed !== true);
  const activeFavoriteTasks = tasks.filter((t) => (t.status ?? 'todo') !== 'done');

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
    setEditNoteContent(note.content);
    setNoteActionError(null);
  };

  const toggleNoteFavorite = async (note: NoteDoc) => {
    if (!note.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== note.userId) return;

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
        content: validation.data.content,
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

    try {
      await updateDoc(doc(db, 'tasks', task.id), {
        favorite: !task.favorite,
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
        dueDate: dueTimestamp,
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
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-semibold mb-2">Notes favorites</h2>
        {notesLoading && <p>Loading notes...</p>}
        {notesError && <p>Error loading notes: {notesError.message}</p>}
        {noteActionError && <p className="text-sm text-destructive">{noteActionError}</p>}
        {!notesLoading && !notesError && activeFavoriteNotes.length === 0 && <p>No notes yet.</p>}
        <ul className="space-y-1">
          {activeFavoriteNotes.map((note) => {
            const isEditing = !!note.id && note.id === editingNoteId;
            return (
              <li key={note.id} className="border border-border rounded-md p-2">
                {!isEditing ? (
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => note.id && router.push(`/notes/${encodeURIComponent(note.id)}${suffix}`)}
                      className="min-w-0 text-left text-sm font-medium truncate cursor-pointer hover:underline"
                      aria-label={`Ouvrir la note ${note.title}`}
                      disabled={!note.id}
                    >
                      <span className="truncate">{note.title}</span>
                      {note.workspaceId && typeof note.workspaceId === 'string' && (
                        <span className="ml-2 text-xs text-muted-foreground whitespace-nowrap">
                          {workspaceNameById.get(note.workspaceId) ?? note.workspaceId}
                        </span>
                      )}
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleNoteFavorite(note)}
                        className="text-xs underline"
                        aria-label={note.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                      >
                        {note.favorite ? '★' : '☆'}
                      </button>
                      <button
                        type="button"
                        onClick={() => startEditNote(note)}
                        className="text-xs underline"
                      >
                        Modifier
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteNote(note)}
                        className="text-xs underline text-destructive"
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
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Tâches favorites</h2>
        {tasksLoading && <p>Loading tasks...</p>}
        {tasksError && <p>Error loading tasks: {tasksError.message}</p>}
        {taskActionError && <p className="text-sm text-destructive">{taskActionError}</p>}
        {!tasksLoading && !tasksError && activeFavoriteTasks.length === 0 && <p>No tasks yet.</p>}
        <ul className="space-y-1">
          {activeFavoriteTasks.map((task) => {
            const isEditing = !!task.id && task.id === editingTaskId;
            const dueLabel = formatFrDateTime(task.dueDate ?? null);
            return (
              <li key={task.id} className="border border-border rounded-md p-2">
                {!isEditing ? (
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => task.id && router.push(`/tasks/${encodeURIComponent(task.id)}${suffix}`)}
                      className="min-w-0 text-left text-sm font-medium truncate cursor-pointer hover:underline"
                      aria-label={`Ouvrir la tâche ${task.title}`}
                      disabled={!task.id}
                    >
                      <span className="truncate">{task.title}</span>
                      {task.workspaceId && typeof task.workspaceId === 'string' && (
                        <span className="ml-2 text-xs text-muted-foreground whitespace-nowrap">
                          {workspaceNameById.get(task.workspaceId) ?? task.workspaceId}
                        </span>
                      )}
                      <span className="ml-2 text-xs text-muted-foreground whitespace-nowrap">
                        {dueLabel || 'Aucun rappel'}
                      </span>
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleTaskFavorite(task)}
                        className="text-xs underline"
                        aria-label={task.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                      >
                        {task.favorite ? '★' : '☆'}
                      </button>
                      <button
                        type="button"
                        onClick={() => startEditTask(task)}
                        className="text-xs underline"
                      >
                        Modifier
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteTask(task)}
                        className="text-xs underline text-destructive"
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
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
