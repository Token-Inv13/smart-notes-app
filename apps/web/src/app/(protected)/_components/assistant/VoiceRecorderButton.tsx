"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FirebaseError } from "firebase/app";
import { httpsCallable } from "firebase/functions";
import { addDoc, collection, doc, getDoc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { ref as storageRef, uploadBytes } from "firebase/storage";
import { db, functions as fbFunctions, storage } from "@/lib/firebase";
import { invalidateAuthSession, isAuthInvalidError } from "@/lib/authInvalidation";
import { useAuth } from "@/hooks/useAuth";
import type { AssistantVoiceJobDoc, AssistantVoiceResultDoc, NoteDoc } from "@/types/firestore";

type Props = {
  noteId?: string;
  mode?: "append_to_note" | "standalone";
  onTranscript?: (transcript: string) => void;
  showInternalActions?: boolean;
  showTranscript?: boolean;
};

type UiStatus = "idle" | "recording" | "uploading" | "transcribing" | "done" | "error";

function formatMs(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

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

function pickMimeType() {
  if (typeof window === "undefined") return "";
  const mr = window.MediaRecorder as unknown as { isTypeSupported?: (t: string) => boolean } | undefined;
  const can = (t: string) => Boolean(mr?.isTypeSupported?.(t));
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  return candidates.find(can) ?? "";
}

function mapMicrophoneAccessError(err: unknown): string {
  if (err instanceof DOMException) {
    const name = String(err.name || "").toLowerCase();
    const message = String(err.message || "").toLowerCase();
    if (name.includes("notfound") || message.includes("requested device not found") || message.includes("device not found")) {
      return "Aucun micro disponible. Vérifie ton appareil audio puis réessaie.";
    }
    if (name.includes("notallowed") || name.includes("security") || message.includes("permission") || message.includes("denied")) {
      return "Permission micro refusée. Autorise le micro dans ton navigateur puis recharge la page.";
    }
    if (name.includes("notreadable") || message.includes("could not start audio source")) {
      return "Le micro est indisponible (utilisé par une autre application ou bloqué par le système).";
    }
    return err.message || "Impossible d’accéder au micro.";
  }

  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("requested device not found") || msg.includes("device not found")) {
      return "Aucun micro disponible. Vérifie ton appareil audio puis réessaie.";
    }
    if (msg.includes("permission") || msg.includes("notallowed") || msg.includes("denied")) {
      return "Permission micro refusée. Autorise le micro dans ton navigateur puis recharge la page.";
    }
    if (msg.includes("not supported") || msg.includes("unsupported")) {
      return "Enregistrement micro non supporté sur cet appareil.";
    }
    return err.message;
  }

  if (typeof err === "string") {
    const msg = err.toLowerCase();
    if (msg.includes("requested device not found") || msg.includes("device not found")) {
      return "Aucun micro disponible. Vérifie ton appareil audio puis réessaie.";
    }
    if (msg.includes("permission") || msg.includes("notallowed") || msg.includes("denied")) {
      return "Permission micro refusée. Autorise le micro dans ton navigateur puis recharge la page.";
    }
    return `Impossible d’accéder au micro: ${err}`;
  }

  return "Impossible d’accéder au micro.";
}

export default function VoiceRecorderButton({
  noteId,
  mode,
  onTranscript,
  showInternalActions = true,
  showTranscript = true,
}: Props) {
  const { user } = useAuth();

  const effectiveMode: "append_to_note" | "standalone" =
    mode === "append_to_note" || mode === "standalone" ? mode : noteId ? "append_to_note" : "standalone";

  const [status, setStatus] = useState<UiStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const [jobId, setJobId] = useState<string | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);

  const maxDurationMs = 5 * 60 * 1000;
  const maxBytes = 25 * 1024 * 1024;

  const isCallableUnauthenticated = (err: unknown) => {
    if (isAuthInvalidError(err)) return true;
    const code = typeof (err as { code?: unknown })?.code === "string" ? String((err as { code?: unknown }).code) : "";
    return code.includes("unauthenticated");
  };

  const stopAndCleanupStream = () => {
    const s = streamRef.current;
    streamRef.current = null;
    try {
      s?.getTracks().forEach((t) => t.stop());
    } catch {
      // ignore
    }
  };

  const stopTimer = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const startTimer = () => {
    stopTimer();
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    timerRef.current = window.setInterval(() => {
      const ms = Date.now() - startedAtRef.current;
      setElapsedMs(ms);
      if (ms >= maxDurationMs) {
        // Auto-stop.
        void stop();
      }
    }, 250);
  };

  const canRecord = useMemo(() => {
    if (typeof window === "undefined") return false;
    return typeof window.MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  }, []);

  const createJob = async () => {
    const fn = httpsCallable<{ noteId?: string; mode?: string }, { jobId: string; storagePath: string }>(
      fbFunctions,
      "assistantCreateVoiceJob",
    );
    const res = await fn({ noteId: noteId ?? undefined, mode: effectiveMode });
    return res.data;
  };

  const requestTranscription = async (id: string) => {
    const fn = httpsCallable<{ jobId: string }, { jobId: string; resultId: string }>(
      fbFunctions,
      "assistantRequestVoiceTranscription",
    );
    const res = await fn({ jobId: id });
    return res.data;
  };

  const handleBlob = async (blob: Blob) => {
    if (!user?.uid) {
      setError("Tu dois être connecté.");
      setStatus("error");
      return;
    }

    if (blob.size <= 0) {
      setError("Audio vide.");
      setStatus("error");
      return;
    }

    if (blob.size > maxBytes) {
      setError("Fichier audio trop volumineux (max 25MB).");
      setStatus("error");
      return;
    }

    setStatus("uploading");
    setError(null);

    let created: { jobId: string; storagePath: string };
    try {
      created = await createJob();
    } catch (e) {
      if (isCallableUnauthenticated(e)) {
        void invalidateAuthSession();
        return;
      }
      if (e instanceof FirebaseError) setError(`${e.code}: ${e.message}`);
      else if (e instanceof Error) setError(e.message);
      else setError("Impossible de créer le job voix.");
      setStatus("error");
      return;
    }

    setJobId(created.jobId);

    try {
      const r = storageRef(storage, created.storagePath);
      await uploadBytes(r, blob, {
        contentType: blob.type || "audio/webm",
      });
    } catch (e) {
      console.error("voice.upload_failed", e);
      if (e instanceof FirebaseError) setError(`${e.code}: ${e.message}`);
      else if (e instanceof Error) setError(e.message);
      else setError("Upload audio impossible.");
      setStatus("error");
      return;
    }

    setStatus("transcribing");

    try {
      const t = await requestTranscription(created.jobId);
      setResultId(t.resultId);
    } catch (e) {
      if (isCallableUnauthenticated(e)) {
        void invalidateAuthSession();
        return;
      }
      if (e instanceof FirebaseError) setError(`${e.code}: ${e.message}`);
      else if (e instanceof Error) setError(e.message);
      else setError("Transcription impossible.");
      setStatus("error");
    }
  };

  const start = async () => {
    if (!canRecord) {
      setError("Enregistrement non supporté sur cet appareil.");
      setStatus("error");
      return;
    }
    if (status === "recording" || status === "uploading" || status === "transcribing") return;

    setError(null);
    setTranscript("");
    try {
      onTranscript?.("");
    } catch {
      // ignore
    }
    setResultId(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        stopTimer();
        const mt = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mt });
        chunksRef.current = [];
        recorderRef.current = null;
        stopAndCleanupStream();
        void handleBlob(blob);
      };

      recorder.start(500);
      setStatus("recording");
      startTimer();
    } catch (e) {
      console.error("voice.start_failed", e);
      setError(mapMicrophoneAccessError(e));
      setStatus("error");
      stopAndCleanupStream();
    }
  };

  const stop = async () => {
    if (status !== "recording") return;
    const r = recorderRef.current;
    if (!r) return;
    try {
      r.stop();
    } catch {
      // ignore
    }
  };

  const insertIntoNote = async () => {
    if (!noteId) return;
    if (!user?.uid) return;
    const t = transcript.trim();
    if (!t) return;

    try {
      const snap = await getDoc(doc(db, "notes", noteId));
      if (!snap.exists()) throw new Error("Note introuvable.");
      const note = snap.data() as NoteDoc;
      if (note.userId !== user.uid) throw new Error("Accès refusé.");

      const current = typeof note.content === "string" ? note.content : "";
      const addition = plainTextToNoteHtml(t);
      const next = current ? `${current}<div><br /></div>${addition}` : addition;

      await updateDoc(doc(db, "notes", noteId), {
        content: next,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      if (e instanceof FirebaseError) setError(`${e.code}: ${e.message}`);
      else if (e instanceof Error) setError(e.message);
      else setError("Insertion impossible.");
      setStatus("error");
    }
  };

  const createNoteFromTranscript = async () => {
    if (!user?.uid) return;
    const t = transcript.trim();
    if (!t) return;

    const title = t.length > 64 ? `${t.slice(0, 61)}…` : t;

    try {
      const payload: Omit<NoteDoc, "id"> = {
        userId: user.uid,
        workspaceId: null,
        title: title || "Transcription",
        content: plainTextToNoteHtml(t),
        favorite: false,
        completed: false,
        archived: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const ref = await addDoc(collection(db, "notes"), payload);
      window.location.href = `/notes/${encodeURIComponent(ref.id)}`;
    } catch (e) {
      if (e instanceof FirebaseError) setError(`${e.code}: ${e.message}`);
      else if (e instanceof Error) setError(e.message);
      else setError("Création de note impossible.");
      setStatus("error");
    }
  };

  useEffect(() => {
    if (!user?.uid) return;
    if (!jobId) return;

    const jobRef = doc(db, "users", user.uid, "assistantVoiceJobs", jobId);
    const unsub = onSnapshot(
      jobRef,
      (snap) => {
        const data = snap.exists() ? (snap.data() as AssistantVoiceJobDoc) : null;
        const st = data?.status;
        const err = typeof data?.errorMessage === "string" ? data.errorMessage : null;
        if (st === "error" && err) {
          setError(err);
          setStatus("error");
        }
      },
      () => {
        // ignore
      },
    );

    return () => unsub();
  }, [jobId, user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    if (!resultId) return;

    const rRef = doc(db, "users", user.uid, "assistantVoiceResults", resultId);
    const unsub = onSnapshot(
      rRef,
      (snap) => {
        const data = snap.exists() ? (snap.data() as AssistantVoiceResultDoc) : null;
        const t = typeof data?.transcript === "string" ? data.transcript : "";
        if (t) {
          setTranscript(t);
          try {
            onTranscript?.(t);
          } catch {
            // ignore
          }
          setStatus("done");
        }
      },
      () => {
        // ignore
      },
    );

    return () => unsub();
  }, [resultId, user?.uid, onTranscript]);

  useEffect(() => {
    return () => {
      try {
        recorderRef.current?.stop();
      } catch {
        // ignore
      }
      recorderRef.current = null;
      stopTimer();
      stopAndCleanupStream();
    };
  }, []);

  const buttonLabel = (() => {
    if (status === "recording") return `Stop (${formatMs(elapsedMs)})`;
    if (status === "uploading") return "Upload…";
    if (status === "transcribing") return "Transcription…";
    return "Enregistrer";
  })();

  const disabled = !user?.uid || status === "uploading" || status === "transcribing";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
          onClick={() => {
            if (status === "recording") void stop();
            else void start();
          }}
          disabled={disabled || (!canRecord && status !== "recording")}
        >
          {buttonLabel}
        </button>

        {showInternalActions && status === "done" && transcript.trim() ? (
          <button
            type="button"
            className="px-3 py-2 rounded-md border border-input text-sm"
            onClick={() => void navigator.clipboard.writeText(transcript)}
          >
            Copier
          </button>
        ) : null}

        {showInternalActions && status === "done" && transcript.trim() ? (
          <button
            type="button"
            className="px-3 py-2 rounded-md border border-input text-sm"
            onClick={() => void createNoteFromTranscript()}
          >
            Créer une note
          </button>
        ) : null}

        {showInternalActions && status === "done" && transcript.trim() && noteId ? (
          <button
            type="button"
            className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm"
            onClick={() => void insertIntoNote()}
          >
            Insérer dans la note
          </button>
        ) : null}
      </div>

      {!user?.uid ? <div className="text-xs text-muted-foreground">Connecte-toi pour enregistrer.</div> : null}
      {!canRecord ? <div className="text-xs text-muted-foreground">Enregistrement audio non supporté.</div> : null}

      {status === "uploading" ? <div className="text-xs text-muted-foreground">Upload en cours…</div> : null}
      {status === "transcribing" ? <div className="text-xs text-muted-foreground">Transcription en cours…</div> : null}

      {error ? <div className="text-xs text-destructive">{error}</div> : null}

      {showTranscript && transcript.trim() ? (
        <div className="rounded-md border border-border bg-card p-3">
          <div className="text-sm whitespace-pre-wrap">{transcript}</div>
        </div>
      ) : null}
    </div>
  );
}
