"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import type { TouchEvent as ReactTouchEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useUserNotes } from '@/hooks/useUserNotes';
import { useUserTasks } from '@/hooks/useUserTasks';
import { useUserTodos } from '@/hooks/useUserTodos';
import { useUserWorkspaces } from '@/hooks/useUserWorkspaces';
import { useUserSettings } from '@/hooks/useUserSettings';
import { useUserInboxMessages } from '@/hooks/useUserInboxMessages';
import type { NoteDoc, TaskDoc, TodoDoc } from '@/types/firestore';
import Link from 'next/link';
import { trackEvent } from '@/lib/analytics';

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

function formatFrDate(ts?: unknown | null) {
  if (!ts) return '';
  const maybeTs = ts as { toDate?: () => Date };
  if (typeof maybeTs?.toDate !== 'function') return '';
  const d = maybeTs.toDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function priorityLabel(p?: TaskDoc['priority'] | TodoDoc['priority'] | null) {
  if (p === 'high') return 'Haute';
  if (p === 'medium') return 'Moyenne';
  if (p === 'low') return 'Basse';
  return '';
}

function priorityDotClass(p?: TaskDoc['priority'] | TodoDoc['priority'] | null) {
  if (p === 'high') return 'bg-red-500/80';
  if (p === 'medium') return 'bg-amber-500/80';
  if (p === 'low') return 'bg-emerald-500/80';
  return 'bg-muted-foreground/40';
}

function inboxSeverityClass(severity?: string | null) {
  if (severity === 'critical') return 'bg-rose-100 text-rose-700 border-rose-200';
  if (severity === 'warn') return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-sky-100 text-sky-700 border-sky-200';
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
  const { data: inboxMessages, loading: inboxLoading, error: inboxError } = useUserInboxMessages({ limit: 8 });
  const isPro = userSettings?.plan === 'pro';
  const freeLimitMessage = 'Limite Free atteinte. Passe en Pro pour épingler plus de favoris.';
  const [optimisticReadIds, setOptimisticReadIds] = useState<string[]>([]);

  const { data: favoriteNotesForLimit } = useUserNotes({ favoriteOnly: true, limit: 11 });
  const { data: favoriteTasksForLimit } = useUserTasks({ favoriteOnly: true, limit: 16 });
  const { data: favoriteTodos } = useUserTodos({ workspaceId, completed: false, favoriteOnly: true });

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

  const todoFavoriteCount = favoriteTodos.length;
  const notesFavoriteCount = activeFavoriteNotes.length;
  const tasksFavoriteCount = activeFavoriteTasks.length;

  const slidesContainerRef = useRef<HTMLDivElement | null>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [activeSlideIndex, setActiveSlideIndex] = useState<0 | 1 | 2>(0);
  const swipeStartRef = useRef<{ x: number; y: number; scrollLeft: number } | null>(null);

  const [flashMessage, setFlashMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.sessionStorage.getItem('smartnotes:flash');
      if (!raw) return;
      setFlashMessage(raw);
      window.sessionStorage.removeItem('smartnotes:flash');
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const root = slidesContainerRef.current;
    if (!root) return;

    const nodes = slideRefs.current;
    if (!nodes[0] || !nodes[1] || !nodes[2]) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        visible.sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const top = visible[0];
        if (!top) return;
        const indexAttr = (top.target as HTMLElement).getAttribute('data-slide-index');
        const idx = indexAttr ? Number(indexAttr) : 0;
        if (idx === 0 || idx === 1 || idx === 2) setActiveSlideIndex(idx);
      },
      {
        root,
        threshold: [0.5, 0.6, 0.7, 0.8],
      },
    );

    nodes.forEach((n) => n && observer.observe(n));
    return () => observer.disconnect();
  }, []);

  const scrollToSlide = (index: 0 | 1 | 2) => {
    slideRefs.current[index]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
  };

  const handleTouchStart = (e: ReactTouchEvent<HTMLDivElement>) => {
    const t = e.touches[0];
    if (!t) return;
    const root = slidesContainerRef.current;
    swipeStartRef.current = {
      x: t.clientX,
      y: t.clientY,
      scrollLeft: root?.scrollLeft ?? 0,
    };
  };

  const handleTouchEnd = (e: ReactTouchEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    const t = e.changedTouches[0];
    if (!start || !t) return;

    const root = slidesContainerRef.current;
    const nextScrollLeft = root?.scrollLeft ?? 0;
    if (Math.abs(nextScrollLeft - start.scrollLeft) > 20) return;

    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;

    if (Math.abs(dx) < 60) return;
    if (Math.abs(dx) < Math.abs(dy)) return;

    if (dx < 0) {
      const nextIndex = Math.min(2, activeSlideIndex + 1) as 0 | 1 | 2;
      if (nextIndex !== activeSlideIndex) scrollToSlide(nextIndex);
    } else {
      const nextIndex = Math.max(0, activeSlideIndex - 1) as 0 | 1 | 2;
      if (nextIndex !== activeSlideIndex) scrollToSlide(nextIndex);
    }
  };

  const [noteActionError, setNoteActionError] = useState<string | null>(null);
  const [taskActionError, setTaskActionError] = useState<string | null>(null);

  const unreadInboxMessages = useMemo(
    () =>
      inboxMessages.filter((m) => {
        if (m.readAt) return false;
        if (!m.id) return false;
        return !optimisticReadIds.includes(m.id);
      }),
    [inboxMessages, optimisticReadIds],
  );
  const activeInboxMessage = unreadInboxMessages[0] ?? null;

  const markInboxMessageRead = async (messageId: string) => {
    const uid = auth.currentUser?.uid;
    if (!uid || !messageId) return;
    setOptimisticReadIds((prev) => (prev.includes(messageId) ? prev : [...prev, messageId]));
    try {
      await updateDoc(doc(db, 'users', uid, 'inbox', messageId), {
        readAt: serverTimestamp(),
      });
      void trackEvent('user_inbox_message_read', {
        message_id_hint: messageId.slice(0, 6),
      });
    } catch (e) {
      setOptimisticReadIds((prev) => prev.filter((id) => id !== messageId));
      console.error('Error marking inbox message as read', e);
    }
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

  const toggleTodoFavorite = async (todo: TodoDoc) => {
    if (!todo.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== todo.userId) return;

    try {
      await updateDoc(doc(db, 'todos', todo.id), {
        userId: todo.userId,
        workspaceId: typeof todo.workspaceId === 'string' ? todo.workspaceId : null,
        title: todo.title,
        completed: todo.completed === true,
        favorite: !(todo.favorite === true),
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error('Error toggling todo favorite', e);
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

    const activeFavoriteCount = favoriteTasksForLimit.filter((t) => t.archived !== true).length;
    if (!isPro && task.favorite !== true && activeFavoriteCount >= 15) {
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
    <div className="space-y-6 min-h-[calc(100svh-2rem)]">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <div id="sn-create-slot" data-dashboard-slide-index={activeSlideIndex} />
      </header>

      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="inline-flex rounded-md border border-border bg-background overflow-hidden">
          <button
            type="button"
            onClick={() => scrollToSlide(0)}
            className={`px-3 py-1 text-sm ${activeSlideIndex === 0 ? 'bg-accent font-semibold' : ''}`}
          >
            Checklist ({todoFavoriteCount})
          </button>
          <button
            type="button"
            onClick={() => scrollToSlide(1)}
            className={`px-3 py-1 text-sm ${activeSlideIndex === 1 ? 'bg-accent font-semibold' : ''}`}
          >
            Notes ({notesFavoriteCount})
          </button>
          <button
            type="button"
            onClick={() => scrollToSlide(2)}
            className={`px-3 py-1 text-sm ${activeSlideIndex === 2 ? 'bg-accent font-semibold' : ''}`}
          >
            Agenda ({tasksFavoriteCount})
          </button>
        </div>
      </div>

      {flashMessage && (
        <div className="sn-alert sn-alert--info" role="status" aria-live="polite">
          {flashMessage}
        </div>
      )}

      {!inboxLoading && !inboxError && activeInboxMessage && activeInboxMessage.id && (
        <section className="fixed bottom-5 right-5 z-40 w-[min(92vw,360px)] rounded-2xl border border-border/70 bg-card/95 backdrop-blur shadow-2xl p-4 space-y-3 sn-animate-in">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <p className="text-xs text-muted-foreground">Message Smart Notes</p>
              <p className="text-sm font-semibold text-foreground truncate">{activeInboxMessage.title}</p>
            </div>
            <span
              className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium ${inboxSeverityClass(
                typeof activeInboxMessage.severity === 'string' ? activeInboxMessage.severity : 'info',
              )}`}
            >
              {typeof activeInboxMessage.severity === 'string' ? activeInboxMessage.severity : 'info'}
            </span>
          </div>

          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{activeInboxMessage.body}</p>

          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">{formatFrDateTime(activeInboxMessage.createdAt)}</p>
            <button
              type="button"
              onClick={() => markInboxMessageRead(activeInboxMessage.id!)}
              className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:opacity-95"
            >
              Marquer comme lu
            </button>
          </div>

          {unreadInboxMessages.length > 1 && (
            <p className="text-[11px] text-muted-foreground">+ {unreadInboxMessages.length - 1} autre(s) message(s)</p>
          )}
        </section>
      )}

      {!inboxLoading && inboxError && (
        <div className="sn-alert sn-alert--error">Impossible de charger les messages Smart Notes.</div>
      )}

      <div
        ref={slidesContainerRef}
        className="flex overflow-x-auto snap-x snap-mandatory gap-6"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={() => {
          swipeStartRef.current = null;
        }}
      >
        <div
          ref={(el) => {
            slideRefs.current[0] = el;
          }}
          data-slide-index="0"
          className="flex-none w-full snap-start"
        >
          <section>
            <h2 className="text-lg font-semibold mb-2">Ta checklist importante</h2>
            {favoriteTodos.length === 0 && (
              <div className="sn-empty">
                <div className="sn-empty-title">Aucun favori pour l’instant</div>
                <div className="sn-empty-desc">Depuis Checklist, épingle les éléments à garder sous la main ⭐.</div>
              </div>
            )}
            {favoriteTodos.length > 0 && (
              <ul className="space-y-1">
                {favoriteTodos.map((todo) => {
                  const href = todo.id ? `/todo/${encodeURIComponent(todo.id)}${suffix}` : null;
                  const dueLabel = todo.dueDate ? formatFrDate(todo.dueDate) : '';
                  const prioText = todo.priority ? priorityLabel(todo.priority) : '';
                  return (
                    <li
                      key={todo.id}
                      className={`sn-card sn-card--task ${todo.favorite ? " sn-card--favorite" : ""} p-4 ${href ? "cursor-pointer" : ""}`}
                      tabIndex={href ? 0 : undefined}
                      onClick={() => {
                        if (!href) return;
                        router.push(href);
                      }}
                      onKeyDown={(e) => {
                        if (!href) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          router.push(href);
                        }
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <label className="text-sm flex items-center gap-3 min-w-0">
                          <input
                            type="checkbox"
                            checked={todo.completed === true}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => toggleTodoCompleted(todo, e.target.checked)}
                            aria-label="Marquer comme terminée"
                          />
                          <span className="min-w-0">
                            <span className="truncate block">{todo.title}</span>
                            {(dueLabel || todo.priority) && (
                              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                {dueLabel && (
                                  <span className="inline-flex items-center gap-1">
                                    <span aria-hidden>📅</span>
                                    <span>{dueLabel}</span>
                                  </span>
                                )}
                                {todo.priority && (
                                  <span className="inline-flex items-center gap-1">
                                    <span className={`h-2 w-2 rounded-full ${priorityDotClass(todo.priority)}`} aria-hidden />
                                    <span>{prioText}</span>
                                  </span>
                                )}
                              </span>
                            )}
                          </span>
                        </label>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleTodoFavorite(todo);
                          }}
                          className="sn-icon-btn shrink-0"
                          aria-label={todo.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                          title={todo.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                        >
                          {todo.favorite ? "★" : "☆"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <div
          ref={(el) => {
            slideRefs.current[1] = el;
          }}
          data-slide-index="1"
          className="flex-none w-full snap-start"
        >
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
                {!isPro && noteActionError.includes('Limite Free atteinte') && (
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
                  const href = note.id
                    ? (() => {
                        const params = new URLSearchParams(suffix.startsWith("?") ? suffix.slice(1) : suffix);
                        params.set("noteId", note.id);
                        const qs = params.toString();
                        return qs ? `/notes?${qs}` : "/notes";
                      })()
                    : null;
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
        </div>

        <div
          ref={(el) => {
            slideRefs.current[2] = el;
          }}
          data-slide-index="2"
          className="flex-none w-full snap-start"
        >
          <section>
            <h2 className="text-lg font-semibold mb-2">Ton agenda important</h2>
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
            {tasksError && <div className="sn-alert sn-alert--error">Impossible de charger l’agenda favori.</div>}
            {taskActionError && (
              <div className="space-y-2">
                <div className="sn-alert sn-alert--error" role="status" aria-live="polite">
                  {taskActionError}
                </div>
                {!isPro && taskActionError.includes('Limite Free atteinte') && (
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
                <div className="sn-empty-desc">Depuis Agenda, épingle les priorités ⭐ pour les retrouver ici.</div>
              </div>
            )}
            {!tasksLoading && !tasksError && activeFavoriteTasks.length > 0 && (
              <ul className="space-y-1">
                {activeFavoriteTasks.map((task) => {
                  const href = task.id ? `/tasks/${encodeURIComponent(task.id)}${suffix}` : null;
                  const dueLabel = formatFrDateTime(task.dueDate ?? null);
                  const startLabel = formatFrDate(task.startDate ?? null);
                  const prioText = task.priority ? priorityLabel(task.priority) : '';
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
                              {startLabel && <span className="sn-badge">Début: {startLabel}</span>}
                              {dueLabel && <span className="sn-badge">Échéance: {dueLabel}</span>}
                              {task.priority && (
                                <span className="sn-badge inline-flex items-center gap-2">
                                  <span className={`h-2 w-2 rounded-full ${priorityDotClass(task.priority)}`} aria-hidden />
                                  <span>Priorité: {prioText}</span>
                                </span>
                              )}
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
      </div>
    </div>
  );
}
