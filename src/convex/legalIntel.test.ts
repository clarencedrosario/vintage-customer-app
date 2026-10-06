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
import {
  checkCitation,
  extractCitations,
  detectUncitedAssertions,
  invalidCitationMarkers,
  clarificationQuestions,
} from "../lib/legalIntel";
import { LEGAL_DATE_KINDS } from "./schemaExtras";

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

    // Seed is idempotent. Nine rows since turn 26 (the DPDP Rules 2025
    // gazette source — in:rules:dpdp-2025 — joined the seed set).
    const first = await op.mutation(api.legalIntel.seedIndianCore, {});
    expect(first.sourcesCreated).toBe(9);
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

  it("un-cited assertion detector flags substantive claims with no citation marker", () => {
    const withCitation =
      "Whoever commits murder shall be punished under [in:statute:ipc-1860 § 302] as the stored text provides.";
    const withoutCitation =
      "The accused shall be liable to life imprisonment because the courts have consistently held that murder attracts the maximum sentence in every such case before the trial court.";
    expect(detectUncitedAssertions(withCitation)).toEqual([]);
    const flagged = detectUncitedAssertions(withoutCitation);
    expect(flagged.length).toBe(1);
    expect(flagged[0]).toMatch(/liable to life imprisonment/);
    // Procedural/labelled sentences are not flagged.
    expect(detectUncitedAssertions("Missing information: the incident date.")).toEqual([]);
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
    // recordIngestionResult stamps freshness with the SUCCESS date on the
    // app's IST calendar (todayISO), so derive the expectation on the same
    // day-model instead of hardcoding a calendar day.
    const todayIst = new Date(now + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const versionId = await t.run(async (ctx) => {
      const v = await ctx.db.insert("legalSourceVersions", {
        sourceId: bsaId,
        version: 2,
        body: "1. Short title and commencement.—(1) This Act may be called the Bharatiya Sakshya Adhiniyam, 2023.",
        sections: [{ anchor: "§ 1", heading: "Short title", start: 0 }],
        collectedAt: todayIst,
        createdAt: now,
      });
      return v;
    });
    await op.mutation(api.legalIntel.recordIngestionResult, {
      runId: r1.runId!,
      outcome: "updated",
      newVersionId: versionId,
    });
    const after = await t.run(async (ctx) => {
      const run = await ctx.db.get(r1.runId!);
      const source = await ctx.db.get(bsaId);
      return { run, source };
    });
    expect(after.run?.outcome).toBe("updated");
    expect(after.run?.lastSuccessfulAt).toBeDefined();
    expect(after.source?.collectionDate).toBe(todayIst);

    // 3) failure path: a failed run records the error and keeps lastSuccess unset.
    const r3 = await t.run(ctx =>
      ctx.runMutation(internal.legalIntel.openRun, { sourceId: bsaId }),
    );
    await op.mutation(api.legalIntel.recordIngestionResult, {
      runId: r3.runId!,
      outcome: "failed",
      error: "simulated upstream failure (test)",
    });
    const failedRun = await t.run((ctx) => ctx.db.get(r3.runId!));
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

  // -------------------------------------------------------------------
  // Turn 8 — the real research workflow (26.6): submit → clarification →
  // provider states → retry → save/reopen → citation handling → access.
  // -------------------------------------------------------------------

  it("invalid citation markers: plausible-but-unverifiable markers are flagged, not treated as cited", () => {
    // Reporter-style cite with no stable key → flagged.
    const reporter = invalidCitationMarkers(
      "It is well settled per (1962) 3 SCR 567 that murder attracts the death penalty in every premeditated case before the sessions court without exception whatsoever.",
    );
    expect(reporter.length).toBe(1);
    expect(reporter[0]).toMatch(/Reporter-style/);
    // Bracketed marker with no stable key or pinpoint → flagged.
    const bracket = invalidCitationMarkers(
      "The provision is clear: [BNS 2023, s.103] says the court shall impose the maximum sentence in all such cases without exception whatsoever."
    );
    expect(bracket.length).toBe(1);
    expect(bracket[0]).toMatch(/Invalid citation marker \[BNS 2023, s\.103\]/);
    // Verifiable markers are NOT flagged.
    const good = invalidCitationMarkers(
      "The court may impose life imprisonment under [in:statute:bns-2023 § 103], as the section quoted in the stored version states.",
    );
    expect(good).toEqual([]);
  });

  it("clarification questions: asked only when missing facts change applicability", () => {
    // Fully-specified India matter with a confirmed date → no questions.
    expect(
      clarificationQuestions({
        country: "in",
        jurisdictionConfirmed: true,
        legalDateKnown: true,
        proceduralStage: "trial",
      }),
    ).toEqual([]);
    // Unknown date → the era question (which code governs).
    const noDate = clarificationQuestions({
      country: "in",
      jurisdictionConfirmed: true,
      legalDateKnown: false,
      proceduralStage: "trial",
    });
    expect(noDate.length).toBe(1);
    expect(noDate[0]).toMatch(/Which date should the law be taken as of/i);
    // Confirmed foreign jurisdiction, date known, non-India → no India-specific stage question.
    expect(
      clarificationQuestions({
        country: "de",
        jurisdictionConfirmed: true,
        legalDateKnown: true,
        proceduralStage: null,
      }),
    ).toEqual([]);
    // India + unconfirmed jurisdiction + no stage → three focused questions.
    const all = clarificationQuestions({
      country: "in",
      jurisdictionConfirmed: false,
      legalDateKnown: false,
      proceduralStage: null,
    });
    expect(all.length).toBe(3);
    expect(all.join(" ")).toMatch(/confirm the governing jurisdiction/i);
    expect(all.join(" ")).toMatch(/procedural stage/i);
  });

  it("research workflow: submit → clarifications recorded → provider-failure keeps question → retry works → save/reopen preserves snapshot", async () => {
    const { ownerId, matterId } = await seedFirm(t);
    const lawyer = asUser(t, ownerId);

    // Confirm the matter facts first (turn 9: unconfirmed facts BLOCK the
    // model, so the happy-path pipeline needs a complete profile).
    await lawyer.mutation(api.legalIntel.setMatterProfile, {
      matterId,
      country: "in",
      legalDates: [{ kind: LEGAL_DATE_KINDS[0], date: "2024-03-01" }],
      proceduralStage: "trial",
    });
    // Submit — jurisdiction/dates resolve from the matter.
    const jobId = await lawyer.mutation(api.ai.prepareLegalResearch, {
      matterId,
      question:
        "What punishment applies to culpable homicide not amounting to murder for conduct on 2024-03-01?",
    });
    expect(jobId).toBeDefined();

    // Submission state: question preserved, source snapshot + clarifications recorded.
    const job0 = await lawyer.query(api.ai.getJob, { jobId });
    expect(job0).not.toBeNull();
    expect(job0!.status).toBe("pending");
    expect(job0!.inputNote).toMatch(/culpable homicide/i);
    expect(job0!.clarifications ?? null).toBeNull(); // fully specified → no questions
    expect(job0!.legalSourceVersions).not.toBeNull(); // frozen snapshot (may be empty pre-ingestion)

    // Cross-tenant rejection: another firm's member cannot read or retry.
    const outsiderId = await createTestUser(t, { email: "rival@other.test", verified: true });
    const rivalOrg = await asUser(t, "system").run(async (ctx) =>
      ctx.db.insert("organizations", {
        name: "Rival Chamber",
        slug: "rival-chamber",
        kind: "chamber" as const,
        currency: "INR",
        timezone: "Asia/Kolkata",
        financialYearStart: "04-01",
        taxLabel: "GST",
        taxPercent: 18,
        invoicePrefix: "INV",
        createdBy: outsiderId as never,
        createdAt: Date.now(),
      }),
    );
    await asUser(t, "system").run(async (ctx) => {
      await ctx.db.patch(outsiderId as never, { activeOrgId: rivalOrg });
      await ctx.db.insert("memberships", {
        orgId: rivalOrg,
        userId: outsiderId as never,
        orgRole: "owner" as const,
        status: "active" as const,
        createdAt: Date.now(),
      });
    });
    const rival = asUser(t, outsiderId);
    // Cross-tenant: getJob returns null (job invisible) rather than
    // throwing — the access rule is org-scope, then matter membership.
    expect(await rival.query(api.ai.getJob, { jobId })).toBeNull();
    // But mutation (retry) and the citation report throw.
    await expect(rival.mutation(api.ai.retryJob, { jobId })).rejects.toThrow();

    // Unauthenticated rejection: no subject → requireAccess throws.
    await expect(
      t.withIdentity({ subject: "" }).query(api.ai.getJob, { jobId }),
    ).rejects.toThrow();
    await expect(
      t.withIdentity({ subject: "" }).mutation(api.ai.prepareLegalResearch, {
        matterId,
        question: "Anything at all about a criminal matter for the trial court?",
      }),
    ).rejects.toThrow();

    // Provider-unavailable path: the runner records an honest failure and
    // the question is NOT lost (the exact message runJob writes when the
    // key is missing).
    await t.run(async (ctx) =>
      ctx.runMutation(internal.ai.attachError, {
        jobId,
        error:
          "Live AI is not configured on this deployment (OPENAI_API_KEY missing). The request was saved; nothing was fabricated. Ask the platform owner to add the key, then retry.",
      }),
    );
    const failed = await lawyer.query(api.ai.getJob, { jobId });
    expect(failed!.status).toBe("failed");
    expect(failed!.error).toMatch(/not configured/i);
    expect(failed!.inputNote).toMatch(/culpable homicide/i); // question NOT lost
    expect(failed!.result ?? null).toBeNull(); // no fabricated answer

    // Retry: carries question + snapshot + clarifications onto a NEW
    // pending job; the original stays intact for the record.
    const retryId = await lawyer.mutation(api.ai.retryJob, { jobId });
    expect(retryId).not.toBe(jobId);
    const retried = await lawyer.query(api.ai.getJob, { jobId: retryId });
    expect(retried!.status).toBe("pending");
    expect(retried!.inputNote).toBe(failed!.inputNote);
    expect(retried!.clarifications).toEqual(failed!.clarifications);
    expect(retried!.legalSourceVersions).toEqual(failed!.legalSourceVersions);
    // A pending job cannot be retried again.
    await expect(lawyer.mutation(api.ai.retryJob, { jobId: retryId })).rejects.toThrow();

    // Save/reopen: both jobs appear in the matter's saved list with
    // source-version references intact.
    const list = await lawyer.query(api.ai.listJobs, { matterId });
    expect(list.map((j) => j._id)).toContain(retryId);
    const listed = list.find((j) => j._id === retryId);
    expect(listed!.legalSourceVersions).toEqual(failed!.legalSourceVersions);

    // A completed answer keeps its snapshot through reopen (a model-shaped
    // done state is patched in to avoid a live call in tests).
    await t.run(async (ctx) => {
      await ctx.db.patch(retryId as never, {
        status: "done",
        result:
          'The IPC governs this conduct. Section 302 provides that "Whoever commits murder shall be punished with death" [in:statute:ipc-1860 § 302]. Assumption: the incident date. For lawyer review.',
      });
    });
    const reopened = await lawyer.query(api.ai.getJob, { jobId: retryId });
    expect(reopened!.status).toBe("done");
    expect(reopened!.result).toMatch(/Section 302 provides/);
    expect(reopened!.legalSourceVersions).toEqual(failed!.legalSourceVersions);

    // The citation report derives from persisted check rows: an invalid
    // marker row flips the job's report to needs_citation_review.
    await t.run(async (ctx) => {
      await ctx.db.insert("legalCitationChecks", {
        jobId: retryId as never,
        stableKey: "(invalid citation marker)",
        quote: "Invalid citation marker [IPC § 302] in: \"The court shall...\"",
        sourceExists: false,
        textIngested: false,
        anchorValid: false,
        quoteVerified: false,
        problem: "Invalid citation marker [IPC § 302]",
        ok: false,
        createdAt: Date.now(),
      });
    });
    const report = await lawyer.query(api.legalIntel.citationReportForJob, {
      jobId: retryId,
    });
    expect(report!.status).toBe("needs_citation_review");
    expect(report!.allVerified).toBe(false);
    expect(report!.rows.some((r) => /Invalid citation marker/.test(r.problem ?? ""))).toBe(true);

    // Cross-tenant citation-report read is refused too.
    await expect(
      rival.query(api.legalIntel.citationReportForJob, { jobId: retryId }),
    ).rejects.toThrow();
  });

  it("citation checks pass on ingested text and refuse on the un-ingested POCSO source", async () => {
    const { ownerId, matterId } = await seedFirm(t);
    const lawyer = asUser(t, ownerId);

    const operatorId = await createTestUser(t, {
      email: "op6@cjglobal.test",
      verified: true,
      platformAdmin: true,
    });
    await asUser(t, operatorId).mutation(api.legalIntel.seedIndianCore, {});
    await asUser(t, operatorId).mutation(api.legalIntel.ingestSourceText, {
      stableKey: "in:statute:ipc-1860",
      body: "302. Punishment for murder.--Whoever commits murder shall be punished with death, or imprisonment for life, and shall also be liable to fine.",
      sections: [{ anchor: "§ 302", heading: "Punishment for murder", start: 0 }],
    });

    // Submit a real research request on the matter.
    const jobId = await lawyer.mutation(api.ai.prepareLegalResearch, {
      matterId,
      question: "What is the punishment for murder under the law in force on 2024-03-01?",
    });

    // Snapshot: ONLY the ingested source is included — registry rows whose
    // bodies are [INGESTION PENDING] (POCSO among them) are excluded, so
    // an answer cannot cite text the corpus does not have.
    const snap = await lawyer.query(api.ai.getJob, { jobId });
    expect(snap!.legalSourceVersions).toEqual([{ stableKey: "in:statute:ipc-1860", version: 2 }]);

    // A verifiable citation against the ingested text → checks pass.
    await t.run(async (ctx) =>
      ctx.runMutation(internal.legalIntel.attachCitationChecks, {
        jobId,
        checks: [
          {
            stableKey: "in:statute:ipc-1860",
            provision: "§ 302",
            quote: "Whoever commits murder shall be punished with death",
            sourceExists: true,
            textIngested: true,
            anchorValid: true,
            quoteVerified: true,
            ok: true,
          },
        ],
      }),
    );
    const report = await lawyer.query(api.legalIntel.citationReportForJob, { jobId });
    expect(report!.status).toBe("verified");
    expect(report!.allVerified).toBe(true);

    // POCSO: registered but text NOT ingested → its citation is blocked.
    const pocso = await t.run((ctx) =>
      ctx.runQuery(internal.legalIntel.storedSourceForCheck, {
        stableKey: "in:statute:pocso-2012",
      }),
    );
    expect(pocso).not.toBeNull();
    expect(pocso!.body).toBeNull();
    await t.run(async (ctx) =>
      ctx.runMutation(internal.legalIntel.attachCitationChecks, {
        jobId,
        checks: [
          {
            stableKey: "in:statute:pocso-2012",
            provision: "§ 3",
            quote: "whoever commits penetrative sexual assault shall be punished",
            sourceExists: true,
            textIngested: false,
            anchorValid: false,
            quoteVerified: false,
            problem: "Source registered but text not ingested — citation cannot be verified.",
            ok: false,
          },
        ],
      }),
    );
    const pocsoReport = await lawyer.query(api.legalIntel.citationReportForJob, { jobId });
    expect(pocsoReport!.status).toBe("needs_citation_review");
    expect(pocsoReport!.rows.some((r) => r.stableKey === "in:statute:pocso-2012" && !r.ok)).toBe(
      true,
    );
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

  // -------------------------------------------------------------------
  // Turn 9 — the clarification gate is a real gate, not decoration.
  // -------------------------------------------------------------------

  it("clarification gate blocks the model until facts are supplied, then unblocks on retry", async () => {
    const { ownerId, matterId } = await seedFirm(t);
    const lawyer = asUser(t, ownerId);

    // Fresh matter: no jurisdiction confirmation, no dates → submission is
    // parked as blocked_clarification and the runner is NEVER scheduled.
    const blockedId = await lawyer.mutation(api.ai.prepareLegalResearch, {
      matterId,
      question: "What notice period governs this dispute and under which code?",
    });
    const blocked = await lawyer.query(api.ai.getJob, { jobId: blockedId });
    expect(blocked!.status).toBe("blocked_clarification");
    expect(blocked!.inputNote).toMatch(/notice period/); // question preserved
    expect(blocked!.clarifications!.length).toBeGreaterThan(0);
    expect(blocked!.result ?? null).toBeNull(); // no fabricated answer

    // The lawyer supplies the facts via the matter profile (confirmed
    // jurisdiction + a governing date).
    await lawyer.mutation(api.legalIntel.setMatterProfile, {
      matterId,
      country: "in",
      legalDates: [{ kind: LEGAL_DATE_KINDS[0], date: "2024-03-01" }],
      proceduralStage: "trial",
    });

    // Retrying the SAME request recomputes the gate and runs it.
    const retryId = await lawyer.mutation(api.ai.retryJob, { jobId: blockedId });
    expect(retryId).not.toBe(blockedId);
    const retried = await lawyer.query(api.ai.getJob, { jobId: retryId });
    expect(retried!.status).toBe("pending");
    expect(retried!.clarifications ?? null).toBeNull(); // gate cleared

    // (The pending path after the gate clears is exactly the retried job
    // asserted above — one firm, one matter, no second seeding.)
  });

  it("runner-time recheck: revoked membership fails the scheduled run before the model is called", async () => {
    const { ownerId, matterId } = await seedFirm(t);
    const lawyer = asUser(t, ownerId);

    await lawyer.mutation(api.legalIntel.setMatterProfile, {
      matterId,
      country: "in",
      legalDates: [{ kind: LEGAL_DATE_KINDS[0], date: "2024-03-01" }],
      proceduralStage: "trial",
    });
    const jobId = await lawyer.mutation(api.ai.prepareLegalResearch, {
      matterId,
      question: "What is the punishment for culpable homicide not amounting to murder?",
    });

    // The requester's membership is suspended BEFORE the scheduled
    // runner claims the job (access withdrawn after submission).
    await asUser(t, "system").run(async (ctx) => {
      const job = await ctx.db.get(jobId);
      const all = await ctx.db.query("memberships").collect();
      const m = all.find(
        (x) => x.orgId === job!.orgId && x.userId === job!.requestedById,
      );
      await ctx.db.patch(m!._id, { status: "suspended" }); // access withdrawn
    });

    // The claim now fails honestly: job failed, NO claim row → the model
    // is never called and no duplicate run can occur.
    const claim = await t.run((ctx) =>
      ctx.runMutation(internal.ai.claimPendingJob, {
        jobId,
        occurrenceKey: "ai:" + jobId,
      }),
    );
    expect(claim).toBeNull();
    // With their only membership suspended the requester cannot even read
    // the job — the failed state is verified by direct read (admin ctx).
    const job = await asUser(t, "system").run((ctx) => ctx.db.get(jobId));
    expect(job!.status).toBe("failed");
    expect(job!.error).toMatch(/no longer has access/);
    const claims = await t.run((ctx) => ctx.db.query("aiJobClaims").collect());
    expect(claims.find((r) => r.occurrenceKey === "ai:" + jobId)).toBeUndefined();
  });

  it("concurrent claims: only the first claim wins — the model can never run twice", async () => {
    const { ownerId, matterId } = await seedFirm(t);
    const lawyer = asUser(t, ownerId);
    await lawyer.mutation(api.legalIntel.setMatterProfile, {
      matterId,
      country: "in",
      legalDates: [{ kind: LEGAL_DATE_KINDS[0], date: "2024-03-01" }],
      proceduralStage: "trial",
    });
    const jobId = await lawyer.mutation(api.ai.prepareLegalResearch, {
      matterId,
      question: "Does the limitation act bar this claim filed in 2025?",
    });

    // Two racing claims with the same occurrence key (a retried job and
    // its stale scheduled twin, say).
    const first = await t.run((ctx) =>
      ctx.runMutation(internal.ai.claimPendingJob, { jobId, occurrenceKey: "ai:" + jobId }),
    );
    expect(first).not.toBeNull();
    const second = await t.run((ctx) =>
      ctx.runMutation(internal.ai.claimPendingJob, { jobId, occurrenceKey: "ai:" + jobId }),
    );
    expect(second).toBeNull();
  });

  it("citation report with zero checks is unchecked — never a success banner", async () => {
    const { ownerId, matterId } = await seedFirm(t);
    const lawyer = asUser(t, ownerId);
    const jobId = await lawyer.mutation(api.ai.prepareLegalResearch, {
      matterId,
      question: "A question about a contract dispute for the district court?",
    });
    const report = await lawyer.query(api.legalIntel.citationReportForJob, { jobId });
    expect(report!.status).toBe("unchecked");
    expect(report!.allVerified).toBe(false);
    expect(report!.total).toBe(0);
  });

});
