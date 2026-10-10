// CJ GLOBAL platform console — official-source discovery monitor +
// candidate review queue (turn-33 extension of the §32 Phase 11 console).
//
// Scope honesty (per the owner's acceptance conditions):
//  - Scheduled runs with `newCandidates: 0` demonstrate EXECUTION and
//    DEDUPLICATION for the registered listing — they do NOT demonstrate
//    complete source coverage. The card says so explicitly.
//  - Three statuses are shown separately per candidate: technical
//    validation (automated gates), publication decision (operator
//    promote/reject with a note), and qualified legal review (ALWAYS
//    "outstanding" for auto-discovered text until a qualified reviewer
//    attests — owning the software grants neither).
//  - Promote/reject requires platformOperator + 7-day reauthentication
//    (reauthGate — same loginEvents evidence class as firmExit).
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
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

type Packet = FunctionReturnType<
  typeof api.legalDiscoveryStore.reviewPacket
>;

const STATUS_ORDER = ["promoted", "validated", "review", "found", "validating", "rejected"] as const;

function fmtWhen(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SourceDiscoveryCard() {
  const monitor = useQuery(api.legalDiscoveryStore.discoveryMonitor);
  const queue = useQuery(api.legalDiscoveryStore.reviewQueue);
  const reject = useMutation(api.legalDiscoveryStore.rejectCandidate);
  // promoteFromReview is an ACTION (network + pdfjs); useMutation accepts
  // actions too — the call goes through the same mutation queue client
  // helper. Typed via the api reference below.
  const promote = useMutation(
    api.legalDiscovery.promoteFromReview as unknown as Parameters<typeof useMutation>[0],
  );

  const [packetFor, setPacketFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Packet loaded lazily for the candidate under review.
  const packet = useQuery(
    api.legalDiscoveryStore.reviewPacket,
    packetFor ? { candidateId: packetFor as never } : "skip",
  );

  if (monitor === undefined || queue === undefined) return null;

  const counts = monitor.byStatus as Record<string, number>;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="font-serif text-lg">
              Official-source discovery
            </CardTitle>
            <CardDescription>
              Listing scans → validation gates → operator review. Scheduled runs with zero new
              candidates demonstrate execution and deduplication of the registered listing —
              they do not imply complete source coverage.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Coverage honesty strip */}
        <div className="flex flex-wrap gap-2">
          {STATUS_ORDER.map((s) => (
            <Badge
              key={s}
              variant={s === "promoted" ? "default" : s === "rejected" ? "destructive" : "secondary"}
              className="text-xs"
            >
              {s}: {counts[s] ?? 0}
            </Badge>
          ))}
          <span className="text-xs text-muted-foreground self-center">
            Registered listing: ncpcr-jj-listing · coverage: this listing only
          </span>
        </div>

        {/* Sweep evidence */}
        <div className="overflow-hidden rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Listing</TableHead>
                <TableHead>Links</TableHead>
                <TableHead>New</TableHead>
                <TableHead>Validated</TableHead>
                <TableHead>Promoted</TableHead>
                <TableHead>Review</TableHead>
                <TableHead>Rejected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {monitor.recentLogs.map((l) => (
                <TableRow key={l._id}>
                  <TableCell className="text-xs whitespace-nowrap">{fmtWhen(l.triggeredAt)}</TableCell>
                  <TableCell className="text-xs">{l.trigger}</TableCell>
                  <TableCell className="text-xs">{l.listingKey}</TableCell>
                  <TableCell className="text-xs">{l.linksFound}</TableCell>
                  <TableCell className="text-xs">{l.newCandidates}</TableCell>
                  <TableCell className="text-xs">{l.validated}</TableCell>
                  <TableCell className="text-xs">{l.promoted}</TableCell>
                  <TableCell className="text-xs">{l.queuedForReview}</TableCell>
                  <TableCell className="text-xs">{l.rejected}</TableCell>
                </TableRow>
              ))}
              {monitor.recentLogs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-xs text-muted-foreground">
                    No sweeps recorded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Review queue */}
        <div className="rounded-md border border-border">
          <div className="border-b border-border px-3 py-2">
            <p className="text-sm font-medium">Candidates awaiting publication decision</p>
            <p className="text-xs text-muted-foreground">
              Review opens the full packet: original document URL, extracted identity, dates,
              jurisdiction, amendment relationship, extraction warnings, proposed identifier.
              Publication approval is NOT legal review — that status stays outstanding.
            </p>
          </div>
          <div className="divide-y divide-border">
            {queue.length === 0 && (
              <p className="px-3 py-3 text-xs text-muted-foreground">
                Nothing awaits review.
              </p>
            )}
            {queue.map((c) => (
              <div key={c._id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <Badge variant="secondary" className="text-xs">{c.status}</Badge>
                <span className="text-xs truncate max-w-[22rem]" title={c.url}>
                  {c.linkTitle ?? c.url.split("/").slice(-1)[0] ?? c.url}
                </span>
                {c.detectedStableKey && (
                  <code className="text-[11px] text-muted-foreground">{c.detectedStableKey}</code>
                )}
                <span className="ml-auto flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setPacketFor(c._id);
                      setNote("");
                    }}
                  >
                    Open packet
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await reject({
                          candidateId: c._id,
                          note: note || "Rejected without note (packet not opened).",
                        });
                        toast.success("Candidate rejected");
                      } catch (e) {
                        toast.error(String(e).replace("Error: ", ""));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Reject
                  </Button>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Packet dialog */}
        <Dialog open={!!packetFor} onOpenChange={(o) => !o && setPacketFor(null)}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-serif">Review packet</DialogTitle>
              <DialogDescription>
                Technical validation is automated. Publication is your decision. Legal accuracy
                review remains a separate, outstanding obligation.
              </DialogDescription>
            </DialogHeader>
            {!packet ? (
              <p className="text-sm text-muted-foreground">Loading packet…</p>
            ) : (
              <div className="space-y-4 text-sm">
                {/* Three separate statuses */}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {[
                    {
                      k: "Technical validation",
                      v: packet.statuses.technicalValidation,
                      cls:
                        packet.statuses.technicalValidation === "passed"
                          ? "bg-emerald-50 text-emerald-900 border-emerald-200"
                          : "bg-amber-50 text-amber-900 border-amber-200",
                    },
                    {
                      k: "Publication decision",
                      v: packet.statuses.publicationDecision,
                      cls: "bg-stone-100 text-stone-800 border-stone-200",
                    },
                    {
                      k: "Qualified legal review",
                      // Data-driven from the review-record table (turn 34):
                      // reviewed only when a qualified-review row covers
                      // the promoted source's CURRENT latest version.
                      v: packet.statuses.legalReview,
                      cls: /REVIEWED/.test(packet.statuses.legalReview)
                        ? "bg-emerald-50 text-emerald-900 border-emerald-200"
                        : /FLAGGED/.test(packet.statuses.legalReview)
                          ? "bg-red-50 text-red-900 border-red-200"
                          : "bg-amber-50 text-amber-900 border-amber-200",
                    },
                  ].map((s) => (
                    <div key={s.k} className={`rounded-md border px-3 py-2 ${s.cls}`}>
                      <p className="text-[11px] uppercase tracking-wide opacity-70">{s.k}</p>
                      <p className="text-xs font-medium mt-0.5">{s.v}</p>
                    </div>
                  ))}
                </div>

                {/* Turn 35: authority separation — publication vs review */}
                <p className={`text-xs rounded-md border px-3 py-2 ${packet.reviewer.canLegallyReview ? "bg-emerald-50 text-emerald-900 border-emerald-200" : "bg-amber-50 text-amber-900 border-amber-200"}`}>
                  <span className="font-medium">Your authorities:</span> publication {packet.reviewer.name ? "(you are an operator)" : "(not an operator)"} · legal review{" "}
                  {packet.reviewer.canLegallyReview
                    ? "— you hold an active reviewer assignment for in: instruments (your credentials are recorded as self-declared, not independently verified)"
                    : "— NOT available: no active reviewer assignment covers this jurisdiction; operating or owning the platform is not reviewer qualification"}
                </p>

                {/* Original document + provenance */}
                <div className="rounded-md border border-border p-3 space-y-1.5 text-xs">
                  <p>
                    <span className="text-muted-foreground">Original document:</span>{" "}
                    <a
                      href={packet.candidate.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline underline-offset-2"
                    >
                      {packet.candidate.linkTitle ?? packet.candidate.url}
                    </a>
                  </p>
                  {packet.provenance && (
                    <p>
                      <span className="text-muted-foreground">Publisher:</span>{" "}
                      {packet.provenance.publisher} · collected {packet.provenance.collectionDate}
                    </p>
                  )}
                  <p>
                    <span className="text-muted-foreground">Listing:</span>{" "}
                    {packet.candidate.listingKey} · first seen {fmtWhen(packet.candidate.firstSeenAt)}
                  </p>
                  {packet.extracted.bytesHash && (
                    <p className="text-muted-foreground">
                      Retrieved-bytes sha256: <code>{packet.extracted.bytesHash.slice(0, 16)}…</code>
                    </p>
                  )}
                </div>

                {/* Extraction result */}
                <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">Extracted title (identity)</dt>
                    <dd>{packet.extracted.identity ?? "— (uncertain)"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Proposed identifier</dt>
                    <dd>
                      {packet.extracted.proposedStableKey ? (
                        <code>{packet.extracted.proposedStableKey}</code>
                      ) : (
                        "none (would be invented — review required)"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Jurisdiction</dt>
                    <dd>{packet.extracted.jurisdiction}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Instrument shape</dt>
                    <dd>{packet.extracted.amendmentRelationship}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Title as published (listing)</dt>
                    <dd>{packet.extracted.enactedOrPublishedAs ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Extraction size</dt>
                    <dd>
                      {packet.extracted.bodyChars ?? "—"} chars ·{" "}
                      {packet.extracted.sectionsCount ?? "—"} anchors
                    </dd>
                  </div>
                </dl>

                {/* Extraction warnings */}
                {packet.warnings.length > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                    <p className="text-xs font-medium text-amber-900">Extraction warnings</p>
                    <ul className="mt-1 list-disc pl-4 text-xs text-amber-900">
                      {packet.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Decision input */}
                <div className="space-y-1.5">
                  <Label htmlFor="rvw-note" className="text-xs">
                    Decision note (required for promote; records your reasoning)
                  </Label>
                  <Input
                    id="rvw-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. matches the official amendment act I cross-checked on India Code"
                  />
                  {packet.reviewer.reauthPending && (
                    <p className="text-xs text-amber-700">
                      Your last sign-in is older than 7 days — sign in again before promoting.
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={busy || !note.trim()}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const res = await promote({
                            candidateId: packet.candidate._id,
                            note: note.trim(),
                          });
                          if (res && "alreadyPresent" in res && res.alreadyPresent) {
                            toast.message("Already in corpus — candidate marked rejected");
                          } else {
                            toast.success("Source published (legal review still outstanding)");
                          }
                          setPacketFor(null);
                        } catch (e) {
                          toast.error(String(e).replace("Error: ", ""));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Promote with note
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await reject({ candidateId: packet.candidate._id, note: note.trim() || "Rejected at packet." });
                          toast.success("Candidate rejected");
                          setPacketFor(null);
                        } catch (e) {
                          toast.error(String(e).replace("Error: ", ""));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Reject from packet
                    </Button>
                  </div>
                </div>

                {/* Gate summary footer */}
                {packet.gateSummary && (
                  <p className="text-[11px] text-muted-foreground border-t pt-2">
                    {packet.gateSummary}
                  </p>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

/** Unauthenticated-view guard is already handled by the Platform page. */
export type PacketShape = Packet;
