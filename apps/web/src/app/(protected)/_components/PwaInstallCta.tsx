"use client";

import { useEffect, useMemo, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const DISMISS_KEY = "pwaInstallCtaDismissed";
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

function isStandaloneDisplayMode() {
  if (typeof window === "undefined") return false;
  const isStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches ?? false;
  const isIosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return isStandalone || isIosStandalone;
}

function isIosDevice() {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent.toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(ua);
  return isIos;
}

function isAndroidDevice() {
  if (typeof window === "undefined") return false;
  return /android/i.test(window.navigator.userAgent);
}

function isSafariBrowser() {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent.toLowerCase();
  const isSafari = ua.includes("safari") && !ua.includes("crios") && !ua.includes("fxios") && !ua.includes("edgios");
  return isSafari;
}

export default function PwaInstallCta() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = window.localStorage.getItem(DISMISS_KEY);
      if (!raw) {
        setDismissed(false);
      } else if (raw === "1") {
        setDismissed(true);
      } else {
        const dismissedAt = Number(raw);
        setDismissed(Number.isFinite(dismissedAt) && Date.now() - dismissedAt < DISMISS_DURATION_MS);
      }
    } catch {
      setDismissed(false);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler);
    const onAppInstalled = () => {
      setDeferred(null);
      setDismissed(true);
    };

    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const installed = useMemo(() => isStandaloneDisplayMode(), []);
  const ios = useMemo(() => isIosDevice(), []);
  const android = useMemo(() => isAndroidDevice(), []);
  const iosSafari = useMemo(() => ios && isSafariBrowser(), [ios]);

  const canPromptInstall = !!deferred;
  const shouldShow = !installed && !dismissed && (canPromptInstall || ios || android);

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore
    }
  };

  const onInstall = async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } finally {
      setDeferred(null);
      dismiss();
    }
  };

  if (!shouldShow) return null;

  return (
    <div className="sn-card sn-card--muted p-3 mb-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">📲 Installer TaskNote</div>
          <div className="text-sm text-muted-foreground">
            Installe l’app pour recevoir les rappels même lorsque l’app est fermée.
            {ios ? " Sur iOS, les notifications fonctionnent uniquement si l’app est installée." : ""}
          </div>
          {ios && (
            <div className="text-xs text-muted-foreground mt-1">
              {iosSafari
                ? "Safari → Partager → Sur l’écran d’accueil."
                : "Ouvre TaskNote dans Safari, puis Partager → Sur l’écran d’accueil."}
            </div>
          )}
          {android && !canPromptInstall && (
            <div className="text-xs text-muted-foreground mt-1">
              Sur Android, utilise le menu du navigateur puis “Installer l’application” ou “Ajouter à l’écran d’accueil”.
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Masquer le bandeau d'installation"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          ×
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2">
        {canPromptInstall && (
          <button type="button" onClick={onInstall} className="sn-text-btn">
            Installer
          </button>
        )}
        {ios && !canPromptInstall && (
          <span className="text-xs text-muted-foreground">
            Installation manuelle via Safari
          </span>
        )}
        {android && !canPromptInstall && (
          <span className="text-xs text-muted-foreground">
            Installation via le menu du navigateur
          </span>
        )}
        <button type="button" onClick={dismiss} className="sn-text-btn">
          Plus tard
        </button>
      </div>
    </div>
  );
}
