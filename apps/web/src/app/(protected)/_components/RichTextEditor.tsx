"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
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

type ToolbarState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  unorderedList: boolean;
  orderedList: boolean;
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

const blockStyleTags = new Set(["DIV", "P", "LI"]);
const structuralTags = new Set(["DIV", "P", "UL", "OL", "LI", "HR"]);

function toCssPropertyName(name: string) {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function applyStyleToElement(el: HTMLElement, style: Record<string, string>) {
  for (const [k, v] of Object.entries(style)) {
    el.style.setProperty(toCssPropertyName(k), v);
  }
}

function fragmentHasStructuralNodes(fragment: DocumentFragment) {
  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_ELEMENT, null);
  let node = walker.nextNode();
  while (node) {
    if (structuralTags.has((node as Element).tagName)) {
      return true;
    }
    node = walker.nextNode();
  }
  return false;
}

function wrapTextNodeWithStyle(textNode: Text, style: Record<string, string>) {
  const value = textNode.textContent ?? "";
  if (!value.trim()) return;

  const span = document.createElement("span");
  applyStyleToElement(span, style);
  textNode.parentNode?.insertBefore(span, textNode);
  span.appendChild(textNode);
}

function normalizeStyledFragment(fragment: DocumentFragment, style: Record<string, string>) {
  const styledBlocks = new Set<Element>();
  const blockWalker = document.createTreeWalker(fragment, NodeFilter.SHOW_ELEMENT, null);
  let blockNode = blockWalker.nextNode();
  while (blockNode) {
    const el = blockNode as HTMLElement;
    if (blockStyleTags.has(el.tagName)) {
      applyStyleToElement(el, style);
      styledBlocks.add(el);
    }
    blockNode = blockWalker.nextNode();
  }

  const textNodes: Text[] = [];
  const textWalker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT, null);
  let textNode = textWalker.nextNode();
  while (textNode) {
    textNodes.push(textNode as Text);
    textNode = textWalker.nextNode();
  }

  for (const node of textNodes) {
    const parent = node.parentElement;
    if (!parent) continue;
    if (Array.from(styledBlocks).some((block) => block.contains(node))) {
      continue;
    }
    if (parent.tagName === "SPAN") {
      applyStyleToElement(parent, style);
      continue;
    }
    wrapTextNodeWithStyle(node, style);
  }
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
  applyStyleToElement(span, style);

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
  if (fragmentHasStructuralNodes(frag)) {
    normalizeStyledFragment(frag, style);
    range.insertNode(frag);
  } else {
    span.appendChild(frag);
    range.insertNode(span);
  }
  sel.removeAllRanges();

  const nextRange = document.createRange();
  const target = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? (range.commonAncestorContainer as Element)
    : range.commonAncestorContainer.parentElement;
  nextRange.selectNodeContents(target ?? root);
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

function getSelectionAnchorElement(root: HTMLElement) {
  if (!isBrowser()) return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const el = container.nodeType === Node.ELEMENT_NODE ? (container as Element) : container.parentElement;
  if (!el || !root.contains(el)) return null;
  return el;
}

function readToolbarState(root: HTMLElement): ToolbarState {
  if (!isBrowser()) {
    return {
      bold: false,
      italic: false,
      underline: false,
      unorderedList: false,
      orderedList: false,
    };
  }

  const anchor = getSelectionAnchorElement(root);
  if (!anchor) {
    return {
      bold: false,
      italic: false,
      underline: false,
      unorderedList: false,
      orderedList: false,
    };
  }

  const safeQueryState = (command: string) => {
    try {
      return document.queryCommandState(command);
    } catch {
      return false;
    }
  };

  return {
    bold: safeQueryState("bold"),
    italic: safeQueryState("italic"),
    underline: safeQueryState("underline"),
    unorderedList: safeQueryState("insertUnorderedList") || Boolean(anchor.closest("ul")),
    orderedList: safeQueryState("insertOrderedList") || Boolean(anchor.closest("ol")),
  };
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
  const [toolbarState, setToolbarState] = useState<ToolbarState>({
    bold: false,
    italic: false,
    underline: false,
    unorderedList: false,
    orderedList: false,
  });

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

  const syncToolbarState = useCallback(() => {
    const el = editorRef.current;
    if (!el || !hasFocus) {
      setToolbarState({
        bold: false,
        italic: false,
        underline: false,
        unorderedList: false,
        orderedList: false,
      });
      return;
    }

    setToolbarState((prev) => {
      const next = readToolbarState(el);
      if (
        prev.bold === next.bold &&
        prev.italic === next.italic &&
        prev.underline === next.underline &&
        prev.unorderedList === next.unorderedList &&
        prev.orderedList === next.orderedList
      ) {
        return prev;
      }
      return next;
    });
  }, [hasFocus]);

  useEffect(() => {
    if (!isBrowser()) return;

    const handleSelectionChange = () => {
      syncToolbarState();
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [syncToolbarState]);

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
    syncToolbarState();
  };

  const preventToolbarFocusSteal = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  };

  const handleInsertHr = () => {
    const el = editorRef.current;
    if (!el) return;
    exec(el, "insertHorizontalRule");
    emitChange();
    syncToolbarState();
  };

  const toolbarButtonClass =
    "px-2 py-1 rounded-md border border-input text-xs bg-background hover:bg-accent disabled:opacity-50";
  const activeToolbarButtonClass = "bg-accent text-foreground border-primary/40 ring-1 ring-primary/20";

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
    <div className="min-w-0 max-w-full space-y-2">
      <div className="flex min-w-0 max-w-full items-center gap-2 overflow-x-auto whitespace-nowrap">
        <button
          type="button"
          disabled={disabled}
          className={`${toolbarButtonClass} ${toolbarState.bold ? activeToolbarButtonClass : ""}`}
          aria-pressed={toolbarState.bold}
          onMouseDown={preventToolbarFocusSteal}
          onClick={() => handleCommand("bold")}
        >
          B
        </button>
        <button
          type="button"
          disabled={disabled}
          className={`${toolbarButtonClass} ${toolbarState.italic ? activeToolbarButtonClass : ""}`}
          aria-pressed={toolbarState.italic}
          onMouseDown={preventToolbarFocusSteal}
          onClick={() => handleCommand("italic")}
        >
          I
        </button>
        <button
          type="button"
          disabled={disabled}
          className={`${toolbarButtonClass} ${toolbarState.underline ? activeToolbarButtonClass : ""}`}
          aria-pressed={toolbarState.underline}
          onMouseDown={preventToolbarFocusSteal}
          onClick={() => handleCommand("underline")}
        >
          U
        </button>

        <div className="h-6 w-px bg-border" />

        <button type="button" disabled={disabled} className={toolbarButtonClass} onMouseDown={preventToolbarFocusSteal} onClick={() => applyTextSize("sm")}>Petit</button>
        <button type="button" disabled={disabled} className={toolbarButtonClass} onMouseDown={preventToolbarFocusSteal} onClick={() => applyTextSize("md")}>Normal</button>
        <button type="button" disabled={disabled} className={toolbarButtonClass} onMouseDown={preventToolbarFocusSteal} onClick={() => applyTextSize("lg")}>Grand</button>

        <div className="h-6 w-px bg-border" />

        <div className="flex items-center gap-1">
          {textColors.map((c) => (
            <button
              key={c}
              type="button"
              disabled={disabled}
              onMouseDown={preventToolbarFocusSteal}
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
              onMouseDown={preventToolbarFocusSteal}
              onClick={() => applyHighlight(c)}
              className="h-6 w-6 rounded-md border border-input"
              title="Surlignage"
              aria-label="Surlignage"
              style={{ backgroundColor: c }}
            />
          ))}
        </div>

        <div className="h-6 w-px bg-border" />

        <button
          type="button"
          disabled={disabled}
          className={`${toolbarButtonClass} ${toolbarState.unorderedList ? activeToolbarButtonClass : ""}`}
          aria-pressed={toolbarState.unorderedList}
          onMouseDown={preventToolbarFocusSteal}
          onClick={() => handleCommand("insertUnorderedList")}
        >
          • Liste
        </button>
        <button
          type="button"
          disabled={disabled}
          className={`${toolbarButtonClass} ${toolbarState.orderedList ? activeToolbarButtonClass : ""}`}
          aria-pressed={toolbarState.orderedList}
          onMouseDown={preventToolbarFocusSteal}
          onClick={() => handleCommand("insertOrderedList")}
        >
          1. Liste
        </button>

        <div className="h-6 w-px bg-border" />

        <button type="button" disabled={disabled || !allowHr} className={toolbarButtonClass} onMouseDown={preventToolbarFocusSteal} onClick={handleInsertHr}>
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

      <div className="relative min-w-0 max-w-full">
        {!hasFocus && !safeValue?.trim() && placeholder ? (
          <div className="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground">
            {placeholder}
          </div>
        ) : null}

        <div
          ref={editorRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          className={`min-w-0 max-w-full w-full ${minHeightClassName} px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary sn-richtext-content`}
          onFocus={() => {
            setHasFocus(true);
            syncToolbarState();
          }}
          onBlur={() => {
            setHasFocus(false);
            emitChange();
            syncToolbarState();
          }}
          onInput={() => {
            emitChange();
            syncToolbarState();
          }}
          onMouseUp={() => syncToolbarState()}
          onKeyUp={() => syncToolbarState()}
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
