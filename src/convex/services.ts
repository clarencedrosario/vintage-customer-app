import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";
import { ROLES } from "./schema";

/**
 * Seed the service catalog on first request. Idempotent: only inserts
 * services whose slug is not yet present.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("services").collect();
  },
});

/** One-time seeding, called from the catalog page on first load. */
export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const services = await ctx.db.query("services").collect();
    if (services.length > 0) return;

    const seed = [
      {
        name: "Contract Review & Redline",
        slug: "contract-review",
        category: "Contracts",
        summary:
          "A business attorney reviews your commercial agreement and returns a marked-up draft with a summary of risks.",
        description:
          "Send us the agreement and we will return a redlined draft within three business days, together with a plain-English memo covering risk allocation, termination rights, liability caps, and any clauses that depart from market standard. Includes one follow-up call to walk through the changes.",
        priceCents: 45000,
        durationMinutes: 60,
        isActive: true,
      },
      {
        name: "Entity Formation & Governance Setup",
        slug: "entity-formation",
        category: "Corporate",
        summary:
          "Form your LLC or corporation with operating documents, resolutions, and a governance calendar in place.",
        description:
          "We prepare and file formation documents, draft operating agreements or bylaws tailored to your ownership structure, issue founder resolutions, and set up your minute book. A governance calendar keeps your annual obligations on schedule.",
        priceCents: 120000,
        durationMinutes: 90,
        isActive: true,
      },
      {
        name: "Employment Policy Audit",
        slug: "employment-audit",
        category: "Employment",
        summary:
          "An audit of your handbook and employment agreements against current state and federal requirements.",
        description:
          "We review your employee handbook, offer letters, and contractor agreements, then deliver a prioritized report of gaps and exposures with suggested replacement language. Covers wage-and-hour classification, leave policies, and restrictive covenants.",
        priceCents: 85000,
        durationMinutes: 90,
        isActive: true,
      },
      {
        name: "Trademark Search & Filing Strategy",
        slug: "trademark-search",
        category: "Intellectual Property",
        summary:
          "A clearance search and filing strategy for your brand, with a recommended registration path.",
        description:
          "We run knockout and comprehensive searches across the relevant classes, assess conflict risk, and recommend the filing route — including international considerations. You receive a written opinion you can rely on before investing in the brand.",
        priceCents: 95000,
        durationMinutes: 60,
        isActive: true,
      },
      {
        name: "Data Privacy Compliance Review",
        slug: "privacy-review",
        category: "Compliance",
        summary:
          "A review of how your product collects and shares personal data, mapped against applicable privacy statutes.",
        description:
          "We map your data flows, review your privacy policy and vendor agreements, and deliver a compliance matrix showing obligations under applicable state privacy laws, with a prioritized remediation plan.",
        priceCents: 150000,
        durationMinutes: 120,
        isActive: true,
      },
      {
        name: "Executive Consultation — Hourly",
        slug: "executive-consultation",
        category: "Advisory",
        summary:
          "A focused session with a senior attorney on any business law question, booked by the hour.",
        description:
          "Bring any question — a dispute that is heating up, a deal point you cannot resolve, a regulatory question. You leave the session with a written summary of the advice given and recommended next steps.",
        priceCents: 55000,
        durationMinutes: 60,
        isActive: true,
      },
    ];

    for (const s of seed) {
      await ctx.db.insert("services", s);
    }
  },
});

/** One service by slug, or null. */
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("services")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
  },
});

/** One service by id, or null. */
export const getById = query({
  args: { serviceId: v.id("services") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.serviceId);
  },
});

// ---------------- Admin: catalog management ----------------

export const create = mutation({
  args: {
    name: v.string(),
    category: v.string(),
    summary: v.string(),
    description: v.string(),
    priceCents: v.number(),
    durationMinutes: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const base = args.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    let slug = base;
    let n = 2;
    while (
      await ctx.db
        .query("services")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .unique()
    ) {
      slug = `${base}-${n}`;
      n += 1;
    }
    await ctx.db.insert("services", {
      ...args,
      slug,
      isActive: true,
    });
  },
});

export const update = mutation({
  args: {
    serviceId: v.id("services"),
    name: v.optional(v.string()),
    category: v.optional(v.string()),
    summary: v.optional(v.string()),
    description: v.optional(v.string()),
    priceCents: v.optional(v.number()),
    durationMinutes: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const { serviceId, ...patch } = args;
    await ctx.db.patch(serviceId, patch);
  },
});

export const remove = mutation({
  args: { serviceId: v.id("services") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.db.delete(args.serviceId);
  },
});

async function requireAdmin(ctx: Parameters<typeof getCurrentUser>[0]) {
  const user = await getCurrentUser(ctx);
  if (!user || user.role !== "admin") {
    throw new Error("Administrator access required.");
  }
}
