"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Modal from "../../../Modal";
import TodoCreateForm from "../../../_components/TodoCreateForm";

export default function NewTodoModal() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId") || undefined;

  return (
    <Modal title="Nouvelle ToDo">
      <TodoCreateForm
        initialWorkspaceId={workspaceId}
        autoFocus
        showActions
        onCancel={() => router.back()}
        onCreated={(_todoId) => router.back()}
      />
    </Modal>
  );
}
