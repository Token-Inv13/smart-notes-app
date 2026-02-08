"use client";

import { useMemo, useState } from "react";
import { doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAssistantSettings } from "@/hooks/useAssistantSettings";
import { useUserSettings } from "@/hooks/useUserSettings";
import { invalidateAuthSession, isAuthInvalidError } from "@/lib/authInvalidation";

const CONSENT_VERSION = 1;

export default function AssistantPage() {
  const { data: assistantSettings, loading: assistantLoading, error: assistantError } = useAssistantSettings();
  const { data: userSettings } = useUserSettings();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const enabled = assistantSettings?.enabled === true;

  const plan = useMemo(() => {
    const raw = userSettings?.plan;
    if (raw === "pro") return "pro";
    return "free";
  }, [userSettings?.plan]);

  const handleEnable = async () => {
    const user = auth.currentUser;
    if (!user) return;

    setSaving(true);
    setMessage(null);

    const ref = doc(db, "users", user.uid, "assistantSettings", "main");

    try {
      if (!assistantSettings) {
        await setDoc(
          ref,
          {
            enabled: true,
            plan,
            autoAnalyze: false,
            consentVersion: CONSENT_VERSION,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      } else {
        await updateDoc(ref, {
          enabled: true,
          plan,
          updatedAt: serverTimestamp(),
        });
      }
      setMessage("Assistant activé.");
    } catch (e) {
      if (isAuthInvalidError(e)) {
        void invalidateAuthSession();
        return;
      }
      setMessage("Impossible d’activer l’assistant.");
    } finally {
      setSaving(false);
    }
  };

  if (assistantError) {
    return <div className="sn-alert sn-alert--error">Impossible de charger l’assistant.</div>;
  }

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Assistant</h1>
          <p className="text-sm text-muted-foreground">
            {assistantLoading ? "Chargement…" : enabled ? "Assistant activé" : "Assistant désactivé"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleEnable()}
          disabled={assistantLoading || saving || enabled}
          className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Activation…" : enabled ? "Activé" : "Activer l’assistant"}
        </button>
      </div>

      {message && <div className="sn-alert">{message}</div>}

      <div className="sn-card p-4 space-y-2">
        <div className="text-sm font-medium">Statut</div>
        <div className="text-sm text-muted-foreground">Plan: {plan}</div>
        <div className="text-sm text-muted-foreground">Auto-analyse: désactivée</div>
      </div>
    </div>
  );
}
