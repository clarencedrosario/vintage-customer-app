import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  can,
  canViewMatter,
  getAccessContext,
  requireAccess,
  requireMatter,
} from "./access";

// ===============================================================
// Draft review & approval desk.
//
// Every draft is a sequence of immutable versions. Approval attaches
// to one specific version; any later text change creates a new
// version whose state resets to `drafted` — an old approval can never
// implicitly cover new wording. Client updates must be approved
// before they can be marked shared for external delivery; only
// approved versions may be filed.
// ===============================================================

const MAX_BODY = 20000;
const MAX_NOTE = 2000;

function assertAuthorOrManager(
  ac: NonNullable<Awaited<ReturnType<typeof getAccessContext>>>,
  draft: Doc<"drafts">,
) {
  if (draft.createdById !== ac.user._id && !can(ac, "note.write")) {
    throw new Error("Only the author or a chamber member may revise this draft.");
  }
}

/** Who may review/approve: any member with note.write except the author. */
function assertReviewer(
  ac: NonNullable<Awaited<ReturnType<typeof getAccessContext>>>,
  version: Doc<"draftVersions">,
) {
  if (!can(ac, "note.write")) {
    throw new Error("You are not a reviewer on this desk.");
  }
  if (version.authorId === ac.user._id) {
    throw new Error("The author of a version cannot review or approve it.");
  }
}

async function loadDraftVersion(
  ctx: QueryCtx,
  draftId: Id<"drafts">,
  versionNo: number,
): Promise<Doc<"draftVersions">> {
  const rows = await ctx.db
    .query("draftVersions")
    .withIndex("by_draft", (q) => q.eq("draftId", draftId))
    .collect();
  const found = rows.find((r) => r.version === versionNo);
  if (!found) throw new Error("That version does not exist.");
  return found;
}

// ---------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------

/** The review desk: drafts visible to the caller, with viewer relations. */
export const desk = query({
  args: {
    filter: v.union(
      v.literal("all"),
      v.literal("mine"),
      v.literal("to_review"),
      v.literal("awaiting_approval"),
      v.literal("approved"),
    ),
  },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const rows = await ctx.db
      .query("drafts")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();

    const userIds = new Set<Id<"users">>();
    for (const d of rows) userIds.add(d.createdById);
    const nameByUser = new Map<Id<"users">, string>();
    for (const id of userIds) {
      const u = await ctx.db.get(id);
      if (u) nameByUser.set(id, u.name ?? u.email ?? "Member");
    }

    // Matter references for linked drafts.
    const matterIds = Array.from(
      new Set(rows.map((d) => d.matterId).filter((x): x is Id<"matters"> => x !== undefined)),
    );
    const refByMatter = new Map<Id<"matters">, string>();
    for (const id of matterIds) {
      const m = await ctx.db.get(id);
      if (m && canViewMatter(ac, m)) refByMatter.set(id, m.reference);
    }

    const allVersions = await ctx.db
      .query("draftVersions")
      .withIndex("by_draft")
      .collect();
    const versionsByDraft = new Map<Id<"drafts">, Doc<"draftVersions">[]>();
    for (const vRow of allVersions) {
      const list = versionsByDraft.get(vRow.draftId) ?? [];
      list.push(vRow);
      versionsByDraft.set(vRow.draftId, list);
    }

    const out = [];
    for (const d of rows) {
      if (d.matterId !== undefined && !refByMatter.has(d.matterId)) {
        // Draft on a matter the caller cannot see — skip entirely.
        continue;
      }
      const versions = (versionsByDraft.get(d._id) ?? []).sort(
        (a, b) => b.version - a.version,
      );
      const current = versions.find((vRow) => vRow.version === d.currentVersion);
      if (!current) continue;

      const mine = d.createdById === ac.user._id;
      const toReview =
        current.reviewerId === ac.user._id &&
        (current.status === "in_review" || current.status === "drafted") &&
        current.authorId !== ac.user._id;

      if (args.filter === "mine" && !mine) continue;
      if (args.filter === "to_review" && !toReview) continue;
      if (args.filter === "awaiting_approval" && current.status !== "in_review") continue;
      if (
        args.filter === "approved" &&
        current.status !== "approved" &&
        current.status !== "shared" &&
        current.status !== "filed"
      ) {
        continue;
      }

      const openCRs = (
        await ctx.db
          .query("draftComments")
          .withIndex("by_draft", (q) => q.eq("draftId", d._id))
          .collect()
      ).filter(
        (c) => c.version === d.currentVersion && c.isChangeRequest && !c.resolvedAt,
      ).length;

      out.push({
        _id: d._id,
        title: d.title,
        kind: d.kind,
        status: d.status,
        currentVersion: d.currentVersion,
        authorName: nameByUser.get(d.createdById) ?? "Member",
        mine,
        toReview,
        openChangeRequests: openCRs,
        matterId: d.matterId ?? null,
        matterReference: d.matterId ? (refByMatter.get(d.matterId) ?? null) : null,
        versionCount: versions.length,
        updatedAt: d.updatedAt,
      });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

/** One draft: versions, comments, and what the caller may do. */
export const detail = query({
  args: { draftId: v.id("drafts") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const d = await ctx.db.get(args.draftId);
    if (!d || d.orgId !== ac.org._id) return null;
    if (d.matterId !== undefined) {
      const m = await ctx.db.get(d.matterId);
      if (!m || !canViewMatter(ac, m)) return null;
    }

    const versions = (
      await ctx.db
        .query("draftVersions")
        .withIndex("by_draft", (q) => q.eq("draftId", d._id))
        .collect()
    ).sort((a, b) => b.version - a.version);

    let matterReference: string | null = null;
    if (d.matterId !== undefined) {
      const m = await ctx.db.get(d.matterId);
      matterReference = m?.reference ?? null;
    }

    const comments = (
      await ctx.db
        .query("draftComments")
        .withIndex("by_draft", (q) => q.eq("draftId", d._id))
        .collect()
    ).sort((a, b) => a.createdAt - b.createdAt);

    const userIds = new Set<Id<"users">>();
    userIds.add(d.createdById);
    for (const vRow of versions) {
      userIds.add(vRow.authorId);
      if (vRow.reviewerId) userIds.add(vRow.reviewerId);
      if (vRow.approvedById) userIds.add(vRow.approvedById);
    }
    for (const c of comments) userIds.add(c.authorId);
    const nameByUser = new Map<Id<"users">, string>();
    for (const id of userIds) {
      const u = await ctx.db.get(id);
      if (u) nameByUser.set(id, u.name ?? u.email ?? "Member");
    }

    const current = versions.find((vRow) => vRow.version === d.currentVersion);
    const openChangeRequests = comments.filter(
      (c) => c.version === d.currentVersion && c.isChangeRequest && !c.resolvedAt,
    ).length;

    return {
      _id: d._id,
      title: d.title,
      kind: d.kind,
      status: d.status,
      matterId: d.matterId ?? null,
      matterReference,
      currentVersion: d.currentVersion,
      currentBody: current?.body ?? "",
      currentVersionStatus: current?.status ?? "drafted",
      currentReviewerName: current?.reviewerId
        ? (nameByUser.get(current.reviewerId) ?? null)
        : null,
      currentAuthorName: current ? (nameByUser.get(current.authorId) ?? null) : null,
      openChangeRequests,
      canReview:
        !!current && can(ac, "note.write") && current.authorId !== ac.user._id,
      isAuthorOrManager: d.createdById === ac.user._id || can(ac, "note.write"),
      versions: versions.map((vRow) => ({
        version: vRow.version,
        status: vRow.status,
        authorName: nameByUser.get(vRow.authorId) ?? "Member",
        reviewerName: vRow.reviewerId
          ? (nameByUser.get(vRow.reviewerId) ?? null)
          : null,
        reviewNote: vRow.reviewNote ?? null,
        reviewedAt: vRow.reviewedAt ?? null,
        approvedByName: vRow.approvedById
          ? (nameByUser.get(vRow.approvedById) ?? null)
          : null,
        approvedAt: vRow.approvedAt ?? null,
        revisesVersion: vRow.revisesVersion ?? null,
        createdAt: vRow.createdAt,
        isCurrent: vRow.version === d.currentVersion,
      })),
      comments: comments.map((c) => ({
        _id: c._id,
        version: c.version,
        authorName: nameByUser.get(c.authorId) ?? "Member",
        body: c.body,
        isChangeRequest: c.isChangeRequest === true,
        resolvedAt: c.resolvedAt ?? null,
        createdAt: c.createdAt,
        isCurrentVersion: c.version === d.currentVersion,
      })),
    };
  },
});

// ---------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------

/** Create a draft (optionally linked to a matter). */
export const create = mutation({
  args: {
    title: v.string(),
    kind: v.union(
      v.literal("client_update"),
      v.literal("legal_notice"),
      v.literal("petition_draft"),
      v.literal("internal_memo"),
      v.literal("other"),
    ),
    body: v.string(),
    matterId: v.optional(v.id("matters")),
    reviewerId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!args.title.trim()) throw new Error("Give the draft a title.");
    if (!args.body.trim()) throw new Error("Write the draft text.");
    if (args.body.length > MAX_BODY) {
      throw new Error(`Draft text must be at most ${MAX_BODY} characters.`);
    }
    if (args.matterId !== undefined) {
      await requireMatter(ctx, ac, args.matterId);
    }
    if (args.reviewerId !== undefined) {
      const m = await ctx.db
        .query("memberships")
        .withIndex("by_org_user", (q) =>
          q.eq("orgId", ac.org._id).eq("userId", args.reviewerId!),
        )
        .first();
      if (!m || m.status !== "active") {
        throw new Error("Reviewers must be active members of the organisation.");
      }
    }

    const now = Date.now();
    const draftId = await ctx.db.insert("drafts", {
      orgId: ac.org._id,
      matterId: args.matterId,
      title: args.title.trim().slice(0, 200),
      kind: args.kind,
      currentVersion: 1,
      status: "drafted",
      createdById: ac.user._id,
      updatedAt: now,
      createdAt: now,
    });
    await ctx.db.insert("draftVersions", {
      draftId,
      version: 1,
      body: args.body,
      status: "drafted",
      authorId: ac.user._id,
      reviewerId: args.reviewerId,
      createdAt: now,
    });
    return { draftId };
  },
});

/**
 * Revise: creates a NEW version. Any prior approval of earlier versions
 * does not carry over — the new version starts at `drafted`.
 */
export const revise = mutation({
  args: {
    draftId: v.id("drafts"),
    body: v.string(),
    reviewerId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const d = await ctx.db.get(args.draftId);
    if (!d || d.orgId !== ac.org._id) throw new Error("Draft not found.");
    assertAuthorOrManager(ac, d);
    if (!args.body.trim()) throw new Error("The revision cannot be empty.");
    if (args.body.length > MAX_BODY) {
      throw new Error(`Draft text must be at most ${MAX_BODY} characters.`);
    }

    const prev = await loadDraftVersion(ctx, d._id, d.currentVersion);
    let reviewerId = args.reviewerId;
    if (reviewerId !== undefined) {
      const m = await ctx.db
        .query("memberships")
        .withIndex("by_org_user", (q) =>
          q.eq("orgId", ac.org._id).eq("userId", reviewerId!),
        )
        .first();
      if (!m || m.status !== "active") {
        throw new Error("Reviewers must be active members of the organisation.");
      }
      if (reviewerId === ac.user._id) {
        throw new Error("You cannot assign yourself to review your own draft.");
      }
    } else if (prev.reviewerId && prev.reviewerId !== ac.user._id) {
      reviewerId = prev.reviewerId; // carry the reviewer forward
    }

    const nextVersion = d.currentVersion + 1;
    const now = Date.now();
    await ctx.db.insert("draftVersions", {
      draftId: d._id,
      version: nextVersion,
      body: args.body,
      status: "drafted",
      authorId: ac.user._id,
      reviewerId,
      revisesVersion: d.currentVersion,
      createdAt: now,
    });
    await ctx.db.patch(d._id, {
      currentVersion: nextVersion,
      status: "drafted",
      updatedAt: now,
    });
  },
});

/** Assign/reassign the reviewer of the current version. */
export const assignReviewer = mutation({
  args: { draftId: v.id("drafts"), reviewerId: v.id("users") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const d = await ctx.db.get(args.draftId);
    if (!d || d.orgId !== ac.org._id) throw new Error("Draft not found.");
    assertAuthorOrManager(ac, d);
    const m = await ctx.db
      .query("memberships")
      .withIndex("by_org_user", (q) =>
        q.eq("orgId", ac.org._id).eq("userId", args.reviewerId),
      )
      .first();
    if (!m || m.status !== "active") {
      throw new Error("Reviewers must be active members of the organisation.");
    }
    if (args.reviewerId === ac.user._id) {
      throw new Error("You cannot review your own draft.");
    }
    const current = await loadDraftVersion(ctx, d._id, d.currentVersion);
    await ctx.db.patch(current._id, { reviewerId: args.reviewerId });
  },
});

/** Send the current version for review. */
export const submitForReview = mutation({
  args: { draftId: v.id("drafts") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const d = await ctx.db.get(args.draftId);
    if (!d || d.orgId !== ac.org._id) throw new Error("Draft not found.");
    assertAuthorOrManager(ac, d);
    const current = await loadDraftVersion(ctx, d._id, d.currentVersion);
    if (current.status !== "drafted" && current.status !== "change_requested") {
      throw new Error("This version is already in review.");
    }
    if (!current.reviewerId) {
      throw new Error("Assign a reviewer before sending for review.");
    }
    if (current.reviewerId === ac.user._id) {
      throw new Error("The author cannot review their own version.");
    }
    await ctx.db.patch(current._id, { status: "in_review" });
    await ctx.db.patch(d._id, { status: "in_review", updatedAt: Date.now() });
  },
});

/** Comment or annotate a specific version. */
export const comment = mutation({
  args: {
    draftId: v.id("drafts"),
    body: v.string(),
    isChangeRequest: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const d = await ctx.db.get(args.draftId);
    if (!d || d.orgId !== ac.org._id) throw new Error("Draft not found.");
    if (!can(ac, "note.write")) {
      throw new Error("Only chamber members can annotate drafts.");
    }
    if (!args.body.trim()) throw new Error("Write the comment first.");
    await ctx.db.insert("draftComments", {
      draftId: d._id,
      version: d.currentVersion,
      authorId: ac.user._id,
      body: args.body.trim().slice(0, MAX_NOTE),
      isChangeRequest: args.isChangeRequest === true,
      createdAt: Date.now(),
    });
  },
});

/** Mark a change request resolved (the revision addressed it). */
export const resolveChangeRequest = mutation({
  args: { commentId: v.id("draftComments") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const c = await ctx.db.get(args.commentId);
    if (!c) throw new Error("Comment not found.");
    const d = await ctx.db.get(c.draftId);
    if (!d || d.orgId !== ac.org._id) throw new Error("Draft not found.");
    assertAuthorOrManager(ac, d);
    if (c.resolvedAt) throw new Error("Already resolved.");
    await ctx.db.patch(args.commentId, { resolvedAt: Date.now() });
  },
});

/**
 * Approve the current version — blocked while change requests on this
 * version remain open. The approval records who and when against this
 * exact version number.
 */
export const approve = mutation({
  args: { draftId: v.id("drafts"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const d = await ctx.db.get(args.draftId);
    if (!d || d.orgId !== ac.org._id) throw new Error("Draft not found.");
    const current = await loadDraftVersion(ctx, d._id, d.currentVersion);
    assertReviewer(ac, current);
    if (current.status === "approved" || current.status === "shared" || current.status === "filed") {
      throw new Error("This version is already approved.");
    }
    if (current.status === "drafted") {
      throw new Error("Send the version for review before approving.");
    }
    const openCRs = (
      await ctx.db
        .query("draftComments")
        .withIndex("by_draft", (q) => q.eq("draftId", d._id))
        .collect()
    ).filter(
      (c) => c.version === d.currentVersion && c.isChangeRequest && !c.resolvedAt,
    );
    if (openCRs.length > 0) {
      throw new Error(
        `${openCRs.length} change request(s) on this version must be resolved (or a revision made) before approval.`,
      );
    }

    const now = Date.now();
    await ctx.db.patch(current._id, {
      status: "approved",
      approvedAt: now,
      approvedById: ac.user._id,
      reviewedAt: now,
      reviewerId: ac.user._id,
      reviewNote: args.note?.trim().slice(0, MAX_NOTE) || current.reviewNote,
    });
    await ctx.db.patch(d._id, { status: "approved", updatedAt: now });
  },
});

/** Reject the current version with a reason; author revises and resubmits. */
export const rejectVersion = mutation({
  args: { draftId: v.id("drafts"), reason: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const d = await ctx.db.get(args.draftId);
    if (!d || d.orgId !== ac.org._id) throw new Error("Draft not found.");
    const current = await loadDraftVersion(ctx, d._id, d.currentVersion);
    assertReviewer(ac, current);
    if (!args.reason.trim()) {
      throw new Error("A rejection must explain what has to change.");
    }
    const now = Date.now();
    await ctx.db.patch(current._id, {
      status: "rejected",
      reviewNote: args.reason.trim().slice(0, MAX_NOTE),
      reviewedAt: now,
      reviewerId: ac.user._id,
    });
    await ctx.db.insert("draftComments", {
      draftId: d._id,
      version: d.currentVersion,
      authorId: ac.user._id,
      body: `Rejected: ${args.reason.trim().slice(0, MAX_NOTE)}`,
      isChangeRequest: true,
      createdAt: now,
    });
    await ctx.db.patch(d._id, { status: "rejected", updatedAt: now });
  },
});

/**
 * Mark an approved version as shared with the client (external
 * delivery). Only the approved version itself may be shared — after
 * which any new revision restarts the approval cycle before sharing
 * again.
 */
export const markShared = mutation({
  args: { draftId: v.id("drafts") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const d = await ctx.db.get(args.draftId);
    if (!d || d.orgId !== ac.org._id) throw new Error("Draft not found.");
    const current = await loadDraftVersion(ctx, d._id, d.currentVersion);
    if (current.status !== "approved") {
      throw new Error(
        "Only an approved version can be shared with the client. Revise and get fresh approval first.",
      );
    }
    if (current.approvedById === undefined) {
      throw new Error("This version has no recorded approver.");
    }
    await ctx.db.patch(current._id, { status: "shared" });
    await ctx.db.patch(d._id, { status: "shared", updatedAt: Date.now() });
  },
});

/** Mark an approved/shared version as filed (e.g. lodged in court). */
export const markFiled = mutation({
  args: { draftId: v.id("drafts") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "note.write")) {
      throw new Error("Only chamber members may record filing.");
    }
    const d = await ctx.db.get(args.draftId);
    if (!d || d.orgId !== ac.org._id) throw new Error("Draft not found.");
    const current = await loadDraftVersion(ctx, d._id, d.currentVersion);
    if (current.status !== "approved" && current.status !== "shared") {
      throw new Error("Only an approved version can be recorded as filed.");
    }
    await ctx.db.patch(current._id, { status: "filed" });
    await ctx.db.patch(d._id, { status: "filed", updatedAt: Date.now() });
  },
});
