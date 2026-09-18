import { v } from "convex/values";
import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import { getCurrentUser } from "./users";
import { getOrCreateChamber } from "./chamber";
import {
  MATTER_STATUSES,
  matterStatusValidator,
  taskStatusValidator,
} from "./schema";

// Limits
const MAX_TEXT = 4000;
const MAX_NAME = 200;

async function requireUser(ctx: QueryCtx) {
  const user = await getCurrentUser(ctx);
  if (!user) throw new Error("You must be signed in.");
  return user;
}

async function logEvent(
  ctx: MutationCtx,
  matterId: any,
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

/** Chamber reference like ADV/2026/0007 for a new matter. */
async function nextMatterReference(ctx: MutationCtx, prefix: string) {
  const year = new Date().getFullYear();
  const all = await ctx.db.query("matters").collect();
  const yearPrefix = `${prefix}/${year}/`;
  const count = all.filter((m) => m.reference.startsWith(yearPrefix)).length;
  return `${prefix}/${year}/${String(count + 1).padStart(4, "0")}`;
}

// ---------------- Matters ----------------

/** All matters with client joined, newest activity first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const matters = await ctx.db.query("matters").collect();
    const sorted = matters.sort((a, b) => b.updatedAt - a.updatedAt);
    return Promise.all(
      sorted.map(async (m) => ({
        ...m,
        client: await ctx.db.get(m.clientId),
      })),
    );
  },
});

/** One matter with client joined. */
export const get = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const matter = await ctx.db.get(args.matterId);
    if (!matter) return null;
    return {
      ...matter,
      client: await ctx.db.get(matter.clientId),
    };
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
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const title = args.title.trim();
    if (!title) throw new Error("Matter title is required.");
    if (title.length > MAX_NAME)
      throw new Error(`Title must be at most ${MAX_NAME} characters.`);

    const client = await ctx.db.get(args.clientId);
    if (!client) throw new Error("Select a client for this matter.");

    const chamber = await getOrCreateChamber(ctx);
    const reference = await nextMatterReference(
      ctx,
      chamber?.invoicePrefix ?? "ADV",
    );
    const now = Date.now();

    const matterId = await ctx.db.insert("matters", {
      title,
      reference,
      clientId: args.clientId,
      practiceArea: args.practiceArea.trim(),
      court: args.court?.trim() || undefined,
      opposingParty: args.opposingParty?.trim() || undefined,
      description: args.description?.trim() || undefined,
      status: MATTER_STATUSES.OPEN,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });

    await logEvent(
      ctx,
      matterId,
      "created",
      `Matter opened — ${reference}`,
    );
    return matterId;
  },
});

/** Update matter status and log the docket entry. */
export const updateStatus = mutation({
  args: { matterId: v.id("matters"), status: matterStatusValidator },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const matter = await ctx.db.get(args.matterId);
    if (!matter) throw new Error("Matter not found.");

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
    await requireUser(ctx);
    const at = args.at;
    await ctx.db.insert("hearings", {
      matterId: args.matterId,
      title: args.title.trim(),
      court: args.court?.trim() || undefined,
      at,
      appearance: args.appearance?.trim() || undefined,
      notes: args.notes?.trim() || undefined,
      status: "scheduled",
      createdAt: Date.now(),
    });
    const when = new Date(at).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
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
    await requireUser(ctx);
    const hearing = await ctx.db.get(args.hearingId);
    if (!hearing) throw new Error("Hearing not found.");
    await ctx.db.patch(args.hearingId, { status: args.status });
    await logEvent(
      ctx,
      hearing.matterId,
      "hearing",
      `Hearing marked ${args.status}.`,
    );
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
    await requireUser(ctx);
    await ctx.db.insert("orders", {
      matterId: args.matterId,
      title: args.title.trim(),
      passedOn: args.passedOn,
      summary: args.summary?.trim() || undefined,
      createdAt: Date.now(),
    });
    await logEvent(
      ctx,
      args.matterId,
      "order",
      `Order recorded — ${args.title.trim()}.`,
    );
  },
});

// ---------------- Tasks ----------------

export const addTask = mutation({
  args: {
    matterId: v.id("matters"),
    title: v.string(),
    dueAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (!args.title.trim()) throw new Error("Task title is required.");
    await ctx.db.insert("tasks", {
      matterId: args.matterId,
      title: args.title.trim(),
      dueAt: args.dueAt,
      status: "pending",
      assigneeId: user._id,
      createdAt: Date.now(),
    });
    await logEvent(ctx, args.matterId, "task", `Task added — ${args.title.trim()}.`);
  },
});

export const setTaskStatus = mutation({
  args: {
    taskId: v.id("tasks"),
    status: taskStatusValidator,
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found.");
    await ctx.db.patch(args.taskId, { status: args.status });
    await logEvent(
      ctx,
      task.matterId,
      "task",
      `Task ${args.status === "done" ? "completed" : "reopened"} — ${task.title}.`,
    );
  },
});

/** Upcoming (pending) tasks across all matters, soonest due first. */
export const upcomingTasks = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    const sorted = tasks
      .filter((t) => t.dueAt !== undefined)
      .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
    return Promise.all(
      sorted.map(async (t) => ({
        ...t,
        matter: await ctx.db.get(t.matterId),
      })),
    );
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
    const user = await requireUser(ctx);
    if (args.minutes <= 0) throw new Error("Minutes must be positive.");
    if (args.ratePerHour < 0) throw new Error("Rate cannot be negative.");
    await ctx.db.insert("timeEntries", {
      matterId: args.matterId,
      userId: user._id,
      description: args.description.trim(),
      minutes: args.minutes,
      ratePerHour: args.ratePerHour,
      date: args.date,
      createdAt: Date.now(),
    });
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
    await requireUser(ctx);
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
    const user = await requireUser(ctx);
    const body = args.body.trim();
    if (!body) throw new Error("Note cannot be empty.");
    if (body.length > MAX_TEXT)
      throw new Error(`Note must be at most ${MAX_TEXT} characters.`);
    await ctx.db.insert("matterNotes", {
      matterId: args.matterId,
      authorId: user._id,
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
    await requireUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const attachDocument = mutation({
  args: {
    matterId: v.id("matters"),
    name: v.string(),
    kind: v.union(v.literal("document"), v.literal("communication")),
    storageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const name = args.name.trim().slice(0, MAX_NAME);
    if (!name) throw new Error("Document name is required.");
    await ctx.db.insert("matterDocuments", {
      matterId: args.matterId,
      uploaderId: user._id,
      name,
      kind: args.kind,
      storageId: args.storageId,
      createdAt: Date.now(),
    });
    await logEvent(
      ctx,
      args.matterId,
      "document",
      `Document filed — ${name}.`,
    );
  },
});

export const getDocumentUrl = query({
  args: { documentId: v.id("matterDocuments") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const doc = await ctx.db.get(args.documentId);
    if (!doc || !doc.storageId) return null;
    return await ctx.storage.getUrl(doc.storageId);
  },
});

// ---------------- Docket ----------------

export const listEvents = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const events = await ctx.db
      .query("matterEvents")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    return events.sort((a, b) => a.createdAt - b.createdAt);
  },
});

/** All hearings across matters with matter joined (calendar feed). */
export const allHearings = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const hearings = await ctx.db.query("hearings").collect();
    const sorted = hearings.sort((a, b) => a.at - b.at);
    return Promise.all(
      sorted.map(async (h) => ({
        ...h,
        matter: await ctx.db.get(h.matterId),
      })),
    );
  },
});

/** Orders across matters with matter joined. */
export const allOrders = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const orders = await ctx.db.query("orders").collect();
    const sorted = orders.sort((a, b) => b.passedOn - a.passedOn);
    return Promise.all(
      sorted.map(async (o) => ({
        ...o,
        matter: await ctx.db.get(o.matterId),
      })),
    );
  },
});

/** Notes for a matter, newest first. */
export const listNotes = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const notes = await ctx.db
      .query("matterNotes")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    return notes.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** Documents for a matter, newest first. */
export const listDocuments = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const docs = await ctx.db
      .query("matterDocuments")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    return docs.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** Time entries for a matter. */
export const listTime = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
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
    await requireUser(ctx);
    const rows = await ctx.db
      .query("expenses")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});
