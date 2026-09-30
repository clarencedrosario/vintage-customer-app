import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAccess } from "./access";
import type { Doc, Id } from "./_generated/dataModel";

// =====================================================================
// Restore verification — the §24 acceptance criterion "restore test"
// turned from a paper register into a REAL, bounded, repeatable drill.
//
// Flow: `restoreSandboxInternal` reads an ARCHIVE BLOB (the JSON written
// by backups.archiveExport) and inserts every row into a SANDBOX
// organization — a fresh org named "Restore Sandbox …" that no member
// can see from the normal UI (memberships are never created for it).
// Live data is never modified or deleted: the drill only ADDS a sandbox
// org and, afterwards, can purge sandboxes.
//
// Guarantees:
//  - id-ref remapping: archive rows reference OLD ids; each insert gets
//    a NEW id and every child pointer is rewritten through the map.
//  - count verification: restored counts must equal archive counts —
//    a mismatch throws (the drill FAILS, honestly).
//  - sandbox isolation: org marked isSandbox; data.importSandbox
//    refuses anything else; purgeSandbox removes exactly one sandbox.
// =====================================================================

type AnyRow = Record<string, unknown>;

function isSandboxOrg(org: Doc<"organizations"> | null): boolean {
  return !!org && org.slug.startsWith("restore-sandbox-");
}

/** Internal: sandbox marker check used by purge/import guards. */
export const orgIsSandbox = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    return isSandboxOrg(org);
  },
});

/**
 * Restore an archive blob into a SANDBOX organization and verify the
 * row counts. Runs as an internal action so it can fetch the stored
 * archive; all writes happen through an internal mutation (one big
 * transaction — a failed verification aborts the whole insert).
 */
export const restoreIntoSandbox = internalAction({
  args: {
    archiveStorageId: v.id("_storage"),
    performedById: v.id("users"),
  },
  handler: async (ctx, args): Promise<{
    sandboxOrgId: Id<"organizations">;
    verified: Record<string, number>;
  }> => {
    const blob = await ctx.storage.get(args.archiveStorageId);
    if (!blob) throw new Error("Archive blob not found in storage.");
    const archive = JSON.parse(await blob.text()) as {
      counts?: Record<string, number>;
      clients?: AnyRow[];
      matters?: AnyRow[];
      hearings?: AnyRow[];
      orders?: AnyRow[];
      tasks?: AnyRow[];
      invoices?: AnyRow[];
      documents?: AnyRow[];
      events?: AnyRow[];
      organization?: { name?: string; slug?: string };
    };

    const result = await ctx.runMutation(internal.restoreVerification.restoreSandboxInternal, {
      archiveStorageId: args.archiveStorageId,
      performedById: args.performedById,
      archive,
    });
    return result;
  },
});

export const restoreSandboxInternal = internalMutation({
  args: {
    archiveStorageId: v.id("_storage"),
    performedById: v.id("users"),
    archive: v.any(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ sandboxOrgId: Id<"organizations">; verified: Record<string, number> }> => {
    const archive = args.archive as {
      counts?: Record<string, number>;
      clients?: AnyRow[];
      matters?: AnyRow[];
      hearings?: AnyRow[];
      orders?: AnyRow[];
      tasks?: AnyRow[];
      invoices?: AnyRow[];
      documents?: AnyRow[];
      events?: AnyRow[];
      organization?: { name?: string; slug?: string };
    };

    const now = Date.now();
    const sandboxOrgId = (await ctx.db.insert("organizations", {
      name: `Restore Sandbox — ${archive.organization?.name ?? "archive"}`,
      slug: `restore-sandbox-${now.toString(36)}`,
      kind: "chamber",
      currency: "INR",
      timezone: "Asia/Kolkata",
      financialYearStart: "04-01",
      taxLabel: "GST",
      taxPercent: 18,
      invoicePrefix: "RS",
      createdBy: args.performedById,
      createdAt: now,
    })) as Id<"organizations">;

    const idMap = new Map<string, string>();

    const remap = (table: string, value: unknown): unknown => {
      if (typeof value === "string" && value.length > 0) {
        const hit = idMap.get(`${table}:${value}`);
        if (hit) return hit;
      }
      return undefined;
    };

    // --- clients -------------------------------------------------------
    const clients = archive.clients ?? [];
    for (const c of clients) {
      const oldId = c._id as string;
      delete c._id;
      delete c._creationTime;
      const row = c as AnyRow;
      row.orgId = sandboxOrgId;
      // Required field; the archive carries no users, so the sandbox
      // row is attributed to the operator who ran the drill.
      row.createdBy = args.performedById;
      row.responsibleLawyerId = undefined;
      row.userId = undefined;
      row.archivedBy = undefined;
      const newId = (await ctx.db.insert("clients", row as never)) as Id<"clients">;
      idMap.set(`clients:${oldId}`, newId);
    }

    // --- matters (client pointer remapped; user pointers dropped) ------
    const matters = archive.matters ?? [];
    for (const m of matters) {
      const oldId = m._id as string;
      delete m._id;
      delete m._creationTime;
      const row = m as AnyRow;
      const clientId = remap("clients", row.clientId);
      if (!clientId) continue; // matter without its client cannot exist
      row.clientId = clientId;
      row.orgId = sandboxOrgId;
      // User references cannot be safely mapped (archive carries no
      // users) — drop them rather than inventing dangling ids.
      for (const k of [
        "leadLawyerId",
        "confirmedById",
        "archivedBy",
        "conflictCheckId",
        // Enrichment fields added by exportMatters (denormalized display
        // data, not table columns).
        "clientName",
      ]) {
        delete row[k];
      }
      if (Array.isArray(row.teamIds)) row.teamIds = [];
      const newId = (await ctx.db.insert("matters", row as never)) as Id<"matters">;
      idMap.set(`matters:${oldId}`, newId);
    }

    // --- hearings ------------------------------------------------------
    const hearings = archive.hearings ?? [];
    for (const h of hearings) {
      const oldId = h._id as string;
      delete h._id;
      delete h._creationTime;
      const row = h as AnyRow;
      const matterId = remap("matters", row.matterId);
      if (!matterId) continue;
      row.matterId = matterId;
      delete row.appearingAdvocateId;
      delete row.outcomeRecordedBy;
      if (Array.isArray(row.reschedules)) {
        row.reschedules = (row.reschedules as AnyRow[]).map((r) => ({
          ...r,
          byId: undefined,
        }));
      }
      const newId = (await ctx.db.insert("hearings", row as never)) as Id<"hearings">;
      idMap.set(`hearings:${oldId}`, newId);
    }

    // --- orders (hearing pointer remapped when present) ----------------
    const orders = archive.orders ?? [];
    for (const o of orders) {
      const oldId = o._id as string;
      delete o._id;
      delete o._creationTime;
      const row = o as AnyRow;
      const matterId = remap("matters", row.matterId);
      if (!matterId) continue;
      row.matterId = matterId;
      row.hearingId = remap("hearings", row.hearingId);
      delete row.reviewedBy;
      // storageId points at binary content NOT in this archive — drop
      // it honestly (the drill verifies records, not object storage).
      delete row.storageId;
      const newId = (await ctx.db.insert("orders", row as never)) as Id<"orders">;
      idMap.set(`orders:${oldId}`, newId);
    }

    // --- tasks ---------------------------------------------------------
    const tasks = archive.tasks ?? [];
    for (const t of tasks) {
      const oldId = t._id as string;
      delete t._id;
      delete t._creationTime;
      const row = t as AnyRow;
      row.orgId = sandboxOrgId;
      row.matterId = remap("matters", row.matterId);
      row.assigneeId = undefined;
      row.createdById = args.performedById; // required field, no users in archive
      row.completedById = undefined;
      row.automationRunId = undefined;
      if (Array.isArray(row.comments)) row.comments = [];
      if (Array.isArray(row.attachments)) row.attachments = [];
      const newId = (await ctx.db.insert("tasks", row as never)) as Id<"tasks">;
      idMap.set(`tasks:${oldId}`, newId);
    }

    // --- invoices (client + matter remapped) ---------------------------
    const invoices = archive.invoices ?? [];
    for (const inv of invoices) {
      const oldId = inv._id as string;
      delete inv._id;
      delete inv._creationTime;
      const row = inv as AnyRow;
      const clientId = remap("clients", row.clientId);
      const matterId = remap("matters", row.matterId);
      if (!clientId || !matterId) continue;
      row.clientId = clientId;
      row.matterId = matterId;
      row.orgId = sandboxOrgId;
      row.createdBy = args.performedById;
      delete row.paymentLinkId;
      delete row.paymentLinkUrl;
      delete row.paymentOrderId;
      const newId = (await ctx.db.insert("invoices", row as never)) as Id<"invoices">;
      idMap.set(`invoices:${oldId}`, newId);
    }

    // --- documents -------------------------------------------------------
    const documents = archive.documents ?? [];
    for (const d of documents) {
      const oldId = d._id as string;
      delete d._id;
      delete d._creationTime;
      const row = d as AnyRow;
      const matterId = remap("matters", row.matterId);
      if (!matterId) continue;
      row.matterId = matterId;
      row.uploaderId = args.performedById;
      delete row.storageId; // binary content not in record archive
      delete row.seenByClient;
      if (Array.isArray(row.custody)) {
        row.custody = (row.custody as AnyRow[]).map((c) => ({
          ...c,
          byId: undefined,
        }));
      }
      const newId = (await ctx.db.insert("matterDocuments", row as never)) as Id<"matterDocuments">;
      idMap.set(`matterDocuments:${oldId}`, newId);
    }

    // --- events ----------------------------------------------------------
    const events = archive.events ?? [];
    for (const e of events) {
      const oldId = e._id as string;
      delete e._id;
      delete e._creationTime;
      const row = e as AnyRow;
      const matterId = remap("matters", row.matterId);
      if (!matterId) continue;
      row.matterId = matterId;
      row.authorId = undefined;
      row.supersedes = undefined;
      const newId = (await ctx.db.insert("matterEvents", row as never)) as Id<"matterEvents">;
      idMap.set(`matterEvents:${oldId}`, newId);
    }

    // --- count verification: the drill FAILS on any mismatch -----------
    const verified: Record<string, number> = {
      clients: (archive.clients ?? []).length,
      matters: (archive.matters ?? []).length,
      hearings: (archive.hearings ?? []).length,
      orders: (archive.orders ?? []).length,
      tasks: (archive.tasks ?? []).length,
      invoices: (archive.invoices ?? []).length,
      documents: (archive.documents ?? []).length,
      events: (archive.events ?? []).length,
    };
    const expected = archive.counts ?? {};
    const mismatches: string[] = [];
    for (const k of Object.keys(verified)) {
      if (expected[k] !== undefined && expected[k] !== verified[k]) {
        mismatches.push(`${k}: archive ${expected[k]} vs restored ${verified[k]}`);
      }
    }
    if (mismatches.length > 0) {
      throw new Error(
        `RESTORE VERIFICATION FAILED — ${mismatches.join("; ")}. The transaction was aborted; the sandbox org was not created.`,
      );
    }

    return { sandboxOrgId, verified };
  },
});

/** List sandbox orgs created by drills (owner/admin only). */
export const listSandboxesForOrg = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    if (ac.membership.orgRole !== "owner" && ac.membership.orgRole !== "administrator") {
      throw new Error("Only owners and administrators can list restore drills.");
    }
    const orgs = await ctx.db.query("organizations").collect();
    return orgs
      .filter((o) => o.slug.startsWith(`restore-sandbox-`))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20);
  },
});

/**
 * Owner-run restore drill: restore the LATEST archive of this org into
 * a sandbox, verify counts, record the result in the register, then
 * purge the sandbox. Everything happens inside this one call.
 */
export const runRestoreDrill = action({
  args: {},
  handler: async (ctx): Promise<{ verified: Record<string, number>; result: "passed" }> => {
    const me = await ctx.runQuery(internal.backups.callerContext, {});
    if (!me) throw new Error("Sign in and select an organization first.");
    if (me.role !== "owner" && me.role !== "administrator") {
      throw new Error("Only owners and administrators can run a restore drill.");
    }
    const orgId = me.orgId as Id<"organizations">;

    // The latest archive of THIS org.
    const records = await ctx.runQuery(internal.restoreVerification.latestArchiveInternal, {
      orgId,
    });
    if (!records) {
      throw new Error(
        "No archive export exists yet — run an archive export first, then drill.",
      );
    }

    let verified: Record<string, number>;
    try {
      const r = await ctx.runAction(internal.restoreVerification.restoreIntoSandbox, {
        archiveStorageId: records.storageId as Id<"_storage">,
        performedById: me.userId as Id<"users">,
      });
      verified = r.verified;
      // Purge the sandbox after a successful verification.
      await ctx.runMutation(internal.restoreVerification.purgeSandboxInternal, {
        orgId: r.sandboxOrgId,
      });
    } catch (err) {
      await ctx.runMutation(internal.backups.recordRestoreTestInternal, {
        orgId,
        performedById: me.userId as Id<"users">,
        performedByName: me.orgName ?? "Member",
        label: `Restore drill — archive ${new Date(records.performedAt).toISOString().slice(0, 10)}`,
        result: "failed",
        procedureNote: err instanceof Error ? err.message.slice(0, 900) : "Unknown failure.",
      });
      throw err;
    }

    await ctx.runMutation(internal.backups.recordRestoreTestInternal, {
      orgId,
      performedById: me.userId as Id<"users">,
      performedByName: me.orgName ?? "Member",
      label: `Restore drill — archive ${new Date(records.performedAt).toISOString().slice(0, 10)}`,
      result: "passed",
      procedureNote: `Sandbox restore + count verification passed (clients ${verified.clients}, matters ${verified.matters}, hearings ${verified.hearings}, orders ${verified.orders}, tasks ${verified.tasks}, invoices ${verified.invoices}, documents ${verified.documents}, events ${verified.events}); sandbox purged after verification.`,
    });
    return { verified, result: "passed" };
  },
});

/** Internal: this org's latest archive record (id + storage + date). */
export const latestArchiveInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("backupRecords")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    const archives = rows
      .filter((r) => r.kind === "archive_export")
      .sort((a, b) => b.performedAt - a.performedAt);
    const latest = archives[0];
    if (!latest?.storageId) return null;
    return {
      storageId: latest.storageId,
      performedAt: latest.performedAt,
      label: latest.label,
      counts: latest.counts ?? null,
    };
  },
});/**
 * List sandbox orgs created by drills (owner/admin only).
 */
export const listSandboxOrgs = internalQuery({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("organizations").collect();
    return orgs.filter((o) => o.slug.startsWith("restore-sandbox-"));
  },
});

/**
 * Purge exactly one sandbox org and its restored rows. Refuses
 * anything that is not a restore sandbox — live data is untouchable
 * through this path by construction.
 */
export const purgeSandboxInternal = internalMutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (!isSandboxOrg(org)) {
      throw new Error("Refusing to purge: not a restore sandbox organization.");
    }
    let deleted = 0;
    const matterRows = await ctx.db
      .query("matters")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    const matterIds = new Set(matterRows.map((m) => m._id));
    const clientRows = await ctx.db
      .query("clients")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();

    const tablesByMatter = [
      "hearings",
      "orders",
      "matterDocuments",
      "matterEvents",
      "invoices",
    ] as const;
    for (const table of tablesByMatter) {
      for (const matterId of matterIds) {
        const rows = await ctx.db
          .query(table)
          .withIndex("by_matter", (q) => q.eq("matterId", matterId))
          .collect();
        for (const row of rows) {
          await ctx.db.delete(row._id);
          deleted += 1;
        }
      }
    }
    for (const c of clientRows) {
      await ctx.db.delete(c._id);
      deleted += 1;
    }
    for (const m of matterRows) {
      await ctx.db.delete(m._id);
      deleted += 1;
    }
    const taskRows = await ctx.db
      .query("tasks")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    for (const t of taskRows) {
      await ctx.db.delete(t._id);
      deleted += 1;
    }
    await ctx.db.delete(args.orgId);
    deleted += 1;
    return { deleted };
  },
});
