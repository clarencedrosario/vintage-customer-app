import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  requireAccess,
  requireCapability,
  requireMatter,
  requireWriteAccess,
  type AccessContext,
} from "./access";
import { refreshNextHearing } from "./matters";
import {
  buildOutcomeProposals,
  istDayEndUtcMs,
  type ProposedItem,
} from "../lib/outcomeProposals";

// ---------------------------------------------------------------------
// Feature 2 — Hearing outcome → proposal workflow (server).
//
// recordOutcome proposes; the lawyer approves. Generation is idempotent
// per hearing (deterministic keys, stored once). Approval is per item
// or in bulk, by an authorized lawyer. Rejected items are kept for
// audit. Deadlines carry source + rule, require explicit approval, and
// never silently overwrite an existing open deadline. Client updates
// become drafts that only the existing approval gate can clear.
// ---------------------------------------------------------------------

const MAX_TEXT = 4000;

// ---------------- Shared helpers ----------------

async function findByKey(
  ctx: { db: unknown },
  orgId: Id<"organizations">,
  key: string,
): Promise<Doc<"outcomeProposals"> | null> {
  const rows = await (ctx.db as QueryDb)
    .query("outcomeProposals")
    .withIndex("by_key", (q: { eq: (f: "key", v: string) => unknown }) =>
      q.eq("key", key),
    )
    .collect();
  return rows.find((r) => r.orgId === orgId) ?? null;
}

type QueryDb = {
  query(t: "outcomeProposals"): {
    withIndex(
      name: "by_key",
      fn: (q: { eq: (f: "key", v: string) => unknown }) => unknown,
    ): { collect(): Promise<Doc<"outcomeProposals">[]> };
  };
};

function proposalKeyString(
  hearingId: string,
  kind: string,
  label: string,
): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${hearingId}:${kind}:${slug}`;
}

/** IST YYYY-MM-DD from a UTC ms timestamp (the project's +05:30 rule). */
function istDateFromDueAt(ms: number): string {
  const p = new Date(ms + 330 * 60 * 1000).toISOString();
  return `${p.slice(0, 4)}-${p.slice(5, 7)}-${p.slice(8, 10)}`;
}

async function logEventLocal(
  ctx: { db: { insert(t: "matterEvents", d: unknown): Promise<unknown> } },
  matterId: Id<"matters">,
  kind: string,
  detail: string,
) {
  await ctx.db.insert("matterEvents", {
    matterId,
    kind,
    detail,
    createdAt: Date.now(),
  });
}

type AuditCtx = {
  db: {
    insert(
      t: "auditLog",
      d: {
        orgId: Id<"organizations">;
        matterId: Id<"matters">;
        actorId: Id<"users">;
        actorName: string;
        action: string;
        detail?: string;
        createdAt: number;
      },
    ): Promise<unknown>;
  };
};

async function auditLocal(
  ctx: AuditCtx,
  ac: AccessContext,
  matterId: Id<"matters">,
  action: string,
  detail?: string,
) {
  await ctx.db.insert("auditLog", {
    orgId: ac.org._id,
    matterId,
    actorId: ac.user._id,
    actorName: ac.user.name ?? ac.user.email ?? "Member",
    action,
    detail,
    createdAt: Date.now(),
  });
}

/** The effective payload: editedPayload when the lawyer edited it. */
function effectivePayload(row: Doc<"outcomeProposals">): Record<string, unknown> {
  return (row.editedPayload ?? row.payload) as Record<string, unknown>;
}

// ---------------- Queries ----------------

/** Review list: every proposal on a hearing with its decision state. */
export const listForHearing = query({
  args: { hearingId: v.id("hearings") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const hearing = await ctx.db.get(args.hearingId);
    if (!hearing) return null;
    await requireMatter(ctx, ac, hearing.matterId);
    return serializeRows(
      await ctx.db
        .query("outcomeProposals")
        .withIndex("by_hearing", (q) => q.eq("hearingId", args.hearingId))
        .collect(),
    );
  },
});

/**
 * Review desk list for a matter: all proposals across its hearings,
 * access-checked (org + matter-level team restriction) and sorted
 * oldest first so a hearing's set reads together.
 */
export const listForMatter = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    await requireMatter(ctx, ac, args.matterId);
    return serializeRows(
      await ctx.db
        .query("outcomeProposals")
        .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
        .collect(),
    );
  },
});

/** Shared shape for both review lists (no confidential payload in the row). */
function serializeRows(rows: Doc<"outcomeProposals">[]) {
  return rows
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((r) => ({
      _id: r._id,
      hearingId: r.hearingId,
      key: r.key,
      kind: r.kind,
      title: r.title,
      payload: r.payload as Record<string, unknown>,
      status: r.status,
      deadlineSource: r.deadlineSource,
      deadlineRule: r.deadlineRule,
      decisionNote: r.decisionNote,
      resultId: r.resultId,
      decidedAt: r.decidedAt,
      edited: r.editedPayload !== undefined,
      createdAt: r.createdAt,
    }));
}

// ---------------- Generation (idempotent) ----------------

export const proposeOutcomeActions = mutation({
  args: {
    hearingId: v.id("hearings"),
    status: v.union(v.literal("held"), v.literal("adjourned")),
    outcome: v.string(),
    attendance: v.optional(
      v.union(
        v.literal("appeared"),
        v.literal("represented"),
        v.literal("adjourned_absent"),
      ),
    ),
    appearances: v.optional(v.string()),
    directions: v.optional(v.array(v.string())),
    nextAction: v.optional(v.string()),
    nextHearing: v.optional(
      v.object({
        title: v.string(),
        at: v.number(),
        purpose: v.optional(v.string()),
      }),
    ),
    deadlines: v.optional(
      v.array(
        v.object({
          title: v.string(),
          category: v.union(
            v.literal("limitation"),
            v.literal("filing"),
            v.literal("compliance"),
            v.literal("court_order"),
            v.literal("custom"),
          ),
          dueAt: v.number(),
          source: v.string(),
          rule: v.string(),
        }),
      ),
    ),
    internalNotes: v.optional(v.string()),
    clientSummary: v.optional(v.string()),
    requiredDocuments: v.optional(v.array(v.string())),
    updateNextPack: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const ac = await requireWriteAccess(ctx);
    requireCapability(ac, "hearing.manage");
    const hearing = await ctx.db.get(args.hearingId);
    if (!hearing) throw new Error("Hearing not found.");
    await requireMatter(ctx, ac, hearing.matterId);
    if (!args.outcome.trim()) throw new Error("Record what happened.");

    const now = Date.now();

    // Record the outcome on the hearing itself (first capture wins —
    // a retry regenerates proposals but never rewrites the record).
    if (!hearing.outcomeRecordedAt) {
      await ctx.db.patch(args.hearingId, {
        status: args.status,
        outcome: args.outcome.trim().slice(0, MAX_TEXT),
        nextAction: args.nextAction?.trim() || undefined,
        outcomeRecordedBy: ac.user._id,
        outcomeRecordedAt: now,
        requiredDocuments: args.requiredDocuments?.length
          ? args.requiredDocuments
              .map((d) => d.trim().slice(0, 200))
              .filter(Boolean)
              .slice(0, 12)
          : hearing.requiredDocuments,
        notes: args.internalNotes?.trim()
          ? [hearing.notes, args.internalNotes.trim().slice(0, MAX_TEXT)]
              .filter(Boolean)
              .join("\n\n")
          : hearing.notes,
      });
      await refreshNextHearing(ctx, hearing.matterId);
      await logEventLocal(
        ctx,
        hearing.matterId,
        "hearing",
        `Hearing ${args.status} — ${args.outcome.trim().slice(0, 160)}`,
      );
      await auditLocal(ctx, ac, hearing.matterId, "Hearing outcome recorded", hearing.title);
    }

    // Next hearing: captured directly (it already happened on the
    // record — its proposal row is an approved audit marker).
    if (
      args.nextHearing &&
      args.nextHearing.title.trim() &&
      args.nextHearing.at > now
    ) {
      const nhKey = proposalKeyString(
        args.hearingId,
        "next_hearing",
        args.nextHearing.title,
      );
      const marker = await findByKey(ctx, ac.org._id, nhKey);
      if (!marker) {
        const nextHearingId = await ctx.db.insert("hearings", {
          matterId: hearing.matterId,
          title: args.nextHearing.title.trim().slice(0, 200),
          court: hearing.court,
          at: args.nextHearing.at,
          purpose: args.nextHearing.purpose?.trim() || undefined,
          status: "scheduled",
          createdAt: now,
        });
        await ctx.db.insert("outcomeProposals", {
          orgId: ac.org._id,
          matterId: hearing.matterId,
          hearingId: args.hearingId,
          key: nhKey,
          kind: "next_hearing",
          title: args.nextHearing.title.trim().slice(0, 200),
          payload: {
            matterId: hearing.matterId,
            title: args.nextHearing.title.trim(),
            at: args.nextHearing.at,
          },
          status: "approved",
          proposedById: ac.user._id,
          createdAt: now,
          decidedAt: now,
          decidedById: ac.user._id,
          decisionNote: "Scheduled directly at outcome time.",
          resultId: nextHearingId,
        });
        await refreshNextHearing(ctx, hearing.matterId);
        await logEventLocal(
          ctx,
          hearing.matterId,
          "hearing",
          `Next hearing scheduled — ${args.nextHearing.title.trim()}.`,
        );
      }
    }

    // Build the proposal set and store only keys not already recorded.
    const proposals = buildOutcomeProposals({
      hearingId: args.hearingId,
      hearingTitle: hearing.title,
      matterId: hearing.matterId,
      orgTimezone: ac.org.timezone,
      status: args.status,
      outcomeText: args.outcome,
      attendance: args.attendance,
      appearances: args.appearances,
      directions: args.directions,
      nextAction: args.nextAction,
      nextHearing: args.nextHearing
        ? {
            title: args.nextHearing.title,
            atIso: new Date(args.nextHearing.at).toISOString(),
            purpose: args.nextHearing.purpose,
          }
        : undefined,
      deadlines: (args.deadlines ?? []).map((d) => ({
        title: d.title,
        category: d.category,
        date: istDateFromDueAt(d.dueAt),
        source: d.source,
        rule: d.rule,
      })),
      internalNotes: args.internalNotes,
      clientSummary: args.clientSummary,
      requiredDocuments: args.requiredDocuments,
      updateNextPack: args.updateNextPack,
      hearingDateIN: istDateFromDueAt(now),
    });

    let stored = 0;
    for (const p of proposals) {
      if (await findByKey(ctx, ac.org._id, p.key)) continue; // idempotent retry
      await ctx.db.insert("outcomeProposals", {
        orgId: ac.org._id,
        matterId: hearing.matterId,
        hearingId: args.hearingId,
        key: p.key,
        kind: p.kind,
        title: p.title,
        payload: p.payload,
        status: "pending",
        deadlineSource: p.kind === "deadline" ? (p.payload.source as string) : undefined,
        deadlineRule: p.kind === "deadline" ? (p.payload.rule as string) : undefined,
        proposedById: ac.user._id,
        createdAt: now,
      });
      stored += 1;
    }

    return { proposed: proposals.length, stored };
  },
});

// ---------------- Approval / rejection ----------------

/**
 * Approve one proposal, materializing its record. Permissions by kind:
 * chronology/tasks/client updates need `hearing.manage`; DEADLINES and
 * next hearings additionally need `order.record` (critical dates are
 * lawyer decisions). An edited payload may be supplied in the same call.
 */
export const approveProposal = mutation({
  args: {
    proposalId: v.id("outcomeProposals"),
    editedPayload: v.optional(v.any()),
    decisionNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireWriteAccess(ctx);
    requireCapability(ac, "hearing.manage");
    const row = await ctx.db.get(args.proposalId);
    if (!row || row.orgId !== ac.org._id) {
      throw new Error("Proposal not found in your organization.");
    }
    if (row.status !== "pending") {
      throw new Error(`This proposal was already ${row.status}.`);
    }
    await requireMatter(ctx, ac, row.matterId);

    // Critical-date kinds need the lawyer's order capability.
    if (row.kind === "deadline" || row.kind === "next_hearing") {
      requireCapability(ac, "order.record");
    }
    const payload = (args.editedPayload ?? row.payload) as Record<string, unknown>;

    let resultId: string | undefined;
    switch (row.kind) {
      case "chronology": {
        await ctx.db.insert("matterEvents", {
          matterId: row.matterId,
          kind: "hearing",
          detail: String(payload.detail ?? "").slice(0, MAX_TEXT),
          createdAt: Date.now(),
          authorId: ac.user._id,
          occurredAt: typeof payload.occurredAt === "number" ? payload.occurredAt : undefined,
          datePrecision: "day",
          sourceRef: typeof payload.sourceRef === "string" ? payload.sourceRef : undefined,
          linkKind: "hearing",
          linkId: typeof payload.linkId === "string" ? payload.linkId : undefined,
          visibility: "internal",
        });
        break;
      }
      case "task": {
        resultId = await ctx.db.insert("tasks", {
          matterId: row.matterId,
          orgId: ac.org._id,
          title: String(payload.title ?? row.title).slice(0, 200),
          kind: (payload.kind as "general" | "filing") ?? "general",
          priority: (payload.priority as "normal" | "high" | "urgent") ?? "high",
          dueAt: typeof payload.dueAt === "number" ? payload.dueAt : undefined,
          status: "pending",
          assigneeId: ac.user._id,
          createdById: ac.user._id,
          createdAt: Date.now(),
        });
        break;
      }
      case "deadline": {
        const title = String(payload.title ?? row.title).slice(0, 200);
        const dueAt = typeof payload.dueAt === "number" ? payload.dueAt : Date.now();
        // Never silently overwrite an existing OPEN deadline with the
        // same title on this matter: refuse and let the lawyer decide.
        const open = await ctx.db
          .query("deadlines")
          .withIndex("by_matter", (q) => q.eq("matterId", row.matterId))
          .collect();
        const clash = open.find(
          (d) => d.status === "open" && d.title === title,
        );
        if (clash && clash.dueAt !== dueAt) {
          throw new Error(
            `An open deadline "${title}" already exists with a different date (${istDateFromDueAt(clash.dueAt)}). Review it on the matter — existing deadlines are never silently overwritten.`,
          );
        }
        if (clash) {
          // Same title, same date: record the duplicate and skip.
          await auditLocal(ctx, ac, row.matterId, "Deadline proposal approved (duplicate skipped)", title);
          resultId = clash._id;
          break;
        }
        resultId = await ctx.db.insert("deadlines", {
          orgId: ac.org._id,
          matterId: row.matterId,
          title,
          category: (payload.category as "filing" | "compliance" | "limitation" | "court_order" | "custom") ?? "court_order",
          dueAt,
          status: "open",
          createdById: ac.user._id,
          history: [
            {
              at: Date.now(),
              byId: ac.user._id,
              text: `Created from hearing outcome. Source: ${row.deadlineSource ?? "—"}; rule: ${row.deadlineRule ?? "—"}.`,
            },
          ],
          createdAt: Date.now(),
        });
        break;
      }
      case "client_update": {
        // Drafts only — the existing approval gate sends it to the client.
        const draftId = await ctx.db.insert("drafts", {
          orgId: ac.org._id,
          matterId: row.matterId,
          title: String(payload.title ?? row.title).slice(0, 200),
          kind: "client_update",
          currentVersion: 1,
          status: "drafted",
          createdById: ac.user._id,
          updatedAt: Date.now(),
          createdAt: Date.now(),
        });
        await ctx.db.insert("draftVersions", {
          draftId,
          version: 1,
          body: String(payload.body ?? "").slice(0, 20000),
          status: "drafted",
          authorId: ac.user._id,
          createdAt: Date.now(),
        });
        resultId = draftId;
        break;
      }
      case "next_hearing": {
        // Approving a next-hearing proposal creates the hearing row.
        const at = typeof payload.at === "number" ? payload.at : 0;
        if (at <= Date.now()) throw new Error("Next hearing must be in the future.");
        resultId = await ctx.db.insert("hearings", {
          matterId: row.matterId,
          title: String(payload.title ?? row.title).slice(0, 200),
          at,
          purpose: typeof payload.purpose === "string" ? payload.purpose : undefined,
          status: "scheduled",
          createdAt: Date.now(),
        });
        await refreshNextHearing(ctx, row.matterId);
        break;
      }
      case "hearing_pack": {
        // A flag proposal: approval is the instruction to open the pack
        // builder; the next hearing id (if scheduled) helps preselect.
        resultId = undefined;
        break;
      }
    }

    await ctx.db.patch(args.proposalId, {
      status: "approved",
      decidedAt: Date.now(),
      decidedById: ac.user._id,
      decisionNote: args.decisionNote?.trim().slice(0, 500) || undefined,
      resultId,
      editedPayload: args.editedPayload,
    });
    await auditLocal(
      ctx,
      ac,
      row.matterId,
      `Outcome proposal approved (${row.kind})`,
      row.title,
    );
    return { ok: true, kind: row.kind, resultId };
  },
});

/**
 * Clear bulk approval: approve every pending proposal on the hearing in
 * one call. Safe under retries — already-decided rows are skipped, not
 * re-materialized. Returns a per-kind summary for the UI toast.
 */
export const approveAllForHearing = mutation({
  args: { hearingId: v.id("hearings") },
  handler: async (ctx, args) => {
    const ac = await requireWriteAccess(ctx);
    requireCapability(ac, "hearing.manage");
    const hearing = await ctx.db.get(args.hearingId);
    if (!hearing) throw new Error("Hearing not found.");
    await requireMatter(ctx, ac, hearing.matterId);

    // Deadline/next-hearing kinds additionally need order.record; refuse
    // the bulk action entirely if the caller lacks it (no partial state).
    const pending = (
      await ctx.db
        .query("outcomeProposals")
        .withIndex("by_hearing", (q) => q.eq("hearingId", args.hearingId))
        .collect()
    ).filter((r) => r.status === "pending");
    if (pending.length === 0) return { approved: 0, skipped: 0 };
    if (
      pending.some((r) => r.kind === "deadline" || r.kind === "next_hearing") &&
      !ac.permissions.has("order.record")
    )
      { throw new Error("Approving this set requires the record-orders permission for its deadline items."); }

    let approved = 0;
    let skipped = 0;
    for (const row of pending) {
      const res = await materializeAndMark(ctx, ac, row, {});
      if (res === "ok") approved += 1;
      else skipped += 1;
    }
    return { approved, skipped };
  },
});

/** Reject one pending proposal — kept for audit with the reason. */
export const rejectProposal = mutation({
  args: { proposalId: v.id("outcomeProposals"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ac = await requireWriteAccess(ctx);
    requireCapability(ac, "hearing.manage");
    const row = await ctx.db.get(args.proposalId);
    if (!row || row.orgId !== ac.org._id) {
      throw new Error("Proposal not found in your organization.");
    }
    if (row.status !== "pending") throw new Error(`Already ${row.status}.`);
    await requireMatter(ctx, ac, row.matterId);
    await ctx.db.patch(row._id, {
      status: "rejected",
      decidedAt: Date.now(),
      decidedById: ac.user._id,
      decisionNote: args.note?.trim().slice(0, 500) || undefined,
    });
    await auditLocal(ctx, ac, row.matterId, `Outcome proposal rejected (${row.kind})`, row.title);
    return { ok: true };
  },
});

/**
 * Shared materialization used by single and bulk approval. Verifies the
 * same permission gates as approveProposal (defense-in-depth on bulk),
 * creates the record for the row's kind, and marks the row approved.
 * Throws on kind-specific refusals (e.g. deadline clash); bulk callers
 * treat a throw as "skipped" while single-approval surfaces the error.
 */
async function materializeAndMark(
  ctx: MutationCtx,
  ac: AccessContext,
  row: Doc<"outcomeProposals">,
  opts: { editedPayload?: Record<string, unknown>; decisionNote?: string },
): Promise<"ok" | "skipped"> {
  if (row.status !== "pending") return "skipped";
  if (row.kind === "deadline" || row.kind === "next_hearing") {
    requireCapability(ac, "order.record");
  }
  const payload = (opts.editedPayload ?? row.payload) as Record<string, unknown>;
  let resultId: string | undefined;

  switch (row.kind) {
    case "chronology": {
      await ctx.db.insert("matterEvents", {
        matterId: row.matterId,
        kind: "hearing",
        detail: String(payload.detail ?? "").slice(0, 4000),
        createdAt: Date.now(),
        authorId: ac.user._id,
        occurredAt: typeof payload.occurredAt === "number" ? payload.occurredAt : undefined,
        datePrecision: "day",
        sourceRef: typeof payload.sourceRef === "string" ? payload.sourceRef : undefined,
        linkKind: "hearing",
        linkId: typeof payload.linkId === "string" ? payload.linkId : undefined,
        visibility: "internal",
      });
      break;
    }
    case "task": {
      resultId = await ctx.db.insert("tasks", {
        matterId: row.matterId,
        orgId: ac.org._id,
        title: String(payload.title ?? row.title).slice(0, 200),
        kind: (payload.kind as "general" | "filing" | "service" | "delivery" | "collection") ?? "general",
        priority: (payload.priority as "normal" | "high" | "urgent") ?? "high",
        dueAt: typeof payload.dueAt === "number" ? payload.dueAt : undefined,
        status: "pending",
        assigneeId: ac.user._id,
        createdById: ac.user._id,
        createdAt: Date.now(),
      });
      break;
    }
    case "deadline": {
      const title = String(payload.title ?? row.title).slice(0, 200);
      const dueAt = typeof payload.dueAt === "number" ? payload.dueAt : Date.now();
      // Never silently overwrite an existing OPEN deadline with the same
      // title: refuse (single approval) or skip-with-audit (bulk).
      const matterDeadlines: Doc<"deadlines">[] = await ctx.db
        .query("deadlines")
        .withIndex("by_matter", (q) => q.eq("matterId", row.matterId))
        .collect();
      const clash = matterDeadlines.find(
        (d) => d.status === "open" && d.title === title,
      );
      if (clash && clash.dueAt !== dueAt) {
        throw new Error(
          `An open deadline "${title}" already exists with a different date (${istDateFromDueAt(clash.dueAt)}). Existing deadlines are never silently overwritten — review it on the matter.`,
        );
      }
      if (clash) {
        await auditLocal(ctx, ac, row.matterId, "Deadline proposal approved (identical deadline already open)", title);
        resultId = clash._id;
        break;
      }
      resultId = await ctx.db.insert("deadlines", {
        orgId: ac.org._id,
        matterId: row.matterId,
        title,
        category: (payload.category as "filing" | "compliance" | "limitation" | "court_order" | "custom") ?? "court_order",
        dueAt,
        status: "open",
        createdById: ac.user._id,
        history: [
          {
            at: Date.now(),
            byId: ac.user._id,
            text: `Created from hearing outcome. Source: ${row.deadlineSource ?? "—"}; rule: ${row.deadlineRule ?? "—"}.`,
          },
        ],
        createdAt: Date.now(),
      });
      break;
    }
    case "client_update": {
      const draftId = await ctx.db.insert("drafts", {
        orgId: ac.org._id,
        matterId: row.matterId,
        title: String(payload.title ?? row.title).slice(0, 200),
        kind: "client_update",
        currentVersion: 1,
        status: "drafted",
        createdById: ac.user._id,
        updatedAt: Date.now(),
        createdAt: Date.now(),
      });
      await ctx.db.insert("draftVersions", {
        draftId,
        version: 1,
        body: String(payload.body ?? "").slice(0, 20000),
        status: "drafted",
        authorId: ac.user._id,
        createdAt: Date.now(),
      });
      resultId = draftId;
      break;
    }
    case "next_hearing": {
      const at = typeof payload.at === "number" ? payload.at : 0;
      if (at <= Date.now()) throw new Error("Next hearing must be in the future.");
      resultId = await ctx.db.insert("hearings", {
        matterId: row.matterId,
        title: String(payload.title ?? row.title).slice(0, 200),
        at,
        purpose: typeof payload.purpose === "string" ? payload.purpose : undefined,
        status: "scheduled",
        createdAt: Date.now(),
      });
      await refreshNextHearing(ctx, row.matterId);
      break;
    }
    case "hearing_pack": {
      resultId = undefined; // instruction to open the pack builder preselected
      break;
    }
  }

  await ctx.db.patch(row._id, {
    status: "approved",
    decidedAt: Date.now(),
    decidedById: ac.user._id,
    decisionNote: opts.decisionNote?.trim().slice(0, 500) || undefined,
    resultId,
    editedPayload: opts.editedPayload,
  });
  await auditLocal(ctx, ac, row.matterId, `Outcome proposal approved (${row.kind})`, row.title);
  return "ok";
}

