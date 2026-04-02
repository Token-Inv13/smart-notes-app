const MOJIBAKE_PATTERN =
  /(\u00c3.|\u00c2|\u00e2\u20ac|\u00e2\u20ac\u2122|\u00e2\u20ac\u0153|\u00e2\u20ac\u009d|\u00e2\u20ac\u00a6|\u00e2\u20ac\u201c|\u00e2\u20ac\u201d|\u00e2\u201a\u00ac|\u00f0\u0178|\u00ef\u00b8|\ufffd|\u00c3\u0192|\u00c3\u00a2|\u00c3\u2030|\u00c3\u20ac|\u00c3\u00a9|\u00c3\u00a8|\u00c3\u00aa|\u00c3\u00a0|\u00c3\u00b9|\u00c3\u00a7)/;

function countMatches(input: string, pattern: RegExp) {
  const matches = input.match(new RegExp(pattern.source, "g"));
  return matches?.length ?? 0;
}

function looksLikeMojibake(input: string) {
  return MOJIBAKE_PATTERN.test(input);
}

function latin1BytesToUtf8(input: string) {
  try {
    const bytes = Uint8Array.from(Array.from(input), (char) => char.charCodeAt(0) & 0xff);
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return input;
  }
}

function scoreDecodedText(input: string) {
  const suspicious = countMatches(input, MOJIBAKE_PATTERN);
  const replacements = countMatches(input, /�/);
  const french = countMatches(input, /[\u00c0\u00c2\u00c7\u00c9\u00c8\u00ca\u00cb\u00ce\u00cf\u00d4\u00d9\u00db\u00dc\u00e0\u00e2\u00e7\u00e9\u00e8\u00ea\u00eb\u00ee\u00ef\u00f4\u00f9\u00fb\u00fc\u0153]/);
  return french - suspicious * 3 - replacements * 4;
}

export function normalizeDisplayText(value?: string | null) {
  if (typeof value !== "string") return "";
  if (!value) return value;

  const normalized = value.normalize("NFC");
  if (!looksLikeMojibake(normalized)) return normalized;

  const firstPass = latin1BytesToUtf8(normalized).normalize("NFC");
  const secondPass = looksLikeMojibake(firstPass) ? latin1BytesToUtf8(firstPass).normalize("NFC") : firstPass;
  const candidates = [normalized, firstPass, secondPass];

  return candidates.reduce((best, candidate) => {
    if (scoreDecodedText(candidate) > scoreDecodedText(best)) {
      return candidate;
    }
    return best;
  }, normalized);
}
