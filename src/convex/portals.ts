import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { getCurrentUser } from "./users";
import { portalForRole } from "./schema";
import type { Doc, Id } from "./_generated/dataModel";

function requireUser<
  T extends { _id: Id<"users">; role?: string; isAnonymous?: boolean },
>(user: T | null): asserts user is T {
  if (!user) throw new Error("You must be signed in.");
}

// ---------------------------------------------------------------
// Portal resolution
// ---------------------------------------------------------------

/**
 * Which portal is the signed-in user authorized for? Clicking a card
 * never grants privileges — this is resolved server-side from role and
 * explicit client grants.
 */
export const resolve = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return { portal: null as string | null, role: null as string | null };
    }
    return { portal: portalForRole(user.role), role: user.role ?? null };
  },
});

/**
 * Assign a role at registration. The first named account becomes the
 * firm owner; later self-signups default to lawyer. Invited staff and
 * connected-client roles are never overwritten.
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

    // A user arriving via staff/client invitation already has a role.
    if (
      user.role &&
      user.role !== "admin" &&
      user.role !== "user" &&
      user.role !== "member"
    ) {
      return { role: user.role };
    }

    const all = await ctx.db.query("users").collect();
    const hasConsoleMember = all.some(
      (u) =>
        !u.isAnonymous &&
        u._id !== user._id &&
        (u.role === "firm_owner" ||
          u.role === "admin" ||
          u.role === "lawyer" ||
          u.role === "user"),
    );

    const role = hasConsoleMember ? "lawyer" : "firm_owner";
    await ctx.db.patch(user._id, { role });
    return { role };
  },
});

// ---------------------------------------------------------------
// Helpers over the caller's explicit client grant
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

async function mattersForClient(
  db: QueryCtx["db"],
  clientId: Id<"clients">,
): Promise<Doc<"matters">[]> {
  return await db
    .query("matters")
    .withIndex("by_client", (q) => q.eq("clientId", clientId))
    .collect();
}

async function perMatter<T>(
  db: QueryCtx["db"],
  matterIds: Id<"matters">[],
  table: "hearings" | "matterDocuments" | "invoices" | "matterEvents",
): Promise<T[]> {
  const rows = await Promise.all(
    matterIds.map((id) =>
      db
        .query(table)
        .withIndex("by_matter", (q) => q.eq("matterId", id))
        .collect(),
    ),
  );
  return rows.flat() as unknown as T[];
}

// ---------------------------------------------------------------
// Client portal — bound to verified identity + explicit grant only
// ---------------------------------------------------------------

/** Everything the client portal renders, for the granted client only. */
export const clientPortal = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    requireUser(user);
    if (user.isAnonymous) {
      throw new Error("Client access requires a verified account.");
    }
    const client = await clientForUser(ctx.db, user._id);
    if (!client) return null;

    const matters = await mattersForClient(ctx.db, client._id);
    const matterIds = matters.map((m) => m._id);
    const [hearings, documents, invoices, events] = await Promise.all([
      perMatter<Doc<"hearings">>(ctx.db, matterIds, "hearings"),
      perMatter<Doc<"matterDocuments">>(ctx.db, matterIds, "matterDocuments"),
      perMatter<Doc<"invoices">>(ctx.db, matterIds, "invoices"),
      perMatter<Doc<"matterEvents">>(ctx.db, matterIds, "matterEvents"),
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
    };
  },
});

/** Resolve a read URL for a document, only if the caller's client owns it. */
export const clientDocumentUrl = query({
  args: { documentId: v.id("matterDocuments") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    requireUser(user);
    const client = await clientForUser(ctx.db, user._id);
    if (!client) return null;

    const doc = await ctx.db.get(args.documentId);
    if (!doc || !doc.storageId) return null;
    const matter = await ctx.db.get(doc.matterId);
    if (!matter || matter.clientId !== client._id) return null; // not yours

    return await ctx.storage.getUrl(doc.storageId);
  },
});

// ---------------------------------------------------------------
// Staff portal — assigned tasks, filing work, shared documents
// ---------------------------------------------------------------

export const staffPortal = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    requireUser(user);

    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_assignee", (q) => q.eq("assigneeId", user._id))
      .collect();

    const matterIds = Array.from(new Set(tasks.map((t) => t.matterId)));
    const matterRows = (await Promise.all(
      matterIds.map((id) => ctx.db.get(id)),
    ).then((rows) => rows.filter(Boolean))) as Doc<"matters">[];

    const documents = matterIds.length
      ? await perMatter<Doc<"matterDocuments">>(
          ctx.db,
          matterIds,
          "matterDocuments",
        )
      : [];

    return {
      tasks: tasks.sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity)),
      matters: matterRows.map((m) => ({
        _id: m._id,
        title: m.title,
        reference: m.reference,
      })),
      documents: documents.sort((a, b) => b.createdAt - a.createdAt).slice(0, 30),
    };
  },
});

/** Mark one of my assigned tasks done. */
export const completeTask = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    requireUser(user);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found.");
    if (task.assigneeId !== user._id) {
      throw new Error("You can only complete your own tasks.");
    }
    await ctx.db.patch(args.taskId, { status: "done" });
  },
});
