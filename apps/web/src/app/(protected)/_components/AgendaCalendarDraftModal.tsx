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
  onDeleteTask: (taskId: string) => Promise<void>;
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
  onDeleteTask,
  skipOccurrence,
  saveDraft,
  saving,
}: AgendaCalendarDraftModalProps) {
  const [closing, setClosing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
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
    setDeleting(false);
    setDeleteError(null);

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
  const isOccurrenceDeletion = Boolean(draft.taskId && draft.instanceDate && draft.recurrenceFreq && editScope === "occurrence");

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

  const handleDelete = async () => {
    if (!draft.taskId || saving || deleting) return;

    const confirmMessage = isOccurrenceDeletion
      ? "Supprimer cette occurrence ? Cette action est irréversible."
      : "Supprimer cet élément ? Cette action est irréversible.";
    if (!window.confirm(confirmMessage)) return;

    setDeleting(true);
    setDeleteError(null);
    try {
      if (isOccurrenceDeletion) {
        await skipOccurrence();
        return;
      }

      await onDeleteTask(draft.taskId);
      requestClose();
    } catch {
      setDeleteError("Impossible de supprimer l’élément pour le moment.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
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
      <div className={`relative z-10 w-full max-w-[560px] max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-2xl border border-border bg-card shadow-lg p-4 space-y-3 sn-modal-panel transition-opacity sm:max-h-[calc(100dvh-3rem)] ${closing ? "opacity-0" : "opacity-100"}`}>
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

        <div className="space-y-2 rounded-xl border border-border/70 bg-background/60 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium">Date et heure</div>
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
                      parseDateFromDraft(prev.endLocal, prev.allDay) ?? new Date(start.getTime() + 60 * 60 * 1000);
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
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium">Type</span>
            <select
              value={draft.calendarKind}
              onChange={(e) => applyCalendarKind(e.target.value as TaskCalendarKind)}
              className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
              aria-label="Type d’événement"
            >
              <option value="task">Élément agenda</option>
              <option value="birthday">Anniversaire</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium">Récurrence</span>
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
          </label>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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

        {(draft.recurrenceFreq || isBirthday) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-sm font-medium">Récurrence jusqu’au</span>
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
            </label>
            <div className="hidden sm:block" aria-hidden />
          </div>
        )}

        {deleteError ? <div className="sn-alert sn-alert--error">{deleteError}</div> : null}

        <div className="flex items-center justify-end gap-3">
          <div className="inline-flex items-center gap-2">
            <button type="button" className="sn-text-btn" onClick={requestClose}>
              Annuler
            </button>
            {draft.taskId ? (
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={saving || deleting}
                className="inline-flex items-center justify-center h-10 px-4 rounded-md border border-destructive/30 bg-destructive/5 text-sm font-medium text-destructive disabled:opacity-50"
              >
                {deleting ? "Suppression..." : isOccurrenceDeletion ? "Supprimer cette occurrence" : "Supprimer"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void saveDraft()}
              disabled={saving}
              className="inline-flex items-center justify-center h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium"
            >
              {saving ? "Enregistrement..." : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
