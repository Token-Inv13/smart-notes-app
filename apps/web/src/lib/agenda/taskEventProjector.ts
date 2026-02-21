import type { TaskDoc } from "@/types/firestore";

export type TaskProjectionReason =
  | "missing_task_id"
  | "missing_dates"
  | "invalid_start"
  | "invalid_due"
  | "invalid_interval";

export type ProjectedTaskEvent = {
  eventId: string;
  taskId: string;
  task: TaskDoc;
  start: Date;
  end: Date;
  allDay: boolean;
  recurrence: TaskDoc["recurrence"] | null;
  instanceDate?: string;
};

export type TaskProjectionExclusion = {
  taskId: string | null;
  reason: TaskProjectionReason;
};

function toLocalDateInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function overlapsRange(start: Date, end: Date, rangeStart: Date, rangeEnd: Date) {
  return end.getTime() > rangeStart.getTime() && start.getTime() < rangeEnd.getTime();
}

function addRecurrenceStep(base: Date, freq: "daily" | "weekly" | "monthly", interval: number) {
  const next = new Date(base);
  if (freq === "daily") next.setDate(next.getDate() + interval);
  else if (freq === "weekly") next.setDate(next.getDate() + interval * 7);
  else next.setMonth(next.getMonth() + interval);
  return next;
}

export function projectTaskToEvent(task: TaskDoc): {
  event: { start: Date; end: Date; allDay: boolean } | null;
  reason?: TaskProjectionReason;
} {
  const startRaw = task.startDate?.toDate?.() ?? null;
  const dueRaw = task.dueDate?.toDate?.() ?? null;

  if (startRaw && Number.isNaN(startRaw.getTime())) return { event: null, reason: "invalid_start" };
  if (dueRaw && Number.isNaN(dueRaw.getTime())) return { event: null, reason: "invalid_due" };

  const start = startRaw ?? dueRaw;
  if (!start) return { event: null, reason: "missing_dates" };

  const explicitAllDay = task.allDay === true;
  if (explicitAllDay) {
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
    const endDay = new Date(startDay.getTime() + 24 * 60 * 60 * 1000);
    return {
      event: {
        start: startDay,
        end: endDay,
        allDay: true,
      },
    };
  }

  const fallbackTimedEnd = new Date(start.getTime() + 60 * 60 * 1000);
  const dueAfterStart = dueRaw && dueRaw.getTime() > start.getTime() ? dueRaw : null;
  const end = dueAfterStart ?? fallbackTimedEnd;

  return {
    event: {
      start,
      end,
      allDay: false,
    },
  };
}

export function projectTasksToEvents(input: {
  tasks: TaskDoc[];
  window: { start: Date; end: Date };
}): {
  events: ProjectedTaskEvent[];
  excluded: TaskProjectionExclusion[];
} {
  const { tasks, window } = input;
  const rangeStart = window.start;
  const rangeEnd = window.end;

  const events: ProjectedTaskEvent[] = [];
  const excluded: TaskProjectionExclusion[] = [];

  for (const task of tasks) {
    const taskId = typeof task.id === "string" && task.id ? task.id : null;
    if (!taskId) {
      excluded.push({ taskId: null, reason: "missing_task_id" });
      continue;
    }

    const projected = projectTaskToEvent(task);
    if (!projected.event) {
      excluded.push({ taskId, reason: projected.reason ?? "missing_dates" });
      continue;
    }

    const { start, end, allDay } = projected.event;
    const recurrence = task.recurrence ?? null;

    if (!recurrence?.freq) {
      if (overlapsRange(start, end, rangeStart, rangeEnd)) {
        events.push({
          eventId: taskId,
          taskId,
          task,
          start,
          end,
          allDay,
          recurrence: null,
        });
      }
      continue;
    }

    const interval = Math.max(1, Number(recurrence.interval ?? 1));
    if (!Number.isFinite(interval)) {
      excluded.push({ taskId, reason: "invalid_interval" });
      continue;
    }

    const until = recurrence.until?.toDate?.() ?? null;
    const exceptions = new Set(Array.isArray(recurrence.exceptions) ? recurrence.exceptions : []);

    let cursorStart = new Date(start);
    let cursorEnd = new Date(end);
    for (let i = 0; i < 400; i += 1) {
      if (until && cursorStart.getTime() > until.getTime()) break;
      if (cursorStart.getTime() > rangeEnd.getTime()) break;

      const instanceDate = toLocalDateInputValue(cursorStart);
      if (!exceptions.has(instanceDate) && overlapsRange(cursorStart, cursorEnd, rangeStart, rangeEnd)) {
        events.push({
          eventId: `${taskId}__${cursorStart.toISOString()}`,
          taskId,
          task,
          start: new Date(cursorStart),
          end: new Date(cursorEnd),
          allDay,
          recurrence,
          instanceDate,
        });
      }

      cursorStart = addRecurrenceStep(cursorStart, recurrence.freq, interval);
      cursorEnd = addRecurrenceStep(cursorEnd, recurrence.freq, interval);
    }
  }

  return { events, excluded };
}
