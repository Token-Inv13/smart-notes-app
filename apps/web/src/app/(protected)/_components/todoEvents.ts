export const TODO_CREATE_EVENT = "sn:create-todo";

export type TodoPlusMode = "create" | "add_item";

export function dispatchCreateTodoEvent(mode: TodoPlusMode = "create") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TODO_CREATE_EVENT, { detail: { mode } }));
}
