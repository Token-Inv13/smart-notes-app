"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type SpeechDictationStatus = "idle" | "listening" | "stopped" | "error";

type SpeechRecognitionResultLike = { isFinal?: boolean; 0?: { transcript?: string } };

type SpeechRecognitionEventLike = {
  resultIndex?: number;
  results?: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionErrorEventLike = { error?: string; message?: string };

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};

interface WindowWithSpeechRecognition extends Window {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as WindowWithSpeechRecognition;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function mapError(err?: string): string {
  const code = String(err ?? "").toLowerCase();
  if (code === "not-allowed" || code === "service-not-allowed") {
    return "Permission micro refusée. Autorise le micro dans ton navigateur.";
  }
  if (code === "audio-capture") {
    return "Aucun micro détecté.";
  }
  if (code === "network") {
    return "Erreur réseau pendant la dictée.";
  }
  if (code === "no-speech") {
    return "Aucune voix détectée.";
  }
  if (code === "aborted") {
    return "Dictée interrompue.";
  }
  return err ? `Dictée: ${err}` : "Erreur de dictée.";
}

function mapStartError(err: unknown): string {
  if (typeof err === "string") {
    const msg = err.toLowerCase();
    if (msg.includes("requested device not found") || msg.includes("device not found")) {
      return "Aucun micro disponible. Vérifie ton appareil audio puis réessaie.";
    }
    if (msg.includes("permission") || msg.includes("notallowed") || msg.includes("denied")) {
      return "Permission micro refusée. Autorise le micro dans ton navigateur.";
    }
    return `Dictée: ${err}`;
  }

  if (err instanceof DOMException) {
    const name = String(err.name || "").toLowerCase();
    const message = String(err.message || "").toLowerCase();
    if (name.includes("notfound") || message.includes("requested device not found") || message.includes("device not found")) {
      return "Aucun micro disponible. Vérifie ton appareil audio puis réessaie.";
    }
    if (name.includes("notallowed") || name.includes("security") || message.includes("permission") || message.includes("denied")) {
      return "Permission micro refusée. Autorise le micro dans ton navigateur.";
    }
    return err.message || "Erreur de dictée.";
  }

  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("requested device not found") || msg.includes("device not found")) {
      return "Aucun micro disponible. Vérifie ton appareil audio puis réessaie.";
    }
    if (msg.includes("permission") || msg.includes("notallowed") || msg.includes("denied")) {
      return "Permission micro refusée. Autorise le micro dans ton navigateur.";
    }
    return err.message;
  }

  return "Erreur de dictée.";
}

export function useSpeechDictation(params: {
  onFinalText: (text: string) => void;
  lang?: string;
}) {
  const ctor = useMemo(() => getSpeechRecognitionCtor(), []);
  const supported = Boolean(ctor);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const statusRef = useRef<SpeechDictationStatus>("idle");
  const finalBufferRef = useRef<string>("");

  const [status, setStatus] = useState<SpeechDictationStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [interimText, setInterimText] = useState<string>("");

  const setStatusSafe = (next: SpeechDictationStatus) => {
    statusRef.current = next;
    setStatus(next);
  };

  const stop = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      // ignore
    }
  }, []);

  const start = useCallback(() => {
    if (!ctor) {
      setError("Dictée non supportée sur cet appareil.");
      setStatusSafe("error");
      return;
    }

    setError(null);
    setInterimText("");
    finalBufferRef.current = "";

    const rec = new ctor();
    recognitionRef.current = rec;

    rec.lang = typeof params.lang === "string" && params.lang ? params.lang : (typeof navigator !== "undefined" ? navigator.language : "fr-FR");
    rec.continuous = false;
    rec.interimResults = true;

    rec.onresult = (ev) => {
      const results = ev?.results;
      const idx = typeof ev?.resultIndex === "number" ? ev.resultIndex : 0;
      if (!results) return;

      let interim = "";
      let finalAppend = "";

      for (let i = idx; i < results.length; i += 1) {
        const r = results[i];
        const transcript = r?.[0]?.transcript;
        const t = typeof transcript === "string" ? transcript : "";
        if (r?.isFinal) {
          finalAppend += t;
        } else {
          interim += t;
        }
      }

      if (finalAppend) {
        finalBufferRef.current += finalAppend;
      }

      setInterimText(interim);
    };

    rec.onerror = (ev) => {
      const msg = mapError(ev?.error ?? ev?.message);
      setError(msg);
      setStatusSafe("error");
    };

    rec.onend = () => {
      const text = String(finalBufferRef.current ?? "").trim();
      finalBufferRef.current = "";
      setInterimText("");

      if (statusRef.current === "listening") {
        setStatusSafe("stopped");
      }

      if (text) {
        params.onFinalText(text);
      }

      recognitionRef.current = null;
    };

    try {
      setStatusSafe("listening");
      rec.start();
    } catch (e) {
      setError(mapStartError(e));
      setStatusSafe("error");
      recognitionRef.current = null;
    }
  }, [ctor, params]);

  const toggle = useCallback(() => {
    if (statusRef.current === "listening") {
      stop();
      return;
    }
    start();
  }, [start, stop]);

  useEffect(() => {
    return () => {
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      try {
        rec?.abort?.();
      } catch {
        // ignore
      }
    };
  }, []);

  return {
    supported,
    status,
    error,
    interimText,
    start,
    stop,
    toggle,
  };
}
