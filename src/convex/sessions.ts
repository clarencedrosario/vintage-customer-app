import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";

/**
 * Sign out of every device: deletes all of the user's auth sessions
 * server-side. Live JWTs stop validating once the session row is gone
 * and refresh attempts fail, so every client is forced to re-authenticate.
 */
export const signOutAllDevices = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");

    const sessions = await ctx.db
      .query("authSessions")
      .filter((q) => q.eq(q.field("userId"), user._id))
      .collect();
    for (const s of sessions) {
      await ctx.db.delete(s._id);
    }
    return { signedOut: sessions.length };
  },
});

/** How many active sessions exist (for the Security settings card). */
export const activeSessions = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { count: 0 };
    const sessions = await ctx.db
      .query("authSessions")
      .filter((q) => q.eq(q.field("userId"), user._id))
      .collect();
    return { count: sessions.length };
  },
});

// ---------------------------------------------------------------
// Login history (security feature)
//
// One append-only row per successful sign-in, written by the
// authenticated caller right after verification succeeds (the server
// session already exists at that point). Rows are readable ONLY by the
// account that owns them — never by firm administrators — so the trail
// cannot be used to surveil other members.
// ---------------------------------------------------------------

/** Record the current signed-in session as a successful login. */
export const recordLogin = mutation({
  args: { userAgent: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user || user.isAnonymous) return null;
    const at = Date.now();
    await ctx.db.insert("loginEvents", {
      userId: user._id,
      email: user.email,
      at,
      userAgent: args.userAgent?.slice(0, 300),
    });
    return at;
  },
});

/** My last 20 sign-ins (own rows only — no cross-account access). */
export const myLoginHistory = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user || user.isAnonymous) return [];
    return ctx.db
      .query("loginEvents")
      .withIndex("by_user_time", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(20);
  },
});

/**
 * Housekeeping: remove 2FA session marks older than 30 days, matching
 * the Convex Auth session lifetime. Session expiry itself is enforced
 * by Convex Auth when refresh tokens are validated against session rows.
 */
export const purgeStaleMarks = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const stale = await ctx.db
      .query("twoFactorSessions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    let removed = 0;
    for (const s of stale) {
      if (s.at < cutoff) {
        await ctx.db.delete(s._id);
        removed++;
      }
    }
    return { removed };
  },
});
