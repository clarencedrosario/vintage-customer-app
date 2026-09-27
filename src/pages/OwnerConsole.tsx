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
import { Headset, Shield, ShieldAlert } from "lucide-react";
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

export default function OwnerConsole() {
  const amAdmin = useQuery(api.platform.amIPlatformAdmin);
  const counts = useQuery(api.platformOps.opsCounts);
  const queue = useQuery(api.platformOps.operatorQueue);
  const audit = useQuery(api.platformOps.opsAudit, { limit: 50 });

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

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    }
  };

  if (amAdmin === undefined) {
    return (
      <ChamberShell subtitle="CJ Global" title="Operations console">
        <p className="mt-10 text-sm text-muted-foreground">Checking access…</p>
      </ChamberShell>
    );
  }

  if (!amAdmin) {
    return (
      <ChamberShell subtitle="CJ Global" title="Operations console">
        <Card>
          <CardContent className="pt-6">
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              This console is restricted to platform operators. Chamber owners
              manage their own chamber from the practice console; customer
              tickets are handled exclusively here.
            </p>
          </CardContent>
        </Card>
      </ChamberShell>
    );
  }

  const selected = detail?.ticket;

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
        {/* Health counters */}
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

        {/* Queue */}
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
                          {t.status === "open" && (
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
                          {(t.status === "open" || t.status === "in_progress") && (
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
                          {t.status === "resolved" && (
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

        {/* Audit trail */}
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
              {selected && selected.status !== "closed" && (
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
