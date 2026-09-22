// ===============================================================
// Report exports — CSV download, styled PDF, and print.
//
// The data handed to every export is the same permission-scoped
// ReportsData the page renders (from the `reports.get` query), so a
// user can never export more than they are permitted to see.
// ===============================================================

import { jsPDF } from "jspdf";

export type ReportRow = Record<string, string | number | null>;

/** Escape a single CSV cell: quotes doubled, formula-injection guarded. */
function csvCell(value: string | number | null): string {
  let s = value === null || value === undefined ? "" : String(value);
  // Neutralise spreadsheet formula injection (=, +, -, @ prefixed cells).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function rowsToCsv(rows: ReportRow[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]!);
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvCell(row[h] ?? null)).join(","));
  }
  return lines.join("\r\n");
}

export function downloadCsv(filename: string, rows: ReportRow[]): void {
  const csv = rowsToCsv(rows);
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------
// PDF (jsPDF, matching the chamber's navy/gold identity)
// ---------------------------------------------------------------

const NAVY: [number, number, number] = [15, 23, 42];
const GOLD: [number, number, number] = [182, 138, 69];
const SLATE: [number, number, number] = [100, 116, 139];
const RULE: [number, number, number] = [229, 231, 235];
const MARGIN = 14;
const PAGE_W = 210;
const PAGE_H = 297;
const CONTENT_W = PAGE_W - MARGIN * 2;

function safe(s: string, max = 180): string {
  // eslint-disable-next-line no-control-regex -- stripping controls is the purpose
  return s.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
}

export type ReportPdfSection = {
  title: string;
  rows: ReportRow[];
  note?: string;
};

function formatDateIN(ts: number): string {
  return new Date(ts).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function buildReportPdf(opts: {
  orgName: string;
  generatedAt: number;
  scopeNote: string;
  sections: ReportPdfSection[];
  summaryLines: string[];
}): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = 0;

  const header = (title: string, pageNo: number) => {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, PAGE_W, 24, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("times", "bold");
    doc.setFontSize(14);
    doc.text(safe(opts.orgName, 60), MARGIN, 10);
    doc.setFont("times", "normal");
    doc.setFontSize(9);
    doc.text(safe(title, 80), MARGIN, 17);
    doc.setFontSize(8);
    doc.text(`Page ${pageNo}`, PAGE_W - MARGIN, 17, { align: "right" });
    doc.setTextColor(...NAVY);
    y = 32;
  };

  const ensure = (needed: number, title: string, pageNo: number) => {
    if (y + needed > PAGE_H - 14) {
      doc.addPage();
      header(title, pageNo);
    }
  };

  const pageNo = 1;
  header("Chamber reports", pageNo);
  doc.setFont("times", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...SLATE);
  doc.text(`Generated ${formatDateIN(opts.generatedAt)}`, MARGIN, y);
  y += 5;
  // Scope note wrapped to two lines max.
  const scopeLines = doc.splitTextToSize(safe(opts.scopeNote, 220), CONTENT_W);
  doc.text(scopeLines.slice(0, 2), MARGIN, y);
  y += scopeLines.slice(0, 2).length * 4.4 + 2;

  if (opts.summaryLines.length > 0) {
    doc.setTextColor(...NAVY);
    doc.setFontSize(9);
    for (const line of opts.summaryLines) {
      ensure(6, "Chamber reports", pageNo);
      doc.setFont("times", "normal");
      doc.text(safe(line, 160), MARGIN, y);
      y += 4.6;
    }
    y += 2;
  }

  for (const section of opts.sections) {
    if (section.rows.length === 0) continue;
    ensure(24, section.title, pageNo);
    doc.setFont("times", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...NAVY);
    doc.text(safe(section.title, 80), MARGIN, y);
    y += 3;
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.4);
    doc.line(MARGIN, y, MARGIN + 42, y);
    y += 4;

    const headers = Object.keys(section.rows[0]!);
    // Column widths: distribute, wider for text-heavy first columns.
    const weights = headers.map((h) => (h.length <= 8 ? 0.8 : 1.6));
    const totalW = weights.reduce((s, w) => s + w, 0);
    const widths = weights.map((w) => (w / totalW) * CONTENT_W);
    const fs = headers.length > 6 ? 7 : 8;

    // Table header row
    doc.setFillColor(247, 245, 239); // parchment
    doc.rect(MARGIN, y - 4, CONTENT_W, 7, "F");
    doc.setFont("times", "bold");
    doc.setFontSize(fs);
    doc.setTextColor(...NAVY);
    headers.forEach((h, i) => {
      doc.text(safe(h, 28), MARGIN + 1.5 + widths.slice(0, i).reduce((s, w) => s + w, 0), y);
    });
    y += 6;
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, y - 5, PAGE_W - MARGIN, y - 5);

    // Body rows
    doc.setFont("times", "normal");
    for (const row of section.rows) {
      const cells = headers.map((h, i) =>
        doc.splitTextToSize(
          safe(row[h] === null || row[h] === undefined ? "" : String(row[h]), 90),
          widths[i]! - 3,
        ),
      );
      const rowH = Math.max(...cells.map((c) => c.length)) * 3.6 + 1.4;
      ensure(rowH + 4, section.title, pageNo);
      if (rowH > PAGE_H - 40) continue; // pathological single row; skip
      headers.forEach((_, i) => {
        doc.text(cells[i]!, MARGIN + 1.5 + widths.slice(0, i).reduce((s, w) => s + w, 0), y);
      });
      y += rowH;
      doc.setDrawColor(...RULE);
      doc.line(MARGIN, y - 3.4, PAGE_W - MARGIN, y - 3.4);
    }
    if (section.note) {
      ensure(8, section.title, pageNo);
      doc.setFontSize(7.5);
      doc.setTextColor(...SLATE);
      const noteLines = doc.splitTextToSize(safe(section.note, 200), CONTENT_W);
      doc.text(noteLines, MARGIN, y);
      y += noteLines.length * 3.6 + 3;
    }
    y += 4;
  }

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("times", "italic");
    doc.setFontSize(7.5);
    doc.setTextColor(...SLATE);
    doc.text(
      "Operational report only — these figures describe chamber activity and predict no case outcome.",
      PAGE_W / 2,
      PAGE_H - 7,
      { align: "center" },
    );
  }
  return doc;
}

export function downloadReportPdf(
  filename: string,
  opts: Parameters<typeof buildReportPdf>[0],
): void {
  const doc = buildReportPdf(opts);
  doc.save(filename);
}

/** Open a print view in a new window with only the given tables. */
export function printReportTables(opts: {
  orgName: string;
  generatedAt: number;
  scopeNote: string;
  summaryLines: string[];
  sections: { title: string; rows: ReportRow[]; note?: string }[];
}): void {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fmtDate = formatDateIN(opts.generatedAt);

  const tableHtml = opts.sections
    .filter((s) => s.rows.length > 0)
    .map((s) => {
      const headers = Object.keys(s.rows[0]!);
      return `
      <h2>${esc(s.title)}</h2>
      <table>
        <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
        <tbody>
          ${s.rows
            .map(
              (r) =>
                `<tr>${headers
                  .map((h) => `<td>${esc(r[h] === null || r[h] === undefined ? "" : String(r[h]))}</td>`)
                  .join("")}</tr>`,
            )
            .join("")}
        </tbody>
      </table>
      ${s.note ? `<p class="note">${esc(s.note)}</p>` : ""}`;
    })
    .join("");

  const win = window.open("", "_blank", "width=980,height=720");
  if (!win) return;
  win.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Chamber reports — ${esc(opts.orgName)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #0F172A; margin: 32px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .sub { color: #64748B; font-size: 12px; margin-bottom: 4px; }
  .meta { color: #64748B; font-size: 11px; margin-bottom: 16px; }
  .summary { font-size: 12px; margin: 8px 0 20px; padding: 10px 14px; background: #F7F5EF; border: 1px solid #E5E7EB; }
  h2 { font-size: 14px; margin: 22px 0 6px; border-bottom: 2px solid #B68A45; padding-bottom: 3px; }
  table { border-collapse: collapse; width: 100%; font-size: 10.5px; }
  th { background: #F7F5EF; text-align: left; padding: 5px 7px; border: 1px solid #E5E7EB; }
  td { padding: 4px 7px; border: 1px solid #E5E7EB; vertical-align: top; }
  .note { font-size: 10px; color: #64748B; margin: 4px 0 0; }
  footer { margin-top: 28px; font-size: 10px; font-style: italic; color: #64748B; text-align: center; }
  @media print { body { margin: 12mm; } }
</style>
</head>
<body>
  <h1>${esc(opts.orgName)} — Chamber reports</h1>
  <div class="sub">Generated ${fmtDate}</div>
  <div class="meta">${esc(opts.scopeNote)}</div>
  ${opts.summaryLines.length ? `<div class="summary">${opts.summaryLines.map(esc).join("<br/>")}</div>` : ""}
  ${tableHtml || "<p>No data available for the sections you may view.</p>"}
  <footer>Operational report only — these figures describe chamber activity and predict no case outcome.</footer>
</body>
</html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}
