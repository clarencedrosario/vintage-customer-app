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
  const [nextAction, setNextAction] = useState("");
  const [scheduleNext, setScheduleNext] = useState(false);
  const [nextTitle, setNextTitle] = useState("");
  const [nextAt, setNextAt] = useState("");
  const [createTasks, setCreateTasks] = useState(true);
  const [makeDraft, setMakeDraft] = useState(true);

  const record = useMutation(api.matters.recordHearingOutcome);
  const addTask = useMutation(api.matters.addTask);
  const createDraft = useMutation(api.drafts.create);
  const busy = false;

  const suggestions = useMemo(
    () => suggestFromOutcome(status, outcome, nextAction, nextTitle || undefined),
    [status, outcome, nextAction, nextTitle],
  );

  const canSave = outcome.trim().length > 2 && matterId;

  const submit = async () => {
    if (!matterId) return;
    try {
      await record({
        hearingId,
        status,
        outcome,
        nextAction: nextAction || undefined,
        nextHearing:
          scheduleNext && nextTitle.trim() && nextAt
            ? {
                title: nextTitle,
                at: new Date(nextAt).getTime(),
                purpose: undefined,
              }
            : undefined,
      });

      // Suggested tasks — each one explicitly confirmed by the lawyer.
      const created: SuggestedTask[] = createTasks ? suggestions.tasks : [];
      for (const t of created) {
        await addTask({
          matterId,
          title: t.title,
          dueAt:
            t.dueInDays !== undefined
              ? Date.now() + t.dueInDays * 24 * 3600_000
              : undefined,
          kind: t.kind,
          priority: t.priority,
        });
      }

      // Client update goes to the Drafts desk for review/approval —
      // it is NOT sent to the client from here.
      if (makeDraft) {
        await createDraft({
          matterId,
          kind: "client_update",
          title: `Client update — ${hearingTitle}`,
          body: suggestions.clientUpdate,
        });
      }

      const extras = [
        created.length ? `${created.length} task(s)` : null,
        makeDraft ? "client update draft" : null,
        scheduleNext ? "next hearing" : null,
      ]
        .filter(Boolean)
        .join(", ");
      toast.success(
        `Outcome recorded${extras ? ` — ${extras} added` : ""}.`,
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record outcome.");
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

          {/* Suggested follow-up work */}
          <div className="rounded-md border border-border p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={createTasks}
                onCheckedChange={(v) => setCreateTasks(v === true)}
              />
              <ListChecks className="size-4" aria-hidden="true" />
              Add suggested follow-up tasks
              <Badge variant="outline" className="ml-1 text-xs">
                reviewable
              </Badge>
            </label>
            <ul className="mt-2 space-y-1.5 pl-7">
              {suggestions.tasks.map((t) => (
                <li key={t.title} className="text-sm">
                  {t.title}
                  {t.dueInDays !== undefined && (
                    <span className="text-xs text-muted-foreground">
                      {" "}
                      · due in {t.dueInDays} day{t.dueInDays === 1 ? "" : "s"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>

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
