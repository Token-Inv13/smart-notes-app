"use client";

import { useEffect, useRef, useState } from "react";

type MenuAction = "edit" | "archive" | "share" | "export" | "delete";

interface ItemActionsMenuProps {
  onEdit: () => void;
  onToggleArchive: () => void;
  onShare: () => void;
  onDelete: () => void;
  archived?: boolean;
  disabledHint?: string;
}

export default function ItemActionsMenu({
  onEdit,
  onToggleArchive,
  onShare,
  onDelete,
  archived,
  disabledHint,
}: ItemActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const hint = disabledHint ?? "Disponible prochainement";

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [open]);

  const run = (action: MenuAction) => {
    if (action === "edit") onEdit();
    if (action === "archive") onToggleArchive();
    if (action === "share") onShare();
    if (action === "delete") onDelete();
    setOpen(false);
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="sn-icon-btn"
        aria-label="Actions"
        title="Actions"
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-48 rounded-md border border-border bg-card shadow-lg p-1 z-50"
          role="menu"
          aria-label="Menu d’actions"
        >
          <button
            type="button"
            className="w-full text-left px-3 py-2 text-sm rounded hover:bg-accent"
            role="menuitem"
            onClick={() => run("edit")}
          >
            Modifier
          </button>

          <button
            type="button"
            className="w-full text-left px-3 py-2 text-sm rounded hover:bg-accent"
            role="menuitem"
            onClick={() => run("archive")}
          >
            {archived ? "Restaurer" : "Archiver"}
          </button>

          <button
            type="button"
            className="w-full text-left px-3 py-2 text-sm rounded hover:bg-accent"
            role="menuitem"
            onClick={() => run("share")}
          >
            Partager
          </button>

          <button
            type="button"
            className="w-full text-left px-3 py-2 text-sm rounded text-muted-foreground opacity-60 cursor-not-allowed"
            role="menuitem"
            disabled
            title={hint}
          >
            Exporter
          </button>

          <div className="my-1 border-t border-border" />

          <button
            type="button"
            className="w-full text-left px-3 py-2 text-sm rounded hover:bg-accent text-destructive"
            role="menuitem"
            onClick={() => run("delete")}
          >
            Supprimer
          </button>
        </div>
      )}
    </div>
  );
}
