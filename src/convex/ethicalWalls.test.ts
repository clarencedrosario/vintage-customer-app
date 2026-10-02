import { describe, expect, it, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { DEADLINE_CATEGORIES } from "./constants";

const modules: Record<string, () => Promise<unknown>> = (import.meta as unknown as {
  glob: (p: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.ts");

const asUser = (t: ReturnType<typeof convexTest>, userId: string) =>
  t.withIdentity({ subject: userId, tokenIdentifier: `test:${userId}` });

/** Seed one org + owner + client + matter (+ an associate member). */
async function seedFirm(t: ReturnType<typeof convexTest>) {
  const ownerId = await asUser(t, "system").run(async (ctx) =>
    ctx.db.insert("users", {
      email: "owner@t19.test",
      emailVerified: true,
      isAnonymous: false,
      isPlatformAdmin: false,
    }),
  );
  const associateId = await asUser(t, "system").run(async (ctx) =>
    ctx.db.insert("users", {
      email: "associate@t19.test",
      emailVerified: true,
      isAnonymous: false,
      isPlatformAdmin: false,
    }),
  );
  const seeded = await asUser(t, "system").run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "T19 Chamber (walls)",
      slug: "t19-walls",
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
    for (const [uid, role] of [
      [ownerId, "owner"],
      [associateId, "associate"],
    ] as const) {
      await ctx.db.insert("memberships", {
        orgId,
        userId: uid as never,
        orgRole: role as never,
        status: "active" as const,
        createdAt: Date.now(),
      });
      await ctx.db.patch(uid as never, { activeOrgId: orgId });
    }
    const clientId = await ctx.db.insert("clients", {
      orgId,
      kind: "company" as const,
      name: "Walltest Industries Pvt. Ltd. (synthetic)",
      createdBy: ownerId as never,
      createdAt: Date.now(),
    });
    const matterId = await ctx.db.insert("matters", {
      orgId,
      clientId,
      reference: "T19/2026/0001",
      title: "Wall test matter (synthetic)",
      practiceArea: "civil",
      clientRole: "Walltest Industries Pvt. Ltd.",
      opposingParty: "Opposing Party (synthetic)",
      court: "City Civil Court",
      status: "open" as const,
      createdBy: ownerId as never,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { orgId, clientId, matterId };
  });
  return { ownerId, associateId, ...seeded };
}

describe("Turn 19 — §32 Phase 7 legal holds & ethical walls", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  it("legal hold blocks vault.remove for EVERY role; lifting is explicit, capability-gated and audited", async () => {
    const { ownerId, matterId } = await seedFirm(t);
    const owner = asUser(t, ownerId);

    // A stored document to try to delete.
    const { documentId } = await asUser(t, "system").run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["hold me"]));
      return {
        documentId: await ctx.db.insert("matterDocuments", {
          matterId: matterId as never,
          uploaderId: ownerId as never,
          name: "evidence.txt",
          kind: "document" as const,
          visibility: "internal" as const,
          storageId,
          createdAt: Date.now(),
        }),
      };
    });

    // Owner places the hold (matter.close capability).
    const { holdId } = await owner.mutation(api.ethicalWalls.placeHold, {
      matterId: matterId as never,
      reasonKind: "litigation",
      reason: "Preservation duty: scheduled trial, records must survive intact.",
    });
    // A second active hold is refused.
    await expect(
      owner.mutation(api.ethicalWalls.placeHold, {
        matterId: matterId as never,
        reasonKind: "audit",
        reason: "A duplicate hold must not be created.",
      }),
    ).rejects.toThrow(/already exists/);

    // Deletion is blocked FOR THE OWNER TOO — no role bypasses a hold.
    await expect(
      owner.mutation(api.vault.remove, { documentId: documentId as never }),
    ).rejects.toThrow(/legal hold/i);

    // Lifting requires the capability...
    await expect(
      asUser(t, "system").run((ctx) =>
        ctx.runMutation(api.ethicalWalls.liftHold, {
          holdId: holdId as never,
          reason: "Not allowed without matter.close.",
        }),
      ),
    ).rejects.toThrow();

    // ...a real reason...
    await expect(
      owner.mutation(api.ethicalWalls.liftHold, {
        holdId: holdId as never,
        reason: "short",
      }),
    ).rejects.toThrow(/at least 10 characters/);

    // ...and is an explicit, recorded decision. After lifting, deletion
    // works again.
    await owner.mutation(api.ethicalWalls.liftHold, {
      holdId: holdId as never,
      reason: "Preservation duty ended — trial record formally closed.",
    });
    await owner.mutation(api.vault.remove, { documentId: documentId as never });

    const audits = await asUser(t, "system").run((ctx) =>
      ctx.db.query("auditLog").collect(),
    );
    expect(audits.some((a) => a.action === "Legal hold placed")).toBe(true);
    expect(audits.some((a) => a.action === "Legal hold lifted")).toBe(true);
    expect(audits.some((a) => a.action === "Vault delete")).toBe(true);
  });

  it("wall restricts every human path (detail, list, §32 surfaces) while the exempt actor keeps access", async () => {
    const { ownerId, associateId, matterId } = await seedFirm(t);
    const owner = asUser(t, ownerId);
    const associate = asUser(t, associateId);

    // Pre-wall: the associate (matter.view_all) can see the matter.
    expect(
      await associate.query(api.matters.get, { matterId: matterId as never }),
    ).not.toBeNull();

    // Guards first: an associate cannot erect walls...
    await expect(
      associate.mutation(api.ethicalWalls.createWall, {
        title: "Hostile wall",
        matterIds: [matterId as never],
        scope: { kind: "user", userId: ownerId as never },
        reason: "Associates must not be able to wall anyone out.",
      }),
    ).rejects.toThrow();
    // ...a wall scoping the CREATOR without explicit exemption is refused...
    await expect(
      owner.mutation(api.ethicalWalls.createWall, {
        title: "Self-walling",
        matterIds: [matterId as never],
        scope: { kind: "user", userId: ownerId as never },
        reason: "Creator inside scope without exemption must be refused.",
      }),
    ).rejects.toThrow(/exemptActorIds/);
    // ...and named users outside the org are refused.
    await expect(
      owner.mutation(api.ethicalWalls.createWall, {
        title: "Ghost user",
        scope: { kind: "user", userId: "ghost" as never },
        reason: "Named users must be active members of this org.",
      }),
    ).rejects.toThrow();

    const { wallId } = await owner.mutation(api.ethicalWalls.createWall, {
      title: "Conflict wall — former client (synthetic)",
      matterIds: [matterId as never],
      scope: { kind: "user", userId: associateId as never },
      exemptActorIds: [ownerId as never],
      reason:
        "The associate previously advised the opposing party; screen every retrieval path.",
    });

    // DETAIL: gone for the walled associate (matterOrNull → null)...
    expect(
      await associate.query(api.matters.get, { matterId: matterId as never }),
    ).toBeNull();
    // ...and WRITES through the same gate are refused (requireMatter).
    await expect(
      associate.mutation(api.matterImpact.setOptIn, {
        matterId: matterId as never,
        enabled: true,
      }),
    ).rejects.toThrow(/ethical wall/i);

    // LIST: the walled matter is not advertised.
    expect(
      (await associate.query(api.matters.list, {})).map((m) => m._id),
    ).not.toContain(matterId);

    // §32 SURFACES: every matter-scoped read returns nothing.
    expect(
      await associate.query(api.conflictReview.list, {
        matterId: matterId as never,
      }),
    ).toEqual([]);
    expect(
      await associate.query(api.evidenceBundles.listForMatter, {
        matterId: matterId as never,
      }),
    ).toEqual([]);
    expect(
      await associate.query(api.filingReadiness.getDraft, {
        matterId: matterId as never,
      }),
    ).toBeNull();
    expect(
      await associate.query(api.matterImpact.list, {
        matterId: matterId as never,
      }),
    ).toEqual([]);

    // The EXEMPT owner keeps full access.
    expect(
      await owner.query(api.matters.get, { matterId: matterId as never }),
    ).not.toBeNull();
    expect(
      (await owner.query(api.matters.list, {})).map((m) => m._id),
    ).toContain(matterId);

    // The wall EXPLAINS itself instead of a bare refusal.
    const assocExp = await associate.query(api.ethicalWalls.wallExplanation, {
      matterId: matterId as never,
    });
    expect(assocExp.walled).toBe(true);
    expect(assocExp.walls[0]!.title).toContain("Conflict wall");
    const ownerExp = await owner.query(api.ethicalWalls.wallExplanation, {
      matterId: matterId as never,
    });
    expect(ownerExp.walled).toBe(false);
    expect(ownerExp.walls[0]!.exempt).toBe(true);

    // Lifting restores access; the wall keeps its audit trail.
    await owner.mutation(api.ethicalWalls.liftWall, {
      wallId: wallId as never,
      reason: "Conflict cleared by the partners after reassignment.",
    });
    expect(
      await associate.query(api.matters.get, { matterId: matterId as never }),
    ).not.toBeNull();
  });

  it("emergency grant is the ONLY route past a wall: unacknowledged opens nothing, expiry closes it, revoke works", async () => {
    const { ownerId, associateId, matterId } = await seedFirm(t);
    const owner = asUser(t, ownerId);
    const associate = asUser(t, associateId);

    const { wallId } = await owner.mutation(api.ethicalWalls.createWall, {
      title: "Investigation wall (synthetic)",
      matterIds: [matterId as never],
      scope: { kind: "user", userId: associateId as never },
      reason: "Internal investigation screen pending partner review.",
    });

    // Grant for the walled associate, issued by the owner.
    const { grantId } = await owner.mutation(api.ethicalWalls.grantEmergencyAccess, {
      wallId: wallId as never,
      actorId: associateId as never,
      reason: "hold_setup_or_correction",
      detail:
        "Place a litigation hold on the matter before the screen completes.",
      durationMinutes: 60,
    });

    // UNACKNOWLEDGED grants open nothing.
    expect(
      await associate.query(api.matters.get, { matterId: matterId as never }),
    ).toBeNull();
    // Only the holder can acknowledge.
    await expect(
      owner.mutation(api.ethicalWalls.acknowledgeEmergencyAccess, {
        grantId: grantId as never,
      }),
    ).rejects.toThrow(/Only the grant holder/);

    await associate.mutation(api.ethicalWalls.acknowledgeEmergencyAccess, {
      grantId: grantId as never,
    });
    // Acknowledged → access through the wall, with an explanation.
    expect(
      await associate.query(api.matters.get, { matterId: matterId as never }),
    ).not.toBeNull();
    const exp = await associate.query(api.ethicalWalls.wallExplanation, {
      matterId: matterId as never,
    });
    expect(exp.walled).toBe(false);
    expect(exp.walls[0]!.emergencyGrantValid).toBe(true);

    // Expiry closes the route again.
    await asUser(t, "system").run((ctx) =>
      ctx.db.patch(grantId as never, { expiresAt: Date.now() - 1 }),
    );
    expect(
      await associate.query(api.matters.get, { matterId: matterId as never }),
    ).toBeNull();

    // Revoke also closes an active grant (audit keeps the reason).
    const { grantId: grant2 } = await owner.mutation(
      api.ethicalWalls.grantEmergencyAccess,
      {
        wallId: wallId as never,
        actorId: associateId as never,
        reason: "court_order",
        detail: "Court-ordered inspection window, one hour only.",
        durationMinutes: 30,
      },
    );
    await associate.mutation(api.ethicalWalls.acknowledgeEmergencyAccess, {
      grantId: grant2 as never,
    });
    expect(
      await associate.query(api.matters.get, { matterId: matterId as never }),
    ).not.toBeNull();
    await owner.mutation(api.ethicalWalls.revokeEmergencyAccess, {
      grantId: grant2 as never,
      reason: "Inspection completed early; access no longer required.",
    });
    expect(
      await associate.query(api.matters.get, { matterId: matterId as never }),
    ).toBeNull();
  });

  it("background paths honour walls: reminder scan skips walled recipients; AI wall-check sees the wall", async () => {
    const { ownerId, associateId, orgId, clientId } = await seedFirm(t);
    const owner = asUser(t, ownerId);

    // Two matters: one walled, one clean; the associate is responsible
    // for a due-today deadline on each.
    const { walledMatterId, cleanMatterId } = await asUser(t, "system").run(
      async (ctx) => {
        const walledMatterId = await ctx.db.insert("matters", {
          orgId,
          clientId,
          reference: "T19/2026/WALLED",
          title: "Walled matter (synthetic)",
          practiceArea: "civil",
          clientRole: "Walltest Industries Pvt. Ltd.",
          status: "open" as const,
          leadLawyerId: associateId as never,
          createdBy: ownerId as never,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        const cleanMatterId = await ctx.db.insert("matters", {
          orgId,
          clientId,
          reference: "T19/2026/CLEAN",
          title: "Clean matter (synthetic)",
          practiceArea: "civil",
          clientRole: "Walltest Industries Pvt. Ltd.",
          status: "open" as const,
          leadLawyerId: associateId as never,
          createdBy: ownerId as never,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        const mk = async (matterId: string, ref: string) =>
          ctx.db.insert("deadlines", {
            orgId,
            matterId: matterId as never,
            title: `Deadline for ${ref} (synthetic)`,
            category: DEADLINE_CATEGORIES[0]!,
            dueAt: Date.now(), // due today
            status: "open" as const,
            responsibleId: associateId as never,
            createdById: ownerId as never,
            createdAt: Date.now(),
          });
        await mk(walledMatterId, "WALLED");
        await mk(cleanMatterId, "CLEAN");
        return { walledMatterId, cleanMatterId };
      },
    );

    const { wallId } = await owner.mutation(api.ethicalWalls.createWall, {
      title: "Screen — walled matter (synthetic)",
      matterIds: [walledMatterId as never],
      scope: { kind: "user", userId: associateId as never },
      reason: "Associate screened from the walled matter entirely.",
    });

    // The background scan speaks for EACH recipient: the walled
    // deadline is skipped, the clean one still fires.
    await t.run((ctx) => ctx.runMutation(internal.reminders.runScan, {}));
    const notes = await asUser(t, "system").run((ctx) =>
      ctx.db.query("appNotifications").collect(),
    );
    const forAssociate = notes.filter((n) => n.userId === associateId);
    expect(forAssociate).toHaveLength(1);
    expect(forAssociate[0]!.body).toContain("T19/2026/CLEAN");
    expect(forAssociate[0]!.body).not.toContain("T19/2026/WALLED");

    // The AI runner's wall check (the exact internal query the runner
    // calls before processing a job) sees the wall for the associate
    // but not for the exempt owner.
    expect(
      await t.run((ctx) =>
        ctx.runQuery(internal.ethicalWalls.isWalledInternal, {
          orgId,
          userId: associateId as never,
          matterId: walledMatterId as never,
        }),
      ),
    ).toBe(true);
    expect(
      await t.run((ctx) =>
        ctx.runQuery(internal.ethicalWalls.isWalledInternal, {
          orgId,
          userId: ownerId as never,
          matterId: walledMatterId as never,
        }),
      ),
    ).toBe(false);

    await owner.mutation(api.ethicalWalls.liftWall, {
      wallId: wallId as never,
      reason: "Screen lifted after the investigation closed (synthetic).",
    });
  });
});
