import { jsPDF } from "jspdf";

// ===============================================================
// Invoice / receipt PDF generation.
//
// All user-supplied text passes through jsPDF's text API, which does
// not interpret markup — but we still strip control characters and
// cap lengths so nothing can corrupt layout. Money arrives in minor
// units (paise) and is formatted with fixed 2-decimal Indian style.
// ===============================================================

export type InvoicePdfOrg = {
  name: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  // Payment instructions shown on the invoice.
  bankDetails?: string | null;
  upiId?: string | null;
};

export type InvoicePdfData = {
  kind: "invoice" | "receipt";
  number: string;
  issuedOn: string;
  dueOn?: string | null;
  status: string;
  arrangement?: string | null;
  org: InvoicePdfOrg;
  clientName: string;
  clientAddress?: string | null;
  clientGstin?: string | null;
  matterReference?: string | null;
  matterTitle?: string | null;
  lines: { description: string; amountMinor: number; kind?: string; minutes?: number; ratePerHourMinor?: number }[];
  subtotalMinor: number;
  discountAmountMinor?: number;
  taxModel: "none" | "intra_state" | "inter_state";
  taxRateBps?: number;
  cgstMinor?: number;
  sgstMinor?: number;
  igstMinor?: number;
  totalMinor: number;
  amountPaidMinor: number;
  balanceMinor: number;
  notes?: string | null;
  payments?: { receivedOn: string; amountMinor: number; mode?: string; reference?: string | null }[];
  paymentTerms?: string;
};

const MARGIN = 16;
const PAGE_W = 210;
const PAGE_H = 297;
const CONTENT_W = PAGE_W - MARGIN * 2;

const NAVY: [number, number, number] = [15, 23, 42];
const GOLD: [number, number, number] = [182, 138, 69];
const SLATE: [number, number, number] = [100, 116, 139];
const RULE: [number, number, number] = [229, 231, 235];

/** Strip control characters and cap length — safe for PDF text runs. */
export function safe(s: string, max = 300): string {
  // eslint-disable-next-line no-control-regex -- stripping controls is the purpose
  return s.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
}

export function inr(minor: number): string {
  const negative = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const s = (abs / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${negative ? "-" : ""}₹${s}`;
}

const TAX_LABEL: Record<string, string> = {
  none: "Tax",
  intra_state: "CGST + SGST",
  inter_state: "IGST",
};

export function buildInvoicePdf(data: InvoicePdfData): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = 0;

  const setBody = () => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(30, 41, 59);
  };
  const setLabel = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...SLATE);
  };

  const ensure = (need: number) => {
    if (y + need > PAGE_H - 24) {
      footer();
      doc.addPage();
      y = MARGIN + 6;
    }
  };

  const footer = () => {
    const page = doc.getNumberOfPages();
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...SLATE);
    doc.text(`${data.org.name} · ${data.number}`, MARGIN, PAGE_H - 10);
    doc.text(`Page ${page}`, PAGE_W - MARGIN, PAGE_H - 10, { align: "right" });
  };

  // ---------------- Header band ----------------
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, PAGE_W, 34, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(255, 255, 255);
  doc.text(safe(data.org.name, 80), MARGIN, 15);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  const addr = [
    data.org.addressLine1,
    data.org.addressLine2,
    [data.org.city, data.org.state, data.org.pincode].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .map((s) => safe(String(s), 80));
  addr.forEach((line, i) => doc.text(line, MARGIN, 21 + i * 4));
  const contact = [data.org.phone, data.org.email]
    .filter(Boolean)
    .map((s) => safe(String(s), 80))
    .join("  ·  ");
  if (contact) doc.text(contact, MARGIN, 21 + addr.length * 4);

  // Title block
  const isReceipt = data.kind === "receipt";
  doc.setFont("times", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...NAVY);
  doc.text(isReceipt ? "RECEIPT" : "INVOICE", PAGE_W - MARGIN, 18, {
    align: "right",
  });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...GOLD);
  doc.text(safe(data.number, 60), PAGE_W - MARGIN, 24, { align: "right" });

  y = 44;

  // Meta rows
  const metaRows: [string, string][] = [
    ["Issue date", safe(data.issuedOn, 20)],
    ["Due date", data.dueOn ? safe(data.dueOn, 20) : "On receipt"],
    ["Status", safe(data.status.replace("_", " "), 24)],
    [
      "For",
      [data.matterReference, data.matterTitle]
        .filter(Boolean)
        .map((s) => safe(String(s), 60))
        .join(" — ") || "—",
    ],
    ...(data.arrangement
      ? ([[ "Arrangement", safe(data.arrangement.replace("_", " "), 30) ]] as [string, string][])
      : []),
  ];
  for (const [label, value] of metaRows) {
    setLabel();
    doc.text(label.toUpperCase(), MARGIN, y);
    setBody();
    doc.text(value, MARGIN + 34, y);
    y += 5;
  }

  // Bill-to block
  y += 2;
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 6;
  setLabel();
  doc.text("BILL TO", MARGIN, y);
  setBody();
  doc.setFont("helvetica", "bold");
  doc.text(safe(data.clientName, 100), MARGIN + 34, y);
  doc.setFont("helvetica", "normal");
  y += 5;
  if (data.clientAddress) {
    for (const line of safe(data.clientAddress, 250).split("\n")) {
      doc.text(safe(line, 100), MARGIN + 34, y);
      y += 4.5;
    }
  }
  if (data.clientGstin) {
    setLabel();
    doc.text("GSTIN", MARGIN, y);
    setBody();
    doc.text(safe(data.clientGstin, 20), MARGIN + 34, y);
    y += 5;
  }
  if (data.org.gstin) {
    setLabel();
    doc.text("FIRM GSTIN", MARGIN, y);
    setBody();
    doc.text(safe(data.org.gstin, 20), MARGIN + 34, y);
    y += 5;
  }

  // ---------------- Line items table ----------------
  y += 3;
  doc.setFillColor(247, 245, 239);
  doc.rect(MARGIN, y, CONTENT_W, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...NAVY);
  doc.text("DESCRIPTION", MARGIN + 2, y + 5.5);
  doc.text("AMOUNT", PAGE_W - MARGIN - 2, y + 5.5, { align: "right" });
  y += 11;

  for (const line of data.lines) {
    const descLines = doc.splitTextToSize(
      safe(line.description, 300),
      CONTENT_W - 46,
    );
    const rowH = Math.max(descLines.length * 4.6 + 3, 9);
    ensure(rowH + 2);
    if (data.taxRateBps && line.kind === "time" && line.minutes != null) {
      setBody();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...SLATE);
      doc.text(
        `${line.minutes} min · ${inr(line.ratePerHourMinor ?? 0)}/hr`,
        MARGIN + 2,
        y + 4,
      );
      doc.setFontSize(9.5);
      doc.setTextColor(30, 41, 59);
    }
    setBody();
    doc.setFont("helvetica", "normal");
    descLines.forEach((l: string, i: number) => {
      doc.text(l, MARGIN + 2, y + 4 + i * 4.6 + (data.taxRateBps && line.kind === "time" ? 4 : 0));
    });
    doc.text(inr(line.amountMinor), PAGE_W - MARGIN - 2, y + 4, {
      align: "right",
    });
    y += rowH;
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  }
  y += 4;

  // ---------------- Totals ----------------
  const totalsX = PAGE_W - MARGIN - 78;
  const totalsRow = (label: string, value: string, bold = false) => {
    ensure(7);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(bold ? NAVY[0] : 71, bold ? NAVY[1] : 85, bold ? NAVY[2] : 105);
    doc.text(label, totalsX, y);
    doc.text(value, PAGE_W - MARGIN - 2, y, { align: "right" });
    y += 5.5;
  };

  totalsRow("Subtotal", inr(data.subtotalMinor));
  if (data.discountAmountMinor && data.discountAmountMinor > 0) {
    totalsRow("Discount", `-${inr(data.discountAmountMinor)}`);
  }
  const taxRatePct = ((data.taxRateBps ?? 0) / 100).toFixed(2).replace(/\.00$/, "");
  if (data.taxModel === "intra_state") {
    totalsRow(`CGST @ ${taxRatePct}%/2`, inr(data.cgstMinor ?? 0));
    totalsRow(`SGST @ ${taxRatePct}%/2`, inr(data.sgstMinor ?? 0));
  } else if (data.taxModel === "inter_state") {
    totalsRow(`IGST @ ${taxRatePct}%`, inr(data.igstMinor ?? 0));
  } else if (data.taxRateBps && data.taxRateBps > 0) {
    totalsRow(TAX_LABEL.none, "Included / nil");
  }
  ensure(9);
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.4);
  doc.line(totalsX, y - 1, PAGE_W - MARGIN, y - 1);
  y += 4;
  totalsRow("Total", inr(data.totalMinor), true);
  totalsRow("Amount paid", inr(data.amountPaidMinor));
  ensure(9);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  const balanceColor: [number, number, number] =
    data.balanceMinor <= 0 ? [21, 128, 61] : NAVY;
  doc.setTextColor(...balanceColor);
  doc.text(
    data.balanceMinor <= 0 ? "PAID IN FULL" : "Balance due",
    totalsX,
    y,
  );
  doc.text(inr(data.balanceMinor), PAGE_W - MARGIN - 2, y, { align: "right" });
  y += 10;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(30, 41, 59);

  // ---------------- Payments (receipt listing) ----------------
  if (data.payments && data.payments.length > 0) {
    ensure(12 + data.payments.length * 6);
    setLabel();
    doc.text("PAYMENTS RECEIVED", MARGIN, y);
    y += 5;
    for (const p of data.payments) {
      setBody();
      doc.text(
        `${safe(p.receivedOn, 12)} · ${(p.mode ?? "payment").toUpperCase()}${p.reference ? ` · ${safe(p.reference, 40)}` : ""}`,
        MARGIN + 2,
        y,
      );
      doc.text(inr(p.amountMinor), PAGE_W - MARGIN - 2, y, { align: "right" });
      y += 5;
    }
    y += 3;
  }

  // ---------------- Payment instructions & terms ----------------
  ensure(30);
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 6;
  setLabel();
  doc.text("PAYMENT DETAILS", MARGIN, y);
  y += 5;
  setBody();
  const details: string[] = [];
  if (data.org.bankDetails) details.push(safe(data.org.bankDetails, 200));
  if (data.org.upiId) details.push(`UPI: ${safe(data.org.upiId, 80)}`);
  if (details.length === 0) {
    details.push("Payment instructions: as shared by the chamber.");
  }
  doc.text(details, MARGIN, y);
  y += details.length * 5 + 2;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(...SLATE);
  doc.text(
    safe(
      data.paymentTerms ??
        "Kindly quote the invoice number with your payment. This document is generated from the chamber's records.",
      300,
    ),
    MARGIN,
    y,
    { maxWidth: CONTENT_W },
  );

  if (data.notes) {
    y += 8;
    ensure(16);
    setLabel();
    doc.text("NOTES", MARGIN, y);
    y += 5;
    setBody();
    doc.text(doc.splitTextToSize(safe(data.notes, 500), CONTENT_W), MARGIN, y);
  }

  footer();

  // PDF bookmarks-free simple doc; return for save.
  return doc;
}

export function invoiceFileName(data: InvoicePdfData): string {
  const safeName = data.number.replace(/[/\\]+/g, "-");
  return `${data.kind === "receipt" ? "Receipt" : "Invoice"}-${safeName}.pdf`;
}
