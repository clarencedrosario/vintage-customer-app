import { v } from "convex/values";
import { mutation, query, MutationCtx } from "./_generated/server";
import { getCurrentUser } from "./users";

export const DEFAULT_CHAMBER = {
  key: "chamber",
  chamberName: "Advokate Chamber",
  addressLine1: "4th Floor, Chambers Block",
  addressLine2: "High Court Annexe",
  city: "Mumbai",
  state: "Maharashtra",
  pincode: "400032",
  phone: "+91 98200 00000",
  email: "office@advokate.in",
  website: "advokate.in",
  gstin: "",
  currency: "INR",
  timezone: "Asia/Kolkata",
  financialYearStart: "04-01",
  taxLabel: "GST",
  taxPercent: 18,
  invoicePrefix: "ADV",
};

/** Singleton chamber settings; creates defaults on first read. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "chamber"))
      .unique();
    if (existing) return existing;
    return null;
  },
});

/** Create-or-update the chamber settings (admin only). */
export const upsert = mutation({
  args: {
    chamberName: v.string(),
    addressLine1: v.string(),
    addressLine2: v.optional(v.string()),
    city: v.string(),
    state: v.string(),
    pincode: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    website: v.optional(v.string()),
    gstin: v.optional(v.string()),
    currency: v.string(),
    timezone: v.string(),
    financialYearStart: v.string(),
    taxLabel: v.string(),
    taxPercent: v.number(),
    invoicePrefix: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");
    if (user.role !== "admin")
      throw new Error("Only the chamber administrator can change settings.");

    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "chamber"))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("settings", { key: "chamber", ...args });
  },
});

/** Internal accessor used when generating invoice numbers and references. */
export async function getOrCreateChamber(ctx: MutationCtx) {
  const existing = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", "chamber"))
    .unique();
  if (existing) return existing;
  const id = await ctx.db.insert("settings", { ...DEFAULT_CHAMBER });
  return await ctx.db.get(id);
}
