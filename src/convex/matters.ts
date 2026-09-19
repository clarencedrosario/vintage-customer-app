import { v } from "convex/values";
import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  canViewDocument,
  canViewMatter,
  can,
  getAccessContext,
  matterOrNull,
  requireAccess,
  requireCapability,
  requireMatter,
} from "./access";
import {
  MATTER_STATUSES,
  matterStatusValidator,
  taskStatusValidator,
  type OrgRole,
} from "./schema";

// Limits
const MAX_TEXT = 4000;
const MAX_NAME = 200;

async function logEvent(
  ctx: MutationCtx,
  matterId: Id<"matters">,
  kind: string,
  detail: string,
) {
  await ctx.db.insert("matterEvents", {
    matterId,
    kind,
    detail,
    createdAt: Date.now(),
  });
}

/** Org-scoped matter reference like ADV/2026/0007 for a new matter. */
async function nextMatterReference(ctx: MutationCtx, orgId: Id<"organizations">, prefix: string) {
  const year = new Date().getFullYear();
  const matters = await ctx.db
    .query("matters")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const yearPrefix = `${prefix}/${year}/`;
  const count = matters.filter((m) => m.reference.startsWith(yearPrefix)).length;
  return `${prefix}/${year}/${String(count + 1).padStart(4, "0")}`;
}

/** May this role set team restrictions? owner/partner/administrator only. */
function mayRestrictTeam(role: OrgRole): boolean {
  return role === "owner" || role === "partner" || role === "administrator";
}

// ---------------- Matters ----------------

/** Matters in the active org the caller may see, newest activity first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const matters = await ctx.db
      .query("matters")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const visible = matters
      .filter((m) => canViewMatter(ac, m))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return Promise.all(
      visible.map(async (m) => ({
        ...m,
        client: await ctx.db.get(m.clientId),
      })),
    );
  },
});

/** One matter with client joined; null when absent or not permitted. */
export const get = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const matter = await matterOrNull(ctx, ac, args.matterId);
    if (!matter) return null;
    return { ...matter, client: await ctx.db.get(matter.clientId) };
  },
});

/** Open a new matter. */
export const create = mutation({
  args: {
    title: v.string(),
    clientId: v.id("clients"),
    practiceArea: v.string(),
    court: v.optional(v.string()),
    opposingParty: v.optional(v.string()),
    description: v.optional(v.string()),
    teamIds: v.optional(v.array(v.id("users"))),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.create");

    const title = args.title.trim();
    if (!title) throw new Error("Matter title is required.");
    if (title.length > MAX_NAME)
      throw new Error(`Title must be at most ${MAX_NAME} characters.`);

    const client = await ctx.db.get(args.clientId);
    if (!client) throw new Error("Select a client for this matter.");
    if (client.orgId !== ac.org._id) {
      throw new Error("That client belongs to a different organization.");
    }

    // team restriction requires the elevated capability
    let teamIds = args.teamIds;
    if (teamIds && teamIds.length > 0 && !mayRestrictTeam(ac.membership.orgRole)) {
      teamIds = undefined; // silently drop rather than fail the filing
    }

    const reference = await nextMatterReference(
      ctx,
      ac.org._id,
      ac.org.invoicePrefix,
    );
    const now = Date.now();

    const matterId = await ctx.db.insert("matters", {
      orgId: ac.org._id,
      title,
      reference,
      clientId: args.clientId,
      practiceArea: args.practiceArea.trim(),
      court: args.court?.trim() || undefined,
      opposingParty: args.opposingParty?.trim() || undefined,
      description: args.description?.trim() || undefined,
      status: MATTER_STATUSES.OPEN,
      teamIds,
      createdBy: ac.user._id,
      createdAt: now,
      updatedAt: now,
    });

    await logEvent(ctx, matterId, "created", `Matter opened — ${reference}.`);
    return matterId;
  },
});

/** Update matter status and log the docket entry. */
export const updateStatus = mutation({
  args: { matterId: v.id("matters"), status: matterStatusValidator },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.edit");
    const matter = await requireMatter(ctx, ac, args.matterId);

    if (args.status === MATTER_STATUSES.CLOSED) {
      requireCapability(ac, "matter.close");
    }
    await ctx.db.patch(args.matterId, {
      status: args.status,
      updatedAt: Date.now(),
    });
    await logEvent(
      ctx,
      args.matterId,
      "status",
      `Status set to ${args.status.replace("_", " ")}.`,
    );
  },
});

/** Enable or disable client document submission on this matter. */
export const setClientSubmission = mutation({
  args: { matterId: v.id("matters"), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.edit");
    await requireMatter(ctx, ac, args.matterId);
    await ctx.db.patch(args.matterId, {
      clientSubmission: args.enabled,
      updatedAt: Date.now(),
    });
    await logEvent(
      ctx,
      args.matterId,
      "status",
      args.enabled
        ? "Client document submission enabled."
        : "Client document submission disabled.",
    );
  },
});

/** Restrict a matter to a responsible team (owner/partner/admin). */
export const setTeam = mutation({
  args: { matterId: v.id("matters"), teamIds: v.array(v.id("users")) },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!mayRestrictTeam(ac.membership.orgRole)) {
      throw new Error("Only owners, partners and administrators can set matter teams.");
    }
    await requireMatter(ctx, ac, args.matterId);
    await ctx.db.patch(args.matterId, {
      teamIds: args.teamIds.length ? args.teamIds : undefined,
      updatedAt: Date.now(),
    });
    await logEvent(
      ctx,
      args.matterId,
      "status",
      args.teamIds.length
        ? "Matter restricted to its responsible team."
        : "Matter opened to the whole organization.",
    );
  },
});

// ---------------- Hearings ----------------

export const addHearing = mutation({
  args: {
    matterId: v.id("matters"),
    title: v.string(),
    court: v.optional(v.string()),
    at: v.number(),
    appearance: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "hearing.manage");
    await requireMatter(ctx, ac, args.matterId);

    await ctx.db.insert("hearings", {
      matterId: args.matterId,
      title: args.title.trim(),
      court: args.court?.trim() || undefined,
      at: args.at,
      appearance: args.appearance?.trim() || undefined,
      notes: args.notes?.trim() || undefined,
      status: "scheduled",
      createdAt: Date.now(),
    });
    const when = new Date(args.at).toLocaleString("en-IN", {
      timeZone: ac.org.timezone,
      dateStyle: "medium",
      timeStyle: "short",
    });
    await logEvent(ctx, args.matterId, "hearing", `Hearing scheduled — ${when}.`);
  },
});

export const setHearingStatus = mutation({
  args: {
    hearingId: v.id("hearings"),
    status: v.union(
      v.literal("held"),
      v.literal("adjourned"),
      v.literal("scheduled"),
    ),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "hearing.manage");
    const hearing = await ctx.db.get(args.hearingId);
    if (!hearing) throw new Error("Hearing not found.");
    await requireMatter(ctx, ac, hearing.matterId);
    await ctx.db.patch(args.hearingId, { status: args.status });
    await logEvent(ctx, hearing.matterId, "hearing", `Hearing marked ${args.status}.`);
  },
});

// ---------------- Orders ----------------

export const addOrder = mutation({
  args: {
    matterId: v.id("matters"),
    title: v.string(),
    passedOn: v.number(),
    summary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "order.record");
    await requireMatter(ctx, ac, args.matterId);
    await ctx.db.insert("orders", {
      matterId: args.matterId,
      title: args.title.trim(),
      passedOn: args.passedOn,
      summary: args.summary?.trim() || undefined,
      createdAt: Date.now(),
    });
    await logEvent(ctx, args.matterId, "order", `Order recorded — ${args.title.trim()}.`);
  },
});

/** Mark an order as reviewed (order.record holders on visible matters). */
export const markOrderReviewed = mutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "order.record");
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found.");
    await requireMatter(ctx, ac, order.matterId);
    await ctx.db.patch(args.orderId, {
      reviewedAt: Date.now(),
      reviewedBy: ac.user._id,
    });
  },
});

// ---------------- Tasks ----------------

export const addTask = mutation({
  args: {
    matterId: v.id("matters"),
    title: v.string(),
    dueAt: v.optional(v.number()),
    assigneeId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "task.manage");
    await requireMatter(ctx, ac, args.matterId);
    if (!args.title.trim()) throw new Error("Task title is required.");

    // Support staff may only create tasks they assign to themselves.
    const assigneeId =
      ac.membership.orgRole === "support_staff"
        ? ac.user._id
        : (args.assigneeId ?? ac.user._id);

    await ctx.db.insert("tasks", {
      matterId: args.matterId,
      title: args.title.trim(),
      dueAt: args.dueAt,
      status: "pending",
      assigneeId,
      createdAt: Date.now(),
    });
    await logEvent(ctx, args.matterId, "task", `Task added — ${args.title.trim()}.`);
  },
});

export const setTaskStatus = mutation({
  args: { taskId: v.id("tasks"), status: taskStatusValidator },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found.");
    await requireMatter(ctx, ac, task.matterId);

    const isMine = task.assigneeId === ac.user._id;
    if (!isMine && !can(ac, "task.manage")) {
      throw new Error("You can only update your own tasks.");
    }
    await ctx.db.patch(args.taskId, { status: args.status });
    await logEvent(
      ctx,
      task.matterId,
      "task",
      `Task ${args.status === "done" ? "completed" : "reopened"} — ${task.title}.`,
    );
  },
});

/** Upcoming (pending) tasks across visible matters, soonest due first. */
export const upcomingTasks = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    const matterCache = new Map<Id<"matters">, Doc<"matters"> | null>();
    const out = [];
    for (const t of tasks) {
      let matter = matterCache.get(t.matterId);
      if (matter === undefined) {
        matter = await ctx.db.get(t.matterId);
        matterCache.set(t.matterId, matter);
      }
      if (!matter || matter.orgId !== ac.org._id) continue;
      if (!canViewMatter(ac, matter)) continue;
      out.push({ ...t, matter });
    }
    return out
      .filter((t) => t.dueAt !== undefined)
      .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
  },
});

// ---------------- Time ----------------

export const addTime = mutation({
  args: {
    matterId: v.id("matters"),
    description: v.string(),
    minutes: v.number(),
    ratePerHour: v.number(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "time.log");
    const matter = await requireMatter(ctx, ac, args.matterId);
    if (args.minutes <= 0) throw new Error("Minutes must be positive.");
    if (args.ratePerHour < 0) throw new Error("Rate cannot be negative.");
    await ctx.db.insert("timeEntries", {
      matterId: args.matterId,
      userId: ac.user._id,
      description: args.description.trim(),
      minutes: args.minutes,
      ratePerHour: args.ratePerHour,
      date: args.date,
      createdAt: Date.now(),
    });
    void matter;
    await logEvent(
      ctx,
      args.matterId,
      "time",
      `Time recorded — ${args.minutes} min, ${args.description.trim()}.`,
    );
  },
});

// ---------------- Expenses ----------------

export const addExpense = mutation({
  args: {
    matterId: v.id("matters"),
    description: v.string(),
    amount: v.number(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "expense.log");
    await requireMatter(ctx, ac, args.matterId);
    if (args.amount <= 0) throw new Error("Amount must be positive.");
    await ctx.db.insert("expenses", {
      matterId: args.matterId,
      description: args.description.trim(),
      amount: args.amount,
      date: args.date,
      createdAt: Date.now(),
    });
    await logEvent(
      ctx,
      args.matterId,
      "expense",
      `Expense recorded — ₹${args.amount}, ${args.description.trim()}.`,
    );
  },
});

// ---------------- Notes ----------------

export const addNote = mutation({
  args: { matterId: v.id("matters"), body: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    await requireMatter(ctx, ac, args.matterId);
    const body = args.body.trim();
    if (!body) throw new Error("Note cannot be empty.");
    if (body.length > MAX_TEXT)
      throw new Error(`Note must be at most ${MAX_TEXT} characters.`);
    await ctx.db.insert("matterNotes", {
      matterId: args.matterId,
      authorId: ac.user._id,
      body,
      createdAt: Date.now(),
    });
    await logEvent(ctx, args.matterId, "note", "Note added to the file.");
  },
});

// ---------------- Documents ----------------

export const generateDocumentUploadUrl = mutation({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "document.upload");
    await requireMatter(ctx, ac, args.matterId);
    return await ctx.storage.generateUploadUrl();
  },
});

export const attachDocument = mutation({
  args: {
    matterId: v.id("matters"),
    name: v.string(),
    kind: v.union(v.literal("document"), v.literal("communication")),
    visibility: v.union(
      v.literal("internal"),
      v.literal("shared_with_client"),
    ),
    storageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "document.upload");
    await requireMatter(ctx, ac, args.matterId);

    const name = args.name.trim().slice(0, MAX_NAME);
    if (!name) throw new Error("Document name is required.");
    await ctx.db.insert("matterDocuments", {
      matterId: args.matterId,
      uploaderId: ac.user._id,
      name,
      kind: args.kind,
      visibility: args.visibility,
      storageId: args.storageId,
      createdAt: Date.now(),
    });
    await logEvent(
      ctx,
      args.matterId,
      "document",
      `Document filed — ${name}${args.visibility === "shared_with_client" ? " (shared with client)" : ""}.`,
    );
  },
});

/** Resolve a document URL, enforcing matter + document-level access. */
export const getDocumentUrl = query({
  args: { documentId: v.id("matterDocuments") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const doc = await ctx.db.get(args.documentId);
    if (!doc || !doc.storageId) return null;
    const matter = await ctx.db.get(doc.matterId);
    if (!matter) return null;
    if (!canViewDocument(ac, doc, matter)) return null;
    return await ctx.storage.getUrl(doc.storageId);
  },
});

// ---------------- Docket & lists ----------------

export const listEvents = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    await requireMatter(ctx, ac, args.matterId);
    const events = await ctx.db
      .query("matterEvents")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    return events.sort((a, b) => a.createdAt - b.createdAt);
  },
});

/** All hearings across visible matters (cause list). */
export const allHearings = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const matters = await ctx.db
      .query("matters")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const visibleIds = new Set(
      matters.filter((m) => canViewMatter(ac, m)).map((m) => m._id),
    );
    const hearings = await ctx.db.query("hearings").collect();
    const sorted = hearings
      .filter((h) => visibleIds.has(h.matterId))
      .sort((a, b) => a.at - b.at);
    return Promise.all(
      sorted.map(async (h) => ({ ...h, matter: await ctx.db.get(h.matterId) })),
    );
  },
});

/** Orders across visible matters. */
export const allOrders = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const matters = await ctx.db
      .query("matters")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const visibleIds = new Set(
      matters.filter((m) => canViewMatter(ac, m)).map((m) => m._id),
    );
    const orders = await ctx.db.query("orders").collect();
    const sorted = orders
      .filter((o) => visibleIds.has(o.matterId))
      .sort((a, b) => b.passedOn - a.passedOn);
    return Promise.all(
      sorted.map(async (o) => ({ ...o, matter: await ctx.db.get(o.matterId) })),
    );
  },
});

/** Notes for a matter, newest first. */
export const listNotes = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    await requireMatter(ctx, ac, args.matterId);
    const notes = await ctx.db
      .query("matterNotes")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    return notes.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** Documents for a matter (document-level access applied), newest first. */
export const listDocuments = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const matter = await requireMatter(ctx, ac, args.matterId);
    const docs = await ctx.db
      .query("matterDocuments")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    return docs
      .filter((d) => canViewDocument(ac, d, matter))
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** Time entries for a matter. */
export const listTime = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    await requireMatter(ctx, ac, args.matterId);
    const rows = await ctx.db
      .query("timeEntries")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** Expenses for a matter. */
export const listExpenses = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    await requireMatter(ctx, ac, args.matterId);
    const rows = await ctx.db
      .query("expenses")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});
