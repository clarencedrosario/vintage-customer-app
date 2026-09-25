/**
 * Undertakings Register — pure lifecycle engine (Feature 9).
 *
 * No Convex context, no React, no I/O: every function here takes plain
 * data and returns a decision, so the vitest suite exercises the exact
 * state machine, calculations and permission rules the server and UI
 * run. Dates are epoch-ms (Convex schema); IST day semantics match the
 * rest of the app (a due date is not overdue before its local day ends).
 *
 * Lifecycle:
 *   draft → pending_approval → active → completed_pending_verification
 *     → discharged
 *   any of draft/pending_approval/active → withdrawn
 *   active → breached (with explanation; audit entry required server-side)
 *
 * Nothing is silently destroyed: an ACTIVE undertaking can never be
 * deleted (server refuses) and corrections append to a history array —
 * the previous text is preserved verbatim.
 */

// ---------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------

export type UndertakingStatus =
  | "draft"
  | "pending_approval"
  | "active"
  | "completed_pending_verification"
  | "discharged"
  | "withdrawn"
  | "breached";

export const UNDERTAKING_STATUSES: readonly UndertakingStatus[] = [
  "draft",
  "pending_approval",
  "active",
  "completed_pending_verification",
  "discharged",
  "withdrawn",
  "breached",
];

export const UNDERTAKING_STATUS_LABELS: Record<UndertakingStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  active: "Active",
  completed_pending_verification: "Completed — awaiting verification",
  discharged: "Discharged",
  withdrawn: "Withdrawn",
  breached: "Breached",
};

/** Allowed transitions; terminal states (discharged/withdrawn/breached) never move. */
export function canTransitionUndertaking(
  from: UndertakingStatus,
  to: UndertakingStatus,
): boolean {
  switch (from) {
    case "draft":
      return to === "pending_approval" || to === "withdrawn";
    case "pending_approval":
      return (
        to === "active" ||
        to === "draft" || // returned for rework — reason recorded server-side
        to === "withdrawn"
      );
    case "active":
      return (
        to === "completed_pending_verification" ||
        to === "breached" ||
        to === "withdrawn"
      );
    case "completed_pending_verification":
      return to === "discharged" || to === "breached";
    case "discharged":
    case "withdrawn":
    case "breached":
      return false;
  }
}

// ---------------------------------------------------------------------
// Permission rules (pure; the server applies them against real capabilities)
// ---------------------------------------------------------------------

/**
 * Who may perform lifecycle actions:
 *  - Draft/submit/withdraw: responsible lawyer (or someone with the
 *    undertakings capability — the server passes the caller's roles).
 *  - Activate (approval) and discharge (verification): the SUPERVISING
 *    lawyer, or the caller holding the elevated capability.
 *  - Breach/corrections: elevated capability (firm governance) or supervisor.
 */
export type UndertakingRoles = {
  isResponsible: boolean;
  isSupervising: boolean;
  hasUndertakingsCapability: boolean; // "matter.edit" — firm-lawyer gate
  hasElevatedCapability: boolean; // "conflict.override"-tier (owner/partner/administrator)
};

export function canSubmitForApproval(r: UndertakingRoles): boolean {
  return (
    r.isResponsible || r.isSupervising || r.hasUndertakingsCapability
  );
}

export function canApproveActivation(r: UndertakingRoles): boolean {
  return r.isSupervising || r.hasElevatedCapability;
}

export function canVerifyDischarge(r: UndertakingRoles): boolean {
  return r.isSupervising || r.hasElevatedCapability;
}

export function canRecordBreach(r: UndertakingRoles): boolean {
  return r.isSupervising || r.hasElevatedCapability;
}

export function canCorrectRecord(r: UndertakingRoles): boolean {
  return (
    r.isResponsible || r.isSupervising || r.hasElevatedCapability
  );
}

export function canWithdraw(r: UndertakingRoles): boolean {
  return (
    r.isResponsible || r.isSupervising || r.hasElevatedCapability
  );
}

/**
 * Firm-level register reporting: the capability gate. Callers without it
 * receive summary counts only (no client names, no undertaking text) —
 * the server strips the detail.
 */
export function canSeeFirmRegister(r: UndertakingRoles): boolean {
  return r.hasElevatedCapability || r.isSupervising || r.isResponsible;
}

// ---------------------------------------------------------------------
// Calculations: due-soon, overdue, escalation
// ---------------------------------------------------------------------

export type DueClass = "overdue" | "due_soon" | "on_track" | "no_deadline";

/** How many days before the due date an undertaking reads "due soon". */
export const DUE_SOON_DAYS = 7;
/** Days an overdue active undertaking escalates per tier. */
export const ESCALATION_STEP_DAYS = 7;

export function dueClass(
  dueAt: number | undefined,
  now: number,
  isActiveLike: boolean,
): DueClass {
  if (!isActiveLike) return "no_deadline";
  if (dueAt === undefined) return "no_deadline";
  if (dueAt < now) return "overdue";
  if (dueAt - now <= DUE_SOON_DAYS * 86_400_000) return "due_soon";
  return "on_track";
}

/** Tailwind classes for each class (vintage palette, red for overdue). */
export function dueClassClass(c: DueClass): string {
  switch (c) {
    case "overdue":
      return "text-red-700 font-medium";
    case "due_soon":
      return "text-[#8a6a33] font-medium";
    default:
      return "";
  }
}

/** Human stamp: "3d overdue" / "due in 2d". */
export function dueStamp(c: DueClass, dueAt: number | undefined, now: number): string {
  if (dueAt === undefined || (c !== "overdue" && c !== "due_soon")) return "";
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

/**
 * Escalation ladder for ACTIVE undertakings that are past due and not
 * yet verified/discharged/breached:
 *   tier 0 — not due or within step → no escalation
 *   tier 1 — overdue by ≤ ESCALATION_STEP_DAYS
 *   tier 2 — overdue by ≤ 2 × step
 *   tier 3+ — longer overdue (escalates each further step)
 */
export function escalationTier(
  status: UndertakingStatus,
  dueAt: number | undefined,
  now: number,
): number {
  if (status !== "active" && status !== "completed_pending_verification") return 0;
  if (dueAt === undefined) return 0;
  const overdueDays = Math.floor((now - dueAt) / 86_400_000);
  if (overdueDays <= 0) return 0;
  return Math.min(3, Math.ceil(overdueDays / ESCALATION_STEP_DAYS));
}

// ---------------------------------------------------------------------
// Completion gate: evidence or explanation is mandatory before discharge
// ---------------------------------------------------------------------

export type CompletionClaim = {
  evidenceNote?: string;
  documentId?: string;
  verificationRequired: boolean;
};

/** Discharge requires evidence/explanation; verification is the supervisor's step. */
export function completionObjection(
  claim: CompletionClaim,
): string | null {
  const hasEvidence = !!claim.evidenceNote?.trim() || !!claim.documentId;
  if (!hasEvidence) {
    return "Record the completion evidence — a document reference or an explanation of how the undertaking was fulfilled — before discharge.";
  }
  return null;
}

// ---------------------------------------------------------------------
// Correction history (never silently overwritten)
// ---------------------------------------------------------------------

export type CorrectionEntry = {
  at: number;
  byId: string;
  byName: string;
  reason: string;
  field: string;
  previous: string;
  next: string;
};

/** Build one history entry; refuses empty reasons and no-op corrections. */
export function makeCorrection(
  input: Omit<CorrectionEntry, "at"> & { at?: number; reason: string; previous: string; next: string },
): CorrectionEntry | { error: string } {
  if (!input.reason.trim()) {
    return { error: "A reason is required for every correction — the previous text is preserved in history." };
  }
  if (input.previous === input.next) {
    return { error: "That is not a change." };
  }
  return {
    at: input.at ?? 0,
    byId: input.byId,
    byName: input.byName,
    reason: input.reason.trim(),
    field: input.field,
    previous: input.previous,
    next: input.next,
  };
}

// ---------------------------------------------------------------------
// Firm-level report (confidential-safe)
// ---------------------------------------------------------------------

export type RegisterRow = {
  id: string;
  matterReference: string;
  matterTitle: string;
  clientName: string | null; // stripped in firm-level summaries for non-viewers
  direction: "given" | "received";
  status: UndertakingStatus;
  dueAt: number | undefined;
  textPreview: string;
  isConfidential: boolean;
};

export type FirmReportRow = {
  id: string;
  matterReference: string;
  direction: "given" | "received";
  status: UndertakingStatus;
  dueClass: DueClass;
  confidential: boolean;
  /** Redacted text for confidential rows. */
  textPreview: string;
};

/**
 * Strip confidential detail for firm-level reporting: rows the viewer
 * cannot open keep only matter reference, direction, status, due class
 * and a visible-but-blank text preview. Client names never leak.
 */
export function toFirmReportRow(
  row: RegisterRow,
  canOpen: boolean,
  now: number,
): FirmReportRow {
  return {
    id: row.id,
    matterReference: row.matterReference,
    direction: row.direction,
    status: row.status,
    dueClass: dueClass(row.dueAt, now, row.status === "active" || row.status === "completed_pending_verification"),
    confidential: !canOpen,
    textPreview: canOpen || !row.isConfidential ? row.textPreview : "",
  };
}

/** Summary counters for the register header. */
export function registerSummary(
  rows: Array<{ status: UndertakingStatus; dueAt: number | undefined }>,
  now: number,
): {
  active: number;
  dueSoon: number;
  overdue: number;
  pendingVerification: number;
  pendingApproval: number;
  breached: number;
} {
  let active = 0;
  let dueSoon = 0;
  let overdue = 0;
  let pendingVerification = 0;
  let pendingApproval = 0;
  let breached = 0;
  for (const r of rows) {
    if (r.status === "active") active += 1;
    if (r.status === "pending_approval") pendingApproval += 1;
    if (r.status === "completed_pending_verification") pendingVerification += 1;
    if (r.status === "breached") breached += 1;
    const c = dueClass(r.dueAt, now, r.status === "active");
    if (c === "overdue") overdue += 1;
    if (c === "due_soon") dueSoon += 1;
  }
  return { active, dueSoon, overdue, pendingVerification, pendingApproval, breached };
}
