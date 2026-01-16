export const TODO_CREATE_EVENT = "sn:create-todo";

export function dispatchCreateTodoEvent() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TODO_CREATE_EVENT));
}
