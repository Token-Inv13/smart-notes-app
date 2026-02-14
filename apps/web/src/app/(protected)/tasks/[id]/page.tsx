"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
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
          setTask({ id: snap.id, ...data });
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

  const dueLabel = useMemo(() => formatFrDateTime(task?.dueDate ?? null), [task?.dueDate]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold truncate">Détail de la tâche</h1>
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
        </div>
      )}
    </div>
  );
}
