import { ChamberShell } from "@/components/ChamberShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import { CommandCentre } from "@/components/CommandCentre";
import { HearingPackDialog } from "@/components/HearingPackDialog";
import { HearingOutcomeDialog } from "@/components/HearingOutcomeDialog";
import { HearingRescheduleDialog } from "@/components/HearingRescheduleDialog";
import { ProposalReviewPanel } from "@/components/ProposalReviewPanel";
import { AiStudio } from "@/components/AiStudio";
import { ConflictReviewPanel } from "@/components/s32/ConflictReviewPanel";
import { AdverseAuthorityPanel } from "@/components/s32/AdverseAuthorityPanel";
import { MatterImpactPanel } from "@/components/s32/MatterImpactPanel";
import { EvidenceBundlesPanel } from "@/components/s32/EvidenceBundlesPanel";
import { MatterHoldCard } from "@/components/s32/MatterHoldCard";
import { FilingReadinessPanel } from "@/components/s32/FilingReadinessPanel";
import { RedactionPanel } from "@/components/s32/RedactionPanel";
import { TranslationsPanel } from "@/components/s32/TranslationsPanel";
import { ClientUpdatesPanel } from "@/components/s32/ClientUpdatesPanel";
import { Badge } from "@/components/ui/badge";
import type { Id } from "@/convex/_generated/dataModel";
import type { MatterStatus } from "@/convex/schema";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  formatDateIN,
  formatDateTimeIN,
  formatINR,
  todayIN,
} from "@/lib/format";
import { useMutation, useQuery } from "convex/react";import {
  ArrowLeft,
  BellRing,
  Bot,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  FileText,
  Inbox,
  Gavel,
  History,
  Landmark,
  ListChecks,
  Loader2,
  MessageSquare,
  Paperclip,
  Scale,
  Trash2,
  Users,
  Plus,
  Receipt,
  Reply,
  Eraser,
  Languages,
  ScrollText,
  ShieldCheck,
  StickyNote,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { sha256Hex } from "@/lib/evidenceIntegrity";
import { DocumentIntegrityChip } from "@/components/DocumentIntegrity";
import { Link, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";


const STATUS_LABELS: Record<MatterStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  on_hold: "On Hold",
  closed: "Closed",
};

/** One document row; resolves a read URL via its own subscription. */
function DocumentLink({ documentId }: { documentId: Id<"matterDocuments"> }) {
  const url = useQuery(api.matters.getDocumentUrl, { documentId });
  if (!url) {
    return (
      <span className="type-label ink-faded">
        {url === null ? "Unavailable" : "…"}
      </span>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="type-label text-primary hover:underline"
    >
      Open
    </a>
  );
}

/**
 * Matter alerts: overdue / due-soon deadlines on this matter, the next
 * hearing, and unreviewed AI suggestions on the timeline. Pure derived
 * view — every item links to where the lawyer acts on it.
 */
function MatterAlerts({
  matterId,
  nextHearingAt,
  eventCount,
}: {
  matterId: Id<"matters">;
  nextHearingAt?: number;
  eventCount: number;
}) {
  const deadlines = useQuery(api.tasks.deadlineList, { status: "open" as const });
  const now = Date.now();
  const weekAhead = now + 7 * 24 * 60 * 60 * 1000;
  const items: { key: string; tone: string; text: string; to: string }[] = [];
  for (const d of deadlines ?? []) {
    if (d.matterId !== matterId) continue;
    const overdue = d.dueAt < now;
    const soon = !overdue && d.dueAt <= weekAhead;
    if (!overdue && !soon) continue;
    items.push({
      key: d._id,
      tone: overdue ? "text-red-700" : "text-[#8a6a33]",
      text: `${overdue ? "Overdue deadline" : "Deadline this week"} — ${d.title}`,
      to: `/matters/${matterId}?tab=docket`,
    });
  }
  if (nextHearingAt && nextHearingAt > now && nextHearingAt < weekAhead) {
    items.unshift({
      key: "hearing",
      tone: "text-[#8a6a33]",
      text: `Next hearing ${formatDateTimeIN(nextHearingAt)}`,
      to: `/matters/${matterId}?tab=hearings`,
    });
  }
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5 rounded-md border border-[#B68A45]/30 bg-[#F7F5EF]/60 p-3">
      {items.slice(0, 6).map((a) => (
        <Link
          key={a.key}
          to={a.to}
          className={`block text-sm font-medium hover:underline ${a.tone}`}
        >
          • {a.text}
        </Link>
      ))}
      {eventCount === 0 && null}
    </div>
  );
}

/**
 * "Ask AI About This Matter" panel: launches an ask_matter job over the
 * matter's extracted sources and lists recent grounded answers. Honest
 * framing — answers are grounded only in what the chamber extracted.
 */
function MatterAskAI({ matterId }: { matterId: Id<"matters"> }) {
  const prepare = useMutation(api.ai.prepareJob);
  const jobs = useQuery(api.ai.listJobs, { matterId, limit: 10 });
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const askJobs = (jobs ?? []).filter((j) => j.kind === "ask_matter");

  const ask = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      await prepare({ matterId, kind: "ask_matter", inputNote: q.trim() });
      setQ("");
      toast.success("Question saved — the answer appears below when ready.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not run the question.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void ask();
            }}
            placeholder="Ask about this matter — e.g. what did the court direct on the last date?"
            aria-label="Ask AI about this matter"
          />
        </div>
        <Button size="sm" disabled={busy || !q.trim()} onClick={() => void ask()}>
          {busy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Bot className="mr-1.5 size-3.5" />}
          Ask
        </Button>
      </div>
      {askJobs.length > 0 && (
        <div className="space-y-2">
          {askJobs.slice(0, 3).map((j) => (
            <details key={j._id} className="rounded-md border border-border p-3">
              <summary className="cursor-pointer text-sm">
                {j.inputNote || "Question"}
                <span className="type-label ml-2 ink-faded">
                  {j.status === "done"
                    ? "answered"
                    : j.status === "pending"
                      ? "working…"
                      : j.status}
                </span>
              </summary>
              {j.result && (
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-background p-2 font-serif text-xs leading-relaxed">
                  {j.result}
                </pre>
              )}
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Communications tab: the matter's threads, listed inside the file with
 * an inline composer. Reuses the same conversations backend as the Comms
 * centre; clients see only what their access already allows.
 */
function MatterThreads({
  matterId,
  canNoteWrite,
}: {
  matterId: Id<"matters">;
  canNoteWrite: boolean;
}) {
  const threads = useQuery(api.conversations.listForMatter, { matterId });
  const create = useMutation(api.conversations.createConversation);
  const [subject, setSubject] = useState("");
  const [scope, setScope] = useState<"matter" | "internal">("matter");
  const [busy, setBusy] = useState(false);

  if (threads === undefined) {
    return <p className="text-sm text-muted-foreground">Loading threads...</p>;
  }

  const startThread = async () => {
    if (!subject.trim()) {
      toast.error("Give the thread a subject.");
      return;
    }
    setBusy(true);
    try {
      await create({ matterId, subject: subject.trim(), scope });
      setSubject("");
      toast.success("Thread started.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the thread.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <p className="font-serif text-sm font-semibold">Start a thread on this matter</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px] flex-1">
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject, e.g. caveat filing status"
                aria-label="New thread subject"
              />
            </div>
            <Select value={scope} onValueChange={(v) => setScope(v as "matter" | "internal")}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="matter">Matter thread (with client)</SelectItem>
                <SelectItem value="internal">Internal thread</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" disabled={busy || !canNoteWrite} onClick={() => void startThread()}>
              <MessageSquare className="mr-1.5 size-3.5" /> Start thread
            </Button>
          </div>
          {!canNoteWrite && (
            <p className="type-label ink-faded">
              You can read the threads below but not start new ones.
            </p>
          )}
        </CardContent>
      </Card>

      {threads.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-sm ink-faded">
            No conversations on this matter yet. Threads started here also
            appear in the Communications centre.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {threads.map((t) => (
            <Link
              key={t._id}
              to={`/comms?thread=${t._id}`}
              className="rule-frame block rounded-lg bg-card p-4 transition-colors hover:bg-accent/40"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-serif text-sm font-semibold">{t.subject}</p>
                  <p className="type-label mt-0.5 ink-faded">
                    {t.scope === "matter" ? "Matter thread" : "Internal thread"} ·{" "}
                    {t.participants.map((p: { name: string }) => p.name).join(", ")}
                  </p>
                </div>
                <Reply className="size-4 shrink-0 text-muted-foreground" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MatterDetail() {
  const [packOpen, setPackOpen] = useState(false);
  // Hearing the pack dialog should preselect (e.g. the newly scheduled
  // next hearing straight after an outcome was recorded).
  const [packHearingId, setPackHearingId] = useState<Id<"hearings"> | null>(null);
  // Post-hearing chain (section 31): outcome → tasks → chronology event
  // → client update draft → next hearing pack.
  const [outcomeHearing, setOutcomeHearing] = useState<{
    id: Id<"hearings">;
    title: string;
    court: string | null;
  } | null>(null);
  // Hearing being rescheduled (audit-trailed, clash-warned dialog).
  const [rescheduleHearing, setRescheduleHearing] = useState<{
    id: Id<"hearings">;
    title: string;
    at: number;
    courtroom: string | null;
    appearingAdvocateId: Id<"users"> | null;
  } | null>(null);
  const { matterId: rawId } = useParams<{ matterId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const matterId = rawId as Id<"matters"> | undefined;

  const matter = useQuery(api.matters.get, matterId ? { matterId } : "skip");
  const notes = useQuery(api.matters.listNotes, matterId ? { matterId } : "skip");
  const documents = useQuery(api.matters.listDocuments, matterId ? { matterId } : "skip");
  const orders = useQuery(api.matters.allOrders);
  const markOrderReviewed = useMutation(api.matters.markOrderReviewed);
  const closeMatterFn = useMutation(api.matters.closeMatter);
  const reopenMatterFn = useMutation(api.matters.reopenMatter);
  const setArchivedFn = useMutation(api.matters.setArchived);
  const setLeadFn = useMutation(api.matters.setLead);
  const addPartyFn = useMutation(api.matters.addParty);
  const removePartyFn = useMutation(api.matters.removeParty);
  const addIssueFn = useMutation(api.matters.addIssue);
  const setIssueStatusFn = useMutation(api.matters.setIssueStatus);
  const attachEvidenceFn = useMutation(api.matters.attachEvidence);
  const parties = useQuery(
    api.matters.listParties,
    matterId ? { matterId } : "skip",
  );
  const issues = useQuery(
    api.matters.listIssues,
    matterId ? { matterId } : "skip",
  );
  const auditLog = useQuery(
    api.matters.listAudit,
    matterId ? { matterId } : "skip",
  );
  const members = useQuery(api.workspace.team);
  const timeEntries = useQuery(api.matters.listTime, matterId ? { matterId } : "skip");
  const expenses = useQuery(api.matters.listExpenses, matterId ? { matterId } : "skip");
  const events = useQuery(api.matters.listEvents, matterId ? { matterId } : "skip");
  const hearings = useQuery(api.matters.listHearings, matterId ? { matterId } : "skip");

  const updateStatus = useMutation(api.matters.updateStatus);
  const addHearing = useMutation(api.matters.addHearing);
  const addOrder = useMutation(api.matters.addOrder);
  const addTask = useMutation(api.matters.addTask);
  const addTime = useMutation(api.billing.addTime);
  const addExpense = useMutation(api.billing.addExpense);
  const addNote = useMutation(api.matters.addNote);
  const createInvoice = useMutation(api.billing.createFromMatter);
  const generateUploadUrl = useMutation(api.matters.generateDocumentUploadUrl);
  const attachDocument = useMutation(api.matters.attachDocument);
  const replyToClient = useMutation(api.portals.replyToClient);
  const setDocumentRequest = useMutation(api.portals.setDocumentRequest);
  const setSubmission = useMutation(api.matters.setClientSubmission);
  const caps = useQuery(api.workspace.myCapabilities);
  const setTeamFn = useMutation(api.matters.setTeam);
  // Contextual AI (Ask This Document): requires the same note-writing
  // permission the AI studio itself enforces.
  const prepareAIJob = useMutation(api.ai.prepareJob);
  const addAISource = useMutation(api.ai.addSource);
  const canNoteWrite = caps?.capabilities.includes("note.write") ?? false;
  // §32 panels: matter-edit governs alert/wall management surfaces; the
  // team roster (active members) feeds alert assignment.
  const canEditMatter = caps?.capabilities.includes("matter.edit") ?? false;
  // §32 Phase 7: close-matters capability gates hold placement/lifting.
  const canCloseMatter = caps?.capabilities.includes("matter.close") ?? false;
  const memberOptions = (members ?? [])
    .filter((m) => m.status === "active")
    .map((m) => ({
      _id: String(m.userId),
      name: m.name ?? m.email ?? "Member",
      email: m.email ?? "",
    }));
  const [askDocBusy, setAskDocBusy] = useState<Id<"matterDocuments"> | null>(null);
  // Extracted AI sources on this matter (to pin the viewed document's
  // text for Ask This Document; undefined until loaded).
  const aiSourcesForMatter = useQuery(
    api.ai.listSources,
    matterId ? { matterId } : "skip",
  );

  const [partyName, setPartyName] = useState("");
  const [partySide, setPartySide] = useState("ours");
  const [partyRole, setPartyRole] = useState("");
  const [partyCounsel, setPartyCounsel] = useState("");
  const [teamDraft, setTeamDraft] = useState<Id<"users">[] | null>(null);
  const teamSel = teamDraft ?? matter?.teamIds ?? [];
  const acIsOwnerPartnerAdmin =
    caps?.orgRole === "owner" ||
    caps?.orgRole === "partner" ||
    caps?.orgRole === "administrator";

  const [hearingTitle, setHearingTitle] = useState("");
  const [hearingAt, setHearingAt] = useState("");
  const [hearingCourt, setHearingCourt] = useState("");
  const [orderTitle, setOrderTitle] = useState("");
  const [orderSummary, setOrderSummary] = useState("");
  const [orderDate, setOrderDate] = useState(todayIN());
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [timeDesc, setTimeDesc] = useState("");
  const [timeBillable, setTimeBillable] = useState(true);
  const [timerStart, setTimerStart] = useState<number | null>(null);
  const [timerEndedAt, setTimerEndedAt] = useState<number | null>(null);
  const [timeMinutes, setTimeMinutes] = useState("");
  const [timeRate, setTimeRate] = useState("");
  const [timeDate, setTimeDate] = useState(todayIN());
  const [expenseDesc, setExpenseDesc] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("misc");
  const [expenseBillable, setExpenseBillable] = useState(true);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const receiptInput = useRef<HTMLInputElement>(null);
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayIN());
  const [noteBody, setNoteBody] = useState("");
  const [docKind, setDocKind] = useState("document");
  const [docVisibility, setDocVisibility] = useState("internal");
  const [replyBody, setReplyBody] = useState<string | null>(null); // which note is being replied to
  const [replyText, setReplyText] = useState("");
  const [requestNote, setRequestNote] = useState<string | null>(null); // which doc gets checklist note
  const [requestText, setRequestText] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [issueTitle, setIssueTitle] = useState("");
  const [issueDetail, setIssueDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // Deep-linkable tab: /matters/:id?tab=orders (used by the attention docket).
  const tabParam = searchParams.get("tab");
  const activeTab =
    tabParam &&
    ["command", "timeline", "hearings", "orders", "tasks", "documents", "time", "expenses", "invoices", "notes", "comms", "parties", "issues", "docket", "audit", "ai", "requests"].includes(
      tabParam,
    )
      ? tabParam
      : "command";
  const setTab = (value: string) => {
    setSearchParams(value === "hearings" ? {} : { tab: value }, { replace: true });
  };

  if (matter === undefined) {
    return (
      <ChamberShell subtitle="The Digital Chamber" title="Matter file">
        <p className="text-sm text-muted-foreground">Retrieving the file…</p>
      </ChamberShell>
    );
  }

  if (matter === null) {
    return (
      <ChamberShell subtitle="The Digital Chamber" title="Matter file">
        <div className="py-20 text-center">
          <Landmark className="mx-auto size-10 text-muted-foreground" />
          <h2 className="mt-6 font-serif text-2xl font-semibold">
            This matter is not on the chamber's record
          </h2>
          <Button asChild variant="outline" className="mt-6">
            <Link to="/dashboard">
              <ArrowLeft className="mr-2 size-4" />
              Return to overview
            </Link>
          </Button>
        </div>
      </ChamberShell>
    );
  }

  const handleUpload = async (file: File) => {
    if (!matterId) return;
    setBusy(true);
    try {
      const uploadUrl = await generateUploadUrl({ matterId });
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      const { storageId } = (await res.json()) as { storageId: string };
      // Evidence integrity: hash the exact bytes in the browser before
      // recording. If hashing fails the upload proceeds without a hash
      // (honestly absent, never fabricated).
      let integritySha256: string | undefined;
      try {
        integritySha256 = await sha256Hex(await file.arrayBuffer());
      } catch {
        integritySha256 = undefined;
      }
      await attachDocument({
        matterId,
        name: file.name,
        kind: docKind as "document" | "communication",
        visibility: docVisibility as "internal" | "shared_with_client",
        storageId: storageId as Id<"_storage"> | undefined,
        integritySha256,
      });
      toast.success("Document filed to the matter.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <ChamberShell
      subtitle="The Digital Chamber"
      title={matter.title}
    >
      {/* File heading */}
      <div className="rule-frame rounded-lg p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="type-label ink-faded">
              {matter.reference} · {matter.practiceArea}
              {matter.archivedAt ? " · ARCHIVED" : ""}
              {matter.priority && matter.priority !== "normal" && (
                <span
                  className={`ml-2 ${matter.priority === "urgent" ? "text-red-700" : "text-[#8a6a33]"}`}
                >
                  · {matter.priority.toUpperCase()} PRIORITY
                </span>
              )}
            </p>
            <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight">
              {matter.title}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {matter.client?.name}
              </span>
              {matter.court ? ` · ${matter.court}` : ""}
              {matter.bench ? ` · ${matter.bench}` : ""}
              {matter.caseNumber ? ` · ${matter.caseNumber}` : ""}
              {matter.opposingParty ? ` · vs ${matter.opposingParty}` : ""}
            </p>
            {(matter.opposingCounsel || matter.billingArrangement) && (
              <p className="mt-1 text-sm text-muted-foreground">
                {matter.opposingCounsel
                  ? `Opposing counsel: ${matter.opposingCounsel}`
                  : ""}
                {matter.opposingCounsel && matter.billingArrangement ? " · " : ""}
                {matter.billingArrangement ?? ""}
              </p>
            )}
            {matter.keyDates && matter.keyDates.length > 0 && (
              <p className="type-label mt-2 flex flex-wrap gap-x-4 gap-y-1 ink-faded">
                {matter.keyDates.map((kd) => (
                  <span key={`${kd.label}-${kd.date}`}>
                    {kd.label}: {formatDateIN(kd.date)}
                  </span>
                ))}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {caps?.capabilities.includes("matter.edit") && (
              <Button
                size="sm"
                variant={matter.clientSubmission ? "default" : "outline"}
                className="gap-1.5"
                onClick={async () => {
                  try {
                    await setSubmission({
                      matterId: matterId!,
                      enabled: !matter.clientSubmission,
                    });
                    toast.success(
                      matter.clientSubmission
                        ? "Client submission disabled."
                        : "Client document submission enabled.",
                    );
                  } catch (err) {
                    toast.error(
                      err instanceof Error ? err.message : "Failed.",
                    );
                  }
                }}
              >
                <Upload className="size-4" aria-hidden="true" />
                {matter.clientSubmission
                  ? "Client submissions on"
                  : "Allow client submissions"}
              </Button>
            )}
            <Select
              value={matter.status}
              onValueChange={async (v) => {
                try {
                  await updateStatus({
                    matterId: matterId!,
                    status: v as MatterStatus,
                  });
                  toast.success("Status updated.");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Update failed.");
                }
              }}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STATUS_LABELS) as MatterStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {caps?.capabilities.includes("matter.edit") && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setEditOpen(true)}
              >
                Edit details
              </Button>
            )}
            {matter && matterId && (
              <EditMatterDialog
                matterId={matterId}
                matter={matter}
                open={editOpen}
                onOpenChange={setEditOpen}
              />
            )}
            {caps?.capabilities.includes("matter.close") &&
              matter.status !== "closed" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await closeMatterFn({ matterId: matterId! });
                      toast.success("Matter closed.");
                    } catch (err) {
                      toast.error(
                        err instanceof Error ? err.message : "Failed.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Close matter
                </Button>
              )}
            {caps?.capabilities.includes("matter.edit") &&
              matter.status === "closed" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await reopenMatterFn({ matterId: matterId! });
                      toast.success("Matter reopened.");
                    } catch (err) {
                      toast.error(
                        err instanceof Error ? err.message : "Failed.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Reopen matter
                </Button>
              )}
            {caps?.capabilities.includes("matter.edit") &&
              matter.status === "closed" && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await setArchivedFn({
                        matterId: matterId!,
                        archived: !matter.archivedAt,
                      });
                      toast.success(
                        matter.archivedAt
                          ? "Matter restored from archive."
                          : "Matter archived.",
                      );
                    } catch (err) {
                      toast.error(
                        err instanceof Error ? err.message : "Failed.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {matter.archivedAt ? "Restore" : "Archive"}
                </Button>
              )}
          </div>
        </div>
        {matter.description && (
          <>
            <Separator className="my-5" />
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {matter.description}
            </p>
          </>
        )}
        {/* At-a-glance strip: status · court · next hearing */}
        <Separator className="my-5" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <p className="type-label ink-faded">Status</p>
            <p className="mt-0.5 text-sm font-medium">
              {STATUS_LABELS[matter.status] ?? matter.status}
              {matter.archivedAt ? " · Archived" : ""}
            </p>
          </div>
          <div>
            <p className="type-label ink-faded">Court</p>
            <p className="mt-0.5 truncate text-sm font-medium">
              {[matter.court, matter.bench, matter.courtroom].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
          <div>
            <p className="type-label ink-faded">Next hearing</p>
            {matter.nextHearingAt ? (
              <p className="mt-0.5 text-sm font-medium">
                {formatDateTimeIN(matter.nextHearingAt)}
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-muted-foreground">None scheduled</p>
            )}
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setTab} className="mt-8">
        <TabsList className="flex-wrap">
          <TabsTrigger value="command" className="gap-2">
            <Landmark className="size-4" /> Overview
          </TabsTrigger>
          <TabsTrigger value="timeline" className="gap-2">
            <CalendarClock className="size-4" /> Timeline
          </TabsTrigger>
          <TabsTrigger value="hearings" className="gap-2">
            <Gavel className="size-4" /> Hearings
          </TabsTrigger>
          <TabsTrigger value="orders" className="gap-2">
            <ScrollText className="size-4" /> Orders
          </TabsTrigger>
          <TabsTrigger value="tasks" className="gap-2">
            <ListChecks className="size-4" /> Tasks
          </TabsTrigger>
          <TabsTrigger value="requests" className="gap-2">
            <Inbox className="size-4" /> Requests
          </TabsTrigger>
          <TabsTrigger value="documents" className="gap-2">
            <FileText className="size-4" /> Documents
          </TabsTrigger>
          <TabsTrigger value="time" className="gap-2">
            <CircleDashed className="size-4" /> Time
          </TabsTrigger>
          <TabsTrigger value="expenses" className="gap-2">
            <Receipt className="size-4" /> Expenses
          </TabsTrigger>
          <TabsTrigger value="invoices" className="gap-2">
            <Receipt className="size-4" /> Billing
          </TabsTrigger>
          <TabsTrigger value="comms" className="gap-2">
            <MessageSquare className="size-4" /> Communications
          </TabsTrigger>
          <TabsTrigger value="notes" className="gap-2">
            <StickyNote className="size-4" /> Notes
          </TabsTrigger>
          <TabsTrigger value="parties" className="gap-2">
            <Users className="size-4" /> Parties &amp; team
          </TabsTrigger>
          <TabsTrigger value="issues" className="gap-2">
            <Scale className="size-4" /> Evidence &amp; issues
          </TabsTrigger>
          <TabsTrigger value="review" className="gap-2">
            <ShieldCheck className="size-4" /> Review (§32)
          </TabsTrigger>
          <TabsTrigger value="filing" className="gap-2">
            <ClipboardCheck className="size-4" /> Filing
          </TabsTrigger>
          <TabsTrigger value="translations" className="gap-2">
            <Languages className="size-4" /> Translations
          </TabsTrigger>
          <TabsTrigger value="client" className="gap-2">
            <FileText className="size-4" /> Client updates
          </TabsTrigger>
          <TabsTrigger value="docket" className="gap-2">
            <CalendarClock className="size-4" /> Docket
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-2">
            <History className="size-4" /> Audit
          </TabsTrigger>
          <TabsTrigger value="ai" className="gap-2">
            <Bot className="size-4" /> AI Studio
          </TabsTrigger>
        </TabsList>

        {/* Command Centre — permission-aware aggregate situation board */}
        <TabsContent value="command" className="mt-6">
          <div className="space-y-5">
            {/* Alerts strip */}
            {matterId && (
              <MatterAlerts
                matterId={matterId}
                nextHearingAt={matter.nextHearingAt}
                eventCount={(events ?? []).length}
              />
            )}
            {matterId && <CommandCentre matterId={matterId} />}
            <div className="grid gap-5 lg:grid-cols-2">
              {/* Recent documents */}
              <Card>
                <CardContent className="p-4">
                  <p className="font-serif text-sm font-semibold">Recent documents</p>
                  {(documents ?? []).length === 0 ? (
                    <p className="mt-3 text-sm ink-faded">No documents filed yet.</p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {(documents ?? [])
                        .slice()
                        .sort((a, b) => b.createdAt - a.createdAt)
                        .slice(0, 5)
                        .map((d) => (
                          <li key={d._id} className="flex items-center justify-between gap-2 text-sm">
                            <span className="min-w-0 truncate">{d.name}</span>
                            <span className="shrink-0">
                              <DocumentLink documentId={d._id} />
                            </span>
                          </li>
                        ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
              {/* Ask AI About This Matter */}
              {matterId && canNoteWrite && (
                <Card>
                  <CardContent className="p-4">
                    <p className="font-serif text-sm font-semibold">Ask AI About This Matter</p>
                    <p className="type-label mt-0.5 ink-faded">
                      Grounded in this matter's extracted sources only.
                    </p>
                    <div className="mt-3">
                      <MatterAskAI matterId={matterId} />
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Communications — the matter's threads, in the file */}
        <TabsContent value="comms" className="mt-6">
          <MatterThreads matterId={matterId!} canNoteWrite={canNoteWrite} />
        </TabsContent>

        {/* Timeline — chronological docket with source-document links */}
        <TabsContent value="timeline" className="mt-6">
          {(events ?? []).length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center text-sm ink-faded">
                The case timeline is empty — filings, orders, hearings and
                payments appear here as the matter progresses.
              </CardContent>
            </Card>
          ) : (
            <ol>
              {(events ?? []).map((e, i) => (
                <li key={e._id} className="relative flex gap-4 pb-6">
                  {i < (events ?? []).length - 1 && (
                    <span className="absolute left-[5px] top-4 h-full w-px bg-border" />
                  )}
                  <span
                    className={`mt-1.5 size-[11px] shrink-0 rounded-full border ${
                      e.aiSuggested && !e.reviewed
                        ? "border-[#8a6a33] bg-[#8a6a33]/20"
                        : "border-primary/60 bg-background"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">{e.detail}</p>
                    <p className="type-label mt-1 ink-faded">
                      {formatDateTimeIN(e.occurredAt ?? e.createdAt)} · {e.kind}
                      {e.datePrecision === "approx" ? " · approx date" : ""}
                      {e.aiSuggested && !e.reviewed ? " · AI suggestion" : ""}
                      {e.sourceRef ? ` · ${e.sourceRef}` : ""}
                    </p>
                    {e.linkKind === "document" && e.linkId && (
                      <p className="mt-1 text-xs">
                        <DocumentLink documentId={e.linkId as Id<"matterDocuments">} />
                      </p>
                    )}
                    {e.linkKind === "hearing" && e.linkId && (
                      <button
                        type="button"
                        className="type-label text-primary hover:underline"
                        onClick={() => setTab("hearings")}
                      >
                        View hearing →
                      </button>
                    )}
                    {e.linkKind === "order" && e.linkId && (
                      <button
                        type="button"
                        className="type-label text-primary hover:underline"
                        onClick={() => setTab("orders")}
                      >
                        View order →
                      </button>
                    )}
                    {e.linkKind === "message" && e.linkId && (
                      <button
                        type="button"
                        className="type-label text-primary hover:underline"
                        onClick={() => setTab("comms")}
                      >
                        View message →
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </TabsContent>

        {/* Hearings */}
        <TabsContent value="hearings" className="mt-6">
          <div className="mb-4 flex justify-end">
            <Button variant="outline" size="sm" onClick={() => { setPackHearingId(null); setPackOpen(true); }}>
              <FileText className="mr-2 h-4 w-4" /> Build hearing pack
            </Button>
          </div>
          {matterId && (
            <HearingPackDialog
              matterId={matterId}
              open={packOpen}
              onOpenChange={setPackOpen}
              preselectHearingId={packHearingId}
            />
          )}
          {outcomeHearing && matterId && (
            <HearingOutcomeDialog
              hearingId={outcomeHearing.id}
              hearingTitle={outcomeHearing.title}
              court={outcomeHearing.court}
              open
              onOpenChange={(v) => !v && setOutcomeHearing(null)}
            />
          )}
          {rescheduleHearing && (
            <HearingRescheduleDialog
              hearingId={rescheduleHearing.id}
              hearingTitle={rescheduleHearing.title}
              currentAt={rescheduleHearing.at}
              courtroom={rescheduleHearing.courtroom}
              appearingAdvocateId={rescheduleHearing.appearingAdvocateId}
              matterLeadId={matter?.leadLawyerId ?? null}
              open
              onOpenChange={(v) => !v && setRescheduleHearing(null)}
            />
          )}

          {/* Feature 2 review desk — proposals from recorded outcomes are
              approved, edited or rejected here before anything is created. */}
          {matterId && (
            <div className="mb-4">
              <ProposalReviewPanel
                matterId={matterId}
                onOpenPack={() => {
                  setPackHearingId(null);
                  setPackOpen(true);
                }}
              />
            </div>
          )}

          {/* Real hearing records — scheduled hearings expose the outcome
              action that drives the whole post-hearing chain. */}
          <div className="mb-4 space-y-2">
            <p className="type-label ink-faded">Hearings on this matter</p>
            {(hearings ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hearings recorded yet. Schedule the first one below.
              </p>
            ) : (
              (hearings ?? [])
                .slice()
                .sort((a, b) => b.at - a.at)
                .slice(0, 8)
                .map((h) => (
                  <div
                    key={h._id}
                    className="flex flex-wrap items-center justify-between gap-2 rule-frame bg-card p-4"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{h.title}</span>
                        <Badge
                          variant={
                            h.status === "held"
                              ? "secondary"
                              : h.status === "adjourned"
                                ? "destructive"
                                : h.status === "cancelled"
                                  ? "outline"
                                  : "default"
                          }
                        >
                          {h.status}
                        </Badge>
                      </div>
                      <p className="type-label mt-1 ink-faded">
                        {formatDateTimeIN(h.at)}
                        {h.court ? ` · ${h.court}` : ""}
                        {h.outcome ? ` · ${h.outcome.slice(0, 110)}` : ""}
                      </p>
                    </div>
                    {h.status === "scheduled" && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setPackHearingId(h._id);
                            setPackOpen(true);
                          }}
                        >
                          <FileText className="mr-1 h-4 w-4" /> Prepare pack
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setRescheduleHearing({
                              id: h._id,
                              title: h.title,
                              at: h.at,
                              courtroom: h.courtroom ?? null,
                              appearingAdvocateId: h.appearingAdvocateId ?? null,
                            })
                          }
                        >
                          Reschedule
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setOutcomeHearing({
                              id: h._id,
                              title: h.title,
                              court: h.court ?? null,
                            })
                          }
                        >
                          Record outcome
                        </Button>
                      </div>
                    )}
                  </div>
                ))
            )}
          </div>
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-3">
              {(events ?? []).filter((e) => e.kind === "hearing").length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-8 text-center text-sm ink-faded">
                    No hearings recorded on this matter yet.
                  </CardContent>
                </Card>
              ) : (
                (events ?? [])
                  .filter((e) => e.kind === "hearing")
                  .reverse()
                  .map((e) => (
                    <div key={e._id} className="rule-frame bg-card p-4">
                      <p className="text-sm">{e.detail}</p>
                      <p className="type-label mt-1 ink-faded">
                        {formatDateTimeIN(e.createdAt)}
                      </p>
                    </div>
                  ))
              )}
            </div>
            <Card className="rule-frame h-fit bg-card">
              <CardContent className="space-y-4 pt-6">
                <h3 className="font-serif text-lg font-semibold">
                  Schedule a hearing
                </h3>
                <div className="space-y-2">
                  <Label htmlFor="h-title">Title</Label>
                  <Input
                    id="h-title"
                    value={hearingTitle}
                    onChange={(e) => setHearingTitle(e.target.value)}
                    placeholder="e.g. Final hearing — arguments"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="h-at">Date & time</Label>
                  <Input
                    id="h-at"
                    type="datetime-local"
                    value={hearingAt}
                    onChange={(e) => setHearingAt(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="h-court">Court</Label>
                  <Input
                    id="h-court"
                    value={hearingCourt}
                    onChange={(e) => setHearingCourt(e.target.value)}
                    placeholder={matter.court ?? "Court / forum"}
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={busy}
                  onClick={async () => {
                    if (!hearingTitle.trim() || !hearingAt) {
                      toast.error("Title and date are required.");
                      return;
                    }
                    setBusy(true);
                    try {
                      await addHearing({
                        matterId: matterId!,
                        title: hearingTitle,
                        court: hearingCourt || undefined,
                        at: new Date(hearingAt).getTime(),
                      });
                      toast.success("Hearing scheduled.");
                      setHearingTitle("");
                      setHearingAt("");
                      setHearingCourt("");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Failed.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Schedule
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Orders */}
        <TabsContent value="orders" className="mt-6">
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-3">
              {(orders ?? []).filter((o) => o.matter?._id === matterId).length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-8 text-center text-sm ink-faded">
                    No orders recorded yet.
                  </CardContent>
                </Card>
              ) : (
                (orders ?? [])
                  .filter((o) => o.matter?._id === matterId)
                  .map((o) => (
                    <div key={o._id} className="rule-frame bg-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{o.title}</p>
                          {o.summary && (
                            <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                              {o.summary}
                            </p>
                          )}
                          <p className="type-label mt-1.5 ink-faded">
                            Passed on {formatDateIN(o.passedOn)}
                            {o.reviewedAt
                              ? ` · reviewed ${formatDateIN(o.reviewedAt)}`
                              : ""}
                          </p>
                        </div>
                        {!o.reviewedAt &&
                          caps?.capabilities.includes("order.record") && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="shrink-0 gap-1.5"
                              onClick={async () => {
                                try {
                                  await markOrderReviewed({ orderId: o._id });
                                  toast.success("Order marked reviewed.");
                                } catch (err) {
                                  toast.error(
                                    err instanceof Error
                                      ? err.message
                                      : "Failed.",
                                  );
                                }
                              }}
                            >
                              <CheckCircle2 className="size-4" aria-hidden="true" />
                              Mark reviewed
                            </Button>
                          )}
                      </div>
                    </div>
                  ))
              )}
            </div>
            <Card className="rule-frame h-fit bg-card">
              <CardContent className="space-y-4 pt-6">
                <h3 className="font-serif text-lg font-semibold">
                  Record an order
                </h3>
                <div className="space-y-2">
                  <Label htmlFor="o-title">Order title</Label>
                  <Input
                    id="o-title"
                    value={orderTitle}
                    onChange={(e) => setOrderTitle(e.target.value)}
                    placeholder="e.g. Interim injunction granted"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="o-date">Passed on</Label>
                  <Input
                    id="o-date"
                    type="date"
                    value={orderDate}
                    onChange={(e) => setOrderDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="o-sum">Summary</Label>
                  <Textarea
                    id="o-sum"
                    value={orderSummary}
                    onChange={(e) => setOrderSummary(e.target.value)}
                    placeholder="What the court held…"
                    className="min-h-[70px]"
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={busy}
                  onClick={async () => {
                    if (!orderTitle.trim()) {
                      toast.error("Order title is required.");
                      return;
                    }
                    setBusy(true);
                    try {
                      await addOrder({
                        matterId: matterId!,
                        title: orderTitle,
                        passedOn: new Date(`${orderDate}T00:00:00`).getTime(),
                        summary: orderSummary || undefined,
                      });
                      toast.success("Order recorded.");
                      setOrderTitle("");
                      setOrderSummary("");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Failed.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Record order
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tasks */}
        <TabsContent value="tasks" className="mt-6">
          <div className="mb-4">
            <Link
              to="/tasks"
              className="type-label text-[#4f6b8f] underline-offset-2 hover:underline"
            >
              Open the full Tasks desk →
            </Link>
          </div>
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-3">
              {(events ?? []).filter((e) => e.kind === "task").length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-8 text-center text-sm ink-faded">
                    No tasks on this matter yet.
                  </CardContent>
                </Card>
              ) : (
                (events ?? [])
                  .filter((e) => e.kind === "task")
                  .reverse()
                  .map((e) => (
                    <div key={e._id} className="rule-frame bg-card p-4">
                      <p className="text-sm">{e.detail}</p>
                      <p className="type-label mt-1 ink-faded">
                        {formatDateTimeIN(e.createdAt)}
                      </p>
                    </div>
                  ))
              )}
            </div>
            <Card className="rule-frame h-fit bg-card">
              <CardContent className="space-y-4 pt-6">
                <h3 className="font-serif text-lg font-semibold">Add a task</h3>
                <div className="space-y-2">
                  <Label htmlFor="t-title">Task</Label>
                  <Input
                    id="t-title"
                    value={taskTitle}
                    onChange={(e) => setTaskTitle(e.target.value)}
                    placeholder="e.g. Draft written submissions"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="t-due">Due (optional)</Label>
                  <Input
                    id="t-due"
                    type="datetime-local"
                    value={taskDue}
                    onChange={(e) => setTaskDue(e.target.value)}
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={busy}
                  onClick={async () => {
                    if (!taskTitle.trim()) {
                      toast.error("Task title is required.");
                      return;
                    }
                    setBusy(true);
                    try {
                      await addTask({
                        matterId: matterId!,
                        title: taskTitle,
                        dueAt: taskDue
                          ? new Date(taskDue).getTime()
                          : undefined,
                      });
                      toast.success("Task added.");
                      setTaskTitle("");
                      setTaskDue("");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Failed.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Add task
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Documents */}
        <TabsContent value="documents" className="mt-6">
          {/* §32 Phase 6 — verified redaction (document-scoped tool) */}
          <details className="mb-6 rounded-lg border border-border/70 p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Verified redaction (§32) — produce a derivative with terms provably removed
            </summary>
            <div className="mt-4">
              {matterId && <RedactionPanel matterId={matterId} />}
            </div>
          </details>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div className="w-44">
              <Label>Kind</Label>
              <Select value={docKind} onValueChange={setDocKind}>
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="document">Document</SelectItem>
                  <SelectItem value="communication">Communication</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-56">
              <Label>Visibility</Label>
              <Select
                value={docVisibility}
                onValueChange={setDocVisibility}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="internal">
                    Internal (chamber only)
                  </SelectItem>
                  <SelectItem value="shared_with_client">
                    Shared with client
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
              }}
            />
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip className="mr-2 size-4" />
              File a document
            </Button>
          </div>
          <div className="space-y-3">
            {(documents ?? []).length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-8 text-center text-sm ink-faded">
                  No documents filed on this matter yet.
                </CardContent>
              </Card>
            ) : (
              (documents ?? []).map((d) => (
                <div key={d._id} className="rule-frame bg-card p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{d.name}</p>
                      <p className="type-label mt-1 flex flex-wrap items-center gap-2 ink-faded">
                        <span>
                          {d.kind} · {formatDateTimeIN(d.createdAt)}
                          {d.submittedByClient
                            ? " · submitted by client"
                            : d.visibility === "shared_with_client"
                              ? " · shared with client"
                              : ""}
                        </span>
                        <DocumentIntegrityChip
                          documentId={d._id}
                          integritySha256={d.integritySha256}
                        />
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {caps?.capabilities.includes("task.manage") && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1.5"
                          onClick={() => {
                            setRequestNote(d._id);
                            setRequestText(d.requestedNote ?? "");
                          }}
                        >
                          <ClipboardCheck
                            className="size-4"
                            aria-hidden="true"
                          />
                          {d.requestedFromClient ? "Checklist ✓" : "Request"}
                        </Button>
                      )}
                      {canNoteWrite && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1.5"
                          disabled={askDocBusy === d._id}
                          onClick={async () => {
                            setAskDocBusy(d._id);
                            try {
                              // Ask This Document: analyse exactly the
                              // Ask This Document: analyse exactly the
                              // document being viewed. Its extracted AI
                              // source (if any) is found and pinned as the
                              // single source; without one, the assistant
                              // says what is missing instead of guessing.
                              const existing = (aiSourcesForMatter ?? []).find(
                                (s) => s.documentId === d._id,
                              );
                              const jobId = await prepareAIJob({
                                matterId: matterId!,
                                kind: "ask_document",
                                inputNote: `Analyse this document: ${d.name}`,
                                sourceIds: existing
                                  ? [existing._id as Id<"aiSources">]
                                  : undefined,
                              });
                              toast.success(
                                existing
                                  ? "Ask This Document saved — grounded in the extracted text."
                                  : "No extracted text for this document yet — the assistant will say exactly what is missing. Add it under Sources for a full analysis.",
                              );
                              setSearchParams(
                                { tab: "ai", job: jobId },
                                { replace: true },
                              );
                            } catch (err) {
                              toast.error(
                                err instanceof Error
                                  ? err.message
                                  : "Could not start the analysis.",
                              );
                            } finally {
                              setAskDocBusy(null);
                            }
                          }}
                        >
                          <Bot className="size-4" aria-hidden="true" />
                          Ask this document
                        </Button>
                      )}
                      {d.storageId && <DocumentLink documentId={d._id} />}
                    </div>
                  </div>
                  {d.requestedFromClient && (
                    <p className="mt-2 border-t border-border pt-2 text-xs text-[#8a6a33]">
                      On the client's document-request checklist
                      {d.requestedNote ? `: ${d.requestedNote}` : ""}
                    </p>
                  )}
                  {requestNote === d._id && (
                    <div className="mt-3 flex gap-2">
                      <Input
                        value={requestText}
                        onChange={(e) => setRequestText(e.target.value)}
                        placeholder="Instruction for the client (optional)…"
                        className="flex-1"
                      />
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await setDocumentRequest({
                              documentId: d._id,
                              requested: true,
                              note: requestText || undefined,
                            });
                            toast.success("Added to the client's checklist.");
                            setRequestNote(null);
                          } catch (err) {
                            toast.error(
                              err instanceof Error ? err.message : "Failed.",
                            );
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Save
      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setRequestNote(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Client document-request checklist */}
          <DocumentRequestPanel matterId={matterId!} />
        </TabsContent>

        {/* Requests — deep-linkable desk for client document requests */}
        <TabsContent value="requests" className="mt-6">
          <DocumentRequestPanel matterId={matterId!} />
        </TabsContent>

        {/* §32 Phase 5 — filing-readiness workspace */}
        <TabsContent value="filing" className="mt-6">
          {matterId && <FilingReadinessPanel matterId={matterId} />}
        </TabsContent>

        {/* §32 Phase 9 — multilingual evidence review */}
        <TabsContent value="translations" className="mt-6">
          {matterId && <TranslationsPanel matterId={matterId} canEdit={canEditMatter} />}
        </TabsContent>

        {/* §32 Phase 10 — client-update drafts from approved developments */}
        <TabsContent value="client" className="mt-6">
          {matterId && (
            <ClientUpdatesPanel matterId={matterId} canEdit={canEditMatter} canSend={canNoteWrite} />
          )}
        </TabsContent>

        {/* Time */}
        <TabsContent value="time" className="mt-6">
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-3">
              {(timeEntries ?? []).length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-8 text-center text-sm ink-faded">
                    No time recorded on this matter yet.
                  </CardContent>
                </Card>
              ) : (
                (timeEntries ?? []).map((t) => (
                  <div
                    key={t._id}
                    className="rule-frame flex items-center justify-between gap-4 bg-card p-4"
                  >
                    <div className="min-w-0">
                      <p className="text-sm">{t.description}</p>
                      <p className="type-label mt-1 ink-faded">
                        {t.minutes} min @ ₹{t.ratePerHour}/hr ·{" "}
                        {formatDateIN(t.date)}
                        {t.invoiceId ? " · invoiced" : ""}
                      </p>
                    </div>
                    <span className="font-serif font-semibold text-primary">
                      {formatINR(Math.round((t.minutes / 60) * t.ratePerHour))}
                    </span>
                  </div>
                ))
              )}
            </div>
            <Card className="rule-frame h-fit bg-card">
              <CardContent className="space-y-4 pt-6">
                <h3 className="font-serif text-lg font-semibold">
                  Record time
                </h3>
                {/* Timer: measure, then save the measured window. */}
                <div className="rounded-md border border-[#B68A45]/40 bg-[#B68A45]/[0.04] p-3">
                  <div className="flex items-center justify-between">
                    <span className="type-label ink-faded">Timer</span>
                    <span className="font-mono text-sm">
                      {timerStart
                        ? `${Math.floor((Date.now() - timerStart) / 60000)}m ${Math.floor(((Date.now() - timerStart) % 60000) / 1000)}s`
                        : "—"}
                    </span>
                  </div>
                  <div className="mt-2 flex gap-2">
                    {!timerStart ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => setTimerStart(Date.now())}
                      >
                        Start
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => {
                          const elapsed = Math.round((Date.now() - timerStart) / 60000);
                          if (elapsed >= 1) {
                            setTimeMinutes(String(elapsed));
                            setTimerEndedAt(timerStart);
                            toast.success(
                              `Timer stopped at ${elapsed} min — review and save below.`,
                            );
                          } else {
                            toast.error("Less than a minute recorded; timer discarded.");
                          }
                          setTimerStart(null);
                        }}
                      >
                        Stop &amp; use
                      </Button>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tm-desc">Description</Label>
                  <Input
                    id="tm-desc"
                    value={timeDesc}
                    onChange={(e) => setTimeDesc(e.target.value)}
                    placeholder="e.g. Conference with client"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="tm-min">Minutes</Label>
                    <Input
                      id="tm-min"
                      type="number"
                      min="1"
                      value={timeMinutes}
                      onChange={(e) => setTimeMinutes(e.target.value)}
                      placeholder="90"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tm-rate">Rate /hr (₹)</Label>
                    <Input
                      id="tm-rate"
                      type="number"
                      min="0"
                      value={timeRate}
                      onChange={(e) => setTimeRate(e.target.value)}
                      placeholder="3000"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tm-date">Date</Label>
                  <Input
                    id="tm-date"
                    type="date"
                    value={timeDate}
                    onChange={(e) => setTimeDate(e.target.value)}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={timeBillable}
                    onChange={(e) => setTimeBillable(e.target.checked)}
                  />
                  Billable (untick for non-billable internal work)
                </label>
                <Button
                  className="w-full"
                  disabled={busy}
                  onClick={async () => {
                    if (!timeDesc.trim() || !timeMinutes || !timeRate) {
                      toast.error("Description, minutes and rate are required.");
                      return;
                    }
                    setBusy(true);
                    try {
                      await addTime({
                        matterId: matterId!,
                        description: timeDesc,
                        minutes: parseInt(timeMinutes, 10),
                        ratePerHourMinor: Math.round(parseFloat(timeRate) * 100),
                        date: timeDate,
                        startedAt: timerEndedAt ?? undefined,
                        endedAt: timerEndedAt
                          ? timerEndedAt + parseInt(timeMinutes, 10) * 60_000
                          : undefined,
                        billable: timeBillable,
                      });
                      toast.success("Time recorded.");
                      setTimeDesc("");
                      setTimeMinutes("");
                      setTimerEndedAt(null);
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Failed.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Record time
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Expenses */}
        <TabsContent value="expenses" className="mt-6">
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-3">
              {(expenses ?? []).length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-8 text-center text-sm ink-faded">
                    No expenses recorded on this matter yet.
                  </CardContent>
                </Card>
              ) : (
                (expenses ?? []).map((x) => (
                  <div
                    key={x._id}
                    className="rule-frame flex items-center justify-between gap-4 bg-card p-4"
                  >
                    <div className="min-w-0">
                      <p className="text-sm">{x.description}</p>
                      <p className="type-label mt-1 ink-faded">
                        {formatDateIN(x.date)}
                        {x.invoiceId ? " · invoiced" : ""}
                      </p>
                    </div>
                    <span className="font-serif font-semibold text-primary">
                      {formatINR(x.amount)}
                    </span>
                  </div>
                ))
              )}
            </div>
            <Card className="rule-frame h-fit bg-card">
              <CardContent className="space-y-4 pt-6">
                <h3 className="font-serif text-lg font-semibold">
                  Record an expense
                </h3>
                <div className="space-y-2">
                  <Label htmlFor="x-desc">Description</Label>
                  <Input
                    id="x-desc"
                    value={expenseDesc}
                    onChange={(e) => setExpenseDesc(e.target.value)}
                    placeholder="e.g. Court fee — plaint"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="x-amt">Amount (₹)</Label>
                    <Input
                      id="x-amt"
                      type="number"
                      min="1"
                      value={expenseAmount}
                      onChange={(e) => setExpenseAmount(e.target.value)}
                      placeholder="2500"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="x-date">Date</Label>
                    <Input
                      id="x-date"
                      type="date"
                      value={expenseDate}
                      onChange={(e) => setExpenseDate(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={expenseCategory} onValueChange={setExpenseCategory}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="court_fee">Court fee</SelectItem>
                      <SelectItem value="filing">Filing</SelectItem>
                      <SelectItem value="travel">Travel</SelectItem>
                      <SelectItem value="printing">Printing</SelectItem>
                      <SelectItem value="courier">Courier</SelectItem>
                      <SelectItem value="misc">Miscellaneous</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Receipt (optional)</Label>
                  <input
                    ref={receiptInput}
                    type="file"
                    className="hidden"
                    onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => receiptInput.current?.click()}
                    >
                      <Paperclip className="mr-1.5 size-4" />
                      {receiptFile ? receiptFile.name : "Attach receipt"}
                    </Button>
                    {receiptFile && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setReceiptFile(null);
                          if (receiptInput.current) receiptInput.current.value = "";
                        }}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={expenseBillable}
                    onChange={(e) => setExpenseBillable(e.target.checked)}
                  />
                  Billable to the client (reimbursable)
                </label>
                <Button
                  className="w-full"
                  disabled={busy}
                  onClick={async () => {
                    if (!expenseDesc.trim() || !expenseAmount) {
                      toast.error("Description and amount are required.");
                      return;
                    }
                    setBusy(true);
                    try {
                      let receiptStorageId: Id<"_storage"> | undefined;
                      if (receiptFile) {
                        const url = await generateUploadUrl({ matterId: matterId! });
                        const res = await fetch(url, {
                          method: "POST",
                          headers: { "Content-Type": receiptFile.type || "application/octet-stream" },
                          body: receiptFile,
                        });
                        receiptStorageId = ((await res.json()) as { storageId: string }).storageId as Id<"_storage">;
                      }
                      await addExpense({
                        matterId: matterId!,
                        description: expenseDesc,
                        amountMinor: Math.round(parseFloat(expenseAmount) * 100),
                        date: expenseDate,
                        category: expenseCategory as
                          | "court_fee"
                          | "filing"
                          | "travel"
                          | "printing"
                          | "courier"
                          | "misc",
                        receiptStorageId,
                        billable: expenseBillable,
                      });
                      toast.success("Expense recorded.");
                      setExpenseDesc("");
                      setExpenseAmount("");
                      setReceiptFile(null);
                      if (receiptInput.current) receiptInput.current.value = "";
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Failed.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Record expense
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Invoices */}
        <TabsContent value="invoices" className="mt-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <p className="text-sm ink-faded">
              Draft an invoice from this matter's unbilled time and expenses.
              GST is applied per the chamber settings.
            </p>
            <Button
              className="gap-2"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await createInvoice({ matterId: matterId!, includeBillable: true });
                  toast.success("Invoice drafted. See Billing.");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Failed.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Plus className="size-4" />
              Draft invoice
            </Button>
          </div>
          <Card className="border-dashed">
            <CardContent className="py-8 text-center text-sm ink-faded">
              Invoices raised on this matter appear in the Billing register with
              their payment status.
            </CardContent>
          </Card>
        </TabsContent>        {/* Notes */}
        <TabsContent value="notes" className="mt-6">
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-3">
              {(notes ?? []).length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-8 text-center text-sm ink-faded">
                    No notes on this matter yet.
                  </CardContent>
                </Card>
              ) : (
                (notes ?? []).map((n) => (
                  <div key={n._id} className="rule-frame bg-card p-4">
                    {n.fromClient && (
                      <p className="type-label mb-2 flex items-center gap-1.5 text-[#8a6a33]">
                        <MessageSquare className="size-3.5" /> Message from the
                        client
                      </p>
                    )}
                    {n.toClient && (
                      <p className="type-label mb-2 ink-faded">
                        Reply to client
                      </p>
                    )}
                    <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                    <p className="type-label mt-2 ink-faded">
                      {formatDateTimeIN(n.createdAt)}
                    </p>
                    {n.fromClient &&
                      caps?.capabilities.includes("note.write") && (
                        <div className="mt-3 border-t border-border pt-3">
                          {replyBody === n._id ? (
                            <div className="flex gap-2">
                              <Input
                                value={replyText}
                                onChange={(e) => setReplyText(e.target.value)}
                                placeholder="Reply to the client…"
                                className="flex-1"
                                autoFocus
                              />
                              <Button
                                size="sm"
                                disabled={busy}
                                onClick={async () => {
                                  setBusy(true);
                                  try {
                                    await replyToClient({
                                      matterId: matterId!,
                                      body: replyText,
                                    });
                                    toast.success("Reply sent to the client.");
                                    setReplyBody(null);
                                    setReplyText("");
                                  } catch (err) {
                                    toast.error(
                                      err instanceof Error
                                        ? err.message
                                        : "Failed.",
                                    );
                                  } finally {
                                    setBusy(false);
                                  }
                                }}
                              >
                                Send
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setReplyBody(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              onClick={() => {
                                setReplyBody(n._id);
                                setReplyText("");
                              }}
                            >
                              <Reply className="size-4" /> Reply to client
                            </Button>
                          )}
                        </div>
                      )}
                  </div>
                ))
              )}
            </div>
            <Card className="rule-frame h-fit bg-card">
              <CardContent className="space-y-4 pt-6">
                <h3 className="font-serif text-lg font-semibold">Add a note</h3>
                <Textarea
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                  placeholder="Observations, advice given, next steps…"
                  className="min-h-[110px]"
                />
                <Button
                  className="w-full"
                  disabled={busy || !noteBody.trim()}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await addNote({ matterId: matterId!, body: noteBody });
                      toast.success("Note added.");
                      setNoteBody("");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Failed.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Add note
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Parties & team */}
        <TabsContent value="parties" className="mt-6">
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-6">
              {/* Lead lawyer */}
              <Card className="rule-frame bg-card">
                <CardContent className="pt-6">
                  <h3 className="font-serif text-lg font-semibold">Responsible lead</h3>
                  <p className="mt-1 text-sm ink-faded">
                    The advocate answerable for the conduct of this matter.
                  </p>
                  {caps?.capabilities.includes("matter.edit") ? (
                    <Select
                      value={matter.leadLawyerId ?? ""}
                      onValueChange={async (v) => {
                        try {
                          await setLeadFn({
                            matterId: matterId!,
                            lawyerId: v as Id<"users">,
                          });
                          toast.success("Lead lawyer updated.");
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Failed.");
                        }
                      }}
                    >
                      <SelectTrigger className="mt-3 w-64">
                        <SelectValue placeholder="Assign lead lawyer" />
                      </SelectTrigger>
                      <SelectContent>
                        {(members ?? [])
                          .filter(
                            (m) =>
                              m.status === "active" &&
                              m.orgRole !== "support_staff" &&
                              m.orgRole !== "accountant",
                          )
                          .map((m) => (
                            <SelectItem key={m.membershipId} value={m.userId}>
                              {m.name ?? m.email ?? "Member"}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="mt-3 text-sm">
                      {members?.find((m) => m.userId === matter.leadLawyerId)?.name ??
                        "Not yet assigned."}
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Parties register */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-serif text-lg font-semibold">Parties on record</h3>
                  {caps?.capabilities.includes("matter.edit") && (
                    <span className="type-label ink-faded">Use the form beside to add</span>
                  )}
                </div>
                {(parties ?? []).length === 0 ? (
                  <Card className="border-dashed">
                    <CardContent className="py-8 text-center text-sm ink-faded">
                      No parties recorded. Add the petitioners, respondents and
                      witnesses so the file reads complete.
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(parties ?? []).map((p) => (
                      <div key={p._id} className="rule-frame bg-card p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium">{p.name}</p>
                            <p className="type-label mt-0.5 ink-faded">
                              {p.side === "ours"
                                ? "On our side"
                                : p.side === "opposing"
                                  ? "Opposing"
                                  : "Neutral"}
                              {p.role ? ` · ${p.role}` : ""}
                            </p>
                            {p.counsel && (
                              <p className="mt-1 text-sm ink-faded">
                                Counsel: {p.counsel}
                              </p>
                            )}
                          </div>
                          {caps?.capabilities.includes("matter.edit") && (
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Remove ${p.name}`}
                              onClick={async () => {
                                try {
                                  await removePartyFn({ partyId: p._id });
                                  toast.success("Party removed.");
                                } catch (err) {
                                  toast.error(
                                    err instanceof Error ? err.message : "Failed.",
                                  );
                                }
                              }}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Matter team restriction */}
              <Card className="rule-frame bg-card">
                <CardContent className="pt-6">
                  <h3 className="font-serif text-lg font-semibold">Matter team</h3>
                  <p className="mt-1 text-sm ink-faded">
                    Restricting the team limits this file to the members below
                    (owners, partners and administrators always retain access).
                  </p>
                  {caps?.capabilities.includes("matter.edit") &&
                  (acIsOwnerPartnerAdmin ?? false) ? (
                    <div className="mt-4 space-y-2">
                      {(members ?? [])
                        .filter(
                          (m) =>
                            m.status === "active" &&
                            m.orgRole !== "support_staff" &&
                            m.orgRole !== "accountant",
                        )
                        .map((m) => {
                          const uid = m.userId;
                          const checked = teamSel.includes(uid);
                          return (
                            <label
                              key={uid}
                              className="flex cursor-pointer items-center gap-2.5 text-sm"
                            >
                              <input
                                type="checkbox"
                                className="accent-[#B68A45]"
                                checked={checked}
                                onChange={() =>
                                  setTeamDraft(
                                    checked
                                      ? teamSel.filter((x) => x !== uid)
                                      : [...teamSel, uid],
                                  )
                                }
                              />
                              {m.name ?? m.email ?? "Member"}
                            </label>
                          );
                        })}
                      <div className="flex gap-2 pt-2">
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await setTeamFn({ matterId: matterId!, teamIds: teamSel });
                              toast.success("Matter team saved.");
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : "Failed.");
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Save team
                        </Button>
                        {matter.teamIds && matter.teamIds.length > 0 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              try {
                                await setTeamFn({ matterId: matterId!, teamIds: [] });
                                setTeamDraft([]);
                                toast.success("File opened to the whole organisation.");
                              } catch (err) {
                                toast.error(
                                  err instanceof Error ? err.message : "Failed.",
                                );
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            Open to organisation
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm ink-faded">
                      {matter.teamIds && matter.teamIds.length > 0
                        ? `Restricted to ${matter.teamIds.length} team member${matter.teamIds.length === 1 ? "" : "s"}.`
                        : "Open to all lawyers of the organisation."}
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card className="rule-frame h-fit bg-card">
              <CardContent className="space-y-4 pt-6">
                <h3 className="font-serif text-lg font-semibold">Add a party</h3>
                <div className="space-y-2">
                  <Label htmlFor="p-name">Name</Label>
                  <Input
                    id="p-name"
                    value={partyName}
                    onChange={(e) => setPartyName(e.target.value)}
                    placeholder="e.g. Ramesh Kumar"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="p-side">Side</Label>
                  <Select
                    value={partySide}
                    onValueChange={setPartySide}
                  >
                    <SelectTrigger id="p-side">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ours">On our side</SelectItem>
                      <SelectItem value="opposing">Opposing</SelectItem>
                      <SelectItem value="neutral">Neutral</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="p-role">Role (optional)</Label>
                  <Input
                    id="p-role"
                    value={partyRole}
                    onChange={(e) => setPartyRole(e.target.value)}
                    placeholder="petitioner, respondent, witness…"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="p-counsel">Counsel (optional)</Label>
                  <Input
                    id="p-counsel"
                    value={partyCounsel}
                    onChange={(e) => setPartyCounsel(e.target.value)}
                    placeholder="Their advocate on record"
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={busy || !partyName.trim()}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await addPartyFn({
                        matterId: matterId!,
                        name: partyName,
                        side: partySide as "ours" | "opposing" | "neutral",
                        role: partyRole || undefined,
                        counsel: partyCounsel || undefined,
                      });
                      toast.success("Party added.");
                      setPartyName("");
                      setPartyRole("");
                      setPartyCounsel("");
                      setPartySide("ours");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Failed.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Add party
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Evidence & issues */}
        <TabsContent value="issues" className="mt-6">
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-3">
              {(issues ?? []).length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-8 text-center text-sm ink-faded">
                    No issues framed yet. Note the questions of law and fact the
                    court must decide, and track the evidence for each.
                  </CardContent>
                </Card>
              ) : (
                (issues ?? []).map((iss) => (
                  <div key={iss._id} className="rule-frame bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{iss.title}</p>
                        {iss.detail && (
                          <p className="mt-1 text-sm ink-faded">{iss.detail}</p>
                        )}
                        {iss.evidence && iss.evidence.length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {iss.evidence.map((ev, i) => (
                              <li
                                key={`${ev.label}-${i}`}
                                className="type-label flex items-center gap-1.5 ink-faded"
                              >
                                <Paperclip className="size-3" /> {ev.label}
                                <span
                                  className={
                                    ev.supports
                                      ? "text-emerald-700"
                                      : "text-red-700"
                                  }
                                >
                                  · {ev.supports ? "supports" : "rebuts"}
                                </span>
                                {ev.documentId && (
                                  <DocumentLink documentId={ev.documentId} />
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {caps?.capabilities.includes("note.write") &&
                          (iss.evidence?.length ?? 0) < 8 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={async () => {
                                const label = window.prompt(
                                  "Evidence reference (e.g. Annexure A-4, bank statement)",
                                );
                                if (!label) return;
                                const supports = window.confirm(
                                  "Does this exhibit SUPPORT our case? (Cancel = it rebuts)",
                                );
                                try {
                                  await attachEvidenceFn({
                                    issueId: iss._id,
                                    label,
                                    supports,
                                  });
                                  toast.success("Evidence tagged.");
                                } catch (err) {
                                  toast.error(
                                    err instanceof Error ? err.message : "Failed.",
                                  );
                                }
                              }}
                            >
                              <Paperclip className="mr-1 size-3.5" /> Evidence
                            </Button>
                          )}
                        {caps?.capabilities.includes("note.write") && (
                          <Select
                            value={iss.status}
                            onValueChange={async (v) => {
                              try {
                                await setIssueStatusFn({
                                  issueId: iss._id,
                                  status: v as "open" | "argued" | "resolved",
                                });
                                toast.success("Issue updated.");
                              } catch (err) {
                                toast.error(
                                  err instanceof Error ? err.message : "Failed.",
                                );
                              }
                            }}
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="open">Open</SelectItem>
                              <SelectItem value="argued">Argued</SelectItem>
                              <SelectItem value="resolved">Resolved</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <Card className="rule-frame h-fit bg-card">
              <CardContent className="space-y-4 pt-6">
                <h3 className="font-serif text-lg font-semibold">Frame an issue</h3>
                <div className="space-y-2">
                  <Label htmlFor="i-title">Issue</Label>
                  <Input
                    id="i-title"
                    value={issueTitle}
                    onChange={(e) => setIssueTitle(e.target.value)}
                    placeholder="e.g. Whether the sale deed of 2019 is valid"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="i-detail">Notes (optional)</Label>
                  <Textarea
                    id="i-detail"
                    value={issueDetail}
                    onChange={(e) => setIssueDetail(e.target.value)}
                    placeholder="The question of law or fact, and the stance…"
                    className="min-h-[80px]"
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={busy || !issueTitle.trim()}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await addIssueFn({
                        matterId: matterId!,
                        title: issueTitle,
                        detail: issueDetail || undefined,
                      });
                      toast.success("Issue framed.");
                      setIssueTitle("");
                      setIssueDetail("");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Failed.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Frame issue
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Docket */}
        {/* §32 Phase 1 — conflicting-evidence review workspace */}
        <TabsContent value="review" className="mt-6">
          <div className="space-y-8">
            <ConflictReviewPanel matterId={matterId!} />
            <MatterImpactPanel
              matterId={matterId!}
              canEdit={canEditMatter}
              members={memberOptions}
            />
            <EvidenceBundlesPanel matterId={matterId!} />
            <AdverseAuthorityPanel matterId={matterId!} />
            <MatterHoldCard matterId={matterId!} canManage={canCloseMatter} />
          </div>
        </TabsContent>

        <TabsContent value="docket" className="mt-6">
          {(events ?? []).length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center text-sm ink-faded">
                The docket is empty.
              </CardContent>
            </Card>
          ) : (
            <ol>
              {(events ?? []).map((e, i) => (
                <li key={e._id} className="relative flex gap-4 pb-6">
                  {i < (events ?? []).length - 1 && (
                    <span className="absolute left-[5px] top-4 h-full w-px bg-border" />
                  )}
                  <span className="mt-1.5 size-[11px] shrink-0 rounded-full border border-primary/60 bg-background" />
                  <div className="min-w-0">
                    <p className="text-sm leading-snug">{e.detail}</p>
                    <p className="type-label mt-1 ink-faded">
                      {formatDateTimeIN(e.createdAt)} · {e.kind}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </TabsContent>

        {/* Audit log (owner/partner/administrator) */}
        <TabsContent value="audit" className="mt-6">
          {(auditLog ?? []).length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center text-sm ink-faded">
                No audit entries, or audit is not part of your role.
              </CardContent>
            </Card>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left">
                    <th className="px-4 py-2.5 font-medium">When</th>
                    <th className="px-4 py-2.5 font-medium">Action</th>
                    <th className="px-4 py-2.5 font-medium">Detail</th>
                    <th className="px-4 py-2.5 font-medium">By</th>
                  </tr>
                </thead>
                <tbody>
                  {(auditLog ?? []).map((a) => (
                    <tr key={a._id} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-4 py-2.5 ink-faded">
                        {formatDateTimeIN(a.createdAt)}
                      </td>
                      <td className="px-4 py-2.5">{a.action}</td>
                      <td className="px-4 py-2.5 ink-faded">{a.detail ?? "—"}</td>
                      <td className="px-4 py-2.5 ink-faded">{a.actorName ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* AI & OCR (section 26) */}
        <TabsContent value="ai" className="mt-6">
          {matterId && <AiStudio matterId={matterId} />}
        </TabsContent>
      </Tabs>
    </ChamberShell>
  );
}

/** Edit-dialog for the matter file — every administrative field. */
function EditMatterDialog({
  matterId,
  matter,
  open,
  onOpenChange,
}: {
  matterId: Id<"matters">;
  matter: Doc<"matters">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateMatter = useMutation(api.matters.update);
  const [title, setTitle] = useState(matter.title);
  const [description, setDescription] = useState(matter.description ?? "");
  const [practiceArea, setPracticeArea] = useState(matter.practiceArea);
  const [court, setCourt] = useState(matter.court ?? "");
  const [jurisdiction, setJurisdiction] = useState(matter.jurisdiction ?? "");
  const [caseNumber, setCaseNumber] = useState(matter.caseNumber ?? "");
  const [bench, setBench] = useState(matter.bench ?? "");
  const [opposingParty, setOpposingParty] = useState(matter.opposingParty ?? "");
  const [opposingCounsel, setOpposingCounsel] = useState(matter.opposingCounsel ?? "");
  const [priority, setPriority] = useState(matter.priority ?? "normal");
  const [billingArrangement, setBillingArrangement] = useState(
    matter.billingArrangement ?? "",
  );
  const [keyDates, setKeyDates] = useState<{ label: string; date: string }[]>(
    matter.keyDates ?? [],
  );
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) {
      toast.error("The matter needs a title.");
      return;
    }
    setBusy(true);
    try {
      await updateMatter({
        matterId,
        title,
        description: description || undefined,
        practiceArea,
        court: court || undefined,
        jurisdiction: jurisdiction || undefined,
        caseNumber: caseNumber || undefined,
        bench: bench || undefined,
        opposingParty: opposingParty || undefined,
        opposingCounsel: opposingCounsel || undefined,
        priority: priority as "normal" | "high" | "urgent",
        billingArrangement: billingArrangement || undefined,
        keyDates: keyDates.filter((kd) => kd.label.trim() && kd.date),
      });
      toast.success("Matter details saved.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <p className="type-label ink-faded">Matter file</p>
          <DialogTitle className="font-serif text-2xl">
            Edit details
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[62vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label htmlFor="em-title">Title</Label>
            <Input
              id="em-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="em-desc">Description</Label>
            <Textarea
              id="em-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-[90px]"
              placeholder="Nature of the dispute, relief sought, background…"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="em-area">Category</Label>
              <Input
                id="em-area"
                value={practiceArea}
                onChange={(e) => setPracticeArea(e.target.value)}
                placeholder="Civil, criminal, family…"
              />
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={priority}
                onValueChange={(v) =>
                  setPriority(v as "normal" | "high" | "urgent")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="em-court">Court</Label>
              <Input
                id="em-court"
                value={court}
                onChange={(e) => setCourt(e.target.value)}
                placeholder="e.g. High Court of Delhi"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="em-bench">Bench</Label>
              <Input
                id="em-bench"
                value={bench}
                onChange={(e) => setBench(e.target.value)}
                placeholder="e.g. Division Bench"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="em-case">Case number</Label>
              <Input
                id="em-case"
                value={caseNumber}
                onChange={(e) => setCaseNumber(e.target.value)}
                placeholder="e.g. W.P.(C) 4321/2026"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="em-jur">Jurisdiction</Label>
              <Input
                id="em-jur"
                value={jurisdiction}
                onChange={(e) => setJurisdiction(e.target.value)}
                placeholder="e.g. Original side, Delhi"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="em-opp">Opposing party</Label>
              <Input
                id="em-opp"
                value={opposingParty}
                onChange={(e) => setOpposingParty(e.target.value)}
                placeholder="Named opposite party"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="em-counsel">Opposing counsel</Label>
              <Input
                id="em-counsel"
                value={opposingCounsel}
                onChange={(e) => setOpposingCounsel(e.target.value)}
                placeholder="Their advocate on record"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="em-bill">Billing arrangement</Label>
              <Input
                id="em-bill"
                value={billingArrangement}
                onChange={(e) => setBillingArrangement(e.target.value)}
                placeholder="e.g. Fixed fee ₹50,000 per stage · Hourly ₹3,000/hr"
              />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Key dates</Label>
              <Button
                size="sm"
                variant="ghost"
                type="button"
                onClick={() =>
                  setKeyDates((prev) => [...prev, { label: "", date: "" }])
                }
              >
                <Plus className="mr-1 size-3.5" /> Add date
              </Button>
            </div>
            {keyDates.length === 0 ? (
              <p className="text-sm ink-faded">
                Limitation dates, filing cut-offs, next appearances…
              </p>
            ) : (
              <div className="space-y-2">
                {keyDates.map((kd, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={kd.label}
                      onChange={(e) =>
                        setKeyDates((prev) =>
                          prev.map((x, j) =>
                            j === i ? { ...x, label: e.target.value } : x,
                          ),
                        )
                      }
                      placeholder="Label — e.g. Limitation expires"
                    />
                    <Input
                      type="date"
                      className="w-40"
                      value={kd.date}
                      onChange={(e) =>
                        setKeyDates((prev) =>
                          prev.map((x, j) =>
                            j === i ? { ...x, date: e.target.value } : x,
                          ),
                        )
                      }
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Remove date"
                      type="button"
                      onClick={() =>
                        setKeyDates((prev) => prev.filter((_, j) => j !== i))
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !title.trim()}>
            Save details
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// Client document-request checklist (chamber side).
// ---------------------------------------------------------------------

const REQUEST_STATUS_META: Record<
  string,
  { label: string; cls: string; rank: number }
> = {
  requested: { label: "Requested", cls: "text-[#8a6a33]", rank: 0 },
  uploaded: { label: "Uploaded — to review", cls: "text-[#4f6b8f]", rank: 0 },
  under_review: { label: "Under review", cls: "text-[#4f6b8f]", rank: 0 },
  rejected: { label: "Rejected — resend needed", cls: "text-red-700", rank: 1 },
  accepted: { label: "Accepted", cls: "text-emerald-700", rank: 2 },
};

const REQUEST_NOW = Date.now();

type RequestRow = {
  _id: string;
  title: string;
  instructions: string | null;
  dueAt: number | null;
  status: string;
  currentStorageId: string | null;
  submissionCount: number;
  reviewNote: string | null;
  reviewedByName: string | null;
  acceptedDocumentId: string | null;
  lastReminderAt: number | null;
  requestedByName: string | null;
  comments: { body: string; at: number; fromClient: boolean; authorName: string }[];
};

function DocumentRequestPanel({ matterId }: { matterId: Id<"matters"> }) {
  const requests = useQuery(
    api.documentRequests.listForMatter,
    { matterId },
  ) as RequestRow[] | undefined;
  const caps = useQuery(api.workspace.myCapabilities);
  const canReview = caps?.capabilities.includes("task.manage") ?? false;

  return (
    <div className="mt-8">
      <DocumentRequestSection
        matterId={matterId}
        requests={requests ?? []}
        loading={requests === undefined}
        canReview={canReview}
      />
    </div>
  );
}

function DocumentRequestSection({
  matterId,
  requests,
  loading,
  canReview,
}: {
  matterId: Id<"matters">;
  requests: RequestRow[];
  loading: boolean;
  canReview: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section aria-label="Client document-request checklist">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-serif text-lg font-semibold">
          <ClipboardCheck className="size-4 text-[#B68A45]" aria-hidden="true" />
          Requested from the client
        </h3>
        {canReview && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Plus className="mr-1.5 size-4" /> Request a document
          </Button>
        )}
      </div>
      <p className="type-label mt-1 ink-faded">
        Client uploads stay here, separate from firm evidence, until a reviewer
        accepts them. Accepted versions are never silently replaced.
      </p>

      <div className="mt-3 space-y-2">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading checklist…</p>
        ) : requests.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-6 text-center text-sm ink-faded">
              Nothing requested from the client on this matter yet.
            </CardContent>
          </Card>
        ) : (
          requests.map((r) => (
            <DocumentRequestRow key={r._id} request={r} canReview={canReview} />
          ))
        )}
      </div>

      <NewRequestDialog matterId={matterId} open={open} onOpenChange={setOpen} />
    </section>
  );
}

function DocumentRequestRow({
  request: r,
  canReview,
}: {
  request: RequestRow;
  canReview: boolean;
}) {
  const startReview = useMutation(api.documentRequests.startReview);
  const accept = useMutation(api.documentRequests.accept);
  const reject = useMutation(api.documentRequests.reject);
  const reopen = useMutation(api.documentRequests.reopen);
  const remind = useMutation(api.documentRequests.markReminderSent);
  const addComment = useMutation(api.documentRequests.addComment);

  const [reviewing, setReviewing] = useState(false);
  const [note, setNote] = useState("");
  const [commentText, setCommentText] = useState("");
  const [showComments, setShowComments] = useState(false);

  const meta = REQUEST_STATUS_META[r.status] ?? {
    label: r.status,
    cls: "",
    rank: 3,
  };
  const overdue =
    (r.status === "requested" || r.status === "rejected") &&
    r.dueAt !== null &&
    r.dueAt < REQUEST_NOW;
  const awaiting = r.status === "uploaded" || r.status === "under_review";

  const run = (fn: () => Promise<unknown>, ok: string) =>
    fn()
      .then(() => toast.success(ok))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed."));

  return (
    <div className="rule-frame rounded-lg p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{r.title}</p>
          <p className="type-label mt-0.5 ink-faded">
            {r.dueAt !== null && <>Due {formatDateIN(r.dueAt)} · </>}
            {r.submissionCount} submission{r.submissionCount === 1 ? "" : "s"}
            {r.requestedByName && ` · requested by ${r.requestedByName}`}
          </p>
        </div>
        <div className="text-right">
          <p className={`type-label ${meta.cls}`}>{meta.label}</p>
          {overdue && <p className="type-label text-red-700">Overdue</p>}
          {r.reviewedByName && awaiting === false && r.status !== "requested" && (
            <p className="type-label ink-faded">
              by {r.reviewedByName}
            </p>
          )}
        </div>
      </div>

      {r.instructions && (
        <p className="mt-2 rounded border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {r.instructions}
        </p>
      )}
      {r.status === "rejected" && r.reviewNote && (
        <p className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          Rejection explained to the client: {r.reviewNote}
        </p>
      )}

      {/* Review actions */}
      {canReview && r.status === "uploaded" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {reviewing ? (
            <>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Note to the client (required to reject)…"
                className="min-w-56 flex-1 text-xs"
                aria-label="Review note"
              />
              <Button
                size="sm"
                onClick={() =>
                  run(
                    () => accept({ requestId: r._id as Id<"documentRequests">, note: note || undefined }),
                    "Accepted and filed on the matter.",
                  )
                }
              >
                Accept
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={!note.trim()}
                onClick={() =>
                  run(
                    () => reject({ requestId: r._id as Id<"documentRequests">, reason: note }),
                    "Rejected — explanation sent to the client.",
                  )
                }
              >
                Reject
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setReviewing(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={() => setReviewing(true)}>
                Review submission…
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  run(
                    () => startReview({ requestId: r._id as Id<"documentRequests"> }),
                    "Moved under review.",
                  )
                }
              >
                Mark under review
              </Button>
            </>
          )}
        </div>
      )}
      {canReview && r.status === "under_review" && (
        <p className="mt-2 type-label text-[#4f6b8f]">
          Use “Review submission…” once you have read the file — open it from
          the Documents list above.
        </p>
      )}
      {canReview && (r.status === "rejected" || r.status === "accepted") && (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2"
          onClick={() =>
            run(
              () => reopen({ requestId: r._id as Id<"documentRequests"> }),
              "Request re-opened for a new submission.",
            )
          }
        >
          Re-open request
        </Button>
      )}
      {canReview && (r.status === "requested" || r.status === "rejected") && (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2"
          disabled={
            r.lastReminderAt !== null &&
            REQUEST_NOW - r.lastReminderAt < 24 * 60 * 60 * 1000
          }
          onClick={() =>
            run(
              () => remind({ requestId: r._id as Id<"documentRequests"> }),
              "Reminder recorded (24h cooldown).",
            )
          }
        >
          <BellRing className="mr-1.5 size-3.5" /> Record reminder sent
        </Button>
      )}

      {/* Comments */}
      <div className="mt-3 border-t pt-2">
        <button
          type="button"
          className="type-label text-[#4f6b8f] underline-offset-2 hover:underline"
          onClick={() => setShowComments((s) => !s)}
        >
          {showComments ? "Hide" : "Comments"} ({r.comments.length})
        </button>
        {showComments && (
          <div className="mt-2 space-y-2">
            {r.comments.map((c, i) => (
              <div key={i} className="rounded border bg-background px-3 py-2">
                <p className="text-xs">{c.body}</p>
                <p className="type-label mt-1 ink-faded">
                  {c.fromClient ? "Client" : c.authorName} · {formatDateTimeIN(c.at)}
                </p>
              </div>
            ))}
            {canReview && (
              <div className="flex gap-2">
                <Input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Message the client about this request…"
                  className="h-8 text-xs"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!commentText.trim()}
                  onClick={() =>
                    run(
                      () =>
                        addComment({
                          requestId: r._id as Id<"documentRequests">,
                          body: commentText,
                        }),
                      "Comment sent.",
                    ).then(() => setCommentText(""))
                  }
                >
                  Send
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function NewRequestDialog({
  matterId,
  open,
  onOpenChange,
}: {
  matterId: Id<"matters">;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const request = useMutation(api.documentRequests.request);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) {
      toast.error("Name the document you need.");
      return;
    }
    setBusy(true);
    try {
      await request({
        matterId,
        title,
        instructions: instructions || undefined,
        dueDate: dueDate || undefined,
      });
      toast.success("Request added to the client's checklist.");
      onOpenChange(false);
      setTitle("");
      setInstructions("");
      setDueDate("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">Request a document</DialogTitle>
          <DialogDescription>
            The client sees this on their portal with your instructions and due
            date, and uploads securely against it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dr-title">Document</Label>
            <Input
              id="dr-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Certified copy of sale deed"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dr-instructions">Instructions</Label>
            <Textarea
              id="dr-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={3}
              placeholder="What exactly should the client send?"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dr-due">Due date</Label>
            <Input
              id="dr-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <Button className="w-full" onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
            Add to checklist
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
