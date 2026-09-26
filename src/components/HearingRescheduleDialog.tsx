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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatDateTimeIN } from "@/lib/format";

/** Epoch ms → datetime-local string in IST, matching the outcome dialog. */
function istLocalInput(ts: number): string {
  const p = new Date(ts + 5.5 * 3600_000).toISOString();
  return `${p.slice(0, 4)}-${p.slice(5, 7)}-${p.slice(8, 10)}T${p.slice(11, 16)}`;
}

/**
 * Reschedule a hearing with a mandatory reason and live clash warnings.
 * The clash query is the same one the add-hearing flow can use — warnings,
 * not blocks: a firm may deliberately double-book, and every move lands in
 * the hearing's audit trail plus the org audit log.
 */
export function HearingRescheduleDialog({
  hearingId,
  hearingTitle,
  currentAt,
  courtroom,
  appearingAdvocateId,
  matterLeadId,
  open,
  onOpenChange,
}: {
  hearingId: Id<"hearings">;
  hearingTitle: string;
  currentAt: number;
  courtroom: string | null;
  appearingAdvocateId: Id<"users"> | null;
  /** The matter's lead lawyer — fallback diary for clash detection. */
  matterLeadId: Id<"users"> | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const reschedule = useMutation(api.matters.rescheduleHearing);
  const members = useQuery(api.workspace.team);

  const [newAt, setNewAt] = useState(istLocalInput(currentAt));
  const [reason, setReason] = useState("");
  const [courtroomValue, setCourtroomValue] = useState(courtroom ?? "");
  const [advocateValue, setAdvocateValue] = useState(
    appearingAdvocateId ?? ("none" as string),
  );
  const [busy, setBusy] = useState(false);

  const parsedAt = newAt ? new Date(newAt).getTime() : NaN;
  const clashResult = useQuery(
    api.matters.checkHearingClash,
    open && !Number.isNaN(parsedAt)
      ? {
          at: parsedAt,
          courtroom: courtroomValue.trim() || undefined,
          appearingAdvocateId:
            advocateValue && advocateValue !== "none"
              ? (advocateValue as Id<"users">)
              : undefined,
          fallbackAdvocateId: matterLeadId ?? undefined,
          excludeHearingId: hearingId,
        }
      : "skip",
  );
  const clashes = clashResult?.clashes ?? [];

  const submit = async () => {
    if (!newAt || Number.isNaN(parsedAt)) {
      toast.error("Pick a new date and time.");
      return;
    }
    if (reason.trim().length < 3) {
      toast.error("A reason is required (at least 3 characters).");
      return;
    }
    setBusy(true);
    try {
      await reschedule({
        hearingId,
        newAt: parsedAt,
        reason: reason.trim(),
        courtroom: courtroomValue.trim() || undefined,
        appearingAdvocateId:
          advocateValue && advocateValue !== "none"
            ? (advocateValue as Id<"users">)
            : undefined,
      });
      toast.success("Hearing rescheduled — audit trail updated.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reschedule.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">Reschedule hearing</DialogTitle>
          <DialogDescription>
            {hearingTitle} — currently {formatDateTimeIN(currentAt)}. The
            previous time is preserved in the audit trail.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="hr-at">New date &amp; time</Label>
            <Input
              id="hr-at"
              type="datetime-local"
              value={newAt}
              onChange={(e) => setNewAt(e.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="hr-courtroom">Courtroom (optional)</Label>
              <Input
                id="hr-courtroom"
                value={courtroomValue}
                onChange={(e) => setCourtroomValue(e.target.value)}
                placeholder="e.g. Courtroom 3"
              />
            </div>
            <div className="space-y-2">
              <Label>Appearing advocate</Label>
              <Select value={advocateValue} onValueChange={setAdvocateValue}>
                <SelectTrigger>
                  <SelectValue placeholder="Unchanged" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— none —</SelectItem>
                  {(members ?? [])
                    .filter((m) => m.status === "active")
                    .map(
                      (m: {
                        userId: string;
                        name?: string | null;
                        email?: string | null;
                      }) => (
                        <SelectItem key={m.userId} value={m.userId}>
                          {m.name ?? m.email ?? m.userId}
                        </SelectItem>
                      ),
                    )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="hr-reason">Reason (recorded in the audit trail)</Label>
            <Textarea
              id="hr-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Adjourned by the court at the request of counsel"
              rows={2}
            />
          </div>

          {clashes.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
                <TriangleAlert className="h-4 w-4" />
                {clashes.length} scheduling clash
                {clashes.length > 1 ? "es" : ""} detected
              </p>
              <ul className="mt-2 space-y-1 text-xs text-amber-700/90 dark:text-amber-400/90">
                {clashes.map((c) => (
                  <li key={c.hearingId}>
                    {c.matterReference !== "—" ? `${c.matterReference} — ` : ""}
                    {c.title} · {formatDateTimeIN(c.at)}
                    {c.reason === "same_advocate"
                      ? " (same advocate)"
                      : c.reason === "same_courtroom"
                        ? " (same courtroom)"
                        : " (overlapping time)"}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-amber-700/70 dark:text-amber-400/70">
                Warnings only — you may still reschedule; the move is audited.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? "Rescheduling…" : "Reschedule"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
