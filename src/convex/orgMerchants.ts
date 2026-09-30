import { v } from "convex/values";
import { mutation, query, internalQuery } from "./_generated/server";
import { requireAccess, requireCapability } from "./access";
import { encryptSecret, decryptSecret } from "./crypto";
import type { Doc } from "./_generated/dataModel";

// =====================================================================
// Per-firm Razorpay merchant connections (owner decision, 30 Sep 2026).
//
// Firm-money flows — client invoices and consultation fees — collect
// through the FIRM's OWN Razorpay account. The platform's
// deployment-wide RAZORPAY_KEY_ID/SECRET are used ONLY for CJ GLOBAL's
// own revenue (software subscriptions, promotion purchases). No code
// path may collect firm money through the platform account.
//
// The firm's key secret is encrypted at rest (encryptSecret under
// RAZORPAY_KEY_SECRET as the master key — that value lives only in the
// deployment env) and is NEVER returned to any client after being set.
// =====================================================================

const MAX_AUDIT = 30;

async function auditEntry(
  existing: Doc<"orgMerchants"> | null,
  byName: string,
  byId: any,
  text: string,
) {
  const entry = { at: Date.now(), byId, byName, text };
  return {
    audit: [...(existing?.audit ?? []), entry].slice(-MAX_AUDIT),
  };
}

function maskLast4(keyId: string): string {
  return keyId.slice(-4);
}

/** Public: whether this org has an active merchant connection (no secrets). */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    const rows = await ctx.db
      .query("orgMerchants")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const active = rows.find((r) => r.active);
    return {
      connected: !!active,
      provider: active?.provider ?? null,
      mode: active?.mode ?? null,
      keyIdLast4: active?.keyIdLast4 ?? null,
      connectedAt: active?.createdAt ?? null,
    };
  },
});

/**
 * Connect or rotate the firm's Razorpay account (test mode only for
 * now — live mode is a deliberate, separately-approved step). The
 * secret is encrypted immediately and never echoed back.
 */
export const connect = mutation({
  args: {
    keyId: v.string(),
    keySecret: v.string(),
    webhookSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "billing.payment");
    const keyId = args.keyId.trim();
    const keySecret = args.keySecret.trim();
    if (!/^rzp_test_[A-Za-z0-9]{8,}$/.test(keyId)) {
      throw new Error(
        "Enter a TEST-mode key id (rzp_test_…). Live connections are a separate, explicitly approved step.",
      );
    }
    if (keySecret.length < 8) {
      throw new Error("The key secret looks too short to be valid.");
    }
    const master = process.env.RAZORPAY_KEY_SECRET;
    if (!master) {
      throw new Error(
        "The platform must configure RAZORPAY_KEY_SECRET first — it is the encryption key for firm credentials.",
      );
    }
    const mode: "test" = "test";
    const rows = await ctx.db
      .query("orgMerchants")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const existing = rows.find((r) => r.active) ?? null;
    const rotate = !!existing;

    // Supersede any previous active connection.
    for (const r of rows) {
      if (r.active) {
        await ctx.db.patch(r._id, { active: false, updatedAt: Date.now() });
      }
    }
    const byName = ac.user.name ?? ac.user.email ?? "Member";
    const id = await ctx.db.insert("orgMerchants", {
      orgId: ac.org._id,
      provider: "razorpay",
      keyId,
      encryptedSecret: encryptSecret(
        master,
        `orgMerchant:${ac.org._id}:secret`,
        keySecret,
      ),
      encryptedWebhookSecret: args.webhookSecret?.trim()
        ? encryptSecret(
            master,
            `orgMerchant:${ac.org._id}:webhook`,
            args.webhookSecret.trim(),
          )
        : undefined,
      keyIdLast4: maskLast4(keyId),
      mode,
      active: true,
      ...(await auditEntry(
        existing,
        byName,
        ac.user._id,
        rotate
          ? `Rotated merchant credentials (key ••••${maskLast4(keyId)}, test mode).`
          : `Connected firm Razorpay account (key ••••${maskLast4(keyId)}, test mode).`,
      )),
      createdBy: ac.user._id,
      createdAt: Date.now(),
    });
    return { id, mode, keyIdLast4: maskLast4(keyId) };
  },
});

/** Disable the firm's connection — no further collection until reconnected. */
export const disable = mutation({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "billing.payment");
    const rows = await ctx.db
      .query("orgMerchants")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const active = rows.find((r) => r.active);
    if (!active) throw new Error("No active merchant connection.");
    await ctx.db.patch(active._id, {
      active: false,
      updatedAt: Date.now(),
      ...(await auditEntry(
        active,
        ac.user.name ?? ac.user.email ?? "Member",
        ac.user._id,
        "Disabled merchant connection — online collection stopped.",
      )),
    });
    return { disabled: true };
  },
});

// ---------------------------------------------------------------------
// Internal resolvers used by the provider bridge and webhook verify.
// ---------------------------------------------------------------------

/** The org's active merchant row, or null (internal; no secrets exposed). */
export const getActiveInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("orgMerchants")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    return rows.find((r) => r.active) ?? null;
  },
});

/**
 * Decrypted credential for the Node runtime (server-only). Throws on
 * tamper or wrong context; the plaintext never leaves the server.
 */
export const getCredentialInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("orgMerchants")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    const m = rows.find((r) => r.active);
    if (!m) return null;
    const master = process.env.RAZORPAY_KEY_SECRET;
    if (!master) return null;
    return {
      merchantId: m._id,
      provider: m.provider,
      mode: m.mode,
      keyId: m.keyId,
      keySecret: decryptSecret(
        master,
        `orgMerchant:${args.orgId}:secret`,
        m.encryptedSecret,
      ),
      webhookSecret: m.encryptedWebhookSecret
        ? decryptSecret(
            master,
            `orgMerchant:${args.orgId}:webhook`,
            m.encryptedWebhookSecret,
          )
        : undefined,
    };
  },
});
