"use client";

import React from "react";
import { useRouter } from "next/navigation";

interface AgendaEmptyStateProps {
  activeSearchLabel: string | null;
  workspaceIdParam: string | null;
  onResetFilters: () => void;
  toLocalDateInputValue: (date: Date) => string;
}

const AgendaEmptyState: React.FC<AgendaEmptyStateProps> = ({
  activeSearchLabel,
  workspaceIdParam,
  onResetFilters,
  toLocalDateInputValue,
}) => {
  const router = useRouter();

  return (
    <div className="sn-empty sn-empty--premium sn-animate-in">
      <div className="sn-empty-title">
        {activeSearchLabel ? "Aucun résultat" : workspaceIdParam ? "Aucun élément direct dans ce dossier" : "Aucun élément d’agenda pour le moment"}
      </div>
      <div className="sn-empty-desc">
        {activeSearchLabel
          ? `Aucun element ne correspond a "${activeSearchLabel}" avec les filtres actuels.`
          : workspaceIdParam
            ? "Ajoute un élément ici ou ouvre un sous-dossier."
            : "Commence par ajouter un élément à l’agenda."}
      </div>
      {activeSearchLabel ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={onResetFilters}
            className="inline-flex items-center justify-center h-10 px-4 rounded-md border border-border bg-background text-sm font-medium hover:bg-accent/60"
          >
            Réinitialiser les filtres
          </button>
        </div>
      ) : (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => {
              const params = new URLSearchParams();
              if (workspaceIdParam) params.set("workspaceId", workspaceIdParam);
              params.set("create", "1");
              params.set("startDate", toLocalDateInputValue(new Date()));
              router.push(`/tasks?${params.toString()}`);
            }}
            className="inline-flex items-center justify-center h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-95 transition-opacity"
          >
            Créer une tâche
          </button>
        </div>
      )}
    </div>
  );
};

export default AgendaEmptyState;
