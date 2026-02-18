const HTML_ENTITY_MAP: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&#39;": "'",
  "&apos;": "'",
  "&quot;": '"',
};

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&(nbsp|amp|lt|gt|#39|apos|quot);/gi, (match) => {
      const key = match.toLowerCase();
      return HTML_ENTITY_MAP[key] ?? match;
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = Number(dec);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
      return String.fromCodePoint(code);
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
      return String.fromCodePoint(code);
    });
}

function decodeEntitiesRecursively(value: string): string {
  let out = value;
  for (let i = 0; i < 3; i += 1) {
    const next = decodeBasicHtmlEntities(out);
    if (next === out) break;
    out = next;
  }
  return out;
}

export function sanitizeAssistantText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;

  const decodedFirst = decodeEntitiesRecursively(value.replace(/\r\n?/g, "\n"));

  const normalized = decodedFirst
    .replace(/<style[\s\S]*?(<\/style>|$)/gi, " ")
    .replace(/<script[\s\S]*?(<\/script>|$)/gi, " ")
    .replace(/<\s*(p|div|h[1-6]|section|article|blockquote|pre|tr|ul|ol)[^>]*>/gi, "\n")
    .replace(/<\s*\/?\s*li[^>]*>/gi, "\n- ")
    .replace(/<\s*\/\s*(p|div|h[1-6]|section|article|blockquote|pre|tr|ul|ol)\s*>/gi, "\n")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/?[a-z][^>\n]*>/gi, " ")
    .replace(/<\/?[a-z][^>\n]*$/gim, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/\n-\s*\n/g, "\n");

  const decoded = decodeEntitiesRecursively(normalized)
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return decoded || fallback;
}
