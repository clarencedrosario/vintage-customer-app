import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { requireAccess, requireCapability, getAccessContext } from "./access";
import type { Doc, Id } from "./_generated/dataModel";
import { sha256Hex } from "../lib/evidenceIntegrity";

// =====================================================================
// §32 PHASE 5 — FILING-READINESS WORKSPACE.
//
// Versioned checklists per matter (v1, v2, …; every revision creates a
// NEW version — completed versions are frozen records). Deterministic
// checks (registry-relevant dates in the past, missing court/case
// metadata) run over the CURRENT matter state; AI suggestions land in a
// SEPARATE table and become checklist items only via explicit lawyer
// approval.
//
// Readiness is a DATED STATEMENT: approving a checklist freezes it, and
// any later change to the underlying documents or legal profile
// INVALIDATES the approval (detected at read time against a snapshot
// hash of the matter's documents + profile). No acceptance is ever
// promised — the registry may still reject a filing for its own
// reasons; that disclaimer is part of every approval record and read.
// =====================================================================

const NOT_AN_ACCEPTANCE_GUARANTEE =
  "Readiness reflects THIS checklist's items as of its approval time. It is NOT an acceptance guarantee: the court or registry may still reject, return, or refuse to accept a filing for its own reasons.";

/**
 * Deterministic snapshot of the matter facts the checklist's readiness
 * depends on: document ids + updater stamps and the legal profile.
 * The hash changes whenever any of it changes → an approved checklist
 * whose recorded hash no longer matches is INVALIDATED (stale).
 */
async function snapshotMatter(ctx: { db: any }, matterId: string) {
  const docs = await ctx.db
    .query("matterDocuments")
    .filter((q: any) => q.eq(q.field("matterId"), matterId))
    .collect();
  const docPart = docs
    .map((d: any) => `${d._id}:${d.updatedAt ?? d.createdAt}`)
    .sort()
    .join("|");
  const matter = await ctx.db.get(matterId);
  const profilePart = matter?.legalProfile
    ? JSON.stringify(matter.legalProfile)
    : "none";
  const basis = `${docPart}#${profilePart}`;
  const hash = await sha256Hex(new TextEncoder().encode(basis));
  return { hash, docCount: docs.length, docPart, profilePart };
}

/** Open draft checklist for a matter (at most one at a time). */
export const getDraft = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.orgId !== ac.org._id) return null;
    const rows = await ctx.db
      .query("filingChecklists")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    const draft = rows.find((r) => r.status === "draft") ?? null;
    return draft ? { ...draft, disclaimer: NOT_AN_ACCEPTANCE_GUARANTEE } : null;
  },
});

/**
 * Full checklist history for a matter (newest first). The disclaimer
 * rides EVERY read: checklist completion does NOT guarantee that the
 * court will accept a filing.
 */
export const listVersions = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.orgId !== ac.org._id) return [];
    const rows = await ctx.db
      .query("filingChecklists")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    return rows
      .sort((a, b) => b.version - a.version)
      .map((r) => ({ ...r, disclaimer: NOT_AN_ACCEPTANCE_GUARANTEE }));
  },
});

/** Create (or start) the next draft version. */
export const createDraft = mutation({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.edit");
    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.orgId !== ac.org._id) {
      throw new Error("Matter not found in this organization.");
    }
    const existing = await ctx.db
      .query("filingChecklists")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    if (existing.some((r) => r.status === "draft")) {
      throw new Error(
        "A draft checklist already exists — finish or revise it instead of starting another.",
      );
    }
    const nextVersion =
      (existing.sort((a, b) => b.version - a.version)[0]?.version ?? 0) + 1;
    const id = (await ctx.db.insert("filingChecklists", {
      orgId: ac.org._id,
      matterId: args.matterId,
      version: nextVersion,
      status: "draft",
      items: [],
      court: matter.court,
      caseNumber: matter.caseNumber,
      caseYear: matter.caseYear,
      createdById: ac.user._id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })) as Id<"filingChecklists">;
    return { checklistId: String(id), version: nextVersion };
  },
});

/** Upsert one checklist item on the DRAFT (lawyer input, matter.edit). */
export const setItem = mutation({
  args: {
    checklistId: v.id("filingChecklists"),
    key: v.string(),
    requirement: v.string(),
    itemStatus: v.union(
      v.literal("satisfied"),
      v.literal("not_satisfied"),
      v.literal("not_applicable"),
    ),
    documentId: v.optional(v.id("matterDocuments")),
    factId: v.optional(v.id("matterFacts")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.edit");
    const cl = await ctx.db.get(args.checklistId);
    if (!cl || cl.orgId !== ac.org._id) {
      throw new Error("Checklist not found in this organization.");
    }
    if (cl.status !== "draft") {
      throw new Error(
        "This checklist version is frozen — revise by starting a new version.",
      );
    }
    if (args.documentId) {
      const doc = await ctx.db.get(args.documentId);
      if (!doc || doc.matterId !== cl.matterId) {
        throw new Error("Evidence document must belong to the checklist's matter.");
      }
    }
    const items = [...cl.items];
    const idx = items.findIndex((i) => i.key === args.key);
    const entry = {
      key: args.key,
      requirement: args.requirement,
      itemStatus: args.itemStatus,
      documentId: args.documentId,
      factId: args.factId,
      note: args.note,
      updatedById: ac.user._id,
      updatedAt: Date.now(),
    };
    if (idx >= 0) items[idx] = entry;
    else items.push(entry);
    await ctx.db.patch(cl._id, { items, updatedAt: Date.now() });
    return { itemCount: items.length };
  },
});

/**
 * Deterministic checks over the CURRENT matter state (registry-relevant
 * dates already past, missing court/case metadata, unsatisfied items).
 * Pure review material — nothing here files anything.
 */
export const deterministicChecks = query({
  args: { checklistId: v.id("filingChecklists") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const cl = await ctx.db.get(args.checklistId);
    if (!cl || cl.orgId !== ac.org._id) return null;
    const matter = await ctx.db.get(cl.matterId);
    const checks: { key: string; status: "ok" | "attention"; detail: string }[] = [];

    // 1. Every item must be explicitly satisfied or not applicable — and
    //    an EMPTY checklist is never complete.
    const unsat = cl.items.filter((i) => i.itemStatus === "not_satisfied");
    checks.push({
      key: "items_complete",
      status: cl.items.length > 0 && unsat.length === 0 ? "ok" : "attention",
      detail:
        cl.items.length === 0
          ? "No items recorded yet — the checklist is empty."
          : unsat.length === 0
            ? `${cl.items.length} item(s) recorded; none left as not satisfied.`
            : `${unsat.length} item(s) still NOT satisfied: ${unsat.map((i) => i.key).join(", ")}.`,
    });

    // 2. Court metadata present.
    checks.push({
      key: "court_metadata",
      status: cl.court && cl.caseNumber && cl.caseYear ? "ok" : "attention",
      detail:
        cl.court && cl.caseNumber && cl.caseYear
          ? `Court, case number and year recorded.`
          : `Court/case-number/year metadata is incomplete — the registry will normally require it.`,
    });

    // 3. Limitation-style sanity: the matter's filing/incident dates in
    //    the profile must be in the past (a future date is a data error,
    //    reported as such, never as a legal computation).
    const dates = matter?.legalProfile?.legalDates ?? [];
    const future = dates.filter(
      (d) => d.kind === "filing" && d.date > new Date().toISOString().slice(0, 10),
    );
    checks.push({
      key: "dates_sane",
      status: future.length === 0 ? "ok" : "attention",
      detail:
        future.length === 0
          ? dates.length > 0
            ? `${dates.length} profile legal date(s) recorded; none dated in the future.`
            : "No profile legal dates recorded."
          : `Filing date(s) in the FUTURE recorded in the profile: ${future.map((d) => d.date).join(", ")} — likely a data-entry error.`,
    });

    return {
      checks,
      snapshot: await snapshotMatter(ctx, cl.matterId),
      disclaimer: NOT_AN_ACCEPTANCE_GUARANTEE,
    };
  },
});

/**
 * AI suggestions for the DRAFT — derived DETERMINISTICALLY here (clearly
 * labelled as derived suggestions, not model output; the deterministic
 * derivation keeps this honest while live-model enhancement stays
 * gated). Suggestions never merge automatically.
 */
export const proposeSuggestions = mutation({
  args: { checklistId: v.id("filingChecklists") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "ai.use");
    const cl = await ctx.db.get(args.checklistId);
    if (!cl || cl.orgId !== ac.org._id) {
      throw new Error("Checklist not found in this organization.");
    }
    if (cl.status !== "draft") {
      throw new Error("Suggestions apply only to a draft checklist.");
    }
    const matter = await ctx.db.get(cl.matterId);
    const proposals: { key: string; requirement: string; basis: string }[] = [];
    // S1: unfilled court metadata.
    if (!cl.court || !cl.caseNumber || !cl.caseYear) {
      proposals.push({
        key: "court_metadata",
        requirement:
          "Record the court, case number and year exactly as the registry requires.",
        basis: "Derived from the checklist: court/case metadata is incomplete.",
      });
    }
    // S2: profile dates missing while the practice area is civil.
    if ((matter?.legalProfile?.legalDates ?? []).length === 0) {
      proposals.push({
        key: "profile_dates",
        requirement:
          "Confirm the matter's legal dates (filing, agreement, incident) in the legal profile.",
        basis: "Derived from the matter: the legal profile records no legal dates.",
      });
    }
    // S3: no evidence document attached to any satisfied item.
    const satisfiedWithoutDoc = cl.items.filter(
      (i) => i.itemStatus === "satisfied" && !i.documentId && !i.factId,
    );
    if (satisfiedWithoutDoc.length > 0) {
      proposals.push({
        key: "evidence_pointers",
        requirement:
          "Attach the supporting document (or fact reference) to each satisfied item.",
        basis: `Derived from the checklist: ${satisfiedWithoutDoc.length} satisfied item(s) carry no evidence pointer (${satisfiedWithoutDoc.map((i) => i.key).join(", ")}).`,
      });
    }

    const existing = await ctx.db
      .query("filingSuggestions")
      .withIndex("by_checklist", (q) => q.eq("checklistId", cl._id))
      .collect();
    const existingKeys = new Set(existing.map((s) => s.key));
    let created = 0;
    for (const p of proposals) {
      if (existingKeys.has(p.key)) continue;
      await ctx.db.insert("filingSuggestions", {
        orgId: ac.org._id,
        checklistId: cl._id,
        matterId: cl.matterId,
        key: p.key,
        requirement: p.requirement,
        basis: p.basis,
        status: "proposed",
        createdAt: Date.now(),
      });
      created += 1;
    }
    return { created };
  },
});

/** List suggestions for a checklist. */
export const listSuggestions = query({
  args: { checklistId: v.id("filingChecklists") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const cl = await ctx.db.get(args.checklistId);
    if (!cl || cl.orgId !== ac.org._id) return [];
    return ctx.db
      .query("filingSuggestions")
      .withIndex("by_checklist", (q) => q.eq("checklistId", args.checklistId))
      .collect();
  },
});

/** Apply a suggestion → becomes a real checklist item (lawyer act). */
export const applySuggestion = mutation({
  args: { suggestionId: v.id("filingSuggestions") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.edit");
    const s = await ctx.db.get(args.suggestionId);
    if (!s || s.orgId !== ac.org._id) {
      throw new Error("Suggestion not found in this organization.");
    }
    if (s.status !== "proposed") {
      throw new Error("This suggestion has already been resolved.");
    }
    const cl = await ctx.db.get(s.checklistId);
    if (!cl || cl.status !== "draft") {
      throw new Error("The checklist is no longer a draft.");
    }
    const items = [...cl.items];
    if (!items.some((i) => i.key === s.key)) {
      items.push({
        key: s.key,
        requirement: s.requirement,
        itemStatus: "not_satisfied",
        updatedById: ac.user._id,
        updatedAt: Date.now(),
      });
      await ctx.db.patch(cl._id, { items, updatedAt: Date.now() });
    }
    await ctx.db.patch(s._id, {
      status: "applied",
      appliedAt: Date.now(),
      appliedById: ac.user._id,
    });
    return { applied: true };
  },
});

/** Dismiss a suggestion with a recorded reason. */
export const dismissSuggestion = mutation({
  args: { suggestionId: v.id("filingSuggestions"), reason: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.edit");
    const s = await ctx.db.get(args.suggestionId);
    if (!s || s.orgId !== ac.org._id) {
      throw new Error("Suggestion not found in this organization.");
    }
    if (!args.reason.trim()) {
      throw new Error("A dismissal reason is required.");
    }
    await ctx.db.patch(s._id, {
      status: "dismissed",
      dismissedReason: args.reason.trim().slice(0, 300),
    });
    return { dismissed: true };
  },
});

/**
 * Approve the draft as READY — freezes it. Readiness is a dated
 * statement (snapshot hash recorded); the disclaimer is part of the
 * approval.
 */
export const approveReady = mutation({
  args: { checklistId: v.id("filingChecklists") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.edit");
    const cl = await ctx.db.get(args.checklistId);
    if (!cl || cl.orgId !== ac.org._id) {
      throw new Error("Checklist not found in this organization.");
    }
    if (cl.status !== "draft") {
      throw new Error("Only a draft can be approved as ready.");
    }
    const unsat = cl.items.filter((i) => i.itemStatus === "not_satisfied");
    if (unsat.length > 0) {
      throw new Error(
        `Cannot approve: ${unsat.length} item(s) remain not satisfied (${unsat.map((i) => i.key).join(", ")}).`,
      );
    }
    const snap = await snapshotMatter(ctx, cl.matterId);
    await ctx.db.patch(cl._id, {
      status: "approved_ready",
      approvedById: ac.user._id,
      approvedAt: Date.now(),
      approvedSnapshotHash: snap.hash,
      court: cl.court,
      caseNumber: cl.caseNumber,
      caseYear: cl.caseYear,
      updatedAt: Date.now(),
    });
    return {
      approved: true,
      snapshotHash: snap.hash,
      disclaimer: NOT_AN_ACCEPTANCE_GUARANTEE,
    };
  },
});

/**
 * Internal invalidation sweep: any APPROVED checklist whose matter
 * snapshot no longer matches its frozen hash becomes `invalidated`
 * (with the reason recorded). Called from the document-ingest path so a
 * later upload can never ride on an earlier approval. Never reopens
 * anything — the next state is a NEW version.
 */
export const invalidateChanged = internalMutation({
  args: {
    matterId: v.id("matters"),
    because: v.union(
      v.literal("document_added"),
      v.literal("document_changed"),
      v.literal("profile_changed"),
      v.literal("manual"),
    ),
  },
  handler: async (ctx, args) => {
    const snap = await snapshotMatter(ctx, args.matterId);
    const rows = await ctx.db
      .query("filingChecklists")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    let invalidated = 0;
    for (const cl of rows) {
      if (cl.status !== "approved_ready") continue;
      if (cl.approvedSnapshotHash === snap.hash) continue;
      await ctx.db.patch(cl._id, {
        status: "invalidated",
        invalidation: {
          at: Date.now(),
          because: args.because,
          detail:
            "The matter's documents or legal profile changed after approval — the readiness statement no longer describes the current matter.",
          detectedById: undefined,
        },
        updatedAt: Date.now(),
      });
      invalidated += 1;
    }
    return { invalidated };
  },
});

/** Read one checklist (any version) with its live staleness state. */
export const get = query({
  args: { checklistId: v.id("filingChecklists") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const cl = await ctx.db.get(args.checklistId);
    if (!cl || cl.orgId !== ac.org._id) return null;
    const matter = await ctx.db.get(cl.matterId);
    if (!matter || matter.orgId !== ac.org._id) return null;
    let staleness: "current" | "stale" | "n/a" = "n/a";
    if (cl.status === "approved_ready" && cl.approvedSnapshotHash) {
      const snap = await snapshotMatter(ctx, cl.matterId);
      staleness = snap.hash === cl.approvedSnapshotHash ? "current" : "stale";
    }
    return {
      ...cl,
      staleness,
      disclaimer: NOT_AN_ACCEPTANCE_GUARANTEE,
      matterCourt: matter.court,
      matterCaseNumber: matter.caseNumber,
    };
  },
});
