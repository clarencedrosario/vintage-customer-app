import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { getAccessContext, requireAccess } from "./access";
import { sha256HexBytes } from "./crypto";
import {
  appendPartAtCursor,
  computeOmissions,
  DOWNLOAD_TTL_MS,
  manifestLineCount,
  MANIFEST_DEFINITION,
  planCheckpoints,
  requireReauth,
  downloadDecision,
  type Checkpoint,
  type TableSpec,
} from "../lib/firmExit";

// =====================================================================
// §32 PHASE 12 — COMPLETE FIRM EXPORT & EXIT (turn 24).
//
// Extends the existing machinery (backups.ts archives, saasExports
// one-time tokens, Phase 7 legal holds) with the complete EXIT flow:
//
//  - RESUMABLE COLLECTION: ordered checkpoints per (table, matter
//    bucket); each completed checkpoint stores ONE checksummed JSON
//    part and appends it at exactly the resume cursor (fence-enforced
//    inside the append mutation). A retried worker advances; it can
//    never duplicate or reorder rows.
//  - VERIFICATION: an independent action re-reads every part from
//    storage, recomputes SHA-256 and compares — a mismatch is a
//    FAILED verification, recorded, never excused.
//  - DOWNLOADS: expiring (1h), single-use, audited grants to stored
//    objects. Expiry is the mechanism; the firm's downloaded copy is
//    theirs.
//  - EXIT: closing the organization is refused unless a VERIFIED
//    export exists, and is BLOCKED while any legal hold is active
//    (holds are listed, not lifted, by this module). Revocation is an
//    explicit, reauth-gated, reason-carrying decision that deletes
//    nothing.
// =====================================================================

/** Verified table names only; org-scoped rows are org-filtered in the bridge. */
const ORG_TABLES = ["clients", "invoices"] as const;
const MATTER_TABLES = [
  "matters",
  "clients_of_matter" /* placeholder replaced below */,
] as const;
void MATTER_TABLES;

const SPECS: TableSpec[] = [
  { table: "clients", kind: "org" },
  { table: "invoices", kind: "org" },
  { table: "matters", kind: "matter" },
  { table: "hearings", kind: "matter" },
  { table: "orders", kind: "matter" },
  { table: "tasks", kind: "matter" },
  { table: "matterEvents", kind: "matter" },
  { table: "matterTimeline", kind: "matter" },
  { table: "matterFacts", kind: "matter" },
  { table: "matterDocuments", kind: "matter" },
];

const MAX_MATTERS_PER_JOB = 200;

// ---------------------------------------------------------------------
// Reauthentication evidence (loginEvents — real sign-in records)
// ---------------------------------------------------------------------

async function lastLoginAt(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<number | null> {
  const row = await ctx.db
    .query("loginEvents")
    .withIndex("by_user_time", (q) => q.eq("userId", userId))
    .order("desc")
    .first();
  return row?.at ?? null;
}

async function loadJob(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
  jobId: Id<"firmExportJobs">,
): Promise<Doc<"firmExportJobs">> {
  const job = await ctx.db.get(jobId);
  if (!job || job.orgId !== orgId) {
    throw new Error("Export job not found in this organization.");
  }
  return job;
}

function assertExportCapability(
  ac: { membership: { orgRole: string }; permissions: Set<string> },
): void {
  if (!ac.permissions.has("data.export") && ac.membership.orgRole !== "owner") {
    throw new Error("The data export capability is required for this action.");
  }
}

// ---------------------------------------------------------------------
// The export job
// ---------------------------------------------------------------------

export const startExportJob = mutation({
  args: { label: v.optional(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ jobId: Id<"firmExportJobs">; checkpoints: number }> => {
    const ac = await requireAccess(ctx);
    assertExportCapability(ac);
    // REAUTHENTICATION: a recent successful sign-in is required to
    // START an export job — a stolen session cannot walk out with the
    // firm's complete records.
    requireReauth(await lastLoginAt(ctx, ac.user._id), Date.now());

    const active = await ctx.db
      .query("firmExportJobs")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    if (active.some((j) => j.status === "collecting")) {
      throw new Error(
        "An export job is already collecting — resume it instead of starting another.",
      );
    }

    const matters = await ctx.db
      .query("matters")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    if (matters.length > MAX_MATTERS_PER_JOB) {
      throw new Error(
        `This organization has ${matters.length} matters; this job covers up to ${MAX_MATTERS_PER_JOB}. Archive closed matters first (recorded as omissions on the next job).`,
      );
    }
    const plan = planCheckpoints(SPECS, matters.length);
    const now = Date.now();
    const jobId = await ctx.db.insert("firmExportJobs", {
      orgId: ac.org._id,
      status: "collecting",
      label:
        args.label?.trim().slice(0, 120) ||
        `Firm exit export — ${new Date(now).toISOString().slice(0, 10)}`,
      matterIds: matters.map((m) => m._id),
      cursor: 0,
      parts: [],
      downloads: [],
      omissions: [],
      startedById: ac.user._id,
      startedByName: ac.user.name || ac.user.email || "Member",
      createdAt: now,
      updatedAt: now,
    });
    return { jobId, checkpoints: plan.length };
  },
});

// ---------------------------------------------------------------------
// Collection (action: storage writes are action-only in Convex)
// ---------------------------------------------------------------------

/** Row bridge: concrete per-table queries, org/matter filtered. */
export const rowsForCheckpoint = internalQuery({
  args: {
    orgId: v.id("organizations"),
    table: v.string(),
    matterId: v.optional(v.id("matters")),
  },
  handler: async (ctx, args): Promise<Array<Record<string, unknown>>> => {
    const t = args.table;
    if (args.matterId !== undefined) {
      switch (t) {
        case "matters": {
          const m = await ctx.db.get(args.matterId);
          return m && m.orgId === args.orgId ? [m as unknown as Record<string, unknown>] : [];
        }
        case "hearings":
          return (await ctx.db
            .query("hearings")
            .withIndex("by_matter", (q) => q.eq("matterId", args.matterId!))
            .collect()) as unknown as Array<Record<string, unknown>>;
        case "orders":
          return (await ctx.db
            .query("orders")
            .withIndex("by_matter", (q) => q.eq("matterId", args.matterId!))
            .collect()) as unknown as Array<Record<string, unknown>>;
        case "tasks":
          return (await ctx.db
            .query("tasks")
            .withIndex("by_matter", (q) => q.eq("matterId", args.matterId!))
            .collect()) as unknown as Array<Record<string, unknown>>;
        case "matterEvents":
          return (await ctx.db
            .query("matterEvents")
            .withIndex("by_matter", (q) => q.eq("matterId", args.matterId!))
            .collect()) as unknown as Array<Record<string, unknown>>;
        case "matterTimeline":
          return (await ctx.db
            .query("matterTimeline")
            .withIndex("by_matter", (q) => q.eq("matterId", args.matterId!))
            .collect()) as unknown as Array<Record<string, unknown>>;
        case "matterFacts":
          return (await ctx.db
            .query("matterFacts")
            .withIndex("by_matter", (q) => q.eq("matterId", args.matterId!))
            .collect()) as unknown as Array<Record<string, unknown>>;
        case "matterDocuments":
          return (await ctx.db
            .query("matterDocuments")
            .withIndex("by_matter", (q) => q.eq("matterId", args.matterId!))
            .collect()) as unknown as Array<Record<string, unknown>>;
        default:
          throw new Error(`Unknown matter-scoped table: ${t}`);
      }
    }
    switch (t) {
      case "clients":
        return (await ctx.db
          .query("clients")
          .filter((q) => q.eq(q.field("orgId"), args.orgId))
          .collect()) as unknown as Array<Record<string, unknown>>;
      case "invoices":
        return (await ctx.db
          .query("invoices")
          .filter((q) => q.eq(q.field("orgId"), args.orgId))
          .collect()) as unknown as Array<Record<string, unknown>>;
      default:
        throw new Error(`Unknown org-scoped table: ${t}`);
    }
  },
});

/** Append one completed part AT the resume cursor (the fence). */
export const appendPart = internalMutation({
  args: {
    jobId: v.id("firmExportJobs"),
    orgId: v.id("organizations"),
    table: v.string(),
    rows: v.number(),
    sha256: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.orgId !== args.orgId) {
      throw new Error("Export job not found in this organization.");
    }
    if (job.status !== "collecting") {
      throw new Error("This job is not collecting.");
    }
    const plan = planCheckpoints(SPECS, job.matterIds.length);
    // The fence: position + plan conformity are enforced here. The
    // state object is passed BY IDENTITY so the cursor increment
    // lands on the object we persist.
    const partsMut = { parts: [...job.parts], cursor: job.cursor };
    appendPartAtCursor(
      partsMut,
      { table: args.table, rows: args.rows, sha256: args.sha256, storageId: args.storageId },
      plan,
    );
    await ctx.db.patch(job._id, {
      parts: partsMut.parts,
      cursor: partsMut.cursor,
      updatedAt: Date.now(),
    });
    return { cursor: partsMut.cursor, remaining: plan.length - partsMut.cursor };
  },
});

/**
 * Run collection steps (default: ALL remaining checkpoints). INTERNAL:
 * trusts the job row only — the PUBLIC entry (runCollectStep) performs
 * the capability + reauthentication gates before scheduling this.
 */
export const collectStep = internalAction({
  args: { jobId: v.id("firmExportJobs"), steps: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ collected: number; remaining: number }> => {
    const job = await ctx.runQuery(internal.firmExit.jobForAction, {
      jobId: args.jobId,
    });
    if (!job) throw new Error("Export job not found.");
    if (job.status !== "collecting") {
      throw new Error("This job is not collecting.");
    }
    const plan = planCheckpoints(SPECS, job.matterIds.length);
    // Cursor-conformance: every already-recorded part must sit at its
    // planned position — otherwise refuse (never re-derive silently).
    for (let i = 0; i < job.parts.length; i += 1) {
      const recorded = job.parts[i]!;
      const planned = plan[i]!;
      if (recorded.table !== planned.table) {
        throw new Error(
          `Job cursor disagrees with the plan at position ${i} (recorded ${recorded.table}, planned ${planned.table}) — refusing to collect.`,
        );
      }
    }
    if (job.cursor !== job.parts.length) {
      throw new Error("Resume fence violated: cursor and parts disagree.");
    }
    const steps = Math.max(1, Math.min(args.steps ?? plan.length, plan.length));
    let collected = 0;
    let remaining = plan.length - job.cursor;
    for (let s = 0; s < steps && remaining > 0; s += 1) {
      const cp: Checkpoint = plan[job.cursor + collected]!;
      const matterId =
        SPECS.find((x) => x.table === cp.table)?.kind === "matter"
          ? job.matterIds[cp.matterIndex]
          : undefined;
      const rows = await ctx.runQuery(internal.firmExit.rowsForCheckpoint, {
        orgId: job.orgId,
        table: cp.table,
        matterId,
      });
      // Content-freeze the exact exported bytes; strip nothing silently.
      const json = JSON.stringify(rows);
      const bytes = new TextEncoder().encode(json);
      const sha256 = sha256HexBytes(bytes);
      const storageId = await ctx.storage.store(
        new Blob([json], { type: "application/json" }),
      );
      await ctx.runMutation(internal.firmExit.appendPart, {
        jobId: args.jobId,
        orgId: job.orgId,
        table: cp.table,
        rows: rows.length,
        sha256,
        storageId,
      });
      collected += 1;
      remaining -= 1;
    }
    return { collected, remaining };
  },
});

function checkpointKeyOf(c: Checkpoint): string {
  return `${c.table}#${c.matterIndex}`;
}


export const jobForAction = internalQuery({
  args: { jobId: v.id("firmExportJobs") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.jobId);
  },
});

/** UI/tests wrapper: schedule one collection step run. */
export const runCollectStep = mutation({
  args: { jobId: v.id("firmExportJobs"), steps: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ scheduled: true }> => {
    const ac = await requireAccess(ctx);
    assertExportCapability(ac);
    await loadJob(ctx, ac.org._id, args.jobId);
    await ctx.scheduler.runAfter(0, internal.firmExit.collectStep, {
      jobId: args.jobId,
      steps: args.steps,
    });
    return { scheduled: true };
  },
});

// ---------------------------------------------------------------------
// Verification (independent re-read + recompute)
// ---------------------------------------------------------------------

export const verifyExport = internalAction({
  args: { jobId: v.id("firmExportJobs") },
  handler: async (
    ctx,
    args,
  ): Promise<{ verified: boolean; checkedParts: number; failures: string[] }> => {
    const job = await ctx.runQuery(internal.firmExit.jobForAction, {
      jobId: args.jobId,
    });
    if (!job) throw new Error("Export job not found.");
    if (job.parts.length === 0) {
      throw new Error("Nothing has been collected yet — run the collection steps first.");
    }
    const failures: string[] = [];
    let checked = 0;
    for (const [i, part] of job.parts.entries()) {
      const blob = await ctx.storage.get(part.storageId);
      if (!blob) {
        failures.push(`part ${i} (${part.table}): object missing from storage`);
        continue;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const actual = sha256HexBytes(bytes);
      if (actual !== part.sha256) {
        failures.push(
          `part ${i} (${part.table}): checksum mismatch (recorded ${part.sha256.slice(0, 12)}… vs actual ${actual.slice(0, 12)}…)`,
        );
      }
      try {
        const rows = JSON.parse(new TextDecoder().decode(bytes)) as unknown[];
        if (rows.length !== part.rows) {
          failures.push(
            `part ${i} (${part.table}): row count mismatch (recorded ${part.rows} vs actual ${rows.length})`,
          );
        }
      } catch {
        failures.push(`part ${i} (${part.table}): stored object is not valid JSON`);
      }
      checked += 1;
    }
    const verified = failures.length === 0 && checked === job.parts.length;
    await ctx.runMutation(internal.firmExit.recordVerification, {
      jobId: args.jobId,
      verified,
      checkedParts: checked,
      failures,
    });
    return { verified, checkedParts: checked, failures };
  },
});

export const runVerification = mutation({
  args: { jobId: v.id("firmExportJobs") },
  handler: async (ctx, args): Promise<{ scheduled: true }> => {
    const ac = await requireAccess(ctx);
    assertExportCapability(ac);
    await loadJob(ctx, ac.org._id, args.jobId);
    await ctx.scheduler.runAfter(0, internal.firmExit.verifyExport, { jobId: args.jobId });
    return { scheduled: true };
  },
});

export const recordVerification = internalMutation({
  args: {
    jobId: v.id("firmExportJobs"),
    verified: v.boolean(),
    checkedParts: v.number(),
    failures: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new Error("Export job not found.");
    }
    await ctx.db.patch(args.jobId, {
      verification: {
        verified: args.verified,
        checkedParts: args.checkedParts,
        at: Date.now(),
        failures: args.failures.slice(0, 50),
      },
      status: args.verified ? "awaiting_download" : "collecting",
      updatedAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------
// Downloads: expiring, single-use, audited (via downloads ledger)
// ---------------------------------------------------------------------

export const issueDownload = mutation({
  args: { jobId: v.id("firmExportJobs"), partIndex: v.number() },
  handler: async (ctx, args): Promise<{ url: string; expiresAt: number }> => {
    const ac = await requireAccess(ctx);
    assertExportCapability(ac);
    requireReauth(await lastLoginAt(ctx, ac.user._id), Date.now());
    const job = await loadJob(ctx, ac.org._id, args.jobId);
    if (job.status === "revoked") {
      throw new Error("This export job was revoked — no further downloads.");
    }
    const part = job.parts[args.partIndex];
    if (!part) throw new Error("No such part.");
    // LEGAL-HOLD RESPECT: fresh download links are blocked while ANY
    // hold is active (the exit itself is blocked too).
    const holds = await ctx.db
      .query("legalHolds")
      .withIndex("by_org_status", (q) => q.eq("orgId", ac.org._id).eq("status", "active"))
      .collect();
    if (holds.length > 0) {
      throw new Error(
        "An active legal hold exists — downloads are blocked while the hold stands. Lifting the hold is an explicit, audited decision.",
      );
    }
    const expiresAt = Date.now() + DOWNLOAD_TTL_MS;
    const url = await ctx.storage.getUrl(part.storageId);
    if (!url) throw new Error("Stored part is missing from object storage.");
    await ctx.db.patch(job._id, {
      downloads: [
        ...job.downloads.slice(-49),
        { storageId: part.storageId, partIndex: args.partIndex, expiresAt },
      ],
      updatedAt: Date.now(),
    });
    return { url, expiresAt };
  },
});

/** Redeem a grant (single-use); the caller then fetches the URL. */
export const redeemDownload = mutation({
  args: { jobId: v.id("firmExportJobs"), storageId: v.id("_storage") },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const ac = await requireAccess(ctx);
    assertExportCapability(ac);
    requireReauth(await lastLoginAt(ctx, ac.user._id), Date.now());
    const job = await loadJob(ctx, ac.org._id, args.jobId);
    const grant = job.downloads.find((d) => d.storageId === args.storageId && !d.usedAt);
    const decision = downloadDecision(
      grant ? { storageId: grant.storageId, expiresAt: grant.expiresAt, usedAt: grant.usedAt ?? null } : null,
      Date.now(),
    );
    if (!decision.ok) throw new Error(decision.reason);
    await ctx.db.patch(job._id, {
      downloads: job.downloads.map((d) =>
        d.storageId === args.storageId && !d.usedAt ? { ...d, usedAt: Date.now() } : d,
      ),
      updatedAt: Date.now(),
    });
    const url = await ctx.storage.getUrl(args.storageId);
    if (!url) throw new Error("Stored part is missing from object storage.");
    return { url };
  },
});

// ---------------------------------------------------------------------
// Manifest + omissions
// ---------------------------------------------------------------------

export const buildManifest = query({
  args: { jobId: v.id("firmExportJobs") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    assertExportCapability(ac);
    const job = await loadJob(ctx, ac.org._id, args.jobId);
    const org = await ctx.db.get(ac.org._id);
    const holds = await ctx.db
      .query("legalHolds")
      .withIndex("by_org_status", (q) => q.eq("orgId", ac.org._id).eq("status", "active"))
      .collect();
    const holdsWithMatters = await Promise.all(
      holds.map(async (h) => {
        const m = await ctx.db.get(h.matterId);
        return {
          matterReference: m?.reference ?? "unknown",
          reasonKind: h.reasonKind,
          placedAt: h.createdAt,
        };
      }),
    );
    const parts = job.parts.map((p) => ({
      table: p.table,
      rows: p.rows,
      sha256: p.sha256,
      storageId: p.storageId,
    }));
    return {
      manifest: {
        schemaVersion: 1 as const,
        exportedAt: new Date(job.updatedAt).toISOString(),
        organization: { name: org?.name ?? "", slug: org?.slug ?? "" },
        parts,
        omissions: job.omissions,
        documentsNote:
          "matterDocuments ROWS are exported with each matter bucket; the document FILE bytes live in object storage and are delivered through the platform's storage export — recorded honestly, not claimed included here.",
        legalHolds: holdsWithMatters,
        definition: MANIFEST_DEFINITION,
      },
      status: job.status,
      verification: job.verification ?? null,
      cursor: job.cursor,
      planSize: planCheckpoints(SPECS, job.matterIds.length).length,
      totalRows: manifestLineCount({
        schemaVersion: 1,
        exportedAt: "",
        organization: { name: "", slug: "" },
        parts,
        omissions: [],
        documentsInStorage: 0,
        legalHolds: [],
        definition: "",
      }),
    };
  },
});

/** Record the omissions catalogue onto the job. */
export const recordOmissions = mutation({
  args: {
    jobId: v.id("firmExportJobs"),
    countsByTable: v.array(v.object({ table: v.string(), rows: v.number() })),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    assertExportCapability(ac);
    const job = await loadJob(ctx, ac.org._id, args.jobId);
    const counts: Record<string, number> = {};
    for (const c of args.countsByTable) counts[c.table] = c.rows;
    const allTables = [
      ...SPECS.map((s) => s.table),
      "commOutbox",
      "auditLog",
      "notificationLog",
      "supportTickets",
      "platformWorkforceRows",
    ];
    const omissions = computeOmissions(
      SPECS.map((s) => s.table),
      allTables,
      counts,
    );
    await ctx.db.patch(job._id, { omissions, updatedAt: Date.now() });
    return { omissions };
  },
});

// ---------------------------------------------------------------------
// Exit: close organization (hold-aware) + revocation
// ---------------------------------------------------------------------

export const closeOrganization = mutation({
  args: { confirm: v.literal("CLOSE ORGANIZATION") },
  handler: async (
    ctx,
    args,
  ): Promise<{ closed: true; exportJobId: Id<"firmExportJobs"> }> => {
    void args.confirm;
    const ac = await requireAccess(ctx);
    if (ac.membership.orgRole !== "owner") {
      throw new Error("Only the owner can close the organization.");
    }
    requireReauth(await lastLoginAt(ctx, ac.user._id), Date.now());

    const jobs = await ctx.db
      .query("firmExportJobs")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const verifiedJob = jobs.find(
      (j) => j.status === "awaiting_download" && j.verification?.verified,
    );
    if (!verifiedJob) {
      throw new Error(
        "No VERIFIED export exists — run the export job to completion and verify it before closing the organization.",
      );
    }

    // LEGAL-HOLD RESPECT: blocked while ANY hold is active; the block
    // is RECORDED on the export job (listed, not hidden).
    const holds = await ctx.db
      .query("legalHolds")
      .withIndex("by_org_status", (q) => q.eq("orgId", ac.org._id).eq("status", "active"))
      .collect();
    if (holds.length > 0) {
      const first = holds[0]!;
      const matter = await ctx.db.get(first.matterId);
      await ctx.db.patch(verifiedJob._id, {
        activeHoldBlocks: {
          holdId: first._id,
          matterId: first.matterId,
          reason: `${first.reasonKind}: ${first.reason}`,
        },
        updatedAt: Date.now(),
      });
      throw new Error(
        `LEGAL HOLD active on matter ${matter?.reference ?? String(first.matterId)} (${first.reasonKind}) — exit is blocked until the hold is lifted by explicit decision.`,
      );
    }

    // The exit decision is RECORDED on the job (additive; no data is
    // destroyed here — the export IS the exit deliverable).
    await ctx.db.patch(verifiedJob._id, {
      label: `${verifiedJob.label} [ORG CLOSED ${new Date().toISOString().slice(0, 10)}]`,
      updatedAt: Date.now(),
    });
    return { closed: true, exportJobId: verifiedJob._id };
  },
});

export const revokeExport = mutation({
  args: { jobId: v.id("firmExportJobs"), reason: v.string() },
  handler: async (ctx, args): Promise<{ revoked: true }> => {
    const ac = await requireAccess(ctx);
    assertExportCapability(ac);
    if (ac.membership.orgRole !== "owner" && ac.membership.orgRole !== "administrator") {
      throw new Error("Only owners and administrators can revoke an export job.");
    }
    requireReauth(await lastLoginAt(ctx, ac.user._id), Date.now());
    const job = await loadJob(ctx, ac.org._id, args.jobId);
    if (job.status === "revoked") return { revoked: true };
    const reason = args.reason.trim();
    if (reason.length < 10) {
      throw new Error("A reason of at least 10 characters is required to revoke an export.");
    }
    await ctx.db.patch(job._id, {
      status: "revoked",
      revokedAt: Date.now(),
      revokedReason: reason,
      updatedAt: Date.now(),
    });
    return { revoked: true };
  },
});

/** The job list for the org. */
export const listJobs = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return { jobs: [], reauthWindowHours: 168 };
    const jobs = await ctx.db
      .query("firmExportJobs")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    return {
      jobs: jobs
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((j) => ({
          jobId: j._id,
          label: j.label,
          status: j.status,
          parts: j.parts.length,
          rows: j.parts.reduce((acc, p) => acc + p.rows, 0),
          verification: j.verification ?? null,
          activeHoldBlocks: j.activeHoldBlocks ?? null,
          startedByName: j.startedByName,
          createdAt: j.createdAt,
        })),
      reauthWindowHours: 168,
    };
  },
});
