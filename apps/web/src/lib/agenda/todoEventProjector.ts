import type { TodoDoc } from "@/types/firestore";

export type ProjectedTodoAgendaEvent = {
  eventId: string;
  todoId: string;
  todo: TodoDoc;
  start: Date;
  end: Date;
  allDay: boolean;
};

function overlapsRange(start: Date, end: Date, rangeStart: Date, rangeEnd: Date) {
  return end.getTime() > rangeStart.getTime() && start.getTime() < rangeEnd.getTime();
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function projectTodosToAgendaEvents(input: {
  todos: TodoDoc[];
  window: { start: Date; end: Date };
}): ProjectedTodoAgendaEvent[] {
  const { todos, window } = input;
  const rangeStart = window.start;
  const rangeEnd = window.end;

  if (
    Number.isNaN(rangeStart.getTime()) ||
    Number.isNaN(rangeEnd.getTime()) ||
    rangeEnd.getTime() <= rangeStart.getTime()
  ) {
    return [];
  }

  const events: ProjectedTodoAgendaEvent[] = [];

  for (const todo of todos) {
    const todoId = typeof todo.id === "string" && todo.id ? todo.id : null;
    if (!todoId) continue;
    if (todo.completed === true) continue;

    const dueRaw = todo.dueDate?.toDate?.() ?? null;
    if (!dueRaw || Number.isNaN(dueRaw.getTime())) continue;

    const start = startOfLocalDay(dueRaw);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    if (!overlapsRange(start, end, rangeStart, rangeEnd)) continue;

    events.push({
      eventId: `todo__${todoId}`,
      todoId,
      todo,
      start,
      end,
      allDay: true,
    });
  }

  return events;
}
