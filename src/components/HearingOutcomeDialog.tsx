import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { CalendarPlus, ListChecks, MailPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  suggestFromOutcome,
  type OutcomeStatus,
  type SuggestedTask,
} from "@/lib/outcomeFlow";

function istLocalInput(ts: number): string {
  const p = new Date(ts + 5.5 * 3600_000).toISOString();
  return `${p.slice(0, 4)}-${p.slice(5, 7)}-${p.slice(8, 10)}T${p.slice(11, 16)}`;
}

/**
 * Record what happened at a hearing, and (all optional, all reviewed):
 * create the next hearing, confirm suggested follow-up tasks, and open
 * a client-update draft for the review/approval desk.
 */
export function HearingOutcomeDialog({
  hearingId,
  hearingTitle,
  court,
  open,
  onOpenChange,
}: {
  hearingId: Id<"hearings">;
  hearingTitle: string;
  court: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const matterId = useQuery(api.matters.matterForHearing, { hearingId });

  const [status, setStatus] = useState<OutcomeStatus>("held");
  const [outcome, setOutcome] = useState("");
  const [attendance, setAttendance] = useState<"appeared" | "represented" | "adjourned_absent">("appeared");
  const [appearances, setAppearances] = useState("");
  const [directions, setDirections] = useState("");
  const [deadlineTitle, setDeadlineTitle] = useState("");
  const [deadlineDate, setDeadlineDate] = useState("");
  const [deadlineSource, setDeadlineSource] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [scheduleNext, setScheduleNext] = useState(false);
  const [nextTitle, setNextTitle] = useState("");
  const [nextAt, setNextAt] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [clientSummary, setClientSummary] = useState("");
  const [requiredDocs, setRequiredDocs] = useState("");
  const [updateNextPack, setUpdateNextPack] = useState(false);
  const [makeDraft, setMakeDraft] = useState(true);
  const [busy, setBusy] = useState(false);

  const propose = useMutation(api.outcomeProposals.proposeOutcomeActions);
  const listProposals = useQuery(
    api.outcomeProposals.listForHearing,
    open ? { hearingId } : "skip",
  );

  const suggestions = useMemo(
    () => suggestFromOutcome(status, outcome, nextAction, nextTitle || undefined),
    [status, outcome, nextAction, nextTitle],
  );

  const canSave = outcome.trim().length > 2 && matterId;

  const submit = async () => {
    if (!matterId) return;
    setBusy(true);
    try {
      const deadline =
        deadlineTitle.trim() && deadlineDate
          ? {
              title: deadlineTitle.trim(),
              category: "court_order" as const,
              dueAt: new Date(`${deadlineDate}T18:59:59.999Z`).getTime(),
              source:
                deadlineSource.trim() ||
                `Recorded at hearing: ${hearingTitle}`,
              rule: `Set to ${deadlineDate} (IST day-end) from the hearing outcome`,
            }
          : undefined;

      // Feature 2: everything becomes a REVIEWABLE proposal — chronology,
      // tasks, deadlines, client update, next hearing, pack flag. Nothing
      // is applied until a lawyer approves (single or bulk).
      const res = await propose({
        hearingId,
        status,
        outcome,
        attendance,
        appearances: appearances || undefined,
        directions: directions
          ? directions.split(/[;\n]/).map((d) => d.trim()).filter(Boolean)
          : undefined,
        nextAction: nextAction || undefined,
        nextHearing:
          scheduleNext && nextTitle.trim() && nextAt
            ? {
                title: nextTitle,
                at: new Date(nextAt).getTime(),
                purpose: undefined,
              }
            : undefined,
        deadlines: deadline ? [deadline] : undefined,
        internalNotes: internalNotes || undefined,
        clientSummary: clientSummary || undefined,
        requiredDocuments: requiredDocs
          ? requiredDocs.split(/[;,\n]/).map((d) => d.trim()).filter(Boolean)
          : undefined,
        updateNextPack,
      });

      const extras = [
        res.stored ? `${res.stored} item${res.stored === 1 ? "" : "s"} proposed` : null,
        res.proposed === res.stored ? null : "rest already awaiting review",
      ]
        .filter(Boolean)
        .join(" · ");
      toast.success(
        `Outcome recorded — ${extras || "no new items"}. Approve them below.`,
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record outcome.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif">Record hearing outcome</DialogTitle>
          <DialogDescription>
            {hearingTitle}
            {court ? ` · ${court}` : ""} — what happened, and what follows.
            Suggested tasks and the client update are drafts until you
            confirm them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <div className="space-y-1.5">
              <Label>Result</Label>
              <div className="flex gap-1 rounded-md border border-border p-1">
                {(["held", "adjourned"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    aria-pressed={status === s}
                    className={`flex-1 rounded px-2 py-1 text-sm capitalize ${
                      status === s
                        ? "bg-[#B68A45] text-white"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ho-outcome">What happened</Label>
              <Textarea
                id="ho-outcome"
                rows={3}
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                placeholder="e.g. Arguments heard in part; matter adjourned for remaining arguments."
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ho-action">Immediate next action (optional)</Label>
            <Input
              id="ho-action"
              value={nextAction}
              onChange={(e) => setNextAction(e.target.value)}
              placeholder="e.g. File written submissions by Friday"
            />
          </div>

          {/* Next hearing */}
          <div className="rounded-md border border-border p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={scheduleNext}
                onCheckedChange={(v) => setScheduleNext(v === true)}
              />
              <CalendarPlus className="size-4" aria-hidden="true" />
              Schedule the next hearing now
            </label>
            {scheduleNext && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ho-nh-title">Title</Label>
                  <Input
                    id="ho-nh-title"
                    value={nextTitle}
                    onChange={(e) => setNextTitle(e.target.value)}
                    placeholder="e.g. Final arguments"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ho-nh-at">Date &amp; time (IST)</Label>
                  <Input
                    id="ho-nh-at"
                    type="datetime-local"
                    value={nextAt}
                    onChange={(e) => setNextAt(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Attendance, appearances & directions (Feature 2 capture) */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ho-att">Attendance</Label>
              <select
                id="ho-att"
                value={attendance}
                onChange={(e) => setAttendance(e.target.value as typeof attendance)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="appeared">Counsel appeared</option>
                <option value="represented">Represented by counsel</option>
                <option value="adjourned_absent">Adjourned — no appearance</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ho-appear">Appearances</Label>
              <Input
                id="ho-appear"
                value={appearances}
                onChange={(e) => setAppearances(e.target.value)}
                placeholder="e.g. Mr. Sharma for plaintiff; Ms. Rao for State"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ho-directions">Directions / orders (one per line)</Label>
            <Textarea
              id="ho-directions"
              rows={2}
              value={directions}
              onChange={(e) => setDirections(e.target.value)}
              placeholder="e.g. File written submissions within 30 days"
            />
          </div>

          {/* Critical deadline capture — source required for the audit trail */}
          <div className="rounded-md border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ho-dl-title">Deadline title (optional)</Label>
                <Input
                  id="ho-dl-title"
                  value={deadlineTitle}
                  onChange={(e) => setDeadlineTitle(e.target.value)}
                  placeholder="e.g. File written submissions"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ho-dl-date">Due date (IST)</Label>
                <Input
                  id="ho-dl-date"
                  type="date"
                  value={deadlineDate}
                  onChange={(e) => setDeadlineDate(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-3 space-y-1.5">
              <Label htmlFor="ho-dl-src">Source line from the court (shown with the deadline)</Label>
              <Input
                id="ho-dl-src"
                value={deadlineSource}
                onChange={(e) => setDeadlineSource(e.target.value)}
                placeholder="e.g. “File written submissions within 30 days” — order dated 20 Sep 2026"
              />
            </div>
          </div>

          {/* Notes, client-facing summary, required documents */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ho-notes">Internal notes</Label>
              <Textarea
                id="ho-notes"
                rows={2}
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ho-summary">Client-facing summary (optional)</Label>
              <Textarea
                id="ho-summary"
                rows={2}
                value={clientSummary}
                onChange={(e) => setClientSummary(e.target.value)}
                placeholder="Plain language — replaces the outcome text in the client update"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ho-docs">Required documents (comma-separated)</Label>
              <Input
                id="ho-docs"
                value={requiredDocs}
                onChange={(e) => setRequiredDocs(e.target.value)}
                placeholder="e.g. Certified order copy, vakalatnama"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox
                  checked={updateNextPack}
                  onCheckedChange={(v) => setUpdateNextPack(v === true)}
                />
                <ListChecks className="size-4" aria-hidden="true" />
                Open/refresh the next Hearing Pack
              </label>
            </div>
          </div>

          {/* Proposal review — approve/reject before anything applies */}
          {listProposals && listProposals.length > 0 && (
            <div className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">
                  Proposed items ({listProposals.filter((p) => p.status === "pending").length} pending)
                </Label>
                <Badge variant="outline" className="text-xs">
                  nothing applied until approved
                </Badge>
              </div>
              <ul className="mt-2 space-y-1.5">
                {listProposals.slice(0, 6).map((p) => (
                  <li key={p._id} className="flex items-center gap-2 text-sm">
                    <Badge
                      variant={p.status === "approved" ? "default" : p.status === "rejected" ? "destructive" : "outline"}
                      className="text-xs"
                    >
                      {p.status}
                    </Badge>
                    <span className="truncate">{p.title}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                Review, edit and approve each item — or bulk-approve — from the matter's hearing outcome panel.
              </p>
            </div>
          )}

          {/* Client update draft */}
          <div className="rounded-md border border-border p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={makeDraft}
                onCheckedChange={(v) => setMakeDraft(v === true)}
              />
              <MailPlus className="size-4" aria-hidden="true" />
              Prepare a client update as a draft
              <Badge variant="outline" className="ml-1 text-xs">
                Draft — review required
              </Badge>
            </label>
            <pre className="mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap rounded bg-muted/50 p-3 font-serif text-sm">
              {suggestions.clientUpdate}
            </pre>
            <p className="mt-1 text-xs text-muted-foreground">
              The draft goes to the review desk; it reaches the client only
              after approval.
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!canSave || busy}>
              Record outcome
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** istLocalInput is used by the parent to prefill next-hearing defaults. */
export { istLocalInput };
