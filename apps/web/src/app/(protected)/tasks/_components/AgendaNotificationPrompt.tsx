"use client";

interface AgendaNotificationPromptProps {
  permission: NotificationPermission | "unsupported";
  isEnabling: boolean;
  pushStatus: string | null;
  onEnable: () => void;
}

export default function AgendaNotificationPrompt({
  permission,
  isEnabling,
  pushStatus,
  onEnable,
}: AgendaNotificationPromptProps) {
  if (permission === "granted") return null;

  return (
    <div className="space-y-2 mt-2">
      {permission === "unsupported" && (
        <div className="sn-alert sn-alert--info">✕ Navigateur non compatible avec les notifications.</div>
      )}

      {permission === "denied" && (
        <div className="sn-alert sn-alert--info">
          Permission refusée. Tu peux réactiver les notifications depuis les paramètres de ton navigateur.
        </div>
      )}

      {permission === "default" && (
        <div className="sn-alert sn-alert--info">🔔 Pour recevoir les rappels, active les notifications.</div>
      )}

      {permission !== "unsupported" && permission !== "denied" && (
        <button
          type="button"
          onClick={onEnable}
          disabled={isEnabling}
          className="sn-text-btn"
        >
          {isEnabling ? "Activation…" : "Activer les notifications"}
        </button>
      )}

      {pushStatus && <div className="text-xs text-muted-foreground">{pushStatus}</div>}
    </div>
  );
}
