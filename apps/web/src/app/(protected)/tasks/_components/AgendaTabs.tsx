"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";

interface AgendaTabsProps {
  hrefSuffix: string;
  activeNoteCount: number;
  visibleTasksCount: number;
  activeTodoCount: number;
}

const AgendaTabs: React.FC<AgendaTabsProps> = ({
  hrefSuffix,
  activeNoteCount,
  visibleTasksCount,
  activeTodoCount,
}) => {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div className="mb-4 max-w-full overflow-x-auto">
      <div className="inline-flex rounded-md border border-border bg-background overflow-hidden whitespace-nowrap">
        <button
          type="button"
          onClick={() => router.push(`/notes${hrefSuffix}`)}
          className={`px-3 py-1 text-sm ${pathname.startsWith("/notes") ? "bg-accent font-semibold" : ""}`}
        >
          Notes ({activeNoteCount})
        </button>
        <button
          type="button"
          onClick={() => router.push(`/tasks${hrefSuffix}`)}
          className={`px-3 py-1 text-sm ${pathname.startsWith("/tasks") ? "bg-accent font-semibold" : ""}`}
        >
          Agenda ({visibleTasksCount})
        </button>
        <button
          type="button"
          onClick={() => router.push(`/todo${hrefSuffix}`)}
          className={`px-3 py-1 text-sm ${pathname.startsWith("/todo") ? "bg-accent font-semibold" : ""}`}
        >
          Checklist ({activeTodoCount})
        </button>
      </div>
    </div>
  );
};

export default AgendaTabs;
