import type { QueryCtx, MutationCtx } from "./_generated/server";
import { getCurrentUser } from "./users";
import type { Doc, Id } from "./_generated/dataModel";
import {
  CONSOLE_ORG_ROLES,
  MEMBERSHIP_STATUSES,
  type OrgRole,
} from "./schema";

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
    "task.manage", "note.write",
    "document.upload", "document.view_internal",
    "time.log", "expense.log",
 "hearing.manage",
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

// Extra guard: support_staff are never granted document/matter-wide reads.
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
// Context: current user + active organization + membership
// ---------------------------------------------------------------------

export type AccessContext = {
  user: Doc<"users">;
  org: Doc<"organizations">;
  membership: Doc<"memberships">;
  permissions: Set<Capability>;
};

async function permissionsFor(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
  orgRole: OrgRole,
): Promise<Set<Capability>> {
  const rows = await ctx.db
    .query("rolePermissions")
    .withIndex("by_org_role", (q) => q.eq("orgId", orgId).eq("orgRole", orgRole))
    .collect();
  const overrides = rows[0]?.permissions;
  const list = overrides
    ? normalizePermissions(orgRole, overrides)
    : DEFAULT_PERMISSIONS[orgRole];
  return new Set(list);
}

/**
 * Resolve the caller's access context against their ACTIVE membership in
 * the given org (or their activeOrgId when not specified).
 */
export async function getAccessContext(
  ctx: QueryCtx,
  orgId?: Id<"organizations">,
): Promise<AccessContext | null> {
  const user = await getCurrentUser(ctx);
  if (!user) return null;
  if (user.isAnonymous) return null;

  const targetOrgId = orgId ?? user.activeOrgId;
  if (!targetOrgId) return null;

  const org = await ctx.db.get(targetOrgId);
  if (!org) return null;

  const rows = await ctx.db
    .query("memberships")
    .withIndex("by_org_user", (q) =>
      q.eq("orgId", targetOrgId).eq("userId", user._id),
    )
    .collect();
  const membership = rows[0];
  if (!membership || membership.status !== MEMBERSHIP_STATUSES.ACTIVE) {
    return null; // suspended / invited / removed members have no access
  }

  const permissions = await permissionsFor(ctx, targetOrgId, membership.orgRole);
  return { user, org, membership, permissions };
}

/** Require an access context (throws when unauthenticated/unauthorized). */
export async function requireAccess(
  ctx: QueryCtx,
  orgId?: Id<"organizations">,
): Promise<AccessContext> {
  const ac = await getAccessContext(ctx, orgId);
  if (!ac) throw new Error("Sign in and select an organization.");
  return ac;
}

/**
 * Mutation-time access: additionally enforces the subscription's
 * read-only policy (section 24). When an organization is past its
 * grace period, every write is refused with an explanatory error —
 * queries keep working so members can view and export their data.
 *
 * Centralizing this in requireAccess covers the mutation paths of
 * matters, clients, billing, comms, drafts, documents, invitations,
 * promotions and more; mutations that do not call requireAccess (notably
 * the public directory/consultation flows and the client/staff portal
 * endpoints) are still safe to leave open because writes from those
 * paths land inside gated modules.
 */
export async function requireWriteAccess(
  ctx: QueryCtx,
  orgId?: Id<"organizations">,
) {
  const ac = await requireAccess(ctx, orgId);
  const now = Date.now();
  const s = ac.org.subscription;
  if (
    s &&
    (s.status === "read_only" ||
      (s.status === "grace" && (s.graceUntil ?? 0) < now) ||
      (s.status === "cancelled" && (s.cancelAt ?? Infinity) < now) ||
      (s.status === "closed"))
  ) {
    throw new Error(
      "Your chamber's subscription is read-only. Please renew from Settings → Subscription to continue making changes.",
    );
  }
  return ac;
}

/** Does the caller hold a capability? */
export function can(ac: AccessContext, cap: Capability): boolean {
  return ac.permissions.has(cap);
}

/** Require a capability. */
export function requireCapability(ac: AccessContext, cap: Capability): void {
  if (!ac.permissions.has(cap)) {
    throw new Error(`Your role is not permitted to do this (${cap}).`);
  }
}

// ---------------------------------------------------------------------
// Matter-level access
// ---------------------------------------------------------------------

/**
 * May this member open the matter file? teamIds restricts access to the
 * responsible team; owner/partner/administrator always see everything.
 */
export function canViewMatter(ac: AccessContext, matter: Doc<"matters">): boolean {
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

/** Load a matter the caller may see, or null. */
export async function matterOrNull(
  ctx: QueryCtx,
  ac: AccessContext,
  matterId: Id<"matters">,
): Promise<Doc<"matters"> | null> {
  const matter = await ctx.db.get(matterId);
  if (!matter) return null;
  if (!canViewMatter(ac, matter)) return null;
  return matter;
}

/** Require a matter the caller may see; throws otherwise. */
export async function requireMatter(
  ctx: QueryCtx | MutationCtx,
  ac: AccessContext,
  matterId: Id<"matters">,
): Promise<Doc<"matters">> {
  const matter = await (ctx.db as QueryCtx["db"]).get(matterId);
  if (!matter) throw new Error("Matter not found.");
  if (!canViewMatter(ac, matter)) {
    throw new Error("You do not have access to this matter.");
  }
  return matter;
}

// ---------------------------------------------------------------------
// Document-level access
// ---------------------------------------------------------------------

/** Internal documents require the capability; shared ones go to clients. */
export function canViewDocument(
  ac: AccessContext,
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
// Last-owner protection
// ---------------------------------------------------------------------

/** The last ACTIVE owner of an org cannot be demoted/suspended/removed. */
export async function isLastActiveOwner(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
  userId: Id<"users">,
): Promise<boolean> {
  const all = await ctx.db
    .query("memberships")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const owners = all.filter(
    (m) => m.orgRole === "owner" && m.status === MEMBERSHIP_STATUSES.ACTIVE,
  );
  return owners.length === 1 && owners[0]!.userId === userId;
}
