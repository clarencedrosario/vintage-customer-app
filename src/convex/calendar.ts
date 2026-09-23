import { query } from "./_generated/server";
import { v } from "convex/values";
import { getAccessContext, canViewMatter } from "./access";
import type { Doc, Id } from "./_generated/dataModel";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** YYYY-MM-DD of a timestamp in Asia/Kolkata. */
function istDay(ts: number): string {
  return new Date(ts + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** End-of-day (Asia/Kolkata) timestamp for a YYYY-MM-DD string. */
function istDayEnd(day: string): number {
  const end = new Date(`${day}T23:59:59+05:30`).getTime();
  if (Number.isNaN(end)) {
    throw new Error("Date must be in YYYY-MM-DD format.");
  }
  return end;
}

/**
 * Everything scheduled on an organisation-local (IST) day: hearings,
 * deadlines, dated tasks and cause-list rows. Powers the Calendar page and
 * the Court Day view. All matter-linked rows are filtered through the
 * caller's matter-level authorization.
 */
export const day = query({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;

    const dayStart = istDayEnd(args.date) - 24 * 60 * 60 * 1000 + 1;
    const dayEnd = istDayEnd(args.date);

    const orgMatters = await ctx.db
      .query("matters")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const matters = orgMatters.filter((m) => canViewMatter(ac, m));
    const matterById = new Map(matters.map((m) => [m._id, m]));

    // Names for responsible lawyers / checkers.
    const userIds = new Set<Id<"users">>();
    for (const m of matters) {
      if (m.leadLawyerId) userIds.add(m.leadLawyerId);
    }

    // --- Hearings on this day -------------------------------------
    const hearingRows = (
      await Promise.all(
        matters.map((m) =>
          ctx.db
            .query("hearings")
            .withIndex("by_matter", (q) => q.eq("matterId", m._id))
            .collect(),
        ),
      )
    )
      .flat()
      .filter((h) => h.status !== "cancelled" && h.at >= dayStart && h.at <= dayEnd)
      .sort((a, b) => a.at - b.at)
      .map((h) => {
        const m = matterById.get(h.matterId);
        if (m?.leadLawyerId) userIds.add(m.leadLawyerId);
        return {
          _id: h._id,
          matterId: h.matterId,
          matterReference: m?.reference ?? "—",
          matterTitle: m?.title ?? "",
          clientId: m?.clientId,
          title: h.title,
          court: h.court ?? null,
          appearance: h.appearance ?? null,
          at: h.at,
          status: h.status,
        };
      });

    // --- Deadlines due this day -----------------------------------
    const deadlineRows = await ctx.db
      .query("deadlines")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const deadlines = deadlineRows
      .filter(
        (d) =>
          d.status === "open" && d.dueAt >= dayStart && d.dueAt <= dayEnd,
      )
      .sort((a, b) => a.dueAt - b.dueAt)
      .map((d) => {
        if (d.responsibleId) userIds.add(d.responsibleId);
        const m = d.matterId ? matterById.get(d.matterId) : undefined;
        if (m?.leadLawyerId) userIds.add(m.leadLawyerId);
        return {
          _id: d._id,
          matterId: d.matterId,
          matterReference: m?.reference ?? null,
          title: d.title,
          category: d.category,
          dueAt: d.dueAt,
          responsibleId: d.responsibleId ?? null,
        };
      });

    // --- Tasks due this day ----------------------------------------
    const taskRows = await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    const tasks = taskRows
      .filter(
        (t) =>
          t.matterId !== undefined &&
          matterById.has(t.matterId) &&
          t.dueAt !== undefined &&
          t.dueAt >= dayStart &&
          t.dueAt <= dayEnd,
      )
      .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
      .map((t) => {
        if (t.assigneeId) userIds.add(t.assigneeId);
        const m = matterById.get(t.matterId as Id<"matters">);
        if (m?.leadLawyerId) userIds.add(m.leadLawyerId);
        return {
          _id: t._id,
          matterId: t.matterId as Id<"matters">,
          matterReference: m?.reference ?? "—",
          title: t.title,
          dueAt: t.dueAt as number,
          assigneeId: (t.assigneeId ?? null) as Id<"users"> | null,
        };
      });

    // --- Cause-list entries for this day ---------------------------
    const causeList = await ctx.db
      .query("causeListEntries")
      .withIndex("by_org_date", (q) =>
        q.eq("orgId", ac.org._id).eq("listDate", args.date),
      )
      .collect();
    const causeRows = causeList
      .sort((a, b) =>
        (a.itemNumber ?? "").localeCompare(
          b.itemNumber ?? "",
          undefined,
          { numeric: true },
        ),
      )
      .map((r) => {
        if (r.checkedById) userIds.add(r.checkedById);
        return {
          _id: r._id,
          court: r.court,
          itemNumber: r.itemNumber ?? null,
          caseTitle: r.caseTitle,
          caseNumber: r.caseNumber ?? null,
          matterId: r.matterId ?? null,
          sourceName: r.sourceName,
          sourceUrl: r.sourceUrl ?? null,
          checkedAt: r.checkedAt,
        };
      });

    // --- Cause-list rows linked to hearings today (court day brief) -
    const linkedCauseRows = hearingRows.map((h) => {
      const row = causeList.find(
        (c) => c.matterId === h.matterId || c.caseTitle.includes(h.matterReference),
      );
      return {
        hearingId: h._id,
        causeListId: row?._id ?? null,
        itemNumber: row?.itemNumber ?? null,
        sourceName: row?.sourceName ?? null,
      };
    });

    // --- Resolve display names -------------------------------------
    const nameByUser = new Map<Id<"users">, string>();
    for (const id of userIds) {
      const u = await ctx.db.get(id);
      if (u) nameByUser.set(id, u.name ?? u.email ?? "Member");
    }

    return {
      date: args.date,
      hearings: hearingRows.map((h) => ({
        ...h,
        responsibleName:
          (matterById.get(h.matterId)?.leadLawyerId &&
            nameByUser.get(matterById.get(h.matterId)!.leadLawyerId!)) ||
          null,
      })),
      deadlines: deadlines.map((d) => ({
        ...d,
        responsibleName: d.responsibleId
          ? nameByUser.get(d.responsibleId) ?? null
          : null,
      })),
      tasks: tasks.map((t) => ({
        ...t,
        assigneeName: t.assigneeId ? nameByUser.get(t.assigneeId) ?? null : null,
      })),
      causeList: causeRows,
      hearingCauseLinks: linkedCauseRows,
    };
  },
});

/** Distinct dates (IST) with any scheduled item, for calendar highlighting. */
export const markedDays = query({
  args: {
    fromDate: v.string(),
    toDate: v.string(),
  },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const from = istDayEnd(args.fromDate) - 24 * 60 * 60 * 1000 + 1;
    const to = istDayEnd(args.toDate);

    const orgMatters = await ctx.db
      .query("matters")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const matters = orgMatters.filter((m) => canViewMatter(ac, m));
    const matterById = new Map(matters.map((m) => [m._id, m]));

    const counts = new Map<string, { hearings: number; deadlines: number; tasks: number }>();
    const bump = (day: string, key: "hearings" | "deadlines" | "tasks") => {
      const cur = counts.get(day) ?? { hearings: 0, deadlines: 0, tasks: 0 };
      cur[key] += 1;
      counts.set(day, cur);
    };

    for (const m of matters) {
      const hs = await ctx.db
        .query("hearings")
        .withIndex("by_matter", (q) => q.eq("matterId", m._id))
        .collect();
      for (const h of hs) {
        if (h.status !== "cancelled" && h.at >= from && h.at <= to) {
          bump(istDay(h.at), "hearings");
        }
      }
    }

    const deadlineRows = await ctx.db
      .query("deadlines")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    for (const d of deadlineRows) {
      if (
        d.status === "open" &&
        d.dueAt >= from &&
        d.dueAt <= to &&
        (!d.matterId || matterById.has(d.matterId))
      ) {
        bump(istDay(d.dueAt), "deadlines");
      }
    }

    const taskRows = await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    for (const t of taskRows) {
      if (
        t.matterId !== undefined &&
        matterById.has(t.matterId) &&
        t.dueAt !== undefined &&
        t.dueAt >= from &&
        t.dueAt <= to
      ) {
        bump(istDay(t.dueAt), "tasks");
      }
    }

    return Array.from(counts.entries())
      .map(([date, c]) => ({ date, ...c }))
      .sort((a, b) => a.date.localeCompare(b.date));
  },
});
