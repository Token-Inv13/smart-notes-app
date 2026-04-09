"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { normalizeDisplayText } from "@/lib/normalizeText";
import type { TaskDoc, WorkspaceDoc } from "@/types/firestore";

interface ArchivedTasksSectionProps {
  tasks: TaskDoc[];
  workspaces: WorkspaceDoc[];
  hrefSuffix: string;
  statusLabel: (s: "todo" | "doing" | "done") => string;
  priorityLabel: (p: string) => string;
  priorityDotClass: (p: string) => string;
  formatDueDate: (ts: any) => string;
  formatStartDate: (ts: any) => string;
  restoreArchivedTask: (task: TaskDoc) => void;
}

const ArchivedTasksSection: React.FC<ArchivedTasksSectionProps> = ({
  tasks,
  workspaces,
  hrefSuffix,
  statusLabel,
  priorityLabel,
  priorityDotClass,
  formatDueDate,
  formatStartDate,
  restoreArchivedTask,
}) => {
  const router = useRouter();

  return (
    <ul className="space-y-2">
      {tasks.map((task) => {
        const status = (task.status as "todo" | "doing" | "done") || "todo";
        const workspaceName = workspaces.find((ws) => ws.id === task.workspaceId)?.name ?? "—";
        const dueLabel = formatDueDate(task.dueDate ?? null);
        const startLabel = formatStartDate(task.startDate ?? null);

        return (
          <li key={task.id}>
            <div
              className="sn-card sn-card--task sn-card--muted p-4 cursor-pointer"
              onClick={() => task.id && router.push(`/tasks/${task.id}${hrefSuffix}`)}
            >
              <div className="sn-card-header">
                <div className="min-w-0">
                  <div className="sn-card-title truncate">{normalizeDisplayText(task.title)}</div>
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
                  <button
                    type="button"
                    className="sn-text-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      restoreArchivedTask(task);
                    }}
                  >
                    Restaurer
                  </button>
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
};

export default ArchivedTasksSection;
