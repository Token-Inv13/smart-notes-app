"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { FirebaseError } from "firebase/app";
import { httpsCallable } from "firebase/functions";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db, functions as fbFunctions } from "@/lib/firebase";
import { useUserNotes } from "@/hooks/useUserNotes";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useUserWorkspaces } from "@/hooks/useUserWorkspaces";
import type { NoteDoc } from "@/types/firestore";
import RichTextEditor from "./RichTextEditor";
import { sanitizeNoteHtml } from "@/lib/richText";
import DictationMicButton from "./DictationMicButton";
import { insertTextAtSelection, prepareDictationTextForInsertion } from "@/lib/textInsert";

const newNoteSchema = z.object({
  title: z.string().min(1, "Le titre est requis."),
  content: z.string().optional(),
  workspaceId: z.string().optional(),
});

type AssistantActionId =
  | "summary"
  | "correction"
  | "structure"
  | "translation"
  | "rewrite_pro"
  | "rewrite_humor"
  | "rewrite_short";

const ASSISTANT_ACTIONS: Record<AssistantActionId, { label: string; instruction: string }> = {
  summary: {
    label: "Résumer",
    instruction:
      "Résume cette note en gardant les points essentiels. Réponds avec un titre concis puis un contenu structuré en paragraphes courts.",
  },
  correction: {
    label: "Correction",
    instruction: "Corrige l'orthographe, la grammaire et la ponctuation de cette note en français, sans changer le sens.",
  },
  structure: {
    label: "Structurer",
    instruction:
      "Réorganise cette note pour qu'elle soit claire et actionnable: titre explicite, sections courtes, points importants en évidence.",
  },
  translation: {
    label: "Traduction",
    instruction: "Traduis la note en anglais naturel en conservant le sens et la structure.",
  },
  rewrite_pro: {
    label: "Reformuler (pro)",
    instruction: "Reformule la note avec un ton professionnel, clair et orienté décision/action.",
  },
  rewrite_humor: {
    label: "Reformuler (humour)",
    instruction: "Reformule la note avec une légère touche d'humour, tout en restant utile et lisible.",
  },
  rewrite_short: {
    label: "Reformuler (succinct)",
    instruction: "Reformule la note de manière très concise, avec des phrases courtes.",
  },
};

function noteHtmlToPlainText(html: string): string {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function noteDraftToAssistantText(title: string, contentHtml: string): string {
  const safeTitle = title.trim() || "Nouvelle note";
  const plain = noteHtmlToPlainText(contentHtml);
  return plain ? `${safeTitle}\n\n${plain}` : safeTitle;
}

function plainTextToNoteHtml(text: string): string {
  const escaped = String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const blocks = escaped
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => `<p>${b.replace(/\n/g, "<br>")}</p>`);

  return blocks.join("") || "<p></p>";
}

function parseAssistantNoteText(raw: string, fallbackTitle: string): { title: string; contentHtml: string } {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { title: fallbackTitle || "Nouvelle note", contentHtml: "<p></p>" };
  }

  const first = lines[0]?.replace(/^[-*•#\d.\s)]+/, "").trim() || "";
  const title = first || fallbackTitle || "Nouvelle note";
  const body = lines.slice(1).join("\n").trim();
  const contentHtml = plainTextToNoteHtml(body || raw);
  return { title, contentHtml };
}

type Props = {
  initialWorkspaceId?: string;
  initialFavorite?: boolean;
  onCreated?: () => void;
};

export default function NoteCreateForm({ initialWorkspaceId, initialFavorite, onCreated }: Props) {
  const { data: workspaces } = useUserWorkspaces();
  const { data: userSettings } = useUserSettings();
  const isPro = userSettings?.plan === "pro";
  const freeLimitMessage =
    "Limite Free atteinte. Tu peux passer en Pro pour créer plus de notes et utiliser les favoris sans limite.";

  const { data: allNotesForLimit } = useUserNotes({ limit: 16 });
  const { data: favoriteNotesForLimit } = useUserNotes({ favoriteOnly: true, limit: 11 });

  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [noteWorkspaceId, setNoteWorkspaceId] = useState<string>(initialWorkspaceId ?? "");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const [dictationStatus, setDictationStatus] = useState<"idle" | "listening" | "stopped" | "error">("idle");
  const [dictationError, setDictationError] = useState<string | null>(null);
  const [assistantMenuOpen, setAssistantMenuOpen] = useState(false);
  const [assistantBusyAction, setAssistantBusyAction] = useState<AssistantActionId | null>(null);
  const [assistantInfo, setAssistantInfo] = useState<string | null>(null);
  const [assistantError, setAssistantError] = useState<string | null>(null);

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

  const runAssistantAction = async (actionId: AssistantActionId) => {
    if (assistantBusyAction || creating) return;
    const action = ASSISTANT_ACTIONS[actionId];

    setAssistantBusyAction(actionId);
    setAssistantInfo(null);
    setAssistantError(null);
    setAssistantMenuOpen(false);

    try {
      const fn = httpsCallable<
        { text: string; instruction: string },
        { text: string; model?: string | null }
      >(fbFunctions, "assistantRewriteText");

      const source = noteDraftToAssistantText(noteTitle, noteContent);
      const response = await fn({ text: source, instruction: action.instruction });
      const transformed = typeof response.data?.text === "string" ? response.data.text.trim() : "";
      if (!transformed) throw new Error("Réponse IA vide.");

      const parsed = parseAssistantNoteText(transformed, noteTitle || "Nouvelle note");
      setNoteTitle(parsed.title);
      setNoteContent(parsed.contentHtml);
      setAssistantInfo(`${action.label} appliqué.`);
    } catch (e) {
      if (e instanceof FirebaseError) {
        const code = String(e.code || "");
        if (code.includes("internal")) setAssistantError("Assistant IA indisponible pour le moment. Réessaie dans quelques secondes.");
        else setAssistantError(`${e.code}: ${e.message}`);
      } else if (e instanceof Error) {
        setAssistantError(e.message);
      } else {
        setAssistantError("Impossible d’appliquer l’action assistant.");
      }
    } finally {
      setAssistantBusyAction(null);
    }
  };

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
      const canFavoriteNow =
        initialFavorite === true ? isPro || favoriteNotesForLimit.length < 10 : false;

      const payload: Omit<NoteDoc, "id"> = {
        userId: user.uid,
        workspaceId: validation.data.workspaceId ?? null,
        title: validation.data.title,
        content: sanitizeNoteHtml(validation.data.content ?? ""),
        favorite: canFavoriteNow,
        completed: false,
        archived: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await addDoc(collection(db, "notes"), payload);

      if (initialFavorite === true && !canFavoriteNow) {
        try {
          if (typeof window !== "undefined") {
            window.sessionStorage.setItem(
              "smartnotes:flash",
              "Note créée, mais non épinglée (limite Free). Passe en Pro ou retire un favori.",
            );
          }
        } catch {
          // ignore
        }
      }

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
          <div className="flex items-center gap-2">
            <input
              id="note-title"
              ref={titleInputRef}
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              className="flex-1 w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Ex: Idées pour demain"
            />
            <DictationMicButton
              disabled={creating}
              onFinalText={(rawText) => {
                const el = titleInputRef.current;
                const insert = prepareDictationTextForInsertion({
                  value: noteTitle,
                  selectionStart: el?.selectionStart ?? null,
                  rawText,
                });
                if (!insert) return;
                const { nextValue, nextCursor } = insertTextAtSelection({
                  value: noteTitle,
                  selectionStart: el?.selectionStart ?? null,
                  selectionEnd: el?.selectionEnd ?? null,
                  text: insert,
                });
                setNoteTitle(nextValue);
                window.requestAnimationFrame(() => {
                  try {
                    el?.focus();
                    el?.setSelectionRange(nextCursor, nextCursor);
                  } catch {
                    // ignore
                  }
                });
              }}
              onStatusChange={(st, err) => {
                setDictationStatus(st);
                setDictationError(err);
              }}
            />
          </div>
          {dictationStatus === "listening" ? (
            <div className="text-xs text-muted-foreground">Écoute…</div>
          ) : dictationError ? (
            <div className="text-xs text-destructive">{dictationError}</div>
          ) : null}
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
        <div className="mb-2 rounded-md border border-border/70 bg-background/40 px-2 py-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground mr-1">Assistant</span>
            <button
              type="button"
              className="px-2 py-1 rounded border border-border text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
              disabled={creating || !!assistantBusyAction}
              onClick={() => void runAssistantAction("summary")}
            >
              {assistantBusyAction === "summary" ? "Résumé…" : "Résumer"}
            </button>
            <button
              type="button"
              className="px-2 py-1 rounded border border-border text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
              disabled={creating || !!assistantBusyAction}
              onClick={() => void runAssistantAction("correction")}
            >
              {assistantBusyAction === "correction" ? "Correction…" : "Correction"}
            </button>
            <button
              type="button"
              className="px-2 py-1 rounded border border-border text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
              disabled={creating || !!assistantBusyAction}
              onClick={() => void runAssistantAction("structure")}
            >
              {assistantBusyAction === "structure" ? "Structure…" : "Structurer"}
            </button>
            <div className="relative">
              <button
                type="button"
                className="px-2 py-1 rounded border border-border text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                disabled={creating || !!assistantBusyAction}
                onClick={() => setAssistantMenuOpen((v) => !v)}
              >
                Plus
              </button>
              {assistantMenuOpen ? (
                <div className="absolute right-0 mt-1 z-20 min-w-[210px] rounded-md border border-border bg-card shadow-lg p-1">
                  <button type="button" className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-accent" onClick={() => void runAssistantAction("translation")}>Traduction</button>
                  <button type="button" className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-accent" onClick={() => void runAssistantAction("rewrite_pro")}>Reformuler (pro)</button>
                  <button type="button" className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-accent" onClick={() => void runAssistantAction("rewrite_humor")}>Reformuler (humour)</button>
                  <button type="button" className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-accent" onClick={() => void runAssistantAction("rewrite_short")}>Reformuler (succinct)</button>
                </div>
              ) : null}
            </div>
          </div>
          {assistantInfo ? <div className="mt-1 text-[11px] text-muted-foreground">{assistantInfo}</div> : null}
          {assistantError ? <div className="mt-1 text-[11px] text-destructive">{assistantError}</div> : null}
        </div>
        <RichTextEditor
          value={noteContent}
          onChange={setNoteContent}
          placeholder="Quelques lignes pour te rappeler l’essentiel…"
          minHeightClassName="min-h-[120px]"
          enableDictation
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
