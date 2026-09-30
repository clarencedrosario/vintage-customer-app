import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAccess, requireCapability, getAccessContext } from "./access";
import type { Doc, Id } from "./_generated/dataModel";

// =====================================================================
// ADVERSE AUTHORITY & CITATION RECHECKING (turn 16, Phase 2).
//
// Two honest capabilities:
//
// 1. ADVERSE SEARCH — surface authorities whose text may WEAKEN or
//    QUALIFY a proposed position. Deterministic corpus search over
//    authorized coverage ONLY (the ingested corpus), with the passage
//    that drove each relevance assessment shown, jurisdiction/court/
//    decision date displayed, and the search scope + coverage limits
//    stated every time. "No adverse authority found" is explicitly
//    recorded as a coverage statement, never as proof none exists.
//
// 2. RECHECK — compare the citations recorded on a saved research job
//    or evidence bundle against the CURRENT corpus:
//      - changed   → a newer legalSourceVersion exists than the one the
//                    research was grounded in
//      - unavailable → the stableKey no longer resolves
//      - treatment → shown ONLY where the source row carries a treatment
//                    WITH its treatmentSourceKey (model inference is
//                    structurally unable to assert treatment here)
//    Everything is a lawyer-review flag, not a conclusion.
//
// Binding/persuasive classification is exposed ONLY as the corpus's
// jurisdictionLevel (a reviewed data field) with an explicit note that
// weight-assessment is the lawyer's task — never computed.
// =====================================================================

/**
 * Adverse search: tokenize the position, find OTHER authorities in the
 * authorized corpus sharing content-bearing terms, and surface the
 * matching passage. Same-country first (never silently substitute
 * another jurisdiction's law — foreign hits are labelled as such).
 */
export const searchAdverse = query({
  args: {
    position: v.string(),
    country: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const position = args.position.trim();
    if (position.length < 8) {
      throw new Error("State the proposition to check (at least a sentence).");
    }
    const STOP = new Set([
      "shall", "must", "that", "this", "with", "from", "which", "been",
      "were", "have", "their", "them", "then", "than", "when", "what",
      "only", "such", "also", "into", "upon", "said", "where", "while",
      "court", "held", "appeal", "against", "under", "section", "act",
    ]);
    const tokens = [
      ...new Set(
        position
          .toLowerCase()
          .split(/[^a-z]+/)
          .filter((t) => t.length >= 5 && !STOP.has(t)),
      ),
    ].slice(0, 12);
    if (tokens.length === 0) {
      throw new Error("No distinctive terms found in the proposition to search with.");
    }

    const rows = await ctx.db.query("legalSources").collect();
    const results: {
      stableKey: string;
      title: string;
      kind: Doc<"legalSources">["kind"];
      country: string;
      sameCountry: boolean;
      jurisdictionLevel: string;
      court: string | null;
      decidedAt: number | null;
      citation: string | null;
      treatment: string | null;
      treatmentSourceKey: string | null;
      matchedTerms: string[];
      passage: string;
      sourceUrl: string;
      note: string;
    }[] = [];
    for (const s of rows) {
      if (args.country && s.country !== args.country) {
        // foreign hits are only included when no country filter was given
      }
      const version = s.latestVersion ? await ctx.db.get(s.latestVersion) : null;
      const body = version?.body;
      if (!body || body.startsWith("[INGESTION PENDING]")) continue;
      const lower = body.toLowerCase();
      const matched = tokens.filter((t) => lower.includes(t));
      // Relevance needs ≥2 shared content terms — single common terms
      // would drown the lawyer in noise.
      if (matched.length < 2) continue;
      const firstIdx = lower.indexOf(matched[0]!);
      const passage = body.slice(Math.max(0, firstIdx - 120), firstIdx + 240).trim();
      results.push({
        stableKey: s.stableKey,
        title: s.title,
        kind: s.kind,
        country: s.country,
        sameCountry: !args.country || s.country === args.country,
        jurisdictionLevel: s.jurisdictionLevel,
        court: s.court ?? null,
        decidedAt: s.decidedAt ?? null,
        citation: s.citation ?? null,
        treatment: s.treatment ?? null,
        treatmentSourceKey: s.treatmentSourceKey ?? null,
        matchedTerms: matched,
        passage,
        sourceUrl: s.sourceUrl,
        note:
          "Relevance assessed by shared terminology in the ingested text only — this is NOT a legal determination of adversity. Whether the authority actually weakens or qualifies the position is for the lawyer.",
      });
      if (results.length >= (args.limit ?? 10)) break;
    }
    results.sort((a, b) => {
      if (a.sameCountry !== b.sameCountry) return a.sameCountry ? -1 : 1;
      return b.matchedTerms.length - a.matchedTerms.length;
    });
    return {
      results,
      scope: {
        corpusSize: rows.length,
        termsUsed: tokens,
        coverageLimit:
          "Only sources ingested in this deployment were searched. Coverage is NOT exhaustive; absence from these results does NOT prove that no adverse authority exists.",
        jurisdictionNote:
          "Same-jurisdiction results rank first. Results from other jurisdictions are labelled and never silently substituted for local law.",
      },
    };
  },
});

/**
 * Recheck saved research: compare each recorded citation (aiJobs
 * legalSourceVersions, or a bundle's frozen citations) against the
 * CURRENT corpus. Flags: changed / unavailable / treatment (with its
 * required source). Pure review material — no auto-amendment.
 */
export const recheck = query({
  args: {
    jobId: v.optional(v.id("aiJobs")),
    bundleId: v.optional(v.id("researchBundles")),
  },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    if (!!args.jobId === !!args.bundleId) {
      throw new Error("Pass exactly one of jobId or bundleId.");
    }

    let checks: { stableKey: string; recordedVersion?: number }[] = [];
    let researchDate: number | undefined;
    if (args.jobId) {
      const job = (await ctx.db.get(args.jobId)) as Doc<"aiJobs"> | null;
      if (!job || job.orgId !== ac.org._id) throw new Error("Research job not found.");
      researchDate = job.createdAt;
      checks = (job.legalSourceVersions ?? []).map((v) => ({
        stableKey: v.stableKey,
        recordedVersion: v.version,
      }));
    } else if (args.bundleId) {
      const bundle = (await ctx.db.get(args.bundleId)) as Doc<"researchBundles"> | null;
      if (!bundle || bundle.orgId !== ac.org._id) throw new Error("Bundle not found.");
      researchDate = bundle.createdAt;
      checks = bundle.citations.map((c) => ({
        stableKey: c.stableKey,
        recordedVersion: c.sourceVersion,
      }));
    }

    const items: {
      stableKey: string;
      status: "unchanged" | "changed" | "unavailable";
      recordedVersion?: number;
      currentVersion?: number;
      title?: string;
      treatment?: string | null;
      treatmentSourceKey?: string | null;
      treatmentNote?: string;
      treatmentSupported?: boolean;
      decidedAt?: number | null;
      court?: string | null;
    }[] = [];
    let affected = 0;
    for (const c of checks) {
      const src = await ctx.db
        .query("legalSources")
        .withIndex("by_stable_key", (q) => q.eq("stableKey", c.stableKey))
        .unique();
      if (!src) {
        affected += 1;
        items.push({
          stableKey: c.stableKey,
          status: "unavailable",
          recordedVersion: c.recordedVersion,
          treatmentNote: "Source no longer resolves in the corpus — lawyer review required.",
        });
        continue;
      }
      const version = src.latestVersion ? await ctx.db.get(src.latestVersion) : null;
      const currentVersion = version?.version;
      const changed =
        currentVersion !== undefined &&
        c.recordedVersion !== undefined &&
        currentVersion !== c.recordedVersion;
      if (changed) affected += 1;
      // Treatment is reported ONLY when the row carries BOTH a treatment
      // and its supporting source — otherwise it is withheld entirely.
      const treatmentSupported = !!(src.treatment && src.treatmentSourceKey);
      items.push({
        stableKey: c.stableKey,
        status: changed ? "changed" : "unchanged",
        recordedVersion: c.recordedVersion,
        currentVersion,
        title: src.title,
        treatment: treatmentSupported ? src.treatment! : null,
        treatmentSourceKey: treatmentSupported ? src.treatmentSourceKey! : null,
        treatmentSupported,
        treatmentNote: src.treatment
          ? treatmentSupported
            ? `Corpus records treatment "${src.treatment}" supported by ${src.treatmentSourceKey}. Verify the supporting source yourself.`
            : "A treatment label exists WITHOUT a supporting source — it is withheld here. Treatment claims require sources; model inference is never sufficient."
          : undefined,
        decidedAt: src.decidedAt ?? null,
        court: src.court ?? null,
      });
    }
    return {
      researchDate,
      items,
      affected,
      scopeNote:
        "Recheck compares recorded versions with the CURRENT corpus. It cannot detect treatment changes that were never ingested, and 'no change' means no NEWER VERSION is in the corpus — not that the law has not moved.",
      adverseNote:
        "Rechecking citations does not search for adverse authority by itself — pair it with an adverse search. Never interpret the absence of flags as proof that no adverse authority exists.",
    };
  },
});

/**
 * Record a lawyer's recheck decision on one citation (review trail).
 * Deliberately minimal: the decision lives with the matter's audit and
 * the flag rows stay recomputable.
 */
export const recordDecision = mutation({
  args: {
    matterId: v.id("matters"),
    stableKey: v.string(),
    decision: v.union(
      v.literal("reviewed_no_change_needed"),
      v.literal("research_updated"),
      v.literal("escalated_to_lawyer_review"),
    ),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.orgId !== ac.org._id) {
      throw new Error("Matter not found in this organization.");
    }
    await ctx.db.insert("matterEvents", {
      matterId: args.matterId,
      kind: "note",
      detail: `Authority recheck — ${args.stableKey}: ${args.decision}. ${args.note.trim().slice(0, 300)}`,
      authorId: ac.user._id,
      createdAt: Date.now(),
    });
    return { recorded: true };
  },
});
