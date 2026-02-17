import { useCallback, useEffect, useRef, type RefObject, type TouchEvent } from "react";
import type FullCalendar from "@fullcalendar/react";

type AgendaDisplayMode = "calendar" | "planning";

type UseAgendaCalendarNavigationParams = {
  calendarRef: RefObject<FullCalendar | null>;
  displayMode: AgendaDisplayMode;
  openQuickDraft: () => void;
  onPlanningJump?: (action: "prev" | "next" | "today") => void;
};

export function useAgendaCalendarNavigation({
  calendarRef,
  displayMode,
  openQuickDraft,
  onPlanningJump,
}: UseAgendaCalendarNavigationParams) {
  const touchStartRef = useRef<{ x: number; y: number; at: number } | null>(null);

  const keepPageScrollStable = useCallback(() => {
    if (typeof window === "undefined") return;
    const lockedY = window.scrollY;
    window.requestAnimationFrame(() => {
      if (Math.abs(window.scrollY - lockedY) > 1) {
        window.scrollTo({ top: lockedY });
      }
    });
  }, []);

  const jump = useCallback(
    (action: "prev" | "next" | "today") => {
      if (displayMode === "planning") {
        onPlanningJump?.(action);
        keepPageScrollStable();
        return;
      }

      const api = calendarRef.current?.getApi();
      if (!api) return;
      if (action === "prev") api.prev();
      if (action === "next") api.next();
      if (action === "today") api.today();
      keepPageScrollStable();
    },
    [calendarRef, displayMode, keepPageScrollStable, onPlanningJump],
  );

  const isSwipeBlockedTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest(
        "button,a,input,select,textarea,[role='button'],[data-no-calendar-swipe],.fc-event,.fc-more-link",
      ),
    );
  };

  const handleCalendarTouchStart = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      if (displayMode !== "calendar") return;
      if (typeof window !== "undefined" && window.innerWidth >= 768) return;
      if (isSwipeBlockedTarget(event.target)) {
        touchStartRef.current = null;
        return;
      }
      if (event.touches.length !== 1) {
        touchStartRef.current = null;
        return;
      }

      const touch = event.touches[0];
      if (!touch) return;
      touchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        at: Date.now(),
      };
    },
    [displayMode],
  );

  const handleCalendarTouchEnd = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      if (displayMode !== "calendar") return;
      if (typeof window !== "undefined" && window.innerWidth >= 768) return;

      const start = touchStartRef.current;
      touchStartRef.current = null;
      if (!start) return;

      const touch = event.changedTouches[0];
      if (!touch) return;

      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      const elapsed = Date.now() - start.at;

      if (elapsed > 650) return;
      if (absX < 64) return;
      if (absX < absY * 1.45) return;

      if (dx < 0) jump("next");
      else jump("prev");
    },
    [displayMode, jump],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isEditing = tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable;
      if (isEditing) return;

      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        openQuickDraft();
        return;
      }

      if (e.key === "/") {
        e.preventDefault();
        const searchInput = document.getElementById("tasks-search-input") as HTMLInputElement | null;
        searchInput?.focus();
        searchInput?.select();
        return;
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        jump("prev");
        return;
      }

      if (e.key === "ArrowRight") {
        e.preventDefault();
        jump("next");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [jump, openQuickDraft]);

  return {
    jump,
    handleCalendarTouchStart,
    handleCalendarTouchEnd,
  };
}
