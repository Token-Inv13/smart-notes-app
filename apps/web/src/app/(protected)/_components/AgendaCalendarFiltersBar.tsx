"use client";

import type { Priority } from "@/types/firestore";
import type { CalendarTimeWindowFilter } from "./useAgendaCalendarFilters";

type AgendaCalendarFiltersBarProps = {
  showRecurringOnly: boolean;
  showConflictsOnly: boolean;
  priorityFilter: "" | Priority;
  timeWindowFilter: CalendarTimeWindowFilter;
  onToggleRecurringOnly: () => void;
  onToggleConflictsOnly: () => void;
  onPriorityFilterChange: (value: "" | Priority) => void;
  onTimeWindowFilterChange: (value: CalendarTimeWindowFilter) => void;
  onReset: () => void;
};

export default function AgendaCalendarFiltersBar({
  showRecurringOnly,
  showConflictsOnly,
  priorityFilter,
  timeWindowFilter,
  onToggleRecurringOnly,
  onToggleConflictsOnly,
  onPriorityFilterChange,
  onTimeWindowFilterChange,
  onReset,
}: AgendaCalendarFiltersBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onToggleRecurringOnly}
        className={`h-8 px-3 rounded-md border text-xs ${showRecurringOnly ? "border-primary bg-accent" : "border-border bg-background"}`}
        title="Cet événement se répète automatiquement (chaque jour/semaine/mois)."
        aria-label="Filtre Répéter — Cet événement se répète automatiquement"
      >
        ↻ Répéter
      </button>
      <button
        type="button"
        onClick={onToggleConflictsOnly}
        className={`h-8 px-3 rounded-md border text-xs ${showConflictsOnly ? "border-primary bg-accent" : "border-border bg-background"}`}
        title="Cet horaire entre en conflit avec un autre événement."
        aria-label="Filtre Chevauchement d’horaire — Cet horaire entre en conflit avec un autre événement"
      >
        ⚠️ Chevauchement d’horaire
      </button>

      <div className="w-full md:hidden text-[11px] text-muted-foreground leading-relaxed">
        ↻ Répéter: événement automatique (jour/semaine/mois) · ⚠️ Chevauchement: horaire en conflit.
      </div>

      <select
        value={priorityFilter}
        onChange={(e) => onPriorityFilterChange(e.target.value as "" | Priority)}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        aria-label="Filtrer par priorité"
      >
        <option value="">Toutes priorités</option>
        <option value="high">Priorité haute</option>
        <option value="medium">Priorité moyenne</option>
        <option value="low">Priorité basse</option>
      </select>

      <select
        value={timeWindowFilter}
        onChange={(e) => onTimeWindowFilterChange(e.target.value as CalendarTimeWindowFilter)}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        aria-label="Filtrer par plage horaire"
      >
        <option value="">Toutes plages</option>
        <option value="allDay">Toute la journée</option>
        <option value="morning">Matin</option>
        <option value="afternoon">Après-midi</option>
        <option value="evening">Soir</option>
      </select>

      {(showRecurringOnly || showConflictsOnly || priorityFilter || timeWindowFilter) && (
        <button
          type="button"
          onClick={onReset}
          className="h-8 px-3 rounded-md border border-border bg-background text-xs"
        >
          Réinitialiser
        </button>
      )}
    </div>
  );
}
