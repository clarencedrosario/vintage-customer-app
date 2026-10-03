// =====================================================================
// §32 PHASE 11 — AI QUALITY / FRESHNESS / COST DASHBOARDS (pure layer).
//
// Two views, one honesty contract:
//
//  - FIRM VIEW: an organization sees aggregates over ITS OWN AI jobs —
//    volumes, outcomes, costs, token totals, latencies, defence-signal
//    incidence — plus the freshness of the shared research corpus that
//    grounds its research answers.
//  - CJ GLOBAL (platform) VIEW: platform staff see COUNTS, COSTS and
//    TIMINGS only, keyed by OPAQUE organization ids. No organization
//    names, no matter references, and above all NO customer content —
//    no results, inputs, transcripts, e-mail bodies or errors. The
//    boundary is structural: rows are built from a field whitelist and
//    re-checked at runtime by assertPlatformSafe (defence-in-depth, so
//    a future field addition cannot silently leak).
//
// NO UNDEFINED ACCURACY PERCENTAGES: there is no "accuracy" metric in
// this module — deliberately. Every number shipped here carries its
// exact definition (what is counted, over what window, with what
// exclusions). Quality is expressed in concrete, defined terms:
// outcome rates, blocked-clarification rate, defence-signal incidence,
// latency percentiles. Nothing vague, nothing invented.
// =====================================================================

export type JobStatus =
  | "pending"
  | "done"
  | "failed"
  | "expired"
  | "blocked_clarification";

/** The aggregate input row — NO content fields, ever. */
export type JobAggRow = {
  orgId: string;
  kind: string;
  status: JobStatus;
  createdAt: number;
  costMinor?: number;
  promptTokens?: number;
  completionTokens?: number;
  durationMs?: number;
  /** 0, or the length of the job's instructionDefence record. */
  defenceSignalCount: number;
};

export type DefinedMetric = {
  key: string;
  label: string;
  value: number;
  definition: string;
};

export const DEFAULT_WINDOW_DAYS = 30;
export const MAX_WINDOW_DAYS = 120;

export function dayKeyUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Nearest-rank percentile over an ALREADY SORTED ascending array.
 * Deliberately the textbook nearest-rank method so the number is
 * reproducible and its definition is exact.
 */
export function percentileNearestRank(
  sorted: number[],
  p: number,
): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

export type ByKindRow = { kind: string; total: number; done: number; failed: number };
export type ByDayRow = { day: string; total: number; done: number; failed: number };

export type FirmAggregates = {
  windowDays: number;
  windowStartUtc: string;
  totals: {
    total: number;
    done: number;
    failed: number;
    expired: number;
    blockedClarification: number;
    pending: number;
  };
  metrics: DefinedMetric[];
  byKind: ByKindRow[];
  byDay: ByDayRow[];
};

/**
 * Aggregate AI-job rows for ONE organization over a rolling window.
 * Every metric carries its definition; jobs outside the window are
 * excluded from everything.
 */
export function aggregateJobs(
  rows: JobAggRow[],
  opts: { now: number; windowDays?: number },
): FirmAggregates {
  const windowDays = Math.min(
    Math.max(1, opts.windowDays ?? DEFAULT_WINDOW_DAYS),
    MAX_WINDOW_DAYS,
  );
  const windowStartMs = opts.now - windowDays * 24 * 3600_000;
  const inWindow = rows.filter((r) => r.createdAt >= windowStartMs);

  const totals = {
    total: inWindow.length,
    done: 0,
    failed: 0,
    expired: 0,
    blockedClarification: 0,
    pending: 0,
  };
  let costMinorTotal = 0;
  let tokensTotal = 0;
  let defenceSignalJobs = 0;
  let defenceSignals = 0;
  const durations: number[] = [];
  for (const r of inWindow) {
    if (r.status === "done") totals.done += 1;
    else if (r.status === "failed") totals.failed += 1;
    else if (r.status === "expired") totals.expired += 1;
    else if (r.status === "blocked_clarification") totals.blockedClarification += 1;
    else totals.pending += 1;
    costMinorTotal += r.costMinor ?? 0;
    tokensTotal += (r.promptTokens ?? 0) + (r.completionTokens ?? 0);
    if (r.defenceSignalCount > 0) defenceSignalJobs += 1;
    defenceSignals += r.defenceSignalCount;
    if (r.status === "done" && typeof r.durationMs === "number") {
      durations.push(r.durationMs);
    }
  }
  durations.sort((a, b) => a - b);

  const outcomes = totals.done + totals.failed + totals.expired;
  const failureRate = outcomes > 0 ? round4(totals.failed / outcomes) : 0;
  const blockedRate = totals.total > 0 ? round4(totals.blockedClarification / totals.total) : 0;
  const defenceJobRate = totals.total > 0 ? round4(defenceSignalJobs / totals.total) : 0;

  const metrics: DefinedMetric[] = [
    {
      key: "failure_rate",
      label: "Failure rate",
      value: failureRate,
      definition:
        "failed ÷ (done + failed + expired) over the window. Pending and blocked_clarification rows are excluded: they are not yet outcomes.",
    },
    {
      key: "blocked_clarification_rate",
      label: "Blocked-for-clarification rate",
      value: blockedRate,
      definition:
        "blocked_clarification ÷ total jobs over the window. A block means applicability facts were missing (governing date, jurisdiction, stage) and the model was deliberately NOT run — a quality guard, not an error.",
    },
    {
      key: "defence_signal_job_rate",
      label: "Instruction-defence incidence",
      value: defenceJobRate,
      definition:
        "jobs with ≥1 instruction-defence signal ÷ total jobs over the window. Detection is a pattern scan (an aid for lawyer review), not a verdict, and never an accuracy claim.",
    },
    {
      key: "completed_median_duration_ms",
      label: "Median duration (completed)",
      value: percentileNearestRank(durations, 50) ?? 0,
      definition:
        "Nearest-rank median of durationMs over completed jobs in the window. Rows without a duration are excluded from the percentile.",
    },
    {
      key: "completed_p95_duration_ms",
      label: "p95 duration (completed)",
      value: percentileNearestRank(durations, 95) ?? 0,
      definition:
        "Nearest-rank 95th percentile of durationMs over completed jobs in the window.",
    },
    {
      key: "cost_minor_total",
      label: "Total cost (minor units)",
      value: costMinorTotal,
      definition:
        "Sum of recorded per-job costMinor over the window (0 where a job recorded no cost — e.g. when no model key is configured).",
    },
    {
      key: "tokens_total",
      label: "Total tokens",
      value: tokensTotal,
      definition: "Sum of promptTokens + completionTokens over the window.",
    },
  ];

  const byKindMap = new Map<string, ByKindRow>();
  for (const r of inWindow) {
    const row = byKindMap.get(r.kind) ?? { kind: r.kind, total: 0, done: 0, failed: 0 };
    row.total += 1;
    if (r.status === "done") row.done += 1;
    if (r.status === "failed") row.failed += 1;
    byKindMap.set(r.kind, row);
  }
  const byKind = [...byKindMap.values()].sort((a, b) => b.total - a.total);

  const byDayMap = new Map<string, ByDayRow>();
  for (let d = 0; d < windowDays; d += 1) {
    byDayMap.set(dayKeyUtc(opts.now - d * 24 * 3600_000), {
      day: dayKeyUtc(opts.now - d * 24 * 3600_000),
      total: 0,
      done: 0,
      failed: 0,
    });
  }
  for (const r of inWindow) {
    const day = dayKeyUtc(r.createdAt);
    const row = byDayMap.get(day);
    if (!row) continue; // outside the rendered window (defensive)
    row.total += 1;
    if (r.status === "done") row.done += 1;
    if (r.status === "failed") row.failed += 1;
  }
  const byDay = [...byDayMap.values()].sort((a, b) => a.day.localeCompare(b.day));

  return {
    windowDays,
    windowStartUtc: dayKeyUtc(windowStartMs),
    totals,
    metrics,
    byKind,
    byDay,
  };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

// ---------------------------------------------------------------------
// Freshness summary (shared research corpus)
// ---------------------------------------------------------------------

export type FreshnessInputRow = {
  stale: boolean;
  hasText: boolean;
  lastCheckOutcome: string | null;
};

export function freshnessSummary(rows: FreshnessInputRow[]): {
  sourcesTotal: number;
  withText: number;
  stale: number;
  lastCheckFailed: number;
  definitions: Record<string, string>;
} {
  const lastCheckFailed = rows.filter((r) => r.lastCheckOutcome === "failed").length;
  return {
    sourcesTotal: rows.length,
    withText: rows.filter((r) => r.hasText).length,
    stale: rows.filter((r) => r.stale).length,
    lastCheckFailed,
    definitions: {
      sourcesTotal:
        "Registered legal sources (shared corpus — the same corpus grounds every firm's research answers).",
      withText:
        "Sources whose latest version carries real ingested text (registered-but-uningested sources count as NOT having text).",
      stale:
        "Sources whose last SUCCESSFUL ingestion is older than 180 days — staleness keys on SUCCESS only; a failed check never advances freshness.",
      lastCheckFailed:
        "Sources whose most recent check ATTEMPT failed — shown so failure is visible, never hidden behind a stale flag.",
    },
  };
}

// ---------------------------------------------------------------------
// Platform (CJ GLOBAL) view: structural content-redaction boundary
// ---------------------------------------------------------------------

export type PlatformOrgRow = {
  orgId: string; // opaque — no organization names
  total: number;
  done: number;
  failed: number;
  expired: number;
  blockedClarification: number;
  pending: number;
  costMinorTotal: number;
  tokensTotal: number;
  defenceSignalJobs: number;
  lastJobAt: number | null;
};

/** The exact field whitelist of a platform row — nothing else may ship. */
export const PLATFORM_ROW_FIELDS = [
  "orgId",
  "total",
  "done",
  "failed",
  "expired",
  "blockedClarification",
  "pending",
  "costMinorTotal",
  "tokensTotal",
  "defenceSignalJobs",
  "lastJobAt",
] as const;

/** Content-carrying aiJobs fields that must NEVER appear in the platform view. */
export const FORBIDDEN_CONTENT_KEYS = [
  "result",
  "inputNote",
  "transcript",
  "emailBody",
  "emailDigest",
  "structured",
  "clarifications",
  "body",
  "text",
  "subject",
  "error",
  "instructionDefence",
  "legalSourceVersions",
] as const;

export const PLATFORM_DISCLOSURE =
  "Platform view: counts, costs and timings only, keyed by opaque organization ids. No organization names, no matter references, no customer content (results, inputs, transcripts, e-mail bodies, errors, defence excerpts). Customer legal records are outside the operator's standing access by design.";

/** Build the content-free per-org row — the ONLY shape that leaves. */
export function toPlatformOrgRow(orgId: string, rows: JobAggRow[]): PlatformOrgRow {
  const row: PlatformOrgRow = {
    orgId,
    total: rows.length,
    done: 0,
    failed: 0,
    expired: 0,
    blockedClarification: 0,
    pending: 0,
    costMinorTotal: 0,
    tokensTotal: 0,
    defenceSignalJobs: 0,
    lastJobAt: null,
  };
  for (const r of rows) {
    if (r.status === "done") row.done += 1;
    else if (r.status === "failed") row.failed += 1;
    else if (r.status === "expired") row.expired += 1;
    else if (r.status === "blocked_clarification") row.blockedClarification += 1;
    else row.pending += 1;
    row.costMinorTotal += r.costMinor ?? 0;
    row.tokensTotal += (r.promptTokens ?? 0) + (r.completionTokens ?? 0);
    if (r.defenceSignalCount > 0) row.defenceSignalJobs += 1;
    if (row.lastJobAt === null || r.createdAt > row.lastJobAt) row.lastJobAt = r.createdAt;
  }
  return row;
}

/**
 * Module-authored structural keys: metric labels/definitions and the
 * disclosure strings. These are deliberately LONG (every metric carries
 * its full definition) and are written by this module, never by job
 * data — exempt from the oversized-string heuristic. The forbidden-key
 * check applies to them like everything else.
 */
const STRUCTURAL_KEYS = new Set([
  "key",
  "label",
  "definition",
  "definitions",
  "disclosure",
  "scope",
  "windowStartUtc",
]);

/**
 * Runtime leak guard (defence-in-depth): walk a payload and throw if a
 * forbidden content key appears anywhere, or if any NON-structural
 * string is long enough to be content (aggregates carry counts, ids
 * and module-authored definitions only). Values inside structural
 * containers (metric definitions, disclosures) are module-authored and
 * exempt from the length heuristic — but the forbidden-key check still
 * applies everywhere.
 */
export function assertPlatformSafe(
  payload: unknown,
  depth = 0,
  structural = false,
): void {
  if (depth > 8) return;
  if (Array.isArray(payload)) {
    for (const item of payload) assertPlatformSafe(item, depth + 1, structural);
    return;
  }
  if (payload !== null && typeof payload === "object") {
    for (const [key, value] of Object.entries(payload)) {
      if ((FORBIDDEN_CONTENT_KEYS as readonly string[]).includes(key)) {
        throw new Error(
          `Platform-view leak guard: forbidden content key "${key}" in the payload.`,
        );
      }
      const structuralSubtree = structural || STRUCTURAL_KEYS.has(key);
      if (
        typeof value === "string" &&
        value.length > 120 &&
        !structuralSubtree
      ) {
        throw new Error(
          `Platform-view leak guard: oversized string under "${key}" — aggregates carry counts, ids and module-authored definitions only.`,
        );
      }
      assertPlatformSafe(value, depth + 1, structuralSubtree);
    }
  }
}
