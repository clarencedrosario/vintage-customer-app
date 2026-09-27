import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import {
  canViewDocument,
  requireAccess,
  requireCapability,
  requireMatter,
} from "./access";
import { logUserAction } from "./auditLogger";
import { appendCustody, CUSTODY_ACTIONS } from "../lib/evidenceIntegrity";

// ===============================================================
// Evidence integrity — custody query/note + internal bridges for the
// Node-runtime verification action (all V8: Convex permits only
// actions in "use node" modules).
//
// Custody trail shape and the action vocabulary are defined once in
// src/lib/evidenceIntegrity.ts (unit-tested). The verification action
// itself lives in evidenceVerify.ts (crypto.subtle guaranteed in
// Node) and reaches the db only through the internal bridges below.
// ===============================================================

/** The custody trail + integrity hash for one document (access-checked). */
export const custody = query({
  args: { documentId: v.id("matterDocuments") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "document.upload");
    const doc = await ctx.db.get(args.documentId);
    if (!doc) return null;
    const matter = await requireMatter(ctx, ac, doc.matterId);
    if (!canViewDocument(ac, doc, matter)) return null;
    return {
      integritySha256: doc.integritySha256 ?? null,
      custody: doc.custody ?? [],
    };
  },
});

/** Add a manual custody note (who physically handled what, etc.). */
export const addCustodyNote = mutation({
  args: {
    documentId: v.id("matterDocuments"),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "document.upload");
    const doc = await ctx.db.get(args.documentId);
    if (!doc) throw new Error("Document not found.");
    const matter = await requireMatter(ctx, ac, doc.matterId);
    if (!canViewDocument(ac, doc, matter)) return;

    const note = args.note.trim().slice(0, 400);
    if (!note) throw new Error("Custody note is required.");

    const event = {
      at: Date.now(),
      byId: ac.user._id,
      byName: ac.user.name ?? ac.user.email ?? "Member",
      action: "note" as const,
      note,
    };
    await ctx.db.patch(args.documentId, {
      custody: appendCustody(doc.custody, event),
    });
    // Mirror into the append-only store (complete history; the row-level
    // trail above is a bounded recent-events window).
    await ctx.db.insert("documentCustodyEvents", {
      orgId: ac.org._id,
      documentId: args.documentId,
      matterId: doc.matterId,
      ...event,
    });
    await logUserAction(ctx, {
      userId: ac.user._id,
      organizationId: ac.org._id,
      actionType: "document.custody_note",
      resourceId: args.documentId,
    });
  },
});

// ---------------------------------------------------------------------
// Internal bridges for the Node-runtime verification action (actions
// cannot reach the db or auth context directly).
// ---------------------------------------------------------------------

/** Access-checked read of the document row for the action. */
export const docForVerification = internalQuery({
  args: { documentId: v.id("matterDocuments") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "document.upload");
    const doc = await ctx.db.get(args.documentId);
    if (!doc) return null;
    const matter = await requireMatter(ctx, ac, doc.matterId);
    if (!canViewDocument(ac, doc, matter)) return null;
    return {
      documentId: doc._id,
      orgId: ac.org._id,
      matterId: doc.matterId,
      storageId: doc.storageId ?? null,
      recordedHash: doc.integritySha256 ?? null,
      actorId: ac.user._id,
      actorName: ac.user.name ?? ac.user.email ?? "Member",
    };
  },
});

/** Append the verification outcome to the custody trail + audit log. */
export const recordVerification = internalMutation({
  args: {
    documentId: v.id("matterDocuments"),
    ok: v.boolean(),
    observedHash: v.optional(v.string()),
    byId: v.id("users"),
    byName: v.string(),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) return;
    const matter = await ctx.db.get(doc.matterId);
    if (!matter) return;
    const event = {
      at: Date.now(),
      byId: args.byId,
      byName: args.byName,
      action: args.ok ? ("integrity_verified" as const) : ("integrity_mismatch" as const),
      note: args.ok ? undefined : "Stored file hash differs from record.",
    };
    await ctx.db.patch(args.documentId, {
      custody: appendCustody(doc.custody, event),
    });
    // Mirror into the append-only store — verification history is never
    // truncated, per document and per version.
    await ctx.db.insert("documentCustodyEvents", {
      orgId: matter.orgId,
      documentId: args.documentId,
      matterId: doc.matterId,
      ...event,
    });
    await ctx.db.insert("auditLog", {
      orgId: matter.orgId,
      matterId: doc.matterId,
      actorId: args.byId,
      actorName: args.byName,
      action: args.ok
        ? "Document integrity verified"
        : "Document integrity MISMATCH",
      detail: args.ok
        ? "Stored bytes match the recorded SHA-256."
        : `Stored hash ${args.observedHash ?? "unavailable"} differs from the recorded hash.`,
      createdAt: Date.now(),
    });
  },
});

/**
 * Paginated COMPLETE custody history for one document, served from the
 * append-only store (never truncated). Newest first. Access rules are
 * identical to the summary query above.
 */
export const custodyHistory = query({
  args: {
    documentId: v.id("matterDocuments"),
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "document.upload");
    const doc = await ctx.db.get(args.documentId);
    if (!doc) return null;
    const matter = await requireMatter(ctx, ac, doc.matterId);
    if (!canViewDocument(ac, doc, matter)) return null;
    return await ctx.db
      .query("documentCustodyEvents")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .order("desc")
      .paginate({
        numItems: Math.min(Math.max(args.pageSize ?? 25, 5), 100),
        cursor: args.cursor ?? null,
      });
  },
});
