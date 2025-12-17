"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { z } from "zod";
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
import type { NoteDoc } from "@/types/firestore";

const newNoteSchema = z.object({
  title: z.string().min(1, "Le titre est requis."),
  content: z.string().min(1, "Le contenu est requis."),
});

export default function NotesPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId") || undefined;

  const { data: notes, loading, error } = useUserNotes({ workspaceId });

  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

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

  const handleCreateNote = async () => {
    const user = auth.currentUser;
    if (!user) {
      setCreateError("Tu dois être connecté pour créer une note.");
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
        workspaceId: workspaceId ?? null,
        title: validation.data.title,
        content: validation.data.content,
        createdAt: serverTimestamp() as unknown as NoteDoc["createdAt"],
        updatedAt: serverTimestamp() as unknown as NoteDoc["updatedAt"],
      };

      await addDoc(collection(db, "notes"), payload);
      setNoteTitle("");
      setNoteContent("");
    } catch (e) {
      console.error("Error creating note", e);
      setCreateError("Erreur lors de la création de la note.");
    } finally {
      setCreating(false);
    }
  };

  const startEditing = (note: NoteDoc) => {
    setEditingId(note.id ?? null);
    setEditTitle(note.title);
    setEditContent(note.content);
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
        content: validation.data.content,
        updatedAt: serverTimestamp(),
      });
      cancelEditing();
    } catch (e) {
      console.error("Error updating note", e);
      setEditError("Erreur lors de la modification de la note.");
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
      setEditError("Erreur lors de la suppression de la note.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-8">
      <section className="border border-border rounded-lg p-4 bg-card">
        <h1 className="text-xl font-semibold mb-3">Notes</h1>

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
              className="w-full min-h-[120px] px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Écris ta note…"
            />
          </div>

          {createError && (
            <p className="text-sm text-destructive" aria-live="polite">
              {createError}
            </p>
          )}

          <button
            type="button"
            disabled={creating}
            onClick={handleCreateNote}
            className="w-full inline-flex items-center justify-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? "Création…" : "Ajouter la note"}
          </button>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Toutes les notes</h2>
        {loading && <p>Loading…</p>}
        {error && <p className="text-sm text-destructive">{error.message}</p>}

        {!loading && !error && sortedNotes.length === 0 && <p>Aucune note.</p>}

        <ul className="space-y-2">
          {sortedNotes.map((note) => {
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
    </div>
  );
}
