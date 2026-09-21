// =====================================================================
// Notification log mutations — plain (non-Node) internal functions used
// by the notify.ts provider bridge actions. Split out because Node
// modules may only define actions.
// =====================================================================

import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const logQueued = internalMutation({
  args: {
    orgId: v.id("organizations"),
    channel: v.union(v.literal("email"), v.literal("whatsapp")),
    recipientUserId: v.optional(v.id("users")),
    recipient: v.string(),
    category: v.string(),
    subject: v.optional(v.string()),
    templateName: v.optional(v.string()),
    conversationId: v.optional(v.id("conversations")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("notificationLog", {
      orgId: args.orgId,
      channel: args.channel,
      recipientUserId: args.recipientUserId,
      recipient: args.recipient,
      category: args.category,
      subject: args.subject,
      templateName: args.templateName,
      status: "queued",
      conversationId: args.conversationId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const markSent = internalMutation({
  args: { logId: v.id("notificationLog"), providerMessageId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.logId, {
      providerMessageId: args.providerMessageId,
      status: "sent",
      updatedAt: Date.now(),
    });
  },
});

export const markFailed = internalMutation({
  args: { logId: v.id("notificationLog"), reason: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.logId, {
      status: "failed",
      failureReason: args.reason.slice(0, 500),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Idempotent status callback application: one row per provider message
 * id + event type, so replays never double-apply. Updates the matching
 * notification log entry.
 */
export const applyProviderEvent = internalMutation({
  args: {
    channel: v.union(v.literal("email"), v.literal("whatsapp")),
    providerMessageId: v.string(),
    eventType: v.string(),
    payload: v.optional(v.string()),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const dedupeKey = `${args.providerMessageId}:${args.eventType}`;
    const existing = await ctx.db
      .query("whatsappEvents")
      .withIndex("by_msg_event", (q) => q.eq("providerMessageId", dedupeKey))
      .first();
    if (existing?.handled) return { applied: false as const };

    await ctx.db.insert("whatsappEvents", {
      providerMessageId: dedupeKey,
      eventType: args.eventType,
      payload: args.payload?.slice(0, 4000),
      handled: true,
      handledAt: Date.now(),
      createdAt: Date.now(),
    });

    // Find the logged message and advance its status.
    const rows = await ctx.db
      .query("notificationLog")
      .withIndex("by_provider_msg", (q) =>
        q.eq("providerMessageId", args.providerMessageId),
      )
      .collect();
    const status =
      args.eventType === "failed"
        ? "failed"
        : args.eventType === "read"
          ? "read"
          : args.eventType === "delivered"
            ? "delivered"
            : "sent";
    const rank: Record<string, number> = {
      queued: 0, sent: 1, delivered: 2, read: 3, failed: 4,
    };
    for (const row of rows) {
      // Never downgrade from a later state (read stays read; failed sticks).
      if (row.status !== "failed" && rank[status] <= rank[row.status]) continue;
      await ctx.db.patch(row._id, {
        status,
        failureReason: args.failureReason ?? row.failureReason,
        updatedAt: Date.now(),
      });
    }
    return { applied: true as const };
  },
});
