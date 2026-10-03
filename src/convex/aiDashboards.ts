import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import { getCurrentUser } from "./users";
import { requireAccess } from "./access";
import type { Doc } from "./_generated/dataModel";
import {
  aggregateJobs,
  assertPlatformSafe,
  freshnessSummary,
  PLATFORM_DISCLOSURE,
  toPlatformOrgRow,
  type FreshnessInputRow,
  type JobAggRow,
  type JobStatus,
} from "../lib/aiDashboards";

// =====================================================================
// §32 PHASE 11 — AI QUALITY / FRESHNESS / COST DASHBOARDS (turn 23).
//
// Read-only aggregates. What this module is NOT: a place where platform
// staff can see customer content, and not a place where vague quality
// numbers ("accuracy") are invented. See the pure layer for the two
// structural guarantees:
//  1. every metric ships with its exact definition;
//  2. the platform view is built from a field whitelist AND re-checked
//     by the runtime leak guard before it leaves.
// =====================================================================

/** The rolling-window aggregation input for aiJobs rows (no content). */
function jobAggRow(j: Doc<"aiJobs">): JobAggRow {
  return {
    orgId: j.orgId,
    kind: j.kind,
    status: j.status as JobStatus,
    createdAt: j.createdAt,
    costMinor: j.costMinor,
    promptTokens: j.promptTokens,
    completionTokens: j.completionTokens,
    durationMs: j.durationMs,
    defenceSignalCount: j.instructionDefence?.length ?? 0,
  };
}

/**
 * Freshness inputs over the shared research corpus (same rules as
 * legalIntel.freshness: staleness keys on SUCCESS only; a failed check
 * never advances freshness — failures surface separately).
 */
async function corpusFreshness(
  ctx: QueryCtx,
): Promise<ReturnType<typeof freshnessSummary>> {
  const sources = (await ctx.db.query("legalSources").collect()) as unknown as Doc<"legalSources">[];
  const runs = (await ctx.db.query("ingestionRuns").collect()) as unknown as Doc<"ingestionRuns">[];
  const lastBySource = new Map<string, { at: number; outcome: string | null }>();
  for (const r of runs) {
    if (!r.lastSuccessfulAt && r.outcome !== "failed") continue;
    const at = r.lastSuccessfulAt ?? r.startedAt;
    const prev = lastBySource.get(r.sourceId);
    if (!prev || at > prev.at) {
      lastBySource.set(r.sourceId, { at, outcome: r.outcome ?? null });
    }
  }
  const STALE_MS = 180 * 24 * 3600_000;
  const rows: FreshnessInputRow[] = await Promise.all(
    sources.map(async (s) => {
      const last = lastBySource.get(s._id);
      const v = s.latestVersion ? await ctx.db.get(s.latestVersion) : null;
      return {
        stale: !last || Date.now() - last.at > STALE_MS,
        hasText: !!v && !v.body.startsWith("[INGESTION PENDING]"),
        lastCheckOutcome: s.lastCheckOutcome ?? last?.outcome ?? null,
      };
    }),
  );
  return freshnessSummary(rows);
}

// ---------------------------------------------------------------------
// FIRM VIEW — the organization's own aggregates
// ---------------------------------------------------------------------

export const firmDashboard = query({
  args: { windowDays: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const jobs = (await ctx.db.query("aiJobs").collect()).filter(
      (j) => j.orgId === ac.org._id,
    );
    const aggregates = aggregateJobs(
      jobs.map(jobAggRow),
      { now: Date.now(), windowDays: args.windowDays },
    );
    const freshness = await corpusFreshness(ctx);
    return {
      scope: "firm" as const,
      aggregates,
      freshness,
      // Honest configuration disclosure: on this deployment the model
      // key is NOT configured, so most rows will be pending/blocked —
      // the dashboard shows that state rather than hiding it.
      liveModelConfigured: !!process.env.OPENAI_API_KEY,
      disclosures: {
        content: "Firm view: aggregates over your organization's AI jobs only. Job results and inputs remain on the job records themselves.",
        quality:
          "No accuracy percentage is shown anywhere — quality is expressed only through metrics whose definitions are printed alongside them.",
        cost:
          "Costs are recorded per job by the runner in minor units (paise-equivalent pricing of the configured model).",
      },
    };
  },
});

// ---------------------------------------------------------------------
// CJ GLOBAL (platform) VIEW — aggregates only, leak-guarded
// ---------------------------------------------------------------------

export const platformDashboard = query({
  args: { windowDays: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user || user.isAnonymous || !user.isPlatformAdmin) {
      throw new Error("Platform administration access required.");
    }
    const jobs = await ctx.db.query("aiJobs").collect();
    const aggregates = aggregateJobs(
      jobs.map(jobAggRow),
      { now: Date.now(), windowDays: args.windowDays },
    );

    const byOrg = new Map<string, JobAggRow[]>();
    for (const r of jobs.map(jobAggRow)) {
      const list = byOrg.get(r.orgId) ?? [];
      list.push(r);
      byOrg.set(r.orgId, list);
    }
    const perOrg = [...byOrg.entries()]
      .map(([orgId, rows]) => toPlatformOrgRow(orgId, rows))
      .sort(
        (a, b) =>
          b.costMinorTotal - a.costMinorTotal || a.orgId.localeCompare(b.orgId),
      );

    const freshness = await corpusFreshness(ctx);

    const payload = {
      scope: "platform" as const,
      aggregates,
      perOrg,
      freshness,
      liveModelConfigured: !!process.env.OPENAI_API_KEY,
      disclosure: PLATFORM_DISCLOSURE,
    };
    // Defence-in-depth: refuse to return anything the guard rejects.
    assertPlatformSafe(payload);
    return payload;
  },
});
