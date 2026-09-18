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
