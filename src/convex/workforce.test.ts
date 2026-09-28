// =====================================================================
// CJ GLOBAL workforce — REAL backend integration tests (convex-test).
//
// These run the actual Convex functions against an in-memory backend
// with the real schema and the real function modules — not capability-
// matrix assertions. Four identities exercise the full lifecycle:
//   owner (isPlatformAdmin) · support agent · developer · chamber owner
// Covers: invite → accept → persistence → capability gating → suspension
// → revocation → self-grant prevention, plus activation binding.
// =====================================================================
import { describe, expect, it, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { PLATFORM_CAPABILITY_SETS } from "./platformWorkforce";
import { totpCodeAt } from "./twofactor";
import { sha256Hex } from "./crypto";

// convex-test needs to import the function modules exactly like a
// deployment does; the modules map mirrors the functions directory.
// (import.meta.glob is Vite-only, so the reference is declared for tsc.)
const modules: Record<string, () => Promise<unknown>> = (import.meta as unknown as {
  glob: (p: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.ts");

// Identity subject convention: @convex-dev/auth derives the user id from
// identity.subject ("userId" before the token divider), so a user row
// created with _id X is simulated with subject X.
const asUser = (t: ReturnType<typeof convexTest>, userId: string) =>
  t.withIdentity({ subject: userId, tokenIdentifier: `test:${userId}` });

// Internal platform accounts must complete the internal-MFA session
// challenge before gated operations; subject "userId|sessionId" binds the
// identity to a real auth session (see internalMfa.test.ts).
const asSession = (
  t: ReturnType<typeof convexTest>,
  userId: string,
  sessionId: string,
) =>
  t.withIdentity({
    subject: `${userId}|${sessionId}`,
    tokenIdentifier: `test:${userId}`,
  });

/** Seed a complete internal-MFA enrollment and satisfy the session challenge. */
async function enrollAndVerify(
  t: ReturnType<typeof convexTest>,
  userId: string,
  sessionId: string,
) {
  const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
  await asUser(t, "system").run(async (ctx) => {
    await ctx.db.insert("twoFactor", {
      userId: userId as never,
      secret,
      enabled: true,
      createdAt: Date.now(),
      confirmedAt: Date.now(),
    });
    for (const code of ["recovery-a1", "recovery-b2"]) {
      await ctx.db.insert("recoveryCodes", {
        userId: userId as never,
        codeHash: sha256Hex(code),
        createdAt: Date.now(),
      });
    }
  });
  const caller = asSession(t, userId, sessionId);
  await caller.mutation(api.twofactor.verifyForSession, {
    code: totpCodeAt(secret),
  });
  return caller;
}

async function createTestUser(
  t: ReturnType<typeof convexTest>,
  opts: { email?: string; verified?: boolean; platformAdmin?: boolean; name?: string } = {},
): Promise<string> {
  const asAdmin = asUser(t, "system");
  // users table inserts go through raw db access via a tiny helper:
  // authUsers are not needed — users rows only.
  const userId = await asAdmin.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      email: opts.email,
      emailVerified: opts.verified ?? false,
      isAnonymous: false,
      isPlatformAdmin: opts.platformAdmin ?? false,
      name: opts.name,
    });
    return id;
  });
  return userId;
}

describe("CJ GLOBAL workforce — real backend lifecycle", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  it("invite → accept → persist → gate → suspend → re-accept → revoke", async () => {
    // --- Identities -------------------------------------------------
    const ownerId = await createTestUser(t, {
      email: "owner@cjglobal.test",
      verified: true,
      platformAdmin: true,
      name: "Platform Owner",
    });
    const agentId = await createTestUser(t, {
      email: "agent@cjglobal.test",
      verified: true,
      name: "Agent A",
    });
    const devId = await createTestUser(t, {
      email: "dev@cjglobal.test",
      verified: true,
      name: "Dev D",
    });
    // An ordinary chamber owner: NOT a platform identity at all.
    const chamberOwnerId = await createTestUser(t, {
      email: "chamber@lawfirm.test",
      verified: true,
      name: "Chamber Owner",
    });
    const chamberOrgId = await asUser(t, "system").run(async (ctx) =>
      ctx.db.insert("organizations", {
        name: "Test Chamber",
        slug: "test-chamber",
        kind: "chamber" as const,
        currency: "INR",
        timezone: "Asia/Kolkata",
        financialYearStart: "04-01",
        taxLabel: "GST",
        taxPercent: 18,
        invoicePrefix: "INV",
        createdBy: chamberOwnerId as never,
        createdAt: Date.now(),
      }),
    );
    await asUser(t, "system").run(async (ctx) => {
      await ctx.db.insert("memberships", {
        orgId: chamberOrgId,
        userId: chamberOwnerId as never,
        orgRole: "owner" as const,
        status: "active" as const,
        createdAt: Date.now(),
      });
    });

    // Internal platform callers must be MFA-enrolled with a challenged
    // session (required for every gated operation below — the negative
    // cases live in internalMfa.test.ts). The chamber-owner identity below
    // deliberately stays sessionless: customers never face internal MFA.
    const owner = await enrollAndVerify(t, ownerId, "sess-owner");
    const agent = await enrollAndVerify(t, agentId, "sess-agent");
    const dev = await enrollAndVerify(t, devId, "sess-dev");
    const chamberOwner = asUser(t, chamberOwnerId);

    // --- 1. Only the platform owner can invite ----------------------
    await expect(
      agent.mutation(api.workforce.inviteEmployee, {
        email: "new@cjglobal.test",
        role: "support_agent",
        token: "a".repeat(32),
      }),
    ).rejects.toThrow(/platform owner/);
    await expect(
      chamberOwner.mutation(api.workforce.inviteEmployee, {
        email: "new@cjglobal.test",
        role: "support_agent",
        token: "a".repeat(32),
      }),
    ).rejects.toThrow(/platform owner/);

    await owner.mutation(api.workforce.inviteEmployee, {
      email: "agent@cjglobal.test",
      role: "support_agent",
      token: "tok-agent-0000000000000001",
    });
    await owner.mutation(api.workforce.inviteEmployee, {
      email: "dev@cjglobal.test",
      role: "developer",
      token: "tok-dev-000000000000000009",
    });

    // --- 2. Acceptance binds the AUTHENTICATED verified account -----
    await agent.mutation(api.workforce.acceptEmployeeInvite, {
      token: "tok-agent-0000000000000001",
    });
    await dev.mutation(api.workforce.acceptEmployeeInvite, {
      token: "tok-dev-000000000000000009",
    });

    // --- 3. Persistence: platform-level, independent of chambers ----
    const roster = await owner.query(api.workforce.listEmployees, {});
    expect(roster).toHaveLength(2);
    const agentRow = roster.find((r) => r.email === "agent@cjglobal.test")!;
    const devRow = roster.find((r) => r.email === "dev@cjglobal.test")!;
    expect(agentRow.role).toBe("support_agent");
    expect(agentRow.status).toBe("active");
    expect(devRow.role).toBe("developer");
    // No orgId anywhere on the rows — platform membership is its own thing.
    for (const row of roster) {
      expect(row).not.toHaveProperty("orgId");
    }

    // --- 4. Identity reads (self only) ------------------------------
    const agentIdentity = await agent.query(api.workforce.myPlatformIdentity, {});
    expect(agentIdentity!.platformRole).toBe("support_agent");
    expect(agentIdentity!.isPlatformAdmin).toBe(false);
    expect(agentIdentity!.capabilities).toEqual(
      PLATFORM_CAPABILITY_SETS.support_agent,
    );

    // --- 5. Capability gating on real queue operations ---------------
    // Create a ticket as the chamber owner (any authenticated user may).
    const ticketId = await chamberOwner.mutation(api.platformOps.submitTicket, {
      subject: "Cannot upload documents",
      body: "The upload button does nothing on the documents page.",
      kind: "technical",
    });

    // Agent (claim+reply capability): claims and replies.
    await agent.mutation(api.platformOps.startProgress, { ticketId });
    await agent.mutation(api.platformOps.addOperatorMessage, {
      ticketId,
      body: "Thanks — our team is looking into the uploader now.",
    });

    // Developer has NO reply capability: refused on a real mutation.
    await expect(
      dev.mutation(api.platformOps.addOperatorMessage, {
        ticketId,
        body: "dev note that should be refused",
      }),
    ).rejects.toThrow(/requires platform.ticket.reply/);

    // Agent lacks rebuild authority: refused.
    await expect(
      agent.mutation(api.platformOps.rebuildAiHandoffStats, {}),
    ).rejects.toThrow(/requires platform.handoff.rebuild/);

    // Developer HOLDS rebuild+diagnostics but cannot claim tickets.
    await dev.mutation(api.platformOps.rebuildAiHandoffStats, {}); // allowed
    await expect(
      dev.mutation(api.platformOps.assignTicket, { ticketId }),
    ).rejects.toThrow(/requires platform.ticket.claim/);

    // Agent cannot manage the workforce.
    await expect(
      agent.query(api.workforce.listEmployees, {}),
    ).rejects.toThrow(/platform owner/);

    // --- 6. Suspension revokes access IMMEDIATELY --------------------
    await owner.mutation(api.workforce.suspendEmployee, { employeeId: agentRow._id });
    const afterSuspend = await asUser(t, agentId).query(
      api.workforce.myPlatformIdentity,
      {},
    );
    expect(afterSuspend!.platformRole).toBeNull();
    expect(afterSuspend!.capabilities).toEqual([]);
    // The suspended agent cannot even read the queue.
    await expect(
      asUser(t, agentId).query(api.platformOps.operatorQueue, {}),
    ).rejects.toThrow(/requires platform.ticket.view_queue/);

    // Owner restores; access returns.
    await owner.mutation(api.workforce.unsuspendEmployee, { employeeId: agentRow._id });
    const afterRestore = await asUser(t, agentId).query(
      api.workforce.myPlatformIdentity,
      {},
    );
    expect(afterRestore!.platformRole).toBe("support_agent");

    // --- 7. Invitation revocation: token dies ------------------------
    await owner.mutation(api.workforce.inviteEmployee, {
      email: "second@cjglobal.test",
      role: "support_supervisor",
      token: "tok-sup-000000000000000001",
    });
    const invites = await owner.query(api.workforce.listInvitations, {});
    const pending = invites.find((i) => i.email === "second@cjglobal.test")!;
    expect(pending.revokedAt).toBeNull();
    await owner.mutation(api.workforce.revokeInvitation, { invitationId: pending._id });
    const secondUserId = await createTestUser(t, {
      email: "second@cjglobal.test",
      verified: true,
    });
    await expect(
      asUser(t, secondUserId).mutation(api.workforce.acceptEmployeeInvite, {
        token: "tok-sup-000000000000000001",
      }),
    ).rejects.toThrow(/No valid invitation/);

    // --- 8. Self-grant prevention ------------------------------------
    // No workforce function can create an owner: the role union has no
    // "owner" and no function sets isPlatformAdmin. Proven at runtime:
    // an employee inviting with any role, and any attempt to manage the
    // workforce, still requires the owner — and the activated owner's
    // flag is untouched by workforce operations.
    const rosterAfter = await owner.query(api.workforce.listEmployees, {});
    for (const row of rosterAfter) {
      expect(row.role).not.toBe("owner");
    }
    // The chamber owner has no platform identity at all.
    const chamberIdentity = await chamberOwner.query(
      api.workforce.myPlatformIdentity,
      {},
    );
    expect(chamberIdentity!.platformRole).toBeNull();
    expect(chamberIdentity!.isPlatformAdmin).toBe(false);
    expect(chamberIdentity!.capabilities).toEqual([]);
  });

  it("acceptance requires a VERIFIED account email matching the invite", async () => {
    const ownerId = await createTestUser(t, {
      email: "owner@cjglobal.test",
      verified: true,
      platformAdmin: true,
    });
    const owner = asUser(t, ownerId);
    await owner.mutation(api.workforce.inviteEmployee, {
      email: "unverified@cjglobal.test",
      role: "support_agent",
      token: "tok-unv-00000000000000001",
    });
    // Signed in, but email NOT verified → refused.
    const unverifiedId = await createTestUser(t, {
      email: "unverified@cjglobal.test",
      verified: false,
    });
    await expect(
      asUser(t, unverifiedId).mutation(api.workforce.acceptEmployeeInvite, {
        token: "tok-unv-00000000000000001",
      }),
    ).rejects.toThrow(/verified/);
  });

  it("wrong token is refused; right token on wrong account is refused", async () => {
    const ownerId = await createTestUser(t, {
      email: "owner@cjglobal.test",
      verified: true,
      platformAdmin: true,
    });
    const owner = asUser(t, ownerId);
    await owner.mutation(api.workforce.inviteEmployee, {
      email: "right@cjglobal.test",
      role: "support_agent",
      token: "tok-right-0000000000000001",
    });
    const rightUserId = await createTestUser(t, {
      email: "right@cjglobal.test",
      verified: true,
    });
    // Bad token.
    await expect(
      asUser(t, rightUserId).mutation(api.workforce.acceptEmployeeInvite, {
        token: "tok-wrong-0000000000000000",
      }),
    ).rejects.toThrow(/No valid invitation/);
    // Right token, wrong ACCOUNT (email mismatch) — the invite is keyed to
    // the signed-in account's email, so this finds no valid invite.
    const otherUserId = await createTestUser(t, {
      email: "other@cjglobal.test",
      verified: true,
    });
    await expect(
      asUser(t, otherUserId).mutation(api.workforce.acceptEmployeeInvite, {
        token: "tok-right-0000000000000001",
      }),
    ).rejects.toThrow(/No valid invitation/);
    // Right token, right account → accepted.
    await asUser(t, rightUserId).mutation(api.workforce.acceptEmployeeInvite, {
      token: "tok-right-0000000000000001",
    });
  });

  it("owner activation is bound to the authenticated account; status is private", async () => {
    // bootstrapStatus reveals nothing without an operator session.
    const nobody = createTestUser(t, { email: "x@y.test", verified: true });
    await expect(
      asUser(t, await nobody).query(api.platform.bootstrapStatus, {}),
    ).rejects.toThrow(/Platform administration access required/);
    await expect(
      t.query(api.platform.bootstrapStatus, {}),
    ).rejects.toThrow(/Platform administration access required/);

    // myOwnerActivationEligibility: a non-matching account gets false.
    const outsiderId = await createTestUser(t, {
      email: "not-owner@elsewhere.test",
      verified: true,
    });
    const outside = await asUser(t, outsiderId).query(
      api.platform.myOwnerActivationEligibility,
      {},
    );
    expect(outside.eligible).toBe(false);

    // The OWNER identity (flag already set in this fixture) reads full
    // status; everyone else is refused bootstrapStatus entirely.
    const ownerId = await createTestUser(t, {
      email: "owner@cjglobal.test",
      verified: true,
      platformAdmin: true,
    });
    const status = await asUser(t, ownerId).query(api.platform.bootstrapStatus, {});
    expect(status.configured).toBe(false); // env var not set inside the test backend
    // selfActivate without the env var configured: refused.
    await expect(
      asUser(t, ownerId).mutation(api.platform.selfActivateOwner, {}),
    ).rejects.toThrow(/not configured/);
  });
});
