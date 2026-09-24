import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  can,
  canViewMatter,
  getAccessContext,
  requireAccess,
  requireCapability,
} from "./access";
import {
  runConflictSearch,
  canProceedToMatter,
  renderConflictReport,
  CLASSIFICATION_LABELS,
  normalizeEmail,
  normalizePhone,
  type ConflictClassification,
  type SearchableRecord,
  type SearchQuery,
} from "../lib/conflictFlow";

const MAX_STR = 300;

function strArray(items: string[] | undefined, max: number): string[] | undefined {
  const clean = (items ?? [])
    .map((s) => (s ?? "").trim().slice(0, MAX_STR))
    .filter(Boolean)
    .slice(0, max);
  return clean.length ? clean : undefined;
}

/** Extract the first plausible email / phone-looking substring from a string. */
function extractIdentity(s: string): { email?: string; phone?: string } {
  const emailMatch = s.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  const digits = s.replace(/\D/g, "");
  return {
    email: emailMatch ? normalizeEmail(emailMatch[0]) : undefined,
    phone: digits.length >= 10 ? normalizePhone(digits) : undefined,
  };
}

async function logAudit(
  ctx: { db: MutationCtx["db"] },
  orgId: Id<"organizations">,
  actorId: Id<"users">,
  actorName: string,
  action: string,
  conflictId: Id<"conflictChecks">,
  detail?: string,
) {
  await ctx.db.insert("auditLog", {
    orgId,
    actorId,
    actorName,
    action,
    detail: detail ?? `Conflict check ${conflictId}`,
    createdAt: Date.now(),
  });
}

// ---------------------------------------------------------------------
// Create: capture the full conflict intake + run the search once
// ---------------------------------------------------------------------

export const create = mutation({
  args: {
    proposedClientName: v.string(),
    clientId: v.optional(v.id("clients")),
    adverseParties: v.optional(v.array(v.string())),
    relatedCompanies: v.optional(v.array(v.string())),
    directorsBeneficialOwners: v.optional(v.array(v.string())),
    witnesses: v.optional(v.array(v.string())),
    aliases: v.optional(v.array(v.string())),
    relatedMatterRefs: v.optional(v.array(v.string())),
    referringParty: v.optional(v.string()),
    engagementDescription: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.create");

    const proposedClientName = args.proposedClientName.trim().slice(0, MAX_STR);
    if (proposedClientName.length < 2) {
      throw new Error("Name the proposed client.");
    }

    const intake = {
      proposedClient: proposedClientName,
      adverseParties: strArray(args.adverseParties, 15) ?? [],
      relatedCompanies: strArray(args.relatedCompanies, 15) ?? [],
      directors: strArray(args.directorsBeneficialOwners, 15) ?? [],
      witnesses: strArray(args.witnesses, 15) ?? [],
      aliases: strArray(args.aliases, 15) ?? [],
      relatedMatters: strArray(args.relatedMatterRefs, 15) ?? [],
      referringParty: args.referringParty?.trim().slice(0, MAX_STR) ?? "",
    };

    const { records, canSeeAll } = await collectSearchRecords(ctx, ac, intake);
    const result = runConflictSearch(intake, records);

    const count = await ctx.db
      .query("conflictChecks")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const year = new Date().getFullYear();
    const reference = `CNF/${year}/${String(count.length + 1).padStart(4, "0")}`;

    const conflictId = await ctx.db.insert("conflictChecks", {
      orgId: ac.org._id,
      clientId: args.clientId,
      subject: proposedClientName,
      status: "pending",
      matchCount: result.matches.length,
      reviewStatus: "pending",
      proposedClientName,
      adverseParties: strArray(args.adverseParties, 15),
      relatedCompanies: strArray(args.relatedCompanies, 15),
      directorsBeneficialOwners: strArray(args.directorsBeneficialOwners, 15),
      witnesses: strArray(args.witnesses, 15),
      aliases: strArray(args.aliases, 15),
      relatedMatterRefs: strArray(args.relatedMatterRefs, 15),
      referringParty: args.referringParty?.trim().slice(0, MAX_STR) || undefined,
      engagementDescription:
        args.engagementDescription?.trim().slice(0, 2000) || undefined,
      searchResults: result.matches,
      matchSummary: result.summary,
      createdBy: ac.user._id,
      createdByName: ac.user.name ?? ac.user.email ?? "Member",
      createdAt: Date.now(),
    });

    await logAudit(
      ctx,
      ac.org._id,
      ac.user._id,
      ac.user.name ?? ac.user.email ?? "Member",
      "Conflict check opened",
      conflictId,
      `${reference} — ${result.matches.length} labelled match${result.matches.length === 1 ? "" : "es"} (${result.summary.restricted} restricted).`,
    );

    return { conflictId, reference, summary: result.summary, searchScopeLimited: !canSeeAll };
  },
});

// ---------------------------------------------------------------------
// Search records builder — org-scoped, access-filtered, batched
// ---------------------------------------------------------------------

/**
 * Gather every searchable row in ONE pass: current/former clients,
 * matters + their opposing parties, contacts, witnesses (chronology
 * mentions), related parties, organizations (matter courts + order
 * titles are NOT searched — entities only), aliases and earlier
 * conflict checks. Rows attached exclusively to matters the caller
 * cannot see are returned as restricted placeholders.
 */
async function collectSearchRecords(
  ctx: import("./_generated/server").QueryCtx,
  ac: import("./access").AccessContext,
  intake: SearchQuery,
): Promise<{ records: SearchableRecord[]; canSeeAll: boolean }> {
  const [clients, matters, contacts, events, notes, priorChecks] = await Promise.all([
    ctx.db.query("clients").withIndex("by_org", (q) => q.eq("orgId", ac.org._id)).collect(),
    ctx.db.query("matters").withIndex("by_org", (q) => q.eq("orgId", ac.org._id)).collect(),
    ctx.db.query("clientContacts").withIndex("by_org", (q) => q.eq("orgId", ac.org._id)).collect(),
    ctx.db.query("matterEvents").collect(),
    ctx.db.query("matterNotes").collect(),
    ctx.db.query("conflictChecks").withIndex("by_org", (q) => q.eq("orgId", ac.org._id)).collect(),
  ]);

  // Visibility per matter once (pure rule, shared with every module).
  const matterVisible = new Map<string, boolean>();
  for (const m of matters) matterVisible.set(m._id, canViewMatter(ac, m));

  const mattersByClient = new Map<Id<"clients">, Doc<"matters">[]>();
  for (const m of matters) {
    const list = mattersByClient.get(m.clientId) ?? [];
    list.push(m);
    mattersByClient.set(m.clientId, list);
  }

  const records: SearchableRecord[] = [];
  const needles = [
    intake.proposedClient,
    ...intake.adverseParties,
    ...intake.relatedCompanies,
    ...intake.directors,
    ...intake.witnesses,
    ...intake.aliases,
    intake.referringParty,
  ].filter(Boolean);
  const needleEmails = needles.map((n) => extractIdentity(n).email).filter(Boolean) as string[];
  const needlePhones = needles.map((n) => extractIdentity(n).phone).filter(Boolean) as string[];

  const clientVisible = (clientId: Id<"clients">): boolean => {
    const ms = mattersByClient.get(clientId) ?? [];
    if (ms.length === 0) return true; // client with no matters: visible to the org
    return ms.some((m) => matterVisible.get(m._id));
  };
  const hiddenForClient = (clientId: Id<"clients">): string[] =>
    (mattersByClient.get(clientId) ?? [])
      .filter((m) => !matterVisible.get(m._id))
      .map((m) => m._id);

  for (const c of clients) {
    const visible = clientVisible(c._id);
    const identity = { email: c.email ? normalizeEmail(c.email) : undefined, phone: c.phone ? normalizePhone(c.phone) : undefined };
    records.push({
      kind: "client",
      id: c._id,
      label: visible ? c.name : undefined,
      matterIds: (mattersByClient.get(c._id) ?? []).filter((m) => matterVisible.get(m._id)).map((m) => m._id),
      hiddenMatterIds: hiddenForClient(c._id),
      restricted: !visible,
      ...identity,
    });
    if (c.archivedAt) {
      records.push({
        kind: "former_client",
        id: `former:${c._id}`,
        label: visible ? c.name : undefined,
        matterIds: [],
        hiddenMatterIds: hiddenForClient(c._id),
        restricted: !visible,
        ...identity,
      });
    }
  }

  for (const m of matters) {
    const visible = matterVisible.get(m._id) ?? false;
    records.push({
      kind: "matter",
      id: m._id,
      label: visible ? `${m.title}` : undefined,
      detail: visible ? `${m.reference}${m.court ? ` — ${m.court}` : ""}` : undefined,
      matterIds: [m._id],
      hiddenMatterIds: visible ? [] : [m._id],
      restricted: !visible,
    });
    if (m.opposingParty) {
      records.push({
        kind: "matter_opposing_party",
        id: `opp:${m._id}`,
        label: visible ? m.opposingParty : undefined,
        detail: visible ? `${m.reference} — opposing party` : undefined,
        matterIds: [m._id],
        hiddenMatterIds: visible ? [] : [m._id],
        restricted: !visible,
      });
    }
  }

  for (const ct of contacts) {
    const visible = clientVisible(ct.clientId);
    records.push({
      kind: "contact",
      id: ct._id,
      label: visible ? ct.name : undefined,
      detail: visible ? (ct.relation ? `${ct.name} — ${ct.relation}` : undefined) : undefined,
      matterIds: [],
      hiddenMatterIds: visible ? [] : hiddenForClient(ct.clientId),
      restricted: !visible,
      email: ct.email ? normalizeEmail(ct.email) : undefined,
      phone: ct.phone ? normalizePhone(ct.phone) : undefined,
    });
  }

  // Witnesses / related parties: mentioned in chronology events and notes.
  const mentionIndex: { id: string; label: string; matterId: Id<"matters">; kind: SearchableRecord["kind"] }[] = [];
  for (const e of events) {
    if (!e.detail) continue;
    const visible = matterVisible.get(e.matterId);
    mentionIndex.push({ id: `ev:${e._id}`, label: e.detail, matterId: e.matterId, kind: visible === false ? "related_party" : "witness" });
  }
  for (const n of notes) {
    if (n.fromClient !== true) continue;
    mentionIndex.push({ id: `note:${n._id}`, label: n.body, matterId: n.matterId, kind: "related_party" });
  }
  const mentionHits = new Map<string, { record: SearchableRecord; score: number }>();
  for (const mi of mentionIndex) {
    const visible = matterVisible.get(mi.matterId) ?? false;
    let hit = false;
    for (const needle of needles) {
      const tokens = needle.toLowerCase().split(/\s+/).filter((t) => t.length >= 4);
      if (tokens.length > 0 && tokens.every((t) => mi.label.toLowerCase().includes(t))) {
        hit = true;
        break;
      }
    }
    if (!hit) continue;
    const key = `${mi.matterId}:${mi.label.slice(0, 80)}`;
    const existing = mentionHits.get(key);
    if (existing) {
      existing.score += 1;
    } else {
      mentionHits.set(key, {
        record: {
          kind: visible ? mi.kind : "related_party",
          id: mi.id,
          label: visible ? mi.label.slice(0, 120) : undefined,
          matterIds: [mi.matterId],
          hiddenMatterIds: visible ? [] : [mi.matterId],
          restricted: !visible,
        },
        score: 1,
      });
    }
  }
  for (const { record } of mentionHits.values()) records.push(record);

  // Organizations: distinct matter courts count as searchable entities.
  const orgNames = new Set<string>();
  for (const m of matters) {
    if (m.court && matterVisible.get(m._id)) orgNames.add(m.court);
  }
  for (const name of orgNames) {
    records.push({ kind: "organization", id: `org:${name}`, label: name, matterIds: [], hiddenMatterIds: [], restricted: false });
  }

  // Aliases recorded on prior checks of this org.
  for (const pc of priorChecks) {
    for (const a of pc.aliases ?? []) {
      records.push({
        kind: "alias",
        id: `alias:${pc._id}:${a}`,
        label: a,
        matterIds: [],
        hiddenMatterIds: [],
        restricted: false,
      });
    }
  }

  void needleEmails;
  void needlePhones;
  return { records, canSeeAll: true };
}

// ---------------------------------------------------------------------
// Re-run search on demand (same visibility rules as creation)
// ---------------------------------------------------------------------

export const search = query({
  args: { conflictId: v.id("conflictChecks") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const row = await ctx.db.get(args.conflictId);
    if (!row || row.orgId !== ac.org._id) return null;
    if (!can(ac, "matter.create") && !can(ac, "client.view_all")) return null;

    const intake: SearchQuery = {
      proposedClient: row.proposedClientName ?? row.subject,
      adverseParties: row.adverseParties ?? [],
      relatedCompanies: row.relatedCompanies ?? [],
      directors: row.directorsBeneficialOwners ?? [],
      witnesses: row.witnesses ?? [],
      aliases: row.aliases ?? [],
      relatedMatters: row.relatedMatterRefs ?? [],
      referringParty: row.referringParty ?? "",
    };
    const { records } = await collectSearchRecords(ctx, ac, intake);
    return runConflictSearch(intake, records);
  },
});

// ---------------------------------------------------------------------
// Read one (with the stored search snapshot) + org register
// ---------------------------------------------------------------------

export const get = query({
  args: { conflictId: v.id("conflictChecks") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const row = await ctx.db.get(args.conflictId);
    if (!row || row.orgId !== ac.org._id) return null;
    if (!can(ac, "matter.create") && !can(ac, "client.view_all")) return null;
    return row;
  },
});

export const register = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    if (!can(ac, "matter.create") && !can(ac, "client.view_all")) return [];
    return ctx.db
      .query("conflictChecks")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect()
      .then((rows) => rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 50));
  },
});

// ---------------------------------------------------------------------
// Classify (authorized lawyer) / override (elevated) / decide
// ---------------------------------------------------------------------

export const classify = mutation({
  args: {
    conflictId: v.id("conflictChecks"),
    classification: v.union(
      v.literal("no_conflict"),
      v.literal("possible_conflict"),
      v.literal("confirmed_conflict"),
      v.literal("investigation_required"),
    ),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.create");
    const row = await ctx.db.get(args.conflictId);
    if (!row || row.orgId !== ac.org._id) {
      throw new Error("Conflict check not found.");
    }
    const reason = args.reason.trim();
    if (reason.length < 10) {
      throw new Error("Give the reasoning for this classification (at least 10 characters).");
    }

    const override =
      args.classification === "confirmed_conflict"
        ? (row.override ?? undefined)
        : undefined;
    if (args.classification === "confirmed_conflict" && !override) {
      // Confirmed conflict stands; matter opening stays blocked until an
      // elevated override or the decision is revisited.
    }

    await ctx.db.patch(args.conflictId, {
      classification: args.classification,
      classificationReason: reason.slice(0, 2000),
      decidedById: ac.user._id,
      decidedByName: ac.user.name ?? ac.user.email ?? "Member",
      decidedAt: Date.now(),
      reviewStatus:
        args.classification === "confirmed_conflict" ? "pending" : "cleared",
      updatedAt: Date.now(),
    });
    await logAudit(
      ctx,
      ac.org._id,
      ac.user._id,
      ac.user.name ?? ac.user.email ?? "Member",
      "Conflict classified",
      args.conflictId,
      `${CLASSIFICATION_LABELS[args.classification]} — ${reason.slice(0, 140)}`,
    );
  },
});

/** Elevated override: clear a confirmed conflict. Audited with a reason. */
export const override = mutation({
  args: {
    conflictId: v.id("conflictChecks"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "conflict.override");
    const row = await ctx.db.get(args.conflictId);
    if (!row || row.orgId !== ac.org._id) {
      throw new Error("Conflict check not found.");
    }
    if (row.classification !== "confirmed_conflict") {
      throw new Error("Only a confirmed conflict needs an override.");
    }
    const reason = args.reason.trim();
    if (reason.length < 10) {
      throw new Error("An override requires a substantive reason (at least 10 characters).");
    }
    await ctx.db.patch(args.conflictId, {
      override: {
        byId: ac.user._id,
        byName: ac.user.name ?? ac.user.email ?? "Member",
        reason: reason.slice(0, 2000),
        at: Date.now(),
      },
      reviewStatus: "cleared",
      updatedAt: Date.now(),
    });
    await logAudit(
      ctx,
      ac.org._id,
      ac.user._id,
      ac.user.name ?? ac.user.email ?? "Member",
      "Conflict override (elevated)",
      args.conflictId,
      `Confirmed conflict cleared — ${reason.slice(0, 140)}`,
    );
  },
});

/** Reject the engagement entirely (kept for the register). */
export const reject = mutation({
  args: { conflictId: v.id("conflictChecks"), reason: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.create");
    const row = await ctx.db.get(args.conflictId);
    if (!row || row.orgId !== ac.org._id) {
      throw new Error("Conflict check not found.");
    }
    await ctx.db.patch(args.conflictId, {
      reviewStatus: "rejected",
      classificationReason: args.reason.trim().slice(0, 2000),
      decidedById: ac.user._id,
      decidedByName: ac.user.name ?? ac.user.email ?? "Member",
      decidedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await logAudit(
      ctx,
      ac.org._id,
      ac.user._id,
      ac.user.name ?? ac.user.email ?? "Member",
      "Engagement declined on conflict",
      args.conflictId,
      args.reason.slice(0, 140),
    );
  },
});

// ---------------------------------------------------------------------
// Gate for matters.create + report rendering
// ---------------------------------------------------------------------

/**
 * May this proposed matter proceed to opening? Used by matters.create.
 * Returns the blocking reason or null. Cross-org rows are simply "no
 * conflict on file" for THAT org — a check from another tenant can
 * never clear this one, so the caller must hold a cleared check in
 * their own org.
 */
export async function openingGate(
  ctx: import("./_generated/server").MutationCtx,
  ac: import("./access").AccessContext,
  proposedClientName: string,
  clientName?: string,
  conflictCheckId?: Id<"conflictChecks">,
): Promise<{ ok: true; conflictId?: Id<"conflictChecks"> } | { ok: false; reason: string }> {
  const row = conflictCheckId ? await ctx.db.get(conflictCheckId) : null;
  if (row) {
    if (row.orgId !== ac.org._id) {
      return { ok: false, reason: "That conflict check belongs to a different organization." };
    }
    if (row.reviewStatus === "rejected") {
      return { ok: false, reason: "This conflict check was rejected — the engagement is declined." };
    }
    if (!canProceedToMatter({ classification: row.classification ?? null, override: row.override ?? null })) {
      if (row.classification === "confirmed_conflict") {
        return {
          ok: false,
          reason: "A confirmed conflict is on record. An elevated override (owner/partner) is required before opening the matter.",
        };
      }
      return { ok: false, reason: "The conflict check has not been classified by an authorized lawyer yet." };
    }
    return { ok: true, conflictId: row._id };
  }
  // No explicit check referenced: fall back to any cleared check for the
  // same proposed client (matter title or the client record's name) in
  // this org.
  const checks = await ctx.db
    .query("conflictChecks")
    .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
    .collect();
  const candidates = [proposedClientName.trim().toLowerCase(), (clientName ?? "").trim().toLowerCase()]
    .filter((n) => n.length >= 2);
  const cleared = checks.find(
    (c) =>
      c.reviewStatus === "cleared" &&
      candidates.includes((c.proposedClientName ?? c.subject).trim().toLowerCase()),
  );
  if (cleared) return { ok: true, conflictId: cleared._id };
  return {
    ok: false,
    reason:
      "Run and clear a conflict check for this proposed client before opening the matter.",
  };
}

/** Timestamped report for one check (text). */
export const report = query({
  args: { conflictId: v.id("conflictChecks") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const row = await ctx.db.get(args.conflictId);
    if (!row || row.orgId !== ac.org._id) return null;
    if (!can(ac, "matter.create") && !can(ac, "client.view_all")) return null;

    const stored = (row.searchResults ?? []) as ReturnType<typeof runConflictSearch>["matches"];
    const summary = row.matchSummary ?? { exact: 0, normalized: 0, possible: 0, restricted: 0 };
    // Derive the org-scoped CNF reference from creation order.
    const earlier = await ctx.db
      .query("conflictChecks")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const index = earlier.filter((c) => c.createdAt <= row.createdAt).length;
    return renderConflictReport({
      reference: `CNF/${new Date(row.createdAt).getFullYear()}/${String(index).padStart(4, "0")}`,
      proposedClient: row.proposedClientName ?? row.subject,
      engagementDescription: row.engagementDescription,
      searchedAt: row.createdAt,
      searchResult: { matches: stored, summary },
      classification: (row.classification ?? null) as ConflictClassification | null,
      classificationReason: row.classificationReason,
      decidedByName: row.decidedByName,
      override: row.override ?? null,
      viewerName: ac.user.name ?? ac.user.email ?? "Member",
      now: Date.now(),
    });
  },
});
