import { ChamberShell } from "@/components/ChamberShell";
import { NewMatterDialog } from "@/pages/Dashboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { Landmark, Plus, Scale, Search, Workflow } from "lucide-react";
import { Link } from "react-router";
import { useMemo, useState } from "react";

type MatterRow = {
  _id: string;
  reference: string;
  title: string;
  status: string;
  practiceArea: string;
  court?: string | null;
  caseNumber?: string | null;
  opposingParty?: string | null;
  priority?: "normal" | "high" | "urgent";
  nextHearingAt?: number;
  clientName?: string | null;
  leadLawyerId?: string | null;
};

// Status filter groups: active/pending covers open + in_progress + on_hold.
const STATUS_FILTERS = [
  ["all", "All"],
  ["active", "Active"],
  ["closed", "Closed"],
  ["archived", "Archived"],
] as const;

function inGroup(status: string, group: string) {
  if (group === "all") return true;
  if (group === "active")
    return status === "open" || status === "in_progress" || status === "on_hold";
  if (group === "closed") return status === "closed" && true;
  if (group === "archived") return status === "closed"; // archived flag checked below
  return true;
}

function statusLabel(s: string) {
  return s === "closed"
    ? "Closed"
    : s === "archived"
      ? "Archived"
      : s.replace(/_/g, " ");
}

export default function Matters() {
  const matters = useQuery(api.matters.list) as (MatterRow & { archivedAt?: number })[] | undefined;
  const team = useQuery(api.workspace.team);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [court, setCourt] = useState<string>("all");
  const [lawyer, setLawyer] = useState<string>("all");
  const [practiceArea, setPracticeArea] = useState<string>("all");
  const [client, setClient] = useState<string>("all");

  // Filter option lists, derived from the register itself.
  const courts = useMemo(
    () =>
      Array.from(new Set((matters ?? []).map((m) => m.court).filter(Boolean) as string[])).sort(),
    [matters],
  );
  const areas = useMemo(
    () =>
      Array.from(new Set((matters ?? []).map((m) => m.practiceArea).filter(Boolean))).sort(),
    [matters],
  );
  const clients = useMemo(
    () =>
      Array.from(new Set((matters ?? []).map((m) => m.clientName).filter(Boolean) as string[])).sort(),
    [matters],
  );

  const rows = (matters ?? []).filter((m) => {
    if (status === "archived") {
      if (!m.archivedAt) return false;
    } else if (!inGroup(m.status, status) || m.archivedAt) {
      return false;
    }
    if (court !== "all" && (m.court ?? "") !== court) return false;
    if (lawyer !== "all" && (m.leadLawyerId ?? "") !== lawyer) return false;
    if (practiceArea !== "all" && m.practiceArea !== practiceArea) return false;
    if (client !== "all" && (m.clientName ?? "") !== client) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      m.reference.toLowerCase().includes(q) ||
      m.title.toLowerCase().includes(q) ||
      m.caseNumber?.toLowerCase().includes(q) ||
      m.practiceArea.toLowerCase().includes(q) ||
      (m.opposingParty ?? "").toLowerCase().includes(q) ||
      (m.clientName ?? "").toLowerCase().includes(q)
    );
  });

  const memberName = (id: string | null | undefined) =>
    (team ?? []).find((t) => t.userId === id)?.name ?? "—";

  return (
    <ChamberShell
      subtitle="The Digital Chamber"
      title="Matters & Cases"
      actions={
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/tasks?tab=playbooks">
              <Workflow className="size-4" aria-hidden="true" />
              Playbooks
            </Link>
          </Button>
          <NewMatterDialog />
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by reference, title, case number, client, opposing party…"
              className="pl-9"
              aria-label="Search matters"
            />
          </div>
          <div
            className="flex gap-1 rounded-md border border-border p-1"
            role="group"
            aria-label="Filter by status"
          >
            {STATUS_FILTERS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatus(key)}
                className={`rounded px-3 py-1 text-sm ${
                  status === key
                    ? "bg-[#B68A45] text-white"
                    : "text-muted-foreground hover:bg-muted"
                }`}
                aria-pressed={status === key}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Register filters: court / lawyer / practice area / client */}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Select value={court} onValueChange={setCourt}>
            <SelectTrigger aria-label="Filter by court">
              <SelectValue placeholder="All courts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All courts</SelectItem>
              {courts.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={lawyer} onValueChange={setLawyer}>
            <SelectTrigger aria-label="Filter by responsible lawyer">
              <SelectValue placeholder="All lawyers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All lawyers</SelectItem>
              {(team ?? []).map((t) => (
                <SelectItem key={t.userId} value={t.userId}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={practiceArea} onValueChange={setPracticeArea}>
            <SelectTrigger aria-label="Filter by practice area">
              <SelectValue placeholder="All practice areas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All practice areas</SelectItem>
              {areas.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={client} onValueChange={setClient}>
            <SelectTrigger aria-label="Filter by client">
              <SelectValue placeholder="All clients" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {clients.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {matters === undefined ? (
          <p className="text-sm text-muted-foreground">Retrieving matters…</p>
        ) : rows.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center text-sm ink-faded">
              No matters match this view.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {rows.map((m) => (
              <Card key={m._id} className="rule-frame bg-card">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="type-label ink-faded">
                        {m.reference}
                        {m.caseNumber ? ` · ${m.caseNumber}` : ""}
                      </p>
                      <Link
                        to={`/matters/${m._id}`}
                        className="font-serif text-lg font-semibold hover:underline"
                      >
                        {m.title}
                      </Link>
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">
                        {m.clientName ?? "—"} · {m.practiceArea}
                        {m.court ? ` · ${m.court}` : ""}
                      </p>
                      {m.opposingParty && (
                        <p className="truncate text-xs text-muted-foreground">
                          vs {m.opposingParty}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <Badge variant="outline" className="capitalize">
                        {statusLabel(m.status)}
                      </Badge>
                      {m.priority === "urgent" && (
                        <Badge variant="destructive">Urgent</Badge>
                      )}
                      {m.priority === "high" && (
                        <Badge variant="secondary">High priority</Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      {m.nextHearingAt
                        ? `Next hearing ${new Date(m.nextHearingAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}`
                        : "No hearing scheduled"}
                      {m.leadLawyerId ? ` · Lead: ${memberName(m.leadLawyerId)}` : ""}
                    </p>
                    <div className="flex gap-1.5">
                      <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                        <Link to={`/matters/${m._id}?tab=issues`}>
                          <Scale className="size-3.5" aria-hidden="true" />
                          Evidence map
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                        <Link to={`/matters/${m._id}?tab=ai`}>
                          <Landmark className="size-3.5" aria-hidden="true" />
                          X-Ray
                        </Link>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </ChamberShell>
  );
}
