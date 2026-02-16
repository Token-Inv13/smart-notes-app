"use client";

import { useUserSettings } from "@/hooks/useUserSettings";
import { useAssistantSettings } from "@/hooks/useAssistantSettings";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { auth, db } from "@/lib/firebase";
import { isAndroidNative } from "@/lib/runtimePlatform";
import { doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { registerFcmToken } from "@/lib/fcm";
import { invalidateAuthSession, isAuthInvalidError } from "@/lib/authInvalidation";
import LogoutButton from "../LogoutButton";

type AssistantSimpleMode = "calm" | "balanced" | "auto";

function assistantSimpleModeDefaults(mode: AssistantSimpleMode): {
  proactivity: "off" | "suggestions" | "proactive";
  maxPerDay: number;
  quietStart: string;
  quietEnd: string;
  aiEnabled: boolean;
  aiMinimize: boolean;
  aiAllowFull: boolean;
} {
  if (mode === "calm") {
    return {
      proactivity: "suggestions",
      maxPerDay: 1,
      quietStart: "22:00",
      quietEnd: "08:00",
      aiEnabled: true,
      aiMinimize: true,
      aiAllowFull: false,
    };
  }

  if (mode === "auto") {
    return {
      proactivity: "proactive",
      maxPerDay: 6,
      quietStart: "22:00",
      quietEnd: "08:00",
      aiEnabled: true,
      aiMinimize: true,
      aiAllowFull: false,
    };
  }

  return {
    proactivity: "suggestions",
    maxPerDay: 3,
    quietStart: "22:00",
    quietEnd: "08:00",
    aiEnabled: true,
    aiMinimize: true,
    aiAllowFull: false,
  };
}

export default function SettingsPage() {
  const { data: user, loading, error } = useUserSettings();
  const { data: assistantSettings } = useAssistantSettings();
  const [toggling, setToggling] = useState(false);
  const [toggleMessage, setToggleMessage] = useState<string | null>(null);
  const [fcmStatus, setFcmStatus] = useState<string | null>(null);
  const [enablingPush, setEnablingPush] = useState(false);

  const [notesViewMode, setNotesViewMode] = useState<"list" | "grid">("list");
  const [tasksViewMode, setTasksViewMode] = useState<"list" | "grid" | "kanban">("list");

  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [displayNameDraft, setDisplayNameDraft] = useState<string>(user?.displayName ?? "");

  const [savingAppearance, setSavingAppearance] = useState(false);
  const [appearanceMessage, setAppearanceMessage] = useState<string | null>(null);

  const [savingAssistant, setSavingAssistant] = useState(false);
  const [assistantMessage, setAssistantMessage] = useState<string | null>(null);
  const [assistantEnabledDraft, setAssistantEnabledDraft] = useState(false);
  const [assistantSimpleModeDraft, setAssistantSimpleModeDraft] = useState<AssistantSimpleMode>("balanced");
  const [assistantJtbdDraft, setAssistantJtbdDraft] = useState<"daily_planning" | "dont_forget" | "meetings" | "projects">("daily_planning");
  const [assistantProactivityDraft, setAssistantProactivityDraft] = useState<"off" | "suggestions" | "proactive">("suggestions");
  const [assistantQuietStartDraft, setAssistantQuietStartDraft] = useState<string>("22:00");
  const [assistantQuietEndDraft, setAssistantQuietEndDraft] = useState<string>("08:00");
  const [assistantMaxPerDayDraft, setAssistantMaxPerDayDraft] = useState<number>(3);
  const [assistantAIEnabledDraft, setAssistantAIEnabledDraft] = useState(true);
  const [assistantAIMinimizeDraft, setAssistantAIMinimizeDraft] = useState(true);
  const [assistantAIAllowFullDraft, setAssistantAIAllowFullDraft] = useState(false);
  const [assistantAdvancedOpen, setAssistantAdvancedOpen] = useState(false);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarPrimaryId, setCalendarPrimaryId] = useState<string | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [calendarMessage, setCalendarMessage] = useState<string | null>(null);

  const applyCalendarStateMessage = useCallback((calendarState: string) => {
    if (calendarState === "connected") {
      setCalendarMessage("Google Calendar connecté.");
      return;
    }
    if (calendarState === "auth_required") {
      setCalendarMessage("Connexion requise pour Google Calendar.");
      return;
    }
    if (calendarState === "oauth_state_invalid") {
      setCalendarMessage("La connexion Google Calendar a expiré. Merci de réessayer.");
      return;
    }
    if (calendarState === "missing_env") {
      setCalendarMessage("La connexion Google Calendar n’est pas encore configurée.");
      return;
    }
    if (calendarState === "token_exchange_failed") {
      setCalendarMessage("Impossible de finaliser la connexion Google Calendar. Réessaie.");
      return;
    }
    if (calendarState === "token_missing") {
      setCalendarMessage("Impossible de finaliser la connexion Google Calendar. Réessaie.");
      return;
    }
    if (calendarState === "error") {
      setCalendarMessage("Impossible de finaliser la connexion Google Calendar. Réessaie.");
    }
  }, []);

  useEffect(() => {
    setDisplayNameDraft(user?.displayName ?? "");
  }, [user?.displayName]);

  useEffect(() => {
    const enabled = assistantSettings?.enabled === true;
    setAssistantEnabledDraft(enabled);

    const simpleModeRaw = assistantSettings?.simpleMode;
    if (simpleModeRaw === "calm" || simpleModeRaw === "balanced" || simpleModeRaw === "auto") {
      setAssistantSimpleModeDraft(simpleModeRaw);
    } else {
      setAssistantSimpleModeDraft("balanced");
    }

    const jtbd = assistantSettings?.jtbdPreset;
    if (jtbd === "daily_planning" || jtbd === "dont_forget" || jtbd === "meetings" || jtbd === "projects") {
      setAssistantJtbdDraft(jtbd);
    } else {
      setAssistantJtbdDraft("daily_planning");
    }

    const proactivity = assistantSettings?.proactivityMode;
    if (proactivity === "off" || proactivity === "suggestions" || proactivity === "proactive") {
      setAssistantProactivityDraft(proactivity);
    } else {
      setAssistantProactivityDraft("suggestions");
    }

    const quietStart = typeof assistantSettings?.quietHours?.start === "string" ? assistantSettings.quietHours.start : "22:00";
    const quietEnd = typeof assistantSettings?.quietHours?.end === "string" ? assistantSettings.quietHours.end : "08:00";
    setAssistantQuietStartDraft(quietStart);
    setAssistantQuietEndDraft(quietEnd);

    const maxPerDay = assistantSettings?.notificationBudget?.maxPerDay;
    setAssistantMaxPerDayDraft(typeof maxPerDay === "number" && Number.isFinite(maxPerDay) ? maxPerDay : 3);

    const aiEnabled = assistantSettings?.aiPolicy?.enabled;
    const aiMinimize = assistantSettings?.aiPolicy?.minimizeData;
    const aiAllowFull = assistantSettings?.aiPolicy?.allowFullContent;
    setAssistantAIEnabledDraft(aiEnabled !== false);
    setAssistantAIMinimizeDraft(aiMinimize !== false);
    setAssistantAIAllowFullDraft(aiAllowFull === true);
  }, [assistantSettings]);

  const loadCalendarStatus = useCallback(async () => {
    setCalendarLoading(true);
    try {
      const res = await fetch("/api/google/calendar/status", { method: "GET", cache: "no-store" });
      if (!res.ok) {
        setCalendarConnected(false);
        setCalendarPrimaryId(null);
        return;
      }
      const data = (await res.json()) as { connected?: unknown; primaryCalendarId?: unknown };
      setCalendarConnected(data?.connected === true);
      setCalendarPrimaryId(typeof data?.primaryCalendarId === "string" ? data.primaryCalendarId : null);
    } catch {
      setCalendarConnected(false);
      setCalendarPrimaryId(null);
    } finally {
      setCalendarLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCalendarStatus();
  }, [loadCalendarStatus]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const calendarState = params.get("calendar");
    if (!calendarState) return;

    applyCalendarStateMessage(calendarState);
    if (calendarState === "connected") {
      void loadCalendarStatus();
    }

    params.delete("calendar");
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`;
    window.history.replaceState({}, "", nextUrl);
  }, [applyCalendarStateMessage, loadCalendarStatus]);

  const handleConnectGoogleCalendar = async () => {
    setCalendarBusy(true);
    setCalendarMessage(null);
    try {
      const returnTo = "/settings";
      const res = await fetch(`/api/google/calendar/connect?returnTo=${encodeURIComponent(returnTo)}`, {
        method: "GET",
        cache: "no-store",
      });
      const data = (await res.json()) as { url?: unknown; code?: unknown };
      if (!res.ok || typeof data?.url !== "string") {
        if (data?.code === "missing_env") {
          setCalendarMessage("La connexion Google Calendar n’est pas encore configurée.");
        } else {
          setCalendarMessage("Impossible de lancer la connexion Google Calendar.");
        }
        return;
      }

      const popup = window.open(
        data.url,
        "google-calendar-oauth",
        "width=540,height=720,menubar=no,toolbar=no,status=no,resizable=yes,scrollbars=yes",
      );

      if (!popup) {
        window.location.href = data.url;
        return;
      }

      popup.focus();

      await new Promise<void>((resolve) => {
        const startedAt = Date.now();
        const timer = window.setInterval(() => {
          if (popup.closed) {
            window.clearInterval(timer);
            resolve();
            return;
          }

          try {
            const popupUrl = popup.location.href;
            if (!popupUrl.startsWith(window.location.origin)) {
              if (Date.now() - startedAt > 3 * 60 * 1000) {
                popup.close();
                window.clearInterval(timer);
                resolve();
              }
              return;
            }

            const parsed = new URL(popupUrl);
            const popupState = parsed.searchParams.get("calendar");
            if (!popupState) return;

            applyCalendarStateMessage(popupState);
            popup.close();
            window.clearInterval(timer);
            resolve();
          } catch {
            // Cross-origin while still on Google OAuth pages.
          }
        }, 350);
      });

      await loadCalendarStatus();
    } catch {
      setCalendarMessage("Impossible de lancer la connexion Google Calendar.");
    } finally {
      setCalendarBusy(false);
    }
  };

  const handleDisconnectGoogleCalendar = async () => {
    setCalendarBusy(true);
    setCalendarMessage(null);
    try {
      const res = await fetch("/api/google/calendar/disconnect", { method: "POST" });
      const data = (await res.json()) as { ok?: unknown; error?: unknown };
      if (!res.ok || data?.ok !== true) {
        setCalendarMessage(typeof data?.error === "string" ? data.error : "Impossible de déconnecter Google Calendar.");
        return;
      }
      setCalendarConnected(false);
      setCalendarPrimaryId(null);
      setCalendarMessage("Google Calendar déconnecté.");
    } catch {
      setCalendarMessage("Impossible de déconnecter Google Calendar.");
    } finally {
      setCalendarBusy(false);
    }
  };

  const applyAssistantSimpleMode = (mode: AssistantSimpleMode) => {
    const defaults = assistantSimpleModeDefaults(mode);
    setAssistantSimpleModeDraft(mode);
    setAssistantProactivityDraft(defaults.proactivity);
    setAssistantMaxPerDayDraft(defaults.maxPerDay);
    setAssistantQuietStartDraft(defaults.quietStart);
    setAssistantQuietEndDraft(defaults.quietEnd);
    setAssistantAIEnabledDraft(defaults.aiEnabled);
    setAssistantAIMinimizeDraft(defaults.aiMinimize);
    setAssistantAIAllowFullDraft(defaults.aiAllowFull);
  };

  useEffect(() => {
    try {
      const rawNotes = window.localStorage.getItem("notesViewMode");
      if (rawNotes === "list" || rawNotes === "grid") {
        setNotesViewMode(rawNotes);
      }

      const rawTasks = window.localStorage.getItem("tasksViewMode");
      if (rawTasks === "list" || rawTasks === "grid" || rawTasks === "kanban") {
        setTasksViewMode(rawTasks);
      }
    } catch {
      // ignore
    }
  }, []);

  const setAndPersistNotesViewMode = (next: "list" | "grid") => {
    setNotesViewMode(next);
    try {
      window.localStorage.setItem("notesViewMode", next);
    } catch {
      // ignore
    }
  };

  const handleSaveAssistantSettings = async () => {
    const currentUser = ensureCanEdit();
    if (!currentUser) {
      setAssistantMessage("Impossible de modifier l’assistant pour ce compte.");
      return;
    }

    setSavingAssistant(true);
    setAssistantMessage(null);

    const plan = (user?.plan ?? "free") === "pro" ? "pro" : "free";
    const ref = doc(db, "users", currentUser.uid, "assistantSettings", "main");

    const maxPerDay = Number.isFinite(assistantMaxPerDayDraft) ? Math.max(0, Math.min(50, assistantMaxPerDayDraft)) : 3;

    try {
      if (!assistantSettings) {
        await setDoc(
          ref,
          {
            enabled: assistantEnabledDraft,
            plan,
            autoAnalyze: false,
            consentVersion: 1,
            simpleMode: assistantSimpleModeDraft,
            jtbdPreset: assistantJtbdDraft,
            proactivityMode: assistantProactivityDraft,
            quietHours: { start: assistantQuietStartDraft, end: assistantQuietEndDraft },
            notificationBudget: { maxPerDay },
            aiPolicy: {
              enabled: assistantAIEnabledDraft,
              minimizeData: assistantAIMinimizeDraft,
              allowFullContent: assistantAIAllowFullDraft,
            },
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      } else {
        await updateDoc(ref, {
          enabled: assistantEnabledDraft,
          plan,
          simpleMode: assistantSimpleModeDraft,
          jtbdPreset: assistantJtbdDraft,
          proactivityMode: assistantProactivityDraft,
          "quietHours.start": assistantQuietStartDraft,
          "quietHours.end": assistantQuietEndDraft,
          "notificationBudget.maxPerDay": maxPerDay,
          "aiPolicy.enabled": assistantAIEnabledDraft,
          "aiPolicy.minimizeData": assistantAIMinimizeDraft,
          "aiPolicy.allowFullContent": assistantAIAllowFullDraft,
          updatedAt: serverTimestamp(),
        });
      }
      setAssistantMessage("Assistant mis à jour.");
    } catch (e) {
      console.error("Error updating assistant settings", e);
      if (isAuthInvalidError(e)) {
        void invalidateAuthSession();
        return;
      }
      setAssistantMessage("Erreur lors de la mise à jour de l’assistant.");
    } finally {
      setSavingAssistant(false);
    }
  };

  const setAndPersistTasksViewMode = (next: "list" | "grid" | "kanban") => {
    setTasksViewMode(next);
    try {
      window.localStorage.setItem("tasksViewMode", next);
    } catch {
      // ignore
    }
  };

  const hasFcmTokens = Object.keys(user?.fcmTokens ?? {}).length > 0;
  const isPro = (user?.plan ?? "free") === "pro";
  const hasActiveStripeSubscription = user?.stripeSubscriptionStatus === "active" || user?.stripeSubscriptionStatus === "trialing";
  const isAndroid = isAndroidNative();
  const googlePlayManageUrl = "https://play.google.com/store/account/subscriptions";

  const handleToggleTaskReminders = async () => {
    if (!user) return;

    const currentUser = auth.currentUser;
    if (!currentUser || currentUser.uid !== user.uid) {
      setToggleMessage("Cannot update settings for this user.");
      return;
    }

    const currentValue = !!user.settings?.notifications?.taskReminders;
    const nextValue = !currentValue;

    setToggling(true);
    setToggleMessage(null);

    try {
      const userRef = doc(db, "users", currentUser.uid);
      await updateDoc(userRef, {
        "settings.notifications.taskReminders": nextValue,
        updatedAt: serverTimestamp(),
      });
      setToggleMessage("Task reminders updated.");

      if (nextValue) {
        setFcmStatus(null);
        // Ensure this device is registered for push notifications.
        await registerFcmToken();
      }
    } catch (e) {
      console.error("Error updating task reminders", e);
      if (isAuthInvalidError(e)) {
        void invalidateAuthSession();
        return;
      }
      setToggleMessage("Error updating task reminders.");
    } finally {
      setToggling(false);
    }
  };

  const ensureCanEdit = () => {
    const currentUser = auth.currentUser;
    if (!user || !currentUser || currentUser.uid !== user.uid) {
      return null;
    }
    return currentUser;
  };

  const handleSaveDisplayName = async () => {
    const currentUser = ensureCanEdit();
    if (!currentUser) {
      setProfileMessage("Cannot update profile for this user.");
      return;
    }

    setSavingProfile(true);
    setProfileMessage(null);
    try {
      const userRef = doc(db, "users", currentUser.uid);
      await updateDoc(userRef, {
        displayName: displayNameDraft.trim() || null,
        updatedAt: serverTimestamp(),
      });
      setProfileMessage("Profil mis à jour.");
    } catch (e) {
      console.error("Error updating profile", e);
      if (isAuthInvalidError(e)) {
        void invalidateAuthSession();
        return;
      }
      setProfileMessage("Erreur lors de la mise à jour du profil.");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleToggleThemeMode = async () => {
    const currentUser = ensureCanEdit();
    if (!currentUser) {
      setAppearanceMessage("Impossible de modifier l’apparence pour ce compte.");
      return;
    }

    const currentMode = user?.settings?.appearance?.mode ?? "light";
    const nextMode = currentMode === "dark" ? "light" : "dark";

    setSavingAppearance(true);
    setAppearanceMessage(null);
    try {
      const userRef = doc(db, "users", currentUser.uid);
      await updateDoc(userRef, {
        "settings.appearance.mode": nextMode,
        updatedAt: serverTimestamp(),
      });
      setAppearanceMessage("Mode mis à jour.");
    } catch (e) {
      console.error("Error updating appearance", e);
      if (isAuthInvalidError(e)) {
        void invalidateAuthSession();
        return;
      }
      setAppearanceMessage("Erreur lors de la mise à jour de l'apparence.");
    } finally {
      setSavingAppearance(false);
    }
  };

  const handleEnablePushNotifications = async () => {
    setFcmStatus("Activation des notifications push…");
    setEnablingPush(true);
    try {
      await registerFcmToken();

      const permission = typeof window !== "undefined" && "Notification" in window ? Notification.permission : "denied";
      if (permission === "granted") {
        setFcmStatus("✅ Notifications activées");
      } else if (permission === "denied") {
        setFcmStatus("⚠️ Permission refusée. Tu peux réactiver les notifications depuis les paramètres de ton navigateur.");
      } else {
        setFcmStatus("Permission non accordée.");
      }
    } catch (e) {
      console.error("Error enabling push notifications", e);
      setFcmStatus("Impossible d’activer les notifications push pour le moment.");
    } finally {
      setEnablingPush(false);
    }
  };

  const notificationPermission: NotificationPermission | "unsupported" = (() => {
    if (typeof window === "undefined") return "unsupported";
    if (!("Notification" in window)) return "unsupported";
    return Notification.permission;
  })();

  const shouldShowRegisterDeviceCta =
    !!user?.settings?.notifications?.taskReminders &&
    notificationPermission === "granted" &&
    !hasFcmTokens;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Paramètres</h1>
        <p className="text-sm text-muted-foreground">Gère ton profil, l’affichage et ton abonnement.</p>
      </div>

      <div>
        <LogoutButton />
      </div>

      {loading && (
        <div className="sn-card p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="sn-skeleton-avatar" />
            <div className="space-y-2 flex-1">
              <div className="sn-skeleton-title w-48" />
              <div className="sn-skeleton-line w-64" />
            </div>
          </div>
          <div className="sn-skeleton-line w-72" />
          <div className="sn-skeleton-line w-56" />
        </div>
      )}
      {error && <div className="sn-alert sn-alert--error">Impossible de charger les paramètres.</div>}

      {!loading && !error && !user && <div className="sn-alert sn-alert--info">Aucun paramètre disponible pour ce compte.</div>}

      {!loading && !error && user && (
        <div className="space-y-6">
          <section className="border border-border/70 rounded-xl p-5 bg-card shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Profil</h2>
              <div className="text-xs text-muted-foreground">Compte</div>
            </div>
            <p className="text-sm text-muted-foreground">Informations de base de ton compte.</p>
            <div className="text-sm">
              <span className="font-medium">Email :</span> <span>{user.email || "—"}</span>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="displayName">
                Nom affiché
              </label>
              <input
                id="displayName"
                value={displayNameDraft}
                onChange={(e) => setDisplayNameDraft(e.target.value)}
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                placeholder="Ex: Token"
              />
            </div>

            <button
              type="button"
              onClick={handleSaveDisplayName}
              disabled={savingProfile}
              className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-95 disabled:opacity-50"
            >
              {savingProfile ? "Enregistrement…" : "Enregistrer"}
            </button>
            {profileMessage && <p className="text-sm">{profileMessage}</p>}
          </section>

          <section className="border border-primary/30 rounded-xl p-5 bg-gradient-to-b from-primary/8 to-transparent shadow-md space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Abonnement</h2>
              <div className="text-xs text-muted-foreground">Pro</div>
            </div>
            <p className="text-sm text-muted-foreground">Ton plan et les options de gestion.</p>
            <div className="text-sm">
              <span className="font-medium">Plan actuel :</span> <span>{user.plan ?? "free"}</span>
            </div>
            {isPro ? (
              <div className="space-y-2">
                <div className="text-xs px-2 py-1 rounded-full border border-primary/30 bg-primary/10 text-foreground inline-flex w-fit">
                  {hasActiveStripeSubscription || isAndroid ? "Pro actif" : "Statut à vérifier"}
                </div>
                <Link
                  href="/upgrade"
                  className="inline-flex items-center justify-center px-4 py-2 rounded-lg border border-border bg-background text-sm font-medium hover:bg-accent/60"
                >
                  Gérer l’abonnement
                </Link>
                {isAndroid ? (
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">Ton abonnement est géré via Google Play.</div>
                    <a
                      href={googlePlayManageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center px-4 py-2 rounded-lg border border-border bg-background text-sm font-medium hover:bg-accent/60"
                    >
                      Ouvrir Google Play
                    </a>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    {hasActiveStripeSubscription
                      ? "Modification et annulation via le portail sécurisé Stripe."
                      : "Ton abonnement Stripe ne semble plus actif. Ouvre la page Abonnement pour rafraîchir le statut."}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Link
                  href="/upgrade"
                  className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-95"
                >
                  Débloquer Pro
                </Link>
                <div className="text-xs text-muted-foreground">Essai immédiat. Annulation en un clic.</div>
              </div>
            )}
          </section>

          <section className="border border-border/70 rounded-xl p-5 bg-card shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Calendriers connectés</h2>
              <div className="text-xs text-muted-foreground">Intégrations</div>
            </div>

            <div className="rounded-lg border border-border/60 p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Google Calendar</div>
                  <div className="text-xs text-muted-foreground">
                    {calendarLoading
                      ? "Chargement…"
                      : calendarConnected
                        ? "Connecté"
                        : "Non connecté"}
                  </div>
                </div>
                {!calendarConnected ? (
                  <button
                    type="button"
                    onClick={() => void handleConnectGoogleCalendar()}
                    disabled={calendarBusy || calendarLoading}
                    className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
                  >
                    {calendarBusy ? "Connexion…" : "Connecter Google Calendar"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleDisconnectGoogleCalendar()}
                    disabled={calendarBusy || calendarLoading}
                    className="px-3 py-2 rounded-md border border-input text-xs disabled:opacity-50"
                  >
                    {calendarBusy ? "Déconnexion…" : "Déconnecter"}
                  </button>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                Connexion OAuth officielle Google en 1 clic, sans saisie manuelle ni affichage de token.
              </p>

              {calendarPrimaryId ? (
                <div className="text-xs text-muted-foreground break-all">Calendrier principal: {calendarPrimaryId}</div>
              ) : null}

              {calendarMessage ? <div className="text-xs">{calendarMessage}</div> : null}
            </div>
          </section>

          <section className="border border-border/70 rounded-xl p-5 bg-card shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Notifications</h2>
              <div className="text-xs text-muted-foreground">Rappels</div>
            </div>
            <p className="text-sm text-muted-foreground">Active les rappels et configure ce navigateur.</p>

            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-medium">Rappels d’agenda</div>
                <div className="text-sm text-muted-foreground">
                  {user.settings?.notifications?.taskReminders ? "Activés" : "Désactivés"}
                </div>
              </div>

              <button
                type="button"
                onClick={handleToggleTaskReminders}
                disabled={toggling}
                aria-label="Rappels d’agenda"
                title="Rappels d’agenda"
                className={`relative inline-flex h-9 w-14 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background disabled:opacity-50 ${
                  user.settings?.notifications?.taskReminders ? "bg-primary/30 border-primary/30" : "bg-muted border-border"
                }`}
              >
                <span
                  className={`inline-block h-7 w-7 rounded-full bg-background shadow-sm transition-transform ${
                    user.settings?.notifications?.taskReminders ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            <div className="text-sm">
              <span className="font-medium">État des notifications:</span>{" "}
              <span>
                {notificationPermission === "granted"
                  ? "✅ Notifications activées"
                  : notificationPermission === "denied"
                    ? "⚠️ Permission refusée"
                    : notificationPermission === "default"
                      ? "— À activer"
                      : "❌ Navigateur non compatible"}
              </span>
            </div>

            {toggleMessage && <p className="text-sm">{toggleMessage}</p>}

            {shouldShowRegisterDeviceCta && (
              <div className="space-y-2">
                <div className="sn-alert sn-alert--info">
                  ⚠️ Notifications autorisées, mais aucun appareil n’est enregistré. Clique ci-dessous pour enregistrer ce navigateur.
                </div>
                <button
                  type="button"
                  onClick={handleEnablePushNotifications}
                  disabled={enablingPush}
                  className="border border-border rounded-lg px-3 py-2 bg-background text-sm hover:bg-accent/60 disabled:opacity-50"
                >
                  {enablingPush ? "Enregistrement…" : "Enregistrer cet appareil"}
                </button>
                {fcmStatus && <p className="text-sm">{fcmStatus}</p>}
              </div>
            )}

            {user.settings?.notifications?.taskReminders && notificationPermission !== "granted" && (
              <div className="space-y-2">
                {notificationPermission === "denied" && (
                  <div className="sn-alert sn-alert--info">
                    Tu peux réactiver les notifications depuis les paramètres de ton navigateur.
                  </div>
                )}

                {notificationPermission === "default" && (
                  <div className="sn-alert sn-alert--info">🔔 Pour recevoir les rappels, active les notifications.</div>
                )}

                {notificationPermission === "unsupported" && (
                  <div className="sn-alert sn-alert--info">❌ Navigateur non compatible avec les notifications.</div>
                )}

                {notificationPermission !== "unsupported" && notificationPermission !== "denied" && (
                  <button
                    type="button"
                    onClick={handleEnablePushNotifications}
                    disabled={enablingPush}
                    className="border border-border rounded-lg px-3 py-2 bg-background text-sm hover:bg-accent/60 disabled:opacity-50"
                  >
                    {enablingPush ? "Activation…" : "Activer les notifications"}
                  </button>
                )}

                {fcmStatus && <p className="text-sm">{fcmStatus}</p>}
              </div>
            )}

            {user.settings?.notifications?.taskReminders && notificationPermission === "granted" && fcmStatus && (
              <p className="text-sm">{fcmStatus}</p>
            )}
          </section>

          <section className="border border-border/60 rounded-xl p-4 bg-card shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Assistant</h2>
              <div className="text-xs text-muted-foreground">Réglages</div>
            </div>
            <p className="text-xs text-muted-foreground">Configuration compacte: mode, objectif et options avancées.</p>

            <div className="rounded-lg border border-border/50 bg-background/60 px-3 py-2 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-medium">Assistant activé</div>
                <div className="text-xs text-muted-foreground">{assistantEnabledDraft ? "Activé" : "Désactivé"}</div>
              </div>

              <button
                type="button"
                onClick={() => setAssistantEnabledDraft((v) => !v)}
                disabled={savingAssistant}
                aria-label="Assistant activé"
                title="Assistant activé"
                className={`relative inline-flex h-8 w-14 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background disabled:opacity-50 ${
                  assistantEnabledDraft ? "bg-primary/30 border-primary/30" : "bg-muted border-border"
                }`}
              >
                <span
                  className={`inline-block h-6 w-6 rounded-full bg-background shadow-sm transition-transform ${
                    assistantEnabledDraft ? "translate-x-7" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">Mode assistant</div>
                <select
                  value={assistantSimpleModeDraft}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "calm" || v === "balanced" || v === "auto") {
                      applyAssistantSimpleMode(v);
                    }
                  }}
                  className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                  aria-label="Mode assistant simple"
                >
                  <option value="calm">Calme</option>
                  <option value="balanced">Équilibré (recommandé)</option>
                  <option value="auto">Auto</option>
                </select>
              </div>

              <div className="space-y-1">
                <div className="text-sm font-medium">JTBD principal</div>
                <select
                  value={assistantJtbdDraft}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "daily_planning" || v === "dont_forget" || v === "meetings" || v === "projects") {
                      setAssistantJtbdDraft(v);
                    }
                  }}
                  className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                  aria-label="JTBD principal"
                >
                  <option value="daily_planning">Planifier ma journée</option>
                  <option value="dont_forget">Ne rien oublier / suivi</option>
                  <option value="meetings">Réunions & décisions</option>
                  <option value="projects">Projets (pilotage)</option>
                </select>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setAssistantAdvancedOpen((v) => !v)}
              className="text-xs text-muted-foreground hover:underline w-fit"
            >
              {assistantAdvancedOpen ? "Masquer les options avancées" : "Afficher les options avancées"}
            </button>

            {assistantAdvancedOpen ? (
              <div className="rounded-md border border-border/50 bg-muted/20 p-3 space-y-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium">Proactivité</div>
                  <select
                    value={assistantProactivityDraft}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "off" || v === "suggestions" || v === "proactive") {
                        setAssistantProactivityDraft(v);
                      }
                    }}
                    className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                    aria-label="Proactivité"
                  >
                    <option value="off">Off</option>
                    <option value="suggestions">Suggestions</option>
                    <option value="proactive">Proactif</option>
                  </select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Silence début</div>
                    <input
                      type="time"
                      value={assistantQuietStartDraft}
                      onChange={(e) => setAssistantQuietStartDraft(e.target.value)}
                      className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                      aria-label="Silence début"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Silence fin</div>
                    <input
                      type="time"
                      value={assistantQuietEndDraft}
                      onChange={(e) => setAssistantQuietEndDraft(e.target.value)}
                      className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                      aria-label="Silence fin"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Notif/jour max</div>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={assistantMaxPerDayDraft}
                      onChange={(e) => setAssistantMaxPerDayDraft(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                      aria-label="Budget notifications"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">Politique IA</div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={assistantAIEnabledDraft} onChange={(e) => setAssistantAIEnabledDraft(e.target.checked)} />
                    Activer l’IA
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={assistantAIMinimizeDraft}
                      onChange={(e) => setAssistantAIMinimizeDraft(e.target.checked)}
                      disabled={!assistantAIEnabledDraft}
                    />
                    Minimiser les données envoyées
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={assistantAIAllowFullDraft}
                      onChange={(e) => setAssistantAIAllowFullDraft(e.target.checked)}
                      disabled={!assistantAIEnabledDraft}
                    />
                    Autoriser le contenu complet
                  </label>
                </div>
              </div>
            ) : null}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleSaveAssistantSettings}
                disabled={savingAssistant}
                className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-95 disabled:opacity-50"
              >
                {savingAssistant ? "Enregistrement…" : "Enregistrer"}
              </button>
              <Link href="/assistant" className="text-xs text-muted-foreground hover:underline">
                Ouvrir l’assistant (optionnel)
              </Link>
            </div>
            {assistantMessage && <p className="text-sm">{assistantMessage}</p>}
          </section>

          <section className="border border-border/70 rounded-xl p-5 bg-card shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Affichage</h2>
              <div className="text-xs text-muted-foreground">Préférences</div>
            </div>
            <p className="text-sm text-muted-foreground">Choisis comment afficher tes listes.</p>

            <div className="space-y-1">
              <div className="text-sm font-medium">Notes</div>
              <select
                value={notesViewMode}
                onChange={(e) => setAndPersistNotesViewMode(e.target.value as "list" | "grid")}
                className="w-full px-3 py-2 border border-input rounded-lg bg-background text-foreground text-sm"
                aria-label="Affichage des notes"
              >
                <option value="list">Liste</option>
                <option value="grid">Vignettes</option>
              </select>
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">Agenda</div>
              <select
                value={tasksViewMode}
                onChange={(e) => setAndPersistTasksViewMode(e.target.value as "list" | "grid" | "kanban")}
                className="w-full px-3 py-2 border border-input rounded-lg bg-background text-foreground text-sm"
                aria-label="Affichage de l’agenda"
              >
                <option value="list">Liste</option>
                <option value="grid">Vignettes</option>
                <option value="kanban">Kanban</option>
              </select>
            </div>
          </section>

          <section className="border border-border/70 rounded-xl p-5 bg-card shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Apparence</h2>
              <div className="text-xs text-muted-foreground">Thème</div>
            </div>
            <p className="text-sm text-muted-foreground">Mode clair ou sombre.</p>

            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Mode</div>
                <div className="text-sm text-muted-foreground">
                  {user.settings?.appearance?.mode === "dark" ? "Sombre" : "Clair"}
                </div>
              </div>

              <button
                type="button"
                onClick={handleToggleThemeMode}
                disabled={savingAppearance}
                aria-label="Mode sombre"
                title="Mode sombre"
                className={`relative inline-flex h-9 w-14 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background disabled:opacity-50 ${
                  user.settings?.appearance?.mode === "dark" ? "bg-primary/30 border-primary/30" : "bg-muted border-border"
                }`}
              >
                <span
                  className={`inline-block h-7 w-7 rounded-full bg-background shadow-sm transition-transform ${
                    user.settings?.appearance?.mode === "dark" ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {appearanceMessage && <p className="text-sm">{appearanceMessage}</p>}
          </section>
        </div>
      )}
    </div>
  );
}
