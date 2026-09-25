// =====================================================================
// FEATURE 5 — Deadline rules engine: server module.
//
// Versioned rules compute deadline drafts from court triggers; an
// authorized lawyer approves each draft (or a whole batch) before any
// real deadline row exists. Guarantees enforced here:
//   - The exact rule version used is frozen onto every draft.
//   - Rule edits create a new version — approved deadlines are never
//     retroactively recomputed.
//   - dedupeKey is deterministic per rule+version+trigger, so retries
//     never double-generate.
//   - Critical deadlines require explicit approval; adjustments keep a
//     reason and the previous date — nothing is silently overwritten.
// =====================================================================

import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  canViewMatter,
  getAccessContext,
  requireAccess,
  requireCapability,
  requireMatter,
  type AccessContext,
} from "./access";
import {
  calculateDeadline,
  dedupeKey as makeDedupeKey,
  sourceSentence,
  type DeadlineRuleSpec,
  type HolidayMap,
} from "../lib/deadlineRules";

const MAX_NAME = 160;
const MAX_TEXT = 400;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function clamp(text: string | undefined, max: number): string | undefined {
  const t = text?.trim();
  return t ? t.slice(0, max) : undefined;
}

function actorName(u: Doc<"users">): string {
  return u.name || u.email || "Member";
}

/** End of a YYYY-MM-DD civil day in Asia/Kolkata (UTC+5:30, no DST). */
export function endOfDayIST(dateStr: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) throw new Error("Use the date picker (YYYY-MM-DD).");
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 18, 29, 59, 999);
  if (Number.isNaN(ms)) throw new Error("That date could not be read.");
  return ms;
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

function specOf(rule: Doc<"deadlineRules">): DeadlineRuleSpec {
  return {
    name: rule.name,
    jurisdiction: rule.jurisdiction,
    authority: rule.authority,
    practiceArea: rule.practiceArea,
    triggerEvent: rule.triggerEvent,
    countType: rule.countType,
    count: rule.count,
    triggerDayTreatment: rule.triggerDayTreatment,
    weekendRule: rule.weekendRule,
    holidayRule: rule.holidayRule,
    direction: rule.direction,
    criticality: rule.criticality,
    reminderDaysBefore: rule.reminderDaysBefore,
    effectiveFrom: rule.effectiveFrom,
    effectiveTo: rule.effectiveTo,
  };
}

async function loadHolidayMap(
  db: QueryCtx["db"],
  orgId: Id<"organizations">,
): Promise<HolidayMap> {
  const rows = await db
    .query("courtHolidays")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const map: HolidayMap = new Map();
  for (const h of rows) {
    const list = map.get(h.date) ?? [];
    list.push(h.court ? `${h.name} (${h.court})` : h.name);
    map.set(h.date, list);
  }
  return map;
}

// ---------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------

/** Rule catalogue for the Rules desk. */
export const ruleList = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const rows = await ctx.db
      .query("deadlineRules")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** One rule + its immutable version history. */
export const ruleDetail = query({
  args: { ruleId: v.id("deadlineRules") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const rule = await ctx.db.get(args.ruleId);
    if (!rule || rule.orgId !== ac.org._id) return null;
    const versions = await ctx.db
      .query("deadlineRuleVersions")
      .withIndex("by_rule", (q) => q.eq("ruleId", args.ruleId))
      .collect();
    versions.sort((a, b) => b.version - a.version);
    return { rule, versions };
  },
});

/** Court holidays for the organisation. */
export const holidayList = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const rows = await ctx.db
      .query("courtHolidays")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  },
});

/** All rule-generated deadline rows for the desk (org-scoped, matter-gated). */
export const draftList = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const rows = await ctx.db
      .query("ruleDeadlines")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const out: Array<
      Doc<"ruleDeadlines"> & { matterReference: string | null; matterTitle: string | null }
    > = [];
    const matterCache = new Map<Id<"matters">, Doc<"matters"> | null>();
    for (const r of rows) {
      let matter = matterCache.get(r.matterId);
      if (matter === undefined) {
        const m = await ctx.db.get(r.matterId);
        matter = m ?? null;
        matterCache.set(r.matterId, matter);
      }
      if (!matter || !canViewMatter(ac, matter)) continue;
      out.push({
        ...r,
        matterReference: matter.reference,
        matterTitle: matter.title,
      });
    }
    out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.createdAt - b.createdAt);
    return out;
  },
});

/** Drafts for one matter (matter workspace tab). */
export const draftsForMatter = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.orgId !== ac.org._id) return [];
    if (!canViewMatter(ac, matter)) return [];
    const rows = await ctx.db
      .query("ruleDeadlines")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    return rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  },
});

/**
 * Live preview of the calculation for the compose dialog — the caller
 * sees the exact breakdown a submission would freeze, plus whether the
 * same rule version + trigger was already generated (retry safety).
 */
export const preview = query({
  args: {
    ruleId: v.id("deadlineRules"),
    triggerDate: v.string(),
    triggerRef: v.string(),
    triggerEvent: v.string(),
  },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const rule = await ctx.db.get(args.ruleId);
    if (!rule || rule.orgId !== ac.org._id) return null;
    const holidays = await loadHolidayMap(ctx.db, ac.org._id);
    try {
      const result = calculateDeadline(specOf(rule), args.triggerDate, holidays);
      const existing = await ctx.db
        .query("ruleDeadlines")
        .withIndex("by_dedupe", (q) =>
          q.eq(
            "dedupeKey",
            makeDedupeKey({
              ruleId: args.ruleId,
              ruleVersion: rule.currentVersion,
              triggerEvent: args.triggerEvent,
              triggerRef: args.triggerRef,
            }),
          ),
        )
        .first();
      return {
        ...result,
        ruleName: rule.name,
        ruleVersion: rule.currentVersion,
        criticality: rule.criticality,
        alreadyGenerated: !!existing,
        existingStatus: existing?.status ?? null,
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Calculation failed." };
    }
  },
});

/** Unacknowledged critical deadlines approaching or past due. */
export const escalations = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const rows = await ctx.db
      .query("ruleDeadlines")
      .withIndex("by_org_status", (q) =>
        q.eq("orgId", ac.org._id).eq("status", "approved"),
      )
      .collect();
    return rows
      .filter((r) => r.criticality === "critical")
      .map((r) => ({
        _id: r._id,
        title: r.title,
        matterId: r.matterId,
        dueDate: r.dueDate,
        daysUntilDue: Math.round(
          (Date.parse(r.dueDate) - Date.parse(today)) / 86400000,
        ),
        unacknowledged: r.acknowledgedAt === undefined,
      }))
      .filter((r) => r.daysUntilDue <= 3)
      .sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  },
});

/** Trigger suggestions for the generate dialog (orders + past hearings). */
export const suggestTriggers = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return { orders: [], hearings: [] };
    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.orgId !== ac.org._id) return { orders: [], hearings: [] };
    if (!canViewMatter(ac, matter)) return { orders: [], hearings: [] };

    const orders = await ctx.db
      .query("orders")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    const hearings = await ctx.db
      .query("hearings")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();

    const ist = (ms: number) =>
      new Date(ms + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

    return {
      orders: orders
        .sort((a, b) => b.passedOn - a.passedOn)
        .slice(0, 20)
        .map((o) => ({
          id: o._id as string,
          label: `Order — ${o.title}`,
          date: ist(o.passedOn),
          detail: o.summary?.slice(0, 200),
        })),
      hearings: hearings
        .filter((h) => h.status === "adjourned" || h.status === "held")
        .sort((a, b) => b.at - a.at)
        .slice(0, 20)
        .map((h) => ({
          id: h._id as string,
          label: `Hearing — ${h.title} (${h.status})`,
          date: ist(h.at),
          detail: h.outcome?.slice(0, 200),
        })),
    };
  },
});

// ---------------------------------------------------------------------
// Court holidays
// ---------------------------------------------------------------------

export const addHoliday = mutation({
  args: { date: v.string(), name: v.string(), court: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "task.manage");
    assertDate(args.date, "Holiday date");
    if (!args.name.trim()) throw new Error("Give the holiday a name.");
    await ctx.db.insert("courtHolidays", {
      orgId: ac.org._id,
      date: args.date.trim(),
      name: args.name.trim().slice(0, MAX_NAME),
      court: clamp(args.court, MAX_NAME),
      createdById: ac.user._id,
      createdAt: Date.now(),
    });
    await logAudit(
      ctx, ac.org._id, ac.user._id, actorName(ac.user),
      "Court holiday added",
      `${args.name.trim()} — ${args.date.trim()}`,
    );
  },
});

export const removeHoliday = mutation({
  args: { holidayId: v.id("courtHolidays") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "task.manage");
    const h = await ctx.db.get(args.holidayId);
    if (!h || h.orgId !== ac.org._id) throw new Error("Holiday not found.");
    await ctx.db.delete(args.holidayId);
    await logAudit(
      ctx, ac.org._id, ac.user._id, actorName(ac.user),
      "Court holiday removed",
      `${h.name} — ${h.date}`,
    );
  },
});

// ---------------------------------------------------------------------
// Rule CRUD (versioned)
// ---------------------------------------------------------------------

export const TRIGGER_EVENTS = [
  "order_passed",
  "hearing_adjourned",
  "hearing_held",
  "filing_done",
  "service_completed",
  "manual",
] as const;

export const TRIGGER_EVENT_LABELS: Record<(typeof TRIGGER_EVENTS)[number], string> = {
  order_passed: "Order passed",
  hearing_adjourned: "Hearing adjourned",
  hearing_held: "Hearing held",
  filing_done: "Filing completed",
  service_completed: "Service completed",
  manual: "Manual trigger",
};

function assertRuleInput(args: {
  name: string;
  count: number;
  effectiveFrom: string;
  effectiveTo?: string;
}) {
  if (!args.name.trim()) throw new Error("Give the rule a name.");
  if (!Number.isInteger(args.count) || args.count <= 0 || args.count > 3650) {
    throw new Error("Count must be a positive whole number of days (≤ 3650).");
  }
  assertDate(args.effectiveFrom, "Effective from");
  if (args.effectiveTo !== undefined) {
    assertDate(args.effectiveTo, "Effective to");
    if (args.effectiveTo < args.effectiveFrom) {
      throw new Error("Effective-to cannot be before effective-from.");
    }
  }
}

export const createRule = mutation({
  args: {
    name: v.string(),
    jurisdiction: v.optional(v.string()),
    authority: v.optional(v.string()),
    practiceArea: v.optional(v.string()),
    triggerEvent: v.string(),
    countType: v.union(v.literal("calendar_days"), v.literal("working_days")),
    count: v.number(),
    triggerDayTreatment: v.union(v.literal("excluded"), v.literal("included")),
    weekendRule: v.union(v.literal("sat_sun"), v.literal("sun_only")),
    holidayRule: v.union(v.literal("skip"), v.literal("count")),
    direction: v.union(v.literal("after"), v.literal("before")),
    criticality: v.union(v.literal("critical"), v.literal("normal")),
    reminderDaysBefore: v.optional(v.number()),
    effectiveFrom: v.string(),
    effectiveTo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "task.manage");
    assertRuleInput(args);
    if (!args.triggerEvent.trim()) throw new Error("Choose a trigger event.");
    const now = Date.now();
    const name = args.name.trim().slice(0, MAX_NAME);
    const spec: DeadlineRuleSpec = {
      name,
      jurisdiction: clamp(args.jurisdiction, MAX_NAME),
      authority: clamp(args.authority, MAX_NAME),
      practiceArea: clamp(args.practiceArea, MAX_NAME),
      triggerEvent: args.triggerEvent.trim(),
      countType: args.countType,
      count: args.count,
      triggerDayTreatment: args.triggerDayTreatment,
      weekendRule: args.weekendRule,
      holidayRule: args.holidayRule,
      direction: args.direction,
      criticality: args.criticality,
      reminderDaysBefore:
        args.reminderDaysBefore !== undefined && args.reminderDaysBefore > 0
          ? args.reminderDaysBefore
          : undefined,
      effectiveFrom: args.effectiveFrom.trim(),
      effectiveTo: args.effectiveTo?.trim() || undefined,
    };
    const ruleId = await ctx.db.insert("deadlineRules", {
      orgId: ac.org._id,
      ...spec,
      currentVersion: 1,
      active: true,
      createdById: ac.user._id,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("deadlineRuleVersions", {
      ruleId,
      version: 1,
      spec,
      changeNote: "Initial version.",
      createdById: ac.user._id,
      createdAt: now,
    });
    await logAudit(
      ctx, ac.org._id, ac.user._id, actorName(ac.user),
      "Deadline rule created",
      `${name} (v1)`,
    );
    return { ruleId };
  },
});

/**
 * Edit a rule → new immutable version. Existing drafts and approvals
 * keep the version they were generated with; only future triggers use
 * the new version.
 */
export const editRule = mutation({
  args: {
    ruleId: v.id("deadlineRules"),
    name: v.optional(v.string()),
    jurisdiction: v.optional(v.string()),
    authority: v.optional(v.string()),
    practiceArea: v.optional(v.string()),
    triggerEvent: v.optional(v.string()),
    countType: v.optional(v.union(v.literal("calendar_days"), v.literal("working_days"))),
    count: v.optional(v.number()),
    triggerDayTreatment: v.optional(v.union(v.literal("excluded"), v.literal("included"))),
    weekendRule: v.optional(v.union(v.literal("sat_sun"), v.literal("sun_only"))),
    holidayRule: v.optional(v.union(v.literal("skip"), v.literal("count"))),
    direction: v.optional(v.union(v.literal("after"), v.literal("before"))),
    criticality: v.optional(v.union(v.literal("critical"), v.literal("normal"))),
    reminderDaysBefore: v.optional(v.number()),
    effectiveFrom: v.optional(v.string()),
    effectiveTo: v.optional(v.string()),
    changeNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "task.manage");
    const rule = await ctx.db.get(args.ruleId);
    if (!rule || rule.orgId !== ac.org._id) throw new Error("Rule not found.");

    const next: DeadlineRuleSpec = {
      name: args.name?.trim() || rule.name,
      jurisdiction:
        args.jurisdiction !== undefined ? clamp(args.jurisdiction, MAX_NAME) : rule.jurisdiction,
      authority: args.authority !== undefined ? clamp(args.authority, MAX_NAME) : rule.authority,
      practiceArea:
        args.practiceArea !== undefined ? clamp(args.practiceArea, MAX_NAME) : rule.practiceArea,
      triggerEvent: args.triggerEvent?.trim() || rule.triggerEvent,
      countType: args.countType ?? rule.countType,
      count: args.count ?? rule.count,
      triggerDayTreatment: args.triggerDayTreatment ?? rule.triggerDayTreatment,
      weekendRule: args.weekendRule ?? rule.weekendRule,
      holidayRule: args.holidayRule ?? rule.holidayRule,
      direction: args.direction ?? rule.direction,
      criticality: args.criticality ?? rule.criticality,
      reminderDaysBefore:
        args.reminderDaysBefore !== undefined
          ? args.reminderDaysBefore > 0
            ? args.reminderDaysBefore
            : undefined
          : rule.reminderDaysBefore,
      effectiveFrom: args.effectiveFrom?.trim() || rule.effectiveFrom,
      effectiveTo:
        args.effectiveTo !== undefined
          ? args.effectiveTo?.trim() || undefined
          : rule.effectiveTo,
    };
    if (!Number.isInteger(next.count) || next.count <= 0 || next.count > 3650) {
      throw new Error("Count must be a positive whole number of days (≤ 3650).");
    }
    assertDate(next.effectiveFrom, "Effective from");
    if (next.effectiveTo) assertDate(next.effectiveTo, "Effective to");
    if (next.effectiveTo && next.effectiveTo < next.effectiveFrom) {
      throw new Error("Effective-to cannot be before effective-from.");
    }

    const version = rule.currentVersion + 1;
    const now = Date.now();
    await ctx.db.patch(rule._id, { ...next, currentVersion: version, updatedAt: now });
    await ctx.db.insert("deadlineRuleVersions", {
      ruleId: rule._id,
      version,
      spec: next,
      changeNote: clamp(args.changeNote, MAX_TEXT) ?? `Edited — now version ${version}.`,
      createdById: ac.user._id,
      createdAt: now,
    });
    await logAudit(
      ctx, ac.org._id, ac.user._id, actorName(ac.user),
      "Deadline rule edited",
      `${next.name} → v${version}${args.changeNote ? `: ${args.changeNote.trim()}` : ""}`,
    );
    return { version };
  },
});

export const setRuleActive = mutation({
  args: { ruleId: v.id("deadlineRules"), active: v.boolean() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "task.manage");
    const rule = await ctx.db.get(args.ruleId);
    if (!rule || rule.orgId !== ac.org._id) throw new Error("Rule not found.");
    await ctx.db.patch(rule._id, { active: args.active, updatedAt: Date.now() });
    await logAudit(
      ctx, ac.org._id, ac.user._id, actorName(ac.user),
      args.active ? "Deadline rule activated" : "Deadline rule deactivated",
      rule.name,
    );
  },
});

// ---------------------------------------------------------------------
// Generation from triggers
// ---------------------------------------------------------------------

/**
 * Generate deadline drafts for a matter by running every active,
 * effective rule matching the chosen trigger. Retries are safe: the
 * deterministic dedupeKey short-circuits duplicates (rejected drafts
 * are kept and reported, never regenerated).
 */
export const generateFromTrigger = mutation({
  args: {
    matterId: v.id("matters"),
    triggerEvent: v.string(),
    triggerRef: v.string(),
    triggerDate: v.string(),
    sourceLabel: v.optional(v.string()),
    sourceDetail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "task.manage");
    const matter = await requireMatter(ctx, ac, args.matterId);
    assertDate(args.triggerDate, "Trigger date");
    if (!args.triggerRef.trim()) {
      throw new Error("A source record reference is required.");
    }

    const rules = await ctx.db
      .query("deadlineRules")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const holidays = await loadHolidayMap(ctx.db, ac.org._id);
    const actor = actorName(ac.user);
    const created: Array<{ ruleName: string; dueDate: string; criticality: string }> = [];
    const skipped: Array<{ ruleName: string; reason: string }> = [];

    for (const rule of rules) {
      if (!rule.active) continue;
      if (rule.triggerEvent !== args.triggerEvent) continue;
      if (args.triggerDate < rule.effectiveFrom) continue;
      if (rule.effectiveTo && args.triggerDate > rule.effectiveTo) continue;

      const key = makeDedupeKey({
        ruleId: rule._id,
        ruleVersion: rule.currentVersion,
        triggerEvent: args.triggerEvent,
        triggerRef: args.triggerRef,
      });
      const existing = await ctx.db
        .query("ruleDeadlines")
        .withIndex("by_dedupe", (q) => q.eq("dedupeKey", key))
        .first();
      if (existing) {
        skipped.push({
          ruleName: rule.name,
          reason:
            existing.status === "rejected"
              ? "already generated and rejected (kept for audit)"
              : "already generated",
        });
        continue;
      }

      let result;
      try {
        result = calculateDeadline(specOf(rule), args.triggerDate, holidays);
      } catch (e) {
        skipped.push({
          ruleName: rule.name,
          reason: e instanceof Error ? e.message : "calculation failed",
        });
        continue;
      }

      const sentence = sourceSentence({
        sourceLabel: args.sourceLabel?.trim() || TRIGGER_EVENT_LABELS[args.triggerEvent as (typeof TRIGGER_EVENTS)[number]] || args.triggerEvent,
        sourceDate: args.triggerDate,
        detail: args.sourceDetail?.trim(),
      });

      await ctx.db.insert("ruleDeadlines", {
        orgId: ac.org._id,
        matterId: args.matterId,
        ruleId: rule._id,
        ruleVersion: rule.currentVersion,
        ruleName: rule.name,
        dedupeKey: key,
        triggerEvent: args.triggerEvent,
        triggerRef: args.triggerRef,
        triggerDate: args.triggerDate,
        title: `${rule.name} — ${matter.reference}`,
        category: args.triggerEvent === "order_passed" ? "court_order" : "compliance",
        dueDate: result.dueDate,
        calcRule: result.calcRule,
        breakdown: result.breakdown,
        sourceSentence: sentence,
        criticality: rule.criticality,
        status: "draft",
        proposedById: ac.user._id,
        proposedByName: actor,
        createdAt: Date.now(),
      });
      created.push({ ruleName: rule.name, dueDate: result.dueDate, criticality: rule.criticality });
    }

    await logAudit(
      ctx, ac.org._id, ac.user._id, actor,
      "Deadline drafts generated",
      `${created.length} draft(s) from ${args.triggerEvent} ${args.triggerRef} (${skipped.length} skipped)`,
    );
    return { created, skipped };
  },
});

// ---------------------------------------------------------------------
// Approval / rejection
// ---------------------------------------------------------------------

function assertApprover(ac: AccessContext) {
  requireCapability(ac, "matter.edit");
}

async function loadDraft(
  ctx: MutationCtx,
  ac: AccessContext,
  draftId: Id<"ruleDeadlines">,
): Promise<Doc<"ruleDeadlines">> {
  const draft = await ctx.db.get(draftId);
  if (!draft || draft.orgId !== ac.org._id) throw new Error("Draft not found.");
  await requireMatter(ctx, ac, draft.matterId);
  return draft;
}

/** Core approval write, shared by single and bulk paths. */
async function approveCore(
  ctx: MutationCtx,
  draft: Doc<"ruleDeadlines">,
  actorId: Id<"users">,
  actor: string,
): Promise<void> {
  // Exactly-once guard: never create a second deadline row (retries).
  if (!draft.deadlineId) {
    const deadlineId = await ctx.db.insert("deadlines", {
      orgId: draft.orgId,
      matterId: draft.matterId,
      title: draft.title,
      category: draft.category,
      dueAt: endOfDayIST(draft.dueDate),
      status: "open",
      createdById: actorId,
      history: [
        {
          at: Date.now(),
          byId: actorId,
          text: `Created from rule “${draft.ruleName}” v${draft.ruleVersion} — due ${draft.dueDate}${draft.criticality === "critical" ? " (CRITICAL)" : ""}.`,
        },
      ],
      createdAt: Date.now(),
    });
    await ctx.db.patch(draft._id, { deadlineId });
  }
  await ctx.db.patch(draft._id, {
    status: "approved",
    approvedAt: Date.now(),
    approvedById: actorId,
    approvedByName: actor,
  });
  await ctx.db.insert("matterEvents", {
    matterId: draft.matterId,
    kind: "deadline",
    detail: `Rule deadline approved — ${draft.title}, due ${draft.dueDate} (rule ${draft.ruleName} v${draft.ruleVersion}).`,
    createdAt: Date.now(),
    authorId: actorId,
    occurredAt: Date.now(),
    datePrecision: "day",
  });
  await logAudit(
    ctx, draft.orgId, actorId, actor,
    "Rule deadline approved",
    `${draft.title} — due ${draft.dueDate} (${draft.ruleName} v${draft.ruleVersion})`,
  );
}

/** Approve one draft — creates the real deadline exactly once. */
export const approveDraft = mutation({
  args: { draftId: v.id("ruleDeadlines") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    assertApprover(ac);
    const draft = await loadDraft(ctx, ac, args.draftId);
    if (draft.status !== "draft") {
      throw new Error(
        `Only pending drafts can be approved (this one is ${draft.status}).`,
      );
    }
    await approveCore(ctx, draft, ac.user._id, actorName(ac.user));
    return { deadlineId: draft.deadlineId };
  },
});

/** Bulk-approve every pending draft for one matter — one clear action. */
export const approveAllForMatter = mutation({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    assertApprover(ac);
    await requireMatter(ctx, ac, args.matterId);
    const drafts = await ctx.db
      .query("ruleDeadlines")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    const actor = actorName(ac.user);
    let approved = 0;
    for (const d of drafts) {
      if (d.status !== "draft") continue;
      await approveCore(ctx, d, ac.user._id, actor);
      approved += 1;
    }
    if (approved > 0) {
      await logAudit(
        ctx, ac.org._id, ac.user._id, actor,
        "Rule deadlines bulk-approved",
        `${approved} draft(s) approved for ${args.matterId}`,
      );
    }
    return { approved };
  },
});

/** Reject a draft — preserved for audit, never deleted. */
export const rejectDraft = mutation({
  args: { draftId: v.id("ruleDeadlines"), note: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    assertApprover(ac);
    const draft = await loadDraft(ctx, ac, args.draftId);
    if (draft.status !== "draft") throw new Error("Only pending drafts can be rejected.");
    if (!args.note.trim()) throw new Error("A rejection note is required (audit trail).");
    await ctx.db.patch(draft._id, {
      status: "rejected",
      rejectNote: args.note.trim().slice(0, MAX_TEXT),
    });
    await logAudit(
      ctx, ac.org._id, ac.user._id, actorName(ac.user),
      "Rule deadline rejected",
      `${draft.title} — ${args.note.trim()}`,
    );
  },
});

// ---------------------------------------------------------------------
// Lifecycle: acknowledge / complete / extend / vacate / missed / adjust
// ---------------------------------------------------------------------

export const acknowledge = mutation({
  args: { draftId: v.id("ruleDeadlines") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const draft = await loadDraft(ctx, ac, args.draftId);
    if (draft.status !== "approved") {
      throw new Error("Only approved deadlines can be acknowledged.");
    }
    await ctx.db.patch(draft._id, {
      status: "acknowledged",
      acknowledgedAt: Date.now(),
      acknowledgedById: ac.user._id,
    });
  },
});

export const complete = mutation({
  args: { draftId: v.id("ruleDeadlines") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const draft = await loadDraft(ctx, ac, args.draftId);
    if (!["approved", "acknowledged"].includes(draft.status)) {
      throw new Error("Only active deadlines can be completed.");
    }
    await ctx.db.patch(draft._id, {
      status: "completed",
      completedAt: Date.now(),
      completedById: ac.user._id,
    });
    if (draft.deadlineId) {
      const dl = await ctx.db.get(draft.deadlineId);
      if (dl && dl.status === "open") {
        await ctx.db.patch(dl._id, {
          status: "completed",
          completedAt: Date.now(),
          completedById: ac.user._id,
          history: [
            ...(dl.history ?? []),
            {
              at: Date.now(),
              byId: ac.user._id,
              text: "Completed via deadline rules engine.",
            },
          ],
        });
      }
    }
    await logAudit(ctx, draft.orgId, ac.user._id, actorName(ac.user), "Rule deadline completed", draft.title);
  },
});

/**
 * Extend — closes the current lifecycle as `extended` and records who
 * moved the date and why. The original approved deadline is never
 * silently overwritten.
 */
export const extend = mutation({
  args: { draftId: v.id("ruleDeadlines"), newDueDate: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    assertApprover(ac);
    const draft = await loadDraft(ctx, ac, args.draftId);
    if (!["approved", "acknowledged"].includes(draft.status)) {
      throw new Error("Only active deadlines can be extended.");
    }
    assertDate(args.newDueDate, "New due date");
    if (!args.reason.trim()) throw new Error("A reason is required to extend a deadline.");
    await ctx.db.patch(draft._id, {
      status: "extended",
      adjustments: [
        ...(draft.adjustments ?? []),
        {
          at: Date.now(),
          byId: ac.user._id,
          byName: actorName(ac.user),
          reason: args.reason.trim().slice(0, MAX_TEXT),
          oldDueDate: draft.dueDate,
          newDueDate: args.newDueDate.trim(),
        },
      ],
    });
    await logAudit(
      ctx, draft.orgId, ac.user._id, actorName(ac.user),
      "Rule deadline extended",
      `${draft.title}: ${draft.dueDate} → ${args.newDueDate.trim()} — ${args.reason.trim()}`,
    );
  },
});

export const vacate = mutation({
  args: { draftId: v.id("ruleDeadlines"), reason: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    assertApprover(ac);
    const draft = await loadDraft(ctx, ac, args.draftId);
    if (!["approved", "acknowledged"].includes(draft.status)) {
      throw new Error("Only active deadlines can be vacated.");
    }
    if (!args.reason.trim()) throw new Error("A reason is required to vacate a deadline.");
    await ctx.db.patch(draft._id, { status: "vacated" });
    if (draft.deadlineId) {
      const dl = await ctx.db.get(draft.deadlineId);
      if (dl && dl.status === "open") {
        await ctx.db.patch(dl._id, {
          status: "completed",
          completedAt: Date.now(),
          completedById: ac.user._id,
          completionNote: `Vacated — ${args.reason.trim()}`,
          history: [
            ...(dl.history ?? []),
            {
              at: Date.now(),
              byId: ac.user._id,
              text: `Vacated — ${args.reason.trim()}`,
            },
          ],
        });
      }
    }
    await logAudit(
      ctx, draft.orgId, ac.user._id, actorName(ac.user),
      "Rule deadline vacated",
      `${draft.title} — ${args.reason.trim()}`,
    );
  },
});

export const markMissed = mutation({
  args: { draftId: v.id("ruleDeadlines") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    assertApprover(ac);
    const draft = await loadDraft(ctx, ac, args.draftId);
    if (!["approved", "acknowledged"].includes(draft.status)) {
      throw new Error("Only active deadlines can be marked missed.");
    }
    await ctx.db.patch(draft._id, { status: "missed" });
    await logAudit(ctx, draft.orgId, ac.user._id, actorName(ac.user), "Rule deadline marked missed", draft.title);
  },
});

/**
 * Post-approval date correction. Deliberately NOT a silent overwrite:
 * requires an explicit reason, keeps the old date in the audit trail on
 * both the draft and the underlying deadline row.
 */
export const adjustDate = mutation({
  args: { draftId: v.id("ruleDeadlines"), newDueDate: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    assertApprover(ac);
    const draft = await loadDraft(ctx, ac, args.draftId);
    if (draft.status !== "approved" && draft.status !== "acknowledged") {
      throw new Error("Only approved deadlines can be adjusted.");
    }
    assertDate(args.newDueDate, "New due date");
    if (!args.reason.trim()) throw new Error("A reason is required for any adjustment.");
    if (args.newDueDate.trim() === draft.dueDate) {
      throw new Error("The new date is unchanged.");
    }
    await ctx.db.patch(draft._id, {
      dueDate: args.newDueDate.trim(),
      adjustments: [
        ...(draft.adjustments ?? []),
        {
          at: Date.now(),
          byId: ac.user._id,
          byName: actorName(ac.user),
          reason: args.reason.trim().slice(0, MAX_TEXT),
          oldDueDate: draft.dueDate,
          newDueDate: args.newDueDate.trim(),
        },
      ],
    });
    if (draft.deadlineId) {
      const dl = await ctx.db.get(draft.deadlineId);
      if (dl) {
        await ctx.db.patch(dl._id, {
          dueAt: endOfDayIST(args.newDueDate),
          history: [
            ...(dl.history ?? []),
            {
              at: Date.now(),
              byId: ac.user._id,
              text: `Due date adjusted ${draft.dueDate} → ${args.newDueDate.trim()} — ${args.reason.trim()}`,
            },
          ],
        });
      }
    }
    await logAudit(
      ctx, draft.orgId, ac.user._id, actorName(ac.user),
      "Rule deadline adjusted",
      `${draft.title}: ${draft.dueDate} → ${args.newDueDate.trim()} — ${args.reason.trim()}`,
    );
  },
});
