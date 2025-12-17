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
import { useUserWorkspaces } from "@/hooks/useUserWorkspaces";
import type { NoteDoc } from "@/types/firestore";

const newNoteSchema = z.object({
  title: z.string().min(1, "Le titre est requis."),
  content: z.string().optional(),
});

export default function NotesPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId") || undefined;
  const { data: workspaces } = useUserWorkspaces();

  const { data: notes, loading, error } = useUserNotes({ workspaceId });

  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [noteWorkspaceId, setNoteWorkspaceId] = useState<string>(workspaceId ?? "");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);

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

  const sortedNotes = useMemo(() => {
    return notes
      .slice()
      .sort((a, b) => {
        const aUpdated = a.updatedAt ? a.updatedAt.toMillis() : 0;
        const bUpdated = b.updatedAt ? b.updatedAt.toMillis() : 0;
        return bUpdated - aUpdated;
      });
  }, [notes]);

  const activeNotes = useMemo(() => sortedNotes.filter((n) => n.completed !== true), [sortedNotes]);
  const completedNotes = useMemo(() => sortedNotes.filter((n) => n.completed === true), [sortedNotes]);

  const handleCreateNote = async () => {
    const user = auth.currentUser;
    if (!user) {
      setCreateError("Tu dois être connecté pour créer une note.");
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
          <h1 className="text-xl font-semibold">Notes</h1>
          <button
            type="button"
            onClick={() => setCreateOpen((v) => !v)}
            className="inline-flex items-center justify-center px-3 py-2 rounded-md border border-border bg-background text-sm font-medium hover:bg-accent"
            aria-expanded={createOpen}
            aria-controls="create-note-panel"
          >
            {createOpen ? "Fermer" : "Nouvelle note"}
          </button>
        </div>

        {createOpen && (
          <div className="px-4 pb-4" id="create-note-panel">
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
                  {creating ? "Création…" : "Ajouter"}
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
                placeholder="Écris ta note…"
              />
            </div>

            {createError && (
              <p className="mt-2 text-sm text-destructive" aria-live="polite">
                {createError}
              </p>
            )}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Toutes les notes</h2>
        {loading && <p>Loading…</p>}
        {error && <p className="text-sm text-destructive">{error.message}</p>}

        {!loading && !error && activeNotes.length === 0 && <p>Aucune note.</p>}

        <ul className="space-y-2">
          {activeNotes.map((note) => {
            const isEditing = !!note.id && note.id === editingId;

            return (
              <li key={note.id} className="border border-border rounded-md p-3 bg-card">
                {!isEditing ? (
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{note.title}</div>
                      <div className="text-sm text-muted-foreground whitespace-pre-wrap break-words mt-1">
                        {note.content}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <label className="text-xs flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={note.completed === true}
                          onChange={(e) => toggleCompleted(note, e.target.checked)}
                        />
                        Terminé
                      </label>
                      <button
                        type="button"
                        onClick={() => toggleFavorite(note)}
                        className="text-xs underline"
                        aria-label={note.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                      >
                        {note.favorite ? "★" : "☆"}
                      </button>
                      <button
                        type="button"
                        onClick={() => startEditing(note)}
                        className="text-xs underline"
                      >
                        Modifier
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(note)}
                        disabled={deletingId === note.id}
                        className="text-xs underline text-destructive disabled:opacity-50"
                      >
                        {deletingId === note.id ? "Suppression…" : "Supprimer"}
                      </button>
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
                      <p className="text-sm text-destructive" aria-live="polite">
                        {editError}
                      </p>
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
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Terminées</h2>
        {!loading && !error && completedNotes.length === 0 && <p>Aucune note terminée.</p>}

        <ul className="space-y-2">
          {completedNotes.map((note) => (
            <li key={note.id} className="border border-border rounded-md p-3 bg-card">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium truncate">{note.title}</div>
                  <div className="text-sm text-muted-foreground whitespace-pre-wrap break-words mt-1">
                    {note.content}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => toggleCompleted(note, false)}
                    className="text-xs underline"
                  >
                    Restaurer
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
