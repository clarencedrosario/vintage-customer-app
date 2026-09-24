import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { getCurrentUser } from "./users";
import { getAccessContext, requireAccess, requireCapability } from "./access";
import {
  freshInviteSalt,
  invitationBlocker,
  invitationStatus,
  invitationTokenHash,
  invitedEmailMatches,
  seatAvailable,
} from "../lib/invitationFlow";
import { MEMBERSHIP_STATUSES } from "./schema";
import type { Id } from "./_generated/dataModel";

/** Invitations are hashed with a per-invite salt (tested pure logic). */
const tokenHash = invitationTokenHash;
const freshSalt = freshInviteSalt;

async function findByToken(ctx: { db: QueryCtx["db"] }, raw: string) {
  const rows = await ctx.db.query("invitations").collect();
  for (const r of rows) {
    if (r.tokenHash === tokenHash(r.salt, raw)) return r;
  }
  return null;
}

// ---------------------------------------------------------------
// Creating invitations (team.invite capability)
// ---------------------------------------------------------------

/** Invite a staff member into the organization with an org role. */
export const inviteStaff = mutation({
  args: {
    email: v.string(),
    orgRole: v.union(
      v.literal("partner"),
      v.literal("senior_associate"),
      v.literal("associate"),
      v.literal("junior"),
      v.literal("paralegal"),
      v.literal("accountant"),
      v.literal("administrator"),
      v.literal("support_staff"),
    ),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "team.invite");
    if (args.token.length < 24) throw new Error("Token entropy too low.");

    const email = args.email.trim().toLowerCase();
    const salt = freshSalt();
    const now = Date.now();

    await ctx.db.insert("invitations", {
      orgId: ac.org._id,
      email,
      kind: "staff",
      orgRole: args.orgRole,
      salt,
      tokenHash: tokenHash(salt, args.token),
      invitedBy: ac.user._id,
      expiresAt: now + 14 * 24 * 60 * 60 * 1000,
      createdAt: now,
    });

    return { token: args.token };
  },
});

/** Connect an existing client record to a portal account. */
export const inviteClient = mutation({
  args: {
    clientId: v.id("clients"),
    email: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "team.invite");
    if (args.token.length < 24) throw new Error("Token entropy too low.");

    const client = await ctx.db.get(args.clientId);
    if (!client || client.orgId !== ac.org._id) {
      throw new Error("Client not found in your organization.");
    }

    const email = args.email.trim().toLowerCase();
    const salt = freshSalt();
    const now = Date.now();

    await ctx.db.insert("invitations", {
      orgId: ac.org._id,
      email,
      kind: "client",
      clientId: args.clientId,
      salt,
      tokenHash: tokenHash(salt, args.token),
      invitedBy: ac.user._id,
      expiresAt: now + 14 * 24 * 60 * 60 * 1000,
      createdAt: now,
    });

    return { token: args.token };
  },
});

// ---------------------------------------------------------------
// Register (list) & revoke — team.manage / team.invite
// ---------------------------------------------------------------

export const listInvitations = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    if (!ac.permissions.has("team.invite") && !ac.permissions.has("team.manage")) {
      return [];
    }
    const rows = await ctx.db.query("invitations").collect();
    const now = Date.now();
    return rows
      .filter((r) => r.orgId === ac.org._id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({
        _id: r._id,
        email: r.email,
        kind: r.kind,
        orgRole: r.orgRole,
        status: invitationStatus(r, now),
        expiresAt: r.expiresAt,
        createdAt: r.createdAt,
      }));
  },
});

export const revokeInvitation = mutation({
  args: { invitationId: v.id("invitations") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "team.invite");
    const invite = await ctx.db.get(args.invitationId);
    if (!invite || invite.orgId !== ac.org._id) {
      throw new Error("Invitation not found in your organization.");
    }
    if (invite.usedAt) throw new Error("Invitation has already been accepted.");
    await ctx.db.patch(args.invitationId, { revokedAt: Date.now() });
  },
});

// ---------------------------------------------------------------
// Acceptance — binds to the caller's verified account only
// ---------------------------------------------------------------

/** Public: validate a token and report what it would grant. */
export const inspect = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const invite = await findByToken(ctx, args.token);
    if (!invite || invite.usedAt || invite.revokedAt || Date.now() > invite.expiresAt) {
      return null;
    }
    return { email: invite.email, kind: invite.kind, orgRole: invite.orgRole };
  },
});

/** Accept an invitation while signed in with the invited email. */
/** Seat limit for an org's live subscription, or null when unlimited/none. */
async function getSubSeatLimit(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
): Promise<number | null> {
  const rows = await ctx.db
    .query("subscriptions")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const sub = rows[0];
  return sub?.seatLimit ?? null;
}

export const accept = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");
    if (user.isAnonymous) {
      throw new Error("Sign in with your own account before accepting.");
    }
    if (!user.email) throw new Error("Your account has no verified email.");

    const invite = await findByToken(ctx, args.token);
    // Same precedence as the pure invitationBlocker (unit-tested).
    const blocker = invitationBlocker(
      invite && {
        usedAt: invite.usedAt,
        revokedAt: invite.revokedAt,
        expiresAt: invite.expiresAt,
        email: invite.email,
      },
      Date.now(),
    );
    if (blocker === "not_valid") throw new Error("This invitation is not valid.");
    if (blocker === "already_used") throw new Error("This invitation has already been used.");
    if (blocker === "revoked") throw new Error("This invitation has been revoked.");
    if (blocker === "expired") throw new Error("This invitation has expired.");
    if (!invite) throw new Error("This invitation is not valid.");
    if (!invitedEmailMatches(invite.email, user.email)) {
      throw new Error("This invitation was issued to a different email address.");
    }

    const now = Date.now();
    if (invite.kind === "staff" && invite.orgId) {
      // Subscription seat limit (section 24): active memberships beyond
      // the plan's seat limit cannot join. Owners/administrators acting
      // as firm administrators may be invited seat-exempt (never for
      // billable legal roles — the invite UI must set that explicitly).
      const org = await ctx.db.get(invite.orgId);
      if (org) {
        const seatLimit = org.subscription?.status === "active" || org.subscription?.status === "trialing"
          ? (await getSubSeatLimit(ctx, invite.orgId))
          : null;
        const members =
          seatLimit !== null
            ? await ctx.db
                .query("memberships")
                .withIndex("by_org", (q) => q.eq("orgId", invite.orgId))
                .collect()
            : [];
        if (!seatAvailable(seatLimit, members, invite.seatExempt === true)) {
          const n = seatLimit ?? 0;
          throw new Error(
            `Your chamber's plan includes ${n} seat${n === 1 ? "" : "s"} and they are all in use. Upgrade the plan or free a seat to invite more members.`,
          );
        }
      }

      // Idempotent: reactivate an existing (suspended) membership instead
      // of duplicating rows; otherwise create an INVITED→ACTIVE membership.
      const existing = await ctx.db
        .query("memberships")
        .withIndex("by_org_user", (q) =>
          q.eq("orgId", invite.orgId!).eq("userId", user._id),
        )
        .collect();
      if (existing[0]) {
        await ctx.db.patch(existing[0]._id, {
          status: MEMBERSHIP_STATUSES.ACTIVE,
          orgRole: invite.orgRole ?? existing[0].orgRole,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("memberships", {
          orgId: invite.orgId,
          userId: user._id,
          orgRole: invite.orgRole ?? "support_staff",
          status: MEMBERSHIP_STATUSES.ACTIVE,
          invitedBy: invite.invitedBy,
          createdAt: now,
          updatedAt: now,
        });
      }
      await ctx.db.patch(user._id, { activeOrgId: invite.orgId });
    } else if (invite.kind === "client" && invite.clientId) {
      const client = await ctx.db.get(invite.clientId);
      if (!client) {
        throw new Error("The connected client record no longer exists.");
      }
      await ctx.db.patch(invite.clientId, { userId: user._id });
      // Legacy fallback role: only set it for accounts that have no role
      // yet. Overwriting an existing firm role would mis-route the user's
      // fallback portal when their memberships resolve to nothing.
      if (!user.role) {
        await ctx.db.patch(user._id, { role: "client" });
      }
    }

    await ctx.db.patch(invite._id, { usedAt: now });
  },
});
