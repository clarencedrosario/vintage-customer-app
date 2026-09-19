import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { getCurrentUser } from "./users";
import { portalForRole } from "./schema";
import { MEMBERSHIP_STATUSES } from "./schema";
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

    const [hearings, documents, invoices, events] = await Promise.all([
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
      Promise.all(
        matterIds.map((id) =>
          ctx.db
            .query("matterEvents")
            .withIndex("by_matter", (q) => q.eq("matterId", id))
            .collect(),
        ),
      ).then((rows) => rows.flat()),
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

// ---------------------------------------------------------------
// Staff portal — assigned tasks, filing work, shared documents
// ---------------------------------------------------------------

export const staffPortal = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");

    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_assignee", (q) => q.eq("assigneeId", user._id))
      .collect();

    const matterIds = Array.from(new Set(tasks.map((t) => t.matterId)));
    const matterRows = (
      await Promise.all(matterIds.map((id) => ctx.db.get(id)))
    ).filter(Boolean) as Doc<"matters">[];

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
      .filter((d) => d.visibility === "shared_with_client");

    return {
      tasks: tasks.sort(
        (a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity),
      ),
      matters: matterRows.map((m) => ({
        _id: m._id,
        title: m.title,
        reference: m.reference,
      })),
      documents: documents
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 30),
    };
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
