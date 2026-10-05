// =====================================================================
// §32 Phase 9 — Multilingual evidence review (matter file →
// Translations tab). Real backend: multilingual.setHandlingPolicy /
// getHandlingPolicy / recordTranslation / sideBySide / listForMatter /
// verifyTranslation. The machine-translation disclosure and the honest
// unset-policy refusal travel from the backend verbatim.
// =====================================================================
import { useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Languages, Loader2, ShieldCheck } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { S32Empty, S32Loading, S32Note, errMessage } from "@/components/s32/shared";
import { formatDateTimeIN } from "@/lib/format";

type RecordRow = {
  recordId: string;
  targetType: string;
  targetId: string;
  languagePair: string;
  machineTranslated: boolean;
  providerKind: string;
  providerName: string | null;
  providerVersion: string | null;
  targetLanguage: string;
  recordedByName: string;
  createdAt: number;
  verifiedAt?: number | null;
  verifiedByName?: string | null;
};

type ListResult = { matterRef: string; records: RecordRow[] };

type PolicyResult = {
  status: string;
  authorityNote: string | null;
  setByName: string | null;
  setAt: number | null;
  disclosure: string | null;
} | null;

type SideBySide = {
  targetName: string | null;
  sourceLanguage: string | null;
  translation: {
    recordId: string;
    targetLanguage: string;
    originalText: string;
    translatedText: string;
    providerKind: string;
    recordedByName: string;
    recordedAt: number;
  } | null;
  disclosure: string | null;
  verifiedDisclosure: string | null;
  staleOriginal: boolean;
  staleDisclosure: string | null;
  pairs: { original: string; translated: string }[] | null;
  activeLanguages: string[];
};

type SideMeta = { targetType: string; targetId: string; targetLanguage: string | null };

export function TranslationsPanel({
  matterId,
  canEdit,
}: {
  matterId: Id<"matters">;
  canEdit: boolean;
}) {
  const list = useQuery(api.multilingual.listForMatter, { matterId });
  const policy = useQuery(api.multilingual.getHandlingPolicy, { matterId });

  const setPolicyFn = useMutation(api.multilingual.setHandlingPolicy);
  const recordFn = useMutation(api.multilingual.recordTranslation);
  const verifyFn = useMutation(api.multilingual.verifyTranslation);
  const convex = useConvex();

  // Policy form
  const [policyBusy, setPolicyBusy] = useState(false);
  const [authorityNote, setAuthorityNote] = useState("");

  // Record form
  const [recOpen, setRecOpen] = useState(false);
  const [recBusy, setRecBusy] = useState(false);
  const [targetType, setTargetType] = useState<"ai_source" | "matter_fact">("ai_source");
  const [targetId, setTargetId] = useState("");
  const [originalText, setOriginalText] = useState("");
  const [sourceLanguage, setSourceLanguage] = useState("");
  const [targetLanguage, setTargetLanguage] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [providerKind, setProviderKind] = useState("manual");
  const [providerName, setProviderName] = useState("");
  const [providerVersion, setProviderVersion] = useState("");

  // Side-by-side viewer
  const [sideMeta, setSideMeta] = useState<SideMeta | null>(null);
  const [sideBusy, setSideBusy] = useState(false);
  const [side, setSide] = useState<SideBySide | null>(null);
  const [verifyNote, setVerifyNote] = useState("");
  const [verifyBusy, setVerifyBusy] = useState(false);

  const savePolicy = async (externalProcessors: "unset" | "allowed" | "restricted") => {
    if (authorityNote.trim().length < 10) {
      toast.error("Record the authority for this decision (at least 10 characters).");
      return;
    }
    setPolicyBusy(true);
    try {
      await setPolicyFn({
        matterId,
        externalProcessors,
        authorityNote,
      });
      toast.success("Data-handling policy recorded.");
      setAuthorityNote("");
    } catch (e) {
      toast.error(errMessage(e, "Could not record the policy."));
    } finally {
      setPolicyBusy(false);
    }
  };

  const saveRecord = async () => {
    if (!targetId.trim() || !originalText.trim() || !sourceLanguage.trim() || !targetLanguage.trim() || !translatedText.trim()) {
      toast.error("Fill the target, both texts and both language codes.");
      return;
    }
    if (providerKind !== "manual" && !providerName.trim()) {
      toast.error("Machine renderings must name their provider (honest labelling).");
      return;
    }
    setRecBusy(true);
    try {
      await recordFn({
        matterId,
        targetType,
        targetId: targetId as Id<"aiSources">,
        originalText,
        sourceLanguage: sourceLanguage.trim(),
        targetLanguage: targetLanguage.trim(),
        translatedText,
        providerKind: providerKind as "manual" | "machine_external" | "machine_self_hosted",
        providerName: providerName.trim() || undefined,
        providerVersion: providerVersion.trim() || undefined,
      });
      toast.success("Translation recorded beside the evidence — the original is preserved.");
      setRecOpen(false);
      setTargetId("");
      setOriginalText("");
      setTranslatedText("");
    } catch (e) {
      toast.error(errMessage(e, "Could not record the translation."));
    } finally {
      setRecBusy(false);
    }
  };

  const openSide = async (row: RecordRow) => {
    setSideMeta({ targetType: row.targetType, targetId: row.targetId, targetLanguage: row.targetLanguage });
    setSideBusy(true);
    setVerifyNote("");
    try {
      const res = (await convex.query(api.multilingual.sideBySide, {
        matterId,
        targetType: row.targetType as "ai_source" | "matter_fact",
        targetId: row.targetId as Id<"aiSources">,
        targetLanguage: row.targetLanguage,
      })) as unknown as SideBySide;
      setSide(res);
    } catch (e) {
      toast.error(errMessage(e, "Could not load the side-by-side view."));
      setSide(null);
    } finally {
      setSideBusy(false);
    }
  };

  const verify = async () => {
    if (!side?.translation) return;
    if (verifyNote.trim().length < 10) {
      toast.error("The attestation needs a note of at least 10 characters (what the comparison covered).");
      return;
    }
    setVerifyBusy(true);
    try {
      await verifyFn({ recordId: side.translation.recordId as Id<"translationRecords">, note: verifyNote });
      toast.success("Human verification attested — text unchanged, machine label stays.");
      setVerifyNote("");
      await openSide({
        targetType: sideMeta!.targetType,
        targetId: sideMeta!.targetId,
        targetLanguage: side.translation.targetLanguage,
        languagePair: "",
        machineTranslated: false,
        providerKind: "",
        providerName: null,
        providerVersion: null,
        recordId: "",
        createdAt: 0,
        recordedByName: "",
      } as RecordRow);
    } catch (e) {
      toast.error(errMessage(e, "Could not record the attestation."));
    } finally {
      setVerifyBusy(false);
    }
  };

  const p = policy as PolicyResult;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Languages className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Multilingual evidence review</h3>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-7 text-xs"
          onClick={() => setRecOpen((s) => !s)}
        >
          {recOpen ? "Close form" : "Record a translation"}
        </Button>
      </div>

      <S32Note>
        Translations are review aids, NEVER the evidence. Renderings are recorded
        beside the original — which is preserved and never re-pointed — and
        machine renderings carry a mandatory disclosure on every read.
      </S32Note>

      {/* Data-handling policy — honest default refusal for external processors */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">External-processing policy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {p === undefined ? (
            <S32Loading />
          ) : p === null ? (
            <p className="text-sm text-muted-foreground">
              No decision recorded. The DEFAULT is restrictive: machine_external
              recordings are refused until an authority is recorded — no silent
              external disclosure.
            </p>
          ) : (
            <div className="space-y-1">
              <p className="text-sm">
                Status: <Badge variant={p.status === "allowed" ? "default" : p.status === "restricted" ? "destructive" : "secondary"}>{p.status}</Badge>
              </p>
              {p.authorityNote && (
                <p className="text-xs italic text-muted-foreground">“{p.authorityNote}”</p>
              )}
              {p.disclosure && <S32Note>{p.disclosure}</S32Note>}
            </div>
          )}
          {canEdit && (
            <div className="space-y-2">
              <Textarea
                className="min-h-[52px]"
                value={authorityNote}
                onChange={(e) => setAuthorityNote(e.target.value)}
                placeholder="Authority for the decision (≥10 chars): engagement-letter clause, client instruction, firm policy…"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={policyBusy}
                  onClick={() => void savePolicy("allowed")}
                >
                  Allow external processors
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={policyBusy}
                  onClick={() => void savePolicy("restricted")}
                >
                  Restrict to self-hosted / manual
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Record form */}
      {recOpen && (
        <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <Label className="text-xs">Target type</Label>
              <Select value={targetType} onValueChange={(v) => setTargetType(v as "ai_source" | "matter_fact")}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ai_source">Extracted source (aiSources)</SelectItem>
                  <SelectItem value="matter_fact">Matter fact</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Target record id</Label>
              <Input className="mt-1" value={targetId} onChange={(e) => setTargetId(e.target.value)} placeholder="Id of the source/fact" />
            </div>
            <div>
              <Label className="text-xs">Source language</Label>
              <Input className="mt-1" value={sourceLanguage} onChange={(e) => setSourceLanguage(e.target.value)} placeholder="e.g. hi" />
            </div>
            <div>
              <Label className="text-xs">Target language</Label>
              <Input className="mt-1" value={targetLanguage} onChange={(e) => setTargetLanguage(e.target.value)} placeholder="e.g. en" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Original text (frozen copy — must match the record)</Label>
            <Textarea className="mt-1 min-h-[56px]" value={originalText} onChange={(e) => setOriginalText(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Translated text</Label>
            <Textarea className="mt-1 min-h-[72px]" value={translatedText} onChange={(e) => setTranslatedText(e.target.value)} />
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            <div>
              <Label className="text-xs">Provider kind</Label>
              <Select value={providerKind} onValueChange={setProviderKind}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual (named translator)</SelectItem>
                  <SelectItem value="machine_external">Machine — external</SelectItem>
                  <SelectItem value="machine_self_hosted">Machine — self-hosted</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Provider name {providerKind !== "manual" && "(required)"}</Label>
              <Input className="mt-1" value={providerName} onChange={(e) => setProviderName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Provider version</Label>
              <Input className="mt-1" value={providerVersion} onChange={(e) => setProviderVersion(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button size="sm" disabled={recBusy} onClick={() => void saveRecord()} className="gap-1.5">
              {recBusy && <Loader2 className="size-4 animate-spin" />}
              Save translation
            </Button>
          </div>
        </div>
      )}

      {/* Records list */}
      {list === undefined ? (
        <S32Loading label="Loading translation records…" />
      ) : (list as unknown as ListResult).records.length === 0 ? (
        <S32Empty>
          No translation records on this matter. Record a rendering of an
          extracted source or matter fact to build the side-by-side review.
        </S32Empty>
      ) : (
        <div className="space-y-2">
          {(list as unknown as ListResult).records.map((r) => (
            <div key={r.recordId} className="flex flex-wrap items-center gap-2 rounded-md border border-border/70 p-3">
              <Badge variant={r.machineTranslated ? "destructive" : "outline"} className="text-[10px]">
                {r.machineTranslated ? "MACHINE" : "MANUAL"}
              </Badge>
              <Badge variant="outline" className="text-[10px]">{r.languagePair}</Badge>
              <span className="text-sm">{r.targetType === "ai_source" ? "Extracted source" : "Matter fact"}</span>
              {r.providerName && (
                <span className="text-xs text-muted-foreground">
                  {r.providerName}{r.providerVersion ? ` ${r.providerVersion}` : ""}
                </span>
              )}
              {r.verifiedAt && (
                <Badge variant="default" className="text-[10px]">human-verified</Badge>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {r.recordedByName} · {formatDateTimeIN(r.createdAt)}
              </span>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void openSide(r)}>
                Side-by-side
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Side-by-side viewer */}
      <Dialog
        open={sideMeta !== null}
        onOpenChange={(o) => !o && setSideMeta(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base">
              {side?.targetName ?? "Translation"}
              {side?.sourceLanguage && side?.translation
                ? ` · ${side.sourceLanguage} → ${side.translation.targetLanguage}`
                : ""}
            </DialogTitle>
            <DialogDescription>
              Original preserved on the record; the translation is a review aid,
              never the evidence.
            </DialogDescription>
          </DialogHeader>
          {sideBusy ? (
            <S32Loading label="Building the side-by-side view…" />
          ) : side === null ? (
            <p className="text-sm text-muted-foreground">Not available.</p>
          ) : (
            <div className="space-y-3">
              {side.staleOriginal && side.staleDisclosure && (
                <S32Note tone="red">{side.staleDisclosure}</S32Note>
              )}
              {side.disclosure && <S32Note>{side.disclosure}</S32Note>}
              {side.verifiedDisclosure && <S32Note tone="blue">{side.verifiedDisclosure}</S32Note>}
              {side.pairs === null ? (
                <S32Note tone="red">
                  Paragraph pairing failed — segment counts differ. The
                  remainders are shown unpaired, never hidden.
                </S32Note>
              ) : (
                <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                  {side.pairs.map((pair, i) => (
                    <div key={i} className="grid gap-2 md:grid-cols-2">
                      <div className="rounded-md border border-border/70 p-2 text-sm">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Original · ¶{i + 1}
                        </p>
                        <p className="mt-1">{pair.original}</p>
                      </div>
                      <div className="rounded-md border border-border/70 p-2 text-sm">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Translation · ¶{i + 1}
                        </p>
                        <p className="mt-1">{pair.translated}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Label className="text-xs">Human-verification attestation (≥10 chars)</Label>
                  <Input
                    className="mt-1"
                    value={verifyNote}
                    onChange={(e) => setVerifyNote(e.target.value)}
                    placeholder="What the comparison covered (paragraph-by-paragraph against the source…)"
                  />
                </div>
                <Button size="sm" className="gap-1.5" disabled={verifyBusy} onClick={() => void verify()}>
                  {verifyBusy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                  Attest
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
