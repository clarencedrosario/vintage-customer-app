import { describe, expect, it, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules: Record<string, () => Promise<unknown>> = (import.meta as unknown as {
  glob: (p: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.ts");

const asUser = (t: ReturnType<typeof convexTest>, userId: string) =>
  t.withIdentity({ subject: userId, tokenIdentifier: `test:${userId}` });

/** Seed one org + owner + client + matter. */
async function seedFirm(t: ReturnType<typeof convexTest>) {
  const ownerId = await asUser(t, "system").run(async (ctx) =>
    ctx.db.insert("users", {
      email: "owner@t16.test",
      emailVerified: true,
      isAnonymous: false,
      isPlatformAdmin: false,
    }),
  );
  const seeded = await asUser(t, "system").run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "T16 Chamber (synthetic)",
      slug: "t16-firm",
      kind: "chamber" as const,
      currency: "INR",
      timezone: "Asia/Kolkata",
      financialYearStart: "04-01",
      taxLabel: "GST",
      taxPercent: 18,
      invoicePrefix: "INV",
      createdBy: ownerId as never,
      createdAt: Date.now(),
    });
    await ctx.db.insert("memberships", {
      orgId,
      userId: ownerId as never,
      orgRole: "owner" as const,
      status: "active" as const,
      createdAt: Date.now(),
    });
    await ctx.db.patch(ownerId as never, { activeOrgId: orgId });
    const clientId = await ctx.db.insert("clients", {
      orgId,
      kind: "company" as const,
      name: "Acme Trading Pvt. Ltd.",
      createdBy: ownerId as never,
      createdAt: Date.now(),
    });
    const matterId = await ctx.db.insert("matters", {
      orgId,
      clientId,
      reference: "T16/2026/0001",
      title: "Recovery suit — Acme v. Kumar",
      practiceArea: "civil",
      clientRole: "Acme Trading Pvt. Ltd.",
      opposingParty: "Rajesh Kumar",
      court: "City Civil Court",
      status: "open" as const,
      createdBy: ownerId as never,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { orgId, clientId, matterId };
  });
  return { ownerId, ...seeded };
}

/** Two documents with conflicting dates AND amounts on the same topic. */
async function seedConflictingDocs(
  t: ReturnType<typeof convexTest>,
  ownerId: string,
  matterId: string,
) {
  const owner = asUser(t, ownerId);
  const makeDoc = async (name: string, kind: "document" | "communication") =>
    asUser(t, "system").run(async (ctx) =>
      ctx.db.insert("matterDocuments", {
        matterId: matterId as never,
        uploaderId: ownerId as never,
        name,
        kind,
        visibility: "internal" as const,
        createdAt: Date.now(),
      }),
    );
  const doc1 = await makeDoc("Plaint paper", "document");
  const doc2 = await makeDoc("Reply paper", "communication");
  const src1 = await owner.mutation(api.ai.addSource, {
    matterId: matterId as never,
    documentId: doc1 as never,
    name: "Plaint paper",
    role: "our_client",
    text: "Agreement dated 2024-03-15. Amount due Rs. 4,50,000. Cause of action arose on 2025-01-10.",
    extraction: "text_layer",
  });
  const src2 = await owner.mutation(api.ai.addSource, {
    matterId: matterId as never,
    documentId: doc2 as never,
    name: "Reply paper",
    role: "opposing_party",
    text: "The agreement was executed on 2024-04-02. Only Rs. 3,10,000 remained payable.",
    extraction: "text_layer",
  });
  await owner.mutation(api.matterIntelligence.analyseSource, {
    aiSourceId: src1 as never,
  });
  await owner.mutation(api.matterIntelligence.analyseSource, {
    aiSourceId: src2 as never,
  });
  const analyses = await owner.query(api.matterIntelligence.analyses, {
    matterId: matterId as never,
  });
  for (const a of analyses) {
    await owner.mutation(api.matterIntelligence.importAnalysisFacts, {
      analysisId: a._id as never,
    });
  }
  const facts = await owner.query(api.matterIntelligence.facts, {
    matterId: matterId as never,
  });
  return { doc1, doc2, src1, src2, facts };
}

describe("Turn 16 — Phase 1 conflicting-evidence review", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  it("detects date + amount conflicts, shows side-by-side provenance, lawyer actions record history", async () => {
    const { ownerId, matterId } = await seedFirm(t);
    const owner = asUser(t, ownerId);
    const { facts } = await seedConflictingDocs(t, ownerId, matterId);
    expect(facts.length).toBeGreaterThanOrEqual(4);

    const scan = await owner.mutation(api.conflictReview.scan, {
      matterId: matterId as never,
    });
    expect(scan.created).toBeGreaterThanOrEqual(2); // date pair + amount pair

    const rows = await owner.query(api.conflictReview.list, {
      matterId: matterId as never,
    });
    const dateRow = rows.find((r) => r.kind === "date_conflict")!;
    const amountRow = rows.find((r) => r.kind === "amount_conflict")!;
    expect(dateRow).toBeDefined();
    expect(amountRow).toBeDefined();

    // Side-by-side: the two sides come from DIFFERENT documents with
    // their own versions, pinpoints and epistemic status (extracted =
    // machine proposals, unconfirmed). Pair order is not significant.
    expect(dateRow!.sideA.occurredOn).not.toBe(dateRow!.sideB.occurredOn);
    const sideNames = [dateRow!.sideA.sourceName, dateRow!.sideB.sourceName].sort();
    expect(sideNames).toEqual([
      "Plaint paper",
      "Reply paper",
    ]);
    expect(dateRow!.sideA.factStatus).toBe("extracted");
    expect(dateRow!.sideB.factStatus).toBe("extracted");
    expect(dateRow!.sideA.pinpoints.length + dateRow!.sideB.pinpoints.length).toBeGreaterThan(0);

    // "Different events" dismissal is a first-class action.
    await owner.mutation(api.conflictReview.act, {
      findingId: dateRow!.findingId as never,
      action: "dismiss_different_events",
      note: "Side A records the agreement date; side B records the delivery date — different events.",
    });
    // Amount conflict: lawyer records an ACCEPTED INTERPRETATION instead
    // of declaring a side false.
    await owner.mutation(api.conflictReview.act, {
      findingId: amountRow!.findingId as never,
      action: "accept_interpretation",
      note: "Plaint amount is the gross claim; reply acknowledges partial payments. Reconciliation recorded.",
    });
    const after = await owner.query(api.conflictReview.list, {
      matterId: matterId as never,
    });
    expect(after).toHaveLength(0); // resolved rows leave the open queue
    const all = await owner.query(api.conflictReview.list, {
      matterId: matterId as never,
      includeResolved: true,
    });
    const dismissed = all.find((r) => r.findingId === dateRow!.findingId)!;
    expect(dismissed.status).toBe("dismissed_different_events");
    const interpreted = all.find((r) => r.findingId === amountRow!.findingId)!;
    expect(interpreted.status).toBe("accepted_interpretation");
    // Both original sources preserved on the record.
    expect(dismissed.sideA.statement.length).toBeGreaterThan(0);
    expect(dismissed.sideB.statement.length).toBeGreaterThan(0);

    // Append-only history for each finding.
    const hist = await owner.query(api.conflictReview.history, {
      findingId: dateRow!.findingId as never,
    });
    expect(hist).toHaveLength(1);
    expect(hist[0]!.fromStatus).toBe("open");
    expect(hist[0]!.toStatus).toBe("dismissed_different_events");
    expect(hist[0]!.changedById).toBeDefined();

    // A re-scan must NOT resurrect reviewed pairs.
    const rescanned = await owner.mutation(api.conflictReview.scan, {
      matterId: matterId as never,
    });
    expect(rescanned.created).toBe(0);
  });

  it("later documents never auto-resolve; source change flags accepted findings for reassessment", async () => {
    const { ownerId, matterId } = await seedFirm(t);
    const owner = asUser(t, ownerId);
    const { src2 } = await seedConflictingDocs(t, ownerId, matterId);

    await owner.mutation(api.conflictReview.scan, { matterId: matterId as never });
    const rows = await owner.query(api.conflictReview.list, { matterId: matterId as never });
    const dateRow = rows.find((r) => r.kind === "date_conflict")!;
    // Lawyer ACCEPTS an interpretation…
    await owner.mutation(api.conflictReview.act, {
      findingId: dateRow!.findingId as never,
      action: "accept_interpretation",
      note: "Execution date 2024-04-02 governs; 2024-03-15 was the draft date.",
    });

    // …then the SOURCE TEXT CHANGES (new version of the reply document).
    await asUser(t, "system").run(async (ctx) =>
      ctx.db.patch(src2 as never, {
        text: "CORRECTED: the agreement was executed on 2024-04-09, not the earlier stated date.",
      }),
    );
    const flagged = await owner.mutation(api.conflictReview.flagForReassessment, {
      aiSourceId: src2 as never,
    });
    expect(flagged.flagged).toBeGreaterThanOrEqual(1);

    // The accepted outcome is NOT replaced — it is flagged for the lawyer.
    const all = await owner.query(api.conflictReview.list, {
      matterId: matterId as never,
    });
    const flaggedRow = all.find((r) => r.findingId === dateRow!.findingId)!;
    expect(flaggedRow).toBeDefined();
    expect(flaggedRow.status).toBe("reassessment_flagged");
    expect(flaggedRow.sourceChangeFlag).toBeDefined();
    // The lawyer's recorded interpretation is still on the record.
    expect(flaggedRow.note).toContain("2024-04-02 governs");

    // Re-review clears the flag and appends history (2 actions now).
    await owner.mutation(api.conflictReview.act, {
      findingId: dateRow!.findingId as never,
      action: "confirm_conflict",
      note: "Corrected reply date still differs from the plaint — genuine conflict.",
    });
    const hist = await owner.query(api.conflictReview.history, {
      findingId: dateRow!.findingId as never,
    });
    expect(hist.length).toBe(2);
    const resolved = await owner.query(api.conflictReview.list, {
      matterId: matterId as never,
      includeResolved: true,
    });
    expect(resolved.find((r) => r.findingId === dateRow!.findingId)!.status).toBe(
      "confirmed_conflict",
    );
  });

  it("cross-tenant: rival org cannot see or act on the matter's findings", async () => {
    const { ownerId, matterId } = await seedFirm(t);
    const owner = asUser(t, ownerId);
    await seedConflictingDocs(t, ownerId, matterId);
    await owner.mutation(api.conflictReview.scan, { matterId: matterId as never });
    const rows = await owner.query(api.conflictReview.list, { matterId: matterId as never });
    expect(rows.length).toBeGreaterThanOrEqual(1);

    const rivalId = await asUser(t, "system").run(async (ctx) => {
      const uid = await ctx.db.insert("users", {
        email: "rival@t16.test",
        emailVerified: true,
        isAnonymous: false,
        isPlatformAdmin: false,
      });
      const orgId = await ctx.db.insert("organizations", {
        name: "Rival T16",
        slug: "rival-t16",
        kind: "chamber" as const,
        currency: "INR",
        timezone: "Asia/Kolkata",
        financialYearStart: "04-01",
        taxLabel: "GST",
        taxPercent: 18,
        invoicePrefix: "INV",
        createdBy: uid as never,
        createdAt: Date.now(),
      });
      await ctx.db.insert("memberships", {
        orgId,
        userId: uid as never,
        orgRole: "owner" as const,
        status: "active" as const,
        createdAt: Date.now(),
      });
      await ctx.db.patch(uid as never, { activeOrgId: orgId });
      return uid;
    });

    expect(
      await asUser(t, rivalId).query(api.conflictReview.list, {
        matterId: matterId as never,
      }),
    ).toEqual([]);
    await expect(
      asUser(t, rivalId).mutation(api.conflictReview.act, {
        findingId: rows[0]!.findingId as never,
        action: "confirm_conflict",
        note: "hostile",
      }),
    ).rejects.toThrow();
    await expect(
      asUser(t, rivalId).mutation(api.conflictReview.scan, {
        matterId: matterId as never,
      }),
    ).rejects.toThrow();
    void ownerId;
  });
});

describe("Turn 16 — Phase 4 research evidence bundles", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  it("freezes citations to source versions with validation, flags broken quotes, supersession chain", async () => {
    const { ownerId, matterId, orgId } = await seedFirm(t);
    void orgId;
    const owner = asUser(t, ownerId);

    // Ingest one legal source with a versioned body (good citation) and
    // reference a second, nonexistent stableKey (broken citation).
    const srcId = await asUser(t, "system").run(async (ctx) =>
      ctx.db.insert("legalSources", {
        stableKey: "in:statute:test-act-2026",
        title: "Test Act, 2026",
        kind: "statute" as const,
        country: "in",
        jurisdictionLevel: "national" as never,
        rights: "Open government data",
        publisher: "Gazette (synthetic)",
        sourceUrl: "https://example.test/gazette",
        collectionDate: "2026-09-30",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const versionId = await asUser(t, "system").run(async (ctx) =>
      ctx.db.insert("legalSourceVersions", {
        sourceId: srcId as never,
        version: 2,
        body: "Section 3: Every application shall be accompanied by an affidavit of service within thirty days.",
        collectedAt: "2026-09-30",
        createdAt: Date.now(),
      }),
    );
    await asUser(t, "system").run(async (ctx) =>
      ctx.db.patch(srcId as never, { latestVersion: versionId as never }),
    );

    // A done research job citing the good source + a broken one.
    const jobId = await asUser(t, "system").run(async (ctx) =>
      ctx.db.insert("aiJobs", {
        orgId: orgId as never,
        matterId: matterId as never,
        kind: "research_question",
        status: "done" as const,
        inputNote: "What is the service requirement for applications under the Test Act?",
        result:
          "Applications must be accompanied by an affidavit of service within thirty days. [1]",
        structured: {
          citations: [
            {
              stableKey: "in:statute:test-act-2026",
              quote:
                "Every application shall be accompanied by an affidavit of service within thirty days.",
              anchor: "s 3",
              title: "Test Act, 2026 — s.3",
            },
            {
              stableKey: "in:judgment:missing-citation-2026",
              quote: "No such judgment exists in the corpus.",
              title: "Nonexistent judgment",
            },
          ],
        },
        requestedById: ownerId as never,
        createdAt: Date.now(),
        completedAt: Date.now(),
      }),
    );

    const created = await owner.mutation(api.evidenceBundles.createFromJob, {
      jobId: jobId as never,
      title: "Service requirements under the Test Act",
      unresolvedQuestions: ["Whether the thirty-day period is extendable."],
    });
    expect(created.citations).toBe(2);
    expect(created.unresolvedIssues).toBe(1); // broken citation flagged

    const bundle = await owner.query(api.evidenceBundles.get, {
      bundleId: created.bundleId as never,
    });
    expect(bundle!.status).toBe("draft");
    expect(bundle!.jurisdiction).toBe("unspecified"); // profile not confirmed
    expect(bundle!.unresolvedQuestions).toHaveLength(1);
    const good = bundle!.citations.find((c) => c.stableKey === "in:statute:test-act-2026")!;
    expect(good.validation!.quoteVerified).toBe(true);
    expect(good.sourceVersion).toBe(2);
    expect(good.integrityHash).toBeDefined();
    const broken = bundle!.citations.find(
      (c) => c.stableKey === "in:judgment:missing-citation-2026",
    )!;
    expect(broken.validation!.sourceExists).toBe(false);

    // Manifest: reference-only export, label, validation results, omissions.
    const manifest = await owner.query(api.evidenceBundles.manifest, {
      bundleId: created.bundleId as never,
    });
    expect(manifest!.label).toMatch(/not a certified court record/);
    expect(manifest!.citations.every((c) => c.exportedAs === "reference")).toBe(true);
    expect(manifest!.unresolvedCitationIssues).toHaveLength(1);
    expect(manifest!.omitted.length).toBeGreaterThanOrEqual(2);

    // Newer source version later → the bundle is NOT re-pointed; a NEW
    // bundle freezes the new state and marks the old superseded.
    const version2 = await asUser(t, "system").run(async (ctx) =>
      ctx.db.insert("legalSourceVersions", {
        sourceId: srcId as never,
        version: 3,
        body: "Section 3 (amended): Every application shall be accompanied by an affidavit of service within forty-five days.",
        collectedAt: "2026-10-01",
        createdAt: Date.now(),
      }),
    );
    await asUser(t, "system").run(async (ctx) =>
      ctx.db.patch(srcId as never, { latestVersion: version2 as never }),
    );
    const created2 = await owner.mutation(api.evidenceBundles.createFromJob, {
      jobId: jobId as never,
      title: "Service requirements (re-export after amendment)",
    });
    expect(created2.bundleId).not.toBe(created.bundleId);
    const old = await owner.query(api.evidenceBundles.get, {
      bundleId: created.bundleId as never,
    });
    expect(old!.status).toBe("superseded"); // preserved, never re-pointed
    expect(old!.citations[0]!.quote).toContain("thirty days"); // original
    const fresh = await owner.query(api.evidenceBundles.get, {
      bundleId: created2.bundleId as never,
    });
    expect(fresh!.citations[0]!.sourceVersion).toBe(3);

    // Lawyer finalizes; reviewer recorded via generatedById + final state.
    await owner.mutation(api.evidenceBundles.setReview, {
      bundleId: created2.bundleId as never,
      status: "finalized",
    });
    const fin = await owner.query(api.evidenceBundles.get, {
      bundleId: created2.bundleId as never,
    });
    expect(fin!.status).toBe("finalized");
  });

  it("cross-tenant: rival cannot read the bundle or manifest", async () => {
    const { ownerId, matterId, orgId } = await seedFirm(t);
    const owner = asUser(t, ownerId);
    const jobId = await asUser(t, "system").run(async (ctx) =>
      ctx.db.insert("aiJobs", {
        orgId: orgId as never,
        matterId: matterId as never,
        kind: "research_question",
        status: "done" as const,
        inputNote: "Q?",
        result: "A.",
        structured: { citations: [] },
        requestedById: ownerId as never,
        createdAt: Date.now(),
      }),
    );
    const created = await owner.mutation(api.evidenceBundles.createFromJob, {
      jobId: jobId as never,
      title: "T",
    });
    const rivalId = await asUser(t, "system").run(async (ctx) => {
      const uid = await ctx.db.insert("users", {
        email: "rival2@t16.test",
        emailVerified: true,
        isAnonymous: false,
        isPlatformAdmin: false,
      });
      const rOrg = await ctx.db.insert("organizations", {
        name: "Rival2 T16",
        slug: "rival2-t16",
        kind: "chamber" as const,
        currency: "INR",
        timezone: "Asia/Kolkata",
        financialYearStart: "04-01",
        taxLabel: "GST",
        taxPercent: 18,
        invoicePrefix: "INV",
        createdBy: uid as never,
        createdAt: Date.now(),
      });
      await ctx.db.insert("memberships", {
        orgId: rOrg,
        userId: uid as never,
        orgRole: "owner" as const,
        status: "active" as const,
        createdAt: Date.now(),
      });
      await ctx.db.patch(uid as never, { activeOrgId: rOrg });
      return uid;
    });
    expect(
      await asUser(t, rivalId).query(api.evidenceBundles.get, {
        bundleId: created.bundleId as never,
      }),
    ).toBeNull();
    expect(
      await asUser(t, rivalId).query(api.evidenceBundles.manifest, {
        bundleId: created.bundleId as never,
      }),
    ).toBeNull();
    expect(
      await asUser(t, rivalId).query(api.evidenceBundles.listForMatter, {
        matterId: matterId as never,
      }),
    ).toEqual([]);
  });
});

describe("Turn 16 — Phase 2 adverse authority & citation recheck", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  const BODY =
    "Where the borrower dies before repayment, the tribunal may order the legal representative to discharge the debt from the estate, provided the claim was filed within the limitation period.";
  const POSITION =
    "Where a borrower dies before repayment, the legal representative must discharge the debt from the estate.";

  /** Ingest one judgment with a versioned body. */
  async function seedCorpus(version = 1) {
    const srcId = await asUser(t, "system").run(async (ctx) =>
      ctx.db.insert("legalSources", {
        stableKey: "in:judgment:adverse-test-2026",
        title: "Estate Recovery v. Representative (synthetic)",
        kind: "judgment" as const,
        country: "in",
        jurisdictionLevel: "national" as never,
        court: "Supreme Court (synthetic)",
        decidedAt: Date.parse("2026-02-11"),
        citation: "(2026) 2 SCC 999 (synthetic)",
        rights: "Open government data (synthetic)",
        publisher: "Synthetic reports",
        sourceUrl: "https://example.test/judgment",
        collectionDate: "2026-09-30",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const versionId = await asUser(t, "system").run(async (ctx) =>
      ctx.db.insert("legalSourceVersions", {
        sourceId: srcId as never,
        version,
        body: BODY,
        collectedAt: "2026-09-30",
        createdAt: Date.now(),
      }),
    );
    await asUser(t, "system").run(async (ctx) =>
      ctx.db.patch(srcId as never, { latestVersion: versionId as never }),
    );
    return { srcId, versionId };
  }

  async function seedResearchJob(
    ownerId: string,
    orgId: string,
    matterId: string,
    recordedVersion: number,
  ) {
    return asUser(t, "system").run(async (ctx) =>
      ctx.db.insert("aiJobs", {
        orgId: orgId as never,
        matterId: matterId as never,
        kind: "research_question",
        status: "done" as const,
        inputNote: "Is the representative liable for the borrower's debt?",
        result: "The representative may be ordered to discharge the debt.",
        structured: { citations: [] },
        legalSourceVersions: [
          { stableKey: "in:judgment:adverse-test-2026", version: recordedVersion },
          { stableKey: "in:judgment:vanished-2020", version: 1 },
        ],
        requestedById: ownerId as never,
        createdAt: Date.now(),
      }),
    );
  }

  it("adverse search shows the passage and terms behind every hit, states scope limits, and withholds unsupported treatment", async () => {
    const { ownerId } = await seedFirm(t);
    const { srcId } = await seedCorpus();
    const owner = asUser(t, ownerId);

    const res = await owner.query(api.adverseAuthority.searchAdverse, {
      position: POSITION,
      country: "in",
    });
    expect(res).not.toBeNull();
    expect(res!.results).toHaveLength(1);
    const hit = res!.results[0]!;
    expect(hit.stableKey).toBe("in:judgment:adverse-test-2026");
    expect(hit.matchedTerms.length).toBeGreaterThanOrEqual(2);
    expect(hit.passage).toContain("borrower");
    expect(hit.sameCountry).toBe(true);
    expect(hit.court).toContain("Supreme Court");
    expect(hit.decidedAt).not.toBeNull();
    // Relevance framing: terminology overlap, never a legal determination.
    expect(hit.note).toMatch(/NOT a legal determination of adversity/);
    // Scope honesty, stated on every call.
    expect(res!.scope.corpusSize).toBe(1);
    expect(res!.scope.termsUsed.length).toBeGreaterThanOrEqual(2);
    expect(res!.scope.coverageLimit).toMatch(/does NOT prove/);

    // A treatment label WITHOUT a supporting source is withheld in search
    // too — same rule as the recheck path.
    await asUser(t, "system").run(async (ctx) =>
      ctx.db.patch(srcId as never, { treatment: "questioned" }),
    );
    const res2 = await owner.query(api.adverseAuthority.searchAdverse, {
      position: POSITION,
    });
    const hit2 = res2!.results.find(
      (r) => r.stableKey === "in:judgment:adverse-test-2026",
    )!;
    expect(hit2.treatmentSupported).toBe(false);
    expect(hit2.treatment).toBeNull();
    expect(hit2.treatmentNote).toMatch(/WITHOUT a supporting source/);
    expect(hit2.treatmentNote).toMatch(/model inference is never sufficient/);

    // Trivial positions are refused.
    await expect(
      owner.query(api.adverseAuthority.searchAdverse, { position: "short" }),
    ).rejects.toThrow(/at least a sentence/);
  });

  it("recheck flags changed and unavailable citations; treatment only with its supporting source", async () => {
    const { ownerId, matterId, orgId } = await seedFirm(t);
    const owner = asUser(t, ownerId);
    const { srcId } = await seedCorpus(2);
    const jobId = await seedResearchJob(ownerId, orgId, matterId, 2);

    // Fresh recheck: recorded 2 == current 2 → unchanged; the vanished
    // stableKey is unavailable, and that is the only affected item.
    const fresh = await owner.query(api.adverseAuthority.recheck, {
      jobId: jobId as never,
    });
    expect(fresh!.researchDate).toBeDefined();
    const ok = fresh!.items.find(
      (i) => i.stableKey === "in:judgment:adverse-test-2026",
    )!;
    expect(ok.status).toBe("unchanged");
    const gone = fresh!.items.find((i) => i.stableKey === "in:judgment:vanished-2020")!;
    expect(gone.status).toBe("unavailable");
    expect(fresh!.affected).toBe(1);
    expect(fresh!.scopeNote).toMatch(/not that the law has not moved/);
    expect(fresh!.adverseNote).toMatch(/does not search for adverse authority by itself/);

    // A newer version is ingested → recorded 2 vs current 3 = changed.
    const v3 = await asUser(t, "system").run(async (ctx) =>
      ctx.db.insert("legalSourceVersions", {
        sourceId: srcId as never,
        version: 3,
        body: BODY + " Clarified in a later report.",
        collectedAt: "2026-10-01",
        createdAt: Date.now(),
      }),
    );
    await asUser(t, "system").run(async (ctx) =>
      ctx.db.patch(srcId as never, { latestVersion: v3 as never }),
    );
    const after = await owner.query(api.adverseAuthority.recheck, {
      jobId: jobId as never,
    });
    const changed = after!.items.find(
      (i) => i.stableKey === "in:judgment:adverse-test-2026",
    )!;
    expect(changed.status).toBe("changed");
    expect(changed.recordedVersion).toBe(2);
    expect(changed.currentVersion).toBe(3);
    expect(after!.affected).toBe(2);

    // Treatment WITHOUT a supporting source → withheld entirely.
    await asUser(t, "system").run(async (ctx) =>
      ctx.db.patch(srcId as never, { treatment: "overruled" }),
    );
    const withheld = await owner.query(api.adverseAuthority.recheck, {
      jobId: jobId as never,
    });
    const w = withheld!.items.find(
      (i) => i.stableKey === "in:judgment:adverse-test-2026",
    )!;
    expect(w.treatmentSupported).toBe(false);
    expect(w.treatment).toBeNull();
    expect(w.treatmentNote).toMatch(/WITHOUT a supporting source/);

    // With the supporting source recorded, the treatment is shown WITH it.
    await asUser(t, "system").run(async (ctx) =>
      ctx.db.patch(srcId as never, { treatmentSourceKey: "in:judgment:supporting-2026" }),
    );
    const shown = await owner.query(api.adverseAuthority.recheck, {
      jobId: jobId as never,
    });
    const s = shown!.items.find(
      (i) => i.stableKey === "in:judgment:adverse-test-2026",
    )!;
    expect(s.treatmentSupported).toBe(true);
    expect(s.treatment).toBe("overruled");
    expect(s.treatmentSourceKey).toBe("in:judgment:supporting-2026");
    expect(s.treatmentNote).toMatch(/Verify the supporting source yourself/);

    // Exactly one of jobId/bundleId (a REAL bundle id, since Convex
    // validates table membership before the handler runs).
    const emptyJob = await asUser(t, "system").run(async (ctx) =>
      ctx.db.insert("aiJobs", {
        orgId: orgId as never,
        matterId: matterId as never,
        kind: "research_question",
        status: "done" as const,
        inputNote: "Scratch job for XOR validation",
        result: "Scratch answer text.",
        structured: { citations: [] },
        requestedById: ownerId as never,
        createdAt: Date.now(),
      }),
    );
    const anyBundle = await owner.mutation(api.evidenceBundles.createFromJob, {
      jobId: emptyJob as never,
      title: "Bundle for XOR validation",
    });
    await expect(
      owner.query(api.adverseAuthority.recheck, {
        jobId: jobId as never,
        bundleId: anyBundle.bundleId as never,
      }),
    ).rejects.toThrow(/exactly one/);
  });

  it("recordDecision appends the matter trail; thin notes and cross-tenant calls are refused", async () => {
    const { ownerId, matterId, orgId } = await seedFirm(t);
    const owner = asUser(t, ownerId);
    await seedCorpus(1);
    const jobId = await seedResearchJob(ownerId, orgId, matterId, 1);

    // Owning org can recheck its own job (2 recorded citations → 2 items).
    const rec = await owner.query(api.adverseAuthority.recheck, { jobId: jobId as never });
    expect(rec!.items).toHaveLength(2);
    expect(rec!.items.every((i) => i.status === "unchanged" || i.status === "unavailable")).toBe(true);

    const decision = await owner.mutation(api.adverseAuthority.recordDecision, {
      matterId: matterId as never,
      stableKey: "in:judgment:adverse-test-2026",
      decision: "reviewed_no_change_needed",
      note: "Re-read the current version; the position stands as pleaded.",
    });
    expect(decision.recorded).toBe(true);
    const events = await asUser(t, "system").run(async (ctx) =>
      ctx.db.query("matterEvents").collect(),
    );
    const mine = events.filter((e) => e.matterId === matterId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.detail).toContain("reviewed_no_change_needed");
    expect(mine[0]!.authorId).toBeDefined();

    // Thin notes are refused — the trail must be self-explanatory.
    await expect(
      owner.mutation(api.adverseAuthority.recordDecision, {
        matterId: matterId as never,
        stableKey: "in:judgment:adverse-test-2026",
        decision: "research_updated",
        note: "ok",
      }),
    ).rejects.toThrow(/reason for the decision/);

    // Rival org: recheck on the job and a decision on the matter refused.
    const rivalId = await asUser(t, "system").run(async (ctx) => {
      const uid = await ctx.db.insert("users", {
        email: "rival3@t16.test",
        emailVerified: true,
        isAnonymous: false,
        isPlatformAdmin: false,
      });
      const rOrg = await ctx.db.insert("organizations", {
        name: "Rival3 T16",
        slug: "rival3-t16",
        kind: "chamber" as const,
        currency: "INR",
        timezone: "Asia/Kolkata",
        financialYearStart: "04-01",
        taxLabel: "GST",
        taxPercent: 18,
        invoicePrefix: "INV",
        createdBy: uid as never,
        createdAt: Date.now(),
      });
      await ctx.db.insert("memberships", {
        orgId: rOrg,
        userId: uid as never,
        orgRole: "owner" as const,
        status: "active" as const,
        createdAt: Date.now(),
      });
      await ctx.db.patch(uid as never, { activeOrgId: rOrg });
      return uid;
    });
    await expect(
      asUser(t, rivalId).query(api.adverseAuthority.recheck, { jobId: jobId as never }),
    ).rejects.toThrow();
    await expect(
      asUser(t, rivalId).mutation(api.adverseAuthority.recordDecision, {
        matterId: matterId as never,
        stableKey: "in:judgment:adverse-test-2026",
        decision: "escalated_to_lawyer_review",
        note: "hostile org probing a matter it cannot see",
      }),
    ).rejects.toThrow();
    void ownerId;
  });
});

describe("Turn 16 — Phase 3 matter-impact alerts (opt-in)", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  const STABLE_KEY = "in:statute:impact-test-act";

  /** One legal source at the given version. */
  async function seedAlertSource(version: number) {
    const srcId = await asUser(t, "system").run(async (ctx) =>
      ctx.db.insert("legalSources", {
        stableKey: STABLE_KEY,
        title: "Impact Test Act (synthetic)",
        kind: "statute" as const,
        country: "in",
        jurisdictionLevel: "national" as never,
        rights: "Open government data (synthetic)",
        publisher: "Gazette (synthetic)",
        sourceUrl: "https://example.test/impact-act",
        collectionDate: "2026-09-30",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const versionId = await asUser(t, "system").run(async (ctx) =>
      ctx.db.insert("legalSourceVersions", {
        sourceId: srcId as never,
        version,
        body: `Section 1 (v${version}): The limitation period shall be ninety days.`,
        collectedAt: "2026-09-30",
        createdAt: Date.now(),
      }),
    );
    await asUser(t, "system").run(async (ctx) =>
      ctx.db.patch(srcId as never, { latestVersion: versionId as never }),
    );
    return { srcId, versionId };
  }

  /** Run the internal evaluator (the ingestion-run closing path). */
  async function evaluate(versionId: string, runId?: string) {
    const res = (await t.run(async (ctx) =>
      ctx.runMutation(internal.matterImpact.evaluateSourceUpdate, {
        stableKey: STABLE_KEY,
        newVersionId: versionId as never,
        runId: runId as never,
      }),
    )) as unknown as { alerted: number; withheldNote: string | null };
    return res;
  }

  it("alerts only opted-in anchored matters, dedupes re-runs, and preserves superseded alerts", async () => {
    const { ownerId, matterId, orgId } = await seedFirm(t);
    void orgId;
    const owner = asUser(t, ownerId);
    await seedAlertSource(1);

    // A rival's matter with the SAME anchor is never alerted.
    const rivalId = await asUser(t, "system").run(async (ctx) => {
      const uid = await ctx.db.insert("users", {
        email: "rival4@t16.test",
        emailVerified: true,
        isAnonymous: false,
        isPlatformAdmin: false,
      });
      const rOrg = await ctx.db.insert("organizations", {
        name: "Rival4 T16",
        slug: "rival4-t16",
        kind: "chamber" as const,
        currency: "INR",
        timezone: "Asia/Kolkata",
        financialYearStart: "04-01",
        taxLabel: "GST",
        taxPercent: 18,
        invoicePrefix: "INV",
        createdBy: uid as never,
        createdAt: Date.now(),
      });
      await ctx.db.insert("memberships", {
        orgId: rOrg,
        userId: uid as never,
        orgRole: "owner" as const,
        status: "active" as const,
        createdAt: Date.now(),
      });
      await ctx.db.patch(uid as never, { activeOrgId: rOrg });
      const rMatter = await ctx.db.insert("matters", {
        orgId: rOrg,
        clientId: (await ctx.db.insert("clients", {
          orgId: rOrg,
          kind: "company" as const,
          name: "Rival Client",
          createdBy: uid as never,
          createdAt: Date.now(),
        })) as never,
        reference: "R4/2026/0001",
        title: "Rival matter",
        practiceArea: "civil",
        status: "open" as const,
        legalProfile: {
          country: "in",
          impactAlerts: true,
          anchoredSourceKeys: [STABLE_KEY],
        },
        createdBy: uid as never,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      void rMatter;
      return uid;
    });

    // Nothing alerted for OUR matter yet — only the rival's opted-in,
    // anchored matter is alerted (its own org's alert, never ours).
    const v1 = await asUser(t, "system").run(async (ctx) => {
      const s = (await ctx.db.query("legalSources").collect()).find(
        (x) => x.stableKey === STABLE_KEY,
      );
      return String(s!.latestVersion!);
    });
    const none = await evaluate(v1);
    expect(none.alerted).toBe(1); // rival matter only

    // Give OUR matter a legal profile, then opt in AND anchor the source
    // (matter.edit path); the rival is already deduped at v1, so this
    // alert is OURS.
    await asUser(t, "system").run(async (ctx) =>
      ctx.db.patch(matterId as never, {
        legalProfile: { country: "in", proceduralStage: "trial" },
      }),
    );
    await owner.mutation(api.matterImpact.setOptIn, {
      matterId: matterId as never,
      enabled: true,
    });
    await owner.mutation(api.matterImpact.setAnchor, {
      matterId: matterId as never,
      stableKey: STABLE_KEY,
    });
    const first = await evaluate(v1);
    expect(first.alerted).toBe(1); // now OUR matter (rival deduped)

    // Idempotent: the SAME version never re-alerts.
    const again = await evaluate(v1);
    expect(again.alerted).toBe(0);

    const rows = await owner.query(api.matterImpact.list, {
      matterId: matterId as never,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("open");
    expect(rows[0]!.fromVersion).toBeUndefined();
    expect(rows[0]!.toVersion).toBe(1);
    expect(rows[0]!.reason).toContain(STABLE_KEY);
    expect(rows[0]!.coverageNote).toMatch(/does NOT mean the law has not moved/);

    // A NEWER version re-alerts and supersedes the open earlier alert —
    // the correction is never silent.
    const srcId2 = await asUser(t, "system").run(async (ctx) => {
      const s = (await ctx.db.query("legalSources").collect()).find(
        (x) => x.stableKey === STABLE_KEY,
      );
      return String(s!._id);
    });
    const v2 = await asUser(t, "system").run(async (ctx) =>
      ctx.db.insert("legalSourceVersions", {
        sourceId: srcId2 as never,
        version: 2,
        body: "Section 1 (v2, corrected): The limitation period shall be one hundred twenty days.",
        collectedAt: "2026-10-01",
        createdAt: Date.now(),
      }),
    );
    await asUser(t, "system").run(async (ctx) =>
      ctx.db.patch(srcId2 as never, { latestVersion: v2 as never }),
    );
    const second = await evaluate(String(v2));
    expect(second.alerted).toBe(2); // ours AND the rival's matter re-alert

    const after = await owner.query(api.matterImpact.list, {
      matterId: matterId as never,
    });
    expect(after).toHaveLength(2); // superseded stays visible
    const newest = after.find((r) => r.toVersion === 2)!;
    const oldest = after.find((r) => r.toVersion === 1)!;
    expect(newest!.status).toBe("open");
    expect(newest!.fromVersion).toBe(1);
    expect(oldest!.status).toBe("superseded"); // actions preserved, flagged

    // Cross-tenant: the rival cannot read OUR matter's alerts (empty) nor
    // act on them (acknowledge refused). Our owner still sees both rows.
    const rivalRows = await asUser(t, rivalId).query(api.matterImpact.list, {
      matterId: matterId as never,
    });
    expect(rivalRows).toEqual([]);
    await expect(
      asUser(t, rivalId).mutation(api.matterImpact.acknowledge, {
        alertId: newest!._id as never,
        note: "hostile org trying to acknowledge another chamber's alert",
      }),
    ).rejects.toThrow();
  });

  it("acknowledge/dismiss/assign record everything; task conversion reuses the propose→approve flow; unsupported treatment is withheld", async () => {
    const { ownerId, matterId } = await seedFirm(t);
    const owner = asUser(t, ownerId);
    const { srcId } = await seedAlertSource(3);
    await asUser(t, "system").run(async (ctx) =>
      ctx.db.patch(matterId as never, {
        legalProfile: { country: "in", proceduralStage: "trial" },
      }),
    );
    await owner.mutation(api.matterImpact.setOptIn, {
      matterId: matterId as never,
      enabled: true,
    });
    await owner.mutation(api.matterImpact.setAnchor, {
      matterId: matterId as never,
      stableKey: STABLE_KEY,
    });
    const latestVersion = await asUser(t, "system").run(async (ctx) => {
      const s = (await ctx.db.query("legalSources").collect()).find(
        (x) => x.stableKey === STABLE_KEY,
      );
      return String(s!.latestVersion!);
    });

    // An unsupported treatment label on the source: NO alerting event.
    await asUser(t, "system").run(async (ctx) =>
      ctx.db.patch(srcId as never, { treatment: "overruled" }),
    );
    const res = await evaluate(latestVersion);
    expect(res.alerted).toBe(1);
    expect(res.withheldNote).toMatch(/WITHOUT a supporting source/);
    expect(res.withheldNote).toMatch(/generated NO alert/);
    const [row] = await owner.query(api.matterImpact.list, {
      matterId: matterId as never,
    });
    expect(row!.treatment).toBeUndefined(); // withheld
    expect(row!.withheldTreatmentNote).toMatch(/generated NO alert/);

    // Acknowledge requires a real note.
    await expect(
      owner.mutation(api.matterImpact.acknowledge, {
        alertId: row!._id as never,
        note: "too short",
      }),
    ).rejects.toThrow(/at least 10 characters/);
    await expect(
      owner.mutation(api.matterImpact.acknowledge, {
        alertId: row!._id as never,
        note: "",
      }),
    ).rejects.toThrow();

    // This alert is CONVERTED to a task proposal instead of acknowledged.
    const conv = await owner.mutation(api.matterImpact.convertToTaskProposal, {
      alertId: row!._id as never,
    });
    const convRow = (await owner.query(api.matterImpact.list, {
      matterId: matterId as never,
      includeHandled: true,
    })).find((r) => r._id === row!._id)!;
    expect(convRow.status).toBe("converted_to_task");
    expect(convRow.taskSuggestionId).toBe(conv.suggestionId);

    // The proposal goes through the EXISTING approval flow → real task.
    const suggestions = await owner.query(api.taskSuggestions.list, {
      matterId: matterId as never,
    });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.title).toContain("Impact Test Act");
    expect(suggestions[0]!.rationale).toMatch(/ingested corpus only/); // coverage disclosure travels
    const approved = await owner.mutation(api.taskSuggestions.approve, {
      suggestionId: suggestions[0]!._id as never,
    });
    expect(approved.created).toBe(true);

    // Second alert: assign, then acknowledge with a proper note.
    const v4 = await asUser(t, "system").run(async (ctx) =>
      ctx.db.insert("legalSourceVersions", {
        sourceId: srcId as never,
        version: 4,
        body: "Section 1 (v4): The limitation period shall be one hundred eighty days.",
        collectedAt: "2026-10-02",
        createdAt: Date.now(),
      }),
    );
    await asUser(t, "system").run(async (ctx) =>
      ctx.db.patch(srcId as never, {
        latestVersion: v4 as never,
        treatment: "overruled",
        treatmentSourceKey: "in:judgment:supporting-impact-2026",
      }),
    );
    await evaluate(String(v4));
    const rows2 = await owner.query(api.matterImpact.list, {
      matterId: matterId as never,
    });
    const open4 = rows2.find((r) => r.status === "open")!;
    expect(open4.toVersion).toBe(4);
    // Treatment now SUPPORTED → surfaced with its source, not withheld.
    expect(open4.treatment).toBe("overruled");
    expect(open4.treatmentSourceKey).toBe("in:judgment:supporting-impact-2026");

    await owner.mutation(api.matterImpact.assign, {
      alertId: open4._id as never,
      assigneeId: ownerId as never,
    });
    await owner.mutation(api.matterImpact.acknowledge, {
      alertId: open4._id as never,
      note: "Read v4 in full; limitation position restated in our draft defence.",
    });
    const handled = (await owner.query(api.matterImpact.list, {
      matterId: matterId as never,
      includeHandled: true,
    })).find((r) => r._id === open4._id)!;
    expect(handled.status).toBe("acknowledged");
    expect(handled.acknowledgedById).toBeDefined();
    expect(handled.acknowledgedNote).toContain("limitation position");

    // Third alert: dismissed with a recorded reason (never deleted).
    const v5 = await asUser(t, "system").run(async (ctx) =>
      ctx.db.insert("legalSourceVersions", {
        sourceId: srcId as never,
        version: 5,
        body: "Section 1 (v5): Editorial consolidation only; no substantive change.",
        collectedAt: "2026-10-03",
        createdAt: Date.now(),
      }),
    );
    await asUser(t, "system").run(async (ctx) =>
      ctx.db.patch(srcId as never, { latestVersion: v5 as never }),
    );
    await evaluate(String(v5));
    const rows3 = await owner.query(api.matterImpact.list, {
      matterId: matterId as never,
    });
    const open5 = rows3.find((r) => r.status === "open")!;
    await expect(
      owner.mutation(api.matterImpact.dismiss, {
        alertId: open5._id as never,
        reason: "short",
      }),
    ).rejects.toThrow(/at least 10 characters/);
    await owner.mutation(api.matterImpact.dismiss, {
      alertId: open5._id as never,
      reason: "Editorial consolidation only — no substantive change to our position.",
    });
    const dismissed = (await owner.query(api.matterImpact.list, {
      matterId: matterId as never,
      includeHandled: true,
    })).find((r) => r._id === open5._id)!;
    expect(dismissed.status).toBe("dismissed");
    expect(dismissed.dismissedReason).toContain("Editorial consolidation");
  });

  it("opt-in is refused without a confirmed legal profile and ingest paths drive alerts end-to-end", async () => {
    const { ownerId, matterId } = await seedFirm(t);
    const owner = asUser(t, ownerId);
    await seedAlertSource(1);

    // No legalProfile on the matter yet → opt-in refused with guidance.
    await expect(
      owner.mutation(api.matterImpact.setOptIn, {
        matterId: matterId as never,
        enabled: true,
      }),
    ).rejects.toThrow(/legal profile first/);
    await expect(
      owner.mutation(api.matterImpact.setAnchor, {
        matterId: matterId as never,
        stableKey: STABLE_KEY,
      }),
    ).rejects.toThrow(/legal profile first/);

    // Give the matter a profile (raw patch — the profile-editing flow is
    // the existing legalIntel profile path), then opt in and anchor.
    await asUser(t, "system").run(async (ctx) =>
      ctx.db.patch(matterId as never, {
        legalProfile: {
          country: "in",
          proceduralStage: "trial",
        },
      }),
    );
    await owner.mutation(api.matterImpact.setOptIn, {
      matterId: matterId as never,
      enabled: true,
    });
    await owner.mutation(api.matterImpact.setAnchor, {
      matterId: matterId as never,
      stableKey: STABLE_KEY,
    });

    // The BROWSER ingest path (operator-gated) drives the evaluator.
    // Identity convention: the subject IS the seeded user-row id.
    const operatorId = await asUser(t, "system").run(async (ctx) =>
      ctx.db.insert("users", {
        email: "operator@t16.test",
        emailVerified: true,
        isAnonymous: false,
        isPlatformAdmin: true,
      }),
    );
    const ing = await asUser(t, operatorId).mutation(
      api.legalIntel.ingestSourceText,
      {
        stableKey: STABLE_KEY,
        body: "Section 1 (v2 via ingestSourceText): The limitation period shall be one hundred twenty days.",
      },
    );
    expect(ing.version).toBe(2);
    const rows = await owner.query(api.matterImpact.list, {
      matterId: matterId as never,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.toVersion).toBe(2);
    expect(rows[0]!.runId).toBeUndefined(); // browser path has no run row
    void ownerId;
  });
});

describe("Turn 16 — Phase 5 filing-readiness workspace", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  it("versioned drafts, deterministic checks, separate suggestions with lawyer approval, freeze + invalidation", async () => {
    const { ownerId, matterId, orgId } = await seedFirm(t);
    void orgId;
    const owner = asUser(t, ownerId);

    // Seed one matter document via the REAL attach path (also proves the
    // invalidation hook doesn't crash on a fresh matter).
    const docId = (
      await owner.mutation(api.matters.attachDocument, {
        matterId: matterId as never,
        name: "Plaint copy",
        kind: "document" as const,
        visibility: "internal" as const,
      })
    ).documentId;

    const draft1 = await owner.mutation(api.filingReadiness.createDraft, {
      matterId: matterId as never,
    });
    expect(draft1.version).toBe(1);

    // A second draft is refused while one is open.
    await expect(
      owner.mutation(api.filingReadiness.createDraft, { matterId: matterId as never }),
    ).rejects.toThrow(/already exists/);

    // Deterministic checks BEFORE any work: items incomplete, court
    // metadata missing.
    const checks1 = await owner.query(api.filingReadiness.deterministicChecks, {
      checklistId: draft1.checklistId as never,
    });
    const byKey = (k: string) => checks1!.checks.find((c) => c.key === k)!;
    expect(byKey("items_complete").status).toBe("attention");
    expect(byKey("court_metadata").status).toBe("attention");
    expect(checks1!.disclaimer).toMatch(/NOT an acceptance guarantee/);

    // Deterministic suggestions (labelled as derived) → apply one.
    const proposed = await owner.mutation(api.filingReadiness.proposeSuggestions, {
      checklistId: draft1.checklistId as never,
    });
    expect(proposed.created).toBeGreaterThanOrEqual(2); // court_metadata + profile_dates
    const suggestions = await owner.query(api.filingReadiness.listSuggestions, {
      checklistId: draft1.checklistId as never,
    });
    const courtSug = suggestions.find((s) => s.key === "court_metadata")!;
    expect(courtSug!.basis).toMatch(/Derived from/);
    await owner.mutation(api.filingReadiness.applySuggestion, {
      suggestionId: courtSug!._id as never,
    });

    // The applied suggestion became a REAL not-satisfied item.
    const draft1After = await owner.query(api.filingReadiness.get, {
      checklistId: draft1.checklistId as never,
    });
    expect(draft1After!.items.some((i) => i.key === "court_metadata")).toBe(true);

    // Record the plaint item as satisfied; the applied suggestion's item
    // stays not_satisfied for now.
    await owner.mutation(api.filingReadiness.setItem, {
      checklistId: draft1.checklistId as never,
      key: "plaint_copy",
      requirement: "Certified copy of the plaint on record.",
      itemStatus: "satisfied",
      documentId: docId as never,
      note: "Original filed at intake.",
    });

    // Approval is refused while anything is still not satisfied.
    await expect(
      owner.mutation(api.filingReadiness.approveReady, {
        checklistId: draft1.checklistId as never,
      }),
    ).rejects.toThrow(/remain not satisfied/);

    // Then record court metadata as satisfied.
    await owner.mutation(api.filingReadiness.setItem, {
      checklistId: draft1.checklistId as never,
      key: "court_metadata",
      requirement: "Court, case number and year recorded.",
      itemStatus: "satisfied",
      note: "City Civil Court, Suit 1234/2026 — re-verified.",
    });

    const approval = await owner.mutation(api.filingReadiness.approveReady, {
      checklistId: draft1.checklistId as never,
    });
    expect(approval.approved).toBe(true);
    expect(approval.disclaimer).toMatch(/NOT an acceptance guarantee/);
    const approvedRow = await owner.query(api.filingReadiness.get, {
      checklistId: draft1.checklistId as never,
    });
    expect(approvedRow!.status).toBe("approved_ready");
    expect(approvedRow!.staleness).toBe("current");

    // Approval FREEZES: item edits are refused.
    await expect(
      owner.mutation(api.filingReadiness.setItem, {
        checklistId: draft1.checklistId as never,
        key: "plaint_copy",
        requirement: "x",
        itemStatus: "not_applicable",
      }),
    ).rejects.toThrow(/frozen/);

    // A NEW DOCUMENT arrives → approval is INVALIDATED automatically.
    await owner.mutation(api.matters.attachDocument, {
      matterId: matterId as never,
      name: "Additional affidavit",
      kind: "document" as const,
      visibility: "internal" as const,
    });
    const invalidated = await owner.query(api.filingReadiness.get, {
      checklistId: draft1.checklistId as never,
    });
    expect(invalidated!.status).toBe("invalidated");
    expect(invalidated!.invalidation!.because).toBe("document_added");

    // Version 2 starts fresh; history shows the frozen v1.
    const draft2 = await owner.mutation(api.filingReadiness.createDraft, {
      matterId: matterId as never,
    });
    expect(draft2.version).toBe(2);
    const versions = await owner.query(api.filingReadiness.listVersions, {
      matterId: matterId as never,
    });
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    const v1row = versions.find((v) => v.version === 1)!;
    expect(v1row.status).toBe("invalidated"); // preserved, never reopened
    expect(v1row.items.length).toBe(2); // the record survives
  });

  it("suggestion dismissal records reason; cross-tenant access refused", async () => {
    const { ownerId, matterId } = await seedFirm(t);
    const owner = asUser(t, ownerId);
    const draft = await owner.mutation(api.filingReadiness.createDraft, {
      matterId: matterId as never,
    });
    await owner.mutation(api.filingReadiness.proposeSuggestions, {
      checklistId: draft.checklistId as never,
    });
    const suggestions = await owner.query(api.filingReadiness.listSuggestions, {
      checklistId: draft.checklistId as never,
    });
    const profileSug = suggestions.find((s) => s.key === "profile_dates")!;
    await owner.mutation(api.filingReadiness.dismissSuggestion, {
      suggestionId: profileSug!._id as never,
      reason: "Dates are tracked outside Advokate for this matter.",
    });
    const after = await owner.query(api.filingReadiness.listSuggestions, {
      checklistId: draft.checklistId as never,
    });
    const dismissedRow = after.find((s) => s.key === "profile_dates")!;
    expect(dismissedRow.status).toBe("dismissed");
    expect(dismissedRow.dismissedReason).toContain("outside Advokate");

    // Rival org: reads return null/empty and mutations are refused.
    const rivalId = await asUser(t, "system").run(async (ctx) => {
      const uid = await ctx.db.insert("users", {
        email: "rival5@t16.test",
        emailVerified: true,
        isAnonymous: false,
        isPlatformAdmin: false,
      });
      const rOrg = await ctx.db.insert("organizations", {
        name: "Rival5 T16",
        slug: "rival5-t16",
        kind: "chamber" as const,
        currency: "INR",
        timezone: "Asia/Kolkata",
        financialYearStart: "04-01",
        taxLabel: "GST",
        taxPercent: 18,
        invoicePrefix: "INV",
        createdBy: uid as never,
        createdAt: Date.now(),
      });
      await ctx.db.insert("memberships", {
        orgId: rOrg,
        userId: uid as never,
        orgRole: "owner" as const,
        status: "active" as const,
        createdAt: Date.now(),
      });
      await ctx.db.patch(uid as never, { activeOrgId: rOrg });
      return uid;
    });
    const rival = asUser(t, rivalId);
    expect(
      await rival.query(api.filingReadiness.get, {
        checklistId: draft.checklistId as never,
      }),
    ).toBeNull();
    expect(
      await rival.query(api.filingReadiness.listVersions, {
        matterId: matterId as never,
      }),
    ).toEqual([]);
    await expect(
      rival.mutation(api.filingReadiness.createDraft, { matterId: matterId as never }),
    ).rejects.toThrow();
    await expect(
      rival.mutation(api.filingReadiness.setItem, {
        checklistId: draft.checklistId as never,
        key: "x",
        requirement: "y",
        itemStatus: "satisfied",
      }),
    ).rejects.toThrow();
    void ownerId;
  });
});
