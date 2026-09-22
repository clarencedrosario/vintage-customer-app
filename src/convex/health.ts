import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { canViewMatter, getAccessContext } from "./access";

// ===============================================================
// Matter health — operational flags, never outcome predictions.
//
// A flag says "something in the file needs attention" and shows the
// evidence behind it. It never implies the matter is strong or weak:
// a winning case with overdue tasks still shows overdue tasks.
// ===============================================================

const DAY_MS = 24 * 60 * 60 * 1000;
/** A matter with no client-visible update in this window is "stale". */
const STALE_AFTER_DAYS = 21;
/** Matters younger than this are exempt from the staleness flag. */
const STALE_GRACE_DAYS = 7;

export type FlagKey =
  | "no_next_step"
  | "overdue_tasks"
  | "order_unreviewed"
  | "stale_updates"
  | "prep_incomplete"
  | "missing_documents";

export const FLAG_META: Record<
  FlagKey,
  { label: string; explanation: string; severity: "attention" | "info" }
> = {
  no_next_step: {
    label: "No next step scheduled",
    explanation:
      "The matter has no scheduled hearing and no open task or deadline. Either the work is genuinely paused or something was never diarised — worth a deliberate decision either way.",
    severity: "info",
  },
  overdue_tasks: {
    label: "Overdue tasks",
    explanation:
      "One or more tasks on this matter are past their due date and not yet completed. Overdue work is the most common cause of missed filing windows.",
    severity: "attention",
  },
  order_unreviewed: {
    label: "Unreviewed order",
    explanation:
      "An order has been uploaded but nobody has recorded its review. Directions inside an unreviewed order can silently go un-complied.",
    severity: "attention",
  },
  stale_updates: {
    label: "Stale client update",
    explanation:
      "No client-visible update has been shared on this matter recently. Clients left in the dark lose confidence — and this flag never judges the case itself, only the communication.",
    severity: "info",
  },
  prep_incomplete: {
    label: "Incomplete hearing preparation",
    explanation:
      "The next hearing lacks preparation notes or the documents marked as required for it have not been uploaded yet.",
    severity: "attention",
  },
  missing_documents: {
    label: "Missing requested documents",
    explanation:
      "Documents requested from the client are still outstanding — not yet accepted — and some may be past their due date.",
    severity: "attention",
  },
};

const FLAG_ORDER: FlagKey[] = [
  "overdue_tasks",
  "missing_documents",
  "prep_incomplete",
  "order_unreviewed",
  "no_next_step",
  "stale_updates",
];

export type HealthFlag = {
  key: FlagKey;
  label: string;
  severity: "attention" | "info";
  evidence: string[];
  /** Matter tab with the underlying record. */
  tab: string;
};

export type MatterHealth = {
  matterId: Id<"matters">;
  reference: string;
  title: string;
  clientName: string;
  status: string;
  flags: HealthFlag[];
};

// ---------------------------------------------------------------
// Shared loaders
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

function fmtDateIN(ts: number): string {
  return new Date(ts).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function capEvidence(lines: string[], max = 4): string[] {
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max), `+${lines.length - max} more`];
}

// ---------------------------------------------------------------
// Per-matter evaluation
// ---------------------------------------------------------------

type MatterData = {
  matter: Doc<"matters">;
  clientName: string;
  names: Map<Id<"users">, string>;
  tasks: Doc<"tasks">[];
  deadlines: Doc<"deadlines">[];
  hearings: Doc<"hearings">[];
  orders: Doc<"orders">[];
  notes: Doc<"matterNotes">[];
  events: Doc<"matterEvents">[];
  docRequests: Doc<"documentRequests">[];
  documents: Doc<"matterDocuments">[];
  now: number;
};

function evaluateFlags(d: MatterData): HealthFlag[] {
  const { matter, now } = d;
  const flags: HealthFlag[] = [];
  const active = matter.status === "open" || matter.status === "in_progress";

  // 1. Overdue tasks -------------------------------------------------
  const overdue = d.tasks.filter(
    (t) => t.status !== "done" && t.dueAt !== undefined && t.dueAt < now,
  );
  if (overdue.length > 0) {
    const byName = (id: Id<"users"> | undefined) =>
      id ? d.names.get(id) ?? "Unassigned" : "Unassigned";
    flags.push({
      key: "overdue_tasks",
      label: FLAG_META.overdue_tasks.label,
      severity: "attention",
      evidence: capEvidence(
        overdue
          .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
          .map(
            (t) =>
              `“${t.title}” was due ${fmtDateIN(t.dueAt!)} — assigned to ${byName(t.assigneeId)}.`,
          ),
      ),
      tab: "tasks",
    });
  }

  // 2. Missing requested documents ----------------------------------
  const openRequests = d.docRequests.filter(
    (r) => r.status === "requested" || r.status === "uploaded" || r.status === "under_review",
  );
  if (openRequests.length > 0) {
    const lines = openRequests
      .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))
      .map((r) => {
        const due = r.dueAt !== undefined ? `, due ${fmtDateIN(r.dueAt)}` : "";
        const late = r.dueAt !== undefined && r.dueAt < now ? " (overdue)" : "";
        const state =
          r.status === "requested"
            ? "awaiting upload"
            : r.status === "uploaded"
              ? "uploaded, awaiting review"
              : "under review";
        return `“${r.title}” — ${state}${due}${late}.`;
      });
    flags.push({
      key: "missing_documents",
      label: FLAG_META.missing_documents.label,
      severity: openRequests.some(
        (r) => r.dueAt !== undefined && r.dueAt < now,
      )
        ? "attention"
        : "info",
      evidence: capEvidence(lines),
      tab: "documents",
    });
  }

  // 3. Incomplete hearing preparation --------------------------------
  const upcoming = d.hearings
    .filter((h) => h.status === "scheduled" && h.at > now)
    .sort((a, b) => a.at - b.at);
  const nextHearing = upcoming[0];
  if (nextHearing) {
    const gaps: string[] = [];
    const required = nextHearing.requiredDocuments ?? [];
    if (required.length > 0) {
      const uploadedNames = new Set(
        d.documents.map((doc) => doc.name.trim().toLowerCase()),
      );
      const missing = required.filter(
        (r) => !uploadedNames.has(r.trim().toLowerCase()),
      );
      if (missing.length > 0)
        gaps.push(`required documents not yet uploaded: ${missing.join(", ")}`);
    }
    if (!nextHearing.prepNotes?.trim()) gaps.push("no preparation notes recorded");
    if (gaps.length > 0) {
      flags.push({
        key: "prep_incomplete",
        label: FLAG_META.prep_incomplete.label,
        severity: "attention",
        evidence: capEvidence([
          `Next hearing: ${nextHearing.title}, ${fmtDateIN(nextHearing.at)}${nextHearing.court ? `, ${nextHearing.court}` : ""}.`,
          ...gaps.map((g) => `Gap: ${g.charAt(0).toUpperCase()}${g.slice(1)}.`),
        ]),
        tab: "hearings",
      });
    }
  }

  // 4. Unreviewed orders ---------------------------------------------
  const unreviewed = d.orders.filter((o) => o.reviewedAt === undefined);
  if (unreviewed.length > 0) {
    flags.push({
      key: "order_unreviewed",
      label: FLAG_META.order_unreviewed.label,
      severity: "attention",
      evidence: capEvidence(
        unreviewed
          .sort((a, b) => b.passedOn - a.passedOn)
          .map(
            (o) =>
              `“${o.title}” passed on ${fmtDateIN(o.passedOn)} has not been reviewed${o.directions?.length ? ` (contains ${o.directions.length} direction${o.directions.length === 1 ? "" : "s"})` : ""}.`,
          ),
      ),
      tab: "orders",
    });
  }

  // 5. No next step ---------------------------------------------------
  if (active) {
    const hasHearing = upcoming.length > 0;
    const hasOpenTask = d.tasks.some(
      (t) => t.status !== "done" && t.dueAt !== undefined,
    );
    const hasOpenDeadline = d.deadlines.some((x) => x.status === "open");
    const hasOpenRequest = openRequests.length > 0;
    if (!hasHearing && !hasOpenTask && !hasOpenDeadline && !hasOpenRequest) {
      flags.push({
        key: "no_next_step",
        label: FLAG_META.no_next_step.label,
        severity: "info",
        evidence: capEvidence([
          `No hearing is scheduled, no task or deadline is open, and no client document request is outstanding as of ${fmtDateIN(now)}.`,
        ]),
        tab: "overview",
      });
    }
  }

  // 6. Stale client updates ------------------------------------------
  if (active) {
    const lastClientVisible = Math.max(
      0,
      ...d.notes
        .filter((n) => n.toClient)
        .map((n) => n.createdAt),
      ...d.events
        .filter(
          (e) =>
            e.visibility === "shared_with_client" &&
            (e.occurredAt ?? e.createdAt) <= now,
        )
        .map((e) => e.occurredAt ?? e.createdAt),
    );
    const lastUpdate = lastClientVisible > 0 ? lastClientVisible : matter.createdAt;
    const daysSince = Math.floor((now - lastUpdate) / DAY_MS);
    if (daysSince > STALE_AFTER_DAYS && now - matter.createdAt > STALE_GRACE_DAYS * DAY_MS) {
      flags.push({
        key: "stale_updates",
        label: FLAG_META.stale_updates.label,
        severity: "info",
        evidence: capEvidence([
          lastClientVisible > 0
            ? `Last client-visible update was ${fmtDateIN(lastUpdate)} (${daysSince} days ago).`
            : `No client-visible update has ever been shared (matter opened ${fmtDateIN(matter.createdAt)}).`,
        ]),
        tab: "notes",
      });
    }
  }

  return FLAG_ORDER.filter((k) => flags.some((f) => f.key === k)).map(
    (k) => flags.find((f) => f.key === k)!,
  );
}

// ---------------------------------------------------------------
// Public queries
// ---------------------------------------------------------------

/** All health flags across the caller's visible active matters. */
export const flags = query({
  args: {},
  handler: async (ctx): Promise<{
    generatedAt: number;
    summary: { key: FlagKey; label: string; explanation: string; severity: string; count: number }[];
    matters: MatterHealth[];
  } | null> => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;

    const now = Date.now();
    const orgMatters = await ctx.db
      .query("matters")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const matters = orgMatters
      .filter((m) => m.status !== "closed" && m.archivedAt === undefined)
      .filter((m) => canViewMatter(ac, m))
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const names = await namesFor(ctx, ac.org._id);

    const [tasks, deadlines, hearings, orders, notes, events, docRequests, documents] =
      await Promise.all([
        ctx.db.query("tasks").collect(),
        ctx.db
          .query("deadlines")
          .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
          .collect(),
        ctx.db.query("hearings").collect(),
        ctx.db.query("orders").collect(),
        ctx.db.query("matterNotes").collect(),
        ctx.db.query("matterEvents").collect(),
        ctx.db.query("documentRequests").collect(),
        ctx.db.query("matterDocuments").collect(),
      ]);

    const clientNames = new Map<Id<"clients">, string>();
    await Promise.all(
      Array.from(new Set(matters.map((m) => m.clientId))).map(async (cid) => {
        const c = await ctx.db.get(cid);
        if (c) clientNames.set(cid, c.name);
      }),
    );

    const counts: Record<string, number> = {};
    const rows: MatterHealth[] = [];

    for (const matter of matters) {
      const mid = matter._id;
      const healthFlags = evaluateFlags({
        matter,
        clientName: clientNames.get(matter.clientId) ?? "—",
        names,
        now,
        tasks: tasks.filter((t) => t.matterId === mid),
        deadlines: deadlines.filter((x) => x.matterId === mid),
        hearings: hearings.filter((h) => h.matterId === mid),
        orders: orders.filter((o) => o.matterId === mid),
        notes: notes.filter((n) => n.matterId === mid),
        events: events.filter((e) => e.matterId === mid),
        docRequests: docRequests.filter((r) => r.matterId === mid),
        documents: documents.filter((doc) => doc.matterId === mid),
      });
      for (const f of healthFlags) counts[f.key] = (counts[f.key] ?? 0) + 1;
      if (healthFlags.length > 0) {
        rows.push({
          matterId: mid,
          reference: matter.reference,
          title: matter.title,
          clientName: clientNames.get(matter.clientId) ?? "—",
          status: matter.status,
          flags: healthFlags,
        });
      }
    }

    // Matters with the most attention-severity flags first.
    rows.sort((a, b) => {
      const aA = a.flags.filter((f) => f.severity === "attention").length;
      const bA = b.flags.filter((f) => f.severity === "attention").length;
      if (aA !== bA) return bA - aA;
      return b.flags.length - a.flags.length;
    });

    const summary = FLAG_ORDER.filter((k) => (counts[k] ?? 0) > 0).map((k) => ({
      key: k,
      label: FLAG_META[k].label,
      explanation: FLAG_META[k].explanation,
      severity: FLAG_META[k].severity,
      count: counts[k] ?? 0,
    }));

    return { generatedAt: now, summary, matters: rows };
  },
});

/** Full health evaluation for one matter (used on the matter file). */
export const matterHealth = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args): Promise<MatterHealth | null> => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const matter = await ctx.db.get(args.matterId);
    if (!matter || !canViewMatter(ac, matter)) return null;

    const now = Date.now();
    const names = await namesFor(ctx, ac.org._id);
    const client = await ctx.db.get(matter.clientId);

    const [tasks, deadlines, hearings, orders, notes, events, docRequests, documents] =
      await Promise.all([
        ctx.db
          .query("tasks")
          .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
          .collect(),
        ctx.db
          .query("deadlines")
          .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
          .collect(),
        ctx.db
          .query("hearings")
          .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
          .collect(),
        ctx.db
          .query("orders")
          .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
          .collect(),
        ctx.db
          .query("matterNotes")
          .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
          .collect(),
        ctx.db
          .query("matterEvents")
          .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
          .collect(),
        ctx.db
          .query("documentRequests")
          .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
          .collect(),
        ctx.db
          .query("matterDocuments")
          .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
          .collect(),
      ]);

    const healthFlags = evaluateFlags({
      matter,
      clientName: client?.name ?? "—",
      names,
      now,
      tasks,
      deadlines,
      hearings,
      orders,
      notes,
      events,
      docRequests,
      documents,
    });

    return {
      matterId: matter._id,
      reference: matter.reference,
      title: matter.title,
      clientName: client?.name ?? "—",
      status: matter.status,
      flags: healthFlags,
    };
  },
});
