import { useCallback, useEffect, useState } from "react";
import { CALENDAR_FILTERS_STORAGE_KEY } from "./agendaCalendarUtils";
import type { Priority } from "@/types/firestore";

export type CalendarPriorityFilter = "" | Priority;
export type CalendarTimeWindowFilter = "" | "allDay" | "morning" | "afternoon" | "evening";
export type CalendarStatusFilter = "all" | "open" | "done";

type CalendarFilterStorage = {
  showRecurringOnly: boolean;
  showConflictsOnly: boolean;
  priorityFilter: CalendarPriorityFilter;
  timeWindowFilter: CalendarTimeWindowFilter;
  showClassicTasks: boolean;
  showChecklistItems: boolean;
  showGoogleCalendar: boolean;
  statusFilter: CalendarStatusFilter;
};

export function useAgendaCalendarFilters() {
  const [showRecurringOnly, setShowRecurringOnly] = useState(false);
  const [showConflictsOnly, setShowConflictsOnly] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<CalendarPriorityFilter>("");
  const [timeWindowFilter, setTimeWindowFilter] = useState<CalendarTimeWindowFilter>("");
  const [showClassicTasks, setShowClassicTasks] = useState(true);
  const [showChecklistItems, setShowChecklistItems] = useState(true);
  const [showGoogleCalendar, setShowGoogleCalendar] = useState(true);
  const [statusFilter, setStatusFilter] = useState<CalendarStatusFilter>("all");
  const [filtersHydrated, setFiltersHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CALENDAR_FILTERS_STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as Partial<CalendarFilterStorage>;

      if (typeof parsed.showRecurringOnly === "boolean") {
        setShowRecurringOnly(parsed.showRecurringOnly);
      }

      if (typeof parsed.showConflictsOnly === "boolean") {
        setShowConflictsOnly(parsed.showConflictsOnly);
      }

      if (parsed.priorityFilter === "" || parsed.priorityFilter === "low" || parsed.priorityFilter === "medium" || parsed.priorityFilter === "high") {
        setPriorityFilter(parsed.priorityFilter);
      }

      if (
        parsed.timeWindowFilter === "" ||
        parsed.timeWindowFilter === "allDay" ||
        parsed.timeWindowFilter === "morning" ||
        parsed.timeWindowFilter === "afternoon" ||
        parsed.timeWindowFilter === "evening"
      ) {
        setTimeWindowFilter(parsed.timeWindowFilter);
      }

      if (typeof parsed.showClassicTasks === "boolean") {
        setShowClassicTasks(parsed.showClassicTasks);
      }

      if (typeof parsed.showChecklistItems === "boolean") {
        setShowChecklistItems(parsed.showChecklistItems);
      }

      if (typeof parsed.showGoogleCalendar === "boolean") {
        setShowGoogleCalendar(parsed.showGoogleCalendar);
      }

      if (parsed.statusFilter === "all" || parsed.statusFilter === "open" || parsed.statusFilter === "done") {
        setStatusFilter(parsed.statusFilter);
      }
    } catch {
      // ignore invalid persisted payload
    } finally {
      setFiltersHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!filtersHydrated) return;

    const payload: CalendarFilterStorage = {
      showRecurringOnly,
      showConflictsOnly,
      priorityFilter,
      timeWindowFilter,
      showClassicTasks,
      showChecklistItems,
      showGoogleCalendar,
      statusFilter,
    };

    try {
      window.localStorage.setItem(CALENDAR_FILTERS_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage write errors
    }
  }, [
    filtersHydrated,
    priorityFilter,
    showGoogleCalendar,
    showChecklistItems,
    showClassicTasks,
    showConflictsOnly,
    showRecurringOnly,
    statusFilter,
    timeWindowFilter,
  ]);

  const clearFilters = useCallback(() => {
    setShowRecurringOnly(false);
    setShowConflictsOnly(false);
    setPriorityFilter("");
    setTimeWindowFilter("");
    setShowClassicTasks(true);
    setShowChecklistItems(true);
    setShowGoogleCalendar(true);
    setStatusFilter("all");
  }, []);

  return {
    showRecurringOnly,
    setShowRecurringOnly,
    showConflictsOnly,
    setShowConflictsOnly,
    priorityFilter,
    setPriorityFilter,
    timeWindowFilter,
    setTimeWindowFilter,
    showClassicTasks,
    setShowClassicTasks,
    showChecklistItems,
    setShowChecklistItems,
    showGoogleCalendar,
    setShowGoogleCalendar,
    statusFilter,
    setStatusFilter,
    clearFilters,
  };
}
