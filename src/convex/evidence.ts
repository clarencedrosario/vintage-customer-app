import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  canViewDocument,
  requireAccess,
  requireCapability,
  requireMatter,
} from "./access";
import { logUserAction } from "./auditLogger";
import {
  appendCustody,
  CUSTODY_ACTIONS,
  isValidSha256Hex,
  sha256Hex,
  type CustodyEvent,
} from "../lib/evidenceIntegrity";

// ===============================================================
// Evidence integrity — chain-of-custody queries/mutations and the
// server-side hash verification action.
//
// Custody trail shape and the action vocabulary are defined once in
// src/lib/evidenceIntegrity.ts (unit-tested); the validators here are
// the Convex mirror of those types.
// ===============================================================

const custodyValidator = v.object({
  at: v.number(),
  byId: v.optional(v.id("users")),
  byName: v.optional(v.string()),
  action: v.union(...CUSTODY_ACTIONS.map((a) => v.literal(a))),
  note: v.optional(v.string()),
});

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

    await ctx.db.patch(args.documentId, {
      custody: appendCustody(doc.custody, {
        at: Date.now(),
        byId: ac.user._id,
        byName: ac.user.name ?? ac.user.email ?? "Member",
        action: "note",
        note,
      }),
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
// Internal bridges for the verification action (actions cannot access
// the db or the auth context directly — this follows the github.ts /
// githubStore.ts pattern already established in this codebase).
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
      custody: (doc.custody ?? []) as CustodyEvent<never>[],
      actorId: ac.user._id,
      actorName: ac.user.name ?? ac.user.email ?? "Member",
    };
  },
});

/** Append a verification outcome to the custody trail (fail-silent caller). */
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
    await ctx.db.patch(args.documentId, {
      custody: appendCustody(doc.custody, {
        at: Date.now(),
        byId: args.byId,
        byName: args.byName,
        action: args.ok ? "integrity_verified" : "integrity_mismatch",
        note: args.ok ? undefined : "Stored file hash differs from record.",
      }),
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
 * Re-hash the stored object and compare against the recorded integrity
 * hash. Runs in Node ("use node") so crypto.subtle and ctx.storage are
 * available; the caller must be authorized (checked in the internal
 * query bridge). A missing recorded hash means the document was uploaded
 * before this feature — verification reports that honestly instead of
 * pretending.
 */
type VerificationInfo = {
  documentId: Id<"matterDocuments">;
  orgId: Id<"organizations">;
  matterId: Id<"matters">;
  storageId: Id<"_storage"> | null;
  recordedHash: string | null;
  custody: CustodyEvent<never>[];
  actorId: Id<"users">;
  actorName: string;
};

type VerificationResult =
  | { ok: false; reason: "unauthorized" | "no_file" | "no_recorded_hash" | "bad_recorded_hash" | "file_missing" | "crypto_unavailable" }
  | { ok: boolean; observedHash: string };

export const verifyDocumentIntegrity = action({
  args: { documentId: v.id("matterDocuments") },
  handler: async (ctx, args): Promise<VerificationResult> => {
    // Explicit result annotation breaks the module-self-reference cycle
    // in type inference (same reason github.ts types its actor() helper).
    const info = (await ctx.runQuery(internal.evidence.docForVerification, {
      documentId: args.documentId,
    })) as VerificationInfo | null;
    if (!info) return { ok: false as const, reason: "unauthorized" as const };
    if (!info.storageId)
      return { ok: false as const, reason: "no_file" as const };
    if (!info.recordedHash)
      return { ok: false as const, reason: "no_recorded_hash" as const };
    if (!isValidSha256Hex(info.recordedHash))
      return { ok: false as const, reason: "bad_recorded_hash" as const };

    const blob = await ctx.storage.get(info.storageId);
    if (!blob) return { ok: false as const, reason: "file_missing" as const };
    let observed: string;
    try {
      observed = await sha256Hex(await blob.arrayBuffer());
    } catch {
      // WebCrypto unavailable in this runtime — reported honestly rather
      // than fabricating a verification result.
      return { ok: false as const, reason: "crypto_unavailable" as const };
    }

    const ok = observed === info.recordedHash;
    await ctx.runMutation(internal.evidence.recordVerification, {
      documentId: args.documentId,
      ok,
      observedHash: observed,
      byId: info.actorId,
      byName: info.actorName,
    });
    return { ok: ok as boolean, observedHash: observed };
  },
});
