"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useUserAssistantDecisions } from "@/hooks/useUserAssistantDecisions";
import { sanitizeAssistantText } from "@/lib/assistantText";
import type { AssistantDecisionDoc } from "@/types/firestore";

type Filter = "all" | "accepted" | "rejected" | "edited";
type PeriodFilter = "7d" | "30d" | "all";

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

function extractPayloadSearchText(payload: AssistantDecisionDoc["beforePayload"] | AssistantDecisionDoc["finalPayload"]) {
  if (!payload || typeof payload !== "object") {
    return { title: "", explanation: "", excerpt: "" };
  }

  const obj = payload as {
    title?: unknown;
    explanation?: unknown;
    origin?: { fromText?: unknown };
  };

  return {
    title: sanitizeAssistantText(obj.title),
    explanation: sanitizeAssistantText(obj.explanation),
    excerpt: sanitizeAssistantText(obj.origin?.fromText),
  };
}

export default function AssistantHistoryPage() {
  const searchParams = useSearchParams();
  const initialNoteId = searchParams.get("noteId") ?? "";

  const { data: decisions, loading, error, refetch } = useUserAssistantDecisions({ limit: 500 });
  const [filter, setFilter] = useState<Filter>("all");
  const [period, setPeriod] = useState<PeriodFilter>("30d");
  const [noteIdFilter, setNoteIdFilter] = useState<string>(initialNoteId);
  const [queryText, setQueryText] = useState<string>("");

  const sorted = useMemo(() => {
    const arr = (decisions ?? []).slice();
    arr.sort((a, b) => toMillisSafe(b.createdAt) - toMillisSafe(a.createdAt));
    return arr;
  }, [decisions]);

  const filtered = useMemo(() => {
    const cutoffMs = (() => {
      if (period === "7d") return Date.now() - 7 * 24 * 60 * 60 * 1000;
      if (period === "30d") return Date.now() - 30 * 24 * 60 * 60 * 1000;
      return null;
    })();

    const q = queryText.trim().toLowerCase();
    const noteFilter = noteIdFilter.trim();

    return sorted.filter((d) => {
      const createdMs = toMillisSafe(d.createdAt);
      if (cutoffMs !== null && createdMs > 0 && createdMs < cutoffMs) return false;

      if (filter === "accepted" && d.action !== "accepted") return false;
      if (filter === "edited" && d.action !== "edited_then_accepted") return false;
      if (filter === "rejected" && d.action !== "rejected") return false;

      if (noteFilter) {
        const n = parseNoteIdFromObjectId(d.objectId);
        if (!n || n !== noteFilter) return false;
      }

      if (q) {
        const before = extractPayloadSearchText(d.beforePayload);
        const final = extractPayloadSearchText(d.finalPayload);
        const title = final.title || before.title;
        const explanation = final.explanation || before.explanation;
        const excerpt = before.excerpt || final.excerpt;
        const objectId = String(d.objectId ?? "");
        const suggestionId = String(d.suggestionId ?? "");
        const hay = `${title}\n${explanation}\n${excerpt}\n${objectId}\n${suggestionId}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [sorted, filter, period, noteIdFilter, queryText]);

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
        <div className="flex flex-col gap-1 w-full">
          <label className="text-xs text-muted-foreground" htmlFor="assistant-history-search">
            Recherche
          </label>
          <input
            id="assistant-history-search"
            type="text"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
            placeholder="Titre, extrait, explication…"
          />
        </div>

        <div className="flex flex-col gap-1 w-full">
          <label className="text-xs text-muted-foreground" htmlFor="assistant-history-noteid">
            Filtre noteId
          </label>
          <input
            id="assistant-history-noteid"
            type="text"
            value={noteIdFilter}
            onChange={(e) => setNoteIdFilter(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
            placeholder="ex: 6pQk…"
          />
        </div>

        <div className="flex flex-wrap items-end gap-2 w-full">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="assistant-history-period">
              Période
            </label>
            <select
              id="assistant-history-period"
              value={period}
              onChange={(e) => setPeriod(e.target.value as PeriodFilter)}
              className="px-3 py-2 rounded-md border border-input text-sm"
            >
              <option value="7d">7 jours</option>
              <option value="30d">30 jours</option>
              <option value="all">Tout</option>
            </select>
          </div>

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

          const title = sanitizeAssistantText(final?.title ?? before?.title ?? "");
          const excerpt = sanitizeAssistantText(before?.origin?.fromText ?? "");

          return (
            <div key={d.id ?? `${d.suggestionId}-${toMillisSafe(d.createdAt)}`} className="sn-card p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{title || "(sans titre)"}</div>
                  <div className="text-xs text-muted-foreground">{decisionLabel(d.action)}</div>
                  <div className="text-xs text-muted-foreground">{formatTs(d.createdAt)}</div>
                  {excerpt ? <div className="text-xs text-muted-foreground whitespace-pre-line">Extrait: “{excerpt}”</div> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {taskId ? (
                    <a
                      href={`/tasks/${encodeURIComponent(taskId)}`}
                      className="px-3 py-2 rounded-md border border-input text-sm hover:bg-accent"
                    >
                      Voir l’élément d’agenda
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
                  {noteId ? (
                    <a
                      href={`/assistant/history?noteId=${encodeURIComponent(noteId)}`}
                      className="px-3 py-2 rounded-md border border-input text-sm hover:bg-accent"
                    >
                      Tout depuis cette note
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
