export type VoiceCaptureStage =
  | "media_devices"
  | "get_user_media"
  | "permissions"
  | "media_recorder"
  | "mime_type"
  | "media_recorder_init"
  | "capture_start";

export type VoiceCaptureErrorCode =
  | "media_devices_unavailable"
  | "get_user_media_unavailable"
  | "permission_denied"
  | "microphone_not_found"
  | "microphone_not_readable"
  | "media_recorder_unavailable"
  | "mime_type_not_supported"
  | "media_recorder_init_failed"
  | "capture_start_failed"
  | "microphone_init_failed";

export type VoiceCaptureErrorDetail = {
  code: VoiceCaptureErrorCode;
  stage: VoiceCaptureStage;
  message: string;
  permissionState?: "granted" | "denied" | "prompt" | "unsupported" | "error";
  causeName?: string;
  causeMessage?: string;
  requestedMimeType?: string;
};

const MIME_TYPE_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
] as const;

const normalizeCause = (err: unknown): { causeName?: string; causeMessage?: string } => {
  if (err instanceof DOMException) {
    return { causeName: err.name || undefined, causeMessage: err.message || undefined };
  }
  if (err instanceof Error) {
    return { causeName: err.name || undefined, causeMessage: err.message || undefined };
  }
  if (typeof err === "string") {
    return { causeMessage: err };
  }
  return {};
};

export async function getMicrophonePermissionState(): Promise<"granted" | "denied" | "prompt" | "unsupported" | "error"> {
  if (typeof window === "undefined") return "unsupported";
  if (!("permissions" in navigator) || typeof navigator.permissions?.query !== "function") {
    return "unsupported";
  }

  try {
    const result = await navigator.permissions.query({ name: "microphone" as PermissionName });
    if (result.state === "granted" || result.state === "denied" || result.state === "prompt") {
      return result.state;
    }
    return "unsupported";
  } catch {
    return "error";
  }
}

export function pickSupportedRecordingMimeType(): { selectedMimeType: string; supportedMimeTypes: string[] } {
  if (typeof window === "undefined" || typeof window.MediaRecorder === "undefined") {
    return { selectedMimeType: "", supportedMimeTypes: [] };
  }

  const mediaRecorder = window.MediaRecorder as unknown as { isTypeSupported?: (value: string) => boolean };
  const can = (value: string) => Boolean(mediaRecorder.isTypeSupported?.(value));
  const supportedMimeTypes = MIME_TYPE_CANDIDATES.filter(can);
  return { selectedMimeType: supportedMimeTypes[0] ?? "", supportedMimeTypes };
}

export function buildVoiceCaptureError(
  code: VoiceCaptureErrorCode,
  stage: VoiceCaptureStage,
  err?: unknown,
  extras?: Partial<VoiceCaptureErrorDetail>,
): VoiceCaptureErrorDetail {
  const cause = normalizeCause(err);
  return {
    code,
    stage,
    message: voiceCaptureErrorMessage(code),
    ...cause,
    ...extras,
  };
}

export function classifyGetUserMediaError(err: unknown): VoiceCaptureErrorDetail {
  const cause = normalizeCause(err);
  const raw = `${cause.causeName ?? ""} ${cause.causeMessage ?? ""}`.toLowerCase();

  if (raw.includes("notallowed") || raw.includes("permission") || raw.includes("denied") || raw.includes("security")) {
    return {
      ...cause,
      code: "permission_denied",
      stage: "get_user_media",
      message: voiceCaptureErrorMessage("permission_denied"),
    };
  }

  if (raw.includes("notfound") || raw.includes("device not found") || raw.includes("requested device not found")) {
    return {
      ...cause,
      code: "microphone_not_found",
      stage: "get_user_media",
      message: voiceCaptureErrorMessage("microphone_not_found"),
    };
  }

  if (raw.includes("notreadable") || raw.includes("trackstart") || raw.includes("could not start audio source") || raw.includes("aborterror")) {
    return {
      ...cause,
      code: "microphone_not_readable",
      stage: "get_user_media",
      message: voiceCaptureErrorMessage("microphone_not_readable"),
    };
  }

  return {
    ...cause,
    code: "microphone_init_failed",
    stage: "get_user_media",
    message: voiceCaptureErrorMessage("microphone_init_failed"),
  };
}

export function voiceCaptureErrorMessage(code: VoiceCaptureErrorCode): string {
  if (code === "media_devices_unavailable") return "Le micro n'est pas accessible sur ce navigateur (mediaDevices indisponible).";
  if (code === "get_user_media_unavailable") return "L'enregistrement audio n'est pas disponible sur ce navigateur.";
  if (code === "permission_denied") return "L'autorisation du micro a été refusée.";
  if (code === "microphone_not_found") return "Aucun micro n'a été détecté sur cet appareil.";
  if (code === "microphone_not_readable") return "Impossible d'initialiser le micro (déjà utilisé ou bloqué par le système).";
  if (code === "media_recorder_unavailable") return "L'enregistrement audio n'est pas disponible sur ce navigateur.";
  if (code === "mime_type_not_supported") return "Le format audio demandé n'est pas supporté sur cet appareil.";
  if (code === "media_recorder_init_failed") return "Impossible d'initialiser l'enregistreur audio.";
  if (code === "capture_start_failed") return "Impossible de démarrer la capture audio.";
  return "Impossible d'initialiser le micro.";
}

export function reportVoiceCaptureError(scope: string, detail: VoiceCaptureErrorDetail) {
  console.error(`${scope}.voice_capture_failed`, {
    stage: detail.stage,
    code: detail.code,
    permissionState: detail.permissionState ?? null,
    requestedMimeType: detail.requestedMimeType ?? null,
    causeName: detail.causeName ?? null,
    causeMessage: detail.causeMessage ?? null,
  });
}
