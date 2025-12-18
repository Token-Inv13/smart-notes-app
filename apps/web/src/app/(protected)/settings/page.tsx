"use client";

import { useUserSettings } from "@/hooks/useUserSettings";
import { useEffect, useState } from "react";
import Link from "next/link";
import { auth, db } from "@/lib/firebase";
import { doc, updateDoc } from "firebase/firestore";
import { registerFcmToken } from "@/lib/fcm";
import LogoutButton from "../LogoutButton";

export default function SettingsPage() {
  const { data: user, loading, error } = useUserSettings();
  const [toggling, setToggling] = useState(false);
  const [toggleMessage, setToggleMessage] = useState<string | null>(null);
  const [fcmStatus, setFcmStatus] = useState<string | null>(null);

  const [notesViewMode, setNotesViewMode] = useState<"list" | "grid">("list");
  const [tasksViewMode, setTasksViewMode] = useState<"list" | "grid" | "kanban">("list");

  const [savingPlan, setSavingPlan] = useState(false);
  const [planMessage, setPlanMessage] = useState<string | null>(null);

  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [displayNameDraft, setDisplayNameDraft] = useState<string>(user?.displayName ?? "");

  const [savingAppearance, setSavingAppearance] = useState(false);
  const [appearanceMessage, setAppearanceMessage] = useState<string | null>(null);

  useEffect(() => {
    setDisplayNameDraft(user?.displayName ?? "");
  }, [user?.displayName]);

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

  const setAndPersistTasksViewMode = (next: "list" | "grid" | "kanban") => {
    setTasksViewMode(next);
    try {
      window.localStorage.setItem("tasksViewMode", next);
    } catch {
      // ignore
    }
  };

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
      });
      setToggleMessage("Task reminders updated.");
    } catch (e) {
      console.error("Error updating task reminders", e);
      setToggleMessage("Error updating task reminders.");
    } finally {
      setToggling(false);
    }
  };

  const handleTogglePlan = async () => {
    const currentUser = ensureCanEdit();
    if (!currentUser) {
      setPlanMessage("Cannot update plan for this user.");
      return;
    }

    const currentPlan = user?.plan ?? 'free';
    const nextPlan = currentPlan === 'pro' ? 'free' : 'pro';

    setSavingPlan(true);
    setPlanMessage(null);
    try {
      const userRef = doc(db, 'users', currentUser.uid);
      await updateDoc(userRef, { plan: nextPlan });
      setPlanMessage(nextPlan === 'pro' ? 'Plan Pro activé (test).' : 'Plan Free activé.');
    } catch (e) {
      console.error('Error updating plan', e);
      setPlanMessage('Erreur lors de la mise à jour du plan.');
    } finally {
      setSavingPlan(false);
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
      });
      setProfileMessage("Profil mis à jour.");
    } catch (e) {
      console.error("Error updating profile", e);
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
      });
      setAppearanceMessage("Mode mis à jour.");
    } catch (e) {
      console.error("Error updating appearance", e);
      setAppearanceMessage("Erreur lors de la mise à jour de l'apparence.");
    } finally {
      setSavingAppearance(false);
    }
  };

  const handleSetBackground = async (background: "none" | "dots" | "grid") => {
    const currentUser = ensureCanEdit();
    if (!currentUser) {
      setAppearanceMessage("Impossible de modifier l’apparence pour ce compte.");
      return;
    }

    setSavingAppearance(true);
    setAppearanceMessage(null);
    try {
      const userRef = doc(db, "users", currentUser.uid);
      await updateDoc(userRef, {
        "settings.appearance.background": background,
      });
      setAppearanceMessage("Fond mis à jour.");
    } catch (e) {
      console.error("Error updating background", e);
      setAppearanceMessage("Erreur lors de la mise à jour du fond.");
    } finally {
      setSavingAppearance(false);
    }
  };

  const handleEnablePushNotifications = async () => {
    setFcmStatus("Activation des notifications push…");
    try {
      await registerFcmToken();
      setFcmStatus("Notifications push activées (si la permission a été accordée).");
    } catch (e) {
      console.error("Error enabling push notifications", e);
      setFcmStatus("Impossible d’activer les notifications push pour le moment.");
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Paramètres</h1>

      <div>
        <LogoutButton />
      </div>

      {loading && <p>Chargement des paramètres…</p>}
      {error && <p>Impossible de charger les paramètres.</p>}

      {!loading && !error && !user && <p>Aucun paramètre disponible pour ce compte.</p>}

      {!loading && !error && user && (
        <div className="space-y-6">
          <section className="border border-border rounded-lg p-4 bg-card space-y-3">
            <h2 className="text-lg font-semibold">Profil</h2>
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
              className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              {savingProfile ? "Enregistrement…" : "Enregistrer"}
            </button>
            {profileMessage && <p className="text-sm">{profileMessage}</p>}
          </section>

          <section className="border border-border rounded-lg p-4 bg-card space-y-3">
            <h2 className="text-lg font-semibold">Apparence</h2>

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
                className="border border-border rounded px-3 py-2 bg-background text-sm disabled:opacity-50"
              >
                Basculer
              </button>
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">Fond</div>
              <select
                value={user.settings?.appearance?.background ?? "none"}
                onChange={(e) => handleSetBackground(e.target.value as "none" | "dots" | "grid")}
                disabled={savingAppearance}
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm disabled:opacity-50"
                aria-label="Fond de page"
              >
                <option value="none">Aucun</option>
                <option value="dots">Points</option>
                <option value="grid">Grille</option>
              </select>
            </div>

            {appearanceMessage && <p className="text-sm">{appearanceMessage}</p>}
          </section>

          <section className="border border-border rounded-lg p-4 bg-card space-y-3">
            <h2 className="text-lg font-semibold">Affichage</h2>

            <div className="space-y-1">
              <div className="text-sm font-medium">Notes</div>
              <select
                value={notesViewMode}
                onChange={(e) => setAndPersistNotesViewMode(e.target.value as "list" | "grid")}
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                aria-label="Affichage des notes"
              >
                <option value="list">Liste</option>
                <option value="grid">Vignettes</option>
              </select>
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">Tâches</div>
              <select
                value={tasksViewMode}
                onChange={(e) =>
                  setAndPersistTasksViewMode(e.target.value as "list" | "grid" | "kanban")
                }
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                aria-label="Affichage des tâches"
              >
                <option value="list">Liste</option>
                <option value="grid">Vignettes</option>
                <option value="kanban">Kanban</option>
              </select>
            </div>
          </section>

          <section className="border border-border rounded-lg p-4 bg-card space-y-2">
            <h2 className="text-lg font-semibold">Notifications</h2>
            <div className="text-sm">
              <span className="font-medium">Rappels de tâches:</span>{" "}
              <span>
                {user.settings?.notifications?.taskReminders ? "Activés" : "Désactivés"}
              </span>
            </div>

            <div className="space-y-1">
              <button
                type="button"
                onClick={handleToggleTaskReminders}
                disabled={toggling}
                className="border border-border rounded px-3 py-1 bg-background"
              >
                {toggling ? "Mise à jour…" : "Basculer rappels"}
              </button>
              {toggleMessage && <p className="text-sm">{toggleMessage}</p>}
            </div>

            <div className="space-y-1">
              <button
                type="button"
                onClick={handleEnablePushNotifications}
                className="border border-border rounded px-3 py-1 bg-background"
              >
                Activer notifications push
              </button>
              {fcmStatus && <p className="text-sm">{fcmStatus}</p>}
            </div>
          </section>

          <section className="border border-border rounded-lg p-4 bg-card space-y-2">
            <h2 className="text-lg font-semibold">Abonnement</h2>
            <div className="text-sm">
              <span className="font-medium">Plan actuel :</span> <span>{user.plan ?? 'free'}</span>
            </div>
            <Link
              href="/upgrade"
              className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium"
            >
              Débloquer Pro
            </Link>
            <button
              type="button"
              onClick={handleTogglePlan}
              disabled={savingPlan}
              className="border border-border rounded px-3 py-2 bg-background text-sm disabled:opacity-50"
            >
              {savingPlan ? 'Mise à jour…' : user.plan === 'pro' ? 'Repasser en Free' : 'Activer Pro (démo)'}
            </button>
            {planMessage && <p className="text-sm">{planMessage}</p>}
          </section>
        </div>
      )}
    </div>
  );
}
