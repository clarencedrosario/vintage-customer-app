import { describe, expect, it, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

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
