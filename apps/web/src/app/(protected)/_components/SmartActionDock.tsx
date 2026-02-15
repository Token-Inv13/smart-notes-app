"use client";

import type { ReactNode } from "react";

type DockMode = "floating" | "agenda-sticky";

type Props = {
  mobileHidden?: boolean;
  mode?: DockMode;
  hiddenOnScroll?: boolean;
  voiceAction: ReactNode;
  createAction: ReactNode;
};

export default function SmartActionDock({ mobileHidden, mode = "floating", hiddenOnScroll = false, voiceAction, createAction }: Props) {
  const visibilityClass = mobileHidden ? "hidden md:flex" : "flex";
  const mobileLayoutClass =
    mode === "agenda-sticky"
      ? "left-1/2 w-[min(calc(100vw-1rem),560px)] -translate-x-1/2 justify-center rounded-2xl px-2"
      : "left-1/2 -translate-x-1/2 rounded-full";
  const hiddenClass = hiddenOnScroll
    ? "translate-y-[130%] opacity-0 pointer-events-none md:translate-y-0 md:opacity-100 md:pointer-events-auto"
    : "translate-y-0 opacity-100";

  return (
    <div
      className={`${visibilityClass} fixed z-[55] ${mobileLayoutClass} ${hiddenClass} bottom-[calc(0.75rem+env(safe-area-inset-bottom))] md:left-auto md:right-6 md:top-32 md:bottom-auto md:translate-x-0 items-center border border-white/15 bg-slate-950/65 backdrop-blur-md shadow-[0_12px_28px_rgba(0,0,0,0.35)] overflow-hidden transition-all duration-220 ease-out`}
      role="group"
      aria-label="Actions rapides"
    >
      <div className="flex items-center justify-center px-1.5 py-1">
        {voiceAction}
      </div>

      <div className="h-7 w-px bg-white/15" aria-hidden="true" />

      <div className="flex items-center justify-center px-1.5 py-1">
        {createAction}
      </div>
    </div>
  );
}
