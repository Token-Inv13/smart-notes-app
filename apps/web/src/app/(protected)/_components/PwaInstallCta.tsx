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

export function usePwaInstallState() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setInstalled(isStandaloneDisplayMode());

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
      setInstalled(true);
      setDeferred(null);
      setDismissed(true);
    };

    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const ios = useMemo(() => isIosDevice(), []);
  const android = useMemo(() => isAndroidDevice(), []);
  const iosSafari = useMemo(() => ios && isSafariBrowser(), [ios]);

  const canPromptInstall = !!deferred;

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
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") {
        setInstalled(true);
      }
      if (choice.outcome === "dismissed") {
        setDismissed(true);
      }
    } finally {
      setDeferred(null);
    }
  };

  return {
    installed,
    dismissed,
    ios,
    android,
    iosSafari,
    canPromptInstall,
    shouldShowBanner: !installed && !dismissed && (canPromptInstall || ios || android),
    shouldShowEntry: !installed && (canPromptInstall || ios || android),
    dismiss,
    onInstall,
  };
}

type PwaInstallViewState = ReturnType<typeof usePwaInstallState>;

export function PwaInstallSidebarEntry({
  mobile = false,
  collapsed = false,
  onNavigate,
  installState,
}: {
  mobile?: boolean;
  collapsed?: boolean;
  onNavigate?: () => void;
  installState: PwaInstallViewState;
}) {
  const { shouldShowEntry, canPromptInstall, ios, android, onInstall } = installState;

  if (!shouldShowEntry) return null;

  const label = canPromptInstall
    ? "Installer l’app"
    : ios
      ? "Installer sur iPhone"
      : android
        ? "Installer sur Android"
        : "Installer l’app";

  return (
    <div className={mobile ? "mt-3 border-t border-border pt-3" : "shrink-0 border-t border-border px-3 pt-3"}>
      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          void onInstall();
        }}
        className={`w-full rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-primary transition-colors hover:bg-primary/10 ${mobile ? "text-left" : collapsed ? "text-center" : "text-left"}`}
        aria-label={label}
        title={label}
      >
        {collapsed && !mobile ? "App" : label}
      </button>
      {!canPromptInstall ? (
        <div className={`mt-1 text-xs text-muted-foreground ${mobile ? "text-left" : collapsed ? "hidden" : "text-left"}`}>
          {ios ? "Via Safari → Partager → Sur l’écran d’accueil." : "Via le menu du navigateur."}
        </div>
      ) : null}
    </div>
  );
}

export function PwaInstallBanner({
  installState,
}: {
  installState: PwaInstallViewState;
}) {
  const {
    shouldShowBanner,
    ios,
    android,
    iosSafari,
    canPromptInstall,
    dismiss,
    onInstall,
  } = installState;

  if (!shouldShowBanner) return null;

  return (
    <div className="sn-card sn-card--muted p-3 mb-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">📲 Installer TaskNote</div>
          <div className="text-sm text-muted-foreground">
            Installe l’app pour l’ouvrir comme une vraie application et recevoir tes rappels.
            {ios ? " Sur iPhone, l’installation est nécessaire pour les notifications." : ""}
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
              Android: menu du navigateur → Installer l’application.
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
            Installer via le menu
          </span>
        )}
        <button type="button" onClick={dismiss} className="sn-text-btn">
          Plus tard
        </button>
      </div>
    </div>
  );
}

export default PwaInstallBanner;
