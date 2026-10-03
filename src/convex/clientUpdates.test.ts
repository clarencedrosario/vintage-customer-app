import { describe, expect, it, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import {
  assembleUpdateBody,
  canonicalSetInput,
  describeProblems,
  duplicateSendDecision,
  MAX_DEVELOPMENTS,
  reverifyProvenance,
  UPDATE_FOOTER,
} from "../lib/clientUpdates";

const modules: Record<string, () => Promise<unknown>> = (import.meta as unknown as {
  glob: (p: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.ts");

const asUser = (t: ReturnType<typeof convexTest>, userId: string) =>
  t.withIdentity({ subject: userId, tokenIdentifier: `test:${userId}` });

/** Seed one org + owner + client + matter. */
async function seedFirm(t: ReturnType<typeof convexTest>) {
  const ownerId = await asUser(t, "system").run(async (ctx) =>
    ctx.db.insert("users", {
      name: "Owner (synthetic)",
      email: "owner@t22.test",
      emailVerified: true,
      isAnonymous: false,
      isPlatformAdmin: false,
    }),
  );
  const seeded = await asUser(t, "system").run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "T22 Chamber (client updates)",
      slug: "t22-client-updates",
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
      name: "Client Updates Test Pvt. Ltd. (synthetic)",
      createdBy: ownerId as never,
      createdAt: Date.now(),
    });
    const matterId = await ctx.db.insert("matters", {
      orgId,
      clientId,
      reference: "T22/2026/0001",
      title: "Client updates test matter (synthetic)",
      practiceArea: "civil",
      clientRole: "Client Updates Test Pvt. Ltd.",
      status: "open" as const,
      createdBy: ownerId as never,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { orgId, clientId, matterId };
  });
  return { ownerId, ...seeded };
}

/** Seed timeline entries: two APPROVED developments + one proposed + one needs_review. */
async function seedDevelopments(
  t: ReturnType<typeof convexTest>,
  ids: { orgId: string; matterId: string },
) {
  return asUser(t, "system").run(async (ctx) => {
    const mk = (
      entryKind: "event" | "filing",
      title: string,
      date: string,
      status: "approved" | "proposed" | "needs_review",
      detail?: string,
    ) =>
      ctx.db.insert("matterTimeline", {
        orgId: ids.orgId as never,
        matterId: ids.matterId as never,
        entryKind,
        title,
        detail,
        date,
        datePrecision: "exact" as const,
        status,
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    const hearingHeld = await mk("event", "Hearing held before the Joint Registrar", "2026-09-12", "approved", "Matter listed for framing of issues.");
    const writtenStatement = await mk("filing", "Written statement filed on behalf of the defendants", "2026-09-20", "approved");
    const proposedDraft = await mk("event", "Unverified: alleged settlement discussion", "2026-09-25", "proposed");
    const flagged = await mk("event", "Bail application listed", "2026-09-28", "needs_review");
    return { hearingHeld, writtenStatement, proposedDraft, flagged };
  });
}

describe("Turn 22 — §32 Phase 10 client-update drafts", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  it("pure layer: deterministic assembly, order-independent set key, re-verification matrix, duplicate decisions", () => {
    // Assembly: sorted by date, factual bullets, footer travels.
    const body = assembleUpdateBody("T22/2026/0001", [
      { refKey: "b", entryKind: "filing", title: "Written statement filed", date: "2026-09-20" },
      { refKey: "a", entryKind: "event", title: "Hearing held", date: "2026-09-12", detail: "Issues framed." },
    ]);
    expect(body).toContain("Matter update — T22/2026/0001");
    expect(body.indexOf("Hearing held")).toBeLessThan(body.indexOf("Written statement filed"));
    expect(body).toContain("• 2026-09-12 — Hearing held: Issues framed.");
    expect(body).toContain(UPDATE_FOOTER);
    expect(assembleUpdateBody("X", [])).toContain("(no developments selected)");

    // Set key is order-independent.
    expect(canonicalSetInput(["d2", "d1", "d3"])).toBe(canonicalSetInput(["d3", "d1", "d2"]));

    // Re-verification matrix.
    const snapshot = [
      { refKey: "k1", title: "A", digest: "h1" },
      { refKey: "k2", title: "B", digest: "h2" },
    ];
    const ok = new Map([
      ["k1", { digest: "h1", approved: true }],
      ["k2", { digest: "h2", approved: true }],
    ]);
    expect(reverifyProvenance(snapshot, ok)).toEqual([]);
    const mixed = new Map([
      ["k1", null], // disappeared
      ["k2", { digest: "h2", approved: false }], // downgraded
    ]);
    const probs = reverifyProvenance(snapshot, mixed);
    expect(probs).toEqual([
      { refKey: "k1", problem: "missing" },
      { refKey: "k2", problem: "not_approved" },
    ]);
    const changed = new Map([["k1", { digest: "h9", approved: true }], ["k2", { digest: "h2", approved: true }]]);
    expect(reverifyProvenance([snapshot[0]!], changed)).toEqual([
      { refKey: "k1", problem: "changed" },
    ]);
    expect(describeProblems(probs)).toContain("Regenerate the draft");

    // Duplicate decisions: blocking outbox states; a sent set blocks;
    // cancelled/failed paths stay with the outbox lifecycle.
    expect(duplicateSendDecision({}).ok).toBe(true);
    expect(duplicateSendDecision({ outboxStatus: "cancelled" }).ok).toBe(true);
    expect(duplicateSendDecision({ outboxStatus: "failed" }).ok).toBe(true);
    for (const s of ["queued", "sent", "delivered", "read", "awaiting_configuration"]) {
      expect(duplicateSendDecision({ outboxStatus: s }).ok).toBe(false);
    }
    const dup = duplicateSendDecision({ priorSentSetKeyAt: Date.UTC(2026, 9, 3) });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.reason).toContain("already sent");
    expect(MAX_DEVELOPMENTS).toBe(25);
  });

  it("end-to-end: approved-only preparation, approval gate, outbox queue + delivery, duplicate set blocked, changed development blocks", async () => {
    const firm = await seedFirm(t);
    const devs = await seedDevelopments(t, firm);
    const owner = asUser(t, firm.ownerId);

    // listDevelopments exposes APPROVED entries only.
    const devList = await owner.query(api.clientUpdates.listDevelopments, {
      matterId: firm.matterId as never,
    });
    expect(devList.map((d) => d.refKey)).toEqual(
      expect.arrayContaining([String(devs.hearingHeld), String(devs.writtenStatement)]),
    );
    expect(devList.some((d) => d.refKey === String(devs.proposedDraft))).toBe(false);
    expect(devList.some((d) => d.refKey === String(devs.flagged))).toBe(false);

    // Preparation REFUSES a non-approved development.
    await expect(
      owner.mutation(api.clientUpdates.prepareDraft, {
        matterId: firm.matterId as never,
        developmentIds: [devs.hearingHeld as never, devs.proposedDraft as never],
      }),
    ).rejects.toThrow(/not an approved development/);

    // Preparation from approved developments only: body is assembled,
    // footer present, status draft.
    const prep = await owner.mutation(api.clientUpdates.prepareDraft, {
      matterId: firm.matterId as never,
      developmentIds: [devs.hearingHeld as never, devs.writtenStatement as never],
    });
    expect(prep.body).toContain("Hearing held before the Joint Registrar");
    expect(prep.body).toContain(UPDATE_FOOTER);

    // Pre-send review BEFORE approval: honest recipient states (no
    // portal account, no recorded preference, no thread yet), no
    // duplicate, provenance clean.
    const review0 = await owner.query(api.clientUpdates.draftReview, {
      draftId: prep.draftId as never,
    });
    expect(review0!.draft.status).toBe("draft");
    expect(review0!.provenanceState.ok).toBe(true);
    expect(review0!.recipients[0]!.hasPortalAccount).toBe(false);
    expect(review0!.recipients[0]!.clientUpdatesPreference).toBeNull();
    expect(review0!.recipients[0]!.clientThreadExists).toBe(false);
    expect(review0!.duplicate.blocked).toBe(false);

    // Queueing a DRAFT (unapproved) is refused.
    await expect(
      owner.mutation(api.clientUpdates.queueForSend, { draftId: prep.draftId as never }),
    ).rejects.toThrow(/Approve the draft/);

    await owner.mutation(api.clientUpdates.approveDraft, { draftId: prep.draftId as never });

    // Queue through the EXISTING outbox: client_update category,
    // in_thread, linked source, conversation attached.
    const sent = await owner.mutation(api.clientUpdates.queueForSend, {
      draftId: prep.draftId as never,
    });
    expect(sent.outboxId).toBeTruthy();
    const outboxRow = await t.run((ctx) => ctx.db.get(sent.outboxId as never));
    expect(outboxRow!.category).toBe("matter_update");
    expect(outboxRow!.status).toBe("queued");
    expect(outboxRow!.sourceKind).toBe("client_update_draft");
    expect(outboxRow!.conversationId).toBe(sent.conversationId);
    const draftRow = await t.run((ctx) => ctx.db.get(prep.draftId as never));
    expect(draftRow!.status).toBe("sent");

    // Duplicate prevention #1: same draft again.
    await expect(
      owner.mutation(api.clientUpdates.queueForSend, { draftId: prep.draftId as never }),
    ).rejects.toThrow(/already sent/);

    // Duplicate prevention #2: a NEW draft with the SAME development
    // set (same set key) is refused — the same update cannot go twice.
    const prep2 = await owner.mutation(api.clientUpdates.prepareDraft, {
      matterId: firm.matterId as never,
      developmentIds: [devs.writtenStatement as never, devs.hearingHeld as never], // different order
    });
    await owner.mutation(api.clientUpdates.approveDraft, { draftId: prep2.draftId as never });
    await expect(
      owner.mutation(api.clientUpdates.queueForSend, { draftId: prep2.draftId as never }),
    ).rejects.toThrow(/already sent on/);

    // In-thread delivery through the outbox posts the message.
    await owner.mutation(api.commOutbox.attemptDelivery, { outboxId: sent.outboxId as never });
    const outboxDelivered = await t.run((ctx) => ctx.db.get(sent.outboxId as never));
    expect(outboxDelivered!.status).toBe("delivered");
    const threadMessages = await t.run((ctx) =>
      ctx.db
        .query("messages")
        .filter((q) => q.eq(q.field("conversationId"), sent.conversationId))
        .collect(),
    );
    expect(threadMessages.some((m) => m.body.includes("Hearing held before the Joint Registrar"))).toBe(true);
    expect(threadMessages.some((m) => m.body.includes(UPDATE_FOOTER))).toBe(true);

    // SEND-TIME RE-VERIFICATION: a development changed after approval
    // blocks the send with a regenerate instruction.
    const prep3 = await owner.mutation(api.clientUpdates.prepareDraft, {
      matterId: firm.matterId as never,
      developmentIds: [devs.hearingHeld as never],
    });
    await owner.mutation(api.clientUpdates.approveDraft, { draftId: prep3.draftId as never });
    await asUser(t, "system").run(async (ctx) => {
      await ctx.db.patch(devs.hearingHeld as never, {
        detail: "CORRECTED after approval: matter adjourned, not heard.",
        updatedAt: Date.now(),
      });
    });
    const review3 = await owner.query(api.clientUpdates.draftReview, {
      draftId: prep3.draftId as never,
    });
    expect(review3!.provenanceState.ok).toBe(false);
    expect(review3!.provenanceState.problems[0]!.problem).toBe("changed");
    await expect(
      owner.mutation(api.clientUpdates.queueForSend, { draftId: prep3.draftId as never }),
    ).rejects.toThrow(/Regenerate the draft/);

    // A downgraded development (needs_review) blocks too.
    const prep4 = await owner.mutation(api.clientUpdates.prepareDraft, {
      matterId: firm.matterId as never,
      developmentIds: [devs.writtenStatement as never],
    });
    await owner.mutation(api.clientUpdates.approveDraft, { draftId: prep4.draftId as never });
    await asUser(t, "system").run(async (ctx) => {
      await ctx.db.patch(devs.writtenStatement as never, { status: "needs_review", updatedAt: Date.now() });
    });
    await expect(
      owner.mutation(api.clientUpdates.queueForSend, { draftId: prep4.draftId as never }),
    ).rejects.toThrow(/not_approved|Regenerate/);
  });

  it("recipient permission display honours recorded preferences; cross-tenant is hidden", async () => {
    const firm = await seedFirm(t);
    const owner = asUser(t, firm.ownerId);

    // Link a portal account to the client and record preferences:
    // client updates NOT accepted, WhatsApp opted in — displayed honestly.
    const clientUserId = await asUser(t, "system").run(async (ctx) => {
      const uid = await ctx.db.insert("users", {
        name: "Client Portal User (synthetic)",
        email: "client-portal@t22.test",
        emailVerified: true,
        isAnonymous: false,
        isPlatformAdmin: false,
      });
      await ctx.db.patch(firm.clientId as never, { userId: uid as never });
      await ctx.db.insert("commPreferences", {
        orgId: firm.orgId as never,
        userId: uid as never,
        emailEnabled: true,
        whatsappEnabled: true,
        hearingReminders: true,
        invoiceReminders: false,
        clientUpdates: false,
        updatedAt: Date.now(),
      });
      return uid;
    });

    const devId = await asUser(t, "system").run((ctx) =>
      ctx.db.insert("matterTimeline", {
        orgId: firm.orgId as never,
        matterId: firm.matterId as never,
        entryKind: "event" as const,
        title: "Summons served on the defendants",
        date: "2026-09-30",
        datePrecision: "exact" as const,
        status: "approved" as const,
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const prep = await owner.mutation(api.clientUpdates.prepareDraft, {
      matterId: firm.matterId as never,
      developmentIds: [devId as never],
    });
    const review = await owner.query(api.clientUpdates.draftReview, {
      draftId: prep.draftId as never,
    });
    const rec = review!.recipients[0]!;
    expect(rec.userId).toBe(clientUserId);
    expect(rec.hasPortalAccount).toBe(true);
    expect(rec.clientUpdatesPreference).toBe(false); // recorded as NO — shown, not treated as consent
    expect(rec.whatsappOptIn).toBe(true);
    expect(rec.clientThreadExists).toBe(false);

    // Cross-tenant: rival org sees NOTHING and can act on nothing.
    const rivalId = await asUser(t, "system").run(async (ctx) => {
      const uid = await ctx.db.insert("users", {
        email: "rival@t22.test",
        emailVerified: true,
        isAnonymous: false,
        isPlatformAdmin: false,
      });
      const orgId = await ctx.db.insert("organizations", {
        name: "Rival T22",
        slug: "rival-t22",
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
    expect(
      await rival.query(api.clientUpdates.draftReview, { draftId: prep.draftId as never }),
    ).toBeNull();
    expect(
      await rival.query(api.clientUpdates.listDevelopments, { matterId: firm.matterId as never }),
    ).toEqual([]);
    const rivalList = await rival.query(api.clientUpdates.listDrafts, {
      matterId: firm.matterId as never,
    });
    expect(rivalList!.drafts).toEqual([]);
    await expect(
      rival.mutation(api.clientUpdates.approveDraft, { draftId: prep.draftId as never }),
    ).rejects.toThrow();
    await expect(
      rival.mutation(api.clientUpdates.queueForSend, { draftId: prep.draftId as never }),
    ).rejects.toThrow();
  });
});
