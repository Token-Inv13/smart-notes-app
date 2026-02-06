"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Modal from "../../../Modal";
import NoteCreateForm from "../../../_components/NoteCreateForm";

export default function NewNoteModal() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId") || undefined;
  const initialFavorite = searchParams.get("favorite") === "1";

  return (
    <Modal title="Nouvelle note">
      <NoteCreateForm initialWorkspaceId={workspaceId} initialFavorite={initialFavorite} onCreated={() => router.back()} />
    </Modal>
  );
}
