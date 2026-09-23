import { ChamberShell } from "@/components/ChamberShell";
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
import { Download, Inbox, ShieldCheck, Upload, Users } from "lucide-react";
import { Link } from "react-router";
import { useState } from "react";

type AdminData = {
  canReview: boolean;
  stats: {
    portalAccounts: number;
    requestsOpen: number;
    pendingReview: number;
    documentsShared: number;
    clientUploads: number;
  };
  requests: {
    _id: string;
    matterId: string;
    matterRef: string;
    title: string;
    status: string;
    dueAt: string | null;
    requestedByName: string;
    reviewedByName: string | null;
    hasSubmission: boolean;
    createdAt: number;
  }[];
  recentClientUploads: {
    _id: string;
    name: string;
    matterRef: string;
    matterId: string;
    createdAt: number;
  }[];
  matters: { _id: string; reference: string; title: string; clientId: string }[];
  clients: { _id: string; name: string }[];
};

const STATUS_FILTERS = [
  ["all", "All"],
  ["requested", "Awaiting client"],
  ["uploaded", "Submitted — review due"],
  ["under_review", "Under review"],
  ["accepted", "Accepted"],
  ["rejected", "Returned"],
] as const;

const STATUS_LABELS: Record<string, string> = {
  requested: "Awaiting client",
  uploaded: "Submitted",
  under_review: "Under review",
  accepted: "Accepted",
  rejected: "Returned",
};

export default function PortalAdmin() {
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");

  const data = useQuery(api.portalAdmin.admin, {
    requestStatus: status as "all" | "requested" | "uploaded" | "under_review" | "accepted" | "rejected",
    search: search || undefined,
  }) as AdminData | null | undefined;

  const stats = data?.stats;

  return (
    <ChamberShell
      subtitle="The Digital Chamber"
      title="Client Portal Administration"
      actions={
        <Button asChild size="sm" variant="outline">
          <Link to="/settings">
            <ShieldCheck className="size-4" aria-hidden="true" />
            Organization settings
          </Link>
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Stats */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["Portal accounts", stats?.portalAccounts, "Clients with shared documents or open requests"],
            ["Requests open", stats?.requestsOpen, "Awaiting a client response"],
            ["Pending review", stats?.pendingReview, "Client submissions awaiting your decision"],
            ["Documents shared", stats?.documentsShared, "Visible to clients through the portal"],
            ["Client uploads", stats?.clientUploads, "Total files submitted by clients"],
          ].map(([label, value, hint]) => (
            <Card key={label as string} className="rule-frame bg-card p-4">
              <p className="type-label ink-faded">{label as string}</p>
              <p className="mt-1 font-serif text-2xl font-semibold">
                {value === undefined ? "…" : (value as number)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{hint as string}</p>
            </Card>
          ))}
        </div>

        {/* Requests inbox */}
        <Card className="rule-frame bg-card">
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <h2 className="flex items-center gap-2 font-serif text-lg font-semibold">
                <Inbox className="size-4" aria-hidden="true" />
                Document requests inbox
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search…"
                  className="h-8 w-40 text-sm"
                  aria-label="Search requests"
                />
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="h-8 w-48 text-sm" aria-label="Filter by status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_FILTERS.map(([k, l]) => (
                      <SelectItem key={k} value={k}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {data === undefined ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">Retrieving…</p>
            ) : data === null ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                Select an organization.
              </p>
            ) : data.requests.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                No document requests match this view.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table w-full">
                  <thead>
                    <tr>
                      <th>Request</th>
                      <th>Matter</th>
                      <th>Status</th>
                      <th>Due</th>
                      <th>Requested by</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.requests.map((r) => (
                      <tr key={r._id}>
                        <td>
                          <span className="font-medium">{r.title}</span>
                          {r.hasSubmission && (
                            <Badge variant="secondary" className="ml-2">
                              Submitted
                            </Badge>
                          )}
                        </td>
                        <td>
                          <Link
                            to={`/matters/${r.matterId}?tab=requests`}
                            className="text-[#8a6a33] underline underline-offset-4"
                          >
                            {r.matterRef}
                          </Link>
                        </td>
                        <td>
                          <Badge
                            variant={
                              r.status === "accepted"
                                ? "secondary"
                                : r.status === "rejected"
                                  ? "destructive"
                                  : r.status === "requested"
                                    ? "outline"
                                    : "default"
                            }
                          >
                            {STATUS_LABELS[r.status] ?? r.status}
                          </Badge>
                        </td>
                        <td className="whitespace-nowrap text-xs text-muted-foreground">
                          {r.dueAt
                            ? new Date(r.dueAt).toLocaleDateString("en-IN", {
                                timeZone: "Asia/Kolkata",
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })
                            : "—"}
                        </td>
                        <td className="text-xs text-muted-foreground">
                          {r.requestedByName}
                          {r.reviewedByName ? ` · reviewed by ${r.reviewedByName}` : ""}
                        </td>
                        <td>
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              variant={r.hasSubmission && data.canReview ? "default" : "ghost"}
                              className="h-7 text-xs"
                              asChild
                            >
                              <Link to={`/matters/${r.matterId}?tab=requests`}>
                                {r.hasSubmission && data.canReview
                                  ? "Review submission"
                                  : "Open on matter"}
                              </Link>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent client uploads */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="rule-frame bg-card">
            <CardContent className="p-0">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <Upload className="size-4" aria-hidden="true" />
                <h2 className="font-serif text-lg font-semibold">
                  Recent client submissions
                </h2>
              </div>
              {data === undefined || data === null ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">Retrieving…</p>
              ) : data.recentClientUploads.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">
                  No client submissions yet.
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {data.recentClientUploads.map((d) => (
                    <div key={d._id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{d.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {d.matterRef} ·{" "}
                          {new Date(d.createdAt).toLocaleDateString("en-IN", {
                            timeZone: "Asia/Kolkata",
                            day: "numeric",
                            month: "short",
                          })}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        asChild
                      >
                        <Link to={`/matters/${d.matterId}?tab=documents`}>
                          Open
                        </Link>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rule-frame bg-card">
            <CardContent className="p-0">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <Users className="size-4" aria-hidden="true" />
                <h2 className="font-serif text-lg font-semibold">
                  Clients with portal presence
                </h2>
              </div>
              {data === undefined || data === null ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">Retrieving…</p>
              ) : (
                <div className="max-h-72 divide-y divide-border overflow-y-auto">
                  {data.clients.map((c) => (
                    <div key={c._id} className="flex items-center justify-between px-4 py-2.5">
                      <p className="text-sm">{c.name}</p>
                      <Link
                        to={`/clients/${c._id}?tab=portal`}
                        className="text-xs text-[#8a6a33] underline underline-offset-4"
                      >
                        Portal access
                      </Link>
                    </div>
                  ))}
                  {data.clients.length === 0 && (
                    <p className="px-4 py-6 text-sm text-muted-foreground">
                      No clients yet.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Download className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Document requests and reviews live inside each matter (the Requests
          tab). This desk is the firm-wide view; every action still happens
          on the matter with the same permission checks.
        </p>
      </div>
    </ChamberShell>
  );
}
