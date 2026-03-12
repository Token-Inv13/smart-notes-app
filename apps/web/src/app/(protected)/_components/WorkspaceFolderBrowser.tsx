"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useDroppable } from "@dnd-kit/core";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { ChevronRight, Folder, FolderOpen, Plus } from "lucide-react";
import { auth, db } from "@/lib/firebase";
import type { WorkspaceDoc } from "@/types/firestore";
import {
  buildFolderDropId,
  DraggableCard,
  type FolderDropData,
  type FolderDragData,
} from "./folderDnd";

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
  allWorkspaces: WorkspaceDoc[];
  workspaceChain: WorkspaceDoc[];
  childFolders: ChildFolderItem[];
  currentCounts: ContentCounts;
  activeDragItem?: FolderDragData | null;
  isFolderDropDisabled?: (workspaceId: string, dragItem: FolderDragData | null) => boolean;
}

function formatCount(value: number, singular: string, plural: string) {
  return `${value} ${value > 1 ? plural : singular}`;
}

export default function WorkspaceFolderBrowser({
  sectionHrefBase,
  allWorkspaces,
  workspaceChain,
  childFolders,
  currentCounts,
  activeDragItem = null,
  isFolderDropDisabled,
}: WorkspaceFolderBrowserProps) {
  const currentWorkspace = workspaceChain[workspaceChain.length - 1];
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isCreateOpen) return;
    inputRef.current?.focus();
  }, [isCreateOpen]);

  if (!currentWorkspace?.id) return null;

  const handleCreateSubfolder = async () => {
    const user = auth.currentUser;
    const name = newFolderName.trim();

    if (!user) {
      setCreateError("Tu dois etre connecte.");
      return;
    }

    if (!name) {
      setCreateError("Le nom est requis.");
      return;
    }

    if (!currentWorkspace.id || isSubmitting) return;

    setIsSubmitting(true);
    setCreateError(null);

    try {
      const nextOrder =
        allWorkspaces.reduce((max, workspace) => {
          const order = typeof workspace.order === "number" ? workspace.order : null;
          if (order === null) return max;
          return Math.max(max, order);
        }, allWorkspaces.length) + 1;

      await addDoc(collection(db, "workspaces"), {
        ownerId: user.uid,
        name,
        parentId: currentWorkspace.id,
        order: nextOrder,
        members: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setNewFolderName("");
      setIsCreateOpen(false);
    } catch (error) {
      console.error("Error creating child workspace", error);
      setCreateError("Erreur lors de la creation du sous-dossier.");
    } finally {
      setIsSubmitting(false);
    }
  };

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
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-accent/70 px-2.5 py-1">{formatCount(currentCounts.notes, "note", "notes")}</span>
            <span className="rounded-full bg-accent/70 px-2.5 py-1">{formatCount(currentCounts.tasks, "tâche", "tâches")}</span>
            <span className="rounded-full bg-accent/70 px-2.5 py-1">{formatCount(currentCounts.todos, "checklist", "checklists")}</span>
            <button
              type="button"
              onClick={() => {
                setIsCreateOpen((prev) => !prev);
                setCreateError(null);
                if (isCreateOpen) {
                  setNewFolderName("");
                }
              }}
              className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/85 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Créer un sous-dossier</span>
            </button>
          </div>
        </div>

        {isCreateOpen ? (
          <div className="rounded-xl border border-border/70 bg-background/75 p-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                ref={inputRef}
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleCreateSubfolder();
                  }
                  if (event.key === "Escape") {
                    setIsCreateOpen(false);
                    setNewFolderName("");
                    setCreateError(null);
                  }
                }}
                placeholder="Nom du sous-dossier"
                aria-label="Nom du sous-dossier"
                className="h-10 flex-1 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={isSubmitting}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateOpen(false);
                    setNewFolderName("");
                    setCreateError(null);
                  }}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-input px-3 text-sm hover:bg-accent"
                  disabled={isSubmitting}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() => void handleCreateSubfolder()}
                  className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isSubmitting || !newFolderName.trim()}
                >
                  {isSubmitting ? "Création…" : "Créer"}
                </button>
              </div>
            </div>
            {createError ? <p className="mt-2 text-sm text-destructive">{createError}</p> : null}
          </div>
        ) : null}
      </div>

      {childFolders.length > 0 ? (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Sous-dossiers</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {childFolders.map(({ workspace, href, counts }) => (
              <WorkspaceFolderTile
                key={workspace.id ?? workspace.name}
                workspace={workspace}
                href={href}
                counts={counts}
                activeDragItem={activeDragItem}
                isDropDisabled={workspace.id ? isFolderDropDisabled?.(workspace.id, activeDragItem) ?? false : true}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border/80 bg-gradient-to-br from-background via-background to-accent/20 px-5 py-5">
          <div className="flex items-start gap-3">
            <div className="rounded-xl border border-border/70 bg-background/90 p-2.5 text-muted-foreground">
              <FolderOpen className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-semibold text-foreground">Aucun sous-dossier direct</div>
              <p className="text-sm text-muted-foreground">
                Ce dossier est vide côté arborescence pour le moment. Crée un sous-dossier pour structurer la suite.
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

interface WorkspaceFolderTileProps {
  workspace: WorkspaceDoc;
  href: string;
  counts: ContentCounts;
  activeDragItem: FolderDragData | null;
  isDropDisabled: boolean;
}

function WorkspaceFolderTile({ workspace, href, counts, activeDragItem, isDropDisabled }: WorkspaceFolderTileProps) {
  const workspaceId = workspace.id ?? "";
  const { setNodeRef, isOver } = useDroppable({
    id: buildFolderDropId(workspaceId),
    data: {
      kind: "folder-target",
      workspaceId,
    } satisfies FolderDropData,
    disabled: !workspaceId || isDropDisabled,
  });

  return (
    <div ref={setNodeRef}>
      <DraggableCard
        dragData={{
          kind: "workspace",
          id: workspaceId,
          parentId: typeof workspace.parentId === "string" && workspace.parentId.trim() ? workspace.parentId : null,
        }}
        disabled={!workspaceId}
        className={isOver ? "rounded-xl ring-2 ring-primary/40 ring-offset-2 ring-offset-background" : ""}
      >
        {({ dragHandle, isDragging }) => (
          <div
            className={`group rounded-2xl border bg-background/90 p-3.5 transition-all ${
              isDropDisabled && activeDragItem
                ? "border-dashed border-border/60 opacity-80"
                : "cursor-pointer border-border/70 shadow-sm hover:-translate-y-0.5 hover:border-primary/35 hover:bg-accent/35 hover:shadow-md"
            } ${isDragging ? "cursor-grabbing" : ""}`}
          >
            <div className="mb-2 flex items-start justify-between gap-3">
              <Link href={href} className="min-w-0 flex flex-1 items-start gap-3 rounded-xl">
                <div className="rounded-xl border border-primary/15 bg-primary/10 p-2.5 text-primary transition-colors group-hover:bg-primary/15">
                  <Folder className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-foreground">{workspace.name}</div>
                      {!activeDragItem ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {formatCount(counts.notes, "note", "notes")} • {formatCount(counts.tasks, "tâche", "tâches")} • {formatCount(counts.todos, "checklist", "checklists")}
                        </div>
                      ) : null}
                    </div>
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:border-primary/25 group-hover:text-primary">
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </span>
                  </div>
                  {isOver && !isDropDisabled ? (
                    <div className="mt-2 inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      Zone de drop active
                    </div>
                  ) : isDropDisabled && activeDragItem ? (
                    <div className="mt-2 text-[11px] text-muted-foreground">Déplacement non autorisé</div>
                  ) : null}
                </div>
              </Link>
              {dragHandle}
            </div>
          </div>
        )}
      </DraggableCard>
    </div>
  );
}
