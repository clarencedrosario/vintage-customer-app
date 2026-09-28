// =====================================================================
// Advokate Legal Intelligence — REAL backend integration tests
// (convex-test). The flagship slice is tested end-to-end on the actual
// Convex functions, not just pure rules:
//
//   seed → coverage register → source search → applicability (IPC vs BNS
//   by date) → matter jurisdiction confirmation → citation verification
//   → refusal contract for unsupported jurisdictions.
//
// Honesty guarantees under test: seeding registers provenance but never
// fabricates legal text; citation verification rejects invented sources;
// the answer contract refuses countries without verified coverage.
// =====================================================================
import { describe, expect, it, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { checkCitation, extractCitations } from "../lib/legalIntel";

const modules: Record<string, () => Promise<unknown>> = (import.meta as unknown as {
  glob: (p: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.ts");

const asUser = (t: ReturnType<typeof convexTest>, userId: string) =>
  t.withIdentity({ subject: userId, tokenIdentifier: `test:${userId}` });

async function createTestUser(
  t: ReturnType<typeof convexTest>,
  opts: { email?: string; verified?: boolean; platformAdmin?: boolean } = {},
): Promise<string> {
  return asUser(t, "system").run(async (ctx) =>
    ctx.db.insert("users", {
      email: opts.email,
      emailVerified: opts.verified ?? false,
      isAnonymous: false,
      isPlatformAdmin: opts.platformAdmin ?? false,
    }),
  );
}

/** A law firm with an owner (lawyer) + client + matter, fully set up. */
async function seedFirm(t: ReturnType<typeof convexTest>) {
  /** A law firm with an owner (lawyer) + client + matter, fully set up. */
  const ownerId = await createTestUser(t, {
    email: "lawyer@firm.test",
    verified: true,
  });
  const orgId = await asUser(t, "system").run(async (ctx) =>
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
      createdBy: ownerId as never,
      createdAt: Date.now(),
    }),
  );
  // activeOrgId is what getAccessContext reads for org-scoped calls.
  await asUser(t, "system").run(async (ctx) => {
    await ctx.db.patch(ownerId as never, { activeOrgId: orgId });
  });
  await asUser(t, "system").run(async (ctx) => {
    await ctx.db.insert("memberships", {
      orgId,
      userId: ownerId as never,
      orgRole: "owner" as const,
      status: "active" as const,
      createdAt: Date.now(),
    });
  });
  const clientId = await asUser(t, "system").run(async (ctx) =>
    ctx.db.insert("clients", {
      orgId,
      kind: "individual" as const,
      name: "Client A",
      createdBy: ownerId as never,
      createdAt: Date.now(),
    }),
  );
  const matterId = await asUser(t, "system").run(async (ctx) =>
    ctx.db.insert("matters", {
      orgId,
      clientId,
      reference: "ADV/2026/9001",
      title: "Criminal matter (pre-BNS conduct)",
      practiceArea: "Criminal Defence",
      status: "open" as const,
      createdBy: ownerId as never,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  return { ownerId, orgId, clientId, matterId };
}

describe("Advokate Legal Intelligence — real backend slice", () => {
  let t: ReturnType<typeof convexTest>;

  // (helper defined inside describe to close over t)

  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  it("seed → search → applicability: IPC governs pre-2024 conduct with BNS cross-ref", async () => {
    const operatorId = await createTestUser(t, {
      email: "op@cjglobal.test",
      verified: true,
      platformAdmin: true,
    });
    const op = asUser(t, operatorId);

    // Seed is idempotent.
    const first = await op.mutation(api.legalIntel.seedIndianCore, {});
    expect(first.sourcesCreated).toBe(8);
    const second = await op.mutation(api.legalIntel.seedIndianCore, {});
    expect(second.sourcesCreated).toBe(0);
    expect(first.crossRefsCreated).toBeGreaterThan(0);

    // Coverage register: India exists with honest statuses.
    const coverage = await op.query(api.legalIntel.coverage, {});
    const india = coverage.find((c) => c.country === "in");
    expect(india?.legislation).toBe("partial");
    expect(india?.judgments).toBe("not_started");

    // Search finds the seeded codes with provenance.
    const lawyer = await seedFirm(t).then((f) => f.ownerId);
    const results = await asUser(t, lawyer).query(api.legalIntel.searchSources, {
      q: "penal",
    });
    const ipc = results.find((r) => r.stableKey === "in:statute:ipc-1860");
    expect(ipc).toBeDefined();
    expect(ipc!.ingested).toBe(false); // registered, text pending — honest
    expect(ipc!.publisher).toBe("India Code (Legislative Department)");

    // Era applicability: incident 2024-03-01 → IPC governs the penal
    // family, BNS surfaced as cross-reference, never substituted. POCSO
    // (special act) must NOT displace the general penal code.
    const preBns = await asUser(t, lawyer).query(api.legalIntel.applicability, {
      country: "in",
      onDate: "2024-03-01",
      family: "penal",
    });
    expect(preBns.resolved?.applicableKey).toBe("in:statute:ipc-1860");
    expect(
      preBns.resolved?.crossRefs.some(
        (r) => r.toKey === "in:statute:bns-2023" && r.toAnchor === "s 103",
      ),
    ).toBe(true);

    // On/after commencement the BNS governs the penal family.
    const postBns = await asUser(t, lawyer).query(api.legalIntel.applicability, {
      country: "in",
      onDate: "2024-07-02",
      family: "penal",
    });
    expect(postBns.resolved?.applicableKey).toBe("in:statute:bns-2023");

    // Temporal review flags: a pre-BNS date must flag the repeal-era
    // savings question (BLANKET July-2024 switching is forbidden); the
    // post-BNS date is inside two years of commencement, so transitional
    // savings (s.358(2) BNS / s.531(2)(a) BNSS / s.170(2) BSA) must be
    // flagged for lawyer review too.
    expect(preBns.resolved!.reviewFlags.length).toBeGreaterThan(0);
    expect(preBns.resolved!.reviewFlags.join(" ")).toMatch(/savings|transitional/i);
    expect(postBns.resolved!.reviewFlags.join(" ")).toMatch(/transitional exceptions/i);
  });

  it("matter jurisdiction: firm default is a labelled fallback; lawyer confirmation wins", async () => {
    const { ownerId, matterId } = await seedFirm(t);
    const lawyer = asUser(t, ownerId);

    // No profile yet → firm default with explicit not-confirmed label.
    const ctx0 = await lawyer.query(api.legalIntel.activeContext, { matterId });
    expect(ctx0!.jurisdiction.confirmed).toBe(false);
    expect(ctx0!.jurisdiction.usedFirmDefault).toBe(true);
    expect(ctx0!.jurisdiction.countryLabel).toMatch(/firm default/);

    // Only matter.edit holders can confirm; a non-member is refused outright.
    await expect(
      asUser(t, "outsider").mutation(api.legalIntel.setMatterProfile, {
        matterId,
        country: "de",
      }),
    ).rejects.toThrow();

    // The lawyer confirms Germany — the default no longer applies.
    const saved = await lawyer.mutation(api.legalIntel.setMatterProfile, {
      matterId,
      country: "de",
      legalDates: [{ kind: "incident", date: "2025-02-10" }],
    });
    expect(saved.coverageLegislation).toBe("not_started");

    const ctx1 = await lawyer.query(api.legalIntel.activeContext, { matterId });
    expect(ctx1!.jurisdiction.country).toBe("de");
    expect(ctx1!.jurisdiction.confirmed).toBe(true);
    expect(ctx1!.legalDate.date).toBe("2025-02-10");
    expect(ctx1!.legalDate.isAssumption).toBe(false);
  });

  it("citation verification rejects invented sources and un-ingested quotes", async () => {
    await seedFirm(t);
    const operatorId = await createTestUser(t, {
      email: "op2@cjglobal.test",
      verified: true,
      platformAdmin: true,
    });
    await asUser(t, operatorId).mutation(api.legalIntel.seedIndianCore, {});

    const result = await asUser(t, operatorId).mutation(
      api.legalIntel.verifyCitations,
      {
        citations: [
          { stableKey: "in:statute:ipc-1860" }, // real, text pending
          { stableKey: "in:statute:made-up-2024" }, // fabricated
        ],
      },
    );
    const [real, fake] = result.results;
    expect(real!.sourceExists).toBe(true);
    expect(real!.quoteVerified).toBe(false);
    expect(real!.problem).toMatch(/not yet ingested/);
    expect(fake!.sourceExists).toBe(false);
    expect(fake!.problem).toMatch(/does not exist/);
    expect(result.allVerified).toBe(false);
  });

  it("backend citation validator: pinpoint + quote fidelity against stored text (pure)", () => {
    const stored = {
      stableKey: "in:statute:ipc-1860",
      title: "Indian Penal Code, 1860",
      body: "302. Punishment for murder.--Whoever commits murder shall be punished with death.",
      sections: [{ anchor: "§ 302", heading: "Punishment for murder", start: 0 }],
    };
    // Verbatim quote + valid pinpoint → verified with passage offset.
    const good = checkCitation(
      { stableKey: stored.stableKey, anchor: "§ 302", quote: "punished with death" },
      stored,
    );
    expect(good.ok).toBe(true);
    expect(good.quoteVerified).toBe(true);
    expect(good.anchorValid).toBe(true);
    expect(good.quoteOffset).toBeGreaterThan(0);
    // Fabricated quote → blocked even though the source exists.
    const badQuote = checkCitation(
      { stableKey: stored.stableKey, quote: "shall be hanged by the neck" },
      stored,
    );
    expect(badQuote.ok).toBe(false);
    expect(badQuote.problem).toMatch(/not found in the stored version/i);
    // Wrong pinpoint → blocked.
    const badPin = checkCitation(
      { stableKey: stored.stableKey, anchor: "§ 999" },
      stored,
    );
    expect(badPin.ok).toBe(false);
    expect(badPin.problem).toMatch(/does not match any section/i);
    // Un-ingested source → blocked.
    const pending = checkCitation(
      { stableKey: "in:statute:pocso-2012" },
      { stableKey: "in:statute:pocso-2012", title: "POCSO", body: null, sections: null },
    );
    expect(pending.ok).toBe(false);
    expect(pending.problem).toMatch(/not ingested/i);
    // Missing source → blocked.
    expect(checkCitation({ stableKey: "in:statute:nope" }, null).ok).toBe(false);
  });

  it("citation extraction pulls stable keys, pinpoints and quotes from generated text", () => {
    const text = `The provision relied on is [in:statute:ipc-1860 § 302] which reads "punished with death" while BNS [in:statute:bns-2023 § 103] governs post-commencement conduct.`;
    const cites = extractCitations(text);
    expect(cites.length).toBe(2);
    expect(cites[0]!.stableKey).toBe("in:statute:ipc-1860");
    expect(cites[0]!.anchor).toBe("§ 302");
    expect(cites[0]!.quote).toMatch(/punished with death/);
    expect(cites[1]!.stableKey).toBe("in:statute:bns-2023");
    expect(cites[1]!.anchor).toBe("§ 103");
  });

  it("ingest pipeline: dedupe, freshness, and failure handling on real run rows", async () => {
    const operatorId = await createTestUser(t, {
      email: "op4@cjglobal.test",
      verified: true,
      platformAdmin: true,
    });
    const op = asUser(t, operatorId);
    await op.mutation(api.legalIntel.seedIndianCore, {});

    // Find a source id via the CLI readback path.
    const src = await op.query(api.legalIntel.searchSources, { q: "sakshya" });
    const bsa = src.find((s) => s.stableKey === "in:statute:bsa-2023");
    expect(bsa).toBeDefined();
    const bsaId = bsa!._id;

    // 1) openRun twice → the second is a dedupe skip.
    const r1 = await t.run(ctx =>
      ctx.runMutation(internal.legalIntel.openRun, { sourceId: bsaId }),
    );
    expect(r1.opened).toBe(true);
    const r2 = await t.run(ctx =>
      ctx.runMutation(internal.legalIntel.openRun, { sourceId: bsaId }),
    );
    expect(r2.opened).toBe(false);
    expect(r2.skipped).toBe(true);

    // 2) close the run with a new version → freshness updates.
    const now = Date.now();
    const versionId = await t.run(async (ctx) => {
      const v = await ctx.db.insert("legalSourceVersions", {
        sourceId: bsaId,
        version: 2,
        body: "1. Short title and commencement.—(1) This Act may be called the Bharatiya Sakshya Adhiniyam, 2023.",
        sections: [{ anchor: "§ 1", heading: "Short title", start: 0 }],
        collectedAt: "2026-09-28",
        createdAt: now,
      });
      return v;
    });
    await op.mutation(api.legalIntel.recordIngestionResult, {
      runId: r1.runId,
      outcome: "updated",
      newVersionId: versionId,
    });
    const after = await t.run(async (ctx) => {
      const run = await ctx.db.get(r1.runId);
      const source = await ctx.db.get(bsaId);
      return { run, source };
    });
    expect(after.run?.outcome).toBe("updated");
    expect(after.run?.lastSuccessfulAt).toBeDefined();
    expect(after.source?.collectionDate).toBe("2026-09-28");

    // 3) failure path: a failed run records the error and keeps lastSuccess unset.
    const r3 = await t.run(ctx =>
      ctx.runMutation(internal.legalIntel.openRun, { sourceId: bsaId }),
    );
    await op.mutation(api.legalIntel.recordIngestionResult, {
      runId: r3.runId,
      outcome: "failed",
      error: "simulated upstream failure (test)",
    });
    const failedRun = await t.run((ctx) => ctx.db.get(r3.runId));
    expect(failedRun?.outcome).toBe("failed");
    expect(failedRun?.error).toMatch(/simulated upstream failure/);
    expect(failedRun?.lastSuccessfulAt).toBeUndefined();
  });

  it("automated end-to-end check: jurisdiction → date → retrieval → grounded answer over INGESTED text", async () => {
    const operatorId = await createTestUser(t, {
      email: "op5@cjglobal.test",
      verified: true,
      platformAdmin: true,
    });
    const op = asUser(t, operatorId);
    await op.mutation(api.legalIntel.seedIndianCore, {});

    // Ingest a small REAL excerpt (with section anchor) so the dry run
    // retrieves actual provision text, not a registry stub.
    await op.mutation(api.legalIntel.ingestSourceText, {
      stableKey: "in:statute:ipc-1860",
      body: "302. Punishment for murder.--Whoever commits murder shall be punished with death, or imprisonment for life, and shall also be liable to fine.",
      sections: [
        { anchor: "§ 302", heading: "Punishment for murder", start: 0 },
      ],
    });

    // Pre-BNS incident date + pinpoint → IPC governs, § 302 retrieved,
    // the passage verifies against stored text, and era review flags fire.
    const pre = await t.run((ctx) =>
      ctx.runQuery(internal.legalIntel.researchDryRun, {
        country: "in",
        onDate: "2024-03-01",
        family: "penal",
        anchorHint: "§ 302",
      }),
    );
    expect(pre.applicability?.applicableKey).toBe("in:statute:ipc-1860");
    const ipcHit = pre.retrieved.find((r: { stableKey: string }) => r.stableKey === "in:statute:ipc-1860");
    expect(ipcHit).toBeDefined();
    expect(ipcHit!.anchor).toBe("§ 302");
    expect(ipcHit!.checkOk).toBe(true);
    expect(ipcHit!.quote).toMatch(/murder/i);
    expect(pre.answer).toMatch(/Indian Penal Code, 1860/);
    expect(pre.answer).toMatch(/FOR LAWYER REVIEW/);

    // Unsupported jurisdiction still refuses inside the same pipeline.
    const fr = await t.run((ctx) =>
      ctx.runQuery(internal.legalIntel.researchDryRun, {
        country: "fr",
        onDate: "2024-03-01",
      }),
    );
    expect(fr.answer).toMatch(/will not produce a substantive legal answer/);
  });

  it("unsupported jurisdiction: the answer contract refuses, coverage register stays honest", async () => {
    const operatorId = await createTestUser(t, {
      email: "op3@cjglobal.test",
      verified: true,
      platformAdmin: true,
    });
    const op = asUser(t, operatorId);
    await op.mutation(api.legalIntel.seedIndianCore, {});
    await op.mutation(api.legalIntel.seedEuropeanCoverage, {});

    const coverage = await op.query(api.legalIntel.coverage, {});
    const france = coverage.find((c) => c.country === "fr");
    expect(france).toBeDefined();
    expect(france!.inEurope).toBe(true);
    expect(france!.legislation).toBe("not_started");

    // Applicability for an un-ingested jurisdiction: contract requires
    // refusal; resolved applicability is null (no sources in force).
    const fr = await op.query(api.legalIntel.applicability, {
      country: "fr",
      onDate: "2026-09-28",
    });
    expect(fr.resolved).toBeNull();
    expect(fr.contract.refusalRequired).toBe(true);
    expect(fr.contract.refusalMessage).toMatch(
      /will not produce a substantive legal answer/,
    );
  });
});
