"use client";

import { useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions as fbFunctions } from "@/lib/firebase";
import { invalidateAuthSession, isAuthInvalidError } from "@/lib/authInvalidation";
import { trackEventBeforeNavigation } from "@/lib/analytics";
import { sanitizeNoteHtml } from "@/lib/richText";
import { useAuth } from "@/hooks/useAuth";
import { toUserErrorMessage } from "@/lib/userError";
import type { TodoDoc } from "@/types/firestore";
import { createNoteWithPlanGuard, getPlanLimitMessage } from "@/lib/planGuardedMutations";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

function escapeHtml(text: string) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function plainTextToNoteHtml(text: string) {
  const safe = escapeHtml(text);
  const withBreaks = safe.replace(/\r\n|\n|\r/g, "<br />");
  return `<div>${withBreaks}</div>`;
}

export default function QuickCapturePage() {
  const { user } = useAuth();

  const [typedText, setTypedText] = useState("");

  const [busy, setBusy] = useState<"note" | "todo" | "ai" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finalText = useMemo(() => typedText.trim(), [typedText]);

  const isCallableUnauthenticated = (err: unknown) => {
    if (isAuthInvalidError(err)) return true;
    const code = typeof (err as { code?: unknown })?.code === "string" ? String((err as { code?: unknown }).code) : "";
    return code.includes("unauthenticated");
  };

  const createNote = async (text: string) => {
    if (!user?.uid) throw new Error("Tu dois Ãªtre connectÃ©.");

    const titleLine = text.split(/\r\n|\n|\r/).map((l) => l.trim()).find((l) => l) || "Quick capture";
    const title = titleLine.length > 64 ? `${titleLine.slice(0, 61)}â€¦` : titleLine;

    const result = await createNoteWithPlanGuard({
      workspaceId: null,
      title,
      content: sanitizeNoteHtml(plainTextToNoteHtml(text)),
      favorite: false,
    });
    return result.noteId;
  };

  const createTodo = async (text: string) => {
    if (!user?.uid) throw new Error("Tu dois Ãªtre connectÃ©.");

    const titleLine = text.split(/\r\n|\n|\r/).map((l) => l.trim()).find((l) => l) || "Quick capture";
    const title = titleLine.length > 96 ? `${titleLine.slice(0, 93)}â€¦` : titleLine;

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

    const ref = await addDoc(collection(db, "todos"), payload);
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
      await trackEventBeforeNavigation("create_note", {
        source: "app",
        surface: "quick_capture",
      });
      window.location.href = `/notes/${encodeURIComponent(id)}`;
    } catch (e) {
      setError(getPlanLimitMessage(e) ?? toUserErrorMessage(e, "CrÃ©ation de note impossible.", { allowMessages: ["Tu dois Ãªtre connectÃ©."] }));
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
      await trackEventBeforeNavigation("create_todo", {
        source: "app",
        surface: "quick_capture",
        item_count: 0,
        scheduled_items_count: 0,
      });
      window.location.href = `/todo/${encodeURIComponent(id)}`;
    } catch (e) {
      setError(toUserErrorMessage(e, "CrÃ©ation de checklist impossible.", { allowMessages: ["Tu dois Ãªtre connectÃ©."] }));
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
      setMessage("Analyse IA demandÃ©e. Ouverture de la noteâ€¦");
      window.location.href = `/notes/${encodeURIComponent(noteId)}`;
    } catch (e) {
      if (isCallableUnauthenticated(e)) {
        void invalidateAuthSession();
        return;
      }
      setError(getPlanLimitMessage(e) ?? toUserErrorMessage(e, "Impossible de lancer lâ€™analyse IA.", { allowMessages: ["Tu dois Ãªtre connectÃ©."] }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4 max-w-xl mx-auto">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Quick Capture</h1>
        <div className="text-sm text-muted-foreground">Capture un texte rapide, puis choisis une action.</div>
      </header>

      {message ? <div className="sn-alert">{message}</div> : null}
      {error ? <div className="sn-alert sn-alert--error">{error}</div> : null}

      <section className="border border-border rounded-lg bg-card p-4 space-y-3">
        <div className="space-y-1">
          <div className="text-sm font-medium">Texte</div>
          <textarea
            className="w-full min-h-[120px] rounded-md border border-input bg-background p-3 text-sm"
            placeholder="Ã‰cris iciâ€¦"
            value={typedText}
            onChange={(e) => setTypedText(e.target.value)}
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
            {busy === "note" ? "CrÃ©ationâ€¦" : "CrÃ©er une note"}
          </button>

          <button
            type="button"
            className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
            disabled={!finalText.trim() || !!busy}
            onClick={() => void handleCreateTodo()}
          >
            {busy === "todo" ? "CrÃ©ationâ€¦" : "Ajouter Ã  la Checklist"}
          </button>

          <button
            type="button"
            className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
            disabled={!finalText.trim() || !!busy}
            onClick={() => void handleAnalyzeAI()}
          >
            {busy === "ai" ? "Analyseâ€¦" : "Analyser avec IA"}
          </button>
        </div>
      </section>

      {!user?.uid ? <div className="text-xs text-muted-foreground">Connecte-toi pour utiliser Quick Capture.</div> : null}
    </div>
  );
}
