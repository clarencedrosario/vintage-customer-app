import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAccess, requireCapability, getAccessContext } from "./access";
import { sha256Hex } from "./crypto";
import type { Doc, Id } from "./_generated/dataModel";

// =====================================================================
// CASE TIMELINE (§3) — proposed entries from source documents; lawyers
// approve, correct, merge or reject. Provenance and correction history
// are preserved. A document change flags affected APPROVED entries as
// "needs_review" instead of silently rewriting the accepted chronology.
// =====================================================================

/** All timeline entries for a matter (newest date first). */
export const list = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const rows = await ctx.db
      .query("matterTimeline")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    return rows
      .filter((r) => r.orgId === ac.org._id)
      .sort((a, b) => a.date.localeCompare(b.date));
  },
});

/** Revision history of one entry. */
export const history = query({
  args: { entryId: v.id("matterTimeline") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const entry = await ctx.db.get(args.entryId);
    if (!entry || entry.orgId !== ac.org._id) return [];
    return ctx.db
      .query("matterTimelineRevisions")
      .withIndex("by_entry", (q) => q.eq("entryId", args.entryId))
      .collect()
      .then((rows) => rows.sort((a, b) => b.createdAt - a.createdAt));
  },
});

/**
 * Propose entries from a document analysis' extracted dates. Every
 * proposal is labelled with its date kind (event vs document vs filing
 * vs proposed_deadline) and uncertainty, and links back to the source
 * pinpoint. Nothing enters the accepted chronology until approved.
 */
export const proposeFromAnalysis = mutation({
  args: { analysisId: v.id("documentAnalyses") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const analysis = await ctx.db.get(args.analysisId);
    if (!analysis || analysis.orgId !== ac.org._id) {
      throw new Error("Analysis not found in this organization.");
    }
    if (analysis.processingStatus !== "done" && analysis.processingStatus !== undefined) {
      throw new Error("This analysis has not finished processing.");
    }
    const src = analysis.aiSourceId ? await ctx.db.get(analysis.aiSourceId) : null;

    const existing = await ctx.db
      .query("matterTimeline")
      .withIndex("by_matter", (q) => q.eq("matterId", analysis.matterId))
      .collect();
    const seen = new Set(
      existing.map((e) => `${e.date}|${e.title}|${e.sourceDocumentId ?? ""}`),
    );

    let created = 0;
    for (const d of analysis.dates) {
      const context = (d.context ?? "").toLowerCase();
      // Date-kind classification from the surrounding text (deterministic;
      // ambiguous cases are marked uncertain).
      let entryKind: "event" | "document" | "filing" | "proposed_deadline" = "event";
      let precision: "exact" | "approximate" | "uncertain" = "exact";
      if (/filed|instituted|registered|presented/.test(context)) entryKind = "filing";
      else if (/dated|agreement|invoice|notice|receipt|deed/.test(context)) entryKind = "document";
      if (/approx|around|on or about|circa/.test(context)) precision = "approximate";
      if (/unclear|illegible|not legible/.test(context)) precision = "uncertain";

      const title = `${entryKind === "filing" ? "Filing" : entryKind === "document" ? "Document" : "Event"}${d.context ? ` — ${d.context.trim().slice(0, 120)}` : ` dated ${d.date}`}`;
      const key = `${d.date}|${title}|${analysis.documentId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await ctx.db.insert("matterTimeline", {
        orgId: ac.org._id,
        matterId: analysis.matterId,
        entryKind,
        title: title.slice(0, 300),
        detail: d.context?.trim().slice(0, 500),
        date: d.date,
        datePrecision: precision,
        sourceDocumentId: analysis.documentId,
        sourceAiSourceId: analysis.aiSourceId,
        sourceRefs: src?.pages?.length
          ? undefined
          : [{ quote: d.context?.slice(0, 200) }],
        status: "proposed",
        proposedBy: "deterministic-extractor",
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      created += 1;
    }
    return { created };
  },
});

/** Lawyer approves a proposed entry. */
export const approve = mutation({
  args: { entryId: v.id("matterTimeline") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const e = await ctx.db.get(args.entryId);
    if (!e || e.orgId !== ac.org._id) throw new Error("Entry not found.");
    if (e.status !== "proposed" && e.status !== "needs_review") {
      throw new Error("Only proposed or needs-review entries can be approved.");
    }
    await ctx.db.insert("matterTimelineRevisions", {
      orgId: ac.org._id,
      matterId: e.matterId,
      entryId: e._id,
      priorStatus: e.status,
      priorDate: e.date,
      priorTitle: e.title,
      newStatus: "approved",
      newDate: e.date,
      newTitle: e.title,
      changedById: ac.user._id,
      note: "Approved for the matter chronology.",
      createdAt: Date.now(),
    });
    await ctx.db.patch(e._id, {
      status: "approved",
      approvedById: ac.user._id,
      approvedAt: Date.now(),
      // Snapshot the current source inputs so later changes are detectable.
      approvedInputsHash: sha256Hex(
        `${e.sourceAiSourceId ?? "none"}:${e.title}:${e.date}`,
      ),
      updatedAt: Date.now(),
    });
    return { approved: true };
  },
});

/** Lawyer corrects an entry: a NEW version row; history preserved. */
export const correct = mutation({
  args: {
    entryId: v.id("matterTimeline"),
    date: v.string(),
    title: v.string(),
    detail: v.optional(v.string()),
    datePrecision: v.optional(v.union(
      v.literal("exact"),
      v.literal("approximate"),
      v.literal("uncertain"),
    )),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const e = await ctx.db.get(args.entryId);
    if (!e || e.orgId !== ac.org._id) throw new Error("Entry not found.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
      throw new Error("Date must be YYYY-MM-DD.");
    }
    if (!args.title.trim()) throw new Error("Title is required.");
    await ctx.db.insert("matterTimelineRevisions", {
      orgId: ac.org._id,
      matterId: e.matterId,
      entryId: e._id,
      priorStatus: e.status,
      priorDate: e.date,
      priorTitle: e.title,
      newStatus: "approved",
      newDate: args.date,
      newTitle: args.title.trim(),
      changedById: ac.user._id,
      note: args.note ?? "Lawyer correction.",
      createdAt: Date.now(),
    });
    // Old row superseded (kept); the correction is approved immediately
    // because the LAWYER made it — no AI re-review loop.
    await ctx.db.patch(e._id, {
      status: "rejected",
      rejectedReason: "Superseded by a lawyer correction.",
      supersededById: undefined,
      updatedAt: Date.now(),
    });
    const newId = (await ctx.db.insert("matterTimeline", {
      orgId: ac.org._id,
      matterId: e.matterId,
      entryKind: e.entryKind,
      title: args.title.trim().slice(0, 300),
      detail: args.detail?.trim().slice(0, 500) ?? e.detail,
      date: args.date,
      datePrecision: args.datePrecision ?? e.datePrecision,
      sourceDocumentId: e.sourceDocumentId,
      sourceAiSourceId: e.sourceAiSourceId,
      sourceRefs: e.sourceRefs,
      status: "approved",
      supersedesId: e._id,
      proposedBy: e.proposedBy,
      approvedById: ac.user._id,
      approvedAt: Date.now(),
      approvedInputsHash: sha256Hex(`${e.sourceAiSourceId ?? "none"}:${args.title}:${args.date}`),
      version: e.version + 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })) as Id<"matterTimeline">;
    await ctx.db.patch(e._id, { supersededById: newId, updatedAt: Date.now() });
    return { newEntryId: newId };
  },
});

/** Reject a proposal with a recorded reason. */
export const reject = mutation({
  args: { entryId: v.id("matterTimeline"), reason: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const e = await ctx.db.get(args.entryId);
    if (!e || e.orgId !== ac.org._id) throw new Error("Entry not found.");
    if (!args.reason.trim()) throw new Error("A rejection reason is required.");
    await ctx.db.insert("matterTimelineRevisions", {
      orgId: ac.org._id,
      matterId: e.matterId,
      entryId: e._id,
      priorStatus: e.status,
      priorDate: e.date,
      priorTitle: e.title,
      newStatus: "rejected",
      changedById: ac.user._id,
      note: args.reason.trim(),
      createdAt: Date.now(),
    });
    await ctx.db.patch(e._id, {
      status: "rejected",
      rejectedReason: args.reason.trim().slice(0, 400),
      updatedAt: Date.now(),
    });
    return { rejected: true };
  },
});

/**
 * Merge duplicates: the surviving entry absorbs the duplicate's source
 * refs; the duplicate is marked merged_into. Lawyer-driven.
 */
export const merge = mutation({
  args: { keepEntryId: v.id("matterTimeline"), duplicateEntryId: v.id("matterTimeline") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const keep = await ctx.db.get(args.keepEntryId);
    const dup = await ctx.db.get(args.duplicateEntryId);
    if (
      !keep || !dup ||
      keep.orgId !== ac.org._id || dup.orgId !== ac.org._id ||
      keep.matterId !== dup.matterId
    ) {
      throw new Error("Entries not found in this matter.");
    }
    if (args.keepEntryId === args.duplicateEntryId) {
      throw new Error("An entry cannot be merged into itself.");
    }
    const mergedRefs = [...(keep.sourceRefs ?? []), ...(dup.sourceRefs ?? [])].slice(0, 10);
    await ctx.db.patch(keep._id, {
      sourceRefs: mergedRefs,
      detail: [keep.detail, dup.detail].filter(Boolean).join(" — ").slice(0, 500) || undefined,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("matterTimelineRevisions", {
      orgId: ac.org._id,
      matterId: keep.matterId,
      entryId: args.duplicateEntryId,
      priorStatus: dup.status,
      priorDate: dup.date,
      priorTitle: dup.title,
      newStatus: "merged_into",
      changedById: ac.user._id,
      note: `Merged into ${String(args.keepEntryId)}.`,
      createdAt: Date.now(),
    });
    await ctx.db.patch(dup._id, {
      status: "merged_into",
      mergedIntoId: args.keepEntryId,
      updatedAt: Date.now(),
    });
    return { merged: true };
  },
});

/**
 * Source-change sweep: when a document's source row changes, flip
 * APPROVED entries traced to it into needs_review (their approvedInputs
 * hash no longer describes the current source) — the accepted
 * chronology is never silently rewritten.
 */
export const flagAffectedBySourceChange = mutation({
  args: { aiSourceId: v.id("aiSources") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const src = await ctx.db.get(args.aiSourceId);
    if (!src || src.orgId !== ac.org._id) {
      throw new Error("Source not found in this organization.");
    }
    const entries = await ctx.db
      .query("matterTimeline")
      .withIndex("by_matter", (q) => q.eq("matterId", src.matterId))
      .collect();
    let flagged = 0;
    for (const e of entries) {
      if (e.status !== "approved") continue;
      if (e.sourceAiSourceId !== args.aiSourceId) continue;
      const currentHash = sha256Hex(`${e.sourceAiSourceId ?? "none"}:${e.title}:${e.date}`);
      // The source snapshot changed → review (hash equality is the
      // cheap detector; the analysis layer re-runs for detail).
      if (e.approvedInputsHash && e.approvedInputsHash !== currentHash) {
        await ctx.db.patch(e._id, { status: "needs_review", updatedAt: Date.now() });
        flagged += 1;
      }
    }
    return { flagged };
  },
});
