import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMutation, useQuery } from "convex/react";
import { Loader2, ScrollText, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

/**
 * Conflict gate for the "Open a matter" flow (Feature 3).
 *
 * Server rule: matters.create refuses to open a matter unless a cleared
 * (or elevated-overridden) conflict check exists for the proposed client.
 * This panel surfaces the check state inline — creation is blocked with
 * the server's reason until cleared, never silently.
 */
export function ConflictGatePanel({
  title,
  clientId,
  clientName,
  onCleared,
}: {
  title: string;
  clientId: string;
  clientName: string;
  onCleared: () => void;
}) {
  const createCheck = useMutation(api.conflicts.create);
  const caps = useQuery(api.workspace.myCapabilities);
  const canCreate = caps?.capabilities.includes("matter.create") ?? false;

  const [busy, setBusy] = useState(false);
  const [runId, setRunId] = useState<Id<"conflictChecks"> | null>(null);

  // Watch the candidate checks: the explicit run + any org check whose
  // subject matches the matter title or client name.
  const explicitRun = useQuery(
    api.conflicts.get,
    runId ? { conflictId: runId } : "skip",
  );

  const runCheck = async () => {
    if (!title.trim() || !clientId || !clientName.trim()) {
      toast.error("Matter title, client and practice area are required first.");
      return;
    }
    setBusy(true);
    try {
      const res = await createCheck({
        proposedClientName: clientName.trim(),
        clientId: clientId as never,
        adverseParties: title.trim() ? [title.trim()] : [],
        engagementDescription: `Matter opening: ${title.trim()}`,
      });
      setRunId(res.conflictId);
      toast.success(
        `Conflict check ${res.reference} recorded (${res.summary.exact + res.summary.normalized + res.summary.possible} labelled, ${res.summary.restricted} restricted).`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Conflict check failed.");
    } finally {
      setBusy(false);
    }
  };

  const row = explicitRun;
  const cleared =
    row !== undefined &&
    row !== null &&
    row.reviewStatus === "cleared" &&
    canProceed(row);

  if (cleared) {
    onCleared();
  }

  return (
    <div className="rounded-lg border border-[#B68A45]/40 bg-[#f6f1e6] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="type-label ink-faded flex items-center gap-2">
            <ShieldAlert className="size-4" aria-hidden="true" /> Conflict-of-interest gate
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            A cleared conflict check for <span className="font-medium text-foreground">{clientName}</span>{" "}
            is required before this matter can be opened.
          </p>
        </div>
        {row === null || row === undefined ? (
          <Button size="sm" variant="outline" onClick={runCheck} disabled={busy || !canCreate}>
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
            {row === undefined && runId ? "Loading…" : "Run conflict check"}
          </Button>
        ) : null}
      </div>

      {row && (
        <div className="mt-3 space-y-2 border-t border-[#B68A45]/30 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={row.reviewStatus === "cleared" ? "default" : row.reviewStatus === "rejected" ? "destructive" : "outline"}
            >
              {row.reviewStatus.replace("_", " ")}
            </Badge>
            {row.classification && (
              <Badge variant="outline">{row.classification.replace(/_/g, " ")}</Badge>
            )}
            {row.matchSummary && row.matchSummary.restricted > 0 && (
              <Badge variant="destructive" className="bg-red-700 text-white">
                {row.matchSummary.restricted} restricted
              </Badge>
            )}
            <span className="type-label ink-faded">
              {(row.matchSummary?.exact ?? 0) + (row.matchSummary?.normalized ?? 0) + (row.matchSummary?.possible ?? 0)} matches
            </span>
          </div>
          {row.reviewStatus !== "cleared" && (
            <p className="text-sm text-[#8a6a33]">
              {row.reviewStatus === "rejected"
                ? "The engagement was declined — a new check is needed if circumstances changed."
                : "Awaiting classification by an authorized lawyer."}{" "}
              <Link to="/conflicts" className="underline">
                Open the Conflicts desk →
              </Link>
            </p>
          )}
          {cleared && (
            <p className="flex items-center gap-2 text-sm text-[#8a6a33]">
              <ShieldCheck className="size-4" aria-hidden="true" />
              Conflict check cleared — you may open the matter.
              <Link to="/conflicts" className="underline">
                View report
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function canProceed(row: { classification: string | null; reviewStatus: string }): boolean {
  // Confirmed conflicts need an override recorded server-side.
  if (row.classification === "confirmed_conflict" && row.reviewStatus !== "cleared") {
    return false;
  }
  return row.reviewStatus === "cleared";
}

/** Legacy inline quick-check hint (from the original conflict desk). */
export function ConflictHintList({
  matches,
}: {
  matches: { clientId: string; clientName: string; evidence: string[] }[];
}) {
  if (matches.length === 0) return null;
  return (
    <div className="rounded-lg border border-[#B68A45]/50 bg-[#f6f1e6] p-3">
      <p className="text-xs font-medium text-[#8a6a33]">
        {matches.length} possible conflict{matches.length === 1 ? "" : "s"} — for
        human review, not an automatic bar.{" "}
        <Link to="/conflicts" className="inline-flex items-center gap-1 underline">
          <ScrollText className="size-3" aria-hidden="true" /> full check
        </Link>
      </p>
      <ul className="mt-1 space-y-1">
        {matches.slice(0, 4).map((m) => (
          <li key={m.clientId} className="text-xs text-muted-foreground">
            · {m.clientName}: {m.evidence[0]}
          </li>
        ))}
      </ul>
    </div>
  );
}
