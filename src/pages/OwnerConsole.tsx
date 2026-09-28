import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { ChamberShell } from "@/components/ChamberShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Headset, Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import { appLink } from "@/lib/appLinks";

// The owner holds every platform capability (mirror of the server-side
// rule in platformOps.requirePlatformCapability / platformWorkforce).
const OWNER_PLATFORM_CAPS = [
  "platform.ticket.view_queue",
  "platform.ticket.reply",
  "platform.ticket.claim",
  "platform.ticket.resolve_close",
  "platform.ticket.set_priority",
  "platform.handoff.view",
  "platform.handoff.rebuild",
  "platform.team.manage",
  "platform.diagnostics.view",
];
import { Link } from "react-router";

// =====================================================================
// CJ GLOBAL — /owner: the platform operator console.
//
// One screen for platform operations: live ticket queue with triage
// actions, health counters, and the operations audit trail. This is
// deliberately SEPARATE from /platform (the section-24 subscription
// console) — that page manages chambers and billing; this page manages
// customer support. Both gate on users.isPlatformAdmin server-side.
// =====================================================================

const STATUS_BADGE: Record<string, string> = {
  open: "bg-sky-100 text-sky-900 border-sky-200",
  in_progress: "bg-amber-50 text-amber-900 border-amber-200",
  resolved: "bg-emerald-50 text-emerald-900 border-emerald-200",
};

const PRIORITY_BADGE: Record<string, string> = {
  low: "bg-stone-100 text-stone-700 border-stone-200",
  normal: "bg-stone-100 text-stone-700 border-stone-200",
  high: "bg-orange-50 text-orange-900 border-orange-200",
  urgent: "bg-red-50 text-red-900 border-red-200",
};

const KIND_LABELS: Record<string, string> = {
  general: "General",
  billing: "Billing & subscription",
  technical: "Technical issue",
  account: "Account access",
  ai_escalation: "AI handoff",
};

function when(ts?: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

// =====================================================================
// CJ GLOBAL Team & Access — internal workforce management (owner only).
//
// Distinct from the chamber Team page: this manages platform employees
// (support_agent / support_supervisor / developer) whose membership lives
// in platformEmployees — independent of any chamber. Invites carry a
// one-time token; the raw token is shown once and never stored server-
// side. No "owner" role exists to invite: ownership is the audited
// isPlatformAdmin flag, so employees cannot grant themselves or anyone
// else platform ownership.
// =====================================================================

const PLATFORM_ROLE_LABELS: Record<string, string> = {
  support_agent: "Support Agent",
  support_supervisor: "Support Supervisor",
  developer: "Developer",
};

function WorkforcePanel() {
  const employees = useQuery(api.workforce.listEmployees);
  const invites = useQuery(api.workforce.listInvitations);
  const invite = useMutation(api.workforce.inviteEmployee);
  const revoke = useMutation(api.workforce.revokeInvitation);
  const suspend = useMutation(api.workforce.suspendEmployee);
  const unsuspend = useMutation(api.workforce.unsuspendEmployee);
  const setEmployeeRoleFn = useMutation(api.workforce.setEmployeeRole);

  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("support_agent");
  const [busy, setBusy] = useState(false);
  const [lastToken, setLastToken] = useState<{ email: string; url: string } | null>(null);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    }
  };

  const sendInvite = async () => {
    // One-time token generated client-side, shown ONCE in the copyable
    // link, stored server-side only as salted SHA-256.
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes)
      .map((b) => b.toString(36).padStart(2, "0"))
      .join("")
      .slice(0, 32);
    setBusy(true);
    try {
      await invite({ email: email.trim(), role: inviteRole as never, token });
      setLastToken({
        email: email.trim(),
        url: appLink(`/accept-platform-invite?token=${token}`),
      });
      setEmail("");
      toast.success("Invitation created — share the link with the invitee.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invite failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg">Invite a platform employee</CardTitle>
          <CardDescription>
            CJ GLOBAL internal roles only — support agents work the queue,
            supervisors additionally see the handoff view and audit, developers
            get diagnostics. There is no invitable owner role: platform
            ownership is bound to one verified account by audited activation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex max-w-xl flex-wrap items-end gap-2">
            <div className="min-w-[220px] flex-1 space-y-1">
              <Label htmlFor="wf-email" className="text-xs">Work email</Label>
              <Input
                id="wf-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="agent@example.com"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Platform role</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger className="h-8 w-[190px] text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PLATFORM_ROLE_LABELS).map(([v, label]) => (
                    <SelectItem key={v} value={v}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" disabled={busy || !email.includes("@")} onClick={sendInvite}>
              Create invite
            </Button>
          </div>
          {lastToken && (
            <div className="rounded-md border border-[#B68A45]/40 bg-[#B68A45]/[0.06] p-3">
              <p className="text-xs font-medium">
                One-time link for {lastToken.email} — shown once, stored only as a hash:
              </p>
              <div className="mt-1 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 text-[11px]">
                  {lastToken.url}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => {
                    void navigator.clipboard.writeText(lastToken.url);
                    toast.success("Link copied.");
                  }}
                >
                  Copy
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg">Pending invitations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Invited</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites === undefined && (
                  <TableRow><TableCell colSpan={5} className="text-xs text-muted-foreground">Loading…</TableCell></TableRow>
                )}
                {invites?.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-xs text-muted-foreground">No pending invitations.</TableCell></TableRow>
                )}
                {invites?.map((inv) => (
                  <TableRow key={inv._id}>
                    <TableCell className="text-xs">{inv.email}</TableCell>
                    <TableCell className="text-xs">{PLATFORM_ROLE_LABELS[inv.role] ?? inv.role}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{when(inv.createdAt)}</TableCell>
                    <TableCell>
                      {inv.revokedAt ? (
                        <Badge variant="outline" className="bg-stone-100 text-stone-700 border-stone-200">Revoked</Badge>
                      ) : inv.expired ? (
                        <Badge variant="outline" className="bg-stone-100 text-stone-700 border-stone-200">Expired</Badge>
                      ) : (
                        <Badge variant="outline" className="bg-sky-100 text-sky-900 border-sky-200">Pending</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {!inv.revokedAt && !inv.expired && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => act(() => revoke({ invitationId: inv._id }), "Invitation revoked.")}
                        >
                          Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg">Platform employees</CardTitle>
          <CardDescription>
            Membership is platform-level: nothing here touches chamber
            memberships, and suspending access takes effect immediately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Accepted</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees === undefined && (
                  <TableRow><TableCell colSpan={5} className="text-xs text-muted-foreground">Loading…</TableCell></TableRow>
                )}
                {employees?.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-xs text-muted-foreground">No platform employees yet.</TableCell></TableRow>
                )}
                {employees?.map((emp) => (
                  <TableRow key={emp._id}>
                    <TableCell className="text-xs">{emp.email}</TableCell>
                    <TableCell>
                      <Select
                        value={emp.role}
                        onValueChange={(v: string) =>
                          void act(() => setEmployeeRoleFn({ employeeId: emp._id, role: v as never }), "Role updated.")
                        }
                      >
                        <SelectTrigger className="h-7 w-[180px] text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(PLATFORM_ROLE_LABELS).map(([v, label]) => (
                            <SelectItem key={v} value={v}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {emp.status === "active" ? (
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-900 border-emerald-200">Active</Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 text-red-900 border-red-200">Suspended</Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{when(emp.acceptedAt)}</TableCell>
                    <TableCell>
                      {emp.status === "active" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => act(() => suspend({ employeeId: emp._id }), "Access suspended.")}
                        >
                          Suspend
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => act(() => unsuspend({ employeeId: emp._id }), "Access restored.")}
                        >
                          Restore
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// =====================================================================
// Section 26 — Advokate Legal Intelligence: operator seed panel.
// Idempotent: the Indian core statutes, IPC↔BNS verified cross-references,
// the European coverage register and the evaluation set. Seeding registers
// sources with provenance and honest coverage statuses — it does NOT
// fabricate legal text; ingestion fills content via the pipeline.
// =====================================================================
function LegalIntelSeedPanel() {
  const seedIndia = useMutation(api.legalIntel.seedIndianCore);
  const seedEurope = useMutation(api.legalIntel.seedEuropeanCoverage);
  const seedEval = useMutation(api.legalIntel.seedEvalCases);
  const coverage = useQuery(api.legalIntel.coverage, {});
  const freshness = useQuery(api.legalIntel.freshness, {});
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-serif text-xl">Advokate Legal Intelligence — source library</CardTitle>
        <CardDescription>
          Registers the verified Indian core (Constitution, IPC, CrPC, Evidence
          Act, BNS, BNSS, BSA, POCSO) with official-source provenance, the
          IPC↔BNS verified cross-references, the European coverage register
          (all states, honest not_started statuses) and adversarial evaluation
          cases. Seeding creates registry entries — legal text arrives only
          through ingestion.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => run(() => seedIndia({}), "Indian core registered.")}
          >
            Seed Indian core
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => run(() => seedEurope({}), "European coverage register seeded.")}
          >
            Seed European register
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => run(() => seedEval({}), "Evaluation cases seeded.")}
          >
            Seed evaluation cases
          </Button>
        </div>
        {coverage && coverage.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Registered countries: {coverage.length} · sources tracked:{" "}
            {freshness?.length ?? 0}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function OwnerConsole() {
  const amAdmin = useQuery(api.platform.amIPlatformAdmin);
  const identity = useQuery(api.workforce.myPlatformIdentity);
  const eligibility = useQuery(api.platform.myOwnerActivationEligibility);
  const selfActivate = useMutation(api.platform.selfActivateOwner);
  const counts = useQuery(api.platformOps.opsCounts);
  const queue = useQuery(api.platformOps.operatorQueue);
  const audit = useQuery(api.platformOps.opsAudit, { limit: 50 });
  const handoffRows = useQuery(api.platformOps.handoffViewRows);
  const rebuildView = useMutation(api.platformOps.rebuildAiHandoffStats);

  const start = useMutation(api.platformOps.startProgress);
  const reply = useMutation(api.platformOps.addOperatorMessage);
  const assign = useMutation(api.platformOps.assignTicket);
  const setPriority = useMutation(api.platformOps.setTicketPriority);
  const resolve = useMutation(api.platformOps.resolveTicket);
  const close = useMutation(api.platformOps.closeTicket);
  const reopen = useMutation(api.platformOps.reopenTicket);

  // Selected ticket detail (operator read of the full thread).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detail = useQuery(
    api.platformOps.getTicket,
    selectedId ? { ticketId: selectedId as never } : "skip",
  );

  const [replyText, setReplyText] = useState("");
  const [resolveOpen, setResolveOpen] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState("");
  const [reopenOpen, setReopenOpen] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState("");
  const [rebuilding, setRebuilding] = useState(false);
  const [activating, setActivating] = useState(false);
  const [challengeCode, setChallengeCode] = useState("");
  const [challengeBusy, setChallengeBusy] = useState(false);
  const verifyMfa = useMutation(api.twofactor.verifyForSession);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    }
  };

  // Capability-derived UI gating — mirrors the server's gate exactly; the
  // server remains authoritative when capabilities change mid-session.
  const isPlatformIdentity =
    amAdmin === true || (identity?.platformRole ?? null) !== null;
  const caps = new Set<string>([
    ...(amAdmin ? OWNER_PLATFORM_CAPS : []),
    ...(identity?.capabilities ?? []),
  ]);

  // Internal accounts (owner + workforce) must complete the per-session
  // MFA challenge before ANY console content renders. The sign-in OTP is
  // authentication, not a second factor — this is the second factor.
  const needsMfaChallenge =
    identity?.internalMfa?.enrolled === true &&
    identity.internalMfa.satisfied === false;
  const mfaIncomplete =
    isPlatformIdentity === true &&
    identity !== null &&
    identity !== undefined &&
    identity.internalMfa?.enrolled !== true;

  if (isPlatformIdentity && needsMfaChallenge) {
    return (
      <ChamberShell subtitle="CJ Global" title="Operations console">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Two-factor challenge required for this session. Enter the 6-digit
              code from your authenticator app, or one of your recovery codes.
            </p>
            <div className="flex gap-2">
              <Input
                value={challengeCode}
                onChange={(e) => setChallengeCode(e.target.value)}
                placeholder="123456 or recovery code"
                className="max-w-[240px] font-mono"
              />
              <Button
                size="sm"
                disabled={challengeBusy || challengeCode.trim().length === 0}
                onClick={async () => {
                  setChallengeBusy(true);
                  try {
                    await verifyMfa({ code: challengeCode.trim() });
                    setChallengeCode("");
                    window.location.reload();
                  } catch (err) {
                    toast.error(
                      err instanceof Error ? err.message : "Verification failed.",
                    );
                  } finally {
                    setChallengeBusy(false);
                  }
                }}
              >
                Verify
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              No authenticator set up yet? Enroll under Settings → Security —
              the emailed sign-in code does not count as a second factor.
            </p>
          </CardContent>
        </Card>
      </ChamberShell>
    );
  }

  if (isPlatformIdentity && mfaIncomplete) {
    return (
      <ChamberShell subtitle="CJ Global" title="Operations console">
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Two-factor authentication is required for platform accounts.
              Complete enrollment under Settings → Security (authenticator app
              plus recovery codes), then return here.
            </p>
            <Button asChild size="sm" variant="outline">
              <Link to="/settings">Open Settings → Security</Link>
            </Button>
          </CardContent>
        </Card>
      </ChamberShell>
    );
  }

  if (amAdmin === undefined || identity === undefined) {
    return (
      <ChamberShell subtitle="CJ Global" title="Operations console">
        <p className="mt-10 text-sm text-muted-foreground">Checking access…</p>
      </ChamberShell>
    );
  }

  // Customers and chamber-only accounts: activation card if eligible,
  // otherwise a bare refusal. No queue content is ever rendered.
  if (!isPlatformIdentity) {
    return (
      <ChamberShell subtitle="CJ Global" title="Operations console">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              This console is restricted to platform operators. Chamber owners
              manage their own chamber from the practice console; customer
              tickets are handled exclusively here.
            </p>
            {eligibility?.eligible && (
              <div className="rounded-md border border-[#B68A45]/40 bg-[#B68A45]/[0.06] p-4">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck className="size-4 text-[#8a6a33]" aria-hidden="true" />
                  This account is the configured platform owner.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Activation is verified server-side against your signed-in,
                  email-verified identity and is written to the platform audit
                  log. No other account can activate here.
                </p>
                <Button
                  size="sm"
                  className="mt-3"
                  disabled={activating}
                  onClick={async () => {
                    setActivating(true);
                    try {
                      await selfActivate({});
                      toast.success("Platform ownership activated.");
                      window.location.reload();
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Activation failed.");
                      setActivating(false);
                    }
                  }}
                >
                  {activating ? "Activating…" : "Activate platform ownership"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </ChamberShell>
    );
  }

  const selected = detail?.ticket;
  const canSeeQueue = caps.has("platform.ticket.view_queue");
  const canReply = caps.has("platform.ticket.reply");
  const canClaim = caps.has("platform.ticket.claim");
  const canResolve = caps.has("platform.ticket.resolve_close");
  const canSetPriority = caps.has("platform.ticket.set_priority");
  const canSeeHandoff = caps.has("platform.handoff.view");
  const canRebuild = caps.has("platform.handoff.rebuild");
  const canSeeAudit = caps.has("platform.diagnostics.view");
  const canManageTeam = amAdmin === true; // workforce admin is owner-only

  return (
    <ChamberShell
      subtitle="CJ Global"
      title="Operations console"
      actions={
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <Shield className="size-3.5" aria-hidden="true" />
          Platform operator
        </span>
      }
    >
      <div className="space-y-8">
        {/* CJ GLOBAL Team & Access — owner-only workforce management */}
        {canManageTeam && <WorkforcePanel />}

        {/* Section 26: Legal Intelligence library seed (operator action). */}
        {canManageTeam && <LegalIntelSeedPanel />}

        {/* Health counters */}
        {canSeeQueue && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { label: "Open", value: counts?.byStatus.open, tone: "text-sky-900" },
            { label: "In progress", value: counts?.byStatus.in_progress, tone: "text-amber-900" },
            { label: "Unassigned", value: counts?.unassigned, tone: "text-orange-900" },
            {
              label: "AI handoffs live",
              value: counts?.aiEscalationsOpen,
              tone: "text-[#8a6a33]",
            },
            {
              label: "No first response >24h",
              value: counts?.awaitingFirstResponse,
              tone: "text-red-900",
            },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="pt-5">
                <p className="type-label">{s.label}</p>
                <p className={`mt-1 font-serif text-2xl ${s.tone}`}>
                  {s.value ?? "—"}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
        )}

        {/* AI-handoff mat view — one row per chamber, write-maintained */}
        {canSeeHandoff && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="font-serif text-lg">
                  AI handoffs by chamber
                </CardTitle>
                <CardDescription>
                  Write-maintained view: every escalation/claim/resolve/reopen
                  bumps these counters in the same transaction as the ticket
                  write. The rebuild re-checks every chamber from the base
                  tickets and corrects any drift, audited.
                </CardDescription>
              </div>
              {canRebuild && (
              <Button
                size="sm"
                variant="outline"
                disabled={rebuilding}
                onClick={async () => {
                  setRebuilding(true);
                  try {
                    const r = await rebuildView({});
                    toast.success(
                      `View rebuilt — ${r.checked} chamber(s) checked, ${r.corrected} row(s) corrected.`,
                    );
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Rebuild failed.");
                  } finally {
                    setRebuilding(false);
                  }
                }}
              >
                Rebuild view
              </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Chamber</TableHead>
                    <TableHead>Open handoffs</TableHead>
                    <TableHead>Unclaimed</TableHead>
                    <TableHead>High priority</TableHead>
                    <TableHead>Last handoff</TableHead>
                    <TableHead>Last resolved</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {handoffRows === undefined && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-xs text-muted-foreground">
                        Loading…
                      </TableCell>
                    </TableRow>
                  )}
                  {handoffRows?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-xs text-muted-foreground">
                        No AI handoffs yet — escalations from the AI Studio
                        create the rows.
                      </TableCell>
                    </TableRow>
                  )}
                  {handoffRows?.map((r) => (
                    <TableRow key={r.orgId}>
                      <TableCell className="text-xs font-medium">{r.orgName}</TableCell>
                      <TableCell className="text-xs font-semibold">{r.openCount}</TableCell>
                      <TableCell className="text-xs">
                        {r.unclaimedCount > 0 ? (
                          <span className="text-orange-900">{r.unclaimedCount}</span>
                        ) : (
                          r.unclaimedCount
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.highPriorityCount > 0 ? (
                          <span className="text-red-900">{r.highPriorityCount}</span>
                        ) : (
                          r.highPriorityCount
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{when(r.lastHandoffAt)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{when(r.lastResolvedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
        )}

        {/* Queue */}
        {canSeeQueue && (
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">Ticket queue</CardTitle>
            <CardDescription>
              Every live ticket across all chambers, newest activity first.
              Closed tickets leave the queue; the audit trail keeps them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Submitter</TableHead>
                    <TableHead>Assigned</TableHead>
                    <TableHead>Last activity</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queue === undefined && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-xs text-muted-foreground">
                        Loading queue…
                      </TableCell>
                    </TableRow>
                  )}
                  {queue?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-xs text-muted-foreground">
                        Queue is clear — no live tickets.
                      </TableCell>
                    </TableRow>
                  )}
                  {queue?.map((t) => (
                    <TableRow key={t._id}>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_BADGE[t.status]}>
                          {t.status.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[260px]">
                        <button
                          type="button"
                          className="truncate text-left text-xs font-medium hover:underline"
                          onClick={() => setSelectedId(t._id)}
                        >
                          {t.subject}
                        </button>
                        {t.escalatedFromAiJobId && (
                          <span className="type-label ml-1 ink-faded">AI</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {KIND_LABELS[t.kind] ?? t.kind}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={t.priority}
                          onValueChange={(v) =>
                            act(
                              () =>
                                setPriority({ ticketId: t._id, priority: v as never }),
                              "Priority updated.",
                            )
                          }
                        >
                          <SelectTrigger className="h-7 w-[110px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {["low", "normal", "high", "urgent"].map((p) => (
                              <SelectItem key={p} value={p}>{p}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-xs">
                        {t.submittedByName ?? t.submittedByEmail ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {t.assignedToName ?? <span className="ink-faded">unassigned</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {when(t.lastActivityAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {t.status === "open" && canClaim && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              onClick={() =>
                                act(
                                  () => start({ ticketId: t._id }),
                                  "Ticket claimed — in progress.",
                                )
                              }
                            >
                              Claim
                            </Button>
                          )}
                          {(t.status === "open" || t.status === "in_progress") && canResolve && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              onClick={() => {
                                setResolveNote("");
                                setResolveOpen(t._id);
                              }}
                            >
                              Resolve
                            </Button>
                          )}
                          {t.status === "resolved" && canResolve && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs"
                                onClick={() =>
                                  act(() => close({ ticketId: t._id }), "Ticket closed.")
                                }
                              >
                                Close
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                onClick={() => {
                                  setReopenReason("");
                                  setReopenOpen(t._id);
                                }}
                              >
                                Reopen
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
        )}

        {/* Audit trail */}
        {canSeeAudit && (
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">Operations audit</CardTitle>
            <CardDescription>
              Every triage action by platform operators, one row per action.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Operator</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {audit === undefined && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-xs text-muted-foreground">
                        Loading…
                      </TableCell>
                    </TableRow>
                  )}
                  {audit?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-xs text-muted-foreground">
                        No operations recorded yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {audit?.map((a) => (
                    <TableRow key={a._id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {when(a.createdAt)}
                      </TableCell>
                      <TableCell className="text-xs">{a.actorName ?? "—"}</TableCell>
                      <TableCell className="text-xs">{a.action}</TableCell>
                      <TableCell className="text-xs">{a.detail ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
        )}

        <p className="text-xs text-muted-foreground">
          Need the subscription console? It lives at{" "}
          <Link to="/platform" className="underline hover:text-foreground">
            /platform
          </Link>{" "}
          — chambers, plans and billing stay there; this console is customer
          support only. Tenant legal records are never shown on either;
          support access to a chamber remains the exceptional, time-boxed,
          audited flow.
        </p>
      </div>

      {/* Ticket thread (operator view) */}
      <Dialog
        open={!!selectedId}
        onOpenChange={(v) => {
          if (!v) {
            setSelectedId(null);
            setReplyText("");
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-base">
              {selected?.subject ?? "Ticket"}
            </DialogTitle>
            {selected && (
              <DialogDescription className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={STATUS_BADGE[selected.status]}>
                  {selected.status.replace("_", " ")}
                </Badge>
                <span>{KIND_LABELS[selected.kind] ?? selected.kind}</span>
                <span>
                  · {selected.submittedByName ?? selected.submittedByEmail ?? "—"}
                </span>
                {selected.escalatedFromAiJobId && (
                  <Badge variant="outline">Escalated from Advokate AI</Badge>
                )}
              </DialogDescription>
            )}
          </DialogHeader>

          {detail === undefined && (
            <p className="text-sm text-muted-foreground">Opening…</p>
          )}
          {detail && (
            <div className="space-y-3">
              <ol className="space-y-2">
                {detail.messages.map((m) => (
                  <li
                    key={m._id}
                    className={`rounded-md border p-3 text-sm ${
                      m.authorType === "operator"
                        ? "border-[#B68A45]/40 bg-[#B68A45]/[0.06]"
                        : "border-border bg-muted/40"
                    }`}
                  >
                    <p className="type-label ink-faded mb-1 flex items-center gap-1.5">
                      <Headset className="size-3" aria-hidden="true" />
                      {m.authorType === "operator"
                        ? "Advokate support"
                        : m.authorName ?? "Customer"}{" "}
                      · {when(m.createdAt)}
                    </p>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                  </li>
                ))}
              </ol>
              {selected && selected.status !== "closed" && canReply && (
                <div className="space-y-2 border-t border-border pt-3">
                  <Label htmlFor="op-reply" className="text-xs">Reply as support</Label>
                  <Textarea
                    id="op-reply"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    rows={3}
                    maxLength={4000}
                    className="text-sm"
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      disabled={!replyText.trim()}
                      onClick={() =>
                        act(async () => {
                          await reply({
                            ticketId: selected._id,
                            body: replyText.trim(),
                          });
                          setReplyText("");
                        }, "Reply sent.")
                      }
                    >
                      Send reply
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Resolve dialog */}
      <Dialog open={!!resolveOpen} onOpenChange={(v) => !v && setResolveOpen(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">Resolve ticket</DialogTitle>
            <DialogDescription>
              The note is posted to the customer's thread and stored as the
              resolution record.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="resolve-note" className="text-xs">
              Resolution note (minimum 10 characters)
            </Label>
            <Textarea
              id="resolve-note"
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
              rows={4}
              maxLength={1000}
              className="text-sm"
            />
          </div>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setResolveOpen(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={resolveNote.trim().length < 10}
              onClick={() =>
                act(async () => {
                  await resolve({
                    ticketId: resolveOpen as never,
                    note: resolveNote.trim(),
                  });
                  setResolveOpen(null);
                }, "Ticket resolved.")
              }
            >
              Resolve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reopen dialog */}
      <Dialog open={!!reopenOpen} onOpenChange={(v) => !v && setReopenOpen(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">Reopen ticket</DialogTitle>
            <DialogDescription>
              The reason is posted to the thread and audited.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="reopen-reason" className="text-xs">Reason</Label>
            <Textarea
              id="reopen-reason"
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              rows={3}
              maxLength={500}
              className="text-sm"
            />
          </div>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setReopenOpen(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={reopenReason.trim().length < 4}
              onClick={() =>
                act(async () => {
                  await reopen({
                    ticketId: reopenOpen as never,
                    reason: reopenReason.trim(),
                  });
                  setReopenOpen(null);
                }, "Ticket reopened.")
              }
            >
              Reopen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ChamberShell>
  );
}
