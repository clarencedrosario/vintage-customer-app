import { ChamberShell } from "@/components/ChamberShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { formatDateTimeIN } from "@/lib/format";
import { useQuery } from "convex/react";
import {
  CalendarClock,
  FileQuestion,
  Gavel,
  ScrollText,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

const FLAG_ICON: Record<string, typeof Gavel> = {
  no_next_step: CalendarClock,
  overdue_tasks: TriangleAlert,
  order_unreviewed: ScrollText,
  stale_updates: ShieldCheck,
  prep_incomplete: Gavel,
  missing_documents: FileQuestion,
};

const TAB_LABEL: Record<string, string> = {
  overview: "Matter overview",
  tasks: "Tasks",
  orders: "Orders",
  notes: "Notes & updates",
  hearings: "Hearings",
  documents: "Documents",
};

type HealthFlag = {
  key: string;
  label: string;
  severity: "attention" | "info";
  evidence: string[];
  tab: string;
};

type MatterHealth = {
  matterId: string;
  reference: string;
  title: string;
  clientName: string;
  status: string;
  flags: HealthFlag[];
};

type FlagsData = {
  generatedAt: number;
  summary: {
    key: string;
    label: string;
    explanation: string;
    severity: string;
    count: number;
  }[];
  matters: MatterHealth[];
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  on_hold: "On hold",
  closed: "Closed",
};

export default function Health() {
  const data = useQuery(api.health.flags) as FlagsData | null | undefined;
  const [openMatter, setOpenMatter] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<"all" | "attention" | "info">(
    "all",
  );
  const [flagFilter, setFlagFilter] = useState<string>("all");

  const matters = (data?.matters ?? []).filter((m) => {
    if (severityFilter !== "all" && !m.flags.some((f) => f.severity === severityFilter))
      return false;
    if (flagFilter !== "all" && !m.flags.some((f) => f.key === flagFilter)) return false;
    return true;
  });

  return (
    <ChamberShell
      subtitle="The Digital Chamber"
      title="Matter health"
      actions={
        <Badge variant="outline" className="gap-1.5">
          <ShieldCheck className="size-3.5 text-[#B68A45]" aria-hidden="true" />
          {data ? `${data.matters.length} matter${data.matters.length === 1 ? "" : "s"} flagged` : "…"}
        </Badge>
      }
    >
      <div className="space-y-6">
        <div className="rounded-md border border-[#E5E7EB] bg-[#F7F5EF] px-4 py-3 text-sm text-muted-foreground">
          These are <span className="font-medium text-foreground">operational flags</span> —
          they describe the state of the file: work, orders, preparation, documents and
          communication. They are{" "}
          <span className="font-medium text-foreground">
            not a prediction of winning or losing any case.
          </span>
        </div>

        {data === undefined ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : data === null ? (
          <p className="text-sm text-muted-foreground">Sign in to view matter health.</p>
        ) : (
          <>
            {/* Flag legend with explanations */}
            <div className="space-y-2">
              <h2 className="type-label ink-faded">What each flag means</h2>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {data.summary.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => {
                      setFlagFilter(flagFilter === s.key ? "all" : s.key);
                      setSeverityFilter("all");
                    }}
                    className={`rounded-md border px-3 py-2.5 text-left transition-colors ${
                      flagFilter === s.key
                        ? "border-[#B68A45] bg-[#B68A45]/5"
                        : "border-[#E5E7EB] bg-white hover:border-[#B68A45]/50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                        {(() => {
                          const Icon = FLAG_ICON[s.key] ?? ScrollText;
                          return (
                            <Icon
                              className={`size-3.5 ${s.severity === "attention" ? "text-red-700" : "text-[#B68A45]"}`}
                              aria-hidden="true"
                            />
                          );
                        })()}
                        {s.label}
                      </span>
                      <span className="type-label ink-faded">{s.count}</span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {s.explanation}
                    </p>
                  </button>
                ))}
                {data.summary.length === 0 && (
                  <Card className="md:col-span-2 xl:col-span-3">
                    <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                      <ShieldCheck className="size-4 text-[#B68A45]" aria-hidden="true" />
                      No flags across your visible matters — everything with a next step
                      has one, work is on schedule, and clients have been updated.
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="type-label ink-faded">Show:</span>
              {(["all", "attention", "info"] as const).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={severityFilter === s ? "default" : "outline"}
                  className="h-7"
                  onClick={() => setSeverityFilter(s)}
                >
                  {s === "all" ? "All flags" : s === "attention" ? "Needs attention" : "Informational"}
                </Button>
              ))}
              {flagFilter !== "all" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7"
                  onClick={() => setFlagFilter("all")}
                >
                  Clear flag filter
                </Button>
              )}
            </div>

            {/* Per-matter cards */}
            <div className="space-y-3">
              {matters.map((m) => {
                const expanded = openMatter === m.matterId;
                return (
                  <Card key={m.matterId}>
                    <CardContent className="py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              to={`/matters/${m.matterId}`}
                              className="font-serif text-base font-semibold text-foreground hover:text-[#B68A45]"
                            >
                              {m.title}
                            </Link>
                            <span className="type-label ink-faded">{m.reference}</span>
                            <Badge variant="outline" className="text-[11px]">
                              {STATUS_LABEL[m.status] ?? m.status}
                            </Badge>
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {m.clientName}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {m.flags.map((f) => {
                            const Icon = FLAG_ICON[f.key] ?? ScrollText;
                            return (
                              <span
                                key={f.key}
                                title={f.label}
                                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                                  f.severity === "attention"
                                    ? "border-red-200 bg-red-50 text-red-800"
                                    : "border-[#E5E7EB] bg-[#F7F5EF] text-[#64748B]"
                                }`}
                              >
                                <Icon className="size-3" aria-hidden="true" />
                                {f.label}
                              </span>
                            );
                          })}
                        </div>
                      </div>

                      <div className="mt-3 space-y-2">
                        {m.flags.map((f) => {
                          const Icon = FLAG_ICON[f.key] ?? ScrollText;
                          return (
                            <div
                              key={f.key}
                              className="rounded-md border border-[#E5E7EB] px-3 py-2.5"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="flex items-center gap-1.5 text-sm font-medium">
                                  <Icon
                                    className={`size-3.5 ${f.severity === "attention" ? "text-red-700" : "text-[#B68A45]"}`}
                                    aria-hidden="true"
                                  />
                                  {f.label}
                                </span>
                                <Link
                                  to={`/matters/${m.matterId}?tab=${f.tab}`}
                                  className="inline-flex items-center gap-1 text-xs font-medium text-[#B68A45] hover:underline"
                                >
                                  Open {TAB_LABEL[f.tab] ?? f.tab}
                                  <CalendarClock className="size-3" aria-hidden="true" />
                                </Link>
                              </div>
                              {!expanded ? (
                                <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                                  {f.evidence[0]}
                                </p>
                              ) : (
                                <ul className="mt-1.5 space-y-1">
                                  {f.evidence.map((e, i) => (
                                    <li
                                      key={i}
                                      className="flex gap-1.5 text-xs leading-relaxed text-muted-foreground"
                                    >
                                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-[#B68A45]" />
                                      {e}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-2 flex items-center justify-between">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => setOpenMatter(expanded ? null : m.matterId)}
                        >
                          {expanded ? "Show less evidence" : "Show full evidence"}
                        </Button>
                        <span className="type-label ink-faded">
                          {m.flags.length} flag{m.flags.length === 1 ? "" : "s"}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}

              {matters.length === 0 && data.matters.length === 0 && (
                <Card>
                  <CardContent className="py-10 text-center">
                    <ShieldCheck className="mx-auto size-8 text-[#B68A45]" aria-hidden="true" />
                    <p className="mt-2 font-serif text-lg font-semibold">
                      Nothing needs attention
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      No health flags on any matter you can currently open.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>

            <p className="type-label ink-faded">
              Computed live{data.generatedAt ? ` · ${formatDateTimeIN(data.generatedAt)}` : ""}
            </p>
          </>
        )}
      </div>
    </ChamberShell>
  );
}
