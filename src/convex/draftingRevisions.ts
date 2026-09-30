import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAccess, requireCapability } from "./access";
import type { Doc, Id } from "./_generated/dataModel";

// =====================================================================
// DRAFTING REVISIONS + RISK COMMENTS (§7 of the independently developed
// legal workspace features).
//
// "One-click improvement" means a lawyer-approved PROPOSED edit — never
// an autonomous legal decision. Every revision is a true diff pair
// (original excerpt → proposed replacement) with a stated reason and a
// risk level. Acceptance writes the change into the draft AND keeps the
// exact prior body so undo restores it verbatim. Risk comments are
// potential-risk flags pinned to a draft: they inform the lawyer and
// nothing auto-edits the draft.
// =====================================================================

const MAX_EXCERPT = 8_000;

/** All revisions for a draft use (newest first). */
export const listRevisions = query({
  args: { useId: v.id("templateUses") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const use = await ctx.db.get(args.useId);
    if (!use || use.orgId !== ac.org._id) return [];
    return ctx.db
      .query("draftRevisions")
      .withIndex("by_use", (q) => q.eq("useId", args.useId))
      .collect()
      .then((rows) => rows.sort((a, b) => b.createdAt - a.createdAt));
  },
});

/** All risk comments for a draft use (open first, then newest). */
export const listRiskComments = query({
  args: { useId: v.id("templateUses") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const use = await ctx.db.get(args.useId);
    if (!use || use.orgId !== ac.org._id) return [];
    const rows = await ctx.db
      .query("draftRiskComments")
      .withIndex("by_use", (q) => q.eq("useId", args.useId))
      .collect();
    return rows.sort((a, b) => {
      if ((a.status === "open") !== (b.status === "open")) return a.status === "open" ? -1 : 1;
      return b.createdAt - a.createdAt;
    });
  },
});

/**
 * Propose an edit: original excerpt → proposed replacement with a
 * reason and an optional risk level. The excerpt must actually occur
 * in the draft's current body (no proposals against text that is not
 * there — that keeps the diff honest).
 */
export const propose = mutation({
  args: {
    useId: v.id("templateUses"),
    originalExcerpt: v.string(),
    proposedExcerpt: v.string(),
    reason: v.string(),
    riskLevel: v.optional(
      v.union(v.literal("info"), v.literal("caution"), v.literal("high")),
    ),
    proposedById: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const use = (await ctx.db.get(args.useId)) as Doc<"templateUses"> | null;
    if (!use || use.orgId !== ac.org._id) {
      throw new Error("Draft use not found in this organization.");
    }
    if (!args.originalExcerpt) throw new Error("Original excerpt is required.");
    if (!args.proposedExcerpt) throw new Error("Proposed excerpt is required.");
    if (!args.reason.trim()) throw new Error("A reason is required for every proposed edit.");
    if (
      args.originalExcerpt.length > MAX_EXCERPT ||
      args.proposedExcerpt.length > MAX_EXCERPT
    ) {
      throw new Error("Excerpt too large.");
    }
    if (!use.renderedBody.includes(args.originalExcerpt)) {
      throw new Error(
        "The original excerpt no longer occurs in the current draft — refresh the draft view and re-propose against the current text.",
      );
    }
    // An identical open proposal for the same excerpt is a duplicate.
    const existing = await ctx.db
      .query("draftRevisions")
      .withIndex("by_use", (q) => q.eq("useId", args.useId))
      .collect();
    const duplicate = existing.find(
      (r) =>
        r.status === "proposed" &&
        r.originalExcerpt === args.originalExcerpt &&
        r.proposedExcerpt === args.proposedExcerpt,
    );
    if (duplicate) {
      return { revisionId: duplicate._id, duplicated: true as const };
    }
    const id = (await ctx.db.insert("draftRevisions", {
      orgId: ac.org._id,
      matterId: use.matterId,
      useId: use._id,
      proposedById: args.proposedById ?? "deterministic-rules",
      originalExcerpt: args.originalExcerpt,
      proposedExcerpt: args.proposedExcerpt,
      reason: args.reason.trim().slice(0, 600),
      riskLevel: args.riskLevel ?? "info",
      status: "proposed",
      createdAt: Date.now(),
    })) as Id<"draftRevisions">;
    return { revisionId: id, duplicated: false as const };
  },
});

/**
 * Lawyer accepts a proposed edit: the current body is snapshotted into
 * `bodyBefore` (undo support) and the excerpt is replaced in
 * `renderedBody`. Only proposed revisions can be accepted.
 */
export const accept = mutation({
  args: { revisionId: v.id("draftRevisions") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const rev = (await ctx.db.get(args.revisionId)) as Doc<"draftRevisions"> | null;
    if (!rev || rev.orgId !== ac.org._id) throw new Error("Revision not found.");
    if (rev.status !== "proposed") {
      throw new Error("Only proposed revisions can be accepted.");
    }
    const use = await ctx.db.get(rev.useId);
    if (!use || use.orgId !== ac.org._id) throw new Error("Draft use not found.");
    if (!use.renderedBody.includes(rev.originalExcerpt)) {
      throw new Error(
        "The draft has changed since this edit was proposed — reject it and re-propose against the current text.",
      );
    }
    const bodyBefore = use.renderedBody;
    await ctx.db.patch(use._id, {
      renderedBody: use.renderedBody.replace(rev.originalExcerpt, rev.proposedExcerpt),
    });
    await ctx.db.patch(rev._id, {
      status: "accepted",
      resolvedById: ac.user._id,
      resolvedAt: Date.now(),
      bodyBefore,
    });
    return { accepted: true };
  },
});

/** Lawyer rejects a proposed edit (stays on the record with the reason). */
export const reject = mutation({
  args: { revisionId: v.id("draftRevisions"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const rev = (await ctx.db.get(args.revisionId)) as Doc<"draftRevisions"> | null;
    if (!rev || rev.orgId !== ac.org._id) throw new Error("Revision not found.");
    if (rev.status !== "proposed") {
      throw new Error("Only proposed revisions can be rejected.");
    }
    await ctx.db.patch(rev._id, {
      status: "rejected",
      resolvedById: ac.user._id,
      resolvedAt: Date.now(),
    });
    void args.note;
    return { rejected: true };
  },
});

/**
 * Undo an accepted edit: restores the exact snapshotted body
 * (bodyBefore) and marks the revision undone. The revision row and its
 * diff remain on the record — undo is traceable, not an erasure.
 */
export const undo = mutation({
  args: { revisionId: v.id("draftRevisions") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const rev = (await ctx.db.get(args.revisionId)) as Doc<"draftRevisions"> | null;
    if (!rev || rev.orgId !== ac.org._id) throw new Error("Revision not found.");
    if (rev.status !== "accepted") {
      throw new Error("Only accepted revisions can be undone.");
    }
    if (!rev.bodyBefore) {
      throw new Error("No pre-acceptance snapshot stored for this revision.");
    }
    const use = await ctx.db.get(rev.useId);
    if (!use || use.orgId !== ac.org._id) throw new Error("Draft use not found.");
    await ctx.db.patch(use._id, {
      renderedBody: rev.bodyBefore,
    });
    await ctx.db.patch(rev._id, {
      status: "undone",
      resolvedById: ac.user._id,
      resolvedAt: Date.now(),
    });
    return { undone: true };
  },
});

/**
 * Add a potential-risk comment pinned to a draft (with reason, and an
 * optional source key). Comments advise; they never edit the draft.
 */
export const addRiskComment = mutation({
  args: {
    useId: v.id("templateUses"),
    excerpt: v.string(),
    concern: v.string(),
    reason: v.string(),
    sourceKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const use = (await ctx.db.get(args.useId)) as Doc<"templateUses"> | null;
    if (!use || use.orgId !== ac.org._id) {
      throw new Error("Draft use not found in this organization.");
    }
    if (!args.excerpt.trim() || !args.concern.trim() || !args.reason.trim()) {
      throw new Error("Excerpt, concern and reason are all required.");
    }
    const id = (await ctx.db.insert("draftRiskComments", {
      orgId: ac.org._id,
      useId: use._id,
      matterId: use.matterId,
      excerpt: args.excerpt.trim().slice(0, 400),
      concern: args.concern.trim().slice(0, 400),
      reason: args.reason.trim().slice(0, 600),
      sourceKey: args.sourceKey,
      status: "open",
      createdAt: Date.now(),
    })) as Id<"draftRiskComments">;
    return { commentId: id };
  },
});

/** Resolve a risk comment: addressed (the concern was dealt with) or dismissed. */
export const resolveRiskComment = mutation({
  args: {
    commentId: v.id("draftRiskComments"),
    resolution: v.union(v.literal("addressed"), v.literal("dismissed")),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const c = (await ctx.db.get(args.commentId)) as Doc<"draftRiskComments"> | null;
    if (!c || c.orgId !== ac.org._id) throw new Error("Risk comment not found.");
    if (c.status !== "open") throw new Error("This comment is already resolved.");
    await ctx.db.patch(args.commentId, {
      status: args.resolution,
      resolvedById: ac.user._id,
    });
    return { resolved: true };
  },
});
