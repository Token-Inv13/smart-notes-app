import { useCallback, useEffect, useState } from "react";
import type { EventInput } from "@fullcalendar/core";
import type { Priority } from "@/types/firestore";
import { toUserErrorMessage } from "@/lib/userError";

type AgendaDisplayMode = "calendar" | "planning";

type CreateEventInput = {
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  workspaceId?: string | null;
  priority?: Priority | null;
  recurrence?: {
    freq: "daily" | "weekly" | "monthly";
    interval?: number;
    until?: Date | null;
    exceptions?: string[];
  } | null;
};

type UseAgendaPlanningSelectionParams = {
  displayMode: AgendaDisplayMode;
  planningEventMap: Map<string, EventInput>;
  onCreateEvent: (input: CreateEventInput) => Promise<void>;
  setError: (value: string | null) => void;
};

export function useAgendaPlanningSelection({
  displayMode,
  planningEventMap,
  onCreateEvent,
  setError,
}: UseAgendaPlanningSelectionParams) {
  const [selectedPlanningIds, setSelectedPlanningIds] = useState<string[]>([]);
  const [duplicatingPlanning, setDuplicatingPlanning] = useState(false);
  const [planningDuplicateDate, setPlanningDuplicateDate] = useState("");

  useEffect(() => {
    if (displayMode === "calendar" && selectedPlanningIds.length > 0) {
      setSelectedPlanningIds([]);
    }
  }, [displayMode, selectedPlanningIds.length]);

  const togglePlanningSelection = useCallback((eventId: string) => {
    setSelectedPlanningIds((prev) =>
      prev.includes(eventId) ? prev.filter((id) => id !== eventId) : [...prev, eventId],
    );
  }, []);

  const duplicatePlanningSelectionByShift = useCallback(
    async (buildShiftDays: (eventStart: Date, anchorStart: Date) => number) => {
      if (selectedPlanningIds.length === 0) return;

      const selectedEvents = selectedPlanningIds
        .map((id) => planningEventMap.get(id))
        .filter((event): event is EventInput => Boolean(event))
        .map((event) => {
          const start = event.start instanceof Date ? event.start : null;
          const end = event.end instanceof Date ? event.end : null;
          if (!start || !end) return null;
          return { event, start, end };
        })
        .filter((item): item is { event: EventInput; start: Date; end: Date } => Boolean(item))
        .sort((a, b) => a.start.getTime() - b.start.getTime());

      if (selectedEvents.length === 0) return;

      const firstSelected = selectedEvents[0];
      if (!firstSelected) return;
      const anchorStart = new Date(
        firstSelected.start.getFullYear(),
        firstSelected.start.getMonth(),
        firstSelected.start.getDate(),
      );

      setDuplicatingPlanning(true);
      setError(null);
      try {
        for (const { event: source, start, end } of selectedEvents) {
          const shiftDays = buildShiftDays(start, anchorStart);

          const nextStart = new Date(start);
          nextStart.setDate(nextStart.getDate() + shiftDays);
          const nextEnd = new Date(end);
          nextEnd.setDate(nextEnd.getDate() + shiftDays);

          await onCreateEvent({
            title: source.title ?? "Élément agenda",
            start: nextStart,
            end: nextEnd,
            allDay: source.allDay === true,
            workspaceId:
              typeof source.extendedProps?.workspaceId === "string" && source.extendedProps.workspaceId
                ? source.extendedProps.workspaceId
                : null,
            priority:
              source.extendedProps?.priority === "low" ||
              source.extendedProps?.priority === "medium" ||
              source.extendedProps?.priority === "high"
                ? (source.extendedProps.priority as Priority)
                : null,
            recurrence: null,
          });
        }

        setSelectedPlanningIds([]);
      } catch (e) {
        setError(toUserErrorMessage(e, "Impossible de dupliquer la sélection."));
      } finally {
        setDuplicatingPlanning(false);
      }
    },
    [onCreateEvent, planningEventMap, selectedPlanningIds, setError],
  );

  const duplicatePlanningSelectionByDays = useCallback(
    async (days: number) => {
      await duplicatePlanningSelectionByShift(() => days);
    },
    [duplicatePlanningSelectionByShift],
  );

  const duplicatePlanningSelectionToDate = useCallback(async () => {
    if (!planningDuplicateDate) return;
    const target = new Date(`${planningDuplicateDate}T00:00:00`);
    if (Number.isNaN(target.getTime())) {
      setError("Date cible invalide.");
      return;
    }

    await duplicatePlanningSelectionByShift((eventStart, anchorStart) => {
      const eventDay = new Date(eventStart.getFullYear(), eventStart.getMonth(), eventStart.getDate());
      const relativeDays = Math.round((eventDay.getTime() - anchorStart.getTime()) / (24 * 60 * 60 * 1000));
      const anchorToTargetDays = Math.round((target.getTime() - anchorStart.getTime()) / (24 * 60 * 60 * 1000));
      return anchorToTargetDays + relativeDays;
    });
  }, [duplicatePlanningSelectionByShift, planningDuplicateDate, setError]);

  return {
    selectedPlanningIds,
    setSelectedPlanningIds,
    duplicatingPlanning,
    planningDuplicateDate,
    setPlanningDuplicateDate,
    togglePlanningSelection,
    duplicatePlanningSelectionByDays,
    duplicatePlanningSelectionToDate,
  };
}
