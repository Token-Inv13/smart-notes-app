"use client";

import { useCallback, useEffect, useState } from "react";
import { CALENDAR_FILTERS_STORAGE_KEY } from "./agendaCalendarUtils";
import type { Priority } from "@/types/firestore";

export type CalendarPriorityFilter = "" | Priority;
export type CalendarTimeWindowFilter = "" | "allDay" | "morning" | "afternoon" | "evening";

type CalendarFilterStorage = {
  priorityFilter: CalendarPriorityFilter;
  timeWindowFilter: CalendarTimeWindowFilter;
};

export function useAgendaCalendarFilters() {
  const [priorityFilter, setPriorityFilter] = useState<CalendarPriorityFilter>("");
  const [timeWindowFilter, setTimeWindowFilter] = useState<CalendarTimeWindowFilter>("");
  const [filtersHydrated, setFiltersHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CALENDAR_FILTERS_STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as Partial<CalendarFilterStorage>;

      if (
        parsed.priorityFilter === "" ||
        parsed.priorityFilter === "low" ||
        parsed.priorityFilter === "medium" ||
        parsed.priorityFilter === "high"
      ) {
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
      priorityFilter,
      timeWindowFilter,
    };

    try {
      window.localStorage.setItem(CALENDAR_FILTERS_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage write errors
    }
  }, [filtersHydrated, priorityFilter, timeWindowFilter]);

  const clearFilters = useCallback(() => {
    setPriorityFilter("");
    setTimeWindowFilter("");
  }, []);

  return {
    priorityFilter,
    setPriorityFilter,
    timeWindowFilter,
    setTimeWindowFilter,
    clearFilters,
  };
}
