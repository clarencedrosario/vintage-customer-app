import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { can, getAccessContext, requireAccess } from "./access";
import type { Doc, Id } from "./_generated/dataModel";

// ===============================================================
// Public lawyer directory (section 22).
//
// Publication is an explicit act: nothing appears publicly unless the
// member has saved a profile with published = true. "Verified" is only
// ever shown after an actual verification decision by an owner or
// administrator — there is no inferred or cosmetic verification.
// ===============================================================

const MAX_LIST_ITEMS = 12;

function cleanList(items: string[] | undefined, max: number): string[] {
  return (items ?? [])
    .map((s) => s.trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, max);
}

function profileShape(p: Doc<"publicProfiles">, orgName: string) {
  return {
    profileId: p._id,
    orgId: p.orgId,
    orgName,
    userId: p.userId,
    headline: p.headline ?? "",
    qualifications: p.qualifications ?? "",
    enrollmentNumber: p.enrollmentNumber ?? "",
    enrollmentState: p.enrollmentState ?? "",
    experienceYears: p.experienceYears ?? null,
    practiceAreas: p.practiceAreas,
    courts: p.courts,
    languages: p.languages,
    city: p.city ?? "",
    publicEmail: p.publicEmail ?? "",
    publicPhone: p.publicPhone ?? "",
    feeMinor: p.feeMinor,
    slots: p.slots ?? [],
    availabilityNote: p.availabilityNote ?? "",
    about: p.about ?? "",
    verificationStatus: p.verificationStatus,
    updatedAt: p.updatedAt,
  };
}

// ---------------------------------------------------------------
// Member-facing profile surface (authenticated)
// ---------------------------------------------------------------

/** My own directory profile in the active organization (or defaults). */
export const myProfile = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const rows = await ctx.db
      .query("publicProfiles")
      .withIndex("by_user", (q) => q.eq("userId", ac.user._id))
      .collect();
    const row = rows.find((r) => r.orgId === ac.org._id);
    if (!row) {
      return {
        exists: false as const,
        published: false,
        canPublish: can(ac, "matter.create") || ac.membership.orgRole !== "support_staff",
        profileId: null,
        headline: "",
        qualifications: "",
        enrollmentNumber: ac.user.barCouncilId ?? "",
        enrollmentState: "",
        experienceYears: null as number | null,
        practiceAreas: [] as string[],
        courts: [] as string[],
        languages: [] as string[],
        city: ac.org.city ?? "",
        publicEmail: ac.user.email ?? "",
        publicPhone: ac.user.phone ?? "",
        feeMinor: 0,
        slots: [] as { label: string; startsAt: number }[],
        availabilityNote: "",
        about: "",
        verificationStatus: "unverified" as const,
        decisionNote: null as string | null,
      };
    }
    return {
      exists: true as const,
      ...profileShape(row, ac.org.name),
      decisionNote: row.decisionNote ?? null,
    };
  },
});

/** Save (create or update) my public profile. */
export const saveProfile = mutation({
  args: {
    published: v.boolean(),
    headline: v.optional(v.string()),
    qualifications: v.optional(v.string()),
    enrollmentNumber: v.optional(v.string()),
    enrollmentState: v.optional(v.string()),
    experienceYears: v.optional(v.number()),
    practiceAreas: v.array(v.string()),
    courts: v.array(v.string()),
    languages: v.array(v.string()),
    city: v.optional(v.string()),
    publicEmail: v.optional(v.string()),
    publicPhone: v.optional(v.string()),
    feeMinor: v.number(),
    slots: v.optional(v.array(v.object({ label: v.string(), startsAt: v.number() }))),
    availabilityNote: v.optional(v.string()),
    about: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (ac.membership.orgRole === "support_staff") {
      throw new Error("Support staff accounts cannot publish directory profiles.");
    }
    // Accounts are created through the platform's verified-email OTP
    // flow, so a signed-in member already controls a verified mailbox.
    if (args.published && !ac.user.email) {
      throw new Error(
        "Add an email address to your account before publishing your public profile.",
      );
    }
    if (args.feeMinor < 0 || !Number.isInteger(args.feeMinor)) {
      throw new Error("Consultation fee must be a whole number of paise.");
    }

    const now = Date.now();
    const rows = await ctx.db
      .query("publicProfiles")
      .withIndex("by_user", (q) => q.eq("userId", ac.user._id))
      .collect();
    const existing = rows.find((r) => r.orgId === ac.org._id);
    const patch = {
      published: args.published,
      headline: args.headline?.trim().slice(0, 120) ?? undefined,
      qualifications: args.qualifications?.trim().slice(0, 600) ?? undefined,
      enrollmentNumber: args.enrollmentNumber?.trim().slice(0, 60) ?? undefined,
      enrollmentState: args.enrollmentState?.trim().slice(0, 60) ?? undefined,
      experienceYears:
        args.experienceYears !== undefined
          ? Math.max(0, Math.min(70, Math.round(args.experienceYears)))
          : undefined,
      practiceAreas: cleanList(args.practiceAreas, MAX_LIST_ITEMS),
      courts: cleanList(args.courts, MAX_LIST_ITEMS),
      languages: cleanList(args.languages, MAX_LIST_ITEMS),
      city: args.city?.trim().slice(0, 80) ?? undefined,
      publicEmail: args.publicEmail?.trim().slice(0, 120) ?? undefined,
      publicPhone: args.publicPhone?.trim().slice(0, 24) ?? undefined,
      feeMinor: args.feeMinor,
      slots: (args.slots ?? [])
        .filter((s) => s.label.trim() && s.startsAt > now - 60_000)
        .slice(0, 40)
        .map((s) => ({ label: s.label.trim().slice(0, 80), startsAt: s.startsAt })),
      availabilityNote: args.availabilityNote?.trim().slice(0, 300) ?? undefined,
      about: args.about?.trim().slice(0, 1500) ?? undefined,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { profileId: existing._id };
    }
    const id = await ctx.db.insert("publicProfiles", {
      orgId: ac.org._id,
      userId: ac.user._id,
      verificationStatus: "unverified",
      ...patch,
      createdAt: now,
    });
    return { profileId: id };
  },
});

/**
 * Verification decision — owner/administrator only. Only this mutation
 * can produce verificationStatus "verified"; the public badge maps 1:1
 * to this stored decision.
 */
export const decideVerification = mutation({
  args: {
    profileId: v.id("publicProfiles"),
    decision: v.union(
      v.literal("verified"),
      v.literal("rejected"),
      v.literal("unverified"),
    ),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (
      ac.membership.orgRole !== "owner" &&
      ac.membership.orgRole !== "administrator"
    ) {
      throw new Error(
        "Only the chamber owner or an administrator can record verification decisions.",
      );
    }
    const profile = await ctx.db.get(args.profileId);
    if (!profile || profile.orgId !== ac.org._id) {
      throw new Error("Profile not found in your organization.");
    }
    const now = Date.now();
    if (args.decision === "verified") {
      await ctx.db.patch(args.profileId, {
        verificationStatus: "verified",
        verifiedAt: now,
        verifiedById: ac.user._id,
        decidedAt: now,
        decisionNote: args.note?.trim().slice(0, 300) ?? undefined,
        updatedAt: now,
      });
    } else if (args.decision === "rejected") {
      await ctx.db.patch(args.profileId, {
        verificationStatus: "rejected",
        decidedAt: now,
        decisionNote: args.note?.trim().slice(0, 300) ?? undefined,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(args.profileId, {
        verificationStatus: "unverified",
        decidedAt: now,
        updatedAt: now,
      });
    }
    return { ok: true };
  },
});

/** Verification queue for owners/administrators. */
export const verificationQueue = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    if (ac.membership.orgRole !== "owner" && ac.membership.orgRole !== "administrator")
      return [];
    const rows = await ctx.db
      .query("publicProfiles")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    return Promise.all(
      rows.map(async (p) => {
        const u = await ctx.db.get(p.userId);
        return {
          profileId: p._id,
          userId: p.userId,
          name: u?.name ?? "Member",
          published: p.published,
          enrollmentNumber: p.enrollmentNumber ?? "",
          verificationStatus: p.verificationStatus,
          decidedAt: p.decidedAt ?? null,
          decisionNote: p.decisionNote ?? null,
          practiceAreas: p.practiceAreas,
          updatedAt: p.updatedAt,
        };
      }),
    );
  },
});

// ---------------------------------------------------------------
// Public surface (no auth) — only published profiles
// ---------------------------------------------------------------

export type DirectoryEntry = {
  profileId: Id<"publicProfiles">;
  userId: Id<"users">;
  name: string;
  orgName: string;
  headline: string;
  qualifications: string;
  enrollmentNumber: string;
  enrollmentState: string;
  experienceYears: number | null;
  practiceAreas: string[];
  courts: string[];
  languages: string[];
  city: string;
  publicEmail: string;
  publicPhone: string;
  feeMinor: number;
  slots: { label: string; startsAt: number }[];
  availabilityNote: string;
  about: string;
  verificationStatus: "unverified" | "pending" | "verified" | "rejected";
};

/** Public directory listing — no authentication required. */
export const publicList = query({
  args: {},
  handler: async (ctx): Promise<DirectoryEntry[]> => {
    const rows = await ctx.db
      .query("publicProfiles")
      .withIndex("by_published", (q) => q.eq("published", true))
      .collect();

    const entries: DirectoryEntry[] = [];
    for (const p of rows) {
      const user = await ctx.db.get(p.userId);
      if (!user) continue;
      const org = await ctx.db.get(p.orgId);
      if (!org) continue;
      const member = await ctx.db
        .query("memberships")
        .withIndex("by_org_user", (q) => q.eq("orgId", p.orgId).eq("userId", p.userId))
        .collect();
      // Never list suspended/removed members, and never support staff.
      if (member[0]?.status !== "active" || member[0].orgRole === "support_staff")
        continue;
      entries.push({
        ...profileShape(p, org.name),
        name: user.name ?? "Advocate",
      });
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** One public profile — no authentication required. */
export const publicProfile = query({
  args: { profileId: v.id("publicProfiles") },
  handler: async (ctx, args): Promise<DirectoryEntry | null> => {
    const p = await ctx.db.get(args.profileId);
    if (!p || !p.published) return null;
    const user = await ctx.db.get(p.userId);
    const org = await ctx.db.get(p.orgId);
    if (!user || !org) return null;
    const member = await ctx.db
      .query("memberships")
      .withIndex("by_org_user", (q) => q.eq("orgId", p.orgId).eq("userId", p.userId))
      .collect();
    if (member[0]?.status !== "active" || member[0].orgRole === "support_staff")
      return null;
    return { ...profileShape(p, org.name), name: user.name ?? "Advocate" };
  },
});

/** Public look-up of a booking by its reference code (no auth). */
export const bookingByReference = query({
  args: { reference: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    const ref = args.reference.trim().toUpperCase();
    if (!ref || !args.email.trim()) return null;
    const rows = await ctx.db
      .query("consultations")
      .withIndex("by_reference", (q) => q.eq("reference", ref))
      .collect();
    const c = rows.find(
      (r) => r.source === "public" && (r.clientEmail ?? "").toLowerCase() === args.email.trim().toLowerCase(),
    );
    if (!c) return null;
    const advocate = c.advocateUserId ? await ctx.db.get(c.advocateUserId) : null;
    const org = await ctx.db.get(c.orgId);
    return {
      reference: c.reference ?? ref,
      status: c.status,
      clientName: c.clientName,
      advocateName: advocate?.name ?? "The advocate",
      chamberName: org?.name ?? "The chamber",
      slotAt: c.slotAt ?? null,
      proposedSlotAt: c.proposedSlotAt ?? null,
      amountMinor: c.amountMinor,
      paymentLinkUrl: c.paymentLinkUrl ?? null,
      paymentStatus: c.status === "scheduled" || c.status === "paid" || c.status === "completed" ? "paid" : "unpaid",
      history: (c.history ?? []).slice(-10),
      matterSummary: c.matterSummary ?? "",
    };
  },
});
