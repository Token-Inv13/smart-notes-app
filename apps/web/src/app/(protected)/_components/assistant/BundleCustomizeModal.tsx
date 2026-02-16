"use client";

import { useEffect, useMemo, useState } from "react";
import type { Timestamp } from "firebase/firestore";
import { formatTimestampForInput, parseLocalDateTimeToTimestamp } from "@/lib/datetime";
import { toUserErrorMessage } from "@/lib/userError";
import type { AssistantSuggestionDoc, Priority } from "@/types/firestore";
import Modal from "../../Modal";

type BundleOverrides = {
  selectedIndexes: number[];
  tasksOverrides?: Record<
    number,
    {
      title?: string;
      dueDate?: number | null;
      remindAt?: number | null;
      priority?: Priority | null;
    }
  >;
};

type Props = {
  open: boolean;
  onClose: () => void;
  suggestion: AssistantSuggestionDoc | null;
  onConfirm: (overrides: BundleOverrides) => Promise<void>;
  isPro: boolean;
  loading?: boolean;
};

const toMillisOrNull = (ts: Timestamp | null | undefined) => {
  try {
    return ts ? ts.toMillis() : null;
  } catch {
    return null;
  }
};

export default function BundleCustomizeModal({ open, onClose, suggestion, onConfirm, isPro, loading }: Props) {
  const bundlePayload = useMemo(() => {
    if (!open) return null;
    if (!suggestion) return null;
    if (suggestion.kind !== "create_task_bundle") return null;
    if (!("tasks" in suggestion.payload)) return null;
    return suggestion.payload;
  }, [open, suggestion]);

  const tasks = useMemo(() => {
    if (!bundlePayload) return [];
    return bundlePayload.tasks.slice(0, 6);
  }, [bundlePayload]);

  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [titles, setTitles] = useState<Record<number, string>>({});
  const [dueDates, setDueDates] = useState<Record<number, string>>({});
  const [remindAts, setRemindAts] = useState<Record<number, string>>({});
  const [priorities, setPriorities] = useState<Record<number, "" | Priority>>({});
  const [error, setError] = useState<string | null>(null);
  const [internalLoading, setInternalLoading] = useState(false);

  const effectiveLoading = typeof loading === "boolean" ? loading : internalLoading;

  useEffect(() => {
    if (!open) return;
    if (!bundlePayload) return;

    const nextSelected: Record<number, boolean> = {};
    const nextTitles: Record<number, string> = {};
    const nextDue: Record<number, string> = {};
    const nextRemind: Record<number, string> = {};
    const nextPriorities: Record<number, "" | Priority> = {};

    tasks.forEach((t, idx) => {
      nextSelected[idx] = true;
      nextTitles[idx] = t.title ?? "";
      nextDue[idx] = t.dueDate ? formatTimestampForInput(t.dueDate) : "";
      nextRemind[idx] = t.remindAt ? formatTimestampForInput(t.remindAt) : "";
      const p = t.priority;
      nextPriorities[idx] = p === "low" || p === "medium" || p === "high" ? p : "";
    });

    setSelected(nextSelected);
    setTitles(nextTitles);
    setDueDates(nextDue);
    setRemindAts(nextRemind);
    setPriorities(nextPriorities);
    setError(null);
  }, [open, bundlePayload, tasks]);

  const selectedCount = useMemo(() => {
    let c = 0;
    for (let i = 0; i < tasks.length; i++) {
      if (selected[i]) c++;
    }
    return c;
  }, [selected, tasks.length]);

  const handleConfirm = async () => {
    if (!suggestion || suggestion.kind !== "create_task_bundle") return;
    if (!bundlePayload) return;

    if (!isPro) {
      onClose();
      return;
    }

    const selectedIndexes: number[] = [];
    for (let i = 0; i < tasks.length; i++) {
      if (selected[i]) selectedIndexes.push(i);
    }

    if (selectedIndexes.length === 0) {
      setError("Sélectionne au moins un élément d’agenda.");
      return;
    }

    const tasksOverrides: BundleOverrides["tasksOverrides"] = {};

    for (const idx of selectedIndexes) {
      const base = tasks[idx];
      if (!base) {
        setError("Item invalide.");
        return;
      }

      const row: NonNullable<BundleOverrides["tasksOverrides"]>[number] = {};

      const nextTitle = (titles[idx] ?? "").trim();
      if (!nextTitle) {
        setError("Le titre ne peut pas être vide.");
        return;
      }
      if (nextTitle !== (base.title ?? "")) row.title = nextTitle;

      const nextDue = (dueDates[idx] ?? "") ? parseLocalDateTimeToTimestamp(dueDates[idx] ?? "") : null;
      const nextRemind = (remindAts[idx] ?? "") ? parseLocalDateTimeToTimestamp(remindAts[idx] ?? "") : null;

      const baseDueMs = toMillisOrNull(base.dueDate);
      const baseRemindMs = toMillisOrNull(base.remindAt);
      const nextDueMs = nextDue ? nextDue.toMillis() : null;
      const nextRemindMs = nextRemind ? nextRemind.toMillis() : null;

      if (baseDueMs !== nextDueMs) row.dueDate = nextDueMs;
      if (baseRemindMs !== nextRemindMs) row.remindAt = nextRemindMs;

      const basePriority = base.priority ?? null;
      const nextPriority = priorities[idx] ?? "";
      if ((basePriority ?? "") !== nextPriority) row.priority = nextPriority ? nextPriority : null;

      if (Object.keys(row).length > 0) tasksOverrides[idx] = row;
    }

    setInternalLoading(true);
    setError(null);
    try {
      await onConfirm({
        selectedIndexes,
        tasksOverrides: Object.keys(tasksOverrides).length > 0 ? tasksOverrides : undefined,
      });
      onClose();
    } catch (e) {
      setError(toUserErrorMessage(e, "Impossible de créer le plan."));
      return;
    } finally {
      setInternalLoading(false);
    }
  };

  if (!open) return null;
  if (!suggestion) return null;
  if (suggestion.kind !== "create_task_bundle") return null;
  if (!bundlePayload) return null;

  const suggestionKey = suggestion.id ?? suggestion.dedupeKey ?? "bundle";

  return (
    <Modal
      title="Personnaliser le plan"
      onBeforeClose={() => {
        onClose();
        return false;
      }}
    >
      <div className="space-y-3">
        {error ? <div className="sn-alert sn-alert--error">{error}</div> : null}

        <div className="space-y-3">
          {tasks.map((t, idx) => {
            const checked = !!selected[idx];
            const title = titles[idx] ?? "";
            const due = dueDates[idx] ?? "";
            const remind = remindAts[idx] ?? "";
            const prio = priorities[idx] ?? "";

            const checkboxId = `bundle-customize-${suggestionKey}-${idx}-selected`;
            const titleId = `bundle-customize-${suggestionKey}-${idx}-title`;
            const dueId = `bundle-customize-${suggestionKey}-${idx}-due`;
            const remindId = `bundle-customize-${suggestionKey}-${idx}-remind`;
            const priorityId = `bundle-customize-${suggestionKey}-${idx}-priority`;

            return (
              <div key={idx} className="border border-border rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm" htmlFor={checkboxId}>
                    <input
                      id={checkboxId}
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setSelected((prev) => ({ ...prev, [idx]: e.target.checked }))}
                    />
                    #{idx + 1}
                  </label>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor={titleId}>
                    Titre
                  </label>
                  <input
                    id={titleId}
                    type="text"
                    value={title}
                    onChange={(e) => setTitles((prev) => ({ ...prev, [idx]: e.target.value }))}
                    disabled={!checked}
                    className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm disabled:opacity-50"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-sm font-medium" htmlFor={dueId}>
                      Échéance
                    </label>
                    <input
                      id={dueId}
                      type="datetime-local"
                      value={due}
                      onChange={(e) => setDueDates((prev) => ({ ...prev, [idx]: e.target.value }))}
                      disabled={!checked}
                      className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm disabled:opacity-50"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium" htmlFor={remindId}>
                      Rappel
                    </label>
                    <input
                      id={remindId}
                      type="datetime-local"
                      value={remind}
                      onChange={(e) => setRemindAts((prev) => ({ ...prev, [idx]: e.target.value }))}
                      disabled={!checked}
                      className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm disabled:opacity-50"
                    />
                  </div>
                </div>

                {typeof t.priority !== "undefined" ? (
                  <div className="space-y-1">
                    <label className="text-sm font-medium" htmlFor={priorityId}>
                      Priorité
                    </label>
                    <select
                      id={priorityId}
                      value={prio}
                      onChange={(e) => setPriorities((prev) => ({ ...prev, [idx]: e.target.value as "" | Priority }))}
                      disabled={!checked}
                      className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm disabled:opacity-50"
                    >
                      <option value="">Aucune</option>
                      <option value="low">Basse</option>
                      <option value="medium">Moyenne</option>
                      <option value="high">Haute</option>
                    </select>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">Créer {selectedCount} élément(s) d’agenda</div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="px-3 py-2 rounded-md border border-input text-sm">
              Annuler
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={effectiveLoading || selectedCount === 0}
              className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              {effectiveLoading ? "Création…" : `Créer ${selectedCount} élément(s) d’agenda`}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
