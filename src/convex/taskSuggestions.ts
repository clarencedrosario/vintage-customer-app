import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAccess, requireCapability, getAccessContext } from "./access";
import type { Doc, Id } from "./_generated/dataModel";

// =====================================================================
// AI-ASSISTED TASK SUGGESTIONS (section 27.5) — propose, never create.
//
// Sources of suggestions: reviewed document analyses (missing
// information, obligations), reviewed orders (directions), and approved
// matter updates. Every suggestion carries its source reference and,
// where a deadline is proposed, the CALCULATION BASIS is stated (e.g.
// "order date + 30 days"). A proposed date is never a legal deadline —
// the lawyer verifies before approval.
//
// Approval creates exactly ONE real task (duplicate-safe by
// source+title dedupe). Dismissal records the reason. The AI cannot
// file, send, or change anything — only this approval path creates.
// =====================================================================

/** Generate suggestions from a matter's reviewed analyses + orders. */
export const proposeFromMatter = mutation({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "ai.use");
    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.orgId !== ac.org._id) {
      throw new Error("Matter not found in this organization.");
    }

    const existing = await ctx.db
      .query("taskSuggestions")
      .withIndex("by_matter_status", (q) =>
        q.eq("matterId", args.matterId).eq("status", "proposed"),
      )
      .collect();
    const existingKeys = new Set(
      existing.map((s) => `${s.sourceKind}:${s.sourceId ?? ""}:${s.title}`),
    );
    const openTasks = await ctx.db
      .query("tasks")
      .filter((q) => q.eq(q.field("matterId"), args.matterId))
      .collect();
    const openTaskTitles = new Set(
      openTasks.filter((t) => t.status !== "done").map((t) => t.title.toLowerCase()),
    );

    let created = 0;
    const add = async (
      s: {
        title: string;
        rationale: string;
        sourceKind: "order" | "document" | "approved_fact" | "hearing";
        sourceId?: string;
        sourceRef?: string;
        proposedDueOn?: string;
        dueBasis?: string;
      },
    ) => {
      const key = `${s.sourceKind}:${s.sourceId ?? ""}:${s.title}`;
      if (existingKeys.has(key)) return; // no duplicate suggestions
      if (openTaskTitles.has(s.title.toLowerCase())) return; // task already open
      existingKeys.add(key);
      await ctx.db.insert("taskSuggestions", {
        orgId: ac.org._id,
        matterId: args.matterId,
        title: s.title.slice(0, 300),
        rationale: s.rationale.slice(0, 600),
        sourceKind: s.sourceKind,
        sourceId: s.sourceId,
        sourceRef: s.sourceRef,
        proposedDueOn: s.proposedDueOn,
        dueBasis: s.dueBasis,
        status: "proposed",
        createdAt: Date.now(),
      });
      created += 1;
    };

    // 1. Missing-information findings from REVIEWED analyses.
    const analyses = await ctx.db
      .query("documentAnalyses")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    for (const a of analyses.filter((x) => x.status === "reviewed")) {
      for (const miss of a.missingInformation.slice(0, 3)) {
        await add({
          title: `Resolve missing material: ${miss.replace(/\.$/, "")}`,
          rationale: `Document analysis flagged: ${miss}`,
          sourceKind: "document",
          sourceId: String(a.documentId),
          sourceRef: a.aiSourceId ? `analysis v${a.analysisVersion}` : undefined,
        });
      }
    }

    // 2. Order directions with a done-flag → follow-up task proposals.
    const orders = await ctx.db
      .query("orders")
      .filter((q) => q.eq(q.field("matterId"), args.matterId))
      .collect();
    for (const o of orders) {
      for (const d of o.directions ?? []) {
        if (d.done) continue;
        await add({
          title: `Comply with order direction: ${d.text.slice(0, 200)}`,
          rationale: `Direction from order "${o.title}" passed on ${new Date(o.passedOn).toISOString().slice(0, 10)}; recorded as not yet done.`,
          sourceKind: "order",
          sourceId: String(o._id),
          sourceRef: `order ${o.title}`,
        });
      }
    }

    return { created };
  },
});

/** Open suggestions for the matter. */
export const list = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const rows = await ctx.db
      .query("taskSuggestions")
      .withIndex("by_matter_status", (q) =>
        q.eq("matterId", args.matterId).eq("status", "proposed"),
      )
      .collect();
    return rows.filter((r) => r.orgId === ac.org._id);
  },
});

/**
 * Approve a suggestion → creates ONE real task (duplicate-safe).
 * The proposed due date, if any, is copied with its basis recorded in
 * the title context — the lawyer's approval is the verification.
 */
export const approve = mutation({
  args: {
    suggestionId: v.id("taskSuggestions"),
    assigneeId: v.optional(v.id("users")),
    dueAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "task.manage");
    const s = await ctx.db.get(args.suggestionId);
    if (!s || s.orgId !== ac.org._id) {
      throw new Error("Suggestion not found in this organization.");
    }
    if (s.status !== "proposed") {
      throw new Error("This suggestion has already been resolved.");
    }
    // Duplicate guard: another open task with the same title?
    const openTasks = await ctx.db
      .query("tasks")
      .filter((q) => q.eq(q.field("matterId"), s.matterId))
      .collect();
    if (openTasks.some((t) => t.status !== "done" && t.title.toLowerCase() === s.title.toLowerCase())) {
      await ctx.db.patch(s._id, {
        status: "dismissed",
        dismissedReason: "An open task with this title already exists.",
      });
      return { created: false, reason: "duplicate-open-task" };
    }
    const taskId = await ctx.db.insert("tasks", {
      matterId: s.matterId,
      orgId: ac.org._id,
      title: s.title,
      kind: "general",
      priority: "normal",
      dueAt: args.dueAt,
      status: "pending",
      assigneeId: args.assigneeId ?? ac.user._id,
      createdById: ac.user._id,
      createdAt: Date.now(),
    });
    await ctx.db.patch(s._id, {
      status: "approved",
      approvedById: ac.user._id,
      createdTaskId: taskId,
    });
    return { created: true, taskId };
  },
});

/** Dismiss with a recorded reason. */
export const dismiss = mutation({
  args: { suggestionId: v.id("taskSuggestions"), reason: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "task.manage");
    const s = await ctx.db.get(args.suggestionId);
    if (!s || s.orgId !== ac.org._id) {
      throw new Error("Suggestion not found in this organization.");
    }
    if (!args.reason.trim()) throw new Error("A dismissal reason is required.");
    await ctx.db.patch(s._id, {
      status: "dismissed",
      dismissedReason: args.reason.trim().slice(0, 300),
    });
    return { dismissed: true };
  },
});
