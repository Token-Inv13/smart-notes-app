"use client";

import React from "react";
import TaskItemCard from "./TaskItemCard";
import type { TaskDoc, WorkspaceDoc, Priority } from "@/types/firestore";

interface ActiveTasksDisplayProps {
  tasks: TaskDoc[];
  workspaces: WorkspaceDoc[];
  viewMode: "list" | "grid";
  hrefSuffix: string;
  highlightedTaskId: string | null;
  flashHighlightTaskId: string | null;
  statusLabel: (s: any) => string;
  priorityLabel: (p: Priority) => string;
  priorityDotClass: (p: Priority) => string;
  formatDueDate: (ts: any) => string;
  formatStartDate: (ts: any) => string;
  toggleFavorite: (task: TaskDoc) => void;
  toggleDone: (task: TaskDoc, done: boolean) => void;
}

const ActiveTasksDisplay: React.FC<ActiveTasksDisplayProps> = ({
  tasks,
  workspaces,
  viewMode,
  hrefSuffix,
  highlightedTaskId,
  flashHighlightTaskId,
  statusLabel,
  priorityLabel,
  priorityDotClass,
  formatDueDate,
  formatStartDate,
  toggleFavorite,
  toggleDone,
}) => {
  if (viewMode === "grid") {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {tasks.map((task) => {
          const workspaceName = workspaces.find((ws) => ws.id === task.workspaceId)?.name ?? "—";
          return (
            <TaskItemCard
              key={task.id}
              task={task}
              viewMode="grid"
              hrefSuffix={hrefSuffix}
              highlightedTaskId={highlightedTaskId}
              flashHighlightTaskId={flashHighlightTaskId}
              workspaceName={workspaceName}
              status={(task.status as any) || "todo"}
              statusLabel={statusLabel}
              priorityLabel={priorityLabel}
              priorityDotClass={priorityDotClass}
              formatDueDate={formatDueDate}
              formatStartDate={formatStartDate}
              toggleFavorite={toggleFavorite}
              toggleDone={toggleDone}
            />
          );
        })}
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {tasks.map((task) => {
        const workspaceName = workspaces.find((ws) => ws.id === task.workspaceId)?.name ?? "—";
        return (
          <li key={task.id} id={`task-${task.id}`}>
            <TaskItemCard
              task={task}
              viewMode="list"
              hrefSuffix={hrefSuffix}
              highlightedTaskId={highlightedTaskId}
              flashHighlightTaskId={flashHighlightTaskId}
              workspaceName={workspaceName}
              status={(task.status as any) || "todo"}
              statusLabel={statusLabel}
              priorityLabel={priorityLabel}
              priorityDotClass={priorityDotClass}
              formatDueDate={formatDueDate}
              formatStartDate={formatStartDate}
              toggleFavorite={toggleFavorite}
              toggleDone={toggleDone}
            />
          </li>
        );
      })}
    </ul>
  );
};

export default ActiveTasksDisplay;
