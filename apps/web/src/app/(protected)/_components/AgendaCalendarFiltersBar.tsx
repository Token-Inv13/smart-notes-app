"use client";

import { useMemo, useState } from "react";
import type { Priority } from "@/types/firestore";
import type { CalendarTimeWindowFilter } from "./useAgendaCalendarFilters";

type AgendaCalendarFiltersBarProps = {
  priorityFilter: "" | Priority;
  timeWindowFilter: CalendarTimeWindowFilter;
  onPriorityFilterChange: (value: "" | Priority) => void;
  onTimeWindowFilterChange: (value: CalendarTimeWindowFilter) => void;
  onReset: () => void;
};

export default function AgendaCalendarFiltersBar({
  priorityFilter,
  timeWindowFilter,
  onPriorityFilterChange,
  onTimeWindowFilterChange,
  onReset,
}: AgendaCalendarFiltersBarProps) {
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (priorityFilter) count += 1;
    if (timeWindowFilter) count += 1;
    return count;
  }, [priorityFilter, timeWindowFilter]);

  const [secondaryFiltersOpen, setSecondaryFiltersOpen] = useState(activeFiltersCount > 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setSecondaryFiltersOpen((prev) => !prev)}
          className="h-9 px-3 rounded-xl border border-input bg-background text-sm"
          aria-expanded={secondaryFiltersOpen}
          aria-label="Afficher les filtres agenda"
        >
          {activeFiltersCount > 0 ? `Filtres (${activeFiltersCount})` : "Filtres"}
        </button>
        {activeFiltersCount > 0 ? (
          <button
            type="button"
            onClick={onReset}
            className="h-9 px-3 rounded-xl border border-input bg-background text-sm"
          >
            Réinitialiser
          </button>
        ) : null}
      </div>

      {secondaryFiltersOpen ? (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={priorityFilter}
            onChange={(e) => onPriorityFilterChange(e.target.value as "" | Priority)}
            className="h-9 min-w-[11rem] rounded-xl border border-input bg-background px-3 text-sm"
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
            className="h-9 min-w-[12rem] rounded-xl border border-input bg-background px-3 text-sm"
            aria-label="Filtrer par plage horaire"
          >
            <option value="">Toutes plages</option>
            <option value="allDay">Toute la journée</option>
            <option value="morning">Matin</option>
            <option value="afternoon">Après-midi</option>
            <option value="evening">Soir</option>
          </select>
        </div>
      ) : null}
    </div>
  );
}
