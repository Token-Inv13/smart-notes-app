"use client";

import { useEffect, useMemo, useState } from "react";
import { deleteDoc, doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { auth, db } from "@/lib/firebase";
import { exportNotePdf } from "@/lib/pdf/exportPdf";
import { useUserWorkspaces } from "@/hooks/useUserWorkspaces";
import type { NoteDoc } from "@/types/firestore";
import Modal from "../../../Modal";
import ItemActionsMenu from "../../../ItemActionsMenu";

function formatFrDateTime(ts?: NoteDoc["updatedAt"] | NoteDoc["createdAt"] | null) {
  if (!ts) return "—";
  const d = ts.toDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const editNoteSchema = z.object({
  title: z.string().min(1, "Le titre est requis."),
  content: z.string().optional(),
  workspaceId: z.string().min(1, "Sélectionne un dossier (workspace)."),
});

export default function NoteDetailModal(props: any) {
  const router = useRouter();
  const noteId: string | undefined = props?.params?.id;

  const { data: workspaces } = useUserWorkspaces();

  const [note, setNote] = useState<NoteDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<"view" | "edit">("view");
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editWorkspaceId, setEditWorkspaceId] = useState("");
  const [saving, setSaving] = useState(false);
  const [, setDeleting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!noteId) {
        setError("ID de note manquant.");
        setLoading(false);
        return;
      }

      const user = auth.currentUser;
      if (!user) {
        setError("Tu dois être connecté.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const snap = await getDoc(doc(db, "notes", noteId));
        if (!snap.exists()) {
          throw new Error("Note introuvable.");
        }

        const data = snap.data() as NoteDoc;
        if (data.userId !== user.uid) {
          throw new Error("Accès refusé.");
        }

        if (!cancelled) {
          setNote({ id: snap.id, ...(data as any) });
          setMode("view");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erreur lors du chargement.";
        if (!cancelled) setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  const handleExportPdf = async () => {
    if (!note?.id) return;

    setEditError(null);
    setExportFeedback(null);

    try {
      const workspaceName = workspaces.find((ws) => ws.id === note.workspaceId)?.name ?? null;
      await exportNotePdf(note, workspaceName);
      setExportFeedback("PDF téléchargé.");
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Erreur lors de l’export PDF.");
    }
  };

  const handleExport = async () => {
    if (!note?.id) return;

    setEditError(null);
    setExportFeedback(null);

    const sanitize = (raw: string) => {
      const base = raw
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();
      return base || "sans-titre";
    };

    const workspaceName = workspaces.find((ws) => ws.id === note.workspaceId)?.name ?? null;

    const lines: string[] = [];
    lines.push(`# ${note.title ?? ""}`);
    if (workspaceName) lines.push(`Workspace: ${workspaceName}`);
    if (note.updatedAt) lines.push(`Dernière mise à jour: ${formatFrDateTime(note.updatedAt)}`);
    lines.push("");
    lines.push(note.content ?? "");

    const md = `${lines.join("\n")}\n`;
    const filename = `smartnotes-note-${sanitize(note.title ?? "")}.md`;

    try {
      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setExportFeedback("Export téléchargé.");
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Erreur lors de l’export.");
    }
  };

  const handleShare = async () => {
    if (!note?.id) return;

    setEditError(null);
    setShareFeedback(null);

    const origin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "https://app.tachesnotes.com";
    const url = `${origin}/notes/${encodeURIComponent(note.id)}`;

    try {
      if (typeof navigator !== "undefined" && typeof (navigator as any).share === "function") {
        await (navigator as any).share({ title: note.title ?? "Note", url });
        setShareFeedback("Partage ouvert.");
        return;
      }

      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setShareFeedback("Lien copié.");
        return;
      }

      throw new Error("Partage non supporté sur cet appareil.");
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Erreur lors du partage.");
    }
  };

  useEffect(() => {
    if (!note) return;
    setEditTitle(note.title ?? "");
    setEditContent(note.content ?? "");
    setEditWorkspaceId(typeof note.workspaceId === "string" ? note.workspaceId : "");
    setEditError(null);
    setShareFeedback(null);
    setExportFeedback(null);
  }, [note]);

  const createdLabel = useMemo(() => formatFrDateTime(note?.createdAt ?? null), [note?.createdAt]);
  const updatedLabel = useMemo(() => formatFrDateTime(note?.updatedAt ?? null), [note?.updatedAt]);

  const startEdit = () => {
    if (!note) return;
    setMode("edit");
    setEditError(null);
  };

  const cancelEdit = () => {
    if (!note) return;
    setMode("view");
    setEditTitle(note.title ?? "");
    setEditContent(note.content ?? "");
    setEditWorkspaceId(typeof note.workspaceId === "string" ? note.workspaceId : "");
    setEditError(null);
  };

  const handleSave = async () => {
    if (!note?.id) return;

    const user = auth.currentUser;
    if (!user || user.uid !== note.userId) {
      setEditError("Impossible de modifier cette note.");
      return;
    }

    const validation = editNoteSchema.safeParse({
      title: editTitle,
      content: editContent,
      workspaceId: editWorkspaceId,
    });

    if (!validation.success) {
      setEditError(validation.error.issues[0]?.message ?? "Données invalides.");
      return;
    }

    setSaving(true);
    setEditError(null);

    try {
      await updateDoc(doc(db, "notes", note.id), {
        title: validation.data.title,
        content: validation.data.content ?? "",
        workspaceId: validation.data.workspaceId,
        updatedAt: serverTimestamp(),
      });

      setNote((prev) =>
        prev
          ? {
              ...prev,
              title: validation.data.title,
              content: validation.data.content ?? "",
              workspaceId: validation.data.workspaceId,
            }
          : prev,
      );
      setMode("view");
    } catch (e) {
      console.error("Error updating note (modal)", e);
      setEditError(e instanceof Error ? e.message : "Erreur lors de la modification de la note.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleArchive = async () => {
    if (!note?.id) return;

    const user = auth.currentUser;
    if (!user || user.uid !== note.userId) {
      setEditError("Impossible d’archiver cette note.");
      return;
    }

    setSaving(true);
    setEditError(null);
    try {
      await updateDoc(doc(db, "notes", note.id), {
        archived: !(note.archived === true),
        updatedAt: serverTimestamp(),
      });
      router.back();
    } catch (e) {
      console.error("Error archiving note (modal)", e);
      setEditError(e instanceof Error ? e.message : "Erreur lors de l’archivage de la note.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!note?.id) return;

    const user = auth.currentUser;
    if (!user || user.uid !== note.userId) {
      setEditError("Impossible de supprimer cette note.");
      return;
    }

    if (!confirm("Supprimer cette note ?")) return;

    setDeleting(true);
    setEditError(null);

    try {
      await deleteDoc(doc(db, "notes", note.id));
      router.back();
    } catch (e) {
      console.error("Error deleting note (modal)", e);
      setEditError(e instanceof Error ? e.message : "Erreur lors de la suppression de la note.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal title="Détail de la note">
      {loading && (
        <div className="sn-skeleton-card space-y-3">
          <div className="sn-skeleton-title w-56" />
          <div className="sn-skeleton-line w-72" />
          <div className="sn-skeleton-line w-64" />
          <div className="sn-skeleton-block-lg w-full" />
        </div>
      )}
      {error && <div className="sn-alert sn-alert--error">{error}</div>}

      {!loading && !error && note && (
        <div className="space-y-4">
          {shareFeedback && <div className="sn-alert">{shareFeedback}</div>}
          {exportFeedback && <div className="sn-alert">{exportFeedback}</div>}
          <div className="flex items-center justify-end gap-2">
            {mode === "view" ? (
              <ItemActionsMenu
                onEdit={startEdit}
                onToggleArchive={handleToggleArchive}
                onShare={handleShare}
                onExportPdf={handleExportPdf}
                onExportMarkdown={handleExport}
                archived={note.archived === true}
                onDelete={handleDelete}
              />
            ) : (
              <>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={saving}
                  className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                >
                  {saving ? "Enregistrement…" : "Enregistrer"}
                </button>
              </>
            )}
          </div>

          <div className="sn-card p-4 space-y-3">
            {mode === "view" ? (
              <>
                <div className="space-y-1">
                  <div className="text-sm font-medium">Titre</div>
                  <div className="text-sm">{note.title}</div>
                </div>

                <div className="space-y-1">
                  <div className="text-sm font-medium">Contenu</div>
                  <textarea
                    readOnly
                    value={note.content ?? ""}
                    aria-label="Contenu de la note"
                    className="w-full min-h-[240px] px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor="note-modal-title">
                    Titre
                  </label>
                  <input
                    id="note-modal-title"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor="note-modal-workspace">
                    Dossier
                  </label>
                  <select
                    id="note-modal-workspace"
                    value={editWorkspaceId}
                    onChange={(e) => setEditWorkspaceId(e.target.value)}
                    className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                  >
                    <option value="">—</option>
                    {workspaces.map((ws) => (
                      <option key={ws.id ?? ws.name} value={ws.id ?? ""}>
                        {ws.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor="note-modal-content">
                    Contenu
                  </label>
                  <textarea
                    id="note-modal-content"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full min-h-[240px] px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                  />
                </div>

                {editError && <div className="sn-alert sn-alert--error">{editError}</div>}
              </>
            )}

            {mode === "view" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="font-medium">Créée le:</span> {createdLabel}
                </div>
                <div>
                  <span className="font-medium">Dernière mise à jour:</span> {updatedLabel}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
