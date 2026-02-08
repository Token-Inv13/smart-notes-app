"use client";

import { useAssistantSettings } from "@/hooks/useAssistantSettings";

type Props = {
  noteId?: string;
};

export default function AssistantNotePanel({ noteId }: Props) {
  const { data: assistantSettings, loading } = useAssistantSettings();
  const enabled = assistantSettings?.enabled === true;

  if (loading) return null;
  if (!enabled) return null;

  return (
    <div className="sn-card p-4 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">Assistant</div>
        <button
          type="button"
          disabled
          className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
          aria-disabled="true"
          title="Bientôt disponible"
        >
          Analyser cette note
        </button>
      </div>
      <div className="text-sm text-muted-foreground">Suggestions à venir.</div>
      {noteId ? <div className="text-xs text-muted-foreground">Note: {noteId}</div> : null}
    </div>
  );
}
