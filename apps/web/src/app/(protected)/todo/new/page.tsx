"use client";

import { useSearchParams } from "next/navigation";
import TodoCreateForm from "../../_components/TodoCreateForm";

export default function NewTodoPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId") || undefined;
  const initialFavorite = searchParams.get("favorite") === "1";

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Nouvelle checklist</h1>
        <div className="text-sm text-muted-foreground">Crée une checklist rapidement.</div>
      </header>

      <section className="border border-border rounded-lg bg-card p-4">
        <TodoCreateForm initialWorkspaceId={workspaceId} initialFavorite={initialFavorite} showActions />
      </section>
    </div>
  );
}
