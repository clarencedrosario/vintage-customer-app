// =====================================================================
// AUTOMATED DISCOVERY PIPELINE — store layer (mutations + queries).
// Separate from legalDiscovery.ts because that module is "use node"
// (network + pdfjs ⇒ actions only), while these functions are standard
// Convex server functions. Same pattern as legalIntel.ts's internal
// query/mutation helpers consumed by sourceConnector.ts.
// =====================================================================
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { getCurrentUser } from "./users";
import type { Doc } from "./_generated/dataModel";

function isPlatformOperator(user: Doc<"users"> | null): boolean {
  return !!user && !user.isAnonymous && !!user.isPlatformAdmin;
}

async function requireOperator(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!isPlatformOperator(user)) {
    throw new Error("Platform operator access required.");
  }
  return user!;
}

/** Identity gate for node actions (identity does not cross runMutation). */
export const operatorCheck = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ operator: boolean; operatorName: string | null }> => {
    const user = await getCurrentUser(ctx);
    return {
      operator: isPlatformOperator(user),
      operatorName: user?.email ?? user?.name ?? null,
    };
  },
});

export const recordCandidate = internalMutation({
  args: {
    listingKey: v.string(),
    url: v.string(),
    linkTitle: v.optional(v.string()),
    urlHash: v.string(),
  },
  handler: async (ctx, args): Promise<{ created: boolean }> => {
    const existing = await ctx.db
      .query("discoveryCandidates")
      .withIndex("by_url_hash", (q) => q.eq("urlHash", args.urlHash))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { updatedAt: Date.now() });
      return { created: false };
    }
    const now = Date.now();
    await ctx.db.insert("discoveryCandidates", {
      listingKey: args.listingKey,
      url: args.url,
      linkTitle: args.linkTitle,
      urlHash: args.urlHash,
      status: "found",
      firstSeenAt: now,
      updatedAt: now,
    });
    return { created: true };
  },
});

export const pendingCandidates = internalQuery({
  args: { listingKey: v.string(), limit: v.number() },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("discoveryCandidates")
      .withIndex("by_listing", (q) => q.eq("listingKey", args.listingKey))
      .collect();
    return all
      .filter((c) => c.status === "found" || c.status === "validating")
      .sort((a, b) => a.firstSeenAt - b.firstSeenAt)
      .slice(0, Math.max(1, Math.min(args.limit, 20)))
      .map((c) => ({ _id: c._id }));
  },
});

/** Narrow readback for the validating action. */
export const getCandidate = internalQuery({
  args: { candidateId: v.id("discoveryCandidates") },
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.candidateId);
    if (!c) return null;
    return {
      _id: String(c._id),
      listingKey: c.listingKey,
      url: c.url,
      linkTitle: c.linkTitle ?? null,
      status: c.status,
    };
  },
});

/** Full readback for the human-promotion action. */
export const getCandidateFull = internalQuery({
  args: { candidateId: v.id("discoveryCandidates") },
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.candidateId);
    if (!c) return null;
    return {
      _id: String(c._id),
      listingKey: c.listingKey,
      url: c.url,
      status: c.status,
      detectedIdentity: c.detectedIdentity ?? null,
      detectedStableKey: c.detectedStableKey ?? null,
      duplicateOfStableKey: c.duplicateOfStableKey ?? null,
      gates: c.gates ?? null,
      bytesHash: c.bytesHash ?? null,
    };
  },
});

export const setCandidateStatus = internalMutation({
  args: {
    candidateId: v.id("discoveryCandidates"),
    status: v.union(
      v.literal("found"),
      v.literal("validating"),
      v.literal("validated"),
      v.literal("promoted"),
      v.literal("review"),
      v.literal("rejected"),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.candidateId, {
      status: args.status,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Duplicate gates against the live corpus: same stableKey, or the same
 * BYTES hash already stored in any version. Returns the colliding
 * stableKey (or "unknown") when a duplicate exists.
 */
export const corpusDuplicateCheck = internalQuery({
  args: { stableKey: v.string(), bytesHash: v.string() },
  handler: async (ctx, args): Promise<string | null> => {
    const byKey = await ctx.db
      .query("legalSources")
      .withIndex("by_stable_key", (q) => q.eq("stableKey", args.stableKey))
      .unique();
    if (byKey) return byKey.stableKey;
    const dup = await ctx.db
      .query("legalSourceVersions")
      .withIndex("by_bytes_hash", (q) => q.eq("bytesHash", args.bytesHash))
      .first();
    if (dup) {
      const src = await ctx.db.get(dup.sourceId);
      return src?.stableKey ?? "unknown";
    }
    return null;
  },
});

/**
 * PROMOTION — the ONLY path that makes discovered content searchable.
 * Creates the legalSources row + v1 (hash + provenance) from a fully
 * gate-passing candidate; refuses double-ingestion if the corpus gained
 * the same stableKey between validation and promotion.
 */
export const stagePromoted = internalMutation({
  args: {
    candidateId: v.id("discoveryCandidates"),
    stableKey: v.string(),
    identity: v.string(),
    url: v.string(),
    body: v.string(),
    sections: v.array(
      v.object({ anchor: v.string(), heading: v.string(), start: v.number() }),
    ),
    bytesHash: v.string(),
    listingKey: v.string(),
    reviewedBy: v.optional(v.string()),
    reviewNote: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ sourceId: string; alreadyPresent: boolean }> => {
    const now = Date.now();
    // Final duplicate guard (corpus may have changed since validation).
    const existing = await ctx.db
      .query("legalSources")
      .withIndex("by_stable_key", (q) => q.eq("stableKey", args.stableKey))
      .unique();
    if (existing) {
      await ctx.db.patch(args.candidateId, {
        status: "rejected",
        duplicateOfStableKey: args.stableKey,
        reviewNote: `promotion refused: ${args.stableKey} already in corpus`,
        updatedAt: now,
      });
      return { sourceId: String(existing._id), alreadyPresent: true };
    }
    const collectionDate = new Date(now + 5.5 * 3600_000)
      .toISOString()
      .slice(0, 10);
    const isRules = /:rules:/.test(args.stableKey);
    const isGuidance = /:guidance:/.test(args.stableKey);
    const sourceId = await ctx.db.insert("legalSources", {
      stableKey: args.stableKey,
      title: args.identity,
      kind: isRules ? ("rules" as const) : isGuidance ? ("guidance" as const) : ("statute" as const),
      codeFamily: "special-act",
      country: "in",
      jurisdictionLevel: "national",
      rights: "Open government publication",
      statusNote:
        "Discovered automatically by the discovery pipeline (turn 32) from a registered official listing; every validation gate passed; provenance = listing + document URL + bytes sha256. AS-PUBLISHED text — vintage/amendment status NOT consolidated; needs legal review before reliance.",
      publisher:
        "National Commission for Protection of Child Rights (NCPCR), Ministry of Women and Child Development, Government of India (per the registered listing)",
      sourceUrl: args.url,
      collectionDate,
      createdAt: now,
      updatedAt: now,
    });
    const versionId = await ctx.db.insert("legalSourceVersions", {
      sourceId,
      version: 1,
      body: args.body,
      sections: args.sections,
      collectedAt: collectionDate,
      bytesHash: args.bytesHash,
      createdAt: now,
    });
    await ctx.db.patch(sourceId, { latestVersion: versionId });
    // Mark the candidate promoted (record who decided, when set).
    const cand = await ctx.db.get(args.candidateId);
    await ctx.db.patch(args.candidateId, {
      status: "promoted",
      promotedSourceId: sourceId,
      promotedStableKey: args.stableKey,
      bytesHash: args.bytesHash,
      sectionsCount: args.sections.length,
      bodyChars: args.body.length,
      retrievedAt: now,
      reviewedBy: args.reviewedBy ?? cand?.reviewedBy,
      reviewedAt: args.reviewedBy ? now : cand?.reviewedAt,
      reviewNote: args.reviewNote ?? cand?.reviewNote,
      updatedAt: now,
    });
    return { sourceId: String(sourceId), alreadyPresent: false };
  },
});

export const finishValidation = internalMutation({
  args: {
    candidateId: v.id("discoveryCandidates"),
    outcome: v.union(
      v.literal("validated"),
      v.literal("promoted"),
      v.literal("review"),
      v.literal("rejected"),
    ),
    gates: v.object({
      magicOk: v.boolean(),
      sizeOk: v.boolean(),
      identityOk: v.boolean(),
      languageOk: v.boolean(),
      sectionsOk: v.boolean(),
      s1Ok: v.boolean(),
      duplicateOk: v.boolean(),
    }),
    gateSummary: v.string(),
    detectedIdentity: v.optional(v.string()),
    detectedStableKey: v.optional(v.string()),
    duplicateOfStableKey: v.optional(v.string()),
    sectionsCount: v.number(),
    bodyChars: v.number(),
    hindiRatio: v.number(),
    bytesHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const patch: Record<string, unknown> = {
      status: args.outcome,
      gates: args.gates,
      gateSummary: args.gateSummary.slice(0, 600),
      detectedIdentity: args.detectedIdentity,
      detectedStableKey: args.detectedStableKey,
      duplicateOfStableKey: args.duplicateOfStableKey,
      sectionsCount: args.sectionsCount || undefined,
      bodyChars: args.bodyChars || undefined,
      hindiRatio: args.hindiRatio || undefined,
      bytesHash: args.bytesHash,
      retrievedAt: now,
      updatedAt: now,
    };
    if (args.outcome === "promoted") {
      // stagePromoted already set the terminal state + stored counts;
      // record only the gate metadata without regressing the counts.
      const c = await ctx.db.get(args.candidateId);
      if (c && c.status === "promoted") {
        await ctx.db.patch(args.candidateId, {
          gates: args.gates,
          gateSummary: args.gateSummary.slice(0, 600),
          retrievedAt: now,
          updatedAt: now,
        });
        return { ok: true };
      }
    }
    await ctx.db.patch(args.candidateId, patch);
    return { ok: true };
  },
});

export const recordSweepLog = internalMutation({
  args: {
    trigger: v.union(v.literal("schedule"), v.literal("manual")),
    listingKey: v.string(),
    linksFound: v.number(),
    newCandidates: v.number(),
    validated: v.number(),
    promoted: v.number(),
    queuedForReview: v.number(),
    rejected: v.number(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    await ctx.db.insert("discoverySweepLogs", {
      triggeredAt: Date.now(),
      trigger: args.trigger,
      listingKey: args.listingKey,
      linksFound: args.linksFound,
      newCandidates: args.newCandidates,
      validated: args.validated,
      promoted: args.promoted,
      queuedForReview: args.queuedForReview,
      rejected: args.rejected,
      error: args.error?.slice(0, 300),
    });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------
// Review queue — human decisions on uncertain candidates.
// ---------------------------------------------------------------------

/** Platform-operator review queue (uncertain candidates). */
export const reviewQueue = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const rows = await ctx.db
      .query("discoveryCandidates")
      .withIndex("by_status", (q) => q.eq("status", "review"))
      .collect();
    return rows.sort((a, b) => a.firstSeenAt - b.firstSeenAt);
  },
});

/** Platform-operator full candidate list (diagnostics). */
export const listCandidates = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const rows = await ctx.db.query("discoveryCandidates").collect();
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

/** Human reject of a review/validated candidate. */
export const rejectCandidate = mutation({
  args: { candidateId: v.id("discoveryCandidates"), note: v.string() },
  handler: async (ctx, args) => {
    const user = await requireOperator(ctx);
    const c = await ctx.db.get(args.candidateId);
    if (!c) throw new Error("Candidate not found.");
    if (c.status === "promoted") {
      throw new Error("Promoted candidates cannot be rejected here.");
    }
    const now = Date.now();
    await ctx.db.patch(c._id, {
      status: "rejected",
      reviewedBy: user.email ?? user.name,
      reviewedAt: now,
      reviewNote: args.note.slice(0, 600),
      updatedAt: now,
    });
    return { ok: true };
  },
});

/** Sweep-log readback (CLI verification of scheduled vs manual runs). */
export const sweepLogsCli = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("discoverySweepLogs")
      .withIndex("by_time")
      .order("desc")
      .take(args.limit ?? 10);
    return rows.map((r) => ({
      triggeredAt: r.triggeredAt,
      trigger: r.trigger,
      listingKey: r.listingKey,
      linksFound: r.linksFound,
      newCandidates: r.newCandidates,
      validated: r.validated,
      promoted: r.promoted,
      queuedForReview: r.queuedForReview,
      rejected: r.rejected,
      error: r.error ?? null,
    }));
  },
});

/**
 * CLI: delete ALL discovery candidates (pipeline shakeout hygiene while
 * bringing a listing online — e.g. after fixing link canonicalization).
 * Sweep-log rows are NEVER touched: the execution history of earlier
 * scans stays as evidence. Admin-key invocation only.
 */
export const resetCandidatesCli = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("discoveryCandidates").collect();
    for (const r of rows) await ctx.db.delete(r._id);
    return { deleted: rows.length };
  },
});

/**
 * CLI: purge a MIS-PROMOTED auto-discovered source (identity-detector
 * bug correction, e.g. the 2026-10-08 Rules-2007-stored-as-Amendment-2006
 * misfire). Guarded twice: only sources whose statusNote marks them as
 * auto-discovered can be purged, and the stableKey must be given exactly.
 * Seeded/connector sources are structurally unreachable.
 */
export const purgeDiscoveredSourceCli = internalMutation({
  args: { stableKey: v.string() },
  handler: async (ctx, args) => {
    const s = await ctx.db
      .query("legalSources")
      .withIndex("by_stable_key", (q) => q.eq("stableKey", args.stableKey))
      .unique();
    if (!s) return { purged: false, reason: "not found" };
    if (!s.statusNote?.includes("Discovered automatically")) {
      return { purged: false, reason: "not an auto-discovered source — refused" };
    }
    const versions = await ctx.db
      .query("legalSourceVersions")
      .withIndex("by_source", (q) => q.eq("sourceId", s._id))
      .collect();
    for (const ver of versions) await ctx.db.delete(ver._id);
    await ctx.db.delete(s._id);
    return { purged: true, versionsDeleted: versions.length };
  },
});

/**
 * CLI readback: every candidate with its gate outcome — the headless
 * evidence view of a scan + validation + promotion cycle (admin-key
 * invocation only; the live pipeline itself runs through
 * manualDiscoveryScan / promoteFromReview with real operator identity).
 */
export const candidatesCli = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("discoveryCandidates").collect();
    return rows
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((c) => ({
        listingKey: c.listingKey,
        url: c.url,
        status: c.status,
        identity: c.detectedIdentity ?? null,
        stableKey: c.detectedStableKey ?? null,
        duplicateOf: c.duplicateOfStableKey ?? null,
        gates: c.gates ?? null,
        gateSummary: c.gateSummary ?? null,
        sectionsCount: c.sectionsCount ?? null,
        bodyChars: c.bodyChars ?? null,
        hindiRatio: c.hindiRatio ?? null,
        promotedSourceId: c.promotedSourceId
          ? String(c.promotedSourceId)
          : null,
        promotedStableKey: c.promotedStableKey ?? null,
        reviewNote: c.reviewNote ?? null,
        firstSeenAt: c.firstSeenAt,
        updatedAt: c.updatedAt,
      }));
  },
});
