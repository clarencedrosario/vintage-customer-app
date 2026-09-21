import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import {
  can,
  canViewDocument,
  getAccessContext,
  requireAccess,
  requireCapability,
  requireMatter,
} from "./access";
import type { Doc, Id } from "./_generated/dataModel";

// ===============================================================
// One-click hearing pack — a reviewable PDF bundle for court day.
//
// The stored pack records the SELECTION and its provenance (who,
// when, which version). The PDF itself is rebuilt from live,
// access-enforced data on every generation and download, so a stale
// selection can never resurrect material the caller may no longer
// see. Client-shared packs (includeInternal: false) exclude internal
// material both when listing options and when rebuilding.
// ===============================================================

const SECTIONS = [
  "hearing",
  "summary",
  "chronology",
  "orders",
  "documents",
  "prep",
  "tasks",
] as const;
type SectionId = (typeof SECTIONS)[number];

const MAX_SELECTED = 50;
const MAX_EVENTS = 200;

/** Events safe for a client-shared bundle (never internal strategy). */
function clientVisibleEvent(e: Doc<"matterEvents">): boolean {
  // AI-extracted events remain suggestions until reviewed — never packed.
  if (e.aiSuggested && e.reviewed !== true) return false;
  if (e.visibility === "shared_with_client") return true;
  if (e.visibility === "internal") return false;
  // Legacy rows without a visibility flag: exclude internal-only kinds.
  return e.kind !== "note" && e.kind !== "task";
}

/** Packable events for an internal bundle. */
function packableEvent(e: Doc<"matterEvents">): boolean {
  return !(e.aiSuggested && e.reviewed !== true);
}

/**
 * Everything the pack builder offers: the hearing selector, orders,
 * documents, chronology entries — already filtered by the caller's
 * document-level access and the client-safe flag.
 */
export const context = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const matter = await requireMatter(ctx, ac, args.matterId);

    const [hearings, orders, documents, events, parties] = await Promise.all([
      ctx.db
        .query("hearings")
        .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
        .collect(),
      ctx.db
        .query("orders")
        .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
        .collect(),
      ctx.db
        .query("matterDocuments")
        .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
        .collect(),
      ctx.db
        .query("matterEvents")
        .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
        .collect(),
      ctx.db
        .query("matterParties")
        .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
        .collect(),
    ]);

    const client = await ctx.db.get(matter.clientId);
    const viewInternal = can(ac, "document.view_internal");

    // Author names for chronology attribution.
    const authorIds = Array.from(
      new Set(
        events
          .map((e) => e.authorId)
          .filter((x): x is Id<"users"> => x !== undefined),
      ),
    );
    const nameByUser = new Map<Id<"users">, string>();
    for (const id of authorIds) {
      const u = await ctx.db.get(id);
      if (u) nameByUser.set(id, u.name ?? u.email ?? "Member");
    }

    const visibleEvents = events
      .filter(viewInternal ? packableEvent : clientVisibleEvent)
      .sort((a, b) => (a.occurredAt ?? a.createdAt) - (b.occurredAt ?? b.createdAt))
      .slice(0, MAX_EVENTS);

    const visibleDocs = documents
      .filter((d) => canViewDocument(ac, d, matter))
      .sort((a, b) => b.createdAt - a.createdAt);

    const versions = await ctx.db
      .query("hearingPacks")
      .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
      .collect();

    return {
      matter: {
        _id: matter._id,
        reference: matter.reference,
        title: matter.title,
        court: matter.court ?? null,
        bench: matter.bench ?? null,
        caseNumber: matter.caseNumber ?? null,
        jurisdiction: matter.jurisdiction ?? null,
        practiceArea: matter.practiceArea,
        description: matter.description ?? null,
      },
      clientName: client?.name ?? "—",
      hearings: hearings
        .sort((a, b) => b.at - a.at)
        .map((h) => ({
          _id: h._id,
          title: h.title,
          at: h.at,
          status: h.status,
          court: h.court ?? null,
        })),
      orders: orders
        .sort((a, b) => b.passedOn - a.passedOn)
        .map((o) => ({
          _id: o._id,
          title: o.title,
          passedOn: o.passedOn,
          summary: o.summary ?? null,
          reviewed: o.reviewedAt !== undefined,
          hearingId: o.hearingId ?? null,
          hasFile: o.storageId !== undefined,
        })),
      documents: visibleDocs.map((d) => ({
        _id: d._id,
        name: d.name,
        kind: d.kind,
        visibility: d.visibility,
        submittedByClient: d.submittedByClient === true,
        hasFile: d.storageId !== undefined,
      })),
      chronology: visibleEvents.map((e) => ({
        _id: e._id,
        kind: e.kind,
        detail: e.detail ?? "",
        occurredAt: e.occurredAt ?? e.createdAt,
        datePrecision: e.datePrecision ?? "exact",
        author: e.authorId ? (nameByUser.get(e.authorId) ?? null) : null,
        sourceRef: e.sourceRef ?? null,
        linkKind: e.linkKind ?? null,
      })),
      parties: parties.map((p) => ({
        _id: p._id,
        side: p.side,
        name: p.name,
        counsel: p.counsel ?? null,
      })),
      permissions: {
        canGenerate: can(ac, "hearing.manage"),
        viewInternal,
      },
      versions: versions
        .sort((a, b) => b.version - a.version)
        .slice(0, 12)
        .map((p) => ({
          _id: p._id,
          version: p.version,
          label: p.label,
          createdAt: p.createdAt,
          includeInternal: p.includeInternal,
          downloads: p.downloads,
        })),
    };
  },
});

type PackData = {
  version: number;
  label: string;
  includeInternal: boolean;
  generatedFor: string;
  generatedAt: number;
  matter: {
    reference: string;
    title: string;
    court: string | null;
    bench: string | null;
    caseNumber: string | null;
    jurisdiction: string | null;
    practiceArea: string;
    description: string | null;
  };
  clientName: string;
  orgName: string;
  orgAddress: string | null;
  timezone: string;
  hearing: {
    _id: Id<"hearings">;
    title: string;
    at: number;
    status: string;
    court: string | null;
    courtroom: string | null;
    judge: string | null;
    purpose: string | null;
    appearance: string | null;
    advocateName: string | null;
    prepNotes: string | null;
    requiredDocuments: string[];
    outcome: string | null;
    nextAction: string | null;
    authorities: { label: string; url?: string }[];
  } | null;
  selectedOrders: {
    title: string;
    passedOn: number;
    summary: string | null;
    directions: { text: string; done: boolean }[];
    followUp: string | null;
    reviewed: boolean;
    hearingTitle: string | null;
    hasFile: boolean;
  }[];
  selectedDocuments: {
    name: string;
    kind: string;
    visibility: string;
    submittedByClient: boolean;
    hasFile: boolean;
  }[];
  chronology: {
    detail: string;
    occurredAt: number;
    datePrecision: string;
    author: string | null;
    sourceRef: string | null;
    linkKind: string | null;
  }[];
  parties: { side: string; name: string; counsel: string | null }[];
  openTasks: { title: string; dueAt: number | null; assignee: string | null }[];
  selectedSectionIds: string[];
  createdBy: string;
};

/**
 * Live, access-enforced content for one stored pack. Returns null when
 * the caller has lost access to the underlying matter — a version can
 * never be downloaded past its permissions.
 */
export const packData = query({
  args: { packId: v.id("hearingPacks") },
  handler: async (ctx, args): Promise<PackData | null> => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const pack = await ctx.db.get(args.packId);
    if (!pack) return null;
    const matter = await requireMatter(ctx, ac, pack.matterId);

    const [client, hearing] = await Promise.all([
      ctx.db.get(matter.clientId),
      pack.hearingId ? ctx.db.get(pack.hearingId) : Promise.resolve(null),
    ]);

    const sectionIds = new Set(
      pack.selection.sectionIds.filter((s): s is SectionId =>
        (SECTIONS as readonly string[]).includes(s),
      ),
    );
    const internal = pack.includeInternal && can(ac, "document.view_internal");

    // ---- Selected orders (drop anything no longer on this matter) ----
    const selectedOrders: PackData["selectedOrders"] = [];
    const hearingTitles = new Map<Id<"hearings">, string>();
    for (const orderId of pack.selection.orderIds.slice(0, MAX_SELECTED)) {
      const o = await ctx.db.get(orderId);
      if (!o || o.matterId !== matter._id) continue;
      if (o.hearingId && !hearingTitles.has(o.hearingId)) {
        const h = await ctx.db.get(o.hearingId);
        if (h) hearingTitles.set(h._id, h.title);
      }
      selectedOrders.push({
        title: o.title,
        passedOn: o.passedOn,
        summary: o.summary ?? null,
        directions: o.directions ?? [],
        followUp: o.followUp ?? null,
        reviewed: o.reviewedAt !== undefined,
        hearingTitle: o.hearingId ? (hearingTitles.get(o.hearingId) ?? null) : null,
        hasFile: o.storageId !== undefined,
      });
    }

    // ---- Selected documents (re-checked against current access) ----
    const selectedDocuments: PackData["selectedDocuments"] = [];
    for (const documentId of pack.selection.documentIds.slice(0, MAX_SELECTED)) {
      const d = await ctx.db.get(documentId);
      if (!d || d.matterId !== matter._id) continue;
      if (!canViewDocument(ac, d, matter)) continue;
      if (d.visibility === "internal" && !internal) continue; // client-safe copy
      selectedDocuments.push({
        name: d.name,
        kind: d.kind,
        visibility: d.visibility,
        submittedByClient: d.submittedByClient === true,
        hasFile: d.storageId !== undefined,
      });
    }

    // ---- Chronology (same visibility rules as the offering query) ----
    const events = await ctx.db
      .query("matterEvents")
      .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
      .collect();
    const visibleEvents = events
      .filter(internal ? packableEvent : clientVisibleEvent)
      .sort((a, b) => (a.occurredAt ?? a.createdAt) - (b.occurredAt ?? b.createdAt))
      .slice(0, MAX_EVENTS);
    const authorIds = Array.from(
      new Set(
        visibleEvents
          .map((e) => e.authorId)
          .filter((x): x is Id<"users"> => x !== undefined),
      ),
    );
    const nameByUser = new Map<Id<"users">, string>();
    for (const id of authorIds) {
      const u = await ctx.db.get(id);
      if (u) nameByUser.set(id, u.name ?? u.email ?? "Member");
    }

    // ---- Open tasks ----
    const taskRows = await ctx.db
      .query("tasks")
      .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
      .collect();
    const openTasks: PackData["openTasks"] = [];
    for (const t of taskRows.filter((t) => t.status !== "done")) {
      const assignee = t.assigneeId ? await ctx.db.get(t.assigneeId) : null;
      openTasks.push({
        title: t.title,
        dueAt: t.dueAt ?? null,
        assignee: assignee ? (assignee.name ?? assignee.email ?? null) : null,
      });
    }

    // ---- Hearing payload ----
    let hearingPayload: PackData["hearing"] = null;
    if (hearing) {
      const advocate = hearing.appearingAdvocateId
        ? await ctx.db.get(hearing.appearingAdvocateId)
        : null;
      hearingPayload = {
        _id: hearing._id,
        title: hearing.title,
        at: hearing.at,
        status: hearing.status,
        court: hearing.court ?? matter.court ?? null,
        courtroom: hearing.courtroom ?? null,
        judge: hearing.judge ?? null,
        purpose: hearing.purpose ?? null,
        appearance: hearing.appearance ?? null,
        advocateName: advocate
          ? (advocate.name ?? advocate.email ?? null)
          : null,
        prepNotes: hearing.prepNotes ?? null,
        requiredDocuments: hearing.requiredDocuments ?? [],
        outcome: hearing.outcome ?? null,
        nextAction: hearing.nextAction ?? null,
        authorities: hearing.authorities ?? [],
      };
    }

    const packAuthor = await ctx.db.get(pack.createdById);

    return {
      version: pack.version,
      label: pack.label,
      includeInternal: internal,
      generatedFor: ac.user.name ?? ac.user.email ?? "Member",
      generatedAt: Date.now(),
      matter: {
        reference: matter.reference,
        title: matter.title,
        court: matter.court ?? null,
        bench: matter.bench ?? null,
        caseNumber: matter.caseNumber ?? null,
        jurisdiction: matter.jurisdiction ?? null,
        practiceArea: matter.practiceArea,
        description: matter.description ?? null,
      },
      clientName: client?.name ?? "—",
      orgName: ac.org.name,
      orgAddress:
        [ac.org.addressLine1, ac.org.city, ac.org.state]
          .filter(Boolean)
          .join(", ") || null,
      timezone: ac.org.timezone ?? "Asia/Kolkata",
      hearing: hearingPayload,
      selectedOrders,
      selectedDocuments,
      chronology: visibleEvents.map((e) => ({
        detail: e.detail ?? "",
        occurredAt: e.occurredAt ?? e.createdAt,
        datePrecision: e.datePrecision ?? "exact",
        author: e.authorId ? (nameByUser.get(e.authorId) ?? null) : null,
        sourceRef: e.sourceRef ?? null,
        linkKind: e.linkKind ?? null,
      })),
      parties: (
        await ctx.db
          .query("matterParties")
          .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
          .collect()
      ).map((p) => ({
        side: p.side,
        name: p.name,
        counsel: p.counsel ?? null,
      })),
      openTasks,
      selectedSectionIds: Array.from(sectionIds),
      createdBy: packAuthor?.name ?? packAuthor?.email ?? "Member",
    };
  },
});

/** Version history for one matter (pack provenance). */
export const listForMatter = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    await requireMatter(ctx, ac, args.matterId);
    return ctx.db
      .query("hearingPacks")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect()
      .then((rows) =>
        rows.sort((a, b) => b.version - a.version).map((p) => ({
          _id: p._id,
          version: p.version,
          label: p.label,
          createdAt: p.createdAt,
          includeInternal: p.includeInternal,
          downloads: p.downloads,
        })),
      );
  },
});

/**
 * Record a generated pack version. The selection is validated against
 * the matter; internal material referenced by a client-shared pack is
 * recorded as excluded so downloads stay consistent with the intent.
 */
export const generate = mutation({
  args: {
    matterId: v.id("matters"),
    hearingId: v.optional(v.id("hearings")),
    sectionIds: v.array(v.string()),
    orderIds: v.array(v.id("orders")),
    documentIds: v.array(v.id("matterDocuments")),
    includeInternal: v.boolean(),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "hearing.manage");
    await requireMatter(ctx, ac, args.matterId);

    if (args.hearingId) {
      const hearing = await ctx.db.get(args.hearingId);
      if (!hearing || hearing.matterId !== args.matterId) {
        throw new Error("That hearing is not on this matter.");
      }
    }

    // Validate sections and the selection shape.
    const sectionIds = args.sectionIds.filter((s) =>
      (SECTIONS as readonly string[]).includes(s),
    );
    if (sectionIds.length === 0) {
      throw new Error("Select at least one section for the pack.");
    }
    if (args.orderIds.length > MAX_SELECTED || args.documentIds.length > MAX_SELECTED) {
      throw new Error("Too many items selected for one pack.");
    }

    // Every referenced item must belong to this matter.
    for (const orderId of args.orderIds) {
      const o = await ctx.db.get(orderId);
      if (!o || o.matterId !== args.matterId) {
        throw new Error("An selected order is not on this matter.");
      }
    }
    for (const documentId of args.documentIds) {
      const d = await ctx.db.get(documentId);
      if (!d || d.matterId !== args.matterId) {
        throw new Error("A selected document is not on this matter.");
      }
    }

    const previous = await ctx.db
      .query("hearingPacks")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    const version = previous.reduce((m, p) => Math.max(m, p.version), 0) + 1;

    const label = `v${version} — ${new Date().toLocaleString("en-IN", {
      timeZone: ac.org.timezone ?? "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short",
    })}`;

    const packId = await ctx.db.insert("hearingPacks", {
      matterId: args.matterId,
      hearingId: args.hearingId,
      version,
      label,
      createdById: ac.user._id,
      createdAt: Date.now(),
      selection: {
        sectionIds,
        orderIds: args.orderIds,
        documentIds: args.documentIds,
      },
      includeInternal: args.includeInternal && can(ac, "document.view_internal"),
      downloads: 0,
    });

    await ctx.db.insert("matterEvents", {
      matterId: args.matterId,
      kind: "hearing",
      detail: `Hearing pack ${label} generated by ${ac.user.name ?? "a member"}${args.includeInternal ? "" : " (client-shared copy — internal material excluded)"}.`,
      createdAt: Date.now(),
      authorId: ac.user._id,
      occurredAt: Date.now(),
      datePrecision: "exact",
      visibility: args.includeInternal ? "internal" : "shared_with_client",
    });

    return { packId, version, label };
  },
});

/** Count a download (any member who can still see the matter). */
export const recordDownload = mutation({
  args: { packId: v.id("hearingPacks") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const pack = await ctx.db.get(args.packId);
    if (!pack) throw new Error("Pack not found.");
    await requireMatter(ctx, ac, pack.matterId);
    await ctx.db.patch(args.packId, { downloads: pack.downloads + 1 });
  },
});
