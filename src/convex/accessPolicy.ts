// ---------------------------------------------------------------------
// Pure access policy — no Convex context, no I/O.
//
// Everything in this file is a decision function over data the caller
// already holds. Keeping it free of `ctx` lets the multi-tenant denial
// fixture (accessPolicy.test.ts) exercise the exact rules the server
// enforces, without a live deployment. The context-dependent wrappers
// (auth resolution, db lookups) stay in access.ts and delegate here.
// ---------------------------------------------------------------------

import type { Doc, Id } from "./_generated/dataModel";
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
  "matter.delete", // hard delete with cascade — deliberately scarce
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
  "document.share", // download files & issue secure share links
  // Time & billing
  "time.log",
  "expense.log",
  "billing.invoice",
  "billing.payment",
  "ai.use", // spend org tokens on AI jobs (preparation gates too)
  "data.export", // archive/backup export of organisation data
  "audit.view", // read the organisation's audit log & login history
  // Team & organization administration
  "team.invite",
  "team.manage", // suspend / reactivate / remove / roles
  "permissions.edit",
  "org.edit_profile",
  // Conflict-of-interest governance: clearing a confirmed conflict via
  // override. Owner/partner/administrator by default; NOT grantable to
  // support staff (enforced in normalizePermissions below).
  "conflict.override",
  // Connect/disconnect third-party services (GitHub, e-mail/SMS providers).
  // Owner/partner/administrator by default; NOT grantable to support staff.
  "integrations.manage",

  // -----------------------------------------------------------------
  // HR module (feature 8 of the 2026 expansion). Salary and identity
  // data get their own capabilities so "can manage HR" and "can read
  // compensation" are separable grants — seeing a colleague's leave
  // balance must not imply seeing their payslip.
  // -----------------------------------------------------------------
  "hr.manage", // employees, departments, leave approvals, reviews, offboarding
  "hr.view_own", // employee self-service: own profile, leave, expenses, payslips
  "hr.view_salary", // compensation, payslips, statutory IDs of OTHERS
  "hr.approve", // leave/expense/requisition approval authority
  "hr.recruit", // vacancies, candidates, interviews, offers

  // -----------------------------------------------------------------
  // Payroll module. Distinct from hr.view_salary: running payroll is
  // an accountancy act (it posts balanced journals), viewing a salary
  // is a read. Preparer and approver are separate grants.
  // -----------------------------------------------------------------
  "payroll.run", // build/preview/finalize payroll periods (posts journals)
  "payroll.approve", // approve/lock finalized runs; reversals

  // -----------------------------------------------------------------
  // Accounting module. "finance.view" is ledger reporting (trial
  // balance, P&L); "finance.manage" posts/reverses journals and closes
  // periods. Client-fund ledgers need BOTH manage and a role gate
  // enforced in finance.ts (owner/partner/accountant only).
  // -----------------------------------------------------------------
  "finance.view",
  "finance.manage",

  // -----------------------------------------------------------------
  // Advanced project management (beyond matter tasks): projects,
  // phases, milestones, dependencies, templates, automations.
  // -----------------------------------------------------------------
  "pm.manage", // create projects/templates/automations; assign across members
  "pm.view_all", // firm-wide portfolio visibility (without it: assigned only)
] as const;
export type Capability = (typeof CAPABILITIES)[number];

// ---------------------------------------------------------------------
// Default permission matrix (editable per organization).
// ---------------------------------------------------------------------
export const DEFAULT_PERMISSIONS: Record<OrgRole, Capability[]> = {
  owner: [...CAPABILITIES],
  partner: [
    "matter.view_all", "matter.create", "matter.edit", "matter.close",
    "matter.team_restrict", "matter.delete",
    "client.view_all", "client.create", "client.edit",
    "hearing.manage", "order.record", "task.manage", "note.write",
    "document.upload", "document.view_internal", "document.share",
    "time.log", "expense.log", "billing.invoice", "billing.payment",
    "ai.use", "data.export", "audit.view",
    "team.invite",
    "conflict.override", "integrations.manage",
    "hr.manage", "hr.view_own", "hr.view_salary", "hr.approve", "hr.recruit",
    "payroll.run", "payroll.approve",
    "finance.view", "finance.manage",
    "pm.manage", "pm.view_all",
  ],
  senior_associate: [
    "matter.view_all", "matter.create", "matter.edit",
    "client.view_all", "client.edit",
    "hearing.manage", "order.record", "task.manage", "note.write",
    "document.upload", "document.view_internal", "document.share",
    "time.log", "expense.log", "ai.use",
    "hr.view_own", "pm.manage", "pm.view_all",
  ],
  associate: [
    "matter.view_all", "matter.create", "matter.edit",
    "client.view_all", "client.edit",
    "hearing.manage", "order.record", "task.manage", "note.write",
    "document.upload", "document.view_internal", "document.share",
    "time.log", "expense.log", "ai.use",
    "hr.view_own", "pm.manage", "pm.view_all",
  ],
  junior: [
    "matter.view_all", "matter.create",
    "client.view_all",
    "task.manage", "note.write",
    "document.upload", "document.view_internal", "document.share",
    "time.log", "expense.log", "ai.use",
    "hr.view_own",
  ],
  paralegal: [
    "matter.view_all", "client.view_all",
    "task.manage", "note.write",
    "document.upload", "document.view_internal", "document.share",
    "expense.log",
    "time.log",
    "ai.use",
    "hr.view_own",
  ],
  accountant: [
    "matter.view_all",
    "client.view_all",
    "billing.invoice", "billing.payment",
    "expense.log",
    // Download-only document access: accountants may retrieve files
    // (receipts, invoices) but never upload or refile them.
    "document.share",
    "finance.view", "finance.manage", "payroll.run",
    "hr.view_own", // accountants are employees too: own leave/payslips
  ],
  administrator: [
    "matter.view_all", "matter.create", "matter.edit",
    "client.view_all", "client.create", "client.edit",
    "hearing.manage", "order.record", "task.manage", "note.write",
    "document.upload", "document.view_internal", "document.share",
    "time.log", "expense.log",
    "ai.use", "data.export", "audit.view",
    "matter.delete",
    "team.invite", "team.manage",
    "permissions.edit", "org.edit_profile",
    "conflict.override", "integrations.manage",
    "hr.manage", "hr.view_own", "hr.view_salary", "hr.approve", "hr.recruit",
  ],
  support_staff: [
    "task.manage", // their own assigned tasks only
    "note.write", // matter notes restricted to assigned matters
    "hr.view_own", // employee self-service: own leave/expenses/payslips only
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
      "document.share",
      "billing.invoice",
      "billing.payment",
      "team.invite",
      "team.manage",
      "permissions.edit",
      "org.edit_profile",
      "matter.create",
      "matter.edit",
      "matter.close",
      "matter.delete",
      "matter.team_restrict",
      "conflict.override",
      "integrations.manage",
      "data.export",
      "audit.view",
      // HR/payroll/finance: support staff keep self-service only.
      // Self-service (hr.view_own) is deliberately NOT on the forbidden
      // list — it is in their default set and only ever reads own rows.
      "hr.manage",
      "hr.view_salary",
      "hr.approve",
      "hr.recruit",
      "payroll.run",
      "payroll.approve",
      "finance.view",
      "finance.manage",
      "pm.manage", // portfolio visibility & project creation stay off-limits
      "pm.view_all",
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

/**
 * May this member read a sensitive HR row (salary, payslip, statutory
 * ID)? Org isolation first — a foreign employee row is always denied.
 * Then: hr.view_salary (explicit grant) OR the row is the viewer's own
 * (self-service is bounded to hr.view_own, so support staff can see
 * their own payslips but nobody else's). Owners and partners do NOT
 * silently see every salary: the grant is per-organization and
 * editable, and a blanket role bypass would defeat the point of the
 * separate capability.
 */
export function canViewSalaryRecord(
  ac: PolicyAccessContext,
  employeeOrgId: Id<"organizations">,
  employeeUserId: Id<"users">,
): boolean {
  if (employeeOrgId !== ac.org._id) return false;
  if (ac.user._id === employeeUserId) return ac.permissions.has("hr.view_own");
  return ac.permissions.has("hr.view_salary");
}

/** HR/finance/payroll write authority — self-service is never a write. */
export function canManageHr(ac: PolicyAccessContext): boolean {
  return ac.permissions.has("hr.manage");
}

export function canManageFinance(ac: PolicyAccessContext): boolean {
  return ac.permissions.has("finance.manage");
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
