// =====================================================================
// CJ GLOBAL internal workforce — PURE role model.
//
// Platform roles are deliberately distinct from chamber roles
// (ORG_ROLES / DEFAULT_PERMISSIONS) and from the operator flag
// (users.isPlatformAdmin). A platform employee is NEVER an owner:
// platform ownership is the audited bootstrap/self-activation of the
// one matching verified account, and no invitable role can reach it.
//
// Kept ctx-free so the capability decisions are unit-testable without a
// deployment (accessPolicy.ts pattern).
// =====================================================================

export type PlatformRole = "support_agent" | "support_supervisor" | "developer";

export const PLATFORM_ROLES: PlatformRole[] = [
  "support_agent",
  "support_supervisor",
  "developer",
];

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  support_agent: "Support Agent",
  support_supervisor: "Support Supervisor",
  developer: "Developer",
};

// ---------------------------------------------------------------------
// Platform capabilities — a separate vocabulary from chamber
// capabilities. Queue work, queue supervision, and internal diagnostics;
// NOTHING here grants chamber/tenant data access, and nothing chamber-
// side grants these.
// ---------------------------------------------------------------------
export type PlatformCapability =
  | "platform.ticket.view_queue" // read live queue + ticket threads
  | "platform.ticket.reply" // post operator replies
  | "platform.ticket.claim" // claim/assign tickets
  | "platform.ticket.resolve_close" // resolve / close / reopen
  | "platform.ticket.set_priority"
  | "platform.handoff.view" // AI-handoff mat view reads
  | "platform.handoff.rebuild" // run the audited mat-view rebuild
  | "platform.team.manage" // invite/suspend/revoke internal workforce
  | "platform.diagnostics.view"; // internal ops audit + bootstrap status

export const PLATFORM_CAPABILITY_SETS: Record<PlatformRole, PlatformCapability[]> = {
  support_agent: [
    "platform.ticket.view_queue",
    "platform.ticket.reply",
    "platform.ticket.claim",
    "platform.ticket.resolve_close",
    "platform.ticket.set_priority",
  ],
  support_supervisor: [
    "platform.ticket.view_queue",
    "platform.ticket.reply",
    "platform.ticket.claim",
    "platform.ticket.resolve_close",
    "platform.ticket.set_priority",
    "platform.handoff.view",
    "platform.handoff.rebuild",
    "platform.diagnostics.view",
  ],
  developer: [
    "platform.ticket.view_queue",
    "platform.diagnostics.view",
    "platform.handoff.view",
    "platform.handoff.rebuild",
  ],
};

export function platformCapabilitiesFor(role: PlatformRole): PlatformCapability[] {
  return PLATFORM_CAPABILITY_SETS[role];
}

export function hasPlatformCapability(
  role: PlatformRole,
  cap: PlatformCapability,
): boolean {
  return PLATFORM_CAPABILITY_SETS[role].includes(cap);
}

// ---------------------------------------------------------------------
// Workforce authority ladder (who may manage the workforce itself)
// ---------------------------------------------------------------------

/** Workforce administration is reserved to the platform owner. */
export function canManageWorkforce(actor: {
  isPlatformAdmin: boolean;
  platformRole?: PlatformRole | null;
}): boolean {
  return actor.isPlatformAdmin;
}

/**
 * May `actor` act on `target`? The owner manages everyone; employees
 * cannot manage each other (no peer suspension, no self-suspension via
 * this surface — self-status changes are a request to the owner).
 */
export function canActOnEmployee(
  actor: { isPlatformAdmin: boolean; platformRole?: PlatformRole | null; userId: string },
  target: { userId: string },
): boolean {
  return actor.isPlatformAdmin && actor.userId !== target.userId;
}

/**
 * Role changes: owner-only, and NEVER to or from "owner" — that role
 * does not exist in the platform workforce (ownership is the audited
 * flag, not a role). A role change to an invalid target is a no.
 */
export function canChangeRole(
  actor: { isPlatformAdmin: boolean; platformRole?: PlatformRole | null },
  newRole: PlatformRole,
): boolean {
  return actor.isPlatformAdmin && PLATFORM_ROLES.includes(newRole);
}

// ---------------------------------------------------------------------
// Employee identity status helper (drives gating)
// ---------------------------------------------------------------------

/**
 * An employee's effective platform identity: active employees hold
 * their role's capabilities; suspended employees hold nothing (their
 * row stays for audit, but every gate re-derives live).
 */
export function effectivePlatformIdentity(
  row: { role: PlatformRole; status: "active" | "suspended" } | null | undefined,
): { platformRole: PlatformRole | null; capabilities: PlatformCapability[] } {
  if (!row || row.status !== "active") {
    return { platformRole: null, capabilities: [] };
  }
  return {
    platformRole: row.role,
    capabilities: platformCapabilitiesFor(row.role),
  };
}
