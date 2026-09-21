import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { getCurrentUser } from "./users";
import { portalForRole } from "./schema";
import { MEMBERSHIP_STATUSES } from "./schema";
import {
  can,
  canViewMatter,
  getAccessContext,
  requireCapability,
  requireMatter,
} from "./access";
import type { Doc, Id } from "./_generated/dataModel";

// ---------------------------------------------------------------
// Portal resolution
// ---------------------------------------------------------------

/**
 * Which portal is the signed-in user authorized for? Clicking a card
 * never grants privileges — this is resolved server-side from role,
 * memberships and explicit client grants.
 */
export const resolve = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return { portal: null as string | null, role: null as string | null };
    }
    if (user.role === "client") return { portal: "client", role: "client" };

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const active = memberships.filter(
      (m) => m.status === MEMBERSHIP_STATUSES.ACTIVE,
    );
    if (active.length > 0) {
      const role = active[0]!.orgRole;
      return { portal: role === "support_staff" ? "staff" : "firm", role };
    }
    // Fallback to legacy role mapping for accounts not yet in an org.
    return { portal: portalForRole(user.role), role: user.role ?? null };
  },
});

/**
 * Assign the legacy portal role at registration (first named account =
 * firm owner). Memberships govern real permissions; this only picks the
 * default portal for brand-new accounts.
 */
export const registerRole = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (!user) return { role: null as string | null };
    if (user.role && user.role !== "member") return { role: user.role };

    const all = await ctx.db.query("users").collect();
    const hasConsoleMember = all.some(
      (u) =>
        !u.isAnonymous &&
        u._id !== user._id &&
        (u.role === "firm_owner" || u.role === "admin" || u.role === "lawyer"),
    );
    const role = hasConsoleMember ? "lawyer" : "firm_owner";
    await ctx.db.patch(user._id, { role });
    return { role };
  },
});

// ---------------------------------------------------------------
// Client portal — explicit grant + shared documents only
// ---------------------------------------------------------------

async function clientForUser(
  db: QueryCtx["db"],
  userId: Id<"users">,
): Promise<Doc<"clients"> | null> {
  const rows = await db
    .query("clients")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return rows[0] ?? null;
}

/** Everything the client portal renders, for the granted client only. */
export const clientPortal = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");
    if (user.isAnonymous) {
      throw new Error("Client access requires a verified account.");
    }
    const client = await clientForUser(ctx.db, user._id);
    if (!client) return null;

    const matters = await ctx.db
      .query("matters")
      .withIndex("by_client", (q) => q.eq("clientId", client._id))
      .collect();
    const matterIds = matters.map((m) => m._id);

    const [hearings, documents, invoices, events, messages] = await Promise.all([
      Promise.all(
        matterIds.map((id) =>
          ctx.db
            .query("hearings")
            .withIndex("by_matter", (q) => q.eq("matterId", id))
            .collect(),
        ),
      ).then((rows) => rows.flat()),
      // Document-level access: clients see only shared_with_client files.
      Promise.all(
        matterIds.map((id) =>
          ctx.db
            .query("matterDocuments")
            .withIndex("by_matter", (q) => q.eq("matterId", id))
            .collect(),
        ),
      ).then((rows) =>
        rows.flat().filter((d) => d.visibility === "shared_with_client"),
      ),
      Promise.all(
        matterIds.map((id) =>
          ctx.db
            .query("invoices")
            .withIndex("by_matter", (q) => q.eq("matterId", id))
            .collect(),
        ),
      ).then((rows) => rows.flat()),
      // Safe chronology only — internal strategy never leaks. A row is
      // client-visible when explicitly marked shared_with_client, or (for
      // legacy auto-entries without a visibility flag) when it is not an
      // internal kind (note, task).
      Promise.all(
        matterIds.map((id) =>
          ctx.db
            .query("matterEvents")
            .withIndex("by_matter", (q) => q.eq("matterId", id))
            .collect(),
        ),
      ).then((rows) =>
        rows.flat().filter((e) =>
          e.aiSuggested && !e.reviewed
            ? false
            : e.visibility === "shared_with_client"
              ? true
              : e.visibility === "internal"
                ? false
                : e.kind !== "note" && e.kind !== "task",
        ),
      ),
      // Message thread: client notes + chamber replies addressed to the
      // client. Internal strategy and staff discussion never appear.
      Promise.all(
        matterIds.map((id) =>
          ctx.db
            .query("matterNotes")
            .withIndex("by_matter", (q) => q.eq("matterId", id))
            .collect(),
        ),
      ).then((rows) =>
        rows
          .flat()
          .filter((n) => n.fromClient === true || n.toClient === true)
          .sort((a, b) => a.createdAt - b.createdAt),
      ),
    ]);

    return {
      client: { _id: client._id, name: client.name },
      matters,
      hearings: hearings
        .filter((h) => h.status === "scheduled")
        .sort((a, b) => a.at - b.at),
      documents: documents.sort((a, b) => b.createdAt - a.createdAt),
      invoices: invoices.sort((a, b) => b.createdAt - a.createdAt),
      events: events.sort((a, b) => b.createdAt - a.createdAt).slice(0, 50),
      messages,
      submissionEnabled: matters.some((m) => m.clientSubmission === true),
    };
  },
});

/** Resolve a document URL only if it is shared with this client. */
export const clientDocumentUrl = query({
  args: { documentId: v.id("matterDocuments") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const client = await clientForUser(ctx.db, user._id);
    if (!client) return null;

    const doc = await ctx.db.get(args.documentId);
    if (!doc || !doc.storageId) return null;
    if (doc.visibility !== "shared_with_client") return null; // internal
    const matter = await ctx.db.get(doc.matterId);
    if (!matter || matter.clientId !== client._id) return null; // not yours

    return await ctx.storage.getUrl(doc.storageId);
  },
});

/** Mark one of my assigned tasks done. */
export const completeTask = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found.");
    if (task.assigneeId !== user._id) {
      throw new Error("You can only complete your own tasks.");
    }
    await ctx.db.patch(args.taskId, { status: "done" });
  },
});

// ===============================================================
// LAWYER DASHBOARD
// ===============================================================

const DAY_MS = 24 * 60 * 60 * 1000;

/** Preparation gaps on a matter the caller may see. */
function prepGaps(
  matter: Doc<"matters">,
  now: number,
  upcomingHearing: Doc<"hearings"> | undefined,
  counts: { orders: number; docs: number; notes: number },
): string[] {
  const gaps: string[] = [];
  if (upcomingHearing) {
    if (counts.orders === 0) {
      gaps.push(
        `No orders recorded yet — file the latest order before the next hearing.`,
      );
    }
    if (counts.docs === 0) {
      gaps.push("No case documents attached — assemble the paper-book.");
    }
    if (counts.notes === 0) {
      gaps.push("No preparation notes on the file.");
    }
  }
  if (matter.status === "open" && now - matter.createdAt > 30 * DAY_MS) {
    gaps.push("Open for over a month with no progress update.");
  }
  return gaps;
}

/** The signed-in lawyer's working view: matters, diary, deadlines, gaps. */
export const lawyerDashboard = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;

    const now = Date.now();
    const dayEnd = now + DAY_MS;

    // Authorized matters only (matter-level access enforced).
    const matters = (
      await ctx.db
        .query("matters")
        .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
        .collect()
    ).filter((m) => canViewMatter(ac, m));
    const matterById = new Map(matters.map((m) => [m._id, m]));
    const visibleIds = new Set(matters.map((m) => m._id));

    // Authorized clients (clients on visible matters).
    const clientIds = Array.from(new Set(matters.map((m) => m.clientId)));
    const clients = (
      await Promise.all(clientIds.map((id) => ctx.db.get(id)))
    ).filter(Boolean) as Doc<"clients">[];

    // Hearings + tasks scoped to visible matters.
    const hearingRows = (
      await Promise.all(
        matters.map((m) =>
          ctx.db
            .query("hearings")
            .withIndex("by_matter", (q) => q.eq("matterId", m._id))
            .collect(),
        ),
      )
    ).flat();
    const upcoming = hearingRows
      .filter((h) => h.status === "scheduled" && h.at > now)
      .sort((a, b) => a.at - b.at);
    const todaysHearings = upcoming
      .filter((h) => h.at <= dayEnd)
      .map((h) => ({
        _id: h._id,
        matterId: h.matterId,
        matterReference: matterById.get(h.matterId)?.reference ?? "—",
        title: h.title,
        court: h.court ?? null,
        appearance: h.appearance ?? null,
        at: h.at,
      }));

    const taskRows = await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    const myTaskRows = taskRows.filter(
      (t): t is Doc<"tasks"> & { matterId: Id<"matters"> } =>
        t.matterId !== undefined &&
        visibleIds.has(t.matterId) &&
        t.assigneeId === ac.user._id,
    );
    const myTasks = myTaskRows
      .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))
      .slice(0, 12)
      .map((t) => ({
        _id: t._id,
        matterId: t.matterId,
        matterReference: matterById.get(t.matterId)?.reference ?? "—",
        title: t.title,
        dueAt: t.dueAt ?? null,
      }));

    // Deadlines: pending tasks across visible matters + scheduled hearings.
    const deadlineRows = taskRows.filter(
      (t): t is Doc<"tasks"> & { matterId: Id<"matters"> } =>
        t.matterId !== undefined &&
        visibleIds.has(t.matterId) &&
        t.dueAt !== undefined,
    );
    const deadlines = deadlineRows
      .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
      .slice(0, 12)
      .map((t) => ({
        _id: t._id,
        matterId: t.matterId,
        matterReference: matterById.get(t.matterId)?.reference ?? "—",
        title: t.title,
        dueAt: t.dueAt ?? null,
        mine: t.assigneeId === ac.user._id,
      }));

    // Preparation gaps on matters with an upcoming hearing.
    const gapMatters = matters
      .filter((m) => m.status !== "closed")
      .map((m) => ({
        matter: m,
        hearing: upcoming.find((h) => h.matterId === m._id),
      }))
      .filter((x) => x.hearing !== undefined)
      .sort((a, b) => (a.hearing!.at ?? 0) - (b.hearing!.at ?? 0))
      .slice(0, 8);
    const gaps: {
      matterId: Id<"matters">;
      reference: string;
      hearingAt: number;
      items: string[];
    }[] = [];
    for (const { matter, hearing } of gapMatters) {
      const [orders, docs, notes] = await Promise.all([
        ctx.db
          .query("orders")
          .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
          .collect(),
        ctx.db
          .query("matterDocuments")
          .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
          .collect(),
        ctx.db
          .query("matterNotes")
          .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
          .collect(),
      ]);
      const items = prepGaps(
        matter,
        now,
        hearing,
        { orders: orders.length, docs: docs.length, notes: notes.length },
      );
      if (items.length > 0) {
        gaps.push({
          matterId: matter._id,
          reference: matter.reference,
          hearingAt: hearing!.at,
          items,
        });
      }
    }

    // Recent activity across visible matters (newest first).
    const events = (
      await Promise.all(
        matters.slice(0, 25).map((m) =>
          ctx.db
            .query("matterEvents")
            .withIndex("by_matter", (q) => q.eq("matterId", m._id))
            .collect(),
        ),
      )
    )
      .flat()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 12)
      .map((e) => ({
        _id: e._id,
        matterId: e.matterId,
        matterReference: matterById.get(e.matterId)?.reference ?? "—",
        detail: e.detail ?? e.kind,
        at: e.createdAt,
      }));

    // Permitted billing: only with a billing capability; otherwise null.
    let billing: {
      outstanding: { number: string; matterId: Id<"matters">; due: number }[];
      totalDue: number;
    } | null = null;
    if (can(ac, "billing.invoice") || can(ac, "billing.payment")) {
      const invoices = await ctx.db
        .query("invoices")
        .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
        .collect();
      const openInvoices = invoices
        .filter(
          (i) =>
            i.status !== "paid" &&
            i.status !== "cancelled" &&
            i.status !== "draft" &&
            visibleIds.has(i.matterId),
        )
        .sort((a, b) => b.createdAt - a.createdAt);
      billing = {
        outstanding: openInvoices.slice(0, 6).map((i) => ({
          number: i.number,
          matterId: i.matterId,
          due: (i.totalMinor - i.amountPaidMinor) / 100,
        })),
        totalDue:
          openInvoices.reduce(
            (s, i) => s + (i.totalMinor - i.amountPaidMinor),
            0,
          ) / 100,
      };
    }

    return {
      matters: matters.slice(0, 50),
      mattersTruncated: matters.length > 50,
      clients: clients.map((c) => ({ _id: c._id, name: c.name, kind: c.kind })),
      todaysHearings,
      upcomingHearingsCount: upcoming.length - todaysHearings.length,
      deadlines,
      myTasks,
      gaps,
      activity: events,
      billing,
    };
  },
});

// ===============================================================
// FIRM DASHBOARD
// ===============================================================

/** Firm-wide statistics, team workload and administration summary. */
export const firmDashboard = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;

    const now = Date.now();

    const orgMatters = await ctx.db
      .query("matters")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const visibleMatters = orgMatters.filter((m) => canViewMatter(ac, m));
    const matterById = new Map(orgMatters.map((m) => [m._id, m]));

    const clients = await ctx.db
      .query("clients")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();

    const [memberships, hearings, tasks, invoices] = await Promise.all([
      ctx.db
        .query("memberships")
        .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
        .collect(),
      ctx.db.query("hearings").collect(),
      ctx.db.query("tasks").collect(),
      ctx.db
        .query("invoices")
        .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
        .collect(),
    ]);

    const visibleIds = new Set(visibleMatters.map((m) => m._id));
    const upcomingHearings = hearings
      .filter(
        (h) =>
          h.status === "scheduled" &&
          h.at > now &&
          visibleIds.has(h.matterId),
      )
      .sort((a, b) => a.at - b.at);

    // Team workload: open matters and pending tasks per active member.
    const workload = await Promise.all(
      memberships
        .filter((m) => m.status === "active")
        .map(async (m) => {
          const u = await ctx.db.get(m.userId);
          return {
            membershipId: m._id,
            userId: m.userId,
            name: u?.name ?? m.invitedEmail ?? "Invited member",
            orgRole: m.orgRole,
            openMatters: orgMatters.filter(
              (x) => x.status !== "closed" && x.teamIds?.includes(m.userId),
            ).length,
            pendingTasks: tasks.filter(
              (t) => t.status === "pending" && t.assigneeId === m.userId,
            ).length,
          };
        }),
    );
    workload.sort(
      (a, b) => b.openMatters + b.pendingTasks - (a.openMatters + a.pendingTasks),
    );

    // Matter activity: most recently touched visible matters.
    const activityMatters = [...visibleMatters]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 8)
      .map((m) => ({
        _id: m._id,
        reference: m.reference,
        title: m.title,
        status: m.status,
        updatedAt: m.updatedAt,
      }));

    // Financials only for authorized (billing-capability) users.
    let financials: {
      billed: number;
      collected: number;
      outstanding: number;
      openInvoices: number;
    } | null = null;
    if (can(ac, "billing.invoice") || can(ac, "billing.payment")) {
      const payments = await ctx.db.query("payments").collect();
      const invoiceIds = new Set(invoices.map((i) => i._id));
      financials = {
        billed:
          invoices
            .filter((i) => i.status !== "cancelled" && i.status !== "draft")
            .reduce((s, i) => s + i.totalMinor, 0) / 100,
        collected:
          payments
            .filter((p) => invoiceIds.has(p.invoiceId))
            .reduce((s, p) => s + p.amountMinor, 0) / 100,
        outstanding:
          invoices
            .filter((i) => i.status !== "paid" && i.status !== "cancelled")
            .reduce((s, i) => s + (i.totalMinor - i.amountPaidMinor), 0) / 100,
        openInvoices: invoices.filter(
          (i) => i.status !== "paid" && i.status !== "cancelled" && i.status !== "draft",
        ).length,
      };
    }

    return {
      stats: {
        matters: orgMatters.length,
        openMatters: orgMatters.filter((m) => m.status !== "closed").length,
        clients: clients.length,
        teamMembers: memberships.filter((m) => m.status === "active").length,
        suspended: memberships.filter((m) => m.status === "suspended").length,
        invited: memberships.filter((m) => m.status === "invited").length,
        pendingTasks: tasks.filter(
          (t) =>
            t.status === "pending" &&
            t.matterId !== undefined &&
            visibleIds.has(t.matterId),
        ).length,
        upcomingHearings: upcomingHearings.length,
      },
      workload: workload.slice(0, 10),
      matterActivity: activityMatters,
      upcomingHearings: upcomingHearings.slice(0, 6).map((h) => ({
        _id: h._id,
        matterId: h.matterId,
        matterReference: matterById.get(h.matterId)?.reference ?? "—",
        title: h.title,
        court: h.court ?? null,
        at: h.at,
      })),
      deadlines: tasks
        .filter(
          (t) =>
            t.status === "pending" &&
            t.dueAt !== undefined &&
            t.matterId !== undefined &&
            visibleIds.has(t.matterId),
        )
        .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
        .slice(0, 6)
        .map((t) => ({
          _id: t._id,
          matterId: t.matterId!,
          matterReference: matterById.get(t.matterId!)?.reference ?? "—",
          title: t.title,
          dueAt: t.dueAt ?? null,
        })),
      financials,
      // Administration summary — what the firm admin manages from here.
      administration: {
        canManageTeam: can(ac, "team.manage"),
        canInvite: can(ac, "team.invite"),
        canEditPermissions: can(ac, "permissions.edit"),
        canEditProfile: can(ac, "org.edit_profile"),
      },
    };
  },
});

// ===============================================================
// STAFF DASHBOARD (support staff — narrow, task-scoped view)
// ===============================================================

/**
 * Support staff never get client lists, financials or confidential
 * notes — only their assigned work and the specific documents shared
 * with them (access-checked per document, per matter).
 */
export const staffDashboard = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");

    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_assignee", (q) => q.eq("assigneeId", user._id))
      .collect();

    const matterIds = Array.from(
      new Set(
        tasks
          .map((t) => t.matterId)
          .filter((id): id is Id<"matters"> => id !== undefined),
      ),
    );
    const matters = (
      await Promise.all(matterIds.map((id) => ctx.db.get(id)))
    ).filter(Boolean) as Doc<"matters">[];
    const matterById = new Map(matters.map((m) => [m._id, m]));

    // Permitted references only: the matters that carry their tasks.
    const matterRefs = matters.map((m) => ({
      _id: m._id,
      title: m.title,
      reference: m.reference,
      court: m.court ?? null,
    }));

    // Upcoming hearings on those matters (references only).
    const now = Date.now();
    const hearings = (
      await Promise.all(
        matterIds.map((id) =>
          ctx.db
            .query("hearings")
            .withIndex("by_matter", (q) => q.eq("matterId", id))
            .collect(),
        ),
      )
    )
      .flat()
      .filter((h) => h.status === "scheduled" && h.at > now)
      .sort((a, b) => a.at - b.at)
      .slice(0, 8)
      .map((h) => ({
        _id: h._id,
        matterReference: matterById.get(h.matterId)?.reference ?? "—",
        title: h.title,
        at: h.at,
      }));

    // Specifically authorized documents: only files explicitly shared
    // with the client (same restricted stream staff receive).
    const documents = (
      await Promise.all(
        matterIds.map((id) =>
          ctx.db
            .query("matterDocuments")
            .withIndex("by_matter", (q) => q.eq("matterId", id))
            .collect(),
        ),
      )
    )
      .flat()
      .filter((d) => d.visibility === "shared_with_client")
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 30);

    const work = tasks
      .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))
      .map((t) => ({
        _id: t._id,
        matterId: t.matterId ?? null,
        matterReference:
          (t.matterId !== undefined
            ? matterById.get(t.matterId)?.reference
            : null) ?? "—",
        title: t.title,
        dueAt: t.dueAt ?? null,
        status: t.status,
        updates: t.staffUpdates ?? [],
        acknowledgements: t.acknowledgements ?? [],
      }));

    return { tasks: work, matters: matterRefs, hearings, documents };
  },
});

// ===============================================================
// CLIENT MUTATIONS — messages, submissions, acknowledgements
// ===============================================================

const MAX_CLIENT_TEXT = 2000;

/** Post a secure message to the lawyer on a granted matter. */
export const clientMessage = mutation({
  args: { matterId: v.id("matters"), body: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");
    if (user.isAnonymous) throw new Error("Verified account required.");
    const client = await clientForUser(ctx.db, user._id);
    if (!client) throw new Error("No client portal access.");

    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.clientId !== client._id) {
      throw new Error("Matter not found among your matters.");
    }
    const body = args.body.trim();
    if (!body) throw new Error("Message cannot be empty.");
    if (body.length > MAX_CLIENT_TEXT)
      throw new Error(`Message must be at most ${MAX_CLIENT_TEXT} characters.`);

    await ctx.db.insert("matterNotes", {
      matterId: args.matterId,
      authorId: user._id,
      body,
      fromClient: true,
      createdAt: Date.now(),
    });
    await ctx.db.insert("matterEvents", {
      matterId: args.matterId,
      kind: "message",
      detail: "Message received from the client.",
      createdAt: Date.now(),
      authorId: user._id,
      visibility: "shared_with_client",
    });

    // Mirror into the matter's client thread so the Comms desk and the
    // portal show one shared history. Participants resolve below; when
    // no thread exists yet this no-ops (the chamber's next client update
    // or thread creation picks the message up from the portal surface).
    const thread = await ctx.db
      .query("conversations")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect()
      .then((rows) =>
        rows
          .filter((c) => c.scope === "matter" && !c.archivedAt)
          .sort((a, b) => b.createdAt - a.createdAt)[0],
      );
    if (thread) {
      await ctx.db.insert("messages", {
        conversationId: thread._id,
        orgId: thread.orgId,
        senderId: user._id,
        senderKind: "client",
        body,
        kind: "message",
        createdAt: Date.now(),
      });
      await ctx.db.patch(thread._id, { lastMessageAt: Date.now() });
      const participants = await ctx.db
        .query("conversationParticipants")
        .withIndex("by_conversation", (q) => q.eq("conversationId", thread!._id))
        .collect();
      for (const p of participants) {
        if (p.removedAt || p.userId === user._id) continue;
        await ctx.db.patch(p._id, { unreadCount: p.unreadCount + 1 });
      }
    }
  },
});

/**
 * Upload URL for a client submission — issued only when the lawyer has
 * enabled document submission on that matter.
 */
export const generateClientUploadUrl = mutation({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");
    if (user.isAnonymous) throw new Error("Verified account required.");
    const client = await clientForUser(ctx.db, user._id);
    if (!client) throw new Error("No client portal access.");

    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.clientId !== client._id) {
      throw new Error("Matter not found among your matters.");
    }
    if (matter.clientSubmission !== true) {
      throw new Error("Document submission is not enabled for this matter.");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

/** Client uploads a document (only where the lawyer enabled submission). */
export const clientUploadDocument = mutation({
  args: {
    matterId: v.id("matters"),
    name: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");
    if (user.isAnonymous) throw new Error("Verified account required.");
    const client = await clientForUser(ctx.db, user._id);
    if (!client) throw new Error("No client portal access.");

    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.clientId !== client._id) {
      throw new Error("Matter not found among your matters.");
    }
    if (matter.clientSubmission !== true) {
      throw new Error(
        "Document submission is not enabled for this matter. Ask your lawyer.",
      );
    }
    const name = args.name.trim().slice(0, 200);
    if (!name) throw new Error("Document name is required.");

    await ctx.db.insert("matterDocuments", {
      matterId: args.matterId,
      uploaderId: user._id,
      name,
      kind: "document",
      visibility: "shared_with_client",
      storageId: args.storageId,
      submittedByClient: true,
      createdAt: Date.now(),
    });
    await ctx.db.insert("matterEvents", {
      matterId: args.matterId,
      kind: "document",
      detail: `Document submitted by the client — ${name}.`,
      createdAt: Date.now(),
    });
  },
});

/** Client acknowledges a requested document as received/not required. */
export const clientAcknowledgeRequest = mutation({
  args: { documentId: v.id("matterDocuments") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");
    const client = await clientForUser(ctx.db, user._id);
    if (!client) throw new Error("No client portal access.");

    const doc = await ctx.db.get(args.documentId);
    if (!doc || doc.visibility !== "shared_with_client") return null;
    const matter = await ctx.db.get(doc.matterId);
    if (!matter || matter.clientId !== client._id) return null;

    const seen = doc.seenByClient ?? [];
    if (!seen.includes(user._id)) {
      await ctx.db.patch(args.documentId, { seenByClient: [...seen, user._id] });
    }
  },
});

// ===============================================================
// CHAMBER SIDE — checklist + replies (capability-checked)
// ===============================================================

/** Toggle a document's checklist status / add instructions (task.manage). */
export const setDocumentRequest = mutation({
  args: {
    documentId: v.id("matterDocuments"),
    requested: v.boolean(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) throw new Error("Sign in and select an organization.");
    requireCapability(ac, "task.manage");

    const doc = await ctx.db.get(args.documentId);
    if (!doc) throw new Error("Document not found.");
    const matter = await ctx.db.get(doc.matterId);
    if (!matter) throw new Error("Matter not found.");
    if (!canViewMatter(ac, matter)) {
      throw new Error("You do not have access to this matter.");
    }

    await ctx.db.patch(args.documentId, {
      requestedFromClient: args.requested,
      requestedNote: args.note?.slice(0, 500),
    });
  },
});

/** Reply to a client message on the matter thread (note.write). */
export const replyToClient = mutation({
  args: { matterId: v.id("matters"), body: v.string() },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) throw new Error("Sign in and select an organization.");
    requireCapability(ac, "note.write");
    await requireMatter(ctx, ac, args.matterId);

    const body = args.body.trim();
    if (!body) throw new Error("Reply cannot be empty.");
    if (body.length > MAX_CLIENT_TEXT)
      throw new Error(`Reply must be at most ${MAX_CLIENT_TEXT} characters.`);

    await ctx.db.insert("matterNotes", {
      matterId: args.matterId,
      authorId: ac.user._id,
      body,
      toClient: true,
      createdAt: Date.now(),
    });
    await ctx.db.insert("matterEvents", {
      matterId: args.matterId,
      kind: "message",
      detail: "Reply sent to the client.",
      createdAt: Date.now(),
    });
  },
});

// ===============================================================
// STAFF MUTATIONS — status updates + completion evidence
// ===============================================================

/** Support staff post a progress note on their own assigned task. */
export const staffTaskUpdate = mutation({
  args: { taskId: v.id("tasks"), body: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found.");
    if (task.assigneeId !== user._id) {
      throw new Error("You can only update your own tasks.");
    }
    const body = args.body.trim();
    if (!body) throw new Error("Update cannot be empty.");
    if (body.length > 1000)
      throw new Error("Update must be at most 1000 characters.");

    const updates = task.staffUpdates ?? [];
    if (updates.length >= 20) {
      throw new Error("Too many updates on this task.");
    }
    await ctx.db.patch(args.taskId, {
      staffUpdates: [...updates, { body, at: Date.now() }],
    });
  },
});

/** Upload URL for support-staff completion evidence. */
export const staffGenerateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");
    return await ctx.storage.generateUploadUrl();
  },
});

/** Support staff attach completion evidence to their own task. */
export const staffAttachAcknowledgement = mutation({
  args: {
    taskId: v.id("tasks"),
    name: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found.");
    if (task.assigneeId !== user._id) {
      throw new Error("You can only attach evidence to your own tasks.");
    }
    const name = args.name.trim().slice(0, 200);
    if (!name) throw new Error("File name is required.");

    const docs = task.acknowledgements ?? [];
    if (docs.length >= 5) {
      throw new Error("Up to five acknowledgement files per task.");
    }
    await ctx.db.patch(args.taskId, {
      acknowledgements: [
        ...docs,
        { name, storageId: args.storageId, at: Date.now() },
      ],
    });
    await ctx.db.insert("matterEvents", {
      matterId: task.matterId!,
      kind: "task",
      detail: `Acknowledgement attached — ${name}.`,
      createdAt: Date.now(),
    });
  },
});
