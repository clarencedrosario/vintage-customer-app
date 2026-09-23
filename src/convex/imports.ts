// =====================================================================
// Data import (section 28) — stage, validate, preview, commit, discard.
//
// Flow: the browser parses a CSV into rows and calls `stage`. Staging
// VALIDATES against the org's own records (duplicate detection, linked
// IDs resolved to this org only) and stores the validated payloads on
// the batch row. Nothing else is written until the user reviews the
// preview and calls `commit`. `discard` deletes a staged batch. Every
// batch is committed at most once (idempotency at the storage layer),
// and only records the user supplied are ever imported.
// =====================================================================

import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { can, getAccessContext, requireAccess } from "./access";
import { IMPORT_ROW_LIMIT } from "../lib/csvImport";

type Staged =
  | { kind: "client"; name: string; fields: Record<string, string> }
  | { kind: "matter"; clientName: string; fields: Record<string, string> }
  | { kind: "hearing"; matterRef: string; fields: Record<string, string> }
  | { kind: "event"; matterRef: string; fields: Record<string, string> }
  | { kind: "document"; matterRef: string; fields: Record<string, string> };

function req(fields: Record<string, string>, key: string, row: number, errors: { row: number; message: string }[]): string | null {
  const value = (fields[key] ?? "").trim();
  if (!value) errors.push({ row, message: `“${key}” is required.` });
  return value || null;
}

/** End of an IST day string (YYYY-MM-DD) as a timestamp. */
function istDayEnd(dateStr: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const end = new Date(`${dateStr}T23:59:59+05:30`).getTime();
  return Number.isNaN(end) ? null : end;
}

function istDateTime(dateStr: string): number | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/.exec(dateStr.trim());
  if (!m) return istDayEnd(dateStr);
  const t = new Date(`${m[1]}T${m[2]}:00+05:30`).getTime();
  return Number.isNaN(t) ? null : t;
}

// ---------------------------------------------------------------------
// Stage — parse + validate + persist the batch
// ---------------------------------------------------------------------

export const stage = mutation({
  args: {
    entity: v.union(
      v.literal("clients"),
      v.literal("matters"),
      v.literal("hearings"),
      v.literal("chronology"),
      v.literal("document_metadata"),
    ),
    fileName: v.string(),
    duplicateStrategy: v.union(v.literal("skip"), v.literal("create")),
    rows: v.array(v.record(v.string(), v.string())),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "client.create") && !can(ac, "matter.create")) {
      throw new Error(
        "Your role cannot import data. Ask an owner or administrator.",
      );
    }

    if (args.rows.length === 0) throw new Error("The file contains no data rows.");
    if (args.rows.length > IMPORT_ROW_LIMIT) {
      throw new Error(
        `Import is limited to ${IMPORT_ROW_LIMIT} rows per batch — split the file.`,
      );
    }

    const errors: { row: number; message: string }[] = [];
    const staged: Staged[] = [];
    const now = Date.now();

    // --- Reference material for duplicate + linked-ID checks ----------
    const existingClients = await ctx.db
      .query("clients")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const clientByName = new Map(
      existingClients.map((c) => [c.name.trim().toLowerCase(), c]),
    );
    const existingMatters = await ctx.db
      .query("matters")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const matterByRef = new Map(existingMatters.map((m) => [m.reference, m]));

    let duplicateCount = 0;

    for (let i = 0; i < args.rows.length; i++) {
      const rowNo = i + 2; // header is line 1; hints row shown in UI only
      const fields: Record<string, string> = {};
      for (const [k, val] of Object.entries(args.rows[i]!)) {
        fields[k.trim()] = typeof val === "string" ? val.trim() : "";
      }

      if (args.entity === "clients") {
        const name = req(fields, "name", rowNo, errors);
        if (!name) continue;
        const dup = clientByName.get(name.toLowerCase());
        if (dup) {
          duplicateCount++;
          if (args.duplicateStrategy === "skip") {
            errors.push({ row: rowNo, message: `Duplicate client “${name}” — skipped.` });
            continue;
          }
        }
        const kind = (fields.kind || "individual").toLowerCase();
        if (!["individual", "company", "trust", "government"].includes(kind)) {
          errors.push({ row: rowNo, message: `Unknown client kind “${fields.kind}”.` });
          continue;
        }
        if (fields.pincode && !/^\d{6}$/.test(fields.pincode)) {
          errors.push({ row: rowNo, message: "PIN code must be 6 digits." });
          continue;
        }
        staged.push({ kind: "client", name, fields });
      } else if (args.entity === "matters") {
        const clientName = req(fields, "clientName", rowNo, errors);
        const title = req(fields, "title", rowNo, errors);
        const practiceArea = req(fields, "practiceArea", rowNo, errors);
        if (!clientName || !title || !practiceArea) continue;
        const client = clientByName.get(clientName.toLowerCase());
        if (!client) {
          errors.push({
            row: rowNo,
            message: `No client named “${clientName}” — import clients first.`,
          });
          continue;
        }
        if (fields.reference && matterByRef.has(fields.reference)) {
          duplicateCount++;
          if (args.duplicateStrategy === "skip") {
            errors.push({ row: rowNo, message: `Matter ${fields.reference} already exists — skipped.` });
            continue;
          }
        }
        const status = (fields.status || "open").toLowerCase();
        if (!["open", "in_progress", "on_hold", "closed"].includes(status)) {
          errors.push({ row: rowNo, message: `Unknown status “${fields.status}”.` });
          continue;
        }
        staged.push({ kind: "matter", clientName, fields });
      } else if (args.entity === "hearings") {
        const matterRef = req(fields, "matterReference", rowNo, errors);
        const title = req(fields, "title", rowNo, errors);
        const at = req(fields, "at", rowNo, errors);
        if (!matterRef || !title || !at) continue;
        const matter = matterByRef.get(matterRef);
        if (!matter) {
          errors.push({ row: rowNo, message: `No matter ${matterRef} in this chamber.` });
          continue;
        }
        const atTs = istDateTime(at);
        if (atTs === null) {
          errors.push({ row: rowNo, message: "Date must be YYYY-MM-DD HH:mm (IST)." });
          continue;
        }
        staged.push({ kind: "hearing", matterRef, fields });
      } else if (args.entity === "chronology") {
        const matterRef = req(fields, "matterReference", rowNo, errors);
        const detail = req(fields, "detail", rowNo, errors);
        if (!matterRef || !detail) continue;
        const matter = matterByRef.get(matterRef);
        if (!matter) {
          errors.push({ row: rowNo, message: `No matter ${matterRef} in this chamber.` });
          continue;
        }
        const precision = (fields.datePrecision || "exact").toLowerCase();
        if (!["exact", "day", "approx"].includes(precision)) {
          errors.push({ row: rowNo, message: `Unknown date precision “${fields.datePrecision}”.` });
          continue;
        }
        const occurredAt = fields.occurredAt
          ? istDayEnd(fields.occurredAt)
          : now;
        if (fields.occurredAt && occurredAt === null) {
          errors.push({ row: rowNo, message: "Date must be YYYY-MM-DD." });
          continue;
        }
        staged.push({ kind: "event", matterRef, fields });
      } else {
        // document_metadata
        const matterRef = req(fields, "matterReference", rowNo, errors);
        const name = req(fields, "name", rowNo, errors);
        if (!matterRef || !name) continue;
        const matter = matterByRef.get(matterRef);
        if (!matter) {
          errors.push({ row: rowNo, message: `No matter ${matterRef} in this chamber.` });
          continue;
        }
        const kind = (fields.kind || "document").toLowerCase();
        if (!["document", "communication"].includes(kind)) {
          errors.push({ row: rowNo, message: `Unknown kind “${fields.kind}”.` });
          continue;
        }
        const visibility = (fields.visibility || "internal").toLowerCase();
        if (!["internal", "shared_with_client"].includes(visibility)) {
          errors.push({ row: rowNo, message: `Unknown visibility “${fields.visibility}”.` });
          continue;
        }
        staged.push({ kind: "document", matterRef, fields });
      }
    }

    const batchId = `imp_${now}_${Math.random().toString(36).slice(2, 10)}`;
    await ctx.db.insert("dataImports", {
      orgId: ac.org._id,
      batchId,
      entity: args.entity,
      status: "staged",
      fileName: args.fileName.trim().slice(0, 200) || "import.csv",
      totalRows: args.rows.length,
      validRows: staged.length,
      errorCount: errors.length,
      errors: errors.slice(0, 100),
      duplicateStrategy: args.duplicateStrategy,
      duplicateCount,
      rows: staged,
      createdById: ac.user._id,
      createdAt: now,
    });

    return { batchId, totalRows: args.rows.length, validRows: staged.length, errorCount: errors.length };
  },
});

// ---------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------

/** Recent import batches for the org (newest first, 15). */
export const listBatches = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    return ctx.db
      .query("dataImports")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect()
      .then((rows) =>
        rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 15),
      );
  },
});

/** One staged batch for preview (org-checked). */
export const getBatch = query({
  args: { batchId: v.string() },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const rows = await ctx.db
      .query("dataImports")
      .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
      .collect();
    const batch = rows.find((b) => b.orgId === ac.org._id);
    if (!batch) return null;
    return batch;
  },
});

// ---------------------------------------------------------------------
// Commit — write the validated rows for real (once)
// ---------------------------------------------------------------------

export const commit = mutation({
  args: { batchId: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "client.create") && !can(ac, "matter.create")) {
      throw new Error("Your role cannot import data.");
    }
    const rows = await ctx.db
      .query("dataImports")
      .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
      .collect();
    const batch = rows.find((b) => b.orgId === ac.org._id);
    if (!batch) throw new Error("Import batch not found.");
    if (batch.status !== "staged") {
      throw new Error(
        batch.status === "committed"
          ? "This batch was already committed (each batch is applied once)."
          : "This batch was discarded and cannot be committed.",
      );
    }

    const now = Date.now();
    let created = 0;
    let updated = 0;

    // Fresh lookups at commit time — data may have moved since staging.
    const clients = await ctx.db
      .query("clients")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const clientByName = new Map(clients.map((c) => [c.name.trim().toLowerCase(), c]));
    const matters = await ctx.db
      .query("matters")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const matterByRef = new Map(matters.map((m) => [m.reference, m]));

    const year = new Date(now).getFullYear();
    const usedRefs = new Set(matters.map((m) => m.reference));
    const nextAutoRef = () => {
      const yearPrefix = `${ac.org.invoicePrefix}/${year}/`;
      let n = 1;
      while (usedRefs.has(`${yearPrefix}${String(n).padStart(4, "0")}`)) n++;
      const ref = `${yearPrefix}${String(n).padStart(4, "0")}`;
      usedRefs.add(ref);
      return ref;
    };

    for (const row of batch.rows as unknown as Staged[]) {
      if (row.kind === "client") {
        const dup = clientByName.get(row.name.toLowerCase());
        if (dup && batch.duplicateStrategy === "skip") continue;
        const f = row.fields;
        const id = await ctx.db.insert("clients", {
          orgId: ac.org._id,
          kind: (f.kind || "individual") as Doc<"clients">["kind"],
          name: row.name,
          email: f.email || undefined,
          phone: f.phone || undefined,
          addressLine1: f.addressLine1 || undefined,
          addressLine2: f.addressLine2 || undefined,
          city: f.city || undefined,
          state: f.state || undefined,
          pincode: f.pincode || undefined,
          gstin: f.gstin?.toUpperCase() || undefined,
          notes: f.notes || undefined,
          createdBy: ac.user._id,
          createdAt: now,
        });
        clientByName.set(row.name.toLowerCase(), await ctx.db.get(id) as Doc<"clients">);
        created++;
      } else if (row.kind === "matter") {
        const client =
          clientByName.get(row.clientName.toLowerCase()) ??
          (await ctx.db
            .query("clients")
            .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
            .collect()
            .then((all) =>
              all.find((c) => c.name.trim().toLowerCase() === row.clientName.toLowerCase()),
            ));
        if (!client) continue;
        const f = row.fields;
        const reference = f.reference && !matterByRef.has(f.reference) ? f.reference : nextAutoRef();
        const matterId = await ctx.db.insert("matters", {
          orgId: ac.org._id,
          clientId: client._id,
          reference,
          title: f.title,
          practiceArea: f.practiceArea,
          court: f.court || undefined,
          caseNumber: f.caseNumber || undefined,
          opposingParty: f.opposingParty || undefined,
          status: (f.status || "open") as Doc<"matters">["status"],
          createdBy: ac.user._id,
          createdAt: now,
          updatedAt: now,
        });
        matterByRef.set(reference, await ctx.db.get(matterId) as Doc<"matters">);
        await ctx.db.insert("matterEvents", {
          matterId,
          kind: "created",
          detail: `Matter opened via data import (${batch.fileName}).`,
          createdAt: now,
          occurredAt: now,
          datePrecision: "exact",
        });
        created++;
      } else if (row.kind === "hearing") {
        const matter = matterByRef.get(row.matterRef);
        if (!matter) continue;
        const f = row.fields;
        const atTs = istDateTime(f.at);
        if (atTs === null) continue;
        await ctx.db.insert("hearings", {
          matterId: matter._id,
          title: f.title,
          court: f.court || undefined,
          courtroom: f.courtroom || undefined,
          judge: f.judge || undefined,
          purpose: f.purpose || undefined,
          at: atTs,
          status: "scheduled",
          createdAt: now,
        });
        created++;
      } else if (row.kind === "event") {
        const matter = matterByRef.get(row.matterRef);
        if (!matter) continue;
        const f = row.fields;
        await ctx.db.insert("matterEvents", {
          matterId: matter._id,
          kind: "note",
          detail: f.detail,
          createdAt: now,
          occurredAt: f.occurredAt ? istDayEnd(f.occurredAt) ?? now : now,
          datePrecision: (f.datePrecision || "exact") as "exact" | "day" | "approx",
          sourceRef: f.sourceRef || undefined,
        });
        created++;
      } else if (row.kind === "document") {
        const matter = matterByRef.get(row.matterRef);
        if (!matter) continue;
        const f = row.fields;
        await ctx.db.insert("matterDocuments", {
          matterId: matter._id,
          uploaderId: ac.user._id,
          name: f.name,
          kind: (f.kind || "document") as Doc<"matterDocuments">["kind"],
          visibility: (f.visibility || "internal") as Doc<"matterDocuments">["visibility"],
          createdAt: now,
        });
        created++;
      }
    }

    await ctx.db.patch(batch._id, {
      status: "committed",
      createdCount: created,
      updatedCount: updated,
      committedById: ac.user._id,
      committedAt: now,
    });

    // Audit-trail entry (redacted: counts only, no row contents).
    await ctx.db.insert("auditLog", {
      orgId: ac.org._id,
      actorId: ac.user._id,
      actorName: ac.user.name ?? ac.user.email ?? "Member",
      action: "Data import committed",
      detail: `${batch.entity} — ${created} created from ${batch.fileName} (${batch.errors.length} row issue(s) reported).`,
      createdAt: now,
    });

    return { created, errors: batch.errors.length };
  },
});

/** Discard a staged batch (it is never applied). */
export const discard = mutation({
  args: { batchId: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "client.create") && !can(ac, "matter.create")) {
      throw new Error("Your role cannot manage imports.");
    }
    const rows = await ctx.db
      .query("dataImports")
      .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
      .collect();
    const batch = rows.find((b) => b.orgId === ac.org._id);
    if (!batch) throw new Error("Import batch not found.");
    if (batch.status !== "staged") throw new Error("Only staged batches can be discarded.");
    await ctx.db.patch(batch._id, { status: "discarded" });
  },
});
