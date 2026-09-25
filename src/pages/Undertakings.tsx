import { ChamberShell } from "@/components/ChamberShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDateIN, formatDateTimeIN } from "@/lib/format";
import {
  UNDERTAKING_STATUS_LABELS,
  type UndertakingStatus,
} from "@/lib/undertakingsFlow";
import { useMutation, useQuery } from "convex/react";
import {
  CalendarClock,
  CheckCheck,
  FileWarning,
  History,
  Loader2,
  PenLine,
  Plus,
  Scale,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";

// ---------------------------------------------------------------------
// FEATURE 9 — Undertakings Register desk: the firm-wide register with
// lifecycle actions, supervisory verification, corrections, escalation
// badges and the confidential-safe firm report.
// ---------------------------------------------------------------------

type UndertakingRow = {
  _id: Id<"undertakings">;
  orgId: Id<"organizations">;
  matterId: Id<"matters">;
  text: string;
  direction: "given" | "received";
  party?: string | null;
  givenOn?: string | null;
  dueAt?: number | null;
  responsibleId: Id<"users">;
  supervisingId: Id<"users">;
  conditions?: string | null;
  notes?: string | null;
  status: UndertakingStatus;
  rejectedReason?: string | null;
  withdrawnReason?: string | null;
  breachExplanation?: string | null;
  verificationNote?: string | null;
  completionEvidence?: {
    note?: string;
    documentId?: Id<"matterDocuments">;
    recordedAt: number;
    recordedByName: string;
  } | null;
  approvedAt?: number | null;
  approvedByName?: string | null;
  dischargedAt?: number | null;
  dischargedByName?: string | null;
  corrections?: Array<{
    at: number;
    byName: string;
    reason: string;
    field: string;
    previous: string;
    next: string;
  }>;
  createdByName?: string | null;
  matterReference: string | null;
  matterTitle: string | null;
  dueClass: string;
  escalationTier: number;
};

type TeamMember = {
  userId: Id<"users">;
  name: string | null;
  email: string | null;
  status: string;
};

function StatusBadge({ status }: { status: UndertakingStatus }) {
  const variant =
    status === "breached"
      ? "destructive"
      : status === "active"
        ? "default"
        : status === "discharged"
          ? "secondary"
          : "outline";
  return <Badge variant={variant}>{UNDERTAKING_STATUS_LABELS[status]}</Badge>;
}

function DueStamp({ row }: { row: UndertakingRow }) {
  if (row.dueAt === undefined || row.dueAt === null) {
    return <span className="type-label ink-faded">no due date</span>;
  }
  const overdue = row.dueAt < Date.now();
  const isActiveLike =
    row.status === "active" || row.status === "completed_pending_verification";
  return (
    <span
      className={`type-label ${
        overdue && isActiveLike ? "text-red-700 font-medium" : "ink-faded"
      }`}
    >
      {formatDateIN(row.dueAt)}
      {overdue && isActiveLike ? " · overdue" : ""}
      {row.escalationTier > 0 ? ` · escalation tier ${row.escalationTier}` : ""}
    </span>
  );
}

export default function Undertakings() {
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get("focus");

  const data = useQuery(api.undertakings.list) as
    | { rows: UndertakingRow[]; summary: { active: number; dueSoon: number; overdue: number; pendingVerification: number; pendingApproval: number; breached: number } | null }
    | undefined;
  const matters = useQuery(api.matters.list) as
    | Array<{ _id: Id<"matters">; reference: string; title: string }>
    | undefined;
  const team = useQuery(api.workspace.team) as TeamMember[] | undefined;

  const createFn = useMutation(api.undertakings.create);
  const submitFn = useMutation(api.undertakings.submitForApproval);
  const decideFn = useMutation(api.undertakings.decideApproval);
  const completeFn = useMutation(api.undertakings.recordCompletion);
  const verifyFn = useMutation(api.undertakings.verify);
  const withdrawFn = useMutation(api.undertakings.withdraw);
  const correctFn = useMutation(api.undertakings.correct);
  const removeFn = useMutation(api.undertakings.remove);

  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  // New undertaking form
  const [open, setOpen] = useState(false);
  const [matterId, setMatterId] = useState<string>("");
  const [text, setText] = useState("");
  const [direction, setDirection] = useState<"given" | "received">("given");
  const [party, setParty] = useState("");
  const [givenOn, setGivenOn] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [responsibleId, setResponsibleId] = useState<string>("");
  const [supervisingId, setSupervisingId] = useState<string>("");
  const [conditions, setConditions] = useState("");
  const [notes, setNotes] = useState("");
  const [confidential, setConfidential] = useState(false);

  // Decision / verification / correction dialogs
  const [decision, setDecision] = useState<{ row: UndertakingRow; approve: boolean } | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [completeFor, setCompleteFor] = useState<UndertakingRow | null>(null);
  const [evidenceNote, setEvidenceNote] = useState("");
  const [verifyFor, setVerifyFor] = useState<UndertakingRow | null>(null);
  const [verifyNote, setVerifyNote] = useState("");
  const [withdrawFor, setWithdrawFor] = useState<UndertakingRow | null>(null);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [correctFor, setCorrectFor] = useState<UndertakingRow | null>(null);
  const [correctField, setCorrectField] = useState<string>("text");
  const [correctText, setCorrectText] = useState("");
  const [correctReason, setCorrectReason] = useState("");

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not complete the action.");
    } finally {
      setBusy(false);
    }
  };

  const rows = (data?.rows ?? []).filter((r) => {
    if (filter !== "all") {
      if (filter === "open_issues") {
        if (r.status !== "active" && r.status !== "completed_pending_verification" && r.status !== "breached")
          return false;
      } else if (r.status !== filter) {
        return false;
      }
    }
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      r.text.toLowerCase().includes(q) ||
      (r.matterReference ?? "").toLowerCase().includes(q) ||
      (r.matterTitle ?? "").toLowerCase().includes(q) ||
      (r.party ?? "").toLowerCase().includes(q)
    );
  });

  const submitNew = async () => {
    if (!matterId || !text.trim() || !responsibleId || !supervisingId) {
      toast.error("Matter, undertaking text, responsible and supervising lawyers are required.");
      return;
    }
    await run(
      () =>
        createFn({
          matterId: matterId as Id<"matters">,
          text,
          direction,
          party: party || undefined,
          givenOn: givenOn || undefined,
          dueAt: dueAt ? Date.parse(`${dueAt}T12:00:00Z`) : undefined,
          responsibleId: responsibleId as Id<"users">,
          supervisingId: supervisingId as Id<"users">,
          conditions: conditions || undefined,
          notes: notes || undefined,
          confidential,
        }),
      "Undertaking recorded as draft.",
    );
    setOpen(false);
    setText("");
    setParty("");
    setConditions("");
    setNotes("");
    setDueAt("");
    setGivenOn("");
  };

  const summary = data?.summary;

  return (
    <ChamberShell
      subtitle="The Digital Chamber"
      title="Undertakings Register"
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="size-4" aria-hidden="true" /> Record undertaking
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="font-serif text-xl">Record an undertaking</DialogTitle>
              <DialogDescription>
                Saved as a draft first. The supervising lawyer must approve activation —
                nothing becomes a live undertaking without that approval.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Matter</Label>
                <Select value={matterId} onValueChange={setMatterId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose the matter" />
                  </SelectTrigger>
                  <SelectContent>
                    {(matters ?? []).map((m) => (
                      <SelectItem key={m._id} value={m._id}>
                        {m.reference} — {m.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ut-text">Undertaking text (exactly as accepted)</Label>
                <Textarea
                  id="ut-text"
                  rows={3}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="e.g. The original title deed will be deposited with the registrar within 30 days."
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Direction</Label>
                  <Select value={direction} onValueChange={(v) => setDirection(v as "given" | "received")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="given">Given by the chamber</SelectItem>
                      <SelectItem value="received">Received from the other side</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ut-party">Involved party (optional)</Label>
                  <Input id="ut-party" value={party} onChange={(e) => setParty(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ut-given">Date given / received (optional)</Label>
                  <Input
                    id="ut-given"
                    type="date"
                    value={givenOn}
                    onChange={(e) => setGivenOn(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ut-due">Completion due (optional)</Label>
                  <Input
                    id="ut-due"
                    type="date"
                    value={dueAt}
                    onChange={(e) => setDueAt(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Responsible lawyer</Label>
                  <Select value={responsibleId} onValueChange={setResponsibleId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose" />
                    </SelectTrigger>
                    <SelectContent>
                      {(team ?? [])
                        .filter((t) => t.status === "active")
                        .map((t) => (
                          <SelectItem key={t.userId} value={t.userId}>
                            {t.name ?? t.email}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Supervising lawyer (approves)</Label>
                  <Select value={supervisingId} onValueChange={setSupervisingId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose" />
                    </SelectTrigger>
                    <SelectContent>
                      {(team ?? [])
                        .filter((t) => t.status === "active")
                        .map((t) => (
                          <SelectItem key={t.userId} value={t.userId}>
                            {t.name ?? t.email}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ut-cond">Conditions (optional)</Label>
                <Textarea
                  id="ut-cond"
                  rows={2}
                  value={conditions}
                  onChange={(e) => setConditions(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ut-notes">Notes (optional)</Label>
                <Textarea
                  id="ut-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={confidential}
                  onChange={(e) => setConfidential(e.target.checked)}
                />
                Confidential — hide from firm-level reporting for members outside this matter
              </label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={busy} onClick={submitNew}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : "Save draft"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      <div className="space-y-6">
        {/* Summary strip */}
        {summary && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "Active", value: summary.active },
              { label: "Overdue", value: summary.overdue, tone: "text-red-700" },
              { label: "Due soon", value: summary.dueSoon, tone: "text-[#8a6a33]" },
              { label: "Awaiting approval", value: summary.pendingApproval },
              { label: "Awaiting verification", value: summary.pendingVerification },
              { label: "Breached", value: summary.breached, tone: "text-red-700" },
            ].map((s) => (
              <Card key={s.label} className="rule-frame">
                <CardContent className="p-4">
                  <p className={`font-serif text-2xl ${s.tone ?? ""}`}>{s.value}</p>
                  <p className="type-label ink-faded">{s.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Tabs defaultValue="register" value={filter} onValueChange={setFilter}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="open_issues">Open issues</TabsTrigger>
              <TabsTrigger value="pending_approval">Pending approval</TabsTrigger>
              <TabsTrigger value="discharged">Discharged</TabsTrigger>
              <TabsTrigger value="withdrawn">Withdrawn</TabsTrigger>
              <TabsTrigger value="breached">Breached</TabsTrigger>
            </TabsList>
            <Input
              className="max-w-xs"
              placeholder="Search text, matter, party…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <TabsContent value={filter} className="mt-4">
            {data === undefined ? (
              <p className="text-sm text-muted-foreground">Retrieving…</p>
            ) : rows.length === 0 ? (
              <Card className="rule-frame">
                <CardContent className="p-8 text-center">
                  <Scale className="mx-auto mb-3 size-8 ink-faded" aria-hidden="true" />
                  <p className="font-serif text-lg">No undertakings here.</p>
                  <p className="mt-1 text-sm ink-faded">
                    Undertakings accepted before a court are recorded here and tracked until
                    they are discharged, withdrawn or — where it happens — breached.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {rows.map((r) => (
                  <Card
                    key={r._id}
                    className={`rule-frame ${focusId === r._id ? "ring-2 ring-[#B68A45]" : ""}`}
                  >
                    <CardContent className="space-y-3 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge status={r.status} />
                            <Badge variant="outline">
                              {r.direction === "given" ? "Given" : "Received"}
                            </Badge>
                            {r.party && (
                              <span className="type-label ink-faded">{r.party}</span>
                            )}
                          </div>
                          <p className="mt-2 text-sm leading-relaxed">{r.text}</p>
                          <p className="mt-1 type-label ink-faded">
                            <Link
                              to={`/matters/${r.matterId}?tab=command`}
                              className="hover:underline"
                            >
                              {r.matterReference} — {r.matterTitle}
                            </Link>
                          </p>
                        </div>
                        <div className="text-right">
                          <DueStamp row={r} />
                        </div>
                      </div>

                      {(r.conditions || r.notes || r.completionEvidence || r.rejectedReason || r.withdrawnReason || r.breachExplanation) && (
                        <div className="space-y-1 rounded-md border border-border/70 bg-[#F7F5EF]/60 p-3 text-xs">
                          {r.conditions && (
                            <p>
                              <span className="type-label ink-faded">Conditions: </span>
                              {r.conditions}
                            </p>
                          )}
                          {r.notes && (
                            <p>
                              <span className="type-label ink-faded">Notes: </span>
                              {r.notes}
                            </p>
                          )}
                          {r.completionEvidence && (
                            <p>
                              <span className="type-label ink-faded">
                                Completion evidence:{" "}
                              </span>
                              {r.completionEvidence.note ?? "(document attached)"} — recorded by{" "}
                              {r.completionEvidence.recordedByName} on{" "}
                              {formatDateTimeIN(r.completionEvidence.recordedAt)}
                            </p>
                          )}
                          {r.rejectedReason && (
                            <p className="text-[#8a6a33]">
                              <span className="type-label">Returned: </span>
                              {r.rejectedReason}
                            </p>
                          )}
                          {r.withdrawnReason && (
                            <p>
                              <span className="type-label ink-faded">Withdrawn: </span>
                              {r.withdrawnReason}
                            </p>
                          )}
                          {r.breachExplanation && (
                            <p className="text-red-700">
                              <span className="type-label">Breach: </span>
                              {r.breachExplanation}
                            </p>
                          )}
                          {r.approvedByName && (
                            <p className="ink-faded">
                              Activated by {r.approvedByName}
                              {r.approvedAt ? ` · ${formatDateTimeIN(r.approvedAt)}` : ""}
                              {r.dischargedByName
                                ? ` · discharged by ${r.dischargedByName}`
                                : ""}
                            </p>
                          )}
                        </div>
                      )}

                      {r.corrections && r.corrections.length > 0 && (
                        <details className="text-xs">
                          <summary className="type-label ink-faded flex cursor-pointer items-center gap-1">
                            <History className="size-3" aria-hidden="true" /> Correction history (
                            {r.corrections.length})
                          </summary>
                          <ul className="mt-2 space-y-1 rounded-md border border-border/70 p-2">
                            {r.corrections.map((c, i) => (
                              <li key={i}>
                                <span className="ink-faded">
                                  {formatDateTimeIN(c.at)} — {c.byName}:
                                </span>{" "}
                                <span className="type-label">{c.field}</span> “{c.previous}” → “
                                {c.next}” ({c.reason})
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}

                      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                        {r.status === "draft" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                run(
                                  () => submitFn({ undertakingId: r._id }),
                                  "Submitted for approval.",
                                )
                              }
                            >
                              <Send className="size-3.5" aria-hidden="true" /> Submit for approval
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => {
                                setCorrectFor(r);
                                setCorrectField("text");
                                setCorrectText(r.text);
                                setCorrectReason("");
                              }}
                            >
                              <PenLine className="size-3.5" aria-hidden="true" /> Correct
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              disabled={busy}
                              onClick={() =>
                                run(() => removeFn({ undertakingId: r._id }), "Draft removed.")
                              }
                            >
                              <Trash2 className="size-3.5" aria-hidden="true" /> Delete draft
                            </Button>
                          </>
                        )}
                        {r.status === "pending_approval" && (
                          <>
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() => {
                                setDecision({ row: r, approve: true });
                                setDecisionNote("");
                              }}
                            >
                              <ShieldCheck className="size-3.5" aria-hidden="true" /> Activate
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setDecision({ row: r, approve: false });
                                setDecisionNote("");
                              }}
                            >
                              Return for rework
                            </Button>
                          </>
                        )}
                        {r.status === "active" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => {
                                setCompleteFor(r);
                                setEvidenceNote("");
                              }}
                            >
                              <CheckCheck className="size-3.5" aria-hidden="true" /> Record
                              completion
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => {
                                setWithdrawFor(r);
                                setWithdrawReason("");
                              }}
                            >
                              Withdraw
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              disabled={busy}
                              onClick={() => {
                                setVerifyFor(r);
                                setVerifyNote("");
                              }}
                            >
                              <FileWarning className="size-3.5" aria-hidden="true" /> Record breach
                            </Button>
                          </>
                        )}
                        {r.status === "completed_pending_verification" && (
                          <>
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() => {
                                setVerifyFor(r);
                                setVerifyNote("");
                              }}
                            >
                              <ShieldCheck className="size-3.5" aria-hidden="true" /> Verify &amp;
                              discharge
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              disabled={busy}
                              onClick={() => {
                                setVerifyFor(r);
                                setVerifyNote("");
                              }}
                            >
                              <FileWarning className="size-3.5" aria-hidden="true" /> Find breach
                            </Button>
                          </>
                        )}
                        {["discharged", "withdrawn", "breached"].includes(r.status) && (
                          <span className="type-label ink-faded">
                            Record closed — history preserved.
                          </span>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto"
                          disabled={busy}
                          onClick={() => {
                            setCorrectFor(r);
                            setCorrectField("text");
                            setCorrectText(r.text);
                            setCorrectReason("");
                          }}
                        >
                          <PenLine className="size-3.5" aria-hidden="true" /> Correct
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* ---- Dialogs ---- */}
        <Dialog open={!!decision} onOpenChange={(o) => !o && setDecision(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-serif text-xl">
                {decision?.approve ? "Activate undertaking" : "Return for rework"}
              </DialogTitle>
              <DialogDescription>
                {decision?.approve
                  ? "Activation is the supervising lawyer's approval. The register keeps your name and the date."
                  : "The undertaking returns to draft with your reason recorded."}
              </DialogDescription>
            </DialogHeader>
            {!decision?.approve && (
              <div className="grid gap-2">
                <Label htmlFor="ut-decision">Reason (required)</Label>
                <Textarea
                  id="ut-decision"
                  rows={3}
                  value={decisionNote}
                  onChange={(e) => setDecisionNote(e.target.value)}
                />
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setDecision(null)}>
                Cancel
              </Button>
              <Button
                disabled={busy}
                onClick={async () => {
                  if (!decision) return;
                  await run(
                    () =>
                      decideFn({
                        undertakingId: decision.row._id,
                        approve: decision.approve,
                        reason: decision.approve ? undefined : decisionNote,
                      }),
                    decision.approve ? "Undertaking activated." : "Returned to draft.",
                  );
                  setDecision(null);
                }}
              >
                Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!completeFor} onOpenChange={(o) => !o && setCompleteFor(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-serif text-xl">Record completion</DialogTitle>
              <DialogDescription>
                Evidence — a document reference or an explanation — is required before the
                supervising lawyer can verify and discharge.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="ut-evidence">How was the undertaking fulfilled?</Label>
              <Textarea
                id="ut-evidence"
                rows={4}
                value={evidenceNote}
                onChange={(e) => setEvidenceNote(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCompleteFor(null)}>
                Cancel
              </Button>
              <Button
                disabled={busy}
                onClick={async () => {
                  if (!completeFor) return;
                  await run(
                    () =>
                      completeFn({
                        undertakingId: completeFor._id,
                        evidenceNote: evidenceNote || undefined,
                      }),
                    "Completion recorded — awaiting supervisory verification.",
                  );
                  setCompleteFor(null);
                }}
              >
                Submit for verification
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!verifyFor} onOpenChange={(o) => !o && setVerifyFor(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-serif text-xl">
                Supervisory verification
              </DialogTitle>
              <DialogDescription>
                Discharge closes the undertaking as fulfilled. Finding a breach records the
                explanation permanently in the register.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="ut-verify">
                Verification note {verifyFor?.status === "active" && "(breach requires an explanation)"}
              </Label>
              <Textarea
                id="ut-verify"
                rows={3}
                value={verifyNote}
                onChange={(e) => setVerifyNote(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setVerifyFor(null)}>
                Cancel
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  if (!verifyFor) return;
                  await run(
                    () =>
                      verifyFn({
                        undertakingId: verifyFor._id,
                        outcome: "discharged",
                        note: verifyNote || undefined,
                      }),
                    "Undertaking discharged.",
                  );
                  setVerifyFor(null);
                }}
              >
                <ShieldCheck className="size-4" aria-hidden="true" /> Discharge
              </Button>
              <Button
                variant="destructive"
                disabled={busy || !verifyNote.trim()}
                onClick={async () => {
                  if (!verifyFor) return;
                  await run(
                    () =>
                      verifyFn({
                        undertakingId: verifyFor._id,
                        outcome: "breached",
                        note: verifyNote,
                      }),
                    "Breach recorded.",
                  );
                  setVerifyFor(null);
                }}
              >
                <FileWarning className="size-4" aria-hidden="true" /> Find breach
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!withdrawFor} onOpenChange={(o) => !o && setWithdrawFor(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-serif text-xl">Withdraw undertaking</DialogTitle>
              <DialogDescription>
                A reason is required; the register preserves the withdrawal and who made it.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="ut-withdraw">Reason (required)</Label>
              <Textarea
                id="ut-withdraw"
                rows={3}
                value={withdrawReason}
                onChange={(e) => setWithdrawReason(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setWithdrawFor(null)}>
                Cancel
              </Button>
              <Button
                disabled={busy || !withdrawReason.trim()}
                onClick={async () => {
                  if (!withdrawFor) return;
                  await run(
                    () =>
                      withdrawFn({
                        undertakingId: withdrawFor._id,
                        reason: withdrawReason,
                      }),
                    "Undertaking withdrawn.",
                  );
                  setWithdrawFor(null);
                }}
              >
                Withdraw
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!correctFor} onOpenChange={(o) => !o && setCorrectFor(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-serif text-xl">Correct the record</DialogTitle>
              <DialogDescription>
                The previous value is preserved verbatim in the correction history with your
                reason — nothing is silently overwritten.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Field</Label>
                <Select value={correctField} onValueChange={setCorrectField}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Undertaking text</SelectItem>
                    <SelectItem value="dueAt">Due date</SelectItem>
                    <SelectItem value="party">Involved party</SelectItem>
                    <SelectItem value="conditions">Conditions</SelectItem>
                    <SelectItem value="notes">Notes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {correctField === "dueAt" ? (
                <div className="grid gap-2">
                  <Label htmlFor="ut-newdue">New due date</Label>
                  <Input
                    id="ut-newdue"
                    type="date"
                    value={correctText}
                    onChange={(e) => setCorrectText(e.target.value)}
                  />
                </div>
              ) : (
                <div className="grid gap-2">
                  <Label htmlFor="ut-newval">New value</Label>
                  <Textarea
                    id="ut-newval"
                    rows={3}
                    value={correctText}
                    onChange={(e) => setCorrectText(e.target.value)}
                  />
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="ut-corr">Reason (required)</Label>
                <Textarea
                  id="ut-corr"
                  rows={2}
                  value={correctReason}
                  onChange={(e) => setCorrectReason(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCorrectFor(null)}>
                Cancel
              </Button>
              <Button
                disabled={busy || !correctReason.trim() || !correctText.trim()}
                onClick={async () => {
                  if (!correctFor) return;
                  await run(
                    () =>
                      correctFn({
                        undertakingId: correctFor._id,
                        field: correctField as
                          | "text"
                          | "dueAt"
                          | "party"
                          | "conditions"
                          | "notes",
                        reason: correctReason,
                        newText: correctField === "dueAt" ? undefined : correctText,
                        newDueAt:
                          correctField === "dueAt" && correctText
                            ? Date.parse(`${correctText}T12:00:00Z`)
                            : undefined,
                      }),
                    "Correction recorded with history.",
                  );
                  setCorrectFor(null);
                }}
              >
                Save correction
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ChamberShell>
  );
}
