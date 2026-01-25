"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  Settings,
  Folder,
  Plus,
  PanelLeft,
  Pencil,
  Trash2,
} from "lucide-react";
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
    `w-full inline-flex items-center justify-start gap-2 px-3 py-2 rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background ${
      active
        ? "bg-primary/10 text-foreground border border-primary/20 font-semibold"
        : "text-muted-foreground hover:text-foreground hover:bg-accent/60 border border-transparent"
    }`;

  const iconButtonClass = (active: boolean) =>
    `relative h-10 w-10 inline-flex items-center justify-center rounded-lg text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background ${
      active
        ? "bg-primary/10 text-foreground border border-primary/20"
        : "border border-transparent hover:bg-accent/60 hover:text-foreground"
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

  // Hotfix: DnD disabled.
  const sortedWorkspaces = baseSortedWorkspaces;

  const WorkspaceRow = ({ ws, selected }: { ws: WorkspaceDoc; selected: boolean }) => {
    return (
      <div
        data-ws-row="true"
        data-ws-id={ws.id ?? ""}
        className={`group rounded-lg px-3 py-2 transition-colors ${
          selected
            ? "bg-accent/70 border border-border"
            : "border border-transparent hover:bg-accent/50"
        }`}
      >
        {!renamingId || ws.id !== renamingId ? (
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => navigateWithWorkspace(ws.id ?? null)}
              className={`min-w-0 flex-1 text-left text-sm truncate transition-colors ${
                selected ? "font-semibold text-foreground" : "text-foreground"
              }`}
              aria-label={`Ouvrir le dossier ${ws.name}`}
              disabled={!ws.id}
            >
              <span className="inline-flex items-center gap-2 min-w-0">
                <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="truncate">{ws.name}</span>
              </span>
            </button>
            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={() => startRename(ws)}
                className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                aria-label={`Renommer le dossier ${ws.name}`}
                title="Renommer"
                disabled={!ws.id}
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => handleDelete(ws)}
                className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                aria-label={`Supprimer le dossier ${ws.name}`}
                title="Supprimer"
                disabled={!ws.id || deletingId === ws.id}
              >
                {deletingId === ws.id ? <span className="text-xs">…</span> : <Trash2 className="h-4 w-4" />}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="Nom du dossier"
              className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              autoFocus
            />
            {renameError && <div className="text-xs text-destructive">{renameError}</div>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => handleRename(ws)}
                disabled={savingRename}
                className="px-3 py-1 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 disabled:opacity-50"
              >
                {savingRename ? "..." : "Sauver"}
              </button>
              <button
                type="button"
                onClick={cancelRename}
                disabled={savingRename}
                className="px-3 py-1 rounded-md border border-input text-xs hover:bg-accent disabled:opacity-50"
              >
                Annuler
              </button>
            </div>
          </div>
        )}
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

    const isTodoPage = pathname.startsWith("/todo");
    const sectionFromPath = pathname.startsWith("/tasks") || isTodoPage ? "tasks" : "notes";
    const isContentPage = pathname.startsWith("/notes") || pathname.startsWith("/tasks") || isTodoPage;

    const targetBase = isTodoPage ? "/todo" : isContentPage ? `/${sectionFromPath}` : `/${lastSection}`;
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

  const navigateToNotes = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("workspaceId");
    const qs = params.toString();
    router.push(qs ? `/notes?${qs}` : "/notes");
    onNavigate?.();
  };

  const navigateToTasks = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("workspaceId");
    const qs = params.toString();
    router.push(qs ? `/tasks?${qs}` : "/tasks");
    onNavigate?.();
  };

  const navigateToTodo = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("workspaceId");
    const qs = params.toString();
    router.push(qs ? `/todo?${qs}` : "/todo");
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
              {isNavActive("/dashboard") && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r bg-primary" />
              )}
              <LayoutDashboard className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={navigateToNotes}
              className={iconButtonClass(isNavActive("/notes"))}
              aria-label="Notes"
              title="Notes"
            >
              {isNavActive("/notes") && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r bg-primary" />
              )}
              <span className="text-sm font-semibold">N</span>
            </button>

            <button
              type="button"
              onClick={navigateToTasks}
              className={iconButtonClass(isNavActive("/tasks"))}
              aria-label="Tâches"
              title="Tâches"
            >
              {isNavActive("/tasks") && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r bg-primary" />
              )}
              <span className="text-sm font-semibold">T</span>
            </button>

            <button
              type="button"
              onClick={navigateToTodo}
              className={iconButtonClass(pathname.startsWith("/todo"))}
              aria-label="ToDo"
              title="ToDo"
            >
              {pathname.startsWith("/todo") && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r bg-primary" />
              )}
              <span className="text-sm font-semibold">✓</span>
            </button>
          </div>

          <div className="border-t border-border/40 pt-3">
            <div className="flex flex-col items-center gap-2">
              {sortedWorkspaces.map((ws) => {
                const isSelected = ws.id && ws.id === currentWorkspaceId;
                const initial = (ws.name || "?").trim().slice(0, 1).toUpperCase();
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
                    {isSelected && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r bg-primary" />
                    )}
                    <span className="h-6 w-6 inline-flex items-center justify-center rounded-md bg-muted text-muted-foreground text-[11px] font-semibold">
                      {initial}
                    </span>
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

          <div className="border-t border-border/40 pt-3">
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={navigateToSettings}
                className={iconButtonClass(isNavActive("/settings"))}
                aria-label="Paramètres"
                title="Paramètres"
              >
                {isNavActive("/settings") && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r bg-primary" />
                )}
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
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">
              Navigation
            </div>
            <button
              type="button"
              onClick={navigateToDashboard}
              className={navButtonClass(isNavActive("/dashboard"))}
            >
              <LayoutDashboard className="h-4 w-4" />
              <span>Favoris</span>
            </button>

            <button
              type="button"
              onClick={navigateToNotes}
              className={navButtonClass(isNavActive("/notes"))}
            >
              <span className="h-4 w-4 inline-flex items-center justify-center rounded text-[11px] font-semibold bg-muted text-muted-foreground">
                N
              </span>
              <span>Notes</span>
            </button>

            <button
              type="button"
              onClick={navigateToTasks}
              className={navButtonClass(isNavActive("/tasks"))}
            >
              <span className="h-4 w-4 inline-flex items-center justify-center rounded text-[11px] font-semibold bg-muted text-muted-foreground">
                T
              </span>
              <span>Tâches</span>
            </button>

            <button
              type="button"
              onClick={navigateToTodo}
              className={navButtonClass(pathname.startsWith("/todo"))}
            >
              <span className="h-4 w-4 inline-flex items-center justify-center rounded text-[11px] font-semibold bg-muted text-muted-foreground">
                ✓
              </span>
              <span>ToDo</span>
            </button>
          </div>
          <div className="h-px bg-border/40" />
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">
              Dossiers
            </div>

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

              {sortedWorkspaces.map((ws) => {
                const isSelected = ws.id && ws.id === currentWorkspaceId;
                return <WorkspaceRow key={ws.id ?? ws.name} ws={ws} selected={!!isSelected} />;
              })}
            </div>
          </div>

          <div className="h-px bg-border/40" />
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">
              Nouveau dossier
            </div>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              aria-label="Nom du nouveau dossier"
              placeholder="Ex: Travail"
              className="w-full px-3 py-2 border border-input rounded-lg bg-background text-foreground text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

          <div className="h-px bg-border/40" />
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">
              Paramètres
            </div>
            <button
              type="button"
              onClick={navigateToSettings}
              className={navButtonClass(isNavActive("/settings"))}
            >
              <Settings className="h-4 w-4" />
              <span>Ouvrir les paramètres</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
