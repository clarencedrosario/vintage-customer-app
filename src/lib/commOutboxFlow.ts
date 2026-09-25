// =====================================================================
// FEATURE 6 — Client communication approval: pure flow rules.
//
// No Convex context, no I/O — the unit suite exercises the exact
// decisions the server enforces: category approval policy, version
// integrity (the approved text is never silently editable), delivery
// state transitions and retry dedupe.
// =====================================================================

export const COMM_CATEGORIES = [
  "hearing_update",
  "deadline_reminder",
  "document_request",
  "matter_update",
  "appointment",
  "billing_notice",
  "secure_message",
] as const;
export type CommCategory = (typeof COMM_CATEGORIES)[number];

export const COMM_CATEGORY_LABELS: Record<CommCategory, string> = {
  hearing_update: "Hearing update",
  deadline_reminder: "Deadline reminder",
  document_request: "Document request",
  matter_update: "Matter update",
  appointment: "Appointment",
  billing_notice: "Billing notice",
  secure_message: "Secure message",
};

/**
 * Which categories are legal/substantive by default (lawyer approval
 * required)? Firms override per category in Settings.
 */
export const DEFAULT_REQUIRES_APPROVAL: Record<CommCategory, boolean> = {
  hearing_update: true,
  deadline_reminder: true,
  document_request: false,
  matter_update: true,
  appointment: false,
  billing_notice: true,
  secure_message: false,
};

export type OutboxStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "returned"
  | "queued"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "cancelled"
  | "awaiting_configuration";

export type OutboxVersionStatus =
  | "drafted"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "returned";

export type OutboxShape = {
  status: OutboxStatus;
  currentVersion: number;
  approvedVersion?: number;
  requiresApproval: boolean;
  providerMessageId?: string;
  attempts: number;
};

export type VersionShape = {
  version: number;
  status: OutboxVersionStatus;
  subject: string;
  body: string;
};

// --------------------------------------------------------------- policy

/** Resolve the org's approval requirement for a category. */
export function requiresApprovalFor(
  category: CommCategory,
  orgOverride?: boolean,
): boolean {
  return orgOverride ?? DEFAULT_REQUIRES_APPROVAL[category];
}

// ------------------------------------------------------------- sending

export type SendDecision =
  | { ok: true; queue: true }
  | { ok: true; queue: false; awaitingConfiguration: true }
  | { ok: false; reason: string };

/**
 * May this message leave the outbox? The gate, in order:
 *  1. cancelled / rejected / returned messages never send;
 *  2. approval-required categories need the CURRENT version approved;
 *  3. an approved version that is no longer current blocks (edit
 *     resets approval — version integrity);
 *  4. already-sent traffic never re-queues (retry dedupe);
 *  5. queued messages are not re-queued.
 */
export function decideSend(msg: OutboxShape): SendDecision {
  if (["cancelled", "rejected", "returned"].includes(msg.status)) {
    return { ok: false, reason: `A ${msg.status} message cannot be sent.` };
  }
  if (msg.requiresApproval) {
    if (msg.approvedVersion === undefined) {
      return { ok: false, reason: "The message has not been approved." };
    }
    if (msg.approvedVersion !== msg.currentVersion) {
      return {
        ok: false,
        reason:
          "The message was edited after approval — the new version needs fresh approval.",
      };
    }
  }
  if (["queued", "sent", "delivered", "read"].includes(msg.status)) {
    return {
      ok: false,
      reason: "The message is already in flight — sending again would duplicate it.",
    };
  }
  if (msg.status === "awaiting_configuration") {
    // Provider missing: the approved message is RETAINED and may be
    // re-attempted once configuration exists.
    return { ok: true, queue: true };
  }
  return { ok: true, queue: true };
}

/** Does a failed send become a retry candidate? */
export function canRetry(msg: OutboxShape): boolean {
  return msg.status === "failed" || msg.status === "awaiting_configuration";
}

/**
 * State after a send attempt fails because the provider is missing or
 * fails: approved messages are retained as awaiting_configuration
 * (never lost, never silently dropped); a hard failure marks failed.
 */
export function afterProviderResult(
  msg: OutboxShape,
  result: { ok: true; providerMessageId: string } | { ok: false; reason: string; providerMissing: boolean },
): { status: OutboxStatus; providerMessageId?: string; lastError?: string } {
  if (result.ok) {
    return { status: "sent", providerMessageId: result.providerMessageId };
  }
  return result.providerMissing
    ? { status: "awaiting_configuration", lastError: result.reason }
    : { status: "failed", lastError: result.reason };
}

// ------------------------------------------------------------- versions

/**
 * Editing always creates a NEW version. The previous approved version
 * remains in the history; the message becomes pending approval again
 * (or stays approved-irrelevant for no-approval categories).
 */
export function nextVersionOnEdit(msg: OutboxShape): number {
  return msg.currentVersion + 1;
}

/** After an edit, what status does the message roll up to? */
export function statusAfterEdit(msg: OutboxShape): OutboxStatus {
  return msg.requiresApproval ? "pending_approval" : "approved";
}

/** Which version's text may be sent? Always the approved one. */
export function sendableVersion(msg: OutboxShape): number | null {
  if (!msg.requiresApproval) return msg.currentVersion;
  if (msg.approvedVersion === undefined) return null;
  if (msg.approvedVersion !== msg.currentVersion) return null;
  return msg.approvedVersion;
}

// ----------------------------------------------------- delivery ranks

const DELIVERY_RANK: Record<string, number> = {
  draft: 0,
  pending_approval: 1,
  approved: 2,
  queued: 3,
  sent: 4,
  delivered: 5,
  read: 6,
};

/**
 * May a provider callback advance the delivery state? Never downgrades
 * (delivered stays delivered), never resurrects failed/cancelled rows,
 * and never applies to messages that never entered the delivery
 * pipeline (draft/approved/awaiting etc.).
 */
export function canApplyDeliveryEvent(
  current: OutboxStatus,
  event: "sent" | "delivered" | "read" | "failed",
): boolean {
  if (["failed", "cancelled"].includes(current)) return false;
  const pipeline = ["queued", "sent", "delivered", "read"];
  if (!pipeline.includes(current)) return false;
  const target = DELIVERY_RANK[event];
  const cur = DELIVERY_RANK[current] ?? -1;
  return target > cur;
}
