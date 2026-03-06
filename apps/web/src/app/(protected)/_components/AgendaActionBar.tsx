"use client";

import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  Kanban,
  LayoutGrid,
  List,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";

type ArchiveView = "active" | "archived";
type TaskViewMode = "list" | "grid" | "kanban" | "calendar";

interface AgendaActionBarProps {
  archiveView: ArchiveView;
  viewMode: TaskViewMode;
  onArchiveViewChange: (next: ArchiveView) => void;
  onViewModeChange: (next: TaskViewMode) => void;
  searchValue: string;
  onSearchChange: (next: string) => void;
  onFilterToggle: () => void;
}

const VIEW_OPTIONS: Array<{
  key: TaskViewMode;
  label: string;
  icon: typeof List;
}> = [
  { key: "list", label: "Liste", icon: List },
  { key: "kanban", label: "Kanban", icon: Kanban },
  { key: "grid", label: "Grille", icon: LayoutGrid },
  { key: "calendar", label: "Agenda", icon: CalendarDays },
];

export default function AgendaActionBar({
  archiveView,
  viewMode,
  onArchiveViewChange,
  onViewModeChange,
  searchValue,
  onSearchChange,
  onFilterToggle,
}: AgendaActionBarProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(() => searchValue.trim().length > 0);

  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      setSearchOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [searchOpen]);

  return (
    <div ref={rootRef} className="w-full rounded-md border border-border bg-background p-1.5">
      <div className="flex w-full flex-wrap items-center gap-1">
        <div className="inline-flex items-center overflow-hidden rounded-md border border-border bg-background whitespace-nowrap">
          <button
            type="button"
            onClick={() => onArchiveViewChange("active")}
            className={`inline-flex items-center gap-1 px-2 py-1.5 text-xs sm:text-sm ${archiveView === "active" ? "bg-accent" : ""}`}
            aria-label="Afficher les taches actives"
            title="Actives"
          >
            <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
            <span>Actives</span>
          </button>
          <button
            type="button"
            onClick={() => onArchiveViewChange("archived")}
            className={`inline-flex items-center gap-1 border-l border-border px-2 py-1.5 text-xs sm:text-sm ${archiveView === "archived" ? "bg-accent" : ""}`}
            aria-label="Afficher les taches archivees"
            title="Archivees"
          >
            <Archive className="h-3.5 w-3.5" aria-hidden />
            <span>Archivees</span>
          </button>
        </div>

        <div className="inline-flex items-center overflow-hidden rounded-md border border-border bg-background whitespace-nowrap">
          {VIEW_OPTIONS.map((option, index) => {
            const Icon = option.icon;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => onViewModeChange(option.key)}
                className={`inline-flex items-center gap-1 px-2 py-1.5 text-xs sm:text-sm ${
                  index > 0 ? "border-l border-border" : ""
                } ${viewMode === option.key ? "bg-accent" : ""}`}
                aria-label={`Afficher la vue ${option.label.toLowerCase()}`}
                title={option.label}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">{option.label}</span>
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1 max-sm:w-full max-sm:justify-start">
          {searchOpen ? (
            <div className="relative min-w-[180px] flex-1">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                id="tasks-search-input"
                ref={searchInputRef}
                type="text"
                value={searchValue}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  onSearchChange(nextValue);
                  if (nextValue.trim().length === 0) {
                    setSearchOpen(false);
                  }
                }}
                onBlur={() => {
                  if (searchValue.trim().length === 0) {
                    setSearchOpen(false);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  if (searchValue.trim().length > 0) {
                    onSearchChange("");
                    return;
                  }
                  setSearchOpen(false);
                }}
                placeholder="Rechercher (titre, texte, dossier)…"
                className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-8 text-sm"
                aria-label="Rechercher dans l'agenda"
              />
              <button
                type="button"
                onClick={() => {
                  if (searchValue.trim().length > 0) {
                    onSearchChange("");
                    setSearchOpen(false);
                    return;
                  }
                  setSearchOpen(false);
                }}
                className="absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={searchValue.trim().length > 0 ? "Effacer la recherche" : "Fermer la recherche"}
                title={searchValue.trim().length > 0 ? "Effacer" : "Fermer"}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ) : (
            <button
              id="tasks-search-toggle"
              type="button"
              onClick={() => setSearchOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background hover:bg-accent"
              aria-label="Ouvrir la recherche"
              title="Recherche"
            >
              <Search className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}

          <button
            type="button"
            onClick={onFilterToggle}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background hover:bg-accent"
            aria-label="Ouvrir les filtres"
            title="Filtres"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
