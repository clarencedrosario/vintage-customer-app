import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAccess, requireWriteAccess, getAccessContext } from "./access";
import type { Doc, Id } from "./_generated/dataModel";

// =====================================================================
// INDIAN COURT & CAUSE-LIST CONNECTIONS (§4, §5, §6 of the India-
// specific capabilities).
//
// Matching discipline (hard rules):
//  - CNR (16-char) exact match against a matter's cnrNumber →
//    identifier_exact, still gated behind lawyer REVIEW.
//  - Case number + year → identifier_exact; case number alone →
//    identifier_partial.
//  - Party-name similarity is EVER a "suggestion" (name_only) and can
//    never drive a calendar/task/draft update on its own.
//  - A listing disappearing from a cause list is NEVER auto-treated as
//    cancellation — disappearance handling is a human review state.
//  - Re-published/revised records supersede (never delete) the earlier
//    row; the original text, source and retrieval timestamp are kept.
//
// Access discipline: the registry records the AUTHORIZED access method
// per source (official API, permitted download, manual upload, reviewed
// entry). No automated CAPTCHA/access-control bypass exists anywhere;
// where automated access is unavailable, data arrives by manual upload
// or reviewed entry and is labelled as such. No nationwide live-sync
// claim is made — coverage is per registered source only.
// =====================================================================

/** CNR format check: 4 establishment letters + 12 digits (16 chars). */
const CNR_RE = /^[A-Z]{4}[0-9]{12}$/;

type CourtSourceSeed = {
  key: string;
  courtName: string;
  bench?: string;
  establishment?: string;
  jurisdiction: string;
  sourceName: string;
  sourceUrl?: string;
  accessMethod: "official_api" | "permitted_download" | "manual_upload" | "reviewed_entry";
  supportedInfo: string;
  refreshSchedule: string;
  limitations: string;
};

/**
 * Registry seed — three extensible entries covering the tiers of the
 * Indian judiciary. Access methods are recorded HONESTLY: no live API
 * connection is claimed until one is actually implemented and verified;
 * eCourts services present CAPTCHAs/anti-bot controls that we do NOT
 * bypass — data arrives via permitted downloads, manual upload, or
 * reviewed entry, labelled per row.
 */
const SEED_COURT_SOURCES: CourtSourceSeed[] = [
  {
    key: "in:sci",
    courtName: "Supreme Court of India",
    jurisdiction: "in:national",
    sourceName: "SCI official website (casestatus / orders APIs exist for registered use)",
    sourceUrl: "https://www.sci.gov.in",
    accessMethod: "official_api",
    supportedInfo: "Case status, listing date, orders/judgments (where API access is granted).",
    refreshSchedule: "manual refresh per matter check (no scheduled live sync yet)",
    limitations:
      "Automated access requires the official channel to remain available and permitted; heavy anti-bot controls on web pages. Advokate does NOT bypass CAPTCHAs or access controls. Coverage: only matters whose counsel registers/queries the source — NOT nationwide live synchronization.",
  },
  {
    key: "in:hc",
    courtName: "State High Courts (eCourts services)",
    jurisdiction: "in:state",
    sourceName: "eCourts / per-HC portals (case status, cause lists, orders)",
    sourceUrl: "https://services.ecourts.gov.in",
    accessMethod: "permitted_download",
    supportedInfo: "Cause-list entries, case status, orders (per permitted download).",
    refreshSchedule: "manual refresh per matter check (no scheduled live sync yet)",
    limitations:
      "CAPTCHA and session controls on public portals are NOT bypassed. Cause lists change intra-day; a downloaded cause list is a point-in-time record. Coverage limited to courts the firm actually registers — not all High Courts are equally supported.",
  },
  {
    key: "in:district",
    courtName: "District Courts (eCourts)",
    jurisdiction: "in:district",
    sourceName: "eCourts district services / per-district portals",
    sourceUrl: "https://services.ecourts.gov.in",
    accessMethod: "manual_upload",
    supportedInfo: "Cause-list entries and case status via manual upload or reviewed entry.",
    refreshSchedule: "as-uploaded / per review",
    limitations:
      "Access method is manual by design until an authorized automated channel is verified for a specific district. Point-in-time records; intra-day changes require re-upload.",
  },
];

/** Seed the registry — idempotent by key. */
export const seedRegistry = mutation({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    if (ac.membership.orgRole !== "owner" && ac.membership.orgRole !== "administrator") {
      throw new Error("Only owners and administrators can seed the court-source registry.");
    }
    let created = 0;
    for (const s of SEED_COURT_SOURCES) {
      const dupe = await ctx.db
        .query("courtSources")
        .withIndex("by_org_key", (q) => q.eq("orgId", ac.org._id).eq("key", s.key))
        .unique();
      if (dupe) continue;
      await ctx.db.insert("courtSources", {
        orgId: ac.org._id,
        key: s.key,
        courtName: s.courtName,
        bench: s.bench,
        establishment: s.establishment,
        jurisdiction: s.jurisdiction,
        sourceName: s.sourceName,
        sourceUrl: s.sourceUrl,
        accessMethod: s.accessMethod,
        supportedInfo: s.supportedInfo,
        refreshSchedule: s.refreshSchedule,
        lastStatus: "never",
        limitations: s.limitations,
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      created += 1;
    }
    return { created, total: SEED_COURT_SOURCES.length };
  },
});

/** The registry. */
export const listSources = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    return ctx.db
      .query("courtSources")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect()
      .then((rows) => rows.sort((a, b) => a.key.localeCompare(b.key)));
  },
});

/** Record the outcome of a source check (manual or automated). */
export const recordCheck = mutation({
  args: { sourceKey: v.string(), ok: v.boolean(), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const src = await ctx.db
      .query("courtSources")
      .withIndex("by_org_key", (q) => q.eq("orgId", ac.org._id).eq("key", args.sourceKey))
      .unique();
    if (!src) throw new Error("Court source not found.");
    await ctx.db.patch(src._id, {
      lastCheckedAt: Date.now(),
      lastStatus: args.ok ? "ok" : "failed",
      lastError: args.ok ? undefined : (args.error ?? "unspecified failure").slice(0, 400),
      updatedAt: Date.now(),
    });
    return { recorded: true };
  },
});

// ---------------------------------------------------------------------
// Import + matching
// ---------------------------------------------------------------------

/**
 * Import a court record (a cause-list entry, a case-status snapshot or
 * an order) and attempt identifier-based matching to a matter.
 * Duplicates: an identical re-publication (same source + identifier +
 * hearing date + status [+ order title]) returns the EXISTING row
 * instead of creating noise; a CHANGED record supersedes the old row
 * (preserved, marked stale) and imports as new.
 */
export const importListing = mutation({
  args: {
    sourceKey: v.string(),
    cnr: v.optional(v.string()),
    caseNumber: v.optional(v.string()),
    caseYear: v.optional(v.string()),
    court: v.optional(v.string()),
    bench: v.optional(v.string()),
    partyNames: v.optional(v.string()),
    rawRecord: v.string(),
    publishedHearingAt: v.optional(v.number()),
    listingPosition: v.optional(v.string()),
    caseStatus: v.optional(v.string()),
    orderTitle: v.optional(v.string()),
    orderDate: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireWriteAccess(ctx);
    if (!args.rawRecord.trim()) throw new Error("The original record text is required.");
    if (args.sourceUrl) {
      const src = await ctx.db
        .query("courtSources")
        .withIndex("by_org_key", (q) => q.eq("orgId", ac.org._id).eq("key", args.sourceKey))
        .unique();
      if (!src) throw new Error("Unknown court source — register the source first.");
    }
    const cnr = args.cnr?.trim().toUpperCase();
    if (cnr && !CNR_RE.test(cnr)) {
      throw new Error(
        "CNR must be 16 characters (AAAA00000000YYYY-ish). Leave it empty if the record has none.",
      );
    }

    // Duplicate detection (same source + identifiers + publication).
    const siblings = await ctx.db
      .query("courtListings")
      .withIndex("by_org_source", (q) => q.eq("orgId", ac.org._id).eq("sourceKey", args.sourceKey))
      .collect();
    const dup = siblings.find(
      (s) =>
        (s.identifier.cnr ?? null) === (cnr ?? null) &&
        (s.identifier.caseNumber ?? null) === (args.caseNumber?.trim() ?? null) &&
        (s.publishedHearingAt ?? null) === (args.publishedHearingAt ?? null) &&
        (s.caseStatus ?? null) === (args.caseStatus?.trim() ?? null) &&
        (s.orderTitle ?? null) === (args.orderTitle?.trim() ?? null) &&
        s.reviewState !== "failed" &&
        s.reviewState !== "stale",
    );
    if (dup) {
      return {
        listingId: dup._id,
        duplicate: true as const,
        matchStatus: dup.matchStatus,
        matchConfidence: dup.matchConfidence,
        matchedMatterId: dup.matchedMatterId,
      };
    }
    // A changed republication supersedes the prior row.
    const prior = siblings.find(
      (s) =>
        (s.identifier.cnr ?? null) === (cnr ?? null) &&
        (s.identifier.caseNumber ?? null) === (args.caseNumber?.trim() ?? null) &&
        s.reviewState !== "stale" &&
        ((s.publishedHearingAt ?? null) !== (args.publishedHearingAt ?? null) ||
          (s.caseStatus ?? null) !== (args.caseStatus?.trim() ?? null) ||
          (s.orderTitle ?? null) !== (args.orderTitle?.trim() ?? null)),
    );

    // --- Identifier-based matching (name matching alone is NEVER enough).
    const matters = await ctx.db
      .query("matters")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();

    let matched: Doc<"matters"> | undefined;
    let confidence: "identifier_exact" | "identifier_partial" | "name_only" | "none" = "none";
    let reason = "No matching matter found — import kept for manual association.";

    if (cnr) {
      const hit = matters.find((m) => m.cnrNumber?.toUpperCase() === cnr);
      if (hit) {
        matched = hit;
        confidence = "identifier_exact";
        reason = `CNR ${cnr} matches the matter's recorded CNR exactly.`;
      }
    }
    if (!matched && args.caseNumber?.trim()) {
      const num = args.caseNumber.trim();
      const hits = matters.filter((m) => m.caseNumber?.trim() === num);
      const hit =
        (args.caseYear ? hits.find((m) => m.caseYear === args.caseYear) : undefined) ??
        hits[0];
      if (hit && args.caseYear && hit.caseYear === args.caseYear) {
        matched = hit;
        confidence = "identifier_exact";
        reason = `Case number ${num} / ${args.caseYear} matches the matter's recorded numbers exactly.`;
      } else if (hit) {
        matched = hit;
        confidence = "identifier_partial";
        reason = `Case number ${num} matches but the year was not corroborated — review required.`;
      }
    }
    if (!matched && args.partyNames?.trim()) {
      const names = args.partyNames.toLowerCase();
      const hit = matters.find((m) => {
        const ours = (m.clientRole ?? "").toLowerCase();
        const theirs = (m.opposingParty ?? "").toLowerCase();
        return (
          (ours.length > 3 && names.includes(ours)) ||
          (theirs.length > 3 && names.includes(theirs))
        );
      });
      if (hit) {
        matched = hit;
        confidence = "name_only";
        reason =
          "Party names appear in the record — NAME-ONLY evidence, never sufficient for consequential updates. Lawyer review required.";
      }
    }

    const matchStatus: Doc<"courtListings">["matchStatus"] =
      matched === undefined
        ? "unmatched"
        : confidence === "name_only"
          ? "suggested"
          : "matched_pending_review";

    const now = Date.now();
    const id = (await ctx.db.insert("courtListings", {
      orgId: ac.org._id,
      sourceKey: args.sourceKey,
      identifier: {
        cnr,
        caseNumber: args.caseNumber?.trim(),
        caseYear: args.caseYear?.trim(),
        court: args.court?.trim(),
        bench: args.bench?.trim(),
      },
      rawRecord: args.rawRecord.trim().slice(0, 8000),
      partyNames: args.partyNames?.trim(),
      publishedHearingAt: args.publishedHearingAt,
      listingPosition: args.listingPosition?.trim(),
      caseStatus: args.caseStatus?.trim(),
      orderTitle: args.orderTitle?.trim(),
      orderDate: args.orderDate?.trim(),
      sourceUrl: args.sourceUrl?.trim(),
      retrievedAt: now,
      retrievedById: ac.user._id,
      matchStatus,
      matchedMatterId: matched?._id,
      matchReason: reason,
      matchConfidence: confidence,
      reviewState: "new",
      supersedesId: prior?._id,
      changeNote: prior ? "Republication: differs from the prior record (see superseded row)." : undefined,
      createdAt: now,
      updatedAt: now,
    })) as Id<"courtListings">;

    if (prior) {
      await ctx.db.patch(prior._id, {
        reviewState: "stale",
        supersedesId: id,
        changeNote: "Superseded by a newer publication of this record.",
        updatedAt: now,
      });
    }

    return {
      listingId: id,
      duplicate: false as const,
      matchStatus,
      matchConfidence: confidence,
      matchedMatterId: matched?._id,
      supersededPriorId: prior?._id,
    };
  },
});

/** Listings associated with a matter (confirmed → pending → suggested). */
export const listingsForMatter = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.orgId !== ac.org._id) return [];
    const rows = await ctx.db
      .query("courtListings")
      .withIndex("by_matter", (q) => q.eq("matchedMatterId", args.matterId))
      .collect();
    const rank = (s: string) =>
      s === "confirmed" ? 0 : s === "matched_pending_review" ? 1 : s === "suggested" ? 2 : 3;
    return rows
      .filter((r) => r.matchStatus !== "rejected")
      .sort((a, b) => rank(a.matchStatus) - rank(b.matchStatus) || b.retrievedAt - a.retrievedAt);
  },
});

/**
 * Lawyer confirms (or corrects) a match. A name-only SUGGESTION can only
 * become confirmed through this human action — never automatically.
 */
export const confirmMatch = mutation({
  args: {
    listingId: v.id("courtListings"),
    matterId: v.optional(v.id("matters")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const listing = (await ctx.db.get(args.listingId)) as Doc<"courtListings"> | null;
    if (!listing || listing.orgId !== ac.org._id) throw new Error("Listing not found.");
    const matterId = args.matterId ?? listing.matchedMatterId;
    if (!matterId) throw new Error("No matter to confirm against — pass a matterId.");
    const matter = await ctx.db.get(matterId);
    if (!matter || matter.orgId !== ac.org._id) {
      throw new Error("Matter not found in this organization.");
    }
    await ctx.db.patch(args.listingId, {
      matchStatus: "confirmed",
      matchConfidence: "identifier_exact",
      matchReason: `Lawyer-confirmed match.${args.note ? ` Note: ${args.note.trim().slice(0, 300)}` : ""}`,
      matchedMatterId: matterId,
      reviewState: "reviewed",
      updatedAt: Date.now(),
    });
    return { confirmed: true };
  },
});

/** Lawyer rejects the proposed match. */
export const rejectMatch = mutation({
  args: { listingId: v.id("courtListings"), reason: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const listing = (await ctx.db.get(args.listingId)) as Doc<"courtListings"> | null;
    if (!listing || listing.orgId !== ac.org._id) throw new Error("Listing not found.");
    if (!args.reason.trim()) throw new Error("A rejection reason is required.");
    await ctx.db.patch(args.listingId, {
      matchStatus: "rejected",
      reviewState: "reviewed",
      conflictNote: args.reason.trim().slice(0, 400),
      updatedAt: Date.now(),
    });
    return { rejected: true };
  },
});

/** Record a conflict found during review (source vs matter record). */
export const markConflicting = mutation({
  args: { listingId: v.id("courtListings"), note: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const listing = (await ctx.db.get(args.listingId)) as Doc<"courtListings"> | null;
    if (!listing || listing.orgId !== ac.org._id) throw new Error("Listing not found.");
    if (!args.note.trim()) throw new Error("A conflict note is required.");
    await ctx.db.patch(args.listingId, {
      reviewState: "conflicting",
      conflictNote: args.note.trim().slice(0, 600),
      updatedAt: Date.now(),
    });
    return { marked: true };
  },
});

// ---------------------------------------------------------------------
// Applying a CONFIRMED listing: calendar + task proposals
// ---------------------------------------------------------------------

/**
 * Apply a REVIEWED, CONFIRMED listing with a published hearing date to
 * the matter calendar — duplicate-safe (a listing applies at most once;
 * re-runs return the existing hearing). The published date is stored as
 * a published hearing date (hearings.at), never as a lawyer-verified
 * legal deadline. Disappearance from a later cause list is NOT processed
 * here as cancellation — that is a human review action.
 */
export const applyToCalendar = mutation({
  args: { listingId: v.id("courtListings") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const listing = (await ctx.db.get(args.listingId)) as Doc<"courtListings"> | null;
    if (!listing || listing.orgId !== ac.org._id) throw new Error("Listing not found.");
    // A superseded record is never applicable, confirmed or not.
    if (listing.reviewState === "stale") {
      throw new Error("This record was superseded by a newer publication — apply that one.");
    }
    if (listing.matchStatus !== "confirmed") {
      throw new Error(
        "Only a lawyer-CONFIRMED match can be applied to the calendar (name-only suggestions never self-apply).",
      );
    }
    if (listing.publishedHearingAt === undefined) {
      throw new Error("This record has no published hearing date.");
    }
    if (!listing.matchedMatterId) throw new Error("No matched matter on the listing.");
    if (listing.appliedHearingId) {
      return { hearingId: listing.appliedHearingId, reused: true as const };
    }
    const hearingId = (await ctx.db.insert("hearings", {
      matterId: listing.matchedMatterId,
      title: `Cause-list appearance — ${listing.identifier.court ?? listing.sourceKey}${
        listing.listingPosition ? ` (${listing.listingPosition})` : ""
      }`,
      court: listing.identifier.court,
      at: listing.publishedHearingAt,
      status: "scheduled",
      notes: `Imported from ${listing.sourceKey}; source record preserved on the court listing row. Published listing date — verify against the court record before relying on it.`,
      createdAt: Date.now(),
    })) as Id<"hearings">;
    await ctx.db.patch(listing.matchedMatterId, {
      nextHearingAt: listing.publishedHearingAt,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(args.listingId, {
      appliedHearingId: hearingId,
      appliedAt: Date.now(),
      reviewState: "reviewed",
      updatedAt: Date.now(),
    });
    return { hearingId, reused: false as const };
  },
});

/**
 * Propose an operational task from a CONFIRMED order record — enters the
 * existing taskSuggestions review flow (approval creates the real task;
 * the due-date basis is stated and the lawyer's approval is the
 * verification). Cause lists are never treated as a source of filing
 * deadlines here.
 */
export const proposeTaskFromOrder = mutation({
  args: {
    listingId: v.id("courtListings"),
    title: v.string(),
    rationale: v.string(),
    dueBasis: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const listing = (await ctx.db.get(args.listingId)) as Doc<"courtListings"> | null;
    if (!listing || listing.orgId !== ac.org._id) throw new Error("Listing not found.");
    if (listing.matchStatus !== "confirmed") {
      throw new Error("Only a lawyer-CONFIRMED order record can generate a task proposal.");
    }
    if (!listing.orderTitle) throw new Error("This record is not an order.");
    if (!listing.matchedMatterId) throw new Error("No matched matter on the listing.");
    if (!args.title.trim() || !args.rationale.trim()) {
      throw new Error("Title and rationale are required.");
    }
    const id = (await ctx.db.insert("taskSuggestions", {
      orgId: ac.org._id,
      matterId: listing.matchedMatterId,
      title: args.title.trim().slice(0, 300),
      rationale: `${args.rationale.trim().slice(0, 400)} — source: order "${listing.orderTitle}" (${listing.orderDate ?? "date not stated"}), ${listing.sourceKey}.`,
      sourceKind: "order",
      sourceId: String(listing._id),
      sourceRef: `court listing ${listing.sourceKey}${listing.orderDate ? `, order dated ${listing.orderDate}` : ""}`,
      proposedDueOn: listing.orderDate,
      dueBasis:
        args.dueBasis?.trim().slice(0, 300) ??
        "Derived from the court record; calculated legal deadlines must use the deadline rules and lawyer confirmation.",
      status: "proposed",
      createdAt: Date.now(),
    })) as Id<"taskSuggestions">;
    return { suggestionId: id };
  },
});

// ---------------------------------------------------------------------
// Court-updates dashboard
// ---------------------------------------------------------------------

/** Dashboard: new / reviewed / conflicting / stale / failed + matches. */
export const dashboard = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const rows = await ctx.db
      .query("courtListings")
      .withIndex("by_org_match", (q) => q.eq("orgId", ac.org._id).eq("matchStatus", "confirmed"))
      .collect();
    const all = await ctx.db
      .query("courtListings")
      .withIndex("by_org_source", (q) => q.eq("orgId", ac.org._id).eq("sourceKey", "in:sci"))
      .collect();
    // (by_org_source is keyed per source; gather the org-wide set cheaply.)
    void rows;
    const universe = [...all];
    for (const key of ["in:hc", "in:district"]) {
      const part = await ctx.db
        .query("courtListings")
        .withIndex("by_org_source", (q) => q.eq("orgId", ac.org._id).eq("sourceKey", key))
        .collect();
      universe.push(...part);
    }
    const by = (s: Doc<"courtListings">["reviewState"]) => universe.filter((r) => r.reviewState === s).length;
    const recent = [...universe]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20)
      .map((r) => ({
        id: r._id,
        sourceKey: r.sourceKey,
        cnr: r.identifier.cnr,
        caseNumber: r.identifier.caseNumber,
        court: r.identifier.court,
        publishedHearingAt: r.publishedHearingAt,
        caseStatus: r.caseStatus,
        orderTitle: r.orderTitle,
        matchStatus: r.matchStatus,
        matchConfidence: r.matchConfidence,
        reviewState: r.reviewState,
        matchedMatterId: r.matchedMatterId,
        appliedHearingId: r.appliedHearingId,
        retrievedAt: r.retrievedAt,
      }));
    return {
      counts: {
        new: by("new"),
        reviewed: by("reviewed"),
        conflicting: by("conflicting"),
        stale: by("stale"),
        failed: by("failed"),
        unmatched: universe.filter((r) => r.matchStatus === "unmatched").length,
        suggested: universe.filter((r) => r.matchStatus === "suggested").length,
        pendingReview: universe.filter((r) => r.matchStatus === "matched_pending_review").length,
        confirmed: universe.filter((r) => r.matchStatus === "confirmed").length,
        total: universe.length,
      },
      recent,
    };
  },
});
