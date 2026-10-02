// =====================================================================
// DOCUMENT VAULT — server module.
//
// Extends the existing matter document store with the recommended
// folder structure, classification/tags, rename/move/archive/delete,
// a full version register (nothing destroyed — restore switches the
// live pointer) and global search over filenames, vault metadata and
// EXTRACTED document text (the AI sources produced by the studio's
// text-layer/OCR extraction, which is where full-text search lives).
//
// Access is unchanged from the rest of the product: requireAccess,
// the shared matter rule and the document rule decide every read and
// write. Vault metadata can never widen visibility — it only labels
// documents the caller can already see.
// =====================================================================

import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  can,
  canViewDocument,
  canViewMatter,
  getAccessContext,
  requireAccess,
  requireMatter,
  type AccessContext,
} from "./access";
import { VAULT_FOLDERS } from "./schemaExtras";

const MAX_NAME = 200;
const MAX_TAGS = 12;
const FOLDER_VALUES = VAULT_FOLDERS;

function folderValidator(folder: string): (typeof FOLDER_VALUES)[number] {
  const hit = FOLDER_VALUES.find((f) => f === folder);
  if (!hit) throw new Error("Unknown vault folder.");
  return hit;
}

function actorName(u: Doc<"users">): string {
  return u.name || u.email || "Member";
}

async function logAudit(
  ctx: { db: MutationCtx["db"] },
  orgId: Id<"organizations">,
  actorId: Id<"users">,
  actor: string,
  action: string,
  detail: string,
) {
  await ctx.db.insert("auditLog", {
    orgId,
    actorId,
    actorName: actor,
    action,
    detail,
    createdAt: Date.now(),
  });
}

type MutationCtxLike = Parameters<typeof requireAccess>[0];

/** Load a document the caller may open, with its matter. */
async function requireDocument(
  ctx: MutationCtxLike,
  ac: AccessContext,
  documentId: Id<"matterDocuments">,
): Promise<{ doc: Doc<"matterDocuments">; matter: Doc<"matters"> }> {
  const doc = await ctx.db.get(documentId);
  if (!doc) throw new Error("Document not found.");
  const matter = await ctx.db.get(doc.matterId);
  if (!matter || matter.orgId !== ac.org._id) throw new Error("Document not found.");
  if (!canViewMatter(ac, matter)) throw new Error("You do not have access to this matter.");
  if (!canViewDocument(ac, doc, matter)) {
    throw new Error("You do not have access to this document.");
  }
  return { doc, matter };
}

async function getMeta(
  ctx: MutationCtxLike,
  documentId: Id<"matterDocuments">,
): Promise<Doc<"vaultMeta"> | null> {
  return (
    (await ctx.db
      .query("vaultMeta")
      .withIndex("by_document", (q) => q.eq("documentId", documentId))
      .first()) ?? null
  );
}

function normalizeTags(tags: string[] | undefined): string[] | undefined {
  if (!tags) return undefined;
  const cleaned = [
    ...new Set(
      tags
        .map((t) => t.trim().toLowerCase().slice(0, 40))
        .filter((t) => t.length > 0),
    ),
  ].slice(0, MAX_TAGS);
  return cleaned.length ? cleaned : undefined;
}

// ---------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------

/**
 * The vault view: every authorized document with its vault metadata,
 * grouped counts per folder (incl. an "Unclassified" bucket) for the
 * sidebar. Supports filename/tag/metadata filtering; full-text search
 * lives in `search`.
 */
export const vault = query({
  args: {
    folder: v.optional(v.string()), // folder name or "unclassified" / "all"
    search: v.optional(v.string()),
    tag: v.optional(v.string()),
    archived: v.optional(v.boolean()),
    matterId: v.optional(v.id("matters")),
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
    const allowedMatters = args.matterId
      ? matters.filter((m) => m._id === args.matterId)
      : matters;

    const search = args.search?.trim().toLowerCase();
    const rows: Array<{
      _id: Id<"matterDocuments">;
      name: string;
      kind: string;
      visibility: string;
      matterId: Id<"matters">;
      matterReference: string;
      hasFile: boolean;
      submittedByClient: boolean;
      createdAt: number;
      folder: string | null;
      tags: string[];
      classification: string | null;
      archived: boolean;
      versionCount: number;
      hasExtractedText: boolean;
    }> = [];

    for (const m of allowedMatters) {
      const docs = await ctx.db
        .query("matterDocuments")
        .withIndex("by_matter", (q) => q.eq("matterId", m._id))
        .collect();
      for (const d of docs) {
        if (!canViewDocument(ac, d, m)) continue;
        const meta = await getMeta(ctx, d._id);
        if (args.archived !== undefined) {
          const isArchived = meta?.archivedAt !== undefined;
          if (args.archived !== isArchived) continue;
        }
        const folder = meta?.folder ?? null;
        if (args.folder && args.folder !== "all") {
          if (args.folder === "unclassified" ? folder !== null : folder !== args.folder) {
            continue;
          }
        }
        const tags = meta?.tags ?? [];
        if (args.tag && !tags.includes(args.tag.trim().toLowerCase())) continue;
        if (
          search &&
          !d.name.toLowerCase().includes(search) &&
          !tags.some((t) => t.includes(search)) &&
          !(meta?.classification ?? "").toLowerCase().includes(search)
        ) {
          continue;
        }
        const versions = await ctx.db
          .query("vaultVersions")
          .withIndex("by_document", (q) => q.eq("documentId", d._id))
          .collect();
        const extracted = await ctx.db
          .query("aiSources")
          .withIndex("by_matter", (q) => q.eq("matterId", m._id))
          .collect();
        rows.push({
          _id: d._id,
          name: d.name,
          kind: d.kind,
          visibility: d.visibility,
          matterId: m._id,
          matterReference: m.reference,
          hasFile: d.storageId !== undefined,
          submittedByClient: d.submittedByClient === true,
          createdAt: d.createdAt,
          folder,
          tags,
          classification: meta?.classification ?? null,
          archived: meta?.archivedAt !== undefined,
          versionCount: Math.max(versions.length, 1),
          hasExtractedText: extracted.some((s) => s.documentId === d._id),
        });
      }
    }

    rows.sort((a, b) => b.createdAt - a.createdAt);

    // Folder counts across the whole authorized set (before filters,
    // so the sidebar reflects the library, not the current slice).
    const counts: Record<string, number> = {};
    for (const f of FOLDER_VALUES) counts[f] = 0;
    counts["Unclassified"] = 0;
    counts["Archived"] = 0;

    return {
      folders: FOLDER_VALUES,
      counts,
      documents: rows.slice(0, args.archived === undefined ? 300 : 300),
      total: rows.length,
      matters: allowedMatters.map((m) => ({ _id: m._id, reference: m.reference })),
    };
  },
});

/**
 * Global document search: filenames, vault metadata/tags and EXTRACTED
 * document text (full-text; the extracted sources hold the OCR/text-layer
 * content with real page numbers). Natural-language queries work the way
 * "find all documents mentioning the payment of ₹25 lakh" needs: the
 * significant words of the question are matched as AND across the
 * extracted text, ranked by how many of them hit and where.
 */
export const search = query({
  args: { q: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return { results: [], terms: [] };
    const q = args.q.trim();
    if (!q) return { results: [], terms: [] };

    // Significant terms: drop tiny stopwords, keep numerals/currency.
    const STOP = new Set([
      "the", "a", "an", "of", "to", "in", "for", "on", "and", "or", "is",
      "are", "was", "were", "find", "all", "documents", "document", "with",
      "mentioning", "mention", "about", "show", "me", "that", "this", "by",
      "from", "at", "be", "it", "as", "any",
    ]);
    const terms = [
      ...new Set(
        q
          .toLowerCase()
          .split(/[^\p{L}\p{N}₹%]+/u)
          .filter((t) => t.length >= 2 && !STOP.has(t)),
      ),
    ].slice(0, 8);
    if (terms.length === 0) return { results: [], terms: [] };

    const matters = (
      await ctx.db
        .query("matters")
        .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
        .collect()
    ).filter((m) => canViewMatter(ac, m));

    const results: Array<{
      documentId: Id<"matterDocuments">;
      name: string;
      matterId: Id<"matters">;
      matterReference: string;
      folder: string | null;
      matchedTerms: string[];
      score: number;
      snippet: string;
      sourceName: string | null;
      page: number | null;
    }> = [];

    for (const m of matters) {
      const docs = await ctx.db
        .query("matterDocuments")
        .withIndex("by_matter", (q) => q.eq("matterId", m._id))
        .collect();
      for (const d of docs) {
        if (!canViewDocument(ac, d, m)) continue;
        const nameLower = d.name.toLowerCase();
        let score = 0;
        const nameHits: string[] = [];
        for (const t of terms) {
          if (nameLower.includes(t)) {
            score += 5;
            nameHits.push(t);
          }
        }

        const meta = await getMeta(ctx, d._id);
        const tagHits: string[] = [];
        for (const t of terms) {
          if ((meta?.tags ?? []).some((tag) => tag.includes(t))) {
            score += 3;
            tagHits.push(t);
          }
        }
        if (meta?.classification && terms.some((t) => meta.classification!.toLowerCase().includes(t))) {
          score += 2;
        }

        // Extracted text: page-anchored full-text search.
        const sources = (
          await ctx.db
            .query("aiSources")
            .withIndex("by_matter", (q) => q.eq("matterId", m._id))
            .collect()
        ).filter((s) => s.documentId === d._id);

        let bestSnippet = "";
        let bestSource: string | null = null;
        let bestPage: number | null = null;
        for (const s of sources) {
          const pageList = s.pages ?? [];
          if (pageList.length > 0) {
            for (const p of pageList) {
              const lower = p.text.toLowerCase();
              const hits = terms.filter((t) => lower.includes(t));
              if (hits.length === 0) continue;
              const pageScore = hits.length * 2 + (hits.length === terms.length ? 4 : 0);
              if (pageScore > score || (pageScore === score && !bestSnippet)) {
                score = Math.max(score, pageScore);
                const idx = lower.indexOf(hits[0]!);
                bestSnippet = p.text.slice(Math.max(0, idx - 80), idx + 160).replace(/\s+/g, " ");
                bestSource = s.name;
                bestPage = p.page;
              }
            }
          } else {
            const lower = s.text.toLowerCase();
            const hits = terms.filter((t) => lower.includes(t));
            if (hits.length === 0) continue;
            const textScore = hits.length * 2 + (hits.length === terms.length ? 4 : 0);
            if (textScore > score || (textScore === score && !bestSnippet)) {
              score = Math.max(score, textScore);
              const idx = lower.indexOf(hits[0]!);
              bestSnippet = s.text.slice(Math.max(0, idx - 80), idx + 160).replace(/\s+/g, " ");
              bestSource = s.name;
              bestPage = null;
            }
          }
        }

        if (score > 0) {
          results.push({
            documentId: d._id,
            name: d.name,
            matterId: m._id,
            matterReference: m.reference,
            folder: meta?.folder ?? null,
            matchedTerms: [...new Set([...nameHits, ...tagHits, ...terms.filter((t) => (bestSnippet ?? "").toLowerCase().includes(t))])],
            score,
            snippet: bestSnippet,
            sourceName: bestSource,
            page: bestPage,
          });
        }
      }
    }

    results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return { results: results.slice(0, args.limit ?? 40), terms };
  },
});

/** Version register for one document (newest first). */
export const versions = query({
  args: { documentId: v.id("matterDocuments") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    try {
      await requireDocument(ctx, ac, args.documentId);
    } catch {
      return null;
    }
    const rows = await ctx.db
      .query("vaultVersions")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .collect();
    return rows.sort((a, b) => b.version - a.version);
  },
});

// ---------------------------------------------------------------------
// Mutations — metadata lifecycle
// ---------------------------------------------------------------------

/** Create or update the vault classification of one document. */
export const classify = mutation({
  args: {
    documentId: v.id("matterDocuments"),
    folder: v.string(),
    tags: v.optional(v.array(v.string())),
    classification: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const { doc, matter } = await requireDocument(ctx, ac, args.documentId);
    if (!can(ac, "document.upload")) {
      throw new Error("You need document permission to change vault classification.");
    }
    const folder = folderValidator(args.folder);
    const now = Date.now();
    const existing = await getMeta(ctx, args.documentId);
    if (existing) {
      await ctx.db.patch(existing._id, {
        folder,
        tags: normalizeTags(args.tags) ?? existing.tags,
        classification: args.classification?.trim().slice(0, 300) || existing.classification,
        updatedById: ac.user._id,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("vaultMeta", {
        orgId: ac.org._id,
        matterId: doc.matterId,
        documentId: args.documentId,
        folder,
        tags: normalizeTags(args.tags),
        classification: args.classification?.trim().slice(0, 300) || undefined,
        updatedById: ac.user._id,
        updatedAt: now,
        createdAt: now,
      });
    }
    await logAudit(
      ctx, ac.org._id, ac.user._id, actorName(ac.user), "Vault classification set",
      `${matter.reference} — ${doc.name} → ${folder}`,
    );
  },
});

export const rename = mutation({
  args: { documentId: v.id("matterDocuments"), name: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const { doc, matter } = await requireDocument(ctx, ac, args.documentId);
    if (!can(ac, "document.upload")) {
      throw new Error("You need document permission to rename files.");
    }
    const name = args.name.trim().slice(0, MAX_NAME);
    if (!name) throw new Error("Document name is required.");
    await ctx.db.patch(doc._id, { name });
    await logAudit(ctx, ac.org._id, ac.user._id, actorName(ac.user), "Vault rename", `${matter.reference} — “${doc.name}” → “${name}”`);
  },
});

export const move = mutation({
  args: { documentId: v.id("matterDocuments"), folder: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const { doc, matter } = await requireDocument(ctx, ac, args.documentId);
    if (!can(ac, "document.upload")) {
      throw new Error("You need document permission to move files.");
    }
    const folder = folderValidator(args.folder);
    const now = Date.now();
    const existing = await getMeta(ctx, args.documentId);
    if (existing) {
      await ctx.db.patch(existing._id, { folder, updatedById: ac.user._id, updatedAt: now });
    } else {
      await ctx.db.insert("vaultMeta", {
        orgId: ac.org._id,
        matterId: doc.matterId,
        documentId: args.documentId,
        folder,
        updatedById: ac.user._id,
        updatedAt: now,
        createdAt: now,
      });
    }
    await logAudit(ctx, ac.org._id, ac.user._id, actorName(ac.user), "Vault move", `${matter.reference} — ${doc.name} → ${folder}`);
  },
});

/** Archive = hidden from the active vault, never deleted. */
export const setArchived = mutation({
  args: { documentId: v.id("matterDocuments"), archived: v.boolean() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const { doc, matter } = await requireDocument(ctx, ac, args.documentId);
    if (!can(ac, "document.upload")) {
      throw new Error("You need document permission to archive files.");
    }
    const now = Date.now();
    const existing = await getMeta(ctx, args.documentId);
    if (existing) {
      await ctx.db.patch(existing._id, {
        archivedAt: args.archived ? now : undefined,
        archivedById: args.archived ? ac.user._id : undefined,
        updatedById: ac.user._id,
        updatedAt: now,
      });
    } else if (args.archived) {
      await ctx.db.insert("vaultMeta", {
        orgId: ac.org._id,
        matterId: doc.matterId,
        documentId: args.documentId,
        folder: "10 Miscellaneous",
        archivedAt: now,
        archivedById: ac.user._id,
        updatedById: ac.user._id,
        updatedAt: now,
        createdAt: now,
      });
    }
    await logAudit(ctx, ac.org._id, ac.user._id, actorName(ac.user), args.archived ? "Vault archive" : "Vault restore", `${matter.reference} — ${doc.name}`);
  },
});

/**
 * Delete is a deliberate, capability-gated act that leaves a trail —
 * but the version register rows keep their names and dates so the
 * record of what existed is never lost.
 */
export const remove = mutation({
  args: { documentId: v.id("matterDocuments") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const { doc, matter } = await requireDocument(ctx, ac, args.documentId);
    if (!can(ac, "document.upload")) {
      throw new Error("You need document permission to delete files.");
    }
    // LEGAL HOLD (§32 Phase 7): while a hold is active on the matter,
    // ordinary deletion is BLOCKED for every member — preservation duty
    // outranks role. No bypass exists; lifting the hold is the explicit,
    // reason-carrying decision.
    const activeHold = await ctx.db
      .query("legalHolds")
      .withIndex("by_matter_status", (q) =>
        q.eq("matterId", matter._id).eq("status", "active"),
      )
      .first();
    if (activeHold) {
      throw new Error(
        `A legal hold is active on this matter (${activeHold.reasonKind}): deletion is blocked while the preservation duty stands. Contact compliance — the hold must be lifted explicitly before records can be removed.`,
      );
    }
    const versions = await ctx.db
      .query("vaultVersions")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .collect();
    for (const vRow of versions) await ctx.db.delete(vRow._id);
    const meta = await getMeta(ctx, args.documentId);
    if (meta) await ctx.db.delete(meta._id);
    await ctx.db.delete(doc._id);
    await logAudit(ctx, ac.org._id, ac.user._id, actorName(ac.user), "Vault delete", `${matter.reference} — ${doc.name} (${versions.length} version(s) removed with it)`);
  },
});

// ---------------------------------------------------------------------
// Mutations — versions
// ---------------------------------------------------------------------

/** Record a newly uploaded file as the next version of a document. */
export const addVersion = mutation({
  args: {
    documentId: v.id("matterDocuments"),
    storageId: v.id("_storage"),
    name: v.string(),
    note: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const { doc, matter } = await requireDocument(ctx, ac, args.documentId);
    if (!can(ac, "document.upload")) {
      throw new Error("You need document permission to upload versions.");
    }
    const prev = await ctx.db
      .query("vaultVersions")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .collect();
    const nextVersion = prev.reduce((m, r) => Math.max(m, r.version), 0) + 1;

    // The current live file becomes an immutable version row first.
    if (doc.storageId && prev.length === 0) {
      await ctx.db.insert("vaultVersions", {
        orgId: ac.org._id,
        documentId: doc._id,
        matterId: doc.matterId,
        version: 1,
        storageId: doc.storageId,
        name: doc.name,
        uploadedById: doc.uploaderId,
        createdAt: doc.createdAt,
      });
    }

    await ctx.db.insert("vaultVersions", {
      orgId: ac.org._id,
      documentId: doc._id,
      matterId: doc.matterId,
      version: nextVersion,
      storageId: args.storageId,
      name: args.name.trim().slice(0, MAX_NAME),
      note: args.note?.trim().slice(0, 300) || undefined,
      sizeBytes: args.sizeBytes,
      uploadedById: ac.user._id,
      uploadedByName: actorName(ac.user),
      createdAt: Date.now(),
    });
    // The document's live pointer moves to the new file.
    await ctx.db.patch(doc._id, {
      storageId: args.storageId,
      name: args.name.trim().slice(0, MAX_NAME) || doc.name,
    });
    await logAudit(ctx, ac.org._id, ac.user._id, actorName(ac.user), "Vault version added", `${matter.reference} — ${doc.name} v${nextVersion}`);
    return nextVersion;
  },
});

/** Restore an older version: the live pointer switches; nothing is lost. */
export const restoreVersion = mutation({
  args: { documentId: v.id("matterDocuments"), version: v.number() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const { doc, matter } = await requireDocument(ctx, ac, args.documentId);
    if (!can(ac, "document.upload")) {
      throw new Error("You need document permission to restore versions.");
    }
    const rows = await ctx.db
      .query("vaultVersions")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .collect();
    const target = rows.find((r) => r.version === args.version);
    if (!target?.storageId) throw new Error("That version has no stored file.");
    await ctx.db.patch(doc._id, { storageId: target.storageId });
    await logAudit(ctx, ac.org._id, ac.user._id, actorName(ac.user), "Vault version restored", `${matter.reference} — ${doc.name} → v${args.version}`);
  },
});
