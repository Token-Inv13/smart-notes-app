"use client";

import { useMemo, useState } from "react";
import { FirebaseError } from "firebase/app";
import { httpsCallable } from "firebase/functions";
import { functions as fbFunctions } from "@/lib/firebase";
import { invalidateAuthSession, isAuthInvalidError } from "@/lib/authInvalidation";
import VoiceRecorderButton from "./VoiceRecorderButton";

type Props = {
  mobileHidden?: boolean;
};

type ExecuteIntentResponse = {
  intent: {
    kind: "create_task" | "create_reminder" | "schedule_meeting";
    title: string;
    confidence: number;
    requiresConfirmation: boolean;
    requiresConfirmationReason?: string | null;
    remindAtIso?: string | null;
  };
  executed: boolean;
  createdCoreObjects: Array<{ type: "task" | "taskReminder" | "calendarEvent"; id: string }>;
  message: string;
};

export default function VoiceAgentButton({ mobileHidden }: Props) {
  const [open, setOpen] = useState(false);
  const [inputText, setInputText] = useState("");
  const [busy, setBusy] = useState<"analyze" | "execute" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExecuteIntentResponse | null>(null);

  const hasText = inputText.trim().length > 0;

  const isCallableUnauthenticated = (err: unknown) => {
    if (isAuthInvalidError(err)) return true;
    const code = typeof (err as { code?: unknown })?.code === "string" ? String((err as { code?: unknown }).code) : "";
    return code.includes("unauthenticated");
  };

  const run = async (execute: boolean) => {
    const transcript = inputText.trim();
    if (!transcript) return;
    setBusy(execute ? "execute" : "analyze");
    setError(null);

    try {
      const fn = httpsCallable<{ transcript: string; execute: boolean }, ExecuteIntentResponse>(fbFunctions, "assistantExecuteIntent");
      const res = await fn({ transcript, execute });
      setResult(res.data);
    } catch (e) {
      if (isCallableUnauthenticated(e)) {
        void invalidateAuthSession();
        return;
      }
      if (e instanceof FirebaseError) setError(`${e.code}: ${e.message}`);
      else if (e instanceof Error) setError(e.message);
      else setError("Impossible d’exécuter la commande vocale.");
    } finally {
      setBusy(null);
    }
  };

  const parsedHint = useMemo(() => {
    if (!result) return null;
    const intent = result.intent;
    const conf = `${Math.round((intent.confidence ?? 0) * 100)}%`;
    if (intent.kind === "create_task") return `Compris: créer une tâche — “${intent.title}” (${conf}).`;
    if (intent.kind === "create_reminder") {
      return `Compris: créer un rappel — “${intent.title}”${intent.remindAtIso ? ` à ${new Date(intent.remindAtIso).toLocaleString("fr-FR")}` : ""} (${conf}).`;
    }
    return `Compris: planifier une réunion — “${intent.title}” (${conf}).`;
  }, [result]);

  return (
    <>
      <button
        type="button"
        className="hidden md:inline-flex fixed right-8 bottom-8 z-50 h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
        onClick={() => setOpen(true)}
        aria-label="Assistant vocal"
        title="Assistant vocal"
      >
        🎤
      </button>

      {!mobileHidden ? (
        <button
          type="button"
          className="md:hidden fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
          onClick={() => setOpen(true)}
          aria-label="Assistant vocal"
          title="Assistant vocal"
        >
          🎤
        </button>
      ) : null}

      {open ? (
        <div
          className="fixed inset-0 z-[70] bg-black/40 p-4 flex items-end md:items-center md:justify-center"
          role="dialog"
          aria-modal="true"
          aria-label="Assistant vocal"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full md:max-w-lg rounded-xl border border-border bg-card p-4 space-y-3" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold">Assistant vocal</div>
              <button type="button" className="text-sm text-muted-foreground" onClick={() => setOpen(false)}>
                Fermer
              </button>
            </div>

            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Appuie puis parle. Tu peux aussi écrire.</div>
              <VoiceRecorderButton
                mode="standalone"
                onTranscript={(t) => {
                  const next = t.trim();
                  if (!next) return;
                  setInputText(next);
                }}
                showInternalActions={false}
                showTranscript={false}
              />
            </div>

            <textarea
              className="w-full min-h-[96px] rounded-md border border-input bg-background p-3 text-sm"
              placeholder="Ex: Rappelle-moi d'envoyer le devis demain à 9h"
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value);
                setResult(null);
                setError(null);
              }}
            />

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
                disabled={!hasText || !!busy}
                onClick={() => void run(false)}
              >
                {busy === "analyze" ? "Compréhension…" : "Comprendre"}
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
                disabled={!hasText || !!busy}
                onClick={() => void run(true)}
              >
                {busy === "execute" ? "Exécution…" : "Exécuter"}
              </button>
            </div>

            {parsedHint ? <div className="text-sm">{parsedHint}</div> : null}
            {result?.message ? <div className="text-xs text-muted-foreground">{result.message}</div> : null}
            {result?.intent?.requiresConfirmation ? (
              <div className="text-xs text-amber-600">Action sensible: confirmation manuelle requise.</div>
            ) : null}
            {error ? <div className="text-xs text-destructive">{error}</div> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
