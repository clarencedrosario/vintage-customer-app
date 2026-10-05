// =====================================================================
// §32 Phase 1 — Conflicting-evidence review (matter file → Review tab).
//
// Loads the REAL authorized findings via conflictReview.list (walls
// filtered server-side), shows the competing passages side by side with
// their document/version references, and records lawyer decisions via
// the exact `conflictReview.act` action literals:
//   confirm_conflict · dismiss_different_events · dismiss_other_reason ·
//   mark_unresolved · accept_interpretation
// A reason is mandatory (backend refuses empty notes); every saved
// decision lands in the finding's append-only history.
// =====================================================================
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { History, Loader2, RefreshCw, Scale } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  S32Empty,
  S32Loading,
  S32Note,
  errMessage,
} from "@/components/s32/shared";
import { formatDateIN, formatDateTimeIN, formatINR } from "@/lib/format";

// ---- Pure decision surface (mirrors conflictReview.act exactly) ------

export const ACTION_OPTIONS = [
  {
    key: "confirm_conflict",
    label: "Confirm conflict",
    status: "confirmed_conflict",
    hint: "Both passages stand and contradict each other on the record.",
  },
  {
    key: "dismiss_different_events",
    label: "Dismiss — different events",
    status: "dismissed_different_events",
    hint: "The passages concern different events, not a contradiction.",
  },
  {
    key: "dismiss_other_reason",
    label: "Dismiss — other reason",
    status: "dismissed_other_reason",
    hint: "Not a real conflict (state the reason on the record).",
  },
  {
    key: "mark_unresolved",
    label: "Mark unresolved",
    status: "unresolved",
    hint: "Keep the conflict visible until the underlying record is fixed.",
  },
  {
    key: "accept_interpretation",
    label: "Accept interpretation",
    status: "accepted_interpretation",
    hint: "Record how the two passages reconcile without declaring either false.",
  },
] as const;

export type ReviewAction = (typeof ACTION_OPTIONS)[number]["key"];

export const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  reassessment_flagged: "Re-assess",
  confirmed_conflict: "Conflict confirmed",
  dismissed_different_events: "Dismissed — different events",
  dismissed_other_reason: "Dismissed — other reason",
  unresolved: "Unresolved",
  accepted_interpretation: "Interpretation accepted",
};

function statusTone(status: string): "default" | "destructive" | "secondary" | "outline" {
  if (status === "open" || status === "reassessment_flagged") return "destructive";
  if (status === "confirmed_conflict") return "destructive";
  if (status === "unresolved") return "secondary";
  return "outline";
}

// ----------------------------------------------------------------------

type Finding = {
  findingId: string;
  kind: string;
  kindLabel: string;
  topicKey: string;
  status: string;
  note: string | null;
  sourceChangeFlag: boolean | undefined;
  createdAt: number;
  updatedAt: number;
  sideA: {
    statement: string;
    occurredOn: string | null;
    amountMinor: number | null;
    partyName: string | null;
    version: number;
    sourceDocumentId: string | null;
    pinpoints: string[];
    sourceName: string | undefined;
    sourceVersionAt: number | undefined;
  };
  sideB: Finding["sideA"];
};

function SideCard({
  side,
  label,
}: {
  side: Finding["sideA"];
  label: string;
}) {
  return (
    <div className="rounded-md border border-border/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <Badge variant="outline" className="text-[10px]">
          v{side.version}
        </Badge>
      </div>
      <p className="mt-2 text-sm leading-relaxed">{side.statement}</p>
      <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
        {side.occurredOn && (
          <div className="flex gap-1">
            <dt className="font-medium">Date:</dt>
            <dd>{formatDateIN(side.occurredOn)}</dd>
          </div>
        )}
        {side.amountMinor != null && (
          <div className="flex gap-1">
            <dt className="font-medium">Amount:</dt>
            <dd>{formatINR(side.amountMinor)}</dd>
          </div>
        )}
        {side.partyName && (
          <div className="flex gap-1">
            <dt className="font-medium">Party:</dt>
            <dd>{side.partyName}</dd>
          </div>
        )}
        {side.sourceName && (
          <div className="flex gap-1">
            <dt className="font-medium">Source:</dt>
            <dd>
              {side.sourceName}
              {side.sourceVersionAt
                ? ` · as of ${formatDateTimeIN(side.sourceVersionAt)}`
                : ""}
            </dd>
          </div>
        )}
        {side.pinpoints.length > 0 && (
          <div className="flex gap-1">
            <dt className="font-medium">Pinpoints:</dt>
            <dd>{side.pinpoints.join(" · ")}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export function ConflictReviewPanel({ matterId }: { matterId: Id<"matters"> }) {
  const [showResolved, setShowResolved] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  // Per-finding decision form state (only one open at a time keeps the
  // review deliberate: pick a finding, record its decision on the record).
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [action, setAction] = useState<ReviewAction | "">("");
  const [note, setNote] = useState("");
  const [actBusy, setActBusy] = useState(false);
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  const findings = useQuery(api.conflictReview.list, {
    matterId,
    includeResolved: showResolved,
  });
  const caps = useQuery(api.workspace.myCapabilities);
  const history = useQuery(
    api.conflictReview.history,
    historyFor ? { findingId: historyFor as Id<"reviewFindings"> } : "skip",
  );

  const scanFn = useMutation(api.conflictReview.scan);
  const actFn = useMutation(api.conflictReview.act);

  const canAct = caps?.capabilities.includes("note.write") ?? false;

  const openCount = useMemo(
    () => (findings ?? []).length,
    [findings],
  );

  const runScan = async () => {
    setScanBusy(true);
    try {
      const res = await scanFn({ matterId });
      toast.success(
        res.created > 0
          ? `Re-scan complete — ${res.created} conflicting pair(s) detected.`
          : "Re-scan complete — no new conflicting passages.",
      );
    } catch (e) {
      toast.error(errMessage(e, "Could not re-scan the matter record."));
    } finally {
      setScanBusy(false);
    }
  };

  const saveDecision = async () => {
    if (!actingOn || !action) return;
    if (!note.trim()) {
      toast.error("A reason is required for every review action.");
      return;
    }
    setActBusy(true);
    try {
      const res = await actFn({
        findingId: actingOn as Id<"reviewFindings">,
        action,
        note,
      });
      toast.success(`Decision recorded — ${STATUS_LABELS[res.status] ?? res.status}.`);
      setActingOn(null);
      setAction("");
      setNote("");
    } catch (e) {
      toast.error(errMessage(e, "Could not record the decision."));
    } finally {
      setActBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <S32Note>
        Conflicting passages are surfaced for lawyer review only — recording a
        decision is a professional judgement recorded on the audit trail, never
        an automated resolution. Later document changes flag affected findings
        for re-assessment instead of rewriting them.
      </S32Note>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={scanBusy || !canAct}
          onClick={() => void runScan()}
        >
          {scanBusy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Re-scan the record
        </Button>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="accent-primary"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
          />
          Show decisions already on the record
        </label>
        {!canAct && (
          <Badge variant="secondary" className="text-xs">
            Read-only — recording decisions needs the note-writing capability
          </Badge>
        )}
      </div>

      {findings === undefined ? (
        <S32Loading label="Loading conflicting passages…" />
      ) : findings.length === 0 ? (
        <S32Empty>
          No conflicting passages are on the review list
          {showResolved
            ? ""
            : " — re-scan after new documents are extracted, or toggle the decisions view above."}
        </S32Empty>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {openCount} finding{openCount === 1 ? "" : "s"} listed
            {showResolved ? " (including decided)" : " (open only)"}
          </p>
          {findings.map((f) => {
            const row = f as unknown as Finding;
            const isActing = actingOn === row.findingId;
            const flagged = !!row.sourceChangeFlag;
            return (
              <Card key={row.findingId}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Scale className="size-4 text-muted-foreground" />
                    <CardTitle className="text-sm">{row.kindLabel}</CardTitle>
                    <Badge variant={statusTone(row.status)}>
                      {STATUS_LABELS[row.status] ?? row.status}
                    </Badge>
                    {flagged && (
                      <Badge variant="destructive" className="text-[10px]">
                        Source changed — re-assess
                      </Badge>
                    )}
                    <span className="ml-auto flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1 text-xs"
                        onClick={() => setHistoryFor(row.findingId)}
                      >
                        <History className="size-3.5" /> History
                      </Button>
                      {!isActing && canAct && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => {
                            setActingOn(row.findingId);
                            setAction("");
                            setNote("");
                          }}
                        >
                          Record decision
                        </Button>
                      )}
                    </span>
                  </div>
                  {row.note && !isActing && (
                    <p className="mt-1 text-xs italic text-muted-foreground">
                      On the record: “{row.note}”
                    </p>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <SideCard side={row.sideA} label="Passage A" />
                    <SideCard side={row.sideB} label="Passage B" />
                  </div>

                  {isActing && (
                    <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
                      <div>
                        <Label className="text-xs">Decision</Label>
                        <Select
                          value={action}
                          onValueChange={(v) => setAction(v as ReviewAction)}
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue placeholder="Choose the review outcome" />
                          </SelectTrigger>
                          <SelectContent>
                            {ACTION_OPTIONS.map((o) => (
                              <SelectItem key={o.key} value={o.key}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {action && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {ACTION_OPTIONS.find((o) => o.key === action)?.hint}
                          </p>
                        )}
                      </div>
                      <div>
                        <Label className="text-xs">Reason (required)</Label>
                        <Textarea
                          className="mt-1 min-h-[64px]"
                          value={note}
                          placeholder="Record why — this is saved on the finding's history."
                          onChange={(e) => setNote(e.target.value)}
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setActingOn(null);
                            setAction("");
                            setNote("");
                          }}
                          disabled={actBusy}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          className="gap-1.5"
                          disabled={actBusy || !action || !note.trim()}
                          onClick={() => void saveDecision()}
                        >
                          {actBusy && <Loader2 className="size-4 animate-spin" />}
                          Save to the record
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Decision history — append-only revisions on the record. */}
      <Dialog
        open={historyFor !== null}
        onOpenChange={(o) => !o && setHistoryFor(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">Decision history</DialogTitle>
            <DialogDescription>
              Every recorded decision, newest first. Entries cannot be edited or
              removed.
            </DialogDescription>
          </DialogHeader>
          {history === undefined ? (
            <S32Loading label="Loading history…" />
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No recorded decisions yet for this finding.
            </p>
          ) : (
            <ol className="max-h-72 space-y-3 overflow-y-auto pr-1">
              {history.map((h) => (
                <li key={h._id} className="rounded-md border border-border/70 p-3">
                  <p className="text-xs text-muted-foreground">
                    {formatDateTimeIN(h.createdAt)}
                  </p>
                  <p className="mt-1 text-sm">
                    {STATUS_LABELS[String(h.fromStatus)] ?? String(h.fromStatus)}
                    {" → "}
                    <span className="font-medium">
                      {STATUS_LABELS[String(h.toStatus)] ?? String(h.toStatus)}
                    </span>
                  </p>
                  <p className="mt-1 text-xs italic text-muted-foreground">
                    “{h.note}”
                  </p>
                </li>
              ))}
            </ol>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
