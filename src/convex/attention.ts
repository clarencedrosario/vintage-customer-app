import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { can, canViewMatter, getAccessContext } from "./access";
import type { AccessContext } from "./access";

// ===============================================================
// Morning docket — "What needs my attention?"
//
// Every item carries: reason, relevant date, responsible person,
// a deep link to the underlying record and a next action. Items are
// computed live from access-enforced data; dismissal/snooze is
// per-user and stored in attentionStates. Critical deadlines cannot
// be dismissed — they can only be snoozed briefly.
// ===============================================================

const DAY_MS = 24 * 60 * 60 * 1000;

type AttentionKind =
  | "hearing_today"
  | "prep_gap"
  | "deadline"
  | "client_message"
  | "missing_document"
  | "order_unreviewed"
  | "overdue_task"
  | "invoice_attention"
  | "draft_invoice";

export type AttentionItem = {
  kind: AttentionKind;
  itemId: string;
  /** Firm-wide items (recorded deadlines without a matter) have none. */
  matterId?: Id<"matters">;
  matterReference: string | null;
  title: string;
  reason: string;
  date: number;
  responsible: string;
  action: { label: string; tab?: string };
  critical?: boolean;
};

function actionFor(kind: AttentionKind): { label: string; tab?: string } {
  switch (kind) {
    case "hearing_today":
      return { label: "Open hearing", tab: "hearings" };
    case "prep_gap":
      return { label: "Prepare file", tab: "docket" };
    case "deadline":
      return { label: "Open deadline", tab: "tasks" };
    case "client_message":
      return { label: "Read & reply", tab: "notes" };
    case "missing_document":
      return { label: "Review request", tab: "documents" };
    case "order_unreviewed":
      return { label: "Review order", tab: "orders" };
    case "overdue_task":
      return { label: "Work the task", tab: "tasks" };
    case "invoice_attention":
      return { label: "Open billing", tab: "invoices" };
    case "draft_invoice":
      return { label: "Review draft", tab: "invoices" };
  }
}

const KIND_LABEL: Record<AttentionKind, string> = {
  hearing_today: "Today's hearing",
  prep_gap: "Awaiting preparation",
  deadline: "Approaching deadline",
  client_message: "Unanswered message",
  missing_document: "Missing document",
  order_unreviewed: "Order to review",
  overdue_task: "Overdue task",
  invoice_attention: "Invoice attention",
  draft_invoice: "Draft invoice",
};

/** Items that must not disappear quietly. */
const CRITICAL_PREFIXES = ["deadline:", "overdue:"];

function isCriticalItem(itemId: string): boolean {
  return CRITICAL_PREFIXES.some((p) => itemId.startsWith(p));
}

/** First responsible person named on the matter's team, else a label. */
function responsibleFor(
  matter: Doc<"matters"> | undefined,
  nameByUser: Map<Id<"users">, string>,
  fallback = "Assigned team",
): string {
  const first = matter?.teamIds?.[0];
  if (first) return nameByUser.get(first) ?? fallback;
  return fallback;
}

export const feed = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;

    const now = Date.now();
    const dayEnd = now + DAY_MS;
    const soon = now + 7 * DAY_MS;

    const orgMatters = await ctx.db
      .query("matters")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const matters = orgMatters.filter((m) => canViewMatter(ac, m));
    const matterById = new Map(matters.map((m) => [m._id, m]));
    const visibleIds = new Set(matters.map((m) => m._id));

    const clientIds = Array.from(new Set(matters.map((m) => m.clientId)));
    const clientRows = (
      await Promise.all(clientIds.map((id) => ctx.db.get(id)))
    ).filter(Boolean) as Doc<"clients">[];
    const clientById = new Map(clientRows.map((c) => [c._id, c.name]));

    const memberRows = await ctx.db
      .query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const memberUserIds = Array.from(
      new Set(
        memberRows
          .filter((m) => m.status === "active")
          .map((m) => m.userId),
      ),
    );
    const userRows = (
      await Promise.all(memberUserIds.map((id) => ctx.db.get(id)))
    ).filter(Boolean) as Doc<"users">[];
    const nameByUser = new Map(
      userRows.map((u) => [u._id, u.name ?? u.email ?? "Unassigned"]),
    );

    const [hearings, tasks, documents, notes, orders, deadlines, invoices] =
      await Promise.all([
        ctx.db.query("hearings").collect(),
        ctx.db.query("tasks").collect(),
        ctx.db.query("matterDocuments").collect(),
        ctx.db.query("matterNotes").collect(),
        ctx.db.query("orders").collect(),
        ctx.db
          .query("deadlines")
          .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
          .collect(),
        ctx.db
          .query("invoices")
          .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
          .collect(),
      ]);

    const items: AttentionItem[] = [];

    // -------------------------------------------------------------
    // 1. Today's hearings (and ones from the last few hours)
    // -------------------------------------------------------------
    for (const h of hearings) {
      if (h.status !== "scheduled") continue;
      if (h.at < now - 6 * 60 * 60 * 1000 || h.at > dayEnd) continue;
      const m = matterById.get(h.matterId);
      if (!m) continue;
      items.push({
        kind: "hearing_today",
        itemId: `hearing:${h._id}`,
        matterId: h.matterId,
        matterReference: m.reference,
        title: h.title,
        reason: `Scheduled for today${h.court ? ` at ${h.court}` : ""}.`,
        date: h.at,
        responsible: responsibleFor(m, nameByUser),
        action: actionFor("hearing_today"),
      });
    }

    // -------------------------------------------------------------
    // 2. Matters awaiting preparation (hearing within 7 days, thin file)
    // -------------------------------------------------------------
    const nextHearing = new Map<Id<"matters">, Doc<"hearings">>();
    for (const h of hearings) {
      if (h.status !== "scheduled" || h.at <= now || h.at > soon) continue;
      if (!visibleIds.has(h.matterId)) continue;
      const cur = nextHearing.get(h.matterId);
      if (!cur || h.at < cur.at) nextHearing.set(h.matterId, h);
    }
    const docCount = new Map<Id<"matters">, number>();
    for (const d of documents)
      docCount.set(d.matterId, (docCount.get(d.matterId) ?? 0) + 1);
    const orderCount = new Map<Id<"matters">, number>();
    for (const o of orders)
      orderCount.set(o.matterId, (orderCount.get(o.matterId) ?? 0) + 1);
    const noteCount = new Map<Id<"matters">, number>();
    for (const n of notes)
      noteCount.set(n.matterId, (noteCount.get(n.matterId) ?? 0) + 1);

    for (const [matterId, hearing] of nextHearing) {
      const m = matterById.get(matterId)!;
      const gaps: string[] = [];
      if ((orderCount.get(matterId) ?? 0) === 0) gaps.push("no orders on file");
      if ((docCount.get(matterId) ?? 0) === 0) gaps.push("no documents attached");
      if ((noteCount.get(matterId) ?? 0) === 0) gaps.push("no preparation notes");
      if (gaps.length === 0) continue;
      items.push({
        kind: "prep_gap",
        itemId: `prep:${matterId}`,
        matterId,
        matterReference: m.reference,
        title: m.title,
        reason: `Hearing coming up with ${gaps.join(", ")}.`,
        date: hearing.at,
        responsible: responsibleFor(m, nameByUser),
        action: actionFor("prep_gap"),
      });
    }

    // -------------------------------------------------------------
    // 3. Approaching deadlines (due within 3 days) — critical
    // -------------------------------------------------------------
    for (const t of tasks) {
      if (t.status !== "pending" || t.dueAt === undefined) continue;
      if (t.matterId === undefined) continue; // firm-wide tasks live on the Tasks desk
      if (!visibleIds.has(t.matterId)) continue;
      if (t.dueAt <= now || t.dueAt > now + 3 * DAY_MS) continue;
      const m = matterById.get(t.matterId)!;
      items.push({
        kind: "deadline",
        itemId: `deadline:${t._id}`,
        matterId: t.matterId,
        matterReference: m.reference,
        title: t.title,
        reason: "Due within three days.",
        date: t.dueAt,
        responsible: t.assigneeId
          ? nameByUser.get(t.assigneeId) ?? "Unassigned"
          : "Unassigned",
        action: actionFor("deadline"),
        critical: true,
      });
    }

    // -------------------------------------------------------------
    // 3b. Recorded deadlines — limitation & compliance, never silent
    // -------------------------------------------------------------
    for (const d of deadlines) {
      if (d.status !== "open") continue;
      if (d.matterId !== undefined && !visibleIds.has(d.matterId)) continue;
      if (d.dueAt < now - 30 * DAY_MS) continue; // completed-late guard rails handled in Tasks
      const responsible = d.responsibleId
        ? (nameByUser.get(d.responsibleId) ?? "Unassigned")
        : "Unassigned";
      const m = d.matterId !== undefined ? matterById.get(d.matterId) : null;
      const categoryLabel =
        d.category === "limitation"
          ? "Limitation"
          : d.category === "court_order"
            ? "Court-order compliance"
            : d.category === "filing"
              ? "Filing"
              : d.category === "compliance"
                ? "Statutory compliance"
                : "Deadline";
      items.push({
        kind: d.dueAt <= now ? "deadline" : "deadline",
        itemId: `recorded-deadline:${d._id}`,
        matterId: d.matterId,
        matterReference: m?.reference ?? null,
        title: d.title,
        reason:
          d.dueAt <= now
            ? `${categoryLabel} deadline has passed.`
            : d.reminderAt !== undefined && d.reminderAt <= now
              ? `${categoryLabel} deadline — reminder day.`
              : `${categoryLabel} deadline due within three days.`,
        date: d.dueAt,
        responsible,
        action: actionFor("deadline"),
        critical: true,
      });
    }

    // -------------------------------------------------------------
    // 4. Overdue tasks — critical
    // -------------------------------------------------------------
    for (const t of tasks) {
      if (t.status !== "pending" || t.dueAt === undefined) continue;
      if (t.matterId === undefined) continue; // firm-wide tasks live on the Tasks desk
      if (!visibleIds.has(t.matterId)) continue;
      if (t.dueAt > now) continue;
      const m = matterById.get(t.matterId)!;
      items.push({
        kind: "overdue_task",
        itemId: `overdue:${t._id}`,
        matterId: t.matterId,
        matterReference: m.reference,
        title: t.title,
        reason: "The due date has passed.",
        date: t.dueAt,
        responsible: t.assigneeId
          ? nameByUser.get(t.assigneeId) ?? "Unassigned"
          : "Unassigned",
        action: actionFor("overdue_task"),
        critical: true,
      });
    }

    // -------------------------------------------------------------
    // 5. Unanswered client messages (no chamber reply after them)
    // -------------------------------------------------------------
    for (const n of notes) {
      if (n.fromClient !== true || !visibleIds.has(n.matterId)) continue;
      const hasLaterReply = notes.some(
        (r) =>
          r.matterId === n.matterId &&
          r.toClient === true &&
          r.createdAt > n.createdAt,
      );
      if (hasLaterReply) continue;
      const m = matterById.get(n.matterId)!;
      items.push({
        kind: "client_message",
        itemId: `message:${n._id}`,
        matterId: n.matterId,
        matterReference: m.reference,
        title: n.body.length > 80 ? `${n.body.slice(0, 77)}…` : n.body,
        reason: "Client message awaiting a reply.",
        date: n.createdAt,
        responsible: responsibleFor(m, nameByUser),
        action: actionFor("client_message"),
      });
    }

    // -------------------------------------------------------------
    // 6. Missing requested documents (checklist, not yet supplied)
    // -------------------------------------------------------------
    for (const d of documents) {
      if (d.requestedFromClient !== true) continue;
      if (!visibleIds.has(d.matterId)) continue;
      if (d.storageId && d.submittedByClient === true) continue; // supplied
      const m = matterById.get(d.matterId)!;
      items.push({
        kind: "missing_document",
        itemId: `docreq:${d._id}`,
        matterId: d.matterId,
        matterReference: m.reference,
        title: d.name,
        reason: `Requested from the client${d.requestedNote ? `: ${d.requestedNote}` : ""} — not yet received.`,
        date: d.createdAt,
        responsible: clientById.get(m.clientId) ?? "The client",
        action: actionFor("missing_document"),
      });
    }

    // -------------------------------------------------------------
    // 7. Unreviewed orders
    // -------------------------------------------------------------
    for (const o of orders) {
      if (o.reviewedAt !== undefined) continue;
      if (!visibleIds.has(o.matterId)) continue;
      const m = matterById.get(o.matterId)!;
      items.push({
        kind: "order_unreviewed",
        itemId: `order:${o._id}`,
        matterId: o.matterId,
        matterReference: m.reference,
        title: o.title,
        reason: "Recorded on the file but not yet reviewed.",
        date: o.passedOn,
        responsible: responsibleFor(m, nameByUser),
        action: actionFor("order_unreviewed"),
      });
    }

    // -------------------------------------------------------------
    // 8. Invoices needing attention (unpaid > 2 weeks) — billing caps only
    // 9. Draft invoices awaiting approval — billing caps only
    // -------------------------------------------------------------
    const canSeeBilling =
      can(ac, "billing.invoice") || can(ac, "billing.payment");
    if (canSeeBilling) {
      for (const inv of invoices) {
        if (!visibleIds.has(inv.matterId)) continue;
        const m = matterById.get(inv.matterId)!;
        const due = inv.total - inv.amountPaid;
        if (inv.status === "draft") {
          items.push({
            kind: "draft_invoice",
            itemId: `draft:${inv._id}`,
            matterId: inv.matterId,
            matterReference: m.reference,
            title: inv.number,
            reason: "Draft awaiting approval before it is sent.",
            date: inv.createdAt,
            responsible: "You",
            action: actionFor("draft_invoice"),
          });
        } else if (
          inv.status !== "paid" &&
          inv.status !== "cancelled" &&
          due > 0 &&
          now - inv.createdAt > 14 * DAY_MS
        ) {
          items.push({
            kind: "invoice_attention",
            itemId: `invoice:${inv._id}`,
            matterId: inv.matterId,
            matterReference: m.reference,
            title: inv.number,
            reason: "Unpaid for over two weeks.",
            date: inv.createdAt,
            responsible: "Accounts",
            action: actionFor("invoice_attention"),
          });
        }
      }
    }

    // -------------------------------------------------------------
    // Apply per-user dismissals and snoozes
    // -------------------------------------------------------------
    const states = await ctx.db
      .query("attentionStates")
      .withIndex("by_user_org", (q) =>
        q.eq("userId", ac.user._id).eq("orgId", ac.org._id),
      )
      .collect();
    const stateByItem = new Map(states.map((s) => [s.itemId, s]));
    const visibleItems = items.filter((i) => {
      const s = stateByItem.get(i.itemId);
      if (!s) return true;
      if (s.dismissedAt !== undefined) return false;
      if (s.snoozedUntil !== undefined && s.snoozedUntil > now) return false;
      return true;
    });
    const hiddenCount = items.length - visibleItems.length;

    return {
      items: visibleItems.sort((a, b) => {
        const criticalDiff =
          Number(b.critical ?? false) - Number(a.critical ?? false);
        if (criticalDiff !== 0) return criticalDiff;
        return a.date - b.date;
      }),
      totalComputed: items.length,
      hiddenCount,
      canSeeBilling,
    };
  },
});

// ---------------------------------------------------------------
// Dismiss / snooze / restore
// ---------------------------------------------------------------

export const dismiss = mutation({
  args: { itemId: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccessCtx(ctx);
    if (isCriticalItem(args.itemId)) {
      throw new Error(
        "Critical deadlines cannot be dismissed. Snooze briefly instead.",
      );
    }
    await upsertState(ctx, ac, args.itemId, { dismissedAt: Date.now() });
  },
});

export const snooze = mutation({
  args: { itemId: v.string(), hours: v.number() },
  handler: async (ctx, args) => {
    const ac = await requireAccessCtx(ctx);
    // Critical items may be snoozed briefly — never silently for days.
    const maxHours = isCriticalItem(args.itemId) ? 24 : 24 * 7;
    const hours = Math.min(Math.max(args.hours, 1), maxHours);
    await upsertState(ctx, ac, args.itemId, {
      snoozedUntil: Date.now() + hours * 60 * 60 * 1000,
    });
  },
});

export const restore = mutation({
  args: { itemId: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccessCtx(ctx);
    await clearState(ctx, ac, args.itemId);
  },
});

export const restoreAll = mutation({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccessCtx(ctx);
    const states = await ctx.db
      .query("attentionStates")
      .withIndex("by_user_org", (q) =>
        q.eq("userId", ac.user._id).eq("orgId", ac.org._id),
      )
      .collect();
    for (const s of states) {
      await ctx.db.delete(s._id);
    }
  },
});

/** Hidden (dismissed/snoozed) items so they can be restored from the UI. */
export const hiddenItems = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const now = Date.now();
    const states = await ctx.db
      .query("attentionStates")
      .withIndex("by_user_org", (q) =>
        q.eq("userId", ac.user._id).eq("orgId", ac.org._id),
      )
      .collect();
    return states
      .filter(
        (s) => s.dismissedAt !== undefined || (s.snoozedUntil ?? 0) > now,
      )
      .map((s) => ({
        itemId: s.itemId,
        dismissedAt: s.dismissedAt ?? null,
        snoozedUntil: s.snoozedUntil ?? null,
      }));
  },
});

// ---------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------

async function requireAccessCtx(ctx: QueryCtx): Promise<AccessContext> {
  const ac = await getAccessContext(ctx);
  if (!ac) throw new Error("Sign in and select an organization.");
  return ac;
}

async function upsertState(
  ctx: MutationCtx,
  ac: AccessContext,
  itemId: string,
  patch: { dismissedAt?: number; snoozedUntil?: number },
) {
  const existing = await ctx.db
    .query("attentionStates")
    .withIndex("by_user_item", (q) =>
      q.eq("userId", ac.user._id).eq("itemId", itemId),
    )
    .collect();
  const row = existing[0];
  if (row) {
    await ctx.db.patch(row._id, { ...patch, updatedAt: Date.now() });
  } else {
    await ctx.db.insert("attentionStates", {
      userId: ac.user._id,
      orgId: ac.org._id,
      itemId,
      ...patch,
      updatedAt: Date.now(),
    });
  }
}

async function clearState(
  ctx: MutationCtx,
  ac: AccessContext,
  itemId: string,
) {
  const existing = await ctx.db
    .query("attentionStates")
    .withIndex("by_user_item", (q) =>
      q.eq("userId", ac.user._id).eq("itemId", itemId),
    )
    .collect();
  if (existing[0]) await ctx.db.delete(existing[0]._id);
}

export const KIND_LABELS = KIND_LABEL;
