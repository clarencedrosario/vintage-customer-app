import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";

/** Chamber team (all signed-up users), for the Team page. */
export const team = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const users = await ctx.db.query("users").collect();
    return users
      .filter((u) => !u.isAnonymous)
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  },
});

/** Update your own profile (name, designation, phone, bar council id). */
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

/** Promote/demote a member (admin only). */
export const setRole = mutation({
  args: {
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("user"), v.literal("member")),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user || user.role !== "admin")
      throw new Error("Only the chamber administrator can change roles.");
    await ctx.db.patch(args.userId, { role: args.role });
  },
});

/** Chamber overview counts for the dashboard. */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const [matters, hearings, tasks, clients] = await Promise.all([
      ctx.db.query("matters").collect(),
      ctx.db.query("hearings").collect(),
      ctx.db.query("tasks").collect(),
      ctx.db.query("clients").collect(),
    ]);

    const now = Date.now();

    return {
      openMatters: matters.filter((m) => m.status !== "closed").length,
      clients: clients.length,
      upcomingHearings: hearings.filter(
        (h) => h.status === "scheduled" && h.at > now,
      ).length,
      pendingTasks: tasks.filter((t) => t.status === "pending").length,
    };
  },
});

/** Simple text search across clients and matters. */
export const search = query({
  args: { q: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { clients: [], matters: [] };

    const needle = args.q.trim().toLowerCase();
    if (!needle) return { clients: [], matters: [] };

    const [clients, matters] = await Promise.all([
      ctx.db.query("clients").collect(),
      ctx.db.query("matters").collect(),
    ]);

    return {
      clients: clients
        .filter((c) => c.name.toLowerCase().includes(needle))
        .slice(0, 5),
      matters: matters
        .filter(
          (m) =>
            m.title.toLowerCase().includes(needle) ||
            m.reference.toLowerCase().includes(needle),
        )
        .slice(0, 5),
    };
  },
});
