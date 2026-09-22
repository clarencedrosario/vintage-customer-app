import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import {
  can,
  canViewDocument,
  matterOrNull,
  requireAccess,
  requireWriteAccess,
  requireMatter,
  type AccessContext,
} from "./access";
import { sha256Hex } from "./crypto";
import type { Doc, Id } from "./_generated/dataModel";

// =====================================================================
// Offline court mode (section 27).
//
// An explicit, opt-in preparation tool: a member selects ONE matter, a
// limited hearing pack and permitted notes, and downloads them to their
// own device. What is stored on the device, how long it lives, how it
// is secured, and how it is removed are all visible in the UI.
//
// Honest limits, stated in the product itself:
//  - Revocation is NOT instant on a disconnected device. Marking a
//    bundle revoked only affects the next sync; the copy on an offline
//    device survives until it reconnects and the user removes it.
//  - Shared-device limitation: anything stored locally can be read by
//    other users of the same browser profile. Requires explicit opt-in
//    for exactly that reason.
//  - Never the whole firm database: one matter, capped selections.
// =====================================================================

const MAX_DOCUMENTS = 12;
const MAX_EVENTS = 120;
const MAX_QUEUED_NOTES = 20;
const MAX_NOTE_CHARS = 4000;
/** Bundles expire after 7 days (re-preparable any time). */
const BUNDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const TTL_DAYS = BUNDLE_TTL_MS / (24 * 60 * 60 * 1000);

/** Device identity scopes bundles to (user, device) pairs. */
export function deviceIdOf(userId: Id<"users">): string {
  return `u:${userId}`;
}

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

export type OfflinePayload = {
  version: number;
  generatedAt: number;
  org: { name: string };
  matter: {
    _id: Id<"matters">;
    reference: string;
    title: string;
    court: string | null;
    bench: string | null;
    caseNumber: string | null;
    practiceArea: string;
  };
  clientName: string;
  hearing: {
    _id: Id<"hearings">;
    title: string;
    at: number;
    court: string | null;
    courtroom: string | null;
    judge: string | null;
    purpose: string | null;
    prepNotes: string | null;
    requiredDocuments: string[];
  } | null;
  orders: {
    _id: Id<"orders">;
    title: string;
    passedOn: number;
    summary: string | null;
    directions: { text: string; done: boolean }[];
  }[];
  chronology: {
    detail: string;
    occurredAt: number;
    datePrecision: string;
    sourceRef: string | null;
  }[];
  notes: {
    _id: Id<"matterNotes">;
    body: string;
    fromClient: boolean;
    createdAt: number;
  }[];
  documents: {
    _id: Id<"matterDocuments">;
    name: string;
    visibility: string;
    updatedAt: number;
  }[];
  parties: { side: string; name: string; counsel: string | null }[];
  limits: { maxEvents: number };
};

// ---------------------------------------------------------------------
// Selection context — what may be packed for this matter
// ---------------------------------------------------------------------

export const prepareContext = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const matter = await requireMatter(ctx, ac, args.matterId);
    const [client, documents, hearings, notes] = await Promise.all([
      ctx.db.get(matter.clientId),
      ctx.db
        .query("matterDocuments")
        .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
        .collect(),
      ctx.db
        .query("hearings")
        .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
        .collect(),
      ctx.db
        .query("matterNotes")
        .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
        .collect(),
    ]);

    const viewInternal = can(ac, "document.view_internal");
    const visibleDocs = documents
      .filter((d) => canViewDocument(ac, d, matter))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((d) => ({
        _id: d._id,
        name: d.name,
        visibility: d.visibility,
        hasFile: d.storageId !== undefined,
      }));

    const existing = await ctx.db
      .query("offlineBundles")
      .withIndex("by_user", (q) => q.eq("userId", ac.user._id))
      .collect();
    const mine = existing
      .filter(
        (b) =>
          b.matterId === matter._id &&
          b.deviceId === deviceIdOf(ac.user._id) &&
          !b.removedAt,
      )
      .sort((a, b) => b.preparedAt - a.preparedAt);

    return {
      matter: {
        _id: matter._id,
        reference: matter.reference,
        title: matter.title,
        court: matter.court ?? null,
      },
      clientName: client?.name ?? "—",
      documents: visibleDocs,
      hearings: hearings
        .sort((a, b) => b.at - a.at)
        .slice(0, 20)
        .map((h) => ({ _id: h._id, title: h.title, at: h.at })),
      noteCount: notes.length,
      permissions: { viewInternal },
      limits: {
        maxDocuments: MAX_DOCUMENTS,
        maxEvents: MAX_EVENTS,
        ttlDays: TTL_DAYS,
      },
      existingBundle: mine[0]
        ? {
            _id: mine[0]._id,
            preparedAt: mine[0].preparedAt,
            syncedAt: mine[0].syncedAt,
            fingerprint: mine[0].fingerprint,
            revokedAt: mine[0].revokedAt ?? null,
            deviceLabel: mine[0].deviceLabel,
          }
        : null,
    };
  },
});

// ---------------------------------------------------------------------
// Payload building — the exact content served to a device
// ---------------------------------------------------------------------

/**
 * The full offline payload. Access is enforced on every build: documents
 * the caller may no longer see are silently dropped, and losing matter
 * access makes the bundle unservable (requireMatter throws).
 */
async function buildPayload(
  ctx: QueryCtx,
  ac: AccessContext,
  sel: {
    matterId: Id<"matters">;
    hearingId?: Id<"hearings">;
    sectionIds: string[];
    includeNotes: boolean;
    documentIds: Id<"matterDocuments">[];
  },
): Promise<OfflinePayload> {
  const matter = await ctx.db.get(sel.matterId);
  if (!matter) throw new Error("Matter not found.");
  const client = await ctx.db.get(matter.clientId);
  const sectionIds = new Set(sel.sectionIds);

  const [hearings, orders, events, notes, parties] = await Promise.all([
    ctx.db
      .query("hearings")
      .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
      .collect(),
    ctx.db
      .query("orders")
      .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
      .collect(),
    ctx.db
      .query("matterEvents")
      .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
      .collect(),
    ctx.db
      .query("matterNotes")
      .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
      .collect(),
    ctx.db
      .query("matterParties")
      .withIndex("by_matter", (q) => q.eq("matterId", matter._id))
      .collect(),
  ]);

  const hearing = sel.hearingId
    ? (hearings.find((h) => h._id === sel.hearingId) ?? null)
    : null;

  const packableEvents = events
    .filter((e) => !(e.aiSuggested && e.reviewed !== true))
    .sort((a, b) => (a.occurredAt ?? a.createdAt) - (b.occurredAt ?? b.createdAt))
    .slice(0, MAX_EVENTS);

  const offlineNotes: OfflinePayload["notes"] = sel.includeNotes
    ? notes
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 60)
        .map((n) => ({
          _id: n._id,
          body: n.body,
          fromClient: n.fromClient === true,
          createdAt: n.createdAt,
        }))
    : [];

  const offlineDocuments: OfflinePayload["documents"] = [];
  for (const documentId of sel.documentIds.slice(0, MAX_DOCUMENTS)) {
    const d = await ctx.db.get(documentId);
    if (!d || d.matterId !== matter._id) continue;
    if (!canViewDocument(ac, d, matter)) continue;
    offlineDocuments.push({
      _id: d._id,
      name: d.name,
      visibility: d.visibility,
      updatedAt: d.createdAt,
    });
  }

  return {
    version: 1,
    generatedAt: Date.now(),
    org: { name: ac.org.name },
    matter: {
      _id: matter._id,
      reference: matter.reference,
      title: matter.title,
      court: matter.court ?? null,
      bench: matter.bench ?? null,
      caseNumber: matter.caseNumber ?? null,
      practiceArea: matter.practiceArea,
    },
    clientName: client?.name ?? "—",
    hearing: hearing
      ? {
          _id: hearing._id,
          title: hearing.title,
          at: hearing.at,
          court: hearing.court ?? null,
          courtroom: hearing.courtroom ?? null,
          judge: hearing.judge ?? null,
          purpose: hearing.purpose ?? null,
          prepNotes: hearing.prepNotes ?? null,
          requiredDocuments: hearing.requiredDocuments ?? [],
        }
      : null,
    orders: sectionIds.has("orders")
      ? orders
          .sort((a, b) => b.passedOn - a.passedOn)
          .slice(0, 30)
          .map((o) => ({
            _id: o._id,
            title: o.title,
            passedOn: o.passedOn,
            summary: o.summary ?? null,
            directions: o.directions ?? [],
          }))
      : [],
    chronology: sectionIds.has("chronology")
      ? packableEvents
          .filter((e) => e.kind !== "note")
          .map((e) => ({
            detail: e.detail ?? "",
            occurredAt: e.occurredAt ?? e.createdAt,
            datePrecision: e.datePrecision ?? "exact",
            sourceRef: e.sourceRef ?? null,
          }))
      : [],
    notes: offlineNotes,
    documents: offlineDocuments,
    parties: parties.map((p) => ({
      side: p.side,
      name: p.name,
      counsel: p.counsel ?? null,
    })),
    limits: { maxEvents: MAX_EVENTS },
  };
}

// ---------------------------------------------------------------------
// Prepare: create the bundle row and return the full payload
// ---------------------------------------------------------------------

export const prepare = mutation({
  args: {
    matterId: v.id("matters"),
    hearingId: v.optional(v.id("hearings")),
    sectionIds: v.array(v.string()),
    includeNotes: v.boolean(),
    documentIds: v.array(v.id("matterDocuments")),
    deviceLabel: v.string(),
  },
  handler: async (ctx, args) => {
    const ac = await requireWriteAccess(ctx);
    if (!can(ac, "note.write")) {
      throw new Error(
        "You need note-writing permission to prepare an offline pack.",
      );
    }
    await requireMatter(ctx, ac, args.matterId);
    if (args.documentIds.length > MAX_DOCUMENTS) {
      throw new Error(
        `Select at most ${MAX_DOCUMENTS} documents for offline use.`,
      );
    }

    const payload = await buildPayload(ctx, ac, {
      matterId: args.matterId,
      hearingId: args.hearingId,
      sectionIds: args.sectionIds,
      includeNotes: args.includeNotes,
      documentIds: args.documentIds,
    });

    const fingerprint = sha256Hex(JSON.stringify(payload));

    // One live bundle per (user, matter, device): re-preparing replaces.
    const existing = await ctx.db
      .query("offlineBundles")
      .withIndex("by_user", (q) => q.eq("userId", ac.user._id))
      .collect();
    const prior = existing.find(
      (b) =>
        b.matterId === args.matterId &&
        b.deviceId === deviceIdOf(ac.user._id) &&
        !b.removedAt,
    );
    if (prior) {
      await ctx.db.delete(prior._id);
    }

    const now = Date.now();
    const id = await ctx.db.insert("offlineBundles", {
      orgId: ac.org._id,
      matterId: args.matterId,
      userId: ac.user._id,
      deviceId: deviceIdOf(ac.user._id),
      deviceLabel: args.deviceLabel.trim().slice(0, 80) || "This device",
      selection: {
        hearingId: args.hearingId,
        sectionIds: args.sectionIds.slice(0, 12),
        includeNotes: args.includeNotes,
        documentIds: args.documentIds.slice(0, MAX_DOCUMENTS),
      },
      fingerprint,
      preparedAt: now,
      syncedAt: now,
    });

    return {
      bundleId: id,
      fingerprint,
      preparedAt: now,
      expiresAt: now + BUNDLE_TTL_MS,
      payload,
    };
  },
});

// ---------------------------------------------------------------------
// Sync: verify the device copy, detect conflicts, return fresh payload
// ---------------------------------------------------------------------

export const sync = mutation({
  args: {
    bundleId: v.id("offlineBundles"),
    deviceFingerprint: v.string(),
    queuedNotes: v.array(
      v.object({
        id: v.string(),
        body: v.string(),
        queuedAt: v.number(),
        baseSyncedAt: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const bundle = await ctx.db.get(args.bundleId);
    if (!bundle || bundle.userId !== ac.user._id) {
      throw new Error("Bundle not found.");
    }
    if (bundle.removedAt) throw new Error("This bundle was removed.");
    if (Date.now() > bundle.preparedAt + BUNDLE_TTL_MS) {
      await ctx.db.patch(bundle._id, { removedAt: Date.now() });
      throw new Error(
        "This offline pack expired. Remove the local copy and prepare a fresh one before court.",
      );
    }
    if (bundle.revokedAt) {
      // Honest revocation: takes effect at next sync, never instantly.
      await ctx.db.patch(bundle._id, { removedAt: Date.now() });
      throw new Error(
        "The chamber marked this pack revoked while you were offline. The local copy must now be deleted from your device.",
      );
    }

    const conflicts: string[] = [];
    if (args.deviceFingerprint !== bundle.fingerprint) {
      conflicts.push(
        "The device copy does not match the pack the server last issued.",
      );
    }
    const matterNow = await ctx.db.get(bundle.matterId);
    if (!matterNow || matterNow.orgId !== bundle.orgId) {
      conflicts.push("The matter could not be found.");
    } else {
      // Conflict detection on reconnect: rebuild the payload from live,
      // access-enforced data and compare fingerprints.
      const fresh = await buildPayload(ctx, ac, {
        matterId: bundle.matterId,
        hearingId: bundle.selection.hearingId,
        sectionIds: bundle.selection.sectionIds,
        includeNotes: bundle.selection.includeNotes,
        documentIds: bundle.selection.documentIds,
      });
      const freshFingerprint = sha256Hex(JSON.stringify(fresh));
      if (freshFingerprint !== bundle.fingerprint) {
        conflicts.push(
          "The matter file has new activity since this pack was prepared.",
        );
      }
      if (!conflicts.length) {
        await ctx.db.patch(bundle._id, { fingerprint: freshFingerprint });
      }
    }

    // Permitted note updates queued on the device while offline.
    const queued = (bundle.queuedNotes ?? []).filter(
      (n) => n.status === "pending" || n.status === "conflict",
    );
    for (const note of args.queuedNotes.slice(0, MAX_QUEUED_NOTES)) {
      if (queued.some((q) => q.id === note.id)) continue;
      if (note.body.trim().length === 0) continue;
      queued.push({
        id: note.id,
        body: note.body.slice(0, MAX_NOTE_CHARS),
        queuedAt: note.queuedAt,
        baseSyncedAt: note.baseSyncedAt,
        status: conflicts.length > 0 ? "conflict" : "pending",
        conflictReason:
          conflicts.length > 0 ? conflicts.join(" ") : undefined,
      });
    }

    await ctx.db.patch(bundle._id, {
      syncedAt: Date.now(),
      queuedNotes: queued,
    });

    return {
      conflicts,
      bundleId: bundle._id,
      syncedAt: Date.now(),
    };
  },
});

// ---------------------------------------------------------------------
// Queue a note while offline (client-side queue drains here on
// reconnect; also usable directly from the offline UI).
// ---------------------------------------------------------------------

export const queueNote = mutation({
  args: {
    bundleId: v.id("offlineBundles"),
    noteId: v.string(),
    body: v.string(),
    baseSyncedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const ac = await requireWriteAccess(ctx);
    const bundle = await ctx.db.get(args.bundleId);
    if (!bundle || bundle.userId !== ac.user._id) {
      throw new Error("Bundle not found.");
    }
    if (Date.now() > bundle.preparedAt + BUNDLE_TTL_MS) {
      throw new Error(
        "This offline pack has expired; notes can no longer be queued.",
      );
    }
    const queued = bundle.queuedNotes ?? [];
    if (queued.length >= MAX_QUEUED_NOTES) {
      throw new Error("Too many queued notes; sync to clear the queue.");
    }
    queued.push({
      id: args.noteId,
      body: args.body.slice(0, MAX_NOTE_CHARS),
      queuedAt: Date.now(),
      baseSyncedAt: args.baseSyncedAt,
      status: "pending",
    });
    await ctx.db.patch(bundle._id, { queuedNotes: queued });
  },
});

// ---------------------------------------------------------------------
// Conflict resolution: the lawyer reviews each queued note and chooses.
// Applied notes become real matter notes; dropped ones stay in the
// bundle's audit trail as "dropped".
// ---------------------------------------------------------------------

export const resolveNote = mutation({
  args: {
    bundleId: v.id("offlineBundles"),
    noteId: v.string(),
    action: v.union(v.literal("apply"), v.literal("drop")),
  },
  handler: async (ctx, args) => {
    const ac = await requireWriteAccess(ctx);
    if (!can(ac, "note.write")) {
      throw new Error("You need note-writing permission to apply offline notes.");
    }
    const bundle = await ctx.db.get(args.bundleId);
    if (!bundle || bundle.userId !== ac.user._id) {
      throw new Error("Bundle not found.");
    }
    const matter = await requireMatter(ctx, ac, bundle.matterId);
    const queued = [...(bundle.queuedNotes ?? [])];
    const idx = queued.findIndex((n) => n.id === args.noteId);
    if (idx === -1) throw new Error("Queued note not found.");
    const note = queued[idx]!;
    if (note.status === "applied") {
      throw new Error("This note was already applied.");
    }
    if (args.action === "drop") {
      queued[idx] = { ...note, status: "applied", conflictReason: "dropped" };
      await ctx.db.patch(bundle._id, { queuedNotes: queued });
      return { applied: false };
    }
    await ctx.db.insert("matterNotes", {
      matterId: matter._id,
      authorId: ac.user._id,
      body: note.body,
      fromClient: false,
      createdAt: Date.now(),
    });
    queued[idx] = { ...note, status: "applied" };
    await ctx.db.patch(bundle._id, { queuedNotes: queued });
    return { applied: true };
  },
});

// ---------------------------------------------------------------------
// Listing, revocation and removal
// ---------------------------------------------------------------------

/** The caller's offline bundles across devices, newest first. */
export const myBundles = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    const rows = await ctx.db
      .query("offlineBundles")
      .withIndex("by_user", (q) => q.eq("userId", ac.user._id))
      .collect();
    const matterNames = new Map<Id<"matters">, string>();
    for (const r of rows) {
      if (!matterNames.has(r.matterId)) {
        const m = await ctx.db.get(r.matterId);
        matterNames.set(r.matterId, m ? `${m.reference} — ${m.title}` : "(matter)");
      }
    }
    return rows
      .sort((a, b) => b.preparedAt - a.preparedAt)
      .map((r) => ({
        _id: r._id,
        matterId: r.matterId,
        matterLabel: matterNames.get(r.matterId) ?? "(matter)",
        deviceLabel: r.deviceLabel,
        preparedAt: r.preparedAt,
        syncedAt: r.syncedAt,
        expiresAt: r.preparedAt + BUNDLE_TTL_MS,
        revokedAt: r.revokedAt ?? null,
        removedAt: r.removedAt ?? null,
        selection: {
          includeNotes: r.selection.includeNotes,
          documentCount: r.selection.documentIds.length,
          sectionCount: r.selection.sectionIds.length,
        },
        queuedNotes: (r.queuedNotes ?? []).map((n) => ({
          id: n.id,
          body: n.body,
          queuedAt: n.queuedAt,
          status: n.status,
          conflictReason: n.conflictReason ?? null,
        })),
      }));
  },
});

/**
 * Mark a bundle revoked (owner/partner or the owning member). The copy
 * on a currently-offline device is NOT deleted remotely — that is
 * impossible to guarantee and the UI says so. Revocation takes effect
 * at the next sync and blocks further ones.
 */
export const revoke = mutation({
  args: { bundleId: v.id("offlineBundles"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ac = await requireWriteAccess(ctx);
    const bundle = await ctx.db.get(args.bundleId);
    if (!bundle || bundle.orgId !== ac.org._id) {
      throw new Error("Bundle not found.");
    }
    const isSelf = bundle.userId === ac.user._id;
    const isManager = can(ac, "team.manage");
    if (!isSelf && !isManager) {
      throw new Error("Only the member or a team manager can revoke a pack.");
    }
    if (bundle.revokedAt) return;
    await ctx.db.patch(bundle._id, {
      revokedAt: Date.now(),
      revokedById: ac.user._id,
    });
  },
});

/** Remove a bundle record once the device copy has been deleted. */
export const remove = mutation({
  args: { bundleId: v.id("offlineBundles") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const bundle = await ctx.db.get(args.bundleId);
    if (!bundle || bundle.userId !== ac.user._id) {
      throw new Error("Bundle not found.");
    }
    await ctx.db.patch(bundle._id, { removedAt: Date.now() });
  },
});

/** A note the device can render while fully offline (for re-download). */
export const payloadFor = query({
  args: { bundleId: v.id("offlineBundles") },
  handler: async (ctx, args): Promise<OfflinePayload | null> => {
    const ac = await requireAccess(ctx);
    const bundle = await ctx.db.get(args.bundleId);
    if (!bundle || bundle.userId !== ac.user._id) return null;
    if (bundle.revokedAt || bundle.removedAt) return null;
    const matter = await matterOrNull(ctx, ac, bundle.matterId);
    if (!matter) return null; // lost access: nothing more is served
    return await buildPayload(ctx, ac, {
      matterId: bundle.matterId,
      hearingId: bundle.selection.hearingId,
      sectionIds: bundle.selection.sectionIds,
      includeNotes: bundle.selection.includeNotes,
      documentIds: bundle.selection.documentIds,
    });
  },
});

// Keep the Doc import used (type surface for future storage payloads).
export type OfflineDoc = Doc<"offlineBundles">;
