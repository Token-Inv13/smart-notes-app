"use client";

import { useEffect, useMemo, useState } from "react";
import { deleteDoc, doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { auth, db } from "@/lib/firebase";
import { useUserWorkspaces } from "@/hooks/useUserWorkspaces";
import { formatTimestampForInput, parseLocalDateTimeToTimestamp } from "@/lib/datetime";
import type { TaskDoc } from "@/types/firestore";
import Modal from "../../../Modal";
import ItemActionsMenu from "../../../ItemActionsMenu";

function formatFrDateTime(ts?: TaskDoc["dueDate"] | null) {
  if (!ts) return "";
  const d = ts.toDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function statusLabel(s?: TaskDoc["status"] | null) {
  if (s === "doing") return "En cours";
  if (s === "done") return "Terminée";
  return "À faire";
}

type TaskStatus = "todo" | "doing" | "done";

const editTaskSchema = z.object({
  title: z.string().min(1, "Le titre est requis."),
  status: z.union([z.literal("todo"), z.literal("doing"), z.literal("done")]),
  workspaceId: z.string().min(1, "Sélectionne un dossier (workspace)."),
  dueDate: z.string().optional(),
});

export default function TaskDetailModal(props: any) {
  const router = useRouter();
  const taskId: string | undefined = props?.params?.id;

  const { data: workspaces } = useUserWorkspaces();

  const [task, setTask] = useState<TaskDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<"view" | "edit">("view");
  const [editTitle, setEditTitle] = useState("");
  const [editStatus, setEditStatus] = useState<TaskStatus>("todo");
  const [editWorkspaceId, setEditWorkspaceId] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [, setDeleting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!taskId) {
        setError("ID de tâche manquant.");
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
        const snap = await getDoc(doc(db, "tasks", taskId));
        if (!snap.exists()) {
          throw new Error("Tâche introuvable.");
        }

        const data = snap.data() as TaskDoc;
        if (data.userId !== user.uid) {
          throw new Error("Accès refusé.");
        }

        if (!cancelled) {
          setTask({ id: snap.id, ...(data as any) });
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
  }, [taskId]);

  const handleExportPdf = async () => {
    if (!task?.id) return;

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

    try {
      const [{ jsPDF }] = await Promise.all([import("jspdf")]);

      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      const marginX = 48;
      const marginTop = 48;
      const marginBottom = 56;
      const headerH = 64;
      const contentTop = marginTop + headerH;

      const exportDate = new Date();
      const exportDateLabel = exportDate.toLocaleString("fr-FR", {
        year: "numeric",
        month: "long",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });

      const workspaceName = workspaces.find((ws) => ws.id === task.workspaceId)?.name ?? null;
      const status = (task.status as TaskStatus | undefined) ?? "todo";

      const svgToPngDataUrl = async (svgText: string) => {
        const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
        const img = new Image();
        img.decoding = "async";
        img.src = svgDataUrl;

        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("Impossible de charger le logo."));
        });

        const canvas = document.createElement("canvas");
        canvas.width = img.width || 160;
        canvas.height = img.height || 40;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas non supporté.");
        ctx.drawImage(img, 0, 0);
        return canvas.toDataURL("image/png");
      };

      const drawHeader = async (pageTitle: string) => {
        const y = marginTop;

        try {
          const res = await fetch("/logo.svg");
          const svg = await res.text();
          const png = await svgToPngDataUrl(svg);
          doc.addImage(png, "PNG", marginX, y, 120, 30);
        } catch {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(14);
          doc.text("Smart Notes", marginX, y + 20);
        }

        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(1);
        doc.line(marginX, y + 40, pageWidth - marginX, y + 40);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(18);
        doc.setTextColor(15, 23, 42);
        doc.text(pageTitle, marginX, y + 62);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(100, 116, 139);
        doc.text(`Export du ${exportDateLabel}`, pageWidth - marginX, y + 62, { align: "right" });
      };

      const addSectionTitle = (title: string, y: number) => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.setTextColor(15, 23, 42);
        doc.text(title, marginX, y);
        doc.setDrawColor(226, 232, 240);
        doc.line(marginX, y + 6, pageWidth - marginX, y + 6);
        return y + 22;
      };

      const ensureSpace = async (y: number, needed: number) => {
        if (y + needed <= pageHeight - marginBottom) return y;
        doc.addPage();
        await drawHeader(task.title ?? "Tâche");
        return contentTop;
      };

      const addWrapped = async (text: string, y: number, fontSize: number) => {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(fontSize);
        doc.setTextColor(51, 65, 85);
        const maxWidth = pageWidth - marginX * 2;
        const lineHeight = fontSize + 4;

        const paragraphs = String(text ?? "").split("\n");
        for (const p of paragraphs) {
          const lines = doc.splitTextToSize(p.length ? p : " ", maxWidth) as string[];
          for (const line of lines) {
            y = await ensureSpace(y, lineHeight);
            doc.text(line, marginX, y);
            y += lineHeight;
          }
          y += 6;
        }
        return y;
      };

      await drawHeader(task.title ?? "Tâche");

      let y = contentTop;
      y = await ensureSpace(y, 40);

      y = addSectionTitle("Détails", y);
      y = await addWrapped(`Statut: ${statusLabel(status)}`, y, 11);
      if (task.dueDate) y = await addWrapped(`Échéance: ${formatFrDateTime(task.dueDate)}`, y, 11);
      if (workspaceName) y = await addWrapped(`Workspace: ${workspaceName}`, y, 11);

      y += 8;
      y = await ensureSpace(y, 30);
      y = addSectionTitle("Description", y);
      y = await addWrapped(task.description ?? "", y, 11);

      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i += 1) {
        doc.setPage(i);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(100, 116, 139);
        doc.text("Exporté depuis Smart Notes — app.tachesnotes.com", marginX, pageHeight - 28);
        doc.text(String(i), pageWidth - marginX, pageHeight - 28, { align: "right" });
      }

      const filename = `smartnotes-task-${sanitize(task.title ?? "")}.pdf`;
      doc.save(filename);

      setExportFeedback("PDF téléchargé.");
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Erreur lors de l’export PDF.");
    }
  };

  const handleExport = async () => {
    if (!task?.id) return;

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

    const workspaceName = workspaces.find((ws) => ws.id === task.workspaceId)?.name ?? null;
    const status = (task.status as TaskStatus | undefined) ?? "todo";

    const lines: string[] = [];
    lines.push(`# ${task.title ?? ""}`);
    lines.push(`Statut: ${statusLabel(status)}`);
    if (task.dueDate) lines.push(`Échéance: ${formatFrDateTime(task.dueDate)}`);
    if (workspaceName) lines.push(`Workspace: ${workspaceName}`);
    lines.push("");
    if (task.description) {
      lines.push(task.description);
      lines.push("");
    }

    const md = `${lines.join("\n")}\n`;
    const filename = `smartnotes-task-${sanitize(task.title ?? "")}.md`;

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
    if (!task?.id) return;

    setEditError(null);
    setShareFeedback(null);

    const origin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "https://app.tachesnotes.com";
    const url = `${origin}/tasks/${encodeURIComponent(task.id)}`;

    try {
      if (typeof navigator !== "undefined" && typeof (navigator as any).share === "function") {
        await (navigator as any).share({ title: task.title ?? "Tâche", url });
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
    if (!task) return;
    setEditTitle(task.title ?? "");
    setEditStatus(((task.status as TaskStatus | undefined) ?? "todo") as TaskStatus);
    setEditWorkspaceId(typeof task.workspaceId === "string" ? task.workspaceId : "");
    setEditDueDate(formatTimestampForInput(task.dueDate ?? null));
    setEditError(null);
    setShareFeedback(null);
    setExportFeedback(null);
  }, [task]);

  const dueLabel = useMemo(() => formatFrDateTime(task?.dueDate ?? null), [task?.dueDate]);

  const startEdit = () => {
    if (!task) return;
    setMode("edit");
    setEditError(null);
  };

  const cancelEdit = () => {
    if (!task) return;
    setMode("view");
    setEditTitle(task.title ?? "");
    setEditStatus(((task.status as TaskStatus | undefined) ?? "todo") as TaskStatus);
    setEditWorkspaceId(typeof task.workspaceId === "string" ? task.workspaceId : "");
    setEditDueDate(formatTimestampForInput(task.dueDate ?? null));
    setEditError(null);
  };

  const handleSave = async () => {
    if (!task?.id) return;

    const user = auth.currentUser;
    if (!user || user.uid !== task.userId) {
      setEditError("Impossible de modifier cette tâche.");
      return;
    }

    const validation = editTaskSchema.safeParse({
      title: editTitle,
      status: editStatus,
      workspaceId: editWorkspaceId,
      dueDate: editDueDate || undefined,
    });

    if (!validation.success) {
      setEditError(validation.error.issues[0]?.message ?? "Données invalides.");
      return;
    }

    const dueTimestamp = validation.data.dueDate
      ? parseLocalDateTimeToTimestamp(validation.data.dueDate)
      : null;

    setSaving(true);
    setEditError(null);

    try {
      await updateDoc(doc(db, "tasks", task.id), {
        title: validation.data.title,
        status: validation.data.status,
        workspaceId: validation.data.workspaceId,
        dueDate: dueTimestamp,
        updatedAt: serverTimestamp(),
      });

      setTask((prev) =>
        prev
          ? {
              ...prev,
              title: validation.data.title,
              status: validation.data.status,
              workspaceId: validation.data.workspaceId,
              dueDate: dueTimestamp,
            }
          : prev,
      );

      setMode("view");
    } catch (e) {
      console.error("Error updating task (modal)", e);
      setEditError(e instanceof Error ? e.message : "Erreur lors de la modification de la tâche.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleArchive = async () => {
    if (!task?.id) return;

    const user = auth.currentUser;
    if (!user || user.uid !== task.userId) {
      setEditError("Impossible d’archiver cette tâche.");
      return;
    }

    setSaving(true);
    setEditError(null);
    try {
      await updateDoc(doc(db, "tasks", task.id), {
        archived: !(task.archived === true),
        updatedAt: serverTimestamp(),
      });
      router.back();
    } catch (e) {
      console.error("Error archiving task (modal)", e);
      setEditError(e instanceof Error ? e.message : "Erreur lors de l’archivage de la tâche.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!task?.id) return;

    const user = auth.currentUser;
    if (!user || user.uid !== task.userId) {
      setEditError("Impossible de supprimer cette tâche.");
      return;
    }

    if (!confirm("Supprimer cette tâche ?")) return;

    setDeleting(true);
    setEditError(null);

    try {
      await deleteDoc(doc(db, "tasks", task.id));
      router.back();
    } catch (e) {
      console.error("Error deleting task (modal)", e);
      setEditError(e instanceof Error ? e.message : "Erreur lors de la suppression de la tâche.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal title="Détail de la tâche">
      {loading && (
        <div className="sn-skeleton-card space-y-3">
          <div className="sn-skeleton-title w-56" />
          <div className="sn-skeleton-line w-72" />
          <div className="sn-skeleton-line w-64" />
          <div className="sn-skeleton-block-md w-full" />
        </div>
      )}
      {error && <div className="sn-alert sn-alert--error">{error}</div>}

      {!loading && !error && task && (
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
                archived={task.archived === true}
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
                  <div className="text-sm">{task.title}</div>
                </div>

                <div className="space-y-1">
                  <div className="text-sm font-medium">Description</div>
                  <textarea
                    readOnly
                    value={task.description ?? ""}
                    aria-label="Description de la tâche"
                    className="w-full min-h-[160px] px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="font-medium">Statut:</span> {statusLabel(task.status ?? null)}
                  </div>
                  <div>
                    <span className="font-medium">Rappel:</span> {dueLabel || "Aucun rappel"}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor="task-modal-title">
                    Titre
                  </label>
                  <input
                    id="task-modal-title"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-sm font-medium" htmlFor="task-modal-status">
                      Statut
                    </label>
                    <select
                      id="task-modal-status"
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value as TaskStatus)}
                      className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                    >
                      <option value="todo">À faire</option>
                      <option value="doing">En cours</option>
                      <option value="done">Terminée</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-medium" htmlFor="task-modal-due">
                      Rappel
                    </label>
                    <input
                      id="task-modal-due"
                      type="datetime-local"
                      value={editDueDate}
                      onChange={(e) => setEditDueDate(e.target.value)}
                      className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor="task-modal-workspace">
                    Dossier
                  </label>
                  <select
                    id="task-modal-workspace"
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

                {editError && <div className="sn-alert sn-alert--error">{editError}</div>}
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
