"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { sanitizeNoteHtml } from "@/lib/richText";
import DictationMicButton from "./DictationMicButton";

type TextSize = "sm" | "md" | "lg";

type Props = {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  minHeightClassName?: string;
  disabled?: boolean;
  allowHr?: boolean;
  enableDictation?: boolean;
};

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function ensureSelectionInside(root: HTMLElement) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const el = container.nodeType === Node.ELEMENT_NODE ? (container as Element) : container.parentElement;
  return !!el && root.contains(el);
}

function wrapSelectionWithSpanStyle(root: HTMLElement, style: Record<string, string>) {
  if (!isBrowser()) return;
  const sel = window.getSelection();
  if (!sel) return;

  if (!ensureSelectionInside(root)) {
    root.focus();
  }

  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);

  const span = document.createElement("span");
  for (const [k, v] of Object.entries(style)) {
    span.style.setProperty(k, v);
  }

  if (range.collapsed) {
    span.appendChild(document.createTextNode("\u200B"));
    range.insertNode(span);
    const nextRange = document.createRange();
    nextRange.setStart(span.firstChild as Text, 1);
    nextRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(nextRange);
    return;
  }

  const frag = range.extractContents();
  span.appendChild(frag);
  range.insertNode(span);
  sel.removeAllRanges();

  const nextRange = document.createRange();
  nextRange.selectNodeContents(span);
  nextRange.collapse(false);
  sel.addRange(nextRange);
}

function exec(root: HTMLElement, command: string, value?: string) {
  if (!isBrowser()) return;
  if (!ensureSelectionInside(root)) root.focus();
  try {
    document.execCommand(command, false, value);
  } catch {
    // ignore
  }
}

const textColors = [
  "#111827",
  "#2563EB",
  "#16A34A",
  "#DC2626",
  "#D97706",
  "#7C3AED",
  "#0F766E",
  "#475569",
];

const highlightColors = ["#FEF08A", "#BBF7D0", "#BFDBFE", "#FBCFE8"]; // yellow, green, blue, pink

export default function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeightClassName = "min-h-[160px]",
  disabled = false,
  allowHr = true,
  enableDictation = false,
}: Props) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastValueRef = useRef<string>("");
  const [hasFocus, setHasFocus] = useState(false);

  const [dictationStatus, setDictationStatus] = useState<"idle" | "listening" | "stopped" | "error">("idle");
  const [dictationError, setDictationError] = useState<string | null>(null);

  const safeValue = useMemo(() => sanitizeNoteHtml(value ?? "", { allowHr }), [allowHr, value]);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;

    if (hasFocus) {
      return;
    }

    if (el.innerHTML !== safeValue) {
      el.innerHTML = safeValue;
    }
    lastValueRef.current = safeValue;
  }, [hasFocus, safeValue]);

  const emitChange = () => {
    const el = editorRef.current;
    if (!el) return;
    const next = sanitizeNoteHtml(el.innerHTML, { allowHr });
    lastValueRef.current = next;
    onChange(next);
  };

  const applyTextSize = (size: TextSize) => {
    const el = editorRef.current;
    if (!el) return;

    const px = size === "sm" ? "0.875rem" : size === "lg" ? "1.125rem" : "1rem";
    wrapSelectionWithSpanStyle(el, { fontSize: px });
    emitChange();
  };

  const applyTextColor = (color: string) => {
    const el = editorRef.current;
    if (!el) return;
    wrapSelectionWithSpanStyle(el, { color });
    emitChange();
  };

  const applyHighlight = (color: string) => {
    const el = editorRef.current;
    if (!el) return;
    wrapSelectionWithSpanStyle(el, { backgroundColor: color });
    emitChange();
  };

  const handleCommand = (command: string) => {
    const el = editorRef.current;
    if (!el) return;
    exec(el, command);
    emitChange();
  };

  const handleInsertHr = () => {
    const el = editorRef.current;
    if (!el) return;
    exec(el, "insertHorizontalRule");
    emitChange();
  };

  const toolbarButtonClass =
    "px-2 py-1 rounded-md border border-input text-xs bg-background hover:bg-accent disabled:opacity-50";

  const insertDictationText = (rawText: string) => {
    const text = String(rawText ?? "").trim();
    if (!text) return;

    const root = editorRef.current;
    if (!root) return;

    if (!ensureSelectionInside(root)) {
      try {
        root.focus();
      } catch {
        // ignore
      }
    }

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      return;
    }

    const range = sel.getRangeAt(0);
    if (!root.contains(range.startContainer)) {
      return;
    }

    let prefix = "";
    try {
      const pre = range.cloneRange();
      pre.selectNodeContents(root);
      pre.setEnd(range.startContainer, range.startOffset);
      const prevChar = pre.toString().slice(-1);
      const needsLeadingSpace = Boolean(prevChar) && !/\s/.test(prevChar) && !/^[\s.,;:!?]/.test(text);
      prefix = needsLeadingSpace ? " " : "";
    } catch {
      // ignore
    }

    const insert = `${prefix}${text}`;
    try {
      range.deleteContents();
      const node = document.createTextNode(insert);
      range.insertNode(node);
      const next = document.createRange();
      next.setStartAfter(node);
      next.collapse(true);
      sel.removeAllRanges();
      sel.addRange(next);
    } catch {
      // ignore
    }

    emitChange();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap">
        <button type="button" disabled={disabled} className={toolbarButtonClass} onClick={() => handleCommand("bold")}>B</button>
        <button type="button" disabled={disabled} className={toolbarButtonClass} onClick={() => handleCommand("italic")}>I</button>
        <button type="button" disabled={disabled} className={toolbarButtonClass} onClick={() => handleCommand("underline")}>U</button>

        <div className="h-6 w-px bg-border" />

        <button type="button" disabled={disabled} className={toolbarButtonClass} onClick={() => applyTextSize("sm")}>Petit</button>
        <button type="button" disabled={disabled} className={toolbarButtonClass} onClick={() => applyTextSize("md")}>Normal</button>
        <button type="button" disabled={disabled} className={toolbarButtonClass} onClick={() => applyTextSize("lg")}>Grand</button>

        <div className="h-6 w-px bg-border" />

        <div className="flex items-center gap-1">
          {textColors.map((c) => (
            <button
              key={c}
              type="button"
              disabled={disabled}
              onClick={() => applyTextColor(c)}
              className="h-6 w-6 rounded-md border border-input"
              title="Couleur du texte"
              aria-label="Couleur du texte"
              style={{ backgroundColor: c }}
            />
          ))}
        </div>

        <div className="h-6 w-px bg-border" />

        <div className="flex items-center gap-1">
          {highlightColors.map((c) => (
            <button
              key={c}
              type="button"
              disabled={disabled}
              onClick={() => applyHighlight(c)}
              className="h-6 w-6 rounded-md border border-input"
              title="Surlignage"
              aria-label="Surlignage"
              style={{ backgroundColor: c }}
            />
          ))}
        </div>

        <div className="h-6 w-px bg-border" />

        <button type="button" disabled={disabled} className={toolbarButtonClass} onClick={() => handleCommand("insertUnorderedList")}>• Liste</button>
        <button type="button" disabled={disabled} className={toolbarButtonClass} onClick={() => handleCommand("insertOrderedList")}>1. Liste</button>

        <div className="h-6 w-px bg-border" />

        <button type="button" disabled={disabled || !allowHr} className={toolbarButtonClass} onClick={handleInsertHr}>
          —
        </button>

        {enableDictation ? (
          <>
            <div className="h-6 w-px bg-border" />
            <DictationMicButton
              disabled={disabled}
              onFinalText={(finalText) => insertDictationText(finalText)}
              onStatusChange={(st, err) => {
                setDictationStatus(st);
                setDictationError(err);
              }}
            />
          </>
        ) : null}
      </div>

      {enableDictation ? (
        dictationStatus === "listening" ? (
          <div className="text-xs text-muted-foreground">Écoute…</div>
        ) : dictationError ? (
          <div className="text-xs text-destructive">{dictationError}</div>
        ) : null
      ) : null}

      <div className="relative">
        {!hasFocus && !safeValue?.trim() && placeholder ? (
          <div className="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground">
            {placeholder}
          </div>
        ) : null}

        <div
          ref={editorRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          className={`w-full ${minHeightClassName} px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary sn-richtext-content`}
          onFocus={() => setHasFocus(true)}
          onBlur={() => {
            setHasFocus(false);
            emitChange();
          }}
          onInput={() => emitChange()}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
              e.preventDefault();
              handleCommand("bold");
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") {
              e.preventDefault();
              handleCommand("italic");
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "u") {
              e.preventDefault();
              handleCommand("underline");
            }
          }}
        />
      </div>
    </div>
  );
}
