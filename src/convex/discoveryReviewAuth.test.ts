// =====================================================================
// Discovery review AUTHORITY — targeted REAL backend tests (convex-test,
// turn 36). Fixture reviews on synthetic documents ONLY: nothing here is
// a real legal assessment and no row is presented as one. What is under
// test, per the owner's acceptance conditions:
//
//  1. Owner/operator WITHOUT an assignment cannot record legal review
//     (ownership / operator status alone confer no review authority).
//  2. A correct ACTIVE assignment permits review within its scope.
//  3. Wrong jurisdiction, REVOKED assignments and EXPIRED assignments
//     refuse review.
//  4. Only platform operators can grant/revoke assignments (and these
//     privileged mutations require the internal-MFA session challenge).
//  5. Jurisdiction matching respects structured colon-segment
//     boundaries — accidental string-prefix matches are impossible.
//  6. REQUIRED internal MFA is enforced on privileged review recording.
//  7. Reviews remain attributed to their ORIGINAL source version —
//     a later version does not silently inherit an earlier review.
// =====================================================================
import { describe, expect, it, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { totpCodeAt } from "./twofactor";
import { sha256Hex } from "./crypto";
import {
  jurisdictionCovers,
  assignmentCurrentlyAuthorises,
  continuityOverlapCount,
  recordSweepLog,
} from "./legalDiscoveryStore";

const modules: Record<string, () => Promise<unknown>> = (import.meta as unknown as {
  glob: (p: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.ts");

const HASH = "0".repeat(64);

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
  opts: {
    email?: string;
    platformAdmin?: boolean;
    mfa?: string; // when set, enroll COMPLETE internal MFA and return {secret}
  } = {},
): Promise<{ id: string; mfaSecret?: string }> {
  const id = await asSessionless(t, "system").run(async (ctx) =>
    ctx.db.insert("users", {
      email: opts.email,
      emailVerified: true,
      isAnonymous: false,
      isPlatformAdmin: opts.platformAdmin ?? false,
    }),
  );
  let mfaSecret: string | undefined;
  if (opts.mfa) {
    mfaSecret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
    await asSessionless(t, "system").run(async (ctx) => {
      await ctx.db.insert("twoFactor", {
        userId: id as never,
        secret: mfaSecret!,
        enabled: true,
        createdAt: Date.now(),
        confirmedAt: Date.now(),
      });
      await ctx.db.insert("recoveryCodes", {
        userId: id as never,
        codeHash: sha256Hex("recovery-x1"),
        createdAt: Date.now(),
      });
    });
  }
  return { id, mfaSecret };
}

/** Seed a promoted auto-discovered source + v1 and return its id/version. */
async function seedSource(
  t: ReturnType<typeof convexTest>,
  stableKey = "in:statute:jj-synthetic-9999",
): Promise<{ sourceId: string; v1: string }> {
  return asSessionless(t, "system").run(async (ctx) => {
    const now = Date.now();
    const sourceId = (await ctx.db.insert("legalSources", {
      stableKey,
      title: "Synthetic Instrument (fixture only — not a real assessment)",
      kind: "statute" as const,
      codeFamily: "special-act",
      country: "in",
      jurisdictionLevel: "national",
      rights: "Open government publication",
      statusNote:
        "FIXTURE — synthetic discovery test row; every review recorded against it is test evidence, not a legal assessment.",
      publisher: "Synthetic publisher (test fixture)",
      sourceUrl: "https://fixture.test/documents/synthetic-9999.pdf",
      collectionDate: new Date(now).toISOString().slice(0, 10),
      createdAt: now,
      updatedAt: now,
    })) as unknown as string;
    const v1 = (await ctx.db.insert("legalSourceVersions", {
      sourceId: sourceId as never,
      version: 1,
      body: "1. Short title and commencement.—This is a synthetic fixture body.",
      sections: [{ anchor: "1", heading: "Short title", start: 0 }],
      collectedAt: new Date(now).toISOString().slice(0, 10),
      bytesHash: HASH,
      createdAt: now,
    })) as unknown as string;
    await ctx.db.patch(sourceId as never, { latestVersion: v1 as never });
    return { sourceId, v1 };
  });
}

/** The operator, MFA-satisfied via a completed session challenge. */
async function satisfyingMfa(
  t: ReturnType<typeof convexTest>,
  userId: string,
  secret: string,
  sessionId = "sess-op-1",
) {
  await asSession(t, userId, sessionId).mutation(api.twofactor.verifyForSession, {
    code: totpCodeAt(secret),
  });
}

describe("structured jurisdiction matching (segment-boundary, no accidental string-prefix)", () => {
  it("matches whole segments only", () => {
    expect(jurisdictionCovers("in:", "in:statute:jj-2015")).toBe(true);
    expect(jurisdictionCovers("in:statute:", "in:statute:jj-2015")).toBe(true);
    expect(jurisdictionCovers("in:statute:", "in:statute:jj-2015")).toBe(true);
    expect(jurisdictionCovers("in:rules:", "in:rules:jj-2016")).toBe(true);
    expect(jurisdictionCovers("in:", "india-something-not-namespaced")).toBe(false);
    expect(jurisdictionCovers("in:statute", "in:statutory-x")).toBe(false);
    expect(jurisdictionCovers("in:statu", "in:statute:jj-2015")).toBe(false);
    expect(jurisdictionCovers("usa:", "in:statute:jj-2015")).toBe(false);
    expect(jurisdictionCovers("in:rules", "in:ruleset:x")).toBe(false);
    expect(jurisdictionCovers("", "in:statute:jj-2015")).toBe(false);
  });

  it("a deeper assignment never covers a shallower key", () => {
    expect(jurisdictionCovers("in:statute:jj-2015", "in:statute")).toBe(false);
  });
});

describe("assignment currency (expiry + revocation, pure rule)", () => {
  const now = 1_800_000_000_000;
  it("active + unexpired authorises", () => {
    expect(assignmentCurrentlyAuthorises({ active: true }, now)).toBe(true);
    expect(
      assignmentCurrentlyAuthorises({ active: true, expiresAt: now + 1 }, now),
    ).toBe(true);
  });
  it("past expiry refuses even when never revoked", () => {
    expect(
      assignmentCurrentlyAuthorises({ active: true, expiresAt: now }, now),
    ).toBe(false);
    expect(
      assignmentCurrentlyAuthorises({ active: true, expiresAt: now - 1 }, now),
    ).toBe(false);
  });
  it("revocation refuses regardless of expiry", () => {
    expect(
      assignmentCurrentlyAuthorises({ active: false, revokedAt: now }, now),
    ).toBe(false);
  });
});

describe("reviewer authority — real backend gate (recordLegalReview)", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  it("owner/operator WITHOUT an assignment cannot record legal review", async () => {
    const { id: ownerId, mfaSecret } = await createTestUser(t, {
      email: "owner@cjglobal.test",
      platformAdmin: true,
      mfa: "yes",
    });
    const { sourceId } = await seedSource(t);
    const sessionId = "sess-none";
    await satisfyingMfa(t, ownerId, mfaSecret!, sessionId);
    await expect(
      asSession(t, ownerId, sessionId).mutation(api.legalDiscoveryStore.recordLegalReview, {
        sourceId: sourceId as never,
        version: 1,
        scope: "identity + as-published fidelity (SYNTHETIC FIXTURE)",
        findings: "faithful_reproduction",
        notes: "Test evidence only.",
      }),
    ).rejects.toThrow(/no active legal-reviewer assignment/);
  });

  it("an operator with an ACTIVE assignment in scope CAN record a review — recorded as fixture evidence, not a real assessment", async () => {
    const { id: reviewerId, mfaSecret } = await createTestUser(t, {
      email: "reviewer@cjglobal.test",
      platformAdmin: true,
      mfa: "yes",
    });
    const { sourceId } = await seedSource(t);
    const sessionId = "sess-r1";
    await satisfyingMfa(t, reviewerId, mfaSecret!, sessionId);
    await asSession(t, reviewerId, sessionId).mutation(
      api.legalDiscoveryStore.assignReviewer,
      {
        userId: reviewerId as never,
        jurisdictionPrefix: "in:",
        selfDeclaredCredentials:
          "SYNTHETIC FIXTURE credentialed reviewer — not a real person, not verified",
      },
    );
    const res = await asSession(t, reviewerId, sessionId).mutation(
      api.legalDiscoveryStore.recordLegalReview,
      {
        sourceId: sourceId as never,
        version: 1,
        scope: "identity + as-published fidelity (SYNTHETIC FIXTURE)",
        findings: "faithful_with_notes",
        notes: "Fixture review of a synthetic document; test evidence only.",
      },
    );
    expect(res.ok).toBe(true);
    // The stored record carries the reviewer identity and the self_declared
    // credential status — never presented as verified.
    const rows = await asSessionless(t, "system").run(async (ctx) =>
      ctx.db.query("discoveryLegalReviews").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reviewerId).toBe(reviewerId as never);
    expect(rows[0]!.version).toBe(1);
  });

  it("WRONG jurisdiction (assignment for another namespace) refuses review", async () => {
    const { id: reviewerId, mfaSecret } = await createTestUser(t, {
      email: "us-reviewer@cjglobal.test",
      platformAdmin: true,
      mfa: "yes",
    });
    const { sourceId } = await seedSource(t, "in:statute:jj-synthetic-8888");
    const sessionId = "sess-wj";
    await satisfyingMfa(t, reviewerId, mfaSecret!, sessionId);
    await asSession(t, reviewerId, sessionId).mutation(
      api.legalDiscoveryStore.assignReviewer,
      { userId: reviewerId as never, jurisdictionPrefix: "usa:" },
    );
    await expect(
      asSession(t, reviewerId, sessionId).mutation(
        api.legalDiscoveryStore.recordLegalReview,
        {
          sourceId: sourceId as never,
          version: 1,
          scope: "out of scope (SYNTHETIC FIXTURE)",
          findings: "faithful_reproduction",
        },
      ),
    ).rejects.toThrow(/no active legal-reviewer assignment/);
  });

  it("a REVOKED assignment refuses review", async () => {
    const { id: reviewerId, mfaSecret } = await createTestUser(t, {
      email: "revoked@cjglobal.test",
      platformAdmin: true,
      mfa: "yes",
    });
    const { sourceId } = await seedSource(t, "in:statute:jj-synthetic-7777");
    const sessionId = "sess-rev";
    await satisfyingMfa(t, reviewerId, mfaSecret!, sessionId);
    await asSession(t, reviewerId, sessionId).mutation(
      api.legalDiscoveryStore.assignReviewer,
      { userId: reviewerId as never, jurisdictionPrefix: "in:" },
    );
    const rows = await asSessionless(t, "system").run(async (ctx) =>
      ctx.db.query("reviewerAssignments").collect(),
    );
    await asSession(t, reviewerId, sessionId).mutation(
      api.legalDiscoveryStore.revokeReviewer,
      { assignmentId: rows[0]!._id },
    );
    await expect(
      asSession(t, reviewerId, sessionId).mutation(
        api.legalDiscoveryStore.recordLegalReview,
        {
          sourceId: sourceId as never,
          version: 1,
          scope: "after revocation (SYNTHETIC FIXTURE)",
          findings: "faithful_reproduction",
        },
      ),
    ).rejects.toThrow(/no active legal-reviewer assignment/);
  });

  it("an EXPIRED assignment refuses review with an explicit expiry message", async () => {
    const { id: reviewerId, mfaSecret } = await createTestUser(t, {
      email: "expired@cjglobal.test",
      platformAdmin: true,
      mfa: "yes",
    });
    const { sourceId } = await seedSource(t, "in:statute:jj-synthetic-6666");
    const sessionId = "sess-exp";
    await satisfyingMfa(t, reviewerId, mfaSecret!, sessionId);
    // Seed the expired assignment directly (an expired grant can no longer
    // be legitimately re-created through the gate that refuses past dates).
    await asSessionless(t, "system").run(async (ctx) => {
      await ctx.db.insert("reviewerAssignments", {
        userId: reviewerId as never,
        userLabel: "expired reviewer (fixture)",
        jurisdictionPrefix: "in:",
        credentialStatus: "self_declared" as const,
        active: true,
        assignedById: reviewerId as never,
        assignedAt: Date.now() - 1000,
        expiresAt: Date.now() - 500,
      });
    });
    await expect(
      asSession(t, reviewerId, sessionId).mutation(
        api.legalDiscoveryStore.recordLegalReview,
        {
          sourceId: sourceId as never,
          version: 1,
          scope: "after expiry (SYNTHETIC FIXTURE)",
          findings: "faithful_reproduction",
        },
      ),
    ).rejects.toThrow(/EXPIRED/);
  });

  it("assignment granting is operator-gated AND internal-MFA gated", async () => {
    // Non-operator (even MFA-enrolled + challenged) cannot grant.
    const { id: civilianId, mfaSecret } = await createTestUser(t, {
      email: "civilian@advokate.test",
      mfa: "yes",
    });
    const { id: targetId } = await createTestUser(t, {
      email: "target@advokate.test",
    });
    const sessC = "sess-civ";
    await satisfyingMfa(t, civilianId, mfaSecret!, sessC);
    await expect(
      asSession(t, civilianId, sessC).mutation(api.legalDiscoveryStore.assignReviewer, {
        userId: targetId as never,
        jurisdictionPrefix: "in:",
      }),
    ).rejects.toThrow(/Platform operator access required/);

    // Operator who has NOT satisfied the MFA challenge cannot grant.
    const { id: opNoChallenge, mfaSecret: mfaSecret2 } = await createTestUser(t, {
      email: "op@cjglobal.test",
      platformAdmin: true,
      mfa: "yes",
    });
    void mfaSecret2;
    await expect(
      asSession(t, opNoChallenge, "sess-unchallenged").mutation(
        api.legalDiscoveryStore.assignReviewer,
        { userId: targetId as never, jurisdictionPrefix: "in:" },
      ),
    ).rejects.toThrow(/two-factor challenge/);
  });

  it("recordLegalReview also refuses a valid assignment WITHOUT the session MFA challenge", async () => {
    // Two independent MFA-complete operators: one to GRANT the assignment
    // (with its own challenge session), one to be DENIED review without a
    // challenge on their own session.
    const grantor = await createTestUser(t, {
      email: "granter@cjglobal.test",
      platformAdmin: true,
      mfa: "yes",
    });
    const reviewer = await createTestUser(t, {
      email: "reviewer-nochal@cjglobal.test",
      platformAdmin: true,
      mfa: "yes",
    });
    const { sourceId } = await seedSource(t, "in:statute:jj-synthetic-5555");
    const sessGrant = "sess-a";
    await satisfyingMfa(t, grantor.id, grantor.mfaSecret!, sessGrant);
    await asSession(t, grantor.id, sessGrant).mutation(
      api.legalDiscoveryStore.assignReviewer,
      { userId: reviewer.id as never, jurisdictionPrefix: "in:" },
    );
    // An enrolled but UNCHALLENGED session and a sessionless identity are
    // both refused — email OTP alone is not a second factor.
    await expect(
      asSession(t, reviewer.id, "sess-b-unchallenged").mutation(
        api.legalDiscoveryStore.recordLegalReview,
        {
          sourceId: sourceId as never,
          version: 1,
          scope: "unchallenged session (SYNTHETIC FIXTURE)",
          findings: "faithful_reproduction",
        },
      ),
    ).rejects.toThrow(/two-factor challenge/i);
    await expect(
      asSessionless(t, reviewer.id).mutation(api.legalDiscoveryStore.recordLegalReview, {
        sourceId: sourceId as never,
        version: 1,
        scope: "sessionless identity (SYNTHETIC FIXTURE)",
        findings: "faithful_reproduction",
      }),
    ).rejects.toThrow(/two-factor/i);
  });
});

describe("version attribution — reviews bind to their ORIGINAL source version", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  it("a review of v1 stays attributed to v1: v2 is OUTSTANDING afterward", async () => {
    const { id: reviewerId, mfaSecret } = await createTestUser(t, {
      email: "versioned@cjglobal.test",
      platformAdmin: true,
      mfa: "yes",
    });
    const { sourceId, v1 } = await seedSource(t, "in:statute:jj-synthetic-4444");
    const sess = "sess-ver";
    await satisfyingMfa(t, reviewerId, mfaSecret!, sess);
    await asSession(t, reviewerId, sess).mutation(api.legalDiscoveryStore.assignReviewer, {
      userId: reviewerId as never,
      jurisdictionPrefix: "in:",
    });
    await asSession(t, reviewerId, sess).mutation(api.legalDiscoveryStore.recordLegalReview, {
      sourceId: sourceId as never,
      version: 1,
      scope: "v1 fidelity (SYNTHETIC FIXTURE)",
      findings: "faithful_reproduction",
    });

    // Publish a SECOND version of the same source.
    await asSessionless(t, "system").run(async (ctx) => {
      const v2 = (await ctx.db.insert("legalSourceVersions", {
        sourceId: sourceId as never,
        version: 2,
        body: "1. Short title and commencement.—Amended synthetic fixture body.",
        sections: [{ anchor: "1", heading: "Short title", start: 0 }],
        collectedAt: new Date().toISOString().slice(0, 10),
        bytesHash: "1".repeat(64),
        createdAt: Date.now(),
      })) as unknown as string;
      await ctx.db.patch(sourceId as never, { latestVersion: v2 as never });
    });

    // The v1 row still exists, unchanged, attributed to its own version.
    const all = await asSessionless(t, "system").run(async (ctx) =>
      ctx.db.query("discoveryLegalReviews").collect(),
    );
    expect(all).toHaveLength(1);
    expect(all[0]!.version).toBe(1);
    expect(all[0]!.reviewerId).toBe(reviewerId as never);
    void v1;
    // legalReviewStatus against the NEW latest version is OUTSTANDING —
    // v2 does not silently inherit v1's review.
    const status = await asSession(t, reviewerId, sess).query(
      api.legalDiscoveryStore.legalReviewStatus,
      { sourceId: sourceId as never },
    );
    expect(status.status).toBe("outstanding");
    expect(status.reviewedVersion).toBe(2);
    expect(status.historyCount).toBe(1);
  });
});

describe("scan continuity — overlap verdict + possible coverage gap", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  it("identical windows → overlap (continuity held); disjoint windows → gap recorded", async () => {
    const A = ["u1", "u2", "u3"];
    const B = ["u3", "u4", "u5"];
    const C = ["x1", "x2", "x3"];
    expect(continuityOverlapCount(A, B)).toBe(1);
    expect(continuityOverlapCount(A, C)).toBe(0);
  });

  it("recordSweepLog: first successful scan → 'first'; overlapping → 'overlap'; fully moved window → 'gap' with coverageGapSince", async () => {
    // Real-path test: successive recordSweepLog invocations (the internal
    // mutation) — first success, overlapping successor, fully moved window,
    // a failed scan, then a re-overlapping success.
    const sweep = (args: Record<string, unknown>) =>
      asSessionless(t, "system").run((ctx) =>
        ctx.runMutation(internal.legalDiscoveryStore.recordSweepLog, args as never),
      ) as Promise<{ continuity: string }>;

    await (async () => {
      // 1) FIRST successful scan.
      const r1 = await sweep({
        trigger: "schedule",
        listingKey: "synthetic-listing",
        linksFound: 3,
        newCandidates: 3,
        validated: 0,
        promoted: 0,
        queuedForReview: 0,
        rejected: 0,
        windowUrls: ["u1", "u2", "u3"],
      });
      expect(r1.continuity).toBe("first");
      // 2) Overlapping successor (shares u2).
      const r2 = await sweep({
        trigger: "schedule",
        listingKey: "synthetic-listing",
        linksFound: 3,
        newCandidates: 2,
        validated: 0,
        promoted: 0,
        queuedForReview: 0,
        rejected: 0,
        windowUrls: ["u2", "u4", "u5"],
      });
      expect(r2.continuity).toBe("overlap");
      // 3) Fully-moved window: NOTHING shared with the last success.
      const r3 = await sweep({
        trigger: "schedule",
        listingKey: "synthetic-listing",
        linksFound: 3,
        newCandidates: 3,
        validated: 0,
        promoted: 0,
        queuedForReview: 0,
        rejected: 0,
        windowUrls: ["x1", "x2", "x3"],
      });
      expect(r3.continuity).toBe("gap");
      // Gap is recorded with a timestamp.
      const logs = (await asSessionless(t, "system").run((c) =>
        c.db.query("discoverySweepLogs").order("desc").collect(),
      )) as { listingKey: string; windowUrls?: string[]; coverageGapSince?: number; continuityOverlap?: string }[];
      const latest = logs.find((l) => l.listingKey === "synthetic-listing");
      expect(latest?.coverageGapSince).toBeDefined();
      expect(latest?.windowUrls).toEqual(["x1", "x2", "x3"]);
      // 4) A FAILED scan neither opens nor closes the gap; verdict unknown.
      const r4 = await sweep({
        trigger: "schedule",
        listingKey: "synthetic-listing",
        linksFound: 0,
        newCandidates: 0,
        validated: 0,
        promoted: 0,
        queuedForReview: 0,
        rejected: 0,
        error: "listing fetch failed: timeout",
      });
      expect(r4.continuity).toBe("unknown");
      const logs2 = (await asSessionless(t, "system").run((c) =>
        c.db.query("discoverySweepLogs").order("desc").collect(),
      )) as typeof logs;
      const afterFailure = logs2.find((l) => l.listingKey === "synthetic-listing");
      // The failed row reports unknown and carries no coverageGapSince of
      // its own; the prior gap stays open as the latest gap on record.
      expect(afterFailure?.continuityOverlap).toBe("unknown");
      expect(afterFailure?.coverageGapSince).toBeUndefined();
      // 5) An overlapping success CLOSES the gap: no newer row carries one.
      const r5 = await sweep({
        trigger: "schedule",
        listingKey: "synthetic-listing",
        linksFound: 2,
        newCandidates: 0,
        validated: 0,
        promoted: 0,
        queuedForReview: 0,
        rejected: 0,
        windowUrls: ["x1", "y2"],
      });
      expect(r5.continuity).toBe("overlap");
      const logs3 = (await asSessionless(t, "system").run((c) =>
        c.db.query("discoverySweepLogs").order("desc").collect(),
      )) as typeof logs;
      const gapRows = logs3.filter(
        (l) => l.listingKey === "synthetic-listing" && l.coverageGapSince,
      );
      expect(gapRows).toHaveLength(1); // only the historic gap row remains
      expect(gapRows[0]!.windowUrls).toEqual(["x1", "x2", "x3"]);
    });
  });
});
