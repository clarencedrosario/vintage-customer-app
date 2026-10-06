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
import type { FunctionReturnType } from "convex/server";

function tokensFmt(n: number | null): string {
  return n == null ? "—" : n.toLocaleString("en-IN");
}

type PlanRow = FunctionReturnType<typeof api.platform.consoleData>["plans"][number];

const CATEGORY_OPTIONS = [
  { value: "practice", label: "A — Practice Management" },
  { value: "practice_ai", label: "B — Practice Management + AI" },
  { value: "firm_ai", label: "C — Firm / Advanced AI" },
  { value: "enterprise", label: "D — Enterprise (contact sales)" },
] as const;

const SELECT_CLASSES =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
  const savePlan = useMutation(api.subscriptions.upsertPlan);
  const togglePlan = useMutation(api.subscriptions.setPlanActive);
  const leads = useQuery(api.entitlements.listEnterpriseLeads);
  const setLeadStatus = useMutation(api.entitlements.setEnterpriseLeadStatus);

  const [editPlan, setEditPlan] = useState<PlanRow | "new" | null>(null);

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
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="font-serif text-lg">Plans</CardTitle>
                <CardDescription>
                  Platform-level catalogue. Changes apply to new checkouts. Enterprise plans must
                  stay at price 0 — they are contact-sales only.
                </CardDescription>
              </div>
              <Button size="sm" onClick={() => setEditPlan("new")}>
                New plan
              </Button>
            </div>
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
                    <TableHead>Category</TableHead>
                    <TableHead>AI</TableHead>
                    <TableHead>Seats</TableHead>
                    <TableHead>Trial</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.plans.map((p) => (
                    <TableRow key={p._id}>
                      <TableCell className="text-xs">{p.code}</TableCell>
                      <TableCell className="text-xs">{p.name}</TableCell>
                      <TableCell className="text-xs">{p.kind}</TableCell>
                      <TableCell className="text-xs">
                        {p.priceMinor > 0 ? `${inr(p.priceMinor)}/${p.interval === "yearly" ? "yr" : "mo"}` : "not set"}
                      </TableCell>
                      <TableCell className="text-xs">{p.category ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {p.aiEnabled
                          ? `${tokensFmt(p.aiAllowanceTokens)} tok${p.aiAdvancedModel ? " · adv" : ""}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs">{p.seatLimit ?? "—"}</TableCell>
                      <TableCell className="text-xs">{p.trialDays ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={p.active ? "bg-emerald-50 text-emerald-900 border-emerald-200" : "bg-stone-100 text-stone-700 border-stone-200"}>
                          {p.active ? "active" : "hidden"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditPlan(p)}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={async () => {
                              try {
                                await togglePlan({ planId: p._id, active: !p.active });
                                toast.success(p.active ? "Plan hidden from the catalogue." : "Plan published.");
                              } catch (err) {
                                toast.error(err instanceof Error ? err.message : "Could not update the plan.");
                              }
                            }}
                          >
                            {p.active ? "Disable" : "Enable"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {data.plans.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={10} className="text-xs text-muted-foreground">
                        No plans yet — use “New plan” to create the catalogue before chambers can subscribe.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {editPlan && (
          <PlanEditorDialog plan={editPlan === "new" ? null : editPlan} onClose={() => setEditPlan(null)} />
        )}

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

        {/* Enterprise enquiries (turn 27) */}
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">Enterprise enquiries</CardTitle>
            <CardDescription>
              Contact-sales requests from the public pricing page. Reply by email; the status is a
              working note only — nothing here activates or charges a plan.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Received</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Chamber</TableHead>
                    <TableHead>Requirements</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(leads ?? []).map((l) => (
                    <TableRow key={l._id}>
                      <TableCell className="text-xs">{day(l.createdAt)}</TableCell>
                      <TableCell className="text-xs">{l.name}</TableCell>
                      <TableCell className="text-xs">{l.email}</TableCell>
                      <TableCell className="text-xs">
                        {l.orgName ?? "—"}
                        {l.orgSize ? ` · ${l.orgSize}` : ""}
                      </TableCell>
                      <TableCell className="max-w-xs whitespace-pre-wrap text-xs text-muted-foreground">
                        {l.requirements}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Badge
                            variant="outline"
                            className={
                              l.status === "new"
                                ? "bg-amber-50 text-amber-900 border-amber-200"
                                : l.status === "contacted"
                                  ? "bg-sky-50 text-sky-900 border-sky-200"
                                  : "bg-stone-100 text-stone-700 border-stone-200"
                            }
                          >
                            {l.status}
                          </Badge>
                          {l.status === "new" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={async () => {
                                try {
                                  await setLeadStatus({ leadId: l._id, status: "contacted" });
                                } catch (err) {
                                  toast.error(err instanceof Error ? err.message : "Failed.");
                                }
                              }}
                            >
                              Mark contacted
                            </Button>
                          )}
                          {l.status !== "closed" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              onClick={async () => {
                                try {
                                  await setLeadStatus({ leadId: l._id, status: "closed" });
                                } catch (err) {
                                  toast.error(err instanceof Error ? err.message : "Failed.");
                                }
                              }}
                            >
                              Close
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {leads !== undefined && leads.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-xs text-muted-foreground">
                        No enterprise enquiries yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
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

// ---------------------------------------------------------------------
// Plan editor (turn 27) — the only place plans are created or changed
// from the product. Commercial honesty validations live server-side in
// subscriptions.upsertPlan; the form mirrors them and never invents
// values: empty means "not configured", never zero-cost or unlimited.
// ---------------------------------------------------------------------
function PlanEditorDialog({ plan, onClose }: { plan: PlanRow | null; onClose: () => void }) {
  const save = useMutation(api.subscriptions.upsertPlan);
  const [f, setF] = useState(() => ({
    code: plan?.code ?? "",
    name: plan?.name ?? "",
    kind: plan?.kind ?? ("firm" as "individual" | "firm"),
    interval: plan?.interval ?? ("monthly" as "monthly" | "yearly"),
    priceRupees: plan ? (plan.priceMinor / 100).toString() : "",
    seats: plan?.seatLimit?.toString() ?? "",
    storageMb: plan?.storageLimitMb?.toString() ?? "",
    trialDays: plan?.trialDays?.toString() ?? "",
    features: plan?.features.join(", ") ?? "",
    active: plan?.active ?? true,
    category: plan?.category ?? "practice",
    billingUnit: plan?.billingUnit ?? "",
    planGroup: plan?.planGroup ?? "",
    aiEnabled: plan?.aiEnabled ?? false,
    allowance: plan?.aiAllowanceTokens?.toString() ?? "",
    advanced: plan?.aiAdvancedModel ?? false,
    concurrency: plan?.aiMaxConcurrentJobs?.toString() ?? "",
    tax: plan?.taxInclusive == null ? "" : plan.taxInclusive ? "incl" : "excl",
    renewalTerms: plan?.renewalTerms ?? "",
    overagePolicy: plan?.overagePolicy ?? "",
  }));
  const [busy, setBusy] = useState(false);

  const num = (s: string): number | undefined => {
    const t = s.trim();
    if (!t) return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  };

  const submit = async () => {
    const rupees = Number(f.priceRupees.trim() || "0");
    if (!Number.isFinite(rupees) || rupees < 0) {
      toast.error("Price must be a non-negative amount in rupees.");
      return;
    }
    setBusy(true);
    try {
      await save({
        planId: plan?._id,
        code: f.code,
        name: f.name,
        kind: f.kind,
        interval: f.interval,
        priceMinor: Math.round(rupees * 100),
        seatLimit: num(f.seats),
        storageLimitMb: num(f.storageMb),
        trialDays: num(f.trialDays),
        features: f.features
          ? f.features.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined,
        active: f.active,
        category: f.category as "practice" | "practice_ai" | "firm_ai" | "enterprise",
        billingUnit: f.billingUnit ? (f.billingUnit as "per_user" | "per_firm") : undefined,
        planGroup: f.planGroup || undefined,
        aiEnabled: f.aiEnabled,
        aiAllowanceTokens: num(f.allowance),
        aiAdvancedModel: f.advanced,
        aiMaxConcurrentJobs: num(f.concurrency),
        taxInclusive: f.tax === "" ? undefined : f.tax === "incl",
        renewalTerms: f.renewalTerms || undefined,
        overagePolicy: f.overagePolicy || undefined,
      });
      toast.success(plan ? "Plan updated." : "Plan created.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the plan.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif">{plan ? `Edit plan — ${plan.code}` : "New plan"}</DialogTitle>
          <DialogDescription>
            Prices are computed from what you enter here — nothing is inferred. Leave a field blank
            when it is genuinely not configured; the storefront will say so rather than invent a value.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Code</Label>
            <Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="FIRM_AI_MO" className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Display name</Label>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Chamber + AI (monthly)" className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Kind</Label>
            <select className={SELECT_CLASSES} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as "individual" | "firm" })}>
              <option value="individual">individual (single-lawyer chamber)</option>
              <option value="firm">firm</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Billing cycle</Label>
            <select className={SELECT_CLASSES} value={f.interval} onChange={(e) => setF({ ...f, interval: e.target.value as "monthly" | "yearly" })}>
              <option value="monthly">monthly</option>
              <option value="yearly">yearly</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Price (₹; 0 = configuration pending)</Label>
            <Input value={f.priceRupees} onChange={(e) => setF({ ...f, priceRupees: e.target.value })} placeholder="0" className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Plan group (monthly+yearly pair share one, e.g. FIRM_AI)</Label>
            <Input value={f.planGroup} onChange={(e) => setF({ ...f, planGroup: e.target.value })} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Category</Label>
            <select className={SELECT_CLASSES} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as typeof f.category })}>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Billing unit</Label>
            <select className={SELECT_CLASSES} value={f.billingUnit} onChange={(e) => setF({ ...f, billingUnit: e.target.value })}>
              <option value="">(follow kind)</option>
              <option value="per_user">per user</option>
              <option value="per_firm">per firm</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Seat limit (blank = not set)</Label>
            <Input value={f.seats} onChange={(e) => setF({ ...f, seats: e.target.value })} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Storage limit MB (blank = not set)</Label>
            <Input value={f.storageMb} onChange={(e) => setF({ ...f, storageMb: e.target.value })} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Trial days (0–90)</Label>
            <Input value={f.trialDays} onChange={(e) => setF({ ...f, trialDays: e.target.value })} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tax treatment</Label>
            <select className={SELECT_CLASSES} value={f.tax} onChange={(e) => setF({ ...f, tax: e.target.value })}>
              <option value="">not configured (no tax claim shown)</option>
              <option value="incl">prices include tax</option>
              <option value="excl">tax added at checkout</option>
            </select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Feature list (comma-separated, max 12)</Label>
            <Input value={f.features} onChange={(e) => setF({ ...f, features: e.target.value })} className="h-8 text-xs" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Renewal terms shown to customers (plain text)</Label>
            <Input value={f.renewalTerms} onChange={(e) => setF({ ...f, renewalTerms: e.target.value })} placeholder="Renewal runs through a payment link at the end of each period." className="h-8 text-xs" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Overage policy shown to customers (plain text)</Label>
            <Input value={f.overagePolicy} onChange={(e) => setF({ ...f, overagePolicy: e.target.value })} placeholder="No overage is charged automatically — requests pause until the allowance resets." className="h-8 text-xs" />
          </div>
          <div className="rounded-md border border-border p-3 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.aiEnabled} onChange={(e) => setF({ ...f, aiEnabled: e.target.checked })} />
              Plan includes AI
            </label>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">AI allowance tokens/month</Label>
                <Input value={f.allowance} onChange={(e) => setF({ ...f, allowance: e.target.value })} disabled={!f.aiEnabled} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max concurrent AI jobs (1–20)</Label>
                <Input value={f.concurrency} onChange={(e) => setF({ ...f, concurrency: e.target.value })} disabled={!f.aiEnabled} className="h-8 text-xs" />
              </div>
              <label className="mt-5 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={f.advanced} onChange={(e) => setF({ ...f, advanced: e.target.checked })} disabled={!f.aiEnabled} />
                Advanced tier allowed
              </label>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              The advanced tier is only ever offered when the operator has also configured an
              advanced model id (ADVOKATE_ADVANCED_MODEL). An allowance requires AI to be enabled —
              the server refuses otherwise.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
            Active (visible in the catalogue)
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy || !f.code.trim() || !f.name.trim()} onClick={submit}>
            {busy ? "Saving…" : plan ? "Save changes" : "Create plan"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
