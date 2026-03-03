import type { EventContentArg } from "@fullcalendar/core";
import type { Priority } from "@/types/firestore";

function formatClock(date: Date) {
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatEventTimeLabel(arg: EventContentArg) {
  const start = arg.event.start;
  const end = arg.event.end;

  if (arg.event.allDay) return "Journee";
  if (!(start instanceof Date)) return arg.timeText || "Horaire";
  if (!(end instanceof Date) || end.getTime() <= start.getTime()) return formatClock(start);
  return `${formatClock(start)}-${formatClock(end)}`;
}

export function renderAgendaCalendarEventContent(arg: EventContentArg, isCompactDensity: boolean) {
  const workspaceName = (arg.event.extendedProps.workspaceName as string) ?? "";
  const workspaceLabel = workspaceName.trim() || "Sans dossier";
  const priority = ((arg.event.extendedProps.priority as Priority | "") ?? "") as "" | Priority;
  const hasConflict = arg.event.extendedProps.conflict === true;
  const conflictSource = (arg.event.extendedProps.conflictSource as "local" | "google" | "mix" | null) ?? null;
  const conflictScore = typeof arg.event.extendedProps.conflictScore === "number" ? arg.event.extendedProps.conflictScore : 0;
  const timeLabel = formatEventTimeLabel(arg);

  const conflictLabel =
    conflictSource === "google"
      ? "Local -> Google"
      : conflictSource === "mix"
        ? "Mixte"
        : "Local";

  const sourceLabel = arg.event.extendedProps.source === "google-calendar" ? "Google" : "LOCAL";
  const start = arg.event.start;
  const end = arg.event.end;
  const durationMinutes =
    start instanceof Date && end instanceof Date ? Math.round((end.getTime() - start.getTime()) / (60 * 1000)) : 60;
  const isMonthView = arg.view.type === "dayGridMonth";
  const isDenseTimeGrid = arg.view.type !== "dayGridMonth" && !arg.event.allDay && durationMinutes <= 45;
  const compactPresentation = isCompactDensity || isDenseTimeGrid;

  if (isMonthView) {
    return (
      <div className="px-1 py-0.5 text-[11px] leading-tight text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]">
        <div className="flex items-center gap-1">
          <span className="break-words font-semibold leading-tight">{arg.event.title}</span>
          {hasConflict && <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-200" aria-hidden />}
        </div>
        <div className="text-[9px] text-white/90">{timeLabel}</div>
      </div>
    );
  }

  return (
    <div className="px-1 py-0.5 text-[11px] leading-tight text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]">
      <div className="break-words font-semibold leading-tight">{arg.event.title}</div>
      <div className="text-[10px] text-white/95">{timeLabel}</div>
      {compactPresentation ? (
        <div className="mt-0.5 inline-flex flex-wrap items-center gap-1 text-[9px] text-white/90">
          <span className="truncate">{workspaceLabel}</span>
          <span className="rounded-full bg-black/25 px-1.5 py-0.5 font-semibold uppercase tracking-wide">{sourceLabel}</span>
          {hasConflict && <span className="rounded-full bg-red-500/85 px-1.5 py-0.5 font-semibold">C P{Math.min(9, conflictScore)}</span>}
        </div>
      ) : (
        <>
          <div className="break-words text-[10px] text-white/90">{workspaceLabel}</div>
          <div className="mt-0.5 inline-flex flex-wrap items-center gap-1">
            <span className="rounded-full bg-black/25 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/95">{sourceLabel}</span>
            {priority && (
              <span className="rounded-full bg-black/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/95">{priority}</span>
            )}
            {hasConflict && (
              <span className="rounded-full bg-red-500/85 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                Conflit {conflictLabel} P{Math.min(9, conflictScore)}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
