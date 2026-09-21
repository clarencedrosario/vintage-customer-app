// =====================================================================
// In-app notification centre — creation is internal (called from the
// flows that produce events); listing and read-state are the public
// surface used by the top-bar bell.
// =====================================================================

import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";

const KINDS = [
  "hearing_reminder",
  "deadline_reminder",
  "task_assigned",
  "doc_request",
  "message",
  "draft_approval",
  "invoice_followup",
  "automation",
] as const;

/** Create a notification, deduping on (user, dedupeKey). */
export const createInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    kind: v.union(...KINDS.map((k) => v.literal(k))),
    title: v.string(),
    body: v.optional(v.string()),
    linkTo: v.optional(v.string()),
    dedupeKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.dedupeKey) {
      const existing = await ctx.db
        .query("appNotifications")
        .withIndex("by_user_dedupe", (q) =>
          q.eq("userId", args.userId).eq("dedupeKey", args.dedupeKey),
        )
        .first();
      if (existing) return existing._id;
    }
    return await ctx.db.insert("appNotifications", {
      orgId: args.orgId,
      userId: args.userId,
      kind: args.kind,
      title: args.title.slice(0, 200),
      body: args.body?.slice(0, 500),
      linkTo: args.linkTo,
      dedupeKey: args.dedupeKey,
      createdAt: Date.now(),
    });
  },
});

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const userId = user._id;
    const rows = await ctx.db
      .query("appNotifications")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .take(Math.min(args.limit ?? 30, 100));
    // Honour the user's muted kinds (settings) — muted rows stay stored
    // and simply do not surface in the centre.
    const prefs = await ctx.db
      .query("userNotificationPrefs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    const muted = new Set(prefs?.mutedKinds ?? []);
    return rows.filter((r) => !muted.has(r.kind));
  },
});

export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return 0;
    const userId = user._id;
    const rows = await ctx.db
      .query("appNotifications")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .collect();
    return rows.filter((r) => !r.readAt).length;
  },
});

export const markRead = mutation({
  args: { notificationId: v.id("appNotifications") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Sign in first.");
    const userId = user._id;
    const row = await ctx.db.get(args.notificationId);
    if (!row || row.userId !== userId) {
      throw new Error("Notification not found.");
    }
    if (!row.readAt) await ctx.db.patch(args.notificationId, { readAt: Date.now() });
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Sign in first.");
    const userId = user._id;
    const rows = await ctx.db
      .query("appNotifications")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .collect();
    const now = Date.now();
    for (const r of rows) {
      if (!r.readAt) await ctx.db.patch(r._id, { readAt: now });
    }
  },
});
