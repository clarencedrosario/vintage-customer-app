// =====================================================================
// §32 Phase 11 — AI quality/freshness/cost dashboard (shared renderer).
// Two scopes, one honesty contract: every metric prints its DEFINITION,
// no accuracy percentages exist, and the platform view shows only
// counts/costs/timings keyed by opaque org ids. Renders for both
// aiDashboards.firmDashboard (chamber AI page) and
// aiDashboards.platformDashboard (/platform, isPlatformAdmin-gated).
// =====================================================================
import { useState } from "react";
import { useQuery } from "convex/react";
import { Activity } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { ByKindRow, ByDayRow, DefinedMetric, PlatformOrgRow } from "@/lib/aiDashboards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { S32Loading, S32Note } from "@/components/s32/shared";
import { formatDateTimeIN } from "@/lib/format";

/** Dashboard windows — every value must be ≤ backend MAX_WINDOW_DAYS (drift test group4.test.ts). */
export const WINDOWS = [7, 30, 60, 90, 120] as const;

type Freshness = {
  sourcesTotal: number;
  withText: number;
  stale: number;
  lastCheckFailed: number;
  definitions: Record<string, string>;
};

type FirmPayload = {
  scope: "firm";
  aggregates: {
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
  freshness: Freshness;
  liveModelConfigured: boolean;
  disclosures: { content: string; quality: string; cost: string };
};

type PlatformPayload = {
  scope: "platform";
  aggregates: FirmPayload["aggregates"];
  perOrg: PlatformOrgRow[];
  freshness: Freshness;
  liveModelConfigured: boolean;
  disclosure: string;
};

export function AiQualityDashboard({ scope }: { scope: "firm" | "platform" }) {
  const [windowDays, setWindowDays] = useState<number>(30);
  const data = useQuery(
    scope === "firm"
      ? api.aiDashboards.firmDashboard
      : api.aiDashboards.platformDashboard,
    { windowDays },
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <Activity className="size-4 text-muted-foreground" />
          {scope === "firm" ? "AI quality & cost — this firm" : "AI usage — all chambers"}
          <span className="ml-auto flex items-center gap-1">
            {WINDOWS.map((w) => (
              <Button
                key={w}
                size="sm"
                variant={w === windowDays ? "default" : "outline"}
                className="h-6 px-2 text-[11px]"
                onClick={() => setWindowDays(w)}
              >
                {w}d
              </Button>
            ))}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {data === undefined ? (
          <S32Loading />
        ) : (
          <DashboardBody
            payload={data as unknown as FirmPayload | PlatformPayload}
            scope={scope}
          />
        )}
      </CardContent>
    </Card>
  );
}

function DashboardBody({
  payload,
  scope,
}: {
  payload: FirmPayload | PlatformPayload;
  scope: "firm" | "platform";
}) {
  const t = payload.aggregates.totals;
  return (
    <>
      {!payload.liveModelConfigured && (
        <S32Note tone="amber">
          Honest configuration state: no model key is configured on this
          deployment, so most jobs stay pending or ask for clarification. The
          dashboard shows that state rather than hiding it.
        </S32Note>
      )}

      {scope === "firm" ? (
        <S32Note>{(payload as FirmPayload).disclosures.content}</S32Note>
      ) : (
        <S32Note>{(payload as PlatformPayload).disclosure}</S32Note>
      )}

      {/* Totals */}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Total", value: t.total },
          { label: "Done", value: t.done },
          { label: "Failed", value: t.failed },
          { label: "Expired", value: t.expired },
          { label: "Blocked (clarification)", value: t.blockedClarification },
          { label: "Pending", value: t.pending },
        ].map((x) => (
          <div key={x.label} className="rounded-md border border-border/70 p-2 text-center">
            <p className="text-lg font-semibold">{x.value}</p>
            <p className="text-[11px] text-muted-foreground">{x.label}</p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Window: last {payload.aggregates.windowDays} days (from {payload.aggregates.windowStartUtc.slice(0, 10)} UTC). Jobs outside the window are excluded from everything.
      </p>

      {/* Defined metrics — definition printed under every value */}
      <div className="overflow-hidden rounded-md border border-border/70">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5">Metric</th>
              <th className="px-3 py-1.5">Value</th>
            </tr>
          </thead>
          <tbody>
            {payload.aggregates.metrics.map((m) => (
              <tr key={m.key} className="border-t border-border/60 align-top">
                <td className="px-3 py-2">
                  <p className="font-medium">{m.label}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{m.definition}</p>
                </td>
                <td className="px-3 py-2 font-mono">{m.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* By kind */}
      <div className="overflow-hidden rounded-md border border-border/70">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5">Kind</th>
              <th className="px-3 py-1.5">Total</th>
              <th className="px-3 py-1.5">Done</th>
              <th className="px-3 py-1.5">Failed</th>
            </tr>
          </thead>
          <tbody>
            {payload.aggregates.byKind.map((k) => (
              <tr key={k.kind} className="border-t border-border/60">
                <td className="px-3 py-1.5">{k.kind}</td>
                <td className="px-3 py-1.5 font-mono">{k.total}</td>
                <td className="px-3 py-1.5 font-mono">{k.done}</td>
                <td className="px-3 py-1.5 font-mono">{k.failed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Platform-only: opaque per-org rows */}
      {scope === "platform" && (
        <div className="overflow-x-auto rounded-md border border-border/70">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5">Organization</th>
                <th className="px-3 py-1.5">Total</th>
                <th className="px-3 py-1.5">Done</th>
                <th className="px-3 py-1.5">Failed</th>
                <th className="px-3 py-1.5">Blocked</th>
                <th className="px-3 py-1.5">Cost (minor)</th>
                <th className="px-3 py-1.5">Tokens</th>
                <th className="px-3 py-1.5">Defence-signal jobs</th>
                <th className="px-3 py-1.5">Last job</th>
              </tr>
            </thead>
            <tbody>
              {(payload as PlatformPayload).perOrg.map((r) => (
                <tr key={r.orgId} className="border-t border-border/60">
                  <td className="px-3 py-1.5 font-mono text-xs">{r.orgId.slice(0, 12)}…</td>
                  <td className="px-3 py-1.5 font-mono">{r.total}</td>
                  <td className="px-3 py-1.5 font-mono">{r.done}</td>
                  <td className="px-3 py-1.5 font-mono">{r.failed}</td>
                  <td className="px-3 py-1.5 font-mono">{r.blockedClarification}</td>
                  <td className="px-3 py-1.5 font-mono">{r.costMinorTotal}</td>
                  <td className="px-3 py-1.5 font-mono">{r.tokensTotal}</td>
                  <td className="px-3 py-1.5 font-mono">{r.defenceSignalJobs}</td>
                  <td className="px-3 py-1.5 text-xs">
                    {r.lastJobAt ? formatDateTimeIN(r.lastJobAt) : "—"}
                  </td>
                </tr>
              ))}
              {(payload as PlatformPayload).perOrg.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-2 text-center text-xs text-muted-foreground">
                    No AI jobs recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Corpus freshness — definitions printed */}
      <div className="rounded-md border border-border/70 p-3">
        <p className="text-sm font-medium">Research-corpus freshness</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-4">
          <FreshnessStat label="Sources" value={payload.freshness.sourcesTotal} />
          <FreshnessStat label="With text" value={payload.freshness.withText} />
          <FreshnessStat label="Stale (>180d)" value={payload.freshness.stale} tone={payload.freshness.stale > 0 ? "amber" : undefined} />
          <FreshnessStat label="Last check failed" value={payload.freshness.lastCheckFailed} tone={payload.freshness.lastCheckFailed > 0 ? "amber" : undefined} />
        </div>
        <ul className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
          {Object.entries(payload.freshness.definitions).map(([k, d]) => (
            <li key={k}>· {d}</li>
          ))}
        </ul>
      </div>

      {/* Quality + cost disclosures */}
      {scope === "firm" ? (
        <>
          <S32Note>{(payload as FirmPayload).disclosures.quality}</S32Note>
          <S32Note>{(payload as FirmPayload).disclosures.cost}</S32Note>
        </>
      ) : (
        <S32Note>
          Platform rows contain counts, costs and timings only — keyed by
          opaque ids. No organization names, matter references, or customer
          content can appear here by construction.
        </S32Note>
      )}
    </>
  );
}

function FreshnessStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "amber";
}) {
  return (
    <div className="rounded border border-border/60 p-2 text-center">
      <p className="text-base font-semibold">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      {tone === "amber" && value > 0 && (
        <Badge variant="secondary" className="mt-1 text-[10px]">attention</Badge>
      )}
    </div>
  );
}
