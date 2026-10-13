import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

// =====================================================================
// Owner activation — one shared email-verification evidence predicate
// (platform.emailVerificationEvidence) used consistently by
// platform.selfActivateOwner, platform.myOwnerActivationEligibility and
// platform.bootstrapAdmin.
//
// Trusted evidence on this deployment (@convex-dev/auth 0.0.90, email-OTP
// provider): a successful code verification writes
// users.emailVerificationTime and never the users.emailVerified boolean
// (the boolean exists only on authAccounts in that library version — see
// the platform.ts evidence note). An explicit emailVerified:false always
// DENIES. Synthetic data only; no real accounts are touched.
// =====================================================================

const modules: Record<string, () => Promise<unknown>> = (import.meta as unknown as {
  glob: (p: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.ts");

const asUser = (t: ReturnType<typeof convexTest>, userId: string) =>
  t.withIdentity({ subject: userId, tokenIdentifier: `test:${userId}` });

const OWNER_EMAIL = "owner@synthetic.test";
const MISMATCH_EMAIL = "notowner@synthetic.test";

const ENV_KEYS = ["PLATFORM_OWNER_EMAIL"] as const;

async function seedUser(
  t: ReturnType<typeof convexTest>,
  fields: {
    email?: string;
    emailVerified?: boolean;
    emailVerificationTime?: number;
    isAnonymous?: boolean;
  },
): Promise<string> {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: fields.email,
      emailVerified: fields.emailVerified,
      emailVerificationTime: fields.emailVerificationTime,
      isAnonymous: fields.isAnonymous ?? false,
    } as never);
    return String(userId);
  });
}

async function userRow(
  t: ReturnType<typeof convexTest>,
  userId: string,
): Promise<Record<string, unknown> | null> {
  return t.run(async (ctx) => {
    const u = await ctx.db.get(userId as never);
    return u as unknown as Record<string, unknown> | null;
  });
}

async function selfActivateAuditCount(
  t: ReturnType<typeof convexTest>,
  actorId: string,
): Promise<number> {
  return t.run(async (ctx) => {
    const rows = await ctx.db
      .query("platformAdminAudit")
      .collect();
    return rows.filter(
      (r) =>
        (r as unknown as { action: string }).action === "admin.self_activate" &&
        String((r as unknown as { actorId: unknown }).actorId) === actorId,
    ).length;
  });
}

describe("Owner activation — email verification evidence gate", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = convexTest(schema, modules);
    process.env.PLATFORM_OWNER_EMAIL = OWNER_EMAIL;
  });

  afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });

  it("an OTP-verified account (emailVerificationTime, no boolean) is eligible, self-activates, and lands one audit row", async () => {
    const userId = await seedUser(t, {
      email: OWNER_EMAIL,
      emailVerificationTime: 1_000_000,
    });

    await expect(
      asUser(t, userId).query(api.platform.myOwnerActivationEligibility, {}),
    ).resolves.toMatchObject({ eligible: true, alreadyActive: false });

    await expect(
      asUser(t, userId).mutation(api.platform.selfActivateOwner, {}),
    ).resolves.toMatchObject({ granted: true, alreadyActive: false });

    expect(await selfActivateAuditCount(t, userId)).toBe(1);
    await expect(userRow(t, userId)).resolves.toMatchObject({
      isPlatformAdmin: true,
    });

    // Idempotent re-activation: alreadyActive, no second audit row.
    await expect(
      asUser(t, userId).mutation(api.platform.selfActivateOwner, {}),
    ).resolves.toMatchObject({ granted: true, alreadyActive: true });
    expect(await selfActivateAuditCount(t, userId)).toBe(1);
  });

  it("an account with NO verification evidence is refused on every path", async () => {
    const userId = await seedUser(t, { email: OWNER_EMAIL });

    await expect(
      asUser(t, userId).query(api.platform.myOwnerActivationEligibility, {}),
    ).resolves.toMatchObject({ eligible: false, alreadyActive: false });

    await expect(
      asUser(t, userId).mutation(api.platform.selfActivateOwner, {}),
    ).rejects.toThrow(/Verify your email first/);

    await expect(
      t.mutation(internal.platform.bootstrapAdmin, {}),
    ).resolves.toMatchObject({ granted: false, reason: /not verified/ });

    expect(await selfActivateAuditCount(t, userId)).toBe(0);
    const unverifiedRow = await userRow(t, userId);
    expect(Boolean(unverifiedRow && unverifiedRow.isPlatformAdmin)).toBe(false);
  });

  it("a mismatched owner email is refused everywhere and leaks nothing", async () => {
    const userId = await seedUser(t, {
      email: MISMATCH_EMAIL,
      emailVerificationTime: 1_000_000,
    });

    const eligible = await asUser(t, userId).query(
      api.platform.myOwnerActivationEligibility,
      {},
    );
    expect(eligible.eligible).toBe(false);

    await expect(
      asUser(t, userId).mutation(api.platform.selfActivateOwner, {}),
    ).rejects.toThrow(/not the configured platform owner/);

    await expect(
      t.mutation(internal.platform.bootstrapAdmin, {}),
    ).resolves.toMatchObject({ granted: false, reason: /No user with email/ });

    expect(await selfActivateAuditCount(t, userId)).toBe(0);
  });

  it("an anonymous account is refused even with a matching email and evidence", async () => {
    const userId = await seedUser(t, {
      email: OWNER_EMAIL,
      emailVerificationTime: 1_000_000,
      isAnonymous: true,
    });

    await expect(
      asUser(t, userId).query(api.platform.myOwnerActivationEligibility, {}),
    ).resolves.toMatchObject({ eligible: false });

    await expect(
      asUser(t, userId).mutation(api.platform.selfActivateOwner, {}),
    ).rejects.toThrow(/Sign in with a verified account first/);
  });

  it("the legacy boolean emailVerified:true still passes all paths", async () => {
    process.env.PLATFORM_OWNER_EMAIL = "legacy-owner@synthetic.test";
    const legacyId = await seedUser(t, {
      email: "legacy-owner@synthetic.test",
      emailVerified: true,
    });
    await expect(
      asUser(t, legacyId).query(api.platform.myOwnerActivationEligibility, {}),
    ).resolves.toMatchObject({ eligible: true });
    await expect(
      t.mutation(internal.platform.bootstrapAdmin, {}),
    ).resolves.toMatchObject({ granted: true });
  });

  it("an explicit emailVerified:false DENIES on all three paths even with a fresh timestamp", async () => {
    process.env.PLATFORM_OWNER_EMAIL = "revoked-owner@synthetic.test";
    const revokedId = await seedUser(t, {
      email: "revoked-owner@synthetic.test",
      emailVerified: false,
      emailVerificationTime: 2_000_000,
    });
    await expect(
      asUser(t, revokedId).query(api.platform.myOwnerActivationEligibility, {}),
    ).resolves.toMatchObject({ eligible: false });
    await expect(
      asUser(t, revokedId).mutation(api.platform.selfActivateOwner, {}),
    ).rejects.toThrow(/Verify your email first/);
    await expect(
      t.mutation(internal.platform.bootstrapAdmin, {}),
    ).resolves.toMatchObject({ granted: false, reason: /not verified/ });
  });

  it("fails closed when PLATFORM_OWNER_EMAIL is unset", async () => {
    delete process.env.PLATFORM_OWNER_EMAIL;
    const userId = await seedUser(t, {
      email: OWNER_EMAIL,
      emailVerificationTime: 1_000_000,
    });

    await expect(
      asUser(t, userId).query(api.platform.myOwnerActivationEligibility, {}),
    ).resolves.toMatchObject({ eligible: false });

    await expect(
      asUser(t, userId).mutation(api.platform.selfActivateOwner, {}),
    ).rejects.toThrow(/not configured/);

    await expect(
      t.mutation(internal.platform.bootstrapAdmin, {}),
    ).resolves.toMatchObject({
      granted: false,
      reason: /PLATFORM_OWNER_EMAIL not set/,
    });
  });
});
