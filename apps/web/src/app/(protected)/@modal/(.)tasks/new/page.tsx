"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Modal from "../../../Modal";
import TaskCreateForm from "../../../_components/TaskCreateForm";

export default function NewTaskModal() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId") || undefined;

  return (
    <Modal title="Nouvelle tâche">
      <TaskCreateForm initialWorkspaceId={workspaceId} onCreated={() => router.back()} />
    </Modal>
  );
}
