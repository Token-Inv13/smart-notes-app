"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Modal from "../../../Modal";
import TaskCreateForm from "../../../_components/TaskCreateForm";

export default function NewTaskModal() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId") || undefined;
  const initialFavorite = searchParams.get("favorite") === "1";

  return (
    <Modal title="Nouvelle tâche">
      <TaskCreateForm initialWorkspaceId={workspaceId} initialFavorite={initialFavorite} onCreated={() => router.back()} />
    </Modal>
  );
}
