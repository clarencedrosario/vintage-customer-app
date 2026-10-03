import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import {
  can,
  canViewMatter,
  getAccessContext,
  isUserWalledFromMatter,
  requireAccess,
  requireMatter,
} from "./access";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { sha256Hex } from "./crypto";
import {
  assembleUpdateBody,
  canonicalSetInput,
  describeProblems,
  duplicateSendDecision,
  MAX_DEVELOPMENTS,
  reverifyProvenance,
  type DevelopmentSnapshot,
} from "../lib/clientUpdates";

// =====================================================================
// §32 PHASE 10 — CLIENT-UPDATE DRAFTS (turn 22).
//
// A drafting workspace between the approved chronology and the client
// communication outbox. What it is NOT: a free-text broadcaster, and
// not a replacement for the outbox — it QUEUES THROUGH the outbox
// (compose → queue → delivery), inheriting its approval-policy and
// delivery machinery.
//
// Hard rules encoded here:
//  - APPROVED-DEVELOPMENTS-ONLY: the body is assembled exclusively
//    from matter-timeline entries whose status is "approved" at draft
//    time, each carrying its provenance (refKey + digest). Nothing
//    else can enter the body.
//  - RECIPIENT PERMISSION DISPLAY: the pre-send review shows exactly
//    who would receive the update and their honest permission state
//    (portal account linked? client-updates preference recorded?
//    WhatsApp opt-in?). Absent preferences are shown as absent —
//    never treated as silent consent for gated channels.
//  - SEND-TIME RE-VERIFICATION: queueing re-derives every
//    development's CURRENT digest + approval. Missing, downgraded
//    (needs_review/rejected) or changed developments BLOCK the send
//    with a precise problem list; the draft must be regenerated.
//  - DUPLICATE-SEND PREVENTION via the existing machinery: the same
//    development set cannot be queued twice (sent-draft ledger keyed
//    by developmentSetKey), and a draft already on the outbox's
//    delivery path is refused again — the outbox's own status guards
//    remain the delivery-side backstop.
//  - Walls: the client thread and every read go through matter access
//    + wall checks like everywhere else.
// =====================================================================

/** Live digest of a timeline entry — change detection, not security. */
function entryDigest(e: Doc<"matterTimeline">): string {
  return sha256Hex(
    `${e.entryKind}:${e.title}:${e.date}:${e.detail ?? ""}:${e.status}`,
  );
}

/** The matter's client thread (creates nothing; null when absent). */
async function clientThread(
  ctx: QueryCtx | MutationCtx,
  matterId: Id<"matters">,
) {
  const rows = await ctx.db
    .query("conversations")
    .withIndex("by_matter", (q) => q.eq("matterId", matterId))
    .collect();
  return (
    rows.filter((c) => c.scope === "matter" && !c.archivedAt).sort(
      (a, b) => b.createdAt - a.createdAt,
    )[0] ?? null
  );
}

async function loadDraft(
  ctx: MutationCtx,
  ac: { org: { _id: Id<"organizations"> } },
  draftId: Id<"clientUpdateDrafts">,
): Promise<Doc<"clientUpdateDrafts">> {
  const row = await ctx.db.get(draftId);
  if (!row || row.orgId !== ac.org._id) {
    throw new Error("Draft not found in this organization.");
  }
  return row;
}

// ---------------------------------------------------------------------
// Approved developments (the only lawful draft input)
// ---------------------------------------------------------------------

/** APPROVED timeline entries only, each with its live digest. */
export const listDevelopments = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.orgId !== ac.org._id) return [];
    if (!canViewMatter(ac, matter)) return [];
    if (await isUserWalledFromMatter(ctx, ac, matter)) return [];
    const rows = await ctx.db
      .query("matterTimeline")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    return rows
      .filter((r) => r.orgId === ac.org._id && r.status === "approved")
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => ({
        refKey: String(e._id),
        entryKind: e.entryKind,
        title: e.title,
        detail: e.detail ?? null,
        date: e.date,
        datePrecision: e.datePrecision,
        digest: entryDigest(e),
      }));
  },
});

// ---------------------------------------------------------------------
// Draft preparation / approval / cancellation
// ---------------------------------------------------------------------

export const prepareDraft = mutation({
  args: {
    matterId: v.id("matters"),
    developmentIds: v.array(v.id("matterTimeline")),
    subject: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "note.write")) {
      throw new Error("Your role is not permitted to prepare client updates.");
    }
    const matter = await requireMatter(ctx, ac, args.matterId);
    const ids = [...new Set(args.developmentIds.map(String))];
    if (ids.length === 0) {
      throw new Error("Select at least one approved development.");
    }
    if (ids.length > MAX_DEVELOPMENTS) {
      throw new Error(`A client update may draw on at most ${MAX_DEVELOPMENTS} developments.`);
    }
    const snapshots: DevelopmentSnapshot[] = [];
    const provenance: { refKey: string; title: string; digest: string }[] = [];
    for (const id of ids) {
      const e = await ctx.db.get(id as Id<"matterTimeline">);
      if (!e || e.orgId !== ac.org._id || e.matterId !== args.matterId) {
        throw new Error("One of the selected developments does not belong to this matter.");
      }
      if (e.status !== "approved") {
        throw new Error(
          `"${e.title}" is not an approved development (status: ${e.status}) — client updates may draw only on approved developments.`,
        );
      }
      snapshots.push({
        refKey: String(e._id),
        entryKind: e.entryKind,
        title: e.title,
        date: e.date,
        detail: e.detail ?? undefined,
      });
      provenance.push({ refKey: String(e._id), title: e.title, digest: entryDigest(e) });
    }
    const body = assembleUpdateBody(matter.reference, snapshots);
    const setKey = sha256Hex(canonicalSetInput(provenance.map((p) => p.digest)));
    const actorName = ac.user.name || ac.user.email || "Member";
    const draftId = await ctx.db.insert("clientUpdateDrafts", {
      orgId: ac.org._id,
      matterId: args.matterId,
      subject: (args.subject?.trim() || `Matter update — ${matter.reference}`).slice(0, 240),
      body,
      developmentIds: ids.map((i) => i as Id<"matterTimeline">),
      provenance,
      developmentSetKey: setKey,
      status: "draft",
      createdById: ac.user._id,
      createdByName: actorName,
      createdAt: Date.now(),
    });
    return { draftId, body };
  },
});

export const approveDraft = mutation({
  args: { draftId: v.id("clientUpdateDrafts") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "matter.edit")) {
      throw new Error("Only approvers (matter edit) may approve client-update drafts.");
    }
    const draft = await loadDraft(ctx, ac, args.draftId);
    await requireMatter(ctx, ac, draft.matterId);
    if (draft.status === "sent") {
      throw new Error("This draft was already sent — prepare a new one.");
    }
    if (draft.status === "cancelled") {
      throw new Error("This draft was cancelled — prepare a new one.");
    }
    const actorName = ac.user.name || ac.user.email || "Member";
    await ctx.db.patch(args.draftId, {
      status: "approved",
      approvedById: ac.user._id,
      approvedByName: actorName,
      approvedAt: Date.now(),
    });
    return { approved: true as const };
  },
});

export const cancelDraft = mutation({
  args: { draftId: v.id("clientUpdateDrafts") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "note.write")) {
      throw new Error("Your role is not permitted to cancel client updates.");
    }
    const draft = await loadDraft(ctx, ac, args.draftId);
    await requireMatter(ctx, ac, draft.matterId);
    if (draft.status === "sent") {
      throw new Error("A sent update cannot be cancelled — record a correction as a new draft.");
    }
    await ctx.db.patch(args.draftId, { status: "cancelled" });
    return { cancelled: true as const };
  },
});

// ---------------------------------------------------------------------
// Pre-send review: provenance state + recipient permissions + duplicates
// ---------------------------------------------------------------------

export const draftReview = query({
  args: { draftId: v.id("clientUpdateDrafts") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.orgId !== ac.org._id) return null;
    const matter = await ctx.db.get(draft.matterId);
    if (!matter || !canViewMatter(ac, matter)) return null;
    if (await isUserWalledFromMatter(ctx, ac, matter)) return null;

    // LIVE re-verification preview — the same check queueForSend runs.
    const current = new Map<string, { digest: string; approved: boolean } | null>();
    for (const item of draft.provenance) {
      const e = await ctx.db.get(item.refKey as Id<"matterTimeline">);
      current.set(
        item.refKey,
        e && e.orgId === ac.org._id
          ? { digest: entryDigest(e), approved: e.status === "approved" }
          : null,
      );
    }
    const problems = reverifyProvenance(draft.provenance, current);

    // Recipient permission display (honest states, no silent consent).
    const client = matter.clientId ? await ctx.db.get(matter.clientId) : null;
    const clientUserId = client?.userId ?? undefined;
    const prefs = clientUserId
      ? (await ctx.db
          .query("commPreferences")
          .withIndex("by_org_user", (q) => q.eq("orgId", ac.org._id).eq("userId", clientUserId))
          .first()) ?? null
      : null;
    const thread = await clientThread(ctx, draft.matterId);
    const recipients = [
      {
        role: "client_primary" as const,
        clientName: client?.name ?? "Client",
        userId: clientUserId ?? null,
        hasPortalAccount: !!clientUserId,
        email: client?.email ?? null,
        // null = never recorded — shown as absent, never treated as yes.
        clientUpdatesPreference: prefs ? prefs.clientUpdates : null,
        whatsappOptIn: prefs ? prefs.whatsappEnabled : null,
        clientThreadExists: !!thread,
      },
    ];

    // Duplicate warning against the sent-draft ledger + outbox link.
    const priorSameSet = await ctx.db
      .query("clientUpdateDrafts")
      .withIndex("by_matter_set", (q) =>
        q.eq("matterId", draft.matterId).eq("developmentSetKey", draft.developmentSetKey),
      )
      .collect()
      .then((rows) =>
        rows.filter(
          (r) =>
            r.orgId === ac.org._id &&
            r._id !== draft._id &&
            r.status === "sent" &&
            !!r.sentAt,
        ),
      );
    let outboxStatus: string | null = null;
    if (draft.outboxId) {
      const outbox = await ctx.db.get(draft.outboxId);
      outboxStatus = outbox?.status ?? null;
    }
    const duplicate = duplicateSendDecision({
      priorSentSetKeyAt: priorSameSet[0]?.sentAt ?? null,
      outboxStatus,
    });

    return {
      draft: {
        draftId: draft._id,
        subject: draft.subject,
        body: draft.body,
        status: draft.status,
        createdByName: draft.createdByName,
        createdAt: draft.createdAt,
        approvedByName: draft.approvedByName ?? null,
        approvedAt: draft.approvedAt ?? null,
        outboxId: draft.outboxId ?? null,
      },
      provenanceCount: draft.provenance.length,
      provenanceState: {
        ok: problems.length === 0,
        problems,
        message:
          problems.length === 0
            ? "All provenance developments are still approved and unchanged."
            : describeProblems(problems),
      },
      recipients,
      duplicate: {
        blocked: !duplicate.ok,
        reason: duplicate.ok ? null : duplicate.reason,
      },
    };
  },
});

// ---------------------------------------------------------------------
// Queue through the EXISTING comm outbox (send-time gates)
// ---------------------------------------------------------------------

export const queueForSend = mutation({
  args: { draftId: v.id("clientUpdateDrafts") },
  handler: async (
    ctx,
    args,
  ): Promise<{ outboxId: Id<"commOutbox">; conversationId: Id<"conversations"> }> => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "note.write")) {
      throw new Error("Your role is not permitted to send client updates.");
    }
    const draft = await loadDraft(ctx, ac, args.draftId);
    const matter = await requireMatter(ctx, ac, draft.matterId);

    if (draft.status === "draft") {
      throw new Error("Approve the draft before sending (approver: matter edit).");
    }
    if (draft.status === "cancelled") {
      throw new Error("This draft was cancelled — prepare a new one.");
    }
    if (draft.status === "sent") {
      throw new Error("This draft was already sent.");
    }

    // SEND-TIME RE-VERIFICATION: every development must still exist, be
    // approved, and be byte-identical to what the draft froze.
    const current = new Map<string, { digest: string; approved: boolean } | null>();
    for (const item of draft.provenance) {
      const e = await ctx.db.get(item.refKey as Id<"matterTimeline">);
      current.set(
        item.refKey,
        e && e.orgId === ac.org._id
          ? { digest: entryDigest(e), approved: e.status === "approved" }
          : null,
      );
    }
    const problems = reverifyProvenance(draft.provenance, current);
    if (problems.length > 0) {
      throw new Error(describeProblems(problems));
    }

    // DUPLICATE-SEND PREVENTION (send ledger + outbox states).
    const priorSameSet = await ctx.db
      .query("clientUpdateDrafts")
      .withIndex("by_matter_set", (q) =>
        q.eq("matterId", draft.matterId).eq("developmentSetKey", draft.developmentSetKey),
      )
      .collect()
      .then((rows) =>
        rows.filter(
          (r) =>
            r.orgId === ac.org._id &&
            r._id !== draft._id &&
            r.status === "sent" &&
            !!r.sentAt,
        ),
      );
    let outboxStatus: string | null = null;
    if (draft.outboxId) {
      const outbox = await ctx.db.get(draft.outboxId);
      outboxStatus = outbox?.status ?? null;
    }
    const duplicate = duplicateSendDecision({
      priorSentSetKeyAt: priorSameSet[0]?.sentAt ?? null,
      outboxStatus,
    });
    if (!duplicate.ok) throw new Error(duplicate.reason);

    // Ensure the client thread exists (existing conversations machinery).
    let thread: Doc<"conversations"> | null = await clientThread(ctx, draft.matterId);
    if (!thread) {
      const created: { conversationId: Id<"conversations"> } = await ctx.runMutation(
        api.conversations.createConversation,
        {
          matterId: draft.matterId,
          scope: "matter" as const,
          subject: `${matter.reference} — client thread`,
          memberIds: matter.leadLawyerId ? [matter.leadLawyerId] : undefined,
          includeClient: true,
        },
      );
      thread = await ctx.db.get(created.conversationId);
    }
    if (!thread) throw new Error("Could not open the client thread.");

    // QUEUE THROUGH THE EXISTING OUTBOX: compose in the matter_update
    // category (which keeps the outbox's own approval policy), approve
    // the exact version through the outbox's own mutation (its
    // capability gate applies — the substantive draft approval already
    // happened on the draft itself), link the client thread, queue.
    const client = matter.clientId ? await ctx.db.get(matter.clientId) : null;
    const { outboxId } = await ctx.runMutation(api.commOutbox.compose, {
      matterId: draft.matterId,
      clientId: matter.clientId,
      category: "matter_update",
      channel: "in_thread" as const,
      recipientUserId: client?.userId ?? undefined,
      subject: draft.subject,
      body: draft.body,
      sourceKind: "client_update_draft",
      sourceId: String(draft._id),
      sourceLabel: draft.subject,
    });
    const outboxRow = await ctx.db.get(outboxId);
    if (outboxRow?.requiresApproval && outboxRow.status === "pending_approval") {
      await ctx.runMutation(api.commOutbox.approve, {
        outboxId,
        note: `Queued from approved client-update draft; draft approved by ${draft.approvedByName ?? "approver"}.`,
      });
    }
    await ctx.db.patch(outboxId, { conversationId: thread._id, updatedAt: Date.now() });
    await ctx.runMutation(api.commOutbox.queue, { outboxId });

    const now = Date.now();
    await ctx.db.patch(draft._id, {
      status: "sent",
      outboxId,
      queuedById: ac.user._id,
      queuedAt: now,
      sentAt: now,
    });
    return { outboxId, conversationId: thread._id };
  },
});

/** Draft list for the matter (with the standing disclosure). */
export const listDrafts = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return { disclosure: "", drafts: [] };
    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.orgId !== ac.org._id) return { disclosure: "", drafts: [] };
    if (!canViewMatter(ac, matter)) return { disclosure: "", drafts: [] };
    if (await isUserWalledFromMatter(ctx, ac, matter)) return { disclosure: "", drafts: [] };
    const rows = await ctx.db
      .query("clientUpdateDrafts")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    return {
      disclosure:
        "Client updates are assembled only from approved developments, re-verified at send time, and queued through the communication outbox.",
      drafts: rows
        .filter((r) => r.orgId === ac.org._id)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((d) => ({
          draftId: d._id,
          subject: d.subject,
          status: d.status,
          developmentCount: d.provenance.length,
          createdByName: d.createdByName,
          createdAt: d.createdAt,
          approvedByName: d.approvedByName ?? null,
          outboxId: d.outboxId ?? null,
        })),
    };
  },
});
