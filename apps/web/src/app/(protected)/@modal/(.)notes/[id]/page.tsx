"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { NoteDoc } from "@/types/firestore";
import Modal from "../../../Modal";

function formatFrDateTime(ts?: NoteDoc["updatedAt"] | NoteDoc["createdAt"] | null) {
  if (!ts) return "—";
  const d = ts.toDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function NoteDetailModal(props: any) {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId");
  const suffix = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";

  const noteId: string | undefined = props?.params?.id;

  const [note, setNote] = useState<NoteDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const createdLabel = useMemo(() => formatFrDateTime(note?.createdAt ?? null), [note?.createdAt]);
  const updatedLabel = useMemo(() => formatFrDateTime(note?.updatedAt ?? null), [note?.updatedAt]);

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
          <div className="flex items-center justify-end gap-2">
            <Link
              href={`/notes${suffix}`}
              className="px-3 py-2 rounded-md border border-input text-sm"
            >
              Modifier
            </Link>
          </div>

          <div className="sn-card p-4 space-y-3">
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <div>
                <span className="font-medium">Créée le:</span> {createdLabel}
              </div>
              <div>
                <span className="font-medium">Dernière mise à jour:</span> {updatedLabel}
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
