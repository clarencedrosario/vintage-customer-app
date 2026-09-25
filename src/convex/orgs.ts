import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";
import type { OrgRole } from "./schema";
import { getAccessContext, requireAccess } from "./access";
import type { Id } from "./_generated/dataModel";
import { MEMBERSHIP_STATUSES } from "./schema";

// ---------------------------------------------------------------
// Organization resolution & registration role assignment
// ---------------------------------------------------------------

/** All my memberships (for the org switcher), with org summary. */
export const myOrganizations = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const rows = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const active = rows.filter((m) => m.status !== "suspended");
    const list: {
      orgId: Id<"organizations">;
      name: string;
      kind: "chamber" | "firm";
      orgRole: OrgRole;
      status: "active" | "invited";
    }[] = [];
    for (const m of active) {
      const org = await ctx.db.get(m.orgId);
      if (!org) continue;
      list.push({
        orgId: org._id,
        name: org.name,
        kind: org.kind,
        orgRole: m.orgRole,
        status: m.status === "invited" ? "invited" : "active",
      });
    }
    return list;
  },
});

/**
 * Which portal is the signed-in user authorized for? Resolved from
 * memberships + role; clicking a card never grants privileges.
 */
export const resolve = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return { portal: null as string | null, role: null as string | null };
    }
    if (user.role === "client") return { portal: "client", role: "client" };

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const active = memberships.filter(
      (m) => m.status === MEMBERSHIP_STATUSES.ACTIVE,
    );
    if (active.length === 0) {
      return { portal: null as string | null, role: (user.role ?? null) as string | null };
    }
    // Any active firm-side membership → console portal.
    const role = active[0]!.orgRole;
    const portal = role === "support_staff" ? "staff" : "firm";
    return { portal, role: role as string };
  },
});

/** Create an organization; creator becomes its Owner. */
export const createOrganization = mutation({
  args: {
    name: v.string(),
    kind: v.union(v.literal("chamber"), v.literal("firm")),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");
    if (user.isAnonymous) {
      throw new Error("Anonymous sessions cannot create organizations.");
    }

    const name = args.name.trim();
    if (name.length < 2) throw new Error("Organization name is too short.");
    const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();

    const orgId = await ctx.db.insert("organizations", {
      name,
      slug,
      kind: args.kind,
      currency: "INR",
      timezone: "Asia/Kolkata",
      financialYearStart: "04-01",
      taxLabel: "GST",
      taxPercent: 18,
      invoicePrefix: "ADV",
      createdBy: user._id,
      createdAt: now,
    });

    await ctx.db.insert("memberships", {
      orgId,
      userId: user._id,
      orgRole: "owner",
      status: MEMBERSHIP_STATUSES.ACTIVE,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(user._id, { activeOrgId: orgId });
    return orgId;
  },
});

/** Switch the active organization (any non-suspended membership). */
export const setActiveOrganization = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");

    const rows = await ctx.db
      .query("memberships")
      .withIndex("by_org_user", (q) =>
        q.eq("orgId", args.orgId).eq("userId", user._id),
      )
      .collect();
    const m = rows[0];
    if (!m || m.status === MEMBERSHIP_STATUSES.SUSPENDED) {
      throw new Error("You are not an active member of that organization.");
    }
    await ctx.db.patch(user._id, { activeOrgId: args.orgId });
  },
});

/** Full org profile for the Settings page (any active member). */
export const profile = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    return {
      _id: ac.org._id,
      name: ac.org.name,
      kind: ac.org.kind,
      logoStorageId: ac.org.logoStorageId,
      addressLine1: ac.org.addressLine1,
      addressLine2: ac.org.addressLine2,
      city: ac.org.city,
      state: ac.org.state,
      pincode: ac.org.pincode,
      gstin: ac.org.gstin,
      pan: ac.org.pan ?? null,
      bankDetails: ac.org.bankDetails ?? null,
      upiId: ac.org.upiId ?? null,
      phone: ac.org.phone,
      email: ac.org.email,
      website: ac.org.website,
      currency: ac.org.currency,
      timezone: ac.org.timezone,
      financialYearStart: ac.org.financialYearStart,
      taxLabel: ac.org.taxLabel,
      taxPercent: ac.org.taxPercent,
      invoicePrefix: ac.org.invoicePrefix,
      promotionsEnabled: ac.org.promotionsEnabled ?? false,
      promotionsComplianceNote: ac.org.promotionsComplianceNote ?? null,
      promotionsComplianceAt: ac.org.promotionsComplianceAt ?? null,
      promoPopupEnabled: ac.org.promoPopupEnabled ?? false,
      promoPopupHeadline: ac.org.promoPopupHeadline ?? null,
      promoPopupBody: ac.org.promoPopupBody ?? null,
      promoPopupCta: ac.org.promoPopupCta ?? null,
      myRole: ac.membership.orgRole,
      canEditProfile: ac.permissions.has("org.edit_profile"),
    };
  },
});

/** Update the org profile (org.edit_profile capability). */
export const updateOrg = mutation({
  args: {
    name: v.optional(v.string()),
    addressLine1: v.optional(v.string()),
    addressLine2: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    pincode: v.optional(v.string()),
    gstin: v.optional(v.string()),
    pan: v.optional(v.string()),
    bankDetails: v.optional(v.string()),
    upiId: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    website: v.optional(v.string()),
    currency: v.optional(v.string()),
    timezone: v.optional(v.string()),
    financialYearStart: v.optional(v.string()),
    taxLabel: v.optional(v.string()),
    taxPercent: v.optional(v.number()),
    invoicePrefix: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!ac.permissions.has("org.edit_profile")) {
      throw new Error("Your role is not permitted to edit the firm profile.");
    }
    if (args.pincode && !/^\d{6}$/.test(args.pincode.trim())) {
      throw new Error("PIN code must be exactly 6 digits.");
    }
    if (
      args.gstin &&
      !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/.test(
        args.gstin.trim().toUpperCase(),
      )
    ) {
      throw new Error("That GSTIN does not look valid.");
    }
    if (
      args.pan &&
      !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(args.pan.trim().toUpperCase())
    ) {
      throw new Error("That PAN does not look valid (AAAAA9999A).");
    }
    const { name, ...rest } = args;
    const patch: Record<string, unknown> = {};
    if (name !== undefined && name.trim().length >= 2) patch.name = name.trim();
    if (rest.gstin !== undefined) {
      patch.gstin = rest.gstin.trim().toUpperCase() || undefined;
    }
    if (rest.pan !== undefined) {
      patch.pan = rest.pan.trim().toUpperCase() || undefined;
    }
    for (const [k, val] of Object.entries(rest)) {
      if (val !== undefined) patch[k] = val;
    }
    await ctx.db.patch(ac.org._id, patch);
  },
});

/** Upload URL for the firm logo (org.edit_profile capability). */
export const generateLogoUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    if (!ac.permissions.has("org.edit_profile")) {
      throw new Error("Your role is not permitted to change the firm logo.");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

/** Attach an uploaded logo to the org. */
export const attachLogo = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!ac.permissions.has("org.edit_profile")) {
      throw new Error("Your role is not permitted to change the firm logo.");
    }
    await ctx.db.patch(ac.org._id, { logoStorageId: args.storageId });
  },
});

/** Logo read URL for the signed-in member's active org. */
export const logoUrl = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac?.org.logoStorageId) return null;
    return await ctx.storage.getUrl(ac.org.logoStorageId);
  },
});

/**
 * Legacy shim used by registerRole callers: assign portal role at
 * registration. First named account becomes firm_owner (legacy portal
 * role); memberships govern actual permissions.
 */
export const registerRole = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (!user) return { role: null as string | null };

    if (
      user.role &&
      user.role !== "admin" &&
      user.role !== "user" &&
      user.role !== "member"
    ) {
      return { role: user.role };
    }
    const all = await ctx.db.query("users").collect();
    const hasConsoleMember = all.some(
      (u) =>
        !u.isAnonymous &&
        u._id !== user._id &&
        (u.role === "firm_owner" ||
          u.role === "admin" ||
          u.role === "lawyer" ||
          u.role === "user"),
    );
    const role = hasConsoleMember ? "lawyer" : "firm_owner";
    await ctx.db.patch(user._id, { role });
    return { role };
  },
});
