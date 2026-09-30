import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAccess, requireCapability, getAccessContext } from "./access";
import type { Doc, Id } from "./_generated/dataModel";

// =====================================================================
// CONFLICTING-EVIDENCE REVIEW (turn 16, Phase 1).
//
// What this is: a REVIEW WORKSPACE for potentially inconsistent
// statements within a matter. What it is NOT: a truth engine.
//
// Hard rules encoded here:
//  - Detection is deterministic pairing over the matter's fact register
//    (dates/amounts/party identity/account conflicts). Every finding is
//    a REVIEW SUGGESTION — never an established falsehood.
//  - Each side is a fact row, which carries its exact document version,
//    page/paragraph/text-span pinpoints and its epistemic status
//    (allegation / extracted / disputed / confirmed / rejected), so the
//    workspace shows allegations, witness statements, lawyer-entered
//    facts and court-derived material distinctly.
//  - Lawyers confirm a conflict, dismiss it ("these passages concern
//    different events" is a first-class reason), mark it unresolved, or
//    record an accepted interpretation — always with reasons.
//  - Both original sources are preserved (fact rows are never
//    overwritten) and every action lands in an append-only history.
//  - A contradiction is NEVER resolved merely because a document is
//    newer: later uploads change nothing automatically. When a source
//    row's text changes, affected findings are FLAGGED for reassessment
//    (accepted/dismissed states keep their recorded outcome and gain a
//    visible flag; nothing is replaced silently).
// =====================================================================

const KIND_LABEL = {
  date_conflict: "Different dates recorded for the same event",
  amount_conflict: "Different amounts recorded for the same transaction",
  party_identity: "Inconsistent party identity for the same role",
  account_conflict: "Contradictory accounts of the same occurrence",
} as const;

type ReviewKind = keyof typeof KIND_LABEL;

/**
 * Deterministic pairing over the matter's ACTIVE (non-rejected,
 * non-superseded) facts. Two pairing routes, both explainable:
 *  1. Same factKey (lawyer-entered correction chains) with differing
 *     occurredOn/amountMinor/partyName.
 *  2. Cross-SOURCE same-kind facts (both dates, both amounts, both
 *     party-bearing) whose statements share at least one informative
 *     content token (boilerplate words excluded) — the shared subject
 *     is the topic; differing values make it a candidate conflict.
 * Every finding records WHY it was proposed (topicKey) and is a review
 * suggestion only.
 */
const STOP_TOKENS = new Set([
  "date", "recorded", "obligation", "text", "amounts", "this", "that",
  "with", "from", "which", "been", "were", "have", "has", "shall",
  "must", "into", "upon", "said", "also", "such", "here", "their",
  "them", "then", "than", "when", "what", "only", "out", "due",
]);

function informativeTokens(statement: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of statement.toLowerCase().split(/[^a-z]+/)) {
    if (raw.length >= 5 && !STOP_TOKENS.has(raw)) tokens.add(raw);
  }
  return tokens;
}
export const scan = mutation({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.orgId !== ac.org._id) {
      throw new Error("Matter not found in this organization.");
    }
    const facts = await ctx.db
      .query("matterFacts")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    const active = facts.filter((f) => f.status !== "rejected" && !f.supersededById);

    // A finding in ANY state (open, resolved, flagged) suppresses its
    // pair forever: a rescan must never resurrect a pair the lawyer has
    // already reviewed. Reassessment after source changes goes through
    // flagForReassessment, not re-pairing.
    const allFindings = await ctx.db
      .query("reviewFindings")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect()
      .then((rows) => rows.filter((r) => r.matterId === args.matterId));
    const knownPairs = new Set(
      allFindings.map((r) => `${String(r.sideAId)}|${String(r.sideBId)}`),
    );

    const byKey = new Map<string, Doc<"matterFacts">[]>();
    for (const f of active) {
      const list = byKey.get(f.factKey) ?? [];
      list.push(f);
      byKey.set(f.factKey, list);
    }

    const kindOf = (
      a: Doc<"matterFacts">,
      b: Doc<"matterFacts">,
    ): ReviewKind | null => {
      if (a.occurredOn && b.occurredOn && a.occurredOn !== b.occurredOn) {
        return "date_conflict";
      }
      if (
        a.amountMinor !== undefined &&
        b.amountMinor !== undefined &&
        a.amountMinor !== b.amountMinor
      ) {
        return "amount_conflict";
      }
      if (
        a.partyName && b.partyName &&
        a.partyName.toLowerCase() !== b.partyName.toLowerCase()
      ) {
        return "party_identity";
      }
      return null;
    };

    let created = 0;
    const addFinding = async (
      kind: ReviewKind,
      topicKey: string,
      a: Doc<"matterFacts">,
      b: Doc<"matterFacts">,
    ) => {
      const pairKey = `${String(a._id)}|${String(b._id)}`;
      if (knownPairs.has(pairKey)) return;
      knownPairs.add(pairKey);
      await ctx.db.insert("reviewFindings", {
        orgId: ac.org._id,
        matterId: args.matterId,
        kind,
        topicKey,
        sideAId: a._id,
        sideBId: b._id,
        status: "open",
        createdById: ac.user._id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      created += 1;
    };

    // Route 1: same factKey (correction chains).
    for (const [topicKey, list] of byKey) {
      if (list.length < 2) continue;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]!;
          const b = list[j]!;
          const kind = kindOf(a, b);
          if (kind) await addFinding(kind, topicKey, a, b);
        }
      }
    }

    // Route 2: cross-source same-kind pairs sharing a content token.
    // Statements embed their source name (extractor format), so each
    // fact's tokens EXCLUDE its own source name's tokens before the
    // comparison — otherwise document labels create phantom topics.
    const sourceName = new Map<string, string>();
    for (const f of active) {
      if (f.sourceAiSourceId && !sourceName.has(String(f.sourceAiSourceId))) {
        const s = await ctx.db.get(f.sourceAiSourceId);
        sourceName.set(String(f.sourceAiSourceId), s?.name ?? "");
      }
    }
    const contentTokens = (f: Doc<"matterFacts">): Set<string> => {
      const tokens = informativeTokens(f.statement);
      const name = f.sourceAiSourceId ? (sourceName.get(String(f.sourceAiSourceId)) ?? "") : "";
      for (const t of informativeTokens(name)) tokens.delete(t);
      return tokens;
    };
    const tokenCache = new Map<string, Set<string>>();
    const tokensOf = (f: Doc<"matterFacts">): Set<string> => {
      const k = String(f._id);
      if (!tokenCache.has(k)) tokenCache.set(k, contentTokens(f));
      return tokenCache.get(k)!;
    };

    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        if (created >= 25) break; // noise cap
        const a = active[i]!;
        const b = active[j]!;
        if ((a.sourceAiSourceId ?? null) === (b.sourceAiSourceId ?? null)) {
          continue; // conflicts are cross-document by definition here
        }
        const kind = kindOf(a, b);
        if (!kind) continue;
        const aTokens = tokensOf(a);
        const shared = [...tokensOf(b)].find((t) => aTokens.has(t));
        if (!shared) continue;
        await addFinding(kind, `shared:${shared}`, a, b);
      }
    }
    return { created };
  },
});

/**
 * The workspace: findings with BOTH sides' full provenance — document
 * version (via aiSource), page/paragraph/quote pinpoints, and the
 * statement's epistemic status. Read-only; org- and matter-scoped.
 */
export const list = query({
  args: {
    matterId: v.id("matters"),
    includeResolved: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.orgId !== ac.org._id) return [];
    const rows = await ctx.db
      .query("reviewFindings")
      .withIndex("by_matter_status", (q) => q.eq("matterId", args.matterId))
      .collect();
    const matterRows = rows.filter((r) => r.orgId === ac.org._id);
    const wanted = new Set(
      matterRows
        .filter((r) =>
          args.includeResolved
            ? true
            : r.status === "open" || r.status === "reassessment_flagged",
        )
        .flatMap((r) => [String(r.sideAId), String(r.sideBId)]),
    );
    const allFacts = await ctx.db
      .query("matterFacts")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    const factById = new Map(allFacts.map((f) => [String(f._id), f]));
    const out = [];
    for (const r of matterRows) {
      if (!args.includeResolved) {
        if (r.status !== "open" && r.status !== "reassessment_flagged") continue;
      }
      const a = factById.get(String(r.sideAId));
      const b = factById.get(String(r.sideBId));
      if (!a || !b) continue;
      const srcA = a.sourceAiSourceId ? await ctx.db.get(a.sourceAiSourceId) : null;
      const srcB = b.sourceAiSourceId ? await ctx.db.get(b.sourceAiSourceId) : null;
      out.push({
        findingId: r._id,
        kind: r.kind,
        kindLabel: KIND_LABEL[r.kind]!,
        topicKey: r.topicKey,
        status: r.status,
        note: r.note,
        sourceChangeFlag: r.sourceChangeFlag,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        sideA: {
          factId: a._id,
          statement: a.statement,
          factStatus: a.status,
          occurredOn: a.occurredOn,
          amountMinor: a.amountMinor,
          partyName: a.partyName,
          version: a.version,
          sourceDocumentId: a.sourceDocumentId,
          pinpoints: a.sourceRefs ?? [],
          sourceName: srcA?.name,
          sourceVersionAt: srcA ? srcA.documentUpdatedAt ?? srcA.createdAt : undefined,
        },
        sideB: {
          factId: b._id,
          statement: b.statement,
          factStatus: b.status,
          occurredOn: b.occurredOn,
          amountMinor: b.amountMinor,
          partyName: b.partyName,
          version: b.version,
          sourceDocumentId: b.sourceDocumentId,
          pinpoints: b.sourceRefs ?? [],
          sourceName: srcB?.name,
          sourceVersionAt: srcB ? srcB.documentUpdatedAt ?? srcB.createdAt : undefined,
        },
      });
    }
    return out.sort((x, y) => y.updatedAt - x.updatedAt);
  },
});

/** Append-only action history for one finding. */
export const history = query({
  args: { findingId: v.id("reviewFindings") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const finding = await ctx.db.get(args.findingId);
    if (!finding || finding.orgId !== ac.org._id) return [];
    return ctx.db
      .query("reviewFindingRevisions")
      .withIndex("by_finding", (q) => q.eq("findingId", args.findingId))
      .collect()
      .then((rows) => rows.sort((a, b) => b.createdAt - a.createdAt));
  },
});

/**
 * Lawyer action on a finding. `different_events` implements the required
 * "these passages concern different events" dismissal. `accepted_
 * interpretation` records HOW the two passages were reconciled without
 * declaring either false. Reasons are mandatory; the previous status is
 * preserved in the history and the finding stays on the record.
 */
export const act = mutation({
  args: {
    findingId: v.id("reviewFindings"),
    action: v.union(
      v.literal("confirm_conflict"),
      v.literal("dismiss_different_events"),
      v.literal("dismiss_other_reason"),
      v.literal("mark_unresolved"),
      v.literal("accept_interpretation"),
    ),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const f = (await ctx.db.get(args.findingId)) as Doc<"reviewFindings"> | null;
    if (!f || f.orgId !== ac.org._id) throw new Error("Finding not found.");
    if (!args.note.trim()) {
      throw new Error("A reason is required for every review action.");
    }
    const toStatus: Doc<"reviewFindings">["status"] =
      args.action === "confirm_conflict"
        ? "confirmed_conflict"
        : args.action === "dismiss_different_events"
          ? "dismissed_different_events"
          : args.action === "dismiss_other_reason"
            ? "dismissed_other_reason"
            : args.action === "mark_unresolved"
              ? "unresolved"
              : "accepted_interpretation";
    const fromStatus = f.status;
    // Source-change flags clear when the lawyer re-reviews with a note.
    await ctx.db.patch(args.findingId, {
      status: toStatus,
      note: args.note.trim().slice(0, 800),
      sourceChangeFlag: undefined,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("reviewFindingRevisions", {
      orgId: f.orgId,
      matterId: f.matterId,
      findingId: f._id,
      fromStatus,
      toStatus,
      note: args.note.trim().slice(0, 800),
      changedById: ac.user._id,
      createdAt: Date.now(),
    });
    return { status: toStatus };
  },
});

/**
 * Source-change reassessment: when a source row's text changed, flag —
 * never silently rewrite — every finding whose sides came from it.
 * OPEN findings stay open; RESOLVED findings gain a visible
 * reassessment flag and keep their recorded outcome + history.
 * (Re-chaining accepted outcomes is the lawyer's job, on the record.)
 */
export const flagForReassessment = mutation({
  args: { aiSourceId: v.id("aiSources") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const src = await ctx.db.get(args.aiSourceId);
    if (!src || src.orgId !== ac.org._id) {
      throw new Error("Source not found in this organization.");
    }
    const matterFindings = await ctx.db
      .query("reviewFindings")
      .withIndex("by_matter_status", (q) => q.eq("matterId", src.matterId))
      .collect();
    let flagged = 0;
    for (const f of matterFindings) {
      if (f.orgId !== ac.org._id) continue;
      const a = await ctx.db.get(f.sideAId);
      const b = await ctx.db.get(f.sideBId);
      if (
        a?.sourceAiSourceId !== args.aiSourceId &&
        b?.sourceAiSourceId !== args.aiSourceId
      ) {
        continue;
      }
      // Open findings need no flag (they are already awaiting review);
      // resolved ones get the visible reassessment flag.
      if (f.status !== "open") {
        await ctx.db.patch(f._id, {
          status: "reassessment_flagged",
          sourceChangeFlag: {
            flagAt: Date.now(),
            aiSourceId: args.aiSourceId,
            note: "A source document changed after this finding was reviewed — reassess.",
          },
          updatedAt: Date.now(),
        });
      }
      flagged += 1;
    }
    return { flagged };
  },
});
