const HTML_ENTITY_MAP: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&#39;": "'",
  "&quot;": '"',
};

function decodeBasicHtmlEntities(value: string): string {
  return value.replace(/&(nbsp|amp|lt|gt|#39|quot);/gi, (match) => {
    const key = match.toLowerCase();
    return HTML_ENTITY_MAP[key] ?? match;
  });
}

export function sanitizeAssistantText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;

  const normalized = value
    .replace(/\r\n?/g, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|ul|ol|section|article|blockquote|pre|tr)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");

  const decoded = decodeBasicHtmlEntities(normalized)
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return decoded || fallback;
}
