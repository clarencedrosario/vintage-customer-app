import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { getCurrentUser } from "./users";
import { sha256Hex } from "./crypto";
import type { Id } from "./_generated/dataModel";

function requireUser<T extends { _id: Id<"users">; role?: string }>(
  user: T | null,
): asserts user is T {
  if (!user) throw new Error("You must be signed in.");
}

/** Invitations are hashed with a per-invite salt so equal tokens never collide. */
function tokenHash(salt: string, raw: string): string {
  return sha256Hex(`${salt}:${raw}`);
}

function freshSalt(): string {
  return Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36);
}

// ---------------------------------------------------------------
// Creating invitations (firm / lawyer roles only).
// The caller generates the raw token in the browser with
// crypto.getRandomValues and passes it here; only the salted SHA-256
// hash is stored. The raw token is shown once to the inviter to share
// out-of-band, and never persisted server-side.
// ---------------------------------------------------------------

/** Invite a staff member (role: lawyer or staff). */
export const inviteStaff = mutation({
  args: {
    email: v.string(),
    role: v.union(v.literal("lawyer"), v.literal("staff")),
    token: v.string(), // ~24 random bytes, base64url, from the client
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    requireUser(user);
    if (user.role === "staff" || user.role === "client") {
      throw new Error("You are not authorized to invite staff.");
    }
    if (args.token.length < 24) {
      throw new Error("Token entropy too low.");
    }

    const email = args.email.trim().toLowerCase();
    const salt = freshSalt();
    const now = Date.now();

    await ctx.db.insert("invitations", {
      email,
      kind: "staff",
      role: args.role,
      salt,
      tokenHash: tokenHash(salt, args.token),
      invitedBy: user._id,
      expiresAt: now + 14 * 24 * 60 * 60 * 1000, // 14 days
      createdAt: now,
    });

    return { token: args.token };
  },
});

/** Connect an existing client record to a portal account via invitation. */
export const inviteClient = mutation({
  args: {
    clientId: v.id("clients"),
    email: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    requireUser(user);
    if (user.role === "staff" || user.role === "client") {
      throw new Error("You are not authorized to connect clients.");
    }
    if (args.token.length < 24) {
      throw new Error("Token entropy too low.");
    }

    const client = await ctx.db.get(args.clientId);
    if (!client) throw new Error("Client not found.");

    const email = args.email.trim().toLowerCase();
    const salt = freshSalt();
    const now = Date.now();

    await ctx.db.insert("invitations", {
      email,
      kind: "client",
      clientId: args.clientId,
      salt,
      tokenHash: tokenHash(salt, args.token),
      invitedBy: user._id,
      expiresAt: now + 14 * 24 * 60 * 60 * 1000,
      createdAt: now,
    });

    return { token: args.token };
  },
});

// ---------------------------------------------------------------
// Revocation & audit (authorized roles) — tokens are never returned.
// ---------------------------------------------------------------

export const listInvitations = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    if (user.role === "staff" || user.role === "client") return [];

    const rows = await ctx.db.query("invitations").order("desc").collect();
    return rows.map((r) => ({
      _id: r._id,
      email: r.email,
      kind: r.kind,
      role: r.role,
      clientId: r.clientId,
      status: r.revokedAt
        ? ("revoked" as const)
        : r.usedAt
          ? ("accepted" as const)
          : Date.now() > r.expiresAt
            ? ("expired" as const)
            : ("pending" as const),
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
    }));
  },
});

export const revokeInvitation = mutation({
  args: { invitationId: v.id("invitations") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    requireUser(user);
    if (user.role === "staff" || user.role === "client") {
      throw new Error("You are not authorized to revoke invitations.");
    }
    const invite = await ctx.db.get(args.invitationId);
    if (!invite) throw new Error("Invitation not found.");
    if (invite.usedAt) throw new Error("Invitation has already been accepted.");
    await ctx.db.patch(args.invitationId, { revokedAt: Date.now() });
  },
});

// ---------------------------------------------------------------
// Accepting an invitation (token-based; binding happens only against
// the caller's already-verified session).
// ---------------------------------------------------------------

/** Public: validate a token and report what it would grant. */
export const inspect = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const invite = await findByToken(ctx, args.token);
    if (!invite) return null;
    return {
      email: invite.email,
      kind: invite.kind,
      clientId: invite.clientId,
    };
  },
});

async function findByToken(ctx: { db: QueryCtx["db"] }, raw: string) {
  // Tokens are matched by salted hash; invitation volumes are small, so
  // a scan is fine and avoids storing the hash in an index (no oracle).
  const rows = await ctx.db.query("invitations").collect();
  for (const r of rows) {
    if (r.tokenHash === tokenHash(r.salt, raw)) {
      return r;
    }
  }
  return null;
}

/** Accept an invitation: binds the grant to the caller's verified account. */
export const accept = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    requireUser(user);
    if (user.isAnonymous) {
      throw new Error("Sign in with your own account before accepting.");
    }
    if (!user.email) throw new Error("Your account has no verified email.");

    const invite = await findByToken(ctx, args.token);
    if (!invite) throw new Error("This invitation is not valid.");
    if (invite.usedAt) throw new Error("This invitation has already been used.");
    if (invite.revokedAt) throw new Error("This invitation has been revoked.");
    if (Date.now() > invite.expiresAt) {
      throw new Error("This invitation has expired.");
    }
    // Tokens are redeemable only by the invited email's verified account.
    if (user.email.trim().toLowerCase() !== invite.email) {
      throw new Error("This invitation was issued to a different email address.");
    }

    if (invite.kind === "staff") {
      await ctx.db.patch(user._id, { role: invite.role ?? "staff" });
    } else if (invite.clientId) {
      // Explicit grant: bind the client record to this verified identity.
      const client = await ctx.db.get(invite.clientId);
      if (!client) throw new Error("The connected client record no longer exists.");
      await ctx.db.patch(invite.clientId, { userId: user._id });
      await ctx.db.patch(user._id, { role: "client" });
    }

    await ctx.db.patch(invite._id, { usedAt: Date.now() });
  },
});
