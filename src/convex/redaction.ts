import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import {
  canViewDocument,
  getAccessContext,
  requireAccess,
  requireCapability,
  requireMatter,
} from "./access";
import { appendCustody } from "../lib/evidenceIntegrity";
import {
  REDACTION_COVERAGE_NOTE,
  REDACTION_REFUSAL_REASONS,
} from "../lib/redaction";
import { REDACTION_STATUSES, redactionEntryValidator } from "./schemaExtras";

// =====================================================================
// §32 PHASE 6 — VERIFIED REDACTION (V8 bridges + read model).
//
// The redaction ACTION (redactionRun.ts, "use node") cannot reach the
// db or the auth context directly, so access checks and all writes live
// here — the same module-split pattern as evidence.ts +
// evidenceVerify.ts. "Verified" is recorded ONLY when the action
// reports a clean re-scan of the produced derivative; refusals and
// failed verifications are recorded with their reasons (never silent).
// =====================================================================

/**
 * Access-checked source info for the redaction action. Returns null for
 * unauthorized callers (nothing is recorded in that case — an
 * unauthenticated request leaves no trail entry, same as the integrity
 * verification bridge).
 */
export const redactionSourceInfo = internalQuery({
  args: { documentId: v.id("matterDocuments") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    // Producing a derivative CREATES a document — same capability as
    // filing one.
    requireCapability(ac, "document.upload");
    const doc = await ctx.db.get(args.documentId);
    if (!doc) return null;
    const matter = await requireMatter(ctx, ac, doc.matterId);
    if (!canViewDocument(ac, doc, matter)) return null;
    return {
      documentId: doc._id,
      orgId: ac.org._id,
      matterId: doc.matterId,
      name: doc.name,
      storageId: doc.storageId ?? null,
      recordedHash: doc.integritySha256 ?? null,
      actorId: ac.user._id,
      actorName: ac.user.name ?? ac.user.email ?? "Member",
    };
  },
});

/**
 * Record one redaction attempt. When status === "verified" AND a
 * derivative is supplied, the derivative is filed as a NORMAL vault
 * document (storage object + integrity hash + custody event + audit
 * entry) — it then flows through the existing download/share/custody
 * machinery. Refused/failed attempts create no document, only the
 * recorded job row.
 */
export const recordRedactionOutcome = internalMutation({
  args: {
    documentId: v.id("matterDocuments"),
    entries: v.array(redactionEntryValidator),
    status: v.union(...REDACTION_STATUSES.map((s) => v.literal(s))),
    refusalReason: v.optional(
      v.union(...REDACTION_REFUSAL_REASONS.map((r) => v.literal(r))),
    ),
    refusalDetail: v.optional(v.string()),
    hits: v.array(v.object({ term: v.string(), count: v.number() })),
    verification: v.array(
      v.object({ term: v.string(), remaining: v.number() }),
    ),
    sourceSha256: v.optional(v.string()),
    derivative: v.optional(
      v.object({
        storageId: v.id("_storage"),
        sha256: v.string(),
        chars: v.number(),
        name: v.string(),
      }),
    ),
    byId: v.id("users"),
    byName: v.string(),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) return null;
    const matter = await ctx.db.get(doc.matterId);
    if (!matter) return null;
    const now = Date.now();

    // File the derivative FIRST so the job row can reference it in the
    // same transaction.
    let derivativeDocumentId: typeof args.documentId | undefined;
    if (args.status === "verified" && args.derivative) {
      derivativeDocumentId = await ctx.db.insert("matterDocuments", {
        matterId: doc.matterId,
        uploaderId: args.byId,
        name: args.derivative.name,
        kind: "document",
        visibility: "internal", // never auto-shared; sharing stays explicit
        storageId: args.derivative.storageId,
        integritySha256: args.derivative.sha256,
        custody: appendCustody(undefined, {
          at: now,
          byId: args.byId,
          byName: args.byName,
          action: "redaction_derivative",
          note: `Mechanically verified redaction derivative of "${doc.name}" — ${args.entries.length} recorded term(s) re-scanned absent in the produced file.`,
        }),
        createdAt: now,
      });
    }

    const jobId = await ctx.db.insert("redactionJobs", {
      orgId: matter.orgId,
      matterId: doc.matterId,
      documentId: doc._id,
      sourceName: doc.name,
      sourceSha256: args.sourceSha256,
      entries: args.entries,
      status: args.status,
      refusalReason: args.refusalReason,
      refusalDetail: args.refusalDetail,
      hits: args.hits,
      verification: args.verification,
      derivativeDocumentId,
      derivativeSha256: args.derivative?.sha256,
      derivativeChars: args.derivative?.chars,
      coverageNote: REDACTION_COVERAGE_NOTE,
      actorId: args.byId,
      actorName: args.byName,
      createdAt: now,
    });

    await ctx.db.insert("auditLog", {
      orgId: matter.orgId,
      matterId: doc.matterId,
      actorId: args.byId,
      actorName: args.byName,
      action:
        args.status === "verified"
          ? "Verified redaction derivative produced"
          : args.status === "failed"
            ? "Redaction FAILED verification"
            : "Redaction refused",
      detail:
        args.status === "verified"
          ? `Derivative of "${doc.name}" (${args.derivative?.chars ?? 0} chars, sha256 ${(args.derivative?.sha256 ?? "").slice(0, 12)}…) — ${args.entries.length} recorded term(s) re-scanned absent. ${REDACTION_COVERAGE_NOTE}`
          : `${args.status === "refused" ? "Refused" : "Verification failed"}: ${args.refusalReason ?? "residue found"}${args.refusalDetail ? ` — ${args.refusalDetail}` : ""}. No derivative was produced or labelled verified.`,
      createdAt: now,
    });

    return { jobId, derivativeDocumentId: derivativeDocumentId ?? null };
  },
});

/** Redaction history for one matter (org-scoped; newest first). */
export const listRedactionJobs = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.orgId !== ac.org._id) return [];
    const rows = await ctx.db
      .query("redactionJobs")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});
