"use client";

import type { ReactNode } from "react";
import { useDraggable } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";

export type FolderDragData =
  | { kind: "note"; id: string; workspaceId: string | null }
  | { kind: "task"; id: string; workspaceId: string | null }
  | { kind: "todo"; id: string; workspaceId: string | null }
  | { kind: "workspace"; id: string; parentId: string | null };

export type FolderDropData = {
  kind: "folder-target";
  workspaceId: string;
};

export function buildFolderDragId(data: FolderDragData) {
  return `${data.kind}:${data.id}`;
}

export function buildFolderDropId(workspaceId: string) {
  return `folder:${workspaceId}`;
}

function toTransformStyle(transform: { x: number; y: number; scaleX: number; scaleY: number } | null | undefined) {
  if (!transform) return undefined;
  return `translate3d(${transform.x}px, ${transform.y}px, 0) scaleX(${transform.scaleX}) scaleY(${transform.scaleY})`;
}

interface DraggableCardProps {
  dragData: FolderDragData;
  className?: string;
  disabled?: boolean;
  children: (args: { dragHandle: ReactNode; isDragging: boolean }) => ReactNode;
}

export function DraggableCard({ dragData, className, disabled = false, children }: DraggableCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: buildFolderDragId(dragData),
    data: dragData,
    disabled,
  });

  const style = transform
    ? {
        transform: toTransformStyle(transform),
      }
    : undefined;

  const dragHandle = disabled ? null : (
    <button
      type="button"
      {...attributes}
      {...listeners}
      onClick={(event) => event.stopPropagation()}
      className="sn-icon-btn touch-none"
      aria-label="Déplacer vers un dossier"
      title="Déplacer vers un dossier"
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${className ?? ""} transition-[opacity,transform,box-shadow] duration-150 ${
        isDragging ? "opacity-50 shadow-xl" : ""
      }`}
    >
      {children({ dragHandle, isDragging })}
    </div>
  );
}
