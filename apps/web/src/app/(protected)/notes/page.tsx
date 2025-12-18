"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { z } from "zod";
import { FirebaseError } from "firebase/app";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useUserNotes } from "@/hooks/useUserNotes";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useUserWorkspaces } from "@/hooks/useUserWorkspaces";
import type { NoteDoc } from "@/types/firestore";
import Link from "next/link";
import { getOnboardingFlag, setOnboardingFlag } from "@/lib/onboarding";

const newNoteSchema = z.object({
  title: z.string().min(1, "Le titre est requis."),
  content: z.string().optional(),
});

export default function NotesPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId") || undefined;
  const createParam = searchParams.get("create");
  const { data: workspaces } = useUserWorkspaces();

  const [viewMode, setViewMode] = useState<"list" | "grid">("list");

  const { data: userSettings } = useUserSettings();
  const isPro = userSettings?.plan === "pro";
  const freeLimitMessage =
    "Limite Free atteinte. Tu peux passer en Pro pour créer plus de notes et utiliser les favoris sans limite.";

  const { data: notes, loading, error } = useUserNotes({ workspaceId });
  const { data: allNotesForLimit } = useUserNotes({ limit: 16 });
  const { data: favoriteNotesForLimit } = useUserNotes({ favoriteOnly: true, limit: 11 });

  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [noteWorkspaceId, setNoteWorkspaceId] = useState<string>(workspaceId ?? "");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);

  const userId = auth.currentUser?.uid;
  const showMicroGuide = !!userId && !getOnboardingFlag(userId, "notes_microguide_v1");

  useEffect(() => {
    if (createParam !== "1") return;
    setCreateOpen(true);
  }, [createParam]);

  useEffect(() => {
    if (!userId) return;
    if (!createOpen) return;
    if (getOnboardingFlag(userId, "notes_microguide_v1")) return;
    setOnboardingFlag(userId, "notes_microguide_v1", true);
  }, [userId, createOpen]);

  useEffect(() => {
    if (createOpen) return;
    setNoteWorkspaceId(workspaceId ?? "");
  }, [workspaceId, createOpen]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const showUpgradeCta =
    !!createError?.includes("Limite Free atteinte") || !!editError?.includes("Limite Free atteinte");

  const sortedNotes = useMemo(() => {
    return notes
      .slice()
      .sort((a, b) => {
        const aUpdated = a.updatedAt ? a.updatedAt.toMillis() : 0;
        const bUpdated = b.updatedAt ? b.updatedAt.toMillis() : 0;
        return bUpdated - aUpdated;
      });
  }, [notes]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("notesViewMode");
      if (raw === "list" || raw === "grid") {
        setViewMode(raw);
      }
    } catch {
      // ignore
    }
  }, []);

  const activeNotes = useMemo(() => sortedNotes.filter((n) => n.completed !== true), [sortedNotes]);
  const completedNotes = useMemo(() => sortedNotes.filter((n) => n.completed === true), [sortedNotes]);

  const handleCreateNote = async () => {
    const user = auth.currentUser;
    if (!user) {
      setCreateError("Connecte-toi pour créer ta première note.");
      return;
    }

    if (!isPro && allNotesForLimit.length >= 15) {
      setCreateError(freeLimitMessage);
      return;
    }

    if (!noteWorkspaceId) {
      setCreateError("Sélectionne un dossier (workspace) pour enregistrer la note.");
      return;
    }

    setCreateError(null);
    const validation = newNoteSchema.safeParse({ title: noteTitle, content: noteContent });
    if (!validation.success) {
      setCreateError(validation.error.issues[0]?.message ?? "Données invalides.");
      return;
    }

    setCreating(true);
    try {
      const payload: Omit<NoteDoc, "id"> = {
        userId: user.uid,
        workspaceId: noteWorkspaceId,
        title: validation.data.title,
        content: validation.data.content ?? "",
        favorite: false,
        completed: false,
        createdAt: serverTimestamp() as unknown as NoteDoc["createdAt"],
        updatedAt: serverTimestamp() as unknown as NoteDoc["updatedAt"],
      };
      await addDoc(collection(db, "notes"), payload);
      setNoteTitle("");
      setNoteContent("");
    } catch (e) {
      console.error("Error creating note", e);
      if (e instanceof FirebaseError) {
        setCreateError(`${e.code}: ${e.message}`);
      } else if (e instanceof Error) {
        setCreateError(e.message);
      } else {
        setCreateError("Erreur lors de la création de la note.");
      }
    } finally {
      setCreating(false);
    }
  };

  const toggleCompleted = async (note: NoteDoc, nextCompleted: boolean) => {
    if (!note.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== note.userId) return;

    try {
      await updateDoc(doc(db, "notes", note.id), {
        completed: nextCompleted,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error("Error toggling completed", e);
      if (e instanceof FirebaseError) {
        setEditError(`${e.code}: ${e.message}`);
      }
    }
  };

  const startEditing = (note: NoteDoc) => {
    setEditingId(note.id ?? null);
    setEditTitle(note.title);
    setEditContent(note.content ?? "");
    setEditError(null);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditTitle("");
    setEditContent("");
    setEditError(null);
  };

  const handleSave = async (note: NoteDoc) => {
    if (!note.id) return;

    const user = auth.currentUser;
    if (!user || user.uid !== note.userId) {
      setEditError("Impossible de modifier cette note.");
      return;
    }

    setEditError(null);
    const validation = newNoteSchema.safeParse({ title: editTitle, content: editContent });
    if (!validation.success) {
      setEditError(validation.error.issues[0]?.message ?? "Données invalides.");
      return;
    }

    setSaving(true);
    try {
      await updateDoc(doc(db, "notes", note.id), {
        title: validation.data.title,
        content: validation.data.content ?? "",
        workspaceId: typeof note.workspaceId === "string" ? note.workspaceId : null,
        favorite: note.favorite === true,
        completed: note.completed === true,
        updatedAt: serverTimestamp(),
      });
      cancelEditing();
    } catch (e) {
      console.error("Error updating note", e);
      if (e instanceof FirebaseError) {
        setEditError(`${e.code}: ${e.message}`);
      } else if (e instanceof Error) {
        setEditError(e.message);
      } else {
        setEditError("Erreur lors de la modification de la note.");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (note: NoteDoc) => {
    if (!note.id) return;

    const user = auth.currentUser;
    if (!user || user.uid !== note.userId) return;

    if (!confirm("Supprimer cette note ?")) return;

    setDeletingId(note.id);
    try {
      await deleteDoc(doc(db, "notes", note.id));
      if (editingId === note.id) {
        cancelEditing();
      }
    } catch (e) {
      console.error("Error deleting note", e);
      if (e instanceof FirebaseError) {
        setEditError(`${e.code}: ${e.message}`);
      } else if (e instanceof Error) {
        setEditError(e.message);
      } else {
        setEditError("Erreur lors de la suppression de la note.");
      }
    } finally {
      setDeletingId(null);
    }
  };

  const toggleFavorite = async (note: NoteDoc) => {
    if (!note.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== note.userId) return;

    if (!isPro && note.favorite !== true && favoriteNotesForLimit.length >= 10) {
      setEditError(freeLimitMessage);
      return;
    }

    try {
      await updateDoc(doc(db, "notes", note.id), {
        favorite: !note.favorite,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error("Error toggling favorite", e);
      if (e instanceof FirebaseError) {
        setEditError(`${e.code}: ${e.message}`);
      }
    }
  };

  return (
    <div className="space-y-8">
      <section className="border border-border rounded-lg bg-card">
        <div className="p-4 flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Tes notes</h1>
          <button
            type="button"
            onClick={() => setCreateOpen((v) => !v)}
            className="inline-flex items-center justify-center px-3 py-2 rounded-md border border-border bg-background text-sm font-medium hover:bg-accent"
            aria-expanded={createOpen}
            aria-controls="create-note-panel"
          >
            {createOpen ? "Fermer" : "Capturer une idée"}
          </button>
        </div>

        {showMicroGuide && !createOpen && (
          <div className="px-4 pb-4">
            <div className="sn-card sn-card--muted p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">Astuce</div>
                  <div className="text-sm text-muted-foreground">
                    Un titre clair suffit. Tu peux compléter le contenu plus tard et épingler l’essentiel en favori ⭐.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => userId && setOnboardingFlag(userId, "notes_microguide_v1", true)}
                  className="sn-text-btn shrink-0"
                >
                  OK, compris
                </button>
              </div>
            </div>
          </div>
        )}

        {createOpen && (
          <div className="px-4 pb-4 sn-animate-in" id="create-note-panel">
            <div className="grid grid-cols-1 md:grid-cols-2 md:grid-rows-1 md:items-end gap-3">
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
                <label className="text-sm font-medium" htmlFor="note-workspace">
                  Dossier
                </label>
                <select
                  id="note-workspace"
                  value={noteWorkspaceId}
                  onChange={(e) => setNoteWorkspaceId(e.target.value)}
                  className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">—</option>
                  {workspaces.map((ws) => (
                    <option key={ws.id ?? ws.name} value={ws.id ?? ""}>
                      {ws.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2 flex justify-end">
                <button
                  type="button"
                  disabled={creating}
                  onClick={handleCreateNote}
                  className="h-10 inline-flex items-center justify-center px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creating ? "Création…" : "Créer la note"}
                </button>
              </div>
            </div>

            <div className="mt-3 space-y-1">
              <label className="text-sm font-medium" htmlFor="note-content">
                Contenu
              </label>
              <textarea
                id="note-content"
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                className="w-full min-h-[96px] md:min-h-[110px] px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Quelques lignes pour te rappeler l’essentiel…"
              />
            </div>

            {createError && (
              <div className="mt-2 sn-alert sn-alert--error" role="status" aria-live="polite">
                {createError}
              </div>
            )}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Tes notes récentes</h2>
        {loading && (
          <div className="sn-empty sn-animate-in">
            <div className="space-y-3">
              <div className="sn-skeleton-title w-48 mx-auto" />
              <div className="sn-skeleton-line w-72 mx-auto" />
              <div className="sn-skeleton-line w-64 mx-auto" />
            </div>
          </div>
        )}
        {createError && <div className="mt-2 sn-alert sn-alert--error">{createError}</div>}
        {showUpgradeCta && (
          <Link
            href="/upgrade"
            className="mt-2 inline-flex items-center justify-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium"
          >
            Débloquer Pro
          </Link>
        )}

        {!loading && !error && activeNotes.length === 0 && (
          <div className="sn-empty">
            <div className="sn-empty-title">Aucune note pour le moment</div>
            <div className="sn-empty-desc">
              Commence simple : capture une idée, une liste ou un résumé. Clique sur “Capturer une idée” pour démarrer.
            </div>
          </div>
        )}
        {error && <div className="sn-alert sn-alert--error">Impossible de charger les notes pour le moment.</div>}
        {!loading && !error && viewMode === "list" && activeNotes.length > 0 && (
          <ul className="space-y-2">
            {activeNotes.map((note) => {
              const isEditing = !!note.id && note.id === editingId;
              const workspaceName = workspaces.find((ws) => ws.id === note.workspaceId)?.name ?? "—";

              return (
                <li
                  key={note.id}
                  className={`sn-card sn-card--note ${note.favorite ? " sn-card--favorite" : ""} p-4`}
                >
                  {!isEditing ? (
                    <div className="space-y-3">
                      <div className="sn-card-header">
                        <div className="min-w-0">
                          <div className="sn-card-title truncate">{note.title}</div>
                          <div className="sn-card-meta">
                            <span className="sn-badge">{workspaceName}</span>
                            {note.favorite && <span className="sn-badge">Favori</span>}
                          </div>
                        </div>

                        <div className="sn-card-actions sn-card-actions-secondary shrink-0">
                          <button
                            type="button"
                            onClick={() => toggleFavorite(note)}
                            className="sn-icon-btn"
                            aria-label={note.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                            title={note.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                          >
                            {note.favorite ? "★" : "☆"}
                          </button>
                        </div>
                      </div>

                      <div className="sn-card-body line-clamp-4">{note.content ?? ""}</div>

                      <div className="flex items-center justify-between gap-3">
                        <label className="text-xs flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={note.completed === true}
                            onChange={(e) => toggleCompleted(note, e.target.checked)}
                          />
                          <span className="text-muted-foreground">Terminé</span>
                        </label>

                        <div className="sn-card-actions sn-card-actions-secondary">
                          <button
                            type="button"
                            onClick={() => startEditing(note)}
                            className="sn-text-btn"
                          >
                            Modifier
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(note)}
                            disabled={deletingId === note.id}
                            className="sn-text-btn text-destructive disabled:opacity-50"
                          >
                            {deletingId === note.id ? "Suppression…" : "Supprimer"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        aria-label="Titre de la note"
                        placeholder="Titre"
                        className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                      />
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        aria-label="Contenu de la note"
                        placeholder="Contenu"
                        className="w-full min-h-[120px] px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                      />

                      {editError && (
                        <div className="sn-alert sn-alert--error" role="status" aria-live="polite">
                          {editError}
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => handleSave(note)}
                          className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                        >
                          {saving ? "Enregistrement…" : "Enregistrer"}
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={cancelEditing}
                          className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
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
        )}

        {viewMode === "grid" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {activeNotes.map((note) => {
              const isEditing = !!note.id && note.id === editingId;
              const workspaceName = workspaces.find((ws) => ws.id === note.workspaceId)?.name ?? "—";

              return (
                <div
                  key={note.id}
                  className={`sn-card sn-card--note ${note.favorite ? " sn-card--favorite" : ""} p-4 min-w-0`}
                >
                  {!isEditing ? (
                    <div className="flex flex-col gap-3">
                      <div className="sn-card-header">
                        <div className="min-w-0">
                          <div className="sn-card-title line-clamp-2">{note.title}</div>
                          <div className="sn-card-meta">
                            <span className="sn-badge">{workspaceName}</span>
                            {note.favorite && <span className="sn-badge">Favori</span>}
                          </div>
                        </div>

                        <div className="sn-card-actions sn-card-actions-secondary shrink-0">
                          <button
                            type="button"
                            onClick={() => toggleFavorite(note)}
                            className="sn-icon-btn"
                            aria-label={note.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                            title={note.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                          >
                            {note.favorite ? "★" : "☆"}
                          </button>
                        </div>
                      </div>

                      <div className="sn-card-body line-clamp-5">{note.content ?? ""}</div>

                      <div className="mt-auto flex items-center justify-between gap-3">
                        <label className="text-xs flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={note.completed === true}
                            onChange={(e) => toggleCompleted(note, e.target.checked)}
                          />
                          <span className="text-muted-foreground">Terminé</span>
                        </label>
                        <div className="sn-card-actions sn-card-actions-secondary">
                          <button
                            type="button"
                            onClick={() => startEditing(note)}
                            className="sn-text-btn"
                          >
                            Modifier
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(note)}
                            disabled={deletingId === note.id}
                            className="sn-text-btn text-destructive disabled:opacity-50"
                          >
                            {deletingId === note.id ? "Suppression…" : "Supprimer"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        aria-label="Titre de la note"
                        placeholder="Titre"
                        className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                      />
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        aria-label="Contenu de la note"
                        placeholder="Contenu"
                        className="w-full min-h-[120px] px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                      />

                      {editError && (
                        <div className="sn-alert sn-alert--error" role="status" aria-live="polite">
                          {editError}
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => handleSave(note)}
                          className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                        >
                          {saving ? "Enregistrement…" : "Enregistrer"}
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={cancelEditing}
                          className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
                        >
                          Annuler
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Terminées</h2>
        {!loading && !error && completedNotes.length === 0 && (
          <p className="text-sm text-muted-foreground">Rien à archiver ici pour l’instant.</p>
        )}

        <ul className="space-y-2">
          {completedNotes.map((note) => (
            <li key={note.id} className="sn-card sn-card--note sn-card--muted p-4">
              <div className="space-y-3">
                <div className="sn-card-header">
                  <div className="min-w-0">
                    <div className="sn-card-title truncate">{note.title}</div>
                    <div className="sn-card-meta">
                      <span className="sn-badge">Terminée</span>
                    </div>
                  </div>
                  <div className="sn-card-actions sn-card-actions-secondary shrink-0">
                    <button
                      type="button"
                      onClick={() => toggleCompleted(note, false)}
                      className="sn-text-btn"
                    >
                      Restaurer
                    </button>
                  </div>
                </div>

                <div className="sn-card-body line-clamp-4">{note.content}</div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
