"use client";

import { useMemo } from "react";
import { DndContext } from "@dnd-kit/core";
import { useUserTasks } from "@/hooks/useUserTasks";
import { useUserNotes } from "@/hooks/useUserNotes";
import { useUserTodos } from "@/hooks/useUserTodos";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useUserWorkspaces } from "@/hooks/useUserWorkspaces";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import { normalizeDisplayText } from "@/lib/normalizeText";
import WorkspaceFolderBrowser from "../_components/WorkspaceFolderBrowser";
import {
  countItemsByWorkspaceId,
  getWorkspaceChain,
} from "@/lib/workspaces";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useAgendaController } from "./_hooks/useAgendaController";

// New Refactored Components
import AgendaTabs from "./_components/AgendaTabs";
import AgendaHeader from "./_components/AgendaHeader";
import AgendaEmptyState from "./_components/AgendaEmptyState";
import AgendaMicroGuide from "./_components/AgendaMicroGuide";
import ActiveTasksDisplay from "./_components/ActiveTasksDisplay";
import ArchivedTasksSection from "./_components/ArchivedTasksSection";
import CompletedTasksSection from "./_components/CompletedTasksSection";

const AgendaCalendar = dynamic(() => import("../_components/AgendaCalendar"), {
  ssr: false,
  loading: () => <div className="sn-empty">Chargement de l’Agenda…</div>,
});

function toLocalDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function TasksPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { tasks: allTasks, loading, error } = useUserTasks();
  const { workspaces } = useUserWorkspaces();
  const { settings: userSettings } = useUserSettings();
  const { notes: notesForCounter } = useUserNotes();
  const { todos: todosForCounter } = useUserTodos();

  const controller = useAgendaController({
    allTasks: allTasks ?? [],
    calendarWindowTasks: allTasks ?? [],
    workspaces: workspaces ?? [],
    userSettings,
    notesForCounter: notesForCounter ?? [],
    todosForCounter: todosForCounter ?? [],
  });

  const workspaceIdParam = searchParams.get("workspaceId");
  const highlightedTaskId = searchParams.get("taskId");

  const hrefSuffix = workspaceIdParam ? `?workspaceId=${encodeURIComponent(workspaceIdParam)}` : "";

  const workspaceTabsSwipeHandlers = useSwipeNavigation<HTMLDivElement>({
    onSwipeLeft: () => router.push(`/todo${hrefSuffix}`),
    onSwipeRight: () => router.push(`/notes${hrefSuffix}`),
    ignoreInteractiveTargets: true,
    disabled: !workspaceIdParam,
  });

  const archiveTabsSwipeHandlers = useSwipeNavigation<HTMLDivElement>({
    onSwipeLeft: () => controller.setArchiveView("archived"),
    onSwipeRight: () => controller.setArchiveView("active"),
    disabled: false,
  });

  const currentWorkspace = useMemo(
    () => (workspaces ?? []).find((ws) => ws.id === workspaceIdParam),
    [workspaces, workspaceIdParam]
  );
  const currentWorkspaceChain = useMemo(
    () => getWorkspaceChain(workspaces ?? [], workspaceIdParam),
    [workspaces, workspaceIdParam]
  );
  const childWorkspaceCards = useMemo(
    () => (workspaces ?? []).filter((ws) => ws.parentId === (workspaceIdParam || null)),
    [workspaces, workspaceIdParam]
  );

  const workspaceOptionLabels = useMemo(() => {
    const m = new Map<string, string>();
    (workspaces ?? []).forEach(ws => m.set(ws.id ?? "", normalizeDisplayText(ws.name)));
    return m;
  }, [workspaces]);

  const initialCalendarAnchorDate = useMemo(() => {
    const focus = searchParams.get("focusDate");
    return focus ? new Date(focus) : new Date();
  }, [searchParams]);

  const notificationPermission: NotificationPermission | "unsupported" = (() => {
    if (typeof window === "undefined") return "unsupported";
    if (!("Notification" in window)) return "unsupported";
    return Notification.permission;
  })();

  if (error) return <div className="sn-alert sn-alert--error m-4">{error.message}</div>;

  const isCalendarView = controller.viewMode === "calendar";

  return (
    <DndContext
      sensors={controller.dndSensors}
      onDragStart={controller.handleFolderDragStart}
      onDragCancel={controller.handleFolderDragCancel}
      onDragEnd={controller.handleFolderDragEnd}
    >
      <div
        className={isCalendarView ? "flex min-h-0 flex-1 flex-col gap-2 md:gap-2" : "space-y-3 md:space-y-2"}
        {...workspaceTabsSwipeHandlers}
      >
        {workspaceIdParam && (
          <AgendaTabs
            hrefSuffix={hrefSuffix}
            activeNoteCount={controller.activeNoteCount}
            visibleTasksCount={controller.visibleTasksCount}
            activeTodoCount={controller.activeTodoCount}
          />
        )}

        <div {...archiveTabsSwipeHandlers}>
          <AgendaHeader
            isCalendarView={isCalendarView}
            archiveView={controller.archiveView}
            viewMode={controller.viewMode}
            onArchiveViewChange={controller.setArchiveView}
            onViewModeChange={controller.applyViewMode}
            searchValue={controller.searchInput}
            onSearchChange={controller.setSearchInput}
            onFilterToggle={() => controller.setFiltersOpen(true)}
            activeSearchLabel={controller.activeSearchLabel}
            filteredTasksCount={controller.filteredTasks?.length || 0}
            filtersOpen={controller.filtersOpen}
            onFiltersClose={() => controller.setFiltersOpen(false)}
            statusFilter={controller.statusFilter}
            onStatusFilterChange={controller.setStatusFilter}
            priorityFilter={controller.priorityFilter}
            onPriorityFilterChange={controller.setPriorityFilter}
            dueFilter={controller.dueFilter}
            onDueFilterChange={controller.setDueFilter}
            sortBy={controller.sortBy}
            onSortByChange={controller.setSortBy}
            workspaceFilter={controller.workspaceFilter}
            onWorkspaceFilterChange={controller.handleWorkspaceFilterChange}
            workspaces={controller.effectiveWorkspaces}
            workspaceOptionLabels={workspaceOptionLabels}
            onResetFilters={controller.resetFilters}
            notificationPermission={notificationPermission}
            enablingPush={controller.enablingPush}
            pushStatus={controller.pushStatus}
            onEnableNotifications={controller.handleEnableNotifications}
          />
        </div>

        {workspaceIdParam && currentWorkspace && (
          <WorkspaceFolderBrowser
            sectionHrefBase="/tasks"
            allWorkspaces={controller.effectiveWorkspaces}
            workspaceChain={currentWorkspaceChain}
            childFolders={childWorkspaceCards}
            currentCounts={{
              notes: countItemsByWorkspaceId(notesForCounter).get(workspaceIdParam) ?? 0,
              tasks: countItemsByWorkspaceId(allTasks).get(workspaceIdParam) ?? 0,
              todos: countItemsByWorkspaceId(todosForCounter).get(workspaceIdParam) ?? 0,
            }}
            activeDragItem={controller.activeDragItem}
            isFolderDropDisabled={controller.isFolderDropDisabled}
          />
        )}

        {workspaceIdParam && currentWorkspace && (
          <section className="rounded-xl border-t border-border/60 pt-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Contenu direct</div>
              <div className="text-xs text-muted-foreground">
                {countItemsByWorkspaceId(allTasks).get(workspaceIdParam) ?? 0} élément
                {(countItemsByWorkspaceId(allTasks).get(workspaceIdParam) ?? 0) > 1 ? "s" : ""}
              </div>
            </div>
          </section>
        )}

        {controller.showMicroGuide && !workspaceIdParam && (
          <AgendaMicroGuide onDismiss={controller.handleDismissMicroGuide} />
        )}

        {loading && (
          <div className="sn-empty sn-animate-in">
            <div className="space-y-3">
              <div className="sn-skeleton-title w-48 mx-auto" />
              <div className="sn-skeleton-line w-72 mx-auto" />
              <div className="sn-skeleton-line w-64 mx-auto" />
            </div>
          </div>
        )}

        {controller.editError && <div className="sn-alert sn-alert--error">{controller.editError}</div>}
        {controller.actionFeedback && <div className="sn-alert" role="status" aria-live="polite">{controller.actionFeedback}</div>}

        {!loading && !error && controller.archiveView === "active" && (controller.activeTasks?.length || 0) === 0 && (controller.completedTasks?.length || 0) === 0 && (
          <AgendaEmptyState
            activeSearchLabel={controller.activeSearchLabel}
            workspaceIdParam={workspaceIdParam}
            onResetFilters={controller.resetFilters}
            toLocalDateInputValue={toLocalDateInputValue}
          />
        )}

        {!loading && !error && controller.archiveView === "archived" && (
          <ArchivedTasksSection
            tasks={controller.filteredTasks.filter(t => t.archived === true)}
            workspaces={controller.effectiveWorkspaces}
            hrefSuffix={hrefSuffix}
            statusLabel={controller.statusLabel}
            priorityLabel={controller.priorityLabel}
            priorityDotClass={controller.priorityDotClass}
            formatDueDate={controller.formatDueDate}
            formatStartDate={controller.formatStartDate}
            restoreArchivedTask={controller.restoreArchivedTask}
          />
        )}

        {!loading && !error && controller.archiveView === "active" && controller.viewMode === "calendar" && (
          <div className="min-h-0 flex-1">
            <AgendaCalendar
              tasks={controller.activeTasks.concat(controller.completedTasks)}
              todos={todosForCounter}
              workspaces={controller.effectiveWorkspaces}
              initialAnchorDate={initialCalendarAnchorDate}
              initialPreferences={controller.calendarInitialPreferences}
              onPreferencesChange={controller.handleAgendaCalendarPreferencesChange}
              createRequest={controller.agendaCreateRequest}
              onCreateRequestHandled={controller.handleAgendaCreateRequestHandled}
              onCreateEvent={controller.handleCalendarCreate}
              onDeleteEvent={controller.handleCalendarDelete}
              hiddenGoogleEventIds={controller.optimisticDeletedGoogleEventIds}
              onUpdateEvent={controller.handleCalendarUpdate}
              onSkipOccurrence={controller.handleSkipOccurrence}
              onVisibleRangeChange={controller.handleCalendarVisibleRangeChange}
              // Filter synchronization
              externalPriorityFilter={controller.priorityFilter}
              onPriorityFilterChange={controller.setPriorityFilter}
            />
          </div>
        )}

        {!loading && !error && controller.archiveView === "active" && controller.viewMode !== "calendar" && (
          <ActiveTasksDisplay
            tasks={controller.activeTasks}
            workspaces={controller.effectiveWorkspaces}
            viewMode={controller.viewMode === "grid" ? "grid" : "list"}
            hrefSuffix={hrefSuffix}
            highlightedTaskId={highlightedTaskId}
            flashHighlightTaskId={controller.flashHighlightTaskId}
            statusLabel={controller.statusLabel}
            priorityLabel={controller.priorityLabel}
            priorityDotClass={controller.priorityDotClass}
            formatDueDate={controller.formatDueDate}
            formatStartDate={controller.formatStartDate}
            toggleFavorite={controller.toggleFavorite}
            toggleDone={controller.toggleDone}
          />
        )}

        {controller.statusFilter === "all" && controller.archiveView === "active" && controller.viewMode !== "calendar" && (
          <CompletedTasksSection
            tasks={controller.completedTasks}
            toggleDone={controller.toggleDone}
          />
        )}
      </div>
    </DndContext>
  );
}
