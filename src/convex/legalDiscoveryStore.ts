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
import { DISCOVERY_LISTINGS } from "./discoveryListings";
import { getAuthSessionId } from "@convex-dev/auth/server";
import { internalMfaState } from "./twofactor";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * STRUCTURED JURISDICTION MATCHING (turn 36).
 *
 * stableKeys are colon-namespaced: `in:statute:jj-2015`, `in:rules:...`,
 * `in:guidance:...`. An assignment grants authority over a PREFIX SEGMENT
 * — `in:` (all India), `in:statute:` (Indian statutes only) — and a source
 * is covered iff the assignment's segment list is a prefix of the
 * source's SEGMENT LIST on segment boundaries. Raw string prefix matching
 * is WRONG here: `in:statute` would accidentally match `in:statutory-x`
 * (or `in:statu…` anything), i.e. garbage like `"in"` would cover
 * `"industrial-..."` slugs inside a segment. Matching therefore compares
 * whole segments only.
 */
export function jurisdictionCovers(
  assignmentPrefix: string,
  stableKey: string,
): boolean {
  const a = assignmentPrefix.split(":").map((s) => s.trim()).filter(Boolean);
  const k = stableKey.split(":").map((s) => s.trim()).filter(Boolean);
  if (a.length === 0 || a.length > k.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== k[i]) return false;
  }
  // Boundary rule: the assignment must END on a segment boundary of the
  // key — `in:statute` covers `in:statute:jj-2015`, and `in:` covers
  // everything under India; a partial final segment never matches (the
  // equals-prefix check above already enforces whole-segment equality).
  return true;
}

/**
 * Is an assignment row CURRENTLY authorising? Active, never revoked, and
 * not past a deliberate expiry (term-bound authority). Shared by the
 * review gate, the packet display and the renewal window check.
 */
export function assignmentCurrentlyAuthorises(
  a: { active: boolean; revokedAt?: number | null; expiresAt?: number | null },
  now: number,
): boolean {
  if (!a.active) return false;
  if (a.revokedAt) return false;
  if (a.expiresAt !== undefined && a.expiresAt !== null && a.expiresAt <= now) {
    return false;
  }
  return true;
}

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

/** Internal reauth gate consumed by the node-action promotion path. */
export const reauthGate = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; reason: string | null }> => {
    const user = await getCurrentUser(ctx);
    if (!user) return { ok: false, reason: "Not signed in." };
    const reason = await reauthRequired(ctx, user._id);
    return { ok: reason === null, reason };
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

/**
 * CONTINUITY (turn 36): compute the overlap verdict for a scan against
 * the last SUCCESSFUL scan of the SAME listing.
 *
 * URL-hash dedupe prevents duplicate PROCESSING; it does NOT recover
 * unseen publications that appeared and left a capped feed between two
 * successful scans. Each scan therefore either demonstrably overlaps its
 * predecessor (continuity held) or gaps cannot be ruled out, which is
 * recorded as an explicit possible coverage gap with its first-seen
 * timestamp (a later failed scan neither opens nor clears a gap — it
 * just leaves continuity unestablished for that interval).
 */
export function continuityOverlapCount(
  prior: string[],
  now: string[],
): number {
  const priorSet = new Set(prior);
  let n = 0;
  for (const u of now) if (priorSet.has(u)) n += 1;
  return n;
}

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
    // The observed window of this scan (capped ≤ 40); absent when the
    // listing fetch itself failed (no window observed).
    windowUrls: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; continuity: string }> => {
    const now = Date.now();
    // Recent history FOR THIS LISTING (bounded scan — by_time is recent-first).
    const prev = (
      await ctx.db
        .query("discoverySweepLogs")
        .withIndex("by_time", (q) => q.lt("triggeredAt", now))
        .order("desc")
        .take(200)
    ).filter((l) => l.listingKey === args.listingKey);
    const lastSuccess = prev.find((l) => !l.error);
    const lastAny = prev[0];

    let continuity: "overlap" | "gap" | "first" | "unknown" = "unknown";
    let coverageGapSince: number | undefined;
    if (args.error || !args.windowUrls) {
      // A failed scan establishes nothing: it cannot CLEAR an open gap
      // (the interval under failure may contain items we never saw) and
      // it cannot CLOSE one. If none is open and a prior successful scan
      // exists, the interval IS potentially unretrievable — open a gap.
      continuity = "unknown";
      coverageGapSince =
        lastAny?.coverageGapSince ?? (lastSuccess ? now : undefined);
    } else if (!lastSuccess || !lastSuccess.windowUrls?.length) {
      continuity = "first";
    } else if (
      continuityOverlapCount(lastSuccess.windowUrls, args.windowUrls) > 0
    ) {
      continuity = "overlap"; // continuity held — gap closed by construction
    } else {
      continuity = "gap";
      // Carry an already-open gap forward; otherwise open at this scan.
      coverageGapSince = lastAny?.coverageGapSince ?? now;
    }

    await ctx.db.insert("discoverySweepLogs", {
      triggeredAt: now,
      trigger: args.trigger,
      listingKey: args.listingKey,
      linksFound: args.linksFound,
      newCandidates: args.newCandidates,
      validated: args.validated,
      promoted: args.promoted,
      queuedForReview: args.queuedForReview,
      rejected: args.rejected,
      error: args.error?.slice(0, 300),
      windowUrls: args.windowUrls?.slice(0, 40),
      continuityOverlapChecked: true,
      continuityOverlap: continuity,
      coverageGapSince,
    });
    return { ok: true, continuity };
  },
});

/**
 * Shared state computation for the packet + monitor: a source's legal-
 * review status is data-driven — `reviewed` only when a qualified-
 * review record exists for the CURRENT latest version with faithful
 * findings; anything else resolves `outstanding` by construction.
 */
/**
 * Does THIS user hold an active reviewer assignment whose jurisdiction
 * prefix matches the given stableKey prefix? Authority check used by
 * the packet display and the assignment-aware review queue.
 */
async function reviewerHasAuthorityFor(
  ctx: QueryCtx,
  userId: Id<"users">,
  stableKeyPrefix: string,
): Promise<boolean> {
  const rows = await ctx.db
    .query("reviewerAssignments")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const now = Date.now();
  return rows.some(
    (a) =>
      assignmentCurrentlyAuthorises(a, now) &&
      jurisdictionCovers(a.jurisdictionPrefix, stableKeyPrefix),
  );
}

async function legalReviewStateFor(
  ctx: QueryCtx,
  sourceId: Id<"legalSources">,
): Promise<string> {
  const src = await ctx.db.get(sourceId);
  if (!src) return "OUTSTANDING — source not found";
  const latest = src.latestVersion ? await ctx.db.get(src.latestVersion) : null;
  const history = await ctx.db
    .query("discoveryLegalReviews")
    .withIndex("by_source_version", (q) => q.eq("sourceId", sourceId))
    .order("desc")
    .collect();
  if (!latest) return "OUTSTANDING — no versions on record";
  const onLatest = history.find((r) => r.version === latest.version);
  if (!onLatest) {
    return `OUTSTANDING — no qualified review of version ${latest.version}`;
  }
  if (onLatest.findings === "uncertain" || onLatest.findings === "defective") {
    return `FLAGGED — version ${latest.version} review findings: ${onLatest.findings} (by ${onLatest.reviewerName ?? "unnamed reviewer"})`;
  }
  return `REVIEWED — version ${latest.version} attested faithful (${onLatest.findings}) by ${onLatest.reviewerName ?? "unnamed reviewer"} on ${new Date(onLatest.reviewedAt).toISOString().slice(0, 10)}; scope: ${onLatest.scope}`;
}

// ---------------------------------------------------------------------
// Qualified legal review — the per-version record a qualified lawyer
// signs. This REPLACES the hardcoded "always OUTSTANDING" display: the
// standalone-status computation is data-driven (a promoted auto-
// discovered source with NO matching review record is outstanding by
// construction), and the record carries reviewer identity, scope,
// findings and date for the audit history.
// AUTO-discovery never runs this path; it is invoked manually by a
// signed-in human granting their own identity (requireOperator gates
// it). The personal-authority rule: owning the software is NOT reviewer
// qualification — that judgment belongs to the human whose identity is
// recorded.
// ---------------------------------------------------------------------

/**
 * Record a qualified legal review of ONE source version (append-only;
 * re-review creates a NEW row — history is never overwritten).
 * Turn 35: a platform operator identity is NOT sufficient. The actor
 * must hold an ACTIVE reviewer assignment whose jurisdiction prefix
 * matches the source's stableKey namespace. Owning the platform or even
 * operating it grants NO review authority; assignments are explicit
 * records. Any user (operator or not) may be assigned.
 */
export const recordLegalReview = mutation({
  args: {
    sourceId: v.id("legalSources"),
    version: v.number(),
    scope: v.string(),
    findings: v.union(
      v.literal("faithful_reproduction"),
      v.literal("faithful_with_notes"),
      v.literal("uncertain"),
      v.literal("defective"),
    ),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireOperator(ctx);
    const src = await ctx.db.get(args.sourceId);
    if (!src) throw new Error("Source not found.");
    // REVIEW-AUTHORITY GATE: an active, unexpired assignment with a
    // matching jurisdiction must exist for THIS user, and the acting
    // session must have completed the required internal-MFA challenge.
    // Platform-operator status or assignment alone never passes this
    // gate on their own.
    const myRows = await ctx.db
      .query("reviewerAssignments")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const now = Date.now();
    const assignment = myRows.find(
      (a) =>
        assignmentCurrentlyAuthorises(a, now) &&
        jurisdictionCovers(a.jurisdictionPrefix, src.stableKey),
    );
    if (!assignment) {
      const expired = myRows.some(
        (a) =>
          a.active &&
          !a.revokedAt &&
          jurisdictionCovers(a.jurisdictionPrefix, src.stableKey) &&
          a.expiresAt !== undefined &&
          a.expiresAt !== null &&
          a.expiresAt <= now,
      );
      throw new Error(
        expired
          ? "Review not recorded: the reviewer assignment covering this jurisdiction has EXPIRED. A renewed assignment from a platform administrator is required."
          : "Review not recorded: this identity holds no active legal-reviewer assignment covering this source's jurisdiction. Platform-operator status alone does not confer review authority; an explicit reviewer assignment is required.",
      );
    }
    // REQUIRED INTERNAL MFA on privileged review recording (turn 36):
    // same gate the workforce/owner surfaces use — TOTP enrollment + a
    // live session challenge. Email-OTP possession is authentication,
    // not a second factor.
    const sessionId = await getAuthSessionId(ctx);
    const mfa = await internalMfaState(ctx.db, user, sessionId);
    if (!mfa.enrolled || !mfa.satisfied) {
      throw new Error(
        mfa.enrolled
          ? "Review not recorded: complete the two-factor challenge for this session first (Settings → Security)."
          : "Review not recorded: two-factor enrollment is required for legal-review recording (Settings → Security).",
      );
    }
    const version = await ctx.db
      .query("legalSourceVersions")
      .withIndex("by_source", (q) => q.eq("sourceId", args.sourceId))
      .filter((q) => q.eq(q.field("version"), args.version))
      .unique() ?? null;
    if (!version) throw new Error(`Version ${args.version} not found.`);
    const reviewedAt = Date.now();
    await ctx.db.insert("discoveryLegalReviews", {
      sourceId: args.sourceId,
      version: args.version,
      reviewerId: user._id,
      reviewerName: user.name ?? undefined,
      reviewerEmail: user.email ?? undefined,
      scope: args.scope.slice(0, 400),
      findings: args.findings,
      notes: args.notes?.slice(0, 2000),
      reviewedAt,
    });
    return { ok: true, reviewedAt };
  },
});

// ---------------------------------------------------------------------
// Reviewer assignments (turn 35) — publication authority vs.
// legal-review authority are DIFFERENT grants. An operator may publish
// (promote/reject candidates) but must NOT conduct legal review until a
// separate, explicit assignment row authorises them for a jurisdiction.
// The requester self-declares any professional credentials; those are
// recorded verbatim and marked self_declared — storing them is not
// verification, and no code path treats an assignment as proof of
// verified qualification.
// ---------------------------------------------------------------------

/** Record (or update, never overwrite) a reviewer assignment. */
export const assignReviewer = mutation({
  args: {
    userId: v.id("users"),
    jurisdictionPrefix: v.string(),
    scopeNote: v.optional(v.string()),
    selfDeclaredCredentials: v.optional(v.string()),
    // Deliberate expiry (term-bound authority), epoch ms. Absent =
    // indefinite. Renewal is a NEW row, never a mutation of an old one.
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const assigner = await requireOperator(ctx);
    if (!/^(\s*[a-z0-9-]+\s*:)+$/.test(args.jurisdictionPrefix) ||
        args.jurisdictionPrefix.split(":").filter(Boolean).length < 1) {
      throw new Error(
        "jurisdictionPrefix must be a colon-namespaced segment prefix, e.g. 'in:' or 'in:statute:'",
      );
    }
    // ASSIGNMENT GRANTING is a privileged platform operation (turn 36):
    // internal-MFA required, same gate class as workforce administration.
    const sessionId = await getAuthSessionId(ctx);
    const mfa = await internalMfaState(ctx.db, assigner, sessionId);
    if (!mfa.enrolled || !mfa.satisfied) {
      throw new Error(
        mfa.enrolled
          ? "Assignment refused: complete the two-factor challenge for this session first (Settings → Security)."
          : "Assignment refused: two-factor enrollment is required to grant reviewer assignments (Settings → Security).",
      );
    }
    if (args.expiresAt !== undefined && args.expiresAt <= Date.now()) {
      throw new Error("expiresAt must be in the future.");
    }
    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("Reviewee user not found.");
    await ctx.db.insert("reviewerAssignments", {
      userId: args.userId,
      userLabel: target.name ?? target.email ?? "unknown",
      jurisdictionPrefix: args.jurisdictionPrefix,
      scopeNote: args.scopeNote?.slice(0, 300),
      selfDeclaredCredentials: args.selfDeclaredCredentials?.slice(0, 1000),
      // Stored verbatim, flagged as NOT verified. Only a future
      // independently_verified record could change this flag.
      credentialStatus: "self_declared" as const,
      active: true,
      assignedById: assigner._id,
      assignedAt: Date.now(),
      expiresAt: args.expiresAt,
    });
    return { ok: true };
  },
});

/** List active assignments (operator view, audit). */
export const reviewerAssignments = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    return ctx.db.query("reviewerAssignments").order("desc").collect();
  },
});

/** Revoke: active=false + revokedAt — assignments are history, never deleted. */
export const revokeReviewer = mutation({
  args: { assignmentId: v.id("reviewerAssignments") },
  handler: async (ctx, args) => {
    const user = await requireOperator(ctx);
    const a = await ctx.db.get(args.assignmentId);
    if (!a) throw new Error("Assignment not found.");
    if (!a.active) throw new Error("Assignment already revoked.");
    await ctx.db.patch(args.assignmentId, {
      active: false,
      revokedAt: Date.now(),
    });
    return { ok: true, revokedBy: user.email ?? user.name ?? "operator" };
  },
});

/**
 * Which candidates is THIS user assigned to? Reviewer-queue filtering:
 * a candidate whose listing or detected stableKey falls inside one of
 * the user's active jurisdiction prefixes. Non-assigned operators see
 * the queue but have no legal-review authority — publication decisions
 * (promote/reject) remain owner/operator functions; legal review is a
 * separate authority granted per jurisdiction.
 */
export const myReviewScope = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { signedIn: false, assignments: [] };
    const rows = await ctx.db
      .query("reviewerAssignments")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    // Same currency rule as the review gate: expiry counts here too, so a
    // lapsed assignment disappears from the reviewer's own scope view.
    const now = Date.now();
    const active = rows.filter((a) => assignmentCurrentlyAuthorises(a, now));
    return {
      signedIn: true,
      isOperator: isPlatformOperator(user),
      assignments: active.map((a) => ({
        jurisdictionPrefix: a.jurisdictionPrefix,
        scopeNote: a.scopeNote ?? null,
        credentialStatus: a.credentialStatus,
      })),
    };
  },
});

/** All reviews of a source (audit history keyed by source+version). */
export const legalReviewHistory = query({
  args: { sourceId: v.id("legalSources") },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    return ctx.db
      .query("discoveryLegalReviews")
      .withIndex("by_source_version", (q) => q.eq("sourceId", args.sourceId))
      .order("desc")
      .collect();
  },
});

/**
 * The standalone legal-review STATUS for one source — data-driven, not
 * a hardcoded label: outstanding unless a review row exists for the
 * CURRENT latest version with findings of faithful-with-notes or
 * faithful WITHOUT defect, and it has not been superseded by a later
 * version of the same source. Exposed in the packet and in monitoring.
 */
export const legalReviewStatus = query({
  args: { sourceId: v.id("legalSources") },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const src = await ctx.db.get(args.sourceId);
    if (!src) throw new Error("Source not found.");
    const latest = src.latestVersion
      ? await ctx.db.get(src.latestVersion)
      : null;
    const history = await ctx.db
      .query("discoveryLegalReviews")
      .withIndex("by_source_version", (q) => q.eq("sourceId", args.sourceId))
      .order("desc")
      .collect();
    const onLatest = latest
      ? history.find((r) => r.version === latest.version)
      : undefined;
    const covered = latest && onLatest &&
      (onLatest.findings === "faithful_reproduction" ||
        onLatest.findings === "faithful_with_notes");
    return {
      status: covered ? "reviewed" : "outstanding",
      reviewedVersion: latest?.version ?? null,
      reviewedBy: covered ? (onLatest?.reviewerName ?? "") : null,
      findings: covered ? onLatest.findings : null,
      reviewedAt: covered ? onLatest.reviewedAt : null,
      uncertainOrDefective: latest && onLatest &&
        (onLatest.findings === "uncertain" || onLatest.findings === "defective"),
      historyCount: history.length,
    };
  },
});

// ---------------------------------------------------------------------
// Review queue — human decisions on uncertain candidates.
// ---------------------------------------------------------------------

/**
 * Reauthentication helper for operator write gates (same evidence class
 * firmExit.ts uses): promotion is a corpus-affecting decision, so the
 * acting platform operator must have signed in within 168 h. Returns
 * "" when fine, else a message.
 */
export async function reauthRequired(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<string | null> {
  const REAUTH_WINDOW = 168 * 3600_000;
  const row = await ctx.db
    .query("loginEvents")
    .withIndex("by_user_time", (q) => q.eq("userId", userId))
    .order("desc")
    .first();
  if (!row) {
    return "No sign-in event on record — sign in again (7-day reauthentication window).";
  }
  if (Date.now() - row.at > REAUTH_WINDOW) {
    return "Last sign-in is older than 7 days — sign in again before promoting a source.";
  }
  return null;
}

/**
 * REVIEW PACKET (query, operator-gated): everything a publication
 * reviewer needs for one candidate — original-document context, the
 * extraction result, extraction warnings, and the PROPOSED identifier.
 *
 * Deliberately carries THREE separately-labelled statuses: technical
 * validation (gates), publication decision (owner promote/reject), and
 * qualified legal review (ALWAYS outstanding for auto-discovered text
 * until a qualified reviewer attests). Owning the software grants none
 * of these by itself.
 */
export const reviewPacket = query({
  args: { candidateId: v.id("discoveryCandidates") },
  handler: async (ctx, args) => {
    const user = await requireOperator(ctx);
    const c = await ctx.db.get(args.candidateId);
    if (!c) throw new Error("Candidate not found.");
    const promotedSource = c.promotedSourceId
      ? await ctx.db.get(c.promotedSourceId)
      : null;
    const warnings: string[] = [];
    const g = c.gates;
    if (g) {
      if (!g.magicOk) warnings.push("PDF magic bytes missing — not a PDF-shaped download.");
      if (!g.sizeOk) warnings.push("Size outside sane bounds for a reportable instrument.");
      if (!g.identityOk) warnings.push("Identity detection inconsistent with the publisher's own naming (left in review by design).");
      if (!g.languageOk) warnings.push(`Language gate failed (hindi ratio ${c.hindiRatio?.toFixed(4) ?? "n/a"}) — the English corpus need is not met.`);
      if (!g.sectionsOk) warnings.push(`Section anchors = ${c.sectionsCount ?? 0} — outside bounds for this instrument class.`);
      if (!g.s1Ok) warnings.push("Section 1 (short title) not detected — anchor drift or non-instrument shape.");
      if (!g.duplicateOk) warnings.push(`Duplicate of existing corpus entry: ${c.duplicateOfStableKey ?? "unknown"}.`);
    }
    if (c.hindiRatio !== null && c.hindiRatio !== undefined && c.hindiRatio > 0.02) {
      warnings.push("Devanagari characters present (likely bilingual gazette header — normal, noted).");
    }
    return {
      candidate: {
        _id: c._id,
        status: c.status,
        listingKey: c.listingKey,
        url: c.url,
        linkTitle: c.linkTitle ?? null,
        firstSeenAt: c.firstSeenAt,
        updatedAt: c.updatedAt,
      },
      extracted: {
        identity: c.detectedIdentity ?? null,
        proposedStableKey: c.detectedStableKey ?? null,
        jurisdiction: "in / national (from the listing's registered scope)",
        amendmentRelationship:
          c.detectedStableKey?.includes("amendment-")
            ? "AMENDS the principal act — NOT a consolidated restatement; original act text remains separate"
            : c.detectedStableKey?.includes("rules-")
              ? "SUBSIDIARY rules under the principal act"
              : c.detectedStableKey?.includes("model-rules-")
                ? "MODEL rules — persuasive template, not binding law"
                : "PRINCIPAL instrument as published",
        enactedOrPublishedAs: c.linkTitle ?? c.detectedIdentity ?? null,
        sectionsCount: c.sectionsCount ?? null,
        bodyChars: c.bodyChars ?? null,
        hindiRatio: c.hindiRatio ?? null,
        bytesHash: c.bytesHash ?? null,
      },
      gates: g ?? null,
      gateSummary: c.gateSummary ?? null,
      warnings,
      provenance: promotedSource
        ? {
            sourceId: promotedSource._id,
            sourceUrl: promotedSource.sourceUrl,
            publisher: promotedSource.publisher,
            collectionDate: promotedSource.collectionDate,
            statusNote: promotedSource.statusNote ?? null,
          }
        : null,
      statuses: {
        technicalValidation:
          g && Object.values(g).every(Boolean) ? "passed" : "not_passed",
        publicationDecision:
          c.status === "promoted"
            ? "published"
            : c.status === "rejected"
              ? "rejected"
              : "PENDING — operator promotes or rejects with a note",
        // Data-driven (turn 34): outstanding unless a qualified-review
        // row covers the source's CURRENT latest version. Never auto-
        // granted; the record itself carries reviewer identity.
        legalReview: promotedSource
          ? await legalReviewStateFor(ctx, promotedSource._id)
          : "OUTSTANDING — unreviewed: a qualified review record covering the latest version does not exist yet",
      },
      reviewer: {
        name: user.name ?? user.email ?? null,
        reauthPending: (await reauthRequired(ctx, user._id)) !== null,
        // Turn 35: publication authority (operator) and legal-review
        // authority (assigned reviewer) shown separately in the packet
        // so the UI cannot blur them.
        canLegallyReview: await reviewerHasAuthorityFor(ctx, user._id, "in:"),
      },
    };
  },
});

/** Platform-operator monitor data: counts by status + recent sweep logs. */
export const discoveryMonitor = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const rows = await ctx.db.query("discoveryCandidates").collect();
    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    const recentLogs = await ctx.db
      .query("discoverySweepLogs")
      .withIndex("by_time")
      .order("desc")
      .take(6);
    return { byStatus, total: rows.length, recentLogs };
  },
});

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

/**
 * CONTINUITY SUMMARY (turn 36): per registered listing, the latest sweep
 * outcome and whether a coverage gap is OPEN. A gap is open iff the most
 * recent log for the listing carries coverageGapSince — opened by a scan
 * that shared no URL with the last successful scan ("gap"), by a failed
 * scan after a successful one ("unknown" interval), and CARRIED forward
 * until a subsequent successful scan demonstrably overlaps again.
 * Deliberately separate from `byStatus`/totals: dedupe/drift are distinct
 * questions.
 */
export const listingContinuity = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const rows = await ctx.db
      .query("discoverySweepLogs")
      .withIndex("by_time")
      .order("desc")
      .take(400);
    const out: {
      listingKey: string;
      lastLogAt: number | null;
      lastContinuity: string | null;
      gapOpenSince: number | null;
      lastError: string | null;
    }[] = [];
    for (const listingKey of Object.keys(DISCOVERY_LISTINGS)) {
      const forListing = rows.filter((r) => r.listingKey === listingKey);
      const latest = forListing[0];
      const gapRow = forListing.find((r) => r.coverageGapSince);
      out.push({
        listingKey,
        lastLogAt: latest?.triggeredAt ?? null,
        lastContinuity: latest?.continuityOverlap ?? null,
        // The most recent gap timestamp wins: rows are recent-first, so
        // the first row carrying one marks the CURRENT unresolved run.
        gapOpenSince: gapRow?.coverageGapSince ?? null,
        lastError: latest?.error ?? null,
      });
    }
    return out;
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
      continuityOverlap: r.continuityOverlap ?? null,
      windowSize: r.windowUrls?.length ?? null,
      coverageGapSince: r.coverageGapSince ?? null,
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
 * CLI: requeue transient-fetch failures (turn 34): the eGazette WriteReadData
 * static files fail inside the action's egress with an undici fetch error
 * (TLS chain build), but the SAME bytes fetch fine with the pinned
 * PUBLIC-anchors https agent (verified out-of-band 10 Oct 2026: HTTP 200
 * %PDF- content-type). Requeued listed "found" so the validator retries
 * through its own pinned path.
 */
export const requeueFailedCli = internalMutation({
  args: { listingKey: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("discoveryCandidates")
      .withIndex("by_listing", (q) => q.eq("listingKey", args.listingKey))
      .collect();
    let requeued = 0;
    for (const r of rows) {
      if (r.status === "rejected" && r.gateSummary?.includes("FAILED[exception] fetch failed")) {
        await ctx.db.patch(r._id, { status: "found", updatedAt: Date.now() });
        requeued += 1;
      }
    }
    return { requeued };
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
        _id: String(c._id),
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
