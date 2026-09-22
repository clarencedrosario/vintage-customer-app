import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { can, requireAccess, requireMatter } from "./access";

// =====================================================================
// AI & OCR (section 26) — request bookkeeping, sources and approvals.
//
// Safeguards baked in here:
//  - Sources are an explicit act: a member with document access selects
//    an ordinary document, labels it (Our Client / Opposing Party /
//    Court / Evidence) and its extracted text is stored with page
//    numbers for real source references.
//  - Every AI request is saved (kind, inputs, status, tokens, cost) —
//    nothing is fire-and-forget.
//  - Monthly usage is capped per organization; over cap = refused.
//  - AI-suggested chronology events stay suggestions until a human
//    confirms them (reviewed flag).
//  - The runner (aiRunner.ts, Node) holds the API key; no key ever
//    reaches the browser.
// =====================================================================

const MAX_SOURCE_CHARS = 200_000;
const MAX_PAGES = 200;
const MONTHLY_TOKEN_LIMIT = 2_000_000; // usage cap per org per month

/** YYYY-MM in India/Asia/Kolkata for the usage meter. */
export function monthKeyIST(at = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  }).format(at);
}

// ---------------------------------------------------------------------
// Sources — explicit, authorized, reviewable extraction
// ---------------------------------------------------------------------

export const listSources = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    await requireMatter(ctx, ac, args.matterId);
    const rows = await ctx.db
      .query("aiSources")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({
        _id: r._id,
        documentId: r.documentId ?? null,
        name: r.name,
        role: r.role,
        extraction: r.extraction,
        charCount: r.charCount,
        pageCount: r.pageCount ?? null,
        documentUpdatedAt: r.documentUpdatedAt ?? null,
        addedById: r.addedById,
        createdAt: r.createdAt,
        preview: r.text.slice(0, 160),
      }));
  },
});

/**
 * Register an extracted source. The caller has already verified access
 * to the matter and the document (the UI uploads text it extracted from
 * a document it can open). Reviewable: the text is kept and can be
 * re-inspected or removed.
 */
export const addSource = mutation({
  args: {
    matterId: v.id("matters"),
    documentId: v.optional(v.id("matterDocuments")),
    name: v.string(),
    role: v.union(
      v.literal("our_client"),
      v.literal("opposing_party"),
      v.literal("court"),
      v.literal("evidence"),
      v.literal("other"),
    ),
    text: v.string(),
    extraction: v.union(v.literal("text_layer"), v.literal("ocr"), v.literal("manual")),
    pageCount: v.optional(v.number()),
    pages: v.optional(v.array(v.object({ page: v.number(), text: v.string() }))),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "note.write")) {
      throw new Error("You need note-writing permission to prepare AI sources.");
    }
    await requireMatter(ctx, ac, args.matterId);
    if (args.documentId !== undefined) {
      const doc = await ctx.db.get(args.documentId);
      if (!doc || doc.matterId !== args.matterId) {
        throw new Error("That document is not on this matter.");
      }
    }
    const text = args.text.slice(0, MAX_SOURCE_CHARS);
    if (text.trim().length < 20) {
      throw new Error("Extracted text is too short to be useful.");
    }
    const pages = (args.pages ?? [])
      .filter((p) => p.page >= 1 && p.page <= MAX_PAGES)
      .map((p) => ({ page: Math.round(p.page), text: p.text.slice(0, 20_000) }))
      .sort((a, b) => a.page - b.page);

    let documentUpdatedAt: number | undefined;
    if (args.documentId !== undefined) {
      documentUpdatedAt = (await ctx.db.get(args.documentId))?.createdAt;
    }

    const id = await ctx.db.insert("aiSources", {
      orgId: ac.org._id,
      matterId: args.matterId,
      documentId: args.documentId,
      name: args.name.trim().slice(0, 200),
      role: args.role,
      documentUpdatedAt,
      text,
      charCount: text.length,
      pageCount: args.pageCount,
      extraction: args.extraction,
      pages: pages.length ? pages : undefined,
      addedById: ac.user._id,
      createdAt: Date.now(),
    });
    return id;
  },
});

export const removeSource = mutation({
  args: { sourceId: v.id("aiSources") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const row = await ctx.db.get(args.sourceId);
    if (!row || row.orgId !== ac.org._id) throw new Error("Source not found.");
    await requireMatter(ctx, ac, row.matterId);
    await ctx.db.delete(args.sourceId);
  },
});

// ---------------------------------------------------------------------
// Jobs — saved requests with usage limits
// ---------------------------------------------------------------------

export const AI_KINDS = [
  "summary",
  "xray",
  "chronology",
  "issues",
  "hearing_prep",
  "draft",
  "client_comm",
  "grounded_qa",
  "opposition",
  "evidence_map",
  "assertion_review",
  "voice_note",
] as const;

/** Organization tokens used this month (IST month key). */
export const usage = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    const key = monthKeyIST();
    const rows = await ctx.db
      .query("aiJobs")
      .withIndex("by_org_month", (q) => q.eq("orgId", ac.org._id).eq("monthKey", key))
      .collect();
    const tokens =
      rows.reduce((s, r) => s + (r.promptTokens ?? 0) + (r.completionTokens ?? 0), 0);
    return {
      monthKey: key,
      tokens,
      limit: MONTHLY_TOKEN_LIMIT,
      jobs: rows.length,
      remaining: Math.max(0, MONTHLY_TOKEN_LIMIT - tokens),
    };
  },
});

/** Create a pending job (records the request; runner picks it up). */
export const prepareJob = mutation({
  args: {
    matterId: v.id("matters"),
    kind: v.string(),
    sourceIds: v.optional(v.array(v.id("aiSources"))),
    inputNote: v.optional(v.string()),
    transcript: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "note.write")) {
      throw new Error("You need note-writing permission to use AI assistance.");
    }
    await requireMatter(ctx, ac, args.matterId);
    if (!AI_KINDS.includes(args.kind as (typeof AI_KINDS)[number])) {
      throw new Error("Unknown AI request kind.");
    }

    // Usage cap: refuse before spending when the monthly budget is out.
    const key = monthKeyIST();
    const month = await ctx.db
      .query("aiJobs")
      .withIndex("by_org_month", (q) => q.eq("orgId", ac.org._id).eq("monthKey", key))
      .collect();
    const used = month.reduce(
      (s, r) => s + (r.promptTokens ?? 0) + (r.completionTokens ?? 0),
      0,
    );
    if (used >= MONTHLY_TOKEN_LIMIT) {
      throw new Error(
        "The chamber's monthly AI usage allowance is exhausted. It resets next month; ask the firm owner to review usage.",
      );
    }

    const sourceIds = args.sourceIds ?? [];
    if (sourceIds.length > 12) {
      throw new Error("Select at most 12 sources per request.");
    }
    for (const sid of sourceIds) {
      const s = await ctx.db.get(sid);
      if (!s || s.orgId !== ac.org._id || s.matterId !== args.matterId) {
        throw new Error("One of the selected sources is not available on this matter.");
      }
    }

    const id = await ctx.db.insert("aiJobs", {
      orgId: ac.org._id,
      matterId: args.matterId,
      kind: args.kind,
      status: "pending",
      sourceIds: sourceIds.length ? sourceIds : undefined,
      inputNote: args.inputNote?.trim().slice(0, 4000) || undefined,
      transcript: args.transcript?.slice(0, 40_000),
      storageId: args.storageId,
      monthKey: key,
      requestedById: ac.user._id,
      createdAt: Date.now(),
    });
    return id;
  },
});

/** Attach a successful result (internal — called by the Node runner). */
export const attachResult = internalMutation({
  args: {
    jobId: v.id("aiJobs"),
    result: v.string(),
    structured: v.optional(v.any()),
    model: v.string(),
    promptTokens: v.number(),
    completionTokens: v.number(),
    costMinor: v.number(),
    durationMs: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: "done",
      result: args.result.slice(0, 100_000),
      structured: args.structured,
      model: args.model,
      promptTokens: args.promptTokens,
      completionTokens: args.completionTokens,
      costMinor: args.costMinor,
      durationMs: args.durationMs,
      completedAt: Date.now(),
    });
  },
});

/** Attach a failure (internal — called by the Node runner). */
export const attachError = internalMutation({
  args: { jobId: v.id("aiJobs"), error: v.string(), model: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: "failed",
      error: args.error.slice(0, 2000),
      model: args.model,
      completedAt: Date.now(),
    });
  },
});

/** One job with its sources (for the result view). */
export const getJob = query({
  args: { jobId: v.id("aiJobs") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.orgId !== ac.org._id) return null;
    await requireMatter(ctx, ac, job.matterId);
    const sources = await Promise.all(
      (job.sourceIds ?? []).map(async (sid) => {
        const s = await ctx.db.get(sid);
        return s ? { _id: s._id, name: s.name, role: s.role, extraction: s.extraction } : null;
      }),
    );
    const requester = await ctx.db.get(job.requestedById);
    return {
      _id: job._id,
      kind: job.kind,
      status: job.status,
      result: job.result ?? null,
      structured: (job.structured ?? null) as unknown,
      error: job.error ?? null,
      model: job.model ?? null,
      promptTokens: job.promptTokens ?? 0,
      completionTokens: job.completionTokens ?? 0,
      costMinor: job.costMinor ?? 0,
      durationMs: job.durationMs ?? 0,
      transcript: job.transcript ?? null,
      storageId: job.storageId ?? null,
      inputNote: job.inputNote ?? null,
      sources: sources.filter((x): x is NonNullable<typeof x> => x !== null),
      requestedByName: requester?.name ?? requester?.email ?? "Member",
      createdAt: job.createdAt,
      completedAt: job.completedAt ?? null,
    };
  },
});

/** Recent jobs on a matter (history of saved requests/results). */
export const listJobs = query({
  args: { matterId: v.id("matters"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    await requireMatter(ctx, ac, args.matterId);
    const rows = await ctx.db
      .query("aiJobs")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.min(args.limit ?? 30, 100))
      .map((r) => ({
        _id: r._id,
        kind: r.kind,
        status: r.status,
        model: r.model ?? null,
        costMinor: r.costMinor ?? 0,
        promptTokens: r.promptTokens ?? 0,
        completionTokens: r.completionTokens ?? 0,
        hasTranscript: !!r.transcript,
        requestedById: r.requestedById,
        createdAt: r.createdAt,
        completedAt: r.completedAt ?? null,
      }));
  },
});

// ---------------------------------------------------------------------
// Confirmations — AI suggestions stay suggestions until a human acts
// ---------------------------------------------------------------------

/**
 * Mark AI-suggested chronology events as reviewed by a human. Only
 * events on matters the member can access, only aiSuggested ones.
 */
export const confirmEvents = mutation({
  args: { matterId: v.id("matters"), eventIds: v.array(v.id("matterEvents")) },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "note.write")) {
      throw new Error("You need note-writing permission to confirm chronology.");
    }
    await requireMatter(ctx, ac, args.matterId);
    for (const eventId of args.eventIds.slice(0, 100)) {
      const ev = await ctx.db.get(eventId);
      if (!ev || ev.matterId !== args.matterId) continue;
      if (!ev.aiSuggested || ev.reviewed) continue;
      await ctx.db.patch(eventId, { reviewed: true });
    }
  },
});

