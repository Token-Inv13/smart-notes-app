import React from "react";

type Props = {
  title: string;
  workspaceName: string | null;
  statusLabel: string;
  dueDateLabel: string | null;
  createdAtLabel: string | null;
  updatedAtLabel: string | null;
  description: string;
  exportDateLabel: string;
};

export default function TaskPdfTemplate(props: Props) {
  const {
    title,
    workspaceName,
    statusLabel,
    dueDateLabel,
    createdAtLabel,
    updatedAtLabel,
    description,
    exportDateLabel,
  } = props;

  return (
    <div className="sn-pdf">
      <style>{`
        .sn-pdf {
          font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
          color: #0f172a;
          width: 210mm;
          background: #ffffff;
        }

        .sn-pdf * {
          box-sizing: border-box;
        }

        .sn-pdf .page {
          padding: 20mm 20mm 26mm;
          min-height: 297mm;
        }

        .sn-pdf .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12mm;
          padding-bottom: 6mm;
          border-bottom: 1px solid #e2e8f0;
        }

        .sn-pdf .brand {
          display: flex;
          align-items: center;
          gap: 4mm;
          min-width: 0;
        }

        .sn-pdf .logo-wrap {
          flex-shrink: 0;
          width: 12mm;
          height: 12mm;
          overflow: hidden;
          border-radius: 3mm;
        }

        .sn-pdf .logo {
          width: 12mm;
          height: 12mm;
          display: block;
          object-fit: contain;
        }

        .sn-pdf .brand-text {
          display: flex;
          flex-direction: column;
          line-height: 1.1;
          min-width: 0;
        }

        .sn-pdf .brand-name {
          font-size: 12pt;
          font-weight: 700;
          color: #0f172a;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .sn-pdf .brand-sub {
          font-size: 9.5pt;
          color: #64748b;
          white-space: nowrap;
        }

        .sn-pdf .meta {
          text-align: right;
          font-size: 10pt;
          color: #64748b;
          white-space: nowrap;
        }

        .sn-pdf h1 {
          font-size: 20pt;
          line-height: 1.2;
          margin: 10mm 0 4mm;
          overflow-wrap: anywhere;
          word-break: break-word;
        }

        .sn-pdf .kv {
          display: grid;
          grid-template-columns: 42mm 1fr;
          gap: 2mm 6mm;
          padding: 6mm;
          border: 1px solid #e2e8f0;
          border-radius: 3mm;
          background: #f8fafc;
          margin-bottom: 10mm;
        }

        .sn-pdf .k {
          font-size: 10pt;
          color: #64748b;
        }

        .sn-pdf .v {
          font-size: 10.5pt;
          color: #0f172a;
          overflow-wrap: anywhere;
          word-break: break-word;
        }

        .sn-pdf .section-title {
          font-size: 12pt;
          margin: 0 0 4mm;
          color: #0f172a;
        }

        .sn-pdf .content {
          font-size: 11pt;
          line-height: 1.65;
          color: #0f172a;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          word-break: break-word;
        }

        .sn-pdf .content p,
        .sn-pdf .content ul,
        .sn-pdf .content ol,
        .sn-pdf .content li,
        .sn-pdf .content pre,
        .sn-pdf .content blockquote {
          break-inside: avoid;
          page-break-inside: avoid;
        }

        @media print {
          .sn-pdf .page {
            padding: 20mm 20mm 26mm;
          }
        }
      `}</style>

      <div className="page">
        <div className="header">
          <div className="brand">
            <div className="logo-wrap">
              <img className="logo" src="/logo-icon.svg" alt="Smart Notes" />
            </div>
            <div className="brand-text">
              <div className="brand-name">Smart Notes</div>
              <div className="brand-sub">app.tachesnotes.com</div>
            </div>
          </div>
          <div className="meta">Exporté le {exportDateLabel}</div>
        </div>

        <h1>{title || "Sans titre"}</h1>

        <div className="kv">
          <div className="k">Statut</div>
          <div className="v">{statusLabel}</div>

          <div className="k">Échéance</div>
          <div className="v">{dueDateLabel || "—"}</div>

          <div className="k">Dossier</div>
          <div className="v">{workspaceName || "—"}</div>

          <div className="k">Créée le</div>
          <div className="v">{createdAtLabel || "—"}</div>

          <div className="k">Dernière mise à jour</div>
          <div className="v">{updatedAtLabel || "—"}</div>
        </div>

        <h2 className="section-title">Description</h2>
        <div className="content">{description || ""}</div>
      </div>
    </div>
  );
}
