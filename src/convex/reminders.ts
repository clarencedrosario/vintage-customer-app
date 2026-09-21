// =====================================================================
// Reminder scan + automation engine (invoked by crons.ts on the
// deployment scheduler — no dashboard visits required).
//
// Each pass:
//  1. Hearing reminders  — hearings in the next 24h, to the lead lawyer
//     and appearing advocate (deduped per hearing per day).
//  2. Deadline reminders — deadlines whose reminderAt has arrived or
//     whose due date is today/past, to the responsible person.
//  3. Invoice follow-ups — invoices past due with a balance, to
//     billing-capable members.
//  4. Automation rules   — for each enabled rule matching the trigger,
//     execute its action once per occurrence (unique occurrenceKey).
//
// Automated task creation is REVIEWABLE: tasks carry automationRunId
// and the run row starts with reviewState "pending".
// =====================================================================

import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAccess, can } from "./access";

// ---------------------------------------------------------------------
// Local-day helpers (Asia/Kolkata — date-only things are never overdue
// before their local due date ends; IST is UTC+5:30).
// ---------------------------------------------------------------------

function istDayKey(nowMs: number): string {
  return new Date(nowMs + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** End of the civil IST day containing the given timestamp. */
function endOfKolkataDay(nowMs: number): number {
  const istNow = nowMs + 5.5 * 3600 * 1000;
  const startOfIstDay = Math.floor(istNow / 86400000) * 86400000;
  return startOfIstDay + 86400000 - 5.5 * 3600 * 1000 - 1;
}

/** End of a "YYYY-MM-DD" local day. */
function endOfLocalDate(date: string): number {
  // Noon UTC is always inside the same IST civil date.
  return endOfKolkataDay(Date.parse(`${date}T12:00:00Z`));
}

function formatWhen(at: number): string {
  return new Date(at).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatINR(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN")}`;
}

// ---------------------------------------------------------------------
// The scheduled scan
// ---------------------------------------------------------------------

export const runScan = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ created: number }> => {
    const now = Date.now();
    const in24h = now + 24 * 3600 * 1000;
    const todayEnd = endOfKolkataDay(now);
    const dayKey = istDayKey(now);

    let created = 0;

    // ---- 1. Hearing reminders (next 24h) -----------------------------
    const hearings = await ctx.db
      .query("hearings")
      .withIndex("by_status", (q) => q.eq("status", "scheduled"))
      .collect();
    const hearingSoon = hearings.filter((h) => h.at > now && h.at <= in24h);

    for (const h of hearingSoon) {
      const matter = await ctx.db.get(h.matterId);
      if (!matter) continue;
      const targets = new Set<Id<"users">>();
      if (matter.leadLawyerId) targets.add(matter.leadLawyerId);
      if (h.appearingAdvocateId) targets.add(h.appearingAdvocateId);
      for (const uid of targets) {
        const id = await ctx.runMutation(internal.notifications.createInternal, {
          orgId: matter.orgId,
          userId: uid,
          kind: "hearing_reminder",
          title: `Hearing ${formatWhen(h.at)} — ${matter.reference}`,
          body: h.purpose ? `${matter.title} · ${h.purpose}` : matter.title,
          linkTo: `/matters/${matter._id}?tab=hearings`,
          dedupeKey: `hearing:${h._id}:${dayKey}:${uid}`,
        });
        if (id) created += 1;
      }
    }

    // ---- 2. Deadline reminders ---------------------------------------
    const deadlines = await ctx.db
      .query("deadlines")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .collect();

    for (const d of deadlines) {
      if (!d.responsibleId) continue;
      const dueTodayOrPast = d.dueAt <= todayEnd;
      const onReminderDay = d.reminderAt !== undefined && d.reminderAt <= now && d.reminderAt > now - 24 * 3600 * 1000;
      if (!dueTodayOrPast && !onReminderDay) continue;
      const overdue = dueTodayOrPast && d.dueAt < now;
      const matter = d.matterId ? await ctx.db.get(d.matterId) : null;
      const id = await ctx.runMutation(internal.notifications.createInternal, {
        orgId: d.orgId,
        userId: d.responsibleId,
        kind: "deadline_reminder",
        title: overdue
          ? `Overdue deadline — ${d.title}`
          : `Deadline ${formatWhen(d.dueAt)} — ${d.title}`,
        body: matter ? `${matter.reference} · ${d.category}` : d.category,
        linkTo: matter ? `/matters/${matter._id}?tab=tasks` : "/tasks",
        dedupeKey: `deadline:${d._id}:${overdue ? "overdue" : dayKey}`,
      });
      if (id) created += 1;
    }

    // ---- 3. Invoice follow-ups (overdue with balance) -----------------
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_org")
      .collect();

    for (const inv of invoices) {
      if (inv.status !== "sent" && inv.status !== "partially_paid") continue;
      if (!inv.dueOn) continue;
      const dueEnd = endOfLocalDate(inv.dueOn);
      if (dueEnd >= now) continue;
      const balance = inv.totalMinor - inv.amountPaidMinor;
      if (balance <= 0) continue;
      const client = await ctx.db.get(inv.clientId);
      const members = await ctx.db
        .query("memberships")
        .withIndex("by_org", (q) => q.eq("orgId", inv.orgId))
        .collect();
      for (const m of members) {
        if (m.status !== "active") continue;
        if (
          m.orgRole !== "owner" &&
          m.orgRole !== "accountant" &&
          m.orgRole !== "administrator"
        ) {
          continue;
        }
        const id = await ctx.runMutation(internal.notifications.createInternal, {
          orgId: inv.orgId,
          userId: m.userId,
          kind: "invoice_followup",
          title: `Invoice ${inv.number} overdue — ${formatINR(balance)}`,
          body: `${client?.name ?? "Client"} · was due ${inv.dueOn}`,
          linkTo: "/billing",
          dedupeKey: `invoice:${inv._id}:${dayKey}:${m.userId}`,
        });
        if (id) created += 1;
      }
    }

    // ---- 4. Automation rules ------------------------------------------
    const rules = await ctx.db
      .query("automationRules")
      .withIndex("by_org")
      .collect();

    for (const rule of rules) {
      if (!rule.enabled) continue;

      if (rule.trigger === "deadline_reminder") {
        for (const d of deadlines) {
          if (!d.responsibleId) continue;
          const dueTodayOrPast = d.dueAt <= todayEnd;
          const onReminderDay =
            d.reminderAt !== undefined &&
            d.reminderAt <= now &&
            d.reminderAt > now - 24 * 3600 * 1000;
          if (!dueTodayOrPast && !onReminderDay) continue;
          if (rule.practiceArea) {
            const matter = d.matterId ? await ctx.db.get(d.matterId) : null;
            if (!matter || matter.practiceArea !== rule.practiceArea) continue;
          }
          created += await executeRule(ctx, rule, `deadline_reminder:${d._id}:${dayKey}`, {
            targetUserId: d.responsibleId,
            matterId: d.matterId ?? null,
            subjectLine: `Deadline — ${d.title}`,
          });
        }
      } else if (rule.trigger === "hearing_tomorrow") {
        for (const h of hearingSoon) {
          const matter = await ctx.db.get(h.matterId);
          if (!matter) continue;
          if (rule.practiceArea && matter.practiceArea !== rule.practiceArea) continue;
          const target = rule.ownerUserId ?? matter.leadLawyerId;
          if (!target) continue;
          created += await executeRule(ctx, rule, `hearing_tomorrow:${h._id}:${dayKey}`, {
            targetUserId: target,
            matterId: h.matterId,
            subjectLine: `Hearing ${formatWhen(h.at)} — ${matter.reference}`,
          });
        }
      } else if (rule.trigger === "invoice_overdue") {
        for (const inv of invoices) {
          if (inv.status !== "sent" && inv.status !== "partially_paid") continue;
          if (!inv.dueOn) continue;
          const daysOver = Math.floor((now - endOfLocalDate(inv.dueOn)) / 86400000);
          if (daysOver < Math.max(1, rule.minDaysOverdue ?? 1)) continue;
          if (inv.totalMinor - inv.amountPaidMinor <= 0) continue;
          const target = rule.ownerUserId;
          if (!target) continue;
          created += await executeRule(ctx, rule, `invoice_overdue:${inv._id}:${dayKey}`, {
            targetUserId: target,
            matterId: inv.matterId,
            subjectLine: `Invoice ${inv.number} — ${daysOver} day(s) overdue`,
          });
        }
      }
    }

    return { created };
  },
});

/** Heartbeat no-op — keeps the schedule observable from run history. */
export const rescheduleCron = internalMutation({
  args: {},
  handler: async () => ({ ok: true as const }),
});

// ---------------------------------------------------------------------
// Rule execution — duplicate-safe, audited, reviewable
// ---------------------------------------------------------------------

type ExecuteArgs = {
  targetUserId: Id<"users">;
  matterId: Id<"matters"> | null;
  subjectLine: string;
};

async function executeRule(
  ctx: MutationCtx,
  rule: Doc<"automationRules">,
  occurrenceKey: string,
  args: ExecuteArgs,
): Promise<number> {
  // Duplicate prevention at the storage layer: one run per occurrence.
  const existing = await ctx.db
    .query("automationRuns")
    .withIndex("by_occurrence", (q) => q.eq("occurrenceKey", occurrenceKey))
    .first();
  if (existing) return 0;

  const runId = await ctx.db.insert("automationRuns", {
    ruleId: rule._id,
    orgId: rule.orgId,
    occurrenceKey,
    status: "succeeded",
    ranAt: Date.now(),
  });

  try {
    if (rule.action === "notify_user") {
      await ctx.runMutation(internal.notifications.createInternal, {
        orgId: rule.orgId,
        userId: args.targetUserId,
        kind: "automation",
        title: `${rule.name}: ${args.subjectLine}`.slice(0, 200),
        body: `Automated rule "${rule.name}".`,
        linkTo: args.matterId ? `/matters/${args.matterId}` : undefined,
        dedupeKey: `automation:${occurrenceKey}:${args.targetUserId}`,
      });
      await ctx.db.patch(runId, { notifiedUserId: args.targetUserId });
    } else if (rule.action === "create_task") {
      const title = `${rule.taskTitle ?? rule.name} — ${args.subjectLine}`.slice(0, 180);
      const dueInDays = rule.taskDueInDays ?? 1;
      const taskId = await ctx.db.insert("tasks", {
        orgId: rule.orgId,
        matterId: args.matterId ?? undefined,
        title,
        kind: "general",
        priority: "normal",
        dueAt: Date.now() + dueInDays * 86400000,
        status: "pending",
        assigneeId: args.targetUserId,
        // Provenance: created by automation, pending human review.
        automationRunId: runId,
        createdById: args.targetUserId,
        createdAt: Date.now(),
      });
      await ctx.db.patch(runId, {
        createdTaskId: taskId,
        reviewState: "pending",
      });
    } else if (rule.action === "whatsapp_template") {
      // External send: requires the rule's recorded authorization AND the
      // recipient's opt-in — enforced again here before anything dispatches.
      if (!rule.whatsappAuthorized || !rule.templateName) {
        await ctx.db.patch(runId, {
          status: "skipped",
          detail: "WhatsApp action is missing recorded authorization or a template.",
        });
        return 0;
      }
      if (!args.matterId) {
        await ctx.db.patch(runId, { status: "skipped", detail: "No matter attached to this occurrence." });
        return 0;
      }
      const matter = await ctx.db.get(args.matterId);
      if (!matter) {
        await ctx.db.patch(runId, { status: "skipped", detail: "Matter not found." });
        return 0;
      }
      const client = await ctx.db.get(matter.clientId);
      const clientUserId = client?.userId;
      if (!clientUserId) {
        await ctx.db.patch(runId, { status: "skipped", detail: "Client has no portal identity." });
        return 0;
      }
      const prefs = await ctx.db
        .query("commPreferences")
        .withIndex("by_org_user", (q) =>
          q.eq("orgId", rule.orgId).eq("userId", clientUserId),
        )
        .first();
      if (!prefs?.whatsappEnabled || !prefs.whatsappNumber) {
        await ctx.db.patch(runId, {
          status: "skipped",
          detail: "Client has not opted in to WhatsApp.",
        });
        return 0;
      }
      await ctx.scheduler.runAfter(0, api.notify.sendWhatsappTemplate, {
        orgId: rule.orgId,
        to: prefs.whatsappNumber,
        recipientUserId: client.userId,
        category: "automation",
        templateName: rule.templateName,
        params: [client.name, matter.reference, args.subjectLine, ""],
      });
      await ctx.db.patch(runId, {
        detail: `WhatsApp template "${rule.templateName}" dispatched to the opted-in client.`,
      });
    }
    return 1;
  } catch (e) {
    // Failure handling: audit the failure and free the occurrence key so
    // the next scheduled pass can retry cleanly.
    await ctx.db.patch(runId, {
      status: "failed",
      failureReason: e instanceof Error ? e.message.slice(0, 400) : "Unknown error",
    });
    await ctx.db.patch(runId, {
      occurrenceKey: `${occurrenceKey}:failed:${runId}`,
    });
    return 0;
  }
}

// ---------------------------------------------------------------------
// Automation rules — CRUD (management gated on team.manage)
// ---------------------------------------------------------------------

const ruleShape = {
  name: v.string(),
  trigger: v.union(
    v.literal("deadline_reminder"),
    v.literal("hearing_tomorrow"),
    v.literal("invoice_overdue"),
  ),
  action: v.union(
    v.literal("notify_user"),
    v.literal("create_task"),
    v.literal("whatsapp_template"),
  ),
  practiceArea: v.optional(v.string()),
  minDaysOverdue: v.optional(v.number()),
  ownerUserId: v.optional(v.id("users")),
  taskTitle: v.optional(v.string()),
  taskDueInDays: v.optional(v.number()),
  templateName: v.optional(v.string()),
  whatsappAuthorized: v.optional(v.boolean()),
};

function assertRuleValid(args: {
  action: "notify_user" | "create_task" | "whatsapp_template";
  ownerUserId?: Id<"users">;
  templateName?: string;
  whatsappAuthorized?: boolean;
}) {
  if (
    (args.action === "notify_user" || args.action === "create_task") &&
    !args.ownerUserId
  ) {
    throw new Error("Choose a responsible owner for this rule.");
  }
  if (args.action === "whatsapp_template") {
    if (!args.templateName) {
      throw new Error("Choose the approved WhatsApp template to send.");
    }
    if (!args.whatsappAuthorized) {
      throw new Error(
        "External sends need explicit authorization: confirm you approve WhatsApp messages to opted-in clients for this rule.",
      );
    }
  }
}

export const listRules = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    const rules = await ctx.db
      .query("automationRules")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    return rules.sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const saveRule = mutation({
  args: { ruleId: v.optional(v.id("automationRules")), ...ruleShape, enabled: v.boolean() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "team.manage")) {
      throw new Error("Only owners and administrators can manage automation rules.");
    }
    assertRuleValid(args);
    if (args.ownerUserId) {
      const rows = await ctx.db
        .query("memberships")
        .withIndex("by_org_user", (q) =>
          q.eq("orgId", ac.org._id).eq("userId", args.ownerUserId!),
        )
        .collect();
      if (!rows[0] || rows[0].status !== "active") {
        throw new Error("The responsible owner must be an active member of the firm.");
      }
    }
    const now = Date.now();
    const fields = {
      orgId: ac.org._id,
      name: args.name.slice(0, 120),
      enabled: args.enabled,
      trigger: args.trigger,
      action: args.action,
      practiceArea: args.practiceArea?.trim() || undefined,
      minDaysOverdue: args.minDaysOverdue,
      ownerUserId: args.ownerUserId,
      taskTitle: args.taskTitle?.trim() || undefined,
      taskDueInDays: args.taskDueInDays,
      templateName: args.templateName?.trim() || undefined,
      whatsappAuthorized: args.whatsappAuthorized,
      updatedAt: now,
    };
    if (args.ruleId) {
      const rule = await ctx.db.get(args.ruleId);
      if (!rule || rule.orgId !== ac.org._id) throw new Error("Rule not found.");
      await ctx.db.patch(args.ruleId, fields);
      return args.ruleId;
    }
    return await ctx.db.insert("automationRules", {
      ...fields,
      createdById: ac.user._id,
      createdAt: now,
    });
  },
});

export const setRuleEnabled = mutation({
  args: { ruleId: v.id("automationRules"), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "team.manage")) {
      throw new Error("Only owners and administrators can manage automation rules.");
    }
    const rule = await ctx.db.get(args.ruleId);
    if (!rule || rule.orgId !== ac.org._id) throw new Error("Rule not found.");
    await ctx.db.patch(args.ruleId, { enabled: args.enabled, updatedAt: Date.now() });
  },
});

export const deleteRule = mutation({
  args: { ruleId: v.id("automationRules") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "team.manage")) {
      throw new Error("Only owners and administrators can manage automation rules.");
    }
    const rule = await ctx.db.get(args.ruleId);
    if (!rule || rule.orgId !== ac.org._id) throw new Error("Rule not found.");
    await ctx.db.delete(args.ruleId);
  },
});

/** Run a rule immediately (manual occurrence; still deduped and audited). */
export const runRuleNow = mutation({
  args: { ruleId: v.id("automationRules") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "team.manage")) {
      throw new Error("Only owners and administrators can run rules.");
    }
    const rule = await ctx.db.get(args.ruleId);
    if (!rule || rule.orgId !== ac.org._id) throw new Error("Rule not found.");
    if (!rule.enabled) throw new Error("Enable the rule before running it.");

    const key = `manual:${rule._id}:${Date.now()}`;
    let executed = 0;
    if (rule.trigger === "invoice_overdue") {
      // For invoice rules, execute against every currently-matching invoice.
      const invoices = await ctx.db
        .query("invoices")
        .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
        .collect();
      const now = Date.now();
      for (const inv of invoices) {
        if (inv.status !== "sent" && inv.status !== "partially_paid" || !inv.dueOn) continue;
        const daysOver = Math.floor((now - endOfLocalDate(inv.dueOn)) / 86400000);
        if (daysOver < Math.max(1, rule.minDaysOverdue ?? 1)) continue;
        if (inv.totalMinor - inv.amountPaidMinor <= 0) continue;
        const target = rule.ownerUserId;
        if (!target) continue;
        executed += await executeRule(ctx, rule, `manual:${rule._id}:${inv._id}:${now}`, {
          targetUserId: target,
          matterId: inv.matterId,
          subjectLine: `Invoice ${inv.number} — ${daysOver} day(s) overdue`,
        });
      }
    } else if (rule.ownerUserId) {
      executed = await executeRule(ctx, rule, key, {
        targetUserId: rule.ownerUserId,
        matterId: null,
        subjectLine: "Manual run",
      });
    }
    return { executed };
  },
});

// ---------------------------------------------------------------------
// Execution history + task review
// ---------------------------------------------------------------------

export const runHistory = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const rules = await ctx.db
      .query("automationRules")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const byId = new Map(rules.map((r) => [r._id, r]));
    const runs = await ctx.db.query("automationRuns").collect();
    return runs
      .filter((r) => byId.has(r.ruleId))
      .sort((a, b) => b.ranAt - a.ranAt)
      .slice(0, Math.min(args.limit ?? 80, 200))
      .map((r) => ({
        ...r,
        ruleName: byId.get(r.ruleId)?.name ?? "Deleted rule",
      }));
  },
});

/** Confirm or reject an automated task — the human review step. */
export const reviewRun = mutation({
  args: {
    runId: v.id("automationRuns"),
    decision: v.union(v.literal("confirmed"), v.literal("rejected")),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.orgId !== ac.org._id) throw new Error("Run not found.");
    const rule = await ctx.db.get(run.ruleId);
    const isOwner = rule?.ownerUserId === ac.user._id;
    if (!can(ac, "task.manage") && !isOwner) {
      throw new Error("Only task managers or the rule's owner can review automated tasks.");
    }
    await ctx.db.patch(args.runId, { reviewState: args.decision });
    if (args.decision === "rejected" && run.createdTaskId) {
      const task = await ctx.db.get(run.createdTaskId);
      if (task && task.status === "pending") {
        await ctx.db.patch(run.createdTaskId, {
          status: "done",
          completedAt: Date.now(),
          completedById: ac.user._id,
          completionNote: "Rejected during automation review.",
        });
      }
    }
  },
});

// ---------------------------------------------------------------------
// User notification preferences (channels the user accepts)
// ---------------------------------------------------------------------

export const getMyPreferences = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    const row = await ctx.db
      .query("userNotificationPrefs")
      .withIndex("by_user", (q) => q.eq("userId", ac.user._id))
      .first();
    return (
      row ?? {
        inApp: true,
        emailUpdates: false,
        mutedKinds: [] as string[],
        userId: ac.user._id,
      }
    );
  },
});

export const saveMyPreferences = mutation({
  args: {
    emailUpdates: v.boolean(),
    mutedKinds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const row = await ctx.db
      .query("userNotificationPrefs")
      .withIndex("by_user", (q) => q.eq("userId", ac.user._id))
      .first();
    if (row) {
      await ctx.db.patch(row._id, {
        emailUpdates: args.emailUpdates,
        mutedKinds: args.mutedKinds,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("userNotificationPrefs", {
        userId: ac.user._id,
        inApp: true,
        emailUpdates: args.emailUpdates,
        mutedKinds: args.mutedKinds,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  },
});

export type { QueryCtx };
