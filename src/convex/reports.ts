import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { can, canViewMatter, getAccessContext } from "./access";

// ===============================================================
// Chamber reports — permission-scoped aggregates.
//
// Two tiers of visibility:
//  - member = the matters this caller may open (matter-level access).
//  - financials require billing capability; time requires time.log.
// The same engine powers the Reports page, its CSV exports and its
// PDF print, so a user can never export more than they can see.
// ===============================================================

const DAY_MS = 24 * 60 * 60 * 1000;

export type ReportRow = Record<string, string | number | null>;

export type ReportsData = {
  generatedAt: number;
  scopeNote: string;
  permissions: {
    financials: boolean;
    time: boolean;
  };
  matters: {
    rows: ReportRow[];
    summary: {
      total: number;
      open: number;
      inProgress: number;
      onHold: number;
      closed: number;
    };
  };
  hearingsDeadlines: {
    rows: ReportRow[];
    summary: {
      upcomingHearings: number;
      hearingsLast90: number;
      openDeadlines: number;
      overdueDeadlines: number;
    };
  };
  workload: {
    rows: ReportRow[];
    summary: { unassignedTasks: number };
  };
  overdueTasks: {
    rows: ReportRow[];
    summary: { count: number; oldestDays: number | null };
  };
  billableTime: {
    rows: ReportRow[];
    summary: {
      totalHours: number;
      uninvoicedHours: number;
      note: string;
    } | null;
  };
  financials: {
    rows: ReportRow[];
    summary: {
      invoicedMinor: number;
      collectedMinor: number;
      outstandingMinor: number;
      overdueMinor: number;
    } | null;
  };
  documentRequests: {
    rows: ReportRow[];
    summary: {
      total: number;
      accepted: number;
      completionPercent: number | null;
      pending: number;
      overdue: number;
    };
  };
};

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function fmtDateIN(ts: number): string {
  return new Date(ts).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function inr(minor: number): string {
  const abs = Math.abs(Math.round(minor));
  return `${minor < 0 ? "-" : ""}₹${(abs / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  on_hold: "On hold",
  closed: "Closed",
};

function statusLabel(s: string): string {
  return STATUS_LABEL[s] ?? s;
}

// ---------------------------------------------------------------
// Core report builder (shared by all callers/exports)
// ---------------------------------------------------------------

async function buildReports(ctx: QueryCtx): Promise<ReportsData | null> {
  const ac = await getAccessContext(ctx);
  if (!ac) return null;

  const now = Date.now();
  const canFinancials =
    can(ac, "billing.invoice") || can(ac, "billing.payment");
  const canTime = can(ac, "time.log");

  const orgMatters = await ctx.db
    .query("matters")
    .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
    .collect();
  const matters = orgMatters
    .filter((m) => m.archivedAt === undefined)
    .filter((m) => canViewMatter(ac, m));
  const matterById = new Map(matters.map((m) => [m._id, m]));
  const visibleIds = new Set(matters.map((m) => m._id));

  const names = await namesFor(ctx, ac.org._id);

  // ---------------- Matters report ----------------
  const clientNames = new Map<Id<"clients">, string>();
  await Promise.all(
    Array.from(new Set(matters.map((m) => m.clientId))).map(async (cid) => {
      const c = await ctx.db.get(cid);
      if (c) clientNames.set(cid, c.name);
    }),
  );
  const matterRows: ReportRow[] = matters
    .sort((a, b) => (a.reference < b.reference ? -1 : 1))
    .map((m) => ({
      Reference: m.reference,
      Title: m.title,
      Client: clientNames.get(m.clientId) ?? "—",
      Status: statusLabel(m.status),
      Priority: m.priority ?? "normal",
      "Practice area": m.practiceArea,
      "Lead lawyer": m.leadLawyerId ? names.get(m.leadLawyerId) ?? "—" : "—",
      "Court": m.court ?? "",
      "Case number": m.caseNumber ?? "",
      "Opened": fmtDateIN(m.createdAt),
    }));
  const matterSummary = {
    total: matters.length,
    open: matters.filter((m) => m.status === "open").length,
    inProgress: matters.filter((m) => m.status === "in_progress").length,
    onHold: matters.filter((m) => m.status === "on_hold").length,
    closed: matters.filter((m) => m.status === "closed").length,
  };

  // ---------------- Hearings & deadlines ----------------
  const hearings = (await ctx.db.query("hearings").collect()).filter((h) =>
    visibleIds.has(h.matterId),
  );
  const deadlines = await ctx.db
    .query("deadlines")
    .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
    .collect();
  const hdRows: ReportRow[] = [];
  for (const h of hearings) {
    const m = matterById.get(h.matterId)!;
    hdRows.push({
      Type: "Hearing",
      Reference: m.reference,
      Matter: m.title,
      Detail: h.title,
      Court: h.court ?? "",
      Date: fmtDateIN(h.at),
      Status: h.status,
      "Appearing advocate": h.appearingAdvocateId
        ? names.get(h.appearingAdvocateId) ?? "—"
        : "—",
    });
  }
  for (const d of deadlines) {
    const m = d.matterId !== undefined ? matterById.get(d.matterId) : null;
    hdRows.push({
      Type: "Deadline",
      Reference: m?.reference ?? "—",
      Matter: m?.title ?? "Firm-wide",
      Detail: d.title,
      Court: "",
      Date: fmtDateIN(d.dueAt),
      Status:
        d.status === "completed"
          ? "completed"
          : d.dueAt < now
            ? "overdue"
            : "open",
      "Appearing advocate": d.responsibleId
        ? names.get(d.responsibleId) ?? "—"
        : "—",
    });
  }
  hdRows.sort((a, b) => String(a.Date).localeCompare(String(b.Date)));
  const hdSummary = {
    upcomingHearings: hearings.filter(
      (h) => h.status === "scheduled" && h.at > now,
    ).length,
    hearingsLast90: hearings.filter(
      (h) =>
        (h.status === "held" || h.status === "adjourned") &&
        h.at > now - 90 * DAY_MS &&
        h.at <= now,
    ).length,
    openDeadlines: deadlines.filter((d) => d.status === "open").length,
    overdueDeadlines: deadlines.filter(
      (d) => d.status === "open" && d.dueAt < now,
    ).length,
  };

  // ---------------- Team workload ----------------
  const tasks = await ctx.db.query("tasks").collect();
  const orgTasks = tasks.filter(
    (t) => t.matterId === undefined || visibleIds.has(t.matterId),
  );
  const openTasks = orgTasks.filter((t) => t.status !== "done");
  const workload = new Map<
    Id<"users"> | "unassigned",
    {
      name: string;
      openTasks: number;
      overdueTasks: number;
      urgentTasks: number;
      matters: Set<Id<"matters">>;
    }
  >();
  for (const t of openTasks) {
    const key = t.assigneeId ?? "unassigned";
    const row =
      workload.get(key) ??
      {
        name: t.assigneeId ? names.get(t.assigneeId) ?? "Unassigned" : "Unassigned",
        openTasks: 0,
        overdueTasks: 0,
        urgentTasks: 0,
        matters: new Set<Id<"matters">>(),
      };
    row.openTasks += 1;
    if (t.dueAt !== undefined && t.dueAt < now) row.overdueTasks += 1;
    if (t.priority === "urgent") row.urgentTasks += 1;
    if (t.matterId !== undefined) row.matters.add(t.matterId);
    workload.set(key, row);
  }
  const workloadRows: ReportRow[] = Array.from(workload.entries())
    .map(([key, w]) => ({
      Member: key === "unassigned" ? "Unassigned" : w.name,
      "Open tasks": w.openTasks,
      "Overdue tasks": w.overdueTasks,
      "Urgent tasks": w.urgentTasks,
      "Matters touched": w.matters.size,
    }))
    .sort((a, b) => Number(b["Open tasks"]) - Number(a["Open tasks"]));

  // ---------------- Overdue tasks ----------------
  const overdue = openTasks
    .filter((t) => t.dueAt !== undefined && t.dueAt < now)
    .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
  const overdueRows: ReportRow[] = overdue.map((t) => {
    const m = t.matterId !== undefined ? matterById.get(t.matterId) : null;
    return {
      Task: t.title,
      Reference: m?.reference ?? "—",
      Matter: m?.title ?? "Firm-wide",
      Priority: t.priority,
      Assigned: t.assigneeId ? names.get(t.assigneeId) ?? "Unassigned" : "Unassigned",
      "Due": fmtDateIN(t.dueAt!),
      "Days overdue": Math.max(1, Math.floor((now - t.dueAt!) / DAY_MS)),
    };
  });
  const overdueSummary = {
    count: overdue.length,
    oldestDays:
      overdue.length > 0
        ? Math.max(1, Math.floor((now - overdue[0]!.dueAt!) / DAY_MS))
        : null,
  };

  // ---------------- Billable time ----------------
  let billableTime: ReportsData["billableTime"];
  if (canTime) {
    const time = await ctx.db.query("timeEntries").collect();
    const scoped = time.filter((t) => visibleIds.has(t.matterId));
    const byMatter = new Map<
      Id<"matters">,
      { minutes: number; uninvoicedMinutes: number }
    >();
    for (const t of scoped) {
      const cur = byMatter.get(t.matterId) ?? { minutes: 0, uninvoicedMinutes: 0 };
      cur.minutes += t.minutes;
      if (t.invoiceId === undefined) cur.uninvoicedMinutes += t.minutes;
      byMatter.set(t.matterId, cur);
    }
    const timeRows: ReportRow[] = Array.from(byMatter.entries())
      .map(([mid, v]) => {
        const m = matterById.get(mid)!;
        return {
          Reference: m.reference,
          Matter: m.title,
          "Total hours": +(v.minutes / 60).toFixed(2),
          "Uninvoiced hours": +(v.uninvoicedMinutes / 60).toFixed(2),
        };
      })
      .sort((a, b) => Number(b["Total hours"]) - Number(a["Total hours"]));
    const totalMinutes = scoped.reduce((s, t) => s + t.minutes, 0);
    const uninvoicedMinutes = scoped
      .filter((t) => t.invoiceId === undefined)
      .reduce((s, t) => s + t.minutes, 0);
    billableTime = {
      rows: timeRows,
      summary: {
        totalHours: +(totalMinutes / 60).toFixed(2),
        uninvoicedHours: +(uninvoicedMinutes / 60).toFixed(2),
        note: "Time requires the time-logging capability; hours are derived from time entries linked to matters you may open.",
      },
    };
  } else {
    billableTime = {
      rows: [],
      summary: null,
    };
  }

  // ---------------- Financials ----------------
  let financials: ReportsData["financials"];
  if (canFinancials) {
    const invoices = (
      await ctx.db
        .query("invoices")
        .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
        .collect()
    ).filter((i) => visibleIds.has(i.matterId));
    const invoiceIds = new Set(invoices.map((i) => i._id));
    const payments = (await ctx.db.query("payments").collect()).filter((p) =>
      invoiceIds.has(p.invoiceId),
    );
    const active = invoices.filter(
      (i) =>
        i.status !== "cancelled" && i.status !== "draft" && i.status !== "credited",
    );
    const byMatter = new Map<
      Id<"matters">,
      { invoiced: number; collected: number; outstanding: number }
    >();
    for (const i of active) {
      const cur =
        byMatter.get(i.matterId) ??
        { invoiced: 0, collected: 0, outstanding: 0 };
      cur.invoiced += i.totalMinor;
      cur.outstanding += Math.max(
        0,
        i.totalMinor - i.amountPaidMinor - (i.amountCreditedMinor ?? 0),
      );
      byMatter.set(i.matterId, cur);
    }
    for (const p of payments) {
      const inv = invoices.find((i) => i._id === p.invoiceId);
      if (!inv) continue;
      const cur = byMatter.get(inv.matterId);
      if (cur) cur.collected += p.amountMinor - (p.refundedMinor ?? 0);
    }
    const finRows: ReportRow[] = Array.from(byMatter.entries())
      .map(([mid, v]) => {
        const m = matterById.get(mid)!;
        return {
          Reference: m.reference,
          Matter: m.title,
          Client: clientNames.get(m.clientId) ?? "—",
          Invoiced: inr(v.invoiced),
          Collected: inr(v.collected),
          Outstanding: inr(v.outstanding),
        };
      })
      .sort(
        (a, b) =>
          parseInrMinor(String(b.Outstanding)) - parseInrMinor(String(a.Outstanding)),
      );
    financials = {
      rows: finRows,
      summary: {
        invoicedMinor: active.reduce((s, i) => s + i.totalMinor, 0),
        collectedMinor: payments.reduce(
          (s, p) => s + p.amountMinor - (p.refundedMinor ?? 0),
          0,
        ),
        outstandingMinor: active.reduce(
          (s, i) =>
            s + Math.max(0, i.totalMinor - i.amountPaidMinor - (i.amountCreditedMinor ?? 0)),
          0,
        ),
        overdueMinor: active
          .filter((i) => i.status !== "paid" && i.dueOn && i.dueOn < todayIN())
          .reduce(
            (s, i) =>
              s +
              Math.max(0, i.totalMinor - i.amountPaidMinor - (i.amountCreditedMinor ?? 0)),
            0,
          ),
      },
    };
  } else {
    financials = {
      rows: [],
      summary: null,
    };
  }

  // ---------------- Document-request completion ----------------
  const docRequests = (
    await ctx.db.query("documentRequests").collect()
  ).filter((r) => visibleIds.has(r.matterId));
  const drRows: ReportRow[] = docRequests
    .map((r) => {
      const m = matterById.get(r.matterId)!;
      return {
        Reference: m.reference,
        Matter: m.title,
        Request: r.title,
        Status: r.status,
        "Due": r.dueAt !== undefined ? fmtDateIN(r.dueAt) : "",
        "Overdue":
          r.status !== "accepted" && r.status !== "rejected" &&
          r.dueAt !== undefined && r.dueAt < now
            ? "yes"
            : "no",
        "Reviewed by": r.reviewedById ? names.get(r.reviewedById) ?? "—" : "",
      };
    })
    .sort((a, b) => String(a.Reference).localeCompare(String(b.Reference)));
  const acceptedCount = docRequests.filter((r) => r.status === "accepted").length;
  const rejectedCount = docRequests.filter((r) => r.status === "rejected").length;
  const drSummary = {
    total: docRequests.length,
    accepted: acceptedCount,
    completionPercent:
      acceptedCount + rejectedCount > 0
        ? Math.round((acceptedCount / (acceptedCount + rejectedCount)) * 100)
        : acceptedCount === docRequests.length && docRequests.length > 0
          ? 100
          : null,
    pending: docRequests.filter(
      (r) =>
        r.status === "requested" ||
        r.status === "uploaded" ||
        r.status === "under_review",
    ).length,
    overdue: docRequests.filter(
      (r) =>
        r.status !== "accepted" &&
        r.status !== "rejected" &&
        r.dueAt !== undefined &&
        r.dueAt < now,
    ).length,
  };

  const scopeNote =
    canFinancials && canTime
      ? "All amounts are in rupees; time is in hours. Figures reflect only the matters you are permitted to open."
      : "Figures reflect only the matters you are permitted to open; some sections are hidden because your role lacks the relevant capability.";

  return {
    generatedAt: now,
    scopeNote,
    permissions: { financials: canFinancials, time: canTime },
    matters: { rows: matterRows, summary: matterSummary },
    hearingsDeadlines: { rows: hdRows, summary: hdSummary },
    workload: { rows: workloadRows, summary: { unassignedTasks: workload.get("unassigned")?.openTasks ?? 0 } },
    overdueTasks: { rows: overdueRows, summary: overdueSummary },
    billableTime,
    financials,
    documentRequests: { rows: drRows, summary: drSummary },
  };
}

// ---------------------------------------------------------------
// Shared helpers used above
// ---------------------------------------------------------------

async function namesFor(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
): Promise<Map<Id<"users">, string>> {
  const rows = await ctx.db
    .query("memberships")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const users = (
    await Promise.all(rows.map((m) => ctx.db.get(m.userId)))
  ).filter(Boolean) as Doc<"users">[];
  return new Map(
    users.map((u) => [u._id, u.name ?? u.email ?? "Team member"]),
  );
}

function todayIN(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function parseInrMinor(s: string): number {
  const m = s.match(/[\d,]+(\.\d+)?/);
  if (!m) return 0;
  return Math.round(parseFloat(m[0].replace(/,/g, "")) * 100);
}

/** The single source for page + CSV + PDF so scope can never diverge. */
export const get = query({
  args: {},
  handler: async (ctx): Promise<ReportsData | null> => buildReports(ctx),
});
