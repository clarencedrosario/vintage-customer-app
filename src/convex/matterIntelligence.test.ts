import { describe, expect, it, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules: Record<string, () => Promise<unknown>> = (import.meta as unknown as {
  glob: (p: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.ts");

const asUser = (t: ReturnType<typeof convexTest>, userId: string) =>
  t.withIdentity({ subject: userId, tokenIdentifier: `test:${userId}` });

const DOC_TEXT = `PLAINT (CIVIL SUIT FOR RECOVERY)

1. The plaintiff, Acme Trading Pvt. Ltd., carried on business with the
defendant, Mr. Rajesh Kumar, under a supply agreement dated 2024-03-15.

2. That the defendant placed purchase orders totalling Rs. 4,50,000
between April 2024 and August 2024.

3. That the defendant shall pay the agreed invoice amounts within 30
days of delivery, which obligation the defendant has breached.

4. A legal notice dated 12/05/2025 was served upon the defendant; the
defendant failed to reply or pay.

5. The cause of action arose on 2025-01-10 when the defendant defaulted.
Annexure copies of invoices are enclosed.`;

async function seedFirmWithSource(t: ReturnType<typeof convexTest>) {
  const ownerId = await asUser(t, "system").run(async (ctx) =>
    ctx.db.insert("users", {
      email: "owner@mifirm.test",
      emailVerified: true,
      isAnonymous: false,
      isPlatformAdmin: false,
    }),
  );
  const seeded = await asUser(t, "system").run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "MI Chamber (synthetic)",
      slug: "mi-firm",
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
      reference: "MI/2026/0001",
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

describe("Matter Intelligence — the complete §7 workflow", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  it("upload → extract → review → chronology → summary → draft → tasks", async () => {
    const { ownerId, matterId } = await seedFirmWithSource(t);
    const owner = asUser(t, ownerId);

    // 1. UPLOAD — a filed document + its versioned extracted-text row
    // (what the real upload path creates).
    const documentId = await asUser(t, "system").run(async (ctx) =>
      ctx.db.insert("matterDocuments", {
        matterId: matterId as never,
        uploaderId: ownerId as never,
        name: "Plaint (synthetic)",
        kind: "document" as const,
        visibility: "internal" as const,
        createdAt: Date.now(),
      }),
    );
    const sourceId = await owner.mutation(api.ai.addSource, {
      matterId: matterId as never,
      documentId: documentId as never,
      name: "Plaint (synthetic)",
      role: "our_client",
      text: DOC_TEXT,
      extraction: "text_layer",
    });

    // 2. EXTRACT — deterministic analysis; all proposals, nothing confirmed.
    const analysis = await owner.mutation(api.matterIntelligence.analyseSource, {
      aiSourceId: sourceId as never,
    });
    expect(analysis.proposed).toBeGreaterThan(3);
    expect(analysis.dates).toBeGreaterThanOrEqual(4); // 2024-03-15, 12/05/2025, 2025-01-10…

    // Import proposals as reviewable facts.
    const analyses = await owner.query(api.matterIntelligence.analyses, {
      matterId: matterId as never,
    });
    expect(analyses).toHaveLength(1);
    const imported = await owner.mutation(api.matterIntelligence.importAnalysisFacts, {
      analysisId: analyses[0]!._id as never,
    });
    expect(imported.imported).toBeGreaterThan(3);

    // 3. REVIEW — nothing is confirmed yet; health shows extraction pending.
    let facts = await owner.query(api.matterIntelligence.facts, {
      matterId: matterId as never,
    });
    expect(facts.every((f) => f.status !== "confirmed")).toBe(true);

    // Confirm the date fact + an amount fact; reject one with a reason.
    const dateFact = facts.find((f) => f.occurredOn === "2024-03-15")!;
    const amountFact = facts.find((f) => f.amountMinor === 45_000_000)!;
    expect(dateFact).toBeDefined();
    expect(amountFact).toBeDefined(); // ₹4,50,000 → integer paise math
    const noticeFact = facts.find((f) => f.occurredOn === "2025-05-12")!;

    await owner.mutation(api.matterIntelligence.confirmFact, {
      factId: dateFact._id as never,
    });
    await owner.mutation(api.matterIntelligence.confirmFact, {
      factId: amountFact._id as never,
    });
    if (noticeFact) {
      await owner.mutation(api.matterIntelligence.rejectFact, {
        factId: noticeFact._id as never,
        reason: "Service of notice not evidenced in the reviewed papers.",
      });
    }

    // 3b. CONTRADICTION: register a conflicting statement of the same
    // factKey via correction; scan must flag the conflicting pair.
    const corrected = await owner.mutation(api.matterIntelligence.correctFact, {
      factId: amountFact._id as never,
      statement: "Amount recorded in Plaint (synthetic): ₹4,75,000 (corrected per ledger).",
      status: "extracted",
      note: "Ledger shows a higher figure.",
    });
    const rescan = await owner.mutation(api.matterIntelligence.scanContradictions, {
      matterId: matterId as never,
    });
    expect(rescan.created).toBeGreaterThanOrEqual(1);
    const contradictions = await owner.query(api.matterIntelligence.contradictions, {
      matterId: matterId as never,
    });
    expect(contradictions).toHaveLength(1);
    // Resolve: favour the corrected (b) side — the losing fact is rejected.
    await owner.mutation(api.matterIntelligence.resolveContradiction, {
      contradictionId: contradictions[0]!._id as never,
      resolution: "resolved_favoring_b",
      explanation: "Ledger entry is primary evidence over the plaint averment.",
    });
    void corrected;

    // 4. CHRONOLOGY — approved facts dated; matter events unchanged
    // (the workflow adds a chronology event only via normal matter ops).
    facts = await owner.query(api.matterIntelligence.facts, {
      matterId: matterId as never,
    });
    const confirmedFacts = facts.filter((f) => f.status === "confirmed");
    expect(confirmedFacts.length).toBeGreaterThanOrEqual(1);
    expect(confirmedFacts.every((f) => f.confirmedById)).toBe(true);

    // 5. SUMMARY — versioned, cited to confirmed facts with pinpoints.
    const gen1 = await owner.mutation(api.matterIntelligence.regenerateSummary, {
      matterId: matterId as never,
    });
    expect(gen1.summaryVersion).toBe(1);
    const summaries1 = await owner.query(api.matterIntelligence.summaries, {
      matterId: matterId as never,
    });
    expect(summaries1[0]!.stale).toBe(false);
    expect(summaries1[0]!.body).toContain("Confirmed facts");
    expect(summaries1[0]!.body).toContain("ALLEGED"); // allegations stay labelled

    // 5b. STALENESS — a source change (new analysis) makes summary v1 stale.
    const doc2 = await asUser(t, "system").run(async (ctx) =>
      ctx.db.insert("matterDocuments", {
        matterId: matterId as never,
        uploaderId: ownerId as never,
        name: "Reply notice (synthetic)",
        kind: "communication" as const,
        visibility: "internal" as const,
        createdAt: Date.now(),
      }),
    );
    await owner.mutation(api.ai.addSource, {
      matterId: matterId as never,
      documentId: doc2 as never,
      name: "Reply notice (synthetic)",
      role: "opposing_party",
      text: "The defendant denies the claim. Reply dated 2025-06-02 to the notice dated 12/05/2025.",
      extraction: "manual",
    });
    const analyses2 = await owner.query(api.matterIntelligence.analyses, {
      matterId: matterId as never,
    });
    const replySource = analyses2[0]!;
    await owner.mutation(api.matterIntelligence.analyseSource, {
      aiSourceId: replySource.aiSourceId as never,
    });
    const gen2 = await owner.mutation(api.matterIntelligence.regenerateSummary, {
      matterId: matterId as never,
    });
    expect(gen2.summaryVersion).toBe(2);
    const summaries2 = await owner.query(api.matterIntelligence.summaries, {
      matterId: matterId as never,
    });
    expect(summaries2).toHaveLength(2); // prior version preserved
    const v1 = summaries2.find((s) => s.summaryVersion === 1)!;
    expect(v1.stale).toBe(true); // flagged, never deleted
    expect(summaries2.find((s) => s.summaryVersion === 2)!.stale).toBe(false);

    // 6. DRAFT — template library: seed, approve, prefill, save, compare.
    const seededLib = await owner.mutation(api.templates.seedLibrary, {});
    expect(seededLib.librarySize).toBe(5); // honest count of the actual seed
    let lib = await owner.query(api.templates.list, {});
    expect(lib.every((tpl) => tpl.approvalStatus !== "approved")).toBe(true); // none approved yet
    const demand = lib.find((tpl) => tpl.key === "legal-notice-demand-in")!;
    await owner.mutation(api.templates.approve, { templateId: demand._id as never });
    lib = await owner.query(api.templates.list, {});
    expect(lib.some((tpl) => tpl.approvalStatus === "approved")).toBe(true);

    const preview = await owner.query(api.templates.prefillPreview, {
      templateId: demand._id as never,
      matterId: matterId as never,
    });
    expect(preview).not.toBeNull();
    // Client name prefilled from the MATTER field (lawyer-maintained);
    // unknown details remain visible placeholders — never invented.
    expect(preview!.values.find((v) => v.key === "client_name")!.source).toBe("matter_field");
    expect(preview!.missingPlaceholders.length).toBeGreaterThan(0);
    expect(preview!.renderedBody).toContain("{{"); // visible gap
    expect(preview!.renderedBody).not.toContain("Mr. Fictional"); // nothing invented

    const use = await owner.mutation(api.templates.saveUse, {
      templateId: demand._id as never,
      matterId: matterId as never,
      values: preview!.values,
      renderedBody: preview!.renderedBody,
      missingPlaceholders: preview!.missingPlaceholders,
    });
    const comparison = await owner.query(api.templates.compareUse, {
      useId: use.useId as never,
    });
    expect(comparison!.added.length + comparison!.kept.length).toBeGreaterThan(0);
    expect(comparison!.unfilledPlaceholders.length).toBeGreaterThan(0);

    // 7. TASKS — propose → approve creates exactly ONE real task.
    const proposals = await owner.mutation(api.taskSuggestions.proposeFromMatter, {
      matterId: matterId as never,
    });
    expect(proposals.created).toBeGreaterThan(0);
    const openSuggestions = await owner.query(api.taskSuggestions.list, {
      matterId: matterId as never,
    });
    const first = openSuggestions[0]!;
    expect(first.status).toBe("proposed");
    const approval = await owner.mutation(api.taskSuggestions.approve, {
      suggestionId: first._id as never,
    });
    expect(approval.created).toBe(true);

    // Re-proposing must NOT duplicate (task now open).
    const again = await owner.mutation(api.taskSuggestions.proposeFromMatter, {
      matterId: matterId as never,
    });
    void again;
    const afterList = await owner.query(api.taskSuggestions.list, {
      matterId: matterId as never,
    });
    expect(
      afterList.filter((s) => s.title === first.title),
    ).toHaveLength(0);

    // 8. HEALTH — indicators are rule-based with visible inputs.
    const health = await owner.query(api.matterIntelligence.health, {
      matterId: matterId as never,
    });
    expect(health).not.toBeNull();
    const keys = health!.indicators.map((i) => i.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "overdue_tasks",
        "unresolved_contradictions",
        "unreviewed_extraction",
        "stale_summaries",
      ]),
    );
    // Contradictions were resolved → that indicator reports ok with a reason.
    const contradictionIndicator = health!.indicators.find(
      (i) => i.key === "unresolved_contradictions",
    )!;
    expect(contradictionIndicator.status).toBe("ok");
    expect(contradictionIndicator.reason).toContain("No unresolved");
    // No invented scores anywhere.
    expect(JSON.stringify(health!.indicators)).not.toMatch(/probability|score/i);
  });

  it("blocks cross-tenant reads and writes", async () => {
    const { ownerId, matterId } = await seedFirmWithSource(t);

    // A rival org with its own user.
    const rivalId = await asUser(t, "system").run(async (ctx) => {
      const uid = await ctx.db.insert("users", {
        email: "rival@mifirm.test",
        emailVerified: true,
        isAnonymous: false,
        isPlatformAdmin: false,
      });
      const orgId = await ctx.db.insert("organizations", {
        name: "Rival MI Chamber",
        slug: "rival-mi-firm",
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

    // Rival reads the owner's matter facts → empty (org-filtered).
    const rivalFacts = await asUser(t, rivalId).query(
      api.matterIntelligence.facts,
      { matterId: matterId as never },
    );
    expect(rivalFacts).toEqual([]);

    // Rival writes into the owner's matter → refused.
    await expect(
      asUser(t, rivalId).mutation(api.matterIntelligence.proposeFact, {
        matterId: matterId as never,
        factKey: "x",
        statement: "hostile insert",
        status: "extracted",
      }),
    ).rejects.toThrow();

    // Rival regenerates a summary for the owner's matter → refused.
    await expect(
      asUser(t, rivalId).mutation(api.matterIntelligence.regenerateSummary, {
        matterId: matterId as never,
      }),
    ).rejects.toThrow();

    // Rival cannot see, approve or use the owner's templates.
    const rivalLib = await asUser(t, rivalId).query(api.templates.list, {});
    expect(rivalLib).toEqual([]);
    void ownerId;
  });

  it("keeps human-approval boundaries: AI never self-confirms", async () => {
    const { ownerId, matterId } = await seedFirmWithSource(t);
    const owner = asUser(t, ownerId);
    const documentId = await asUser(t, "system").run(async (ctx) =>
      ctx.db.insert("matterDocuments", {
        matterId: matterId as never,
        uploaderId: ownerId as never,
        name: "Plaint (synthetic)",
        kind: "document" as const,
        visibility: "internal" as const,
        createdAt: Date.now(),
      }),
    );
    const sourceId = await owner.mutation(api.ai.addSource, {
      matterId: matterId as never,
      documentId: documentId as never,
      name: "Plaint (synthetic)",
      role: "our_client",
      text: DOC_TEXT,
      extraction: "text_layer",
    });
    await owner.mutation(api.matterIntelligence.analyseSource, {
      aiSourceId: sourceId as never,
    });
    const analyses = await owner.query(api.matterIntelligence.analyses, {
      matterId: matterId as never,
    });
    await owner.mutation(api.matterIntelligence.importAnalysisFacts, {
      analysisId: analyses[0]!._id as never,
    });
    const facts = await owner.query(api.matterIntelligence.facts, {
      matterId: matterId as never,
    });
    // Every imported fact is non-confirmed, provenance-tagged as machine
    // extraction, and carries source linkage.
    for (const f of facts) {
      expect(f.status).toBe("extracted");
      expect(f.proposedBy).toBe("deterministic-extractor");
      expect(f.confirmedById).toBeUndefined();
    }
    // Confirming requires an authenticated matter member — a signed-out
    // call must fail.
    await expect(
      t.mutation(api.matterIntelligence.confirmFact, {
        factId: facts[0]!._id as never,
      }),
    ).rejects.toThrow();
  });
});
