import type { QueryCtx, MutationCtx } from "./_generated/server";
import { getCurrentUser } from "./users";
import type { Doc, Id } from "./_generated/dataModel";
import { MEMBERSHIP_STATUSES } from "./schema";
import {
  DEFAULT_PERMISSIONS,
  canViewDocument as canViewDocumentPolicy,
  canViewMatter as canViewMatterPolicy,
  isSubscriptionReadOnly,
  normalizePermissions,
  type Capability,
} from "./accessPolicy";

// ---------------------------------------------------------------------
// Pure policy re-exports
//
// CAPABILITIES, DEFAULT_PERMISSIONS, normalizePermissions and the
// Capability type live in accessPolicy.ts (pure, unit-tested); they are
// re-exported here so every existing `from "./access"` import keeps
// working. The decision rules for matter/document access and the
// subscription read-only gate are likewise tested there via the
// multi-tenant denial fixture.
// ---------------------------------------------------------------------
export {
  CAPABILITIES,
  DEFAULT_PERMISSIONS,
  normalizePermissions,
} from "./accessPolicy";
export type { Capability } from "./accessPolicy";

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
  orgRole: AccessContext["membership"]["orgRole"],
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
  if (isSubscriptionReadOnly(ac.org.subscription, Date.now())) {
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
 * May this member open the matter file? Delegates to the pure policy
 * rule (org match first, then role/team restriction) so the two-tenant
 * fixture exercises the same code the server runs.
 */
export function canViewMatter(ac: AccessContext, matter: Doc<"matters">): boolean {
  return canViewMatterPolicy(ac, matter);
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
  return canViewDocumentPolicy(ac, doc, matter);
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
