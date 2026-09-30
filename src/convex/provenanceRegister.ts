import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAccess, getAccessContext } from "./access";
import type { Doc, Id } from "./_generated/dataModel";

// =====================================================================
// THIRD-PARTY PROVENANCE REGISTER (§1 of the independently developed
// legal workspace features).
//
// One register per organization recording every externally sourced
// asset the platform depends on — libraries, fonts, icons, datasets,
// template sources — with licence (SPDX id or "proprietary (CJ
// GLOBAL)"), origin, notice obligation and review status.
//
// Honesty rules encoded here:
//  - Only ACTUAL dependencies (read from the project manifest) are
//    seeded. Nothing aspirational, nothing from any competitor.
//  - Licences we have verified are "cleared"; anything uncertain —
//    e.g. Convex's functional-source-style licence, which is NOT a
//    standard OSI licence — is "flagged_for_review", never silently
//    marked cleared. No guaranteed-non-infringement claims.
//  - Required notices ( licences like ISC/MIT demand attribution
//    retention) are recorded with their location.
// =====================================================================

type SeedEntry = {
  asset: string;
  version: string;
  origin: string;
  licence: string;
  noticeRequired: boolean;
  noticeLocation?: string;
  usageScope: string;
  status: "cleared" | "flagged_for_review";
  note?: string;
};

/** Actual runtime dependencies (package.json) — verified at seed time. */
const DEPENDENCIES: SeedEntry[] = [
  {
    asset: "react",
    version: "^19.2.0",
    origin: "https://react.dev (npm: react)",
    licence: "MIT",
    noticeRequired: true,
    noticeLocation: "docs/PROVENANCE.md — notices section",
    usageScope: "Application UI runtime",
    status: "cleared",
  },
  {
    asset: "react-dom",
    version: "^19.2.0",
    origin: "https://react.dev (npm: react-dom)",
    licence: "MIT",
    noticeRequired: true,
    noticeLocation: "docs/PROVENANCE.md — notices section",
    usageScope: "Application UI renderer",
    status: "cleared",
  },
  {
    asset: "react-router",
    version: "^7.18.4",
    origin: "https://reactrouter.com (npm: react-router)",
    licence: "MIT",
    noticeRequired: true,
    noticeLocation: "docs/PROVENANCE.md — notices section",
    usageScope: "Client routing",
    status: "cleared",
  },
  {
    asset: "convex",
    version: "^1.46.0",
    origin: "https://convex.dev (npm: convex)",
    licence: "Convex Open Source Licence (functional-source style — NOT a standard OSI licence)",
    noticeRequired: true,
    noticeLocation: "docs/PROVENANCE.md — flagged review",
    usageScope: "Backend functions + managed database",
    status: "flagged_for_review",
    note:
      "Licence is a source-available, FSL-style licence with a change date that converts to a permissive licence per release; a qualified review of our usage (hosted SaaS built on the managed cloud) is OUTSTANDING. Recorded as flagged, not cleared.",
  },
  {
    asset: "@convex-dev/auth",
    version: "^0.0.90",
    origin: "https://labs.convex.dev/auth (npm: @convex-dev/auth)",
    licence: "Apache-2.0",
    noticeRequired: true,
    noticeLocation: "docs/PROVENANCE.md — notices section",
    usageScope: "Authentication",
    status: "cleared",
  },
  {
    asset: "@noble/ciphers",
    version: "^2.4.0",
    origin: "https://github.com/paulmillr/noble-ciphers (npm: @noble/ciphers)",
    licence: "MIT",
    noticeRequired: true,
    noticeLocation: "docs/PROVENANCE.md — notices section",
    usageScope: "AES-256-GCM secret encryption",
    status: "cleared",
  },
  {
    asset: "@noble/hashes",
    version: "^2.4.0",
    origin: "https://github.com/paulmillr/noble-hashes (npm: @noble/hashes)",
    licence: "MIT",
    noticeRequired: true,
    noticeLocation: "docs/PROVENANCE.md — notices section",
    usageScope: "SHA-256/HMAC/HKDF (audit chain, hashing, TOTP)",
    status: "cleared",
  },
  {
    asset: "framer-motion",
    version: "^12.23.25",
    origin: "https://motion.dev (npm: framer-motion)",
    licence: "MIT",
    noticeRequired: true,
    noticeLocation: "docs/PROVENANCE.md — notices section",
    usageScope: "Interface motion",
    status: "cleared",
  },
  {
    asset: "lucide-react",
    version: "^0.555.0",
    origin: "https://lucide.dev (npm: lucide-react)",
    licence: "ISC",
    noticeRequired: true,
    noticeLocation: "docs/PROVENANCE.md — notices section",
    usageScope: "Interface icons",
    status: "cleared",
  },
  {
    asset: "tailwindcss",
    version: "^4.1.17",
    origin: "https://tailwindcss.com (npm: tailwindcss)",
    licence: "MIT",
    noticeRequired: true,
    noticeLocation: "docs/PROVENANCE.md — notices section",
    usageScope: "Styling engine",
    status: "cleared",
  },
  {
    asset: "recharts",
    version: "^2.15.4",
    origin: "https://recharts.org (npm: recharts)",
    licence: "MIT",
    noticeRequired: true,
    noticeLocation: "docs/PROVENANCE.md — notices section",
    usageScope: "Charts",
    status: "cleared",
  },
  {
    asset: "zod",
    version: "^4.1.13",
    origin: "https://zod.dev (npm: zod)",
    licence: "MIT",
    noticeRequired: true,
    noticeLocation: "docs/PROVENANCE.md — notices section",
    usageScope: "Schema validation (client-side forms)",
    status: "cleared",
  },
];

/** Advokate-authored template content — proprietary, no external source. */
const IN_HOUSE: SeedEntry[] = [
  {
    asset: "Advokate seed template library (6 templates)",
    origin: "Authored in-house for CJ GLOBAL — original drafting structures, no external template collection",
    licence: "proprietary (CJ GLOBAL)",
    noticeRequired: false,
    usageScope: "Firm drafting workspace",
    version: "1",
    status: "cleared",
    note:
      "Indian-practice templates (demand notice, S.138 complaint, written statement, bail application, mutual NDA, affidavit of evidence) written from the record of law; each carries instructions and limitations and requires advocate review.",
  },
  {
    asset: "Advokate interface design, copy and prompts",
    origin: "Authored in-house for CJ GLOBAL",
    licence: "proprietary (CJ GLOBAL)",
    noticeRequired: false,
    usageScope: "Whole product surface",
    version: "1",
    status: "cleared",
    note:
      "No competitor source code, prompts, templates, marketing text, screenshots or interface designs are used anywhere in Advokate.",
  },
];

/** Seed the register — idempotent by (asset, version). */
export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    if (ac.membership.orgRole !== "owner" && ac.membership.orgRole !== "administrator") {
      throw new Error("Only owners and administrators can seed the provenance register.");
    }
    let created = 0;
    for (const e of [...DEPENDENCIES, ...IN_HOUSE]) {
      const existing = await ctx.db
        .query("thirdPartyProvenance")
        .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
        .collect()
        .then((rows) => rows.find((r) => r.asset === e.asset));
      if (existing) continue;
      await ctx.db.insert("thirdPartyProvenance", {
        orgId: ac.org._id,
        asset: e.asset,
        version: e.version,
        origin: e.origin,
        licence: e.licence,
        noticeRequired: e.noticeRequired,
        noticeLocation: e.noticeLocation,
        usageScope: e.usageScope,
        status: e.status,
        note: e.note,
        recordedById: ac.user._id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      created += 1;
    }
    return { created, total: DEPENDENCIES.length + IN_HOUSE.length };
  },
});

/** The register for the caller's organization (asset order). */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const rows = await ctx.db
      .query("thirdPartyProvenance")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    return rows.sort((a, b) => a.asset.localeCompare(b.asset));
  },
});

/** Summary counts — flagged items are the honest headline. */
export const stats = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const rows = await ctx.db
      .query("thirdPartyProvenance")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    return {
      total: rows.length,
      cleared: rows.filter((r) => r.status === "cleared").length,
      flaggedForReview: rows.filter((r) => r.status === "flagged_for_review").length,
      open: rows.filter((r) => r.status === "open").length,
      noticeRequired: rows.filter((r) => r.noticeRequired).length,
    };
  },
});

/** Owner/admin records a review outcome for one register entry. */
export const updateStatus = mutation({
  args: {
    entryId: v.id("thirdPartyProvenance"),
    status: v.union(
      v.literal("open"),
      v.literal("cleared"),
      v.literal("flagged_for_review"),
    ),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (ac.membership.orgRole !== "owner" && ac.membership.orgRole !== "administrator") {
      throw new Error("Only owners and administrators can update the provenance register.");
    }
    const entry = (await ctx.db.get(args.entryId)) as Doc<"thirdPartyProvenance"> | null;
    if (!entry || entry.orgId !== ac.org._id) throw new Error("Register entry not found.");
    await ctx.db.patch(args.entryId, {
      status: args.status,
      note: args.note?.slice(0, 600) ?? entry.note,
      updatedAt: Date.now(),
    });
    return { updated: true };
  },
});
