import fs from "fs";
const p = "src/convex/schema.ts";
let src = fs.readFileSync(p, "utf8");
const anchor = `    .index("by_payment", ["paymentId"])
    .index("by_org_status", ["orgId", "status"]),
`;
const i = src.indexOf(anchor);
if (i === -1) { console.error("ANCHOR_NOT_FOUND"); process.exit(1); }
if (src.indexOf(anchor) !== src.lastIndexOf(anchor)) { console.error("ANCHOR_NOT_UNIQUE"); process.exit(1); }
const insertAt = i + anchor.length;
const block = `
  // Per-firm Razorpay merchant connections (owner decision, 30 Sep 2026):
  // firm-money flows (client invoices, consultation fees) collect through
  // the FIRM's own Razorpay account — never through the platform's
  // deployment-wide keys. Platform-money flows (CJ GLOBAL software
  // subscriptions, promotion purchases) keep using the deployment keys.
  // The secret is stored encrypted-at-rest (AES-256-GCM under
  // RAZORPAY_KEY_SECRET as the key-encryption key) and is never returned
  // to any client after being set.
  orgMerchants: defineTable({
    orgId: v.id("organizations"),
    provider: v.literal("razorpay"),
    keyId: v.string(), // rzp_test_... / rzp_live_...
    encryptedSecret: v.string(), // base64(iv || ciphertext || tag)
    // The webhook secret for the FIRM's own Razorpay dashboard webhook.
    encryptedWebhookSecret: v.optional(v.string()),
    keyIdLast4: v.string(),
    // "test" connections never collect real money.
    mode: v.union(v.literal("test"), v.literal("live")),
    active: v.boolean(),
    // Audit trail: who connected/rotated/disabled.
    audit: v.optional(
      v.array(
        v.object({
          at: v.number(),
          byId: v.optional(v.id("users")),
          byName: v.string(),
          text: v.string(),
        }),
      ),
    ),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"]),
`;
const out = src.slice(0, insertAt) + block + src.slice(insertAt);
fs.writeFileSync(p, out);
console.log("SCHEMA_MERCHANT_OK");
