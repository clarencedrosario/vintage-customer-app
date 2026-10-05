import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { ChamberShell } from "@/components/ChamberShell";
import { AiQualityDashboard } from "@/components/s32/AiQualityDashboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function inr(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function day(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const SUB_BADGE: Record<string, string> = {
  trialing: "bg-sky-100 text-sky-900 border-sky-200",
  active: "bg-emerald-50 text-emerald-900 border-emerald-200",
  past_due: "bg-amber-50 text-amber-900 border-amber-200",
  grace: "bg-orange-50 text-orange-900 border-orange-200",
  read_only: "bg-stone-100 text-stone-700 border-stone-200",
  closed: "bg-stone-100 text-stone-700 border-stone-200",
  none: "bg-stone-100 text-stone-600 border-stone-200",
};

// ---------------------------------------------------------------------
// Platform console — visible (and functional) only for platform
// administrators. Everyone else gets an honest notice, never a partial
// view of another chamber's records.
// ---------------------------------------------------------------------

export default function Platform() {
  const data = useQuery(api.platform.consoleData);
  const amAdmin = useQuery(api.platform.amIPlatformAdmin);
  const setAdmin = useMutation(api.platform.setPlatformAdminByEmail);
  const grant = useMutation(api.platform.grantExceptionalAccess);
  const revoke = useMutation(api.platform.revokeExceptionalAccess);
  const setStatus = useMutation(api.subscriptions.adminSetSubscriptionStatus);
  const setSeats = useMutation(api.subscriptions.adminSetSeatLimitOverride);

  const [revokeOrg, setRevokeOrg] = useState<{ id: string; name: string } | null>(null);

  const [accessOrg, setAccessOrg] = useState<{ id: string; name: string } | null>(null);
  const [accessReason, setAccessReason] = useState("");
  const [accessHours, setAccessHours] = useState("4");
  const [grantEmail, setGrantEmail] = useState("");

  if (amAdmin === undefined || data === undefined) {
    return (
      <ChamberShell subtitle="The Digital Chamber" title="Platform">
        <p className="mt-10 text-sm text-muted-foreground">Retrieving particulars…</p>
      </ChamberShell>
    );
  }

  if (!amAdmin) {
    return (
      <ChamberShell subtitle="The Digital Chamber" title="Platform">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              This area is restricted to platform administrators.
            </p>
          </CardContent>
        </Card>
      </ChamberShell>
    );
  }

  return (
    <ChamberShell subtitle="The Digital Chamber" title="Platform console">
      <div className="space-y-8">
        {/* §32 Phase 11 — cross-chamber AI usage (counts/costs/timings only,
            opaque org ids; the backend whitelist + leak guard enforce it) */}
        <AiQualityDashboard scope="platform" />

        {/* Summary */}
        <div className="grid gap-4 sm:grid-cols-4">
          {[
            { label: "Trial chambers", value: String(data.counts.subscriptions.trialing) },
            { label: "Paying chambers", value: String(data.counts.subscriptions.active) },
            { label: "Read-only / closed", value: String(data.counts.subscriptions.readOnly) },
            { label: "MRR (active, monthly-normalised)", value: inr(data.counts.subscriptions.mrrMinor) },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="pt-5">
                <p className="type-label">{s.label}</p>
                <p className="mt-1 font-serif text-2xl">{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Plans */}
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">Plans</CardTitle>
            <CardDescription>
              Platform-level catalogue. Changes apply to new checkouts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Seats</TableHead>
                    <TableHead>Trial</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.plans.map((p) => (
                    <TableRow key={p._id}>
                      <TableCell className="text-xs">{p.code}</TableCell>
                      <TableCell className="text-xs">{p.name}</TableCell>
                      <TableCell className="text-xs">{p.kind}</TableCell>
                      <TableCell className="text-xs">
                        {inr(p.priceMinor)}/{p.interval === "yearly" ? "yr" : "mo"}
                      </TableCell>
                      <TableCell className="text-xs">{p.seatLimit ?? "—"}</TableCell>
                      <TableCell className="text-xs">{p.trialDays ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={p.active ? "bg-emerald-50 text-emerald-900 border-emerald-200" : "bg-stone-100 text-stone-700 border-stone-200"}>
                          {p.active ? "active" : "hidden"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {data.plans.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-xs text-muted-foreground">
                        No plans yet — insert saasPlans rows (or wire a plan editor) before chambers can subscribe.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Organizations & subscriptions */}
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">Chambers</CardTitle>
            <CardDescription>
              Membership counts and subscription state. Confidential legal records are never shown here; support access is exceptional, time-boxed, reasoned and audited.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Chamber</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Members</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Period ends</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.orgs.map((o) => (
                    <TableRow key={o.orgId}>
                      <TableCell className="text-xs">
                        <div className="flex items-center gap-2">
                          {o.name}
                          {o.hasLiveAccess && (
                            <button
                              type="button"
                              title="Click to revoke"
                              onClick={() => setRevokeOrg({ id: o.orgId, name: o.name })}
                            >
                              <Badge variant="outline" className="bg-red-50 text-red-900 border-red-200">
                                support access live
                              </Badge>
                            </button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{o.kind}</TableCell>
                      <TableCell className="text-xs">{o.activeMembers}</TableCell>
                      <TableCell className="text-xs">{o.planName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={SUB_BADGE[o.subStatus] ?? ""}>
                          {o.subStatus.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{day(o.currentPeriodEnd)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => {
                              setAccessOrg({ id: o.orgId, name: o.name });
                              setAccessReason("");
                            }}
                          >
                            Support access
                          </Button>
                          {o.subStatus !== "none" && (
                            <>
                              <select
                                className="h-7 rounded-md border border-border bg-background px-1 text-xs"
                                defaultValue=""
                                onChange={async (e) => {
                                  const v = e.target.value;
                                  e.currentTarget.value = "";
                                  if (!v) return;
                                  try {
                                    await setStatus({ subscriptionId: o.subscriptionId as never, status: v as never });
                                    toast.success("Subscription status updated.");
                                  } catch (err) {
                                    toast.error(err instanceof Error ? err.message : "Failed.");
                                  }
                                }}
                              >
                                <option value="">Set status…</option>
                                {["trialing", "active", "past_due", "grace", "read_only", "cancelled", "closed"].map((s) => (
                                  <option key={s} value={s}>
                                    {s.replace("_", " ")}
                                  </option>
                                ))}
                              </select>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                onClick={async () => {
                                  const v = prompt("Seat limit override (blank to reset to plan default):");
                                  if (v === null) return;
                                  try {
                                    await setSeats({
                                      subscriptionId: o.subscriptionId as never,
                                      seatLimit: v.trim() ? Number(v) : undefined,
                                    });
                                    toast.success("Seat limit updated.");
                                  } catch (err) {
                                    toast.error(err instanceof Error ? err.message : "Failed.");
                                  }
                                }}
                              >
                                Seats
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {data.orgs.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-xs text-muted-foreground">
                        No chambers yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Administrator grants */}
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">Administrators</CardTitle>
            <CardDescription>
              Every change here is written to the platform audit log.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex max-w-md items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor="admin-email" className="text-xs">
                  Grant platform administrator (account email)
                </Label>
                <Input
                  id="admin-email"
                  value={grantEmail}
                  onChange={(e) => setGrantEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="h-8 text-xs"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!grantEmail.includes("@")}
                onClick={async () => {
                  try {
                    await setAdmin({ email: grantEmail.trim(), value: true });
                    setGrantEmail("");
                    toast.success("Administrator granted.");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Failed.");
                  }
                }}
              >
                Grant
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Audit trail */}
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">Audit trail</CardTitle>
            <CardDescription>Most recent platform actions.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.audit.map((a) => (
                    <TableRow key={a._id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {new Date(a.createdAt).toLocaleString("en-IN", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>
                      <TableCell className="text-xs">{a.actorName}</TableCell>
                      <TableCell className="text-xs">{a.action}</TableCell>
                      <TableCell className="text-xs">{a.detail ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                  {data.audit.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-xs text-muted-foreground">
                        No platform actions recorded yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Exceptional-access dialog */}
      <Dialog open={!!accessOrg} onOpenChange={(v) => !v && setAccessOrg(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">
              Grant support access — {accessOrg?.name}
            </DialogTitle>
            <DialogDescription>
              Time-boxed and audited. Access ends automatically; you can revoke
              it earlier at any time. Confidential records stay confidential
              even from the platform.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="access-reason" className="text-xs">
                Written reason (minimum 10 characters)
              </Label>
              <textarea
                id="access-reason"
                value={accessReason}
                onChange={(e) => setAccessReason(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder="Support ticket #… — diagnosing reported issue…"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="access-hours" className="text-xs">
                Duration (hours, 1–24)
              </Label>
              <Input
                id="access-hours"
                type="number"
                min={1}
                max={24}
                value={accessHours}
                onChange={(e) => setAccessHours(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setAccessOrg(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={accessReason.trim().length < 10}
                onClick={async () => {
                  if (!accessOrg) return;
                  try {
                    await grant({ orgId: accessOrg.id as never, reason: accessReason, hours: Number(accessHours) || 4 });
                    toast.success("Support access granted and audited.");
                    setAccessOrg(null);
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Failed.");
                  }
                }}
              >
                Grant access
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Revoke-support-access dialog */}
      <Dialog open={!!revokeOrg} onOpenChange={(v) => !v && setRevokeOrg(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif">Revoke support access</DialogTitle>
            <DialogDescription>
              Access to {revokeOrg?.name} ends immediately. The revocation is
              written to the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setRevokeOrg(null)}>
              Keep access
            </Button>
            <Button
              size="sm"
              onClick={async () => {
                if (!revokeOrg) return;
                try {
                  await revoke({ orgId: revokeOrg.id as never });
                  toast.success("Support access revoked.");
                  setRevokeOrg(null);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Failed.");
                }
              }}
            >
              Revoke now
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </ChamberShell>
  );
}
