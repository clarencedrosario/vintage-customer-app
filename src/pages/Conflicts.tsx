import { ChamberShell } from "@/components/ChamberShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  Loader2,
  Lock,
  Plus,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type MatchRow = {
  recordKind: string;
  tier: "exact" | "normalized" | "possible";
  matchedAgainst: string[];
  evidence: string[];
  recordId?: string;
  label?: string;
  detail?: string;
  restricted?: boolean;
};

const TIER_LABEL: Record<MatchRow["tier"], string> = {
  exact: "EXACT",
  normalized: "NORMALIZED",
  possible: "POSSIBLE",
};

const TIER_CLASS: Record<MatchRow["tier"], string> = {
  exact: "text-red-700 border-red-700/40 bg-red-50",
  normalized: "text-[#8a6a33] border-[#8a6a33]/40 bg-[#f6f1e6]",
  possible: "text-muted-foreground border-border",
};

function TierBadge({ tier, restricted }: { tier: MatchRow["tier"]; restricted?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 type-label ${TIER_CLASS[tier]}`}
    >
      {tier === "possible" ? (
        <AlertTriangle className="size-3" aria-hidden="true" />
      ) : (
        <ShieldAlert className="size-3" aria-hidden="true" />
      )}
      {TIER_LABEL[tier]}
      {restricted ? " · RESTRICTED" : ""}
    </span>
  );
}

/** Comma-separated tag input for parties, aliases, witnesses etc. */
function TagInput({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <p className="type-label ink-faded">Separate multiple entries with commas.</p>
    </div>
  );
}

const splitTags = (s: string): string[] =>
  s.split(",").map((t) => t.trim()).filter(Boolean);

export default function Conflicts() {
  const register = useQuery(api.conflicts.register) as
    | {
        _id: string;
        subject: string;
        proposedClientName?: string;
        reviewStatus: "pending" | "cleared" | "rejected";
        classification?: string;
        matchSummary?: { exact: number; normalized: number; possible: number; restricted: number };
        createdAt: number;
      }[]
    | undefined;
  const caps = useQuery(api.workspace.myCapabilities);
  const canCreate = caps?.capabilities.includes("matter.create") ?? false;
  const canOverride = caps?.capabilities.includes("conflict.override") ?? false;

  const createCheck = useMutation(api.conflicts.create);
  const classifyFn = useMutation(api.conflicts.classify);
  const overrideFn = useMutation(api.conflicts.override);
  const rejectFn = useMutation(api.conflicts.reject);

  // ---- New check form ----
  const [formOpen, setFormOpen] = useState(false);
  const [clientName, setClientName] = useState("");
  const [adverse, setAdverse] = useState("");
  const [companies, setCompanies] = useState("");
  const [directors, setDirectors] = useState("");
  const [witnesses, setWitnesses] = useState("");
  const [aliases, setAliases] = useState("");
  const [relatedMatters, setRelatedMatters] = useState("");
  const [referringParty, setReferringParty] = useState("");
  const [engagement, setEngagement] = useState("");
  const [busy, setBusy] = useState(false);

  // ---- Selected check detail ----
  const [selectedId, setSelectedId] = useState<Id<"conflictChecks"> | null>(null);
  const detail = useQuery(
    api.conflicts.get,
    selectedId ? { conflictId: selectedId } : "skip",
  );
  const liveSearch = useQuery(
    api.conflicts.search,
    selectedId ? { conflictId: selectedId } : "skip",
  );
  const reportText = useQuery(
    api.conflicts.report,
    selectedId ? { conflictId: selectedId } : "skip",
  );

  const [decision, setDecision] = useState("");
  const [reason, setReason] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [decisionBusy, setDecisionBusy] = useState(false);

  const submitNewCheck = async () => {
    if (!clientName.trim()) {
      toast.error("Name the proposed client.");
      return;
    }
    setBusy(true);
    try {
      const res = await createCheck({
        proposedClientName: clientName.trim(),
        adverseParties: splitTags(adverse),
        relatedCompanies: splitTags(companies),
        directorsBeneficialOwners: splitTags(directors),
        witnesses: splitTags(witnesses),
        aliases: splitTags(aliases),
        relatedMatterRefs: splitTags(relatedMatters),
        referringParty: referringParty || undefined,
        engagementDescription: engagement || undefined,
      });
      toast.success(`Conflict check ${res.reference} recorded.`);
      setSelectedId(res.conflictId);
      setFormOpen(false);
      setClientName("");
      setAdverse("");
      setCompanies("");
      setDirectors("");
      setWitnesses("");
      setAliases("");
      setRelatedMatters("");
      setReferringParty("");
      setEngagement("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record the check.");
    } finally {
      setBusy(false);
    }
  };

  const submitDecision = async () => {
    if (!selectedId) return;
    if (!reason.trim() || reason.trim().length < 10) {
      toast.error("Reasoning of at least 10 characters is required.");
      return;
    }
    setDecisionBusy(true);
    try {
      if (decision === "reject") {
        await rejectFn({ conflictId: selectedId, reason: reason.trim() });
        toast.success("Engagement declined — kept on the register.");
      } else {
        await classifyFn({
          conflictId: selectedId,
          classification: decision as "no_conflict" | "possible_conflict" | "confirmed_conflict" | "investigation_required",
          reason: reason.trim(),
        });
        toast.success("Classification recorded.");
      }
      setReason("");
      setDecision("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Decision failed.");
    } finally {
      setDecisionBusy(false);
    }
  };

  const submitOverride = async () => {
    if (!selectedId) return;
    if (overrideReason.trim().length < 10) {
      toast.error("An override requires a substantive reason.");
      return;
    }
    setDecisionBusy(true);
    try {
      await overrideFn({ conflictId: selectedId, reason: overrideReason.trim() });
      toast.success("Override recorded with audit entry.");
      setOverrideReason("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Override failed.");
    } finally {
      setDecisionBusy(false);
    }
  };

  const matches: MatchRow[] = liveSearch?.matches ?? [];
  const summary = liveSearch?.summary;

  return (
    <ChamberShell
      subtitle="The Digital Chamber"
      title="Conflicts desk"
      actions={
        canCreate ? (
          <Button size="sm" onClick={() => setFormOpen((o) => !o)}>
            <Plus className="mr-2 size-4" aria-hidden="true" />
            New conflict check
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-6">
        {formOpen && (
          <Card className="rule-frame">
            <CardContent className="space-y-4 p-5">
              <div>
                <p className="type-label ink-faded">New conflict check</p>
                <h2 className="font-serif text-lg font-semibold">
                  Pre-engagement screening
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Capture the proposed client, adverse parties, related companies,
                  directors/beneficial owners, witnesses, aliases, related matters,
                  referring party and the engagement description. Nothing here is an
                  automatic bar — a lawyer classifies every result.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TagInput
                  id="cc-client"
                  label="Proposed client"
                  value={clientName}
                  onChange={setClientName}
                  placeholder="e.g. Ramesh Industries Pvt Ltd"
                />
                <TagInput
                  id="cc-adverse"
                  label="Adverse parties"
                  value={adverse}
                  onChange={setAdverse}
                  placeholder="e.g. Sunil Kumar, State of Maharashtra"
                />
                <TagInput
                  id="cc-companies"
                  label="Related companies"
                  value={companies}
                  onChange={setCompanies}
                  placeholder="Group entities, subsidiaries…"
                />
                <TagInput
                  id="cc-directors"
                  label="Directors / beneficial owners"
                  value={directors}
                  onChange={setDirectors}
                  placeholder="e.g. Geeta Verma"
                />
                <TagInput
                  id="cc-witnesses"
                  label="Witnesses"
                  value={witnesses}
                  onChange={setWitnesses}
                  placeholder="Known witnesses…"
                />
                <TagInput
                  id="cc-aliases"
                  label="Aliases / former names"
                  value={aliases}
                  onChange={setAliases}
                  placeholder="e.g. S.K. Traders"
                />
                <TagInput
                  id="cc-related"
                  label="Related matters (refs)"
                  value={relatedMatters}
                  onChange={setRelatedMatters}
                  placeholder="e.g. ADV/2026/0001"
                />
                <TagInput
                  id="cc-referrer"
                  label="Referring party"
                  value={referringParty}
                  onChange={setReferringParty}
                  placeholder="Who sent the engagement?"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cc-engagement">Engagement description</Label>
                <Textarea
                  id="cc-engagement"
                  value={engagement}
                  onChange={(e) => setEngagement(e.target.value)}
                  placeholder="The nature of the dispute or work…"
                  className="min-h-[70px]"
                />
              </div>
              <Button onClick={submitNewCheck} disabled={busy}>
                {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
                Run search &amp; record check
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
          {/* Register */}
          <Card className="rule-frame h-fit">
            <CardContent className="p-4">
              <p className="type-label ink-faded mb-3 flex items-center gap-2">
                <ScrollText className="size-4" aria-hidden="true" /> Register
              </p>
              {register === undefined ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : register.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No conflict checks recorded yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {register.map((r) => (
                    <li key={r._id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(r._id as Id<"conflictChecks">)}
                        className={`w-full rounded border p-3 text-left transition-colors ${
                          selectedId === r._id
                            ? "border-[#B68A45] bg-[#f6f1e6]"
                            : "border-border hover:bg-muted/50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">
                            {r.proposedClientName ?? r.subject}
                          </span>
                          <Badge
                            variant={
                              r.reviewStatus === "cleared"
                                ? "default"
                                : r.reviewStatus === "rejected"
                                  ? "destructive"
                                  : "outline"
                            }
                          >
                            {r.reviewStatus.replace("_", " ")}
                          </Badge>
                        </div>
                        <p className="type-label mt-1 ink-faded">
                          {r.matchSummary
                            ? `${r.matchSummary.exact} exact · ${r.matchSummary.normalized} norm · ${r.matchSummary.possible} poss${r.matchSummary.restricted ? ` · ${r.matchSummary.restricted} restricted` : ""}`
                            : "legacy entry"}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Detail */}
          <div className="space-y-6">
            {!selectedId || !detail ? (
              <Card className="border-dashed">
                <CardContent className="py-10 text-center text-sm ink-faded">
                  Select a check from the register, or start a new one.
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Summary strip */}
                <Card className="rule-frame">
                  <CardContent className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="type-label ink-faded">Conflict check</p>
                        <h2 className="font-serif text-xl font-semibold">
                          {detail.proposedClientName ?? detail.subject}
                        </h2>
                        {detail.engagementDescription && (
                          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                            {detail.engagementDescription}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <Badge
                          variant={
                            detail.reviewStatus === "cleared"
                              ? "default"
                              : detail.reviewStatus === "rejected"
                                ? "destructive"
                                : "outline"
                          }
                        >
                          {detail.reviewStatus.replace("_", " ")}
                        </Badge>
                        {detail.classification && (
                          <Badge variant="outline">
                            {detail.classification.replace(/_/g, " ")}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {summary && (
                      <p className="type-label mt-3 ink-faded">
                        {summary.exact} exact · {summary.normalized} normalized ·{" "}
                        {summary.possible} possible
                        {summary.restricted > 0 ? ` · ${summary.restricted} RESTRICTED (confidential)` : ""}
                      </p>
                    )}
                    {detail.override && (
                      <p className="mt-2 rounded border border-[#8a6a33]/40 bg-[#f6f1e6] p-2 text-sm text-[#8a6a33]">
                        <ShieldCheck className="mr-1 inline size-4" aria-hidden="true" />
                        Elevated override by {detail.override.byName} — {detail.override.reason}
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Results */}
                <Card className="rule-frame">
                  <CardContent className="p-5">
                    <p className="type-label ink-faded mb-3">
                      Labelled search results (current &amp; former clients, matters,
                      opposing parties, contacts, witnesses, related parties,
                      organizations, aliases, earlier checks)
                    </p>
                    {matches.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No labelled matches for this check.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {matches.map((m, i) => (
                          <li key={m.recordId ?? `restricted-${i}`} className="rounded border p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <TierBadge tier={m.tier} restricted={m.restricted} />
                              {m.restricted ? (
                                <span className="flex items-center gap-1 text-sm text-[#8a6a33]">
                                  <Lock className="size-3.5" aria-hidden="true" />
                                  Confidential match — details withheld
                                </span>
                              ) : (
                                <span className="text-sm font-medium">{m.label}</span>
                              )}
                            </div>
                            {!m.restricted && m.detail && (
                              <p className="type-label mt-1 ink-faded">{m.detail}</p>
                            )}
                            <ul className="mt-1 space-y-0.5">
                              {m.evidence.slice(0, 3).map((e, j) => (
                                <li key={j} className="text-xs text-muted-foreground">
                                  • {e}
                                </li>
                              ))}
                            </ul>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>

                {/* Decisions */}
                {detail.reviewStatus === "pending" && canCreate && (
                  <Card className="rule-frame">
                    <CardContent className="space-y-3 p-5">
                      <p className="type-label ink-faded">Classification</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {[
                          ["no_conflict", "No conflict"],
                          ["possible_conflict", "Possible conflict"],
                          ["confirmed_conflict", "Confirmed conflict"],
                          ["investigation_required", "Investigation required"],
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setDecision(value)}
                            className={`rounded border p-2 text-left text-sm ${
                              decision === value
                                ? "border-[#B68A45] bg-[#f6f1e6] font-medium"
                                : "border-border hover:bg-muted/50"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="cc-reason">Reasoning (required)</Label>
                        <Textarea
                          id="cc-reason"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="Why this classification — which relationships were considered…"
                          className="min-h-[70px]"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button onClick={submitDecision} disabled={decisionBusy || !decision}>
                          {decisionBusy && <Loader2 className="mr-2 size-4 animate-spin" />}
                          Record decision
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setDecision("reject")}
                          disabled={decisionBusy}
                        >
                          Decline engagement
                        </Button>
                      </div>
                      {decision === "reject" && (
                        <p className="text-sm text-[#8a6a33]">
                          “Record decision” will decline the engagement entirely.
                        </p>
                      )}
                      {decision === "confirmed_conflict" && !canOverride && (
                        <p className="text-sm text-[#8a6a33]">
                          A confirmed conflict blocks matter opening until an
                          owner/partner records an override.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Override */}
                {detail.reviewStatus === "pending" &&
                  detail.classification === "confirmed_conflict" &&
                  canOverride && (
                    <Card className="rule-frame">
                      <CardContent className="space-y-3 p-5">
                        <p className="type-label ink-faded flex items-center gap-2">
                          <ShieldCheck className="size-4" aria-hidden="true" /> Elevated
                          override
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Clearing a confirmed conflict requires elevated permission and
                          is permanently audited with your reason.
                        </p>
                        <Textarea
                          value={overrideReason}
                          onChange={(e) => setOverrideReason(e.target.value)}
                          placeholder="e.g. Former client, unrelated dispute, informed consent documented…"
                          className="min-h-[70px]"
                        />
                        <Button onClick={submitOverride} disabled={decisionBusy}>
                          {decisionBusy && <Loader2 className="mr-2 size-4 animate-spin" />}
                          Record override
                        </Button>
                      </CardContent>
                    </Card>
                  )}

                {/* Report */}
                <Card className="rule-frame">
                  <CardContent className="p-5">
                    <p className="type-label ink-faded mb-2">Timestamped report</p>
                    {reportText === undefined ? (
                      <p className="text-sm text-muted-foreground">Rendering…</p>
                    ) : (
                      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded border bg-muted/30 p-3 text-xs leading-relaxed">
                        {reportText}
                      </pre>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      </div>
    </ChamberShell>
  );
}
