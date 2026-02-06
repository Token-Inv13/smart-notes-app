"use client";

import { useSearchParams } from "next/navigation";
import TaskCreateForm from "../../_components/TaskCreateForm";

export default function NewTaskPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId") || undefined;
  const initialFavorite = searchParams.get("favorite") === "1";

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Nouvelle tâche</h1>
        <div className="text-sm text-muted-foreground">Planifie une tâche et, si besoin, ajoute un rappel.</div>
      </header>

      <section className="border border-border rounded-lg bg-card p-4">
        <TaskCreateForm initialWorkspaceId={workspaceId} initialFavorite={initialFavorite} />
      </section>
    </div>
  );
}
