import type { QueryCtx, MutationCtx } from "./_generated/server";
import { getCurrentUser } from "./users";
import type { Doc, Id } from "./_generated/dataModel";
import { MEMBERSHIP_STATUSES } from "./schema";
import {
  isMemberInScope,
  isWallActive,
  wallCoversMatter,
} from "../lib/wallScope";
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
 * PURE policy check (org match + role/team restriction) — synchronous,
 * used directly by ~40 list/filter call sites that pre-date walls. The
 * WALL layer (§32 Phase 7) is enforced on top by requireMatter /
 * matterOrNull (every matter-content path) and by the explicit
 * background/AI helper below. Exempt actors (named on the wall) and
 * acknowledged, unexpired emergency grants are the only routes past a
 * wall — no role is ever implicitly privileged through one.
 */
export function canViewMatter(ac: AccessContext, matter: Doc<"matters">): boolean {
  return canViewMatterPolicy(ac, matter);
}

/**
 * WALL EVALUATION for one org member against one matter (no
 * exemptions, no emergency grants — used by background/AI scans that
 * speak for a specific user).
 */
export async function isUserWalledFromMatterByUser(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
  userId: Id<"users">,
  matterId: Id<"matters">,
): Promise<boolean> {
  const db = ctx.db as QueryCtx["db"];
  const now = Date.now();
  const walls = await db
    .query("ethicalWalls")
    .withIndex("by_org_status", (q) =>
      q.eq("orgId", orgId).eq("status", "active"),
    )
    .collect();
  for (const w of walls) {
    const active = isWallActive(
      { startsAt: w.startsAt, endsAt: w.endsAt ?? null, liftedAt: w.liftedAt ?? null },
      now,
    );
    if (!active) continue;
    if (!wallCoversMatter({ matterIds: w.matterIds ?? null }, matterId)) continue;
    const memberships = await db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const member = memberships.find(
      (m) => m.orgId === orgId && m.status === "active",
    );
    if (
      member &&
      isMemberInScope(w.scope, {
        orgRole: member.orgRole,
        status: member.status,
        userId,
      })
    ) {
      return true;
    }
  }
  return false;
}

/**
 * HUMAN wall evaluation: scope membership + EXEMPT actors (named on
 * the wall) + valid emergency grants (issued for this wall,
 * acknowledged by the holder, not revoked, not expired).
 */
export async function isUserWalledFromMatter(
  ctx: QueryCtx,
  ac: AccessContext,
  matter: Doc<"matters">,
): Promise<boolean> {
  const db = ctx.db as QueryCtx["db"];
  const now = Date.now();
  const walls = await db
    .query("ethicalWalls")
    .withIndex("by_org_status", (q) =>
      q.eq("orgId", ac.org._id).eq("status", "active"),
    )
    .collect();
  for (const w of walls) {
    const active = isWallActive(
      { startsAt: w.startsAt, endsAt: w.endsAt ?? null, liftedAt: w.liftedAt ?? null },
      now,
    );
    if (!active) continue;
    if (!wallCoversMatter({ matterIds: w.matterIds ?? null }, matter._id)) continue;
    // Exempt actors keep access: the wall names them explicitly.
    if ((w.exemptActorIds ?? []).some((id) => id === ac.user._id)) continue;

    const memberships = await db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", ac.user._id))
      .collect();
    const member = memberships.find(
      (m) => m.orgId === ac.org._id && m.status === "active",
    );
    if (
      !member ||
      !isMemberInScope(w.scope, {
        orgRole: member.orgRole,
        status: member.status,
        userId: ac.user._id,
      })
    ) {
      continue;
    }
    // In scope and not exempt — the ONLY remaining route is a valid
    // emergency grant.
    const grants = await db
      .query("emergencyAccessGrants")
      .withIndex("by_wall_actor", (q) =>
        q.eq("wallId", w._id).eq("actorId", ac.user._id),
      )
      .collect();
    const valid = grants.some(
      (g) => !g.revokedAt && g.acknowledgedAt !== undefined && g.expiresAt > now,
    );
    if (!valid) return true;
  }
  return false;
}

/** Load a matter the caller may see (walls applied), or null. */
export async function matterOrNull(
  ctx: QueryCtx,
  ac: AccessContext,
  matterId: Id<"matters">,
): Promise<Doc<"matters"> | null> {
  const matter = await ctx.db.get(matterId);
  if (!matter) return null;
  if (!canViewMatter(ac, matter)) return null;
  if (await isUserWalledFromMatter(ctx, ac, matter)) return null;
  return matter;
}

/** Require a matter the caller may see (walls applied); throws otherwise. */
export async function requireMatter(
  ctx: QueryCtx | MutationCtx,
  ac: AccessContext,
  matterId: Id<"matters">,
): Promise<Doc<"matters">> {
  const matter = await ctx.db.get(matterId);
  if (!matter) throw new Error("Matter not found.");
  if (!canViewMatter(ac, matter)) {
    throw new Error("You do not have access to this matter.");
  }
  if (await isUserWalledFromMatter(ctx, ac, matter)) {
    throw new Error(
      "An ethical wall restricts access to this matter. If you believe this is an error, contact compliance. Emergency access requires a pre-approved, acknowledged grant.",
    );
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
