// ===============================================================
// Data import (section 28) — CSV parsing and column specs.
//
// Parsing happens in the browser; validation, duplicate detection
// and the actual writes happen server-side in convex/imports.ts so
// no client can bypass the org-scoped checks. Only records the user
// supplies may be imported — the templates below produce empty
// shells and the app never fabricates "real" case data.
// ===============================================================

export type ImportEntity =
  | "clients"
  | "matters"
  | "hearings"
  | "chronology"
  | "document_metadata";

export const IMPORT_ENTITIES: ImportEntity[] = [
  "clients",
  "matters",
  "hearings",
  "chronology",
  "document_metadata",
];

export const IMPORT_ENTITY_LABELS: Record<ImportEntity, string> = {
  clients: "Clients",
  matters: "Matters",
  hearings: "Hearings",
  chronology: "Chronology events",
  document_metadata: "Document metadata",
};

export const IMPORT_ENTITY_NOTES: Record<ImportEntity, string> = {
  clients:
    "One row per client. Matters import links clients by exact name, so import clients first.",
  matters:
    "clientName must exactly match an existing client (case-insensitive). Leave reference blank to auto-number.",
  hearings:
    "matterReference must match an existing matter reference (e.g. ADV/2026/0001). Date/time is read in Asia/Kolkata.",
  chronology:
    "Matter-linked timeline entries. Dates may be exact days or approximate; mark precision accordingly.",
  document_metadata:
    "Register documents that exist physically elsewhere; no files are uploaded by import.",
};

export type ImportColumn = {
  key: string;
  header: string;
  required?: boolean;
  hint?: string;
};

export const IMPORT_COLUMNS: Record<ImportEntity, ImportColumn[]> = {
  clients: [
    { key: "name", header: "name", required: true, hint: "Full name (person or entity)" },
    {
      key: "kind",
      header: "kind",
      hint: "individual | company | trust | government (default individual)",
    },
    { key: "email", header: "email" },
    { key: "phone", header: "phone" },
    { key: "addressLine1", header: "addressLine1" },
    { key: "addressLine2", header: "addressLine2" },
    { key: "city", header: "city" },
    { key: "state", header: "state" },
    { key: "pincode", header: "pincode", hint: "6 digits" },
    { key: "gstin", header: "gstin", hint: "15-character GSTIN if applicable" },
    { key: "notes", header: "notes" },
  ],
  matters: [
    { key: "clientName", header: "clientName", required: true, hint: "Exact match of an existing client" },
    { key: "title", header: "title", required: true },
    { key: "practiceArea", header: "practiceArea", required: true },
    { key: "reference", header: "reference", hint: "Blank = auto-numbered (PREFIX/YEAR/NNNN)" },
    { key: "court", header: "court" },
    { key: "caseNumber", header: "caseNumber" },
    { key: "opposingParty", header: "opposingParty" },
    {
      key: "status",
      header: "status",
      hint: "open | in_progress | on_hold | closed (default open)",
    },
  ],
  hearings: [
    { key: "matterReference", header: "matterReference", required: true, hint: "e.g. ADV/2026/0001" },
    { key: "title", header: "title", required: true },
    { key: "at", header: "at", required: true, hint: "YYYY-MM-DD HH:mm (IST)" },
    { key: "court", header: "court" },
    { key: "courtroom", header: "courtroom" },
    { key: "judge", header: "judge" },
    { key: "purpose", header: "purpose" },
  ],
  chronology: [
    { key: "matterReference", header: "matterReference", required: true },
    { key: "detail", header: "detail", required: true, hint: "What happened" },
    { key: "occurredAt", header: "occurredAt", hint: "YYYY-MM-DD (leave blank for today)" },
    {
      key: "datePrecision",
      header: "datePrecision",
      hint: "exact | day | approx (default exact)",
    },
    { key: "sourceRef", header: "sourceRef", hint: "Where this fact came from" },
  ],
  document_metadata: [
    { key: "matterReference", header: "matterReference", required: true },
    { key: "name", header: "name", required: true },
    {
      key: "kind",
      header: "kind",
      hint: "document | communication (default document)",
    },
    {
      key: "visibility",
      header: "visibility",
      hint: "internal | shared_with_client (default internal)",
    },
  ],
};

// ---------------------------------------------------------------------
// CSV parsing (RFC 4180-ish: quoted fields, doubled quotes, CRLF)
// ---------------------------------------------------------------------

export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const clean = text.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      record.push(field);
      field = "";
      if (record.some((f) => f.trim() !== "")) records.push(record);
      record = [];
    } else {
      field += ch;
    }
  }
  // Final unterminated record.
  record.push(field);
  if (record.some((f) => f.trim() !== "")) records.push(record);

  const [headerRow = [], ...body] = records;
  return {
    headers: headerRow.map((h) => h.trim()),
    rows: body,
  };
}

/** Escape one CSV cell for template download (formula-injection guarded). */
export function csvEscape(value: string): string {
  let s = value;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Downloadable template: header row only, so nothing can be imported
 * by accident. Column hints are shown in the import card UI. */
export function buildTemplate(entity: ImportEntity): string {
  const cols = IMPORT_COLUMNS[entity];
  return `${cols.map((c) => csvEscape(c.header)).join(",")}\r\n`;
}

export function downloadTemplate(entity: ImportEntity): void {
  const blob = new Blob([`\uFEFF${buildTemplate(entity)}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `import-template-${entity}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Cap on rows per batch — keeps mutation payloads well under limits. */
export const IMPORT_ROW_LIMIT = 500;
