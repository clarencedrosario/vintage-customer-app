import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { formatDateTimeIN } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  Bot,
  Check,
  FileSearch,
  FileText,
  Headset,
  Loader2,
  Mic,
  Scale,
  ScrollText,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// =====================================================================
// AI Studio (section 26) — the matter's AI workspace.
//
// Safety posture, visible in the UI:
//  - Sources are added deliberately (text layer via pdf.js, OCR via a
//    vision pass, or manual paste) and labeled Our Client / Opposing
//    Party / Court / Evidence. Selected documents go to the provider —
//    the notice under the launcher says so explicitly.
//  - Requests are saved jobs with visible status (pending/done/failed/
//    expired). No canned answers: failures are shown as failures.
//  - Every output is marked "Draft — Professional Review Required".
//  - Chronology suggestions arrive as unreviewed docket rows with
//    Confirm/Discard; evidence suggestions land only when the lawyer
//    applies them to a framed issue.
//  - Voice notes keep the recording + transcript; suggested tasks and
//    updates are shown in the result only until the lawyer acts.
// =====================================================================

const KIND_LABELS: Record<string, string> = {
  summary: "Document summary",
  xray: "Case X-Ray",
  chronology: "Chronology suggestions",
  issues: "Issues & missing information",
  hearing_prep: "Hearing preparation",
  draft: "Draft a document",
  client_comm: "Client communication draft",
  grounded_qa: "Ask the record",
  opposition: "Opposition analysis",
  evidence_map: "Evidence map suggestions",
  assertion_review: "Unsupported assertion review",
  voice_note: "Voice note (post-court)",
  ask_matter: "Ask My Matter",
  ask_document: "Ask This Document",
  smart_timeline: "Smart Timeline",
  compare: "Document comparison",
  morning_briefing: "Morning briefing",
  legal_research: "Legal research",
  email_summary: "Email summary",
  email_reply: "Email reply draft",
};

const NEEDS_SOURCES = new Set([
  "chronology",
  "evidence_map",
  "assertion_review",
  "opposition",
  "summary",
  "ask_document",
]);

/** Kinds that gather their own matter context server-side (no picking). */
const AUTO_CONTEXT_KINDS = new Set(["ask_matter", "smart_timeline", "morning_briefing", "legal_research"]);

type SourceRow = Doc<"aiSources">;

/** Extract per-page text from an ordinary PDF in the browser (pdf.js). */
async function extractPdfPages(file: File): Promise<{
  pages: Array<{ page: number; text: string }>;
  text: string;
}> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (
    await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
  ).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const pages: Array<{ page: number; text: string }> = [];
  for (let i = 1; i <= Math.min(pdf.numPages, 200); i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push({ page: i, text });
  }
  return { pages, text: pages.map((p) => p.text).join("\n") };
}

/** AI Studio tab body; mounted only with a real matterId. */
export function AiStudio({ matterId }: { matterId: Id<"matters"> }) {
  const sources = useQuery(api.ai.listSources, { matterId });
  const jobs = useQuery(api.ai.listJobs, { matterId, limit: 12 });
  const usage = useQuery(api.ai.usage);
  const runner = useQuery(api.ai.runnerStatus);
  const documents = useQuery(api.matters.listDocuments, { matterId });

  const addSourceFn = useMutation(api.ai.addSource);
  const removeSourceFn = useMutation(api.ai.removeSource);
  const prepareJobFn = useMutation(api.ai.prepareJob);
  const generateVoiceUploadUrlFn = useMutation(api.ai.generateVoiceUploadUrl);

  const [kind, setKind] = useState("summary");
  const [inputNote, setInputNote] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [launching, setLaunching] = useState(false);
  // Contextual Ask My Matter bar (this matter is already understood).
  const [askMatter, setAskMatter] = useState("");
  const [askBusy, setAskBusy] = useState(false);

  const [srcName, setSrcName] = useState("");
  const [srcRole, setSrcRole] = useState("our_client");
  const [srcBusy, setSrcBusy] = useState(false);
  const srcFileRef = useRef<HTMLInputElement>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState("");

  const [voiceBusy, setVoiceBusy] = useState(false);
  const voiceFileRef = useRef<HTMLInputElement>(null);

  const [openJob, setOpenJob] = useState<Id<"aiJobs"> | null>(null);

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setSrcBusy(true);
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
    } finally {
      setSrcBusy(false);
    }
  };

  const handleSourceFile = async (file: File) => {
    setSrcBusy(true);
    try {
      const name = srcName.trim() || file.name;
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        const { pages, text } = await extractPdfPages(file);
        await addSourceFn({
          matterId,
          name,
          role: srcRole as "our_client" | "opposing_party" | "court" | "evidence" | "other",
          text: text || "[No text layer found — scanned document]",
          extraction: text ? "text_layer" : "ocr",
          pageCount: pages.length,
          pages,
        });
      } else if (file.type.startsWith("text/") || /\.(txt|md)$/i.test(file.name)) {
        const text = await file.text();
        await addSourceFn({
          matterId,
          name,
          role: srcRole as "our_client" | "opposing_party" | "court" | "evidence" | "other",
          text,
          extraction: "text_layer",
        });
      } else {
        toast.error("Use a PDF or text file, or paste the text manually.");
        return;
      }
      toast.success("Source prepared and labeled.");
      setSrcName("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Extraction failed.");
    } finally {
      setSrcBusy(false);
      if (srcFileRef.current) srcFileRef.current.value = "";
    }
  };

  /** Voice note: recording is preserved in storage, transcription and
   *  suggestions run server-side; nothing consequential auto-saves. */
  const handleVoiceFile = async (file: File) => {
    setVoiceBusy(true);
    try {
      const uploadUrl = await generateVoiceUploadUrlFn({ matterId });
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "audio/webm" },
        body: file,
      });
      const { storageId } = (await res.json()) as { storageId: string };
      await prepareJobFn({
        matterId,
        kind: "voice_note",
        sourceIds: selected as Id<"aiSources">[],
        storageId: storageId as Id<"_storage">,
      });
      toast.success(
        "Voice note saved — the assistant will transcribe it and suggest follow-ups for your approval.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setVoiceBusy(false);
      if (voiceFileRef.current) voiceFileRef.current.value = "";
    }
  };

  const launch = async () => {
    setLaunching(true);
    try {
      const jobId = await prepareJobFn({
        matterId,
        kind,
        sourceIds: selected as Id<"aiSources">[],
        inputNote: inputNote || undefined,
      });
      setSelected([]);
      setInputNote("");
      setOpenJob(jobId);
      toast.success("Request saved and sent to the assistant.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
    } finally {
      setLaunching(false);
    }
  };

  if (sources === undefined || jobs === undefined) {
    return (
      <p className="py-8 text-center text-sm ink-faded">Opening the studio…</p>
    );
  }

  const overCap = usage ? usage.remaining <= 0 : false;

  return (
    <div className="space-y-6">
      {/* Notice before selected information goes to the provider */}
      <div className="rule-frame bg-card p-4">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-1 size-4 shrink-0 text-primary" />
          <div className="text-sm leading-relaxed">
            <p className="font-serif font-semibold">AI assistance — how it works here</p>
            <p className="mt-1 text-muted-foreground">
              Only documents you explicitly select are sent to the AI provider,
              server-side, with this firm's key — never your browser. Outputs are
              drafts anchored to the pages you supplied, marked{" "}
              <em>Draft — Professional Review Required</em>. Suggestions become
              matters of record only after a lawyer confirms them. The assistant
              cannot file, send or commit anything on its own.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              About your data: this application cannot verify whether the AI
              provider trains its models on submitted content — that is governed
              solely by the provider's own terms and configuration. Nothing here
              claims your matter documents are excluded from model training.
            </p>
          </div>
        </div>
      </div>

      {runner && !runner.configured && (
        <div className="rule-frame border-[#8a6a33] bg-card p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#8a6a33]" />
            <p className="text-sm">
              <span className="font-medium">Live AI is not yet configured.</span>{" "}
              <span className="text-muted-foreground">
                The request workflow below is fully functional — requests are
                saved and tracked — but the assistant's responses are blocked
                until the platform owner adds an OpenAI key. Nothing canned is
                shown in place of a real answer.
              </span>
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        {/* Left: sources */}
        <div className="space-y-4">
          <Card className="rule-frame bg-card">
            <CardContent className="space-y-4 pt-6">
              <h3 className="flex items-center gap-2 font-serif text-lg font-semibold">
                <FileSearch className="size-4" /> Sources for this matter
              </h3>
              <p className="text-xs text-muted-foreground">
                Extract text from ordinary PDFs (page numbers preserved) or
                paste it manually, then label each source.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ai-src-name">Label / name</Label>
                  <Input
                    id="ai-src-name"
                    value={srcName}
                    onChange={(e) => setSrcName(e.target.value)}
                    placeholder="e.g. Plaint (uncertified)"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ai-src-role">Role</Label>
                  <Select value={srcRole} onValueChange={setSrcRole}>
                    <SelectTrigger id="ai-src-role" className="mt-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="our_client">Our Client</SelectItem>
                      <SelectItem value="opposing_party">Opposing Party</SelectItem>
                      <SelectItem value="court">Court</SelectItem>
                      <SelectItem value="evidence">Evidence</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <input
                ref={srcFileRef}
                type="file"
                accept=".pdf,.txt,.md,text/plain"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleSourceFile(f);
                }}
              />
              <input
                ref={voiceFileRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleVoiceFile(f);
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={srcBusy}
                  onClick={() => srcFileRef.current?.click()}
                >
                  {srcBusy ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 size-4" />
                  )}
                  Extract from PDF / text
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={srcBusy}
                  onClick={() => setManualOpen((v) => !v)}
                >
                  <FileText className="mr-2 size-4" />
                  Paste manually
                </Button>
              </div>
              {manualOpen && (
                <div className="space-y-2">
                  <Textarea
                    rows={4}
                    value={manualText}
                    onChange={(e) => setManualText(e.target.value)}
                    placeholder="Paste the reviewed text here…"
                  />
                  <Button
                    size="sm"
                    disabled={srcBusy || manualText.trim().length < 20}
                    onClick={() =>
                      run(async () => {
                        await addSourceFn({
                          matterId,
                          name: srcName.trim() || "Manual extract",
                          role: srcRole as "our_client" | "opposing_party" | "court" | "evidence" | "other",
                          text: manualText,
                          extraction: "manual",
                        });
                        setManualText("");
                        setManualOpen(false);
                        setSrcName("");
                      }, "Manual source saved.")
                    }
                  >
                    Save source
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-2">
            {sources.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-6 text-center text-sm ink-faded">
                  No sources selected yet. Everything the assistant uses must be
                  added here first.
                </CardContent>
              </Card>
            ) : (
              sources.map((s) => (
                <div key={s._id} className="rule-frame bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{s.name}</p>
                      <p className="type-label mt-0.5 ink-faded">
                        {s.role === "our_client"
                          ? "Our Client"
                          : s.role === "opposing_party"
                            ? "Opposing Party"
                            : s.role === "court"
                              ? "Court"
                              : s.role === "evidence"
                                ? "Evidence"
                                : "Other"}{" "}
                        · {s.charCount.toLocaleString("en-IN")} chars
                        {s.pageCount ? ` · ${s.pageCount} pp` : ""} ·{" "}
                        {s.extraction === "ocr"
                          ? "OCR"
                          : s.extraction === "manual"
                            ? "manual"
                            : "text layer"}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {s.preview}…
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <Button
                        size="sm"
                        variant={selected.includes(s._id) ? "default" : "outline"}
                        onClick={() => toggle(s._id)}
                      >
                        {selected.includes(s._id) ? (
                          <>
                            <Check className="mr-1 size-3.5" /> Selected
                          </>
                        ) : (
                          "Select"
                        )}
                      </Button>
                      <button
                        className="text-xs text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          run(
                            () => removeSourceFn({ sourceId: s._id }),
                            "Source removed.",
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: launcher + jobs */}
        <div className="space-y-4">
          <Card className="rule-frame bg-card">
            <CardContent className="space-y-4 pt-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 font-serif text-lg font-semibold">
                  <Bot className="size-4" /> New request
                </h3>
                {usage && (
                  <Badge variant="outline" className="font-mono text-xs">
                    {usage.remaining.toLocaleString("en-IN")} /{" "}
                    {usage.limit.toLocaleString("en-IN")} tokens left this month
                  </Badge>
                )}
              </div>
              {/* Contextual quick-ask: the assistant already understands
                  which matter is open — no picker, no setup. */}
              <div className="flex flex-col gap-2 rounded-md border border-[#B68A45]/40 bg-[#B68A45]/[0.04] p-3 sm:flex-row">
                <Input
                  aria-label="Ask My Matter"
                  value={askMatter}
                  onChange={(e) => setAskMatter(e.target.value)}
                  placeholder="Ask My Matter — e.g. what deadlines does the record create this month?"
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && askMatter.trim() && !askBusy && !overCap) {
                      setAskBusy(true);
                      try {
                        const jobId = await prepareJobFn({
                          matterId,
                          kind: "ask_matter",
                          inputNote: askMatter,
                        });
                        setAskMatter("");
                        setOpenJob(jobId);
                        toast.success("Question saved — grounded in this matter's sources.");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Failed.");
                      } finally {
                        setAskBusy(false);
                      }
                    }
                  }}
                />
                <Button
                  variant="outline"
                  disabled={askBusy || !askMatter.trim() || overCap}
                  onClick={async () => {
                    setAskBusy(true);
                    try {
                      const jobId = await prepareJobFn({
                        matterId,
                        kind: "ask_matter",
                        inputNote: askMatter,
                      });
                      setAskMatter("");
                      setOpenJob(jobId);
                      toast.success("Question saved — grounded in this matter's sources.");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Failed.");
                    } finally {
                      setAskBusy(false);
                    }
                  }}
                >
                  {askBusy ? (
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1.5 size-4" />
                  )}
                  Ask
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ai-kind">What should the assistant do?</Label>
                  <Select value={kind} onValueChange={setKind}>
                    <SelectTrigger id="ai-kind">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(KIND_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ai-note">
                    Your instruction (optional)
                  </Label>
                  <Input
                    id="ai-note"
                    value={inputNote}
                    onChange={(e) => setInputNote(e.target.value)}
                    placeholder="e.g. focus on the limitation question"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {selected.length} source{selected.length === 1 ? "" : "s"} will
                be sent.{" "}
                {NEEDS_SOURCES.has(kind) && selected.length === 0
                  ? kind === "ask_document"
                    ? "Select exactly the one document you are viewing (add it under Sources first if missing)."
                    : "This request requires at least one selected source."
                  : AUTO_CONTEXT_KINDS.has(kind)
                    ? "The assistant gathers this matter's extracted sources itself — you see only what your access already allows."
                    : "Select sources on the left to ground the answer."}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={
                    launching ||
                    overCap ||
                    (NEEDS_SOURCES.has(kind) && selected.length === 0)
                  }
                  onClick={launch}
                >
                  {launching ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 size-4" />
                  )}
                  Save request & run
                </Button>
                <Button
                  variant="outline"
                  disabled={voiceBusy || overCap}
                  onClick={() => voiceFileRef.current?.click()}
                >
                  {voiceBusy ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Mic className="mr-2 size-4" />
                  )}
                  Voice note after court
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Voice notes: the recording is preserved, transcribed
                server-side, and the suggested outcome, tasks and client
                update appear in the result — you approve each before
                anything is saved or sent.
              </p>
            </CardContent>
          </Card>

          {/* Saved requests / results */}
          <div className="space-y-3">
            <h3 className="font-serif text-lg font-semibold">Saved requests</h3>
            {jobs.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-6 text-center text-sm ink-faded">
                  No AI requests on this matter yet.
                </CardContent>
              </Card>
            ) : (
              jobs.map((j) => (
                <div key={j._id} className="rule-frame bg-card p-4">
                  <button
                    className="flex w-full items-start justify-between gap-3 text-left"
                    onClick={() => setOpenJob(openJob === j._id ? null : j._id)}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {KIND_LABELS[j.kind] ?? j.kind}
                      </p>
                      <p className="type-label mt-0.5 ink-faded">
                        {formatDateTimeIN(j.createdAt)}
                        {j.model ? ` · ${j.model}` : ""}
                        {j.costMinor ? ` · ${(j.costMinor / 100).toFixed(2)}¢` : ""}
                      </p>
                    </div>
                    <JobStatusBadge status={j.status} />
                  </button>
                  {openJob === j._id && <JobResult jobId={j._id} matterId={matterId} />}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function JobStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "Running", cls: "bg-[#8a6a33]/10 text-[#8a6a33]" },
    done: { label: "Done", cls: "bg-primary/10 text-primary" },
    failed: { label: "Failed", cls: "bg-destructive/10 text-destructive" },
    expired: { label: "Expired", cls: "bg-destructive/10 text-destructive" },
  };
  const s = map[status] ?? { label: status, cls: "" };
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

/** One job's result, with confirm/discard controls for suggestions. */
function JobResult({
  jobId,
  matterId,
}: {
  jobId: Id<"aiJobs">;
  matterId: Id<"matters">;
}) {
  return (
    <JobResultInner jobId={jobId} matterId={matterId} />
  );
}

/** Job result with the CJ GLOBAL human-handoff affordance. */
function JobResultInner({
  jobId,
  matterId,
}: {
  jobId: Id<"aiJobs">;
  matterId: Id<"matters">;
}) {
  const job = useQuery(api.ai.getJob, { jobId });
  const confirmFn = useMutation(api.ai.confirmEvents);
  const rejectFn = useMutation(api.ai.rejectEvent);
  const applyFn = useMutation(api.ai.applyToIssue);
  const removeRowFn = useMutation(api.ai.removeEvidenceRow);
  const issues = useQuery(api.matters.listIssues, { matterId });
  const docket = useQuery(api.matters.listEvents, { matterId });
  const escalate = useMutation(api.platformOps.escalateFromAiJob);
  // Chamber's open AI-handoff counters from the write-maintained mat view.
  const handoffStats = useQuery(api.platformOps.myChamberHandoffStats);

  const [issueId, setIssueId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [escOpen, setEscOpen] = useState(false);
  const [escSubject, setEscSubject] = useState("");
  const [escDesc, setEscDesc] = useState("");

  useEffect(() => {
    if (!issueId && issues && issues.length > 0) setIssueId(issues[0]._id);
  }, [issues, issueId]);

  if (job === undefined) {
    return <Loader2 className="mt-3 size-4 animate-spin text-muted-foreground" />;
  }
  if (job === null) return null;

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  const aiEvents = (docket ?? []).filter(
    (e) => e.aiSuggested && !e.reviewed,
  );
  const evidenceItems =
    job.structured && typeof job.structured === "object" && "items" in job.structured
      ? ((job.structured as { items?: Array<{ label: string; supports: boolean }> })
          .items ?? [])
      : [];

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      {/* §32 Phase 8 — instruction-defence notice. Signals were detected in
          this job's UNTRUSTED sources (documents/emails can originate from
          opposing parties). Always shown when present, whatever the outcome. */}
      {job.instructionDefence && job.instructionDefence.length > 0 && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3">
          <p className="flex items-start gap-2 text-sm font-medium">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
            Instruction-defence review ({job.instructionDefence.length} signal{job.instructionDefence.length === 1 ? "" : "s"})
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Patterns were detected in this request's untrusted sources that
            could try to steer the assistant. The lawyer reviewing this output
            should confirm the result against the underlying sources — the
            signals below are excerpts, not conclusions.
          </p>
          <ul className="mt-2 space-y-1">
            {job.instructionDefence.map(
              (s: { kind: string; excerpt: string; sourceName: string }, i: number) => (
                <li key={i} className="rounded border border-border/60 bg-background/60 p-1.5 text-xs">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400">
                    {s.kind.replace(/_/g, " ")}
                  </span>
                  <span className="ml-2 text-muted-foreground">in {s.sourceName}:</span>
                  <span className="ml-1 italic">“{s.excerpt}”</span>
                </li>
              ),
            )}
          </ul>
        </div>
      )}
      {job.status === "pending" && (
        <p className="flex items-center gap-2 text-sm ink-faded">
          <Loader2 className="size-4 animate-spin" /> Working on the record…
        </p>
      )}
      {job.status === "failed" && (
        <div className="flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p>The assistant could not complete this request:</p>
            <p className="mt-1 text-muted-foreground">{job.error}</p>
          </div>
        </div>
      )}
      {/* CJ GLOBAL — AI-to-human escalation: hand this AI conversation to a
          platform operator as a high-priority support ticket. */}
      {(job.status === "done" || job.status === "failed" || job.status === "expired") && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => {
              setEscSubject(
                job.status === "done"
                  ? "Review this AI answer"
                  : "AI request failed",
              );
              setEscDesc("");
              setEscOpen(true);
            }}
          >
            <Headset className="mr-1.5 size-3.5" aria-hidden="true" />
            Escalate to human support
          </Button>
        </div>
      )}
      {job.status === "expired" && (
        <div className="flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p>This request expired before it could run.</p>
            <p className="mt-1 text-muted-foreground">{job.error}</p>
          </div>
        </div>
      )}
      {job.status === "done" && (
        <>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-3 font-serif text-sm leading-relaxed">
            {job.result}
          </pre>
          <p className="type-label ink-faded">
            {job.promptTokens.toLocaleString("en-IN")} +{" "}
            {job.completionTokens.toLocaleString("en-IN")} tokens ·{" "}
            {(job.durationMs / 1000).toFixed(1)}s
            {job.sources.length > 0 &&
              ` · grounded in ${job.sources.map((s) => s.name).join(", ")}`}
          </p>
          {job.transcript && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                Voice recording transcript (preserved)
              </summary>
              <p className="mt-2 whitespace-pre-wrap rounded border border-border bg-background p-3 text-xs">
                {job.transcript}
              </p>
            </details>
          )}
          {job.kind === "chronology" && aiEvents.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                Unconfirmed suggestions on the docket — review each:
              </p>
              {aiEvents.map((ev) => (
                <div
                  key={ev._id}
                  className="flex items-start justify-between gap-2 rounded border border-dashed border-[#8a6a33] p-2.5"
                >
                  <div className="min-w-0 text-sm">
                    {ev.detail}
                    <span className="type-label ml-2 ink-faded">
                      suggested
                    </span>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        act(
                          () => confirmFn({ matterId, eventIds: [ev._id] }),
                          "Suggestion confirmed into the chronology.",
                        )
                      }
                    >
                      <Check className="size-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        act(
                          () => rejectFn({ eventId: ev._id }),
                          "Suggestion discarded.",
                        )
                      }
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {job.kind === "evidence_map" && evidenceItems.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                Apply suggestions to a framed issue (they arrive flagged [AI]
                and stay removable):
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-64">
                  <Label htmlFor="ai-issue-pick">Issue</Label>
                  <Select value={issueId} onValueChange={setIssueId}>
                    <SelectTrigger id="ai-issue-pick">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(issues ?? []).map((i) => (
                        <SelectItem key={i._id} value={i._id}>
                          {i.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="sm"
                  disabled={busy || !issueId}
                  onClick={() =>
                    act(async () => {
                      await applyFn({
                        issueId: issueId as Id<"matterIssues">,
                        items: evidenceItems.map((i) => ({
                          label: i.label,
                          supports: !!i.supports,
                        })),
                      });
                    }, "Suggestions added to the evidence map for review.")
                  }
                >
                  <Scale className="mr-2 size-4" /> Apply
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* CJ GLOBAL — human-handoff dialog, with the chamber's live
          handoff counters from the write-maintained mat view. */}
      <Dialog open={escOpen} onOpenChange={setEscOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif">Escalate to human support</DialogTitle>
            <DialogDescription>
              A platform operator picks this up as a high-priority ticket. Your
              message matters — describe what the AI missed or got wrong. The
              matter's contents stay confidential; only your description and
              the request reference reach support.
            </DialogDescription>
          </DialogHeader>
          {handoffStats && (handoffStats.openCount > 0 || handoffStats.unclaimedCount > 0) && (
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Your chamber currently has {handoffStats.openCount} open AI
              handoff{handoffStats.openCount === 1 ? "" : "s"}
              {handoffStats.unclaimedCount > 0
                ? `, ${handoffStats.unclaimedCount} not yet claimed by an operator`
                : ""}
              {handoffStats.lastResolvedAt
                ? ` — the last one was resolved ${formatDateTimeIN(handoffStats.lastResolvedAt)}`
                : ""}
              . Your escalation joins that queue.
            </p>
          )}
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="esc-subject" className="text-xs">Subject</Label>
              <Input
                id="esc-subject"
                value={escSubject}
                onChange={(e) => setEscSubject(e.target.value)}
                className="h-8 text-sm"
                maxLength={200}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="esc-desc" className="text-xs">
                What went wrong or needs human review?
              </Label>
              <Textarea
                id="esc-desc"
                value={escDesc}
                onChange={(e) => setEscDesc(e.target.value)}
                rows={4}
                maxLength={8000}
                className="text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setEscOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={escSubject.trim().length < 4 || escDesc.trim().length < 10}
              onClick={async () => {
                try {
                  await escalate({
                    jobId,
                    subject: escSubject.trim(),
                    description: escDesc.trim(),
                  });
                  toast.success(
                    "Handed off to human support — track it under Platform support.",
                  );
                  setEscOpen(false);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not escalate.");
                }
              }}
            >
              Hand off to a human
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
