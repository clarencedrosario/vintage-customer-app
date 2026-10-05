// =====================================================================
// §32 Phase 6 — Verified redaction (matter file → Documents tab).
// Real backend: redactionRun.produceVerifiedRedaction (action) +
// redaction.listRedactionJobs (per-matter history). Text-family files
// only — honest refusal reasons for everything else; the coverage note
// travels with every job. Verified derivatives are real vault documents
// and download through the existing secure link.
// =====================================================================
import { useState } from "react";
// produceVerifiedRedaction is an ACTION (storage writes + V8); getDocumentUrl
// is a QUERY fetched imperatively when the lawyer opens a derivative.
import { useAction, useConvex, useQuery } from "convex/react";
import { toast } from "sonner";
import { Eraser, Loader2, Plus, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { S32Empty, S32Loading, S32Note, errMessage } from "@/components/s32/shared";
import { formatDateTimeIN } from "@/lib/format";
import { REDACTION_COVERAGE_NOTE } from "@/lib/redaction";

type TermEntry = { term: string; label: string; reason: string };

type JobRow = {
  _id: string;
  documentId: string;
  status: string;
  refusalReason?: string;
  refusalDetail?: string;
  hits: { term: string; count: number }[];
  verification: { term: string; residueCount: number }[];
  derivativeDocumentId?: string;
  derivativeSha256?: string;
  derivativeChars?: number;
  createdAt: number;
};

type DocRow = {
  _id: string;
  name: string;
  kind?: string;
  visibility?: string;
};

export function RedactionPanel({ matterId }: { matterId: Id<"matters"> }) {
  const documents = useQuery(api.matters.listDocuments, { matterId });
  const jobs = useQuery(api.redaction.listRedactionJobs, { matterId });
  const produce = useAction(api.redactionRun.produceVerifiedRedaction);
  const convex = useConvex();

  const [docId, setDocId] = useState<string>("");
  const [terms, setTerms] = useState<TermEntry[]>([]);
  const [draftTerm, setDraftTerm] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftReason, setDraftReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [urlBusy, setUrlBusy] = useState<string | null>(null);

  // Text-family files only, judged from the NAME (backend re-derives this
  // itself and refuses anything else — the filter here is a courtesy).
  const TEXT_EXT = /\.(txt|md|markdown|csv|json)$/i;
  const candidates = (documents ?? []).filter(
    (d) => TEXT_EXT.test((d as unknown as DocRow).name ?? ""),
  );

  const addTerm = () => {
    const t = draftTerm.trim();
    if (!t || !draftLabel.trim() || !draftReason.trim()) {
      toast.error("Each entry needs the exact term, a label, and a reason.");
      return;
    }
    // Case-insensitive dedupe (mirrors the backend rule).
    if (terms.some((e) => e.term.toLowerCase() === t.toLowerCase())) {
      toast.error("That term is already listed (case-insensitive).");
      return;
    }
    setTerms([...terms, { term: t, label: draftLabel.trim(), reason: draftReason.trim() }]);
    setDraftTerm("");
    setDraftLabel("");
    setDraftReason("");
  };

  const run = async () => {
    if (!docId || terms.length === 0) return;
    setBusy(true);
    try {
      const res = (await produce({
        documentId: docId as Id<"matterDocuments">,
        entries: terms,
      })) as unknown as { status: string; reason?: string; detail?: string | null };
      if (res.status === "verified") {
        toast.success("Verified derivative produced — every term provably absent. Human review required before external use.");
      } else if (res.status === "failed") {
        toast.error("Run FAILED — residues remain. The derivative was NOT filed.");
      } else if (res.status === "refused") {
        toast.error(`Refused: ${res.reason ?? "unknown"}${res.detail ? ` — ${res.detail}` : ""}`);
      } else if (res.status === "unauthorized") {
        toast.error("You are not authorized to redact documents on this matter.");
      } else {
        toast.error(`Outcome: ${res.status}`);
      }
    } catch (e) {
      toast.error(errMessage(e, "The redaction run failed."));
    } finally {
      setBusy(false);
    }
  };

  const openDerivative = async (documentId: string) => {
    setUrlBusy(documentId);
    try {
      const url = (await convex.query(api.matters.getDocumentUrl, {
        documentId: documentId as Id<"matterDocuments">,
      })) as unknown as string | null;
      if (!url) {
        toast.error("No downloadable link for this derivative (permission or file state).");
        return;
      }
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error(errMessage(e, "Could not open the derivative."));
    } finally {
      setUrlBusy(null);
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Eraser className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Verified redaction</h3>
      </div>

      <S32Note>{REDACTION_COVERAGE_NOTE}</S32Note>

      <div className="space-y-3 rounded-md border border-border/70 p-3">
        <div>
          <Label className="text-xs">Source document (text files only)</Label>
          <Select value={docId} onValueChange={setDocId}>
            <SelectTrigger className="mt-1">
              <SelectValue
                placeholder={
                  candidates.length === 0
                    ? "No text-family documents on this matter"
                    : "Choose a .txt / .md / .csv / .json document"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((d) => {
                const row = d as unknown as DocRow;
                return (
                  <SelectItem key={row._id} value={row._id}>
                    {row.name}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {documents !== undefined && candidates.length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Only UTF-8 text-family files (.txt/.md/.markdown/.csv/.json) can be
              verifiably redacted here — boxed-over PDFs or images that leave
              text intact are structurally impossible to verify, so they are
              refused honestly rather than labelled verified.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Terms to remove (exact term · label · reason)</Label>
          {terms.length > 0 && (
            <ul className="space-y-1">
              {terms.map((t, i) => (
                <li
                  key={`${t.term}-${i}`}
                  className="flex items-center justify-between gap-2 rounded border border-border/60 px-2 py-1 text-xs"
                >
                  <span>
                    <span className="font-mono">{t.term}</span> — {t.label} ({t.reason})
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove term ${t.term}`}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setTerms(terms.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-40">
              <Input
                value={draftTerm}
                onChange={(e) => setDraftTerm(e.target.value)}
                placeholder="Exact term"
              />
            </div>
            <div className="w-40">
              <Input
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
                placeholder="Label (e.g. Aadhaar)"
              />
            </div>
            <div className="w-56">
              <Input
                value={draftReason}
                onChange={(e) => setDraftReason(e.target.value)}
                placeholder="Reason (mandatory, audited)"
              />
            </div>
            <Button size="sm" variant="outline" className="gap-1" onClick={addTerm}>
              <Plus className="size-3.5" /> Add
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            className="gap-1.5"
            disabled={busy || !docId || terms.length === 0}
            onClick={() => void run()}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Eraser className="size-4" />}
            Produce verified derivative
          </Button>
          {busy && (
            <p className="text-xs text-muted-foreground">
              Removing terms, re-scanning residues, filing the derivative…
            </p>
          )}
        </div>
      </div>

      {/* Run history — every attempt recorded, refusals verbatim */}
      {jobs === undefined ? (
        <S32Loading label="Loading run history…" />
      ) : (jobs as unknown as JobRow[]).length === 0 ? (
        <S32Empty>No redaction has been run on this matter yet.</S32Empty>
      ) : (
        <div className="space-y-2">
          {(jobs as unknown as JobRow[]).map((j) => (
            <div key={j._id} className="rounded-md border border-border/70 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    j.status === "verified"
                      ? "default"
                      : j.status === "failed"
                        ? "destructive"
                        : "secondary"
                  }
                  className="text-[10px]"
                >
                  {j.status}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {formatDateTimeIN(j.createdAt)}
                </span>
                {j.refusalReason && (
                  <span className="text-xs text-destructive">
                    refused: {j.refusalReason}
                    {j.refusalDetail ? ` — ${j.refusalDetail}` : ""}
                  </span>
                )}
              </div>
              {j.hits.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Hits: {j.hits.map((h) => `${h.term} ×${h.count}`).join(", ")}
                </p>
              )}
              {j.verification.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Residues on derivative:{" "}
                  {j.verification.map((v) => `${v.term} → ${v.residueCount}`).join(", ")}
                  {j.verification.every((v) => v.residueCount === 0)
                    ? " (all zero — verified)"
                    : " (NON-ZERO — derivative not filed)"}
                </p>
              )}
              {j.derivativeDocumentId && (
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={urlBusy === j.derivativeDocumentId}
                    onClick={() => void openDerivative(j.derivativeDocumentId!)}
                  >
                    {urlBusy === j.derivativeDocumentId ? (
                      <Loader2 className="mr-1 size-3 animate-spin" />
                    ) : null}
                    Open verified derivative
                  </Button>
                  {j.derivativeSha256 && (
                    <span className="text-xs text-muted-foreground">
                      sha256 {j.derivativeSha256.slice(0, 12)}… · {j.derivativeChars ?? "?"} chars
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
