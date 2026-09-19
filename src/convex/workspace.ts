import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  can,
  getAccessContext,
  isLastActiveOwner,
  normalizePermissions,
  requireAccess,
  requireCapability,
  DEFAULT_PERMISSIONS,
  CAPABILITIES,
  type Capability,
} from "./access";
import { getCurrentUser } from "./users";
import {
  MEMBERSHIP_STATUSES,
  ORG_ROLES,
  ORG_ROLE_LABELS,
  type OrgRole,
} from "./schema";
import type { Id } from "./_generated/dataModel";

/** Members of the active organization (active + suspended + invited). */
export const team = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];

    const rows = await ctx.db
      .query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();

    return Promise.all(
      rows.map(async (m) => {
        const u = await ctx.db.get(m.userId);
        const effective = normalizePermissions(
          m.orgRole,
          [], // effective = defaults overridden below; kept simple for UI
        );
        void effective;
        return {
          membershipId: m._id,
          userId: m.userId,
          name: u?.name ?? null,
          email: u?.email ?? m.invitedEmail ?? null,
          image: u?.image ?? null,
          orgRole: m.orgRole,
          status: m.status,
          joinedAt: m.createdAt,
          barCouncilId: u?.barCouncilId ?? null,
        };
      }),
    );
  },
});

/** Update your own profile. */
export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    designation: v.optional(v.string()),
    phone: v.optional(v.string()),
    barCouncilId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");
    await ctx.db.patch(user._id, args);
  },
});

/** Change a member's org role (team.manage; last-owner protected). */
export const setMemberRole = mutation({
  args: {
    membershipId: v.id("memberships"),
    orgRole: v.union(...ORG_ROLES.map((r) => v.literal(r))),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "team.manage");

    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.orgId !== ac.org._id) {
      throw new Error("Membership not found in your organization.");
    }

    if (
      membership.orgRole === "owner" &&
      args.orgRole !== "owner" &&
      (await isLastActiveOwner(ctx, ac.org._id, membership.userId))
    ) {
      throw new Error(
        "The last active owner cannot be demoted. Promote another owner first.",
      );
    }

    await ctx.db.patch(args.membershipId, {
      orgRole: args.orgRole,
      updatedAt: Date.now(),
    });
  },
});

/** Suspend a member (loses access immediately; reversible). */
export const suspendMember = mutation({
  args: { membershipId: v.id("memberships") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "team.manage");

    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.orgId !== ac.org._id) {
      throw new Error("Membership not found in your organization.");
    }
    if (await isLastActiveOwner(ctx, ac.org._id, membership.userId)) {
      throw new Error("The last active owner cannot be suspended.");
    }
    await ctx.db.patch(args.membershipId, {
      status: MEMBERSHIP_STATUSES.SUSPENDED,
      updatedAt: Date.now(),
    });
  },
});

/** Reactivate a suspended member. */
export const reactivateMember = mutation({
  args: { membershipId: v.id("memberships") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "team.manage");

    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.orgId !== ac.org._id) {
      throw new Error("Membership not found in your organization.");
    }
    await ctx.db.patch(args.membershipId, {
      status: MEMBERSHIP_STATUSES.ACTIVE,
      updatedAt: Date.now(),
    });
  },
});

/** Remove a member entirely (last-owner protected). */
export const removeMember = mutation({
  args: { membershipId: v.id("memberships") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "team.manage");

    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.orgId !== ac.org._id) {
      throw new Error("Membership not found in your organization.");
    }
    if (await isLastActiveOwner(ctx, ac.org._id, membership.userId)) {
      throw new Error("The last active owner cannot be removed.");
    }
    // Clear the user's active org if it pointed here.
    const u = await ctx.db.get(membership.userId);
    if (u?.activeOrgId === ac.org._id) {
      await ctx.db.patch(membership.userId, { activeOrgId: undefined });
    }
    await ctx.db.delete(args.membershipId);
  },
});

// ---------------------------------------------------------------
// Editable permission settings
// ---------------------------------------------------------------

/** The capability catalog + defaults + saved overrides for the org. */
export const permissionMatrix = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;

    const overrides = await ctx.db
      .query("rolePermissions")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const byRole = new Map(overrides.map((o) => [o.orgRole, o.permissions]));

    return {
      canEdit: can(ac, "permissions.edit"),
      capabilities: CAPABILITIES,
      roles: ORG_ROLES.map((role) => ({
        role,
        label: ORG_ROLE_LABELS[role],
        defaults: DEFAULT_PERMISSIONS[role],
        effective: normalizePermissions(
          role,
          byRole.get(role) ?? DEFAULT_PERMISSIONS[role],
        ),
      })),
    };
  },
});

/** Save an override for one role (permissions.edit only). */
export const setRolePermissions = mutation({
  args: {
    orgRole: v.union(...ORG_ROLES.map((r) => v.literal(r))),
    permissions: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "permissions.edit");

    const cleaned = normalizePermissions(args.orgRole, args.permissions);

    // Guard: never lock owners out of managing permissions.
    if (args.orgRole === "owner") {
      for (const cap of ["team.manage", "permissions.edit"] as Capability[]) {
        if (!cleaned.includes(cap)) cleaned.push(cap);
      }
    }

    const existing = await ctx.db
      .query("rolePermissions")
      .withIndex("by_org_role", (q) =>
        q.eq("orgId", ac.org._id).eq("orgRole", args.orgRole),
      )
      .collect();

    if (existing[0]) {
      await ctx.db.patch(existing[0]._id, {
        permissions: cleaned,
        updatedBy: ac.user._id,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("rolePermissions", {
        orgId: ac.org._id,
        orgRole: args.orgRole,
        permissions: cleaned,
        updatedBy: ac.user._id,
        updatedAt: Date.now(),
      });
    }
  },
});

// ---------------------------------------------------------------
// Dashboard helpers (org-scoped)
// ---------------------------------------------------------------

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;

    const [matters, hearings, tasks, clients] = await Promise.all([
      ctx.db
        .query("matters")
        .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
        .collect(),
      ctx.db.query("hearings").collect(),
      ctx.db.query("tasks").collect(),
      ctx.db
        .query("clients")
        .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
        .collect(),
    ]);

    // Restrict to matters the caller may see (matter-level access).
    const { canViewMatter } = await import("./access");
    const visible = matters.filter((m) => canViewMatter(ac, m));
    const visibleIds = new Set(visible.map((m) => m._id));

    const now = Date.now();
    return {
      openMatters: visible.filter((m) => m.status !== "closed").length,
      clients: clients.length,
      upcomingHearings: hearings.filter(
        (h) => h.status === "scheduled" && h.at > now && visibleIds.has(h.matterId),
      ).length,
      pendingTasks: tasks.filter(
        (t) => t.status === "pending" && visibleIds.has(t.matterId),
      ).length,
    };
  },
});

/** Text search across the org's clients and visible matters. */
export const search = query({
  args: { q: v.string() },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return { clients: [], matters: [] };

    const needle = args.q.trim().toLowerCase();
    if (!needle) return { clients: [], matters: [] };

    const [clients, matters] = await Promise.all([
      ctx.db
        .query("clients")
        .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
        .collect(),
      ctx.db
        .query("matters")
        .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
        .collect(),
    ]);

    const { canViewMatter } = await import("./access");
    return {
      clients: clients
        .filter((c) => c.name.toLowerCase().includes(needle))
        .slice(0, 5),
      matters: matters
        .filter(
          (m) =>
            canViewMatter(ac, m) &&
            (m.title.toLowerCase().includes(needle) ||
              m.reference.toLowerCase().includes(needle)),
        )
        .slice(0, 5),
    };
  },
});
