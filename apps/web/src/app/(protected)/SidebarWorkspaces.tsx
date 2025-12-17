"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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

export default function SidebarWorkspaces() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { data: workspaces, loading, error } = useUserWorkspaces();

  const currentWorkspaceId = searchParams.get("workspaceId");

  const navButtonClass = (active: boolean) =>
    `w-full inline-flex items-center justify-center px-4 py-2 rounded-md border border-border bg-background text-sm font-medium hover:bg-accent ${
      active ? " bg-accent font-semibold" : ""
    }`;

  const navButtonClassCompact = (active: boolean) =>
    `inline-flex items-center justify-center px-4 py-2 rounded-md border border-border bg-background text-sm font-medium hover:bg-accent ${
      active ? " bg-accent font-semibold" : ""
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

  const sortedWorkspaces = useMemo(() => {
    return workspaces
      .slice()
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [workspaces]);

  const navigateWithWorkspace = (workspaceId: string | null) => {
    const params = new URLSearchParams(searchParams.toString());

    if (!workspaceId) {
      params.delete("workspaceId");
    } else {
      params.set("workspaceId", workspaceId);
    }

    const qs = params.toString();
    const nextPath = pathname.startsWith('/settings') ? '/dashboard' : pathname;
    router.replace(qs ? `${nextPath}?${qs}` : nextPath);
  };

  const navigateToSettings = () => {
    const params = new URLSearchParams(searchParams.toString());
    const qs = params.toString();
    router.push(qs ? `/settings?${qs}` : "/settings");
  };

  const navigateToDashboard = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("workspaceId");
    const qs = params.toString();
    router.push(qs ? `/dashboard?${qs}` : "/dashboard");
  };

  const navigateToNotes = () => {
    const params = new URLSearchParams(searchParams.toString());
    const qs = params.toString();
    router.push(qs ? `/notes?${qs}` : "/notes");
  };

  const navigateToTasks = () => {
    const params = new URLSearchParams(searchParams.toString());
    const qs = params.toString();
    router.push(qs ? `/tasks?${qs}` : "/tasks");
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
      const payload: Omit<WorkspaceDoc, "id"> = {
        ownerId: user.uid,
        name: validation.data.name,
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
    <div className="space-y-4">
      <div>
        <div className="text-sm font-semibold mb-2">Navigation</div>
        <button
          type="button"
          onClick={navigateToDashboard}
          className={navButtonClass(isNavActive("/dashboard"))}
        >
          Ouvrir le dashboard
        </button>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={navigateToNotes}
            className={navButtonClassCompact(isNavActive("/notes"))}
          >
            Notes
          </button>
          <button
            type="button"
            onClick={navigateToTasks}
            className={navButtonClassCompact(isNavActive("/tasks"))}
          >
            Tâches
          </button>
        </div>
      </div>
      <div>
        <div className="text-sm font-semibold mb-2">Dossiers</div>

        <div className="mt-2 space-y-2">
          {loading && <div className="text-sm text-muted-foreground">Chargement…</div>}
          {error && <div className="text-sm text-destructive">{error.message}</div>}

          {!loading && !error && sortedWorkspaces.length === 0 && (
            <div className="text-sm text-muted-foreground">Aucun dossier.</div>
          )}

          {sortedWorkspaces.map((ws) => {
            const isSelected = ws.id && ws.id === currentWorkspaceId;
            const isRenaming = ws.id && ws.id === renamingId;

            return (
              <div key={ws.id ?? ws.name} className="border border-border rounded p-2 bg-card">
                {!isRenaming ? (
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => navigateWithWorkspace(ws.id ?? null)}
                      className={`text-left text-sm truncate ${isSelected ? "font-semibold" : ""}`}
                      aria-label={`Ouvrir le dossier ${ws.name}`}
                    >
                      {ws.name}
                    </button>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => startRename(ws)}
                        className="text-xs underline"
                        disabled={!ws.id}
                      >
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
                      aria-label="Renommer le dossier"
                      placeholder="Nom"
                      className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                    />

                    {renameError && (
                      <div className="text-sm text-destructive" aria-live="polite">
                        {renameError}
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => ws.id && handleRename(ws)}
                        disabled={savingRename}
                        className="px-3 py-1 rounded-md bg-primary text-primary-foreground text-xs disabled:opacity-50"
                      >
                        {savingRename ? "..." : "OK"}
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
              </div>
            );
          })}
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
          <div className="text-sm text-destructive mt-2" aria-live="polite">
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
    </div>
  );
}
