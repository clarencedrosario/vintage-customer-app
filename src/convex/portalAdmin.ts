import { query } from "./_generated/server";
import { v } from "convex/values";
import {
  getAccessContext,
  can,
  canViewMatter,
  canViewDocument,
  requireMatter,
} from "./access";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Client Portal Administration (section 29 nav): the firm-side view of
 * everything that flows through the client portal — document requests
 * awaiting review, client-visible documents, portal accounts and
 * engagement stats. Permission-scoped like every other module.
 */
export const admin = query({
  args: {
    requestStatus: v.optional(
      v.union(
        v.literal("requested"),
        v.literal("uploaded"),
        v.literal("under_review"),
        v.literal("accepted"),
        v.literal("rejected"),
        v.literal("all"),
      ),
    ),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;

    const canReview =
      can(ac, "document.view_internal") || can(ac, "matter.view_all");

    const matters = (
      await ctx.db
        .query("matters")
        .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
        .collect()
    ).filter((m) => canViewMatter(ac, m));
    const matterById = new Map(matters.map((m) => [m._id, m]));

    // ---- Document requests across visible matters ------------------
    const requestsByMatter = await Promise.all(
      matters.map(async (m) => {
        const rows = await ctx.db
          .query("documentRequests")
          .withIndex("by_matter", (q) => q.eq("matterId", m._id))
          .collect();
        return rows.map((r) => ({ request: r, matterRef: m.reference, matterId: m._id }));
      }),
    );
    let requests = requestsByMatter.flat();

    if (args.requestStatus && args.requestStatus !== "all") {
      requests = requests.filter((r) => r.request.status === args.requestStatus);
    }
    const search = args.search?.trim().toLowerCase();
    if (search) {
      requests = requests.filter(
        (r) =>
          r.request.title.toLowerCase().includes(search) ||
          r.matterRef.toLowerCase().includes(search),
      );
    }

    const userIds = new Set<Id<"users">>();
    for (const r of requests) {
      userIds.add(r.request.requestedById);
      if (r.request.reviewedById) userIds.add(r.request.reviewedById);
    }
    const nameByUser = new Map<Id<"users">, string>();
    for (const id of userIds) {
      const u = await ctx.db.get(id);
      if (u) nameByUser.set(id, u.name ?? u.email ?? "Member");
    }

    const requestRows = requests
      .sort((a, b) => b.request.createdAt - a.request.createdAt)
      .slice(0, 100)
      .map(({ request: r, matterRef, matterId }) => ({
        _id: r._id,
        matterId,
        matterRef,
        title: r.title,
        status: r.status,
        dueAt: r.dueAt ?? null,
        requestedByName: nameByUser.get(r.requestedById) ?? "Member",
        reviewedByName: r.reviewedById
          ? nameByUser.get(r.reviewedById) ?? null
          : null,
        hasSubmission: r.currentStorageId !== undefined,
        createdAt: r.createdAt,
      }));

    // ---- Portal statistics -----------------------------------------
    let portalAccounts = 0;
    const clientIds = Array.from(new Set(matters.map((m) => m.clientId)));
    const clientRows = (await Promise.all(clientIds.map((id) => ctx.db.get(id))))
      .filter(Boolean) as Doc<"clients">[];

    const docsByMatter = await Promise.all(
      matters.map(async (m) => {
        const rows = await ctx.db
          .query("matterDocuments")
          .withIndex("by_matter", (q) => q.eq("matterId", m._id))
          .collect();
        return rows.map((d) => ({ doc: d, matterRef: m.reference }));
      }),
    );
    const allDocs = docsByMatter.flat();
    const sharedDocs = allDocs.filter(
      ({ doc }) =>
        doc.visibility === "shared_with_client" && canViewDocument(ac, doc, matterById.get(doc.matterId)!),
    );

    // Portal accounts = clients with at least one shared document or an
    // active request — an honest proxy, not a login count.
    const clientWithPortal = new Set<Id<"clients">>();
    for (const m of matters) {
      const hasShared = sharedDocs.some((d) => matterById.get(d.doc.matterId)?.clientId === m.clientId);
      const hasRequests = requestsByMatter
        .flat()
        .some((r) => r.matterId === m._id);
      if (hasShared || hasRequests) clientWithPortal.add(m.clientId);
    }
    portalAccounts = clientWithPortal.size;

    const pendingReview = requestRows.filter(
      (r) => r.status === "uploaded" || r.status === "under_review",
    );

    return {
      canReview,
      stats: {
        portalAccounts,
        requestsOpen: requestRows.filter((r) => r.status === "requested").length,
        pendingReview: pendingReview.length,
        documentsShared: sharedDocs.length,
        clientUploads: allDocs.filter((d) => d.doc.submittedByClient === true).length,
      },
      requests: requestRows,
      recentClientUploads: allDocs
        .filter((d) => d.doc.submittedByClient === true)
        .sort((a, b) => b.doc.createdAt - a.doc.createdAt)
        .slice(0, 20)
        .map(({ doc, matterRef }) => ({
          _id: doc._id,
          name: doc.name,
          matterRef,
          matterId: doc.matterId,
          createdAt: doc.createdAt,
        })),
      matters: matters.map((m) => ({
        _id: m._id,
        reference: m.reference,
        title: m.title,
        clientId: m.clientId,
      })),
      clients: clientRows.map((c) => ({ _id: c._id, name: c.name })),
    };
  },
});

/** Review a client submission (accept/reject) from the admin desk. */
export const review = query({
  args: { requestId: v.id("documentRequests") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const r = await ctx.db.get(args.requestId);
    if (!r) return null;
    const matter = await requireMatter(ctx, ac, r.matterId);
    void matter;
    return {
      _id: r._id,
      title: r.title,
      status: r.status,
      instructions: r.instructions ?? null,
      dueAt: r.dueAt ?? null,
      hasSubmission: r.currentStorageId !== undefined,
    };
  },
});
