import { describe, expect, it, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import {
  aggregateJobs,
  assertPlatformSafe,
  dayKeyUtc,
  freshnessSummary,
  FORBIDDEN_CONTENT_KEYS,
  percentileNearestRank,
  PLATFORM_ROW_FIELDS,
  toPlatformOrgRow,
} from "../lib/aiDashboards";

const modules: Record<string, () => Promise<unknown>> = (import.meta as unknown as {
  glob: (p: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.ts");

const asUser = (t: ReturnType<typeof convexTest>, userId: string) =>
  t.withIdentity({ subject: userId, tokenIdentifier: `test:${userId}` });

/** Seed one org + owner + client + matter. */
async function seedFirm(t: ReturnType<typeof convexTest>) {
  const ownerId = await asUser(t, "system").run(async (ctx) =>
    ctx.db.insert("users", {
      name: "Owner (synthetic)",
      email: "owner@t23.test",
      emailVerified: true,
      isAnonymous: false,
      isPlatformAdmin: false,
    }),
  );
  const seeded = await asUser(t, "system").run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "T23 Chamber (dashboards) — CONFIDENTIAL-NAME",
      slug: "t23-dashboards",
      kind: "chamber" as const,
      currency: "INR",
      timezone: "Asia/Kolkata",
      financialYearStart: "04-01",
      taxLabel: "GST",
      taxPercent: 18,
      invoicePrefix: "INV",
      createdBy: ownerId as never,
      createdAt: Date.now(),
    });
    await ctx.db.insert("memberships", {
      orgId,
      userId: ownerId as never,
      orgRole: "owner" as const,
      status: "active" as const,
      createdAt: Date.now(),
    });
    await ctx.db.patch(ownerId as never, { activeOrgId: orgId });
    const clientId = await ctx.db.insert("clients", {
      orgId,
      kind: "company" as const,
      name: "Dashboard Test Pvt. Ltd. (synthetic)",
      createdBy: ownerId as never,
      createdAt: Date.now(),
    });
    const matterId = await ctx.db.insert("matters", {
      orgId,
      clientId,
      reference: "T23/2026/0001",
      title: "Dashboard test matter (synthetic)",
      practiceArea: "civil",
      clientRole: "Dashboard Test Pvt. Ltd.",
      status: "open" as const,
      createdBy: ownerId as never,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { orgId, clientId, matterId };
  });
  return { ownerId, ...seeded };
}

type SeedJob = {
  status: "pending" | "done" | "failed" | "expired" | "blocked_clarification";
  kind?: string;
  ageDays?: number;
  costMinor?: number;
  promptTokens?: number;
  completionTokens?: number;
  durationMs?: number;
  defenceSignals?: number;
  error?: string;
  result?: string;
};

/** Seed aiJobs rows for the firm (matters required by the schema). */
async function seedJobs(
  t: ReturnType<typeof convexTest>,
  ids: { orgId: string; matterId: string; ownerId: string },
  specs: SeedJob[],
) {
  return asUser(t, "system").run(async (ctx) => {
    const out: string[] = [];
    for (const s of specs) {
      const createdAt = Date.now() - (s.ageDays ?? 0) * 24 * 3600_000;
      const jobId = await ctx.db.insert("aiJobs", {
        orgId: ids.orgId as never,
        matterId: ids.matterId as never,
        kind: s.kind ?? "summary",
        status: s.status as never,
        result: s.result,
        error: s.error,
        model: s.status === "done" ? "gpt-4o-mini" : undefined,
        promptTokens: s.promptTokens,
        completionTokens: s.completionTokens,
        costMinor: s.costMinor,
        durationMs: s.durationMs,
        instructionDefence:
          s.defenceSignals && s.defenceSignals > 0
            ? Array.from({ length: s.defenceSignals }, () => ({
                kind: "direct_instruction",
                excerpt: "synthetic",
                sourceName: "synthetic",
              }))
            : undefined,
        requestedById: ids.ownerId as never,
        createdAt,
      });
      out.push(String(jobId));
    }
    return out;
  });
}

describe("Turn 23 — §32 Phase 11 AI quality/freshness/cost dashboards", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  it("pure layer: defined metrics, windowing, nearest-rank percentiles, whitelist platform rows, runtime leak guard", () => {
    const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
    const rows = [
      { orgId: "o1", kind: "summary", status: "done" as const, createdAt: NOW - 1000, costMinor: 500, promptTokens: 100, completionTokens: 50, durationMs: 1000, defenceSignalCount: 2 },
      { orgId: "o1", kind: "summary", status: "done" as const, createdAt: NOW - 2000, durationMs: 3000, defenceSignalCount: 0 },
      { orgId: "o1", kind: "research", status: "failed" as const, createdAt: NOW - 3000, defenceSignalCount: 0 },
      { orgId: "o1", kind: "research", status: "blocked_clarification" as const, createdAt: NOW - 4000, defenceSignalCount: 0 },
      { orgId: "o1", kind: "email_summary", status: "pending" as const, createdAt: NOW - 5000, defenceSignalCount: 0 },
      { orgId: "o1", kind: "summary", status: "done" as const, createdAt: NOW - 40 * 24 * 3600_000, costMinor: 99_000, defenceSignalCount: 0 }, // outside 30d window
    ];
    const agg = aggregateJobs(rows, { now: NOW });

    // Window: only the 5 in-window rows count.
    expect(agg.windowDays).toBe(30);
    expect(agg.totals.total).toBe(5);
    expect(agg.totals.done).toBe(2);
    expect(agg.totals.failed).toBe(1);
    expect(agg.totals.blockedClarification).toBe(1);
    expect(agg.totals.pending).toBe(1);

    // Defined metrics — every metric carries a real definition, and NO
    // accuracy percentage exists anywhere (the honesty rule).
    const keys = agg.metrics.map((m) => m.key);
    expect(keys).toContain("failure_rate");
    expect(keys).toContain("blocked_clarification_rate");
    expect(keys).toContain("defence_signal_job_rate");
    expect(keys).toContain("cost_minor_total");
    expect(agg.metrics.every((m) => m.definition.length > 40)).toBe(true);
    expect(agg.metrics.some((m) => /accuracy/i.test(m.key + m.label))).toBe(false);
    const failure = agg.metrics.find((m) => m.key === "failure_rate")!;
    expect(failure.value).toBeCloseTo(1 / 3, 4); // failed ÷ (done+failed+expired)
    const defence = agg.metrics.find((m) => m.key === "defence_signal_job_rate")!;
    expect(defence.value).toBeCloseTo(1 / 5, 4);
    const cost = agg.metrics.find((m) => m.key === "cost_minor_total")!;
    expect(cost.value).toBe(500); // out-of-window cost excluded

    // Nearest-rank percentiles over completed durations [1000, 3000].
    const med = agg.metrics.find((m) => m.key === "completed_median_duration_ms")!;
    expect(med.value).toBe(1000); // ceil(0.5*2)-1 = index 0
    const p95 = agg.metrics.find((m) => m.key === "completed_p95_duration_ms")!;
    expect(p95.value).toBe(3000); // ceil(0.95*2)-1 = index 1
    expect(percentileNearestRank([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentileNearestRank([1, 2, 3, 4, 5], 95)).toBe(5);
    expect(percentileNearestRank([], 50)).toBeNull();

    // byKind + byDay bucketing. In-window summary rows: the two done
    // rows (the third done summary is outside the window).
    expect(agg.byKind.find((k) => k.kind === "summary")).toEqual({
      kind: "summary", total: 2, done: 2, failed: 0,
    });
    expect(agg.byDay).toHaveLength(30);
    expect(agg.byDay.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.day))).toBe(true);
    const todayRow = agg.byDay.find((d) => d.day === dayKeyUtc(NOW))!;
    // All five in-window synthetic rows fall on NOW's UTC day.
    expect(todayRow.total).toBe(5);

    // Freshness summary.
    const fresh = freshnessSummary([
      { stale: false, hasText: true, lastCheckOutcome: "unchanged" },
      { stale: true, hasText: false, lastCheckOutcome: "failed" },
      { stale: true, hasText: false, lastCheckOutcome: null },
    ]);
    expect(fresh.sourcesTotal).toBe(3);
    expect(fresh.withText).toBe(1);
    expect(fresh.stale).toBe(2);
    expect(fresh.lastCheckFailed).toBe(1);
    expect(fresh.definitions.stale).toContain("SUCCESS only");

    // Platform whitelist rows: exact fields, counts only.
    const prow = toPlatformOrgRow("o1", rows.filter((r) => r.createdAt >= NOW - 30 * 24 * 3600_000));
    expect(Object.keys(prow).sort()).toEqual([...PLATFORM_ROW_FIELDS].sort());
    expect(prow.total).toBe(5);
    expect(prow.costMinorTotal).toBe(500);
    expect(prow.defenceSignalJobs).toBe(1);
    expect(prow.lastJobAt).toBe(NOW - 1000);

    // Runtime leak guard: forbidden keys and long strings throw.
    expect(() => assertPlatformSafe({ ok: { total: 1 } })).not.toThrow();
    for (const bad of ["result", "inputNote", "transcript", "error", "instructionDefence"]) {
      expect(FORBIDDEN_CONTENT_KEYS).toContain(bad);
      expect(() => assertPlatformSafe({ ok: { [bad]: "x" } })).toThrow(/leak guard/);
    }
    expect(() =>
      assertPlatformSafe({ ok: { note: "x".repeat(121) } }),
    ).toThrow(/oversized string/);
  });

  it("firm view: aggregates over its own jobs, freshness summary, honest configuration state, no content in the payload", async () => {
    const firm = await seedFirm(t);
    await seedJobs(t, firm, [
      { status: "done", costMinor: 500, promptTokens: 100, completionTokens: 50, durationMs: 1200, defenceSignals: 1, result: "SECRET-RESULT-TEXT should never appear" },
      { status: "done", costMinor: 250, promptTokens: 80, completionTokens: 40, durationMs: 2400 },
      { status: "failed", error: "SECRET-ERROR-TEXT should never appear" },
      { status: "blocked_clarification" },
      { status: "pending" },
      { status: "done", ageDays: 45, costMinor: 777 }, // outside 30d window
    ]);
    const owner = asUser(t, firm.ownerId);

    const dash = await owner.query(api.aiDashboards.firmDashboard, {});
    expect(dash!.scope).toBe("firm");
    expect(dash!.aggregates.totals.total).toBe(5);
    expect(dash!.aggregates.totals.done).toBe(2);
    expect(dash!.aggregates.totals.failed).toBe(1);
    expect(dash!.aggregates.totals.blockedClarification).toBe(1);
    expect(dash!.liveModelConfigured).toBe(false);
    expect(dash!.aggregates.metrics.every((m) => m.definition.length > 40)).toBe(true);
    expect(dash!.aggregates.metrics.some((m) => /accuracy/i.test(m.key))).toBe(false);
    // All five in-window jobs default to kind "summary" (2 done,
    // 1 failed, 1 blocked, 1 pending).
    expect(dash!.aggregates.byKind.find((k) => k.kind === "summary")).toEqual({
      kind: "summary", total: 5, done: 2, failed: 1,
    });

    // NO CONTENT LEAKS into the firm dashboard payload either — results
    // and errors stay on the job records.
    const serialized = JSON.stringify(dash);
    expect(serialized).not.toContain("SECRET-RESULT-TEXT");
    expect(serialized).not.toContain("SECRET-ERROR-TEXT");

    // Freshness: one stale, un-ingested source registered.
    expect(dash!.freshness.sourcesTotal).toBe(0);
  });

  it("platform view: gated on platform admin; content-free opaque org rows; leak guard enforced", async () => {
    const firm = await seedFirm(t);
    await seedJobs(t, firm, [
      { status: "done", costMinor: 500, promptTokens: 100, completionTokens: 50, durationMs: 1200, defenceSignals: 2, result: "SECRET-RESULT-TEXT" },
      { status: "failed", error: "SECRET-ERROR-TEXT" },
      { status: "blocked_clarification" },
    ]);

    // A regular firm member is refused.
    await expect(
      asUser(t, firm.ownerId).query(api.aiDashboards.platformDashboard, {}),
    ).rejects.toThrow(/Platform administration access required/);

    // A platform admin (no org membership at all) sees aggregates only.
    const adminId = await asUser(t, "system").run((ctx) =>
      ctx.db.insert("users", {
        name: "CJ GLOBAL Operator (synthetic)",
        email: "operator@cjglobal.test",
        emailVerified: true,
        isAnonymous: false,
        isPlatformAdmin: true,
      }),
    );
    const dash = await asUser(t, adminId).query(api.aiDashboards.platformDashboard, {});
    expect(dash!.scope).toBe("platform");
    expect(dash!.perOrg).toHaveLength(1);
    const row = dash!.perOrg[0]!;
    expect(row.orgId).toBe(firm.orgId); // opaque id — the only identifier
    expect(row.total).toBe(3);
    expect(row.done).toBe(1);
    expect(row.failed).toBe(1);
    expect(row.blockedClarification).toBe(1);
    expect(row.costMinorTotal).toBe(500);
    expect(row.defenceSignalJobs).toBe(1);

    // The structural boundary: NO organization name, NO matter
    // reference, NO customer content anywhere in the payload.
    const serialized = JSON.stringify(dash);
    expect(serialized).not.toContain("CONFIDENTIAL-NAME");
    expect(serialized).not.toContain("T23/2026/0001");
    expect(serialized).not.toContain("SECRET-RESULT-TEXT");
    expect(serialized).not.toContain("SECRET-ERROR-TEXT");
    expect(serialized).not.toContain("Dashboard Test Pvt. Ltd.");
    expect(dash!.disclosure).toContain("No organization names");
    expect(dash!.disclosure).toContain("no customer content");

    // Same content-free guarantee for the aggregate totals.
    expect(dash!.aggregates.totals.total).toBe(3);
    expect(dash!.aggregates.metrics.every((m) => m.definition.length > 40)).toBe(true);
  });
});
