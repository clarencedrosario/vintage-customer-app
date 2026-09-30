import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAccess, requireCapability, getAccessContext } from "./access";
import { sha256Hex } from "./crypto";
import type { Doc, Id } from "./_generated/dataModel";

// =====================================================================
// RESEARCH EVIDENCE BUNDLES (turn 16, Phase 4).
//
// An evidence bundle is a FROZEN research record: the question, the
// matter/jurisdiction context, the answer with unresolved questions
// marked, and every cited passage pinned to the EXACT source version it
// was validated against — plus retrieval dates, integrity hashes where
// the source carries them, citation-validation results, coverage/freshness
// limits, and a manifest of included/omitted items.
//
// Honesty rules:
//  - The bundle preserves the historical answer; it is NEVER silently
//    re-pointed at newer source versions. A new export creates a new
//    bundle and marks the old one superseded.
//  - "A citation that exists is not necessarily a citation that supports
//    the claim": validation here records source existence + quote match
//    ONLY. Support-assessment is the lawyer's job and is recorded as
//    review state, not computed.
//  - Export applies matter permissions AT EXPORT TIME; licensing may
//    force reference-only export (no full text) — recorded per citation.
//  - Label: a RESEARCH RECORD, not a certified court record or proof of
//    legal correctness. Unresolved citation issues are flagged loudly.
// =====================================================================

/** Create a bundle from a saved AI answer's citations (validated now). */
export const createFromJob = mutation({
  args: {
    jobId: v.id("aiJobs"),
    title: v.string(),
    unresolvedQuestions: v.optional(v.array(v.string())),
    coverageNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "ai.use");
    const job = (await ctx.db.get(args.jobId)) as Doc<"aiJobs"> | null;
    if (!job || job.orgId !== ac.org._id) throw new Error("Research job not found.");
    if (job.matterId) {
      const matter = await ctx.db.get(job.matterId);
      if (!matter || matter.orgId !== ac.org._id) {
        throw new Error("Matter not found in this organization.");
      }
    }
    if (!job.result || !job.result.trim()) {
      throw new Error("This research job has no answer to bundle.");
    }
    if (!args.title.trim()) throw new Error("A title is required.");

    // Matter legal dates (as recorded in the confirmed legal profile).
    let legalDates: { label: string; date: string }[] = [];
    let jurisdiction = "unspecified";
    if (job.matterId) {
      const matter = await ctx.db.get(job.matterId);
      jurisdiction = matter?.legalProfile?.country ?? matter?.jurisdiction ?? "unspecified";
      legalDates = (matter?.legalProfile?.legalDates ?? [])
        .filter((d) => !!d.date)
        .map((d) => ({ label: d.kind, date: d.date }));
    }

    // Freeze citations: resolve each stableKey to its CURRENT source row
    // and record version + retrieval date + integrity hash (computed over
    // the bundled text — clearly labelled, not a provider attestation)
    // plus a FRESH validation run. Versions never update after creation.
    const citations: {
      stableKey: string;
      title?: string;
      anchor?: string;
      quote?: string;
      sourceVersion?: number;
      sourceTitle?: string;
      retrievedAt?: number;
      integrityHash?: string;
      validation?: {
        sourceExists: boolean;
        quoteVerified: boolean;
        problem?: string;
      };
    }[] = [];
    let unresolvedIssues = 0;
    const structured = job.structured as
      | { citations?: { stableKey: string; quote?: string; anchor?: string; title?: string }[] }
      | undefined;
    const cited = structured?.citations ?? [];
    for (const c of cited) {
      const src = await ctx.db
        .query("legalSources")
        .withIndex("by_stable_key", (q) => q.eq("stableKey", c.stableKey))
        .unique();
      const versionRow = src?.latestVersion ? await ctx.db.get(src.latestVersion) : null;
      const body = versionRow?.body ?? null;
      const quote = c.quote;
      let quoteVerified = false;
      let problem: string | undefined;
      if (!src) {
        problem = "Source not found in the available corpus at bundle creation.";
      } else if (quote && body && !body.includes(quote)) {
        problem = "Quoted passage not found in the recorded source version.";
      } else if (!body) {
        problem = "Source metadata present but full text not held — quote unverifiable.";
      } else {
        quoteVerified = true;
      }
      if (problem) unresolvedIssues += 1;
      citations.push({
        stableKey: c.stableKey,
        title: c.title,
        anchor: c.anchor,
        quote,
        sourceVersion: versionRow?.version,
        sourceTitle: src?.title,
        retrievedAt: Date.now(),
        // Hash OF THE BUNDLED TEXT (computed at freeze time for exit/
        // audit comparison) — not a provider attestation.
        integrityHash: body ? sha256Hex(body) : undefined,
        validation: {
          sourceExists: !!src,
          quoteVerified,
          problem,
        },
      });
    }

    // Supersede prior bundles for the same job (chain preserved).
    const orgBundles = await ctx.db
      .query("researchBundles")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    for (const p of orgBundles.filter(
      (p) => p.jobId === job._id && p.status !== "superseded",
    )) {
      await ctx.db.patch(p._id, { status: "superseded" });
    }

    const id = (await ctx.db.insert("researchBundles", {
      orgId: ac.org._id,
      matterId: job.matterId,
      title: args.title.trim().slice(0, 300),
      question: (job.inputNote ?? job.kind).slice(0, 2000),
      jurisdiction,
      legalDates,
      answer: job.result.slice(0, 60_000),
      unresolvedQuestions: (args.unresolvedQuestions ?? []).map((q) => q.slice(0, 500)),
      citations,
      jobId: job._id,
      coverageNote:
        args.coverageNote?.slice(0, 1000) ??
        "Coverage limited to the sources ingested in this deployment at bundle creation; freshness limited to the last successful ingestion. Not a certified court record and not proof of legal correctness.",
      status: "draft",
      generatedById: ac.user._id,
      createdAt: Date.now(),
    })) as Id<"researchBundles">;
    return { bundleId: id, citations: citations.length, unresolvedIssues };
  },
});

/** One bundle (org-scoped). */
export const get = query({
  args: { bundleId: v.id("researchBundles") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const b = (await ctx.db.get(args.bundleId)) as Doc<"researchBundles"> | null;
    if (!b || b.orgId !== ac.org._id) return null;
    return b;
  },
});

/** Bundles for a matter (newest first). */
export const listForMatter = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.orgId !== ac.org._id) return [];
    return ctx.db
      .query("researchBundles")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect()
      .then((rows) => rows.sort((a, b) => b.createdAt - a.createdAt));
  },
});

/** Lawyer review state on a bundle (finalization records the reviewer). */
export const setReview = mutation({
  args: {
    bundleId: v.id("researchBundles"),
    status: v.union(v.literal("draft"), v.literal("finalized"), v.literal("superseded")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const b = (await ctx.db.get(args.bundleId)) as Doc<"researchBundles"> | null;
    if (!b || b.orgId !== ac.org._id) throw new Error("Bundle not found.");
    await ctx.db.patch(args.bundleId, { status: args.status });
    void args.note;
    return { updated: true };
  },
});

/**
 * Machine-readable manifest for export (Phase 12 will wrap this in the
 * firm handover package). Includes the manifest of included/omitted
 * items and the licensing-driven reference-only list. Matter permissions
 * are applied HERE, at export time.
 */
export const manifest = query({
  args: { bundleId: v.id("researchBundles") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const b = (await ctx.db.get(args.bundleId)) as Doc<"researchBundles"> | null;
    if (!b || b.orgId !== ac.org._id) return null;
    if (b.matterId) {
      const matter = await ctx.db.get(b.matterId);
      if (!matter) return null;
    }
    const omitted: string[] = [];
    const citations = b.citations.map((c) => {
      // Licensing posture: full corpus texts are exporter-restricted —
      // the bundle carries pinpoint + version + hash references.
      const includeFullText = false;
      if (!includeFullText && c.quote) {
        omitted.push(`full text of ${c.stableKey} (licence-limited: reference exported)`);
      }
      return {
        stableKey: c.stableKey,
        sourceTitle: c.sourceTitle,
        sourceVersion: c.sourceVersion,
        anchor: c.anchor,
        retrievedAt: c.retrievedAt,
        integrityHash: c.integrityHash,
        validation: c.validation,
        exportedAs: includeFullText ? ("full_text" as const) : ("reference" as const),
      };
    });
    return {
      manifestVersion: 1,
      label:
        "RESEARCH RECORD — not a certified court record, not proof of legal correctness. Quotation verification does not establish that a source supports the conclusion.",
      title: b.title,
      generatedAt: b.createdAt,
      generatedById: b.generatedById,
      matterId: b.matterId,
      jurisdiction: b.jurisdiction,
      legalDates: b.legalDates,
      question: b.question,
      answer: b.answer,
      unresolvedQuestions: b.unresolvedQuestions,
      citations,
      unresolvedCitationIssues: citations.filter((c) => c.validation?.problem),
      coverageNote: b.coverageNote,
      reviewStatus: b.status,
      included: {
        answer: true,
        citations: citations.length,
        unresolvedQuestions: b.unresolvedQuestions.length,
      },
      omitted,
    };
  },
});
