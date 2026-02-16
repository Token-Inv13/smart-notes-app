"use client";

import type { Dispatch, SetStateAction } from "react";
import type { Priority, TaskRecurrenceFreq, WorkspaceDoc } from "@/types/firestore";
import {
  parseDateFromDraft,
  toLocalDateInputValue,
  toLocalInputValue,
} from "./agendaCalendarUtils";
import type { CalendarDraft } from "./useAgendaDraftManager";

type AgendaCalendarDraftModalProps = {
  draft: CalendarDraft | null;
  setDraft: Dispatch<SetStateAction<CalendarDraft | null>>;
  editScope: "series" | "occurrence";
  setEditScope: Dispatch<SetStateAction<"series" | "occurrence">>;
  workspaces: WorkspaceDoc[];
  onOpenTask: (taskId: string) => void;
  onSkipOccurrence?: (taskId: string, occurrenceDate: string) => Promise<void>;
  skipOccurrence: () => Promise<void>;
  saveDraft: () => Promise<void>;
  saving: boolean;
};

export default function AgendaCalendarDraftModal({
  draft,
  setDraft,
  editScope,
  setEditScope,
  workspaces,
  onOpenTask,
  onSkipOccurrence,
  skipOccurrence,
  saveDraft,
  saving,
}: AgendaCalendarDraftModalProps) {
  if (!draft) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Éditeur agenda">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={() => setDraft(null)}
        aria-label="Fermer"
      />
      <div className="absolute bottom-0 left-0 right-0 sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:right-auto sm:w-[min(92vw,560px)] sm:-translate-x-1/2 sm:-translate-y-1/2 rounded-t-lg sm:rounded-lg border border-border bg-card shadow-lg p-4 space-y-3">
        <div className="text-sm font-semibold">{draft.taskId ? "Modifier l’élément d’agenda" : "Nouvel élément d’agenda"}</div>

        {draft.taskId && draft.instanceDate && draft.recurrenceFreq && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setEditScope("occurrence")}
              className={`h-9 rounded-md border text-sm ${editScope === "occurrence" ? "border-primary bg-accent" : "border-border bg-background"}`}
            >
              Cette occurrence
            </button>
            <button
              type="button"
              onClick={() => setEditScope("series")}
              className={`h-9 rounded-md border text-sm ${editScope === "series" ? "border-primary bg-accent" : "border-border bg-background"}`}
            >
              Toute la série
            </button>
          </div>
        )}

        <input
          value={draft.title}
          onChange={(e) => setDraft((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
          placeholder="Titre"
          className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
          aria-label="Titre"
        />

        <label className="text-xs flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.allDay}
            onChange={(e) =>
              setDraft((prev) => {
                if (!prev) return prev;
                const start = parseDateFromDraft(prev.startLocal, prev.allDay) ?? new Date();
                const end =
                  parseDateFromDraft(prev.endLocal, prev.allDay) ??
                  new Date(start.getTime() + 60 * 60 * 1000);
                return {
                  ...prev,
                  allDay: e.target.checked,
                  startLocal: e.target.checked ? toLocalDateInputValue(start) : toLocalInputValue(start),
                  endLocal: e.target.checked ? toLocalDateInputValue(end) : toLocalInputValue(end),
                };
              })
            }
          />
          Toute la journée
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            type={draft.allDay ? "date" : "datetime-local"}
            value={draft.startLocal}
            onChange={(e) => setDraft((prev) => (prev ? { ...prev, startLocal: e.target.value } : prev))}
            className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
            aria-label="Début"
          />
          <input
            type={draft.allDay ? "date" : "datetime-local"}
            value={draft.endLocal}
            onChange={(e) => setDraft((prev) => (prev ? { ...prev, endLocal: e.target.value } : prev))}
            className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
            aria-label="Fin"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <select
            value={draft.workspaceId}
            onChange={(e) => setDraft((prev) => (prev ? { ...prev, workspaceId: e.target.value } : prev))}
            className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
            aria-label="Dossier"
          >
            <option value="">Sans dossier</option>
            {workspaces.map((ws) => (
              <option key={ws.id ?? ws.name} value={ws.id ?? ""} disabled={!ws.id}>
                {ws.name}
              </option>
            ))}
          </select>

          <select
            value={draft.priority}
            onChange={(e) =>
              setDraft((prev) => (prev ? { ...prev, priority: e.target.value as "" | Priority } : prev))
            }
            className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
            aria-label="Priorité"
          >
            <option value="">Priorité</option>
            <option value="low">Basse</option>
            <option value="medium">Moyenne</option>
            <option value="high">Haute</option>
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <select
            value={draft.recurrenceFreq}
            onChange={(e) =>
              setDraft((prev) =>
                prev ? { ...prev, recurrenceFreq: e.target.value as "" | TaskRecurrenceFreq } : prev,
              )
            }
            className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
            aria-label="Récurrence"
          >
            <option value="">Sans récurrence</option>
            <option value="daily">Chaque jour</option>
            <option value="weekly">Chaque semaine</option>
            <option value="monthly">Chaque mois</option>
          </select>

          <input
            type="date"
            value={draft.recurrenceUntil}
            onChange={(e) =>
              setDraft((prev) => (prev ? { ...prev, recurrenceUntil: e.target.value } : prev))
            }
            className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
            aria-label="Récurrence jusqu’au"
            disabled={!draft.recurrenceFreq}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          {draft.taskId ? (
            <div className="inline-flex items-center gap-3">
              <button
                type="button"
                className="sn-text-btn"
                onClick={() => {
                  if (!draft.taskId) return;
                  onOpenTask(draft.taskId);
                }}
              >
                Ouvrir le détail
              </button>
              {draft.recurrenceFreq && draft.instanceDate && onSkipOccurrence && (
                <button type="button" className="sn-text-btn" onClick={() => void skipOccurrence()}>
                  Ignorer cette occurrence
                </button>
              )}
            </div>
          ) : (
            <span />
          )}

          <div className="inline-flex items-center gap-2">
            <button type="button" className="sn-text-btn" onClick={() => setDraft(null)}>
              Annuler
            </button>
            <button
              type="button"
              onClick={() => void saveDraft()}
              disabled={saving}
              className="inline-flex items-center justify-center h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium"
            >
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
