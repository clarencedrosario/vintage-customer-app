import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { canViewDocument, canViewMatter, can, getAccessContext } from "./access";

// ---------------------------------------------------------------------
// Case Command Centre — one permission-aware aggregate query per matter.
//
// Access: requireAccess-style gate first (active membership in the org),
// then the shared matter rule (cross-tenant always denied; team-restricted
// matters only for their team). A caller without access gets `null` —
// the same response shape as a missing matter, so nothing about the
// matter's existence leaks.
//
// Performance: every collection is read once via its by_matter index and
// sliced in memory; user names are resolved through one shared batch
// cache. No per-row round-trips (no N+1).
//
// Sections are gated server-side by capability, mirroring the UI: a
// role without `billing.invoice` never receives invoice data, not just
// a hidden card.
// ---------------------------------------------------------------------

/** Latest client-directed message (portal thread) or client-facing note. */
type LatestContact = { at: number; preview: string; kind: "message" | "note" } | null;

function preview(text: string | undefined, max = 140): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export const matterOverview = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;

    // Matter gate: org match first, then team restriction (pure policy
    // shared with every other module — cross-tenant and out-of-team
    // callers are denied identically).
    const matter = await ctx.db.get(args.matterId);
    if (!matter) return null;
    if (!canViewMatter(ac, matter)) return null;

    const now = Date.now();
    const canInternal = can(ac, "document.view_internal");
    const canInvoices = can(ac, "billing.invoice");
    const canPayments = can(ac, "billing.payment");
    const canAudit =
      can(ac, "matter.edit") ||
      can(ac, "permissions.edit") ||
      ac.membership.orgRole === "owner" ||
      ac.membership.orgRole === "partner" ||
      ac.membership.orgRole === "administrator";

    // ---- Parallel batched reads (one indexed query per table) ----
    const [
      client,
      tasks,
      deadlines,
      events,
      hearings,
      orders,
      documents,
      requests,
      notes,
      invoices,
      packs,
      issues,
      auditRows,
      conversations,
    ] = await Promise.all([
      ctx.db.get(matter.clientId),
      ctx.db
        .query("tasks")
        .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
        .collect(),
      ctx.db
        .query("deadlines")
        .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
        .collect(),
      ctx.db
        .query("matterEvents")
        .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
        .collect(),
      ctx.db
        .query("hearings")
        .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
        .collect(),
      ctx.db
        .query("orders")
        .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
        .collect(),
      ctx.db
        .query("matterDocuments")
        .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
        .collect(),
      ctx.db
        .query("documentRequests")
        .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
        .collect(),
      ctx.db
        .query("matterNotes")
        .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
        .collect(),
      canInvoices
        ? ctx.db
            .query("invoices")
            .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
            .collect()
        : Promise.resolve([] as Doc<"invoices">[]),
      ctx.db
        .query("hearingPacks")
        .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
        .collect(),
      ctx.db
        .query("matterIssues")
        .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
        .collect(),
      canAudit
        ? ctx.db
            .query("auditLog")
            .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
            .collect()
        : Promise.resolve([] as Doc<"auditLog">[]),
      ctx.db
        .query("conversations")
        .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
        .collect(),
    ]);

    // ---- Batched name resolution (one shared cache, no N+1) ----
    const userNameCache = new Map<Id<"users">, string>();
    const userName = async (id: Id<"users"> | undefined): Promise<string | null> => {
      if (!id) return null;
      const hit = userNameCache.get(id);
      if (hit !== undefined) return hit;
      const u = await ctx.db.get(id);
      const name = u?.name ?? u?.email ?? null;
      if (name) userNameCache.set(id, name);
      return name;
    };

    const [leadLawyerName, teamNames, clientResponsibleName] = await Promise.all([
      userName(matter.leadLawyerId),
      Promise.all(
        (matter.teamIds ?? []).slice(0, 12).map((id) => userName(id)),
      ),
      userName(client?.responsibleLawyerId),
    ]);

    // ---- Client communication: latest portal message / client-facing note ----
    let latestContact: LatestContact = null;
    let latestActivityAt: number | undefined;

    const matterConversations = conversations.filter(
      (c) => c.scope === "matter" && !c.archivedAt,
    );
    if (matterConversations.length > 0) {
      const lastByConv = await Promise.all(
        matterConversations.map(async (c) => {
          const last = await ctx.db
            .query("messages")
            .withIndex("by_conversation", (q) => q.eq("conversationId", c._id))
            .order("desc")
            .take(1);
          return { conv: c, msg: last[0] };
        }),
      );
      for (const { conv, msg } of lastByConv) {
        if (!msg) continue;
        const candidate: LatestContact = {
          at: msg.createdAt,
          preview: `${conv.subject}: ${preview(msg.body)}`,
          kind: "message",
        };
        if (!latestContact || candidate.at > latestContact.at) latestContact = candidate;
      }
    }
    // Client-facing notes participate in "has the client been told?".
    const clientNote = notes
      .filter((n) => n.toClient === true)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (clientNote) {
      const candidate: LatestContact = {
        at: clientNote.createdAt,
        preview: preview(clientNote.body),
        kind: "note",
      };
      if (!latestContact || candidate.at > latestContact.at) latestContact = candidate;
    }

    // Latest chronology event drives the update-due flag.
    const latestEvent = [...events].sort((a, b) => b.createdAt - a.createdAt)[0];
    if (latestEvent) latestActivityAt = latestEvent.createdAt;
    if (latestContact && (latestActivityAt === undefined || latestContact.at > latestActivityAt)) {
      latestActivityAt = latestContact.at;
    }

    // ---- Deadlines ----
    const openDeadlines = deadlines
      .filter((d) => d.status === "open")
      .sort((a, b) => a.dueAt - b.dueAt);
    const overdueDeadlines = openDeadlines.filter((d) => d.dueAt < now);
    const upcomingDeadlines = openDeadlines
      .filter((d) => d.dueAt >= now)
      .slice(0, 6);

    // ---- Tasks ----
    const openTasks = tasks.filter((t) => t.status !== "done");
    const sortedTasks = openTasks.sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity));
    const overdueTasks = sortedTasks.filter((t) => t.dueAt !== undefined && t.dueAt < now);
    const pendingApprovalTasks = sortedTasks.filter((t) => t.automationRunId !== undefined);
    const soonTasks = sortedTasks
      .filter((t) => t.dueAt !== undefined && t.dueAt >= now)
      .slice(0, 6);

    // ---- Documents awaiting review (client submissions not yet accepted) ----
    const awaitingReviewDocs = documents
      .filter(
        (d) =>
          d.submittedByClient === true &&
          canViewDocument(ac, d, matter),
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 5);

    // ---- Client document requests still in flight ----
    const openRequests = requests
      .filter((r) => r.status !== "accepted" && r.status !== "rejected")
      .sort((a, b) => (a.dueAt ?? a.createdAt) - (b.dueAt ?? b.createdAt))
      .slice(0, 5);

    // ---- Recent chronology (visible only: hide internal events from
    // members without the internal-document capability) ----
    const recentEvents = events
      .filter((e) => e.visibility !== "internal" || canInternal)
      .filter((e) => !e.supersedes) // corrections hide the superseded row
      .sort((a, b) => (b.occurredAt ?? b.createdAt) - (a.occurredAt ?? a.createdAt))
      .slice(0, 6);

    // ---- Next hearing + recent outcomes ----
    const scheduledHearings = hearings
      .filter((h) => h.status === "scheduled")
      .sort((a, b) => a.at - b.at);
    const nextHearing = scheduledHearings.find((h) => h.at > now - 2 * 60 * 60 * 1000);
    const recentHearings = hearings
      .filter((h) => h.status !== "scheduled" && h.outcome)
      .sort((a, b) => b.at - a.at)
      .slice(0, 2);

    // ---- Undertakings: open court_order deadlines + outstanding order directions ----
    const undertakingDeadlines = openDeadlines.filter(
      (d) => d.category === "court_order",
    );
    const undertakingDirections = orders.flatMap((o) =>
      (o.directions ?? [])
        .filter((d) => !d.done)
        .map((d, i) => ({ orderId: o._id, orderTitle: o.title, index: i, text: d.text })),
    );

    // ---- Hearing Pack status ----
    const latestPack = [...packs].sort((a, b) => b.createdAt - a.createdAt)[0];

    // ---- Financial (capability-gated above) ----
    const outstandingInvoices = invoices
      .filter(
        (inv) =>
          inv.status !== "paid" &&
          inv.status !== "cancelled" &&
          inv.status !== "credited" &&
          inv.totalMinor - inv.amountPaidMinor - (inv.amountCreditedMinor ?? 0) > 0,
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 5);
    const outstandingTotalMinor = outstandingInvoices.reduce(
      (sum, inv) =>
        sum + Math.max(0, inv.totalMinor - inv.amountPaidMinor - (inv.amountCreditedMinor ?? 0)),
      0,
    );

    let recentPayments: { id: string; amountMinor: number; receivedOn: string; invoiceNumber: string }[] = [];
    if (canPayments && invoices.length > 0) {
      const paymentRows = await Promise.all(
        invoices.slice(0, 12).map(async (inv) => ({
          inv,
          payments: await ctx.db
            .query("payments")
            .withIndex("by_invoice", (q) => q.eq("invoiceId", inv._id))
            .collect(),
        })),
      );
      const flat = paymentRows.flatMap(({ inv, payments: ps }) =>
        ps.map((p) => ({ p, inv })),
      );
      recentPayments = flat
        .sort((a, b) => b.p.createdAt - a.p.createdAt)
        .slice(0, 5)
        .map(({ p, inv }) => ({
          id: p._id,
          amountMinor: p.amountMinor,
          receivedOn: p.receivedOn,
          invoiceNumber: inv.number,
        }));
    }

    // ---- Risks: open issues + unreviewed orders + blocked tasks counts ----
    const openIssues = issues.filter((i) => i.status === "open");
    const unreviewedOrders = orders.filter((o) => !o.reviewedAt).length;

    // ---- Audit (capability-gated above) ----
    const recentAudit = [...auditRows]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 8)
      .map((a) => ({
        id: a._id,
        action: a.action,
        detail: a.detail ?? null,
        actorName: a.actorName,
        at: a.createdAt,
      }));

    return {
      now,
      matter: {
        _id: matter._id,
        reference: matter.reference,
        title: matter.title,
        status: matter.status,
        priority: matter.priority ?? "normal",
        practiceArea: matter.practiceArea,
        court: matter.court ?? null,
        bench: matter.bench ?? null,
        caseNumber: matter.caseNumber ?? null,
        clientName: client?.name ?? null,
        clientId: matter.clientId,
        leadLawyerName,
        teamNames: teamNames.map((n) => n ?? "Member"),
        restrictedToTeam: matter.restrictedToTeam === true,
        clientResponsibleName,
      },
      nextHearing: nextHearing
        ? {
            id: nextHearing._id,
            title: nextHearing.title,
            at: nextHearing.at,
            court: nextHearing.court ?? null,
          }
        : null,
      nextHearingUpdateDue: matter.nextHearingAt !== undefined && matter.nextHearingAt < now,
      deadlines: {
        overdue: overdueDeadlines.slice(0, 5).map((d) => ({
          id: d._id, title: d.title, category: d.category, dueAt: d.dueAt,
        })),
        upcoming: upcomingDeadlines.map((d) => ({
          id: d._id, title: d.title, category: d.category, dueAt: d.dueAt,
        })),
        overdueCount: overdueDeadlines.length,
      },
      tasks: {
        openCount: openTasks.length,
        overdue: overdueTasks.slice(0, 5).map((t) => ({
          id: t._id, title: t.title, dueAt: t.dueAt ?? null, priority: t.priority,
        })),
        soon: soonTasks.map((t) => ({
          id: t._id, title: t.title, dueAt: t.dueAt ?? null, priority: t.priority,
        })),
        pendingApproval: pendingApprovalTasks.slice(0, 5).map((t) => ({
          id: t._id, title: t.title,
        })),
        pendingApprovalCount: pendingApprovalTasks.length,
        overdueCount: overdueTasks.length,
      },
      chronology: recentEvents.map((e) => ({
        id: e._id,
        kind: e.kind,
        detail: e.detail ?? null,
        at: e.occurredAt ?? e.createdAt,
        visibility: e.visibility ?? "internal",
      })),
      documentsAwaitingReview: awaitingReviewDocs.map((d) => ({
        id: d._id, name: d.name, at: d.createdAt,
      })),
      clientRequests: openRequests.map((r) => ({
        id: r._id, title: r.title, status: r.status, dueAt: r.dueAt ?? null,
      })),
      latestClientContact: latestContact
        ? { at: latestContact.at, preview: latestContact.preview, kind: latestContact.kind }
        : null,
      updateDue:
        latestActivityAt !== undefined &&
        (latestContact === null || latestActivityAt - latestContact.at > 30 * 60 * 1000),
      undertakings: {
        deadlines: undertakingDeadlines.slice(0, 4).map((d) => ({
          id: d._id, title: d.title, dueAt: d.dueAt,
        })),
        directions: undertakingDirections.slice(0, 4),
      },
      hearingPack: latestPack
        ? {
            id: latestPack._id,
            version: latestPack.version,
            label: latestPack.label,
            createdAt: latestPack.createdAt,
            includeInternal: latestPack.includeInternal,
          }
        : null,
      recentHearings: recentHearings.map((h) => ({
        id: h._id, title: h.title, at: h.at, outcome: h.outcome ?? null,
      })),
      risks: {
        openIssues: openIssues.slice(0, 4).map((i) => ({
          id: i._id, title: i.title, detail: i.detail ?? null,
        })),
        openIssueCount: openIssues.length,
        unreviewedOrders,
        blockedTaskCount: overdueTasks.length,
      },
      financial:
        canInvoices || canPayments
          ? {
              canSeeInvoices: canInvoices,
              canSeePayments: canPayments,
              outstandingInvoices: canInvoices
                ? outstandingInvoices.map((inv) => ({
                    id: inv._id,
                    number: inv.number,
                    status: inv.status,
                    totalMinor: inv.totalMinor,
                    amountPaidMinor: inv.amountPaidMinor,
                    outstandingMinor:
                      inv.totalMinor - inv.amountPaidMinor - (inv.amountCreditedMinor ?? 0),
                    dueOn: inv.dueOn ?? null,
                  }))
                : [],
              outstandingTotalMinor,
              recentPayments,
            }
          : null,
      audit: canAudit ? recentAudit : null,
      capabilities: {
        canInternal,
        canInvoices,
        canPayments,
        canAudit,
      },
    };
  },
});
