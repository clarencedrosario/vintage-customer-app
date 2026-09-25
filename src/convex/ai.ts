import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
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
//  - Suggestions never auto-create deadlines/tasks or send messages;
//    every consequential action requires explicit lawyer approval.
// =====================================================================

// Pending-job timeout: a job still pending after this long is marked
// expired by the daily sweeper (runner crash, deployment restart…).
export const PENDING_TIMEOUT_MS = 30 * 60 * 1000;

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
  // Legal AI contextual modes (Ask My Matter / Ask This Document /
  // Smart Timeline / Document Comparison / AI Morning Briefing).
  "ask_matter",
  "ask_document",
  "smart_timeline",
  "compare",
  "morning_briefing",
] as const;

/**
 * Kinds that assemble their own source set server-side from matter
 * context (the caller's authorized sources on the matter), rather than
 * requiring an explicit selection in the studio. Access is unchanged:
 * only sources already visible on a matter the caller can open are used.
 */
export const AUTO_SOURCE_KINDS: ReadonlySet<string> = new Set([
  "ask_matter",
  "smart_timeline",
  "morning_briefing",
]);

/** The morning briefing reads recent jobs on all of the caller's matters. */
export const MORNING_BRIEFING_MATTER_CAP = 8;
export const MORNING_BRIEFING_SOURCE_CAP = 10;

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
    // Ask This Document: the document being viewed.
    documentId: v.optional(v.id("matterDocuments")),
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

    // Ask This Document: the question is anchored to ONE document. The
    // caller must be able to open the matter; the source must belong to
    // that matter. The runner receives exactly that source.
    if (args.kind === "ask_document") {
      if (!args.documentId) {
        throw new Error("Ask This Document needs the document you are viewing.");
      }
      if (sourceIds.length > 0) {
        throw new Error("Ask This Document uses the document itself; do not select extra sources.");
      }
      const doc = await ctx.db.get(args.documentId);
      if (!doc || doc.matterId !== args.matterId) {
        throw new Error("That document is not on this matter.");
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
      documentId: args.documentId,
      monthKey: key,
      requestedById: ac.user._id,
      createdAt: Date.now(),
    });
    // Deployment-supported execution: the request is saved and the Node
    // runner is scheduled server-side. Failure handling is end-to-end —
    // a claim/timeout marks the job failed/expired for the user to retry.
    await ctx.scheduler.runAfter(0, internal.aiRunner.runJob, {
      jobId: id,
      occurrenceKey: `ai:${id}`,
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

/**
 * Atomically claim a pending job (internal). An occurrence key makes the
 * claim idempotent: if two schedulers race for the same job, only one
 * insert wins, so the model is never called twice.
 */
export const claimPendingJob = internalMutation({
  args: {
    jobId: v.id("aiJobs"),
    occurrenceKey: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "pending") return null;
    const existing = await ctx.db
      .query("aiJobClaims")
      .withIndex("by_occurrence", (q) => q.eq("occurrenceKey", args.occurrenceKey))
      .first();
    if (existing) return null; // already claimed (or retried) — never run twice
    await ctx.db.insert("aiJobClaims", {
      occurrenceKey: args.occurrenceKey,
      jobId: args.jobId,
      claimedAt: Date.now(),
    });
    return {
      kind: job.kind,
      matterId: job.matterId,
      orgId: job.orgId,
      inputNote: job.inputNote ?? null,
      transcript: job.transcript ?? null,
      sourceIds: job.sourceIds ?? [],
    };
  },
});

/** Full job payload for the Node runner (internal, after a claim won). */
export const jobForRunner = internalQuery({
  args: { jobId: v.id("aiJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "pending") return null;
    const sources: Array<{
      name: string;
      role: string;
      text: string;
      pages?: Array<{ page: number; text: string }>;
    }> = [];
    for (const sid of job.sourceIds ?? []) {
      const s = await ctx.db.get(sid);
      if (s) {
        sources.push({ name: s.name, role: s.role, text: s.text, pages: s.pages });
      }
    }
    return {
      kind: job.kind,
      matterId: job.matterId,
      orgId: job.orgId,
      inputNote: job.inputNote ?? null,
      transcript: job.transcript ?? null,
      storageId: job.storageId ?? null,
      sources,
    };
  },
});

/** Persist the Whisper transcript on a voice job (internal). */
export const saveTranscript = internalMutation({
  args: { jobId: v.id("aiJobs"), transcript: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, { transcript: args.transcript.slice(0, 40_000) });
  },
});

/** Tokens already used this month by an org (internal, for the runner). */
export const usageForRunner = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const key = monthKeyIST();
    const rows = await ctx.db
      .query("aiJobs")
      .withIndex("by_org_month", (q) =>
        q.eq("orgId", args.orgId).eq("monthKey", key),
      )
      .collect();
    return rows.reduce(
      (s, r) => s + (r.promptTokens ?? 0) + (r.completionTokens ?? 0),
      0,
    );
  },
});

/** Internal org lookup for the runner (matters of the same org). */
export const orgForRunner = internalQuery({
  args: { jobId: v.id("aiJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    const org = await ctx.db.get(job.orgId);
    if (!org) return null;
    return { name: org.name, currency: org.currency };
  },
});

/**
 * Append AI-suggested chronology events (internal). Every event is
 * stored with aiSuggested: true — it renders as a suggestion and stays
 * out of packs/exports until a lawyer confirms it.
 */
export const appendChronology = internalMutation({
  args: {
    jobId: v.id("aiJobs"),
    events: v.array(
      v.object({
        detail: v.string(),
        occurredAt: v.number(),
        datePrecision: v.union(
          v.literal("exact"),
          v.literal("day"),
          v.literal("approx"),
        ),
        sourceRef: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "pending") return 0;
    for (const e of args.events.slice(0, 40)) {
      await ctx.db.insert("matterEvents", {
        matterId: job.matterId,
        kind: "ai_suggestion",
        detail: e.detail.slice(0, 400),
        createdAt: Date.now(),
        occurredAt: e.occurredAt,
        datePrecision: e.datePrecision,
        sourceRef: e.sourceRef?.slice(0, 200),
        visibility: "internal",
        aiSuggested: true,
        reviewed: false,
      });
    }
    return args.events.length;
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

/** Daily sweeper: expire stale pending jobs whose claim never resolved. */
export const expireStaleJobs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - PENDING_TIMEOUT_MS;
    const stale = await ctx.db
      .query("aiJobs")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    let expired = 0;
    for (const job of stale) {
      if (job.createdAt < cutoff) {
        await ctx.db.patch(job._id, {
          status: "expired",
          error: "The request timed out before the assistant could respond.",
          completedAt: Date.now(),
        });
        expired++;
      }
    }
    return expired;
  },
});

/**
 * Apply AI-suggested evidence rows to a human-framed issue, flagged as
 * AI-suggested. The lawyer reviews and can remove them; nothing lands
 * silently in the evidence map.
 */
export const applyToIssue = mutation({
  args: {
    issueId: v.id("matterIssues"),
    items: v.array(
      v.object({
        label: v.string(),
        supports: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "note.write")) {
      throw new Error("You need note-writing permission to edit the evidence map.");
    }
    const issue = await ctx.db.get(args.issueId);
    if (!issue) throw new Error("Issue not found.");
    await requireMatter(ctx, ac, issue.matterId);
    const evidence = issue.evidence ?? [];
    if (evidence.length + args.items.length > 20) {
      throw new Error("Up to 20 exhibits per issue.");
    }
    await ctx.db.patch(args.issueId, {
      evidence: [
        ...evidence,
        ...args.items.slice(0, 20 - evidence.length).map((i) => ({
          label: `[AI] ${i.label.trim().slice(0, 190)}`,
          documentId: undefined,
          supports: i.supports,
          aiSuggested: true,
        })),
      ],
      updatedAt: Date.now(),
    });
  },
});

/** Remove an AI-suggested evidence row (human correction). */
export const removeEvidenceRow = mutation({
  args: { issueId: v.id("matterIssues"), index: v.number() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "note.write")) {
      throw new Error("You need note-writing permission to edit the evidence map.");
    }
    const issue = await ctx.db.get(args.issueId);
    if (!issue) throw new Error("Issue not found.");
    await requireMatter(ctx, ac, issue.matterId);
    const evidence = [...(issue.evidence ?? [])];
    if (args.index < 0 || args.index >= evidence.length) return;
    if (!evidence[args.index]?.aiSuggested) {
      throw new Error("Only AI-suggested rows can be removed here.");
    }
    evidence.splice(args.index, 1);
    await ctx.db.patch(args.issueId, { evidence, updatedAt: Date.now() });
  },
});

/** Delete an AI-suggested (unreviewed) chronology event the lawyer rejects. */
export const rejectEvent = mutation({
  args: { eventId: v.id("matterEvents") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "note.write")) {
      throw new Error("You need note-writing permission to correct the chronology.");
    }
    const ev = await ctx.db.get(args.eventId);
    if (!ev) throw new Error("Event not found.");
    await requireMatter(ctx, ac, ev.matterId);
    if (!ev.aiSuggested || ev.reviewed) {
      throw new Error("Only unconfirmed AI suggestions can be discarded.");
    }
    await ctx.db.delete(args.eventId);
  },
});

/**
 * Voice-to-workflow: a short-lived upload URL for a post-court voice
 * note. The recording is preserved in storage and transcribed by the
 * runner; nothing consequential (tasks, updates) is saved or sent
 * without explicit lawyer approval (handled in the result view).
 */
export const generateVoiceUploadUrl = mutation({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "note.write")) {
      throw new Error("You need note-writing permission to record voice notes.");
    }
    await requireMatter(ctx, ac, args.matterId);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Live runner configuration for the UI (never exposes the key). */
export const runnerStatus = query({
  args: {},
  handler: async () => {
    return { configured: !!process.env.OPENAI_API_KEY, model: "gpt-4o-mini" };
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

