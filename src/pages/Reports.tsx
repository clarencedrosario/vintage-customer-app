import { ChamberShell } from "@/components/ChamberShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import { formatINRCompact, formatDateTimeIN } from "@/lib/format";
import {
  downloadCsv,
  downloadReportPdf,
  printReportTables,
  type ReportRow,
} from "@/lib/reportExports";
import { useQuery } from "convex/react";
import {
  CalendarRange,
  CheckCircle2,
  ClipboardList,
  FileSpreadsheet,
  FolderKanban,
  Gavel,
  Printer,
  Receipt,
  ScrollText,
  Timer,
  Users,
} from "lucide-react";
type ReportsData = {
  generatedAt: number;
  scopeNote: string;
  permissions: { financials: boolean; time: boolean };
  matters: {
    rows: ReportRow[];
    summary: { total: number; open: number; inProgress: number; onHold: number; closed: number };
  };
  hearingsDeadlines: {
    rows: ReportRow[];
    summary: {
      upcomingHearings: number;
      hearingsLast90: number;
      openDeadlines: number;
      overdueDeadlines: number;
    };
  };
  workload: { rows: ReportRow[]; summary: { unassignedTasks: number } };
  overdueTasks: { rows: ReportRow[]; summary: { count: number; oldestDays: number | null } };
  billableTime: {
    rows: ReportRow[];
    summary: { totalHours: number; uninvoicedHours: number; note: string } | null;
  };
  financials: {
    rows: ReportRow[];
    summary: {
      invoicedMinor: number;
      collectedMinor: number;
      outstandingMinor: number;
      overdueMinor: number;
    } | null;
  };
  documentRequests: {
    rows: ReportRow[];
    summary: {
      total: number;
      accepted: number;
      completionPercent: number | null;
      pending: number;
      overdue: number;
    };
  };
};

type SectionDef = {
  id: string;
  title: string;
  icon: typeof Gavel;
  rows: ReportRow[];
  emptyText: string;
  note?: string;
};

const STATUS_TONE: Record<string, string> = {
  Open: "border-[#E5E7EB] bg-[#F7F5EF] text-[#0F172A]",
  "In progress": "border-[#B68A45]/40 bg-[#B68A45]/10 text-[#8a6d3b]",
  "On hold": "border-[#E5E7EB] bg-white text-[#64748B]",
  Closed: "border-[#E5E7EB] bg-white text-[#64748B]",
  overdue: "border-red-200 bg-red-50 text-red-800",
  open: "border-[#E5E7EB] bg-white text-[#0F172A]",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  held: "border-[#E5E7EB] bg-white text-[#64748B]",
  scheduled: "border-[#B68A45]/40 bg-[#B68A45]/10 text-[#8a6d3b]",
  adjourned: "border-[#E5E7EB] bg-white text-[#64748B]",
  cancelled: "border-red-100 bg-red-50 text-red-700",
  accepted: "border-emerald-200 bg-emerald-50 text-emerald-800",
  requested: "border-[#E5E7EB] bg-white text-[#64748B]",
  uploaded: "border-[#B68A45]/40 bg-[#B68A45]/10 text-[#8a6d3b]",
  under_review: "border-[#B68A45]/40 bg-[#B68A45]/10 text-[#8a6d3b]",
  rejected: "border-red-200 bg-red-50 text-red-800",
};

function StatusBadge({ value }: { value: string | number | null }) {
  const v = String(value ?? "");
  const tone = STATUS_TONE[v] ?? "border-[#E5E7EB] bg-white text-[#64748B]";
  return (
    <Badge variant="outline" className={`text-[11px] ${tone}`}>
      {v}
    </Badge>
  );
}

const BADGE_COLS = new Set(["Status", "Type", "Priority", "Overdue"]);

export default function Reports() {
  const data = useQuery(api.reports.get) as ReportsData | null | undefined;
  const caps = useQuery(api.workspace.myCapabilities);
  const canAudit = caps?.capabilities.includes("audit.view") ?? false;
  const audit = useQuery(
    api.workspace.auditTrail,
    canAudit ? { limit: 200 } : "skip",
  ) as
    | { _id: string; at: number; actorName: string; action: string; detail: string | null }[]
    | undefined;

  if (data === undefined) {
    return (
      <ChamberShell subtitle="The Digital Chamber" title="Reports">
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </ChamberShell>
    );
  }

  if (data === null) {
    return (
      <ChamberShell subtitle="The Digital Chamber" title="Reports">
        <p className="text-sm text-muted-foreground">Sign in to view chamber reports.</p>
      </ChamberShell>
    );
  }

  const p = data.permissions;

  const summaryLines = [
    `Matters: ${data.matters.summary.total} visible (${data.matters.summary.open} open, ${data.matters.summary.inProgress} in progress, ${data.matters.summary.onHold} on hold, ${data.matters.summary.closed} closed)`,
    `Hearings: ${data.hearingsDeadlines.summary.upcomingHearings} upcoming, ${data.hearingsDeadlines.summary.hearingsLast90} in the last 90 days`,
    `Deadlines: ${data.hearingsDeadlines.summary.openDeadlines} open, ${data.hearingsDeadlines.summary.overdueDeadlines} overdue`,
    `Tasks: ${data.overdueTasks.summary.count} overdue${data.overdueTasks.summary.oldestDays !== null ? `, oldest ${data.overdueTasks.summary.oldestDays} days` : ""}; ${data.workload.summary.unassignedTasks} unassigned`,
    ...(p.time
      ? [
          `Time: ${data.billableTime.summary!.totalHours} h logged, ${data.billableTime.summary!.uninvoicedHours} h uninvoiced`,
        ]
      : []),
    ...(p.financials
      ? [
          `Invoiced ${formatINRCompact(data.financials.summary!.invoicedMinor / 100)}, collected ${formatINRCompact(data.financials.summary!.collectedMinor / 100)}, outstanding ${formatINRCompact(data.financials.summary!.outstandingMinor / 100)} (overdue ${formatINRCompact(data.financials.summary!.overdueMinor / 100)})`,
        ]
      : []),
    `Document requests: ${data.documentRequests.summary.accepted}/${data.documentRequests.summary.total} accepted${data.documentRequests.summary.completionPercent !== null ? ` (${data.documentRequests.summary.completionPercent}% completion)` : ""}, ${data.documentRequests.summary.overdue} overdue`,
  ];

  const sections: SectionDef[] = [
    {
      id: "matters",
      title: "Matter status",
      icon: FolderKanban,
      rows: data.matters.rows,
      emptyText: "No matters are visible to you yet.",
    },
    {
      id: "hearings",
      title: "Hearings & deadlines",
      icon: CalendarRange,
      rows: data.hearingsDeadlines.rows,
      emptyText: "No hearings or deadlines recorded.",
    },
    {
      id: "workload",
      title: "Team workload",
      icon: Users,
      rows: data.workload.rows,
      emptyText: "No open tasks — nothing to distribute.",
      note:
        data.workload.summary.unassignedTasks > 0
          ? `${data.workload.summary.unassignedTasks} open task${data.workload.summary.unassignedTasks === 1 ? "" : "s"} ha${data.workload.summary.unassignedTasks === 1 ? "s" : "ve"} no assignee.`
          : undefined,
    },
    {
      id: "overdue",
      title: "Overdue tasks",
      icon: ClipboardList,
      rows: data.overdueTasks.rows,
      emptyText: "No overdue tasks. Well kept.",
    },
    ...(p.time
      ? [
          {
            id: "time",
            title: "Billable time",
            icon: Timer,
            rows: data.billableTime.rows,
            emptyText: "No time logged on your visible matters.",
            note: data.billableTime.summary?.note,
          } as SectionDef,
        ]
      : []),
    ...(p.financials
      ? [
          {
            id: "financials",
            title: "Invoiced, collected & outstanding",
            icon: Receipt,
            rows: data.financials.rows,
            emptyText: "No invoices on your visible matters.",
            note: "Amounts include GST where billed; refunds reduce collected amounts.",
          } as SectionDef,
        ]
      : []),
    {
      id: "docRequests",
      title: "Document-request completion",
      icon: CheckCircle2,
      rows: data.documentRequests.rows,
      emptyText: "No document requests raised.",
    },
  ];

  const exportOpts = {
    orgName: "The Digital Chamber",
    generatedAt: data.generatedAt,
    scopeNote: data.scopeNote,
    summaryLines,
    sections: sections.map(({ title, rows, note }) => ({ title, rows, note })),
  };

  const exportFilename = `advokate-reports-${data.generatedAt}`;

  const exportCsvAll = () => {
    for (const s of sections.filter((x) => x.rows.length > 0)) {
      downloadCsv(`${exportFilename}-${s.id}.csv`, s.rows);
    }
  };

  return (
    <ChamberShell
      subtitle="The Digital Chamber"
      title="Reports"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={exportCsvAll}>
            <FileSpreadsheet className="size-4" aria-hidden="true" />
            CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => downloadReportPdf(`${exportFilename}.pdf`, exportOpts)}
          >
            <ScrollText className="size-4" aria-hidden="true" />
            PDF
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => printReportTables(exportOpts)}>
            <Printer className="size-4" aria-hidden="true" />
            Print
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="rounded-md border border-[#E5E7EB] bg-[#F7F5EF] px-4 py-3">
          <p className="text-sm text-muted-foreground">{data.scopeNote}</p>
          <p className="mt-1 text-xs text-muted-foreground/80">
            Generated {formatDateTimeIN(data.generatedAt)} · exports carry the same scope
            as this page.
          </p>
        </div>

        {/* Headline stats */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Matters visible", value: String(data.matters.summary.total) },
            {
              label: "Upcoming hearings",
              value: String(data.hearingsDeadlines.summary.upcomingHearings),
            },
            {
              label: "Overdue tasks",
              value: String(data.overdueTasks.summary.count),
            },
            p.financials
              ? {
                  label: "Outstanding",
                  value: formatINRCompact(data.financials.summary!.outstandingMinor / 100),
                }
              : { label: "Open deadlines", value: String(data.hearingsDeadlines.summary.openDeadlines) },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="py-4">
                <p className="type-label ink-faded">{s.label}</p>
                <p className="mt-1 font-serif text-2xl font-semibold">{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Summary card (matches what exports contain) */}
        <Card>
          <CardContent className="py-4">
            <h2 className="font-serif text-base font-semibold">Summary</h2>
            <ul className="mt-2 grid gap-1.5 text-sm text-muted-foreground md:grid-cols-2">
              {summaryLines.map((l) => (
                <li key={l} className="flex gap-1.5">
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-[#B68A45]" />
                  {l}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Sections */}
        {sections.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.id}>
              <CardContent className="py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 font-serif text-base font-semibold">
                    <Icon className="size-4 text-[#B68A45]" aria-hidden="true" />
                    {s.title}
                    <span className="type-label ink-faded">
                      {s.rows.length} row{s.rows.length === 1 ? "" : "s"}
                    </span>
                  </h2>
                  {s.rows.length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1.5 text-xs"
                      onClick={() => downloadCsv(`${exportFilename}-${s.id}.csv`, s.rows)}
                    >
                      <FileSpreadsheet className="size-3.5" aria-hidden="true" />
                      CSV
                    </Button>
                  )}
                </div>

                {s.rows.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">{s.emptyText}</p>
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {Object.keys(s.rows[0]!).map((h) => (
                            <TableHead key={h} className="whitespace-nowrap">
                              {h}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {s.rows.map((row, ri) => (
                          <TableRow key={ri}>
                            {Object.keys(s.rows[0]!).map((h) => (
                              <TableCell key={h} className="align-top">
                                {BADGE_COLS.has(h) ? (
                                  <StatusBadge value={row[h] ?? null} />
                                ) : (
                                  <span className="text-[13px]">
                                    {row[h] === null || row[h] === undefined
                                      ? "—"
                                      : String(row[h])}
                                  </span>
                                )}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {s.note && s.rows.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground/80">{s.note}</p>
                )}
              </CardContent>
            </Card>
          );
        })}

        {/* Organization-wide audit trail (audit.view capability) */}
        {canAudit && (
          <Card>
            <CardContent className="py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 font-serif text-base font-semibold">
                  <ScrollText className="size-4 text-[#B68A45]" aria-hidden="true" />
                  Audit trail
                  <span className="type-label ink-faded">
                    {audit === undefined
                      ? "…"
                      : `${audit.length} recent entr${audit.length === 1 ? "y" : "ies"}`}
                  </span>
                </h2>
                <span className="type-label ink-faded">append-only</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Matter changes, document events, billing, permissions, exports and
                downloads. Records are written once and cannot be altered from the
                application.
              </p>
              {audit === undefined ? (
                <p className="mt-3 text-sm text-muted-foreground">Loading the trail…</p>
              ) : audit.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  No audit entries recorded yet.
                </p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="whitespace-nowrap">When</TableHead>
                        <TableHead className="whitespace-nowrap">Actor</TableHead>
                        <TableHead className="whitespace-nowrap">Action</TableHead>
                        <TableHead>Detail</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {audit.map((r) => (
                        <TableRow key={r._id}>
                          <TableCell className="whitespace-nowrap text-[13px]">
                            {formatDateTimeIN(r.at)}
                          </TableCell>
                          <TableCell className="text-[13px]">{r.actorName}</TableCell>
                          <TableCell className="text-[13px]">{r.action}</TableCell>
                          <TableCell className="text-[13px]">
                            {r.detail ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <p className="type-label ink-faded">
          These reports describe chamber activity — they are not a prediction of the
          outcome of any matter.
        </p>
      </div>
    </ChamberShell>
  );
}
