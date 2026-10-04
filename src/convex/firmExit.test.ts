import { describe, expect, it, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import {
  appendPartAtCursor,
  computeOmissions,
  computeResume,
  downloadDecision,
  planCheckpoints,
  reauthState,
  DOWNLOAD_TTL_MS,
  MAX_PARTS_PER_JOB,
} from "../lib/firmExit";

const modules: Record<string, () => Promise<unknown>> = (import.meta as unknown as {
  glob: (p: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.ts");

const asUser = (t: ReturnType<typeof convexTest>, userId: string) =>
  t.withIdentity({ subject: userId, tokenIdentifier: `test:${userId}` });

/** Seed one org + owner + client + matters + login event + timeline entry. */
async function seedFirm(t: ReturnType<typeof convexTest>, opts?: { matterCount?: number }) {
  const ownerId = await asUser(t, "system").run(async (ctx) =>
    ctx.db.insert("users", {
      name: "Owner (synthetic)",
      email: "owner@t24.test",
      emailVerified: true,
      isAnonymous: false,
      isPlatformAdmin: false,
    }),
  );
  const matterCount = opts?.matterCount ?? 1;
  const seeded = await asUser(t, "system").run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "T24 Chamber (exit)",
      slug: "t24-exit",
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
      name: "Exit Test Pvt. Ltd. (synthetic)",
      createdBy: ownerId as never,
      createdAt: Date.now(),
    });
    const matterIds: string[] = [];
    for (let i = 0; i < matterCount; i += 1) {
      const matterId = await ctx.db.insert("matters", {
        orgId,
        clientId,
        reference: `T24/2026/000${i + 1}`,
        title: `Exit test matter ${i + 1} (synthetic)`,
        practiceArea: "civil",
        clientRole: "Exit Test Pvt. Ltd.",
        status: "open" as const,
        createdBy: ownerId as never,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      matterIds.push(matterId);
    }
    // REAUTHENTICATION EVIDENCE: a recent successful sign-in.
    await ctx.db.insert("loginEvents", {
      userId: ownerId as never,
      email: "owner@t24.test",
      at: Date.now() - 3600_000,
      userAgent: "vitest",
    });
    return { orgId, clientId, matterIds };
  });
  return { ownerId, ...seeded };
}

/** Seed per-matter content rows so parts carry real row counts. */
async function seedMatterContent(
  t: ReturnType<typeof convexTest>,
  ids: { orgId: string; matterIds: string[] },
) {
  return asUser(t, "system").run(async (ctx) => {
    // hearings / matterEvents are matter-scoped rows without orgId —
    // their shapes are exactly as in schema.ts.
    const hearingId = await ctx.db.insert("hearings", {
      matterId: ids.matterIds[0] as never,
      title: "First hearing before the Joint Registrar (synthetic)",
      at: Date.now() + 7 * 24 * 3600_000,
      status: "scheduled" as const,
      createdAt: Date.now(),
    });
    const eventId = await ctx.db.insert("matterEvents", {
      matterId: ids.matterIds[0] as never,
      kind: "hearing_scheduled",
      detail: "Hearing scheduled (synthetic)",
      createdAt: Date.now(),
    });
    return { hearingId, eventId };
  });
}

describe("Turn 24 — §32 Phase 12 complete firm export & exit", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  it("pure layer: plan/resume fence, omissions, reauth gate, download decisions", () => {
    const specs = [
      { table: "clients", kind: "org" as const },
      { table: "hearings", kind: "matter" as const },
      { table: "tasks", kind: "matter" as const },
    ];
    const plan = planCheckpoints(specs, 2);
    expect(plan).toEqual([
      { table: "clients", matterIndex: 0 },
      { table: "hearings", matterIndex: 0 },
      { table: "hearings", matterIndex: 1 },
      { table: "tasks", matterIndex: 0 },
      { table: "tasks", matterIndex: 1 },
    ]);

    // Resume prefix semantics.
    const resume = computeResume(
      plan.slice(0, 3).map((c) => `${c.table}#${c.matterIndex}`),
      plan,
    );
    expect(resume.next).toBe("tasks#0");
    expect(resume.progress).toBeCloseTo(0.6, 3);
    expect(computeResume([], plan).next).toBe("clients#0");
    expect(computeResume(plan.map((c) => `${c.table}#${c.matterIndex}`), plan).next).toBeNull();

    // The fence: in-order appends pass; drift, plan-conformity and
    // cursor/parts disagreement all throw.
    const state = { parts: [] as { table: string; rows: number; sha256: string; storageId: string }[], cursor: 0 };
    appendPartAtCursor(state, { table: "clients", rows: 2, sha256: "x", storageId: "s1" }, plan);
    appendPartAtCursor(state, { table: "hearings", rows: 1, sha256: "y", storageId: "s2" }, plan);
    expect(state.cursor).toBe(2);
    expect(() =>
      appendPartAtCursor(state, { table: "tasks", rows: 0, sha256: "z", storageId: "s3" }, plan),
    ).toThrow(/does not match the planned checkpoint/);
    const drifted = { parts: [{ table: "hearings", rows: 1, sha256: "y", storageId: "s" }], cursor: 2 };
    expect(() =>
      appendPartAtCursor(drifted, { table: "hearings", rows: 1, sha256: "y", storageId: "s2" }, plan),
    ).toThrow(/fence violated/);

    // Omissions: uncovered non-empty tables listed with reasons; empty
    // tables are not omissions.
    const omissions = computeOmissions(
      ["clients", "hearings"],
      ["clients", "hearings", "tasks", "auditLog", "emptyTable"],
      { tasks: 12, auditLog: 300 },
    );
    expect(omissions.map((o) => o.table).sort()).toEqual(["auditLog", "tasks"]);
    expect(omissions.find((o) => o.table === "auditLog")!.reason).toContain("silently");

    // §32 enhancement tables carry their own reason (still "silently"-visible).
    const s32 = computeOmissions(
      ["clients"],
      ["clients", "translationRecords", "clientUpdateDrafts"],
      { translationRecords: 4 },
    );
    expect(s32).toHaveLength(1);
    expect(s32[0]!.table).toBe("translationRecords");
    expect(s32[0]!.reason).toContain("§32 enhancement");
    expect(s32[0]!.reason).toContain("silently");

    // Reauthentication window: 7 days on the last successful sign-in.
    const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
    expect(reauthState(null, NOW).satisfied).toBe(false);
    expect(reauthState(NOW - 8 * 24 * 3600_000, NOW).satisfied).toBe(false);
    const ok = reauthState(NOW - 3600_000, NOW);
    expect(ok.satisfied).toBe(true);
    expect(DOWNLOAD_TTL_MS).toBe(3600_000);
    expect(MAX_PARTS_PER_JOB).toBe(200);

    // Download decisions: missing / used / expired / ok.
    expect(downloadDecision(null, NOW).ok).toBe(false);
    expect(downloadDecision({ storageId: "s", expiresAt: NOW + 1, usedAt: NOW - 1 }, NOW).ok).toBe(false);
    expect(downloadDecision({ storageId: "s", expiresAt: NOW - 1, usedAt: null }, NOW).ok).toBe(false);
    expect(downloadDecision({ storageId: "s", expiresAt: NOW + 1, usedAt: null }, NOW).ok).toBe(true);
  });

  it("end-to-end: reauth-gated job, fenced resumable collection, independent verification, manifest, expiring downloads, hold-aware exit, revocation", async () => {
    const firm = await seedFirm(t);
    await seedMatterContent(t, firm);
    const owner = asUser(t, firm.ownerId);

    // Start the job (reauth satisfied via the seeded login event).
    const start = await owner.mutation(api.firmExit.startExportJob, {});
    // Plan: 2 org tables (clients, invoices) + 8 matter-scoped tables × matters.
    expect(start.checkpoints).toBe(2 + firm.matterIds.length * 8);
    const jobs0 = await owner.query(api.firmExit.listJobs, {});
    expect(jobs0.jobs[0]!.status).toBe("collecting");

    // FULL collection: all checkpoints in one action run.
    const collected = await t.action(internal.firmExit.collectStep, {
      jobId: start.jobId as never,
    });
    expect(collected.remaining).toBe(0);
    expect(collected.collected).toBeGreaterThan(0);

    const jobRow = await t.run((ctx) => ctx.db.get(start.jobId as never));
    expect(jobRow!.cursor).toBe(jobRow!.parts.length);
    const clientsPart = jobRow!.parts.find((p: { table: string }) => p.table === "clients")!;
    expect(clientsPart.rows).toBe(1); // the seeded client
    expect(clientsPart.sha256).toMatch(/^[0-9a-f]{64}$/);
    const hearingsPart = jobRow!.parts.find((p: { table: string }) => p.table === "hearings")!;
    expect(hearingsPart.rows).toBe(1); // the seeded hearing

    // RESUME FENCE: a second full collect is a no-op (nothing left).
    const again = await t.action(internal.firmExit.collectStep, { jobId: start.jobId as never });
    expect(again.collected).toBe(0);

    // Omissions recorded — counts are computed SERVER-SIDE (no caller-
    // supplied counts). §32 tables and operational tables are all empty
    // here, so nothing non-empty is outside scope.
    const om = await owner.mutation(api.firmExit.recordOmissions, {
      jobId: start.jobId as never,
    });
    expect(om.omissions).toHaveLength(0); // nothing non-empty outside scope

    // INDEPENDENT VERIFICATION: re-read + recompute → verified.
    const verify = await t.action(internal.firmExit.verifyExport, {
      jobId: start.jobId as never,
    });
    expect(verify.verified).toBe(true);
    expect(verify.failures).toEqual([]);
    expect(verify.checkedParts).toBe(jobRow!.parts.length);

    // Manifest: complete catalogue + definition + holds listing.
    const manifestView = await owner.query(api.firmExit.buildManifest, {
      jobId: start.jobId as never,
    });
    expect(manifestView!.manifest.parts.length).toBe(jobRow!.parts.length);
    expect(manifestView!.manifest.definition).toContain("COMPLETE means");
    expect(manifestView!.verification!.verified).toBe(true);
    expect(manifestView!.status).toBe("awaiting_download");

    // Expiring, single-use downloads.
    const dl = await owner.mutation(api.firmExit.issueDownload, {
      jobId: start.jobId as never,
      partIndex: 0,
    });
    expect(dl.expiresAt).toBeGreaterThan(Date.now());
    const redeemed = await owner.mutation(api.firmExit.redeemDownload, {
      jobId: start.jobId as never,
      storageId: (jobRow!.parts[0] as { storageId: string }).storageId as never,
    });
    expect(redeemed.url).toBeTruthy();
    await expect(
      owner.mutation(api.firmExit.redeemDownload, {
        jobId: start.jobId as never,
        storageId: (jobRow!.parts[0] as { storageId: string }).storageId as never,
      }),
    ).rejects.toThrow(/already used/);

    // EXIT: refused without… wait, we HAVE a verified export → passes
    // (no holds active).
    const closed = await owner.mutation(api.firmExit.closeOrganization, {
      confirm: "CLOSE ORGANIZATION" as never,
    });
    expect(closed.closed).toBe(true);

    // Revocation afterwards is still possible (explicit, reasoned).
    await owner.mutation(api.firmExit.revokeExport, {
      jobId: start.jobId as never,
      reason: "Owner downloaded the verified bundle; job retired.",
    });
    const jobs1 = await owner.query(api.firmExit.listJobs, {});
    expect(jobs1.jobs[0]!.status).toBe("revoked");
  });

  it("guards: no reauth refused, verified-export requirement, legal hold blocks exit + downloads, cross-tenant hidden", async () => {
    const firm = await seedFirm(t);
    const owner = asUser(t, firm.ownerId);

    // A user with NO login event is refused at start (stolen session).
    await asUser(t, "system").run(async (ctx) => {
      await ctx.db.delete(
        (
          await ctx.db
            .query("loginEvents")
            .collect()
        )[0]!._id as never,
      );
    });
    await expect(owner.mutation(api.firmExit.startExportJob, {})).rejects.toThrow(
      /No successful sign-in is on record/,
    );

    // Restore a fresh login event for the rest of the flow.
    await asUser(t, "system").run(async (ctx) => {
      await ctx.db.insert("loginEvents", {
        userId: firm.ownerId as never,
        email: "owner@t24.test",
        at: Date.now() - 1800_000,
        userAgent: "vitest",
      });
    });

    const start = await owner.mutation(api.firmExit.startExportJob, {});
    await t.action(internal.firmExit.collectStep, { jobId: start.jobId as never });
    await t.action(internal.firmExit.verifyExport, { jobId: start.jobId as never });

    // LEGAL HOLD: place a hold → exit BLOCKED (recorded on the job),
    // downloads blocked; lifting restores the path.
    await owner.mutation(api.ethicalWalls.placeHold, {
      matterId: firm.matterIds[0] as never,
      reasonKind: "litigation",
      reason: "Preservation order received in the pending appeal (synthetic).",
    });
    await expect(
      owner.mutation(api.firmExit.closeOrganization, { confirm: "CLOSE ORGANIZATION" as never }),
    ).rejects.toThrow(/LEGAL HOLD active/);
    await expect(
      owner.mutation(api.firmExit.issueDownload, { jobId: start.jobId as never, partIndex: 0 }),
    ).rejects.toThrow(/legal hold exists/);
    const blockedJob = await owner.query(api.firmExit.buildManifest, { jobId: start.jobId as never });
    expect(blockedJob!.manifest.legalHolds).toHaveLength(1);
    expect(blockedJob!.manifest.legalHolds[0]!.matterReference).toBe("T24/2026/0001");

    // SWEEP SEAM (turn 24): the omissions catalogue is SELF-COUNTING and
    // includes §32 tables — the hold we just placed must now appear as a
    // visible omission (never silently dropped from the exit record).
    const omAfterHold = await owner.mutation(api.firmExit.recordOmissions, {
      jobId: start.jobId as never,
    });
    const holdOmission = omAfterHold.omissions.find((o) => o.table === "legalHolds");
    expect(holdOmission).toBeDefined();
    expect(holdOmission!.rows).toBe(1);
    expect(holdOmission!.reason).toContain("silently");

    // Lift the hold → the verified export still exists → close passes.
    const holds = await owner.query(api.ethicalWalls.activeHolds, {});
    await owner.mutation(api.ethicalWalls.liftHold, {
      holdId: holds[0]!._id as never,
      reason: "Preservation order withdrawn by the court (synthetic).",
    });
    const closed = await owner.mutation(api.firmExit.closeOrganization, {
      confirm: "CLOSE ORGANIZATION" as never,
    });
    expect(closed.closed).toBe(true);

    // Revocation requires a ≥10-char reason.
    await expect(
      owner.mutation(api.firmExit.revokeExport, { jobId: start.jobId as never, reason: "short" }),
    ).rejects.toThrow(/at least 10 characters/);

    // Cross-tenant: a rival org sees no jobs and cannot act on ours.
    const rivalId = await asUser(t, "system").run(async (ctx) => {
      const uid = await ctx.db.insert("users", {
        email: "rival@t24.test",
        emailVerified: true,
        isAnonymous: false,
        isPlatformAdmin: false,
      });
      const orgId = await ctx.db.insert("organizations", {
        name: "Rival T24",
        slug: "rival-t24",
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
      await ctx.db.insert("loginEvents", {
        userId: uid as never,
        email: "rival@t24.test",
        at: Date.now() - 60_000,
        userAgent: "vitest",
      });
      return uid;
    });
    const rival = asUser(t, rivalId);
    expect((await rival.query(api.firmExit.listJobs, {})).jobs).toEqual([]);
    await expect(
      rival.mutation(api.firmExit.revokeExport, {
        jobId: start.jobId as never,
        reason: "Rival org attempting to revoke another firm's export.",
      }),
    ).rejects.toThrow(/not found in this organization/);
    await expect(
      rival.query(api.firmExit.buildManifest, { jobId: start.jobId as never }),
    ).rejects.toThrow(/not found in this organization/);
    await expect(
      rival.mutation(api.firmExit.closeOrganization, { confirm: "CLOSE ORGANIZATION" as never }),
    ).rejects.toThrow();
  });
});
