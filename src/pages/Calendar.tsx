import { ChamberShell } from "@/components/ChamberShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Gavel,
  ListChecks,
  ScrollText,
} from "lucide-react";
import { Link } from "react-router";
import { useMemo, useState } from "react";

type DayData = {
  date: string;
  hearings: {
    _id: string;
    matterId: string;
    matterReference: string;
    title: string;
    court: string | null;
    at: number;
    status: string;
    responsibleName: string | null;
  }[];
  deadlines: {
    _id: string;
    matterId: string | null;
    matterReference: string | null;
    title: string;
    category: string;
    dueAt: number;
    responsibleName: string | null;
  }[];
  tasks: {
    _id: string;
    matterId: string;
    matterReference: string;
    title: string;
    dueAt: number;
    assigneeName: string | null;
  }[];
  causeList: {
    _id: string;
    court: string;
    itemNumber: string | null;
    caseTitle: string;
    caseNumber: string | null;
    sourceName: string;
  }[];
};

type MarkedDay = {
  date: string;
  hearings: number;
  deadlines: number;
  tasks: number;
};

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function istParts(d: Date) {
  const y = new Date(d.getTime() + 5.5 * 3600_000).toISOString();
  return {
    day: y.slice(8, 10),
    month: y.slice(5, 7),
    year: y.slice(0, 4),
  };
}

function istToday(): string {
  return istParts(new Date()).year + "-" + istParts(new Date()).month + "-" + istParts(new Date()).day;
}

/** Month grid of IST dates for a given year-month. */
function monthGrid(year: number, month: number): (string | null)[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // Monday-first offset (Mon=0 … Sun=6)
  let dow = first.getUTCDay() - 1;
  if (dow < 0) dow = 6;
  const cells: (string | null)[] = [];
  for (let i = 0; i < dow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(
      `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    );
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export default function CalendarPage() {
  const today = istToday();
  const [selected, setSelected] = useState(today);
  const [viewYear, setViewYear] = useState(Number(today.slice(0, 4)));
  const [viewMonth, setViewMonth] = useState(Number(today.slice(5, 7)));

  const marked = useQuery(api.calendar.markedDays, {
    fromDate: `${viewYear}-${String(viewMonth).padStart(2, "0")}-01`,
    toDate: `${viewYear}-${String(viewMonth).padStart(2, "0")}-31`,
  }) as MarkedDay[] | undefined;
  const day = useQuery(api.calendar.day, { date: selected }) as
    | DayData
    | null
    | undefined;

  const weeks = useMemo(() => monthGrid(viewYear, viewMonth), [viewYear, viewMonth]);
  const markedByDate = useMemo(() => {
    const map = new Map<string, MarkedDay>();
    (marked ?? []).forEach((m) => map.set(m.date, m));
    return map;
  }, [marked]);

  const shiftMonth = (delta: number) => {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setViewMonth(m);
    setViewYear(y);
  };

  const monthName = new Date(Date.UTC(viewYear, viewMonth - 1, 1)).toLocaleString(
    "en-IN",
    { month: "long", year: "numeric", timeZone: "UTC" },
  );

  return (
    <ChamberShell subtitle="The Digital Chamber" title="Calendar">
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Month grid */}
        <Card className="rule-frame bg-card">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-serif text-xl font-semibold">{monthName}</h2>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  onClick={() => shiftMonth(-1)}
                  aria-label="Previous month"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    setViewYear(Number(today.slice(0, 4)));
                    setViewMonth(Number(today.slice(5, 7)));
                    setSelected(today);
                  }}
                >
                  Today
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  onClick={() => shiftMonth(1)}
                  aria-label="Next month"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center">
              {DOW.map((d) => (
                <div key={d} className="type-label ink-faded py-1">
                  {d}
                </div>
              ))}
              {weeks.flat().map((date, i) => {
                if (!date) return <div key={`e${i}`} aria-hidden="true" />;
                const marks = markedByDate.get(date);
                const isSelected = date === selected;
                const isToday = date === today;
                const dom = Number(date.slice(8, 10));
                return (
                  <button
                    key={date}
                    type="button"
                    onClick={() => setSelected(date)}
                    aria-pressed={isSelected}
                    aria-label={`${date}, ${marks ? `${marks.hearings} hearings, ${marks.deadlines} deadlines, ${marks.tasks} tasks` : "no items"}`}
                    className={`flex min-h-[52px] flex-col items-center justify-start rounded border p-1 text-sm transition-colors ${
                      isSelected
                        ? "border-[#B68A45] bg-[#B68A45]/10"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    <span
                      className={`inline-flex size-5 items-center justify-center rounded-full text-xs ${
                        isToday ? "bg-[#B68A45] font-semibold text-white" : ""
                      }`}
                    >
                      {dom}
                    </span>
                    <span className="mt-0.5 flex gap-0.5" aria-hidden="true">
                      {marks && marks.hearings > 0 && (
                        <span className="size-1.5 rounded-full bg-[#8a3b2e]" />
                      )}
                      {marks && marks.deadlines > 0 && (
                        <span className="size-1.5 rounded-full bg-[#B68A45]" />
                      )}
                      {marks && marks.tasks > 0 && (
                        <span className="size-1.5 rounded-full bg-[#4f6b8f]" />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-[#8a3b2e]" /> Hearings
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-[#B68A45]" /> Deadlines
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-[#4f6b8f]" /> Tasks
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Day detail */}
        <div className="space-y-4">
          <h2 className="font-serif text-lg font-semibold">
            {new Date(`${selected}T12:00:00+05:30`).toLocaleDateString("en-IN", {
              weekday: "long",
              day: "numeric",
              month: "long",
              timeZone: "Asia/Kolkata",
            })}
          </h2>
          {day === undefined ? (
            <p className="text-sm text-muted-foreground">Retrieving…</p>
          ) : day === null ? (
            <p className="text-sm text-muted-foreground">Select an organization.</p>
          ) : (
            <>
              {day.hearings.length > 0 && (
                <div className="space-y-2">
                  <p className="type-label ink-faded flex items-center gap-1.5">
                    <Gavel className="size-3.5" aria-hidden="true" /> Hearings
                  </p>
                  {day.hearings.map((h) => (
                    <Card key={h._id} className="rule-frame bg-card p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium">{h.title}</p>
                        <Badge variant="outline" className="capitalize">
                          {h.status}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(h.at).toLocaleTimeString("en-IN", {
                          timeZone: "Asia/Kolkata",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {h.court ? ` · ${h.court}` : ""}
                      </p>
                      <Link
                        to={`/matters/${h.matterId}?tab=hearings`}
                        className="mt-1.5 inline-block text-xs text-[#8a6a33] underline underline-offset-4"
                      >
                        {h.matterReference} — open matter
                      </Link>
                    </Card>
                  ))}
                </div>
              )}
              {day.deadlines.length > 0 && (
                <div className="space-y-2">
                  <p className="type-label ink-faded flex items-center gap-1.5">
                    <Clock className="size-3.5" aria-hidden="true" /> Deadlines
                  </p>
                  {day.deadlines.map((d) => (
                    <div
                      key={d._id}
                      className="rounded-md border border-[#B68A45]/40 bg-[#B68A45]/[0.05] px-3 py-2"
                    >
                      <p className="text-sm font-medium">{d.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {d.matterReference ? `${d.matterReference} · ` : ""}
                        {d.category.replace(/_/g, " ")}
                        {d.responsibleName ? ` · ${d.responsibleName}` : ""}
                      </p>
                      {d.matterId && (
                        <Link
                          to={`/matters/${d.matterId}?tab=overview`}
                          className="mt-1 inline-block text-xs text-[#8a6a33] underline underline-offset-4"
                        >
                          Open matter
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {day.tasks.length > 0 && (
                <div className="space-y-2">
                  <p className="type-label ink-faded flex items-center gap-1.5">
                    <ListChecks className="size-3.5" aria-hidden="true" /> Tasks due
                  </p>
                  {day.tasks.map((t) => (
                    <div
                      key={t._id}
                      className="rounded-md border border-border px-3 py-2"
                    >
                      <p className="text-sm">{t.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t.matterReference}
                        {t.assigneeName ? ` · ${t.assigneeName}` : ""}
                      </p>
                      <Link
                        to={`/matters/${t.matterId}?tab=tasks`}
                        className="mt-1 inline-block text-xs text-[#8a6a33] underline underline-offset-4"
                      >
                        Open matter
                      </Link>
                    </div>
                  ))}
                </div>
              )}
              {day.causeList.length > 0 && (
                <div className="space-y-2">
                  <p className="type-label ink-faded flex items-center gap-1.5">
                    <ScrollText className="size-3.5" aria-hidden="true" /> Cause list
                  </p>
                  {day.causeList.map((c) => (
                    <div
                      key={c._id}
                      className="rounded-md border border-border px-3 py-2"
                    >
                      <p className="text-sm">
                        {c.itemNumber ? `${c.itemNumber}. ` : ""}
                        {c.caseTitle}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {c.court}
                        {c.caseNumber ? ` · ${c.caseNumber}` : ""} · manually
                        imported ({c.sourceName})
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {day.hearings.length === 0 &&
                day.deadlines.length === 0 &&
                day.tasks.length === 0 &&
                day.causeList.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Nothing scheduled on this day.
                  </p>
                )}
            </>
          )}
        </div>
      </div>
    </ChamberShell>
  );
}
