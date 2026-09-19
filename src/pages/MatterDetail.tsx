import { ChamberShell } from "@/components/ChamberShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import type { Id } from "@/convex/_generated/dataModel";
import type { MatterStatus } from "@/convex/schema";
import {
  formatDateIN,
  formatDateTimeIN,
  formatINR,
  todayIN,
} from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  CalendarClock,
  CircleDashed,
  FileText,
  Gavel,
  Landmark,
  ListChecks,
  Paperclip,
  Plus,
  Receipt,
  ScrollText,
  StickyNote,
} from "lucide-react";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router";
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

export default function MatterDetail() {
  const { matterId: rawId } = useParams<{ matterId: string }>();
  const matterId = rawId as Id<"matters"> | undefined;

  const matter = useQuery(api.matters.get, matterId ? { matterId } : "skip");
  const notes = useQuery(api.matters.listNotes, matterId ? { matterId } : "skip");
  const documents = useQuery(api.matters.listDocuments, matterId ? { matterId } : "skip");
  const timeEntries = useQuery(api.matters.listTime, matterId ? { matterId } : "skip");
  const expenses = useQuery(api.matters.listExpenses, matterId ? { matterId } : "skip");
  const events = useQuery(api.matters.listEvents, matterId ? { matterId } : "skip");

  const updateStatus = useMutation(api.matters.updateStatus);
  const addHearing = useMutation(api.matters.addHearing);
  const addOrder = useMutation(api.matters.addOrder);
  const addTask = useMutation(api.matters.addTask);
  const addTime = useMutation(api.matters.addTime);
  const addExpense = useMutation(api.matters.addExpense);
  const addNote = useMutation(api.matters.addNote);
  const createInvoice = useMutation(api.billing.createFromMatter);
  const generateUploadUrl = useMutation(api.matters.generateDocumentUploadUrl);
  const attachDocument = useMutation(api.matters.attachDocument);

  const [hearingTitle, setHearingTitle] = useState("");
  const [hearingAt, setHearingAt] = useState("");
  const [hearingCourt, setHearingCourt] = useState("");
  const [orderTitle, setOrderTitle] = useState("");
  const [orderSummary, setOrderSummary] = useState("");
  const [orderDate, setOrderDate] = useState(todayIN());
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [timeDesc, setTimeDesc] = useState("");
  const [timeMinutes, setTimeMinutes] = useState("");
  const [timeRate, setTimeRate] = useState("");
  const [timeDate, setTimeDate] = useState(todayIN());
  const [expenseDesc, setExpenseDesc] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayIN());
  const [noteBody, setNoteBody] = useState("");
  const [docKind, setDocKind] = useState("document");
  const [docVisibility, setDocVisibility] = useState("internal");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

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
      await attachDocument({
        matterId,
        name: file.name,
        kind: docKind as "document" | "communication",
        visibility: docVisibility as "internal" | "shared_with_client",
        storageId: storageId as Id<"_storage"> | undefined,
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
            </p>
            <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight">
              {matter.title}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {matter.client?.name}
              </span>
              {matter.court ? ` · ${matter.court}` : ""}
              {matter.opposingParty ? ` · vs ${matter.opposingParty}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
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
      </div>

      <Tabs defaultValue="hearings" className="mt-8">
        <TabsList className="flex-wrap">
          <TabsTrigger value="hearings" className="gap-2">
            <Gavel className="size-4" /> Hearings
          </TabsTrigger>
          <TabsTrigger value="orders" className="gap-2">
            <ScrollText className="size-4" /> Orders
          </TabsTrigger>
          <TabsTrigger value="tasks" className="gap-2">
            <ListChecks className="size-4" /> Tasks
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
            <Receipt className="size-4" /> Invoices
          </TabsTrigger>
          <TabsTrigger value="notes" className="gap-2">
            <StickyNote className="size-4" /> Notes
          </TabsTrigger>
          <TabsTrigger value="docket" className="gap-2">
            <CalendarClock className="size-4" /> Docket
          </TabsTrigger>
        </TabsList>

        {/* Hearings */}
        <TabsContent value="hearings" className="mt-6">
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
              {(events ?? []).filter((e) => e.kind === "order").length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-8 text-center text-sm ink-faded">
                    No orders recorded yet.
                  </CardContent>
                </Card>
              ) : (
                (events ?? [])
                  .filter((e) => e.kind === "order")
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
                <div
                  key={d._id}
                  className="rule-frame flex items-center justify-between gap-4 bg-card p-4"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">{d.name}</p>
                    <p className="type-label mt-1 ink-faded">
                      {d.kind} · {formatDateTimeIN(d.createdAt)}
                    </p>
                  </div>
                  {d.storageId && <DocumentLink documentId={d._id} />}
                </div>
              ))
            )}
          </div>
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
                        ratePerHour: parseFloat(timeRate),
                        date: timeDate,
                      });
                      toast.success("Time recorded.");
                      setTimeDesc("");
                      setTimeMinutes("");
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
                      await addExpense({
                        matterId: matterId!,
                        description: expenseDesc,
                        amount: parseFloat(expenseAmount),
                        date: expenseDate,
                      });
                      toast.success("Expense recorded.");
                      setExpenseDesc("");
                      setExpenseAmount("");
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
                  await createInvoice({ matterId: matterId! });
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
        </TabsContent>

        {/* Notes */}
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
                    <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                    <p className="type-label mt-2 ink-faded">
                      {formatDateTimeIN(n.createdAt)}
                    </p>
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

        {/* Docket */}
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
      </Tabs>
    </ChamberShell>
  );
}
