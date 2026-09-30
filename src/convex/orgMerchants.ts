import { v } from "convex/values";
import { mutation, query, internalQuery } from "./_generated/server";
import { requireAccess, requireCapability } from "./access";
import { encryptSecret, decryptSecret, sha256Hex } from "./crypto";
import type { Doc, Id } from "./_generated/dataModel";

// =====================================================================
// Per-firm Razorpay merchant connections (owner decision, 30 Sep 2026).
//
// Firm-money flows — client invoices and consultation fees — collect
// through the FIRM's OWN Razorpay account. The platform's
// deployment-wide RAZORPAY_KEY_ID/SECRET are used ONLY for CJ GLOBAL's
// own revenue (software subscriptions, promotion purchases). No code
// path may collect firm money through the platform account.
//
// Merchant identity and rotation:
//   - Each connected account is ONE orgMerchants row; the row _id IS
//     the merchant identity. `merchantRef` (returned to the UI) names
//     it for rotation.
//   - connect({merchantRef: R}) where R is the active row's ref =
//     ROTATION: credentials replaced IN PLACE, identity preserved.
//   - connect() without a matching ref = a DIFFERENT account: a new
//     row and identity; the old row is superseded (inactive) but kept
//     forever so money it captured can still be refunded through IT.
//   - payments rows record the merchant row id + key id that captured
//     them; refunds always use THAT row's credentials — never the
//     newly connected account.
//
// The firm's key secret is encrypted at rest (AES-256-GCM under the
// deployment master key; context binds ciphertext to this exact row)
// and is NEVER returned to any client after being set.
// =====================================================================

const MAX_AUDIT = 30;

function randomRef(inputs: {
  orgId: Id<"organizations">;
  keyId: string;
  existingCount: number;
}): string {
  // Sandbox-safe: derived from already-available primitives (no reliance
  // on a CSPRNG global inside mutations). Not a secret — just a stable
  // public handle unique per (org, key, moment).
  return sha256Hex(
    `${inputs.orgId}:${inputs.keyId}:${Date.now()}:${inputs.existingCount}`,
  ).slice(0, 18);
}

async function auditEntry(
  existing: Doc<"orgMerchants"> | null,
  byName: string,
  byId: Id<"users"> | undefined,
  text: string,
) {
  const entry = { at: Date.now(), byId, byName, text };
  return {
    audit: [...(existing?.audit ?? []), entry].slice(-MAX_AUDIT),
  };
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
      merchantRef: active?.merchantRef ?? null,
      connectedAt: active?.createdAt ?? null,
    };
  },
});

/**
 * Connect a Razorpay account, or ROTATE the current one.
 *
 * Pass `merchantRef` (as returned here/status) to rotate the SAME
 * merchant's credentials in place — identity and history preserved.
 * Omit it (or pass a different ref) to connect a DIFFERENT account:
 * a new merchant identity is created; captured money stays bound to
 * the account that captured it.
 */
export const connect = mutation({
  args: {
    keyId: v.string(),
    keySecret: v.string(),
    webhookSecret: v.optional(v.string()),
    merchantRef: v.optional(v.string()),
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

    const rows = await ctx.db
      .query("orgMerchants")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const active = rows.find((r) => r.active) ?? null;
    const byName = ac.user.name ?? ac.user.email ?? "Member";

    // ROTATION: same merchant identity, credentials replaced in place.
    if (args.merchantRef && active && active.merchantRef === args.merchantRef) {
      await ctx.db.patch(active._id, {
        keyId,
        encryptedSecret: encryptSecret(
          `orgMerchant:${ac.org._id}:${active._id}:secret`,
          keySecret,
        ),
        encryptedWebhookSecret: args.webhookSecret?.trim()
          ? encryptSecret(
              `orgMerchant:${ac.org._id}:${active._id}:webhook`,
              args.webhookSecret.trim(),
            )
          : active.encryptedWebhookSecret,
        keyIdLast4: keyId.slice(-4),
        active: true,
        updatedAt: Date.now(),
        ...(await auditEntry(
          active,
          byName,
          ac.user._id,
          `Rotated credentials for the SAME merchant account (new key ••••${keyId.slice(-4)}). Captured money stays refundable through this account.`,
        )),
      });
      return { merchantRef: active.merchantRef, rotated: true, keyIdLast4: keyId.slice(-4) };
    }

    // DIFFERENT ACCOUNT: supersede the old row; its identity (and the
    // ability to refund what it captured) is preserved on the old row.
    for (const r of rows) {
      if (r.active) {
        await ctx.db.patch(r._id, {
          active: false,
          updatedAt: Date.now(),
          ...(await auditEntry(
            r,
            byName,
            ac.user._id,
            "Superseded by a DIFFERENT merchant account. Already-captured money remains bound to this account for refunds.",
          )),
        });
      }
    }
    const merchantRef = randomRef({
      orgId: ac.org._id,
      keyId,
      existingCount: rows.length,
    });
    // Insert, then seal secrets against THIS row's identity (the row id
    // is part of the crypto context) — same transaction.
    const id = await ctx.db.insert("orgMerchants", {
      orgId: ac.org._id,
      provider: "razorpay",
      merchantRef,
      keyId,
      encryptedSecret: "",
      encryptedWebhookSecret: undefined,
      keyIdLast4: keyId.slice(-4),
      mode: "test",
      active: true,
      createdBy: ac.user._id,
      createdAt: Date.now(),
    });
    await ctx.db.patch(id, {
      encryptedSecret: encryptSecret(
        `orgMerchant:${ac.org._id}:${id}:secret`,
        keySecret,
      ),
      encryptedWebhookSecret: args.webhookSecret?.trim()
        ? encryptSecret(
            `orgMerchant:${ac.org._id}:${id}:webhook`,
            args.webhookSecret.trim(),
          )
        : undefined,
      ...(await auditEntry(
        null,
        byName,
        ac.user._id,
        `Connected merchant account (key ••••${keyId.slice(-4)}, test mode).`,
      )),
    });
    return { merchantRef, rotated: false, keyIdLast4: keyId.slice(-4) };
  },
});

/**
 * Disable the firm's active connection — no NEW collection until
 * reconnected. Money already captured stays refundable through the
 * bound (now inactive) merchant row; disabling never blocks that.
 */
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
        "Disabled merchant connection — new collection stopped. Captured money remains refundable through this account.",
      )),
    });
    return { disabled: true };
  },
});

// ---------------------------------------------------------------------
// Internal resolvers used by the provider bridge and webhook verify.
// None of these ever expose secrets to a client — they run server-side
// inside Node actions only.
// ---------------------------------------------------------------------

/** The org's ACTIVE merchant row, or null (no secrets). */
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
 * Decrypted credential for the org's ACTIVE merchant (link creation).
 * Server-only; throws on tamper or wrong context.
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
    return {
      merchantId: m._id,
      merchantRef: m.merchantRef,
      provider: m.provider,
      mode: m.mode,
      keyId: m.keyId,
      keySecret: decryptSecret(
        `orgMerchant:${args.orgId}:${m._id}:secret`,
        m.encryptedSecret,
      ),
      webhookSecret: m.encryptedWebhookSecret
        ? decryptSecret(
            `orgMerchant:${args.orgId}:${m._id}:webhook`,
            m.encryptedWebhookSecret,
          )
        : undefined,
    };
  },
});

/**
 * Credential for a SPECIFIC merchant row — used for REFUNDS so money
 * is always sent back through the account that captured it, even if
 * that account has since been superseded or disabled. Returns null
 * when the row no longer resolves.
 */
export const getCredentialByMerchantInternal = internalQuery({
  args: { merchantId: v.id("orgMerchants") },
  handler: async (ctx, args) => {
    const m = await ctx.db.get(args.merchantId);
    if (!m) return null;
    return {
      merchantId: m._id,
      merchantRef: m.merchantRef,
      provider: m.provider,
      mode: m.mode,
      active: m.active,
      keyId: m.keyId,
      keySecret: decryptSecret(
        `orgMerchant:${m.orgId}:${m._id}:secret`,
        m.encryptedSecret,
      ),
    };
  },
});

/**
 * Webhook-verification candidates for an org: the active row FIRST,
 * then superseded rows (most recent first). During/after rotation a
 * firm's dashboard may briefly still hold the previous secret — those
 * events are legitimately Razorpay-signed for THIS firm and still
 * verify; every accepted event then passes full tenant/association
 * validation before any money moves.
 */
export const listWebhookCandidatesInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("orgMerchants")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    const sorted = [...rows].sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return b.createdAt - a.createdAt;
    });
    const out: {
      merchantId: Id<"orgMerchants">;
      merchantRef: string;
      keyId: string;
      webhookSecret: string;
    }[] = [];
    for (const m of sorted.slice(0, 5)) {
      if (!m.encryptedWebhookSecret) continue;
      try {
        out.push({
          merchantId: m._id,
          merchantRef: m.merchantRef,
          keyId: m.keyId,
          webhookSecret: decryptSecret(
            `orgMerchant:${args.orgId}:${m._id}:webhook`,
            m.encryptedWebhookSecret,
          ),
        });
      } catch {
        // Undecryptable (e.g. master key rotated without re-save):
        // skip honestly; the row's other uses still fail closed.
      }
    }
    return out;
  },
});
