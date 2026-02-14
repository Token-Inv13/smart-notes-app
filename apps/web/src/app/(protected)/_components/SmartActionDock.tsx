"use client";

import type { ReactNode } from "react";

type Props = {
  mobileHidden?: boolean;
  voiceAction: ReactNode;
  createAction: ReactNode;
};

export default function SmartActionDock({ mobileHidden, voiceAction, createAction }: Props) {
  const visibilityClass = mobileHidden ? "hidden md:flex" : "flex";

  return (
    <div
      className={`${visibilityClass} fixed z-[55] left-1/2 -translate-x-1/2 bottom-[calc(1rem+env(safe-area-inset-bottom))] md:left-auto md:right-6 md:bottom-6 md:translate-x-0 items-center rounded-full border border-white/15 bg-slate-950/65 backdrop-blur-md shadow-[0_12px_28px_rgba(0,0,0,0.35)] overflow-hidden`}
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
