import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link } from "react-router";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { ChamberShell } from "@/components/ChamberShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, BookOpen, Globe, Scale, Search, ShieldCheck } from "lucide-react";
import { countryName, normalizeCitation } from "@/lib/legalIntel";

const STATUS_STAMP: Record<string, string> = {
  verified: "text-emerald-700",
  partial: "text-amber-700",
  not_started: "text-muted-foreground",
};

/** The firm's matters for the context selector. */
function MatterPicker({
  onPick,
  selected,
}: {
  onPick: (id: string, ref: string, title: string) => void;
  selected: string | null;
}) {
  const matters = useQuery(api.matters.list, {});
  const visible = (matters ?? []).slice(0, 50);
  return (
    <Select
      value={selected ?? undefined}
      onValueChange={(v) => {
        const m = visible.find((x) => x._id === v);
        if (m) onPick(m._id, m.reference, m.title);
      }}
    >
      <SelectTrigger className="w-full sm:w-[320px]">
        <SelectValue placeholder="Choose a matter…" />
      </SelectTrigger>
      <SelectContent>
        {visible.map((m) => (
          <SelectItem key={m._id} value={m._id}>
            {m.reference} — {m.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function LegalIntel() {
  const coverage = useQuery(api.legalIntel.coverage, {});
  const freshness = useQuery(api.legalIntel.freshness, {});

  // Matter context
  const [matterId, setMatterId] = useState<string | null>(null);
  const [matterRef, setMatterRef] = useState("");
  const context = useQuery(
    api.legalIntel.activeContext,
    matterId ? { matterId: matterId as never } : "skip",
  );

  // Jurisdiction + date (profile value when confirmed; editable draft otherwise)
  const [countryDraft, setCountryDraft] = useState("");
  const [dateDraft, setDateDraft] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const setProfile = useMutation(api.legalIntel.setMatterProfile);

  const activeCountry = context?.jurisdiction.country ?? "in";
  const activeDate = dateDraft || context?.legalDate.date || "";

  // Source search — always available, no AI generation involved.
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const normalized = useMemo(() => normalizeCitation(query), [query]);
  const results = useQuery(
    api.legalIntel.searchSources,
    query.trim()
      ? { q: query.trim(), country: activeCountry, onDate: activeDate || undefined }
      : "skip",
  );
  const sourceDetail = useQuery(
    api.legalIntel.getSource,
    selectedKey ? { stableKey: selectedKey } : "skip",
  );

  const applicability = useQuery(
    api.legalIntel.applicability,
    activeDate ? { country: activeCountry, onDate: activeDate } : "skip",
  );

  // Automated research check (demand #2): question → jurisdiction/date →
  // retrieval of real provisions → grounded answer → clickable passages.
  // No LLM involved: the template answer is assembled from RETRIEVED text
  // only and every passage verifies against the stored corpus.
  const [question, setQuestion] = useState("");
  const [anchorHint, setAnchorHint] = useState("");
  const [openPassage, setOpenPassage] = useState<string | null>(null);
  const research = useQuery(
    api.legalIntel.researchCheck,
    activeDate
      ? {
          country: activeCountry,
          onDate: activeDate,
          // question is deliberately NOT an arg: it is echoed for the
          // record only and never changes retrieval, so typing must not
          // re-run the pipeline.
          anchorHint: anchorHint.trim() || undefined,
        }
      : "skip",
  );

  const activeCov = (coverage ?? []).find((c) => c.country === activeCountry);
  const jurisdictionConfirmed = context?.jurisdiction.confirmed ?? false;
  const supportedLegislation =
    (activeCov?.legislation ?? "not_started") !== "not_started";

  const saveProfile = async () => {
    if (!matterId || !countryDraft.trim()) return;
    setSavingProfile(true);
    try {
      await setProfile({
        matterId: matterId as never,
        country: countryDraft.trim(),
      });
      toast.success("Matter jurisdiction confirmed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <ChamberShell
      subtitle="Advokate"
      title="Legal Intelligence"
      actions={
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <Scale className="size-3.5" aria-hidden="true" />
          Verified sources · cited answers
        </span>
      }
    >
      {/* Active jurisdiction + legal date — always prominent */}
      <Card className="rule-frame bg-card">
        <CardHeader className="pb-3">
          <CardDescription className="flex items-center gap-2">
            <Globe className="size-3.5" aria-hidden="true" />
            Active jurisdiction and governing legal date
          </CardDescription>
          <CardTitle className="font-serif text-2xl">
            {context ? context.jurisdiction.countryLabel : "Select a matter"}
            {context && (
              <span className="ml-3 align-middle text-sm font-normal text-muted-foreground">
                {context.legalDate.date}
                {context.legalDate.isAssumption && (
                  <Badge variant="outline" className="ml-2 text-amber-700">
                    date assumed
                  </Badge>
                )}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!context && (
            <p className="text-sm text-muted-foreground">
              Pick a matter below — its jurisdiction and legal dates drive every
              answer and search. Firm settings are defaults only; the lawyer's
              per-matter confirmation always wins.
            </p>
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs">Matter context</Label>
              <MatterPicker
                selected={matterId}
                onPick={(id, ref) => {
                  setMatterId(id);
                  setMatterRef(ref);
                  setCountryDraft("");
                  setDateDraft("");
                  setSelectedKey(null);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Governing legal date</Label>
              <Input
                type="date"
                value={activeDate}
                onChange={(e) => setDateDraft(e.target.value)}
                className="w-[180px]"
              />
            </div>
          </div>

          {context && !jurisdictionConfirmed && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <p className="flex items-center gap-2 font-medium">
                <AlertTriangle className="size-4" aria-hidden="true" />
                Jurisdiction not matter-confirmed — using the firm default.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input
                  value={countryDraft}
                  onChange={(e) => setCountryDraft(e.target.value)}
                  placeholder="Country code, e.g. in"
                  className="max-w-[140px]"
                />
                <Button size="sm" disabled={savingProfile || !matterId} onClick={saveProfile}>
                  Confirm jurisdiction for {matterRef || "this matter"}
                </Button>
              </div>
            </div>
          )}
          {context && jurisdictionConfirmed && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5 text-emerald-700" aria-hidden="true" />
              Confirmed by a lawyer on {matterRef}.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Coverage honesty: unsupported / stale states are explicit */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="rule-frame bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="font-serif text-lg">Coverage for this jurisdiction</CardTitle>
            <CardDescription>
              A country here does not imply AI support — statuses are per domain.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!activeCov ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="size-4 text-amber-700" aria-hidden="true" />
                No verified coverage registered for {countryName(activeCountry)} yet —
                research will refuse rather than answer from memory.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                {(["legislation", "judgments", "procedure", "tax", "payroll", "drafting"] as const).map(
                  (k) => (
                    <div key={k} className="flex items-center justify-between gap-2">
                      <span className="capitalize text-muted-foreground">{k}</span>
                      <span className={`stamp ${STATUS_STAMP[activeCov[k]]}`}>
                        {activeCov[k].replace("_", " ")}
                      </span>
                    </div>
                  ),
                )}
              </div>
            )}
            {applicability?.resolved && (
              <p className="mt-3 rounded-md border border-border bg-muted p-2 text-xs">
                Governing code on {activeDate || "—"}:{" "}
                <strong>{applicability.resolved.applicableLabel}</strong>{" "}
                <span className="text-muted-foreground">
                  ({applicability.resolved.reason})
                </span>
                {applicability.resolved.crossRefs.map((r) => (
                  <span key={r.toKey + r.toAnchor} className="mt-1 block">
                    Cross-reference → {r.toKey} {r.toAnchor} [{r.mappingKind}]
                    {r.notes ? ` — ${r.notes}` : ""}
                  </span>
                ))}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="rule-frame bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="font-serif text-lg">Source freshness</CardTitle>
            <CardDescription>
              Ingestion status per source — stale sources are warned, not hidden.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {(freshness ?? []).slice(0, 8).map((f) => (
              <div key={f.stableKey} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{f.title}</span>
                {f.stale ? (
                  <Badge variant="outline" className="text-amber-700">
                    {f.lastSuccessfulAt ? "stale" : "awaiting ingestion"}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-emerald-700">
                    current
                  </Badge>
                )}
              </div>
            ))}
            {freshness && freshness.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No sources registered yet — run the platform seed from the owner console.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Automated research check — real ingested text, no LLM */}
      <Card className="rule-frame mt-6 bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="font-serif text-lg flex items-center gap-2">
            <Search className="size-4" aria-hidden="true" />
            Research check — question to source-backed passage
          </CardTitle>
          <CardDescription>
            Runs the retrieval→applicability→citation pipeline over the stored,
            verified corpus (no language model). Every passage below is shown
            from the stored text and validated; era and transitional questions
            are flagged for lawyer review, never auto-resolved.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Legal question, e.g. punishment for murder for conduct on 2024-03-01"
            />
            <Input
              value={anchorHint}
              onChange={(e) => setAnchorHint(e.target.value)}
              placeholder="Pinpoint (e.g. § 302) — optional"
              className="sm:w-[220px]"
            />
          </div>
          {!activeDate && (
            <p className="text-sm text-muted-foreground">
              Pick a matter (or set the governing legal date above) to run the
              check — the date decides which era of law is retrieved.
            </p>
          )}
          {research && (
            <div className="space-y-3">
              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                <p className="font-medium">Answer (template-assembled from retrieved sources only)</p>
                <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed">{research.answer}</p>
                <p className="mt-2 text-[11px] text-muted-foreground">{research.generatedBy}</p>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Retrieved passages — click to inspect the stored text around the anchor
                </p>
                {research.retrieved.map((passage) => {
                  const open = openPassage === passage.stableKey + passage.anchor;
                  return (
                    <div key={passage.stableKey + passage.anchor} className="rounded-md border border-border">
                      <button
                        type="button"
                        onClick={() => setOpenPassage(open ? null : passage.stableKey + passage.anchor)}
                        className="flex w-full items-center justify-between gap-2 p-2.5 text-left hover:bg-accent/40"
                      >
                        <span className="text-sm font-medium">
                          {passage.title} · {passage.anchor}
                          <span className="ml-2 font-normal text-muted-foreground">{passage.heading}</span>
                        </span>
                        {passage.checkOk ? (
                          <Badge variant="outline" className="shrink-0 text-emerald-700">verified</Badge>
                        ) : (
                          <Badge variant="outline" className="shrink-0 text-amber-700">unverified</Badge>
                        )}
                      </button>
                      {open && (
                        <div className="border-t border-border bg-muted/30 p-3">
                          <pre className="max-h-60 overflow-auto whitespace-pre-wrap text-xs leading-relaxed">
                            {passage.quote}
                          </pre>
                          <p className="mt-2 text-[11px] text-muted-foreground">
                            Stored version, offset {passage.offset} · anchor {passage.anchor}
                            {passage.problem ? ` · validation: ${passage.problem}` : ""}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
                {research.retrieved.length === 0 && research.contract.refusalRequired && (
                  <p className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                    Refusal recorded — no verified sources for this jurisdiction/date. The pipeline will not substitute memory for sources.
                  </p>
                )}
              </div>
              {research.applicability?.reviewFlags && research.applicability.reviewFlags.length > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  <p className="font-medium">For lawyer review — unresolved applicability</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    {research.applicability.reviewFlags.map((f) => (
                      <li key={f.slice(0, 40)}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Verified source search — works with AI generation unavailable */}
      <Card className="rule-frame mt-6 bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="font-serif text-lg flex items-center gap-2">
            <BookOpen className="size-4" aria-hidden="true" />
            Verified source library
          </CardTitle>
          <CardDescription>
            Search stored, provenance-recorded sources. Type an abbreviation
            (e.g. “ipc”) and the official title is shown.
            {normalized && normalized.officialTitle !== normalized.input && (
              <span className="ml-1 text-foreground">
                → {normalized.officialTitle}
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search statutes, codes, judgments…"
            />
            <Button variant="outline" size="icon" aria-label="Search">
              <Search className="size-4" aria-hidden="true" />
            </Button>
          </div>

          {!supportedLegislation && activeCov && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              Legislation coverage for {activeCov.countryName} is{" "}
              {activeCov.legislation.replace("_", " ")} — results here are registry
              entries, not yet verified full-text law.
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              {(results ?? []).map((r) => (
                <button
                  key={r.stableKey}
                  type="button"
                  onClick={() => setSelectedKey(r.stableKey)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent/40 ${
                    selectedKey === r.stableKey ? "border-[#B68A45]" : "border-border"
                  }`}
                >
                  <p className="flex items-center justify-between gap-2 text-sm font-medium">
                    <span className="truncate">{r.title}</span>
                    {!r.ingested && (
                      <Badge variant="outline" className="shrink-0 text-amber-700">
                        text pending
                      </Badge>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {r.countryName} · {r.kind} · key {r.stableKey}
                    {r.citation ? ` · ${r.citation}` : ""}
                  </p>
                  {r.snippet && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {r.snippet}
                    </p>
                  )}
                </button>
              ))}
              {query.trim() && results && results.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No verified sources match. The library is honest — it does not
                  pad results with unverified material.
                </p>
              )}
            </div>

            <div className="rounded-lg border border-border bg-muted/40 p-3">
              {sourceDetail ? (
                <div className="space-y-2">
                  <p className="font-serif text-base font-semibold">
                    {sourceDetail.source.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {sourceDetail.source.publisher} · collected{" "}
                    {sourceDetail.collectedAt ?? sourceDetail.source.collectionDate} ·{" "}
                    <a
                      className="text-[#8a6a33] underline"
                      href={sourceDetail.source.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      official source
                    </a>
                    {sourceDetail.source.citation
                      ? ` · ${sourceDetail.source.citation}`
                      : ""}
                  </p>
                  {sourceDetail.crossRefs.length > 0 && (
                    <div className="rounded border border-border bg-card p-2 text-xs">
                      <p className="font-medium">Verified cross-references</p>
                      {sourceDetail.crossRefs.map((r) => (
                        <p key={r.fromAnchor + r.toKey} className="mt-1">
                          {r.fromAnchor} → {r.toKey} {r.toAnchor || "—"} [
                          {r.mappingKind}]
                          {r.notes ? ` — ${r.notes}` : ""}
                        </p>
                      ))}
                    </div>
                  )}
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-card p-2 text-xs">
                    {sourceDetail.body}
                  </pre>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Select a source to inspect its verified text, provenance and
                  cross-references.
                </p>
              )}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Full AI research runs on a matter with the verified library — open{" "}
            <Link to="/ai" className="text-[#8a6a33] underline">
              Advokate AI
            </Link>{" "}
            and choose a matter; research answers follow the nine-part verified
            contract and refuse unsupported jurisdictions.
          </p>
        </CardContent>
      </Card>
    </ChamberShell>
  );
}
