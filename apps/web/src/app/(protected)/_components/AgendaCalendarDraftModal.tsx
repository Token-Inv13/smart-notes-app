"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Priority, TaskCalendarKind, TaskRecurrenceFreq, WorkspaceDoc } from "@/types/firestore";
import { buildWorkspacePathLabelMap } from "@/lib/workspaces";
import {
  parseDateFromDraft,
  toLocalDateInputValue,
  toLocalInputValue,
} from "./agendaCalendarUtils";
import type { CalendarDraft } from "./useAgendaDraftManager";
import {
  TASK_EMPTY_PRIORITY_LABEL,
  TASK_EMPTY_WORKSPACE_LABEL,
  TASK_FIELD_DUE_LABEL,
  TASK_FIELD_PRIORITY_LABEL,
  TASK_FIELD_START_LABEL,
  TASK_FIELD_TITLE_LABEL,
  TASK_FIELD_WORKSPACE_LABEL,
  TASK_MODAL_CREATE_TITLE,
  TASK_MODAL_EDIT_TITLE,
  TASK_PRIORITY_OPTIONS,
} from "./taskModalLabels";

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
  const [closing, setClosing] = useState(false);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const hadDraftRef = useRef(false);
  const workspaceOptionLabelById = useMemo(() => buildWorkspacePathLabelMap(workspaces), [workspaces]);

  useEffect(() => {
    const hasDraft = Boolean(draft);
    if (hasDraft && !hadDraftRef.current) {
      window.requestAnimationFrame(() => {
        setClosing(false);
        titleInputRef.current?.focus();
        titleInputRef.current?.select();
      });
    }
    hadDraftRef.current = hasDraft;
  }, [draft]);

  const requestClose = useCallback(() => {
    setClosing(true);
    window.setTimeout(() => setDraft(null), 160);
  }, [setDraft]);

  useEffect(() => {
    if (!draft) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      requestClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [draft, requestClose]);

  if (!draft) return null;
  const isBirthday = draft.calendarKind === "birthday";

  const applyCalendarKind = (nextKind: TaskCalendarKind) => {
    setDraft((prev) => {
      if (!prev) return prev;
      if (nextKind === "birthday") {
        const start = parseDateFromDraft(prev.startLocal, prev.allDay) ?? new Date();
        const end =
          parseDateFromDraft(prev.endLocal, prev.allDay) ??
          new Date(start.getTime() + 60 * 60 * 1000);
        const safeEnd = end.getTime() > start.getTime() ? end : new Date(start.getTime() + 60 * 60 * 1000);
        return {
          ...prev,
          calendarKind: "birthday",
          allDay: true,
          startLocal: toLocalDateInputValue(start),
          endLocal: toLocalDateInputValue(safeEnd),
          recurrenceFreq: "yearly",
        };
      }

      return {
        ...prev,
        calendarKind: "task",
      };
    });
  };

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={draft.taskId ? TASK_MODAL_EDIT_TITLE : TASK_MODAL_CREATE_TITLE}
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/40 sn-modal-backdrop"
        onClick={requestClose}
        aria-label="Fermer"
      />
      <div className={`absolute bottom-0 left-0 right-0 sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:right-auto sm:w-[min(92vw,560px)] sm:-translate-x-1/2 sm:-translate-y-1/2 rounded-t-lg sm:rounded-lg border border-border bg-card shadow-lg p-4 space-y-3 sn-modal-panel transition-opacity ${closing ? "opacity-0" : "opacity-100"}`}>
        <div className="text-sm font-semibold">{draft.taskId ? TASK_MODAL_EDIT_TITLE : TASK_MODAL_CREATE_TITLE}</div>

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

        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="agenda-draft-title">
            {TASK_FIELD_TITLE_LABEL}
          </label>
          <input
            id="agenda-draft-title"
            ref={titleInputRef}
            value={draft.title}
            onChange={(e) => setDraft((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
            placeholder={TASK_FIELD_TITLE_LABEL}
            className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
            aria-label={TASK_FIELD_TITLE_LABEL}
          />
        </div>

        <label className="text-xs flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.allDay}
            disabled={isBirthday}
            onChange={(e) =>
              setDraft((prev) => {
                if (!prev) return prev;
                const nextAllDay = e.target.checked;
                const start = parseDateFromDraft(prev.startLocal, prev.allDay) ?? new Date();
                const end =
                  parseDateFromDraft(prev.endLocal, prev.allDay) ??
                  new Date(start.getTime() + 60 * 60 * 1000);
                const safeTimedEnd = end.getTime() > start.getTime() ? end : new Date(start.getTime() + 60 * 60 * 1000);
                return {
                  ...prev,
                  allDay: nextAllDay,
                  startLocal: nextAllDay ? toLocalDateInputValue(start) : toLocalInputValue(start),
                  endLocal: nextAllDay ? toLocalDateInputValue(end) : toLocalInputValue(safeTimedEnd),
                };
              })
            }
          />
          Toute la journée
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-sm font-medium">{TASK_FIELD_START_LABEL}</span>
            <input
              type={draft.allDay ? "date" : "datetime-local"}
              value={draft.startLocal}
              onChange={(e) => setDraft((prev) => (prev ? { ...prev, startLocal: e.target.value } : prev))}
              className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
              aria-label={TASK_FIELD_START_LABEL}
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">{TASK_FIELD_DUE_LABEL}</span>
            <input
              type={draft.allDay ? "date" : "datetime-local"}
              value={draft.endLocal}
              onChange={(e) => setDraft((prev) => (prev ? { ...prev, endLocal: e.target.value } : prev))}
              className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
              aria-label={TASK_FIELD_DUE_LABEL}
            />
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <select
            value={draft.calendarKind}
            onChange={(e) => applyCalendarKind(e.target.value as TaskCalendarKind)}
            className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
            aria-label="Type d’événement"
          >
            <option value="task">Élément agenda</option>
            <option value="birthday">Anniversaire</option>
          </select>

          <select
            value={draft.recurrenceFreq}
            onChange={(e) =>
              setDraft((prev) =>
                prev ? { ...prev, recurrenceFreq: e.target.value as "" | TaskRecurrenceFreq } : prev,
              )
            }
            className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
            aria-label="Récurrence"
            disabled={isBirthday}
          >
            <option value="">Sans récurrence</option>
            <option value="daily">Chaque jour</option>
            <option value="weekly">Chaque semaine</option>
            <option value="monthly">Chaque mois</option>
            <option value="yearly">Chaque année</option>
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-sm font-medium">{TASK_FIELD_WORKSPACE_LABEL}</span>
            <select
              value={draft.workspaceId}
              onChange={(e) => setDraft((prev) => (prev ? { ...prev, workspaceId: e.target.value } : prev))}
              className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
              aria-label={TASK_FIELD_WORKSPACE_LABEL}
            >
              <option value="">{TASK_EMPTY_WORKSPACE_LABEL}</option>
              {workspaces.map((ws) => (
                <option key={ws.id ?? ws.name} value={ws.id ?? ""} disabled={!ws.id}>
                  {workspaceOptionLabelById.get(ws.id ?? "") ?? ws.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium">{TASK_FIELD_PRIORITY_LABEL}</span>
            <select
              value={draft.priority}
              onChange={(e) =>
                setDraft((prev) => (prev ? { ...prev, priority: e.target.value as "" | Priority } : prev))
              }
              className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
              aria-label={TASK_FIELD_PRIORITY_LABEL}
            >
              <option value="">{TASK_EMPTY_PRIORITY_LABEL}</option>
              {TASK_PRIORITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            type="date"
            value={draft.recurrenceUntil}
            onChange={(e) =>
              setDraft((prev) => (prev ? { ...prev, recurrenceUntil: e.target.value } : prev))
            }
            className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
            aria-label="Récurrence jusqu’au"
            disabled={!draft.recurrenceFreq && !isBirthday}
          />
          <div className="hidden sm:block" aria-hidden />
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
            <button type="button" className="sn-text-btn" onClick={requestClose}>
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
