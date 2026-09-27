// =====================================================================
// FEATURE 10 — CJ GLOBAL: platform operations (section 25).
//
// Customer support tickets, platform-owner triage, and the AI-to-human
// escalation path from Advokate AI conversations to human operators.
//
// Access model (consistent with section 24's platform administration):
//  - SUBMIT/REPLY: any authenticated, non-anonymous user from any portal
//    (client, staff, chamber console). Tickets are about the platform —
//    no special capability required.
//  - TRIAGE/RESOLVE/CLOSE: platform operators only (users.isPlatformAdmin,
//    the same gate as the section-24 console), every action audited in
//    platformOpsAudit.
//  - VISIBILITY: only the ticket's submitter and platform operators can
//    read a ticket. Never chamber-wide, never cross-customer.
//  - NO LEGAL RECORD EXPOSURE: a ticket carries its own subject/body and
//    an optional AI-job reference. Operators never see matter files here;
//    tenant-record support access remains the exceptionalAccess flow.
// =====================================================================
import { v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { getCurrentUser } from "./users";
import { getAccessContext } from "./access";
import type { Doc, Id } from "./_generated/dataModel";
import {
  TICKET_PRIORITIES,
  TICKET_KINDS,
} from "./schemaExtras";
import {
  mergeHandoffSnapshotChange,
  rebuildHandoffRow,
  handoffCountersMatch,
  type HandoffTicketSnapshot,
} from "./handoffView";

type TicketStatus = "open" | "in_progress" | "resolved" | "closed";

const TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ["in_progress", "resolved", "closed"],
  in_progress: ["resolved", "closed", "open"],
  resolved: ["closed", "open"], // reopen
  closed: ["open"], // reopen re-opens the queue item
};

export function canTransitionTicket(from: TicketStatus, to: TicketStatus): boolean {
  return TICKET_TRANSITIONS[from]?.includes(to) ?? false;
}

const MAX_SUBJECT = 200;
const MAX_BODY = 8000;
const MAX_MESSAGE = 4000;

// Explicit rebuild scan limits (see rebuildAiHandoffStats).
export const REBUILD_MAX_TICKETS = 5_000;
export const REBUILD_MAX_ORGS = 500;

// ---------------------------------------------------------------------
// Identity + operator gate
// ---------------------------------------------------------------------

async function actorOf(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users"> | null> {
  const user = await getCurrentUser(ctx as QueryCtx);
  if (!user || user.isAnonymous) return null;
  return user;
}

async function requireOperator(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  const user = await actorOf(ctx);
  if (!user || !user.isPlatformAdmin) {
    throw new Error("Platform operator access required.");
  }
  return user;
}

async function auditOps(
  ctx: MutationCtx,
  actor: Doc<"users">,
  action: string,
  ticketId: Id<"supportTickets"> | undefined,
  detail?: string,
) {
  await ctx.db.insert("platformOpsAudit", {
    actorId: actor._id,
    actorName: actor.name ?? actor.email ?? actor._id.slice(-6),
    action,
    ticketId,
    detail: detail?.slice(0, 500),
    createdAt: Date.now(),
  });
}

async function ticketOrThrow(
  ctx: QueryCtx | MutationCtx,
  ticketId: Id<"supportTickets">,
): Promise<Doc<"supportTickets">> {
  const t = await ctx.db.get(ticketId);
  if (!t) throw new Error("Ticket not found.");
  return t;
}

// ---------------------------------------------------------------------
// AI-handoff materialized view (write-maintained)
//
// Every mutator below calls bumpHandoffView IN THE SAME TRANSACTION as
// its ticket write, so the view row can never lag a ticket write. Pure
// delta rules live in handoffView.ts (snapshot in, snapshot out — one
// rule covers create/claim/priority/resolve/close/reopen). orgId may be
// undefined on legacy tickets — those are skipped (they cannot be
// attributed to a chamber) and the audited rebuild is the correction
// path.
// ---------------------------------------------------------------------

function handoffSnapshotOf(
  ticket: Pick<
    Doc<"supportTickets">,
    "orgId" | "kind" | "status" | "priority" | "assignedToId"
  >,
): HandoffTicketSnapshot {
  return {
    kind: ticket.kind,
    orgId: ticket.orgId ?? undefined,
    status: ticket.status,
    priority: ticket.priority,
    assignedToId: ticket.assignedToId ?? null,
  };
}

async function bumpHandoffView(
  ctx: MutationCtx,
  before: HandoffTicketSnapshot | null,
  after: HandoffTicketSnapshot,
  at: number,
): Promise<void> {
  // Only AI-escalation tickets with a chamber belong in the view.
  if (after.kind !== "ai_escalation" || !after.orgId) return;
  const existing = await ctx.db
    .query("aiHandoffStats")
    .withIndex("by_org", (q) => q.eq("orgId", after.orgId as never))
    .unique();
  const next = mergeHandoffSnapshotChange(
    existing
      ? {
          orgId: existing.orgId,
          openCount: existing.openCount,
          unclaimedCount: existing.unclaimedCount,
          highPriorityCount: existing.highPriorityCount,
          lastHandoffAt: existing.lastHandoffAt ?? null,
          lastResolvedAt: existing.lastResolvedAt ?? null,
          updatedAt: existing.updatedAt,
        }
      : null,
    before,
    after,
    at,
  );
  const row = {
    openCount: next.openCount,
    unclaimedCount: next.unclaimedCount,
    highPriorityCount: next.highPriorityCount,
    lastHandoffAt: next.lastHandoffAt ?? undefined,
    lastResolvedAt: next.lastResolvedAt ?? undefined,
    updatedAt: next.updatedAt,
  };
  if (existing) {
    await ctx.db.patch(existing._id, row);
  } else {
    await ctx.db.insert("aiHandoffStats", { orgId: after.orgId as never, ...row });
  }
}

/** Submitter or platform operator — the only readers of a ticket. */
export function canSeeTicket(
  user: Pick<Doc<"users">, "_id" | "isPlatformAdmin">,
  ticket: Doc<"supportTickets">,
): boolean {
  return user._id === ticket.submittedById || !!user.isPlatformAdmin;
}

// ---------------------------------------------------------------------
// Ticket creation — any authenticated user
// ---------------------------------------------------------------------

export const submitTicket = mutation({
  args: {
    subject: v.string(),
    body: v.string(),
    kind: v.union(...TICKET_KINDS.map((k) => v.literal(k))),
    priority: v.optional(
      v.union(...TICKET_PRIORITIES.map((p) => v.literal(p))),
    ),
    // Optional org context; verified against the caller's membership.
    orgId: v.optional(v.id("organizations")),
    // AI escalation provenance (set only by escalateFromAiJob).
    escalatedFromAiJobId: v.optional(v.id("aiJobs")),
  },
  handler: async (ctx, args) => {
    const user = await actorOf(ctx);
    if (!user) throw new Error("Sign in to raise a support ticket.");

    const subject = args.subject.trim();
    const body = args.body.trim();
    if (subject.length < 4) {
      throw new Error("Subject must be at least 4 characters.");
    }
    if (body.length < 10) {
      throw new Error("Describe the issue in at least 10 characters.");
    }

    // Org context: only an org the caller is an ACTIVE member of can be
    // attached. Otherwise the ticket is simply personal.
    let orgId: Id<"organizations"> | undefined;
    if (args.orgId) {
      const ac = await getAccessContext(ctx, args.orgId);
      if (ac) orgId = args.orgId;
    }

    const now = Date.now();
    const ticketId = await ctx.db.insert("supportTickets", {
      orgId,
      submittedById: user._id,
      submittedByName: user.name ?? undefined,
      submittedByEmail: user.email ?? undefined,
      kind: args.kind,
      priority: args.priority ?? "normal",
      status: "open",
      subject: subject.slice(0, MAX_SUBJECT),
      body: body.slice(0, MAX_BODY),
      escalatedFromAiJobId: args.escalatedFromAiJobId,
      reopenCount: 0,
      lastActivityAt: now,
      createdAt: now,
    });

    // Opening message preserves the original report verbatim.
    await ctx.db.insert("supportTicketMessages", {
      ticketId,
      authorId: user._id,
      authorType: "customer",
      authorName: user.name ?? undefined,
      body: body.slice(0, MAX_BODY),
      createdAt: now,
    });

    // Mat-view bump, same transaction as the ticket insert.
    await bumpHandoffView(
      ctx,
      null,
      handoffSnapshotOf(await ctx.db.get(ticketId) as Doc<"supportTickets">),
      now,
    );

    return ticketId;
  },
});

// ---------------------------------------------------------------------
// AI-to-human escalation (feature 10)
// ---------------------------------------------------------------------

/**
 * Escalate an AI conversation to a human operator. The caller must be
 * able to see the AI job (active member of the job's org — the same rule
 * ai.request enforces); the escalation is recorded on the ticket for
 * operator context. The AI job's contents are never copied into the
 * ticket — only the reference and the user's own description.
 */
export const escalateFromAiJob = mutation({
  args: {
    jobId: v.id("aiJobs"),
    subject: v.string(),
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await actorOf(ctx);
    if (!user) throw new Error("Sign in to escalate to human support.");

    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("AI request not found.");

    const ac = await getAccessContext(ctx, job.orgId);
    if (!ac) {
      throw new Error("You do not have access to this AI request.");
    }

    const subject = args.subject.trim();
    if (subject.length < 4) {
      throw new Error("Subject must be at least 4 characters.");
    }
    const description = args.description.trim();
    if (description.length < 10) {
      throw new Error(
        "Describe what went wrong in at least 10 characters so a human can pick this up.",
      );
    }

    const now = Date.now();
    const ticketId = await ctx.db.insert("supportTickets", {
      orgId: job.orgId,
      submittedById: user._id,
      submittedByName: user.name ?? undefined,
      submittedByEmail: user.email ?? undefined,
      kind: "ai_escalation",
      priority: "high", // an explicit human handoff starts high
      status: "open",
      subject: `[AI handoff] ${subject}`.slice(0, MAX_SUBJECT),
      body: description.slice(0, MAX_BODY),
      escalatedFromAiJobId: args.jobId,
      reopenCount: 0,
      lastActivityAt: now,
      createdAt: now,
    });

    await ctx.db.insert("supportTicketMessages", {
      ticketId,
      authorId: user._id,
      authorType: "customer",
      authorName: user.name ?? undefined,
      body: description.slice(0, 2000),
      createdAt: now,
    });

    // Mat-view bump, same transaction as the handoff insert.
    await bumpHandoffView(
      ctx,
      null,
      handoffSnapshotOf(await ctx.db.get(ticketId) as Doc<"supportTickets">),
      now,
    );

    return { ticketId };
  },
});

// ---------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------

/** The signed-in customer's own tickets (any portal). */
export const myTickets = query({
  args: {},
  handler: async (ctx) => {
    const user = await actorOf(ctx);
    if (!user) return [];
    return ctx.db
      .query("supportTickets")
      .withIndex("by_submitter", (q) => q.eq("submittedById", user._id))
      .order("desc")
      .take(100);
  },
});

/**
 * Operator queue: all non-closed tickets, newest activity first.
 * Platform operators only.
 */
export const operatorQueue = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const [open, inProgress, resolved] = await Promise.all([
      ctx.db
        .query("supportTickets")
        .withIndex("by_status", (q) => q.eq("status", "open"))
        .collect(),
      ctx.db
        .query("supportTickets")
        .withIndex("by_status", (q) => q.eq("status", "in_progress"))
        .collect(),
      ctx.db
        .query("supportTickets")
        .withIndex("by_status", (q) => q.eq("status", "resolved"))
        .collect(),
    ]);
    // Closed tickets are deliberately NOT listed — the queue is for live
    // work; closed history rides the audit trail and the submitter's list.
    return [...open, ...inProgress, ...resolved].sort(
      (a, b) => b.lastActivityAt - a.lastActivityAt,
    );
  },
});

/** Full ticket detail: submitter or operator only. */
export const getTicket = query({
  args: { ticketId: v.id("supportTickets") },
  handler: async (ctx, args) => {
    const user = await actorOf(ctx);
    if (!user) return null;
    const ticket = await ctx.db.get(args.ticketId);
    if (!ticket || !canSeeTicket(user, ticket)) return null;
    const messages = await ctx.db
      .query("supportTicketMessages")
      .withIndex("by_ticket", (q) => q.eq("ticketId", args.ticketId))
      .collect();
    messages.sort((a, b) => a.createdAt - b.createdAt);
    return { ticket, messages };
  },
});

/** Operator overview counts for the /owner console (operators only). */
export const opsCounts = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const all = await ctx.db.query("supportTickets").collect();
    const byStatus = { open: 0, in_progress: 0, resolved: 0, closed: 0 };
    let unassigned = 0;
    let aiEscalationsOpen = 0;
    let awaitingFirstResponse = 0;
    const now = Date.now();
    for (const t of all) {
      byStatus[t.status] += 1;
      const live = t.status === "open" || t.status === "in_progress";
      if (!t.assignedToId && live) unassigned += 1;
      if (t.kind === "ai_escalation" && live) aiEscalationsOpen += 1;
      // >24h without a first operator response = breaching the SLA signal.
      if (!t.firstResponseAt && live && now - t.createdAt > 24 * 3600_000) {
        awaitingFirstResponse += 1;
      }
    }
    return {
      byStatus,
      unassigned,
      aiEscalationsOpen,
      awaitingFirstResponse,
      total: all.length,
    };
  },
});

// ---------------------------------------------------------------------
// Customer actions
// ---------------------------------------------------------------------

/** The submitter may add messages; a reply on resolved/closed re-opens. */
export const addCustomerMessage = mutation({
  args: { ticketId: v.id("supportTickets"), body: v.string() },
  handler: async (ctx, args) => {
    const user = await actorOf(ctx);
    if (!user) throw new Error("Sign in required.");
    const ticket = await ticketOrThrow(ctx, args.ticketId);
    if (!canSeeTicket(user, ticket)) {
      throw new Error("You do not have access to this ticket.");
    }
    if (user._id !== ticket.submittedById) {
      throw new Error("Only the ticket submitter can post customer messages.");
    }
    const body = args.body.trim();
    if (!body) throw new Error("Message cannot be empty.");

    const now = Date.now();
    await ctx.db.insert("supportTicketMessages", {
      ticketId: args.ticketId,
      authorId: user._id,
      authorType: "customer",
      authorName: user.name ?? undefined,
      body: body.slice(0, MAX_MESSAGE),
      createdAt: now,
    });
    // A customer reply on a resolved/closed ticket re-opens it.
    if (
      (ticket.status === "resolved" || ticket.status === "closed") &&
      canTransitionTicket(ticket.status, "open")
    ) {
      await ctx.db.patch(ticket._id, {
        status: "open",
        reopenCount: (ticket.reopenCount ?? 0) + 1,
        lastActivityAt: now,
      });
      await auditOps(ctx, user, "ticket.reopen_by_customer", ticket._id);
      // View: reopened tickets re-enter the open counters.
      await bumpHandoffView(ctx, handoffSnapshotOf(ticket), { ...handoffSnapshotOf(ticket), status: "open" }, now);
      return { reopened: true };
    }
    await ctx.db.patch(ticket._id, { lastActivityAt: now });
    return { reopened: false };
  },
});

// ---------------------------------------------------------------------
// Operator actions (all audited)
// ---------------------------------------------------------------------

/** Acknowledge + claim a ticket (open → in_progress, assigned to self). */
export const startProgress = mutation({
  args: { ticketId: v.id("supportTickets"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const ticket = await ticketOrThrow(ctx, args.ticketId);
    if (ticket.status !== "open") {
      throw new Error("Only open tickets can move to in progress.");
    }
    const now = Date.now();
    await ctx.db.patch(ticket._id, {
      status: "in_progress",
      assignedToId: operator._id,
      assignedToName: operator.name ?? operator.email ?? undefined,
      assignedAt: now,
      lastActivityAt: now,
    });
    if (args.note?.trim()) {
      await ctx.db.insert("supportTicketMessages", {
        ticketId: ticket._id,
        authorId: operator._id,
        authorType: "operator",
        authorName: operator.name ?? operator.email ?? undefined,
        body: args.note.trim().slice(0, MAX_MESSAGE),
        createdAt: now,
      });
    }
    await auditOps(ctx, operator, "ticket.start", ticket._id);
    // View: claim moves the ticket from unclaimed to claimed (still open).
    await bumpHandoffView(
      ctx,
      handoffSnapshotOf(ticket),
      { ...handoffSnapshotOf(ticket), status: "in_progress", assignedToId: operator._id },
      now,
    );
  },
});

/** Operator reply. First operator response stamps firstResponseAt. */
export const addOperatorMessage = mutation({
  args: { ticketId: v.id("supportTickets"), body: v.string() },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const ticket = await ticketOrThrow(ctx, args.ticketId);
    if (ticket.status === "closed") {
      throw new Error("Reopen the ticket before replying.");
    }
    const body = args.body.trim();
    if (!body) throw new Error("Message cannot be empty.");
    const now = Date.now();
    await ctx.db.insert("supportTicketMessages", {
      ticketId: ticket._id,
      authorId: operator._id,
      authorType: "operator",
      authorName: operator.name ?? operator.email ?? undefined,
      body: body.slice(0, MAX_MESSAGE),
      createdAt: now,
    });
    const patch: { firstResponseAt?: number; lastActivityAt: number } = {
      lastActivityAt: now,
    };
    if (!ticket.firstResponseAt) patch.firstResponseAt = now;
    await ctx.db.patch(ticket._id, patch);
    await auditOps(ctx, operator, "ticket.reply", ticket._id);
  },
});

/** Claim/assign to self (also moves open → in_progress). */
export const assignTicket = mutation({
  args: { ticketId: v.id("supportTickets") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const ticket = await ticketOrThrow(ctx, args.ticketId);
    const now = Date.now();
    const nextStatus = ticket.status === "open" ? "in_progress" : ticket.status;
    await ctx.db.patch(ticket._id, {
      assignedToId: operator._id,
      assignedToName: operator.name ?? operator.email ?? undefined,
      assignedAt: now,
      status: nextStatus,
      lastActivityAt: now,
    });
    await auditOps(ctx, operator, "ticket.assign", ticket._id);
    // View: assignment (and any open→in_progress move) is one snapshot step.
    await bumpHandoffView(
      ctx,
      handoffSnapshotOf(ticket),
      { ...handoffSnapshotOf(ticket), status: nextStatus, assignedToId: operator._id },
      now,
    );
  },
});

/** Priority change (operator only). */
export const setTicketPriority = mutation({
  args: {
    ticketId: v.id("supportTickets"),
    priority: v.union(...TICKET_PRIORITIES.map((p) => v.literal(p))),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const ticket = await ticketOrThrow(ctx, args.ticketId);
    await ctx.db.patch(ticket._id, {
      priority: args.priority,
      lastActivityAt: Date.now(),
    });
    await auditOps(ctx, operator, "ticket.priority", ticket._id, args.priority);
    // View: priority changes move the high-priority counter while open.
    await bumpHandoffView(
      ctx,
      handoffSnapshotOf(ticket),
      { ...handoffSnapshotOf(ticket), priority: args.priority },
      Date.now(),
    );
  },
});

/** Resolve with a mandatory note (what was actually done). */
export const resolveTicket = mutation({
  args: { ticketId: v.id("supportTickets"), note: v.string() },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const ticket = await ticketOrThrow(ctx, args.ticketId);
    if (!canTransitionTicket(ticket.status, "resolved")) {
      throw new Error(`A ${ticket.status} ticket cannot be resolved.`);
    }
    const note = args.note.trim();
    if (note.length < 10) {
      throw new Error(
        "A resolution note of at least 10 characters is required.",
      );
    }
    const now = Date.now();
    await ctx.db.insert("supportTicketMessages", {
      ticketId: ticket._id,
      authorId: operator._id,
      authorType: "operator",
      authorName: operator.name ?? operator.email ?? undefined,
      body: note.slice(0, MAX_MESSAGE),
      createdAt: now,
    });
    await ctx.db.patch(ticket._id, {
      status: "resolved",
      resolvedAt: now,
      resolvedById: operator._id,
      resolutionNote: note.slice(0, 1000),
      lastActivityAt: now,
    });
    await auditOps(ctx, operator, "ticket.resolve", ticket._id);
    // View: leaving the open set; lastResolvedAt advances (forward-only).
    await bumpHandoffView(
      ctx,
      handoffSnapshotOf(ticket),
      { ...handoffSnapshotOf(ticket), status: "resolved" },
      now,
    );
  },
});

/** Close a resolved ticket (operators only). */
export const closeTicket = mutation({
  args: { ticketId: v.id("supportTickets") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const ticket = await ticketOrThrow(ctx, args.ticketId);
    if (ticket.status !== "resolved") {
      throw new Error("Only resolved tickets can be closed.");
    }
    const now = Date.now();
    await ctx.db.patch(ticket._id, {
      status: "closed",
      closedAt: now,
      closedById: operator._id,
      lastActivityAt: now,
    });
    await auditOps(ctx, operator, "ticket.close", ticket._id);
    // View: closed is also outside the open set (resolved→closed is a
    // counter no-op — both states are non-open — but the snapshot model
    // handles it uniformly).
    await bumpHandoffView(
      ctx,
      handoffSnapshotOf(ticket),
      { ...handoffSnapshotOf(ticket), status: "closed" },
      now,
    );
  },
});

/** Operator-initiated reopen (customer reopen happens via reply). */
export const reopenTicket = mutation({
  args: { ticketId: v.id("supportTickets"), reason: v.string() },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const ticket = await ticketOrThrow(ctx, args.ticketId);
    if (ticket.status !== "resolved" && ticket.status !== "closed") {
      throw new Error("Only resolved or closed tickets can be reopened.");
    }
    const reason = args.reason.trim();
    if (reason.length < 4) throw new Error("A reason is required to reopen.");
    const now = Date.now();
    await ctx.db.patch(ticket._id, {
      status: "open",
      reopenCount: (ticket.reopenCount ?? 0) + 1,
      lastActivityAt: now,
    });
    await ctx.db.insert("supportTicketMessages", {
      ticketId: ticket._id,
      authorId: operator._id,
      authorType: "operator",
      authorName: operator.name ?? operator.email ?? undefined,
      body: `[Reopened] ${reason.slice(0, MAX_MESSAGE)}`,
      createdAt: now,
    });
    await auditOps(ctx, operator, "ticket.reopen", ticket._id, reason);
    // View: reopened tickets re-enter the open counters.
    await bumpHandoffView(
      ctx,
      handoffSnapshotOf(ticket),
      { ...handoffSnapshotOf(ticket), status: "open" },
      now,
    );
  },
});

// ---------------------------------------------------------------------
// Audit feed for the console
// ---------------------------------------------------------------------

export const opsAudit = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    return ctx.db
      .query("platformOpsAudit")
      .withIndex("by_time", (q) => q.gte("createdAt", 0))
      .order("desc")
      .take(Math.min(args.limit ?? 50, 200));
  },
});

// ---------------------------------------------------------------------
// AI-handoff view: reads + audited rebuild
// ---------------------------------------------------------------------

/**
 * Operator read of the mat view: one row per chamber that has live AI
 * handoff counters, joined with the chamber name for display.
 */
export const handoffViewRows = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const rows = await ctx.db.query("aiHandoffStats").collect();
    const withNames = await Promise.all(
      rows.map(async (r) => {
        const org = await ctx.db.get(r.orgId);
        return {
          orgId: r.orgId,
          orgName: org?.name ?? "(deleted chamber)",
          openCount: r.openCount,
          unclaimedCount: r.unclaimedCount,
          highPriorityCount: r.highPriorityCount,
          lastHandoffAt: r.lastHandoffAt ?? null,
          lastResolvedAt: r.lastResolvedAt ?? null,
          updatedAt: r.updatedAt,
        };
      }),
    );
    return withNames.sort((a, b) => b.openCount - a.openCount || a.orgName.localeCompare(b.orgName));
  },
});

/**
 * Chamber-scoped read for the escalation UI: the caller's own chamber's
 * open AI-handoff counters (or nulls when the chamber has none). This is
 * what the AI Studio escalation dialog surfaces before submitting.
 */
export const myChamberHandoffStats = query({
  args: {},
  handler: async (ctx) => {
    const user = await actorOf(ctx);
    if (!user) return null;
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const row = await ctx.db
      .query("aiHandoffStats")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .unique();
    return {
      openCount: row?.openCount ?? 0,
      unclaimedCount: row?.unclaimedCount ?? 0,
      highPriorityCount: row?.highPriorityCount ?? 0,
      lastResolvedAt: row?.lastResolvedAt ?? null,
    };
  },
});

/**
 * Audited self-heal: recompute EVERY chamber's view row from the base
 * supportTickets table and write back rows whose counters drifted. The
 * result reports checked/updated/chamber list; every correction is one
 * ops-audit row. Normal operation never needs this — every mutator bumps
 * the view in-transaction — but the rebuild makes drift detectable and
 * correctable instead of trusted-away.
 */
export const rebuildAiHandoffStats = mutation({
  args: {},
  handler: async (ctx) => {
    const operator = await requireOperator(ctx);

    // Explicit scan limits: a rebuild reads at most REBUILD_MAX_TICKETS
    // tickets across at most REBUILD_MAX_ORGS chambers. Volume is operator-
    // bounded in practice, but the limits are enforced rather than assumed —
    // breaching them aborts the rebuild with an explicit error (the view
    // stays at its last maintained state; a data-import bump to the limits
    // is a deliberate code change, never a silent truncate).
    const all = await ctx.db.query("supportTickets").collect();
    if (all.length > REBUILD_MAX_TICKETS) {
      throw new Error(
        `Rebuild aborted: ${all.length} tickets exceeds the ${REBUILD_MAX_TICKETS}-ticket scan limit. Raise REBUILD_MAX_TICKETS deliberately.`,
      );
    }
    const byOrg = new Map<string, typeof all>();
    for (const t of all) {
      if (t.kind !== "ai_escalation" || !t.orgId) continue;
      const list = byOrg.get(t.orgId) ?? [];
      list.push(t);
      byOrg.set(t.orgId, list);
    }
    if (byOrg.size > REBUILD_MAX_ORGS) {
      throw new Error(
        `Rebuild aborted: ${byOrg.size} chambers exceeds the ${REBUILD_MAX_ORGS}-chamber scan limit. Raise REBUILD_MAX_ORGS deliberately.`,
      );
    }

    const now = Date.now();
    const updated: string[] = [];
    for (const [orgId, tickets] of byOrg) {
      const rebuilt = rebuildHandoffRow(
        orgId,
        tickets.map((t) => ({
          status: t.status,
          priority: t.priority,
          assignedToId: t.assignedToId ?? null,
          createdAt: t.createdAt,
          resolvedAt: t.resolvedAt ?? null,
        })),
        now,
      );
      const existing = await ctx.db
        .query("aiHandoffStats")
        .withIndex("by_org", (q) => q.eq("orgId", orgId as never))
        .unique();
      const drifted = !existing || !handoffCountersMatch(existing, rebuilt);
      if (!drifted) continue;
      const row = {
        openCount: rebuilt.openCount,
        unclaimedCount: rebuilt.unclaimedCount,
        highPriorityCount: rebuilt.highPriorityCount,
        lastHandoffAt: rebuilt.lastHandoffAt ?? undefined,
        lastResolvedAt: rebuilt.lastResolvedAt ?? undefined,
        updatedAt: now,
      };
      if (existing) {
        await ctx.db.patch(existing._id, row);
      } else {
        await ctx.db.insert("aiHandoffStats", { orgId: orgId as never, ...row });
      }
      updated.push(orgId);
    }

    await auditOps(
      ctx,
      operator,
      "handoff_view.rebuild",
      undefined,
      `${byOrg.size} chamber(s) checked, ${updated.length} row(s) corrected`,
    );
    return { checked: byOrg.size, corrected: updated.length };
  },
});
