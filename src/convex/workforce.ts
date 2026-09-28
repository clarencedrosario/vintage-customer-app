// =====================================================================
// CJ GLOBAL internal workforce — Convex functions.
//
// Invite → accept → persist → gate → suspend → revoke, entirely separate
// from chamber membership (memberships/invitations). Roles are platform-
// only (support_agent / support_supervisor / developer); ownership is NOT
// a role: it stays the audited isPlatformAdmin flag bound to the verified
// PLATFORM_OWNER_EMAIL account, and no workforce function can set it.
// =====================================================================
import { v } from "convex/values";
import {
  mutation,
  query,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { getCurrentUser } from "./users";
import { invitationTokenHash, freshInviteSalt } from "../lib/invitationFlow";
import type { Doc } from "./_generated/dataModel";
import {
  PLATFORM_ROLES,
  canManageWorkforce,
  canActOnEmployee,
  canChangeRole,
  effectivePlatformIdentity,
  type PlatformRole,
} from "./platformWorkforce";

const INVITE_TTL = 14 * 24 * 60 * 60 * 1000; // 14 days, mirrors chamber invites
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function roleValidator() {
  return v.union(...PLATFORM_ROLES.map((r) => v.literal(r)));
}

async function actorOf(ctx: QueryCtx | MutationCtx) {
  const user = await getCurrentUser(ctx as QueryCtx);
  if (!user || user.isAnonymous) return null;
  return user;
}

async function freshToken(): Promise<string> {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

type PlatformActor = {
  userId: string;
  isPlatformAdmin: boolean;
  platformRole: PlatformRole | null;
  capabilities: string[];
};

/**
 * The caller's platform-workforce actor: the operator flag (owner) or an
 * ACTIVE platformEmployees row. Suspended employees resolve to a null
 * role (no capabilities) while their row remains for audit.
 */
export async function platformActorOf(
  ctx: QueryCtx | MutationCtx,
): Promise<PlatformActor | null> {
  const user = await actorOf(ctx);
  if (!user) return null;
  const row = await ctx.db
    .query("platformEmployees")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .unique();
  const eff = effectivePlatformIdentity(row);
  return {
    userId: user._id,
    isPlatformAdmin: !!user.isPlatformAdmin,
    platformRole: eff.platformRole,
    capabilities: eff.capabilities,
  };
}

async function requireWorkforceManager(ctx: QueryCtx | MutationCtx) {
  const actor = await platformActorOf(ctx);
  if (!actor || !canManageWorkforce(actor)) {
    throw new Error("Platform workforce administration requires the platform owner.");
  }
  return actor;
}

async function actorNameOf(
  ctx: QueryCtx | MutationCtx,
  userId: string,
): Promise<string | undefined> {
  const u = await ctx.db.get(userId as never);
  if (!u) return undefined;
  const name = (u as { name?: string | null }).name;
  const email = (u as { email?: string | null }).email;
  return name ?? email ?? undefined;
}

// ---------------------------------------------------------------------
// Owner: invite / revoke / suspend / unsuspend / set-role / list
// ---------------------------------------------------------------------

export const inviteEmployee = mutation({
  args: {
    email: v.string(),
    role: roleValidator(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireWorkforceManager(ctx);
    const email = args.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new Error("Enter a valid email address.");
    if (args.token.length < 24) throw new Error("Token entropy too low.");

    // An existing ACTIVE employee of the same email cannot be re-invited.
    const existing = await ctx.db
      .query("platformEmployees")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existing && existing.status === "active") {
      throw new Error("That email already belongs to an active platform employee.");
    }

    // Supersede any live invite for the same email; history stays.
    const prior = await ctx.db
      .query("platformInvitations")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    const now = Date.now();
    for (const p of prior) {
      if (!p.acceptedAt && !p.revokedAt && p.expiresAt > now) {
        await ctx.db.patch(p._id, { revokedAt: now });
      }
    }

    const salt = freshInviteSalt(now);
    await ctx.db.insert("platformInvitations", {
      email,
      role: args.role,
      salt,
      tokenHash: invitationTokenHash(salt, args.token),
      invitedBy: actor.userId as never,
      invitedByName: await actorNameOf(ctx, actor.userId),
      expiresAt: now + INVITE_TTL,
      createdAt: now,
    });
    return { ok: true as const };
  },
});

/**
 * Accept a platform invitation: verifies the token against the stored
 * hash, requires the signed-in account's VERIFIED email to match the
 * invite, and creates the platformEmployees row in the same transaction.
 * No password is set; identity is the authenticated OTP account.
 */
export const acceptEmployeeInvite = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await actorOf(ctx);
    if (!user) throw new Error("Sign in with the invited account to accept.");
    if (!user.email || !user.emailVerified) {
      throw new Error("Your account's email must be verified to accept an invitation.");
    }
    const email = user.email.trim().toLowerCase();

    const invites = await ctx.db
      .query("platformInvitations")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    const now = Date.now();
    let match: Doc<"platformInvitations"> | null = null;
    for (const p of invites) {
      if (p.acceptedAt || p.revokedAt || p.expiresAt < now) continue;
      if (invitationTokenHash(p.salt, args.token) === p.tokenHash) {
        match = p;
        break;
      }
    }
    if (!match) {
      throw new Error(
        "No valid invitation for this account. Ask the platform owner to re-invite.",
      );
    }

    const dup = await ctx.db
      .query("platformEmployees")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (dup) {
      // Re-acceptance reactivates a suspended employee; an active
      // duplicate is a no-op success.
      if (dup.status === "active") return { ok: true as const, alreadyActive: true };
      await ctx.db.patch(dup._id, {
        status: "active",
        role: match.role,
        unsuspendedAt: now,
        unsuspendedBy: user._id,
      });
      await ctx.db.patch(match._id, { acceptedAt: now });
      return { ok: true as const, reactivated: true };
    }

    await ctx.db.insert("platformEmployees", {
      userId: user._id,
      email,
      role: match.role,
      status: "active",
      invitedBy: match.invitedBy,
      invitedAt: match.createdAt,
      acceptedAt: now,
    });
    await ctx.db.patch(match._id, { acceptedAt: now });
    return { ok: true as const };
  },
});

export const suspendEmployee = mutation({
  args: { employeeId: v.id("platformEmployees") },
  handler: async (ctx, args) => {
    const actor = await requireWorkforceManager(ctx);
    const row = await ctx.db.get(args.employeeId);
    if (!row) throw new Error("Employee not found.");
    if (!canActOnEmployee(actor, row)) {
      throw new Error("You cannot change this employee's access.");
    }
    if (row.status === "suspended") return;
    await ctx.db.patch(args.employeeId, {
      status: "suspended",
      suspendedAt: Date.now(),
      suspendedBy: actor.userId as never,
    });
  },
});

export const unsuspendEmployee = mutation({
  args: { employeeId: v.id("platformEmployees") },
  handler: async (ctx, args) => {
    const actor = await requireWorkforceManager(ctx);
    const row = await ctx.db.get(args.employeeId);
    if (!row) throw new Error("Employee not found.");
    if (!canActOnEmployee(actor, row)) {
      throw new Error("You cannot change this employee's access.");
    }
    if (row.status === "active") return;
    await ctx.db.patch(args.employeeId, {
      status: "active",
      unsuspendedAt: Date.now(),
      unsuspendedBy: actor.userId as never,
    });
  },
});

export const setEmployeeRole = mutation({
  args: { employeeId: v.id("platformEmployees"), role: roleValidator() },
  handler: async (ctx, args) => {
    const actor = await requireWorkforceManager(ctx);
    const row = await ctx.db.get(args.employeeId);
    if (!row) throw new Error("Employee not found.");
    if (!canActOnEmployee(actor, row)) {
      throw new Error("You cannot change this employee's role.");
    }
    if (!canChangeRole(actor, args.role)) {
      throw new Error("That role cannot be assigned.");
    }
    if (row.role === args.role) return;
    await ctx.db.patch(args.employeeId, { role: args.role });
  },
});

export const revokeInvitation = mutation({
  args: { invitationId: v.id("platformInvitations") },
  handler: async (ctx, args) => {
    await requireWorkforceManager(ctx);
    const row = await ctx.db.get(args.invitationId);
    if (!row) throw new Error("Invitation not found.");
    if (row.acceptedAt) throw new Error("That invitation was already accepted.");
    if (row.revokedAt) return;
    await ctx.db.patch(args.invitationId, { revokedAt: Date.now() });
  },
});

// ---------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------

/** Workforce roster (owner only — employee rows are internal HR data). */
export const listEmployees = query({
  args: {},
  handler: async (ctx) => {
    await requireWorkforceManager(ctx);
    const rows = await ctx.db.query("platformEmployees").collect();
    return rows.sort((a, b) => a.email.localeCompare(b.email));
  },
});

/** Live invitations (owner only). Token hashes are never returned. */
export const listInvitations = query({
  args: {},
  handler: async (ctx) => {
    await requireWorkforceManager(ctx);
    const rows = await ctx.db.query("platformInvitations").collect();
    return rows
      .filter((r) => !r.acceptedAt)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({
        _id: r._id,
        email: r.email,
        role: r.role,
        invitedByName: r.invitedByName ?? null,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        revokedAt: r.revokedAt ?? null,
        expired: r.expiresAt < Date.now(),
      }));
  },
});

/**
 * The signed-in user's own platform identity (drives UI gating and the
 * invite-acceptance surface). Returns only the caller's own row.
 */
export const myPlatformIdentity = query({
  args: {},
  handler: async (ctx) => {
    return platformActorOf(ctx);
  },
});
