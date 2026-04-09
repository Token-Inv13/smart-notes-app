"use client";

import React from "react";
import AgendaActionBar from "../../_components/AgendaActionBar";
import AgendaFilterDialog from "./AgendaFilterDialog";
import AgendaNotificationPrompt from "./AgendaNotificationPrompt";
import { TaskViewMode, TaskStatusFilter, TaskPriorityFilter, DueFilter, TaskSortBy } from "../_hooks/useAgendaController";

interface AgendaHeaderProps {
  isCalendarView: boolean;
  archiveView: "active" | "archived";
  viewMode: TaskViewMode;
  onArchiveViewChange: (next: "active" | "archived") => void;
  onViewModeChange: (next: TaskViewMode) => void;
  searchValue: string;
  onSearchChange: (next: string) => void;
  onFilterToggle: () => void;
  activeSearchLabel: string | null;
  filteredTasksCount: number;
  
  // Filter Dialog Props
  filtersOpen: boolean;
  onFiltersClose: () => void;
  statusFilter: TaskStatusFilter;
  onStatusFilterChange: (next: TaskStatusFilter) => void;
  priorityFilter: TaskPriorityFilter;
  onPriorityFilterChange: (next: TaskPriorityFilter) => void;
  dueFilter: DueFilter;
  onDueFilterChange: (next: DueFilter) => void;
  sortBy: TaskSortBy;
  onSortByChange: (next: TaskSortBy) => void;
  workspaceFilter: string;
  onWorkspaceFilterChange: (id: string) => void;
  workspaces: any[];
  workspaceOptionLabels: Map<string, string>;
  onResetFilters: () => void;
  
  // Notification Props
  notificationPermission: NotificationPermission | "unsupported";
  enablingPush: boolean;
  pushStatus: string | null;
  onEnableNotifications: () => Promise<void>;
}

const AgendaHeader: React.FC<AgendaHeaderProps> = ({
  isCalendarView,
  archiveView,
  viewMode,
  onArchiveViewChange,
  onViewModeChange,
  searchValue,
  onSearchChange,
  onFilterToggle,
  activeSearchLabel,
  filteredTasksCount,
  filtersOpen,
  onFiltersClose,
  statusFilter,
  onStatusFilterChange,
  priorityFilter,
  onPriorityFilterChange,
  dueFilter,
  onDueFilterChange,
  sortBy,
  onSortByChange,
  workspaceFilter,
  onWorkspaceFilterChange,
  workspaces,
  workspaceOptionLabels,
  onResetFilters,
  notificationPermission,
  enablingPush,
  pushStatus,
  onEnableNotifications,
}) => {
  return (
    <header className={isCalendarView ? "flex flex-col gap-1.5 mb-1 md:mb-1" : "flex flex-col gap-2 mb-2 md:mb-2"}>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Agenda</h1>
      </div>

      <div className="w-full">
        <AgendaActionBar
          archiveView={archiveView}
          viewMode={viewMode}
          onArchiveViewChange={onArchiveViewChange}
          onViewModeChange={onViewModeChange}
          searchValue={searchValue}
          onSearchChange={onSearchChange}
          onFilterToggle={onFilterToggle}
          trailingSlot={<div id="sn-create-slot" data-task-view-mode={viewMode} />}
        />
      </div>

      {activeSearchLabel && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="sn-badge">Recherche: “{activeSearchLabel}”</span>
          <span className="sn-badge">Résultats: {filteredTasksCount}</span>
        </div>
      )}

      <AgendaFilterDialog
        isOpen={filtersOpen}
        onClose={onFiltersClose}
        statusFilter={statusFilter}
        onStatusFilterChange={onStatusFilterChange}
        priorityFilter={priorityFilter}
        onPriorityFilterChange={onPriorityFilterChange}
        dueFilter={dueFilter}
        onDueFilterChange={onDueFilterChange}
        sortBy={sortBy}
        onSortByChange={onSortByChange}
        workspaceFilter={workspaceFilter}
        onWorkspaceFilterChange={onWorkspaceFilterChange}
        workspaces={workspaces}
        workspaceOptionLabels={workspaceOptionLabels}
        onReset={onResetFilters}
      />

      <AgendaNotificationPrompt
        permission={notificationPermission}
        enablingPush={enablingPush}
        pushStatus={pushStatus}
        onEnable={onEnableNotifications}
      />
    </header>
  );
};

export default AgendaHeader;
