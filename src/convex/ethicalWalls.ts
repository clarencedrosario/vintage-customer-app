import { v } from "convex/values";
import {
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import {
  getAccessContext,
  isUserWalledFromMatterByUser,
  requireAccess,
  requireCapability,
  requireMatter,
} from "./access";
import type { AccessContext } from "./access";
import type { Doc, Id } from "./_generated/dataModel";
import {
  EMERGENCY_GRANT_REASONS,
  LEGAL_HOLD_REASON_KINDS,
} from "./schemaExtras";
import { isWallActive, isMemberInScope, wallCoversMatter } from "../lib/wallScope";

// =====================================================================
// §32 PHASE 7 — LEGAL HOLDS & ETHICAL WALLS (management module).
//
// Legal holds: a preservation order over a matter's records. While a
// hold is ACTIVE, ordinary deletion paths (currently vault.remove) are
// BLOCKED for every member — including owners/administrators. Lifting
// is an explicit, reason-carrying decision.
//
// Ethical walls: access restriction for a targeted scope (one user, one
// role, or all members) over chosen matters or the whole org. The wall
// is evaluated by the shared access gate (access.ts requireMatter /
// matterOrNull — every matter-content path), by list filters
// (matters.list and the §32 surfaces), and by explicit background
// checks (reminders scan per-recipient, AI runner via isWalledInternal).
// Exempt actors are NAMED at creation time — no role is ever implicitly
// privileged. The ONLY route past a wall is an explicit emergency
// grant: issued for that wall with a mandatory detail, time-boxed,
// ACKNOWLEDGED by the holder, usable only while unexpired and
// unrevoked.
//
// Management operations require the scarce "matter.close" capability
// (owner/partner/administrator by default; never support staff).
// =====================================================================

const MIN_REASON = 10;

function assertReason(reason: string, what: string): void {
  if (!reason || reason.trim().length < MIN_REASON) {
    throw new Error(
      `A reason of at least ${MIN_REASON} characters is required to ${what}.`,
    );
  }
}

function actorOf(ac: AccessContext) {
  return {
    id: ac.user._id,
    name: ac.user.name ?? ac.user.email ?? "Member",
  };
}

/** Direct append-only audit entry (same pattern as evidence.ts). */
async function audit(
  ctx: { db: MutationCtx["db"] },
  orgId: Id<"organizations">,
  actor: { id: Id<"users">; name: string },
  action: string,
  detail: string,
  matterId?: Id<"matters">,
): Promise<void> {
  await ctx.db.insert("auditLog", {
    orgId,
    matterId,
    actorId: actor.id,
    actorName: actor.name,
    action,
    detail,
    createdAt: Date.now(),
  });
}

// ---------------------------------------------------------------------
// Legal holds
// ---------------------------------------------------------------------

/** Place a legal hold on a matter (preservation duty). */
export const placeHold = mutation({
  args: {
    matterId: v.id("matters"),
    reasonKind: v.union(...LEGAL_HOLD_REASON_KINDS.map((r) => v.literal(r))),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.close");
    const matter = await requireMatter(ctx, ac, args.matterId);
    assertReason(args.reason, "place a legal hold");
    const actor = actorOf(ac);

    // One active hold per matter is enough — a second adds nothing.
    const existing = await ctx.db
      .query("legalHolds")
      .withIndex("by_matter_status", (q) =>
        q.eq("matterId", matter._id).eq("status", "active"),
      )
      .collect();
    if (existing.length > 0) {
      throw new Error("An active legal hold already exists for this matter.");
    }

    const holdId = await ctx.db.insert("legalHolds", {
      orgId: matter.orgId,
      matterId: matter._id,
      reasonKind: args.reasonKind,
      reason: args.reason.trim(),
      status: "active",
      createdById: actor.id,
      createdByName: actor.name,
      createdAt: Date.now(),
    });
    await audit(
      ctx,
      matter.orgId,
      actor,
      "Legal hold placed",
      `${matter.reference}: ${args.reason.trim()}`,
      matter._id,
    );
    return { holdId };
  },
});

/**
 * Lift a hold. Explicit decision with a mandatory reason — never a side
 * effect of any other operation.
 */
export const liftHold = mutation({
  args: { holdId: v.id("legalHolds"), reason: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.close");
    const hold = await ctx.db.get(args.holdId);
    if (!hold || hold.orgId !== ac.org._id) {
      throw new Error("Hold not found in your organization.");
    }
    if (hold.status === "lifted") throw new Error("Hold is already lifted.");
    assertReason(args.reason, "lift a legal hold");
    const actor = actorOf(ac);
    const matter = await ctx.db.get(hold.matterId);
    await ctx.db.patch(args.holdId, {
      status: "lifted",
      liftedAt: Date.now(),
      liftedById: actor.id,
      liftedByName: actor.name,
      liftReason: args.reason.trim(),
    });
    await audit(
      ctx,
      hold.orgId,
      actor,
      "Legal hold lifted",
      `${matter?.reference ?? "matter"}: ${args.reason.trim()}`,
      hold.matterId,
    );
  },
});

/** Holds for a matter (visible to those who can see the matter). */
export const holdsForMatter = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const matter = await requireMatter(ctx, ac, args.matterId);
    const active = await ctx.db
      .query("legalHolds")
      .withIndex("by_matter_status", (q) =>
        q.eq("matterId", matter._id).eq("status", "active"),
      )
      .collect();
    const lifted = await ctx.db
      .query("legalHolds")
      .withIndex("by_matter_status", (q) =>
        q.eq("matterId", matter._id).eq("status", "lifted"),
      )
      .collect();
    return [...active, ...lifted].sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** All active holds in the org (compliance view; matter joined). */
export const activeHolds = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const rows = await ctx.db
      .query("legalHolds")
      .withIndex("by_org_status", (q) =>
        q.eq("orgId", ac.org._id).eq("status", "active"),
      )
      .collect();
    return Promise.all(
      rows
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(async (h) => ({
          ...h,
          matter: await ctx.db.get(h.matterId),
        })),
    );
  },
});

// ---------------------------------------------------------------------
// Ethical walls
// ---------------------------------------------------------------------

/**
 * Create a wall. The caller MUST be exempt if they would otherwise be
 * inside the scope (the creator of a wall must never wall themselves
 * out of administering it); exempt actors are always explicit.
 */
export const createWall = mutation({
  args: {
    title: v.string(),
    matterIds: v.optional(v.array(v.id("matters"))), // absent = whole org
    scope: v.union(
      v.object({ kind: v.literal("user"), userId: v.id("users") }),
      v.object({ kind: v.literal("role"), orgRole: v.string() }),
      v.object({ kind: v.literal("all") }),
    ),
    exemptActorIds: v.optional(v.array(v.id("users"))),
    reason: v.string(),
    endsAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.close");
    assertReason(args.reason, "erect an ethical wall");
    const actor = actorOf(ac);
    const scope = args.scope;

    // Sanity: named users must be active members of THIS org.
    const isActiveMember = async (userId: Id<"users">) => {
      const rows = await ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      return rows.some((x) => x.orgId === ac.org._id && x.status === "active");
    };
    if (scope.kind === "user" && !(await isActiveMember(scope.userId))) {
      throw new Error(
        "Walled user is not an active member of this organization.",
      );
    }
    const exempt = [...new Set(args.exemptActorIds ?? [])];
    for (const uid of exempt) {
      if (!(await isActiveMember(uid))) {
        throw new Error(
          "Exempt actor is not an active member of this organization.",
        );
      }
    }
    const matterIds = args.matterIds;
    if (matterIds) {
      if (matterIds.length === 0) {
        throw new Error(
          "Pass no matterIds (whole-org wall) or a non-empty list.",
        );
      }
      for (const mid of matterIds) {
        const m = await ctx.db.get(mid);
        if (!m || m.orgId !== ac.org._id) {
          throw new Error("Walled matter not found in this organization.");
        }
      }
    }

    // The creator must never be silently walled out of administration.
    const inOwnScope =
      scope.kind === "all" ||
      (scope.kind === "role" && ac.membership.orgRole === scope.orgRole) ||
      (scope.kind === "user" && scope.userId === actor.id);
    if (inOwnScope && !exempt.includes(actor.id)) {
      throw new Error(
        "You are inside this wall's scope — add yourself to exemptActorIds explicitly to remain able to administer it.",
      );
    }

    const wallId = await ctx.db.insert("ethicalWalls", {
      orgId: ac.org._id,
      title: args.title.trim() || "Ethical wall",
      matterIds,
      scope,
      exemptActorIds: exempt,
      reason: args.reason.trim(),
      status: "active",
      createdById: actor.id,
      createdByName: actor.name,
      createdAt: Date.now(),
      startsAt: Date.now(),
      endsAt: args.endsAt,
    });
    await audit(
      ctx,
      ac.org._id,
      actor,
      "Ethical wall created",
      `${args.title.trim() || "Ethical wall"} — scope ${scope.kind}${
        matterIds ? ` over ${matterIds.length} matter(s)` : " over the whole org"
      }; ${exempt.length} exempt actor(s)`,
    );
    return { wallId };
  },
});

/** Lift a wall — explicit, reason-carrying. Emergency grants die with it. */
export const liftWall = mutation({
  args: { wallId: v.id("ethicalWalls"), reason: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.close");
    const wall = await ctx.db.get(args.wallId);
    if (!wall || wall.orgId !== ac.org._id) {
      throw new Error("Wall not found in your organization.");
    }
    if (wall.status === "lifted") throw new Error("Wall is already lifted.");
    assertReason(args.reason, "lift an ethical wall");
    const actor = actorOf(ac);
    await ctx.db.patch(args.wallId, {
      status: "lifted",
      liftedAt: Date.now(),
      liftedById: actor.id,
      liftReason: args.reason.trim(),
    });
    await audit(
      ctx,
      ac.org._id,
      actor,
      "Ethical wall lifted",
      `${wall.title}: ${args.reason.trim()}`,
    );
  },
});

/**
 * Issue an emergency grant: the ONLY route past a wall. Time-boxed,
 * detail mandatory, issued for ONE wall + ONE actor. The holder must
 * still acknowledge it before it opens anything.
 */
export const grantEmergencyAccess = mutation({
  args: {
    wallId: v.id("ethicalWalls"),
    actorId: v.id("users"),
    reason: v.union(...EMERGENCY_GRANT_REASONS.map((r) => v.literal(r))),
    detail: v.string(),
    durationMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.close");
    const wall = await ctx.db.get(args.wallId);
    if (!wall || wall.orgId !== ac.org._id || wall.status !== "active") {
      throw new Error("Active wall not found in your organization.");
    }
    if (!args.detail || args.detail.trim().length < MIN_REASON) {
      throw new Error(
        `A detail of at least ${MIN_REASON} characters is required for an emergency grant.`,
      );
    }
    const rows = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", args.actorId))
      .collect();
    if (!rows.some((x) => x.orgId === ac.org._id && x.status === "active")) {
      throw new Error(
        "Grant recipient is not an active member of this organization.",
      );
    }
    const minutes =
      args.durationMinutes && args.durationMinutes > 0 && args.durationMinutes <= 24 * 60
        ? args.durationMinutes
        : 60;
    const actor = actorOf(ac);
    const holder = await ctx.db.get(args.actorId);
    const expiresAt = Date.now() + minutes * 60_000;
    const grantId = await ctx.db.insert("emergencyAccessGrants", {
      wallId: wall._id,
      orgId: ac.org._id,
      actorId: args.actorId,
      actorName: holder?.name ?? holder?.email ?? "Member",
      reason: args.reason,
      detail: args.detail.trim(),
      grantedById: actor.id,
      grantedByName: actor.name,
      grantedAt: Date.now(),
      expiresAt,
    });
    await audit(
      ctx,
      ac.org._id,
      actor,
      "Emergency access granted",
      `${wall.title} — ${args.reason} (${minutes} min): ${args.detail.trim()}`,
    );
    return { grantId, expiresAt };
  },
});

/**
 * The holder ACKNOWLEDGES the grant (sees the wall, the reason and the
 * expiry) before it takes effect. Unacknowledged grants open nothing.
 */
export const acknowledgeEmergencyAccess = mutation({
  args: { grantId: v.id("emergencyAccessGrants") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const grant = await ctx.db.get(args.grantId);
    if (!grant || grant.orgId !== ac.org._id) {
      throw new Error("Grant not found in your organization.");
    }
    if (grant.actorId !== ac.user._id) {
      throw new Error("Only the grant holder can acknowledge it.");
    }
    if (grant.revokedAt !== undefined) {
      throw new Error("This grant has been revoked.");
    }
    if (grant.expiresAt <= Date.now()) throw new Error("This grant has expired.");
    if (grant.acknowledgedAt === undefined) {
      await ctx.db.patch(args.grantId, { acknowledgedAt: Date.now() });
      await audit(
        ctx,
        grant.orgId,
        actorOf(ac),
        "Emergency access acknowledged",
        `Grant for wall ${grant.wallId} acknowledged (expires ${new Date(grant.expiresAt).toISOString()}).`,
      );
    }
    return { acknowledgedAt: grant.acknowledgedAt ?? Date.now() };
  },
});

/** Revoke a grant before its expiry (the audit keeps the reason). */
export const revokeEmergencyAccess = mutation({
  args: { grantId: v.id("emergencyAccessGrants"), reason: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.close");
    const grant = await ctx.db.get(args.grantId);
    if (!grant || grant.orgId !== ac.org._id) {
      throw new Error("Grant not found in your organization.");
    }
    assertReason(args.reason, "revoke an emergency grant");
    if (grant.revokedAt === undefined) {
      await ctx.db.patch(args.grantId, { revokedAt: Date.now() });
    }
    await audit(
      ctx,
      ac.org._id,
      actorOf(ac),
      "Emergency access revoked",
      args.reason.trim(),
    );
  },
});

/**
 * Internal: is a specific user walled from a specific matter? Used by
 * the AI runner (background paths that speak for the requester) — no
 * exemptions, no emergency grants on this path.
 */
export const isWalledInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    matterId: v.id("matters"),
  },
  handler: async (ctx, args) =>
    isUserWalledFromMatterByUser(ctx, args.orgId, args.userId, args.matterId),
});

/** Walls for the compliance view (matter titles joined). */
export const listWalls = query({
  args: { includeLifted: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const rows = await ctx.db
      .query("ethicalWalls")
      .withIndex("by_org_status", (q) =>
        args.includeLifted
          ? q.eq("orgId", ac.org._id).eq("status", "lifted")
          : q.eq("orgId", ac.org._id).eq("status", "active"),
      )
      .collect();
    return Promise.all(
      rows
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(async (w) => ({
          ...w,
          matters: await Promise.all(
            (w.matterIds ?? []).map(async (mid) => {
              const m: Doc<"matters"> | null = await ctx.db.get(mid);
              return m
                ? { _id: m._id, reference: m.reference, title: m.title }
                : null;
            }),
          ),
        })),
    );
  },
});

/**
 * Why the caller is (or is not) walled from a matter — used by the UI to
 * EXPLAIN the wall instead of a bare refusal. Shows the wall, its
 * reason, exemption status and any emergency-grant state.
 */
export const wallExplanation = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return { walled: false as const, walls: [] };
    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.orgId !== ac.org._id) {
      return { walled: false as const, walls: [] };
    }
    const now = Date.now();
    const walls = await ctx.db
      .query("ethicalWalls")
      .withIndex("by_org_status", (q) =>
        q.eq("orgId", ac.org._id).eq("status", "active"),
      )
      .collect();
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", ac.user._id))
      .collect();
    const member = memberships.find(
      (m) => m.orgId === ac.org._id && m.status === "active",
    );
    const applicable: {
      wallId: Id<"ethicalWalls">;
      title: string;
      reason: string;
      inScope: boolean;
      exempt: boolean;
      emergencyGrantValid: boolean;
    }[] = [];
    for (const w of walls) {
      const active = isWallActive(
        { startsAt: w.startsAt, endsAt: w.endsAt ?? null, liftedAt: w.liftedAt ?? null },
        now,
      );
      if (!active) continue;
      if (!wallCoversMatter({ matterIds: w.matterIds ?? null }, matter._id)) continue;
      const inScope =
        !!member &&
        isMemberInScope(w.scope, {
          orgRole: member.orgRole,
          status: member.status,
          userId: ac.user._id,
        });
      const exempt = (w.exemptActorIds ?? []).includes(ac.user._id);
      const grants = await ctx.db
        .query("emergencyAccessGrants")
        .withIndex("by_wall_actor", (q) =>
          q.eq("wallId", w._id).eq("actorId", ac.user._id),
        )
        .collect();
      const emergencyGrantValid = grants.some(
        (g) =>
          g.revokedAt === undefined &&
          g.acknowledgedAt !== undefined &&
          g.expiresAt > now,
      );
      applicable.push({
        wallId: w._id,
        title: w.title,
        reason: w.reason,
        inScope,
        exempt,
        emergencyGrantValid,
      });
    }
    return {
      walled: applicable.some((a) => a.inScope && !a.exempt && !a.emergencyGrantValid),
      walls: applicable,
    };
  },
});
