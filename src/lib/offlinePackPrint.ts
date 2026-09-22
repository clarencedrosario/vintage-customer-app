/**
 * Offline pack viewer — renders the stored payload into a print-ready
 * document so a lawyer can read the pack at court with no connectivity.
 * Prints through the browser's own print pipeline (Save as PDF works
 * offline too). No network access is attempted here.
 */

import { formatDateIN, formatDateTimeIN } from "@/lib/format";
import type { OfflinePayload } from "@/lib/offlineStore";

const style = `
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; color: #1f2937; margin: 0; }
  .wrap { max-width: 178mm; margin: 0 auto; }
  .org { font-family: Helvetica, Arial, sans-serif; font-size: 10px; letter-spacing: 0.18em; color: #B68A45; text-transform: uppercase; font-weight: 700; }
  h1 { font-size: 26px; margin: 18px 0 4px; color: #0f172a; }
  h2 { font-size: 15px; margin: 26px 0 6px; color: #0f172a; border-bottom: 1.5px solid #B68A45; padding-bottom: 4px; }
  h3 { font-size: 12.5px; margin: 16px 0 4px; color: #0f172a; }
  .rule { border-bottom: 1px solid #E5E7EB; margin: 10px 0; }
  .meta { font-family: Helvetica, Arial, sans-serif; font-size: 10.5px; color: #64748b; }
  .row { display: flex; gap: 8px; margin: 3px 0; }
  .row .k { width: 42mm; flex-shrink: 0; font-family: Helvetica, Arial, sans-serif; font-size: 8.5px; letter-spacing: 0.08em; color: #64748b; text-transform: uppercase; padding-top: 2px; }
  .row .v { flex: 1; font-size: 11px; }
  .entry { margin: 0 0 7px; }
  .entry .date { font-weight: 700; font-size: 10.5px; }
  .entry .meta { margin-top: 1px; }
  .note { background: #f7f5ef; border: 1px solid #E5E7EB; border-radius: 4px; padding: 8px 10px; font-size: 11px; margin: 4px 0; }
  .dir { font-size: 11px; margin: 2px 0 2px 10px; }
  .stamp { display: inline-block; border: 1.2px solid #B68A45; color: #B68A45; font-family: Helvetica, Arial, sans-serif; font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; padding: 2px 8px; border-radius: 2px; margin-top: 8px; }
  .footnote { font-family: Helvetica, Arial, sans-serif; font-size: 9px; color: #64748b; margin-top: 28px; border-top: 1px solid #E5E7EB; padding-top: 8px; }
  @media print { .no-print { display: none; } }
`;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildOfflinePackHtml(p: OfflinePayload): string {
  const h = p.hearing;
  const matterLine = [
    p.matter.reference,
    p.matter.court,
    p.matter.bench,
    p.matter.caseNumber ? `Case No. ${p.matter.caseNumber}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  const section = (title: string, inner: string) =>
    inner ? `<h2>${esc(title)}</h2>${inner}` : "";

  const parts: string[] = [];

  // Cover
  parts.push(`
    <p class="org">${esc(p.org?.name ?? "")}</p>
    <h1>Offline Hearing Pack</h1>
    <p class="meta">Prepared ${formatDateTimeIN(p.generatedAt)} · stored on this device</p>
    <div class="rule"></div>
    <p style="font-size:15px; font-weight:700; margin:10px 0 2px;">${esc(p.matter.title)}</p>
    <p class="meta">${esc(matterLine)}</p>
    <p class="row" style="margin-top:8px;"><span class="k">Client</span><span class="v">${esc(p.clientName)}</span></p>
    <span class="stamp">Offline copy — verify against chamber records</span>
  `);

  // Hearing
  if (h) {
    parts.push(
      section(
        "Hearing details",
        `
        <div class="row"><span class="k">Hearing</span><span class="v">${esc(h.title)}</span></div>
        <div class="row"><span class="k">Date &amp; time</span><span class="v">${formatDateTimeIN(h.at)}</span></div>
        ${h.court ? `<div class="row"><span class="k">Court</span><span class="v">${esc(h.court)}</span></div>` : ""}
        ${h.courtroom ? `<div class="row"><span class="k">Courtroom</span><span class="v">${esc(h.courtroom)}</span></div>` : ""}
        ${h.judge ? `<div class="row"><span class="k">Judge / coram</span><span class="v">${esc(h.judge)}</span></div>` : ""}
        ${h.purpose ? `<div class="row"><span class="k">Purpose</span><span class="v">${esc(h.purpose)}</span></div>` : ""}
        ${
          h.requiredDocuments.length
            ? `<h3>Required documents</h3>${h.requiredDocuments
                .map((d) => `<p class="dir">• ${esc(d)}</p>`)
                .join("")}`
            : ""
        }
        ${h.prepNotes ? `<h3>Preparation notes</h3><p class="note">${esc(h.prepNotes)}</p>` : ""}
      `,
      ),
    );
  }

  // Orders
  if (p.orders.length) {
    parts.push(
      section(
        "Previous orders",
        p.orders
          .map(
            (o, i) => `
          <div class="entry">
            <p style="font-weight:700; margin:0;">Order ${i + 1}. ${esc(o.title)}</p>
            <p class="meta">Passed ${formatDateIN(o.passedOn)}</p>
            ${o.summary ? `<p style="font-size:11px; margin:3px 0 0;">${esc(o.summary)}</p>` : ""}
            ${
              o.directions.length
                ? o.directions
                    .map(
                      (d) =>
                        `<p class="dir">${d.done ? "☑" : "☐"} ${esc(d.text)}</p>`,
                    )
                    .join("")
                : ""
            }
          </div>
        `,
          )
          .join(""),
      ),
    );
  }

  // Chronology
  if (p.chronology.length) {
    parts.push(
      section(
        "Chronology",
        p.chronology
          .map(
            (e) => `
          <div class="entry">
            <span class="date">${
              e.datePrecision === "approx" ? "c. " : ""
            }${formatDateIN(e.occurredAt)}</span>
            <span style="font-size:11px;"> — ${esc(e.detail)}</span>
            ${e.sourceRef ? `<p class="meta">Source: ${esc(e.sourceRef)}</p>` : ""}
          </div>
        `,
          )
          .join(""),
      ),
    );
  }

  // Documents
  if (p.documents.length) {
    parts.push(
      section(
        "Documents index",
        `<ol style="font-size:11px; padding-left:18px; margin:0;">${p.documents
          .map(
            (d) =>
              `<li style="margin-bottom:4px;">${esc(d.name)} <span class="meta">(${
                d.visibility === "internal" ? "internal" : "shared with client"
              })</span></li>`,
          )
          .join("")}</ol>`,
      ),
    );
  }

  // Notes
  if (p.notes.length) {
    parts.push(
      section(
        "Matter notes",
        p.notes
          .map(
            (n) => `
          <p class="note"><span class="meta">${formatDateTimeIN(n.createdAt)}${
            n.fromClient ? " · from client" : ""
          }</span><br/>${esc(n.body)}</p>
        `,
          )
          .join(""),
      ),
    );
  }

  // Parties
  if (p.parties.length) {
    parts.push(
      section(
        "Parties &amp; counsel",
        p.parties
          .map(
            (pt) =>
              `<p class="row"><span class="k">${esc(pt.side)}</span><span class="v">${esc(
                pt.name,
              )}${pt.counsel ? ` — counsel: ${esc(pt.counsel)}` : ""}</span></p>`,
          )
          .join(""),
      ),
    );
  }

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>${esc(offlinePackFileName(p))}</title>
<style>${style}</style>
</head>
<body>
<div class="wrap">
${parts.join("\n")}
<p class="footnote">
Generated from the chamber’s records on ${formatDateIN(p.generatedAt)}.
This is a stored offline copy: it does not update by itself, and it is not
a substitute for the original filings. Verify everything before court.
</p>
</div>
</body>
</html>`;
}

export function offlinePackFileName(p: OfflinePayload): string {
  const safe = p.matter.reference.replace(/[/\\]+/g, "-");
  return `OfflinePack-${safe}-${formatDateIN(p.generatedAt)}.html`;
}

/** Open a new window with the pack and trigger the print dialog. */
export function printOfflinePack(p: OfflinePayload): void {
  const html = buildOfflinePackHtml(p);
  const w = window.open("", "_blank", "width=880,height=1000");
  if (!w) {
    // Popup blocked: fall back to a download so the pack is still usable.
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = offlinePackFileName(p);
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  // Give the document a moment to lay out before opening the dialog.
  setTimeout(() => w.print(), 250);
}
