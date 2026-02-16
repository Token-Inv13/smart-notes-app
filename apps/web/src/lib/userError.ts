type ErrorWithCode = {
  code?: unknown;
};

type UserErrorOptions = {
  allowMessages?: string[];
};

function getErrorCode(error: unknown): string {
  const raw = (error as ErrorWithCode | null | undefined)?.code;
  return typeof raw === "string" ? raw.toLowerCase() : "";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.trim();
  return "";
}

export function toUserErrorMessage(error: unknown, fallback: string, options?: UserErrorOptions): string {
  const code = getErrorCode(error);

  if (code.includes("unauthenticated") || code.includes("permission-denied")) {
    return "Session expirée ou accès refusé. Recharge la page et reconnecte-toi.";
  }
  if (code.includes("network-request-failed") || code.includes("unavailable") || code.includes("deadline-exceeded")) {
    return "Service temporairement indisponible. Réessaie dans quelques instants.";
  }
  if (code.includes("quota-exceeded") || code.includes("resource-exhausted")) {
    return "Limite temporairement atteinte. Réessaie plus tard.";
  }

  const message = getErrorMessage(error);
  if (message && Array.isArray(options?.allowMessages) && options.allowMessages.includes(message)) {
    return message;
  }

  return fallback;
}
