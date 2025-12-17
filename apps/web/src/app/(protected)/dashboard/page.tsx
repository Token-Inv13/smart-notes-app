"use client";

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
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
import type { NoteDoc, TaskDoc } from '@/types/firestore';

const newNoteSchema = z.object({
  title: z.string().min(1, 'Le titre est requis.'),
  content: z.string().min(1, 'Le contenu est requis.'),
});

const newTaskSchema = z.object({
  title: z.string().min(1, 'Le titre est requis.'),
  dueDate: z.string().optional(),
});

export default function DashboardPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspaceId') || undefined;

  const {
    data: notes,
    loading: notesLoading,
    error: notesError,
  } = useUserNotes({ workspaceId, limit: 5 });

  const {
    data: tasks,
    loading: tasksLoading,
    error: tasksError,
  } = useUserTasks({ workspaceId, limit: 5 });

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
        <h2 className="text-lg font-semibold mb-2">Recent notes</h2>
        {notesLoading && <p>Loading notes...</p>}
        {notesError && <p>Error loading notes: {notesError.message}</p>}
        {noteActionError && <p className="text-sm text-destructive">{noteActionError}</p>}
        {!notesLoading && !notesError && notes.length === 0 && <p>No notes yet.</p>}
        <ul className="space-y-1">
          {notes.map((note) => {
            const isEditing = !!note.id && note.id === editingNoteId;
            return (
              <li key={note.id} className="border border-border rounded-md p-2">
                {!isEditing ? (
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium truncate">{note.title}</div>
                    <div className="flex items-center gap-2">
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
        <h2 className="text-lg font-semibold mb-2">Upcoming tasks</h2>
        {tasksLoading && <p>Loading tasks...</p>}
        {tasksError && <p>Error loading tasks: {tasksError.message}</p>}
        {taskActionError && <p className="text-sm text-destructive">{taskActionError}</p>}
        {!tasksLoading && !tasksError && tasks.length === 0 && <p>No tasks yet.</p>}
        <ul className="space-y-1">
          {tasks.map((task) => {
            const isEditing = !!task.id && task.id === editingTaskId;
            return (
              <li key={task.id} className="border border-border rounded-md p-2">
                {!isEditing ? (
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium truncate">{task.title}</div>
                    <div className="flex items-center gap-2">
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
