"use client";

import { useMemo, useState } from "react";
import { useUserAssistantDecisions } from "@/hooks/useUserAssistantDecisions";
import type { AssistantDecisionDoc } from "@/types/firestore";

type Filter = "all" | "accepted" | "rejected" | "edited";

function toMillisSafe(ts: unknown): number {
  const maybe = ts as { toMillis?: () => number };
  if (maybe && typeof maybe.toMillis === "function") return maybe.toMillis();
  return 0;
}

function formatTs(ts: unknown): string {
  const maybe = ts as { toDate?: () => Date };
  if (!maybe || typeof maybe.toDate !== "function") return "";
  try {
    return maybe.toDate().toLocaleString();
  } catch {
    return "";
  }
}

function decisionLabel(action: AssistantDecisionDoc["action"]): string {
  if (action === "edited_then_accepted") return "Modifiée puis acceptée";
  if (action === "accepted") return "Acceptée";
  return "Refusée";
}

function parseNoteIdFromObjectId(objectId: string | undefined): string | null {
  if (!objectId) return null;
  if (!objectId.startsWith("note_")) return null;
  const id = objectId.slice("note_".length);
  return id || null;
}

function getTaskId(decision: AssistantDecisionDoc): string | null {
  const task = decision.createdCoreObjects?.find((o) => o.type === "task");
  return task?.id ?? null;
}

export default function AssistantHistoryPage() {
  const { data: decisions, loading, error, refetch } = useUserAssistantDecisions({ limit: 100 });
  const [filter, setFilter] = useState<Filter>("all");

  const sorted = useMemo(() => {
    const arr = (decisions ?? []).slice();
    arr.sort((a, b) => toMillisSafe(b.createdAt) - toMillisSafe(a.createdAt));
    return arr;
  }, [decisions]);

  const filtered = useMemo(() => {
    if (filter === "all") return sorted;
    if (filter === "accepted") return sorted.filter((d) => d.action === "accepted");
    if (filter === "edited") return sorted.filter((d) => d.action === "edited_then_accepted");
    return sorted.filter((d) => d.action === "rejected");
  }, [sorted, filter]);

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Assistant — Historique</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? "Chargement…" : `${filtered.length} décision(s)`}
          </p>
        </div>
        <a
          href="/assistant"
          className="px-3 py-2 rounded-md border border-input text-sm hover:bg-accent"
        >
          Retour
        </a>
      </div>

      <div className="sn-card p-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={
            filter === "all"
              ? "px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm"
              : "px-3 py-2 rounded-md border border-input text-sm"
          }
        >
          Tous
        </button>
        <button
          type="button"
          onClick={() => setFilter("accepted")}
          className={
            filter === "accepted"
              ? "px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm"
              : "px-3 py-2 rounded-md border border-input text-sm"
          }
        >
          Acceptés
        </button>
        <button
          type="button"
          onClick={() => setFilter("rejected")}
          className={
            filter === "rejected"
              ? "px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm"
              : "px-3 py-2 rounded-md border border-input text-sm"
          }
        >
          Refusés
        </button>
        <button
          type="button"
          onClick={() => setFilter("edited")}
          className={
            filter === "edited"
              ? "px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm"
              : "px-3 py-2 rounded-md border border-input text-sm"
          }
        >
          Modifiés
        </button>

        <button
          type="button"
          onClick={refetch}
          className="ml-auto px-3 py-2 rounded-md border border-input text-sm hover:bg-accent"
        >
          Rafraîchir
        </button>
      </div>

      {error && <div className="sn-alert sn-alert--error">Impossible de charger l’historique.</div>}

      {!loading && !error && filtered.length === 0 && (
        <div className="text-sm text-muted-foreground">Aucune décision pour le moment.</div>
      )}

      <div className="space-y-3">
        {filtered.map((d) => {
          const taskId = getTaskId(d);
          const noteId = parseNoteIdFromObjectId(d.objectId);
          const before = d.beforePayload;
          const final = d.finalPayload;

          const title = final?.title ?? before?.title ?? "";
          const excerpt = before?.origin?.fromText ?? "";

          return (
            <div key={d.id ?? `${d.suggestionId}-${toMillisSafe(d.createdAt)}`} className="sn-card p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{title || "(sans titre)"}</div>
                  <div className="text-xs text-muted-foreground">{decisionLabel(d.action)}</div>
                  <div className="text-xs text-muted-foreground">{formatTs(d.createdAt)}</div>
                  {excerpt ? (
                    <div className="text-xs text-muted-foreground">Extrait: “{excerpt}”</div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {taskId ? (
                    <a
                      href={`/tasks/${encodeURIComponent(taskId)}`}
                      className="px-3 py-2 rounded-md border border-input text-sm hover:bg-accent"
                    >
                      Voir la tâche
                    </a>
                  ) : null}
                  {noteId ? (
                    <a
                      href={`/notes/${encodeURIComponent(noteId)}`}
                      className="px-3 py-2 rounded-md border border-input text-sm hover:bg-accent"
                    >
                      Voir la note
                    </a>
                  ) : null}
                </div>
              </div>

              {d.action === "edited_then_accepted" && before && final ? (
                <div className="border-t border-border pt-2 space-y-1">
                  <div className="text-xs text-muted-foreground">Avant: {before.title}</div>
                  <div className="text-xs text-muted-foreground">Après: {final.title}</div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
