"use client";

import { useSearchParams } from "next/navigation";
import TodoCreateForm from "../../_components/TodoCreateForm";

export default function NewTodoPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId") || undefined;

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Nouvelle ToDo</h1>
        <div className="text-sm text-muted-foreground">Crée une ToDo rapidement.</div>
      </header>

      <section className="border border-border rounded-lg bg-card p-4">
        <TodoCreateForm initialWorkspaceId={workspaceId} showActions />
      </section>
    </div>
  );
}
