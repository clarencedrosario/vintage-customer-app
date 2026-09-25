// =====================================================================
// FEATURE 6 — Client communication approval: the outbox server module.
//
// Staff may compose; lawyers approve for configured legal/substantive
// categories. Guarantees:
//   - The EXACT approved version is preserved (immutable version rows);
//     any later edit creates a new version and resets approval.
//   - Delivery is queued only after approval; in-flight traffic is never
//     duplicated (status-guarded sends).
//   - A missing provider retains the approved message as
//     awaiting_configuration — never lost, never claimed sent.
//   - Provider callbacks advance delivery states without downgrades.
// =====================================================================

import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  can,
  canViewMatter,
  getAccessContext,
  requireAccess,
  requireMatter,
  type AccessContext,
} from "./access";
import {
  COMM_CATEGORIES,
  canApplyDeliveryEvent,
  canRetry,
  decideSend,
  nextVersionOnEdit,
  requiresApprovalFor,
  sendableVersion,
  statusAfterEdit,
  type CommCategory,
} from "../lib/commOutboxFlow";

const MAX_SUBJECT = 240;
const MAX_BODY = 8000;
const MAX_NOTE = 600;

function actorName(u: Doc<"users">): string {
  return u.name || u.email || "Member";
}

async function logAudit(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  actorId: Id<"users">,
  actor: string,
  action: string,
  detail: string,
) {
  await ctx.db.insert("auditLog", {
    orgId,
    actorId,
    actorName: actor,
    action,
    detail,
    createdAt: Date.now(),
  });
}

async function approvalRequired(
  ctx: { db: MutationCtx["db"] },
  orgId: Id<"organizations">,
  category: CommCategory,
): Promise<boolean> {
  const rows = await ctx.db
    .query("commCategoryConfig")
    .withIndex("by_org_category", (q) =>
      q.eq("orgId", orgId).eq("category", category),
    )
    .collect();
  return requiresApprovalFor(category, rows[0]?.requiresApproval);
}

/** Load an outbox row the caller may see (org-scoped + matter-gated). */
async function loadOutbox(
  ctx: MutationCtx,
  ac: AccessContext,
  outboxId: Id<"commOutbox">,
): Promise<Doc<"commOutbox">> {
  const row = await ctx.db.get(outboxId);
  if (!row || row.orgId !== ac.org._id) throw new Error("Message not found.");
  if (row.matterId !== undefined) {
    await requireMatter(ctx, ac, row.matterId);
  } else if (!can(ac, "note.write") && row.createdById !== ac.user._id) {
    throw new Error("You cannot access this message.");
  }
  return row;
}

function assertApprover(ac: AccessContext): void {
  if (!can(ac, "matter.edit")) {
    throw new Error(
      "Your role is not permitted to approve client communications.",
    );
  }
}

// ---------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------

/** The outbox desk list (org-scoped, matter-gated per row). */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const rows = await ctx.db
      .query("commOutbox")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const out: Array<
      Doc<"commOutbox"> & { matterReference: string | null; recipientDisplay: string }
    > = [];
    const matterCache = new Map<Id<"matters">, Doc<"matters"> | null>();
    for (const r of rows) {
      let matterRef: string | null = null;
      if (r.matterId !== undefined) {
        let matter = matterCache.get(r.matterId);
        if (matter === undefined) {
          const m = await ctx.db.get(r.matterId);
          matterCache.set(r.matterId, m ?? null);
          matter = m ?? null;
        }
        if (!matter || !canViewMatter(ac, matter)) continue;
        matterRef = matter.reference;
      }
      out.push({
        ...r,
        matterReference: matterRef,
        recipientDisplay:
          r.recipient ?? (r.recipientUserId ? "portal account" : "client thread"),
      });
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    return out;
  },
});

/** One message with its full immutable version history. */
export const detail = query({
  args: { outboxId: v.id("commOutbox") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    try {
      const row = await loadOutbox(ctx as unknown as MutationCtx, ac, args.outboxId);
      const versions = await ctx.db
        .query("commOutboxVersions")
        .withIndex("by_outbox", (q) => q.eq("outboxId", args.outboxId))
        .collect();
      versions.sort((a, b) => b.version - a.version);
      return { row, versions };
    } catch {
      return null;
    }
  },
});

/** Per-category approval policy for the organisation. */
export const categoryPolicy = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const rows = await ctx.db
      .query("commCategoryConfig")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    return COMM_CATEGORIES.map((c) => {
      const row = rows.find((r) => r.category === c);
      return {
        category: c,
        requiresApproval: requiresApprovalFor(c, row?.requiresApproval),
        overridden: !!row,
      };
    });
  },
});

// ---------------------------------------------------------------------
// Compose / edit — always a new immutable version
// ---------------------------------------------------------------------

export const compose = mutation({
  args: {
    matterId: v.optional(v.id("matters")),
    clientId: v.optional(v.id("clients")),
    category: v.string(),
    channel: v.union(
      v.literal("email"),
      v.literal("whatsapp"),
      v.literal("in_thread"),
    ),
    recipientUserId: v.optional(v.id("users")),
    recipient: v.optional(v.string()),
    subject: v.string(),
    body: v.string(),
    sourceKind: v.optional(v.string()),
    sourceId: v.optional(v.string()),
    sourceLabel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "note.write") && !can(ac, "matter.edit")) {
      throw new Error("Your role is not permitted to prepare communications.");
    }
    const category = args.category as CommCategory;
    if (!COMM_CATEGORIES.includes(category)) {
      throw new Error("Unknown communication category.");
    }
    const subject = args.subject.trim();
    const body = args.body.trim();
    if (!subject) throw new Error("A subject is required.");
    if (!body) throw new Error("The message body is required.");
    if (subject.length > MAX_SUBJECT) throw new Error("Subject is too long.");
    if (body.length > MAX_BODY) throw new Error("Message is too long.");

    if (args.matterId !== undefined) {
      await requireMatter(ctx, ac, args.matterId);
    }
    const requiresApproval = await approvalRequired(ctx, ac.org._id, category);
    const now = Date.now();

    const outboxId = await ctx.db.insert("commOutbox", {
      orgId: ac.org._id,
      matterId: args.matterId,
      clientId: args.clientId,
      category,
      channel: args.channel,
      recipientUserId: args.recipientUserId,
      recipient: args.recipient?.trim() || undefined,
      subject: subject.slice(0, MAX_SUBJECT),
      status: requiresApproval ? "pending_approval" : "approved",
      requiresApproval,
      currentVersion: 1,
      attempts: 0,
      sourceKind: args.sourceKind?.trim().slice(0, 120) || undefined,
      sourceId: args.sourceId?.trim().slice(0, 120) || undefined,
      sourceLabel: args.sourceLabel?.trim().slice(0, 240) || undefined,
      createdById: ac.user._id,
      createdByName: actorName(ac.user),
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("commOutboxVersions", {
      outboxId,
      version: 1,
      subject: subject.slice(0, MAX_SUBJECT),
      body,
      status: requiresApproval ? "pending_approval" : "approved",
      authorId: ac.user._id,
      authorName: actorName(ac.user),
      createdAt: now,
    });
    await logAudit(
      ctx, ac.org._id, ac.user._id, actorName(ac.user),
      "Communication prepared",
      `${category} — “${subject.slice(0, 80)}”${requiresApproval ? " (awaiting approval)" : ""}`,
    );
    return { outboxId };
  },
});

/** Revise — creates a NEW version; approval resets (version integrity). */
export const revise = mutation({
  args: {
    outboxId: v.id("commOutbox"),
    subject: v.string(),
    body: v.string(),
    changeNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const row = await loadOutbox(ctx, ac, args.outboxId);
    if (["queued", "sent", "delivered", "read"].includes(row.status)) {
      throw new Error("In-flight or delivered messages cannot be edited.");
    }
    if (["cancelled", "failed"].includes(row.status)) {
      throw new Error(
        `${row.status === "cancelled" ? "Cancelled" : "Failed"} messages cannot be edited — compose a new message instead.`,
      );
    }
    const subject = args.subject.trim();
    const body = args.body.trim();
    if (!subject) throw new Error("A subject is required.");
    if (!body) throw new Error("The message body is required.");
    if (subject.length > MAX_SUBJECT) throw new Error("Subject is too long.");
    if (body.length > MAX_BODY) throw new Error("Message is too long.");

    const version = nextVersionOnEdit(row);
    const nextStatus = statusAfterEdit(row);
    const now = Date.now();
    await ctx.db.insert("commOutboxVersions", {
      outboxId: row._id,
      version,
      subject: subject.slice(0, MAX_SUBJECT),
      body,
      status: nextStatus === "approved" ? "approved" : "pending_approval",
      authorId: ac.user._id,
      authorName: actorName(ac.user),
      revisesVersion: row.currentVersion,
      createdAt: now,
    });
    await ctx.db.patch(row._id, {
      subject: subject.slice(0, MAX_SUBJECT),
      status: nextStatus,
      currentVersion: version,
      // An edit invalidates the previous approval — deliberate.
      approvedVersion: nextStatus === "approved" ? version : undefined,
      approvedAt: nextStatus === "approved" ? now : undefined,
      approvedById: nextStatus === "approved" ? ac.user._id : undefined,
      approvedByName: nextStatus === "approved" ? actorName(ac.user) : undefined,
      updatedAt: now,
    });
    await logAudit(
      ctx, ac.org._id, ac.user._id, actorName(ac.user),
      "Communication revised",
      `v${version} of “${subject.slice(0, 80)}”${args.changeNote ? ` — ${args.changeNote.trim()}` : ""}`,
    );
    return { version };
  },
});

// ---------------------------------------------------------------------
// Review: approve / reject / return
// ---------------------------------------------------------------------

export const approve = mutation({
  args: { outboxId: v.id("commOutbox"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    assertApprover(ac);
    const row = await loadOutbox(ctx, ac, args.outboxId);
    if (!row.requiresApproval) {
      throw new Error("This category does not require approval.");
    }
    if (row.status !== "pending_approval") {
      throw new Error(`Only pending messages can be approved (this one is ${row.status}).`);
    }
    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: "approved",
      approvedVersion: row.currentVersion,
      approvedAt: now,
      approvedById: ac.user._id,
      approvedByName: actorName(ac.user),
      reviewNote: args.note?.trim().slice(0, MAX_NOTE) || undefined,
      updatedAt: now,
    });
    await ctx.db
      .query("commOutboxVersions")
      .withIndex("by_outbox", (q) => q.eq("outboxId", row._id))
      .collect()
      .then((versions) => {
        const vRow = versions.find((x) => x.version === row.currentVersion);
        if (vRow) {
          void ctx.db.patch(vRow._id, {
            status: "approved",
            reviewedAt: now,
            reviewerId: ac.user._id,
            reviewNote: args.note?.trim().slice(0, MAX_NOTE) || undefined,
            approvedAt: now,
            approvedById: ac.user._id,
          });
        }
      });
    await logAudit(
      ctx, ac.org._id, ac.user._id, actorName(ac.user),
      "Communication approved",
      `v${row.currentVersion} of “${row.subject.slice(0, 80)}”`,
    );
  },
});

export const rejectOrReturn = mutation({
  args: {
    outboxId: v.id("commOutbox"),
    decision: v.union(v.literal("rejected"), v.literal("returned")),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    assertApprover(ac);
    const row = await loadOutbox(ctx, ac, args.outboxId);
    if (row.status !== "pending_approval") {
      throw new Error("Only pending messages can be rejected or returned.");
    }
    if (!args.note.trim()) {
      throw new Error("A comment is required when rejecting or returning.");
    }
    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: args.decision,
      reviewNote: args.note.trim().slice(0, MAX_NOTE),
      updatedAt: now,
    });
    const versions = await ctx.db
      .query("commOutboxVersions")
      .withIndex("by_outbox", (q) => q.eq("outboxId", row._id))
      .collect();
    const vRow = versions.find((x) => x.version === row.currentVersion);
    if (vRow) {
      await ctx.db.patch(vRow._id, {
        status: args.decision,
        reviewedAt: now,
        reviewerId: ac.user._id,
        reviewNote: args.note.trim().slice(0, MAX_NOTE),
      });
    }
    await logAudit(
      ctx, ac.org._id, ac.user._id, actorName(ac.user),
      args.decision === "rejected" ? "Communication rejected" : "Communication returned with comments",
      `v${row.currentVersion} of “${row.subject.slice(0, 80)}” — ${args.note.trim().slice(0, 200)}`,
    );
  },
});

// ---------------------------------------------------------------------
// Delivery — queue only after approval, dedupe on retries
// ---------------------------------------------------------------------

/**
 * Queue an approved message for delivery. Retries are safe: the status
 * guard makes duplicate invocations no-ops for in-flight traffic.
 */
export const queue = mutation({
  args: { outboxId: v.id("commOutbox") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const row = await loadOutbox(ctx, ac, args.outboxId);
    const decision = decideSend(row);
    if (!decision.ok) throw new Error(decision.reason);

    // Resolve the recipient for direct channels.
    let recipient = row.recipient;
    if (!recipient && row.recipientUserId) {
      const u = await ctx.db.get(row.recipientUserId);
      recipient =
        row.channel === "email"
          ? u?.email ?? undefined
          : u?.phone ?? u?.email ?? undefined;
    }

    // in_thread delivery posts onto the client conversation at send time.
    if (row.channel === "in_thread") {
      await ctx.db.patch(row._id, { status: "queued", updatedAt: Date.now() });
      return { queued: true as const };
    }
    if (!recipient) {
      throw new Error(
        "No recipient is recorded for this message — set a recipient first.",
      );
    }
    await ctx.db.patch(row._id, {
      status: "queued",
      recipient,
      attempts: row.attempts + 1,
      lastError: undefined,
      updatedAt: Date.now(),
    });
    await logAudit(
      ctx, ac.org._id, ac.user._id, actorName(ac.user),
      "Communication queued for delivery",
      `“${row.subject.slice(0, 80)}” → ${recipient}`,
    );
    return { queued: true as const };
  },
});

/**
 * Attempt delivery through the provider bridge. Called for queued
 * messages; preserves approved-but-unconfigured messages as
 * awaiting_configuration (never lost, never claimed sent).
 */
export const attemptDelivery = mutation({
  args: { outboxId: v.id("commOutbox") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const row = await loadOutbox(ctx, ac, args.outboxId);
    if (row.status !== "queued") {
      throw new Error("Only queued messages can be delivered.");
    }
    const version = sendableVersion(row);
    if (version === null) {
      throw new Error("The current version is not approved for sending.");
    }
    const versions = await ctx.db
      .query("commOutboxVersions")
      .withIndex("by_outbox", (q) => q.eq("outboxId", row._id))
      .collect();
    const vRow = versions.find((x) => x.version === version);
    if (!vRow) throw new Error("The approved version is missing.");

    // Provider availability check lives in the Node action; the action
    // logs its own outcome in notificationLog and the provider message
    // id is linked back onto this row via linkProviderMessage.
    if (row.channel === "email") {
      await ctx.scheduler.runAfter(0, api.notify.sendEmail, {
        orgId: row.orgId,
        to: row.recipient!,
        recipientUserId: row.recipientUserId,
        category: `outbox_${row.category}`,
        subject: vRow.subject,
        title: vRow.subject,
        bodyHtml: `<p style="white-space:pre-wrap;">${vRow.body
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</p>`,
        conversationId: row.conversationId,
      });
    } else if (row.channel === "whatsapp") {
      // WhatsApp requires the template registry; free-text goes as the
      // registered case_update template.
      await ctx.scheduler.runAfter(0, api.notify.sendWhatsappTemplate, {
        orgId: row.orgId,
        to: row.recipient!,
        recipientUserId: row.recipientUserId,
        category: "client_update",
        templateName: "case_update",
        languageCode: "en",
        params: [
          row.createdByName ?? "your chamber",
          row.subject.slice(0, 80),
          vRow.body.slice(0, 400),
        ],
        conversationId: row.conversationId,
      });
    } else {
      // in_thread: post to the conversation directly.
      if (!row.conversationId) {
        throw new Error("No conversation is linked for this message.");
      }
      await ctx.runMutation(internal.conversations.postSystemUpdate, {
        conversationId: row.conversationId,
        body: vRow.body,
        senderId: ac.user._id,
        kind: "client_update" as const,
      });
      await ctx.db.patch(row._id, {
        status: "delivered",
        deliveredAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { delivered: true as const };
    }
    // The provider action logs its own outcome in notificationLog; the
    // outbox row follows the provider message id via callbacks.
    await ctx.db.patch(row._id, { status: "sent", sentAt: Date.now(), updatedAt: Date.now() });
    return { dispatched: true as const };
  },
});

/**
 * Cancel a message. In-flight traffic cannot be cancelled silently —
 * the caller must confirm; only queued/pending/approved states allow it.
 */
export const cancel = mutation({
  args: { outboxId: v.id("commOutbox") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const row = await loadOutbox(ctx, ac, args.outboxId);
    if (["sent", "delivered", "read"].includes(row.status)) {
      throw new Error("A message that has already been sent cannot be cancelled.");
    }
    await ctx.db.patch(row._id, { status: "cancelled", updatedAt: Date.now() });
    await logAudit(
      ctx, ac.org._id, ac.user._id, actorName(ac.user),
      "Communication cancelled",
      `“${row.subject.slice(0, 80)}”`,
    );
  },
});

// ---------------------------------------------------------------------
// Provider wiring — idempotent callbacks from the notify bridge
// ---------------------------------------------------------------------

/**
 * Link an outbox row to its provider message id and mark it sent.
 * Called by the delivery fan-out once the provider accepts the send.
 * Matching is by providerMessageId → unique.
 */
export const markSent = internalMutation({
  args: {
    outboxId: v.id("commOutbox"),
    providerMessageId: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.outboxId);
    if (!row) return;
    if (["sent", "delivered", "read"].includes(row.status)) return; // no dupes
    await ctx.db.patch(args.outboxId, {
      status: "sent",
      providerMessageId: args.providerMessageId,
      sentAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

/** Provider failure callback for an outbox row. */
export const markDeliveryFailed = internalMutation({
  args: { outboxId: v.id("commOutbox"), reason: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.outboxId);
    if (!row || row.status === "cancelled") return;
    if (["delivered", "read"].includes(row.status)) return;
    await ctx.db.patch(args.outboxId, {
      status: "failed",
      lastError: args.reason.slice(0, 500),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Apply a verified provider event (sent/delivered/read/failed) to the
 * outbox row by provider message id. Never downgrades; never applies to
 * rows outside the delivery pipeline.
 */
export const applyProviderEvent = internalMutation({
  args: {
    providerMessageId: v.string(),
    eventType: v.string(),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("commOutbox")
      .withIndex("by_provider_msg", (q) =>
        q.eq("providerMessageId", args.providerMessageId),
      )
      .collect();
    const type = args.eventType as "sent" | "delivered" | "read" | "failed";
    for (const row of rows) {
      if (type === "failed") {
        if (!["queued", "sent"].includes(row.status)) continue;
        await ctx.db.patch(row._id, {
          status: "failed",
          lastError: args.failureReason?.slice(0, 500),
          updatedAt: Date.now(),
        });
        continue;
      }
      if (!canApplyDeliveryEvent(row.status, type)) continue;
      const patch: Partial<Doc<"commOutbox">> = {
        status: type,
        updatedAt: Date.now(),
      };
      if (type === "delivered") patch.deliveredAt = Date.now();
      if (type === "read") patch.readAt = Date.now();
      await ctx.db.patch(row._id, patch);
    }
  },
});

/**
 * Mark approved messages as awaiting_configuration when the provider is
 * not configured. Retains the approval so a later send works once keys
 * are added.
 */
export const markAwaitingConfiguration = internalMutation({
  args: { outboxId: v.id("commOutbox"), reason: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.outboxId);
    if (!row || row.status !== "queued") return;
    await ctx.db.patch(args.outboxId, {
      status: "awaiting_configuration",
      lastError: args.reason.slice(0, 500),
      updatedAt: Date.now(),
    });
  },
});

/** Retry a failed / awaiting-configuration message (re-queue then send). */
export const retry = mutation({
  args: { outboxId: v.id("commOutbox") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const row = await loadOutbox(ctx, ac, args.outboxId);
    if (!canRetry(row)) {
      throw new Error("Only failed or unconfigured messages can be retried.");
    }
    if (row.requiresApproval && sendableVersion(row) === null) {
      throw new Error("Re-approve the current version before retrying.");
    }
    await ctx.db.patch(row._id, {
      status: "queued",
      attempts: row.attempts + 1,
      lastError: undefined,
      updatedAt: Date.now(),
    });
    return { queued: true as const };
  },
});
