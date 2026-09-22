import { v } from "convex/values";
import { mutation, query, internalMutation, type QueryCtx, type MutationCtx } from "./_generated/server";
import { getCurrentUser } from "./users";
import type { Doc, Id } from "./_generated/dataModel";

// =====================================================================
// Platform owner administration (section 24).
//
// The operator of this SaaS needs administration surfaces, but the
// operator is NOT a party to the legal work stored here. The design:
//
//  - A tiny set of users carry users.isPlatformAdmin. It is granted by
//    bootstrapAdmin (platform job) to the verified user whose email
//    matches PLATFORM_OWNER_EMAIL — never self-serve from the UI.
//  - Every administrative action (plan management, subscription status
//    changes, advertisement administration, access grants) is recorded
//    in platformAdminAudit — one row per action.
//  - Access to customer LEGAL records (matters, clients, documents) is
//    NOT a platform privilege. It exists only via exceptionalAccess on
//    one specific organization: explicitly granted for a written
//    reason, time-boxed to at most 7 days, revocable at any moment,
//    and every grant/revocation is audited. There is no standing or
//    default operator access to case files.
// =====================================================================

const MAX_ACCESS_HOURS = 7 * 24;
const MAX_AUDIT_ROWS = 200;

async function platformAdminOf(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users"> | null> {
  const user = await getCurrentUser(ctx as QueryCtx);
  if (!user || user.isAnonymous) return null;
  if (!user.isPlatformAdmin) return null;
  return user;
}

async function requirePlatformAdmin(ctx: QueryCtx | MutationCtx) {
  const admin = await platformAdminOf(ctx);
  if (!admin) {
    throw new Error("Platform administration access required.");
  }
  return admin;
}

async function audit(
  ctx: MutationCtx,
  actor: Doc<"users">,
  action: string,
  targetType: string,
  targetId: string,
  detail?: string,
) {
  await ctx.db.insert("platformAdminAudit", {
    actorId: actor._id,
    actorName: actor.name ?? actor.email ?? actor._id.slice(-6),
    action,
    targetType,
    targetId,
    detail: detail?.slice(0, 500),
    createdAt: Date.now(),
  });
}

// ---------------------------------------------------------------------
// Bootstrap — grants the platform-admin flag to the verified user whose
// email matches PLATFORM_OWNER_EMAIL. Run once per deployment via the
// platform bootstrap script; fails closed when unset.
// ---------------------------------------------------------------------

export const bootstrapAdmin = internalMutation({
  args: {},
  handler: async (ctx) => {
    const email = process.env.PLATFORM_OWNER_EMAIL?.trim().toLowerCase();
    if (!email) return { granted: false, reason: "PLATFORM_OWNER_EMAIL not set." };
    const users = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .collect();
    const u = users[0];
    if (!u) return { granted: false, reason: `No user with email ${email}.` };
    if (!u.emailVerified) {
      return { granted: false, reason: "That account's email is not verified." };
    }
    if (u.isPlatformAdmin) return { granted: true, reason: "Already an admin." };
    await ctx.db.patch(u._id, { isPlatformAdmin: true });
    return { granted: true, reason: `Granted to ${email}.` };
  },
});

// ---------------------------------------------------------------------
// Exceptional access — explicitly authorized, expiring, audited
// ---------------------------------------------------------------------

export const grantExceptionalAccess = mutation({
  args: {
    orgId: v.id("organizations"),
    reason: v.string(),
    hours: v.number(),
  },
  handler: async (ctx, args) => {
    const admin = await requirePlatformAdmin(ctx);
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("Organization not found.");
    const reason = args.reason.trim();
    if (reason.length < 10) {
      throw new Error("A written reason of at least 10 characters is required.");
    }
    const hours = Math.floor(args.hours);
    if (!Number.isFinite(hours) || hours < 1) {
      throw new Error("Duration must be at least 1 hour.");
    }
    if (hours > MAX_ACCESS_HOURS) {
      throw new Error(`Access cannot exceed ${MAX_ACCESS_HOURS} hours.`);
    }
    // Re-granting replaces any previous grant; the audit trail keeps the
    // full history of grants and revocations.
    await ctx.db.patch(org._id, {
      exceptionalAccess: {
        granted: true,
        grantedBy: admin._id,
        grantedAt: Date.now(),
        reason: reason.slice(0, 500),
        expiresAt: Date.now() + hours * 3600_000,
      },
    });
    await audit(ctx, admin, "exceptional_access.grant", "organization", org._id, `${hours}h — ${reason}`);
  },
});

export const revokeExceptionalAccess = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const admin = await requirePlatformAdmin(ctx);
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("Organization not found.");
    const cur = org.exceptionalAccess;
    if (!cur || !cur.granted || cur.revokedAt) {
      throw new Error("There is no live exceptional access to revoke.");
    }
    await ctx.db.patch(org._id, {
      exceptionalAccess: { ...cur, granted: false, revokedAt: Date.now() },
    });
    await audit(ctx, admin, "exceptional_access.revoke", "organization", org._id, cur.reason);
  },
});

/** Live exceptional access for one org (used by the exceptionalAccess helper). */
export const exceptionalAccessFor = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const admin = await requirePlatformAdmin(ctx);
    void admin;
    const org = await ctx.db.get(args.orgId);
    if (!org?.exceptionalAccess?.granted) return null;
    const ea = org.exceptionalAccess;
    if (ea.revokedAt || Date.now() > ea.expiresAt) return null;
    return ea;
  },
});

// ---------------------------------------------------------------------
// Platform console — organizations, subscriptions, plans, audit, health
// ---------------------------------------------------------------------

export const consoleData = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);

    const orgs = await ctx.db.query("organizations").collect();
    const subs = await ctx.db.query("subscriptions").collect();
    const subByOrg = new Map(subs.map((s) => [s.orgId, s]));
    const plans = await ctx.db.query("saasPlans").collect();
    const memberships = await ctx.db.query("memberships").collect();
    const activeByOrg = new Map<Id<"organizations">, number>();
    for (const m of memberships) {
      if (m.status === "active") {
        activeByOrg.set(m.orgId, (activeByOrg.get(m.orgId) ?? 0) + 1);
      }
    }

    const now = Date.now();
    const orgRows = orgs
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100)
      .map((o) => {
        const s = subByOrg.get(o._id);
        return {
          orgId: o._id,
          name: o.name,
          kind: o.kind,
          createdAt: o.createdAt,
          activeMembers: activeByOrg.get(o._id) ?? 0,
          planName: s
            ? plans.find((p) => p._id === s.planId)?.name ?? "—"
            : "No subscription",
          subStatus: s?.status ?? "none",
          currentPeriodEnd: s?.currentPeriodEnd ?? null,
          hasLiveAccess:
            !!o.exceptionalAccess?.granted &&
            !o.exceptionalAccess.revokedAt &&
            now < o.exceptionalAccess.expiresAt,
        };
      });

    const auditRows = await ctx.db
      .query("platformAdminAudit")
      .withIndex("by_time", (q) => q.gte("createdAt", 0))
      .order("desc")
      .take(MAX_AUDIT_ROWS);

    const counts = {
      trialing: subs.filter((s) => s.status === "trialing").length,
      active: subs.filter((s) => s.status === "active" || s.status === "past_due" || s.status === "grace").length,
      readOnly: subs.filter((s) => s.status === "read_only" || s.status === "closed").length,
      mrrMinor: subs
        .filter((s) => s.status === "active")
        .reduce((sum, s) => {
          const p = plans.find((pl) => pl._id === s.planId);
          if (!p) return sum;
          return sum + (s.interval === "yearly" ? Math.round(p.priceMinor / 12) : p.priceMinor);
        }, 0),
    };

    // Service health: rough table-volume signals (counts only — the
    // console never loads legal record contents).
    const [docs, msgs, files] = await Promise.all([
      ctx.db.query("matterDocuments").collect(),
      ctx.db.query("messages").collect(),
      ctx.db.query("appNotifications").collect(),
    ]);

    return {
      counts: {
        orgs: orgs.length,
        subscriptions: counts,
        members: memberships.filter((m) => m.status === "active").length,
        storageDocs: docs.length,
        messages: msgs.length,
        notifications: files.length,
      },
      orgs: orgRows,
      plans: plans
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((p) => ({
          _id: p._id,
          code: p.code,
          name: p.name,
          kind: p.kind,
          priceMinor: p.priceMinor,
          interval: p.interval,
          seatLimit: p.seatLimit ?? null,
          storageLimitMb: p.storageLimitMb ?? null,
          trialDays: p.trialDays ?? null,
          active: p.active,
        })),
      audit: auditRows.map((a) => ({
        _id: a._id,
        actorName: a.actorName,
        action: a.action,
        targetType: a.targetType,
        targetId: a.targetId,
        detail: a.detail ?? null,
        createdAt: a.createdAt,
      })),
    };
  },
});

/** True when the signed-in user is a platform admin (UI gating). */
export const amIPlatformAdmin = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    return !!user && !user.isAnonymous && !!user.isPlatformAdmin;
  },
});

/** Set the platform-admin flag (admin only). */
export const setPlatformAdmin = mutation({
  args: { userId: v.id("users"), value: v.boolean() },
  handler: async (ctx, args) => {
    const admin = await requirePlatformAdmin(ctx);
    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("User not found.");
    await ctx.db.patch(args.userId, { isPlatformAdmin: args.value });
    await audit(
      ctx,
      admin,
      args.value ? "admin.grant" : "admin.revoke",
      "user",
      args.userId,
      target.email ?? undefined,
    );
  },
});
