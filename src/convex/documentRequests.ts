import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  getAccessContext,
  requireAccess,
  requireCapability,
  requireMatter,
} from "./access";
import { endOfDayIST } from "./tasks";
import { getCurrentUser } from "./users";
import type { Id } from "./_generated/dataModel";

// ===============================================================
// Client document-request checklists.
//
// Lawyers/staff request items from a client with instructions and a
// due date. The client uploads through a secure, checked upload URL.
// Every submission is preserved — review flows are requested →
// uploaded → under_review → accepted / rejected, and an accepted
// version is never silently overwritten: replacing it means a new
// submission that must be reviewed again.
//
// Reviewer identity is recorded on every decision. The accepted copy
// is filed on the matter's document record separately from the raw
// client submission until a reviewer accepts it.
// ===============================================================

const MAX_TEXT = 2000;
const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Who may review client submissions on a matter. */
function assertCanReview(
  ac: NonNullable<Awaited<ReturnType<typeof getAccessContext>>>,
) {
  requireCapability(ac, "task.manage");
}

// ---------------------------------------------------------------------
// Chamber queries
// ---------------------------------------------------------------------

/** The checklist for one matter (chamber side). */
export const listForMatter = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    await requireMatter(ctx, ac, args.matterId);

    const rows = await ctx.db
      .query("documentRequests")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();

    const userIds = new Set<string>();
    for (const r of rows) {
      userIds.add(r.requestedById);
      if (r.reviewedById) userIds.add(r.reviewedById);
      for (const c of r.comments ?? []) {
        if (c.authorId) userIds.add(c.authorId);
      }
    }
    const nameByUser = new Map<string, string>();
    for (const id of userIds) {
      const u = await ctx.db.get(id as Id<"users">);
      if (u) nameByUser.set(id, u.name ?? u.email ?? "Member");
    }

    return rows
      .sort((a, b) => {
        const rank = { requested: 0, uploaded: 0, under_review: 0, rejected: 1, accepted: 2 } as Record<string, number>;
        const ra = rank[a.status] ?? 3;
        const rb = rank[b.status] ?? 3;
        if (ra !== rb) return ra - rb;
        return (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity);
      })
      .map((r) => ({
        _id: r._id,
        title: r.title,
        instructions: r.instructions ?? null,
        dueAt: r.dueAt ?? null,
        status: r.status,
        currentStorageId: r.currentStorageId ?? null,
        currentUploadedAt: r.currentUploadedAt ?? null,
        submissionCount: (r.submissions ?? []).length,
        reviewNote: r.reviewNote ?? null,
        reviewedAt: r.reviewedAt ?? null,
        reviewedByName: r.reviewedById
          ? (nameByUser.get(r.reviewedById) ?? null)
          : null,
        acceptedDocumentId: r.acceptedDocumentId ?? null,
        lastReminderAt: r.lastReminderAt ?? null,
        requestedByName: nameByUser.get(r.requestedById) ?? null,
        comments: (r.comments ?? []).map((c) => ({
          body: c.body,
          at: c.at,
          fromClient: c.fromClient,
          authorName: c.fromClient
            ? "Client"
            : c.authorId
              ? (nameByUser.get(c.authorId) ?? "Member")
              : "Member",
        })),
      }));
  },
});

/** Download URL for a checklist file (matter access enforced). */
export const getFileUrl = query({
  args: { requestId: v.id("documentRequests"), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const r = await ctx.db.get(args.requestId);
    if (!r) return null;
    await requireMatter(ctx, ac, r.matterId);
    if (
      r.currentStorageId !== args.storageId &&
      !(r.submissions ?? []).some((s) => s.storageId === args.storageId)
    ) {
      return null;
    }
    return await ctx.storage.getUrl(args.storageId);
  },
});

// ---------------------------------------------------------------------
// Chamber mutations
// ---------------------------------------------------------------------

/** Request a document from the client (task.manage). */
export const request = mutation({
  args: {
    matterId: v.id("matters"),
    title: v.string(),
    instructions: v.optional(v.string()),
    dueDate: v.optional(v.string()), // YYYY-MM-DD
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    assertCanReview(ac);
    await requireMatter(ctx, ac, args.matterId);
    if (!args.title.trim()) throw new Error("Name the document you need.");

    const requestId = await ctx.db.insert("documentRequests", {
      orgId: ac.org._id,
      matterId: args.matterId,
      requestedById: ac.user._id,
      title: args.title.trim().slice(0, 200),
      instructions: args.instructions?.trim().slice(0, MAX_TEXT) || undefined,
      dueAt: args.dueDate ? endOfDayIST(args.dueDate) : undefined,
      status: "requested",
      createdAt: Date.now(),
    });

    await ctx.db.insert("matterEvents", {
      matterId: args.matterId,
      kind: "document",
      detail: `Document requested from the client — ${args.title.trim()}.`,
      createdAt: Date.now(),
      authorId: ac.user._id,
      occurredAt: Date.now(),
      datePrecision: "exact",
      linkId: requestId,
    });
    return { requestId };
  },
});

/** Edit instructions or due date of an open request. */
export const editRequest = mutation({
  args: {
    requestId: v.id("documentRequests"),
    title: v.optional(v.string()),
    instructions: v.optional(v.string()),
    dueDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    assertCanReview(ac);
    const r = await ctx.db.get(args.requestId);
    if (!r || r.orgId !== ac.org._id) throw new Error("Request not found.");
    await requireMatter(ctx, ac, r.matterId);

    const patch: Record<string, unknown> = {};
    if (args.title !== undefined && args.title.trim()) {
      patch.title = args.title.trim().slice(0, 200);
    }
    if (args.instructions !== undefined) {
      patch.instructions = args.instructions.trim().slice(0, MAX_TEXT) || undefined;
    }
    if (args.dueDate !== undefined) {
      patch.dueAt = args.dueDate ? endOfDayIST(args.dueDate) : undefined;
    }
    await ctx.db.patch(args.requestId, patch);
  },
});

/** Move a submission into formal review. */
export const startReview = mutation({
  args: { requestId: v.id("documentRequests") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    assertCanReview(ac);
    const r = await ctx.db.get(args.requestId);
    if (!r || r.orgId !== ac.org._id) throw new Error("Request not found.");
    await requireMatter(ctx, ac, r.matterId);
    if (r.status !== "uploaded") {
      throw new Error("Only a freshly uploaded document can move to review.");
    }
    await ctx.db.patch(args.requestId, { status: "under_review" });
  },
});

/**
 * Accept the current submission. The accepted copy is filed on the
 * matter's document record (firm evidence), clearly attributed to the
 * client's submission and the reviewer.
 */
export const accept = mutation({
  args: { requestId: v.id("documentRequests"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    assertCanReview(ac);
    const r = await ctx.db.get(args.requestId);
    if (!r || r.orgId !== ac.org._id) throw new Error("Request not found.");
    await requireMatter(ctx, ac, r.matterId);
    if (r.status !== "uploaded" && r.status !== "under_review") {
      throw new Error("There is no pending submission to accept.");
    }
    if (r.currentStorageId === undefined) {
      throw new Error("No file has been uploaded for this request yet.");
    }

    // File the accepted version on the matter's document record as its
    // own row — the raw client submission stays in the checklist trail.
    const acceptedDocumentId = await ctx.db.insert("matterDocuments", {
      matterId: r.matterId,
      uploaderId: ac.user._id,
      name: r.title,
      kind: "document",
      visibility: "internal",
      storageId: r.currentStorageId,
      submittedByClient: true,
      // Carry the submission's hash forward if the checklist recorded one.
      integritySha256: r.currentIntegritySha256,
      custody: [
        {
          at: Date.now(),
          byId: ac.user._id,
          byName: ac.user.name ?? ac.user.email ?? "Member",
          action: "accepted_from_request" as const,
        },
      ],
      createdAt: Date.now(),
    });

    await ctx.db.patch(args.requestId, {
      status: "accepted",
      reviewNote: args.note?.trim().slice(0, MAX_TEXT) || undefined,
      reviewedAt: Date.now(),
      reviewedById: ac.user._id,
      acceptedDocumentId,
    });

    await ctx.db.insert("matterEvents", {
      matterId: r.matterId,
      kind: "document",
      detail: `Client document accepted — ${r.title}${args.note?.trim() ? ` (${args.note.trim()})` : ""}.`,
      createdAt: Date.now(),
      authorId: ac.user._id,
      occurredAt: Date.now(),
      datePrecision: "exact",
      linkId: args.requestId,
    });
  },
});

/** Reject with an explanation — the client sees it on their portal. */
export const reject = mutation({
  args: { requestId: v.id("documentRequests"), reason: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    assertCanReview(ac);
    const r = await ctx.db.get(args.requestId);
    if (!r || r.orgId !== ac.org._id) throw new Error("Request not found.");
    await requireMatter(ctx, ac, r.matterId);
    if (r.status !== "uploaded" && r.status !== "under_review") {
      throw new Error("There is no pending submission to reject.");
    }
    if (!args.reason.trim()) {
      throw new Error("A rejection must carry an explanation for the client.");
    }

    await ctx.db.patch(args.requestId, {
      status: "rejected",
      reviewNote: args.reason.trim().slice(0, MAX_TEXT),
      reviewedAt: Date.now(),
      reviewedById: ac.user._id,
    });

    await ctx.db.insert("matterEvents", {
      matterId: r.matterId,
      kind: "document",
      detail: `Client document rejected — ${r.title}. Explanation sent to the client.`,
      createdAt: Date.now(),
      authorId: ac.user._id,
      occurredAt: Date.now(),
      datePrecision: "exact",
    });
  },
});

/**
 * Re-open a rejected request so the client can upload again. Any
 * previously accepted version remains filed; the new submission starts
 * a fresh review cycle.
 */
export const reopen = mutation({
  args: { requestId: v.id("documentRequests") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    assertCanReview(ac);
    const r = await ctx.db.get(args.requestId);
    if (!r || r.orgId !== ac.org._id) throw new Error("Request not found.");
    await requireMatter(ctx, ac, r.matterId);
    if (r.status !== "rejected" && r.status !== "accepted") {
      throw new Error("Only a rejected or accepted request can be re-opened.");
    }
    await ctx.db.patch(args.requestId, {
      status: "requested",
      // Keep the last submission visible in the trail; the next client
      // upload replaces `currentStorageId` but old storage ids remain in
      // `submissions`, so accepted versions are never overwritten.
      currentStorageId: r.status === "rejected" ? r.currentStorageId : undefined,
      currentUploadedAt: r.status === "rejected" ? r.currentUploadedAt : undefined,
      reviewNote: undefined,
      reviewedAt: undefined,
      reviewedById: undefined,
    });
  },
});

/** Record that a reminder was sent (24h cooldown). */
export const markReminderSent = mutation({
  args: { requestId: v.id("documentRequests") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    assertCanReview(ac);
    const r = await ctx.db.get(args.requestId);
    if (!r || r.orgId !== ac.org._id) throw new Error("Request not found.");
    await requireMatter(ctx, ac, r.matterId);
    if (r.status !== "requested" && r.status !== "rejected") {
      throw new Error("Reminders apply to items the client still owes.");
    }
    const last = r.lastReminderAt ?? 0;
    if (Date.now() - last < REMINDER_COOLDOWN_MS) {
      throw new Error("A reminder was recorded within the last 24 hours.");
    }
    await ctx.db.patch(args.requestId, { lastReminderAt: Date.now() });
  },
});

/** Add a chamber-side comment (visible to the client too). */
export const addComment = mutation({
  args: { requestId: v.id("documentRequests"), body: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    await requireMatter(ctx, ac, (await ctx.db.get(args.requestId))?.matterId ?? ("" as never));
    const r = await ctx.db.get(args.requestId);
    if (!r || r.orgId !== ac.org._id) throw new Error("Request not found.");
    if (!args.body.trim()) throw new Error("Write the comment first.");
    await ctx.db.patch(args.requestId, {
      comments: [
        ...(r.comments ?? []),
        {
          authorId: ac.user._id,
          fromClient: false,
          body: args.body.trim().slice(0, MAX_TEXT),
          at: Date.now(),
        },
      ],
    });
  },
});

// ---------------------------------------------------------------------
// Client portal queries + mutations
// ---------------------------------------------------------------------

/** The client's own checklist view (bound to the verified identity). */
export const clientChecklist = query({
  args: {},
  handler: async (ctx) => {
    const userDoc = await getCurrentUser(ctx);
    if (!userDoc || userDoc.isAnonymous) return [];
    const client = await ctx.db
      .query("clients")
      .withIndex("by_user", (q) => q.eq("userId", userDoc._id))
      .first();
    if (!client) return [];

    const matters = await ctx.db
      .query("matters")
      .withIndex("by_client", (q) => q.eq("clientId", client._id))
      .collect();
    const matterById = new Map(matters.map((m) => [m._id, m]));

    const out = [];
    for (const m of matters) {
      const rows = await ctx.db
        .query("documentRequests")
        .withIndex("by_matter", (q) => q.eq("matterId", m._id))
        .collect();
      for (const r of rows) {
        out.push({
          _id: r._id,
          matterId: r.matterId,
          matterReference: m.reference,
          matterTitle: m.title,
          title: r.title,
          instructions: r.instructions ?? null,
          dueAt: r.dueAt ?? null,
          status: r.status,
          hasFile: r.currentStorageId !== undefined,
          currentStorageId: r.currentStorageId ?? null,
          reviewNote: r.reviewNote ?? null,
          reviewedAt: r.reviewedAt ?? null,
          comments: (r.comments ?? []).map((c) => ({
            body: c.body,
            at: c.at,
            fromClient: c.fromClient,
          })),
        });
      }
    }
    void matterById;
    return out.sort((a, b) => {
      const rank = { requested: 0, uploaded: 0, under_review: 0, rejected: 1, accepted: 2 } as Record<string, number>;
      return (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity);
    });
  },
});

/** Secure upload URL for a specific open request (identity-checked). */
export const clientUploadUrl = mutation({
  args: { requestId: v.id("documentRequests") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");
    if (user.isAnonymous) throw new Error("Verified account required.");
    const client = await ctx.db
      .query("clients")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (!client) throw new Error("No client portal access.");

    const r = await ctx.db.get(args.requestId);
    if (!r) throw new Error("Request not found.");
    const matter = await ctx.db.get(r.matterId);
    if (!matter || matter.clientId !== client._id) {
      throw new Error("That request is not on your matters.");
    }
    if (r.status === "accepted") {
      throw new Error(
        "This document was accepted. Ask your lawyer to re-open it before uploading a new version.",
      );
    }
    if (r.status === "under_review") {
      throw new Error("This document is being reviewed — please wait.");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

/** Client submits a file against a request — appended, never overwriting accepted work. */
export const clientSubmit = mutation({
  args: {
    requestId: v.id("documentRequests"),
    name: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");
    if (user.isAnonymous) throw new Error("Verified account required.");
    const client = await ctx.db
      .query("clients")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (!client) throw new Error("No client portal access.");

    const r = await ctx.db.get(args.requestId);
    if (!r) throw new Error("Request not found.");
    const matter = await ctx.db.get(r.matterId);
    if (!matter || matter.clientId !== client._id) {
      throw new Error("That request is not on your matters.");
    }
    if (r.status === "accepted") {
      throw new Error(
        "This document was already accepted. Ask your lawyer to re-open the request for a new version.",
      );
    }
    if (r.status === "under_review") {
      throw new Error("This document is being reviewed — please wait.");
    }
    const name = args.name.trim().slice(0, 200);
    if (!name) throw new Error("File name is required.");

    await ctx.db.patch(args.requestId, {
      status: "uploaded",
      currentStorageId: args.storageId,
      currentUploadedAt: Date.now(),
      submissions: [
        ...(r.submissions ?? []),
        { storageId: args.storageId, name, uploadedAt: Date.now() },
      ],
      // A fresh upload clears a previous rejection's review state.
      reviewNote: undefined,
      reviewedAt: undefined,
      reviewedById: undefined,
    });

    await ctx.db.insert("matterEvents", {
      matterId: r.matterId,
      kind: "document",
      detail: `Client uploaded — ${r.title}. Awaiting review.`,
      createdAt: Date.now(),
    });

    // Notify the chamber: the matter's lead lawyer and the last reviewer;
    // fall back to active owners when neither is set.
    const matter2 = await ctx.db.get(r.matterId);
    if (matter2) {
      const targets = new Set<string>();
      if (r.reviewedById) targets.add(r.reviewedById);
      if (matter2.leadLawyerId) targets.add(matter2.leadLawyerId);
      if (targets.size === 0) {
        const members = await ctx.db
          .query("memberships")
          .withIndex("by_org", (q) => q.eq("orgId", r.orgId))
          .collect();
        for (const m of members) {
          if (m.status === "active" && m.orgRole === "owner") targets.add(m.userId);
        }
      }
      for (const uid of targets) {
        if (uid === user._id) continue;
        await ctx.runMutation(internal.notifications.createInternal, {
          orgId: r.orgId,
          userId: uid as never,
          kind: "doc_request",
          title: `Document submitted — ${r.title}`,
          body: `${client.name} uploaded a file. It is awaiting review.`,
          linkTo: `/matters/${r.matterId}?tab=documents`,
          dedupeKey: `doc_upload:${args.requestId}:${args.storageId}`,
        });
      }
    }
  },
});

/** Client comment on a request (visible to the chamber). */
export const clientComment = mutation({
  args: { requestId: v.id("documentRequests"), body: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");
    const client = await ctx.db
      .query("clients")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (!client) throw new Error("No client portal access.");
    const r = await ctx.db.get(args.requestId);
    if (!r) throw new Error("Request not found.");
    const matter = await ctx.db.get(r.matterId);
    if (!matter || matter.clientId !== client._id) {
      throw new Error("That request is not on your matters.");
    }
    if (!args.body.trim()) throw new Error("Write the comment first.");
    await ctx.db.patch(args.requestId, {
      comments: [
        ...(r.comments ?? []),
        { fromClient: true, body: args.body.trim().slice(0, MAX_TEXT), at: Date.now() },
      ],
    });
  },
});

/** Client download URL for instructions attachments (identity-checked). */
export const clientFileUrl = query({
  args: { requestId: v.id("documentRequests") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const client = await ctx.db
      .query("clients")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (!client) return null;
    const r = await ctx.db.get(args.requestId);
    if (!r) return null;
    const matter = await ctx.db.get(r.matterId);
    if (!matter || matter.clientId !== client._id) return null;
    return r.currentStorageId ? await ctx.storage.getUrl(r.currentStorageId) : null;
  },
});

// Keep the type import referenced for doc-shape documentation above.
export type DocumentRequestDoc = Doc<"documentRequests">;
