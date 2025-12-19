import React from "react";
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

async function renderOffscreen(node: React.ReactNode) {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = "210mm";
  host.style.background = "white";
  host.style.zIndex = "-1";
  document.body.appendChild(host);

  const root = createRoot(host);
  root.render(node);

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

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
  const [{ jsPDF }] = await Promise.all([import("jspdf")]);

  const doc = new jsPDF({ unit: "mm", format: "a4" });

  // Render HTML -> PDF. jsPDF.html relies on html2canvas being installed.
  await doc.html(element, {
    x: 0,
    y: 0,
    width: 210,
    windowWidth: element.scrollWidth,
    autoPaging: "text",
    html2canvas: {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
    },
  });

  const pageCount = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Footer + page numbers (kept minimal & consistent)
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);

  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);

    const footerY = pageHeight - 10;
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
      content={note.content ?? ""}
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
      description={(task as any).description ?? ""}
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
