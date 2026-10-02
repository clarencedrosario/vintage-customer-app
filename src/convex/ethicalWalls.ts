import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import {
  getAccessContext,
  requireAccess,
  requireCapability,
  requireMatter,
} from "./access";
import type { Doc, Id } from "./_generated/dataModel";
import { logUserAction } from "./auditLogger";
import {
  isUserWalledFromMatterByUser,
} from "./access";
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
// matterOrNull — every matter-content path) and by explicit background
// checks (reminders scan per-recipient, AI runner). Exempt actors are
// NAMED at creation time — no role is ever implicitly privileged. The
// ONLY route past a wall is an explicit emergency grant: issued for
// that wall with a mandatory detail, time-boxed, ACKNOWLEDGED by the
// holder, usable only while unexpired and unrevoked — each use is
// recorded on the grant row.
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

async function actorOf(ac: Awaited<ReturnType<typeof requireAccess>>) {
  return {
    id: ac.user._id,
    name: ac.user.name ?? ac.user.email ?? "Member",
  };
}

// ---------------------------------------------------------------------
// Legal holds
// ---------------------------------------------------------------------

/** Place a legal hold on a matter (preservation duty). */
export const placeHold = mutation({
  args: {
    matterId: v.id("matters"),
    reasonKind: v.union(...["litigation", "investigation", "audit", "regulatory", "other"].map((r) => v.literal(r))),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.close");
    const matter = await requireMatter(ctx, ac, args.matterId);
    assertReason(args.reason, "place a legal hold");
    const actor = await actorOf(ac);

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
    await logUserAction(ctx, ac, "Legal hold placed", `${matter.reference}: ${args.reason.trim()}`, args.matterId);
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
    const actor = await actorOf(ac);
    const matter = await ctx.db.get(hold.matterId);
    await ctx.db.patch(args.holdId, {
      status: "lifted",
      liftedAt: Date.now(),
      liftedById: actor.id,
      liftedByName: actor.name,
      liftReason: args.reason.trim(),
    });
    await logUserAction(
      ctx,
      ac,
      "Legal hold lifted",
      `${matter?.reference ?? hold.matterId}: ${args.reason.trim()}`,
      hold.matterId,
    );
  },
});

/** Active/lifted holds for a matter (visible to those who can see it). */
export const holdsForMatter = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const matter = await requireMatter(ctx, ac, args.matterId);
    const rows = await ctx.db
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
    return [...rows, ...lifted].sort((a, b) => b.createdAt - a.createdAt);
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
    const actor = await actorOf(ac);

    // Validations: scope/target sanity + org membership of named users.
    const exempt = [...new Set(args.exemptActorIds ?? [])];
    if (args.scope.kind === "user") {
      const m = await ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", args.scope.userId))
        .collect();
      if (!m.some((x) => x.orgId === ac.org._id && x.status === "active")) {
        throw new Error("Walled user is not an active member of this organization.");
      }
    }
    for (const uid of exempt) {
      const m = await ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", uid))
        .collect();
      if (!m.some((x) => x.orgId === ac.org._id && x.status === "active")) {
        throw new Error("Exempt actor is not an active member of this organization.");
      }
    }
    const matterIds = args.matterIds;
    if (matterIds) {
      if (matterIds.length === 0) {
        throw new Error("Pass no matterIds (whole-org wall) or a non-empty list.");
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
      args.scope.kind === "all" ||
      (args.scope.kind === "role" && ac.membership.orgRole === args.scope.orgRole) ||
      (args.scope.kind === "user" && args.scope.userId === actor.id);
    if (inOwnScope && !exempt.some((id) => id === actor.id)) {
      throw new Error(
        "You are inside this wall's scope — add yourself to exemptActorIds explicitly to remain able to administer it.",
      );
    }

    const wallId = await ctx.db.insert("ethicalWalls", {
      orgId: ac.org._id,
      title: args.title.trim() || "Ethical wall",
      matterIds,
      scope: args.scope,
      exemptActorIds: exempt,
      reason: args.reason.trim(),
      status: "active",
      createdById: actor.id,
      createdByName: actor.name,
      createdAt: Date.now(),
      startsAt: Date.now(),
      endsAt: args.endsAt,
    });
    await logUserAction(
      ctx,
      ac,
      "Ethical wall created",
      `${args.title.trim() || "Ethical wall"} — scope ${args.scope.kind}${matterIds ? ` over ${matterIds.length} matter(s)` : " over the whole org"}; ${exempt.length} exempt actor(s)`,
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
    const actor = await actorOf(ac);
    await ctx.db.patch(args.wallId, {
      status: "lifted",
      liftedAt: Date.now(),
      liftedById: actor.id,
      liftReason: args.reason.trim(),
    });
    await logUserAction(ctx, ac, "Ethical wall lifted", `${wall.title}: ${args.reason.trim()}`);
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
    reason: v.union(...["hold_setup_or_correction", "wall_correction", "security_incident", "court_order", "other_documented"].map((r) => v.literal(r))),
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
      throw new Error(`A detail of at least ${MIN_REASON} characters is required for an emergency grant.`);
    }
    const m = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", args.actorId))
      .collect();
    if (!m.some((x) => x.orgId === ac.org._id && x.status === "active")) {
      throw new Error("Grant recipient is not an active member of this organization.");
    }
    const minutes =
      args.durationMinutes && args.durationMinutes > 0 && args.durationMinutes <= 24 * 60
        ? args.durationMinutes
        : 60;
    const actor = await actorOf(ac);
    const grantId = await ctx.db.insert("emergencyAccessGrants", {
      wallId: wall._id,
      orgId: ac.org._id,
      actorId: args.actorId,
      actorName:
        (await ctx.db.get(args.actorId))?.name ??
        (await ctx.db.get(args.actorId))?.email ??
        "Member",
      reason: args.reason,
      detail: args.detail.trim(),
      grantedById: actor.id,
      grantedByName: actor.name,
      grantedAt: Date.now(),
      expiresAt: Date.now() + minutes * 60_000,
    });
    await logUserAction(
      ctx,
      ac,
      "Emergency access granted",
      `${wall.title} — ${args.reason} (${minutes} min): ${args.detail.trim()}`,
    );
    return { grantId, expiresAt: Date.now() + minutes * 60_000 };
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
    if (grant.revokedAt) throw new Error("This grant has been revoked.");
    if (grant.expiresAt <= Date.now()) throw new Error("This grant has expired.");
    if (grant.acknowledgedAt === undefined) {
      await ctx.db.patch(args.grantId, { acknowledgedAt: Date.now() });
    }
    return { acknowledgedAt: grant.acknowledgedAt ?? Date.now() };
  },
});

/** Revoke a grant before its expiry (also works post-hoc for the audit). */
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
    await logUserAction(ctx, ac, "Emergency access revoked", `${args.reason.trim()}`);
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
              return m ? { _id: m._id, reference: m.reference, title: m.title } : null;
            }),
          ),
        })),
    );
  },
});

/**
 * Why the caller is (or is not) walled from a matter — used by the UI to
 * explain the wall instead of a bare 403-style refusal.
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
    const applicable: {
      wallId: Id<"ethicalWalls">;
      title: string;
      reason: string;
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
      const memberships = await ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", ac.user._id))
        .collect();
      const member = memberships.find(
        (m) => m.orgId === ac.org._id && m.status === "active",
      );
      const inScope =
        !!member &&
        isMemberInScope(w.scope, {
          orgRole: member.orgRole,
          status: member.status,
          userId: ac.user._id,
        });
      if (!inScope) continue;
      const exempt = (w.exemptActorIds ?? []).some((id) => id === ac.user._id);
      const grants = await ctx.db
        .query("emergencyAccessGrants")
        .withIndex("by_wall_actor", (q) =>
          q.eq("wallId", w._id).eq("actorId", ac.user._id),
        )
        .collect();
      const emergencyGrantValid = grants.some(
        (g) => !g.revokedAt && g.acknowledgedAt !== undefined && g.expiresAt > now,
      );
      applicable.push({
        wallId: w._id,
        title: w.title,
        reason: w.reason,
        exempt,
        emergencyGrantValid,
      });
    }
    return {
      walled: applicable.some((a) => !a.exempt && !a.emergencyGrantValid),
      walls: applicable,
    };
  },
});
