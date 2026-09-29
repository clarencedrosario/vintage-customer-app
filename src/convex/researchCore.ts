import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { MutationCtx } from "./_generated/server";
import {
  clarificationQuestions,
  governingLegalDate,
  resolveJurisdiction,
} from "../lib/legalIntel";
import { MONTHLY_TOKEN_LIMIT, monthKeyIST } from "./ai";

/**
 * Shared core for legal-research request submission and retry (turn 10).
 * Both `prepareLegalResearch` and `retryJob` funnel through here so the
 * clarification-gate transition is IDENTICAL in both paths:
 *
 *   clarifications empty   → job pending, runner scheduled (model runs)
 *   clarifications present → job blocked_clarification, NO scheduler call
 *
 * so the model is only ever run when the facts that change applicability
 * are on record. Authorization is enforced by the CALLERS before this
 * function runs (requireAccess + note.write + requireMatter); the usage
 * cap is re-checked here for every new attempt; duplicate execution is
 * prevented at runner time by the aiJobClaims occurrence-key guard plus
 * the pending-status retry refusal.
 *
 * Returns the new job id (pending or blocked_clarification).
 */
export async function insertResearchAttempt(
  ctx: MutationCtx,
  args: {
    orgId: Id<"organizations">;
    matterId: Id<"matters">;
    question: string;
    requestedById: Id<"users">;
    /** Retry path: carry the original frozen snapshot instead of re-taking it. */
    carriedSourceVersions?: { stableKey: string; version: number }[];
  },
): Promise<Id<"aiJobs">> {
  // Usage cap for this attempt's own cost (same policy as prepareJob).
  const key = monthKeyIST();
  const month = await ctx.db
    .query("aiJobs")
    .withIndex("by_org_month", (q) => q.eq("orgId", args.orgId).eq("monthKey", key))
    .collect();
  const used = month.reduce(
    (s, r) => s + (r.promptTokens ?? 0) + (r.completionTokens ?? 0),
    0,
  );
  if (used >= MONTHLY_TOKEN_LIMIT) {
    throw new Error(
      "The chamber's monthly AI usage allowance is exhausted. It resets next month; ask the firm owner to review usage.",
    );
  }

  // Jurisdiction/date context: the matter's legal profile wins, else the
  // firm default (labelled not-confirmed, which the gate then asks about).
  const matter = await ctx.db.get(args.matterId);
  const org = await ctx.db.get(args.orgId);
  const profile = matter?.legalProfile ?? null;
  const j = resolveJurisdiction(profile, org?.legalDefaults?.country ?? "in");
  const d = governingLegalDate(
    profile,
    new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10),
  );

  // Source-version snapshot (26.6): the versions the answer will be
  // grounded in. Fresh attempts freeze it now; retries carry the original
  // snapshot so the record keeps WHICH text was in force at request time.
  let sourceVersions: { stableKey: string; version: number }[];
  if (args.carriedSourceVersions) {
    sourceVersions = args.carriedSourceVersions;
  } else {
    const legalRows = await ctx.db
      .query("legalSources")
      .withIndex("by_country", (q) => q.eq("country", j.country))
      .collect();
    sourceVersions = [];
    for (const s of legalRows) {
      const v = s.latestVersion ? await ctx.db.get(s.latestVersion) : null;
      if (!v || v.body.startsWith("[INGESTION PENDING]")) continue;
      sourceVersions.push({ stableKey: s.stableKey, version: v.version });
    }
  }

  // Focused clarifications — only when missing facts change applicability.
  const clarifications = clarificationQuestions({
    country: j.country,
    jurisdictionConfirmed: j.confirmed,
    legalDateKnown: !d.isAssumption,
    proceduralStage: profile?.proceduralStage ?? null,
  });

  // THE transition (identical for submit and retry): facts missing →
  // blocked_clarification, runner NEVER scheduled; facts on record →
  // pending, runner scheduled below.
  const gated = clarifications.length > 0;
  const id = await ctx.db.insert("aiJobs", {
    orgId: args.orgId,
    matterId: args.matterId,
    kind: "legal_research",
    status: gated ? "blocked_clarification" : "pending",
    inputNote: args.question.slice(0, 4000),
    monthKey: key,
    legalSourceVersions: sourceVersions,
    clarifications: gated ? clarifications : undefined,
    requestedById: args.requestedById,
    createdAt: Date.now(),
  });

  if (gated) {
    // Gate closed: the request is parked with the focused questions and
    // the model is not called. Supplying the facts on the matter and
    // retrying recomputes this gate — the labelled resume path.
    return id;
  }

  // Gate open: schedule exactly like every other AI kind. The
  // occurrence-key claim in aiRunner guarantees a single execution.
  await ctx.scheduler.runAfter(0, internal.aiRunner.runJob, {
    jobId: id,
    occurrenceKey: `ai:${id}`,
  });
  return id;
}
