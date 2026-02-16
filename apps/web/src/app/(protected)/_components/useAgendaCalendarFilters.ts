import { useCallback, useEffect, useState } from "react";
import { CALENDAR_FILTERS_STORAGE_KEY } from "./agendaCalendarUtils";
import type { Priority } from "@/types/firestore";

export type CalendarPriorityFilter = "" | Priority;
export type CalendarTimeWindowFilter = "" | "allDay" | "morning" | "afternoon" | "evening";

type CalendarFilterStorage = {
  showRecurringOnly: boolean;
  showConflictsOnly: boolean;
  priorityFilter: CalendarPriorityFilter;
  timeWindowFilter: CalendarTimeWindowFilter;
};

export function useAgendaCalendarFilters() {
  const [showRecurringOnly, setShowRecurringOnly] = useState(false);
  const [showConflictsOnly, setShowConflictsOnly] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<CalendarPriorityFilter>("");
  const [timeWindowFilter, setTimeWindowFilter] = useState<CalendarTimeWindowFilter>("");
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
    };

    try {
      window.localStorage.setItem(CALENDAR_FILTERS_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage write errors
    }
  }, [filtersHydrated, priorityFilter, showConflictsOnly, showRecurringOnly, timeWindowFilter]);

  const clearFilters = useCallback(() => {
    setShowRecurringOnly(false);
    setShowConflictsOnly(false);
    setPriorityFilter("");
    setTimeWindowFilter("");
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
    clearFilters,
  };
}
