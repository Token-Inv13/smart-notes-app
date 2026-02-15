"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { arrayRemove, arrayUnion, doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { TaskDoc } from "@/types/firestore";

function formatFrDateTime(ts?: TaskDoc["dueDate"] | null) {
  if (!ts) return "";
  const d = ts.toDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

function statusLabel(s?: TaskDoc["status"] | null) {
  if (s === "doing") return "En cours";
  if (s === "done") return "Terminée";
  return "À faire";
}

function recurrenceLabel(task: TaskDoc | null) {
  const rec = task?.recurrence;
  if (!rec?.freq) return "Aucune";
  if (rec.freq === "daily") return "Tous les jours";
  if (rec.freq === "weekly") return "Toutes les semaines";
  return "Tous les mois";
}

export default function TaskDetailPage() {
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId");
  const suffix = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";

  const taskId = typeof params?.id === "string" ? params.id : undefined;

  const [task, setTask] = useState<TaskDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [busyException, setBusyException] = useState<string | null>(null);
  const [newExceptionDate, setNewExceptionDate] = useState("");
  const [addingException, setAddingException] = useState(false);

  const loadTask = useCallback(async () => {
    if (!taskId) {
      setError("ID d’élément d’agenda manquant.");
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
    const snap = await getDoc(doc(db, "tasks", taskId));
    if (!snap.exists()) {
      throw new Error("Élément d’agenda introuvable.");
    }

    const data = snap.data() as TaskDoc;
    if (data.userId !== user.uid) {
      throw new Error("Accès refusé.");
    }

    setTask({ id: snap.id, ...data });
  }, [taskId]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        await loadTask();
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
  }, [loadTask]);

  const dueLabel = useMemo(() => formatFrDateTime(task?.dueDate ?? null), [task?.dueDate]);
  const recurrenceUntilLabel = useMemo(() => formatFrDateTime(task?.recurrence?.until ?? null), [task?.recurrence?.until]);
  const recurrenceExceptions = useMemo(() => {
    const list = Array.isArray(task?.recurrence?.exceptions) ? task?.recurrence?.exceptions : [];
    return [...list].sort((a, b) => a.localeCompare(b));
  }, [task?.recurrence?.exceptions]);

  const restoreOccurrence = async (occurrenceDate: string) => {
    if (!task?.id) return;
    const user = auth.currentUser;
    if (!user || task.userId !== user.uid) {
      setError("Accès refusé.");
      return;
    }

    setBusyException(occurrenceDate);
    setActionMsg(null);
    try {
      await updateDoc(doc(db, "tasks", task.id), {
        "recurrence.exceptions": arrayRemove(occurrenceDate),
        updatedAt: serverTimestamp(),
      });
      await loadTask();
      setActionMsg("Occurrence restaurée.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de restaurer cette occurrence.");
    } finally {
      setBusyException(null);
    }
  };

  const addException = async () => {
    if (!task?.id) return;
    if (!task.recurrence?.freq) {
      setError("Ajout impossible: aucune récurrence active sur cet élément.");
      return;
    }
    if (!newExceptionDate) {
      setError("Choisis une date d’occurrence à ignorer.");
      return;
    }

    const user = auth.currentUser;
    if (!user || task.userId !== user.uid) {
      setError("Accès refusé.");
      return;
    }

    setAddingException(true);
    setActionMsg(null);
    try {
      await updateDoc(doc(db, "tasks", task.id), {
        "recurrence.exceptions": arrayUnion(newExceptionDate),
        updatedAt: serverTimestamp(),
      });
      await loadTask();
      setActionMsg("Occurrence ignorée ajoutée.");
      setNewExceptionDate("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible d’ajouter cette occurrence ignorée.");
    } finally {
      setAddingException(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold truncate">Détail de l’élément d’agenda</h1>
        <button
          type="button"
          onClick={() => router.push(`/dashboard${suffix}`)}
          className="border border-border rounded px-3 py-2 bg-background text-sm hover:bg-accent"
        >
          Retour au dashboard
        </button>
      </div>

      {loading && (
        <div className="sn-skeleton-card space-y-3">
          <div className="sn-skeleton-title w-56" />
          <div className="sn-skeleton-line w-72" />
          <div className="sn-skeleton-line w-64" />
          <div className="sn-skeleton-block-md w-full" />
        </div>
      )}
      {error && <div className="sn-alert sn-alert--error">{error}</div>}
      {actionMsg && <div className="sn-alert sn-alert--success">{actionMsg}</div>}

      {!loading && !error && task && (
        <div className="sn-card p-4 space-y-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">Titre</div>
            <div className="text-sm">{task.title}</div>
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Description</div>
            <textarea
              readOnly
              value={task.description ?? ""}
              aria-label="Description de l’élément d’agenda"
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

          <div className="space-y-2 border-t border-border pt-3">
            <div className="text-sm font-medium">Récurrence & exceptions</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <div>
                <span className="font-medium">Règle:</span> {recurrenceLabel(task)}
              </div>
              <div>
                <span className="font-medium">Jusqu’au:</span> {recurrenceUntilLabel || "Sans fin"}
              </div>
            </div>

            {task.recurrence?.freq && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={newExceptionDate}
                  onChange={(e) => setNewExceptionDate(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  aria-label="Ajouter une occurrence ignorée"
                />
                <button
                  type="button"
                  onClick={addException}
                  disabled={addingException || !newExceptionDate}
                  className="h-9 px-3 rounded-md border border-border bg-background text-sm"
                >
                  {addingException ? "Ajout…" : "Ajouter une exception"}
                </button>
              </div>
            )}

            {recurrenceExceptions.length === 0 ? (
              <div className="text-xs text-muted-foreground">Aucune occurrence ignorée.</div>
            ) : (
              <ul className="space-y-2">
                {recurrenceExceptions.map((exceptionDate) => (
                  <li key={exceptionDate} className="flex items-center justify-between gap-2 text-sm">
                    <span className="sn-badge">{exceptionDate}</span>
                    <button
                      type="button"
                      onClick={() => restoreOccurrence(exceptionDate)}
                      disabled={busyException === exceptionDate}
                      className="sn-text-btn"
                    >
                      {busyException === exceptionDate ? "Restauration…" : "Restaurer"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
