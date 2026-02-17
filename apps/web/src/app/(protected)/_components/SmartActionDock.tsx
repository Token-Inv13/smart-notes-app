"use client";

import type { ReactNode } from "react";

type Props = {
  mobileHidden?: boolean;
  hiddenOnScroll?: boolean;
  desktopTopClass?: string;
  subtleIdle?: boolean;
  voiceAction?: ReactNode;
  createAction: ReactNode;
};

export default function SmartActionDock({
  mobileHidden,
  hiddenOnScroll = false,
  desktopTopClass = "md:top-24",
  subtleIdle = false,
  voiceAction,
  createAction,
}: Props) {
  const hasVoiceAction = Boolean(voiceAction);
  const visibilityClass = mobileHidden ? "hidden md:flex" : "flex";
  const mobileLayoutClass = "max-md:left-1/2 max-md:-translate-x-1/2 max-md:rounded-full";
  const hiddenClass = hiddenOnScroll
    ? "translate-y-[130%] opacity-0 pointer-events-none md:translate-y-0 md:opacity-100 md:pointer-events-auto"
    : "translate-y-0 opacity-100";
  const subtleClass = subtleIdle
    ? "opacity-60 hover:opacity-100 focus-within:opacity-100 active:opacity-100 transition-opacity duration-200"
    : "";

  return (
    <div
      className={`${visibilityClass} fixed z-[45] ${mobileLayoutClass} ${hiddenClass} ${subtleClass} bottom-[calc(0.75rem+env(safe-area-inset-bottom))] md:left-auto md:right-6 md:bottom-auto md:rounded-full md:px-0 ${desktopTopClass} items-center border border-white/15 bg-slate-950/65 backdrop-blur-md shadow-[0_12px_28px_rgba(0,0,0,0.35)] overflow-hidden transition-all duration-220 ease-out`}
      role="group"
      aria-label="Actions rapides"
    >
      {hasVoiceAction ? (
        <>
          <div className="flex items-center justify-center px-1.5 py-1">
            {voiceAction}
          </div>
          <div className="h-7 w-px bg-white/15" aria-hidden="true" />
        </>
      ) : null}

      <div className="flex items-center justify-center px-1.5 py-1">
        {createAction}
      </div>
    </div>
  );
}
