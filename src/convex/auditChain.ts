import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { requireAccess, requireWriteAccess } from "./access";
import { sha256Hex } from "./crypto";
import type { Doc, Id } from "./_generated/dataModel";

// =====================================================================
// AUDIT HASH CHAIN (§10 of the independently developed legal workspace
// features — "Make audit records append-only and tamper-evident using
// an appropriate design. Distinguish tamper evidence from an absolute
// claim that records cannot be altered.")
//
// Design: rows already exist in `auditLog`. Each chained row carries
//   seq       — 1..n within the organization (no gaps)
//   prevHash  — the previous row's entryHash (genesis = 64 × "0")
//   entryHash = sha256Hex(prevHash | seq | actorId | action | detail | createdAt)
//
// Verification walks the whole org chain and fails on any gap, break,
// or recomputed-hash mismatch — so editing or deleting an earlier row
// is DETECTABLE. This is tamper EVIDENCE, not immutability: the
// database itself remains the trust root, and a sufficiently privileged
// database operator could still tamper (though a consistent re-chain of
// history would have to be reconstructed). We state exactly that — no
// absolute "records cannot be altered" claim.
//
// Coexistence: the legacy writer (auditLogger.logUserAction) inserts
// rows WITHOUT seq/hash. New appends here chain onto the last chained
// row; `backfillLegacy` folds unchained legacy rows into the chain
// afterwards (in createdAt order). Verification reports unchained rows
// instead of silently ignoring them.
// =====================================================================

const GENESIS = "0".repeat(64);

function entryHashFor(
  prevHash: string,
  seq: number,
  actorId: string,
  action: string,
  detail: string | undefined,
  createdAt: number,
): string {
  return sha256Hex(`${prevHash}|${seq}|${actorId}|${action}|${detail ?? ""}|${createdAt}`);
}

/** Last chained row (highest seq) for the org. */
async function lastChained(
  ctx: { db: MutationCtx["db"] },
  orgId: Id<"organizations">,
): Promise<Doc<"auditLog"> | null> {
  const rows = await ctx.db
    .query("auditLog")
    .withIndex("by_org_seq", (q) => q.eq("orgId", orgId))
    .order("desc")
    .take(1);
  return rows[0] ?? null;
}

/**
 * Append one chained audit entry for the caller's organization. The
 * seq/prevHash chain is computed inside the same transaction as the
 * insert, so the append is atomic (OCC serializes concurrent writers).
 */
export const append = mutation({
  args: {
    action: v.string(),
    detail: v.optional(v.string()),
    matterId: v.optional(v.id("matters")),
  },
  handler: async (ctx, args) => {
    const ac = await requireWriteAccess(ctx);
    if (args.matterId) {
      const matter = await ctx.db.get(args.matterId);
      if (!matter || matter.orgId !== ac.org._id) {
        throw new Error("Matter not found in this organization.");
      }
    }
    const last = await lastChained(ctx, ac.org._id);
    const seq = (last?.seq ?? 0) + 1;
    const prevHash = last?.entryHash ?? GENESIS;
    const createdAt = Date.now();
    const entryHash = entryHashFor(
      prevHash,
      seq,
      ac.user._id,
      args.action,
      args.detail,
      createdAt,
    );
    const id = (await ctx.db.insert("auditLog", {
      orgId: ac.org._id,
      matterId: args.matterId,
      actorId: ac.user._id,
      actorName: ac.user.name ?? ac.user.email ?? "member",
      action: args.action.slice(0, 120),
      detail: args.detail?.slice(0, 1000),
      createdAt,
      seq,
      prevHash,
      entryHash,
    })) as Id<"auditLog">;
    return { seq, entryHash, prevHash, id };
  },
});

/**
 * Verify the organization's chain: walks by_org_seq, recomputes every
 * hash, checks seq continuity and hash linkage, and reports unchained
 * (legacy) rows rather than ignoring them. Returns the FIRST break.
 */
export const verify = query({
  args: {},
  // NOTE: the org comes from the session (requireAccess), never the
  // payload — verification always covers the caller's own chain.
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    const rows = await ctx.db
      .query("auditLog")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const ordered = rows
      .filter((r) => r.seq !== undefined)
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    const unchained = rows.filter((r) => r.seq === undefined).length;

    let expectedPrev = GENESIS;
    let expectedSeq = 1;
    let chained = 0;
    for (const r of ordered) {
      if (r.seq !== expectedSeq) {
        return {
          ok: false as const,
          chained,
          unchained,
          brokenAt: r._id,
          reason: `Sequence break at entry ${String(r._id)}: expected seq ${expectedSeq}, found ${r.seq} (a row may have been deleted).`,
        };
      }
      if (r.prevHash !== expectedPrev) {
        return {
          ok: false as const,
          chained,
          unchained,
          brokenAt: r._id,
          reason: `Linkage break at seq ${r.seq}: stored prevHash does not match the previous entry's hash (earlier history may have been altered).`,
        };
      }
      const recomputed = entryHashFor(
        r.prevHash ?? GENESIS,
        r.seq ?? 0,
        r.actorId,
        r.action,
        r.detail,
        r.createdAt,
      );
      if (recomputed !== r.entryHash) {
        return {
          ok: false as const,
          chained,
          unchained,
          brokenAt: r._id,
          reason: `Hash mismatch at seq ${r.seq}: entry content does not match its recorded hash (the row was modified after writing).`,
        };
      }
      expectedPrev = r.entryHash!;
      expectedSeq += 1;
      chained += 1;
    }

    if (unchained > 0) {
      return {
        ok: false as const,
        chained,
        unchained,
        brokenAt: undefined,
        reason: `${unchained} earlier audit row(s) are not yet chained — run backfillLegacy to fold them into the chain.`,
      };
    }
    return { ok: true as const, chained, unchained, brokenAt: undefined, reason: undefined };
  },
});

/**
 * Fold legacy (unchained) auditLog rows into the chain, in createdAt
 * order, continuing the seq sequence from the last chained row.
 * Idempotent: already-chained rows are left alone.
 */
export const backfillLegacy = mutation({
  args: {},
  handler: async (ctx) => {
    const ac = await requireWriteAccess(ctx);
    const rows = await ctx.db
      .query("auditLog")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const legacy = rows
      .filter((r) => r.seq === undefined)
      .sort((a, b) => a.createdAt - b.createdAt);
    if (legacy.length === 0) return { backfilled: 0 };

    let last = await lastChained(ctx, ac.org._id);
    let seq = last?.seq ?? 0;
    let prevHash = last?.entryHash ?? GENESIS;
    for (const r of legacy) {
      seq += 1;
      const entryHash = entryHashFor(prevHash, seq, r.actorId, r.action, r.detail, r.createdAt);
      await ctx.db.patch(r._id, { seq, prevHash, entryHash });
      prevHash = entryHash;
    }
    return { backfilled: legacy.length, lastSeq: seq };
  },
});

/** Recent audit entries for the org (newest first). */
export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const rows = await ctx.db
      .query("auditLog")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    return rows
      .sort((a, b) => (b.seq ?? -1) - (a.seq ?? -1) || b.createdAt - a.createdAt)
      .slice(0, Math.min(args.limit ?? 50, 200))
      .map((r) => ({
        id: r._id,
        seq: r.seq,
        actorName: r.actorName,
        action: r.action,
        detail: r.detail,
        matterId: r.matterId,
        createdAt: r.createdAt,
        chained: r.entryHash !== undefined,
        entryHash: r.entryHash,
      }));
  },
});
