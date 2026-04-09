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
import { DraggableCard } from "../_components/folderDnd";
import WorkspaceFolderBrowser from "../_components/WorkspaceFolderBrowser";
import {
  countItemsByWorkspaceId,
  getWorkspaceChain,
} from "@/lib/workspaces";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import AgendaActionBar from "../_components/AgendaActionBar";
import AgendaFilterDialog from "./_components/AgendaFilterDialog";
import AgendaNotificationPrompt from "./_components/AgendaNotificationPrompt";
import { useAgendaController } from "./_hooks/useAgendaController";

const AgendaCalendar = dynamic(() => import("../_components/AgendaCalendar"), {
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

  const tabs = (
    <div className="mb-4 max-w-full overflow-x-auto">
      <div className="inline-flex rounded-md border border-border bg-background overflow-hidden whitespace-nowrap">
        <button
          type="button"
          onClick={() => router.push(`/notes${hrefSuffix}`)}
          className={`px-3 py-1 text-sm ${pathname.startsWith("/notes") ? "bg-accent font-semibold" : ""}`}
        >
          Notes ({controller.activeNoteCount})
        </button>
        <button
          type="button"
          onClick={() => router.push(`/tasks${hrefSuffix}`)}
          className={`px-3 py-1 text-sm ${pathname.startsWith("/tasks") ? "bg-accent font-semibold" : ""}`}
        >
          Agenda ({controller.visibleTasksCount})
        </button>
        <button
          type="button"
          onClick={() => router.push(`/todo${hrefSuffix}`)}
          className={`px-3 py-1 text-sm ${pathname.startsWith("/todo") ? "bg-accent font-semibold" : ""}`}
        >
          Checklist ({controller.activeTodoCount})
        </button>
      </div>
    </div>
  );

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
        {workspaceIdParam && tabs}
        <header className={isCalendarView ? "flex flex-col gap-1.5 mb-1 md:mb-1" : "flex flex-col gap-2 mb-2 md:mb-2"}>
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-xl font-semibold">Agenda</h1>
          </div>

          <div className="w-full" {...archiveTabsSwipeHandlers}>
            <AgendaActionBar
              archiveView={controller.archiveView}
              viewMode={controller.viewMode}
              onArchiveViewChange={controller.setArchiveView}
              onViewModeChange={controller.applyViewMode}
              searchValue={controller.searchInput}
              onSearchChange={controller.setSearchInput}
              onFilterToggle={() => controller.setFiltersOpen(true)}
              trailingSlot={<div id="sn-create-slot" data-task-view-mode={controller.viewMode} />}
            />
          </div>

          {controller.activeSearchLabel && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="sn-badge">Recherche: “{controller.activeSearchLabel}”</span>
              <span className="sn-badge">Résultats: {controller.filteredTasks.length}</span>
            </div>
          )}

          <AgendaFilterDialog
            isOpen={controller.filtersOpen}
            onClose={() => controller.setFiltersOpen(false)}
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
            onReset={controller.resetFilters}
          />

          <AgendaNotificationPrompt
            permission={notificationPermission}
            enablingPush={controller.enablingPush}
            pushStatus={controller.pushStatus}
            onEnable={controller.handleEnableNotifications}
          />
        </header>

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
          <div>
            <div className="sn-card sn-card--muted p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">Astuce</div>
                  <div className="text-sm text-muted-foreground">
                    Ajoute un titre simple, puis un rappel si besoin. Tu peux épingler l’essentiel en favori ⭐.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={controller.handleDismissMicroGuide}
                  className="sn-text-btn shrink-0"
                >
                  Compris
                </button>
              </div>
            </div>
          </div>
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

      {!loading && !error && controller.archiveView === "active" && controller.activeTasks.length === 0 && controller.completedTasks.length === 0 && (
        <div className="sn-empty sn-empty--premium sn-animate-in">
          <div className="sn-empty-title">
            {controller.activeSearchLabel ? "Aucun résultat" : workspaceIdParam ? "Aucun élément direct dans ce dossier" : "Aucun élément d’agenda pour le moment"}
          </div>
          <div className="sn-empty-desc">
            {controller.activeSearchLabel
              ? `Aucun element ne correspond a "${controller.activeSearchLabel}" avec les filtres actuels.`
              : workspaceIdParam
                ? "Ajoute un élément ici ou ouvre un sous-dossier."
                : "Commence par ajouter un élément à l’agenda."}
          </div>
          {controller.activeSearchLabel ? (
            <div className="mt-3">
              <button
                type="button"
                onClick={controller.resetFilters}
                className="inline-flex items-center justify-center h-10 px-4 rounded-md border border-border bg-background text-sm font-medium hover:bg-accent/60"
              >
                Réinitialiser les filtres
              </button>
            </div>
          ) : (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => {
                  const params = new URLSearchParams();
                  if (workspaceIdParam) params.set("workspaceId", workspaceIdParam);
                  params.set("create", "1");
                  params.set("startDate", toLocalDateInputValue(new Date()));
                  router.push(`/tasks?${params.toString()}`);
                }}
                className="inline-flex items-center justify-center h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-95 transition-opacity"
              >
                Créer une tâche
              </button>
            </div>
          )}
        </div>
      )}

      {!loading && !error && controller.archiveView === "archived" && (
        <ul className="space-y-2">
          {controller.filteredTasks.filter(t => t.archived === true).map((task) => {
            const status = (task.status as any) || "todo";
            const workspaceName = controller.effectiveWorkspaces.find((ws) => ws.id === task.workspaceId)?.name ?? "—";
            const dueLabel = controller.formatDueDate(task.dueDate ?? null);
            const startLabel = controller.formatStartDate(task.startDate ?? null);

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
                        <span className="sn-badge">{controller.statusLabel(status)}</span>
                        {startLabel && <span className="sn-badge">Début: {startLabel}</span>}
                        {dueLabel && <span className="sn-badge">Échéance: {dueLabel}</span>}
                        {task.priority && (
                          <span className="sn-badge inline-flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${controller.priorityDotClass(task.priority)}`} />
                            <span>Priorité: {controller.priorityLabel(task.priority)}</span>
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
                          controller.restoreArchivedTask(task);
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
          />
        </div>
      )}

      {!loading && !error && controller.archiveView === "active" && controller.viewMode === "list" && controller.activeTasks.length > 0 && (
        <ul className="space-y-2">
          {controller.activeTasks.map((task) => {
            const status = (task.status as any) || "todo";
            const workspaceName = controller.effectiveWorkspaces.find((ws) => ws.id === task.workspaceId)?.name ?? "—";
            const dueLabel = controller.formatDueDate(task.dueDate ?? null);
            const startLabel = controller.formatStartDate(task.startDate ?? null);

            return (
              <li key={task.id} id={`task-${task.id}`}>
                <DraggableCard dragData={{ kind: "task", id: task.id ?? "", workspaceId: task.workspaceId }}>
                  {({ dragHandle }) => (
                    <div
                      className={`sn-card sn-card--task ${task.favorite ? " sn-card--favorite" : ""} p-4 ${
                        task.id === highlightedTaskId ? (controller.flashHighlightTaskId === task.id ? "sn-highlight-soft" : "border-primary") : ""
                      }`}
                      onClick={() => task.id && router.push(`/tasks/${task.id}${hrefSuffix}`)}
                    >
                      <div className="space-y-3">
                        <div className="sn-card-header">
                          <div className="min-w-0">
                            <div className="sn-card-title truncate">{normalizeDisplayText(task.title)}</div>
                            <div className="sn-card-meta">
                              <span className="sn-badge">{normalizeDisplayText(workspaceName)}</span>
                              <span className="sn-badge">{controller.statusLabel(status)}</span>
                              {startLabel && <span className="sn-badge">Début: {startLabel}</span>}
                              {dueLabel && <span className="sn-badge">Échéance: {dueLabel}</span>}
                              {task.priority && (
                                <span className="sn-badge inline-flex items-center gap-2">
                                  <span className={`h-2 w-2 rounded-full ${controller.priorityDotClass(task.priority)}`} />
                                  <span>Priorité: {controller.priorityLabel(task.priority)}</span>
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
                                controller.toggleFavorite(task);
                              }}
                              className="sn-icon-btn"
                            >
                              {task.favorite ? "★" : "☆"}
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <label className="text-xs flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={status === "done"}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => controller.toggleDone(task, e.target.checked)}
                            />
                            <span className="text-muted-foreground">Terminé</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  )}
                </DraggableCard>
              </li>
            );
          })}
        </ul>
      )}

      {!loading && !error && controller.archiveView === "active" && controller.viewMode === "grid" && controller.activeTasks.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {controller.activeTasks.map((task) => {
            const status = (task.status as any) || "todo";
            const workspaceName = controller.effectiveWorkspaces.find((ws) => ws.id === task.workspaceId)?.name ?? "—";
            const dueLabel = controller.formatDueDate(task.dueDate ?? null);
            const startLabel = controller.formatStartDate(task.startDate ?? null);

            return (
              <div
                key={task.id}
                className={`sn-card sn-card--task ${task.favorite ? " sn-card--favorite" : ""} p-4 ${
                  task.id === highlightedTaskId ? (controller.flashHighlightTaskId === task.id ? "sn-highlight-soft" : "border-primary") : ""
                }`}
                onClick={() => task.id && router.push(`/tasks/${task.id}${hrefSuffix}`)}
              >
                <div className="flex flex-col gap-3">
                  <div className="sn-card-header">
                    <div className="min-w-0">
                      <div className="sn-card-title line-clamp-2">{normalizeDisplayText(task.title)}</div>
                      <div className="sn-card-meta">
                        <span className="sn-badge">{normalizeDisplayText(workspaceName)}</span>
                        <span className="sn-badge">{controller.statusLabel(status)}</span>
                        {startLabel && <span className="sn-badge">Début: {startLabel}</span>}
                        {dueLabel && <span className="sn-badge">Échéance: {dueLabel}</span>}
                        {task.priority && (
                          <span className="sn-badge inline-flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${controller.priorityDotClass(task.priority)}`} />
                            <span>Priorité: {controller.priorityLabel(task.priority)}</span>
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="sn-card-actions shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          controller.toggleFavorite(task);
                        }}
                        className="sn-icon-btn"
                      >
                        {task.favorite ? "★" : "☆"}
                      </button>
                    </div>
                  </div>
                  <div className="mt-auto">
                    <label className="text-xs flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={status === "done"}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => controller.toggleDone(task, e.target.checked)}
                    />
                    <span className="text-muted-foreground">Terminé</span>
                    </label>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {controller.completedTasks.length > 0 && controller.statusFilter === "all" && controller.archiveView === "active" && controller.viewMode !== "calendar" && (
        <section>
          <h2 className="text-lg font-semibold mt-6 mb-2">Terminées</h2>
          <ul className="space-y-2">
            {controller.completedTasks.map((task) => (
              <li key={task.id} className="sn-card sn-card--task sn-card--muted p-4">
                <div className="sn-card-header">
                  <div className="min-w-0">
                    <div className="sn-card-title truncate">{normalizeDisplayText(task.title)}</div>
                    <div className="sn-card-meta"><span className="sn-badge">Terminée</span></div>
                  </div>
                  <div className="sn-card-actions">
                    <button type="button" onClick={() => controller.toggleDone(task, false)} className="sn-text-btn">
                      Restaurer
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      </div>
    </DndContext>
  );
}
