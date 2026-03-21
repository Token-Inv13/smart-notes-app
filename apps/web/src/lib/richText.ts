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

function mergeSiblingSpans(container: Element) {
  const spans = Array.from(container.querySelectorAll("span"));
  for (const span of spans) {
    let next = span.nextSibling;
    while (
      next &&
      next.nodeType === Node.ELEMENT_NODE &&
      (next as Element).tagName === "SPAN" &&
      ((next as HTMLElement).getAttribute("style") || "") === ((span as HTMLElement).getAttribute("style") || "")
    ) {
      while (next.firstChild) {
        span.appendChild(next.firstChild);
      }
      const current = next;
      next = next.nextSibling;
      current.parentNode?.removeChild(current);
    }
  }
}

function unwrapNestedSpans(container: Element) {
  const spans = Array.from(container.querySelectorAll("span"));
  for (const span of spans) {
    const parent = span.parentElement;
    if (!parent || parent.tagName !== "SPAN") continue;
    const parentStyle = parent.getAttribute("style") || "";
    const spanStyle = span.getAttribute("style") || "";
    if (parentStyle !== spanStyle) continue;
    while (span.firstChild) {
      parent.insertBefore(span.firstChild, span);
    }
    parent.removeChild(span);
  }
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

  mergeSiblingSpans(container);
  unwrapNestedSpans(container);

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

export function htmlToMarkdown(html: string) {
  const normalizeLineBreaks = (input: string) =>
    input
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  if (!isBrowser()) {
    return normalizeLineBreaks(
      String(html ?? "")
        .replace(/<\s*br\s*\/?>/gi, "\n")
        .replace(/<\s*hr\s*\/?>/gi, "\n---\n")
        .replace(/<\s*\/\s*(p|div)\s*>/gi, "\n\n")
        .replace(/<\s*li[^>]*>/gi, "- ")
        .replace(/<\s*\/\s*li\s*>/gi, "\n")
        .replace(/<\s*(strong|b)\s*>/gi, "**")
        .replace(/<\s*\/\s*(strong|b)\s*>/gi, "**")
        .replace(/<\s*(em|i)\s*>/gi, "_")
        .replace(/<\s*\/\s*(em|i)\s*>/gi, "_")
        .replace(/<\s*u\s*>/gi, "__")
        .replace(/<\s*\/\s*u\s*>/gi, "__")
        .replace(/<[^>]*>/g, "")
    );
  }

  const container = document.createElement("div");
  container.innerHTML = sanitizeNoteHtml(String(html ?? ""));

  const renderChildren = (node: Node, ctx?: { listDepth?: number; orderedIndex?: number[] }): string => {
    return Array.from(node.childNodes)
      .map((child, index) => renderNode(child, { listDepth: ctx?.listDepth ?? 0, orderedIndex: ctx?.orderedIndex, childIndex: index }))
      .join("");
  };

  const renderNode = (
    node: Node,
    ctx?: { listDepth?: number; orderedIndex?: number[]; childIndex?: number },
  ): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent ?? "").replace(/\s+/g, " ");
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const el = node as HTMLElement;
    const tag = el.tagName;

    if (tag === "BR") return "\n";
    if (tag === "HR") return "\n---\n";
    if (tag === "STRONG" || tag === "B") return `**${renderChildren(el, ctx).trim()}**`;
    if (tag === "EM" || tag === "I") return `_${renderChildren(el, ctx).trim()}_`;
    if (tag === "U") return `__${renderChildren(el, ctx).trim()}__`;

    if (tag === "SPAN") {
      return renderChildren(el, ctx);
    }

    if (tag === "DIV" || tag === "P") {
      const body = normalizeLineBreaks(renderChildren(el, ctx));
      return body ? `${body}\n\n` : "";
    }

    if (tag === "UL") {
      const body = Array.from(el.children)
        .filter((child) => child.tagName === "LI")
        .map((child) => renderNode(child, { listDepth: (ctx?.listDepth ?? 0) + 1 }))
        .join("");
      return body ? `${body}\n` : "";
    }

    if (tag === "OL") {
      const body = Array.from(el.children)
        .filter((child) => child.tagName === "LI")
        .map((child, index) =>
          renderNode(child, {
            listDepth: (ctx?.listDepth ?? 0) + 1,
            orderedIndex: [...(ctx?.orderedIndex ?? []), index + 1],
          }),
        )
        .join("");
      return body ? `${body}\n` : "";
    }

    if (tag === "LI") {
      const depth = Math.max(0, (ctx?.listDepth ?? 1) - 1);
      const indent = "  ".repeat(depth);
      const orderedMarker = ctx?.orderedIndex?.[ctx.orderedIndex.length - 1];
      const marker = orderedMarker ? `${orderedMarker}. ` : "- ";
      const body = normalizeLineBreaks(renderChildren(el, ctx));
      if (!body) return "";
      const lines = body.split("\n");
      return `${indent}${marker}${lines[0]}${lines
        .slice(1)
        .map((line) => `\n${indent}  ${line}`)
        .join("")}\n`;
    }

    return renderChildren(el, ctx);
  };

  return normalizeLineBreaks(renderChildren(container));
}
