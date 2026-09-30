import { describe, expect, it, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules: Record<string, () => Promise<unknown>> = (import.meta as unknown as {
  glob: (p: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.ts");

const asUser = (t: ReturnType<typeof convexTest>, userId: string) =>
  t.withIdentity({ subject: userId, tokenIdentifier: `test:${userId}` });

async function seedFirm(t: ReturnType<typeof convexTest>) {
  const ownerId = await asUser(t, "system").run(async (ctx) =>
    ctx.db.insert("users", {
      email: "owner@firm.test",
      emailVerified: true,
      isAnonymous: false,
      isPlatformAdmin: false,
    }),
  );
  const { orgId, clientId, matterId } = await asUser(t, "system").run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Drill Chamber (synthetic)",
      slug: "drill-firm",
      kind: "chamber",
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
      orgRole: "owner",
      status: "active",
      createdAt: Date.now(),
    });
    await ctx.db.patch(ownerId as never, { activeOrgId: orgId });
    const clientId = await ctx.db.insert("clients", {
      orgId,
      kind: "individual",
      name: "Drill Client",
      createdBy: ownerId as never,
      createdAt: Date.now(),
    });
    const matterId = await ctx.db.insert("matters", {
      orgId,
      clientId,
      reference: "DR/2026/0001",
      title: "Drill matter",
      practiceArea: "criminal",
      status: "open",
      createdBy: ownerId as never,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("hearings", {
      matterId,
      title: "First hearing",
      at: Date.now() + 86_400_000,
      status: "scheduled",
      createdAt: Date.now(),
    });
    await ctx.db.insert("orders", {
      matterId,
      title: "Interim order",
      passedOn: Date.now(),
      createdAt: Date.now(),
    });
    await ctx.db.insert("tasks", {
      matterId,
      orgId,
      title: "File vakalatnama",
      kind: "filing",
      priority: "high",
      status: "pending",
      createdById: ownerId as never,
      createdAt: Date.now(),
    });
    await ctx.db.insert("invoices", {
      orgId,
      number: "DR/2026/0001",
      matterId,
      clientId,
      status: "sent",
      subtotalMinor: 10_000,
      taxModel: "none",
      totalMinor: 10_000,
      amountPaidMinor: 0,
      issuedOn: "2026-09-30",
      createdBy: ownerId as never,
      createdAt: Date.now(),
    });
    await ctx.db.insert("matterEvents", {
      matterId,
      kind: "note",
      detail: "Matter opened.",
      createdAt: Date.now(),
    });
    return { orgId, clientId, matterId };
  });
  return { ownerId, orgId, clientId, matterId };
}

describe("Restore verification (§24 restore test, automated drill)", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  it("restores an archive into a sandbox with exact count verification, then purges it", async () => {
    const { ownerId } = await seedFirm(t);

    // 1. Archive the org the same way the UI does.
    const archiveResult = await asUser(t, ownerId).action(api.backups.archiveExport, {
      label: "drill source archive",
    });
    expect(archiveResult.counts.matters).toBe(1);
    expect(archiveResult.counts.hearings).toBe(1);
    expect(archiveResult.counts.orders).toBe(1);
    expect(archiveResult.counts.tasks).toBe(1);
    expect(archiveResult.counts.invoices).toBe(1);
    expect(archiveResult.counts.events).toBe(1);

    // 2. Run the drill: sandbox restore → verify → purge.
    const owner = await asUser(t, "system").run((ctx) => ctx.db.get(ownerId));
    const orgId = owner!.activeOrgId!;
    const recs = await asUser(t, "system").run(async (ctx) =>
      ctx.db
        .query("backupRecords")
        .filter((q) => q.eq(q.field("orgId"), orgId))
        .collect(),
    );
    const archiveRow = recs.find((r) => r.kind === "archive_export")!;
    expect(archiveRow.storageId).toBeDefined();

    // The FULL owner-facing drill: latest archive → sandbox restore →
    // verify → purge → register the result.
    const drill = await asUser(t, ownerId).action(api.restoreVerification.runRestoreDrill, {});
    expect(drill.result).toBe("passed");
    expect(drill.verified.matters).toBe(1);
    expect(drill.verified.hearings).toBe(1);

    // The sandbox existed only transiently — purged after verification.
    const orgsAfter = await asUser(t, "system").run((ctx) =>
      ctx.db.query("organizations").collect(),
    );
    expect(
      orgsAfter.filter((o) => o.slug.startsWith("restore-sandbox-")),
    ).toHaveLength(0);

    // 3. The drill is on the restore-test register, honestly.
    const register = await asUser(t, "system").run(async (ctx) =>
      ctx.db
        .query("backupRecords")
        .filter((q) => q.eq(q.field("orgId"), orgId))
        .collect(),
    );
    const drillRow = register.find((r) => r.kind === "restore_test");
    expect(drillRow).toBeDefined();
    expect(drillRow!.result).toBe("passed");
    expect(drillRow!.environment).toContain("restore-sandbox");
  });

  it("refuses to purge anything that is not a restore sandbox", async () => {
    const { orgId } = await seedFirm(t);
    await expect(
      t.mutation(internal.restoreVerification.purgeSandboxInternal, {
        orgId: orgId as never,
      }),
    ).rejects.toThrow(/not a restore sandbox/);
  });

  it("fails loudly when archive counts and restored rows disagree", async () => {
    const { ownerId } = await seedFirm(t);
    await asUser(t, ownerId).action(api.backups.archiveExport, {});
    const owner = await asUser(t, "system").run((ctx) => ctx.db.get(ownerId));
    const orgId = owner!.activeOrgId!;
    const recs = await asUser(t, "system").run(async (ctx) =>
      ctx.db
        .query("backupRecords")
        .filter((q) => q.eq(q.field("orgId"), orgId))
        .collect(),
    );
    const archiveRow = recs.find((r) => r.kind === "archive_export")!;

    // Fetch the stored archive, tamper with the counts, store as new blob.
    const stored = await t.action(
      internal.restoreVerificationTestHelper.readArchiveJson,
      { storageId: archiveRow.storageId! },
    );
    const parsed = JSON.parse(stored);
    parsed.counts.hearings = 99;
    const tampered = JSON.stringify(parsed);

    const { newStorageId } = await t.action(
      internal.restoreVerificationTestHelper.storeArchiveJson,
      { json: tampered },
    );

    await expect(
      t.action(internal.restoreVerification.restoreIntoSandbox, {
        archiveStorageId: newStorageId as never,
        performedById: ownerId as never,
      }),
    ).rejects.toThrow(/RESTORE VERIFICATION FAILED/);

    // The failed drill left no sandbox behind.
    const orgs = await asUser(t, "system").run((ctx) =>
      ctx.db.query("organizations").collect(),
    );
    expect(orgs.filter((o) => o.slug.startsWith("restore-sandbox-"))).toHaveLength(0);
  });
});
