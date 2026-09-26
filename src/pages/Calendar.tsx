import { ChamberShell } from "@/components/ChamberShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useEffect, useMemo, useState } from "react";

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

type RangeHearing = {
  _id: string;
  at: number;
  status: string;
  title: string;
  court: string | null;
  courtroom: string | null;
  purpose: string | null;
  judge: string | null;
  matterId: string;
  matterReference: string;
  matterTitle: string;
  leadLawyerId: string | null;
  leadLawyerName: string | null;
  appearingAdvocateName: string | null;
};

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type ViewMode = "day" | "week" | "month" | "list";

function istParts(d: Date) {
  const y = new Date(d.getTime() + 5.5 * 3600_000).toISOString();
  return {
    year: y.slice(0, 4),
    month: y.slice(5, 7),
    day: y.slice(8, 10),
  };
}

function istToday(): string {
  return istParts(new Date()).year + "-" + istParts(new Date()).month + "-" + istParts(new Date()).day;
}

/** YYYY-MM-DD of a timestamp in IST. */
function istDate(ts: number): string {
  return new Date(ts + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/** Month grid of IST dates for a given year-month. */
function monthGrid(year: number, month: number): (string | null)[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // Monday-first offset (Mon=0 … Sun=6)
  const offset = (first.getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
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

/** Monday of the IST week containing the given IST date. */
function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00+05:30`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function CalendarPage() {
  const today = istToday();
  const [selected, setSelected] = useState(today);
  const [view, setView] = useState<ViewMode>("month");
  const [viewYear, setViewYear] = useState(Number(today.slice(0, 4)));
  const [viewMonth, setViewMonth] = useState(Number(today.slice(5, 7)));

  // Filters — court / lawyer / matter / courtroom.
  const [fCourt, setFCourt] = useState("all");
  const [fLawyer, setFLawyer] = useState("all");
  const [fMatter, setFMatter] = useState("all");
  const [fCourtroom, setFCourtroom] = useState("all");

  const marked = useQuery(api.calendar.markedDays, {
    fromDate: `${viewYear}-${String(viewMonth).padStart(2, "0")}-01`,
    toDate: `${viewYear}-${String(viewMonth).padStart(2, "0")}-31`,
  }) as MarkedDay[] | undefined;
  const day = useQuery(api.calendar.day, { date: selected }) as
    | DayData
    | null
    | undefined;

  // Range query powers week/list/day-strip views. Month needs ~31 days;
  // list shows the current month by default.
  const rangeFrom =
    view === "week"
      ? mondayOf(selected)
      : view === "day"
        ? selected
        : `${viewYear}-${String(viewMonth).padStart(2, "0")}-01`;
  const rangeTo =
    view === "week"
      ? addDays(mondayOf(selected), 6)
      : view === "day"
        ? selected
        : `${viewYear}-${String(viewMonth).padStart(2, "0")}-31`;
  const rangeHearings = useQuery(api.calendar.range, {
    fromDate: rangeFrom,
    toDate: rangeTo,
  }) as RangeHearing[] | undefined;

  // Keep the month header in sync with week navigation.
  useEffect(() => {
    if (view === "week") {
      const d = mondayOf(selected);
      setViewYear(Number(d.slice(0, 4)));
      setViewMonth(Number(d.slice(5, 7)));
    }
  }, [view, selected]);

  const matters = useQuery(api.matters.list) as
    | { _id: string; reference: string; title: string; court?: string | null; leadLawyerId?: string | null }[]
    | undefined;
  const team = useQuery(api.workspace.team) as
    | { userId: string; name: string | null }[]
    | undefined;

  const weeks = useMemo(() => monthGrid(viewYear, viewMonth), [viewYear, viewMonth]);
  const markedByDate = useMemo(() => {
    const map = new Map<string, MarkedDay>();
    (marked ?? []).forEach((m) => map.set(m.date, m));
    return map;
  }, [marked]);

  // Filter option lists derived from the chamber's own data.
  const courtOptions = useMemo(() => {
    const set = new Set<string>();
    for (const h of rangeHearings ?? []) if (h.court) set.add(h.court);
    for (const m of matters ?? []) if (m.court) set.add(m.court);
    return Array.from(set).sort();
  }, [rangeHearings, matters]);
  const courtroomOptions = useMemo(() => {
    const set = new Set<string>();
    for (const h of rangeHearings ?? []) if (h.courtroom) set.add(h.courtroom);
    return Array.from(set).sort();
  }, [rangeHearings]);

  const passesFilters = (h: RangeHearing) =>
    (fCourt === "all" || h.court === fCourt) &&
    (fLawyer === "all" || h.leadLawyerId === fLawyer) &&
    (fMatter === "all" || h.matterId === fMatter) &&
    (fCourtroom === "all" || (h.courtroom ?? "") === fCourtroom);

  const filteredRange = (rangeHearings ?? []).filter(passesFilters);

  // Group range hearings by IST day for the week/day boards.
  const byDay = useMemo(() => {
    const map = new Map<string, RangeHearing[]>();
    for (const h of filteredRange) {
      const k = istDate(h.at);
      const arr = map.get(k) ?? [];
      arr.push(h);
      map.set(k, arr);
    }
    return map;
  }, [filteredRange]);

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

  const filterBar = (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <Select value={fCourt} onValueChange={setFCourt}>
        <SelectTrigger aria-label="Filter by court">
          <SelectValue placeholder="All courts" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All courts</SelectItem>
          {courtOptions.map((c) => (
            <SelectItem key={c} value={c}>{c}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={fLawyer} onValueChange={setFLawyer}>
        <SelectTrigger aria-label="Filter by lawyer">
          <SelectValue placeholder="All lawyers" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All lawyers</SelectItem>
          {(team ?? []).map((t) => (
            <SelectItem key={t.userId} value={t.userId}>
              {t.name ?? "Member"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={fMatter} onValueChange={setFMatter}>
        <SelectTrigger aria-label="Filter by matter">
          <SelectValue placeholder="All matters" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All matters</SelectItem>
          {(matters ?? []).map((m) => (
            <SelectItem key={m._id} value={m._id}>
              {m.reference} — {m.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={fCourtroom} onValueChange={setFCourtroom}>
        <SelectTrigger aria-label="Filter by courtroom">
          <SelectValue placeholder="All courtrooms" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All courtrooms</SelectItem>
          {courtroomOptions.map((c) => (
            <SelectItem key={c} value={c}>{c}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const hearingTime = (ts: number) =>
    new Date(ts).toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <ChamberShell subtitle="The Digital Chamber" title="Hearing Calendar">
      <div className="space-y-5">
        {/* View switcher */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            className="flex gap-1 rounded-md border border-border p-1"
            role="group"
            aria-label="Calendar view"
          >
            {(
              [
                ["day", "Day"],
                ["week", "Week"],
                ["month", "Month"],
                ["list", "List"],
              ] as [ViewMode, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={`rounded px-3 py-1 text-sm ${
                  view === key
                    ? "bg-[#B68A45] text-white"
                    : "text-muted-foreground hover:bg-muted"
                }`}
                aria-pressed={view === key}
              >
                {label}
              </button>
            ))}
          </div>
          {view !== "month" && view !== "list" && (
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                onClick={() => setSelected(addDays(selected, view === "week" ? -7 : -1))}
                aria-label="Previous"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setSelected(today)}
              >
                Today
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                onClick={() => setSelected(addDays(selected, view === "week" ? 7 : 1))}
                aria-label="Next"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </div>

        {filterBar}

        {/* Month grid */}
        {(view === "month" || view === "day") && (
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
        )}

        {/* Week strip */}
        {view === "week" && (
          <Card className="rule-frame bg-card">
            <CardContent className="p-4">
              <h2 className="mb-3 font-serif text-lg font-semibold">
                Week of{" "}
                {new Date(`${mondayOf(selected)}T12:00:00+05:30`).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "long",
                  timeZone: "Asia/Kolkata",
                })}
              </h2>
              <div className="grid gap-2 sm:grid-cols-7">
                {Array.from({ length: 7 }, (_, i) => addDays(mondayOf(selected), i)).map((d) => {
                  const items = byDay.get(d) ?? [];
                  const isToday = d === today;
                  return (
                    <div
                      key={d}
                      className={`min-h-[120px] rounded border p-2 ${
                        isToday ? "border-[#B68A45] bg-[#B68A45]/[0.06]" : "border-border"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(d);
                          setView("day");
                        }}
                        className="type-label w-full text-left hover:underline"
                      >
                        {new Date(`${d}T12:00:00+05:30`).toLocaleDateString("en-IN", {
                          weekday: "short",
                          day: "numeric",
                          timeZone: "Asia/Kolkata",
                        })}
                      </button>
                      <div className="mt-1 space-y-1">
                        {items.map((h) => (
                          <Link
                            key={h._id}
                            to={`/matters/${h.matterId}?tab=hearings`}
                            className="block rounded bg-[#8a3b2e]/10 px-1.5 py-1 text-[11px] leading-tight hover:bg-[#8a3b2e]/20"
                          >
                            {hearingTime(h.at)} · {h.matterReference}
                          </Link>
                        ))}
                        {items.length === 0 && (
                          <p className="text-[11px] text-muted-foreground">—</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* List view — every hearing in range with full record fields */}
        {view === "list" && (
          <Card className="rule-frame bg-card">
            <CardContent className="p-4">
              <h2 className="mb-3 font-serif text-lg font-semibold">
                Hearings — {monthName}
              </h2>
              {rangeHearings === undefined ? (
                <p className="text-sm text-muted-foreground">Retrieving…</p>
              ) : filteredRange.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No hearings match these filters this month.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table w-full text-sm">
                    <thead>
                      <tr>
                        <th className="text-left">Date &amp; time</th>
                        <th className="text-left">Matter</th>
                        <th className="text-left">Purpose</th>
                        <th className="text-left">Court</th>
                        <th className="text-left">Courtroom</th>
                        <th className="text-left">Judge</th>
                        <th className="text-left">Advocate</th>
                        <th className="text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRange.map((h) => (
                        <tr key={h._id}>
                          <td className="whitespace-nowrap">
                            {new Date(`${istDate(h.at)}T12:00:00+05:30`).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                              timeZone: "Asia/Kolkata",
                            })}
                            , {hearingTime(h.at)}
                          </td>
                          <td>
                            <Link
                              to={`/matters/${h.matterId}?tab=hearings`}
                              className="text-[#8a6a33] underline underline-offset-4"
                            >
                              {h.matterReference}
                            </Link>
                            <span className="block text-xs text-muted-foreground">
                              {h.matterTitle}
                            </span>
                          </td>
                          <td>{h.purpose ?? h.title}</td>
                          <td>{h.court ?? "—"}</td>
                          <td>{h.courtroom ?? "—"}</td>
                          <td>{h.judge ?? "—"}</td>
                          <td>
                            {h.appearingAdvocateName ?? h.leadLawyerName ?? "—"}
                          </td>
                          <td>
                            <Badge variant="outline" className="capitalize">
                              {h.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Day detail (month/day views) */}
        {(view === "month" || view === "day") && (
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
        )}
      </div>
    </ChamberShell>
  );
}
