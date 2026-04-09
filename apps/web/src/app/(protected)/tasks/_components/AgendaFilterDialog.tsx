"use client";

import { normalizeDisplayText } from "@/lib/normalizeText";
import type { WorkspaceDoc } from "@/types/firestore";

export type TaskStatusFilter = "all" | "todo" | "doing" | "done";
export type TaskPriorityFilter = "all" | "low" | "medium" | "high";
export type DueFilter = "all" | "today" | "overdue";
export type TaskSortBy = "dueDate" | "updatedAt" | "createdAt";
export type WorkspaceFilter = "all" | string;

interface AgendaFilterDialogProps {
  isOpen: boolean;
  onClose: () => void;
  statusFilter: TaskStatusFilter;
  onStatusChange: (val: TaskStatusFilter) => void;
  priorityFilter: TaskPriorityFilter;
  onPriorityChange: (val: TaskPriorityFilter) => void;
  dueFilter: DueFilter;
  onDueChange: (val: DueFilter) => void;
  sortBy: TaskSortBy;
  onSortByChange: (val: TaskSortBy) => void;
  workspaceFilter: WorkspaceFilter;
  onWorkspaceChange: (val: WorkspaceFilter) => void;
  workspaces: WorkspaceDoc[];
  workspaceOptionLabels: Map<string, string>;
  onReset: () => void;
}

export default function AgendaFilterDialog({
  isOpen,
  onClose,
  statusFilter,
  onStatusChange,
  priorityFilter,
  onPriorityChange,
  dueFilter,
  onDueChange,
  sortBy,
  onSortByChange,
  workspaceFilter,
  onWorkspaceChange,
  workspaces,
  workspaceOptionLabels,
  onReset,
}: AgendaFilterDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Filtres agenda">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label="Fermer les filtres"
      />
      <div className="absolute left-0 right-0 bottom-0 w-full sm:left-1/2 sm:top-1/2 sm:right-auto sm:bottom-auto sm:w-[min(92vw,520px)] sm:-translate-x-1/2 sm:-translate-y-1/2 rounded-t-lg sm:rounded-lg border border-border bg-card shadow-lg max-h-[85dvh] overflow-y-auto">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="text-sm font-semibold">Filtres</div>
          <button
            type="button"
            onClick={onClose}
            className="sn-icon-btn"
            aria-label="Fermer"
          >
            ×
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Statut</div>
              <select
                value={statusFilter}
                onChange={(e) => onStatusChange(e.target.value as TaskStatusFilter)}
                aria-label="Filtrer par statut"
                className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
              >
                <option value="all">Tous</option>
                <option value="todo">À faire</option>
                <option value="doing">En cours</option>
                <option value="done">Terminée</option>
              </select>
            </div>

            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Priorité</div>
              <select
                value={priorityFilter}
                onChange={(e) => onPriorityChange(e.target.value as TaskPriorityFilter)}
                aria-label="Filtrer par priorité"
                className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
              >
                <option value="all">Toutes</option>
                <option value="high">Haute</option>
                <option value="medium">Moyenne</option>
                <option value="low">Basse</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Échéance</div>
              <select
                value={dueFilter}
                onChange={(e) => onDueChange(e.target.value as DueFilter)}
                aria-label="Filtrer par échéance"
                className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
              >
                <option value="all">Toutes</option>
                <option value="today">Aujourd’hui</option>
                <option value="overdue">En retard</option>
              </select>
            </div>

            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Tri</div>
              <select
                value={sortBy}
                onChange={(e) => onSortByChange(e.target.value as TaskSortBy)}
                aria-label="Trier l’agenda"
                className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
              >
                <option value="dueDate">Échéance</option>
                <option value="updatedAt">Dernière modification</option>
                <option value="createdAt">Date de création</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Dossier</div>
            <select
              value={workspaceFilter}
              onChange={(e) => onWorkspaceChange(e.target.value)}
              aria-label="Filtrer par dossier"
              className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
            >
              <option value="all">Tous les dossiers</option>
              {workspaces.map((ws) => (
                <option key={ws.id ?? ws.name} value={ws.id ?? ""} disabled={!ws.id}>
                  {workspaceOptionLabels.get(ws.id ?? "") ?? normalizeDisplayText(ws.name)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between gap-3 pt-2">
            <button
              type="button"
              className="sn-text-btn"
              onClick={onReset}
            >
              Réinitialiser
            </button>

            <button
              type="button"
              className="inline-flex items-center justify-center h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium"
              onClick={onClose}
            >
              Appliquer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
