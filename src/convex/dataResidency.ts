import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAccess, requireWriteAccess, getAccessContext } from "./access";
import type { Doc } from "./_generated/dataModel";

// =====================================================================
// DATA LOCATION & RESIDENCY CONTROLS (§2 of the India-specific
// capabilities).
//
// Honesty rules enforced here:
//  - The inventory records where data ACTUALLY travels and resides.
//    Regions are "unverified" until someone verifies them; the main
//    database's region is NEVER extrapolated to other services.
//  - No universal India-only storage obligation is assumed. The default
//    policy mode is "record_only": inventory + flagging only.
//  - "restrict_in" mode (used only when a law/contract/customer policy
//    actually requires India-only processing) BLOCKS processing in
//    services not verified in-region — with a logged block row —
//    instead of silently transferring data elsewhere.
//  - Nothing here advertises residency the hosting stack cannot
//    guarantee; migration/paid-service activation stays a human,
//    approved step (out of scope for this module by design).
// =====================================================================

type LocationSeed = {
  service: string;
  dataCategory: string;
  provider: string;
  region: string;
  residencyVerified: boolean;
  notes?: string;
};

/** Inventory seed: the actual Advokate stack, honestly labelled. */
const LOCATION_SEED: LocationSeed[] = [
  {
    service: "primary_database",
    dataCategory: "All application records (matters, clients, facts, drafts)",
    provider: "Convex managed cloud",
    region: "unverified",
    residencyVerified: false,
    notes:
      "Convex deployment region is an operator-side fact; verify from the Convex dashboard before claiming any region. Until verified: unverified.",
  },
  {
    service: "document_storage",
    dataCategory: "Original documents and derived files",
    provider: "Convex file storage (same deployment)",
    region: "unverified",
    residencyVerified: false,
    notes: "Same deployment region as the primary database — verify before claiming.",
  },
  {
    service: "backups",
    dataCategory: "Database snapshots (platform-managed)",
    provider: "Convex managed cloud",
    region: "unverified",
    residencyVerified: false,
    notes: "Backup geography follows the deployment; NOT separately verified.",
  },
  {
    service: "search_indexes",
    dataCategory: "Full-text search indexes over firm data",
    provider: "Convex (same deployment)",
    region: "unverified",
    residencyVerified: false,
  },
  {
    service: "embeddings",
    dataCategory: "Vector indexes over firm data",
    provider: "Convex vector index (same deployment)",
    region: "unverified",
    residencyVerified: false,
    notes: "Turn-9+ vector search runs in-deployment; no external vector store.",
  },
  {
    service: "ai_processing",
    dataCategory: "Prompts and matter context sent for model processing",
    provider: "None active (OPENAI_API_KEY not configured)",
    region: "n/a",
    residencyVerified: false,
    notes:
      "No external AI processing occurs today: the live-model path is gated on a key that is NOT on the deployment. If a model API is ever enabled, this row MUST be re-assessed before use.",
  },
  {
    service: "logs_diagnostics",
    dataCategory: "Application logs and diagnostics",
    provider: "Platform logging",
    region: "unverified",
    residencyVerified: false,
    notes: "Support access follows the platform's restricted-diagnostics policy (PERMISSIONS.md).",
  },
  {
    service: "email_notifications",
    dataCategory: "Transactional email (invitations, notifications)",
    provider: "Provider per deployment configuration",
    region: "unverified",
    residencyVerified: false,
    notes: "Provider/region must be recorded by the operator when email is configured.",
  },
  {
    service: "payments",
    dataCategory: "Merchant credentials (encrypted) and payment identifiers",
    provider: "Razorpay (when configured)",
    region: "unverified",
    residencyVerified: false,
    notes: "Card data is never stored by Advokate; Razorpay processes payments under its own terms.",
  },
  {
    service: "support_access",
    dataCategory: "Operator support sessions over firm data",
    provider: "CJ GLOBAL (restricted diagnostics)",
    region: "unverified",
    residencyVerified: false,
    notes: "Access is capability-gated and audited; geographic profile not separately verified.",
  },
];

/** Seed the inventory — idempotent by service. */
export const seedInventory = mutation({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    if (ac.membership.orgRole !== "owner" && ac.membership.orgRole !== "administrator") {
      throw new Error("Only owners and administrators can seed the data-location inventory.");
    }
    let created = 0;
    for (const s of LOCATION_SEED) {
      const existing = await ctx.db
        .query("dataLocations")
        .withIndex("by_org_service", (q) => q.eq("orgId", ac.org._id).eq("service", s.service))
        .unique();
      if (existing) continue;
      await ctx.db.insert("dataLocations", {
        orgId: ac.org._id,
        service: s.service,
        dataCategory: s.dataCategory,
        provider: s.provider,
        region: s.region,
        residencyVerified: s.residencyVerified,
        notes: s.notes,
        recordedById: ac.user._id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      created += 1;
    }
    return { created, total: LOCATION_SEED.length };
  },
});

/** The inventory (service order). */
export const listInventory = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    return ctx.db
      .query("dataLocations")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect()
      .then((rows) => rows.sort((a, b) => a.service.localeCompare(b.service)));
  },
});

/**
 * Record a VERIFIED region for a service (human verification step).
 * This is the only path that sets residencyVerified=true.
 */
export const verifyRegion = mutation({
  args: {
    service: v.string(),
    verifiedRegion: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (ac.membership.orgRole !== "owner" && ac.membership.orgRole !== "administrator") {
      throw new Error("Only owners and administrators can verify a service region.");
    }
    const row = await ctx.db
      .query("dataLocations")
      .withIndex("by_org_service", (q) => q.eq("orgId", ac.org._id).eq("service", args.service))
      .unique();
    if (!row) throw new Error("Inventory row not found — seed the inventory first.");
    await ctx.db.patch(row._id, {
      region: args.verifiedRegion,
      residencyVerified: true,
      notes: args.note?.slice(0, 500) ?? row.notes,
      updatedAt: Date.now(),
    });
    return { verified: true };
  },
});

/** Set the org's residency policy (default is record_only). */
export const setPolicy = mutation({
  args: {
    mode: v.union(v.literal("record_only"), v.literal("restrict_in")),
    basis: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireWriteAccess(ctx);
    if (ac.membership.orgRole !== "owner" && ac.membership.orgRole !== "administrator") {
      throw new Error("Only owners and administrators can set the residency policy.");
    }
    if (!args.basis.trim()) {
      throw new Error("A basis (law/contract/policy) is required for any policy mode.");
    }
    const existing = await ctx.db
      .query("residencyPolicies")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect()
      .then((rows) => rows[0]);
    // Blocked services = every service NOT verified in-region.
    const inventory = await ctx.db
      .query("dataLocations")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const blocked = inventory
      .filter((r) => !(r.residencyVerified && r.region === "in"))
      .map((r) => r.service);
    const patch = {
      mode: args.mode,
      basis: args.basis.trim().slice(0, 600),
      blockedServices: args.mode === "restrict_in" ? blocked : [],
      note: args.note?.slice(0, 500),
      createdById: ac.user._id,
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { mode: args.mode, blockedServices: patch.blockedServices };
    }
    await ctx.db.insert("residencyPolicies", { orgId: ac.org._id, ...patch });
    return { mode: args.mode, blockedServices: patch.blockedServices };
  },
});

/** The org's policy (or null = no policy recorded). */
export const getPolicy = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    return ctx.db
      .query("residencyPolicies")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect()
      .then((rows) => rows[0] ?? null);
  },
});

/**
 * THE GATE — call before any processing that would send a data category
 * to a service. Under "restrict_in", processing in a service that is
 * not verified in-region is REFUSED and logged (never silently
 * transferred). Under "record_only" the attempt is allowed (inventory
 * mode). Unauthenticated or cross-org callers are refused outright.
 */
export const assertProcessingAllowed = internalMutation({
  args: {
    orgId: v.id("organizations"),
    service: v.string(),
    dataCategory: v.string(),
  },
  handler: async (ctx, args): Promise<{ allowed: boolean; reason?: string }> => {
    const policy = await ctx.db
      .query("residencyPolicies")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect()
      .then((rows) => rows[0]);
    if (!policy || policy.mode !== "restrict_in") return { allowed: true };
    const inventory = await ctx.db
      .query("dataLocations")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    const row = inventory.find((r) => r.service === args.service);
    const allowed = !!row && row.residencyVerified && row.region === "in";
    if (!allowed) {
      await ctx.db.insert("residencyBlocks", {
        orgId: args.orgId,
        service: args.service,
        dataCategory: args.dataCategory,
        reason: row
          ? `Policy restrict_in (basis: ${policy.basis}): service region ${row.region} (verified=${row.residencyVerified}) is not verified in-region.`
          : `Policy restrict_in (basis: ${policy.basis}): service "${args.service}" is not in the verified inventory.`,
        createdAt: Date.now(),
      });
    }
    return { allowed, reason: allowed ? undefined : "Service not verified in-region under the org's India-only policy." };
  },
});

/** Recent residency blocks (for the dashboard). */
export const listBlocks = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    return ctx.db
      .query("residencyBlocks")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect()
      .then((rows) => rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 50));
  },
});
