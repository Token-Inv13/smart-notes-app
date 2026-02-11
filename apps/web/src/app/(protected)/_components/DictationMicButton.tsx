"use client";

import { useEffect } from "react";
import { Mic, Square } from "lucide-react";
import { useSpeechDictation, type SpeechDictationStatus } from "@/hooks/useSpeechDictation";

type Props = {
  disabled?: boolean;
  lang?: string;
  onFinalText: (text: string) => void;
  onStatusChange?: (status: SpeechDictationStatus, error: string | null) => void;
};

export default function DictationMicButton({ disabled, lang, onFinalText, onStatusChange }: Props) {
  const dictation = useSpeechDictation({
    onFinalText,
    lang,
  });

  useEffect(() => {
    onStatusChange?.(dictation.status, dictation.error);
  }, [dictation.error, dictation.status, onStatusChange]);

  const isDisabled = Boolean(disabled);
  const canUse = dictation.supported && !isDisabled;
  const listening = dictation.status === "listening";

  const title = !dictation.supported
    ? "Dictée non supportée sur cet appareil"
    : listening
      ? "Arrêter la dictée"
      : "Démarrer la dictée";

  const className = [
    "sn-icon-btn",
    "h-10",
    "w-10",
    listening ? "bg-primary text-primary-foreground border-primary" : null,
    dictation.status === "error" ? "border-destructive" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={className}
      onMouseDown={(e) => {
        e.preventDefault();
      }}
      onTouchStart={(e) => {
        e.preventDefault();
      }}
      onClick={() => {
        if (!canUse) {
          dictation.start();
          return;
        }
        dictation.toggle();
      }}
      aria-label={title}
      title={dictation.error ? `${title}: ${dictation.error}` : title}
      disabled={isDisabled}
    >
      {listening ? <Square size={18} /> : <Mic size={18} />}
    </button>
  );
}
