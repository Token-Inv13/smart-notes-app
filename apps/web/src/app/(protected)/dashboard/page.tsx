"use client";

import { useUserNotes } from '@/hooks/useUserNotes';
import { useUserTasks } from '@/hooks/useUserTasks';

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

  return (
    <div className="space-y-8">
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
