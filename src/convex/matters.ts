import { v } from "convex/values";
import { mutation, query, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { openingGate } from "./conflicts";
import type { Doc, Id } from "./_generated/dataModel";
import {
  canViewDocument,
  canViewMatter,
  can,
  getAccessContext,
  isUserWalledFromMatter,
  matterOrNull,
  requireAccess,
  requireCapability,
  requireMatter,
  type AccessContext,
} from "./access";
import {
  MATTER_STATUSES,
  matterStatusValidator,
  taskStatusValidator,
  TASK_KINDS,
  TASK_PRIORITIES,
  type OrgRole,
} from "./schema";
import {
  detectClashes,
  rescheduleRejection,
  buildRescheduleAudit,
  carryReminderDays,
  istDay,
  istDayBounds,
  type ClashCandidate,
} from "../lib/hearingSchedule";

// Limits
const MAX_TEXT = 4000;
const MAX_NAME = 200;

async function logEvent(
  ctx: MutationCtx,
  matterId: Id<"matters">,
  kind: string,
  detail: string,
  opts?: {
    authorId?: Id<"users">;
    occurredAt?: number;
    datePrecision?: "exact" | "day" | "approx";
    sourceRef?: string;
    linkKind?: "document" | "hearing" | "order" | "message";
    linkId?: string;
    visibility?: "internal" | "shared_with_client";
    aiSuggested?: boolean;
  },
) {
  await ctx.db.insert("matterEvents", {
    matterId,
    kind,
    detail,
    createdAt: Date.now(),
    authorId: opts?.authorId,
    occurredAt: opts?.occurredAt ?? Date.now(),
    datePrecision: opts?.datePrecision ?? "exact",
    sourceRef: opts?.sourceRef,
    linkKind: opts?.linkKind,
    linkId: opts?.linkId,
    visibility: opts?.visibility,
    aiSuggested: opts?.aiSuggested,
  });
}

/** Audit-trail entry: who did what. Called on important changes. */
async function audit(
  ctx: MutationCtx,
  ac: AccessContext,
  matterId: Id<"matters">,
  action: string,
  detail?: string,
) {
  await ctx.db.insert("auditLog", {
    orgId: ac.org._id,
    matterId,
    actorId: ac.user._id,
    actorName: ac.user.name ?? ac.user.email ?? "Member",
    action,
    detail,
    createdAt: Date.now(),
  });
}

/** Org-scoped matter reference like ADV/2026/0007 for a new matter. */
export async function nextMatterReference(ctx: MutationCtx, orgId: Id<"organizations">, prefix: string) {
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
    // Ethical walls (§32 Phase 7): matters behind a wall covering this
    // member do not appear in the list at all — the wall is not
    // advertised to the people it restricts.
    const policyVisible = matters.filter((m) => canViewMatter(ac, m));
    const visible = (
      await Promise.all(
        policyVisible.map(async (m) =>
          (await isUserWalledFromMatter(ctx, ac, m)) ? null : m,
        ),
      )
    )
      .filter((m): m is NonNullable<typeof m> => m !== null)
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
    conflictCheckId: v.optional(v.id("conflictChecks")),
    practiceArea: v.string(),
    reference: v.optional(v.string()),
    court: v.optional(v.string()),
    jurisdiction: v.optional(v.string()),
    caseNumber: v.optional(v.string()),
    bench: v.optional(v.string()),
    caseType: v.optional(v.string()),
    caseYear: v.optional(v.string()),
    courtroom: v.optional(v.string()),
    cnrNumber: v.optional(v.string()),
    filingNumber: v.optional(v.string()),
    registrationNumber: v.optional(v.string()),
    clientRole: v.optional(v.string()),
    otherParties: v.optional(v.string()),
    billingType: v.optional(
      v.union(
        v.literal("hourly"),
        v.literal("fixed"),
        v.literal("retainer"),
        v.literal("non_billable"),
      ),
    ),
    billingRate: v.optional(v.string()),
    supportingLawyerIds: v.optional(v.array(v.id("users"))),
    juniorStaffIds: v.optional(v.array(v.id("users"))),
    opposingParty: v.optional(v.string()),
    opposingCounsel: v.optional(v.string()),
    description: v.optional(v.string()),
    teamIds: v.optional(v.array(v.id("users"))),
    leadLawyerId: v.optional(v.id("users")),
    priority: v.optional(
      v.union(v.literal("normal"), v.literal("high"), v.literal("urgent")),
    ),
    billingArrangement: v.optional(v.string()),
    keyDates: v.optional(
      v.array(v.object({ label: v.string(), date: v.string() })),
    ),
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

    // Conflict-of-interest gate: a cleared (or elevated-override)
    // conflict check for this proposed client is required first.
    const gate = await openingGate(ctx, ac, title, client.name, args.conflictCheckId);
    if (!gate.ok) throw new Error(gate.reason);
    void gate;

    // team restriction requires the elevated capability
    let teamIds = args.teamIds;
    if (teamIds && teamIds.length > 0 && !mayRestrictTeam(ac.membership.orgRole)) {
      teamIds = undefined; // silently drop rather than fail the filing
    }

    const reference =
      args.reference?.trim() ||
      (await nextMatterReference(ctx, ac.org._id, ac.org.invoicePrefix));
    const now = Date.now();

    // Compose the billing summary from the structured selection, unless
    // the caller supplied free text directly.
    const BILLING_LABEL: Record<string, string> = {
      hourly: "Hourly",
      fixed: "Fixed fee",
      retainer: "Retainer",
      non_billable: "Non-billable",
    };
    const billingArrangement =
      args.billingArrangement?.trim() ||
      [args.billingType ? BILLING_LABEL[args.billingType] : null, args.billingRate?.trim()]
        .filter(Boolean)
        .join(" — ") ||
      undefined;

    const matterId = await ctx.db.insert("matters", {
      orgId: ac.org._id,
      title,
      reference,
      clientId: args.clientId,
      conflictCheckId: gate.conflictId,
      practiceArea: args.practiceArea.trim(),
      court: args.court?.trim() || undefined,
      jurisdiction: args.jurisdiction?.trim() || undefined,
      caseNumber: args.caseNumber?.trim() || undefined,
      bench: args.bench?.trim() || undefined,
      caseType: args.caseType?.trim() || undefined,
      caseYear: args.caseYear?.trim() || undefined,
      courtroom: args.courtroom?.trim() || undefined,
      cnrNumber: args.cnrNumber?.trim().toUpperCase() || undefined,
      filingNumber: args.filingNumber?.trim() || undefined,
      registrationNumber: args.registrationNumber?.trim() || undefined,
      clientRole: args.clientRole?.trim() || undefined,
      otherParties: args.otherParties?.trim().slice(0, MAX_TEXT) || undefined,
      billingType: args.billingType || undefined,
      billingRate: args.billingRate?.trim() || undefined,
      billingArrangement,
      opposingParty: args.opposingParty?.trim() || undefined,
      opposingCounsel: args.opposingCounsel?.trim() || undefined,
      description: args.description?.trim() || undefined,
      status: MATTER_STATUSES.OPEN,
      teamIds,
      leadLawyerId: args.leadLawyerId || undefined,
      priority: args.priority ?? undefined,
      keyDates: args.keyDates?.length ? args.keyDates : undefined,
      createdBy: ac.user._id,
      createdAt: now,
      updatedAt: now,
    });

    // Seed the parties register from the form: client (with role),
    // opposing party and any "other parties" line.
    const partyRows: {
      name: string;
      side: "ours" | "opposing" | "neutral";
      role?: string;
      counsel?: string;
    }[] = [
      {
        name: client.name,
        side: "ours" as const,
        role: args.clientRole?.trim() || "Client",
      },
    ];
    if (args.opposingParty?.trim()) {
      partyRows.push({
        name: args.opposingParty.trim(),
        side: "opposing",
        counsel: args.opposingCounsel?.trim() || undefined,
      });
    }
    for (const raw of (args.otherParties ?? "").split(/[,;\n]/)) {
      const name = raw.trim();
      if (name) partyRows.push({ name, side: "neutral" });
    }
    for (const p of partyRows) {
      await ctx.db.insert("matterParties", {
        orgId: ac.org._id,
        matterId,
        name: p.name,
        side: p.side,
        role: p.role,
        counsel: p.counsel,
        createdBy: ac.user._id,
        createdAt: now,
      });
    }

    await logEvent(ctx, matterId, "created", `Matter opened — ${reference}.`);
    await audit(ctx, ac, matterId, "Matter opened", `${reference} — ${title}.`);
    return matterId;
  },
});

/**
 * Register rows for the matters desk: one flat row per matter with the
 * client name, lead-lawyer name and court joined. Org-scoped and
 * canViewMatter-filtered, like matters.list.
 */
export const registerRows = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const matters = await ctx.db
      .query("matters")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    // Ethical walls (§32 Phase 7): matters behind a wall covering this
    // member do not appear in the list at all — the wall is not
    // advertised to the people it restricts.
    const policyVisible = matters.filter((m) => canViewMatter(ac, m));
    const visible = (
      await Promise.all(
        policyVisible.map(async (m) =>
          (await isUserWalledFromMatter(ctx, ac, m)) ? null : m,
        ),
      )
    )
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return Promise.all(
      visible.map(async (m) => {
        const client = await ctx.db.get(m.clientId);
        const lead = m.leadLawyerId
          ? ((await ctx.db.get(m.leadLawyerId)) as Doc<"users"> | null)
          : null;
        return {
          _id: m._id,
          reference: m.reference,
          title: m.title,
          status: m.status,
          practiceArea: m.practiceArea,
          priority: m.priority,
          court: m.court ?? null,
          caseNumber: m.caseNumber ?? null,
          nextHearingAt: m.nextHearingAt ?? null,
          leadLawyerName: lead?.name ?? lead?.email ?? null,
          clientName: client?.name ?? null,
          clientId: m.clientId,
          archivedAt: m.archivedAt ?? null,
        };
      }),
    );
  },
});

/** Edit the matter record (court details, parties, priority, billing). */
export const update = mutation({
  args: {
    matterId: v.id("matters"),
    title: v.optional(v.string()),
    practiceArea: v.optional(v.string()),
    court: v.optional(v.string()),
    jurisdiction: v.optional(v.string()),
    caseNumber: v.optional(v.string()),
    bench: v.optional(v.string()),
    caseType: v.optional(v.string()),
    caseYear: v.optional(v.string()),
    courtroom: v.optional(v.string()),
    cnrNumber: v.optional(v.string()),
    filingNumber: v.optional(v.string()),
    registrationNumber: v.optional(v.string()),
    clientRole: v.optional(v.string()),
    otherParties: v.optional(v.string()),
    billingType: v.optional(
      v.union(
        v.literal("hourly"),
        v.literal("fixed"),
        v.literal("retainer"),
        v.literal("non_billable"),
      ),
    ),
    billingRate: v.optional(v.string()),
    opposingParty: v.optional(v.string()),
    opposingCounsel: v.optional(v.string()),
    description: v.optional(v.string()),
    priority: v.optional(
      v.union(v.literal("normal"), v.literal("high"), v.literal("urgent")),
    ),
    billingArrangement: v.optional(v.string()),
    keyDates: v.optional(
      v.array(v.object({ label: v.string(), date: v.string() })),
    ),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.edit");
    const matter = await requireMatter(ctx, ac, args.matterId);

    const { matterId, ...patch } = args;
    const changes: string[] = [];
    if (patch.title !== undefined && patch.title.trim() !== matter.title)
      changes.push("title");
    if (patch.court !== undefined && patch.court.trim() !== (matter.court ?? ""))
      changes.push("court");
    if (
      patch.caseNumber !== undefined &&
      patch.caseNumber.trim() !== (matter.caseNumber ?? "")
    )
      changes.push("case number");
    if (patch.cnrNumber !== undefined) changes.push("CNR number");
    if (
      patch.filingNumber !== undefined &&
      patch.filingNumber.trim() !== (matter.filingNumber ?? "")
    )
      changes.push("filing number");
    if (
      patch.registrationNumber !== undefined &&
      patch.registrationNumber.trim() !== (matter.registrationNumber ?? "")
    )
      changes.push("registration number");
    if (patch.caseType !== undefined) changes.push("case type");
    if (patch.courtroom !== undefined) changes.push("courtroom");
    if (patch.clientRole !== undefined) changes.push("client role");
    if (patch.otherParties !== undefined) changes.push("other parties");
    if (
      patch.billingType !== undefined &&
      patch.billingType !== (matter.billingType ?? null)
    )
      changes.push("billing type");
    if (
      patch.billingRate !== undefined &&
      patch.billingRate.trim() !== (matter.billingRate ?? "")
    )
      changes.push("billing rate");
    if (patch.priority !== undefined && patch.priority !== (matter.priority ?? "normal"))
      changes.push("priority");
    if (
      patch.billingArrangement !== undefined &&
      patch.billingArrangement.trim() !== (matter.billingArrangement ?? "")
    )
      changes.push("billing arrangement");
    if (patch.keyDates !== undefined)
      changes.push("key dates");

    const clean = Object.fromEntries(
      Object.entries(patch).map(([k, val]) => [
        k,
        typeof val === "string" && !(k === "keyDates")
          ? (val as string).trim() || undefined
          : val,
      ]),
    );
    if (clean.keyDates !== undefined) {
      const kd = clean.keyDates as { label: string; date: string }[] | undefined;
      clean.keyDates = kd && kd.length > 0 ? kd : undefined;
    }

    await ctx.db.patch(matterId, { ...clean, updatedAt: Date.now() });
    if (changes.length > 0) {
      await logEvent(
        ctx,
        matterId,
        "status",
        `Matter details updated — ${changes.join(", ")} changed.`,
      );
      await audit(ctx, ac, matterId, "Matter edited", `${changes.join(", ")} changed.`);
    }
  },
});

/** Close a matter (matter.close capability). */
export const closeMatter = mutation({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.close");
    await requireMatter(ctx, ac, args.matterId);
    await ctx.db.patch(args.matterId, {
      status: MATTER_STATUSES.CLOSED,
      updatedAt: Date.now(),
    });
    await logEvent(ctx, args.matterId, "status", "Matter closed.");
    await audit(ctx, ac, args.matterId, "Matter closed", undefined);
  },
});

/** Reopen a closed matter. */
export const reopenMatter = mutation({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.edit");
    await requireMatter(ctx, ac, args.matterId);
    await ctx.db.patch(args.matterId, {
      status: MATTER_STATUSES.IN_PROGRESS,
      updatedAt: Date.now(),
    });
    await logEvent(ctx, args.matterId, "status", "Matter reopened.");
    await audit(ctx, ac, args.matterId, "Matter reopened", undefined);
  },
});

/** Archive (soft) a closed matter; restore it. */
export const setArchived = mutation({
  args: { matterId: v.id("matters"), archived: v.boolean() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.edit");
    const matter = await requireMatter(ctx, ac, args.matterId);
    if (args.archived && matter.status !== "closed") {
      throw new Error("Only closed matters can be archived.");
    }
    await ctx.db.patch(args.matterId, {
      archivedAt: args.archived ? Date.now() : undefined,
      archivedBy: args.archived ? ac.user._id : undefined,
      updatedAt: Date.now(),
    });
    await logEvent(
      ctx,
      args.matterId,
      "status",
      args.archived ? "Matter archived." : "Matter restored from archive.",
    );
    await audit(
      ctx,
      ac,
      args.matterId,
      args.archived ? "Matter archived" : "Matter restored",
      undefined,
    );
  },
});

/** Set the lead lawyer (matter.edit; recorded in timeline + audit). */
export const setLead = mutation({
  args: { matterId: v.id("matters"), lawyerId: v.optional(v.id("users")) },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.edit");
    await requireMatter(ctx, ac, args.matterId);
    const lawyer = args.lawyerId
      ? await ctx.db.get(args.lawyerId)
      : null;
    await ctx.db.patch(args.matterId, {
      leadLawyerId: args.lawyerId || undefined,
      updatedAt: Date.now(),
    });
    const label = lawyer?.name ?? lawyer?.email ?? "unassigned";
    await logEvent(ctx, args.matterId, "status", `Lead lawyer set — ${label}.`);
    await audit(ctx, ac, args.matterId, "Lead lawyer changed", label);
  },
});

// ---------------- Parties & issues ----------------

export const listParties = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    await requireMatter(ctx, ac, args.matterId);
    return ctx.db
      .query("matterParties")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
  },
});

export const addParty = mutation({
  args: {
    matterId: v.id("matters"),
    name: v.string(),
    side: v.union(
      v.literal("ours"),
      v.literal("opposing"),
      v.literal("neutral"),
    ),
    role: v.optional(v.string()),
    counsel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.edit");
    await requireMatter(ctx, ac, args.matterId);
    const name = args.name.trim();
    if (!name) throw new Error("Party name is required.");
    await ctx.db.insert("matterParties", {
      orgId: ac.org._id,
      matterId: args.matterId,
      name,
      side: args.side,
      role: args.role?.trim() || undefined,
      counsel: args.counsel?.trim() || undefined,
      createdBy: ac.user._id,
      createdAt: Date.now(),
    });
    await logEvent(
      ctx,
      args.matterId,
      "party",
      `Party added — ${name} (${args.side}).`,
    );
    await audit(ctx, ac, args.matterId, "Party added", name);
  },
});

export const removeParty = mutation({
  args: { partyId: v.id("matterParties") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.edit");
    const party = await ctx.db.get(args.partyId);
    if (!party) throw new Error("Party not found.");
    await requireMatter(ctx, ac, party.matterId);
    await ctx.db.delete(args.partyId);
    await logEvent(ctx, party.matterId, "party", `Party removed — ${party.name}.`);
    await audit(ctx, ac, party.matterId, "Party removed", party.name);
  },
});

export const listIssues = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    await requireMatter(ctx, ac, args.matterId);
    return ctx.db
      .query("matterIssues")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
  },
});

export const addIssue = mutation({
  args: {
    matterId: v.id("matters"),
    title: v.string(),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    await requireMatter(ctx, ac, args.matterId);
    const title = args.title.trim();
    if (!title) throw new Error("Issue title is required.");
    await ctx.db.insert("matterIssues", {
      orgId: ac.org._id,
      matterId: args.matterId,
      title,
      detail: args.detail?.trim() || undefined,
      status: "open",
      createdBy: ac.user._id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await logEvent(ctx, args.matterId, "issue", `Issue framed — ${title}.`);
    await audit(ctx, ac, args.matterId, "Issue framed", title);
  },
});

export const setIssueStatus = mutation({
  args: {
    issueId: v.id("matterIssues"),
    status: v.union(
      v.literal("open"),
      v.literal("argued"),
      v.literal("resolved"),
    ),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const issue = await ctx.db.get(args.issueId);
    if (!issue) throw new Error("Issue not found.");
    await requireMatter(ctx, ac, issue.matterId);
    await ctx.db.patch(args.issueId, {
      status: args.status,
      updatedAt: Date.now(),
    });
    await logEvent(
      ctx,
      issue.matterId,
      "issue",
      `Issue “${issue.title}” marked ${args.status}.`,
    );
  },
});

export const attachEvidence = mutation({
  args: {
    issueId: v.id("matterIssues"),
    label: v.string(),
    documentId: v.optional(v.id("matterDocuments")),
    supports: v.boolean(),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const issue = await ctx.db.get(args.issueId);
    if (!issue) throw new Error("Issue not found.");
    const matter = await requireMatter(ctx, ac, issue.matterId);
    if (args.documentId) {
      const doc = await ctx.db.get(args.documentId);
      if (!doc || doc.matterId !== matter._id) {
        throw new Error("That document is not on this matter.");
      }
    }
    const evidence = issue.evidence ?? [];
    if (evidence.length >= 20) {
      throw new Error("Up to 20 exhibits per issue.");
    }
    await ctx.db.patch(args.issueId, {
      evidence: [
        ...evidence,
        {
          label: args.label.trim().slice(0, 200),
          documentId: args.documentId,
          supports: args.supports,
        },
      ],
      updatedAt: Date.now(),
    });
    await logEvent(
      ctx,
      issue.matterId,
      "issue",
      `Exhibit linked to “${issue.title}” — ${args.label.trim()}.`,
    );
  },
});

/** Update matter status and log the docket entry. */
export const updateStatus = mutation({
  args: { matterId: v.id("matters"), status: matterStatusValidator },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.edit");
    await requireMatter(ctx, ac, args.matterId);

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

/** Maintain matters.nextHearingAt = earliest scheduled (non-cancelled) hearing. */
export async function refreshNextHearing(
  ctx: MutationCtx,
  matterId: Id<"matters">,
  now = Date.now(),
) {
  const hearings = await ctx.db
    .query("hearings")
    .withIndex("by_matter", (q) => q.eq("matterId", matterId))
    .collect();
  const next = hearings
    .filter((h) => h.status === "scheduled" && h.at > now - 2 * 60 * 60 * 1000)
    .sort((a, b) => a.at - b.at)[0];
  await ctx.db.patch(matterId, { nextHearingAt: next?.at ?? undefined });
}

/** A hearing is editable until its outcome is recorded. */
async function requireEditableHearing(
  ctx: MutationCtx,
  hearingId: Id<"hearings">,
) {
  const hearing = await ctx.db.get(hearingId);
  if (!hearing) throw new Error("Hearing not found.");
  if (hearing.status === "cancelled") {
    throw new Error("Cancelled hearings cannot be edited.");
  }
  if (hearing.outcomeRecordedAt) {
    throw new Error("Outcome already recorded — this hearing is final.");
  }
  return hearing;
}

export const addHearing = mutation({
  args: {
    matterId: v.id("matters"),
    title: v.string(),
    court: v.optional(v.string()),
    at: v.number(),
    appearance: v.optional(v.string()),
    notes: v.optional(v.string()),
    // Court-day detail.
    courtroom: v.optional(v.string()),
    judge: v.optional(v.string()),
    purpose: v.optional(v.string()),
    appearingAdvocateId: v.optional(v.id("users")),
    prepNotes: v.optional(v.string()),
    requiredDocuments: v.optional(v.array(v.string())),
    // Reminder lead times in days before the hearing (30/14/7/3/1;
    // 0 = morning of). Empty/absent = the firm default cadence.
    reminderDays: v.optional(v.array(v.number())),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "hearing.manage");
    const matter = await requireMatter(ctx, ac, args.matterId);

    // Duplicate-submission guard: identical matter + time + title within
    // five minutes is treated as a double-click, not a new hearing.
    const recent = await ctx.db
      .query("hearings")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    const fiveMin = 5 * 60 * 1000;
    if (
      recent.some(
        (h) =>
          Math.abs(h.at - args.at) < fiveMin &&
          h.title === args.title.trim() &&
          Date.now() - h.createdAt < fiveMin,
      )
    ) {
      throw new Error(
        "A hearing with the same title and time was just recorded.",
      );
    }
    if (args.at < Date.now() - 24 * 60 * 60 * 1000) {
      throw new Error("Pick a future date for the hearing.");
    }

    await ctx.db.insert("hearings", {
      matterId: args.matterId,
      title: args.title.trim(),
      court: args.court?.trim() || undefined,
      at: args.at,
      appearance: args.appearance?.trim() || undefined,
      notes: args.notes?.trim() || undefined,
      courtroom: args.courtroom?.trim() || undefined,
      judge: args.judge?.trim() || undefined,
      purpose: args.purpose?.trim() || undefined,
      appearingAdvocateId: args.appearingAdvocateId,
      prepNotes: args.prepNotes?.trim() || undefined,
      requiredDocuments: args.requiredDocuments?.length
        ? args.requiredDocuments
        : undefined,
      reminderDays: args.reminderDays?.length ? args.reminderDays : undefined,
      status: "scheduled",
      createdAt: Date.now(),
    });
    await refreshNextHearing(ctx, args.matterId);
    const when = new Date(args.at).toLocaleString("en-IN", {
      timeZone: ac.org.timezone,
      dateStyle: "medium",
      timeStyle: "short",
    });
    await logEvent(ctx, args.matterId, "hearing", `Hearing scheduled — ${when}.`);
    await audit(ctx, ac, args.matterId, "Hearing scheduled", when);
    void matter;
  },
});

export const editHearing = mutation({
  args: {
    hearingId: v.id("hearings"),
    title: v.optional(v.string()),
    court: v.optional(v.string()),
    at: v.optional(v.number()),
    courtroom: v.optional(v.string()),
    judge: v.optional(v.string()),
    purpose: v.optional(v.string()),
    appearingAdvocateId: v.optional(v.id("users")),
    prepNotes: v.optional(v.string()),
    requiredDocuments: v.optional(v.array(v.string())),
    reminderDays: v.optional(v.array(v.number())),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "hearing.manage");
    const hearing = await requireEditableHearing(ctx, args.hearingId);
    await requireMatter(ctx, ac, hearing.matterId);

    const patch: Record<string, unknown> = {};
    if (args.title !== undefined && args.title.trim())
      patch.title = args.title.trim();
    if (args.court !== undefined) patch.court = args.court.trim() || undefined;
    if (args.at !== undefined) {
      if (args.at < Date.now() - 24 * 60 * 60 * 1000)
        throw new Error("Pick a future date for the hearing.");
      patch.at = args.at;
    }
    if (args.courtroom !== undefined)
      patch.courtroom = args.courtroom.trim() || undefined;
    if (args.judge !== undefined) patch.judge = args.judge.trim() || undefined;
    if (args.purpose !== undefined)
      patch.purpose = args.purpose.trim() || undefined;
    if (args.appearingAdvocateId !== undefined)
      patch.appearingAdvocateId = args.appearingAdvocateId || undefined;
    if (args.prepNotes !== undefined)
      patch.prepNotes = args.prepNotes.trim() || undefined;
    if (args.requiredDocuments !== undefined)
      patch.requiredDocuments = args.requiredDocuments.length
        ? args.requiredDocuments
        : undefined;
    if (args.reminderDays !== undefined)
      patch.reminderDays = args.reminderDays.length ? args.reminderDays : undefined;

    await ctx.db.patch(args.hearingId, patch);
    if (patch.at !== undefined) {
      await refreshNextHearing(ctx, hearing.matterId);
    }
    await logEvent(
      ctx,
      hearing.matterId,
      "hearing",
      `Hearing details updated${patch.at !== undefined ? " (date/time changed)" : ""}.`,
    );
  },
});

export const cancelHearing = mutation({
  args: { hearingId: v.id("hearings") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "hearing.manage");
    const hearing = await requireEditableHearing(ctx, args.hearingId);
    await requireMatter(ctx, ac, hearing.matterId);
    await ctx.db.patch(args.hearingId, { status: "cancelled" });
    await refreshNextHearing(ctx, hearing.matterId);
    await logEvent(
      ctx,
      hearing.matterId,
      "hearing",
      `Hearing cancelled — ${hearing.title}.`,
    );
    await audit(ctx, ac, hearing.matterId, "Hearing cancelled", hearing.title);
  },
});

export const setHearingStatus = mutation({
  args: {
    hearingId: v.id("hearings"),
    status: v.union(
      v.literal("held"),
      v.literal("adjourned"),
      v.literal("scheduled"),
      v.literal("cancelled"),
    ),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "hearing.manage");
    const hearing = await requireEditableHearing(ctx, args.hearingId);
    await requireMatter(ctx, ac, hearing.matterId);
    await ctx.db.patch(args.hearingId, { status: args.status });
    if (args.status !== "scheduled") {
      await refreshNextHearing(ctx, hearing.matterId);
    }
    await logEvent(ctx, hearing.matterId, "hearing", `Hearing marked ${args.status}.`);
  },
});

/** Record the post-hearing outcome; optionally create the next hearing. */
export const recordHearingOutcome = mutation({
  args: {
    hearingId: v.id("hearings"),
    status: v.union(v.literal("held"), v.literal("adjourned")),
    outcome: v.string(),
    nextAction: v.optional(v.string()),
    nextHearing: v.optional(
      v.object({
        title: v.string(),
        at: v.number(),
        purpose: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "hearing.manage");
    const hearing = await requireEditableHearing(ctx, args.hearingId);
    const matter = await requireMatter(ctx, ac, hearing.matterId);
    if (!args.outcome.trim()) throw new Error("Record what happened.");

    await ctx.db.patch(args.hearingId, {
      status: args.status,
      outcome: args.outcome.trim().slice(0, MAX_TEXT),
      nextAction: args.nextAction?.trim() || undefined,
      outcomeRecordedBy: ac.user._id,
      outcomeRecordedAt: Date.now(),
    });
    await refreshNextHearing(ctx, hearing.matterId);
    await logEvent(
      ctx,
      hearing.matterId,
      "hearing",
      `Hearing ${args.status} — ${args.outcome.trim().slice(0, 160)}`,
    );
    await audit(
      ctx,
      ac,
      hearing.matterId,
      "Hearing outcome recorded",
      hearing.title,
    );

    // Optional next hearing, created atomically with the outcome.
    if (args.nextHearing) {
      const nh = args.nextHearing;
      if (!nh.title.trim() || !nh.at)
        throw new Error("Next hearing needs a title and date.");
      if (nh.at < Date.now()) throw new Error("Next hearing must be in the future.");
      await ctx.db.insert("hearings", {
        matterId: hearing.matterId,
        title: nh.title.trim(),
        court: hearing.court,
        at: nh.at,
        purpose: nh.purpose?.trim() || undefined,
        status: "scheduled",
        createdAt: Date.now(),
      });
      await refreshNextHearing(ctx, hearing.matterId);
      const when = new Date(nh.at).toLocaleString("en-IN", {
        timeZone: ac.org.timezone,
        dateStyle: "medium",
        timeStyle: "short",
      });
      await logEvent(
        ctx,
        hearing.matterId,
        "hearing",
        `Next hearing scheduled — ${when}.`,
      );
    }
    void matter;
  },
});

/** Maintain the authorities list on a hearing (court-day brief). */
export const setHearingAuthorities = mutation({
  args: {
    hearingId: v.id("hearings"),
    authorities: v.array(v.object({ label: v.string(), url: v.string() })),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "hearing.manage");
    const hearing = await ctx.db.get(args.hearingId);
    if (!hearing) throw new Error("Hearing not found.");
    await requireMatter(ctx, ac, hearing.matterId);
    const clean = args.authorities
      .map((a) => ({ label: a.label.trim().slice(0, 200), url: a.url.trim() }))
      .filter((a) => a.label && /^https?:\/\//i.test(a.url))
      .slice(0, 12);
    await ctx.db.patch(args.hearingId, { authorities: clean });
    await logEvent(
      ctx,
      hearing.matterId,
      "hearing",
      `Authorities list updated (${clean.length} link${clean.length === 1 ? "" : "s"}).`,
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
    hearingId: v.optional(v.id("hearings")),
    directions: v.optional(v.array(v.string())),
    followUp: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "order.record");
    const matter = await requireMatter(ctx, ac, args.matterId);
    if (args.hearingId) {
      const hearing = await ctx.db.get(args.hearingId);
      if (!hearing || hearing.matterId !== args.matterId) {
        throw new Error("That hearing is not on this matter.");
      }
    }
    await ctx.db.insert("orders", {
      matterId: args.matterId,
      title: args.title.trim(),
      passedOn: args.passedOn,
      summary: args.summary?.trim() || undefined,
      hearingId: args.hearingId,
      directions: args.directions?.length
        ? args.directions
            .map((d) => d.trim().slice(0, 300))
            .filter(Boolean)
            .map((text) => ({ text, done: false }))
        : undefined,
      followUp: args.followUp?.trim() || undefined,
      createdAt: Date.now(),
    });
    await logEvent(
      ctx,
      args.matterId,
      "order",
      `Order recorded — ${args.title.trim()}.`,
      { linkKind: "order", linkId: undefined },
    );
    void matter;
  },
});

/** Record/confirm directions and follow-up on an order. */
export const setOrderDirections = mutation({
  args: {
    orderId: v.id("orders"),
    directions: v.optional(v.array(v.string())),
    followUp: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "order.record");
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found.");
    await requireMatter(ctx, ac, order.matterId);
    const patch: Record<string, unknown> = {};
    if (args.directions !== undefined) {
      patch.directions = args.directions
        .map((d) => d.trim().slice(0, 300))
        .filter(Boolean)
        .map((text) => ({ text, done: false }));
    }
    if (args.followUp !== undefined)
      patch.followUp = args.followUp.trim() || undefined;
    await ctx.db.patch(args.orderId, patch);
    await logEvent(
      ctx,
      order.matterId,
      "order",
      `Order directions updated — ${order.title}.`,
    );
  },
});

/** Toggle a single direction's completion. */
export const toggleDirection = mutation({
  args: { orderId: v.id("orders"), index: v.number() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "order.record");
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found.");
    await requireMatter(ctx, ac, order.matterId);
    const dirs = order.directions ?? [];
    if (args.index < 0 || args.index >= dirs.length)
      throw new Error("No such direction.");
    const next = dirs.map((d, i) =>
      i === args.index ? { ...d, done: !d.done } : d,
    );
    await ctx.db.patch(args.orderId, { directions: next });
    await logEvent(
      ctx,
      order.matterId,
      "order",
      `Direction marked ${next[args.index].done ? "done" : "pending"} — ${next[args.index].text.slice(0, 80)}.`,
    );
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
    await logEvent(
      ctx,
      order.matterId,
      "order",
      `Order reviewed — ${order.title}.`,
      { linkKind: "order", linkId: order._id },
    );
  },
});

// ---------------- Tasks ----------------

export const addTask = mutation({
  args: {
    matterId: v.id("matters"),
    title: v.string(),
    dueAt: v.optional(v.number()),
    assigneeId: v.optional(v.id("users")),
    priority: v.optional(v.union(...TASK_PRIORITIES.map((p) => v.literal(p)))),
    kind: v.optional(v.union(...TASK_KINDS.map((k) => v.literal(k)))),
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

    const taskId = await ctx.db.insert("tasks", {
      matterId: args.matterId,
      orgId: ac.org._id,
      title: args.title.trim(),
      kind: args.kind ?? "general",
      priority: args.priority ?? "normal",
      dueAt: args.dueAt,
      status: "pending",
      assigneeId,
      createdById: ac.user._id,
      createdAt: Date.now(),
    });
    await logEvent(ctx, args.matterId, "task", `Task added — ${args.title.trim()}.`);
    // In-app notification for the assignee (not the creator).
    if (assigneeId !== ac.user._id) {
      await ctx.runMutation(internal.notifications.createInternal, {
        orgId: ac.org._id,
        userId: assigneeId,
        kind: "task_assigned",
        title: `New task — ${args.title.trim().slice(0, 140)}`,
        body: `Assigned by ${ac.user.name ?? "a colleague"}.`,
        linkTo: "/tasks",
        dedupeKey: `task_assigned:${taskId}`,
      });
    }
  },
});

/** Add a comment to any task the caller can see (matter access or own/firm-wide). */
export const addTaskComment = mutation({
  args: { taskId: v.id("tasks"), body: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!args.body.trim()) throw new Error("Comment cannot be empty.");
    const task = await ctx.db.get(args.taskId);
    if (!task || task.orgId !== ac.org._id) throw new Error("Task not found.");
    if (task.matterId !== undefined) {
      await requireMatter(ctx, ac, task.matterId);
    }
    const mine = task.assigneeId === ac.user._id;
    if (!mine && !can(ac, "task.manage")) {
      throw new Error("You can comment only on your own tasks.");
    }
    await ctx.db.patch(args.taskId, {
      comments: [
        ...(task.comments ?? []),
        { authorId: ac.user._id, body: args.body.trim(), at: Date.now() },
      ],
    });
    if (task.matterId !== undefined) {
      await logEvent(ctx, task.matterId, "task", `Comment on task — ${task.title}.`);
    }
  },
});

/** Reassign a task (management capability) — assignees must be active members. */
export const reassignTask = mutation({
  args: { taskId: v.id("tasks"), assigneeId: v.optional(v.id("users")) },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "task.manage");
    const task = await ctx.db.get(args.taskId);
    if (!task || task.orgId !== ac.org._id) throw new Error("Task not found.");
    if (task.matterId !== undefined) {
      await requireMatter(ctx, ac, task.matterId);
    }
    if (args.assigneeId !== undefined) {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_org_user", (q) =>
          q.eq("orgId", ac.org._id).eq("userId", args.assigneeId!),
        )
        .first();
      if (!membership || membership.status !== "active") {
        throw new Error("Assignees must be active members of the organisation.");
      }
    }
    await ctx.db.patch(args.taskId, { assigneeId: args.assigneeId });
    if (task.matterId !== undefined) {
      const assignee = args.assigneeId
        ? await ctx.db.get(args.assigneeId)
        : null;
      await logEvent(
        ctx,
        task.matterId,
        "task",
        `Task reassigned${assignee ? ` to ${assignee.name ?? "member"}` : " — unassigned"} — ${task.title}.`,
      );
    }
  },
});

export const setTaskStatus = mutation({
  args: { taskId: v.id("tasks"), status: taskStatusValidator },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found.");
    if (task.matterId === undefined) {
      throw new Error("Firm-wide tasks are updated from the Tasks desk.");
    }
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
      if (t.matterId === undefined) continue; // firm-wide tasks live on the Tasks desk
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
  args: {
    matterId: v.id("matters"),
    body: v.string(),
    confidentiality: v.optional(
      v.union(v.literal("internal"), v.literal("shared_with_client")),
    ),
  },
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
      confidentiality: args.confidentiality ?? "internal",
      createdAt: Date.now(),
    });
    await logEvent(ctx, args.matterId, "note", "Note added to the file.", {
      authorId: ac.user._id,
      visibility: "internal",
    });
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
    // SHA-256 (lowercase hex) of the uploaded bytes, computed in the
    // uploader's browser. Optional for legacy clients; when present it
    // seeds the evidence-integrity record.
    integritySha256: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "document.upload");
    await requireMatter(ctx, ac, args.matterId);

    const name = args.name.trim().slice(0, MAX_NAME);
    if (!name) throw new Error("Document name is required.");
    if (
      args.integritySha256 !== undefined &&
      !/^[a-f0-9]{64}$/.test(args.integritySha256)
    ) {
      throw new Error("Invalid integrity hash format.");
    }
    const docId = await ctx.db.insert("matterDocuments", {
      matterId: args.matterId,
      uploaderId: ac.user._id,
      name,
      kind: args.kind,
      visibility: args.visibility,
      storageId: args.storageId,
      integritySha256: args.integritySha256,
      custody: [
        {
          at: Date.now(),
          byId: ac.user._id,
          byName: ac.user.name ?? ac.user.email ?? "Member",
          action: "filed" as const,
        },
      ],
      createdAt: Date.now(),
    });
    // §32 Phase 5: a new document invalidates any approved-ready filing
    // checklist on this matter (readiness is a dated statement).
    await ctx.runMutation(internal.filingReadiness.invalidateChanged, {
      matterId: args.matterId,
      because: "document_added",
    });
    await logEvent(
      ctx,
      args.matterId,
      "document",
      `Document filed — ${name}${args.visibility === "shared_with_client" ? " (shared with client)" : ""}.`,
      {
        authorId: ac.user._id,
        linkKind: "document",
        linkId: docId,
        visibility:
          args.visibility === "shared_with_client"
            ? "shared_with_client"
            : "internal",
      },
    );
    return { documentId: String(docId) };
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

/** Audit log for a matter (who changed what) — audit-capable roles. */
export const listAudit = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    await requireMatter(ctx, ac, args.matterId);
    if (
      !can(ac, "matter.edit") &&
      !can(ac, "permissions.edit") &&
      ac.membership.orgRole !== "owner" &&
      ac.membership.orgRole !== "partner" &&
      ac.membership.orgRole !== "administrator"
    ) {
      return [];
    }
    return ctx.db
      .query("auditLog")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect()
      .then((rows) => rows.sort((a, b) => b.createdAt - a.createdAt));
  },
});

/** All hearings across visible matters (cause list). */
/** All hearings on a matter, newest first (access-checked). */
export const listHearings = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    await requireMatter(ctx, ac, args.matterId);
    const rows = await ctx.db
      .query("hearings")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    return rows.sort((a, b) => b.at - a.at);
  },
});

/** Resolve the matter behind a hearing (for deep links; access-checked). */
export const matterForHearing = query({
  args: { hearingId: v.id("hearings") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const hearing = await ctx.db.get(args.hearingId);
    if (!hearing) return null;
    const matter = await requireMatter(ctx, ac, hearing.matterId);
    return matter._id;
  },
});

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

// =====================================================================
// Hearing rescheduling with clash warnings (26 Sep 2026 audit gap).
//
// Pure rules live in src/lib/hearingSchedule.ts (unit-tested); this
// module enforces them server-side: capability + matter access first,
// then the same reschedule/clash rules the UI previews. Every move is
// appended to the hearing's `reschedules` audit trail (old value kept,
// never overwritten) and written to the org audit log; the matter
// chronology records the change and matters.nextHearingAt is refreshed
// by the existing helper.
// =====================================================================

/**
 * Clash preview for scheduling and rescheduling dialogs. Same-day
 * (IST) hearings across the whole organization are compared against the
 * candidate time; a clash requires time overlap AND a shared resource
 * (courtroom or effective advocate). Nothing here is a hard block — a
 * firm may deliberately double-book; the UI warns, the audit records.
 */
export const checkHearingClash = query({
  args: {
    at: v.number(),
    courtroom: v.optional(v.string()),
    appearingAdvocateId: v.optional(v.id("users")),
    // The candidate matter's lead lawyer — the fallback diary used when
    // no appearing advocate is chosen (mirrors addHearing defaults).
    fallbackAdvocateId: v.optional(v.id("users")),
    // Set when rescheduling: the hearing being moved excludes itself.
    excludeHearingId: v.optional(v.id("hearings")),
  },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;

    // Compare only against hearings on the candidate's IST day, across
    // the matters the caller is authorized to see.
    const day = istDayBounds(istDay(args.at));
    const matters = (
      await ctx.db
        .query("matters")
        .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
        .collect()
    ).filter((m) => canViewMatter(ac, m));
    const matterById = new Map(matters.map((m) => [m._id, m]));

    const candidates: ClashCandidate[] = [];
    for (const m of matters) {
      const rows = await ctx.db
        .query("hearings")
        .withIndex("by_matter", (q) => q.eq("matterId", m._id))
        .collect();
      for (const h of rows) {
        if (h.status === "cancelled") continue;
        if (h.at < day.start || h.at > day.end) continue;
        candidates.push({
          hearingId: h._id,
          matterId: h.matterId,
          title: `${m.reference} — ${h.title}`,
          at: h.at,
          courtroom: h.courtroom,
          appearingAdvocateId: h.appearingAdvocateId,
        });
      }
    }

    const clashes = detectClashes(
      {
        hearingId: args.excludeHearingId,
        at: args.at,
        courtroom: args.courtroom,
        appearingAdvocateId: args.appearingAdvocateId,
        fallbackAdvocateId: args.fallbackAdvocateId,
      },
      candidates,
    );

    return {
      clashes: clashes.map((c) => ({
        ...c,
        matterReference:
          matterById.get(c.matterId as Id<"matters">)?.reference ?? "—",
      })),
    };
  },
});

/**
 * Reschedule a hearing with a mandatory recorded reason. Only scheduled
 * or adjourned hearings may move (pure rule in hearingSchedule.ts);
 * the previous time is preserved in the audit trail, reminders carry
 * forward (they re-anchor to the new time), the matter chronology gets
 * an event, and the org audit log records who moved what and why.
 */
export const rescheduleHearing = mutation({
  args: {
    hearingId: v.id("hearings"),
    newAt: v.number(),
    reason: v.string(),
    courtroom: v.optional(v.string()),
    appearingAdvocateId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "hearing.manage");
    const hearing = await requireEditableHearing(ctx, args.hearingId);
    const matter = await requireMatter(ctx, ac, hearing.matterId);
    void matter;

    // Server-side validation of the same rules the client previews.
    const rejection = rescheduleRejection({
      currentStatus: hearing.status,
      currentAt: hearing.at,
      newAt: args.newAt,
      now: Date.now(),
    });
    if (rejection) throw new Error(rejection);

    const reason = args.reason.trim();
    if (reason.length < 3) {
      throw new Error("A reschedule reason is required (at least 3 characters).");
    }

    const now = Date.now();
    await ctx.db.patch(args.hearingId, {
      at: args.newAt,
      status: "scheduled",
      reminderDays: carryReminderDays(hearing.reminderDays),
      reschedules: [
        ...(hearing.reschedules ?? []),
        buildRescheduleAudit(
          ac.user._id,
          ac.user.name ?? ac.user.email ?? "Member",
          reason,
          hearing.at,
          args.newAt,
          now,
        ),
      ],
    });

    await refreshNextHearing(ctx, hearing.matterId);
    const oldWhen = new Date(hearing.at).toLocaleString("en-IN", {
      timeZone: ac.org.timezone,
      dateStyle: "medium",
      timeStyle: "short",
    });
    const newWhen = new Date(args.newAt).toLocaleString("en-IN", {
      timeZone: ac.org.timezone,
      dateStyle: "medium",
      timeStyle: "short",
    });
    await logEvent(
      ctx,
      hearing.matterId,
      "hearing",
      `Hearing rescheduled from ${oldWhen} to ${newWhen} — ${reason}.`,
      { linkKind: "hearing", linkId: args.hearingId },
    );
    await audit(
      ctx,
      ac,
      hearing.matterId,
      "Hearing rescheduled",
      `${oldWhen} → ${newWhen} (${reason})`,
    );
  },
});
