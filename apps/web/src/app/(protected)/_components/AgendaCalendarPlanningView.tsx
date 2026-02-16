"use client";

import { useMemo } from "react";
import type { EventInput } from "@fullcalendar/core";
import { toHourMinuteLabel } from "./agendaCalendarUtils";
import type { PlanningSection, PlanningAvailabilitySlot } from "./useAgendaPlanningData";

type AgendaCalendarPlanningViewProps = {
  planningSections: PlanningSection[];
  planningAvailabilityByDate: Map<string, PlanningAvailabilitySlot[]>;
  showPlanningAvailability: boolean;
  planningAvailabilityTargetMinutes: number;
  onTogglePlanningAvailability: () => void;
  planningDuplicateDate: string;
  onPlanningDuplicateDateChange: (value: string) => void;
  selectedPlanningIds: string[];
  onClearSelection: () => void;
  onTogglePlanningSelection: (eventId: string) => void;
  onDuplicateByDays: (days: number) => Promise<void>;
  onDuplicateToDate: () => Promise<void>;
  duplicatingPlanning: boolean;
  onPlanningAvailabilityTargetMinutesChange: (value: number) => void;
  onOpenTask: (taskId: string) => void;
};

function formatPlanningTimeRange(start: Date | null, end: Date | null) {
  if (!start || !end) return "Heure non définie";
  return `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")} - ${String(
    end.getHours(),
  ).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
}

function getPlanningEventMeta(event: EventInput) {
  const workspaceName =
    typeof event.extendedProps?.workspaceName === "string" ? event.extendedProps.workspaceName : "Sans dossier";
  const taskId = typeof event.extendedProps?.taskId === "string" ? event.extendedProps.taskId : "";
  const conflict = event.extendedProps?.conflict === true;
  const conflictSource = (event.extendedProps?.conflictSource as "local" | "google" | "mix" | null) ?? null;
  const conflictScore = typeof event.extendedProps?.conflictScore === "number" ? event.extendedProps.conflictScore : 0;

  return {
    workspaceName,
    taskId,
    conflict,
    conflictSource,
    conflictScore,
    isExternal: !taskId,
  };
}

function formatConflictBadge(conflictSource: "local" | "google" | "mix" | null, conflictScore: number) {
  const sourceCode = conflictSource === "google" ? "G" : conflictSource === "mix" ? "M" : "L";
  return `Conflit ${sourceCode} · P${Math.min(9, conflictScore)}`;
}

export default function AgendaCalendarPlanningView({
  planningSections,
  planningAvailabilityByDate,
  showPlanningAvailability,
  planningAvailabilityTargetMinutes,
  onTogglePlanningAvailability,
  planningDuplicateDate,
  onPlanningDuplicateDateChange,
  selectedPlanningIds,
  onClearSelection,
  onTogglePlanningSelection,
  onDuplicateByDays,
  onDuplicateToDate,
  duplicatingPlanning,
  onPlanningAvailabilityTargetMinutesChange,
  onOpenTask,
}: AgendaCalendarPlanningViewProps) {
  const selectedPlanningIdSet = useMemo(() => new Set(selectedPlanningIds), [selectedPlanningIds]);

  return (
    <div className="space-y-4 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Sélection: {selectedPlanningIds.length}</span>
        <button
          type="button"
          className={`h-8 px-3 rounded-md border text-xs ${showPlanningAvailability ? "border-primary bg-accent" : "border-border bg-background"}`}
          onClick={onTogglePlanningAvailability}
        >
          Disponibilités futures
        </button>
        <select
          value={String(planningAvailabilityTargetMinutes)}
          onChange={(e) => onPlanningAvailabilityTargetMinutesChange(Number(e.target.value))}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          aria-label="Durée cible des disponibilités"
        >
          <option value="30">Slots ≥ 30 min</option>
          <option value="45">Slots ≥ 45 min</option>
          <option value="60">Slots ≥ 60 min</option>
          <option value="90">Slots ≥ 90 min</option>
        </select>
        <button
          type="button"
          className="h-8 px-3 rounded-md border border-border bg-background text-xs"
          onClick={() => void onDuplicateByDays(1)}
          disabled={selectedPlanningIds.length === 0 || duplicatingPlanning}
        >
          {duplicatingPlanning ? "Duplication…" : "J+1"}
        </button>
        <button
          type="button"
          className="h-8 px-3 rounded-md border border-border bg-background text-xs"
          onClick={() => void onDuplicateByDays(7)}
          disabled={selectedPlanningIds.length === 0 || duplicatingPlanning}
        >
          Semaine +1
        </button>
        <input
          type="date"
          value={planningDuplicateDate}
          onChange={(e) => onPlanningDuplicateDateChange(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          aria-label="Date cible de duplication"
        />
        <button
          type="button"
          className="h-8 px-3 rounded-md border border-border bg-background text-xs"
          onClick={() => void onDuplicateToDate()}
          disabled={selectedPlanningIds.length === 0 || duplicatingPlanning || !planningDuplicateDate}
        >
          Copier à date
        </button>
        <button
          type="button"
          className="h-8 px-3 rounded-md border border-border bg-background text-xs"
          onClick={onClearSelection}
          disabled={selectedPlanningIds.length === 0 || duplicatingPlanning}
        >
          Vider la sélection
        </button>
      </div>

      {planningSections.length === 0 ? (
        <div className="text-sm text-muted-foreground">Aucun élément à afficher dans la vue planning.</div>
      ) : (
        planningSections.map((section) => (
          <div key={section.dateKey} className="space-y-2">
            <div className="text-sm font-semibold">{section.dateKey}</div>
            <ul className="space-y-2">
              {section.events.map((event) => {
                const start = event.start instanceof Date ? event.start : null;
                const end = event.end instanceof Date ? event.end : null;
                const meta = getPlanningEventMeta(event);
                const timeLabel = formatPlanningTimeRange(start, end);

                return (
                  <li key={String(event.id)} className="relative pl-4">
                    <span className="absolute left-0 top-2 h-2 w-2 rounded-full bg-primary" />
                    <div className="flex items-start gap-2 rounded-md border border-border bg-background px-2 py-2">
                      {meta.isExternal ? (
                        <span className="mt-1 inline-flex h-4 min-w-4 items-center justify-center rounded border border-border px-1 text-[10px] text-muted-foreground">
                          G
                        </span>
                      ) : (
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={selectedPlanningIdSet.has(String(event.id))}
                          onChange={() => onTogglePlanningSelection(String(event.id))}
                          aria-label={`Sélectionner ${event.title}`}
                        />
                      )}
                      <button
                        type="button"
                        className="flex-1 text-left hover:bg-accent rounded-md px-1 py-1"
                        onClick={() => {
                          if (meta.taskId) onOpenTask(meta.taskId);
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-medium truncate">{event.title}</div>
                          <div className="inline-flex items-center gap-1">
                            {meta.isExternal && <span className="text-[10px] text-blue-600">Google</span>}
                            {meta.conflict && (
                              <span className="text-[10px] text-red-600">
                                {formatConflictBadge(meta.conflictSource, meta.conflictScore)}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground">{timeLabel}</div>
                        <div className="text-xs text-muted-foreground">{meta.workspaceName}</div>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            {showPlanningAvailability && (
              <div className="rounded-md border border-border bg-muted/30 px-2 py-2">
                <div className="text-[11px] font-semibold text-muted-foreground">
                  Créneaux disponibles (08:00-20:00, ≥ {planningAvailabilityTargetMinutes} min)
                </div>
                {(() => {
                  const slots = planningAvailabilityByDate.get(section.dateKey) ?? [];
                  if (slots.length === 0) {
                    return <div className="text-xs text-muted-foreground mt-1">Aucun créneau futur détecté.</div>;
                  }

                  return (
                    <ul className="mt-1 space-y-1">
                      {slots.map((slot) => (
                        <li
                          key={`${section.dateKey}-${slot.start.toISOString()}-${slot.end.toISOString()}`}
                          className="text-xs text-muted-foreground"
                        >
                          {toHourMinuteLabel(slot.start)} - {toHourMinuteLabel(slot.end)} ({slot.durationMinutes} min)
                        </li>
                      ))}
                    </ul>
                  );
                })()}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
