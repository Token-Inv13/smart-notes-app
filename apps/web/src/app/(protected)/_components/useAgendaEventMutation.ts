import { useCallback } from "react";
import type { Priority, TaskDoc, TaskRecurrenceFreq } from "@/types/firestore";

type CalendarRecurrenceInput = {
  freq: TaskRecurrenceFreq;
  interval?: number;
  until?: Date | null;
  exceptions?: string[];
} | null;

export interface CalendarMutationArg {
  event: {
    id: string;
    start: Date | null;
    end: Date | null;
    allDay: boolean;
    extendedProps: Record<string, unknown>;
  };
  revert: () => void;
}

type UseAgendaEventMutationParams = {
  onCreateEvent: (input: {
    title: string;
    start: Date;
    end: Date;
    allDay: boolean;
    workspaceId?: string | null;
    priority?: Priority | null;
    recurrence?: CalendarRecurrenceInput;
  }) => Promise<void>;
  onUpdateEvent: (input: {
    taskId: string;
    title?: string;
    start: Date;
    end: Date;
    allDay: boolean;
    workspaceId?: string | null;
    priority?: Priority | null;
    recurrence?: CalendarRecurrenceInput;
  }) => Promise<void>;
  onSkipOccurrence?: (taskId: string, occurrenceDate: string) => Promise<void>;
  setError: (value: string | null) => void;
};

export function useAgendaEventMutation({
  onCreateEvent,
  onUpdateEvent,
  onSkipOccurrence,
  setError,
}: UseAgendaEventMutationParams) {
  const handleMoveOrResize = useCallback(
    async (arg: CalendarMutationArg) => {
      try {
        const start = arg.event.start;
        const end =
          arg.event.end ??
          (start
            ? new Date(start.getTime() + (arg.event.allDay ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000))
            : null);
        const taskId = ((arg.event.extendedProps.taskId as string) || arg.event.id) as string;
        const instanceDate = (arg.event.extendedProps.instanceDate as string | undefined) ?? undefined;
        const recurrence = (arg.event.extendedProps.recurrence as TaskDoc["recurrence"] | null) ?? null;
        if (!taskId || !start || !end) {
          arg.revert();
          return;
        }

        if (instanceDate && recurrence?.freq) {
          if (!onSkipOccurrence) {
            arg.revert();
            setError("Impossible de modifier cette occurrence pour le moment.");
            return;
          }

          await onSkipOccurrence(taskId, instanceDate);
          await onCreateEvent({
            title:
              typeof arg.event.extendedProps.title === "string"
                ? (arg.event.extendedProps.title as string)
                : "Occurrence",
            start,
            end,
            allDay: arg.event.allDay,
            workspaceId: (arg.event.extendedProps.workspaceId as string) || null,
            priority: (arg.event.extendedProps.priority as Priority | "") || null,
            recurrence: null,
          });
          return;
        }

        await onUpdateEvent({
          taskId,
          start,
          end,
          allDay: arg.event.allDay,
          workspaceId: (arg.event.extendedProps.workspaceId as string) || null,
          priority: (arg.event.extendedProps.priority as Priority | "") || null,
          recurrence: (() => {
            const rec = (arg.event.extendedProps.recurrence as TaskDoc["recurrence"] | null) ?? null;
            if (!rec?.freq) return null;
            return {
              freq: rec.freq,
              interval: rec.interval ?? 1,
              until: rec.until?.toDate ? rec.until.toDate() : null,
              exceptions: Array.isArray(rec.exceptions) ? rec.exceptions : [],
            };
          })(),
        });
      } catch {
        arg.revert();
        setError("Impossible de déplacer/redimensionner cet élément d’agenda.");
      }
    },
    [onCreateEvent, onSkipOccurrence, onUpdateEvent, setError],
  );

  return {
    handleMoveOrResize,
  };
}
