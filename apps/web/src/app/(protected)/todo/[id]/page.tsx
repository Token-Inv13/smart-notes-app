"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { TodoDoc } from "@/types/firestore";

export default function TodoDetailPage(props: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = use(props.params);
  const workspaceId = searchParams.get("workspaceId");
  const suffix = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";

  const todoId: string | undefined = params?.id;

  const [todo, setTodo] = useState<TodoDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!todoId) {
        setError("ID de checklist manquant.");
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
        const snap = await getDoc(doc(db, "todos", todoId));
        if (!snap.exists()) {
          throw new Error("Checklist introuvable.");
        }

        const data = snap.data() as TodoDoc;
        if (data.userId !== user.uid) {
          throw new Error("Accès refusé.");
        }

        if (!cancelled) {
          setTodo({ id: snap.id, ...data });
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
  }, [todoId]);

  const items = useMemo(() => todo?.items ?? [], [todo?.items]);
  const activeItems = useMemo(() => items.filter((it) => it.done !== true), [items]);
  const doneItems = useMemo(() => items.filter((it) => it.done === true), [items]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold truncate">Détail de la checklist</h1>
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

      {!loading && !error && todo && (
        <div className="sn-card p-4 space-y-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">Titre</div>
            <div className="text-sm">{todo.title}</div>
          </div>

          <div className="text-xs text-muted-foreground">
            Actifs: {activeItems.length} · Terminés: {doneItems.length}
          </div>

          {activeItems.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-medium">Actifs</div>
              <ul className="space-y-2">
                {activeItems.map((it) => (
                  <li key={`active-${it.id}`} className="sn-card p-3">
                    <div className="text-sm break-words">{it.text}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-2">
            <div className="text-sm font-medium">Terminées</div>
            {doneItems.length === 0 && <div className="text-sm text-muted-foreground">Aucun élément terminé.</div>}
            {doneItems.length > 0 && (
              <ul className="space-y-2">
                {doneItems.map((it) => (
                  <li key={`done-${it.id}`} className="sn-card sn-card--muted p-3">
                    <div className="text-sm line-through text-muted-foreground break-words">{it.text}</div>
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
