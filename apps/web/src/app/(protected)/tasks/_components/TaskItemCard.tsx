"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { normalizeDisplayText } from "@/lib/normalizeText";
import { DraggableCard } from "../_components/folderDnd";
import type { TaskDoc, Priority } from "@/types/firestore";

interface TaskItemCardProps {
  task: TaskDoc;
  hrefSuffix: string;
  highlightedTaskId: string | null;
  flashHighlightTaskId: string | null;
  workspaceName: string;
  status: "todo" | "doing" | "done";
  statusLabel: (s: any) => string;
  priorityLabel: (p: Priority) => string;
  priorityDotClass: (p: Priority) => string;
  formatDueDate: (ts: any) => string;
  formatStartDate: (ts: any) => string;
  toggleFavorite: (task: TaskDoc) => void;
  toggleDone: (task: TaskDoc, done: boolean) => void;
  viewMode: "list" | "grid";
}

const TaskItemCard: React.FC<TaskItemCardProps> = ({
  task,
  hrefSuffix,
  highlightedTaskId,
  flashHighlightTaskId,
  workspaceName,
  status,
  statusLabel,
  priorityLabel,
  priorityDotClass,
  formatDueDate,
  formatStartDate,
  toggleFavorite,
  toggleDone,
  viewMode,
}) => {
  const router = useRouter();
  const dueLabel = formatDueDate(task.dueDate ?? null);
  const startLabel = formatStartDate(task.startDate ?? null);

  const cardContent = (dragHandle?: React.ReactNode) => (
    <div
      className={`sn-card sn-card--task ${task.favorite ? " sn-card--favorite" : ""} p-4 ${
        task.id === highlightedTaskId ? (flashHighlightTaskId === task.id ? "sn-highlight-soft" : "border-primary") : ""
      } ${viewMode === "grid" ? "h-full flex flex-col" : ""}`}
      onClick={() => task.id && router.push(`/tasks/${task.id}${hrefSuffix}`)}
    >
      <div className={viewMode === "grid" ? "flex flex-col gap-3 h-full" : "space-y-3"}>
        <div className="sn-card-header">
          <div className="min-w-0">
            <div className={`sn-card-title ${viewMode === "grid" ? "line-clamp-2" : "truncate"}`}>
              {normalizeDisplayText(task.title)}
            </div>
            <div className="sn-card-meta">
              <span className="sn-badge">{normalizeDisplayText(workspaceName)}</span>
              <span className="sn-badge">{statusLabel(status)}</span>
              {startLabel && <span className="sn-badge">Début: {startLabel}</span>}
              {dueLabel && <span className="sn-badge">Échéance: {dueLabel}</span>}
              {task.priority && (
                <span className="sn-badge inline-flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${priorityDotClass(task.priority)}`} />
                  <span>Priorité: {priorityLabel(task.priority)}</span>
                </span>
              )}
            </div>
          </div>
          <div className="sn-card-actions shrink-0">
            {dragHandle}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleFavorite(task);
              }}
              className="sn-icon-btn"
            >
              {task.favorite ? "★" : "☆"}
            </button>
          </div>
        </div>
        <div className={viewMode === "grid" ? "mt-auto" : "flex items-center justify-between gap-3"}>
          <label className="text-xs flex items-center gap-2">
            <input
              type="checkbox"
              checked={status === "done"}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => toggleDone(task, e.target.checked)}
            />
            <span className="text-muted-foreground">Terminé</span>
          </label>
        </div>
      </div>
    </div>
  );

  if (viewMode === "list") {
    return (
      <DraggableCard dragData={{ kind: "task", id: task.id ?? "", workspaceId: task.workspaceId }}>
        {({ dragHandle }) => cardContent(dragHandle)}
      </DraggableCard>
    );
  }

  return cardContent();
};

export default TaskItemCard;
