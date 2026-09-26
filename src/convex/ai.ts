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
// Morning briefing — yesterday's filed inbound emails
//
// Pure helpers so the day-window and digest construction are unit-
// testable without a database. "Yesterday" is the previous IST calendar
// day (the chamber works on IST days, matching the reminder engine).
// ---------------------------------------------------------------------

/**
 * [start, end) epoch-ms window of the IST calendar day `offsetDays`
 * before the day containing `at`. offset 0 = today, 1 = yesterday.
 */
export function istDayWindow(
  at: number,
  offsetDays: number,
): { start: number; end: number } {
  const shifted = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at - offsetDays * 86_400_000);
  // IST is a fixed UTC+5:30 offset — no DST — so the day starts at
  // 00:00 IST == 18:30 UTC of the previous UTC day.
  const start = Date.parse(`${shifted}T00:00:00+05:30`);
  return { start, end: start + 86_400_000 };
}

export const BRIEFING_EMAIL_CAP = 8;
const EMAIL_BODY_CHAR_CAP = 1_500;

/**
 * Build the briefing's email digest from filed-email rows the caller
 * can already see. Rows are given pre-filtered (access decided by the
 * caller's visible matters); this function only formats. Digest is
 * capped: newest first, fixed per-email body cap, so the prompt stays
 * bounded no matter how chatty the inbox was.
 */
export function emailDigestForBriefing(
  rows: Array<{
    messageId: string;
    matterId: string;
    matterReference: string;
    fromAddress: string;
    subject: string;
    receivedAt: number;
    body: string;
  }>,
): string | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => b.receivedAt - a.receivedAt).slice(0, BRIEFING_EMAIL_CAP);
  return sorted
    .map((r, i) => {
      const date = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(r.receivedAt);
      return [
        `[${i + 1}] EMAIL — matter ${r.matterReference}`,
        `From: ${r.fromAddress}`,
        `Received: ${date} IST`,
        `Subject: ${r.subject}`,
        `Body: ${r.body.slice(0, EMAIL_BODY_CHAR_CAP)}${r.body.length > EMAIL_BODY_CHAR_CAP ? "… [truncated]" : ""}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");
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
  // Smart Timeline / Document Comparison / AI Morning Briefing) and
  // section 18 legal research over the chamber's own verified library.
  "ask_matter",
  "ask_document",
  "smart_timeline",
  "compare",
  "morning_briefing",
  "legal_research",
  // Email integration: summarise or draft a reply to an email filed to
  // a matter thread. The filed email is pinned as the single source.
  "email_summary",
  "email_reply",
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
  // Hearing preparation analyses the whole record: case history, orders,
  // evidence, previous hearing notes and deadlines.
  "hearing_prep",
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
    // Email integration: the filed email the job works from.
    emailMessageId: v.optional(v.id("messages")),
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

    // Email AI jobs answer from the exact filed email: the caller passes
    // the email's messageId; the runner pins it as a single labelled
    // source. Access is the thread's matter rule — no separate path.
    let emailBody: string | null = null;
    if (args.kind === "email_summary" || args.kind === "email_reply") {
      if (!args.emailMessageId) {
        throw new Error("This email request needs the filed email to work from.");
      }
      const msg = await ctx.db.get(args.emailMessageId);
      const meta = msg?.emailMeta;
      if (
        !msg ||
        !meta ||
        msg.orgId !== ac.org._id ||
        (msg.conversationId
          ? (
              await ctx.db.get(msg.conversationId)
            )?.matterId !== args.matterId
          : true)
      ) {
        throw new Error("That email is not available on this matter.");
      }
      emailBody = [
        `DIRECTION: ${meta.direction === "inbound" ? "received by the chamber" : "sent by the chamber"}`,
        `FROM: ${meta.fromAddress}`,
        `TO: ${meta.toAddress}`,
        `SUBJECT: ${meta.subject}`,
        `FILED ON: ${new Date(meta.receivedAt).toISOString().slice(0, 10)}`,
        ``,
        msg.body,
      ].join("\n");
    }

    // Ask This Document: the question must be anchored to a document
    // that already has an extracted AI source on this matter (extraction
    // is the explicit act — the studio's Sources tab). The job simply
    // pins THAT source, so the runner answers from exactly one document
    // and the citations name it.
    if (args.kind === "ask_document") {
      if (sourceIds.length !== 1) {
        throw new Error(
          "Ask This Document answers from one document. Add the document to Sources first (Sources tab), then ask.",
        );
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
      // Email jobs: the runner reads the filed email from this id.
      emailMessageId: args.emailMessageId,
      emailBody: emailBody ?? undefined,
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

/**
 * Full job payload for the Node runner (internal, after a claim won).
 *
 * Contextual AI kinds assemble their sources here, server-side, from
 * matter context the requesting lawyer already had access to:
 *  - ask_matter / smart_timeline: the matter's extracted sources
 *    (newest first, capped) — the caller could already open the matter,
 *    and sources only exist where a member with document access made
 *    them, so no new information is exposed.
 *  - morning_briefing: the caller's own matters are resolved in
 *    prepareMorningBriefing and stored as the job's source set.
 * Explicit-selection kinds (studio) pass exactly the selected sources.
 */
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

    if (job.kind === "legal_research" && (job.sourceIds ?? []).length === 0) {
      // FIRM KNOWLEDGE: approved entries only, joined into one clearly
      // labelled source. The prompt forbids treating anything else as
      // retrieved authority.
      const entries = await ctx.db
        .query("knowledgeEntries")
        .withIndex("by_org", (q) => q.eq("orgId", job.orgId))
        .collect();
      const approved = entries
        .filter((e) => e.state === "approved")
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 20);
      const parts: string[] = [];
      for (const e of approved) {
        const versions = await ctx.db
          .query("knowledgeVersions")
          .withIndex("by_entry", (q) => q.eq("entryId", e._id))
          .collect();
        const latest = versions.sort((a, b) => b.version - a.version)[0];
        if (!latest) continue;
        const kindLabel =
          e.kind === "authority" ? "Saved authority"
          : e.kind === "precedent" ? "Precedent"
          : e.kind === "template" ? "Template"
          : "Research note";
        parts.push(
          `[${kindLabel}] ${e.title} (v${latest.version}${latest.sourceRef ? `; ref: ${latest.sourceRef}` : ""}${latest.sourceUrl ? `; url: ${latest.sourceUrl}` : ""})\n${(latest.body ?? "").slice(0, 6_000)}`,
        );
      }
      sources.push({
        name: "FIRM KNOWLEDGE (approved library)",
        role: "other",
        text: parts.join("\n\n---\n\n"),
      });
      // Matter documents add context; without knowledge entries the
      // prompt's strict no-fabrication rules still hold.
      const matterRows = await ctx.db
        .query("aiSources")
        .withIndex("by_matter", (q) => q.eq("matterId", job.matterId))
        .collect();
      matterRows.sort((a, b) => b.createdAt - a.createdAt);
      for (const s of matterRows.slice(0, 6)) {
        sources.push({ name: s.name, role: s.role, text: s.text, pages: s.pages });
      }
    } else if (AUTO_SOURCE_KINDS.has(job.kind) && (job.sourceIds ?? []).length === 0) {
      const rows = await ctx.db
        .query("aiSources")
        .withIndex("by_matter", (q) => q.eq("matterId", job.matterId))
        .collect();
      rows.sort((a, b) => b.createdAt - a.createdAt);
      const cap = job.kind === "morning_briefing" ? MORNING_BRIEFING_SOURCE_CAP : 8;
      for (const s of rows.slice(0, cap)) {
        sources.push({ name: s.name, role: s.role, text: s.text, pages: s.pages });
      }
    } else {
      for (const sid of job.sourceIds ?? []) {
        const s = await ctx.db.get(sid);
        if (s) {
          sources.push({ name: s.name, role: s.role, text: s.text, pages: s.pages });
        }
      }
    }

    // A morning briefing across a chamber's matters is not meaningful if
    // nothing has been extracted yet — the runner fails the job honestly
    // instead of letting the model answer from nothing.
    return {
      kind: job.kind,
      matterId: job.matterId,
      orgId: job.orgId,
      inputNote: job.inputNote ?? null,
      transcript: job.transcript ?? null,
      storageId: job.storageId ?? null,
      // Email jobs: the exact filed email, snapshotted at request time.
      emailBody: job.emailBody ?? null,
      // Morning briefings: yesterday's filed inbound emails, digested.
      emailDigest: job.emailDigest ?? null,
      noSourcesAvailable:
        AUTO_SOURCE_KINDS.has(job.kind) && sources.length === 0,
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
        // Question + a capped answer preview, so matter-level panels (Ask
        // AI About This Matter) can show results without N getJob calls.
        inputNote: r.inputNote ?? null,
        result: r.result ? r.result.slice(0, 4000) : null,
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

/**
 * Legal research (section 18 + the Legal AI spec): the lawyer states a
 * question; the assistant receives the chamber's APPROVED knowledge
 * entries (authorities, precedents, research notes) as "FIRM KNOWLEDGE"
 * sources and matter sources, and is forbidden from inventing anything
 * not retrieved. Anchored to a matter so access and the result live in
 * the matter's AI tab. Knowledge text is joined into ONE synthetic
 * source so the runner's prompt contract stays unchanged.
 */
export const prepareLegalResearch = mutation({
  args: {
    matterId: v.id("matters"),
    question: v.string(),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "note.write")) {
      throw new Error("You need note-writing permission to use AI assistance.");
    }
    await requireMatter(ctx, ac, args.matterId);
    const question = args.question.trim();
    if (!question) throw new Error("State the legal question to research.");

    // Usage cap (same policy as prepareJob).
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

    // Approved firm-knowledge entries only — drafts are never research.
    const entries = await ctx.db
      .query("knowledgeEntries")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const approved = entries
      .filter((e) => e.state === "approved")
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 20);

    // Latest version body per entry.
    const knowledgeParts: string[] = [];
    for (const e of approved) {
      const versions = await ctx.db
        .query("knowledgeVersions")
        .withIndex("by_entry", (q) => q.eq("entryId", e._id))
        .collect();
      const latest = versions.sort((a, b) => b.version - a.version)[0];
      if (!latest) continue;
      const kindLabel =
        e.kind === "authority" ? "Saved authority"
        : e.kind === "precedent" ? "Precedent"
        : e.kind === "template" ? "Template"
        : "Research note";
      knowledgeParts.push(
        `[${kindLabel}] ${e.title} (v${latest.version}${latest.sourceRef ? `; ref: ${latest.sourceRef}` : ""}${latest.sourceUrl ? `; url: ${latest.sourceUrl}` : ""})\n${(latest.body ?? "").slice(0, 6_000)}`,
      );
    }

    const id = await ctx.db.insert("aiJobs", {
      orgId: ac.org._id,
      matterId: args.matterId,
      kind: "legal_research",
      status: "pending",
      inputNote: question.slice(0, 4000),
      monthKey: key,
      requestedById: ac.user._id,
      createdAt: Date.now(),
    });

    // The joined library is stored on the job via sourceIds-less path:
    // the runner reads it from jobForRunner, which assembles the
    // synthetic FIRM KNOWLEDGE source from approved entries.
    await ctx.scheduler.runAfter(0, internal.aiRunner.runJob, {
      jobId: id,
      occurrenceKey: `ai:${id}`,
    });
    return id;
  },
});

/**
 * AI Morning Briefing (one click from the Morning Docket): creates a
 * briefing job on the caller's most recently updated matter that HAS
 * extracted sources. One job per matter keeps every answer grounded,
 * cited and access-checked; the docket links straight to the result.
 * Access: requireAccess first, then the matter is chosen only from
 * matters whose team includes the caller (the shared view rule).
 */
export const prepareMorningBriefing = mutation({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "note.write")) {
      throw new Error("You need note-writing permission to use AI assistance.");
    }

    // Usage cap first (same policy as prepareJob).
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

    // The caller's visible matters, most recently active first.
    const matters = await ctx.db
      .query("matters")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    matters.sort((a, b) => b.updatedAt - a.updatedAt);

    // The same visibility rule decides both the matter sources and the
    // email digest: a team-restricted matter's emails must not leak into
    // a briefing just because the requester has note.write.
    const visibleMatters = matters.filter((matter) => {
      const restricted = matter.restrictedToTeam === true;
      const onTeam =
        matter.leadLawyerId === ac.user._id ||
        (matter.teamIds ?? []).includes(ac.user._id);
      const privileged =
        ac.membership.orgRole === "owner" ||
        ac.membership.orgRole === "partner" ||
        ac.membership.orgRole === "administrator";
      return !restricted || onTeam || privileged;
    });

    // Yesterday's filed inbound emails across those matters (IST day).
    const window = istDayWindow(Date.now(), 1);
    const matterRefById = new Map(
      visibleMatters.map((m) => [m._id as string, m.reference as string]),
    );
    const emailRows: Array<{
      messageId: string;
      matterId: string;
      matterReference: string;
      fromAddress: string;
      subject: string;
      receivedAt: number;
      body: string;
    }> = [];
    const orgConversations = await ctx.db
      .query("conversations")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const convMatter = new Map(
      orgConversations
        .filter((c) => c.matterId !== undefined)
        .map((c) => [c._id as string, c.matterId as string]),
    );
    for (const msg of await ctx.db
      .query("messages")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect()) {
      const meta = msg.emailMeta;
      if (!meta || meta.direction !== "inbound") continue;
      if (meta.receivedAt < window.start || meta.receivedAt >= window.end) continue;
      const matterId = convMatter.get(msg.conversationId as string);
      if (!matterId) continue;
      const matterReference = matterRefById.get(matterId);
      if (!matterReference) continue; // matter not visible to the caller
      emailRows.push({
        messageId: msg._id as string,
        matterId,
        matterReference,
        fromAddress: meta.fromAddress,
        subject: meta.subject,
        receivedAt: meta.receivedAt,
        body: msg.body,
      });
    }
    const emailDigest = emailDigestForBriefing(emailRows);

    for (const matter of visibleMatters.slice(0, MORNING_BRIEFING_MATTER_CAP)) {
      // The same pure team/role rule every module uses (cross-tenant is
      // impossible here — matters came from this org's index — but a
      // team-restricted matter must not leak into the briefing).
      const restricted = matter.restrictedToTeam === true;
      const onTeam =
        matter.leadLawyerId === ac.user._id ||
        (matter.teamIds ?? []).includes(ac.user._id);
      const privileged =
        ac.membership.orgRole === "owner" ||
        ac.membership.orgRole === "partner" ||
        ac.membership.orgRole === "administrator";
      if (restricted && !onTeam && !privileged) continue;

      const src = await ctx.db
        .query("aiSources")
        .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
        .first();
      if (!src) continue; // nothing extracted on this matter yet

      const jobId = await ctx.db.insert("aiJobs", {
        orgId: ac.org._id,
        matterId: matter._id,
        kind: "morning_briefing",
        status: "pending",
        // Yesterday's filed inbound emails across the caller's visible
        // matters, snapshotted at request time (IST day window).
        emailDigest: emailDigest ?? undefined,
        monthKey: key,
        requestedById: ac.user._id,
        createdAt: Date.now(),
      });
      await ctx.scheduler.runAfter(0, internal.aiRunner.runJob, {
        jobId,
        occurrenceKey: `ai:${jobId}`,
      });
      return { jobId, matterId: matter._id };
    }
    return null;
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

