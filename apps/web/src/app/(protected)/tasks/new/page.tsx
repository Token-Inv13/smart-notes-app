"use client";

import { useSearchParams } from "next/navigation";
import TaskCreateForm from "../../_components/TaskCreateForm";
import { TASK_MODAL_CREATE_TITLE } from "../../_components/taskModalLabels";

export default function NewTaskPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId") || undefined;
  const initialFavorite = searchParams.get("favorite") === "1";
  const initialStartDate = searchParams.get("startDate") || undefined;

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{TASK_MODAL_CREATE_TITLE}</h1>
        <div className="text-sm text-muted-foreground">Planifie un élément d’agenda et, si besoin, ajoute un rappel.</div>
      </header>

      <section className="border border-border rounded-lg bg-card p-4">
        <TaskCreateForm
          initialWorkspaceId={workspaceId}
          initialFavorite={initialFavorite}
          initialStartDate={initialStartDate}
        />
      </section>
    </div>
  );
}
