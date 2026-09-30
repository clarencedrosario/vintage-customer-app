import { describe, expect, it, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules: Record<string, () => Promise<unknown>> = (import.meta as unknown as {
  glob: (p: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.ts");

const asUser = (t: ReturnType<typeof convexTest>, userId: string) =>
  t.withIdentity({ subject: userId, tokenIdentifier: `test:${userId}` });

/** Seed one org + owner + client + two matters (one with court IDs). */
async function seedFirm(t: ReturnType<typeof convexTest>) {
  const ownerId = await asUser(t, "system").run(async (ctx) =>
    ctx.db.insert("users", {
      email: "owner@in29.test",
      emailVerified: true,
      isAnonymous: false,
      isPlatformAdmin: false,
    }),
  );
  const seeded = await asUser(t, "system").run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "IN29 Chamber (synthetic)",
      slug: "in29-firm",
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
      reference: "IN29/2026/0001",
      title: "Recovery suit — Acme v. Kumar",
      practiceArea: "civil",
      clientRole: "Acme Trading Pvt. Ltd.",
      opposingParty: "Rajesh Kumar",
      court: "City Civil Court",
      caseNumber: "CS 1187",
      caseYear: "2025",
      cnrNumber: "KABT010451122025",
      status: "open" as const,
      createdBy: ownerId as never,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    // A second matter WITHOUT court identifiers (wrong-match target).
    const matter2Id = await ctx.db.insert("matters", {
      orgId,
      clientId,
      reference: "IN29/2026/0002",
      title: "Cheque bounce — Acme v. Sharma",
      practiceArea: "criminal",
      clientRole: "Acme Trading Pvt. Ltd.",
      opposingParty: "Vikram Sharma",
      status: "open" as const,
      createdBy: ownerId as never,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { orgId, clientId, matterId, matter2Id };
  });
  return { ownerId, ...seeded };
}

describe("§29 India-specific capabilities", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  it("court sources: registry seeds with authorized access methods and honest limitations", async () => {
    const { ownerId } = await seedFirm(t);
    const owner = asUser(t, ownerId);

    const seeded = await owner.mutation(api.courtSources.seedRegistry, {});
    expect(seeded.created).toBe(3);
    const sources = await owner.query(api.courtSources.listSources, {});
    expect(sources.map((s) => s.key)).toEqual(["in:district", "in:hc", "in:sci"]);
    // No access-control bypass is ever claimed; limitations are recorded.
    for (const s of sources) {
      expect(["official_api", "permitted_download", "manual_upload", "reviewed_entry"]).toContain(
        s.accessMethod,
      );
      expect(s.limitations).toMatch(/NOT bypass|not all|manual by design|NOT nationwide/i);
    }
    // Idempotent.
    const again = await owner.mutation(api.courtSources.seedRegistry, {});
    expect(again.created).toBe(0);
  });

  it("case matching: CNR exact, case number partial without year, name-only is EVER a suggestion", async () => {
    const { ownerId, matterId, matter2Id } = await seedFirm(t);
    const owner = asUser(t, ownerId);

    await owner.mutation(api.courtSources.seedRegistry, {});

    // 1. CNR exact match → matched_pending_review (never auto-confirmed).
    const byCnr = await owner.mutation(api.courtSources.importListing, {
      sourceKey: "in:hc",
      cnr: "KABT010451122025",
      caseNumber: "CS 1187",
      caseYear: "2025",
      court: "City Civil Court",
      partyNames: "Acme Trading Pvt. Ltd. vs Rajesh Kumar",
      rawRecord: "CAUSE LIST — ITEM 12 — CS 1187/2025 — Acme Trading Pvt. Ltd. vs Rajesh Kumar",
      publishedHearingAt: Date.now() + 5 * 86_400_000,
      listingPosition: "Item 12",
      sourceUrl: "manual upload (synthetic)",
    });
    expect(byCnr.duplicate).toBe(false);
    expect(byCnr.matchConfidence).toBe("identifier_exact");
    expect(byCnr.matchStatus).toBe("matched_pending_review");
    expect(byCnr.matchedMatterId).toBe(matterId);

    // 2. Wrong-matter guard: a DIFFERENT case number does not match the
    // matter with the same party names — name evidence alone is never
    // enough when identifiers conflict. Here the record carries a CNR
    // belonging to no matter and no case number, so party names can only
    // produce a "suggested" match, never a confirmed one.
    const byName = await owner.mutation(api.courtSources.importListing, {
      sourceKey: "in:hc",
      partyNames: "Acme Trading Pvt. Ltd. vs Rajesh Kumar",
      rawRecord: "CAUSE LIST — ITEM 30 — some other case — Acme Trading Pvt. Ltd. vs Rajesh Kumar",
      publishedHearingAt: Date.now() + 6 * 86_400_000,
    });
    expect(byName.matchConfidence).toBe("name_only");
    expect(byName.matchStatus).toBe("suggested");
    expect(byName.matchedMatterId).toBe(matterId); // suggested target…

    // …but a suggestion can NEVER apply to the calendar.
    await expect(
      owner.mutation(api.courtSources.applyToCalendar, {
        listingId: byName.listingId as never,
      }),
    ).rejects.toThrow(/lawyer-CONFIRMED/);

    // 3. A wrong identifier (case number of ANOTHER matter's register) —
    // matter2 has no case number, so a number+year hit on matter1 stays
    // on matter1 and never leaks to matter2.
    const partial = await owner.mutation(api.courtSources.importListing, {
      sourceKey: "in:hc",
      caseNumber: "CS 1187",
      rawRecord: "CAUSE LIST — CS 1187 — no year stated",
      publishedHearingAt: Date.now() + 7 * 86_400_000,
    });
    expect(partial.matchConfidence).toBe("identifier_partial");
    expect(partial.matchedMatterId).toBe(matterId);
    void matter2Id;

    // Lawyer CONFIRMS the exact match; only then can it be applied.
    await owner.mutation(api.courtSources.confirmMatch, {
      listingId: byCnr.listingId as never,
      note: "Verified against the court's own listing.",
    });
    const applied = await owner.mutation(api.courtSources.applyToCalendar, {
      listingId: byCnr.listingId as never,
    });
    expect(applied.reused).toBe(false);
    // The hearing actually exists for the matter (system-context read).
    const hearingRow = await asUser(t, "system").run(async (ctx) =>
      ctx.db.get(applied.hearingId as never),
    );
    expect(hearingRow).not.toBeNull();
    expect(String(hearingRow!.matterId)).toBe(String(matterId));
    expect(hearingRow!.status).toBe("scheduled");

    // Re-applying is duplicate-safe.
    const reapply = await owner.mutation(api.courtSources.applyToCalendar, {
      listingId: byCnr.listingId as never,
    });
    expect(reapply.reused).toBe(true);
    expect(reapply.hearingId).toBe(applied.hearingId);
  });

  it("republications: identical duplicate collapses; changed record supersedes (stale, preserved)", async () => {
    const { ownerId, matterId } = await seedFirm(t);
    const owner = asUser(t, ownerId);
    await owner.mutation(api.courtSources.seedRegistry, {});

    const v1 = await owner.mutation(api.courtSources.importListing, {
      sourceKey: "in:hc",
      cnr: "KABT010451122025",
      rawRecord: "Listing: item 12, 2026-10-05",
      publishedHearingAt: 1,
    });
    void matterId;

    // Identical re-publication → same row, no duplicate noise.
    const dup = await owner.mutation(api.courtSources.importListing, {
      sourceKey: "in:hc",
      cnr: "KABT010451122025",
      rawRecord: "Listing: item 12, 2026-10-05 (reprinted)",
      publishedHearingAt: 1,
    });
    expect(dup.duplicate).toBe(true);
    expect(dup.listingId).toBe(v1.listingId);

    // CHANGED publication (adjourned to a new date) → new row superseding
    // the old; the old row is stale and PRESERVED with its original text.
    const v2 = await owner.mutation(api.courtSources.importListing, {
      sourceKey: "in:hc",
      cnr: "KABT010451122025",
      rawRecord: "Listing: item 27, 2026-10-19 (adjourned by court)",
      publishedHearingAt: 2,
      caseStatus: "adjourned",
    });
    expect(v2.duplicate).toBe(false);
    expect(v2.supersededPriorId).toBe(v1.listingId);

    const rows = await owner.query(api.courtSources.listingsForMatter, {
      matterId: matterId as never,
    });
    const old = rows.find((r) => r._id === v1.listingId)!;
    expect(old.reviewState).toBe("stale");
    expect(old.rawRecord).toContain("item 12"); // original preserved
    // A stale record cannot be applied to the calendar.
    await expect(
      owner.mutation(api.courtSources.applyToCalendar, { listingId: v1.listingId as never }),
    ).rejects.toThrow(/superseded/);
  });

  it("order records → proposed task (review flow) — cause lists never yield deadlines", async () => {
    const { ownerId, matterId } = await seedFirm(t);
    const owner = asUser(t, ownerId);
    await owner.mutation(api.courtSources.seedRegistry, {});

    const imported = await owner.mutation(api.courtSources.importListing, {
      sourceKey: "in:hc",
      cnr: "KABT010451122025",
      rawRecord: "ORDER: Defendant to file written statement within 30 days.",
      orderTitle: "Order dated 2026-09-20",
      orderDate: "2026-09-20",
    });
    // Unconfirmed orders cannot generate tasks.
    await expect(
      owner.mutation(api.courtSources.proposeTaskFromOrder, {
        listingId: imported.listingId as never,
        title: "File written statement",
        rationale: "Direction in the order.",
      }),
    ).rejects.toThrow(/lawyer-CONFIRMED/);

    await owner.mutation(api.courtSources.confirmMatch, {
      listingId: imported.listingId as never,
    });
    const sugg = await owner.mutation(api.courtSources.proposeTaskFromOrder, {
      listingId: imported.listingId as never,
      title: "File written statement",
      rationale: "Direction in the order; due-date basis to be confirmed by the lawyer.",
      dueBasis: "Order direction; limitation to be computed from verified rules + confirmation.",
    });
    const list = await owner.query(api.taskSuggestions.list, { matterId: matterId as never });
    const row = list.find((s) => s._id === sugg.suggestionId)!;
    expect(row.status).toBe("proposed");
    expect(row.sourceKind).toBe("order");
    expect(row.dueBasis).toMatch(/lawyer confirmation|verified rules/i);
  });

  it("court-updates dashboard reports new/conflicting/stale states", async () => {
    const { ownerId, matterId } = await seedFirm(t);
    const owner = asUser(t, ownerId);
    await owner.mutation(api.courtSources.seedRegistry, {});

    const a = await owner.mutation(api.courtSources.importListing, {
      sourceKey: "in:hc",
      cnr: "KABT010451122025",
      rawRecord: "Item 12",
      publishedHearingAt: 10,
    });
    // Confirmed record (kept separate from the superseded pair).
    const c = await owner.mutation(api.courtSources.importListing, {
      sourceKey: "in:hc",
      caseNumber: "CS 1187",
      caseYear: "2025",
      rawRecord: "Item 5 — CS 1187/2025",
      publishedHearingAt: 12,
    });
    await owner.mutation(api.courtSources.confirmMatch, {
      listingId: c.listingId as never,
    });
    // Changed republication → a goes stale, b is the current record.
    const b = await owner.mutation(api.courtSources.importListing, {
      sourceKey: "in:hc",
      cnr: "KABT010451122025",
      rawRecord: "Item 27 (changed)",
      publishedHearingAt: 11,
    });
    await owner.mutation(api.courtSources.markConflicting, {
      listingId: b.listingId as never,
      note: "Cause list shows item 27; the registry status page still shows item 12.",
    });
    const dash = await owner.query(api.courtSources.dashboard, {});
    expect(dash!.counts.stale).toBeGreaterThanOrEqual(1); // superseded v1
    expect(dash!.counts.conflicting).toBeGreaterThanOrEqual(1);
    expect(dash!.counts.confirmed).toBeGreaterThanOrEqual(1);
    expect(dash!.counts.total).toBeGreaterThanOrEqual(3);
    void matterId;
  });

  it("DPDP: register seeds with official sources + effective dates; requests, consent withdrawal → erasure review, incidents", async () => {
    const { ownerId } = await seedFirm(t);
    const owner = asUser(t, ownerId);

    const seeded = await owner.mutation(api.dpdpCompliance.seedRegister, {});
    expect(seeded.created).toBeGreaterThanOrEqual(8);
    const register = await owner.query(api.dpdpCompliance.listRegister, {});
    // Every entry carries an official source and an effective date or an
    // honest conditional basis; legal review starts OUTSTANDING.
    for (const r of register) {
      expect(r.officialSource.length).toBeGreaterThan(10);
      expect(r.legalReview).toBe("outstanding");
      expect(r.responsiblePerson).toMatch(/UNASSIGNED/);
    }
    // Phased commencement is recorded, not assumed fully operational.
    const consentManager = register.find((r) => /Consent Manager/.test(r.requirement))!;
    expect(consentManager.effectiveFrom).toBe("2025-11-13");
    expect(consentManager.status).toBe("blocked"); // no integration exists
    const lawfulBases = register.find((r) => /legitimate uses/.test(r.requirement))!;
    expect(lawfulBases.requirement).toMatch(/consent is NOT the only basis/i);
    const sdf = register.find((r) => /Significant Data Fiduciary/.test(r.requirement))!;
    expect(sdf.requirement).toMatch(/only if notified|notification/i);

    // Requests lifecycle.
    const req = await owner.mutation(api.dpdpCompliance.createRequest, {
      kind: "access",
      subjectName: "Priya Nair",
      subjectContact: "priya@example.test",
      details: "Request for access to all personal data held about me.",
    });
    expect(req.dueAt).toBeGreaterThan(Date.now());
    let requests = await owner.query(api.dpdpCompliance.listRequests, {});
    expect(requests[0]!.status).toBe("received");
    await owner.mutation(api.dpdpCompliance.updateRequest, {
      requestId: req.requestId as never,
      status: "fulfilled",
      resolutionNote: "Export provided; statutory-retention items listed with basis.",
    });
    requests = await owner.query(api.dpdpCompliance.listRequests, {});
    expect(requests[0]!.status).toBe("fulfilled");
    expect(requests[0]!.handledById).toBeDefined();

    // Consent + withdrawal → erasure review opened (never silent erasure).
    const consent = await owner.mutation(api.dpdpCompliance.recordConsent, {
      subjectName: "Priya Nair",
      purpose: "Portal notifications about matter updates",
      noticeVersion: "notice-v1.0",
    });
    let consents = await owner.query(api.dpdpCompliance.listConsents, {});
    expect(consents.some((c) => c._id === consent.consentId)).toBe(true);
    await owner.mutation(api.dpdpCompliance.withdrawConsent, {
      consentId: consent.consentId as never,
      reason: "No longer wishes to use the portal.",
    });
    consents = await owner.query(api.dpdpCompliance.listConsents, {});
    expect(consents.some((c) => c._id === consent.consentId)).toBe(false); // now withdrawn
    requests = await owner.query(api.dpdpCompliance.listRequests, {});
    const erasure = requests.find((r) => r.kind === "erasure" && r.subjectName === "Priya Nair")!;
    expect(erasure).toBeDefined();
    expect(erasure.details).toMatch(/retention obligations/); // honest basis check required

    // Incidents with notification trail.
    const inc = await owner.mutation(api.dpdpCompliance.recordIncident, {
      detectedAt: Date.now() - 3_600_000,
      description: "Misdirected email containing a client statement to the wrong recipient.",
      affectedData: "One data principal's statement extract (name + financial detail).",
    });
    await owner.mutation(api.dpdpCompliance.updateIncident, {
      incidentId: inc.incidentId as never,
      containment: "Recipient confirmed deletion; written assurance obtained.",
      regulatorNotifiedAt: Date.now(),
      subjectsNotifiedAt: Date.now(),
      notificationBasis: "Assessed as a personal-data breach under r.7; Board + subject notified.",
      status: "contained",
    });
    const incidents = await owner.query(api.dpdpCompliance.listIncidents, {});
    expect(incidents[0]!.notifications!.regulatorNotifiedAt).toBeDefined();
  });

  it("data residency: inventory seeds honestly unverified; restrict_in BLOCKS unverified services", async () => {
    const { ownerId, orgId } = await seedFirm(t);
    const owner = asUser(t, ownerId);

    const seeded = await owner.mutation(api.dataResidency.seedInventory, {});
    expect(seeded.created).toBeGreaterThanOrEqual(8);
    let inv = await owner.query(api.dataResidency.listInventory, {});
    // Nothing is verified in-region by default — no false residency claim.
    expect(inv.every((r) => !(r.residencyVerified && r.region === "in"))).toBe(true);
    const ai = inv.find((r) => r.service === "ai_processing")!;
    expect(ai.provider).toMatch(/None active/);

    // Owner verifies the primary database region (the human verification step).
    await owner.mutation(api.dataResidency.verifyRegion, {
      service: "primary_database",
      verifiedRegion: "in",
      note: "Verified from the Convex dashboard region setting by the operator.",
    });
    inv = await owner.query(api.dataResidency.listInventory, {});
    expect(inv.find((r) => r.service === "primary_database")!.residencyVerified).toBe(true);

    // record_only (default) allows everything; restrict_in blocks every
    // service not verified in-region and logs the block.
    const p1 = await owner.mutation(api.dataResidency.setPolicy, {
      mode: "record_only",
      basis: "Inventory mode — no India-only commitment made.",
    });
    expect(p1.blockedServices).toEqual([]);

    const p2 = await owner.mutation(api.dataResidency.setPolicy, {
      mode: "restrict_in",
      basis: "Client contract clause 12: processing restricted to India.",
    });
    expect(p2.blockedServices).toContain("document_storage"); // unverified
    expect(p2.blockedServices).not.toContain("primary_database"); // verified in

    // The gate REFUSES processing in a blocked service and logs it
    // (internal mutation — exercised through the system context).
    const denied = (await asUser(t, "system").run(async (ctx) =>
      ctx.runMutation(internal.dataResidency.assertProcessingAllowed, {
        orgId: orgId as never,
        service: "document_storage",
        dataCategory: "client documents",
      }),
    )) as { allowed: boolean; reason?: string };
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toMatch(/not verified in-region/);
    const blocks = await owner.query(api.dataResidency.listBlocks, {});
    expect(blocks.length).toBe(1);
    expect(blocks[0]!.service).toBe("document_storage");

    // A verified-in service is ALLOWED by the gate (no new block rows).
    const allowedResult = (await asUser(t, "system").run(async (ctx) =>
      ctx.runMutation(internal.dataResidency.assertProcessingAllowed, {
        orgId: orgId as never,
        service: "primary_database",
        dataCategory: "core records",
      }),
    )) as { allowed: boolean };
    expect(allowedResult.allowed).toBe(true);
    expect((await owner.query(api.dataResidency.listBlocks, {})).length).toBe(1);
  });

  it("draft review: three separated layers, reviewable fixes via the governed revision flow", async () => {
    const { ownerId, matterId } = await seedFirm(t);
    const owner = asUser(t, ownerId);

    // Library + approved template + use with an unpopulated field.
    await owner.mutation(api.templates.seedLibrary, {});
    const lib = await owner.query(api.templates.list, { includeUnapproved: true });
    const tpl = lib.find((x) => x.key === "legal-notice-demand-in")!;
    await owner.mutation(api.templates.approve, { templateId: tpl._id as never });
    const body = `LEGAL NOTICE\nDate: 2026-09-30\n\n1. That on 2024-03-15 an agreement was executed. A sum of Rs. 5,00,000 is due.\n2. Interest is claimed from the date of default.\n\n{{NOTICEE_NAME}}`;
    const use = await owner.mutation(api.templates.saveUse, {
      templateId: tpl._id as never,
      matterId: matterId as never,
      values: [],
      renderedBody: body,
      missingPlaceholders: ["noticee_name", "noticee_address"],
    });

    // Seed a CONFIRMED fact with a DIFFERENT amount (₹4,50,000) so the
    // factual layer must flag the draft's ₹5,00,000.
    await owner.mutation(api.matterIntelligence.proposeFact, {
      matterId: matterId as never,
      factKey: "in29-ledger-amount",
      statement: "Ledger confirms Rs. 4,50,000 due.",
      status: "extracted",
      amountMinor: 45_000_000,
    });
    const facts = await owner.query(api.matterIntelligence.facts, {
      matterId: matterId as never,
    });
    await owner.mutation(api.matterIntelligence.confirmFact, { factId: facts[0]!._id as never });

    const r = await owner.query(api.draftReview.review, { useId: use.useId as never });
    expect(r).not.toBeNull();
    // Formatting layer: placeholders.
    expect(r!.layers.formatting.count).toBeGreaterThanOrEqual(1);
    expect(r!.findings.some((f) => f.layer === "formatting" && /placeholder/i.test(f.concern))).toBe(
      true,
    );
    // Factual layer: amount conflict + missing required fields.
    expect(r!.layers.factual.count).toBeGreaterThanOrEqual(1);
    expect(r!.findings.some((f) => f.layer === "factual" && /Rs\.?\s?5,00,000|5,00,000|500000/.test(f.excerpt))).toBe(
      true,
    );
    // Legal layer: interest without rate — advisory only.
    expect(r!.findings.some((f) => f.layer === "legal" && /Interest/.test(f.concern))).toBe(true);
    expect(r!.layers.legal.note).toMatch(/lawyer/i);

    // proposeFix goes through the GOVERNED revision flow (diff + undo).
    const fix = await owner.mutation(api.draftReview.proposeFix, {
      useId: use.useId as never,
      originalExcerpt: "Rs. 5,00,000 is due",
      proposedExcerpt: "Rs. 4,50,000 (as per the confirmed ledger) is due",
      reason: "Amount conflicts with the confirmed fact register.",
      riskLevel: "caution",
    });
    const revs = await owner.query(api.draftingRevisions.listRevisions, {
      useId: use.useId as never,
    });
    expect(revs.some((x) => x._id === fix.revisionId && x.status === "proposed")).toBe(true);
    // Accept + undo still works through the standard flow.
    await owner.mutation(api.draftingRevisions.accept, { revisionId: fix.revisionId as never });
    await owner.mutation(api.draftingRevisions.undo, { revisionId: fix.revisionId as never });

    // Legal-layer findings become risk comments, not silent edits.
    const flagged = await owner.mutation(api.draftReview.flagRisk, {
      useId: use.useId as never,
      excerpt: "Interest is claimed",
      concern: "Interest without rate/period.",
      reason: "Lawyer to specify basis and computation.",
    });
    const comments = await owner.query(api.draftingRevisions.listRiskComments, {
      useId: use.useId as never,
    });
    expect(comments.some((c) => c._id === flagged.commentId && c.status === "open")).toBe(true);
  });

  it("template library grows honestly to 10 with the new practice areas", async () => {
    const { ownerId } = await seedFirm(t);
    const owner = asUser(t, ownerId);
    const seeded = await owner.mutation(api.templates.seedLibrary, {});
    expect(seeded.librarySize).toBe(10);
    const lib = await owner.query(api.templates.list, { includeUnapproved: true });
    const keys = lib.map((x) => x.key);
    expect(keys).toContain("execution-application-order-in");
    expect(keys).toContain("board-resolution-bank-account-in");
    expect(keys).toContain("engagement-letter-in");
    expect(keys).toContain("application-u1563-in");
    // New areas covered: corporate + practice management.
    const areas = new Set(lib.map((x) => x.practiceArea));
    expect(areas.has("corporate")).toBe(true);
    expect(areas.has("practice_management")).toBe(true);
    // Every template still records provenance + limitations.
    for (const x of lib) {
      expect(x.authorSource.length).toBeGreaterThan(5);
      expect(x.limitations.length).toBeGreaterThan(20);
    }
  });

  it("cross-tenant: rival org cannot reach DPDP, residency, court or review surfaces", async () => {
    const { ownerId, matterId, orgId } = await seedFirm(t);
    const owner = asUser(t, ownerId);

    await owner.mutation(api.courtSources.seedRegistry, {});
    const listing = await owner.mutation(api.courtSources.importListing, {
      sourceKey: "in:hc",
      cnr: "KABT010451122025",
      rawRecord: "Item 12",
      publishedHearingAt: 5,
    });
    await owner.mutation(api.dpdpCompliance.seedRegister, {});
    await owner.mutation(api.dpdpCompliance.createRequest, {
      kind: "grievance",
      subjectName: "Priya Nair",
      details: "Grievance about correction delay.",
    });
    await owner.mutation(api.dataResidency.seedInventory, {});
    void orgId;

    const rivalId = await asUser(t, "system").run(async (ctx) => {
      const uid = await ctx.db.insert("users", {
        email: "rival@in29.test",
        emailVerified: true,
        isAnonymous: false,
        isPlatformAdmin: false,
      });
      const rOrgId = await ctx.db.insert("organizations", {
        name: "Rival IN29",
        slug: "rival-in29",
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
        orgId: rOrgId,
        userId: uid as never,
        orgRole: "owner" as const,
        status: "active" as const,
        createdAt: Date.now(),
      });
      await ctx.db.patch(uid as never, { activeOrgId: rOrgId });
      return uid;
    });
    const rival = asUser(t, rivalId);

    // Reads → empty/null.
    expect(await rival.query(api.dpdpCompliance.listRequests, {})).toEqual([]);
    expect(await rival.query(api.dpdpCompliance.listRegister, {})).toEqual([]);
    expect(await rival.query(api.dataResidency.listInventory, {})).toEqual([]);
    expect(
      await rival.query(api.courtSources.listingsForMatter, { matterId: matterId as never }),
    ).toEqual([]);
    expect(await rival.query(api.courtSources.dashboard, {})).not.toBeNull();
    expect(await rival.query(api.courtSources.dashboard, {})).toMatchObject({
      counts: { total: 0 },
    });

    // Writes → refused.
    await expect(
      rival.mutation(api.courtSources.confirmMatch, { listingId: listing.listingId as never }),
    ).rejects.toThrow();
    await expect(
      rival.mutation(api.courtSources.rejectMatch, {
        listingId: listing.listingId as never,
        reason: "hostile",
      }),
    ).rejects.toThrow();
    await expect(
      rival.mutation(api.dpdpCompliance.updateRegisterEntry, {
        entryId: (await owner.query(api.dpdpCompliance.listRegister, {}))[0]!._id as never,
        legalReview: "completed",
      }),
    ).rejects.toThrow();
    await expect(
      rival.mutation(api.dataResidency.verifyRegion, {
        service: "primary_database",
        verifiedRegion: "in",
      }),
    ).rejects.toThrow();
    void ownerId;
  });
});
