"use client";

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
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

export default function DashboardPage() {
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
              return (
                <li
                  key={note.id}
                  className={`sn-card sn-card--note ${note.favorite ? " sn-card--favorite" : ""} p-4 relative ${
                    note.id ? "cursor-pointer" : ""
                  }`}
                >
                  <div className="space-y-3">
                    {note.id && (
                      <Link
                        href={`/notes/${encodeURIComponent(note.id)}${suffix}`}
                        aria-label={`Ouvrir la note ${note.title}`}
                        className="absolute inset-0"
                      />
                    )}
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
              const dueLabel = formatFrDateTime(task.dueDate ?? null);
              return (
                <li
                  key={task.id}
                  className={`sn-card sn-card--task ${task.favorite ? " sn-card--favorite" : ""} p-4 relative ${
                    task.id ? "cursor-pointer" : ""
                  }`}
                >
                  <div className="space-y-3">
                    {task.id && (
                      <Link
                        href={`/tasks/${encodeURIComponent(task.id)}${suffix}`}
                        aria-label={`Ouvrir la tâche ${task.title}`}
                        className="absolute inset-0"
                      />
                    )}
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
