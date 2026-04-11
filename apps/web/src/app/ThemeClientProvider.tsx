"use client";

import { useEffect } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { listenToForegroundMessages } from "@/lib/fcm";
import { invalidateAuthSession, isAuthInvalidError } from "@/lib/authInvalidation";
import { installGlobalErrorHandlers, observeCaughtError } from "@/lib/clientObservability";

type ThemeMode = "light" | "dark";

type BackgroundPreset = "none" | "dots" | "grid";

type UserAppearanceDoc = {
  settings?: {
    appearance?: {
      mode?: ThemeMode;
      background?: BackgroundPreset;
    };
  };
};

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  const isDark = mode === "dark";
  root.classList.toggle("dark", isDark);
  root.style.colorScheme = isDark ? "dark" : "light";
}

function applyBackground(preset: BackgroundPreset) {
  const root = document.documentElement;
  let value = "none";

  if (preset === "dots") {
    value = "radial-gradient(circle, rgba(0,0,0,0.12) 1px, transparent 1px)";
  } else if (preset === "grid") {
    value = "linear-gradient(to right, rgba(0,0,0,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.08) 1px, transparent 1px)";
  }

  root.style.setProperty("--app-bg-image", value);
  root.style.setProperty("--app-bg-size", preset === "dots" ? "18px 18px" : preset === "grid" ? "32px 32px" : "auto");
}

function readLocalAppearance(): { mode: ThemeMode; background: BackgroundPreset } {
  const mode = (localStorage.getItem("themeMode") as ThemeMode | null) ?? "light";
  const background = (localStorage.getItem("themeBackground") as BackgroundPreset | null) ?? "none";
  return {
    mode: mode === "dark" ? "dark" : "light",
    background: background === "dots" || background === "grid" ? background : "none",
  };
}

export default function ThemeClientProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  useEffect(() => {
    listenToForegroundMessages();
    const uninstallGlobalErrorHandlers = installGlobalErrorHandlers();

    const local = readLocalAppearance();
    applyTheme(local.mode);
    applyBackground(local.background);

    return () => {
      uninstallGlobalErrorHandlers();
    };
  }, []);

  useEffect(() => {
    const local = readLocalAppearance();
    if (!user) {
      applyTheme(local.mode);
      applyBackground(local.background);
      return;
    }

    const ref = doc(db, "users", user.uid);
    return onSnapshot(
      ref,
      (snap) => {
        const data = snap.data() as UserAppearanceDoc | undefined;
        const mode = data?.settings?.appearance?.mode ?? local.mode;
        const background = data?.settings?.appearance?.background ?? local.background;

        const normalizedMode: ThemeMode = mode === "dark" ? "dark" : "light";
        const normalizedBg: BackgroundPreset =
          background === "dots" || background === "grid" ? background : "none";

        localStorage.setItem("themeMode", normalizedMode);
        localStorage.setItem("themeBackground", normalizedBg);

        applyTheme(normalizedMode);
        applyBackground(normalizedBg);
      },
      (err) => {
        if (isAuthInvalidError(err)) {
          void invalidateAuthSession({
            reason: "session-invalid",
            message: "Session invalide pendant le chargement des préférences.",
          });
          return;
        }

        void observeCaughtError("frontend.auth_settings_snapshot_error", err, {
          source: "ThemeClientProvider",
        });
      },
    );
  }, [user]);

  return children;
}
