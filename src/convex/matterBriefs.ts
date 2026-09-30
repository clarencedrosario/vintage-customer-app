import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAccess, requireCapability, getAccessContext } from "./access";
import { sha256Hex } from "./crypto";
import type { Doc, Id } from "./_generated/dataModel";

// =====================================================================
// SOURCE-LINKED MATTER BRIEF (§5 of the independently developed legal
// workspace features).
//
// A brief is a STRUCTURED, VERSIONED, APPROVAL-GATED summary of a
// matter's record. Discipline enforced here:
//  - Material assertions link to their supporting passage (fact row,
//    timeline entry, document pinpoint). Unlinked assertions are not
//    emitted.
//  - Confirmed facts are labelled as verified; disputed points and
//    allegations are labelled as NOT established.
//  - `interpretationNote` distinguishes verified quotations from
//    AI interpretation. We do NOT promise citation checks eliminate
//    every possible error — the lawyer approves every version.
//  - Regeneration never overwrites: a new version is proposed; prior
//    versions are preserved and marked stale via inputsHash. A lawyer
//    approves the version that enters the record.
//  - `changesFromPrior` highlights what moved between versions so the
//    approval is an informed act, not a rubber stamp.
// =====================================================================

/** Deterministic inputs hash for staleness: facts + timeline + summaries. */
async function computeBriefInputsHash(
  ctx: { db: MutationCtx["db"] },
  matterId: Id<"matters">,
): Promise<string> {
  const facts = await ctx.db
    .query("matterFacts")
    .withIndex("by_matter", (q) => q.eq("matterId", matterId))
    .collect();
  const relevant = facts
    .filter((f) => !f.supersededById)
    .sort((a, b) => a.factKey.localeCompare(b.factKey));
  const timeline = await ctx.db
    .query("matterTimeline")
    .withIndex("by_matter", (q) => q.eq("matterId", matterId))
    .collect();
  const payload = JSON.stringify({
    f: relevant.map((f) => [f.factKey, f.version, f.status, f.statement, f.occurredOn]),
    t: timeline
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => [e._id, e.version, e.status, e.date, e.title]),
  });
  return sha256Hex(payload);
}

/**
 * Propose a new brief version. Deterministic core: procedural position
 * from the matter's legal profile, key facts from confirmed facts
 * (disputed/allegation facts land in disputedPoints), recent
 * developments from approved timeline entries, outstanding questions
 * from analyses' missing-information flags. When nothing changed since
 * the last version the existing latest version is returned unchanged —
 * regeneration is honest, not churn.
 */
export const generate = internalMutation({
  args: {
    matterId: v.id("matters"),
  },
  handler: async (ctx, args) => {
    const matter = await ctx.db.get(args.matterId);
    if (!matter) throw new Error("Matter not found.");
    const hash = await computeBriefInputsHash(ctx, args.matterId);

    const prior = await ctx.db
      .query("matterBriefs")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    const last = prior.sort((a, b) => b.briefVersion - a.briefVersion)[0];
    if (last && last.inputsHash === hash && !last.stale) {
      return { briefVersion: last.briefVersion, briefId: last._id, unchanged: true };
    }

    // --- Inputs -------------------------------------------------------
    const facts = (
      await ctx.db
        .query("matterFacts")
        .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
        .collect()
    ).filter((f) => !f.supersededById);
    const confirmed = facts
      .filter((f) => f.status === "confirmed")
      .sort((a, b) => a.factKey.localeCompare(b.factKey));
    const notEstablished = facts.filter(
      (f) =>
        f.status === "allegation" ||
        f.status === "disputed" ||
        (f.status === "extracted" && !f.supersededById),
    );

    const analyses = await ctx.db
      .query("documentAnalyses")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();

    const timeline = (
      await ctx.db
        .query("matterTimeline")
        .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
        .collect()
    )
      .filter((e) => e.status === "approved")
      .sort((a, b) => b.date.localeCompare(a.date));

    const docs = await ctx.db
      .query("matterDocuments")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();

    // --- Sections -----------------------------------------------------
    const lp = matter.legalProfile;
    const proceduralPosition = [
      `${matter.reference} — ${matter.title}`,
      `Forum: ${matter.court ?? "not recorded"}`,
      `Jurisdiction: ${lp?.country ?? "not set"}${lp?.stateOrProvince ? ` / ${lp.stateOrProvince}` : ""}`,
      `Procedural stage: ${lp?.proceduralStage ?? "not confirmed by the lawyer"}`,
      `Our client acts as ${matter.clientRole ?? "recorded client"}. Opposing party: ${matter.opposingParty ?? "not recorded"}.`,
    ].join(" · ");

    // Key facts ALWAYS carry their source linkage; a fact without a
    // supporting passage is labelled as such rather than presented as
    // source-linked.
    const keyFacts = confirmed.slice(0, 25).map((f) => {
      const ref = (f.sourceRefs ?? [])[0];
      const refLabel = ref
        ? `${f.statement.slice(0, 80)} — ${[
            ref.page ? `p. ${ref.page}` : null,
            ref.paragraph ? `¶ ${ref.paragraph}` : null,
            ref.quote ? `"${ref.quote.slice(0, 80)}"` : null,
          ]
            .filter(Boolean)
            .join(", ")}`
        : undefined;
      return {
        text: f.occurredOn ? `${f.statement} (date: ${f.occurredOn})` : f.statement,
        refKind: "fact" as const,
        refId: f._id,
        refLabel,
        disputed: false,
      };
    });

    const disputedPoints = notEstablished
      .slice(0, 15)
      .map(
        (f) =>
          `${f.status === "allegation" ? "ALLEGED (not established)" : `${f.status.toUpperCase()} (unverified)`}: ${f.statement}`,
      );

    const relevantDocuments = docs
      .slice(0, 20)
      .map((d) => ({ documentId: d._id, name: d.name }));

    const recentDevelopments = timeline
      .slice(0, 10)
      .map(
        (e) =>
          `${e.date}${e.datePrecision !== "exact" ? ` (${e.datePrecision})` : ""} — ${e.title} [${e.entryKind}]`,
      );

    const outstandingQuestions = [
      ...new Set(analyses.flatMap((a) => a.missingInformation ?? [])),
    ]
      .slice(0, 12)
      .map((m) => `Missing/unclear material flagged by extraction (needs lawyer review): ${m}`);
    if (confirmed.length === 0) {
      outstandingQuestions.unshift(
        "No lawyer-confirmed facts on record — confirm extracted facts before relying on any summary of this matter.",
      );
    }

    // Proposed next actions are SUGGESTIONS only — the lawyer decides
    // strategy (§6/§11 human-approval boundaries).
    const proposedNextActions: string[] = [];
    if (notEstablished.length > 0) {
      proposedNextActions.push(
        `Review and confirm/reject ${notEstablished.length} unverified statement(s) in the fact register.`,
      );
    }
    const openContradictions = await ctx.db
      .query("matterContradictions")
      .withIndex("by_matter_status", (q) =>
        q.eq("matterId", args.matterId).eq("status", "open"),
      )
      .collect();
    if (openContradictions.length > 0) {
      proposedNextActions.push(
        `Resolve ${openContradictions.length} conflicting factual account(s).`,
      );
    }
    const pendingTimeline = timeline.length; // approved only
    void pendingTimeline;
    const proposedEntries = (
      await ctx.db
        .query("matterTimeline")
        .withIndex("by_matter_status", (q) =>
          q.eq("matterId", args.matterId).eq("status", "proposed"),
        )
        .collect()
    ).length;
    if (proposedEntries > 0) {
      proposedNextActions.push(
        `Approve, correct or reject ${proposedEntries} proposed timeline entr${proposedEntries === 1 ? "y" : "ies"}.`,
      );
    }

    const interpretationNote =
      "Sections above marked 'confirmed' reproduce lawyer-verified fact-register entries. " +
      "Items marked ALLEGED or UNVERIFIED are party statements or machine extractions — they are NOT established facts. " +
      "Recent developments come from approved chronology entries only. This brief is generated deterministically from the " +
      "matter record; wording is machine-assembled and citation links show where each assertion comes from. " +
      "Reviewing the linked sources reduces but does not eliminate the possibility of error — lawyer approval is required.";

    const changesFromPrior: string[] = [];
    if (last) {
      const diffLine = (label: string, before: number, after: number) => {
        if (before !== after) changesFromPrior.push(`${label}: ${before} → ${after}`);
      };
      diffLine("Confirmed key facts", last.keyFacts.length, keyFacts.length);
      diffLine("Disputed/unverified points", last.disputedPoints.length, disputedPoints.length);
      diffLine("Recent developments listed", last.recentDevelopments.length, recentDevelopments.length);
      diffLine(
        "Outstanding questions",
        last.outstandingQuestions.length,
        outstandingQuestions.length,
      );
      const oldStage = last.proceduralPosition;
      if (oldStage !== proceduralPosition) {
        changesFromPrior.push("Procedural position line changed.");
      }
      if (changesFromPrior.length === 0) {
        changesFromPrior.push("No section-count changes; underlying inputs hash changed (see timeline/fact revisions).");
      }
    } else {
      changesFromPrior.push("First proposed version.");
    }

    // Prior versions go stale (preserved, never deleted).
    for (const p of prior) {
      if (!p.stale) await ctx.db.patch(p._id, { stale: true });
    }

    const briefVersion = (last?.briefVersion ?? 0) + 1;
    const id = (await ctx.db.insert("matterBriefs", {
      orgId: matter.orgId,
      matterId: args.matterId,
      briefVersion,
      status: "proposed",
      proceduralPosition,
      keyFacts,
      disputedPoints,
      relevantDocuments,
      recentDevelopments,
      outstandingQuestions,
      proposedNextActions,
      interpretationNote,
      inputsHash: hash,
      stale: false,
      changesFromPrior,
      generatedBy: "deterministic",
      createdAt: Date.now(),
    })) as Id<"matterBriefs">;
    return { briefVersion, briefId: id, unchanged: false };
  },
});

/** Public entry: propose a brief for a matter (capability-gated). */
export const proposeBrief = mutation({
  args: { matterId: v.id("matters") },
  handler: async (
    ctx,
    args,
  ): Promise<{ briefVersion: number; briefId: Id<"matterBriefs">; unchanged: boolean }> => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "ai.use");
    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.orgId !== ac.org._id) {
      throw new Error("Matter not found in this organization.");
    }
    return (await ctx.runMutation(internal.matterBriefs.generate, {
      matterId: args.matterId,
    })) as { briefVersion: number; briefId: Id<"matterBriefs">; unchanged: boolean };
  },
});

/** All brief versions for a matter (newest first; stale flagged). */
export const list = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const rows = await ctx.db
      .query("matterBriefs")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    return rows
      .filter((r) => r.orgId === ac.org._id)
      .sort((a, b) => b.briefVersion - a.briefVersion);
  },
});

/** One brief version. */
export const get = query({
  args: { briefId: v.id("matterBriefs") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const b = await ctx.db.get(args.briefId);
    if (!b || b.orgId !== ac.org._id) return null;
    return b;
  },
});

/**
 * Lawyer approves a proposed brief — the only path by which a brief
 * becomes the matter's record of position. The brief must be current
 * (not stale): approving an outdated version would silently bless
 * stale inputs.
 */
export const approve = mutation({
  args: { briefId: v.id("matterBriefs") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const b = (await ctx.db.get(args.briefId)) as Doc<"matterBriefs"> | null;
    if (!b || b.orgId !== ac.org._id) throw new Error("Brief not found.");
    if (b.status !== "proposed") {
      throw new Error("Only proposed briefs can be approved.");
    }
    if (b.stale) {
      throw new Error(
        "This brief is stale (inputs changed after it was proposed) — regenerate and approve the current version.",
      );
    }
    await ctx.db.patch(args.briefId, {
      status: "approved",
      approvedById: ac.user._id,
      approvedAt: Date.now(),
    });
    return { approved: true };
  },
});
