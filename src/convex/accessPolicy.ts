// ---------------------------------------------------------------------
// Pure access policy — no Convex context, no I/O.
//
// Everything in this file is a decision function over data the caller
// already holds. Keeping it free of `ctx` lets the multi-tenant denial
// fixture (accessPolicy.test.ts) exercise the exact rules the server
// enforces, without a live deployment. The context-dependent wrappers
// (auth resolution, db lookups) stay in access.ts and delegate here.
// ---------------------------------------------------------------------

import type { Doc } from "./_generated/dataModel";
import type { OrgRole } from "./schema";

// ---------------------------------------------------------------------
// Capability keys
// ---------------------------------------------------------------------
export const CAPABILITIES = [
  // Matters
  "matter.view_all",
  "matter.create",
  "matter.edit",
  "matter.close",
  "matter.team_restrict",
  // Clients
  "client.view_all",
  "client.create",
  "client.edit",
  // Hearings / orders / tasks / notes
  "hearing.manage",
  "order.record",
  "task.manage",
  "note.write",
  // Documents
  "document.upload",
  "document.view_internal",
  // Time & billing
  "time.log",
  "expense.log",
  "billing.invoice",
  "billing.payment",
  // Team & organization administration
  "team.invite",
  "team.manage", // suspend / reactivate / remove / roles
  "permissions.edit",
  "org.edit_profile",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

// ---------------------------------------------------------------------
// Default permission matrix (editable per organization).
// ---------------------------------------------------------------------
export const DEFAULT_PERMISSIONS: Record<OrgRole, Capability[]> = {
  owner: [...CAPABILITIES],
  partner: [
    "matter.view_all", "matter.create", "matter.edit", "matter.close",
    "matter.team_restrict",
    "client.view_all", "client.create", "client.edit",
    "hearing.manage", "order.record", "task.manage", "note.write",
    "document.upload", "document.view_internal",
    "time.log", "expense.log", "billing.invoice", "billing.payment",
    "team.invite",
  ],
  senior_associate: [
    "matter.view_all", "matter.create", "matter.edit",
    "client.view_all", "client.edit",
    "hearing.manage", "order.record", "task.manage", "note.write",
    "document.upload", "document.view_internal",
    "time.log", "expense.log",
  ],
  associate: [
    "matter.view_all", "matter.create", "matter.edit",
    "client.view_all", "client.edit",
    "hearing.manage", "order.record", "task.manage", "note.write",
    "document.upload", "document.view_internal",
    "time.log", "expense.log",
  ],
  junior: [
    "matter.view_all", "matter.create",
    "client.view_all",
    "task.manage", "note.write",
    "document.upload", "document.view_internal",
    "time.log", "expense.log",
  ],
  paralegal: [
    "matter.view_all", "client.view_all",
    "task.manage", "note.write",
    "document.upload", "document.view_internal",
    "expense.log",
    "time.log",
  ],
  accountant: [
    "matter.view_all",
    "client.view_all",
    "billing.invoice", "billing.payment",
    "expense.log",
  ],
  administrator: [
    "matter.view_all", "matter.create", "matter.edit",
    "client.view_all", "client.create", "client.edit",
    "hearing.manage", "order.record", "task.manage", "note.write",
    "document.upload", "document.view_internal",
    "time.log", "expense.log",
    "team.invite", "team.manage",
    "permissions.edit", "org.edit_profile",
  ],
  support_staff: [
    "task.manage", // their own assigned tasks only
    "note.write", // matter notes restricted to assigned matters
  ],
  // Document upload was deliberately excluded from accountant:
  // they see billing on matters, not case documents.
};

/**
 * Editable-permission guard: drops unknown capability strings and, for
 * support staff, refuses the broad matter/document/billing/admin
 * privileges they can never be granted. A browser-supplied override
 * list therefore cannot escalate a support account.
 */
export function normalizePermissions(
  role: OrgRole,
  requested: string[],
): Capability[] {
  const valid = new Set<string>(CAPABILITIES);
  const cleaned = requested.filter((p): p is Capability => valid.has(p));
  if (role === "support_staff") {
    // Peons/support staff can never gain broad matter/document privileges.
    const forbidden = new Set<Capability>([
      "matter.view_all",
      "client.view_all",
      "document.view_internal",
      "document.upload",
      "billing.invoice",
      "billing.payment",
      "team.invite",
      "team.manage",
      "permissions.edit",
      "org.edit_profile",
      "matter.create",
      "matter.edit",
      "matter.close",
      "matter.team_restrict",
    ]);
    return cleaned.filter((p) => !forbidden.has(p));
  }
  return cleaned;
}

// ---------------------------------------------------------------------
// Shared access-context shape
// ---------------------------------------------------------------------
// Structurally compatible with the richer `AccessContext` in access.ts
// (full Doc rows satisfy the Pick-ed fields), so access.ts can delegate
// to these functions with its own context type without a runtime import
// cycle.

export type PolicyAccessContext = {
  user: Pick<Doc<"users">, "_id">;
  org: Pick<Doc<"organizations">, "_id">;
  membership: Pick<Doc<"memberships">, "orgRole" | "status">;
  permissions: Set<Capability>;
};

// ---------------------------------------------------------------------
// Matter-level access
// ---------------------------------------------------------------------

/**
 * May this member open the matter file? The matter's own orgId must
 * match the caller's organization first — a foreign matter id is always
 * denied, whatever the role. teamIds then restricts access to the
 * responsible team; owner/partner/administrator always see everything.
 */
export function canViewMatter(
  ac: PolicyAccessContext,
  matter: Doc<"matters">,
): boolean {
  if (matter.orgId !== ac.org._id) return false;
  const role = ac.membership.orgRole;
  if (
    role === "owner" ||
    role === "partner" ||
    role === "administrator"
  ) {
    return true;
  }
  if (!ac.permissions.has("matter.view_all")) {
    return false;
  }
  if (!matter.teamIds || matter.teamIds.length === 0) return true;
  return matter.teamIds.includes(ac.user._id);
}

// ---------------------------------------------------------------------
// Document-level access
// ---------------------------------------------------------------------

/** Internal documents require the capability; shared ones go to clients. */
export function canViewDocument(
  ac: PolicyAccessContext,
  doc: Doc<"matterDocuments">,
  matter: Doc<"matters">,
): boolean {
  if (!canViewMatter(ac, matter)) return false;
  if (doc.visibility === "internal") {
    return ac.permissions.has("document.view_internal");
  }
  return true;
}

// ---------------------------------------------------------------------
// Subscription read-only gate (section 24)
// ---------------------------------------------------------------------

export type SubscriptionInfo = NonNullable<
  Doc<"organizations">["subscription"]
>;

/**
 * True when the organization's subscription forbids writes: past grace,
 * cancelled past its paid period, closed, or explicitly read-only.
 * Pure so the gate in requireWriteAccess is testable without a database.
 */
export function isSubscriptionReadOnly(
  sub: SubscriptionInfo | undefined,
  now: number,
): boolean {
  if (!sub) return false;
  return (
    sub.status === "read_only" ||
    (sub.status === "grace" && (sub.graceUntil ?? 0) < now) ||
    (sub.status === "cancelled" && (sub.cancelAt ?? Infinity) < now) ||
    sub.status === "closed"
  );
}
