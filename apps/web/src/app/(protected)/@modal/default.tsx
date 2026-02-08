"use client";

import { useSearchParams } from "next/navigation";
import NoteDetailModalRoute from "./(.)notes/[id]/page";

export default function Default() {
  const searchParams = useSearchParams();
  const noteId = searchParams.get("noteId");
  const workspaceId = searchParams.get("workspaceId");
  const fullscreen = searchParams.get("fullscreen") === "1";
  const fallbackHref = workspaceId
    ? `/notes?workspaceId=${encodeURIComponent(workspaceId)}`
    : "/notes";

  if (!noteId) return null;

  return (
    <NoteDetailModalRoute
      params={{ id: noteId }}
      fallbackHref={fallbackHref}
      fullscreen={fullscreen}
    />
  );
}
