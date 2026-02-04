"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { auth, db } from "@/lib/firebase";
import type { TaskDoc } from "@/types/firestore";
import { useUserWorkspaces } from "@/hooks/useUserWorkspaces";
import { exportTaskPdf } from "@/lib/pdf/exportPdf";
import { invalidateAuthSession, isAuthInvalidError } from "@/lib/authInvalidation";
import { formatTimestampForInput, parseLocalDateTimeToTimestamp } from "@/lib/datetime";
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
  workspaceId: z.string().optional(),
  dueDate: z.string().optional(),
});

export default function TaskDetailModal(props: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const params = use(props.params);
  const taskId: string | undefined = params?.id;

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
  const [snoozing, setSnoozing] = useState(false);
  const [snoozeFeedback, setSnoozeFeedback] = useState<string | null>(null);

  const [, setIsDirty] = useState(false);
  const isDirtyRef = useRef(false);
  const lastSavedSnapshotRef = useRef<string>("");

  const setDirty = (next: boolean) => {
    isDirtyRef.current = next;
    setIsDirty(next);
  };

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
        if (isAuthInvalidError(e)) {
          void invalidateAuthSession();
          return;
        }
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

    try {
      const workspaceName = workspaces.find((ws) => ws.id === task.workspaceId)?.name ?? null;
      await exportTaskPdf(task, workspaceName);
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

    lastSavedSnapshotRef.current = JSON.stringify({
      title: task.title ?? "",
      status: ((task.status as TaskStatus | undefined) ?? "todo") as TaskStatus,
      workspaceId: typeof task.workspaceId === "string" ? task.workspaceId : "",
      dueDate: formatTimestampForInput(task.dueDate ?? null),
    });
    setDirty(false);
  }, [task]);

  const dueLabel = useMemo(() => formatFrDateTime(task?.dueDate ?? null), [task?.dueDate]);

  const handleSnooze = async (preset: '10m' | '1h' | 'tomorrow') => {
    if (!task?.id) return;

    const user = auth.currentUser;
    if (!user || user.uid !== task.userId) {
      setEditError("Impossible de modifier cette tâche.");
      return;
    }

    setSnoozing(true);
    setEditError(null);
    setSnoozeFeedback(null);

    try {
      const remindersRef = collection(db, 'taskReminders');
      const remindersSnap = await getDocs(
        query(
          remindersRef,
          where('userId', '==', user.uid),
          where('taskId', '==', task.id),
        ),
      );

      const reminderDoc = remindersSnap.docs[0] ?? null;
      if (!reminderDoc) {
        setEditError('Aucun rappel existant pour cette tâche.');
        return;
      }

      const reminder = reminderDoc.data() as { reminderTime?: string };
      const baseDate = (() => {
        const fromReminder = typeof reminder.reminderTime === 'string' ? new Date(reminder.reminderTime) : null;
        if (fromReminder && !Number.isNaN(fromReminder.getTime())) return fromReminder;
        if (task.dueDate) return task.dueDate.toDate();
        return new Date();
      })();

      const now = new Date();
      const effectiveBaseDate = baseDate.getTime() < now.getTime() ? now : baseDate;

      const nextDate = new Date(effectiveBaseDate.getTime());
      if (preset === '10m') nextDate.setMinutes(nextDate.getMinutes() + 10);
      if (preset === '1h') nextDate.setHours(nextDate.getHours() + 1);
      if (preset === 'tomorrow') nextDate.setDate(nextDate.getDate() + 1);

      await updateDoc(reminderDoc.ref, {
        reminderTime: nextDate.toISOString(),
        sent: false,
      });

      setSnoozeFeedback('Rappel reprogrammé.');
    } catch (e) {
      console.error('Error snoozing reminder', e);
      setEditError(e instanceof Error ? e.message : 'Erreur lors du snooze du rappel.');
    } finally {
      setSnoozing(false);
    }
  };

  const startEdit = () => {
    if (!task) return;
    setMode("edit");
    setEditError(null);
    setDirty(false);
  };

  const cancelEdit = () => {
    if (!task) return;
    setMode("view");
    setEditTitle(task.title ?? "");
    setEditStatus(((task.status as TaskStatus | undefined) ?? "todo") as TaskStatus);
    setEditWorkspaceId(typeof task.workspaceId === "string" ? task.workspaceId : "");
    setEditDueDate(formatTimestampForInput(task.dueDate ?? null));
    setEditError(null);
    setDirty(false);
  };

  const saveEdits = async (opts?: { setView?: boolean }): Promise<boolean> => {
    if (!task?.id) return false;

    const user = auth.currentUser;
    if (!user || user.uid !== task.userId) {
      setEditError("Impossible de modifier cette tâche.");
      console.warn("[task modal] saveEdits blocked: unauth or not owner", {
        hasUser: Boolean(user),
        userId: user?.uid,
        taskUserId: task.userId,
        taskId: task.id,
      });
      return false;
    }

    const validation = editTaskSchema.safeParse({
      title: editTitle,
      status: editStatus,
      workspaceId: editWorkspaceId || undefined,
      dueDate: editDueDate || undefined,
    });

    if (!validation.success) {
      setEditError(validation.error.issues[0]?.message ?? "Données invalides.");
      console.warn("[task modal] saveEdits blocked: validation failed", {
        issues: validation.error.issues,
        taskId: task.id,
      });
      return false;
    }

    const nextSnapshot = JSON.stringify({
      title: validation.data.title,
      status: validation.data.status,
      workspaceId: validation.data.workspaceId ?? "",
      dueDate: editDueDate,
    });

    if (lastSavedSnapshotRef.current === nextSnapshot) {
      console.info("[task modal] saveEdits noop: snapshot unchanged", { taskId: task.id });
      if (opts?.setView) setMode("view");
      setDirty(false);
      return true;
    }

    const dueTimestamp = validation.data.dueDate
      ? parseLocalDateTimeToTimestamp(validation.data.dueDate)
      : null;

    setSaving(true);
    setEditError(null);
    console.info("[task modal] saveEdits start", {
      taskId: task.id,
      workspaceId: validation.data.workspaceId,
      status: validation.data.status,
    });

    try {
      await updateDoc(doc(db, "tasks", task.id), {
        title: validation.data.title,
        status: validation.data.status,
        workspaceId: validation.data.workspaceId ?? null,
        dueDate: dueTimestamp,
        updatedAt: serverTimestamp(),
      });

      console.info("[task modal] saveEdits success", { taskId: task.id });

      const remindersRef = collection(db, "taskReminders");
      const remindersSnap = await getDocs(
        query(
          remindersRef,
          where("userId", "==", user.uid),
          where("taskId", "==", task.id),
        ),
      );

      const existingDocs = remindersSnap.docs;

      if (!validation.data.dueDate) {
        await Promise.all(existingDocs.map((d) => deleteDoc(d.ref)));
      } else {
        const reminderDate = new Date(validation.data.dueDate);
        if (!Number.isNaN(reminderDate.getTime())) {
          const primary = existingDocs[0] ?? null;
          if (primary) {
            await updateDoc(primary.ref, {
              dueDate: dueTimestamp ? dueTimestamp.toDate().toISOString() : "",
              reminderTime: reminderDate.toISOString(),
              sent: false,
            });
            if (existingDocs.length > 1) {
              await Promise.all(existingDocs.slice(1).map((d) => deleteDoc(d.ref)));
            }
          } else {
            await addDoc(remindersRef, {
              userId: user.uid,
              taskId: task.id,
              dueDate: dueTimestamp ? dueTimestamp.toDate().toISOString() : "",
              reminderTime: reminderDate.toISOString(),
              sent: false,
              createdAt: serverTimestamp(),
            });
          }
        }
      }

      setTask((prev) =>
        prev
          ? {
              ...prev,
              title: validation.data.title,
              status: validation.data.status,
              workspaceId: validation.data.workspaceId ?? null,
              dueDate: dueTimestamp,
            }
          : prev,
      );

      lastSavedSnapshotRef.current = nextSnapshot;
      setDirty(false);
      if (opts?.setView) setMode("view");
      return true;
    } catch (e) {
      console.error("Error updating task (modal)", e);
      setEditError(e instanceof Error ? e.message : "Erreur lors de la modification de la tâche.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    const ok = await saveEdits({ setView: true });
    if (!ok) {
      console.warn("[task modal] handleSave: save failed (staying in edit mode)", { taskId: task?.id });
    }
  };

  useEffect(() => {
    if (mode !== "edit") return;

    const flush = () => {
      if (!isDirtyRef.current) return;
      void saveEdits({ setView: false });
    };

    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);

    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

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
      const nextArchived = !(task.archived === true);
      await updateDoc(doc(db, "tasks", task.id), {
        archived: nextArchived,
        archivedAt: nextArchived ? serverTimestamp() : null,
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
    <Modal
      hideHeader
      onBeforeClose={async () => {
        if (mode !== "edit") return true;

        if (!isDirtyRef.current) return true;
        return await saveEdits({ setView: false });
      }}
    >
      {({ close }: { close: () => void }) => {
        if (loading) {
          return (
            <div className="sn-skeleton-card space-y-3">
              <div className="sn-skeleton-title w-56" />
              <div className="sn-skeleton-line w-72" />
              <div className="sn-skeleton-line w-64" />
              <div className="sn-skeleton-block-md w-full" />
            </div>
          );
        }

        if (error) {
          return <div className="sn-alert sn-alert--error">{error}</div>;
        }

        if (!task) return null;

        return (
        <div className="space-y-4">
          {shareFeedback && <div className="sn-alert">{shareFeedback}</div>}
          {exportFeedback && <div className="sn-alert">{exportFeedback}</div>}
          {snoozeFeedback && <div className="sn-alert">{snoozeFeedback}</div>}
          {editError && <div className="sn-alert sn-alert--error">{editError}</div>}
          <div className="sn-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                {mode === "view" ? (
                  <div className="text-sm font-semibold truncate">{task.title}</div>
                ) : (
                  <div className="text-sm font-semibold">Modifier la tâche</div>
                )}
              </div>

              <div className="shrink-0 flex items-center gap-2">
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

                <button
                  type="button"
                  onClick={close}
                  className="sn-icon-btn"
                  aria-label="Fermer"
                  title="Fermer"
                >
                  ×
                </button>
              </div>
            </div>

            {mode === "view" ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="font-medium">Statut:</span> {statusLabel(task.status ?? null)}
                  </div>
                  <div>
                    <span className="font-medium">Rappel:</span> {dueLabel || "Aucun rappel"}
                    {dueLabel && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-sm">Rappeler plus tard</summary>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleSnooze('10m')}
                            disabled={snoozing}
                            className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
                          >
                            +10 minutes
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSnooze('1h')}
                            disabled={snoozing}
                            className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
                          >
                            +1 heure
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSnooze('tomorrow')}
                            disabled={snoozing}
                            className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
                          >
                            Demain
                          </button>
                        </div>
                      </details>
                    )}
                  </div>
                </div>
                <div className="text-sm">
                  <span className="font-medium">Dossier:</span>{" "}
                  {workspaces.find((ws) => ws.id === task.workspaceId)?.name ?? "—"}
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 items-end">
                  <div className="space-y-1 lg:col-span-2">
                    <label className="text-sm font-medium" htmlFor="task-modal-title">
                      Titre
                    </label>
                    <input
                      id="task-modal-title"
                      type="text"
                      value={editTitle}
                      onChange={(e) => {
                        const nextTitle = e.target.value;
                        setEditTitle(nextTitle);
                        const snap = JSON.stringify({
                          title: nextTitle,
                          status: editStatus,
                          workspaceId: editWorkspaceId,
                          dueDate: editDueDate,
                        });
                        setDirty(snap !== lastSavedSnapshotRef.current);
                      }}
                      className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                      placeholder="Ex : Payer le loyer"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-medium" htmlFor="task-modal-status">
                      Statut
                    </label>
                    <select
                      id="task-modal-status"
                      value={editStatus}
                      onChange={(e) => {
                        const nextStatus = e.target.value as TaskStatus;
                        setEditStatus(nextStatus);
                        const snap = JSON.stringify({
                          title: editTitle,
                          status: nextStatus,
                          workspaceId: editWorkspaceId,
                          dueDate: editDueDate,
                        });
                        setDirty(snap !== lastSavedSnapshotRef.current);
                      }}
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
                      onChange={(e) => {
                        const nextDueDate = e.target.value;
                        setEditDueDate(nextDueDate);
                        const snap = JSON.stringify({
                          title: editTitle,
                          status: editStatus,
                          workspaceId: editWorkspaceId,
                          dueDate: nextDueDate,
                        });
                        setDirty(snap !== lastSavedSnapshotRef.current);
                      }}
                      className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 items-end">
                  <div className="space-y-1">
                    <label className="text-sm font-medium" htmlFor="task-modal-workspace">
                      Dossier
                    </label>
                    <select
                      id="task-modal-workspace"
                      value={editWorkspaceId}
                      onChange={(e) => {
                        const nextWorkspaceId = e.target.value;
                        setEditWorkspaceId(nextWorkspaceId);
                        const snap = JSON.stringify({
                          title: editTitle,
                          status: editStatus,
                          workspaceId: nextWorkspaceId,
                          dueDate: editDueDate,
                        });
                        setDirty(snap !== lastSavedSnapshotRef.current);
                      }}
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

                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="h-10 inline-flex items-center justify-center px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    {saving ? "Enregistrement…" : "Enregistrer"}
                  </button>
                </div>

                {editError && <div className="sn-alert sn-alert--error">{editError}</div>}
              </>
            )}
          </div>
        </div>
        );
      }}
    </Modal>
  );
}
