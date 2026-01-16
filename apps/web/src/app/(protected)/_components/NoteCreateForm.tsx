"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { FirebaseError } from "firebase/app";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useUserNotes } from "@/hooks/useUserNotes";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useUserWorkspaces } from "@/hooks/useUserWorkspaces";
import type { NoteDoc } from "@/types/firestore";

const newNoteSchema = z.object({
  title: z.string().min(1, "Le titre est requis."),
  content: z.string().optional(),
  workspaceId: z.string().optional(),
});

type Props = {
  initialWorkspaceId?: string;
  onCreated?: () => void;
};

export default function NoteCreateForm({ initialWorkspaceId, onCreated }: Props) {
  const { data: workspaces } = useUserWorkspaces();
  const { data: userSettings } = useUserSettings();
  const isPro = userSettings?.plan === "pro";
  const freeLimitMessage =
    "Limite Free atteinte. Tu peux passer en Pro pour créer plus de notes et utiliser les favoris sans limite.";

  const { data: allNotesForLimit } = useUserNotes({ limit: 16 });

  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [noteWorkspaceId, setNoteWorkspaceId] = useState<string>(initialWorkspaceId ?? "");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedDraftRef = useRef<string>("");
  const DRAFT_KEY = "smartnotes:draft:new-note";

  useEffect(() => {
    setNoteWorkspaceId(initialWorkspaceId ?? "");
  }, [initialWorkspaceId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = window.sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { title?: string; content?: string; workspaceId?: string };

      setNoteTitle((prev) => prev || (typeof parsed.title === "string" ? parsed.title : ""));
      setNoteContent((prev) => prev || (typeof parsed.content === "string" ? parsed.content : ""));
      setNoteWorkspaceId((prev) => prev || (typeof parsed.workspaceId === "string" ? parsed.workspaceId : ""));
      lastSavedDraftRef.current = raw;
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const draft = JSON.stringify({
      title: noteTitle,
      content: noteContent,
      workspaceId: noteWorkspaceId,
    });

    if (draft === lastSavedDraftRef.current) return;

    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      try {
        window.sessionStorage.setItem(DRAFT_KEY, draft);
        lastSavedDraftRef.current = draft;
      } catch {
        // ignore
      }
    }, 800);

    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    };
  }, [noteTitle, noteContent, noteWorkspaceId]);

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

    const validation = newNoteSchema.safeParse({
      title: noteTitle,
      content: noteContent,
      workspaceId: noteWorkspaceId || undefined,
    });
    if (!validation.success) {
      setCreateError(validation.error.issues[0]?.message ?? "Données invalides.");
      return;
    }

    setCreateError(null);
    setCreating(true);
    try {
      const payload: Omit<NoteDoc, "id"> = {
        userId: user.uid,
        workspaceId: validation.data.workspaceId ?? null,
        title: validation.data.title,
        content: validation.data.content ?? "",
        favorite: false,
        completed: false,
        archived: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await addDoc(collection(db, "notes"), payload);

      try {
        if (typeof window !== "undefined") window.sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        // ignore
      }

      setNoteTitle("");
      setNoteContent("");

      onCreated?.();
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

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 md:items-end gap-3">
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

      <div className="space-y-1">
        <label className="sr-only" htmlFor="note-content">
          Contenu
        </label>
        <textarea
          id="note-content"
          value={noteContent}
          onChange={(e) => setNoteContent(e.target.value)}
          className="w-full min-h-[120px] px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="Quelques lignes pour te rappeler l’essentiel…"
        />
      </div>

      {createError && (
        <div className="sn-alert sn-alert--error" role="status" aria-live="polite">
          {createError}
        </div>
      )}
    </div>
  );
}
