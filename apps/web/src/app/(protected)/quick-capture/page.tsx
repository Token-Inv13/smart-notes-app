"use client";

import { useMemo, useState } from "react";
import { FirebaseError } from "firebase/app";
import { httpsCallable } from "firebase/functions";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db, functions as fbFunctions } from "@/lib/firebase";
import { invalidateAuthSession, isAuthInvalidError } from "@/lib/authInvalidation";
import { sanitizeNoteHtml } from "@/lib/richText";
import { useAuth } from "@/hooks/useAuth";
import type { NoteDoc, TodoDoc } from "@/types/firestore";
import VoiceRecorderButton from "../_components/assistant/VoiceRecorderButton";

function escapeHtml(text: string) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function plainTextToNoteHtml(text: string) {
  const safe = escapeHtml(text);
  const withBreaks = safe.replace(/\r\n|\n|\r/g, "<br />");
  return `<div>${withBreaks}</div>`;
}

function buildFinalText(typed: string, transcript: string) {
  const a = typed.trim();
  const b = transcript.trim();
  if (a && b) return `${a}\n\n${b}`;
  return a || b;
}

export default function QuickCapturePage() {
  const { user } = useAuth();

  const [typedText, setTypedText] = useState("");
  const [transcript, setTranscript] = useState("");

  const [busy, setBusy] = useState<"note" | "todo" | "ai" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finalText = useMemo(() => buildFinalText(typedText, transcript), [typedText, transcript]);

  const isCallableUnauthenticated = (err: unknown) => {
    if (isAuthInvalidError(err)) return true;
    const code = typeof (err as { code?: unknown })?.code === "string" ? String((err as { code?: unknown }).code) : "";
    return code.includes("unauthenticated");
  };

  const createNote = async (text: string) => {
    if (!user?.uid) throw new Error("Tu dois être connecté.");

    const titleLine = text.split(/\r\n|\n|\r/).map((l) => l.trim()).find((l) => l) || "Quick capture";
    const title = titleLine.length > 64 ? `${titleLine.slice(0, 61)}…` : titleLine;

    const payload: Omit<NoteDoc, "id"> = {
      userId: user.uid,
      workspaceId: null,
      title,
      content: sanitizeNoteHtml(plainTextToNoteHtml(text)),
      favorite: false,
      completed: false,
      archived: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const ref = await addDoc(collection(db, "notes"), payload as any);
    return ref.id;
  };

  const createTodo = async (text: string) => {
    if (!user?.uid) throw new Error("Tu dois être connecté.");

    const titleLine = text.split(/\r\n|\n|\r/).map((l) => l.trim()).find((l) => l) || "Quick capture";
    const title = titleLine.length > 96 ? `${titleLine.slice(0, 93)}…` : titleLine;

    const payload: Omit<TodoDoc, "id"> = {
      userId: user.uid,
      workspaceId: null,
      title,
      items: [],
      dueDate: null,
      priority: null,
      completed: false,
      favorite: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const ref = await addDoc(collection(db, "todos"), payload as any);
    return ref.id;
  };

  const handleCreateNote = async () => {
    if (busy) return;
    const text = finalText.trim();
    if (!text) return;

    setBusy("note");
    setMessage(null);
    setError(null);

    try {
      const id = await createNote(text);
      window.location.href = `/notes/${encodeURIComponent(id)}`;
    } catch (e) {
      if (e instanceof FirebaseError) setError(`${e.code}: ${e.message}`);
      else if (e instanceof Error) setError(e.message);
      else setError("Création de note impossible.");
    } finally {
      setBusy(null);
    }
  };

  const handleCreateTodo = async () => {
    if (busy) return;
    const text = finalText.trim();
    if (!text) return;

    setBusy("todo");
    setMessage(null);
    setError(null);

    try {
      const id = await createTodo(text);
      window.location.href = `/todo/${encodeURIComponent(id)}`;
    } catch (e) {
      if (e instanceof FirebaseError) setError(`${e.code}: ${e.message}`);
      else if (e instanceof Error) setError(e.message);
      else setError("Création de ToDo impossible.");
    } finally {
      setBusy(null);
    }
  };

  const handleAnalyzeAI = async () => {
    if (busy) return;
    const text = finalText.trim();
    if (!text) return;

    setBusy("ai");
    setMessage(null);
    setError(null);

    try {
      const noteId = await createNote(text);
      const fn = httpsCallable<{ noteId: string }, { jobId: string; resultId?: string }>(fbFunctions, "assistantRequestAIAnalysis");
      await fn({ noteId });
      setMessage("Analyse IA demandée. Ouverture de la note…");
      window.location.href = `/notes/${encodeURIComponent(noteId)}`;
    } catch (e) {
      if (isCallableUnauthenticated(e)) {
        void invalidateAuthSession();
        return;
      }
      if (e instanceof FirebaseError) setError(`${e.code}: ${e.message}`);
      else if (e instanceof Error) setError(e.message);
      else setError("Impossible de lancer l’analyse IA.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4 max-w-xl mx-auto">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Quick Capture</h1>
        <div className="text-sm text-muted-foreground">Capture un texte ou une note vocale, puis choisis une action.</div>
      </header>

      {message ? <div className="sn-alert">{message}</div> : null}
      {error ? <div className="sn-alert sn-alert--error">{error}</div> : null}

      <section className="border border-border rounded-lg bg-card p-4 space-y-3">
        <div className="space-y-1">
          <div className="text-sm font-medium">Texte</div>
          <textarea
            className="w-full min-h-[120px] rounded-md border border-input bg-background p-3 text-sm"
            placeholder="Écris ici…"
            value={typedText}
            onChange={(e) => setTypedText(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <div className="text-sm font-medium">Voix</div>
          <VoiceRecorderButton
            mode="standalone"
            onTranscript={(t) => setTranscript(t)}
            showInternalActions={false}
            showTranscript
          />
        </div>

        {finalText.trim() ? (
          <div className="space-y-2">
            <div className="text-sm font-medium">Texte final</div>
            <div className="rounded-md border border-border bg-background p-3 text-sm whitespace-pre-wrap">{finalText}</div>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 pt-2">
          <button
            type="button"
            className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            disabled={!finalText.trim() || !!busy}
            onClick={() => void handleCreateNote()}
          >
            {busy === "note" ? "Création…" : "Créer une note"}
          </button>

          <button
            type="button"
            className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
            disabled={!finalText.trim() || !!busy}
            onClick={() => void handleCreateTodo()}
          >
            {busy === "todo" ? "Création…" : "Créer une todo"}
          </button>

          <button
            type="button"
            className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
            disabled={!finalText.trim() || !!busy}
            onClick={() => void handleAnalyzeAI()}
          >
            {busy === "ai" ? "Analyse…" : "Analyser avec IA"}
          </button>
        </div>
      </section>

      {!user?.uid ? <div className="text-xs text-muted-foreground">Connecte-toi pour utiliser Quick Capture.</div> : null}
    </div>
  );
}
