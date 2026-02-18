"use client";

import { useCallback, useRef, type TouchEventHandler, type WheelEventHandler } from "react";

type SwipeDirection = "left" | "right";

interface SwipeStart {
  x: number;
  y: number;
  scrollLeft: number;
}

interface UseSwipeNavigationOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  disabled?: boolean;
  ignoreInteractiveTargets?: boolean;
  minDistancePx?: number;
  minWheelDistancePx?: number;
  maxScrollDeltaPx?: number;
}

interface SwipeHandlers<T extends HTMLElement> {
  onTouchStart: TouchEventHandler<T>;
  onTouchEnd: TouchEventHandler<T>;
  onTouchCancel: TouchEventHandler<T>;
  onWheel: WheelEventHandler<T>;
}

export function useSwipeNavigation<T extends HTMLElement = HTMLDivElement>(
  opts: UseSwipeNavigationOptions,
): SwipeHandlers<T> {
  const {
    onSwipeLeft,
    onSwipeRight,
    disabled = false,
    ignoreInteractiveTargets = false,
    minDistancePx = 60,
    minWheelDistancePx = 80,
    maxScrollDeltaPx = 20,
  } = opts;

  const shouldIgnoreTarget = useCallback(
    (target: EventTarget | null) => {
      if (!ignoreInteractiveTargets) return false;
      if (!(target instanceof Element)) return false;

      return Boolean(
        target.closest(
          [
            "input",
            "textarea",
            "select",
            "option",
            "button",
            "a",
            "label",
            "summary",
            "[contenteditable='true']",
            "[role='button']",
            "[role='link']",
            "[role='checkbox']",
            "[role='radio']",
            "[role='switch']",
            "[role='slider']",
            "[draggable='true']",
            "[data-no-swipe='true']",
          ].join(","),
        ),
      );
    },
    [ignoreInteractiveTargets],
  );

  const startRef = useRef<SwipeStart | null>(null);
  const wheelAccumRef = useRef(0);
  const wheelSignRef = useRef<1 | -1 | 0>(0);
  const wheelResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetWheel = useCallback(() => {
    wheelAccumRef.current = 0;
    wheelSignRef.current = 0;
    if (wheelResetTimerRef.current) {
      clearTimeout(wheelResetTimerRef.current);
      wheelResetTimerRef.current = null;
    }
  }, []);

  const fire = useCallback(
    (dir: SwipeDirection) => {
      if (disabled) return;
      if (dir === "left") onSwipeLeft?.();
      else onSwipeRight?.();
    },
    [disabled, onSwipeLeft, onSwipeRight],
  );

  const onTouchStart = useCallback<TouchEventHandler<T>>(
    (e) => {
      if (disabled) return;
      if (shouldIgnoreTarget(e.target)) return;
      const t = e.touches[0];
      if (!t) return;
      startRef.current = {
        x: t.clientX,
        y: t.clientY,
        scrollLeft: (e.currentTarget as unknown as HTMLElement).scrollLeft ?? 0,
      };
    },
    [disabled, shouldIgnoreTarget],
  );

  const onTouchCancel = useCallback<TouchEventHandler<T>>(() => {
    startRef.current = null;
  }, []);

  const onTouchEnd = useCallback<TouchEventHandler<T>>(
    (e) => {
      if (disabled) return;
      if (shouldIgnoreTarget(e.target)) return;
      const start = startRef.current;
      startRef.current = null;

      const t = e.changedTouches[0];
      if (!start || !t) return;

      const nextScrollLeft = (e.currentTarget as unknown as HTMLElement).scrollLeft ?? 0;
      if (Math.abs(nextScrollLeft - start.scrollLeft) > maxScrollDeltaPx) return;

      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;

      if (Math.abs(dx) < minDistancePx) return;
      if (Math.abs(dx) < Math.abs(dy)) return;

      if (dx < 0) fire("left");
      else fire("right");
    },
    [disabled, fire, maxScrollDeltaPx, minDistancePx, shouldIgnoreTarget],
  );

  const onWheel = useCallback<WheelEventHandler<T>>(
    (e) => {
      if (disabled) return;
      if (e.ctrlKey) return;
      if (shouldIgnoreTarget(e.target)) return;

      const el = e.currentTarget as unknown as HTMLElement;
      if (el && el.scrollWidth > el.clientWidth + 2) return;

      const dx = e.deltaX;
      const dy = e.deltaY;
      if (Math.abs(dx) < 4) return;
      if (Math.abs(dx) < Math.abs(dy)) {
        resetWheel();
        return;
      }

      const sign: 1 | -1 = dx > 0 ? 1 : -1;
      if (wheelSignRef.current !== 0 && wheelSignRef.current !== sign) {
        wheelAccumRef.current = 0;
      }
      wheelSignRef.current = sign;
      wheelAccumRef.current += dx;

      if (wheelResetTimerRef.current) clearTimeout(wheelResetTimerRef.current);
      wheelResetTimerRef.current = setTimeout(() => {
        resetWheel();
      }, 140);

      if (Math.abs(wheelAccumRef.current) >= minWheelDistancePx) {
        resetWheel();
        if (sign > 0) fire("left");
        else fire("right");
      }
    },
    [disabled, fire, minWheelDistancePx, resetWheel, shouldIgnoreTarget],
  );

  return { onTouchStart, onTouchEnd, onTouchCancel, onWheel };
}
