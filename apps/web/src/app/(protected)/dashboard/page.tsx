"use client";

import { useState } from 'react';
import { z } from 'zod';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { parseLocalDateTimeToTimestamp } from '@/lib/datetime';
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
  const {
    data: notes,
    loading: notesLoading,
    error: notesError,
  } = useUserNotes({ limit: 5 });

  const {
    data: tasks,
    loading: tasksLoading,
    error: tasksError,
  } = useUserTasks({ limit: 5 });

  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [noteCreating, setNoteCreating] = useState(false);
  const [noteCreateError, setNoteCreateError] = useState<string | null>(null);

  const [taskTitle, setTaskTitle] = useState('');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [taskCreating, setTaskCreating] = useState(false);
  const [taskCreateError, setTaskCreateError] = useState<string | null>(null);

  const handleCreateNote = async () => {
    const user = auth.currentUser;
    if (!user) {
      setNoteCreateError('Tu dois être connecté pour créer une note.');
      return;
    }

    setNoteCreateError(null);
    const validation = newNoteSchema.safeParse({ title: noteTitle, content: noteContent });
    if (!validation.success) {
      setNoteCreateError(validation.error.issues[0]?.message ?? 'Données invalides.');
      return;
    }

    setNoteCreating(true);
    try {
      const payload: Omit<NoteDoc, 'id'> = {
        userId: user.uid,
        workspaceId: null,
        title: validation.data.title,
        content: validation.data.content,
        createdAt: serverTimestamp() as unknown as NoteDoc['createdAt'],
        updatedAt: serverTimestamp() as unknown as NoteDoc['updatedAt'],
      };

      await addDoc(collection(db, 'notes'), payload);
      setNoteTitle('');
      setNoteContent('');
    } catch (e) {
      console.error('Error creating note', e);
      setNoteCreateError('Erreur lors de la création de la note.');
    } finally {
      setNoteCreating(false);
    }
  };

  const handleCreateTask = async () => {
    const user = auth.currentUser;
    if (!user) {
      setTaskCreateError('Tu dois être connecté pour créer une tâche.');
      return;
    }

    setTaskCreateError(null);
    const validation = newTaskSchema.safeParse({ title: taskTitle, dueDate: taskDueDate || undefined });
    if (!validation.success) {
      setTaskCreateError(validation.error.issues[0]?.message ?? 'Données invalides.');
      return;
    }

    const dueTimestamp = validation.data.dueDate
      ? parseLocalDateTimeToTimestamp(validation.data.dueDate)
      : null;

    setTaskCreating(true);
    try {
      const payload: Omit<TaskDoc, 'id'> = {
        userId: user.uid,
        workspaceId: null,
        title: validation.data.title,
        status: 'todo',
        dueDate: dueTimestamp,
        createdAt: serverTimestamp() as unknown as TaskDoc['createdAt'],
        updatedAt: serverTimestamp() as unknown as TaskDoc['updatedAt'],
      };

      await addDoc(collection(db, 'tasks'), payload);
      setTaskTitle('');
      setTaskDueDate('');
    } catch (e) {
      console.error('Error creating task', e);
      setTaskCreateError('Erreur lors de la création de la tâche.');
    } finally {
      setTaskCreating(false);
    }
  };

  return (
    <div className="space-y-8">
      <section className="grid gap-6 md:grid-cols-2">
        <div className="border border-border rounded-lg p-4 bg-card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Créer une note</h2>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="note-title">
                Titre
              </label>
              <input
                id="note-title"
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Ex: Idées pour demain"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="note-content">
                Contenu
              </label>
              <textarea
                id="note-content"
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                className="w-full min-h-[96px] px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Écris ta note…"
              />
            </div>

            {noteCreateError && (
              <p className="text-sm text-destructive" aria-live="polite">
                {noteCreateError}
              </p>
            )}

            <button
              type="button"
              disabled={noteCreating}
              onClick={handleCreateNote}
              className="w-full inline-flex items-center justify-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {noteCreating ? 'Création…' : 'Ajouter la note'}
            </button>
          </div>
        </div>

        <div className="border border-border rounded-lg p-4 bg-card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Créer une tâche</h2>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="task-title">
                Titre
              </label>
              <input
                id="task-title"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Ex: Appeler le client"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="task-due">
                Échéance (optionnel)
              </label>
              <input
                id="task-due"
                type="datetime-local"
                value={taskDueDate}
                onChange={(e) => setTaskDueDate(e.target.value)}
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {taskCreateError && (
              <p className="text-sm text-destructive" aria-live="polite">
                {taskCreateError}
              </p>
            )}

            <button
              type="button"
              disabled={taskCreating}
              onClick={handleCreateTask}
              className="w-full inline-flex items-center justify-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {taskCreating ? 'Création…' : 'Ajouter la tâche'}
            </button>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Recent notes</h2>
        {notesLoading && <p>Loading notes...</p>}
        {notesError && <p>Error loading notes: {notesError.message}</p>}
        {!notesLoading && !notesError && notes.length === 0 && <p>No notes yet.</p>}
        <ul className="space-y-1">
          {notes.map((note) => (
            <li key={note.id}>{note.title}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Upcoming tasks</h2>
        {tasksLoading && <p>Loading tasks...</p>}
        {tasksError && <p>Error loading tasks: {tasksError.message}</p>}
        {!tasksLoading && !tasksError && tasks.length === 0 && <p>No tasks yet.</p>}
        <ul className="space-y-1">
          {tasks.map((task) => (
            <li key={task.id}>{task.title}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
