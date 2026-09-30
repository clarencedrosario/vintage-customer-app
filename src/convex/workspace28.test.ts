import { describe, expect, it, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

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

3. A legal notice dated 12/05/2025 was served upon the defendant; the
defendant failed to reply or pay.

4. The cause of action arose on 2025-01-10 when the defendant defaulted.
Annexure copies of invoices are enclosed.`;

/** Seed one org + owner + client + matter (mirrors matterIntelligence.test). */
async function seedFirm(t: ReturnType<typeof convexTest>) {
  const ownerId = await asUser(t, "system").run(async (ctx) =>
    ctx.db.insert("users", {
      email: "owner@w28.test",
      emailVerified: true,
      isAnonymous: false,
      isPlatformAdmin: false,
    }),
  );
  const seeded = await asUser(t, "system").run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "W28 Chamber (synthetic)",
      slug: "w28-firm",
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
      reference: "W28/2026/0001",
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

describe("§28 independently developed workspace", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  it("timeline: propose → approve → source change flags needs_review (chronology never silently rewritten)", async () => {
    const { ownerId, matterId } = await seedFirm(t);
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

    // Propose timeline entries from the analysis (dated, kind-labelled).
    const proposed = await owner.mutation(api.caseTimeline.proposeFromAnalysis, {
      analysisId: analyses[0]!._id as never,
    });
    expect(proposed.created).toBeGreaterThanOrEqual(3);

    let entries = await owner.query(api.caseTimeline.list, {
      matterId: matterId as never,
    });
    expect(entries.every((e) => e.status === "proposed")).toBe(true);
    const event = entries.find((e) => e.date === "2025-01-10")!;
    expect(event.entryKind).toBe("event");
    const docEntry = entries.find((e) => e.date === "2024-03-15")!;
    expect(docEntry.entryKind).toBe("document"); // "supply agreement dated ..."
    expect(docEntry.datePrecision).toBe("exact");

    // Approve one entry — it binds to the CURRENT source text.
    await owner.mutation(api.caseTimeline.approve, { entryId: event._id as never });
    entries = await owner.query(api.caseTimeline.list, { matterId: matterId as never });
    const approved = entries.find((e) => e._id === event._id)!;
    expect(approved.status).toBe("approved");
    expect(approved.approvedById).toBeDefined();
    expect(approved.approvedInputsHash).toBeDefined();

    // History records the approval; a lawyer CORRECTION creates a new
    // version row and keeps the old one (superseded, never deleted).
    const history = await owner.query(api.caseTimeline.history, {
      entryId: event._id as never,
    });
    expect(history.length).toBeGreaterThanOrEqual(1);
    const corrected = await owner.mutation(api.caseTimeline.correct, {
      entryId: event._id as never,
      date: "2025-01-12",
      title: "Cause of action arose (corrected per ledger)",
      note: "Ledger shows default on 12 Jan.",
    });
    entries = await owner.query(api.caseTimeline.list, { matterId: matterId as never });
    expect(entries.find((e) => e._id === event._id)!.supersededById).toBeDefined();
    const v2 = entries.find((e) => e._id === corrected.newEntryId)!;
    expect(v2.status).toBe("approved");
    expect(v2.version).toBe(event.version + 1);

    // SOURCE CHANGE: the source text is replaced (new version) → the
    // OTHER approved entry flips to needs_review; the chronology is not
    // rewritten and no entry is deleted.
    await asUser(t, "system").run(async (ctx) =>
      ctx.db.patch(sourceId as never, {
        text: `${DOC_TEXT}\nAMENDED: additional cause-of-action particulars appended.`,
      }),
    );
    const flag = await owner.mutation(api.caseTimeline.flagAffectedBySourceChange, {
      aiSourceId: sourceId as never,
    });
    expect(flag.flagged).toBeGreaterThanOrEqual(1);
    entries = await owner.query(api.caseTimeline.list, { matterId: matterId as never });
    // The old version was superseded to "rejected"; the CURRENT approved
    // entry (the v2 correction) must be flagged for review.
    const v2After = entries.find((e) => e._id === corrected.newEntryId)!;
    expect(v2After.status).toBe("needs_review");
    expect(
      entries.filter((e) => e.status === "needs_review").length,
    ).toBeGreaterThanOrEqual(1);

    // A needs_review entry can be re-approved after review.
    await owner.mutation(api.caseTimeline.approve, { entryId: v2After._id as never });
    entries = await owner.query(api.caseTimeline.list, { matterId: matterId as never });
    expect(entries.find((e) => e._id === v2After._id)!.status).toBe("approved");

    // Reject a proposal with a recorded reason.
    const stillProposed = entries.find((e) => e.status === "proposed")!;
    await owner.mutation(api.caseTimeline.reject, {
      entryId: stillProposed._id as never,
      reason: "Duplicate of the ledger entry.",
    });
    entries = await owner.query(api.caseTimeline.list, { matterId: matterId as never });
    expect(entries.find((e) => e._id === stillProposed._id)!.rejectedReason).toBeDefined();

    // Merge a duplicate into the survivor.
    const remaining = entries.filter((e) => e.status === "proposed");
    if (remaining.length >= 2) {
      await owner.mutation(api.caseTimeline.merge, {
        keepEntryId: remaining[0]!._id as never,
        duplicateEntryId: remaining[1]!._id as never,
      });
      const after = await owner.query(api.caseTimeline.list, { matterId: matterId as never });
      expect(after.find((e) => e._id === remaining[1]!._id)!.status).toBe("merged_into");
    }

    // Lawyer-authored entry enters the chronology APPROVED immediately.
    const lawyerEntry = await owner.mutation(api.caseTimeline.proposeEntry, {
      matterId: matterId as never,
      entryKind: "filing",
      title: "Suit filed",
      date: "2026-02-01",
    });
    entries = await owner.query(api.caseTimeline.list, { matterId: matterId as never });
    const le = entries.find((e) => e._id === lawyerEntry.entryId)!;
    expect(le.status).toBe("approved");
    expect(le.proposedBy).toBe("lawyer");
  });

  it("brief: deterministic generation, changesFromPrior, staleness, lawyer-only approval", async () => {
    const { ownerId, matterId } = await seedFirm(t);
    const owner = asUser(t, ownerId);

    // First version.
    const gen1 = await owner.mutation(api.matterBriefs.proposeBrief, {
      matterId: matterId as never,
    });
    expect(gen1.unchanged).toBe(false);
    expect(gen1.briefVersion).toBe(1);
    let briefs = await owner.query(api.matterBriefs.list, { matterId: matterId as never });
    expect(briefs[0]!.status).toBe("proposed");
    expect(briefs[0]!.proceduralPosition).toContain("City Civil Court");
    expect(briefs[0]!.interpretationNote).toMatch(/NOT established/);
    expect(briefs[0]!.outstandingQuestions[0]).toContain("No lawyer-confirmed facts");
    expect(briefs[0]!.changesFromPrior[0]).toContain("First proposed version");
    const briefId1 = briefs[0]!._id;

    // Regenerate with unchanged inputs → honest "unchanged" (no churn).
    const genSame = await owner.mutation(api.matterBriefs.proposeBrief, {
      matterId: matterId as never,
    });
    expect(genSame.unchanged).toBe(true);

    // Approve v1 now that it is current.
    await owner.mutation(api.matterBriefs.approve, { briefId: briefId1 as never });
    briefs = await owner.query(api.matterBriefs.list, { matterId: matterId as never });
    expect(briefs[0]!.status).toBe("approved");

    // Add a confirmed fact → inputs change.
    await owner.mutation(api.matterIntelligence.proposeFact, {
      matterId: matterId as never,
      factKey: "w28-agreement-date",
      statement: "Supply agreement executed on 2024-03-15 between the parties.",
      status: "extracted",
    });
    const facts = await owner.query(api.matterIntelligence.facts, {
      matterId: matterId as never,
    });
    await owner.mutation(api.matterIntelligence.confirmFact, {
      factId: facts[0]!._id as never,
    });

    // Regenerate → v2 with changesFromPrior; v1 goes stale (preserved).
    const gen2 = await owner.mutation(api.matterBriefs.proposeBrief, {
      matterId: matterId as never,
    });
    expect(gen2.briefVersion).toBe(2);
    expect(gen2.unchanged).toBe(false);
    briefs = await owner.query(api.matterBriefs.list, { matterId: matterId as never });
    expect(briefs).toHaveLength(2);
    const v1 = briefs.find((b) => b.briefVersion === 1)!;
    const v2 = briefs.find((b) => b.briefVersion === 2)!;
    expect(v1.stale).toBe(true);
    expect(v2.stale).toBe(false);
    expect(v2.changesFromPrior.some((c) => /Confirmed key facts/.test(c))).toBe(true);
    expect(v2.keyFacts.some((k) => /Supply agreement executed/.test(k.text))).toBe(true);
    expect(v2.keyFacts.every((k) => k.refKind === "fact")).toBe(true);

    // The STALE v1 cannot be approved — only the current version can.
    await expect(
      owner.mutation(api.matterBriefs.approve, { briefId: v1._id as never }),
    ).rejects.toThrow();
  });

  it("draft revisions: propose → accept (diff applied, body snapshotted) → undo restores verbatim; risk comments resolve", async () => {
    const { ownerId, matterId } = await seedFirm(t);
    const owner = asUser(t, ownerId);
    void ownerId;

    // Approved template + saved use (draft).
    await owner.mutation(api.templates.seedLibrary, {});
    const lib = await owner.query(api.templates.list, { includeUnapproved: true });
    const tpl = lib.find((x) => x.key === "legal-notice-demand-in")!;
    await owner.mutation(api.templates.approve, { templateId: tpl._id as never });
    const body = `LEGAL NOTICE\nDate: 2026-09-30\n\nTo,\n{{NOTICEE_NAME}}\n\n1. That a sum of Rs. 4,50,000 is due.`;
    const use = await owner.mutation(api.templates.saveUse, {
      templateId: tpl._id as never,
      matterId: matterId as never,
      values: [],
      renderedBody: body,
      missingPlaceholders: ["noticee_name"],
    });

    // Propose an edit against text that IS in the draft.
    const prop = await owner.mutation(api.draftingRevisions.propose, {
      useId: use.useId as never,
      originalExcerpt: "a sum of Rs. 4,50,000 is due",
      proposedExcerpt: "a sum of Rs. 4,75,000 (as per ledger) is due",
      reason: "Ledger figure supersedes the plaint averment.",
      riskLevel: "caution",
    });
    expect(prop.duplicated).toBe(false);

    // An identical open proposal is collapsed onto the existing one.
    const dup = await owner.mutation(api.draftingRevisions.propose, {
      useId: use.useId as never,
      originalExcerpt: "a sum of Rs. 4,50,000 is due",
      proposedExcerpt: "a sum of Rs. 4,75,000 (as per ledger) is due",
      reason: "same again",
    });
    expect(dup.duplicated).toBe(true);
    expect(dup.revisionId).toBe(prop.revisionId);

    // Proposals against text NOT in the draft are refused (honest diffs).
    await expect(
      owner.mutation(api.draftingRevisions.propose, {
        useId: use.useId as never,
        originalExcerpt: "this text is not in the draft",
        proposedExcerpt: "x",
        reason: "should fail",
      }),
    ).rejects.toThrow();

    // Accept: body changes AND the pre-acceptance body is snapshotted.
    await owner.mutation(api.draftingRevisions.accept, {
      revisionId: prop.revisionId as never,
    });
    let revisions = await owner.query(api.draftingRevisions.listRevisions, {
      useId: use.useId as never,
    });
    const accepted = revisions.find((r) => r._id === prop.revisionId)!;
    expect(accepted.status).toBe("accepted");
    expect(accepted.resolvedById).toBeDefined();
    expect(accepted.bodyBefore).toBe(body);

    // Undo restores the EXACT prior body and marks the revision undone.
    await owner.mutation(api.draftingRevisions.undo, { revisionId: prop.revisionId as never });
    revisions = await owner.query(api.draftingRevisions.listRevisions, {
      useId: use.useId as never,
    });
    expect(revisions.find((r) => r._id === prop.revisionId)!.status).toBe("undone");

    // Re-accept is impossible after undo.
    await expect(
      owner.mutation(api.draftingRevisions.accept, { revisionId: prop.revisionId as never }),
    ).rejects.toThrow();

    // Risk comments: open → addressed.
    const rc = await owner.mutation(api.draftingRevisions.addRiskComment, {
      useId: use.useId as never,
      excerpt: "Date: 2026-09-30",
      concern: "Limitation period for the intended proceeding must be verified.",
      reason: "Demand-notice timing rules depend on the cause-of-action date.",
      sourceKey: "doc:plaint",
    });
    let comments = await owner.query(api.draftingRevisions.listRiskComments, {
      useId: use.useId as never,
    });
    expect(comments).toHaveLength(1);
    expect(comments[0]!.status).toBe("open");
    await owner.mutation(api.draftingRevisions.resolveRiskComment, {
      commentId: rc.commentId as never,
      resolution: "addressed",
    });
    comments = await owner.query(api.draftingRevisions.listRiskComments, {
      useId: use.useId as never,
    });
    expect(comments[0]!.status).toBe("addressed");
  });

  it("audit chain: append links hashes, backfill folds legacy rows, verification detects tampering", async () => {
    const { ownerId, matterId, orgId } = await seedFirm(t);
    const owner = asUser(t, ownerId);

    // Legacy-style rows (written without seq/hash by the old logger),
    // properly org-scoped, OLDER than the chained appends.
    await asUser(t, "system").run(async (ctx) => {
      for (let i = 0; i < 2; i++) {
        await ctx.db.insert("auditLog", {
          orgId: orgId as never,
          matterId: matterId as never,
          actorId: ownerId as never,
          actorName: "Legacy Writer",
          action: `legacy.action.${i}`,
          detail: "written before chaining",
          createdAt: 1_000_000 + i, // far in the past
        });
      }
    });

    const a1 = await owner.mutation(api.auditChain.append, {
      action: "brief.approved",
      detail: "Brief v1 approved",
      matterId: matterId as never,
    });
    const a2 = await owner.mutation(api.auditChain.append, {
      action: "timeline.entry.approved",
      detail: "Entry approved",
      matterId: matterId as never,
    });
    expect(a2.seq).toBe(a1.seq + 1);
    expect(a2.prevHash).toBe(a1.entryHash);

    // Fold the legacy rows into the chain (createdAt order → they come FIRST).
    const bf = await owner.mutation(api.auditChain.backfillLegacy, {});
    expect(bf.backfilled).toBe(2);

    // Chain verifies: every hash recomputes, seq is continuous.
    let verdict = await owner.query(api.auditChain.verify, {});
    expect(verdict.ok).toBe(true);
    expect(verdict.unchained).toBe(0);
    expect(verdict.chained).toBeGreaterThanOrEqual(4);

    // TAMPER: modify a chained row's detail directly in the database —
    // exactly what a tamper-evident log exists to catch.
    const target = await asUser(t, "system").run(async (ctx) => {
      const rows = await ctx.db.query("auditLog").collect();
      return rows.find((r) => String(r.orgId) === String(orgId) && r.seq === 2);
    });
    await asUser(t, "system").run(async (ctx) =>
      ctx.db.patch(target!._id, { detail: "TAMPERED DETAIL" }),
    );

    verdict = await owner.query(api.auditChain.verify, {});
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/Hash mismatch at seq 2/);
    expect(verdict.brokenAt).toBeDefined();
  });

  it("daily priorities: real work items only, extracted dates kept distinct", async () => {
    const { ownerId, matterId, orgId } = await seedFirm(t);
    const owner = asUser(t, ownerId);
    const now = Date.now();

    await asUser(t, "system").run(async (ctx) => {
      // Overdue task + open overdue deadline + upcoming deadline.
      await ctx.db.insert("tasks", {
        orgId: orgId as never,
        matterId: matterId as never,
        title: "File rejoinder (overdue)",
        kind: "filing" as const,
        priority: "high" as const,
        dueAt: now - 86_400_000,
        status: "pending" as const,
        createdById: ownerId as never,
        createdAt: now,
      });
      await ctx.db.insert("deadlines", {
        orgId: orgId as never,
        matterId: matterId as never,
        title: "Written statement due (overdue)",
        category: "filing" as const,
        dueAt: now - 2 * 86_400_000,
        status: "open" as const,
        createdById: ownerId as never,
        createdAt: now,
      });
      await ctx.db.insert("deadlines", {
        orgId: orgId as never,
        matterId: matterId as never,
        title: "Evidence affidavit due soon",
        category: "compliance" as const,
        dueAt: now + 5 * 86_400_000,
        status: "open" as const,
        createdById: ownerId as never,
        createdAt: now,
      });
      // Scheduled hearing within 14 days; cancelled one excluded.
      await ctx.db.insert("hearings", {
        matterId: matterId as never,
        title: "First hearing",
        court: "City Civil Court",
        at: now + 3 * 86_400_000,
        status: "scheduled" as const,
        createdAt: now,
      });
      await ctx.db.insert("hearings", {
        matterId: matterId as never,
        title: "Cancelled hearing",
        at: now + 2 * 86_400_000,
        status: "cancelled" as const,
        createdAt: now,
      });
      // Unreviewed order.
      await ctx.db.insert("orders", {
        matterId: matterId as never,
        title: "Order on application",
        passedOn: now - 3 * 86_400_000,
        createdAt: now,
      });
      // Unanswered client request.
      await ctx.db.insert("documentRequests", {
        orgId: orgId as never,
        matterId: matterId as never,
        requestedById: ownerId as never,
        title: "Bank statement (Apr–Aug 2024)",
        status: "requested" as const,
        createdAt: now,
      });
    });

    const p = await owner.query(api.dailyPriorities.priorities, {
      matterId: matterId as never,
    });
    expect(p).not.toBeNull();
    expect(p!.counts.overdue).toBe(2); // task + open deadline
    expect(p!.counts.hearings).toBe(1); // cancelled excluded
    expect(p!.counts.unreviewedOrders).toBe(1);
    expect(p!.counts.unansweredRequests).toBe(1);
    expect(p!.upcomingDeadlines.some((d) => /Evidence affidavit/.test(d.title))).toBe(true);
    expect(p!.overdue.some((o) => o.source === "deadline")).toBe(true);
    expect(p!.upcomingHearings[0]!.court).toBe("City Civil Court");

    // AI proposals / extracted dates arrive separately and labelled.
    expect(p!.aiProposalsAwaitingApproval).toEqual([]);
    expect(p!.extractedDatesAwaitingReview).toEqual([]);

    // A proposed task suggestion lands ONLY in the AI-proposals bucket
    // (proposed dates are never shown as verified deadlines). Seed a
    // REVIEWED analysis with missing material so proposeFromMatter has
    // something real to propose from.
    const documentId = await asUser(t, "system").run(async (ctx) =>
      ctx.db.insert("matterDocuments", {
        matterId: matterId as never,
        uploaderId: ownerId as never,
        name: "Plaint (synthetic)",
        kind: "document" as const,
        visibility: "internal" as const,
        createdAt: now,
      }),
    );
    const sourceId = await owner.mutation(api.ai.addSource, {
      matterId: matterId as never,
      documentId: documentId as never,
      name: "Plaint (synthetic)",
      role: "our_client",
      text: "Notice dated 12/05/2025. Amount of Rs. 4,50,000 remains unpaid.",
      extraction: "text_layer",
    });
    await owner.mutation(api.matterIntelligence.analyseSource, {
      aiSourceId: sourceId as never,
    });
    const analyses = await owner.query(api.matterIntelligence.analyses, {
      matterId: matterId as never,
    });
    // Importing proposals marks the analysis reviewed (the lawyer has
    // seen its output) — that is what makes its missing-material flag
    // eligible for task proposals.
    await owner.mutation(api.matterIntelligence.importAnalysisFacts, {
      analysisId: analyses[0]!._id as never,
    });
    const proposalResult = await owner.mutation(api.taskSuggestions.proposeFromMatter, {
      matterId: matterId as never,
    });
    expect(proposalResult.created).toBeGreaterThanOrEqual(1);
    const p2 = await owner.query(api.dailyPriorities.priorities, {
      matterId: matterId as never,
    });
    expect(p2!.counts.proposedTasks).toBeGreaterThanOrEqual(1);
    expect(p2!.aiProposalsAwaitingApproval[0]!.rationale).toBeDefined();
  });

  it("provenance register: seeds actual dependencies, flags the uncertain licence, blocks non-admin edits", async () => {
    const { ownerId } = await seedFirm(t);
    const owner = asUser(t, ownerId);

    const seeded = await owner.mutation(api.provenanceRegister.seed, {});
    expect(seeded.created).toBeGreaterThan(5);
    const stats = await owner.query(api.provenanceRegister.stats, {});
    expect(stats!.total).toBe(seeded.created);
    expect(stats!.flaggedForReview).toBeGreaterThanOrEqual(1); // Convex licence
    const rows = await owner.query(api.provenanceRegister.list, {});
    const convex = rows.find((r) => r.asset === "convex")!;
    expect(convex.status).toBe("flagged_for_review");
    expect(convex.licence).toMatch(/NOT a standard OSI licence/);
    const react = rows.find((r) => r.asset === "react")!;
    expect(react.licence).toBe("MIT");
    const inHouse = rows.find((r) => /seed template library/.test(r.asset))!;
    expect(inHouse.licence).toBe("proprietary (CJ GLOBAL)");

    // Idempotent: re-seeding adds nothing.
    const again = await owner.mutation(api.provenanceRegister.seed, {});
    expect(again.created).toBe(0);

    // Owner records a review outcome.
    await owner.mutation(api.provenanceRegister.updateStatus, {
      entryId: convex._id as never,
      status: "cleared",
      note: "Reviewed: managed-cloud usage assessed within licence terms (recorded decision).",
    });
    const after = await owner.query(api.provenanceRegister.stats, {});
    expect(after!.flaggedForReview).toBe(stats!.flaggedForReview - 1);
  });

  it("health: extended indicators with rulesVersion v1", async () => {
    const { ownerId, matterId, orgId } = await seedFirm(t);
    const owner = asUser(t, ownerId);
    const now = Date.now();

    await asUser(t, "system").run(async (ctx) => {
      await ctx.db.insert("orders", {
        matterId: matterId as never,
        title: "Unreviewed order",
        passedOn: now - 86_400_000,
        createdAt: now,
      });
      await ctx.db.insert("hearings", {
        matterId: matterId as never,
        title: "Hearing soon",
        at: now + 2 * 86_400_000,
        status: "scheduled" as const,
        createdAt: now,
      });
      await ctx.db.insert("documentRequests", {
        orgId: orgId as never,
        matterId: matterId as never,
        requestedById: ownerId as never,
        title: "Pending request",
        status: "requested" as const,
        createdAt: now,
      });
    });

    const health = await owner.query(api.matterIntelligence.health, {
      matterId: matterId as never,
    });
    expect(health).not.toBeNull();
    const keys = health!.indicators.map((i: { key: string }) => i.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "overdue_tasks",
        "unresolved_contradictions",
        "unreviewed_extraction",
        "stale_summaries",
        "unreviewed_orders",
        "missing_evidence",
        "upcoming_hearings",
        "unanswered_client_requests",
      ]),
    );
    expect(health!.rulesVersion).toBe("v1");
    expect(JSON.stringify(health!.indicators)).not.toMatch(/probability|score/i);
    const ordersIndicator = health!.indicators.find(
      (i: { key: string }) => i.key === "unreviewed_orders",
    )!;
    expect(ordersIndicator.status).toBe("attention");
  });

  it("cross-tenant: rival org cannot read or write §28 surfaces", async () => {
    const { ownerId, matterId } = await seedFirm(t);
    const owner = asUser(t, ownerId);
    void ownerId;

    await owner.mutation(api.matterBriefs.proposeBrief, { matterId: matterId as never });
    await owner.mutation(api.templates.seedLibrary, {});
    const lib = await owner.query(api.templates.list, { includeUnapproved: true });
    const tpl = lib.find((x) => x.key === "legal-notice-demand-in")!;
    await owner.mutation(api.templates.approve, { templateId: tpl._id as never });
    const use = await owner.mutation(api.templates.saveUse, {
      templateId: tpl._id as never,
      matterId: matterId as never,
      values: [],
      renderedBody: "DRAFT BODY",
      missingPlaceholders: [],
    });

    // Rival org with its own user.
    const rivalId = await asUser(t, "system").run(async (ctx) => {
      const uid = await ctx.db.insert("users", {
        email: "rival@w28.test",
        emailVerified: true,
        isAnonymous: false,
        isPlatformAdmin: false,
      });
      const orgId = await ctx.db.insert("organizations", {
        name: "Rival W28",
        slug: "rival-w28",
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
    const rival = asUser(t, rivalId);

    // Reads → empty/null.
    expect(
      await rival.query(api.matterBriefs.list, { matterId: matterId as never }),
    ).toEqual([]);
    expect(
      await rival.query(api.dailyPriorities.priorities, { matterId: matterId as never }),
    ).toBeNull();
    expect(
      await rival.query(api.draftingRevisions.listRevisions, { useId: use.useId as never }),
    ).toEqual([]);
    expect(await rival.query(api.caseTimeline.list, { matterId: matterId as never })).toEqual(
      [],
    );

    // Writes → refused.
    await expect(
      rival.mutation(api.matterBriefs.proposeBrief, { matterId: matterId as never }),
    ).rejects.toThrow();
    await expect(
      rival.mutation(api.draftingRevisions.propose, {
        useId: use.useId as never,
        originalExcerpt: "DRAFT BODY",
        proposedExcerpt: "hostile",
        reason: "injection",
      }),
    ).rejects.toThrow();
    await expect(
      rival.mutation(api.caseTimeline.proposeEntry, {
        matterId: matterId as never,
        entryKind: "event",
        title: "hostile entry",
        date: "2026-01-01",
      }),
    ).rejects.toThrow();
  });
});
