"use client";

import { useUserSettings } from "@/hooks/useUserSettings";
import { useState } from "react";
import { auth, db } from "@/lib/firebase";
import { doc, updateDoc } from "firebase/firestore";
import { registerFcmToken } from "@/lib/fcm";

export default function SettingsPage() {
  const { data: user, loading, error } = useUserSettings();
  const [toggling, setToggling] = useState(false);
  const [toggleMessage, setToggleMessage] = useState<string | null>(null);
  const [fcmStatus, setFcmStatus] = useState<string | null>(null);

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

  const handleEnablePushNotifications = async () => {
    setFcmStatus("Enabling push notifications...");
    try {
      await registerFcmToken();
      setFcmStatus("Push notifications enabled (if permission granted).");
    } catch (e) {
      console.error("Error enabling push notifications", e);
      setFcmStatus("Error enabling push notifications.");
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Settings (read-only)</h1>

      {loading && <p>Loading settings...</p>}
      {error && <p>Error loading settings.</p>}

      {!loading && !error && !user && <p>No settings found.</p>}

      {!loading && !error && user && (
        <div className="space-y-2">
          <div>
            <span className="font-medium">Display name:</span>{" "}
            <span>{user.displayName || "—"}</span>
          </div>
          <div>
            <span className="font-medium">Email:</span>{" "}
            <span>{user.email || "—"}</span>
          </div>
          <div>
            <span className="font-medium">Task reminders:</span>{" "}
            <span>
              {user.settings?.notifications?.taskReminders ? "Enabled" : "Disabled"}
            </span>
          </div>

          <div className="space-y-1">
            <button
              type="button"
              onClick={handleToggleTaskReminders}
              disabled={toggling}
              className="border border-border rounded px-3 py-1 bg-background"
            >
              {toggling ? "Updating..." : "Toggle task reminders"}
            </button>
            {toggleMessage && <p className="text-sm">{toggleMessage}</p>}
          </div>

          <div className="space-y-1">
            <button
              type="button"
              onClick={handleEnablePushNotifications}
              className="border border-border rounded px-3 py-1 bg-background"
            >
              Enable push notifications
            </button>
            {fcmStatus && <p className="text-sm">{fcmStatus}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
