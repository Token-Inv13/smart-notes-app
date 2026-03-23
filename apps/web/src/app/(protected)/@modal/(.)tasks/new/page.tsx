"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Modal from "../../../Modal";
import TaskCreateForm from "../../../_components/TaskCreateForm";
import { TASK_MODAL_CREATE_TITLE } from "../../../_components/taskModalLabels";

export default function NewTaskModal() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId") || undefined;
  const initialFavorite = searchParams.get("favorite") === "1";
  const initialStartDate = searchParams.get("startDate") || undefined;

  return (
    <Modal title={TASK_MODAL_CREATE_TITLE}>
      <TaskCreateForm
        initialWorkspaceId={workspaceId}
        initialFavorite={initialFavorite}
        initialStartDate={initialStartDate}
        onCreated={() => router.back()}
      />
    </Modal>
  );
}
