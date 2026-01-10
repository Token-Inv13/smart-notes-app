"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  Settings,
  Folder,
  Plus,
  PanelLeft,
  GripVertical,
} from "lucide-react";
import { useDndContext } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { z } from "zod";
import {
  addDoc,
  collection,
  serverTimestamp,
  doc,
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useUserWorkspaces } from "@/hooks/useUserWorkspaces";
import type { WorkspaceDoc } from "@/types/firestore";

const createWorkspaceSchema = z.object({
  name: z.string().min(1, "Le nom est requis."),
});

const renameWorkspaceSchema = z.object({
  name: z.string().min(1, "Le nom est requis."),
});

interface SidebarWorkspacesProps {
  collapsed?: boolean;
  onNavigate?: () => void;
  onRequestExpand?: () => void;
  workspaces?: WorkspaceDoc[];
  loading?: boolean;
  error?: Error | null;
}

export default function SidebarWorkspaces({
  collapsed = false,
  onNavigate,
  onRequestExpand,
  workspaces: workspacesProp,
  loading: loadingProp,
  error: errorProp,
}: SidebarWorkspacesProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const hook = useUserWorkspaces();
  const workspaces = workspacesProp ?? hook.data;
  const loading = loadingProp ?? hook.loading;
  const error = errorProp ?? hook.error;

  const currentWorkspaceId = searchParams.get("workspaceId");

  const [lastSection, setLastSection] = useState<"notes" | "tasks">("notes");

  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("lastSection") : null;
    if (saved === "tasks" || saved === "notes") {
      setLastSection(saved);
    }
  }, []);

  useEffect(() => {
    const next = pathname.startsWith("/tasks") ? "tasks" : pathname.startsWith("/notes") ? "notes" : null;
    if (!next) return;
    if (lastSection === next) return;
    setLastSection(next);
    try {
      window.localStorage.setItem("lastSection", next);
    } catch {
      // ignore
    }
  }, [pathname, lastSection]);

  const navButtonClass = (active: boolean) =>
    `w-full inline-flex items-center justify-center px-4 py-2 rounded-md border border-border bg-background text-sm font-medium hover:bg-accent ${
      active ? " bg-accent font-semibold" : ""
    }`;

  const iconButtonClass = (active: boolean) =>
    `h-10 w-10 inline-flex items-center justify-center rounded-md border border-border bg-background hover:bg-accent ${
      active ? " bg-accent border-primary" : ""
    }`;

  const isNavActive = (href: "/dashboard" | "/notes" | "/tasks" | "/settings") => {
    if (href === "/dashboard") {
      return pathname.startsWith("/dashboard") && !currentWorkspaceId;
    }
    return pathname.startsWith(href);
  };

  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const baseSortedWorkspaces = useMemo(() => {
    return workspaces
      .slice()
      .sort((a, b) => {
        const ao = typeof a.order === "number" ? a.order : null;
        const bo = typeof b.order === "number" ? b.order : null;
        if (ao !== null && bo !== null && ao !== bo) return ao - bo;
        if (ao !== null && bo === null) return -1;
        if (ao === null && bo !== null) return 1;
        return (a.name || "").localeCompare(b.name || "");
      });
  }, [workspaces]);

  // Keep a reference to the DnD context so sortable rows can work,
  // but avoid rendering DragOverlay portals which may block clicks in some prod builds.
  useDndContext();
  const sortedWorkspaces = baseSortedWorkspaces;
  const sortableWorkspaces = useMemo(
    () => sortedWorkspaces.filter((w) => typeof w.id === "string" && w.id.length > 0),
    [sortedWorkspaces],
  );
  const sortableIds = useMemo(
    () => sortableWorkspaces.map((w) => w.id as string),
    [sortableWorkspaces],
  );

  const SortableWorkspaceRow = ({ ws, selected }: { ws: WorkspaceDoc; selected: boolean }) => {
    const wsId = ws.id;
    const user = auth.currentUser;
    const canDrag = !!wsId && !!user && user.uid === ws.ownerId;

    const {
      attributes,
      listeners,
      setNodeRef,
      setActivatorNodeRef,
      transform,
      transition,
      isDragging,
      isOver,
      active,
    } = useSortable({ id: wsId ?? "", disabled: !canDrag, data: { type: "workspace" } });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
    } as const;

    const showDropIndicator = !!active && isOver && !isDragging;

    return (
      <div
        ref={setNodeRef}
        data-ws-row="true"
        data-ws-id={ws.id ?? ""}
        style={style}
        className={`border rounded p-2 select-none ${
          isDragging ? "opacity-60 shadow-lg" : ""
        } ${showDropIndicator ? "ring-1 ring-primary" : ""} ${
          selected ? "border-primary bg-accent" : "border-border bg-card"
        }`}
      >
        {!renamingId || ws.id !== renamingId ? (
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              aria-label="Réordonner"
              title={canDrag ? "Réordonner" : "Réordonner (propriétaire uniquement)"}
              ref={setActivatorNodeRef}
              className={`shrink-0 text-muted-foreground hover:text-foreground ${
                canDrag ? "cursor-grab" : "opacity-40 cursor-not-allowed"
              }`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              style={{ touchAction: "none", WebkitTouchCallout: "none" }}
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => navigateWithWorkspace(ws.id ?? null)}
              className={`text-left text-sm truncate ${selected ? "font-semibold" : ""}`}
              aria-label={`Ouvrir le dossier ${ws.name}`}
            >
              {ws.name}
            </button>
            <div className="flex items-center gap-2 shrink-0">
              <button type="button" onClick={() => startRename(ws)} className="text-xs underline" disabled={!ws.id}>
                Renommer
              </button>
              <button
                type="button"
                onClick={() => handleDelete(ws)}
                className="text-xs underline text-destructive"
                disabled={!ws.id || deletingId === ws.id}
              >
                {deletingId === ws.id ? "..." : "Suppr"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="w-full border border-input rounded px-3 py-2 bg-background text-sm"
              autoFocus
            />
            {renameError && <div className="text-xs text-destructive">{renameError}</div>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => handleRename(ws)}
                disabled={savingRename}
                className="px-3 py-1 rounded-md bg-primary text-primary-foreground text-xs disabled:opacity-50"
              >
                {savingRename ? "..." : "Sauver"}
              </button>
              <button
                type="button"
                onClick={cancelRename}
                disabled={savingRename}
                className="px-3 py-1 rounded-md border border-input text-xs disabled:opacity-50"
              >
                Annuler
              </button>
            </div>
          </div>
        )}
        {showDropIndicator && <div className="mt-2 h-0.5 bg-primary rounded" />}
      </div>
    );
  };

  const navigateWithWorkspace = (workspaceId: string | null) => {
    const params = new URLSearchParams(searchParams.toString());

    if (!workspaceId) {
      params.delete("workspaceId");
    } else {
      params.set("workspaceId", workspaceId);
    }

    const qs = params.toString();

    const sectionFromPath = pathname.startsWith("/tasks") ? "tasks" : "notes";
    const isContentPage = pathname.startsWith("/notes") || pathname.startsWith("/tasks");

    const targetBase = isContentPage ? `/${sectionFromPath}` : `/${lastSection}`;
    router.push(qs ? `${targetBase}?${qs}` : targetBase);
    onNavigate?.();
  };

  const navigateToSettings = () => {
    const params = new URLSearchParams(searchParams.toString());
    const qs = params.toString();
    router.push(qs ? `/settings?${qs}` : "/settings");
    onNavigate?.();
  };

  const navigateToDashboard = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("workspaceId");
    const qs = params.toString();
    router.push(qs ? `/dashboard?${qs}` : "/dashboard");
    onNavigate?.();
  };

  const handleCreate = async () => {
    const user = auth.currentUser;
    if (!user) {
      setCreateError("Tu dois être connecté.");
      return;
    }

    setCreateError(null);
    const validation = createWorkspaceSchema.safeParse({ name: newName.trim() });
    if (!validation.success) {
      setCreateError(validation.error.issues[0]?.message ?? "Données invalides.");
      return;
    }

    setCreating(true);
    try {
      const nextOrder = (() => {
        const max = baseSortedWorkspaces.reduce<number | null>((acc, w) => {
          const value = typeof w.order === "number" ? w.order : null;
          if (value === null) return acc;
          if (acc === null) return value;
          return Math.max(acc, value);
        }, null);
        return (max ?? baseSortedWorkspaces.length) + 1;
      })();

      const payload: Omit<WorkspaceDoc, "id"> = {
        ownerId: user.uid,
        name: validation.data.name,
        order: nextOrder,
        members: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const ref = await addDoc(collection(db, "workspaces"), {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setNewName("");
      navigateWithWorkspace(ref.id);
    } catch (e) {
      console.error("Error creating workspace", e);
      setCreateError("Erreur lors de la création du dossier.");
    } finally {
      setCreating(false);
    }
  };

  const startRename = (ws: WorkspaceDoc) => {
    setRenamingId(ws.id ?? null);
    setRenameValue(ws.name ?? "");
    setRenameError(null);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue("");
    setRenameError(null);
  };

  const handleRename = async (ws: WorkspaceDoc) => {
    if (!ws.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== ws.ownerId) {
      setRenameError("Seul le propriétaire peut renommer.");
      return;
    }

    setRenameError(null);
    const validation = renameWorkspaceSchema.safeParse({ name: renameValue.trim() });
    if (!validation.success) {
      setRenameError(validation.error.issues[0]?.message ?? "Données invalides.");
      return;
    }

    setSavingRename(true);
    try {
      await updateDoc(doc(db, "workspaces", ws.id), {
        name: validation.data.name,
        updatedAt: serverTimestamp(),
      });
      cancelRename();
    } catch (e) {
      console.error("Error renaming workspace", e);
      setRenameError("Erreur lors du renommage.");
    } finally {
      setSavingRename(false);
    }
  };

  const handleDelete = async (ws: WorkspaceDoc) => {
    if (!ws.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== ws.ownerId) return;

    if (!confirm("Supprimer ce dossier ? Toutes les notes et tâches qu'il contient seront définitivement supprimées.")) return;

    setDeletingId(ws.id);
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(ws.id)}`, { method: "DELETE" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || "Failed to delete workspace");
      }

      if (currentWorkspaceId === ws.id) {
        navigateWithWorkspace(null);
      }
    } catch (e) {
      console.error("Error deleting workspace", e);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className={collapsed ? "space-y-3" : "space-y-4"}>
      {/* Collapsed: icons only */}
      {collapsed ? (
        <div className="space-y-3">
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={navigateToDashboard}
              className={iconButtonClass(isNavActive("/dashboard"))}
              aria-label="Dashboard"
              title="Dashboard"
            >
              <LayoutDashboard className="h-4 w-4" />
            </button>
          </div>

          <div className="border-t border-border pt-3">
            <div className="flex flex-col items-center gap-2">
              {sortedWorkspaces.map((ws) => {
                const isSelected = ws.id && ws.id === currentWorkspaceId;
                return (
                  <button
                    key={ws.id ?? ws.name}
                    type="button"
                    onClick={() => navigateWithWorkspace(ws.id ?? null)}
                    className={iconButtonClass(!!isSelected)}
                    aria-label={`Dossier ${ws.name}`}
                    title={ws.name}
                    disabled={!ws.id}
                  >
                    <Folder className="h-4 w-4" />
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => onRequestExpand?.()}
                className={iconButtonClass(false)}
                aria-label="Créer un dossier (ouvrir la sidebar)"
                title="Créer un dossier"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="border-t border-border pt-3">
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={navigateToSettings}
                className={iconButtonClass(isNavActive("/settings"))}
                aria-label="Paramètres"
                title="Paramètres"
              >
                <Settings className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => onRequestExpand?.()}
                className={iconButtonClass(false)}
                aria-label="Agrandir"
                title="Agrandir"
              >
                <PanelLeft className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div>
            <div className="text-sm font-semibold mb-2">Navigation</div>
            <button
              type="button"
              onClick={navigateToDashboard}
              className={navButtonClass(isNavActive("/dashboard"))}
            >
              Ouvrir le dashboard
            </button>
          </div>
          <div>
            <div className="text-sm font-semibold mb-2">Dossiers</div>

            <div className="mt-2 space-y-2">
              {loading && (
                <div className="space-y-2">
                  <div className="sn-skeleton-line w-28" />
                  <div className="sn-skeleton-line w-40" />
                  <div className="sn-skeleton-line w-32" />
                </div>
              )}
              {error && <div className="sn-alert sn-alert--error">{error.message}</div>}

              {!loading && !error && sortedWorkspaces.length === 0 && (
                <div className="text-sm text-muted-foreground">Aucun dossier.</div>
              )}

              <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                {sortableWorkspaces.map((ws) => {
                  const isSelected = ws.id && ws.id === currentWorkspaceId;
                  return <SortableWorkspaceRow key={ws.id ?? ws.name} ws={ws} selected={!!isSelected} />;
                })}
              </SortableContext>
              {null}
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <div className="text-sm font-semibold mb-2">Nouveau dossier</div>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              aria-label="Nom du nouveau dossier"
              placeholder="Ex: Travail"
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
            />
            {createError && (
              <div className="mt-2 sn-alert sn-alert--error" role="status" aria-live="polite">
                {createError}
              </div>
            )}
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="w-full mt-2 inline-flex items-center justify-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? "Création…" : "Créer"}
            </button>
          </div>

          <div className="border-t border-border pt-4">
            <div className="text-sm font-semibold mb-2">Paramètres</div>
            <button
              type="button"
              onClick={navigateToSettings}
              className={navButtonClass(isNavActive("/settings"))}
            >
              Ouvrir les paramètres
            </button>
          </div>
        </>
      )}
    </div>
  );
}
