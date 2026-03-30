import type { EventContentArg } from "@fullcalendar/core";
import type { Priority } from "@/types/firestore";

export function renderAgendaCalendarEventContent(arg: EventContentArg, isCompactDensity: boolean) {
  const workspaceName = (arg.event.extendedProps.workspaceName as string) ?? "";
  const priority = ((arg.event.extendedProps.priority as Priority | "") ?? "") as "" | Priority;
  const calendarKind = (arg.event.extendedProps.calendarKind as "task" | "birthday" | null) ?? "task";
  const source = (arg.event.extendedProps.source as "google-calendar" | "holiday" | undefined) ?? undefined;
  const hasConflict = arg.event.extendedProps.conflict === true;
  const conflictSource = (arg.event.extendedProps.conflictSource as "local" | "google" | "mix" | null) ?? null;
  const conflictScore = typeof arg.event.extendedProps.conflictScore === "number" ? arg.event.extendedProps.conflictScore : 0;

  const conflictLabel =
    conflictSource === "google"
      ? "Local \u2194 Google"
      : conflictSource === "mix"
        ? "Mixte"
        : "Local";

  const sourceLabel = source === "google-calendar" ? "Google" : source === "holiday" ? "F\u00e9ri\u00e9" : "Local";
  const fromChecklist = arg.event.extendedProps.sourceType === "checklist_item";
  const fromTodoChecklist = arg.event.extendedProps.todoEvent === true;
  const isBirthday = calendarKind === "birthday";
  const isHoliday = source === "holiday";
  const isRecurring = Boolean(arg.event.extendedProps.recurrence?.freq);
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
        <div className="flex items-center gap-1.5">
          {isHoliday && <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-slate-200" aria-hidden />}
          {isBirthday && <span className="inline-block shrink-0 text-[10px]" aria-hidden>{"\u{1F382}"}</span>}
          {fromChecklist && <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-200" aria-hidden />}
          {fromTodoChecklist && <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-200" aria-hidden />}
          {isRecurring && <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-sky-200" aria-hidden />}
          <span className="truncate font-semibold">{arg.event.title}</span>
          {hasConflict && <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-200" aria-hidden />}
        </div>
      </div>
    );
  }

  return (
    <div className="px-1 py-0.5 text-[11px] leading-tight text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]">
      <div className="font-semibold truncate">{arg.event.title}</div>
      {compactPresentation ? (
        <div className="mt-0.5 inline-flex items-center gap-1 text-[9px] text-white/90">
          <span className="rounded-full bg-black/25 px-1.5 py-0.5 font-semibold uppercase tracking-wide">
            {sourceLabel === "Google" ? "G" : sourceLabel === "F\u00e9ri\u00e9" ? "F" : "L"}
          </span>
          {isHoliday && <span className="rounded-full bg-slate-500/85 px-1.5 py-0.5 font-semibold">F\u00e9ri\u00e9</span>}
          {isBirthday && <span className="rounded-full bg-pink-500/85 px-1.5 py-0.5 font-semibold">{"\u{1F382}"}</span>}
          {isRecurring && <span className="rounded-full bg-sky-500/85 px-1.5 py-0.5 font-semibold">Rec</span>}
          {fromChecklist && <span className="rounded-full bg-emerald-500/80 px-1.5 py-0.5 font-semibold">Checklist</span>}
          {fromTodoChecklist && <span className="rounded-full bg-cyan-500/80 px-1.5 py-0.5 font-semibold">Checklist</span>}
          {hasConflict && <span className="rounded-full bg-red-500/85 px-1.5 py-0.5 font-semibold">C \u00b7 P{Math.min(9, conflictScore)}</span>}
        </div>
      ) : (
        <>
          <div className="truncate text-white/90">{workspaceName}</div>
          <div className="mt-0.5 inline-flex flex-wrap items-center gap-1">
            <span className="rounded-full bg-black/25 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/95">{sourceLabel}</span>
            {isHoliday && (
              <span className="rounded-full bg-slate-500/85 px-1.5 py-0.5 text-[9px] font-semibold text-white">Jour f\u00e9ri\u00e9</span>
            )}
            {isBirthday && (
              <span className="rounded-full bg-pink-500/85 px-1.5 py-0.5 text-[9px] font-semibold text-white">{"\u{1F382}"} Anniversaire</span>
            )}
            {isRecurring && (
              <span className="rounded-full bg-sky-500/85 px-1.5 py-0.5 text-[9px] font-semibold text-white">R\u00e9current</span>
            )}
            {fromChecklist && (
              <span className="rounded-full bg-emerald-500/80 px-1.5 py-0.5 text-[9px] font-semibold text-white">Checklist</span>
            )}
            {fromTodoChecklist && (
              <span className="rounded-full bg-cyan-500/80 px-1.5 py-0.5 text-[9px] font-semibold text-white">Checklist</span>
            )}
            {priority && (
              <span className="rounded-full bg-black/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/95">{priority}</span>
            )}
            {hasConflict && (
              <span className="rounded-full bg-red-500/85 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                Conflit {conflictLabel} \u00b7 P{Math.min(9, conflictScore)}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
