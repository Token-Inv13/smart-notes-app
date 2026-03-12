"use client";

import Link from "next/link";
import { ChevronRight, Folder } from "lucide-react";
import type { WorkspaceDoc } from "@/types/firestore";

type ContentCounts = {
  notes: number;
  tasks: number;
  todos: number;
};

type ChildFolderItem = {
  workspace: WorkspaceDoc;
  href: string;
  counts: ContentCounts;
};

interface WorkspaceFolderBrowserProps {
  sectionHrefBase: string;
  workspaceChain: WorkspaceDoc[];
  childFolders: ChildFolderItem[];
  currentCounts: ContentCounts;
}

function formatCount(value: number, singular: string, plural: string) {
  return `${value} ${value > 1 ? plural : singular}`;
}

export default function WorkspaceFolderBrowser({
  sectionHrefBase,
  workspaceChain,
  childFolders,
  currentCounts,
}: WorkspaceFolderBrowserProps) {
  const currentWorkspace = workspaceChain[workspaceChain.length - 1];

  if (!currentWorkspace?.id) return null;

  return (
    <section className="space-y-3 rounded-2xl border border-border/70 bg-card/70 p-4">
      <div className="space-y-2">
        <nav aria-label="Chemin du dossier" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <Link href={sectionHrefBase} className="rounded px-1 py-0.5 hover:bg-accent hover:text-foreground">
            Tous les dossiers
          </Link>
          {workspaceChain.map((workspace, index) => {
            const isCurrent = index === workspaceChain.length - 1;
            const href = workspace.id ? `${sectionHrefBase}?workspaceId=${encodeURIComponent(workspace.id)}` : sectionHrefBase;

            return (
              <span key={workspace.id ?? `${workspace.name}-${index}`} className="inline-flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                {isCurrent ? (
                  <span className="font-medium text-foreground">{workspace.name}</span>
                ) : (
                  <Link href={href} className="rounded px-1 py-0.5 hover:bg-accent hover:text-foreground">
                    {workspace.name}
                  </Link>
                )}
              </span>
            );
          })}
        </nav>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">{currentWorkspace.name}</h2>
            <p className="text-sm text-muted-foreground">Sous-dossiers visibles d’abord, puis contenu direct du dossier courant.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-accent/70 px-2.5 py-1">{formatCount(currentCounts.notes, "note", "notes")}</span>
            <span className="rounded-full bg-accent/70 px-2.5 py-1">{formatCount(currentCounts.tasks, "tâche", "tâches")}</span>
            <span className="rounded-full bg-accent/70 px-2.5 py-1">{formatCount(currentCounts.todos, "checklist", "checklists")}</span>
          </div>
        </div>
      </div>

      {childFolders.length > 0 ? (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Sous-dossiers</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {childFolders.map(({ workspace, href, counts }) => (
              <Link
                key={workspace.id ?? workspace.name}
                href={href}
                className="group rounded-xl border border-border/70 bg-background/80 p-4 transition-colors hover:border-primary/30 hover:bg-accent/40"
              >
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-primary/10 p-2 text-primary">
                    <Folder className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-foreground">{workspace.name}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                      <span className="rounded-full bg-accent px-2 py-0.5">{formatCount(counts.notes, "note", "notes")}</span>
                      <span className="rounded-full bg-accent px-2 py-0.5">{formatCount(counts.tasks, "tâche", "tâches")}</span>
                      <span className="rounded-full bg-accent px-2 py-0.5">{formatCount(counts.todos, "checklist", "checklists")}</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border/80 bg-background/50 px-4 py-3 text-sm text-muted-foreground">
          Aucun sous-dossier direct dans ce dossier.
        </div>
      )}
    </section>
  );
}
