import { v } from "convex/values";
import { query } from "./_generated/server";
import { getAccessContext } from "./access";
import type { Doc } from "./_generated/dataModel";

// =====================================================================
// DAILY WORK — "TODAY'S PRIORITIES" (§9 of the independently developed
// legal workspace features).
//
// A single, deterministic consolidation of the firm's ACTUAL work
// items for one matter-day: overdue work, scheduled hearings, open
// deadlines, pending reviews, and unanswered client requests. Every
// item is real database state — nothing is invented, no scores.
//
// Date discipline (explicit): extracted/proposed dates
// (`timelineProposed`, `suggestions`) are shown DISTINCTLY from
// lawyer-maintained work items. A machine-proposed date is never
// displayed as a verified legal deadline.
// =====================================================================

/** Local end-of-day (Asia/Kolkata) for a YYYY-MM-DD string. */
export function endOfDayIST(dateStr: string): number {
  return new Date(`${dateStr}T23:59:59+05:30`).getTime();
}

export const priorities = query({
  args: {
    matterId: v.id("matters"),
    /** YYYY-MM-DD; defaults to today (IST). */
    onDate: v.optional(v.string()),
    /** Hearing/priority lookahead window in days (default 14). */
    windowDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.orgId !== ac.org._id) return null;

    const day = args.onDate ?? new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const windowDays = args.windowDays ?? 14;
    const endOfToday = endOfDayIST(day);
    const windowEnd = endOfToday + windowDays * 86_400_000;

    const [tasks, hearings, deadlines, orders, requests, suggestions, timeline] =
      await Promise.all([
        ctx.db.query("tasks").withIndex("by_org", (q) => q.eq("orgId", ac.org._id)).collect(),
        ctx.db
          .query("hearings")
          .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
          .collect(),
        ctx.db
          .query("deadlines")
          .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
          .collect(),
        ctx.db
          .query("orders")
          .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
          .collect(),
        ctx.db
          .query("documentRequests")
          .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
          .collect(),
        ctx.db
          .query("taskSuggestions")
          .withIndex("by_matter_status", (q) =>
            q.eq("matterId", args.matterId).eq("status", "proposed"),
          )
          .collect(),
        ctx.db
          .query("matterTimeline")
          .withIndex("by_matter_status", (q) =>
            q.eq("matterId", args.matterId).eq("status", "proposed"),
          )
          .collect(),
      ]);

    // --- Overdue work: tasks + open deadlines past their due time ------
    const overdueTasks = (tasks as Doc<"tasks">[])
      .filter(
        (t) =>
          t.matterId === args.matterId &&
          t.status !== "done" &&
          t.dueAt !== undefined &&
          t.dueAt < endOfToday,
      )
      .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
      .map((t) => ({
        id: t._id,
        title: t.title,
        kind: "task" as const,
        dueAt: t.dueAt,
        assigneeId: t.assigneeId,
      }));

    const openDeadlines = deadlines
      .filter((d) => d.status === "open" && d.dueAt < endOfToday)
      .sort((a, b) => a.dueAt - b.dueAt)
      .map((d) => ({
        id: d._id,
        title: d.title,
        kind: "deadline" as const,
        dueAt: d.dueAt,
        assigneeId: d.responsibleId,
      }));

    const overdue = [
      ...overdueTasks.map((t) => ({ ...t, source: "task" as const })),
      ...openDeadlines.map((d) => ({ ...d, source: "deadline" as const })),
    ];

    // --- Upcoming hearings within the window ---------------------------
    const upcomingHearings = hearings
      .filter((h) => h.status === "scheduled" && h.at >= Date.now() - 6 * 3600_000 && h.at <= windowEnd)
      .sort((a, b) => a.at - b.at)
      .map((h) => ({
        id: h._id,
        title: h.title,
        kind: "hearing" as const,
        at: h.at,
        court: h.court,
        courtroom: h.courtroom,
        purpose: h.purpose,
      }));

    // --- Upcoming open deadlines within the window ---------------------
    const upcomingDeadlines = deadlines
      .filter((d) => d.status === "open" && d.dueAt >= endOfToday && d.dueAt <= windowEnd)
      .sort((a, b) => a.dueAt - b.dueAt)
      .map((d) => ({
        id: d._id,
        title: d.title,
        kind: "deadline" as const,
        dueAt: d.dueAt,
        category: d.category,
      }));

    // --- Pending reviews (items awaiting a lawyer's eye) ---------------
    const unreviewedOrders = orders
      .filter((o) => o.reviewedAt === undefined)
      .sort((a, b) => b.passedOn - a.passedOn)
      .map((o) => ({ id: o._id, title: o.title, passedOn: o.passedOn }));

    const pendingRequests = requests
      .filter((r) => r.status === "requested")
      .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))
      .map((r) => ({
        id: r._id,
        title: r.title,
        dueAt: r.dueAt,
        overdue: r.dueAt !== undefined && r.dueAt < endOfToday,
      }));

    const proposedSuggestions = suggestions.map((s) => ({
      id: s._id,
      title: s.title,
      rationale: s.rationale,
      proposedDueOn: s.proposedDueOn,
      dueBasis: s.dueBasis,
    }));

    // --- Extracted/proposed dates — kept DISTINCT from verified work ---
    const proposedTimelineDates = timeline
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => ({
        id: e._id,
        date: e.date,
        datePrecision: e.datePrecision,
        title: e.title,
        entryKind: e.entryKind,
      }));

    return {
      onDate: day,
      windowDays,
      overdue,
      upcomingHearings,
      upcomingDeadlines,
      pendingReviews: unreviewedOrders,
      clientRequestsAwaitingUpload: pendingRequests,
      aiProposalsAwaitingApproval: proposedSuggestions,
      extractedDatesAwaitingReview: proposedTimelineDates,
      counts: {
        overdue: overdue.length,
        hearings: upcomingHearings.length,
        deadlines: upcomingDeadlines.length,
        unreviewedOrders: unreviewedOrders.length,
        unansweredRequests: pendingRequests.length,
        proposedTasks: proposedSuggestions.length,
        proposedTimeline: proposedTimelineDates.length,
      },
    };
  },
});
