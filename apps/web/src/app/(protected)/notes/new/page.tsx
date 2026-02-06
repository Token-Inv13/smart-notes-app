"use client";

import { useSearchParams } from "next/navigation";
import NoteCreateForm from "../../_components/NoteCreateForm";

export default function NewNotePage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId") || undefined;
  const initialFavorite = searchParams.get("favorite") === "1";

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Nouvelle note</h1>
        <div className="text-sm text-muted-foreground">Capture une idée rapidement.</div>
      </header>

      <section className="border border-border rounded-lg bg-card p-4">
        <NoteCreateForm initialWorkspaceId={workspaceId} initialFavorite={initialFavorite} />
      </section>
    </div>
  );
}
