/**
 * Case Command Centre — pure classification helpers.
 *
 * No Convex context, no React, no I/O: every function here takes plain
 * data and returns a decision, so the vitest suite exercises the exact
 * urgency / gating / empty-state rules the UI renders. Dates are
 * epoch-ms, matching the Convex schema (Asia/Kolkata rendering happens
 * in the UI via formatDateTimeIN).
 */

// ---------------------------------------------------------------------
// Urgency classification (deadlines, tasks, hearings, invoices)
// ---------------------------------------------------------------------

/** The three visual tiers every row can fall into. */
export type Urgency = "overdue" | "urgent" | "ordinary";

/** Windows shared by tasks/deadlines/invoices. */
export const URGENT_WINDOW_MS = 48 * 60 * 60 * 1000; // 48h
export const INVOICE_GRACE_MS = 7 * 24 * 60 * 60 * 1000; // 7-day grace before an invoice reads urgent

/** One classification rule for every dated row on the Command Centre. */
export function classifyUrgency(
  dueAt: number | undefined,
  now: number,
  isOverdueLike = true,
): Urgency {
  if (dueAt === undefined) return "ordinary";
  if (isOverdueLike && dueAt < now) return "overdue";
  if (dueAt - now <= URGENT_WINDOW_MS) return "urgent";
  return "ordinary";
}

/** Tailwind classes for each tier (vintage sepia palette, red for overdue). */
export function urgencyClass(u: Urgency): string {
  switch (u) {
    case "overdue":
      return "text-red-700 font-medium";
    case "urgent":
      return "text-[#8a6a33] font-medium";
    default:
      return "";
  }
}

/** Human stamp shown next to the date ("3d overdue", "due in 5h"). */
export function urgencyStamp(u: Urgency, dueAt: number | undefined, now: number): string {
  if (dueAt === undefined || u === "ordinary") return "";
  const diff = dueAt - now;
  const abs = Math.abs(diff);
  const label =
    abs < 60 * 60 * 1000
      ? `${Math.max(1, Math.round(abs / 60000))}m`
      : abs < 24 * 60 * 60 * 1000
        ? `${Math.round(abs / (60 * 60 * 1000))}h`
        : `${Math.round(abs / (24 * 60 * 60 * 1000))}d`;
  return diff < 0 ? `${label} overdue` : `due in ${label}`;
}

// ---------------------------------------------------------------------
// Task buckets
// ---------------------------------------------------------------------

export type TaskStatusValue = "pending" | "in_progress" | "done";

/** An open task: pending or in_progress (never done). */
export function isTaskOpen(status: TaskStatusValue): boolean {
  return status === "pending" || status === "in_progress";
}

/** A task is blocked when its due date passed while still open. */
export function isTaskBlocked(status: TaskStatusValue, dueAt: number | undefined, now: number): boolean {
  return isTaskOpen(status) && dueAt !== undefined && dueAt < now;
}

// ---------------------------------------------------------------------
// Client update due (latest communication vs chronology change)
// ---------------------------------------------------------------------

/** When did the client last hear from the chamber (portal message or note)? */
export function lastClientContactAt(latest: { at: number } | null): number | null {
  return latest ? latest.at : null;
}

/**
 * Update is due when the client has not been contacted since the latest
 * matter activity (chronology event) — grace of 30 minutes for the
 * post-hearing workflow (outcome → proposals → approval → update).
 */
export function isUpdateDue(
  latestActivityAt: number | undefined,
  latestContactAt: number | null,
  now: number,
  graceMs = 30 * 60 * 1000,
): boolean {
  if (latestActivityAt === undefined) return false;
  if (latestContactAt === null) return true;
  return latestActivityAt - latestContactAt > graceMs;
}

// ---------------------------------------------------------------------
// Documents awaiting review
// ---------------------------------------------------------------------

/** Client submissions that no one has accepted/reviewed yet. */
export function isDocumentAwaitingReview(
  doc: { submittedByClient?: boolean; requestedFromClient?: boolean },
): boolean {
  return doc.submittedByClient === true;
}

// ---------------------------------------------------------------------
// Invoice money math (all minor units / integer paise)
// ---------------------------------------------------------------------

export type InvoiceLite = {
  status: "draft" | "sent" | "partially_paid" | "paid" | "cancelled" | "credited";
  totalMinor: number;
  amountPaidMinor: number;
  amountCreditedMinor?: number;
  dueOn?: string;
};

/** True when the invoice still demands money from the client. */
export function isInvoiceOutstanding(inv: InvoiceLite): boolean {
  if (inv.status === "paid" || inv.status === "cancelled" || inv.status === "credited") {
    return false;
  }
  const credited = inv.amountCreditedMinor ?? 0;
  return inv.totalMinor - (inv.amountPaidMinor ?? 0) - credited > 0;
}

/** Outstanding paise for one invoice (never negative). */
export function invoiceOutstandingMinor(inv: InvoiceLite): number {
  if (!isInvoiceOutstanding(inv)) return 0;
  return Math.max(0, inv.totalMinor - (inv.amountPaidMinor ?? 0) - (inv.amountCreditedMinor ?? 0));
}

/**
 * An invoice is overdue when outstanding and past its due date. Due dates
 * are local YYYY-MM-DD strings (Asia/Kolkata) — compare as end-of-day IST
 * so an invoice is never overdue before its due date is over.
 */
export function isInvoiceOverdue(inv: InvoiceLite, now: number): boolean {
  if (!isInvoiceOutstanding(inv) || !inv.dueOn) return false;
  const endOfDayIST = new Date(`${inv.dueOn}T23:59:59+05:30`).getTime();
  return now > endOfDayIST;
}

/**
 * Due-date urgency for an invoice: overdue (past due, unpaid), urgent
 * (within 7 days of due), otherwise ordinary.
 */
export function invoiceUrgency(inv: InvoiceLite, now: number): Urgency {
  if (!isInvoiceOutstanding(inv)) return "ordinary";
  if (isInvoiceOverdue(inv, now)) return "overdue";
  if (inv.dueOn) {
    const endOfDayIST = new Date(`${inv.dueOn}T23:59:59+05:30`).getTime();
    if (endOfDayIST - now <= INVOICE_GRACE_MS) return "urgent";
  }
  return "ordinary";
}

// ---------------------------------------------------------------------
// Section gating (permission-aware rendering)
// ---------------------------------------------------------------------

/** A section renders when the viewer holds every required capability. */
export type SectionGate = {
  id: string;
  requiredCapabilities: string[];
};

/** Can the viewer see a section? Pure version of the UI rule. */
export function canSeeSection(
  gate: SectionGate,
  capabilities: ReadonlySet<string> | string[] | undefined,
): boolean {
  if (!capabilities) return false;
  const set = Array.isArray(capabilities) ? new Set(capabilities) : capabilities;
  return gate.requiredCapabilities.every((c) => set.has(c));
}

/** The confidential/financial sections and their capability keys. */
export const COMMAND_CENTRE_SECTIONS = {
  invoices: { id: "invoices", requiredCapabilities: ["billing.invoice"] },
  payments: { id: "payments", requiredCapabilities: ["billing.payment"] },
  internalDocuments: { id: "internalDocuments", requiredCapabilities: ["document.view_internal"] },
  audit: {
    id: "audit",
    requiredCapabilities: ["matter.edit"],
  },
} as const satisfies Record<string, SectionGate>;

// ---------------------------------------------------------------------
// Empty-state copy
// ---------------------------------------------------------------------

export type EmptyState = { message: string; hint?: string };

/** Consistent, honest empty states per section id. */
export function emptyStateFor(sectionId: string): EmptyState {
  switch (sectionId) {
    case "deadlines":
      return { message: "No deadlines on record.", hint: "Limitation dates and court-ordered compliances appear here the moment they are recorded." };
    case "tasks":
      return { message: "No open tasks.", hint: "Everything assigned on this matter is done." };
    case "chronology":
      return { message: "No chronology yet.", hint: "Events, hearings and filings appear as the matter progresses." };
    case "documents":
      return { message: "Nothing awaiting review.", hint: "Client uploads land here for acceptance." };
    case "requests":
      return { message: "No pending client requests.", hint: "Ask the client for documents from the Requests tab." };
    case "communication":
      return { message: "No client communication yet.", hint: "Messages and updates sent to the client appear here." };
    case "invoices":
      return { message: "No invoices raised.", hint: "Raise one from the Invoices tab when work is billed." };
    case "payments":
      return { message: "No payments recorded.", hint: "Receipts against this matter's invoices appear here." };
    case "undertakings":
      return { message: "No undertakings on record.", hint: "Directions accepted before the court appear here until discharged." };
    case "pack":
      return { message: "No Hearing Pack generated yet.", hint: "Build one from the Hearings tab before the next court date." };
    case "risks":
      return { message: "No open issues flagged.", hint: "Evidence & issues flagged on the matter appear here." };
    case "audit":
      return { message: "No recent activity.", hint: "Who changed what appears here as the file moves." };
    default:
      return { message: "Nothing here yet." };
  }
}
