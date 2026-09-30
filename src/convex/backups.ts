// =====================================================================
// Backups & restore tests (section 28).
//
// Honest tooling only:
//  - `archiveExport` writes a chamber-scoped JSON archive of the
//    chamber's own records to object storage and registers it. Binary
//    files (scans, PDFs) live separately in object storage; Convex also
//    runs platform-level scheduled backups of the database and storage
//    — this export complements those and gives the chamber a portable
//    copy it controls.
//  - `recordRestoreTest` is a manual register entry by an owner after
//    an ACTUAL restore test in a non-production environment. The app
//    never marks restores as verified on its own.
// =====================================================================

import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { can, getAccessContext, requireAccess } from "./access";

// ---------------------------------------------------------------------
// Query: the register for the org
// ---------------------------------------------------------------------

export const listRecords = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    return ctx.db
      .query("backupRecords")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect()
      .then((rows) =>
        rows.sort((a, b) => b.performedAt - a.performedAt).slice(0, 20),
      );
  },
});

// ---------------------------------------------------------------------
// Action: full archive export of the chamber's own data
// ---------------------------------------------------------------------

type ArchiveCounts = {
  clients: number;
  matters: number;
  hearings: number;
  orders: number;
  tasks: number;
  invoices: number;
  documents: number;
  events: number;
};

export const archiveExport = action({
  args: { label: v.optional(v.string()) },
  handler: async (ctx, args) => {
    // Resolve who is calling (actions cannot use query-side ctx helpers).
    const me = await ctx.runQuery(internal.backups.callerContext, {});
    if (!me) throw new Error("Sign in and select an organization first.");
    if (me.role !== "owner" && me.role !== "administrator") {
      throw new Error("Only owners and administrators can export an archive.");
    }
    const orgId = me.orgId as Doc<"organizations">["_id"];

    const counts: ArchiveCounts = {
      clients: 0,
      matters: 0,
      hearings: 0,
      orders: 0,
      tasks: 0,
      invoices: 0,
      documents: 0,
      events: 0,
    };

    const clients = await ctx.runQuery(internal.backups.exportClients, { orgId });
    counts.clients = clients.length;

    const matters = await ctx.runQuery(internal.backups.exportMatters, { orgId });
    counts.matters = matters.length;

    // Org-checked matter id set (defence in depth against stale ids).
    const allowed = new Set(
      matters.map((m: { _id: Doc<"matters">["_id"] }) => m._id),
    );
    const matterIds = [...allowed];

    const hearings = matterIds.length
      ? await ctx.runQuery(internal.backups.exportByMatter, {
          orgId,
          table: "hearings" as const,
          matterIds,
        })
      : [];
    counts.hearings = hearings.length;

    const orders = matterIds.length
      ? await ctx.runQuery(internal.backups.exportByMatter, {
          orgId,
          table: "orders" as const,
          matterIds,
        })
      : [];
    counts.orders = orders.length;

    const tasks = await ctx.runQuery(internal.backups.exportTasks, { orgId });
    counts.tasks = tasks.length;

    const invoices = matterIds.length
      ? await ctx.runQuery(internal.backups.exportByMatter, {
          orgId,
          table: "invoices" as const,
          matterIds,
        })
      : [];
    counts.invoices = invoices.length;

    const documents = matterIds.length
      ? await ctx.runQuery(internal.backups.exportByMatter, {
          orgId,
          table: "matterDocuments" as const,
          matterIds,
        })
      : [];
    counts.documents = documents.length;

    const events = matterIds.length
      ? await ctx.runQuery(internal.backups.exportByMatter, {
          orgId,
          table: "matterEvents" as const,
          matterIds,
        })
      : [];
    counts.events = events.length;

    const payload = {
      exportedAt: new Date().toISOString(),
      organization: { name: me.orgName, slug: me.orgSlug },
      note: "Chamber archive export — database records only. Document files (scans, PDFs) are stored separately in object storage; platform backups cover both database and storage.",
      counts,
      clients,
      matters,
      hearings,
      orders,
      tasks,
      invoices,
      documents,
      events,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const storageId = await ctx.storage.store(blob);
    const url = await ctx.storage.getUrl(storageId);

    const label =
      args.label?.trim().slice(0, 120) ||
      `Archive export — ${new Date().toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
        month: "short",
        year: "numeric",
      })}`;

    await ctx.runMutation(internal.backups.registerExport, {
      orgId,
      performedById: me.userId,
      label,
      counts,
      storageId,
    });

    return { url, counts };
  },
});

// ---------------------------------------------------------------------
// Internal helpers (invoked by the action above)
// ---------------------------------------------------------------------

/** Caller context for actions: user, active org and role in one row. */
export const callerContext = internalQuery({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    return {
      userId: ac.user._id,
      orgId: ac.org._id,
      orgName: ac.org.name,
      orgSlug: ac.org.slug,
      role: ac.membership.orgRole,
      canPermissionsEdit: can(ac, "permissions.edit"),
    };
  },
});

export const exportClients = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) =>
    ctx.db
      .query("clients")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect(),
});

/** Matters with the client name resolved for portability. */
export const exportMatters = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const matters = await ctx.db
      .query("matters")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    const names = new Map<string, string>();
    return Promise.all(
      matters.map(async (m) => {
        let clientName = names.get(m.clientId);
        if (clientName === undefined) {
          const c = await ctx.db.get(m.clientId);
          clientName = c?.name ?? "(deleted client)";
          names.set(m.clientId, clientName);
        }
        return { ...m, clientName };
      }),
    );
  },
});

/**
 * Rows of a matter-scoped table. The table is a fixed whitelist, and the
 * matter ids are re-checked against the org before any row is returned.
 */
export const exportByMatter = internalQuery({
  args: {
    orgId: v.id("organizations"),
    table: v.union(
      v.literal("hearings"),
      v.literal("orders"),
      v.literal("invoices"),
      v.literal("matterDocuments"),
      v.literal("matterEvents"),
    ),
    matterIds: v.array(v.id("matters")),
  },
  handler: async (ctx, args) => {
    const allowed = new Set(
      (
        await ctx.db
          .query("matters")
          .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
          .collect()
      ).map((m) => m._id),
    );
    const ids = args.matterIds.filter((id) => allowed.has(id));
    const out: Record<string, unknown>[] = [];
    for (const id of ids) {
      if (args.table === "hearings") {
        out.push(
          ...(await ctx.db
            .query("hearings")
            .withIndex("by_matter", (q) => q.eq("matterId", id))
            .collect()),
        );
      } else if (args.table === "orders") {
        out.push(
          ...(await ctx.db
            .query("orders")
            .withIndex("by_matter", (q) => q.eq("matterId", id))
            .collect()),
        );
      } else if (args.table === "invoices") {
        out.push(
          ...(await ctx.db
            .query("invoices")
            .withIndex("by_matter", (q) => q.eq("matterId", id))
            .collect()),
        );
      } else if (args.table === "matterDocuments") {
        out.push(
          ...(await ctx.db
            .query("matterDocuments")
            .withIndex("by_matter", (q) => q.eq("matterId", id))
            .collect()),
        );
      } else {
        out.push(
          ...(await ctx.db
            .query("matterEvents")
            .withIndex("by_matter", (q) => q.eq("matterId", id))
            .collect()),
        );
      }
    }
    return out;
  },
});

/** All tasks of the org (firm-wide + matter tasks). */
export const exportTasks = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) =>
    ctx.db
      .query("tasks")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect(),
});

/** Register the archive (internal; called only by archiveExport). */
export const registerExport = internalMutation({
  args: {
    orgId: v.id("organizations"),
    performedById: v.id("users"),
    label: v.string(),
    counts: v.object({
      clients: v.number(),
      matters: v.number(),
      hearings: v.number(),
      orders: v.number(),
      tasks: v.number(),
      invoices: v.number(),
      documents: v.number(),
      events: v.number(),
    }),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("backupRecords", {
      orgId: args.orgId,
      kind: "archive_export",
      label: `${args.label} (archive ref ${args.storageId})`,
      counts: args.counts,
      storageId: args.storageId,
      performedById: args.performedById,
      performedAt: Date.now(),
    });
    await ctx.db.insert("auditLog", {
      orgId: args.orgId,
      actorId: args.performedById,
      actorName:
        (await ctx.db.get(args.performedById))?.name ?? "Member",
      action: "Archive export",
      detail: `${args.label} — ${args.counts.matters} matters, ${args.counts.documents} documents registered.`,
      createdAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------
// Restore-test register (manual, by an owner/administrator; the
// automated drill in restoreVerification.ts records through the
// internal variant below)
// ---------------------------------------------------------------------

/** Internal recorder for automated restore drills (no caller identity). */
export const recordRestoreTestInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    performedById: v.id("users"),
    performedByName: v.string(),
    label: v.string(),
    result: v.union(
      v.literal("passed"),
      v.literal("failed"),
      v.literal("partial"),
    ),
    procedureNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("backupRecords", {
      orgId: args.orgId,
      kind: "restore_test",
      label: args.label.slice(0, 120),
      environment: "restore-sandbox (same deployment, isolated org)",
      result: args.result,
      procedureNote: args.procedureNote?.slice(0, 1000),
      performedById: args.performedById,
      performedAt: Date.now(),
    });
    await ctx.db.insert("auditLog", {
      orgId: args.orgId,
      actorId: args.performedById,
      actorName: args.performedByName,
      action: "Restore drill (automated)",
      detail: `${args.label} — ${args.result}.`,
      createdAt: Date.now(),
    });
  },
});

export const recordRestoreTest = mutation({
  args: {
    label: v.string(),
    environment: v.string(),
    result: v.union(
      v.literal("passed"),
      v.literal("failed"),
      v.literal("partial"),
    ),
    procedureNote: v.optional(v.string()),
    retentionNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (
      !can(ac, "permissions.edit") &&
      ac.membership.orgRole !== "owner" &&
      ac.membership.orgRole !== "administrator"
    ) {
      throw new Error(
        "Only owners and administrators can record restore tests.",
      );
    }
    if (args.label.trim().length < 3)
      throw new Error("Give the test a clear label.");
    if (args.environment.trim().length < 2)
      throw new Error("Name the non-production environment used.");
    await ctx.db.insert("backupRecords", {
      orgId: ac.org._id,
      kind: "restore_test",
      label: args.label.trim().slice(0, 120),
      environment: args.environment.trim().slice(0, 120),
      result: args.result,
      procedureNote: args.procedureNote?.trim().slice(0, 1000) || undefined,
      retentionNote: args.retentionNote?.trim().slice(0, 500) || undefined,
      performedById: ac.user._id,
      performedAt: Date.now(),
    });
    await ctx.db.insert("auditLog", {
      orgId: ac.org._id,
      actorId: ac.user._id,
      actorName: ac.user.name ?? ac.user.email ?? "Member",
      action: "Restore test recorded",
      detail: `${args.label.trim()} — ${args.result} in ${args.environment.trim()}.`,
      createdAt: Date.now(),
    });
  },
});
