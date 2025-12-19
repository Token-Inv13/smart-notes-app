import React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { NoteDoc, TaskDoc } from "@/types/firestore";
import NotePdfTemplate from "./templates/NotePdfTemplate";
import TaskPdfTemplate from "./templates/TaskPdfTemplate";

function sanitizeFilename(raw: string) {
  const base = String(raw ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return base || "sans-titre";
}

function formatFrDateTime(ts?: any | null) {
  if (!ts) return null;
  const d = typeof ts?.toDate === "function" ? ts.toDate() : new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function statusLabelFr(s?: TaskDoc["status"] | null) {
  if (s === "doing") return "En cours";
  if (s === "done") return "Terminée";
  return "À faire";
}

function sanitizeExportBody(raw: string) {
  const lines = String(raw ?? "").split("\n");
  const cleaned: string[] = [];

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      cleaned.push(line);
      continue;
    }

    if (/^texte pr[êe]t [àa] copier\s*:?$/i.test(t)) continue;
    if (/^bouton\s+"?partager smart notes"?/i.test(t)) continue;
    if (/^partage\s+dans\s+l['’]app/i.test(t)) continue;
    if (/^cr[ée]e?\s+avec\s+smart\s+notes/i.test(t)) continue;
    if (/^export[ée]\s+depuis\s+smart\s+notes/i.test(t)) continue;
    if (/^bonus$/i.test(t)) continue;

    cleaned.push(line);
  }

  return cleaned.join("\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

async function renderOffscreen(node: React.ReactNode) {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "0";
  host.style.top = "0";
  host.style.width = "210mm";
  host.style.background = "white";
  host.style.pointerEvents = "none";
  host.style.zIndex = "-9999";
  document.body.appendChild(host);

  const root = createRoot(host);
  flushSync(() => {
    root.render(node);
  });

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  // Wait for fonts (best-effort)
  try {
    await (document as any).fonts?.ready;
  } catch {
    // ignore
  }

  // Wait for images inside template (logo)
  const imgs = Array.from(host.querySelectorAll("img"));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if ((img as HTMLImageElement).complete) return resolve();
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        })
    )
  );

  return {
    element: host,
    cleanup: () => {
      try {
        root.unmount();
      } finally {
        host.remove();
      }
    },
  };
}

async function buildPdfFromElement(element: HTMLElement) {
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import("jspdf"), import("html2canvas")]);

  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
    windowWidth: element.scrollWidth || 794,
  });

  const pageWidthMm = 210;
  const pageHeightMm = 297;
  const footerReserveMm = 22;
  const printableHeightMm = pageHeightMm - footerReserveMm;

  const mmPerPx = pageWidthMm / canvas.width;
  const sliceHeightPx = Math.floor(printableHeightMm / mmPerPx);

  let pageIndex = 0;
  for (let sy = 0; sy < canvas.height; sy += sliceHeightPx) {
    const sh = Math.min(sliceHeightPx, canvas.height - sy);
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = canvas.width;
    pageCanvas.height = sh;

    const ctx = pageCanvas.getContext("2d");
    if (!ctx) throw new Error("Canvas non supporté.");

    ctx.drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);

    const imgData = pageCanvas.toDataURL("image/png");
    const imgHeightMm = sh * mmPerPx;

    if (pageIndex > 0) doc.addPage();
    doc.addImage(imgData, "PNG", 0, 0, pageWidthMm, imgHeightMm);
    pageIndex += 1;
  }

  const pageCount = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Footer + page numbers (kept minimal & consistent)
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);

  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);

    const footerY = pageHeight - 6;
    doc.text("Exporté depuis Smart Notes — app.tachesnotes.com", 20, footerY);
    doc.text(`${i}/${pageCount}`, pageWidth - 20, footerY, { align: "right" });
  }

  return doc;
}

export async function exportNotePdf(note: NoteDoc, workspaceName: string | null) {
  const exportDate = new Date();
  const exportDateLabel = exportDate.toLocaleString("fr-FR", {
    year: "numeric",
    month: "long",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const { element, cleanup } = await renderOffscreen(
    <NotePdfTemplate
      title={note.title ?? "Sans titre"}
      workspaceName={workspaceName}
      createdAtLabel={formatFrDateTime(note.createdAt)}
      updatedAtLabel={formatFrDateTime(note.updatedAt)}
      content={sanitizeExportBody(note.content ?? "")}
      exportDateLabel={exportDateLabel}
    />
  );

  try {
    const doc = await buildPdfFromElement(element);
    doc.save(`smartnotes-note-${sanitizeFilename(note.title ?? "")}.pdf`);
  } finally {
    cleanup();
  }
}

export async function exportTaskPdf(task: TaskDoc, workspaceName: string | null) {
  const exportDate = new Date();
  const exportDateLabel = exportDate.toLocaleString("fr-FR", {
    year: "numeric",
    month: "long",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const { element, cleanup } = await renderOffscreen(
    <TaskPdfTemplate
      title={task.title ?? "Sans titre"}
      workspaceName={workspaceName}
      statusLabel={statusLabelFr(task.status)}
      dueDateLabel={formatFrDateTime(task.dueDate)}
      createdAtLabel={formatFrDateTime((task as any).createdAt)}
      updatedAtLabel={formatFrDateTime((task as any).updatedAt)}
      description={sanitizeExportBody((task as any).description ?? "")}
      exportDateLabel={exportDateLabel}
    />
  );

  try {
    const doc = await buildPdfFromElement(element);
    doc.save(`smartnotes-task-${sanitizeFilename(task.title ?? "")}.pdf`);
  } finally {
    cleanup();
  }
}
