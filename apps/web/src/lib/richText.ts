export type RichTextSanitizeOptions = {
  allowHr?: boolean;
};

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

const allowedTags = new Set([
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "BR",
  "DIV",
  "P",
  "UL",
  "OL",
  "LI",
  "SPAN",
  "HR",
]);

function normalizeCssColor(input: string) {
  const v = input.trim();
  if (!v) return "";

  if (!isBrowser()) return v;

  const el = document.createElement("span");
  el.style.color = "";
  el.style.color = v;
  return el.style.color || v;
}

function extractAllowedInlineStyle(style: CSSStyleDeclaration) {
  const out: string[] = [];

  const color = normalizeCssColor(style.color || "");
  if (color) out.push(`color: ${color}`);

  const backgroundColor = normalizeCssColor(style.backgroundColor || "");
  if (backgroundColor) out.push(`background-color: ${backgroundColor}`);

  const fontSize = style.fontSize;
  if (fontSize) {
    const match = String(fontSize).match(/^(\d+(?:\.\d+)?)(px|rem|em|%)$/);
    if (match) out.push(`font-size: ${match[1]}${match[2]}`);
  }

  return out.join("; ");
}

function unwrapElement(el: Element) {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

export function sanitizeNoteHtml(html: string, opts?: RichTextSanitizeOptions) {
  const allowHr = opts?.allowHr !== false;

  if (!isBrowser()) {
    return String(html ?? "");
  }

  const container = document.createElement("div");
  container.innerHTML = String(html ?? "");

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT, null);
  const nodes: Element[] = [];
  let n = walker.nextNode();
  while (n) {
    nodes.push(n as Element);
    n = walker.nextNode();
  }

  for (const el of nodes) {
    const tag = el.tagName;
    if (!allowedTags.has(tag) || (!allowHr && tag === "HR")) {
      unwrapElement(el);
      continue;
    }

    const attrs = Array.from(el.attributes);
    for (const a of attrs) {
      if (a.name === "style") continue;
      el.removeAttribute(a.name);
    }

    if (tag === "SPAN") {
      const style = extractAllowedInlineStyle((el as HTMLElement).style);
      if (style) {
        el.setAttribute("style", style);
      } else {
        el.removeAttribute("style");
        unwrapElement(el);
      }
      continue;
    }

    if (tag === "DIV" || tag === "P" || tag === "LI") {
      const style = extractAllowedInlineStyle((el as HTMLElement).style);
      if (style) el.setAttribute("style", style);
      else el.removeAttribute("style");
      continue;
    }

    el.removeAttribute("style");
  }

  return container.innerHTML;
}

export function htmlToPlainText(html: string) {
  if (!isBrowser()) {
    return String(html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  }

  const container = document.createElement("div");
  container.innerHTML = String(html ?? "");
  const text = container.textContent ?? "";
  return text.replace(/\s+/g, " ").trim();
}

export function htmlToReadableText(html: string) {
  const raw = String(html ?? "");
  const normalized = raw
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|h1|h2|h3|h4|h5|h6)\s*>/gi, "\n")
    .replace(/<\s*hr\s*\/?>/gi, "\n---\n");

  if (!isBrowser()) {
    return normalized
      .replace(/<[^>]*>/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  const container = document.createElement("div");
  container.innerHTML = normalized;
  const text = container.textContent ?? "";
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
