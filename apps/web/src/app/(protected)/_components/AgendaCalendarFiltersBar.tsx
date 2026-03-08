"use client";

import { useMemo, useState } from "react";
import type { Priority } from "@/types/firestore";
import type { CalendarStatusFilter, CalendarTimeWindowFilter } from "./useAgendaCalendarFilters";

type AgendaCalendarFiltersBarProps = {
  showRecurringOnly: boolean;
  showConflictsOnly: boolean;
  priorityFilter: "" | Priority;
  timeWindowFilter: CalendarTimeWindowFilter;
  showClassicTasks: boolean;
  showChecklistItems: boolean;
  statusFilter: CalendarStatusFilter;
  onToggleRecurringOnly: () => void;
  onToggleConflictsOnly: () => void;
  onToggleClassicTasks: () => void;
  onToggleChecklistItems: () => void;
  onStatusFilterChange: (value: CalendarStatusFilter) => void;
  onPriorityFilterChange: (value: "" | Priority) => void;
  onTimeWindowFilterChange: (value: CalendarTimeWindowFilter) => void;
  onReset: () => void;
};

export default function AgendaCalendarFiltersBar({
  showRecurringOnly,
  showConflictsOnly,
  priorityFilter,
  timeWindowFilter,
  showClassicTasks,
  showChecklistItems,
  statusFilter,
  onToggleRecurringOnly,
  onToggleConflictsOnly,
  onToggleClassicTasks,
  onToggleChecklistItems,
  onStatusFilterChange,
  onPriorityFilterChange,
  onTimeWindowFilterChange,
  onReset,
}: AgendaCalendarFiltersBarProps) {
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (!showClassicTasks) count += 1;
    if (!showChecklistItems) count += 1;
    if (statusFilter !== "all") count += 1;
    if (showRecurringOnly) count += 1;
    if (showConflictsOnly) count += 1;
    if (priorityFilter) count += 1;
    if (timeWindowFilter) count += 1;
    return count;
  }, [priorityFilter, showChecklistItems, showClassicTasks, showConflictsOnly, showRecurringOnly, statusFilter, timeWindowFilter]);

  const [mobileExpanded, setMobileExpanded] = useState(activeFiltersCount > 0);

  return (
    <div className="space-y-2">
      <div className="md:hidden flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setMobileExpanded((prev) => !prev)}
          className="h-8 px-3 rounded-md border border-border bg-background text-xs"
          aria-expanded={mobileExpanded}
        >
          {mobileExpanded ? "Masquer les filtres" : "Afficher les filtres"}
        </button>
        {activeFiltersCount > 0 ? (
          <button
            type="button"
            className="sn-badge text-[11px]"
            onClick={() => setMobileExpanded(true)}
            aria-label="Ouvrir les filtres actifs"
          >
            {activeFiltersCount} actif(s)
          </button>
        ) : null}
      </div>

      <div className={`${mobileExpanded ? "flex" : "hidden"} md:flex flex-wrap items-center gap-2`}>
        <button
          type="button"
          onClick={onToggleClassicTasks}
          className={`h-8 px-3 rounded-md border text-xs ${showClassicTasks ? "border-primary bg-accent" : "border-border bg-background"}`}
          aria-pressed={showClassicTasks}
        >
          Tâches
        </button>
        <button
          type="button"
          onClick={onToggleChecklistItems}
          className={`h-8 px-3 rounded-md border text-xs ${showChecklistItems ? "border-primary bg-accent" : "border-border bg-background"}`}
          aria-pressed={showChecklistItems}
        >
          Checklist
        </button>

        <div className="inline-flex rounded-md border border-border bg-background overflow-hidden">
          <button
            type="button"
            onClick={() => onStatusFilterChange("all")}
            className={`h-8 px-3 text-xs ${statusFilter === "all" ? "bg-accent font-medium" : "hover:bg-accent/60"}`}
            aria-pressed={statusFilter === "all"}
          >
            Toutes
          </button>
          <button
            type="button"
            onClick={() => onStatusFilterChange("open")}
            className={`h-8 px-3 text-xs border-l border-border ${statusFilter === "open" ? "bg-accent font-medium" : "hover:bg-accent/60"}`}
            aria-pressed={statusFilter === "open"}
          >
            Non terminées
          </button>
          <button
            type="button"
            onClick={() => onStatusFilterChange("done")}
            className={`h-8 px-3 text-xs border-l border-border ${statusFilter === "done" ? "bg-accent font-medium" : "hover:bg-accent/60"}`}
            aria-pressed={statusFilter === "done"}
          >
            Terminées
          </button>
        </div>

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

        {(showRecurringOnly ||
          showConflictsOnly ||
          priorityFilter ||
          timeWindowFilter ||
          !showClassicTasks ||
          !showChecklistItems ||
          statusFilter !== "all") && (
          <button
            type="button"
            onClick={onReset}
            className="h-8 px-3 rounded-md border border-border bg-background text-xs"
          >
            Réinitialiser
          </button>
        )}
      </div>
    </div>
  );
}
