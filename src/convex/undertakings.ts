// =====================================================================
// FEATURE 9 — Undertakings Register: server module.
//
// Guarantees enforced here (mirrored by the pure engine in
// src/lib/undertakingsFlow.ts, which the tests exercise):
//   - Lifecycle transitions follow the state machine; terminal states
//     never move; rejection returns to draft WITH a reason.
//   - Activation (approval) and discharge (verification) require the
//     SUPERVISING lawyer (or an elevated owner/partner/administrator).
//   - ACTIVE undertakings can never be silently deleted; corrections
//     append a history entry and keep the previous text verbatim.
//   - Completion requires evidence or an explanation BEFORE the record
//     can move to completed_pending_verification; only the supervisor
//     then verifies (discharge) or finds breach.
//   - Every mutation is tenant-gated (requireAccess) and matter-gated
//     (canViewMatter); cross-tenant ids are "not found".
//   - Firm-level reporting strips confidential detail for viewers who
//     cannot open the underlying matter.
// =====================================================================

import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  canViewMatter,
  can,
  getAccessContext,
  requireAccess,
  requireMatter,
  type AccessContext,
} from "./access";
import {
  canApproveActivation,
  canCorrectRecord,
  canRecordBreach,
  canSubmitForApproval,
  canVerifyDischarge,
  canWithdraw,
  canTransitionUndertaking,
  completionObjection,
  dueClass,
  escalationTier,
  registerSummary,
  UNDERTAKING_STATUS_LABELS,
  type UndertakingStatus,
} from "../lib/undertakingsFlow";

const MAX_NAME = 200;
const MAX_TEXT = 4000;
const MAX_SHORT = 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function clamp(text: string | undefined, max: number): string | undefined {
  const t = text?.trim();
  return t ? t.slice(0, max) : undefined;
}

function actorName(u: Doc<"users">): string {
  return u.name || u.email || "Member";
}

function assertDate(d: string, label: string): void {
  if (!DATE_RE.test(d.trim())) throw new Error(`${label} must be YYYY-MM-DD.`);
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

/** Roles of the caller relative to one undertaking (feeds the pure policy). */
function rolesFor(
  ac: AccessContext,
  u: Doc<"undertakings">,
): {
  isResponsible: boolean;
  isSupervising: boolean;
  hasUndertakingsCapability: boolean;
  hasElevatedCapability: boolean;
} {
  return {
    isResponsible: u.responsibleId === ac.user._id,
    isSupervising: u.supervisingId === ac.user._id,
    hasUndertakingsCapability: can(ac, "matter.edit"),
    hasElevatedCapability:
      can(ac, "conflict.override") ||
      ac.membership.orgRole === "owner" ||
      ac.membership.orgRole === "partner" ||
      ac.membership.orgRole === "administrator",
  };
}

/** Load an undertaking the caller may see, or throw a tenant-safe error. */
async function requireUndertaking(
  ctx: QueryCtx | MutationCtx,
  ac: AccessContext,
  undertakingId: Id<"undertakings">,
): Promise<Doc<"undertakings">> {
  const u = await ctx.db.get(undertakingId);
  if (!u || u.orgId !== ac.org._id) throw new Error("Undertaking not found.");
  const matter = await ctx.db.get(u.matterId);
  if (!matter || !canViewMatter(ac, matter)) {
    throw new Error("You do not have access to this matter.");
  }
  return u;
}

// ---------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------

/** Register list for the firm desk, matter-gated, with summary counts. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return { rows: [], summary: null };

    const rows = await ctx.db
      .query("undertakings")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();

    const now = Date.now();
    const out: Array<
      Doc<"undertakings"> & {
        matterReference: string | null;
        matterTitle: string | null;
        dueClass: string;
        escalationTier: number;
      }
    > = [];
    for (const u of rows) {
      const matter = await ctx.db.get(u.matterId);
      if (!matter || !canViewMatter(ac, matter)) continue;
      const isActiveLike =
        u.status === "active" || u.status === "completed_pending_verification";
      out.push({
        ...u,
        matterReference: matter.reference,
        matterTitle: matter.title,
        dueClass: dueClass(u.dueAt, now, isActiveLike),
        escalationTier: escalationTier(u.status, u.dueAt, now),
      });
    }
    out.sort((a, b) => {
      // Active issues first, then by due date, then newest.
      const rank = (s: UndertakingStatus) =>
        s === "breached" ? 0
        : s === "active" ? 1
        : s === "completed_pending_verification" ? 2
        : s === "pending_approval" ? 3
        : 4;
      return (
        rank(a.status) - rank(b.status) ||
        (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) ||
        b.createdAt - a.createdAt
      );
    });

    return {
      rows: out,
      summary: registerSummary(
        rows.map((r) => ({ status: r.status, dueAt: r.dueAt })),
        now,
      ),
    };
  },
});

/** One undertaking + its matter coordinates. */
export const get = query({
  args: { undertakingId: v.id("undertakings") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    try {
      const u = await requireUndertaking(ctx, ac, args.undertakingId);
      const matter = await ctx.db.get(u.matterId);
      return {
        ...u,
        matterReference: matter?.reference ?? null,
        matterTitle: matter?.title ?? null,
      };
    } catch {
      return null; // tenant-safe: not found and denied look identical
    }
  },
});

/** Undertakings for one matter (workspace tab + Command Centre). */
export const listForMatter = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.orgId !== ac.org._id) return [];
    if (!canViewMatter(ac, matter)) return [];
    const now = Date.now();
    const rows = await ctx.db
      .query("undertakings")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    return rows
      .map((u) => ({
        ...u,
        dueClass: dueClass(u.dueAt, now, u.status === "active"),
      }))
      .sort((a, b) => {
        const rank = (s: UndertakingStatus) =>
          s === "breached" ? 0 : s === "active" ? 1 : 2;
        return rank(a.status) - rank(b.status) || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity);
      });
  },
});

/**
 * Firm-level register report (management view). Rows on matters the
 * caller cannot open are stripped to reference/direction/status/due
 * class with a confidential indicator — never client names, matter
 * titles or undertaking text. Callers without any undertakings role get
 * counts only.
 */
export const firmReport = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;

    const rows = await ctx.db
      .query("undertakings")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();

    const now = Date.now();
    const detail: Array<{
      id: Id<"undertakings">;
      matterReference: string;
      direction: "given" | "received";
      status: UndertakingStatus;
      dueAt: number | undefined;
      confidential: boolean;
      textPreview: string;
    }> = [];
    for (const u of rows) {
      const matter = await ctx.db.get(u.matterId);
      if (!matter || !canViewMatter(ac, matter)) {
        // Restricted row: visible indicator, zero detail.
        detail.push({
          id: u._id,
          matterReference: "Restricted",
          direction: u.direction,
          status: u.status,
          dueAt: u.dueAt,
          confidential: true,
          textPreview: "",
        });
        continue;
      }
      detail.push({
        id: u._id,
        matterReference: matter.reference,
        direction: u.direction,
        status: u.status,
        dueAt: u.dueAt,
        confidential: false,
        textPreview: (u.text ?? "").slice(0, 120),
      });
    }

    const summary = registerSummary(
      rows.map((r) => ({ status: r.status, dueAt: r.dueAt })),
      now,
    );

    return { generatedAt: now, summary, rows: detail };
  },
});

/** Active/overdue undertakings approaching or past due (escalation feed). */
export const escalations = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const now = Date.now();
    const rows = await ctx.db
      .query("undertakings")
      .withIndex("by_org_status", (q) => q.eq("orgId", ac.org._id).eq("status", "active"))
      .collect();
    const out: Array<{
      id: Id<"undertakings">;
      matterId: Id<"matters">;
      text: string;
      dueAt: number;
      tier: number;
    }> = [];
    for (const u of rows) {
      const tier = escalationTier(u.status, u.dueAt, now);
      if (tier === 0) continue;
      if (!canViewMatter(ac, (await ctx.db.get(u.matterId))!)) continue;
      out.push({ id: u._id, matterId: u.matterId, text: u.text, dueAt: u.dueAt!, tier });
    }
    return out.sort((a, b) => b.tier - a.tier || a.dueAt - b.dueAt);
  },
});

// ---------------------------------------------------------------------
// Mutations — lifecycle
// ---------------------------------------------------------------------

export const create = mutation({
  args: {
    matterId: v.id("matters"),
    text: v.string(),
    direction: v.union(v.literal("given"), v.literal("received")),
    party: v.optional(v.string()),
    givenOn: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    responsibleId: v.id("users"),
    supervisingId: v.id("users"),
    conditions: v.optional(v.string()),
    notes: v.optional(v.string()),
    confidential: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const matter = await requireMatter(ctx, ac, args.matterId);
    const text = args.text.trim();
    if (!text) throw new Error("Record the undertaking text exactly as accepted.");
    if (!canSubmitForApproval(rolesFor(ac, { ...blankForRoles(), responsibleId: args.responsibleId, supervisingId: args.supervisingId } as Doc<"undertakings">))) {
      throw new Error("Your role is not permitted to record undertakings.");
    }
    if (args.givenOn) assertDate(args.givenOn, "Given-on date");

    const now = Date.now();
    const id = await ctx.db.insert("undertakings", {
      orgId: ac.org._id,
      matterId: matter._id,
      text: text.slice(0, MAX_TEXT),
      direction: args.direction,
      party: clamp(args.party, MAX_NAME),
      givenOn: args.givenOn?.trim(),
      dueAt: args.dueAt,
      responsibleId: args.responsibleId,
      supervisingId: args.supervisingId,
      conditions: clamp(args.conditions, MAX_TEXT),
      notes: clamp(args.notes, MAX_TEXT),
      confidential: args.confidential ?? false,
      status: "draft",
      createdById: ac.user._id,
      createdByName: actorName(ac.user),
      createdAt: now,
      updatedAt: now,
    });
    await logAudit(
      ctx, ac.org._id, ac.user._id, actorName(ac.user),
      "Undertaking recorded",
      `${matter.reference} — ${args.direction} — ${text.slice(0, 80)}`,
    );
    return id;
  },
});

export const submitForApproval = mutation({
  args: { undertakingId: v.id("undertakings"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const u = await requireUndertaking(ctx, ac, args.undertakingId);
    if (!canSubmitForApproval(rolesFor(ac, u))) {
      throw new Error("Only the responsible or supervising lawyer may submit this for approval.");
    }
    if (!canTransitionUndertaking(u.status, "pending_approval")) {
      throw new Error(`An undertaking in status “${UNDERTAKING_STATUS_LABELS[u.status]}” cannot be submitted.`);
    }
    const now = Date.now();
    await ctx.db.patch(u._id, {
      status: "pending_approval",
      submittedAt: now,
      rejectedReason: undefined,
      updatedAt: now,
    });
    await logAudit(ctx, ac.org._id, ac.user._id, actorName(ac.user), "Undertaking submitted for approval", u.text.slice(0, 80));
  },
});

/** Supervisor approves activation (or returns to draft with a reason). */
export const decideApproval = mutation({
  args: {
    undertakingId: v.id("undertakings"),
    approve: v.boolean(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const u = await requireUndertaking(ctx, ac, args.undertakingId);
    if (!canApproveActivation(rolesFor(ac, u))) {
      throw new Error("Only the supervising lawyer (or an owner/partner) may approve activation.");
    }
    if (args.approve) {
      if (!canTransitionUndertaking(u.status, "active")) {
        throw new Error(`An undertaking in status “${UNDERTAKING_STATUS_LABELS[u.status]}” cannot be activated.`);
      }
      const now = Date.now();
      await ctx.db.patch(u._id, {
        status: "active",
        approvedAt: now,
        approvedById: ac.user._id,
        approvedByName: actorName(ac.user),
        rejectedReason: undefined,
        updatedAt: now,
      });
      await logAudit(ctx, ac.org._id, ac.user._id, actorName(ac.user), "Undertaking activated", u.text.slice(0, 80));
    } else {
      const reason = args.reason?.trim();
      if (!reason) throw new Error("Give a reason when returning an undertaking for rework.");
      if (!canTransitionUndertaking(u.status, "draft")) {
        throw new Error(`An undertaking in status “${UNDERTAKING_STATUS_LABELS[u.status]}” cannot be returned.`);
      }
      const now = Date.now();
      await ctx.db.patch(u._id, {
        status: "draft",
        rejectedReason: reason.slice(0, MAX_SHORT),
        updatedAt: now,
      });
      await logAudit(ctx, ac.org._id, ac.user._id, actorName(ac.user), "Undertaking returned for rework", reason.slice(0, 120));
    }
  },
});

export const withdraw = mutation({
  args: { undertakingId: v.id("undertakings"), reason: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const u = await requireUndertaking(ctx, ac, args.undertakingId);
    if (!canWithdraw(rolesFor(ac, u))) {
      throw new Error("Only the responsible or supervising lawyer (or an owner/partner) may withdraw an undertaking.");
    }
    const reason = args.reason.trim();
    if (!reason) throw new Error("A withdrawal reason is required — the register keeps the history.");
    if (!canTransitionUndertaking(u.status, "withdrawn")) {
      throw new Error(`An undertaking in status “${UNDERTAKING_STATUS_LABELS[u.status]}” cannot be withdrawn.`);
    }
    const now = Date.now();
    await ctx.db.patch(u._id, {
      status: "withdrawn",
      withdrawnAt: now,
      withdrawnById: ac.user._id,
      withdrawnReason: reason.slice(0, MAX_SHORT),
      updatedAt: now,
    });
    await logAudit(ctx, ac.org._id, ac.user._id, actorName(ac.user), "Undertaking withdrawn", reason.slice(0, 120));
  },
});

// ---------------------------------------------------------------------
// Mutations — completion, verification, breach
// ---------------------------------------------------------------------

/** Responsible lawyer records completion evidence/explanation. */
export const recordCompletion = mutation({
  args: {
    undertakingId: v.id("undertakings"),
    evidenceNote: v.optional(v.string()),
    documentId: v.optional(v.id("matterDocuments")),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const u = await requireUndertaking(ctx, ac, args.undertakingId);
    if (!canSubmitForApproval(rolesFor(ac, u))) {
      throw new Error("Only the responsible or supervising lawyer may record completion.");
    }
    if (!canTransitionUndertaking(u.status, "completed_pending_verification")) {
      throw new Error(`An undertaking in status “${UNDERTAKING_STATUS_LABELS[u.status]}” cannot be marked completed.`);
    }
    const note = args.evidenceNote?.trim();
    if (!note && !args.documentId) {
      throw new Error(
        completionObjection({ verificationRequired: true }) ??
          "Completion evidence is required before verification.",
      );
    }
    const now = Date.now();
    await ctx.db.patch(u._id, {
      status: "completed_pending_verification",
      completionEvidence: {
        note: note ? note.slice(0, MAX_TEXT) : undefined,
        documentId: args.documentId,
        recordedAt: now,
        recordedById: ac.user._id,
        recordedByName: actorName(ac.user),
      },
      updatedAt: now,
    });
    await logAudit(ctx, ac.org._id, ac.user._id, actorName(ac.user), "Undertaking completion recorded", u.text.slice(0, 80));
  },
});

/** Supervisory verification: discharge (accept) or breach (reject). */
export const verify = mutation({
  args: {
    undertakingId: v.id("undertakings"),
    outcome: v.union(v.literal("discharged"), v.literal("breached")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const u = await requireUndertaking(ctx, ac, args.undertakingId);
    if (!canVerifyDischarge(rolesFor(ac, u))) {
      throw new Error("Only the supervising lawyer (or an owner/partner) may verify completion.");
    }
    if (args.outcome === "breached" && !canRecordBreach(rolesFor(ac, u))) {
      throw new Error("Recording a breach requires supervision or an elevated role.");
    }
    if (!canTransitionUndertaking(u.status, args.outcome)) {
      throw new Error(`An undertaking in status “${UNDERTAKING_STATUS_LABELS[u.status]}” cannot be verified.`);
    }
    const now = Date.now();
    if (args.outcome === "discharged") {
      await ctx.db.patch(u._id, {
        status: "discharged",
        dischargedAt: now,
        dischargedById: ac.user._id,
        dischargedByName: actorName(ac.user),
        verificationNote: clamp(args.note, MAX_TEXT),
        updatedAt: now,
      });
      await logAudit(ctx, ac.org._id, ac.user._id, actorName(ac.user), "Undertaking discharged", u.text.slice(0, 80));
    } else {
      const explanation = args.note?.trim();
      if (!explanation) {
        throw new Error("An explanation is required when recording a breach — the register preserves it for audit.");
      }
      await ctx.db.patch(u._id, {
        status: "breached",
        breachedAt: now,
        breachedById: ac.user._id,
        breachExplanation: explanation.slice(0, MAX_TEXT),
        updatedAt: now,
      });
      await logAudit(ctx, ac.org._id, ac.user._id, actorName(ac.user), "Undertaking BREACHED", explanation.slice(0, 120));
    }
  },
});

// ---------------------------------------------------------------------
// Mutations — corrections (history-preserving) and delete guard
// ---------------------------------------------------------------------

/**
 * In-place correction. The previous value is preserved verbatim in the
 * corrections history; a reason is mandatory. Active undertakings can
 * be corrected (with history) — never silently replaced.
 */
export const correct = mutation({
  args: {
    undertakingId: v.id("undertakings"),
    field: v.union(
      v.literal("text"),
      v.literal("dueAt"),
      v.literal("party"),
      v.literal("conditions"),
      v.literal("notes"),
    ),
    reason: v.string(),
    newText: v.optional(v.string()),
    newDueAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const u = await requireUndertaking(ctx, ac, args.undertakingId);
    if (!canCorrectRecord(rolesFor(ac, u))) {
      throw new Error("Only the responsible or supervising lawyer (or an owner/partner) may correct an undertaking.");
    }
    const reason = args.reason.trim();
    if (!reason) throw new Error("A reason is required for every correction.");

    const now = Date.now();
    const patch: Record<string, unknown> = { updatedAt: now };

    if (args.field === "dueAt") {
      if (args.newDueAt === undefined) throw new Error("Provide the new due date.");
      const previous = u.dueAt === undefined ? "(none)" : String(u.dueAt);
      if (u.dueAt === args.newDueAt) throw new Error("That is not a change.");
      patch.dueAt = args.newDueAt;
      const entry = {
        at: now, byId: ac.user._id, byName: actorName(ac.user),
        reason: reason.slice(0, MAX_SHORT), field: "dueAt",
        previous, next: String(args.newDueAt),
      };
      await ctx.db.patch(u._id, { ...patch, corrections: [...(u.corrections ?? []), entry] });
    } else {
      const newValue = (args.newText ?? "").trim();
      if (!newValue) throw new Error("Provide the new value.");
      const previous = (u[args.field] as string | undefined) ?? "(none)";
      if (previous === newValue) throw new Error("That is not a change.");
      const max = args.field === "text" ? MAX_TEXT : MAX_SHORT;
      patch[args.field] = newValue.slice(0, max);
      const entry = {
        at: now, byId: ac.user._id, byName: actorName(ac.user),
        reason: reason.slice(0, MAX_SHORT), field: args.field,
        previous, next: newValue.slice(0, max),
      };
      await ctx.db.patch(u._id, { ...patch, corrections: [...(u.corrections ?? []), entry] });
    }

    await logAudit(
      ctx, ac.org._id, ac.user._id, actorName(ac.user),
      "Undertaking corrected",
      `${args.field} — ${reason.slice(0, 100)}`,
    );
  },
});

/**
 * Deletion guard: only drafts (never submitted) may be removed, and
 * only by their creator or an elevated role. Active and completed
 * undertakings are part of the firm's record and cannot be deleted.
 */
export const remove = mutation({
  args: { undertakingId: v.id("undertakings") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const u = await requireUndertaking(ctx, ac, args.undertakingId);
    const elevated = rolesFor(ac, u).hasElevatedCapability;
    if (u.status !== "draft" || (u.createdById !== ac.user._id && !elevated)) {
      throw new Error(
        "Active and completed undertakings are part of the chamber's record and cannot be deleted. Withdraw or discharge instead.",
      );
    }
    await ctx.db.delete(u._id);
    await logAudit(ctx, ac.org._id, ac.user._id, actorName(ac.user), "Undertaking draft removed", u.text.slice(0, 80));
  },
});

// ---------------------------------------------------------------------
// Escalation — wired into the scheduled reminder scan
// ---------------------------------------------------------------------

/**
 * Called by reminders.runScan: creates one notification per escalated
 * undertaking per day, to the responsible and supervising lawyers.
 * Returns the number of notifications created.
 */
export const escalateScan = internalMutation({
  args: { dayKey: v.string() },
  handler: async (ctx, args): Promise<number> => {
    const now = Date.now();
    const rows = await ctx.db
      .query("undertakings")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    let created = 0;
    for (const u of rows) {
      const tier = escalationTier(u.status, u.dueAt, now);
      if (tier === 0) continue;
      const recipients = new Set<Id<"users">>([u.responsibleId, u.supervisingId]);
      for (const userId of recipients) {
        const id = await ctx.runMutation(internal.notifications.createInternal, {
          orgId: u.orgId,
          userId,
          kind: "undertaking_escalation",
          title: `Undertaking overdue — tier ${tier}`,
          body: u.text.slice(0, 160),
          linkTo: `/undertakings?focus=${u._id}`,
          dedupeKey: `undertaking:${u._id}:${args.dayKey}`,
        });
        if (id) created += 1;
      }
    }
    return created;
  },
});

// Minimal shape used only to reuse the pure role predicates in create().
function blankForRoles(): Partial<Doc<"undertakings">> {
  return {};
}
