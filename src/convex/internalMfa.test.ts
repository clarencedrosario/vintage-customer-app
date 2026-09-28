// =====================================================================
// CJ GLOBAL internal-MFA — REAL backend integration tests (convex-test).
//
// Policy under test:
//  - Email OTP sign-in is authentication, NOT a second factor. A
//    sessionless identity (no auth session bound) can never satisfy the
//    internal-MFA challenge, and an auth session that has not completed
//    the challenge is refused internal mutations.
//  - Internal platform accounts (owner flag or workforce role) must be
//    enrolled: TOTP enabled AND a live recovery-code set. A half-finished
//    enrollment (secret confirmed, codes never stored) is refused.
//  - The session challenge accepts a live TOTP code or ONE recovery code
//    (single use); only then do owner-only workforce mutations run.
// =====================================================================
import { describe, expect, it, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { totpCodeAt } from "./twofactor";
import { sha256Hex } from "./crypto";

const modules: Record<string, () => Promise<unknown>> = (import.meta as unknown as {
  glob: (p: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.ts");

// @convex-dev/auth derives the user id from subject.split("|")[0] and the
// auth session id from subject.split("|")[1] — so a plain subject
// simulates sessionless authentication and a "userId|sessionId" subject
// simulates a real signed-in session.
const asSessionless = (t: ReturnType<typeof convexTest>, userId: string) =>
  t.withIdentity({ subject: userId, tokenIdentifier: `test:${userId}` });

const asSession = (
  t: ReturnType<typeof convexTest>,
  userId: string,
  sessionId: string,
) =>
  t.withIdentity({
    subject: `${userId}|${sessionId}`,
    tokenIdentifier: `test:${userId}`,
  });

async function createTestUser(
  t: ReturnType<typeof convexTest>,
  opts: { email?: string; verified?: boolean; platformAdmin?: boolean } = {},
): Promise<string> {
  return asSessionless(t, "system").run(async (ctx) =>
    ctx.db.insert("users", {
      email: opts.email,
      emailVerified: opts.verified ?? false,
      isAnonymous: false,
      isPlatformAdmin: opts.platformAdmin ?? false,
    }),
  );
}

/** Seed a COMPLETE internal-MFA enrollment; returns the fixture secrets. */
async function enrollInternalMfa(
  t: ReturnType<typeof convexTest>,
  userId: string,
): Promise<{ secret: string; codes: string[] }> {
  const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"; // 160-bit base32
  const codes = ["recovery-a1", "recovery-b2"];
  await asSessionless(t, "system").run(async (ctx) => {
    await ctx.db.insert("twoFactor", {
      userId: userId as never,
      secret,
      enabled: true,
      createdAt: Date.now(),
      confirmedAt: Date.now(),
    });
    for (const code of codes) {
      await ctx.db.insert("recoveryCodes", {
        userId: userId as never,
        codeHash: sha256Hex(code),
        createdAt: Date.now(),
      });
    }
  });
  return { secret, codes };
}

describe("CJ GLOBAL internal MFA — real backend enforcement", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  it("email OTP alone is NOT a second factor: sessionless and unchallenged sessions are refused", async () => {
    const ownerId = await createTestUser(t, {
      email: "owner@cjglobal.test",
      verified: true,
      platformAdmin: true,
    });

    // Even the OWNER is refused before enrollment — the gate is the
    // enrollment + challenge, not the ownership flag.
    await expect(
      asSessionless(t, ownerId).mutation(api.workforce.inviteEmployee, {
        email: "agent@cjglobal.test",
        role: "support_agent",
        token: "tok-mfa-0000000000000000001",
      }),
    ).rejects.toThrow(/Two-factor enrollment is required/);

    // Enrolled, but the caller presents NO auth session (what an emailed
    // OTP alone proves): still refused.
    const { secret } = await enrollInternalMfa(t, ownerId);
    await expect(
      asSessionless(t, ownerId).mutation(api.workforce.inviteEmployee, {
        email: "agent@cjglobal.test",
        role: "support_agent",
        token: "tok-mfa-0000000000000000001",
      }),
    ).rejects.toThrow(/Two-factor challenge required/);

    // A real auth session that has NOT completed the challenge: refused.
    await expect(
      asSession(t, ownerId, "sess-1").mutation(api.workforce.inviteEmployee, {
        email: "agent@cjglobal.test",
        role: "support_agent",
        token: "tok-mfa-0000000000000000001",
      }),
    ).rejects.toThrow(/Two-factor challenge required/);

    // Completing the challenge with a LIVE TOTP code unlocks the console.
    await asSession(t, ownerId, "sess-1").mutation(
      api.twofactor.verifyForSession,
      { code: totpCodeAt(secret) },
    );
    await asSession(t, ownerId, "sess-1").mutation(api.workforce.inviteEmployee, {
      email: "agent@cjglobal.test",
      role: "support_agent",
      token: "tok-mfa-0000000000000000001",
    });

    // The identity read reflects the enforced state.
    const identity = await asSession(t, ownerId, "sess-1").query(
      api.workforce.myPlatformIdentity,
      {},
    );
    expect(identity!.internalMfa).toEqual({
      enrollmentExists: true,
      enrolled: true,
      challengeNeeded: true,
      satisfied: true,
    });
  });

  it("half-finished enrollment is refused until recovery codes exist", async () => {
    const ownerId = await createTestUser(t, {
      email: "half@cjglobal.test",
      verified: true,
      platformAdmin: true,
    });
    // TOTP confirmed but the recovery-code step never completed.
    await asSessionless(t, "system").run(async (ctx) => {
      await ctx.db.insert("twoFactor", {
        userId: ownerId as never,
        secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
        enabled: true,
        createdAt: Date.now(),
        confirmedAt: Date.now(),
      });
    });
    await expect(
      asSessionless(t, ownerId).mutation(api.workforce.inviteEmployee, {
        email: "x@cjglobal.test",
        role: "support_agent",
        token: "tok-mfa-0000000000000000002",
      }),
    ).rejects.toThrow(/Finish two-factor enrollment/);

    // Completing enrollment (codes stored) moves the refusal to the
    // challenge — the state machine is honest about what is missing.
    await enrollInternalMfa(t, ownerId);
    await expect(
      asSessionless(t, ownerId).mutation(api.workforce.inviteEmployee, {
        email: "x@cjglobal.test",
        role: "support_agent",
        token: "tok-mfa-0000000000000000002",
      }),
    ).rejects.toThrow(/Two-factor challenge required/);
  });

  it("a recovery code satisfies the challenge exactly once", async () => {
    const ownerId = await createTestUser(t, {
      email: "rec@cjglobal.test",
      verified: true,
      platformAdmin: true,
    });
    const { codes } = await enrollInternalMfa(t, ownerId);
    const caller = asSession(t, ownerId, "sess-2");

    await caller.mutation(api.twofactor.verifyForSession, { code: codes[0]! });
    await caller.mutation(api.workforce.inviteEmployee, {
      email: "sup@cjglobal.test",
      role: "support_supervisor",
      token: "tok-mfa-0000000000000000003",
    });

    // The SAME code can never satisfy a new session: single use.
    const secondSession = asSession(t, ownerId, "sess-3");
    await expect(
      secondSession.mutation(api.twofactor.verifyForSession, {
        code: codes[0]!,
      }),
    ).rejects.toThrow(/recovery code is not valid/);
    // The untouched second code still works.
    await secondSession.mutation(api.twofactor.verifyForSession, {
      code: codes[1]!,
    });
  });
});
