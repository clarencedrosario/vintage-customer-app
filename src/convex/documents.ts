import { query } from "./_generated/server";
import { v } from "convex/values";
import {
  getAccessContext,
  requireMatter,
  canViewMatter,
  canViewDocument,
} from "./access";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Cross-matter document library: every matter document the caller is
 * authorized to see, with their matter references. Supports search and
 * filters — the Documents nav section.
 */
export const library = query({
  args: {
    search: v.optional(v.string()),
    kind: v.optional(
      v.union(v.literal("document"), v.literal("communication"), v.literal("all")),
    ),
    visibility: v.optional(
      v.union(
        v.literal("internal"),
        v.literal("shared_with_client"),
        v.literal("all"),
      ),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;

    const matters = (
      await ctx.db
        .query("matters")
        .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
        .collect()
    ).filter((m) => canViewMatter(ac, m));
    const matterById = new Map(matters.map((m) => [m._id, m]));

    const rows: {
      _id: Id<"matterDocuments">;
      name: string;
      kind: string;
      visibility: string;
      matterId: Id<"matters">;
      matterReference: string;
      storageId: Id<"_storage"> | undefined;
      hasFile: boolean;
      submittedByClient: boolean;
      createdAt: number;
    }[] = [];

    for (const m of matters) {
      const docs = await ctx.db
        .query("matterDocuments")
        .withIndex("by_matter", (q) => q.eq("matterId", m._id))
        .collect();
      for (const d of docs) {
        if (!canViewDocument(ac, d, m)) continue;
        rows.push({
          _id: d._id,
          name: d.name,
          kind: d.kind,
          visibility: d.visibility,
          matterId: m._id,
          matterReference: m.reference,
          storageId: d.storageId,
          hasFile: d.storageId !== undefined,
          submittedByClient: d.submittedByClient === true,
          createdAt: d.createdAt,
        });
      }
    }

    const search = args.search?.trim().toLowerCase();
    let filtered = rows;
    if (search) {
      filtered = filtered.filter((r) => r.name.toLowerCase().includes(search));
    }
    if (args.kind && args.kind !== "all") {
      filtered = filtered.filter((r) => r.kind === args.kind);
    }
    if (args.visibility && args.visibility !== "all") {
      filtered = filtered.filter((r) => r.visibility === args.visibility);
    }

    return {
      total: filtered.length,
      documents: filtered
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, args.limit ?? 200),
      matters: matters.map((m) => ({ _id: m._id, reference: m.reference })),
    };
  },
});

/**
 * A document comparison pair (e.g. draft vs executed agreement). Stored
 * org-side so reviewers can open both documents side by side. The
 * comparison itself is rendered client-side — this only manages the pair.
 */
export const saveComparison = query({
  args: {
    documentAId: v.id("matterDocuments"),
    documentBId: v.id("matterDocuments"),
  },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const a = await ctx.db.get(args.documentAId);
    const b = await ctx.db.get(args.documentBId);
    if (!a || !b) return null;
    const matterA = await requireMatter(ctx, ac, a.matterId);
    const matterB = await requireMatter(ctx, ac, b.matterId);
    // Same-organization linked-ID check: both docs must be in matters the
    // caller can already see, and comparison is limited to same-matter pairs.
    if (a.matterId !== b.matterId || matterA._id !== matterB._id) {
      throw new Error(
        "Documents can only be compared within the same matter.",
      );
    }
    return {
      a: { _id: a._id, name: a.name, kind: a.kind, visibility: a.visibility, createdAt: a.createdAt },
      b: { _id: b._id, name: b.name, kind: b.kind, visibility: b.visibility, createdAt: b.createdAt },
      matter: { _id: matterA._id, reference: matterA.reference, title: matterA.title },
    };
  },
});

/** Resolve a library document URL (matter + document-level access enforced). */
export const getFileUrl = query({
  args: { documentId: v.id("matterDocuments") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const doc = await ctx.db.get(args.documentId);
    if (!doc || !doc.storageId) return null;
    const matter = await requireMatter(ctx, ac, doc.matterId);
    if (!canViewDocument(ac, doc, matter)) return null;
    return await ctx.storage.getUrl(doc.storageId);
  },
});
