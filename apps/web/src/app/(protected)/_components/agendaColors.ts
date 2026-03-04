type FolderColorPaletteEntry = {
  backgroundColor: string;
  borderColor: string;
};

const FOLDER_COLOR_PALETTE: readonly FolderColorPaletteEntry[] = [
  { backgroundColor: "#0ea5e9", borderColor: "#0369a1" },
  { backgroundColor: "#2563eb", borderColor: "#1d4ed8" },
  { backgroundColor: "#10b981", borderColor: "#047857" },
  { backgroundColor: "#14b8a6", borderColor: "#0f766e" },
  { backgroundColor: "#84cc16", borderColor: "#4d7c0f" },
  { backgroundColor: "#f59e0b", borderColor: "#b45309" },
  { backgroundColor: "#f97316", borderColor: "#c2410c" },
  { backgroundColor: "#ef4444", borderColor: "#b91c1c" },
  { backgroundColor: "#06b6d4", borderColor: "#0e7490" },
  { backgroundColor: "#6366f1", borderColor: "#4338ca" },
];

const DEFAULT_FOLDER_COLOR: FolderColorPaletteEntry = {
  backgroundColor: "#94a3b8",
  borderColor: "#64748b",
};

export type FolderColorResult = FolderColorPaletteEntry & {
  textColor: "#0f172a" | "#ffffff";
  textTone: "dark" | "light";
};

function hashFolderKey(value: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function parseHexChannel(hex: string, start: number) {
  return Number.parseInt(hex.slice(start, start + 2), 16);
}

function toRelativeLuminance(hexColor: string) {
  const red = parseHexChannel(hexColor, 1) / 255;
  const green = parseHexChannel(hexColor, 3) / 255;
  const blue = parseHexChannel(hexColor, 5) / 255;

  const linearize = (channel: number) =>
    channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);

  return 0.2126 * linearize(red) + 0.7152 * linearize(green) + 0.0722 * linearize(blue);
}

export function getFolderColor(folderId?: string | null, folderName?: string | null): FolderColorResult {
  const normalizedId = typeof folderId === "string" ? folderId.trim() : "";
  const normalizedName = typeof folderName === "string" ? folderName.trim().toLowerCase() : "";
  const key = normalizedId || normalizedName;
  const paletteEntry = key
    ? FOLDER_COLOR_PALETTE[hashFolderKey(key) % FOLDER_COLOR_PALETTE.length] ?? DEFAULT_FOLDER_COLOR
    : DEFAULT_FOLDER_COLOR;
  const textColor = toRelativeLuminance(paletteEntry.backgroundColor) < 0.45 ? "#ffffff" : "#0f172a";

  return {
    ...paletteEntry,
    textColor,
    textTone: textColor === "#ffffff" ? "light" : "dark",
  };
}
