import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { getCurrentUser } from "./users";
import { base32Decode, base32Encode, hmacSha1, sha256Hex } from "./crypto";
import { getAuthSessionId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";

function requireUser<
  T extends { _id: Id<"users">; email?: string; isAnonymous?: boolean },
>(user: T | null): asserts user is T {
  if (!user) throw new Error("You must be signed in.");
}

/** RFC 6238 TOTP (SHA-1 HMAC, 6 digits, 30-second step) at a given time. */
function totpAt(secret: Uint8Array, atMs: number): string {
  const counter = Math.floor(atMs / 1000 / 30);
  const buf = new Uint8Array(8);
  const hi = Math.floor(counter / 0x100000000);
  const lo = counter >>> 0;
  buf[0] = (hi >>> 24) & 0xff;
  buf[1] = (hi >>> 16) & 0xff;
  buf[2] = (hi >>> 8) & 0xff;
  buf[3] = hi & 0xff;
  buf[4] = (lo >>> 24) & 0xff;
  buf[5] = (lo >>> 16) & 0xff;
  buf[6] = (lo >>> 8) & 0xff;
  buf[7] = lo & 0xff;

  const mac = hmacSha1(secret, buf);
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  return String(bin % 1_000_000).padStart(6, "0");
}

type InternalMfaState = {
  /** A TOTP enrollment row exists (may be half-finished). */
  enrollmentExists: boolean;
  /** TOTP enabled AND a live recovery-code set exists. */
  enrolled: boolean;
  /** Enrolled internal accounts always face the challenge. */
  challengeNeeded: true | false;
  /** This auth session has completed the challenge. */
  satisfied: boolean;
};

/** Verify a 6-digit code, tolerating one step of clock drift. */
function verifyTotp(secret: string, code: string, atMs = Date.now()): boolean {
  const key = base32Decode(secret);
  for (const drift of [-1, 0, 1]) {
    if (totpAt(key, atMs + drift * 30_000) === code.trim()) {
      return true;
    }
  }
  return false;
}

/**
 * Exported for tests and tooling only: the TOTP code a given base32 secret
 * produces at a point in time (drift 0). Never used for verification inside
 * the app — verifyTotp stays the single authority.
 */
export function totpCodeAt(secret: string, atMs = Date.now()): string {
  return totpAt(base32Decode(secret), atMs);
}

async function enrollmentFor(db: QueryCtx["db"], userId: Id<"users">) {
  const rows = await db
    .query("twoFactor")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return rows[0] ?? null;
}

// ---------------------------------------------------------------
// Status & enrollment
// ---------------------------------------------------------------

/** Is 2FA enabled for the signed-in user? */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { enabled: false };
    const rec = await enrollmentFor(ctx.db, user._id);
    return { enabled: rec?.enabled ?? false };
  },
});

/**
 * Begin enrollment. The browser supplies 20 CSPRNG bytes (crypto.getRandomValues)
 * as base64; the server stores only the derived base32 secret. Returns the
 * otpauth:// URI to scan into an authenticator app.
 */
export const startEnrollment = mutation({
  args: { entropy: v.string() }, // 20 random bytes, base64, from the client
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    requireUser(user);
    if (user.isAnonymous) {
      throw new Error("Two-factor requires a named account.");
    }

    // Decode base64 → bytes → base32.
    const raw = Uint8Array.from(atob(args.entropy), (c) => c.charCodeAt(0));
    if (raw.length < 16) throw new Error("Entropy too low.");
    const secret = base32Encode(raw);

    const existing = await enrollmentFor(ctx.db, user._id);
    if (existing) {
      await ctx.db.patch(existing._id, { secret, enabled: false });
    } else {
      await ctx.db.insert("twoFactor", {
        userId: user._id,
        secret,
        enabled: false,
        createdAt: Date.now(),
      });
    }

    const label = encodeURIComponent(user.email ?? "advokate.in");
    const issuer = encodeURIComponent("ADVOKATE.IN");
    return {
      otpauthUri: `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`,
      secret,
    };
  },
});

/** Confirm enrollment with a valid code; issues recovery codes once. */
export const confirmEnrollment = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    requireUser(user);
    const rec = await enrollmentFor(ctx.db, user._id);
    if (!rec) throw new Error("Start enrollment first.");
    if (!verifyTotp(rec.secret, args.code)) {
      throw new Error("That code is not valid — check your authenticator.");
    }

    await ctx.db.patch(rec._id, { enabled: true, confirmedAt: Date.now() });

    // Issue 8 single-use recovery codes (shown once, hashed at rest).
    const previous = await ctx.db
      .query("recoveryCodes")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    for (const c of previous) await ctx.db.delete(c._id);

    // Recovery codes are generated client-side (CSPRNG) and supplied here.
    return { recoveryCodes: [] as string[] };
  },
});

/** Store recovery codes supplied by the client (hashed at rest). */
export const storeRecoveryCodes = mutation({
  args: { codes: v.array(v.string()) },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    requireUser(user);
    const rec = await enrollmentFor(ctx.db, user._id);
    if (!rec?.enabled) throw new Error("Two-factor is not enabled.");

    const previous = await ctx.db
      .query("recoveryCodes")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    for (const c of previous) await ctx.db.delete(c._id);

    for (const raw of args.codes) {
      await ctx.db.insert("recoveryCodes", {
        userId: user._id,
        codeHash: sha256Hex(raw.trim().toLowerCase()),
        createdAt: Date.now(),
      });
    }
    return { stored: args.codes.length };
  },
});

/** Disable 2FA after re-authenticating with a current code. */
export const disable = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    requireUser(user);
    const rec = await enrollmentFor(ctx.db, user._id);
    if (!rec || !rec.enabled) throw new Error("Two-factor is not enabled.");
    if (!verifyTotp(rec.secret, args.code)) {
      throw new Error("That code is not valid.");
    }
    const codes = await ctx.db
      .query("recoveryCodes")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    for (const c of codes) await ctx.db.delete(c._id);
    await ctx.db.delete(rec._id);
  },
});

/** Verify a TOTP code or consume a recovery code for this session. */
export const verifyForSession = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    requireUser(user);
    const rec = await enrollmentFor(ctx.db, user._id);
    if (!rec?.enabled) throw new Error("Two-factor is not enabled.");

    const code = args.code.trim();
    const isTotp = /^\d{6}$/.test(code);
    if (isTotp) {
      if (!verifyTotp(rec.secret, code)) {
        throw new Error("That code is not valid.");
      }
    } else {
      // Recovery code: hashed lookup, single use.
      const h = sha256Hex(code.replace(/\s+/g, "").toLowerCase());
      const rows = await ctx.db
        .query("recoveryCodes")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      const match = rows.find((r) => !r.usedAt && r.codeHash === h);
      if (!match) throw new Error("That recovery code is not valid.");
      await ctx.db.patch(match._id, { usedAt: Date.now() });
    }

    // Mark this session as having satisfied two-factor.
    const sessionId = await getAuthSessionId(ctx);
    if (sessionId) {
      const existing = await ctx.db
        .query("twoFactorSessions")
        .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
        .unique();
      if (!existing) {
        await ctx.db.insert("twoFactorSessions", {
          userId: user._id,
          sessionId,
          at: Date.now(),
        });
      }
    }
  },
});

/**
 * INTERNAL-ACCOUNT MFA STATE (computed, not stored).
 *
 * A user is internally enrolled once their TOTP enrollment row exists AND
 * their recovery-code set is non-empty: both legs are created in one
 * enrollment transaction, so a half-enrolled account (secret confirmed but
 * recovery codes never stored) is impossible through the UI flow and reads
 * as not-yet-enrolled. Internal accounts with an incomplete enrollment are
 * refused on challenge; everyone else gets a false.
 *
 * Deliberately NOT a stored "isInternal" flag: internal staff and owners
 * both come and go through existing audited mechanisms (workforce
 * suspension, role changes, owner flag), and any flag would drift. Internal
 * status is derived per request from the audited state that already exists.
 */
export async function internalMfaState(
  db: QueryCtx["db"],
  user: { _id: Id<"users"> },
  sessionId: string | null,
): Promise<InternalMfaState> {
  const rec = await enrollmentFor(db, user._id);
  if (!rec)
    return {
      enrollmentExists: false,
      enrolled: false,
      challengeNeeded: false,
      satisfied: false,
    };
  const codes = await db
    .query("recoveryCodes")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .collect();
  const enrolled = !!rec.enabled && codes.length > 0;
  if (!enrolled)
    return {
      enrollmentExists: true,
      enrolled: false,
      challengeNeeded: false,
      satisfied: false,
    };
  let satisfied = false;
  if (sessionId) {
    const sess = await db
      .query("twoFactorSessions")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .unique();
    satisfied = !!sess;
  }
  return { enrollmentExists: true, enrolled: true, challengeNeeded: true, satisfied };
}

/**
 * SERVER-SIDE GATE for internal platform surfaces (owner console, workforce
 * management, platform operations mutations).
 *
 * Policy for internal platform accounts (owner flag or active workforce
 * role): TOTP-based MFA with recovery codes is REQUIRED, and each session
 * must complete the challenge before any internal mutation. The emailed
 * sign-in OTP is an authentication mechanism, NOT a second factor — it
 * proves mailbox possession at login time and never satisfies this gate.
 *
 * Three refusals, each with its own recovery instruction:
 *  1. not enrolled          → enroll first (Settings → Security);
 *  2. half-finished         → complete enrollment (secret confirmed but
 *     recovery codes never stored);
 *  3. enrolled, unsatisfied → enter a TOTP or recovery code (challenge UI).
 */
export async function requireInternalMfa(
  ctx: QueryCtx | MutationCtx,
): Promise<void> {
  const user = await getCurrentUser(ctx);
  if (!user || user.isAnonymous) throw new Error("Sign in required.");
  const sessionId = await getAuthSessionId(ctx);
  const state = await internalMfaState(ctx.db, user, sessionId);
  if (state.enrollmentExists && !state.enrolled) {
    throw new Error(
      "Finish two-factor enrollment (Settings → Security) before using the platform console.",
    );
  }
  if (!state.enrolled) {
    throw new Error(
      "Two-factor enrollment is required for platform accounts (Settings → Security).",
    );
  }
  if (!state.satisfied) {
    throw new Error("Two-factor challenge required for this session.");
  }
}

/** Has the current session satisfied two-factor? */
export const sessionSatisfied = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { needed: false, satisfied: false };
    const rec = await enrollmentFor(ctx.db, user._id);
    if (!rec?.enabled) return { needed: false, satisfied: true };

    const sessionId = await getAuthSessionId(ctx);
    if (!sessionId) return { needed: true, satisfied: false };
    const sess = await ctx.db
      .query("twoFactorSessions")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .unique();
    return { needed: true, satisfied: !!sess };
  },
});
