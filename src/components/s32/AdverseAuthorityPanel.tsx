// =====================================================================
// §32 Phase 2 — Adverse authority & citation rechecking (matter file →
// Review tab). Real backend: adverseAuthority.searchAdverse (org-wide
// corpus), .recheck (job XOR bundle), .recordDecision (matter trail).
// Treatments are shown only when the backend reports them supported;
// scope/adverse notes are displayed verbatim — never swallowed.
// =====================================================================
import { useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { ExternalLink, Loader2, Search, ShieldQuestion } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { S32Empty, S32Loading, S32Note, errMessage } from "@/components/s32/shared";
import { formatDateIN } from "@/lib/format";

type AdverseHit = {
  stableKey: string;
  title: string;
  kind: string;
  country: string;
  sameCountry: boolean;
  jurisdictionLevel: string;
  court: string | null;
  decidedAt: number | null;
  citation: string | null;
  treatment: string | null;
  treatmentSourceKey: string | null;
  treatmentSupported: boolean;
  treatmentNote?: string;
  matchedTerms: string[];
  passage: string;
  sourceUrl: string;
  note: string;
};

type RecheckItem = {
  stableKey: string;
  status: "unchanged" | "changed" | "unavailable";
  recordedVersion?: number;
  currentVersion?: number;
  title?: string;
  treatment?: string | null;
  treatmentSourceKey?: string | null;
  treatmentNote?: string;
  decidedAt?: number | null;
  court?: string | null;
};

type RecheckResult = {
  researchDate: number;
  items: RecheckItem[];
  affected: number;
  scopeNote: string;
  adverseNote: string;
};

const DECISIONS = [
  { key: "reviewed_no_change_needed", label: "Reviewed — no change needed" },
  { key: "research_updated", label: "Research updated" },
  { key: "escalated_to_lawyer_review", label: "Escalated to lawyer review" },
] as const;

export function AdverseAuthorityPanel({
  matterId,
}: {
  matterId: Id<"matters">;
}) {
  const [position, setPosition] = useState("");
  const [country, setCountry] = useState("");
  const [hits, setHits] = useState<AdverseHit[] | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [recheck, setRecheck] = useState<RecheckResult | null>(null);
  const [recheckBusy, setRecheckBusy] = useState(false);
  const [decisionFor, setDecisionFor] = useState<string | null>(null);
  const [decision, setDecision] = useState<string>("");
  const [note, setNote] = useState("");

  // searchAdverse and recheck are QUERIES on the backend (pure reads over
  // the corpus), but they are user-triggered with validation errors that
  // must surface as toasts — not render-time throws. They are invoked
  // imperatively through the convex client inside the handlers.
  const convex = useConvex();

  const decideFn = useMutation(api.adverseAuthority.recordDecision);
  const jobs = useQuery(api.ai.listJobs, { matterId, limit: 20 });
  const bundles = useQuery(api.evidenceBundles.listForMatter, { matterId });

  const researchJobs = (jobs ?? []).filter(
    (j) => j.status === "done" && j.kind === "legal_research",
  );
  const lastJobId = researchJobs[0]?._id ?? null;
  const activeBundles = (bundles ?? []).filter(
    (b) => (b as { status?: string }).status !== "superseded",
  );

  const runSearch = async () => {
    if (position.trim().length < 8) {
      toast.error("State the proposition to check (at least a sentence).");
      return;
    }
    setSearchBusy(true);
    try {
      const rows = (await convex.query(api.adverseAuthority.searchAdverse, {
        position,
        country: country.trim() || undefined,
      })) as unknown as AdverseHit[];
      setHits(rows ?? []);
      toast.success(
        rows.length > 0
          ? `${rows.length} passage hit(s) — review the treatments and sources below.`
          : "No corpus passages matched the proposition's distinctive terms.",
      );
    } catch (e) {
      toast.error(errMessage(e, "The adverse search could not run."));
    } finally {
      setSearchBusy(false);
    }
  };

  const runRecheck = async (basis: { jobId?: string; bundleId?: string }) => {
    setRecheckBusy(true);
    try {
      const res = (await convex.query(api.adverseAuthority.recheck, {
        jobId: basis.jobId ? (basis.jobId as Id<"aiJobs">) : undefined,
        bundleId: basis.bundleId ? (basis.bundleId as Id<"researchBundles">) : undefined,
      })) as unknown as RecheckResult;
      setRecheck(res);
      toast.success(
        res.affected > 0
          ? `${res.affected} citation(s) need attention.`
          : "No citation changes in the corpus since the research ran.",
      );
    } catch (e) {
      toast.error(errMessage(e, "The recheck could not run."));
    } finally {
      setRecheckBusy(false);
    }
  };

  const saveDecision = async (stableKey: string) => {
    if (!decision || !note.trim()) {
      toast.error("Choose an outcome and record a reason (mandatory).");
      return;
    }
    try {
      await decideFn({
        matterId,
        stableKey,
        decision: decision as "reviewed_no_change_needed" | "research_updated" | "escalated_to_lawyer_review",
        note,
      });
      toast.success(`Decision recorded on the matter trail for ${stableKey}.`);
      setDecisionFor(null);
      setDecision("");
      setNote("");
    } catch (e) {
      toast.error(errMessage(e, "Could not record the decision."));
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <ShieldQuestion className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Adverse authority &amp; citation recheck</h3>
      </div>

      <S32Note>
        The search surfaces corpus passages that cut against your proposition
        with their terms and sources — it is a research aid, not a legal
        conclusion. Cross-jurisdiction hits are labelled, never substituted for
        local law; treatment labels appear only with their supporting source.
      </S32Note>

      <div className="space-y-2 rounded-md border border-border/70 p-3">
        <div>
          <Label className="text-xs">Proposition to stress-test</Label>
          <Textarea
            className="mt-1 min-h-[60px]"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            placeholder="State the proposition in a full sentence (e.g. 'A minor's statement to police is admissible without safeguards under …')."
          />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-44">
            <Label className="text-xs">Jurisdiction hint (optional)</Label>
            <Input
              className="mt-1"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="e.g. India"
            />
          </div>
          <Button
            size="sm"
            className="gap-1.5"
            disabled={searchBusy || position.trim().length < 8}
            onClick={() => void runSearch()}
          >
            {searchBusy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            Search the corpus
          </Button>
        </div>
      </div>

      {hits && hits.length === 0 && (
        <S32Empty>
          No corpus passage shared at least two distinctive terms with the
          proposition. That is an absence of indexed matches — not proof that no
          adverse authority exists.
        </S32Empty>
      )}

      {hits && hits.length > 0 && (
        <div className="space-y-3">
          {hits.map((h) => (
            <div key={h.stableKey} className="rounded-md border border-border/70 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{h.title}</p>
                <Badge variant={h.sameCountry ? "default" : "secondary"} className="text-[10px]">
                  {h.sameCountry ? h.country : `other jurisdiction · ${h.country}`}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {h.jurisdictionLevel}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {h.court ?? "—"}
                {h.decidedAt ? ` · decided ${formatDateIN(h.decidedAt)}` : ""}
                {h.citation ? ` · ${h.citation}` : ""}
              </p>
              <blockquote className="mt-2 border-l-2 border-border pl-3 text-sm italic leading-relaxed">
                “{h.passage}”
              </blockquote>
              <p className="mt-2 text-xs text-muted-foreground">
                Matched terms: {h.matchedTerms.join(", ")}
              </p>
              {h.treatment && (
                <p className="mt-2 text-xs">
                  <span className="font-medium">Recorded treatment:</span> {h.treatment}
                  {h.treatmentSourceKey ? ` (supported by ${h.treatmentSourceKey})` : ""}
                </p>
              )}
              {h.treatmentNote && (
                <S32Note className="mt-2">{h.treatmentNote}</S32Note>
              )}
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">{h.note}</p>
                <a
                  href={h.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
                >
                  <ExternalLink className="size-3" /> Inspect source
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Citation recheck — grounded in the matter's own research record. */}
      <div className="rounded-md border border-border/70 p-3">
        <p className="text-sm font-medium">Recheck this matter's citations</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={recheckBusy || !lastJobId}
            onClick={() => lastJobId && void runRecheck({ jobId: lastJobId })}
          >
            {recheckBusy ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
            Recheck last research job
          </Button>
          {activeBundles.map((b) => {
            const id = String(b._id);
            return (
              <Button
                key={id}
                size="sm"
                variant="ghost"
                disabled={recheckBusy}
                onClick={() => void runRecheck({ bundleId: id })}
              >
                Recheck “{(b as { title?: string }).title ?? id.slice(-6)}”
              </Button>
            );
          })}
        </div>
        {!lastJobId && activeBundles.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Run a legal research job or freeze a bundle first — the recheck
            compares THAT recorded snapshot with the current corpus.
          </p>
        )}
        {recheck && (
          <div className="mt-3 space-y-2">
            <S32Note>{recheck.scopeNote}</S32Note>
            <S32Note>{recheck.adverseNote}</S32Note>
            {recheck.items.map((it) => (
              <div key={it.stableKey} className="rounded-md border border-border/70 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      it.status === "changed"
                        ? "destructive"
                        : it.status === "unavailable"
                          ? "secondary"
                          : "outline"
                    }
                    className="text-[10px]"
                  >
                    {it.status}
                  </Badge>
                  <p className="text-sm">{it.title ?? it.stableKey}</p>
                  <span className="text-xs text-muted-foreground">
                    recorded v{it.recordedVersion ?? "?"} → current{" "}
                    {it.currentVersion !== undefined ? `v${it.currentVersion}` : "—"}
                  </span>
                </div>
                {it.treatmentNote && (
                  <p className="mt-1 text-xs text-muted-foreground">{it.treatmentNote}</p>
                )}
                {it.status !== "unchanged" && (
                  <div className="mt-2">
                    {decisionFor === it.stableKey ? (
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-2">
                          {DECISIONS.map((d) => (
                            <Button
                              key={d.key}
                              size="sm"
                              variant={decision === d.key ? "default" : "outline"}
                              className="h-7 text-xs"
                              onClick={() => setDecision(d.key)}
                            >
                              {d.label}
                            </Button>
                          ))}
                        </div>
                        <Textarea
                          className="min-h-[48px]"
                          value={note}
                          placeholder="Reason (mandatory) — recorded on the matter trail."
                          onChange={(e) => setNote(e.target.value)}
                        />
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => setDecisionFor(null)}>
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            disabled={!decision || !note.trim()}
                            onClick={() => void saveDecision(it.stableKey)}
                          >
                            Save decision
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => {
                          setDecisionFor(it.stableKey);
                          setDecision("");
                          setNote("");
                        }}
                      >
                        Record decision
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
