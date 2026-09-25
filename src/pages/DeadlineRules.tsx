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
import { useMutation, useQuery } from "convex/react";
import {
  CalendarClock,
  CalendarDays,
  CheckCheck,
  Gavel,
  ListChecks,
  Loader2,
  Plus,
  Scale,
  ShieldAlert,
  Trash2,
  Wand2,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

// ---------------------------------------------------------------------
// FEATURE 5 — Deadline rules engine desk: rules, court holidays, the
// approval queue for rule-generated deadlines and critical escalation.
// ---------------------------------------------------------------------

const TRIGGER_EVENT_LABELS: Record<string, string> = {
  order_passed: "Order passed",
  hearing_adjourned: "Hearing adjourned",
  hearing_held: "Hearing held",
  filing_done: "Filing completed",
  service_completed: "Service completed",
  manual: "Manual trigger",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Pending approval",
  approved: "Approved",
  rejected: "Rejected (kept for audit)",
  acknowledged: "Acknowledged",
  completed: "Completed",
  extended: "Extended",
  vacated: "Vacated",
  missed: "Missed",
};

type RuleRow = {
  _id: string;
  name: string;
  jurisdiction?: string | null;
  authority?: string | null;
  practiceArea?: string | null;
  triggerEvent: string;
  countType: string;
  count: number;
  triggerDayTreatment: string;
  weekendRule: string;
  holidayRule: string;
  direction: string;
  criticality: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  currentVersion: number;
  active: boolean;
};

type DraftRow = {
  _id: string;
  title: string;
  matterId: string;
  matterReference: string | null;
  ruleName: string;
  ruleVersion: number;
  triggerEvent: string;
  triggerDate: string;
  dueDate: string;
  calcRule: string;
  breakdown: string[];
  sourceSentence?: string | null;
  criticality: string;
  status: string;
  rejectNote?: string | null;
  proposedByName?: string | null;
  approvedByName?: string | null;
  adjustments?: Array<{
    at: number;
    byName: string;
    reason: string;
    oldDueDate: string;
    newDueDate: string;
  }>;
};

const inputCls = "w-full";

export default function DeadlineRules() {
  const [tab, setTab] = useState("deadlines");

  return (
    <ChamberShell
      title="Deadline rules"
      subtitle="Versioned court deadline rules — computed, never guessed"
    >
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="deadlines">
            <CalendarClock className="mr-1.5 size-4" /> Rule deadlines
          </TabsTrigger>
          <TabsTrigger value="rules">
            <ListChecks className="mr-1.5 size-4" /> Rules
          </TabsTrigger>
          <TabsTrigger value="holidays">
            <CalendarDays className="mr-1.5 size-4" /> Court holidays
          </TabsTrigger>
          <TabsTrigger value="escalations">
            <ShieldAlert className="mr-1.5 size-4" /> Critical watch
          </TabsTrigger>
        </TabsList>

        <TabsContent value="deadlines" className="mt-6">
          <DraftDesk />
        </TabsContent>
        <TabsContent value="rules" className="mt-6">
          <RulesDesk />
        </TabsContent>
        <TabsContent value="holidays" className="mt-6">
          <HolidaysDesk />
        </TabsContent>
        <TabsContent value="escalations" className="mt-6">
          <EscalationDesk />
        </TabsContent>
      </Tabs>
    </ChamberShell>
  );
}

// ------------------------------------------------------------- helpers

function ruleSentence(r: RuleRow): string {
  const parts = [
    `${r.count} ${r.countType === "working_days" ? "working" : "calendar"} day(s)`,
    r.direction === "after" ? "after" : "before",
    `the ${TRIGGER_EVENT_LABELS[r.triggerEvent] ?? r.triggerEvent}`.toLowerCase(),
  ];
  return parts.join(" ");
}

// -------------------------------------------------------- drafts desk

function DraftDesk() {
  const drafts = useQuery(api.deadlineRules.draftList) as DraftRow[] | undefined;
  const caps = useQuery(api.workspace.myCapabilities);
  const reject = useMutation(api.deadlineRules.rejectDraft);
  const adjust = useMutation(api.deadlineRules.adjustDate);
  const acknowledge = useMutation(api.deadlineRules.acknowledge);
  const complete = useMutation(api.deadlineRules.complete);
  const approveAll = useMutation(api.deadlineRules.approveAllForMatter);

  const canApprove = caps?.capabilities.includes("matter.edit") ?? false;
  const [showBreakdown, setShowBreakdown] = useState<DraftRow | null>(null);
  const [adjusting, setAdjusting] = useState<DraftRow | null>(null);
  const [rejecting, setRejecting] = useState<DraftRow | null>(null);

  const pending = (drafts ?? []).filter((d) => d.status === "draft");
  const active = (drafts ?? []).filter((d) =>
    ["approved", "acknowledged"].includes(d.status),
  );
  const decided = (drafts ?? []).filter((d) =>
    ["rejected", "completed", "extended", "vacated", "missed"].includes(d.status),
  );

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not go through.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-sm text-muted-foreground">
          Deadlines computed from versioned rules appear here for lawyer
          approval — the rule sentence, source date and full calculation
          breakdown travel with every draft.
        </p>
        <GenerateDialog />
      </div>
      {drafts === undefined && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading the deadline register…
        </p>
      )}

      {drafts !== undefined && drafts.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <Scale className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="font-serif text-lg">No rule-generated deadlines yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Deadlines computed from court orders and hearings appear here for
              lawyer approval. Generate them from a matter file, or define rules
              first on the Rules tab.
            </p>
          </CardContent>
        </Card>
      )}

      {pending.length > 0 && canApprove && (
        <div className="flex flex-wrap items-center gap-2">
          {[...new Set(pending.map((d) => d.matterId))].map((mid) => (
            <Button
              key={mid}
              size="sm"
              variant="outline"
              onClick={() =>
                act(async () => {
                  const r = await approveAll({ matterId: mid as Id<"matters"> });
                  if (r.approved === 0) {
                    toast.message("Nothing left to approve for that matter.");
                  }
                }, `Approved all pending drafts for one matter.`)
              }
            >
              <CheckCheck className="mr-1.5 size-4" />
              Approve all for {pending.find((d) => d.matterId === mid)?.matterReference}
            </Button>
          ))}
        </div>
      )}

      {pending.length > 0 && (
        <section>
          <h2 className="mb-2 font-serif text-lg">
            Awaiting lawyer approval{" "}
            <span className="text-sm text-muted-foreground">({pending.length})</span>
          </h2>
          <div className="space-y-2">
            {pending.map((d) => (
              <DraftRowCard
                key={d._id}
                d={d}
                canApprove={canApprove}
                onBreakdown={() => setShowBreakdown(d)}
                onReject={() => setRejecting(d)}
                onAdjust={() => setAdjusting(d)}
                act={act}
                reject={reject}
              />
            ))}
          </div>
        </section>
      )}

      {active.length > 0 && (
        <section>
          <h2 className="mb-2 font-serif text-lg">
            Active{" "}
            <span className="text-sm text-muted-foreground">({active.length})</span>
          </h2>
          <div className="space-y-2">
            {active.map((d) => (
              <DraftRowCard
                key={d._id}
                d={d}
                canApprove={canApprove}
                onBreakdown={() => setShowBreakdown(d)}
                onAdjust={() => setAdjusting(d)}
                act={act}
                acknowledge={acknowledge}
                complete={complete}
              />
            ))}
          </div>
        </section>
      )}

      {decided.length > 0 && (
        <section>
          <h2 className="mb-2 font-serif text-lg">
            Decided{" "}
            <span className="text-sm text-muted-foreground">({decided.length})</span>
          </h2>
          <div className="space-y-2">
            {decided.map((d) => (
              <DraftRowCard
                key={d._id}
                d={d}
                canApprove={false}
                onBreakdown={() => setShowBreakdown(d)}
                act={act}
              />
            ))}
          </div>
        </section>
      )}

      <BreakdownDialog draft={showBreakdown} onClose={() => setShowBreakdown(null)} />
      <AdjustDialog draft={adjusting} canApprove={canApprove} onClose={() => setAdjusting(null)} act={act} adjust={adjust} />
      <RejectDialog draft={rejecting} onClose={() => setRejecting(null)} act={act} reject={reject} />
    </div>
  );
}

function DraftRowCard({
  d,
  canApprove,
  onBreakdown,
  onReject,
  onAdjust,
  act,
  reject,
  acknowledge,
  complete,
}: {
  d: DraftRow;
  canApprove: boolean;
  onBreakdown: () => void;
  onReject?: () => void;
  onAdjust?: () => void;
  act: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
  reject?: ReturnType<typeof useMutation<typeof api.deadlineRules.rejectDraft>>;
  acknowledge?: ReturnType<typeof useMutation<typeof api.deadlineRules.acknowledge>>;
  complete?: ReturnType<typeof useMutation<typeof api.deadlineRules.complete>>;
}) {
  const overdue = d.dueDate < new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const soon =
    !overdue &&
    d.dueDate <=
      new Date(Date.now() + 5.5 * 3600 * 1000 + 2 * 86400000).toISOString().slice(0, 10);
  return (
    <Card>
      <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {d.criticality === "critical" && (
              <Badge className="bg-[#7a1f1f] text-white">Critical</Badge>
            )}
            {d.status === "draft" && <Badge variant="outline">Pending approval</Badge>}
            {d.status !== "draft" && (
              <span className="text-sm text-muted-foreground">
                {STATUS_LABELS[d.status] ?? d.status}
                {d.status === "rejected" && d.rejectNote ? ` — ${d.rejectNote}` : ""}
              </span>
            )}
          </div>
          <p className="mt-1 truncate font-medium">{d.title}</p>
          <p className="text-sm text-muted-foreground">
            <Link
              to={`/matters/${d.matterId}?tab=command`}
              className="hover:underline"
            >
              {d.matterReference}
            </Link>
            {" · "}
            {ruleSentenceFromDraft(d)}
          </p>
          <p className="mt-1 text-sm">
            Due{" "}
            <span
              className={
                overdue
                  ? "font-semibold text-[#7a1f1f]"
                  : soon
                    ? "font-semibold text-[#8a6a33]"
                    : ""
              }
            >
              {d.dueDate}
            </span>
            {overdue && " — overdue"}
            {d.sourceSentence && (
              <span className="block text-xs text-muted-foreground">{d.sourceSentence}</span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={onBreakdown}>
            Calculation
          </Button>
          {d.status === "draft" && canApprove && onReject && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() =>
                reject &&
                onReject()
              }
            >
              Reject
            </Button>
          )}
          {["approved", "acknowledged"].includes(d.status) && canApprove && onAdjust && (
            <Button size="sm" variant="outline" onClick={onAdjust}>
              Adjust date
            </Button>
          )}
          {d.status === "approved" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                act(async () => {
                  await acknowledge?.({ draftId: d._id as Id<"ruleDeadlines"> });
                }, "Deadline acknowledged.")
              }
            >
              Acknowledge
            </Button>
          )}
          {["approved", "acknowledged"].includes(d.status) && (
            <Button
              size="sm"
              onClick={() =>
                act(async () => {
                  await complete?.({ draftId: d._id as Id<"ruleDeadlines"> });
                }, "Deadline completed.")
              }
            >
              Complete
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ruleSentenceFromDraft(d: DraftRow): string {
  return `${d.ruleName} v${d.ruleVersion} · trigger ${d.triggerDate}`;
}

function BreakdownDialog({
  draft,
  onClose,
}: {
  draft: DraftRow | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">How this date was computed</DialogTitle>
          <DialogDescription>
            {draft?.calcRule}
          </DialogDescription>
        </DialogHeader>
        {draft && (
          <div className="space-y-3">
            {draft.sourceSentence && (
              <p className="rounded border border-border bg-background p-2.5 text-sm">
                {draft.sourceSentence}
              </p>
            )}
            <ol className="list-inside list-decimal space-y-1 text-sm text-muted-foreground">
              {draft.breakdown.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ol>
            {(draft.adjustments ?? []).length > 0 && (
              <div className="rounded border border-border p-2.5">
                <p className="text-sm font-medium">Adjustment history</p>
                <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                  {draft.adjustments!.map((a, i) => (
                    <li key={i}>
                      {a.oldDueDate} → {a.newDueDate} by {a.byName}: {a.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AdjustDialog({
  draft,
  canApprove,
  onClose,
  act,
  adjust,
}: {
  draft: DraftRow | null;
  canApprove: boolean;
  onClose: () => void;
  act: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
  adjust: ReturnType<typeof useMutation<typeof api.deadlineRules.adjustDate>>;
}) {
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open={!!draft}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setDate("");
          setReason("");
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">Adjust the due date</DialogTitle>
          <DialogDescription>
            The previous date is kept in the audit trail. A reason is required.
          </DialogDescription>
        </DialogHeader>
        {draft && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {draft.title} — currently due {draft.dueDate}
            </p>
            <div>
              <Label htmlFor="adj-date">New due date</Label>
              <Input
                id="adj-date"
                type="date"
                className={inputCls}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={!canApprove}
              />
            </div>
            <div>
              <Label htmlFor="adj-reason">Reason</Label>
              <Textarea
                id="adj-reason"
                className={inputCls}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Supreme Court order dated … extended the limitation period"
                disabled={!canApprove}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button
            disabled={!canApprove || !date || !reason.trim()}
            onClick={() =>
              act(async () => {
                await adjust({
                  draftId: draft!._id as Id<"ruleDeadlines">,
                  newDueDate: date,
                  reason: reason.trim(),
                });
                setDate("");
                setReason("");
                onClose();
              }, "Due date adjusted — the previous date is preserved in history.")
            }
          >
            Adjust
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({
  draft,
  onClose,
  act,
  reject,
}: {
  draft: DraftRow | null;
  onClose: () => void;
  act: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
  reject: ReturnType<typeof useMutation<typeof api.deadlineRules.rejectDraft>>;
}) {
  const [note, setNote] = useState("");
  return (
    <Dialog
      open={!!draft}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setNote("");
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">Reject this draft</DialogTitle>
          <DialogDescription>
            Rejected drafts are kept for audit and will not regenerate for the
            same rule version and source.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label htmlFor="rej-note">Reason (required)</Label>
          <Textarea
            id="rej-note"
            className={inputCls}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. The order did not direct a written statement."
          />
        </div>
        <DialogFooter>
          <Button
            variant="destructive"
            disabled={!note.trim()}
            onClick={() =>
              act(async () => {
                await reject({
                  draftId: draft!._id as Id<"ruleDeadlines">,
                  note: note.trim(),
                });
                setNote("");
                onClose();
              }, "Draft rejected — kept for audit.")
            }
          >
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --------------------------------------------------------- rules desk

const emptyForm = {
  name: "",
  triggerEvent: "order_passed",
  countType: "calendar_days",
  count: "30",
  triggerDayTreatment: "excluded",
  weekendRule: "sat_sun",
  holidayRule: "skip",
  direction: "after",
  criticality: "normal",
  jurisdiction: "",
  authority: "",
  practiceArea: "",
  reminderDaysBefore: "",
  effectiveFrom: "",
  effectiveTo: "",
};

function RulesDesk() {
  const rules = useQuery(api.deadlineRules.ruleList) as RuleRow[] | undefined;
  const caps = useQuery(api.workspace.myCapabilities);
  const create = useMutation(api.deadlineRules.createRule);
  const setActive = useMutation(api.deadlineRules.setRuleActive);
  const canManage = caps?.capabilities.includes("task.manage") ?? false;

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof emptyForm) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setBusy(true);
    try {
      await create({
        name: form.name,
        triggerEvent: form.triggerEvent,
        countType: form.countType as "calendar_days" | "working_days",
        count: Number(form.count),
        triggerDayTreatment: form.triggerDayTreatment as "excluded" | "included",
        weekendRule: form.weekendRule as "sat_sun" | "sun_only",
        holidayRule: form.holidayRule as "skip" | "count",
        direction: form.direction as "after" | "before",
        criticality: form.criticality as "critical" | "normal",
        jurisdiction: form.jurisdiction || undefined,
        authority: form.authority || undefined,
        practiceArea: form.practiceArea || undefined,
        reminderDaysBefore: form.reminderDaysBefore
          ? Number(form.reminderDaysBefore)
          : undefined,
        effectiveFrom: form.effectiveFrom,
        effectiveTo: form.effectiveTo || undefined,
      });
      toast.success("Rule created (version 1).");
      setForm(emptyForm);
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the rule.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Editing a rule creates a new version — deadlines already approved keep
          the version they were computed with.
        </p>
        {canManage && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-1.5 size-4" /> New rule
          </Button>
        )}
      </div>

      {rules === undefined && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading rules…
        </p>
      )}
      {rules !== undefined && rules.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <ListChecks className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="font-serif text-lg">No rules defined yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Define how many working or calendar days the chamber has after an
              order, an adjournment or a completed filing. Rules are versioned;
              the exact version used is recorded on every deadline.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {(rules ?? []).map((r) => (
          <Card key={r._id}>
            <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{r.name}</p>
                  <Badge variant="outline">v{r.currentVersion}</Badge>
                  {r.criticality === "critical" && (
                    <Badge className="bg-[#7a1f1f] text-white">Critical</Badge>
                  )}
                  {!r.active && <Badge variant="secondary">Inactive</Badge>}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{ruleSentence(r)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {[
                    r.authority,
                    r.jurisdiction,
                    r.practiceArea,
                    `trigger day ${r.triggerDayTreatment}`,
                    r.weekendRule === "sat_sun" ? "weekends Sat+Sun" : "weekend Sun",
                    r.holidayRule === "skip" ? "holidays skipped" : "holidays counted",
                    `effective ${r.effectiveFrom}${r.effectiveTo ? ` → ${r.effectiveTo}` : ""}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {canManage && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await setActive({ ruleId: r._id as Id<"deadlineRules">, active: !r.active });
                      toast.success(r.active ? "Rule deactivated." : "Rule activated.");
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Failed.");
                    }
                  }}
                >
                  {r.active ? "Deactivate" : "Activate"}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif">New deadline rule</DialogTitle>
            <DialogDescription>
              Computation is deterministic and versioned; nothing is applied
              without a lawyer's approval.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label htmlFor="rule-name">Rule name</Label>
              <Input
                id="rule-name"
                className={inputCls}
                value={form.name}
                onChange={(e) => set("name")(e.target.value)}
                placeholder="e.g. Written statement after order"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="rule-trigger">Trigger event</Label>
                <Select value={form.triggerEvent} onValueChange={set("triggerEvent")}>
                  <SelectTrigger id="rule-trigger">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TRIGGER_EVENT_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="rule-direction">Direction</Label>
                <Select value={form.direction} onValueChange={set("direction")}>
                  <SelectTrigger id="rule-direction">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="after">After the trigger</SelectItem>
                    <SelectItem value="before">Before the trigger</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="rule-count-type">Count</Label>
                <Select value={form.countType} onValueChange={set("countType")}>
                  <SelectTrigger id="rule-count-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="calendar_days">Calendar days</SelectItem>
                    <SelectItem value="working_days">Working days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="rule-count">Number of days</Label>
                <Input
                  id="rule-count"
                  type="number"
                  min={1}
                  className={inputCls}
                  value={form.count}
                  onChange={(e) => set("count")(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="rule-trigday">Trigger day</Label>
                <Select
                  value={form.triggerDayTreatment}
                  onValueChange={set("triggerDayTreatment")}
                >
                  <SelectTrigger id="rule-trigday">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="excluded">Excluded from count</SelectItem>
                    <SelectItem value="included">Counts as day 1</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="rule-weekend">Weekend</Label>
                <Select value={form.weekendRule} onValueChange={set("weekendRule")}>
                  <SelectTrigger id="rule-weekend">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sat_sun">Saturday &amp; Sunday</SelectItem>
                    <SelectItem value="sun_only">Sunday only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="rule-holiday">Court holidays</Label>
                <Select value={form.holidayRule} onValueChange={set("holidayRule")}>
                  <SelectTrigger id="rule-holiday">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="skip">Skipped</SelectItem>
                    <SelectItem value="count">Counted as working days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="rule-criticality">Criticality</Label>
                <Select value={form.criticality} onValueChange={set("criticality")}>
                  <SelectTrigger id="rule-criticality">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="critical">Critical (explicit approval)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="rule-jur">Jurisdiction (optional)</Label>
                <Input
                  id="rule-jur"
                  className={inputCls}
                  value={form.jurisdiction}
                  onChange={(e) => set("jurisdiction")(e.target.value)}
                  placeholder="Any when empty"
                />
              </div>
              <div>
                <Label htmlFor="rule-auth">Court / authority (optional)</Label>
                <Input
                  id="rule-auth"
                  className={inputCls}
                  value={form.authority}
                  onChange={(e) => set("authority")(e.target.value)}
                  placeholder="e.g. Delhi High Court"
                />
              </div>
              <div>
                <Label htmlFor="rule-pa">Practice area (optional)</Label>
                <Input
                  id="rule-pa"
                  className={inputCls}
                  value={form.practiceArea}
                  onChange={(e) => set("practiceArea")(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="rule-rem">Reminder days before (optional)</Label>
                <Input
                  id="rule-rem"
                  type="number"
                  min={0}
                  className={inputCls}
                  value={form.reminderDaysBefore}
                  onChange={(e) => set("reminderDaysBefore")(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="rule-eff-from">Effective from</Label>
                <Input
                  id="rule-eff-from"
                  type="date"
                  className={inputCls}
                  value={form.effectiveFrom}
                  onChange={(e) => set("effectiveFrom")(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="rule-eff-to">Effective to (optional)</Label>
                <Input
                  id="rule-eff-to"
                  type="date"
                  className={inputCls}
                  value={form.effectiveTo}
                  onChange={(e) => set("effectiveTo")(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={
                busy ||
                !form.name.trim() ||
                !form.count ||
                Number(form.count) <= 0 ||
                !form.effectiveFrom
              }
              onClick={submit}
            >
              {busy && <Loader2 className="mr-2 size-4 animate-spin" />} Create rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ------------------------------------------------------ holidays desk

function HolidaysDesk() {
  const holidays = useQuery(api.deadlineRules.holidayList);
  const caps = useQuery(api.workspace.myCapabilities);
  const add = useMutation(api.deadlineRules.addHoliday);
  const remove = useMutation(api.deadlineRules.removeHoliday);
  const canManage = caps?.capabilities.includes("task.manage") ?? false;

  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [court, setCourt] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-4">
      {canManage && (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <div className="min-w-40 flex-1">
              <Label htmlFor="hol-date">Date</Label>
              <Input
                id="hol-date"
                type="date"
                className={inputCls}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="min-w-48 flex-1">
              <Label htmlFor="hol-name">Holiday</Label>
              <Input
                id="hol-name"
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Holi"
              />
            </div>
            <div className="min-w-48 flex-1">
              <Label htmlFor="hol-court">Court (optional)</Label>
              <Input
                id="hol-court"
                className={inputCls}
                value={court}
                onChange={(e) => setCourt(e.target.value)}
                placeholder="Applies to all courts when empty"
              />
            </div>
            <Button
              disabled={busy || !date || !name.trim()}
              onClick={async () => {
                setBusy(true);
                try {
                  await add({ date, name: name.trim(), court: court || undefined });
                  toast.success("Court holiday recorded.");
                  setDate("");
                  setName("");
                  setCourt("");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Plus className="mr-1.5 size-4" /> Add
            </Button>
          </CardContent>
        </Card>
      )}

      {holidays !== undefined && holidays.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <CalendarDays className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="font-serif text-lg">No court holidays recorded</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Holidays configured here are skipped by working-day rules and by
              the landing adjustment — visible in every calculation breakdown.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {(holidays ?? []).map((h) => (
          <Card key={h._id}>
            <CardContent className="flex items-center justify-between gap-2 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{h.name}</p>
                <p className="text-xs text-muted-foreground">
                  {h.date}
                  {h.court ? ` · ${h.court}` : ""}
                </p>
              </div>
              {canManage && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove ${h.name}`}
                  onClick={async () => {
                    try {
                      await remove({ holidayId: h._id });
                      toast.success("Holiday removed.");
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Failed.");
                    }
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------- generate dialog

function GenerateDialog({ onDone }: { onDone?: () => void }) {
  const matters = useQuery(api.matters.list);
  const caps = useQuery(api.workspace.myCapabilities);
  const generate = useMutation(api.deadlineRules.generateFromTrigger);
  const canManage = caps?.capabilities.includes("task.manage") ?? false;

  const [open, setOpen] = useState(false);
  const [matterId, setMatterId] = useState("");
  const [triggerEvent, setTriggerEvent] = useState("order_passed");
  const [triggerDate, setTriggerDate] = useState("");
  const [triggerRef, setTriggerRef] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceDetail, setSourceDetail] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={!canManage}>
          <Wand2 className="mr-1.5 size-4" /> Generate from court record
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">Generate deadline drafts</DialogTitle>
          <DialogDescription>
            Every active rule matching this trigger computes a draft with its
            full calculation breakdown. Nothing reaches the deadline register
            until a lawyer approves it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label htmlFor="gen-matter">Matter</Label>
            <Select value={matterId} onValueChange={setMatterId}>
              <SelectTrigger id="gen-matter">
                <SelectValue placeholder="Choose a matter" />
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="gen-trigger">Trigger</Label>
              <Select value={triggerEvent} onValueChange={setTriggerEvent}>
                <SelectTrigger id="gen-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TRIGGER_EVENT_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="gen-date">Trigger date</Label>
              <Input
                id="gen-date"
                type="date"
                className={inputCls}
                value={triggerDate}
                onChange={(e) => setTriggerDate(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="gen-ref">Source record reference</Label>
            <Input
              id="gen-ref"
              className={inputCls}
              value={triggerRef}
              onChange={(e) => setTriggerRef(e.target.value)}
              placeholder="e.g. order:12 or hearing:2026-03-02"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              The same rule version + source can never generate twice — retries
              are safe.
            </p>
          </div>
          <div>
            <Label htmlFor="gen-label">Source label (optional)</Label>
            <Input
              id="gen-label"
              className={inputCls}
              value={sourceLabel}
              onChange={(e) => setSourceLabel(e.target.value)}
              placeholder="e.g. Order in suit 12/2026"
            />
          </div>
          <div>
            <Label htmlFor="gen-detail">Source detail (optional)</Label>
            <Textarea
              id="gen-detail"
              className={inputCls}
              value={sourceDetail}
              onChange={(e) => setSourceDetail(e.target.value)}
              placeholder="e.g. paragraph 4 directs a written statement within 30 days"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={busy || !matterId || !triggerDate || !triggerRef.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await generate({
                  matterId: matterId as Id<"matters">,
                  triggerEvent,
                  triggerRef: triggerRef.trim(),
                  triggerDate,
                  sourceLabel: sourceLabel || undefined,
                  sourceDetail: sourceDetail || undefined,
                });
                if (r.created.length === 0) {
                  toast.message(
                    `No new drafts — ${r.skipped.length} skipped (already generated or no matching rule).`,
                    {
                      description:
                        r.skipped
                          .map((s) => `${s.ruleName}: ${s.reason}`)
                          .join(" · ") || undefined,
                    },
                  );
                } else {
                  toast.success(
                    `${r.created.length} draft(s) created for approval.` +
                      (r.skipped.length ? ` ${r.skipped.length} skipped.` : ""),
                  );
                }
                setTriggerRef("");
                setSourceLabel("");
                setSourceDetail("");
                setOpen(false);
                onDone?.();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Generation failed.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />} Generate drafts
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --------------------------------------------------- escalation desk

type EscalationRow = {
  _id: string;
  title: string;
  matterId: string;
  dueDate: string;
  daysUntilDue: number;
  unacknowledged: boolean;
};

function EscalationDesk() {
  const rows = useQuery(api.deadlineRules.escalations) as EscalationRow[] | undefined;

  return (
    <div className="space-y-3">
      {rows === undefined && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Checking critical deadlines…
        </p>
      )}
      {rows !== undefined && rows.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <Gavel className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="font-serif text-lg">Nothing on the critical watch</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Approved critical deadlines within three days of falling due — or
              already past due — appear here until they are acknowledged.
            </p>
          </CardContent>
        </Card>
      )}
      {(rows ?? []).map((r) => (
        <Card key={r._id}>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="font-medium">{r.title}</p>
              <p className="text-sm text-muted-foreground">
                Due {r.dueDate} —{" "}
                {r.daysUntilDue < 0
                  ? `overdue by ${Math.abs(r.daysUntilDue)} day(s)`
                  : r.daysUntilDue === 0
                    ? "due today"
                    : `${r.daysUntilDue} day(s) remaining`}
                {r.unacknowledged && " · not yet acknowledged"}
              </p>
            </div>
            <div className="flex gap-2">
              {r.daysUntilDue < 0 ? (
                <Badge className="bg-[#7a1f1f] text-white">Escalated</Badge>
              ) : (
                <Badge className="bg-[#8a6a33] text-white">Approaching</Badge>
              )}
              <Button size="sm" variant="outline" asChild>
                <Link to={`/matters/${r.matterId}?tab=tasks`}>Open matter</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
