// ===============================================================
// GitHub connection store — transactional queries and mutations.
//
// Kept separate from github.ts (Node runtime) because Convex queries
// and mutations must run in the default runtime. Everything here is
// organization-scoped and authorization-checked; the GitHub token is
// never read or stored here.
// ===============================================================

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import {
  requireAccess,
  requireCapability,
  type AccessContext,
} from "./access";

/** Connections shown on the settings card. */
export const listConnections = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    const rows = await ctx.db
      .query("githubConnections")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    return rows
      .sort((a, b) => a.repo.localeCompare(b.repo))
      .map((r) => ({
        _id: r._id,
        repo: r.repo,
        owner: r.owner,
        name: r.name,
        defaultBranch: r.defaultBranch,
        connectedAt: r.connectedAt,
        lastVerifiedAt: r.lastVerifiedAt,
        lastError: r.lastError ?? null,
      }));
  },
});

/** Recent audit entries for the settings card. */
export const recentAudit = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    const rows = await ctx.db
      .query("githubAudit")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
  },
});

/** Disconnect a repository (owner/admin only, audited). */
export const disconnectRepo = mutation({
  args: { repo: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "integrations.manage");
    const existing = await ctx.db
      .query("githubConnections")
      .withIndex("by_org_repo", (q) =>
        q.eq("orgId", ac.org._id).eq("repo", args.repo),
      )
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
      await ctx.db.insert("githubAudit", {
        orgId: ac.org._id,
        actorId: ac.user._id,
        actorName: ac.user.name ?? ac.user.email ?? "Member",
        action: "disconnect",
        repo: args.repo,
        detail: "Repository connection removed.",
        createdAt: Date.now(),
      });
    }
  },
});

// ---------------------------------------------------------------------
// Internal writers used by the github.ts actions
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Internal precheck for actions (github.ts): resolve the caller's access
// context in the default runtime (where db access lives) and require the
// organization-administration capability.
// ---------------------------------------------------------------------

export const actorInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const ac: AccessContext = await requireAccess(ctx);
    requireCapability(ac, "integrations.manage");
    return {
      orgId: ac.org._id,
      userId: ac.user._id,
      userName: ac.user.name ?? ac.user.email ?? "Member",
    };
  },
});

export const upsertConnection = internalMutation({
  args: {
    orgId: v.id("organizations"),
    repo: v.string(),
    owner: v.string(),
    name: v.string(),
    defaultBranch: v.string(),
    actorId: v.id("users"),
    actorName: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("githubConnections")
      .withIndex("by_org_repo", (q) =>
        q.eq("orgId", args.orgId).eq("repo", args.repo),
      )
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        owner: args.owner,
        name: args.name,
        defaultBranch: args.defaultBranch,
        connectedById: args.actorId,
        connectedAt: existing.connectedAt,
        lastVerifiedAt: now,
        lastError: undefined,
      });
    } else {
      await ctx.db.insert("githubConnections", {
        orgId: args.orgId,
        repo: args.repo,
        owner: args.owner,
        name: args.name,
        defaultBranch: args.defaultBranch,
        connectedById: args.actorId,
        connectedAt: now,
        lastVerifiedAt: now,
      });
    }
    await ctx.db.insert("githubAudit", {
      orgId: args.orgId,
      actorId: args.actorId,
      actorName: args.actorName,
      action: "connect",
      repo: args.repo,
      detail: existing
        ? "Repository re-verified and connection updated."
        : "Repository connected and verified against the API.",
      createdAt: now,
    });
  },
});

export const auditWrite = internalMutation({
  args: {
    orgId: v.id("organizations"),
    actorId: v.id("users"),
    actorName: v.string(),
    action: v.string(),
    repo: v.optional(v.string()),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("githubAudit", {
      orgId: args.orgId,
      actorId: args.actorId,
      actorName: args.actorName,
      action: args.action,
      repo: args.repo,
      detail: args.detail,
      createdAt: Date.now(),
    });
  },
});
