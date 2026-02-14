"use client";

import { useSearchParams } from "next/navigation";
import NoteDetailModalRoute from "./(.)notes/[id]/page";

export default function Default() {
  const searchParams = useSearchParams();
  const noteId = searchParams.get("noteId");

  if (!noteId) return null;

  return (
    <NoteDetailModalRoute
      params={Promise.resolve({ id: noteId })}
    />
  );
}
