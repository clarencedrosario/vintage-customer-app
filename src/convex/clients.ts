import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";

/** All clients in the chamber, newest first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const clients = await ctx.db.query("clients").collect();
    return clients.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** One client. */
export const get = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    return await ctx.db.get(args.clientId);
  },
});

/** Create a client (individual / company / trust / government). */
export const create = mutation({
  args: {
    name: v.string(),
    kind: v.union(
      v.literal("individual"),
      v.literal("company"),
      v.literal("trust"),
      v.literal("government"),
    ),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    addressLine1: v.optional(v.string()),
    addressLine2: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    pincode: v.optional(v.string()),
    gstin: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");

    const name = args.name.trim();
    if (!name) throw new Error("Client name is required.");

    if (args.pincode && !/^\d{6}$/.test(args.pincode.trim())) {
      throw new Error("PIN code must be exactly 6 digits.");
    }
    if (args.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/.test(args.gstin.trim().toUpperCase())) {
      throw new Error("That GSTIN does not look valid.");
    }

    return await ctx.db.insert("clients", {
      ...args,
      name,
      gstin: args.gstin?.trim().toUpperCase() || undefined,
      createdBy: user._id,
      createdAt: Date.now(),
    });
  },
});

/** Update a client. */
export const update = mutation({
  args: {
    clientId: v.id("clients"),
    name: v.optional(v.string()),
    kind: v.optional(
      v.union(
        v.literal("individual"),
        v.literal("company"),
        v.literal("trust"),
        v.literal("government"),
      ),
    ),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    addressLine1: v.optional(v.string()),
    addressLine2: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    pincode: v.optional(v.string()),
    gstin: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");

    const { clientId, ...patch } = args;
    await ctx.db.patch(clientId, patch);
  },
});

/** Open matters count per client, for list display. */
export const openMatterCounts = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return {};

    const matters = await ctx.db.query("matters").collect();
    const counts: Record<string, number> = {};
    for (const m of matters) {
      if (m.status !== "closed") {
        counts[m.clientId] = (counts[m.clientId] ?? 0) + 1;
      }
    }
    return counts;
  },
});
