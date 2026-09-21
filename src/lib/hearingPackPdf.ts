import { jsPDF } from "jspdf";
import { formatDateIN, formatDateTimeIN } from "@/lib/format";

// ===============================================================
// Hearing pack PDF — cover, matter details, hearing brief,
// chronology, orders, documents index, preparation notes, open
// tasks. Index + pagination + PDF bookmarks; every order and
// document row preserves its source reference.
// ===============================================================

export type HearingPackPdfData = {
  version: number;
  label: string;
  includeInternal: boolean;
  generatedFor: string;
  generatedAt: number;
  matter: {
    reference: string;
    title: string;
    court: string | null;
    bench: string | null;
    caseNumber: string | null;
    jurisdiction: string | null;
    practiceArea: string;
    description: string | null;
  };
  clientName: string;
  orgName: string;
  orgAddress: string | null;
  timezone: string;
  hearing: {
    title: string;
    at: number;
    status: string;
    court: string | null;
    courtroom: string | null;
    judge: string | null;
    purpose: string | null;
    appearance: string | null;
    advocateName: string | null;
    prepNotes: string | null;
    requiredDocuments: string[];
    outcome: string | null;
    nextAction: string | null;
    authorities: { label: string; url?: string }[];
  } | null;
  selectedOrders: {
    title: string;
    passedOn: number;
    summary: string | null;
    directions: { text: string; done: boolean }[];
    followUp: string | null;
    reviewed: boolean;
    hearingTitle: string | null;
    hasFile: boolean;
  }[];
  selectedDocuments: {
    name: string;
    kind: string;
    visibility: string;
    submittedByClient: boolean;
    hasFile: boolean;
  }[];
  chronology: {
    detail: string;
    occurredAt: number;
    datePrecision: string;
    author: string | null;
    sourceRef: string | null;
    linkKind: string | null;
  }[];
  parties: { side: string; name: string; counsel: string | null }[];
  openTasks: { title: string; dueAt: number | null; assignee: string | null }[];
  selectedSectionIds: string[];
  createdBy: string;
};

type SectionEntry = { id: string; title: string; pageIndex: number };

const MARGIN = 18;
const PAGE_W = 210; // A4 mm
const PAGE_H = 297;
const CONTENT_W = PAGE_W - MARGIN * 2;

const NAVY: [number, number, number] = [15, 23, 42]; // #0F172A
const GOLD: [number, number, number] = [182, 138, 69]; // #B68A45
const SLATE: [number, number, number] = [100, 116, 139]; // #64748B
const RULE: [number, number, number] = [229, 231, 235]; // #E5E7EB

export function buildHearingPackPdf(data: HearingPackPdfData): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const bookmarks: SectionEntry[] = [];
  let y = 0;

  const setBody = () => {
    doc.setFont("times", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(30, 41, 59);
  };
  const setLabel = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...SLATE);
  };
  const setHeading = () => {
    doc.setFont("times", "bold");
    doc.setFontSize(15);
    doc.setTextColor(...NAVY);
  };

  const newPage = () => {
    footer();
    doc.addPage();
    y = MARGIN + 6;
  };

  const ensure = (needed: number) => {
    if (y + needed > PAGE_H - 22) newPage();
  };

  const footer = () => {
    const page = doc.getNumberOfPages();
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...SLATE);
    doc.text(
      `${data.matter.reference} · Hearing pack ${data.label}`,
      MARGIN,
      PAGE_H - 10,
    );
    doc.text(`Page ${page}`, PAGE_W - MARGIN, PAGE_H - 10, { align: "right" });
  };

  const sectionHeading = (title: string) => {
    ensure(18);
    setHeading();
    doc.text(title, MARGIN, y);
    y += 3.5;
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
    y += 7;
  };

  const para = (text: string, indent = 0) => {
    if (!text) return;
    setBody();
    const lines = doc.splitTextToSize(text, CONTENT_W - indent);
    for (const line of lines) {
      ensure(6);
      doc.text(line, MARGIN + indent, y);
      y += 5;
    }
    y += 1.5;
  };

  const fieldRow = (label: string, value: string) => {
    if (!value) return;
    ensure(6);
    setLabel();
    doc.text(label.toUpperCase(), MARGIN, y);
    setBody();
    doc.text(value, MARGIN + 42, y, { maxWidth: CONTENT_W - 44 });
    y += 6;
  };

  const bulletList = (items: string[]) => {
    for (const item of items) {
      ensure(6);
      setBody();
      doc.text("•", MARGIN + 1, y);
      const lines = doc.splitTextToSize(item, CONTENT_W - 8);
      doc.text(lines[0] ?? "", MARGIN + 6, y);
      y += 5;
      for (let i = 1; i < lines.length; i++) {
        ensure(5.5);
        doc.text(lines[i]!, MARGIN + 6, y);
        y += 5;
      }
    }
    y += 1;
  };

  // -------------------------------------------------------------

  const sectionIndex = data.selectedSectionIds;

  // ---- Cover page ----
  y = 42;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...GOLD);
  doc.text((data.orgName || "ADVOKATE.IN").toUpperCase(), MARGIN, y);
  if (data.orgAddress) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...SLATE);
    doc.text(data.orgAddress, MARGIN, y + 5);
  }

  y = 78;
  doc.setFont("times", "bold");
  doc.setFontSize(26);
  doc.setTextColor(...NAVY);
  doc.text("Hearing Pack", MARGIN, y);
  y += 9;
  doc.setFontSize(13);
  doc.setTextColor(...GOLD);
  doc.text(`Version ${data.version} — prepared for court`, MARGIN, y);

  y += 14;
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);

  y += 10;
  doc.setFont("times", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...NAVY);
  doc.text(doc.splitTextToSize(data.matter.title, CONTENT_W), MARGIN, y);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(51, 65, 85);
  const refLine = [
    data.matter.reference,
    data.matter.court,
    data.matter.bench,
    data.matter.caseNumber ? `Case No. ${data.matter.caseNumber}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
  doc.text(refLine, MARGIN, y);

  y += 12;
  setLabel();
  doc.text("CLIENT", MARGIN, y);
  doc.text("PRACTICE AREA", MARGIN + 80, y);
  setBody();
  doc.setFontSize(10.5);
  doc.text(data.clientName, MARGIN, y + 5);
  doc.text(data.matter.practiceArea, MARGIN + 80, y + 5);

  y += 16;
  doc.setFontSize(9);
  doc.setTextColor(...SLATE);
  doc.text(
    [
      `Prepared for: ${data.generatedFor}`,
      `Generated: ${formatDateTimeIN(data.generatedAt)}`,
      data.includeInternal
        ? "Internal copy — includes chamber-internal material."
        : "Client-shared copy — internal material excluded.",
    ].join("\n"),
    MARGIN,
    y,
  );

  // Contents list on the cover (index).
  y += 22;
  setLabel();
  doc.text("CONTENTS", MARGIN, y);
  y += 2;
  const sectionTitles: Record<string, string> = {
    hearing: "Hearing details",
    summary: "Case summary & parties",
    chronology: "Chronology",
    orders: "Previous orders",
    documents: "Documents index",
    prep: "Preparation notes",
    tasks: "Open tasks",
  };
  const included = sectionIndex
    .map((id, i) => `${i + 1}.  ${sectionTitles[id] ?? id}`)
    .join("\n");
  doc.setFont("times", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(30, 41, 59);
  doc.text(included, MARGIN, y + 5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...SLATE);
  doc.text(
    "This bundle was generated from the chamber's records on " +
      formatDateIN(data.generatedAt) +
      ". Verify against original filings before court.",
    MARGIN,
    PAGE_H - 16,
    { maxWidth: CONTENT_W },
  );

  // ---- Matter details page ----
  newPage();
  bookmarks.push({ id: "matter", title: "Matter details", pageIndex: 2 });
  sectionHeading("Matter details");
  fieldRow("Reference", data.matter.reference);
  fieldRow("Title", data.matter.title);
  fieldRow("Client", data.clientName);
  fieldRow("Court / tribunal", data.matter.court ?? "");
  fieldRow("Bench", data.matter.bench ?? "");
  fieldRow("Case number", data.matter.caseNumber ?? "");
  fieldRow("Jurisdiction", data.matter.jurisdiction ?? "");
  fieldRow("Practice area", data.matter.practiceArea);
  if (data.matter.description) {
    y += 2;
    setLabel();
    doc.text("DESCRIPTION", MARGIN, y);
    y += 5;
    para(data.matter.description);
  }

  sectionHeading("Parties & counsel");
  if (data.parties.length === 0) {
    para("No parties recorded on the file.", 2);
  } else {
    for (const p of data.parties) {
      ensure(7);
      setBody();
      doc.setFont("times", "bold");
      doc.text(`${p.name}`, MARGIN + 2, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...SLATE);
      doc.text(
        [p.side, p.counsel].filter(Boolean).join(" — "),
        MARGIN + 70,
        y,
      );
      setBody();
      y += 5.5;
    }
  }

  // ---- Each selected section ----
  if (sectionIndex.includes("hearing")) {
    newPage();
    bookmarks.push({ id: "hearing", title: "Hearing details", pageIndex: doc.getNumberOfPages() });
    sectionHeading("Hearing details");
    const h = data.hearing;
    if (!h) {
      para("No specific hearing was attached to this pack.", 2);
    } else {
      fieldRow("Hearing", h.title);
      fieldRow("Date & time", formatDateTimeIN(h.at));
      fieldRow("Status", h.status);
      fieldRow("Court", h.court ?? "");
      fieldRow("Courtroom", h.courtroom ?? "");
      fieldRow("Judge / coram", h.judge ?? "");
      fieldRow("Purpose", h.purpose ?? "");
      fieldRow("Appearing advocate", h.advocateName ?? "");
      fieldRow("Appearance entry", h.appearance ?? "");
      if (h.requiredDocuments.length > 0) {
        y += 2;
        setLabel();
        doc.text("REQUIRED DOCUMENTS", MARGIN, y);
        y += 5;
        bulletList(h.requiredDocuments);
      }
      if (h.outcome) {
        y += 2;
        setLabel();
        doc.text("LAST RECORDED OUTCOME", MARGIN, y);
        y += 5;
        para(h.outcome);
        if (h.nextAction) para(`Next action: ${h.nextAction}`);
      }
      if (h.authorities.length > 0) {
        y += 2;
        setLabel();
        doc.text("AUTHORITIES & SOURCE LINKS", MARGIN, y);
        y += 5;
        for (const a of h.authorities) {
          ensure(6);
          setBody();
          doc.text(`• ${a.label}${a.url ? ` — ${a.url}` : ""}`, MARGIN + 2, y, {
            maxWidth: CONTENT_W - 4,
          });
          y += 5;
        }
      }
    }
  }

  if (sectionIndex.includes("summary")) {
    newPage();
    bookmarks.push({ id: "summary", title: "Case summary & parties", pageIndex: doc.getNumberOfPages() });
    sectionHeading("Case summary & parties");
    if (data.matter.description) {
      para(data.matter.description);
    } else {
      para("No case description recorded on the file.", 2);
    }
    sectionHeading("Parties");
    for (const p of data.parties) {
      para(`${p.name} (${p.side}${p.counsel ? `, counsel: ${p.counsel}` : ""})`, 2);
    }
  }

  if (sectionIndex.includes("chronology")) {
    newPage();
    bookmarks.push({ id: "chronology", title: "Chronology", pageIndex: doc.getNumberOfPages() });
    sectionHeading("Chronology");
    if (data.chronology.length === 0) {
      para("No chronology entries recorded yet.", 2);
    } else {
      for (const e of data.chronology) {
        ensure(12);
        setBody();
        doc.setFont("times", "bold");
        const dateLabel =
          e.datePrecision === "approx"
            ? `c. ${formatDateIN(e.occurredAt)}`
            : formatDateIN(e.occurredAt);
        doc.text(dateLabel, MARGIN, y);
        doc.setFont("times", "normal");
        const lines = doc.splitTextToSize(e.detail, CONTENT_W - 36);
        doc.text(lines[0] ?? "", MARGIN + 34, y);
        y += 4.6;
        for (let i = 1; i < lines.length; i++) {
          ensure(5.5);
          doc.text(lines[i]!, MARGIN + 34, y);
          y += 4.6;
        }
        // Preserve author and source references on every entry.
        const meta = [
          e.author,
          e.sourceRef ? `Source: ${e.sourceRef}` : null,
          e.linkKind ? `Linked: ${e.linkKind}` : null,
          e.datePrecision === "approx" ? "approximate date" : null,
        ]
          .filter(Boolean)
          .join("  ·  ");
        if (meta) {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7.5);
          doc.setTextColor(...SLATE);
          doc.text(meta, MARGIN + 34, y, { maxWidth: CONTENT_W - 36 });
          y += 4;
          setBody();
        }
        doc.setDrawColor(...RULE);
        doc.setLineWidth(0.2);
        doc.line(MARGIN + 34, y - 1.4, PAGE_W - MARGIN, y - 1.4);
        y += 2.5;
      }
      y += 1;
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7.5);
      doc.setTextColor(...SLATE);
      doc.text(
        "“c.” marks an approximate date recorded on the file; precision is preserved as entered.",
        MARGIN,
        y,
      );
    }
  }

  if (sectionIndex.includes("orders")) {
    newPage();
    bookmarks.push({ id: "orders", title: "Previous orders", pageIndex: doc.getNumberOfPages() });
    sectionHeading("Previous orders");
    if (data.selectedOrders.length === 0) {
      para("No orders were selected for this pack.", 2);
    } else {
      let i = 0;
      for (const o of data.selectedOrders) {
        i += 1;
        ensure(26);
        setBody();
        doc.setFont("times", "bold");
        doc.setFontSize(11);
        doc.text(`Order ${i}. ${o.title}`, MARGIN, y);
        y += 5;
        setLabel();
        const meta = [
          `Passed: ${formatDateIN(o.passedOn)}`,
          o.hearingTitle ? `Hearing: ${o.hearingTitle}` : null,
          o.reviewed ? "Reviewed by chamber" : "Not yet reviewed",
          o.hasFile ? "Certified copy on file" : null,
        ]
          .filter(Boolean)
          .join("  ·  ");
        doc.text(meta, MARGIN, y);
        y += 5;
        if (o.summary) para(o.summary, 2);
        if (o.directions.length > 0) {
          setLabel();
          ensure(6);
          doc.text("DIRECTIONS", MARGIN + 2, y);
          y += 4.5;
          bulletList(
            o.directions.map(
              (d) => `${d.done ? "[done]" : "[pending]"} ${d.text}`,
            ),
          );
        }
        if (o.followUp) para(`Follow-up: ${o.followUp}`, 2);
        y += 2;
        doc.setDrawColor(...RULE);
        doc.setLineWidth(0.25);
        doc.line(MARGIN, y, PAGE_W - MARGIN, y);
        y += 5;
      }
    }
  }

  if (sectionIndex.includes("documents")) {
    newPage();
    bookmarks.push({ id: "documents", title: "Documents index", pageIndex: doc.getNumberOfPages() });
    sectionHeading("Documents index");
    if (data.selectedDocuments.length === 0) {
      para("No documents were selected for this pack.", 2);
    } else {
      let i = 0;
      for (const d of data.selectedDocuments) {
        i += 1;
        ensure(9);
        setBody();
        doc.setFont("times", "bold");
        doc.text(`${i}.  ${d.name}`, MARGIN, y);
        y += 4.8;
        setLabel();
        const meta = [
          d.kind,
          d.visibility === "shared_with_client" ? "shared with client" : "internal",
          d.submittedByClient ? "submitted by client" : "chamber copy",
          d.hasFile ? "file attached on the matter" : "reference only (no file)",
        ]
          .filter(Boolean)
          .join("  ·  ");
        doc.text(meta, MARGIN + 2, y);
        y += 5.5;
      }
      y += 2;
      para(
        "Original files remain attached to the matter record; this index preserves their references.",
        2,
      );
    }
  }

  if (sectionIndex.includes("prep")) {
    newPage();
    bookmarks.push({ id: "prep", title: "Preparation notes", pageIndex: doc.getNumberOfPages() });
    sectionHeading("Preparation notes");
    const prep = data.hearing?.prepNotes;
    if (prep) {
      para(prep);
    } else {
      para("No preparation notes were recorded for this hearing.", 2);
    }
  }

  if (sectionIndex.includes("tasks")) {
    newPage();
    bookmarks.push({ id: "tasks", title: "Open tasks", pageIndex: doc.getNumberOfPages() });
    sectionHeading("Open tasks");
    if (data.openTasks.length === 0) {
      para("Nothing outstanding — all tasks on this matter are complete.", 2);
    } else {
      bulletList(
        data.openTasks.map(
          (t) =>
            `${t.title}${t.dueAt ? ` — due ${formatDateIN(t.dueAt)}` : ""}${t.assignee ? ` (assigned: ${t.assignee})` : ""}`,
        ),
      );
    }
  }

  footer();

  // ---- PDF bookmarks (outline) ----
  const root = doc.outline.add(null, data.matter.title, { pageNumber: 1 });
  for (const b of bookmarks) {
    doc.outline.add(root, b.title, { pageNumber: b.pageIndex });
  }

  return doc;
}

export function hearingPackFileName(data: HearingPackPdfData): string {
  const safe = data.matter.reference.replace(/[/\\]+/g, "-");
  return `HearingPack-${safe}-v${data.version}.pdf`;
}
