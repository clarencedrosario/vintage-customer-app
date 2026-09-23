import { ChamberShell } from "@/components/ChamberShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { Landmark, Scale, Search, Workflow } from "lucide-react";
import { Link } from "react-router";
import { useState } from "react";

type MatterRow = {
  _id: string;
  reference: string;
  title: string;
  status: string;
  practiceArea: string;
  priority?: "normal" | "high" | "urgent";
  nextHearingAt?: number;
  clientName?: string | null;
};

const STATUS_FILTERS = [
  ["all", "All"],
  ["open", "Open"],
  ["closed", "Closed"],
] as const;

function statusLabel(s: string) {
  return s === "closed"
    ? "Closed"
    : s === "archived"
      ? "Archived"
      : s.replace(/_/g, " ");
}

export default function Matters() {
  const matters = useQuery(api.matters.list) as MatterRow[] | undefined;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");

  const rows = (matters ?? []).filter((m) => {
    if (status === "open" && (m.status === "closed" || m.status === "archived"))
      return false;
    if (status === "closed" && m.status !== "closed") return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      m.reference.toLowerCase().includes(q) ||
      m.title.toLowerCase().includes(q) ||
      m.practiceArea.toLowerCase().includes(q) ||
      (m.clientName ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <ChamberShell
      subtitle="The Digital Chamber"
      title="Matters"
      actions={
        <Button asChild size="sm" variant="outline">
          <Link to="/tasks?tab=playbooks">
            <Workflow className="size-4" aria-hidden="true" />
            Playbooks
          </Link>
        </Button>
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
              placeholder="Search by reference, title, client…"
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
                      <p className="type-label ink-faded">{m.reference}</p>
                      <Link
                        to={`/matters/${m._id}`}
                        className="font-serif text-lg font-semibold hover:underline"
                      >
                        {m.title}
                      </Link>
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">
                        {m.clientName ?? "—"} · {m.practiceArea}
                      </p>
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
