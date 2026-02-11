export function insertTextAtSelection(params: {
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  text: string;
}): { nextValue: string; nextCursor: number } {
  const base = String(params.value ?? "");
  const insert = String(params.text ?? "");

  const start = typeof params.selectionStart === "number" && params.selectionStart >= 0 ? params.selectionStart : base.length;
  const end = typeof params.selectionEnd === "number" && params.selectionEnd >= 0 ? params.selectionEnd : start;

  const safeStart = Math.min(Math.max(start, 0), base.length);
  const safeEnd = Math.min(Math.max(end, safeStart), base.length);

  const nextValue = base.slice(0, safeStart) + insert + base.slice(safeEnd);
  const nextCursor = safeStart + insert.length;
  return { nextValue, nextCursor };
}

export function prepareDictationTextForInsertion(params: {
  value: string;
  selectionStart: number | null;
  rawText: string;
}): string {
  const base = String(params.value ?? "");
  const raw = String(params.rawText ?? "");
  const text = raw.trim();
  if (!text) return "";

  const start =
    typeof params.selectionStart === "number" && params.selectionStart >= 0
      ? params.selectionStart
      : base.length;
  const safeStart = Math.min(Math.max(start, 0), base.length);
  const prevChar = safeStart > 0 ? base.charAt(safeStart - 1) : "";

  const needsLeadingSpace = Boolean(prevChar) && !/\s/.test(prevChar) && !/^[\s.,;:!?]/.test(text);
  return `${needsLeadingSpace ? " " : ""}${text}`;
}
