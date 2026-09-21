import { ChamberShell } from "@/components/ChamberShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDateIN, formatDateTimeIN } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import {
  CalendarClock,
  ClipboardList,
  FileUp,
  ListChecks,
  Loader2,
  MessageSquare,
  Plus,
} from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

// ---------------------------------------------------------------------
// Tasks, deadlines and matter playbooks — the chamber's work desk.
// ---------------------------------------------------------------------

// Captured once at module load; overdue/reminder markers refresh on reload.
const NOW = Date.now();

const TASK_KIND_LABELS: Record<string, string> = {
  general: "General",
  filing: "Filing",
  service: "Service",
  delivery: "Delivery",
  collection: "Collection",
};

const DEADLINE_CATEGORY_LABELS: Record<string, string> = {
  limitation: "Limitation",
  filing: "Filing",
  compliance: "Compliance",
  court_order: "Court order",
  custom: "Custom",
};

type DeskTask = {
  _id: string;
  title: string;
  kind: string;
  priority: string;
  status: string;
  dueAt: number | null;
  assigneeId: string | null;
  assigneeName: string | null;
  createdByName: string | null;
  matterId: string | null;
  matterReference: string | null;
  comments: { body: string; at: number; authorName: string }[];
  attachments: { name: string; storageId: string; at: number }[];
  completionNote: string | null;
  completedAt: number | null;
  automationRunId?: string | null;
  automationReviewState?: string | null;
};

type DeadlineRow = {
  _id: string;
  title: string;
  category: string;
  dueAt: number;
  status: string;
  responsibleName: string | null;
  matterId?: string | null;
  matterReference: string | null;
  reminderAt?: number | null;
  history?: { at: number; byId: string; text: string }[];
  completionNote?: string | null;
};

type PlaybookRow = {
  _id: string;
  name: string;
  matterType: string;
  description: string | null;
  currentVersion: number;
  timesApplied: number;
};

export default function Tasks() {
  const [view, setView] = useState("mine");
  const [includeFirmWide, setIncludeFirmWide] = useState(true);
  const [tab, setTab] = useState("tasks");

  const caps = useQuery(api.workspace.myCapabilities);
  const members = useQuery(api.workspace.team);
  const tasks = useQuery(api.tasks.desk, { view: view as "mine", includeFirmWide });
  const deadlines = useQuery(api.tasks.deadlineList, {
    status: "open" as const,
  }) as DeadlineRow[] | undefined;
  const completedDeadlines = useQuery(api.tasks.deadlineList, {
    status: "completed" as const,
  }) as DeadlineRow[] | undefined;
  const playbooks = useQuery(api.tasks.playbookList) as PlaybookRow[] | undefined;

  const canManage = caps?.capabilities.includes("task.manage") ?? false;

  return (
    <ChamberShell
      title="Tasks & deadlines"
      subtitle="The chamber's work desk"
    >
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="tasks">
            <ClipboardList className="mr-1.5 size-4" /> Tasks
          </TabsTrigger>
          <TabsTrigger value="deadlines">
            <CalendarClock className="mr-1.5 size-4" /> Deadlines
          </TabsTrigger>
          <TabsTrigger value="playbooks">
            <ListChecks className="mr-1.5 size-4" /> Playbooks
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="mt-6">
          <TaskDesk
            tasks={tasks}
            members={members}
            canManage={canManage}
            view={view}
            setView={setView}
            includeFirmWide={includeFirmWide}
            setIncludeFirmWide={setIncludeFirmWide}
          />
        </TabsContent>

        <TabsContent value="deadlines" className="mt-6">
          <DeadlineRegister
            deadlines={deadlines}
            completed={completedDeadlines}
            members={members}
            canManage={canManage}
          />
        </TabsContent>

        <TabsContent value="playbooks" className="mt-6">
          <PlaybookLibrary playbooks={playbooks} canManage={canManage} />
        </TabsContent>
      </Tabs>
    </ChamberShell>
  );
}

// ---------------------------------------------------------------------
// Task desk
// ---------------------------------------------------------------------

function TaskDesk({
  tasks,
  members,
  canManage,
  view,
  setView,
  includeFirmWide,
  setIncludeFirmWide,
}: {
  tasks: DeskTask[] | undefined;
  members: { userId: string; name?: string | null; email?: string | null; status: string; orgRole: string }[] | undefined;
  canManage: boolean;
  view: string;
  setView: (v: string) => void;
  includeFirmWide: boolean;
  setIncludeFirmWide: (v: boolean) => void;
}) {
  const createTask = useMutation(api.tasks.createTask);
  const setStatus = useMutation(api.tasks.setDeskTaskStatus);

  const [open, setOpen] = useState(false);
  const [evidenceFor, setEvidenceFor] = useState<DeskTask | null>(null);

  const activeMembers = (members ?? []).filter(
    (m) => m.status === "active" && m.orgRole !== "accountant",
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {[
            ["mine", "My tasks"],
            ["today", "Today"],
            ["upcoming", "Upcoming"],
            ["overdue", "Overdue"],
            ["completed", "Completed"],
            ["all", "All"],
          ].map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                view === v
                  ? "border-[#B68A45] bg-[#B68A45]/10 font-medium text-[#8a6d3b]"
                  : "border-border text-muted-foreground hover:bg-muted/60"
              }`}
            >
              {label}
            </button>
          ))}
          <label className="ml-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox
              checked={includeFirmWide}
              onCheckedChange={(v) => setIncludeFirmWide(v === true)}
            />
            Include firm-wide
          </label>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-1.5 size-4" /> New task
          </Button>
        )}
      </div>

      {tasks === undefined ? (
        <p className="text-sm text-muted-foreground">Loading tasks…</p>
      ) : tasks.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm ink-faded">
            Nothing here — this view is clear.
          </CardContent>
        </Card>
      ) : (
        <div className="rule-frame overflow-x-auto rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left">
                <th className="px-4 py-2.5 font-medium">Task</th>
                <th className="px-4 py-2.5 font-medium">Kind</th>
                <th className="px-4 py-2.5 font-medium">Due</th>
                <th className="px-4 py-2.5 font-medium">Assignee</th>
                <th className="px-4 py-2.5 font-medium">Matter</th>
                <th className="px-4 py-2.5 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tasks.map((t) => (
                <TaskRow
                  key={t._id}
                  task={t}
                  members={activeMembers}
                  canManage={canManage}
                  onEvidence={() => setEvidenceFor(t)}
                  onComplete={(note) =>
                    setStatus({ taskId: t._id as Id<"tasks">, status: "done", completionNote: note || undefined })
                      .then(() => toast.success("Task completed."))
                      .catch((e) =>
                        toast.error(e instanceof Error ? e.message : "Failed."),
                      )
                  }
                  onReopen={() =>
                    setStatus({ taskId: t._id as Id<"tasks">, status: "pending" })
                      .then(() => toast.success("Task reopened."))
                      .catch((e) =>
                        toast.error(e instanceof Error ? e.message : "Failed."),
                      )
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewTaskDialog
        open={open}
        onOpenChange={setOpen}
        members={activeMembers}
        createTask={createTask}
      />
      <EvidenceDialog task={evidenceFor} onOpenChange={() => setEvidenceFor(null)} />
    </div>
  );
}

function TaskRow({
  task,
  members,
  canManage,
  onComplete,
  onReopen,
  onEvidence,
}: {
  task: DeskTask;
  members: { userId: string; name?: string | null; email?: string | null }[];
  canManage: boolean;
  onComplete: (note?: string) => void;
  onReopen: () => void;
  onEvidence: () => void;
}) {
  const reassign = useMutation(api.tasks.editTask);
  const addComment = useMutation(api.tasks.addDeskTaskComment);
  const [showDetail, setShowDetail] = useState(false);
  const [comment, setComment] = useState("");

  const overdue = task.status !== "done" && task.dueAt !== null && task.dueAt < NOW;

  return (
    <>
      <tr className={task.status === "done" ? "opacity-60" : ""}>
        <td className="max-w-xs px-4 py-3">
          <p className="truncate font-medium">{task.title}</p>
          {task.priority !== "normal" && (
            <span
              className={`type-label ${task.priority === "urgent" ? "text-red-700" : "text-[#8a6d3b]"}`}
            >
              {task.priority === "urgent" ? "Urgent" : "High priority"}
            </span>
          )}
          {task.automationRunId && (
            <span
              className={`type-label mt-0.5 block ${
                task.automationReviewState === "pending" || !task.automationReviewState
                  ? "text-[#8a6d3b]"
                  : "ink-faded"
              }`}
            >
              {task.automationReviewState === "confirmed"
                ? "Automated · confirmed"
                : task.automationReviewState === "rejected"
                  ? "Automated · rejected"
                  : "Automated · needs review"}
            </span>
          )}
        </td>
        <td className="px-4 py-3">
          <Badge variant="outline" className="font-normal">
            {TASK_KIND_LABELS[task.kind] ?? task.kind}
          </Badge>
        </td>
        <td className="whitespace-nowrap px-4 py-3">
          {task.dueAt ? formatDateIN(task.dueAt) : "—"}
          {overdue && (
            <span className="type-label ml-1 text-red-700">overdue</span>
          )}
        </td>
        <td className="px-4 py-3">
          {canManage && task.status !== "done" ? (
            <Select
              value={task.assigneeId ?? "none"}
              onValueChange={(v) =>
                reassign({
                  taskId: task._id as Id<"tasks">,
                  assigneeId: v === "none" ? undefined : (v as Id<"users">),
                })
                  .then(() => toast.success("Assignee updated."))
                  .catch((e) =>
                    toast.error(e instanceof Error ? e.message : "Failed."),
                  )
              }
            >
              <SelectTrigger className="h-7 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {m.name ?? m.email ?? "Member"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-muted-foreground">
              {task.assigneeName ?? "Unassigned"}
            </span>
          )}
        </td>
        <td className="px-4 py-3">
          {task.matterId ? (
            <Link
              className="type-label text-[#4f6b8f] underline-offset-2 hover:underline"
              to={`/matters/${task.matterId}?tab=tasks`}
            >
              {task.matterReference ?? "Open"}
            </Link>
          ) : (
            <span className="type-label ink-faded">Firm-wide</span>
          )}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-right">
          {task.status === "done" ? (
            <Button variant="ghost" size="sm" onClick={onReopen}>
              Reopen
            </Button>
          ) : task.kind === "general" ? (
            <Button variant="outline" size="sm" onClick={() => onComplete()}>
              Complete
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={onEvidence}>
              Complete…
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDetail((s) => !s)}
          >
            {showDetail ? "Hide" : "Detail"}
          </Button>
        </td>
      </tr>
      {showDetail && (
        <tr>
          <td colSpan={6} className="bg-muted/30 px-6 py-4">
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-x-8 gap-y-1 text-xs text-muted-foreground">
                <span>Created by {task.createdByName ?? "—"}</span>
                {task.completedAt && (
                  <span>
                    Completed {formatDateTimeIN(task.completedAt)}
                    {task.completionNote ? ` — ${task.completionNote}` : ""}
                  </span>
                )}
              </div>
              {task.attachments.length > 0 && (
                <div className="space-y-1">
                  <p className="type-label">Evidence files</p>
                  {task.attachments.map((a) => (
                    <TaskFileLink
                      key={a.storageId}
                      taskId={task._id}
                      storageId={a.storageId}
                      name={a.name}
                    />
                  ))}
                </div>
              )}
              <div className="space-y-2">
                <p className="type-label flex items-center gap-1.5">
                  <MessageSquare className="size-3.5" /> Comments
                </p>
                {task.comments.length === 0 && (
                  <p className="text-xs ink-faded">No comments yet.</p>
                )}
                {task.comments.map((c, i) => (
                  <div key={i} className="rounded border bg-background px-3 py-2">
                    <p>{c.body}</p>
                    <p className="type-label mt-1 ink-faded">
                      {c.authorName} · {formatDateTimeIN(c.at)}
                    </p>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Add a comment…"
                    className="h-8 text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!comment.trim()}
                    onClick={() =>
                      addComment({ taskId: task._id as Id<"tasks">, body: comment })
                        .then(() => setComment(""))
                        .catch((e) =>
                          toast.error(e instanceof Error ? e.message : "Failed."),
                        )
                    }
                  >
                    Post
                  </Button>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function TaskFileLink({
  taskId,
  storageId,
  name,
}: {
  taskId: string;
  storageId: string;
  name: string;
}) {
  const url = useQuery(api.tasks.getTaskFileUrl, {
    taskId: taskId as Id<"tasks">,
    storageId: storageId as Id<"_storage">,
  });
  if (!url) {
    return (
      <span className="type-label ink-faded">
        {url === null ? "Unavailable" : "…"} · {name}
      </span>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="type-label text-[#4f6b8f] underline-offset-2 hover:underline"
    >
      {name}
    </a>
  );
}

function NewTaskDialog({
  open,
  onOpenChange,
  members,
  createTask,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  members: { userId: string; name?: string | null; email?: string | null }[];
  createTask: ReturnType<typeof useMutation<typeof api.tasks.createTask>>;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("general");
  const [priority, setPriority] = useState("normal");
  const [dueDate, setDueDate] = useState("");
  const [assigneeId, setAssigneeId] = useState("me");
  const [matterId, setMatterId] = useState("none");
  const [busy, setBusy] = useState(false);

  const visibleMatters = useQuery(api.matters.list) as
    | { _id: string; reference: string; title: string }[]
    | undefined;

  const submit = async () => {
    if (!title.trim()) {
      toast.error("Give the task a title.");
      return;
    }
    setBusy(true);
    try {
      await createTask({
        title,
        kind: kind as "general",
        priority: priority as "normal",
        dueDate: dueDate || undefined,
        assigneeId:
          assigneeId === "me"
            ? undefined
            : assigneeId === "none"
              ? undefined
              : (assigneeId as Id<"users">),
        matterId: matterId === "none" ? undefined : (matterId as Id<"matters">),
      });
      toast.success("Task created.");
      onOpenChange(false);
      setTitle("");
      setDueDate("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the task.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">New task</DialogTitle>
          <DialogDescription>
            Filing, service, delivery and collection tasks ask for completion
            evidence when they are completed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="t-title">Title</Label>
            <Input
              id="t-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. File vakalatnama at district court"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Kind</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TASK_KIND_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
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
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="t-due">Due date</Label>
              <Input
                id="t-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Assignee</Label>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="me">Me</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.name ?? m.email ?? "Member"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Link to a matter (optional)</Label>
            <Select value={matterId} onValueChange={setMatterId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Firm-wide (no matter)</SelectItem>
                {(visibleMatters ?? [])
                  .filter((m) => m.reference)
                  .map((m) => (
                    <SelectItem key={m._id} value={m._id}>
                      {m.reference} — {m.title}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full" onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
            Create task
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Completion dialog for filing/service/delivery/collection tasks. */
function EvidenceDialog({
  task,
  onOpenChange,
}: {
  task: DeskTask | null;
  onOpenChange: () => void;
}) {
  const setStatus = useMutation(api.tasks.setDeskTaskStatus);
  const generateUploadUrl = useMutation(api.tasks.generateTaskUploadUrl);
  const attach = useMutation(api.tasks.attachToTask);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const KindWord =
    task?.kind != null
      ? TASK_KIND_LABELS[task.kind] ?? task.kind
      : "task";

  const submit = async () => {
    if (!task) return;
    setBusy(true);
    try {
      await setStatus({
        taskId: task._id as Id<"tasks">,
        status: "done",
        completionNote: note || undefined,
      });
      toast.success("Task completed with evidence recorded.");
      onOpenChange();
      setNote("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    if (!task) return;
    setBusy(true);
    try {
      const url = await generateUploadUrl({});
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await attach({ taskId: task._id as Id<"tasks">, name: file.name, storageId });
      toast.success("Evidence file attached.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={task !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">Complete {KindWord} task</DialogTitle>
          <DialogDescription>
            Record how this {KindWord.toLowerCase()} work was finished — a note,
            proof file(s), or both. The record stays on the task.
          </DialogDescription>
        </DialogHeader>
        {task && (
          <div className="space-y-4">
            <p className="text-sm font-medium">{task.title}</p>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={`e.g. Served on opposing counsel by speed post — receipt enclosed.`}
              rows={3}
            />
            <div>
              <input
                ref={fileInput}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                  e.target.value = "";
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInput.current?.click()}
                disabled={busy}
              >
                <FileUp className="mr-1.5 size-4" /> Attach proof file
              </Button>
              {task.attachments.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {task.attachments.map((a) => (
                    <li key={a.storageId}>✓ {a.name}</li>
                  ))}
                </ul>
              )}
            </div>
            <Button className="w-full" onClick={submit} disabled={busy}>
              {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
              Mark completed
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------

function DeadlineRegister({
  deadlines,
  completed,
  members,
  canManage,
}: {
  deadlines: DeadlineRow[] | undefined;
  completed: DeadlineRow[] | undefined;
  members: { userId: string; name?: string | null; email?: string | null; status: string }[] | undefined;
  canManage: boolean;
}) {
  const createDeadline = useMutation(api.tasks.createDeadline);
  const completeDeadline = useMutation(api.tasks.completeDeadline);
  const reopenDeadline = useMutation(api.tasks.reopenDeadline);
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState<DeadlineRow | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);

  const activeMembers = (members ?? []).filter((m) => m.status === "active");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Limitation, filing, compliance and court-order deadlines. Every date is
          entered and confirmed by a responsible person — the system never
          computes limitation periods.
        </p>
        {canManage && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-1.5 size-4" /> New deadline
          </Button>
        )}
      </div>

      {deadlines === undefined ? (
        <p className="text-sm text-muted-foreground">Loading deadlines…</p>
      ) : deadlines.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm ink-faded">
            No open deadlines recorded.
          </CardContent>
        </Card>
      ) : (
        <div className="rule-frame overflow-x-auto rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left">
                <th className="px-4 py-2.5 font-medium">Deadline</th>
                <th className="px-4 py-2.5 font-medium">Category</th>
                <th className="px-4 py-2.5 font-medium">Due</th>
                <th className="px-4 py-2.5 font-medium">Responsible</th>
                <th className="px-4 py-2.5 font-medium">Matter</th>
                <th className="px-4 py-2.5 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {deadlines.map((d) => {
                const overdue = d.dueAt < NOW;
                const reminderDue =
                  d.reminderAt != null &&
                  d.reminderAt <= NOW &&
                  !overdue;
                return (
                  <tr key={d._id}>
                    <td className="max-w-xs px-4 py-3">
                      <p className="truncate font-medium">{d.title}</p>
                      {reminderDue && (
                        <span className="type-label text-[#8a6d3b]">
                          reminder day
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="font-normal">
                        {DEADLINE_CATEGORY_LABELS[d.category] ?? d.category}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {formatDateIN(d.dueAt)}
                      {overdue && (
                        <span className="type-label ml-1 text-red-700">
                          passed
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {d.responsibleName ?? "Unassigned"}
                    </td>
                    <td className="px-4 py-3">
                      {d.matterId ? (
                        <Link
                          className="type-label text-[#4f6b8f] underline-offset-2 hover:underline"
                          to={`/matters/${d.matterId}?tab=tasks`}
                        >
                          {d.matterReference ?? "Open"}
                        </Link>
                      ) : (
                        <span className="type-label ink-faded">Firm-wide</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowHistory(d)}
                      >
                        History
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          completeDeadline({ deadlineId: d._id as Id<"deadlines"> })
                            .then(() => toast.success("Deadline completed."))
                            .catch((e) =>
                              toast.error(
                                e instanceof Error ? e.message : "Failed.",
                              ),
                            )
                        }
                      >
                        Complete
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Completed deadlines */}
      <div>
        <button
          type="button"
          className="type-label text-[#4f6b8f] underline-offset-2 hover:underline"
          onClick={() => setShowCompleted((s) => !s)}
        >
          {showCompleted ? "Hide" : "Show"} completed deadlines ({completed?.length ?? 0})
        </button>
        {showCompleted && (
          <div className="rule-frame mt-2 overflow-x-auto rounded-lg">
            <table className="w-full text-sm">
              <tbody className="divide-y">
                {(completed ?? []).map((d) => (
                  <tr key={d._id} className="opacity-70">
                    <td className="px-4 py-2.5 font-medium">{d.title}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {DEADLINE_CATEGORY_LABELS[d.category] ?? d.category}
                    </td>
                    <td className="px-4 py-2.5">{formatDateIN(d.dueAt)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            reopenDeadline({
                              deadlineId: d._id as Id<"deadlines">,
                            })
                              .then(() => toast.success("Deadline reopened."))
                              .catch((e) =>
                                toast.error(
                                  e instanceof Error ? e.message : "Failed.",
                                ),
                              )
                          }
                        >
                          Reopen
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {(completed ?? []).length === 0 && (
                  <tr>
                    <td className="px-4 py-3 text-sm ink-faded" colSpan={4}>
                      Nothing completed yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <NewDeadlineDialog
        open={open}
        onOpenChange={setOpen}
        members={activeMembers}
        createDeadline={createDeadline}
      />

      <Dialog
        open={showHistory !== null}
        onOpenChange={() => setShowHistory(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">Deadline history</DialogTitle>
            <DialogDescription>
              Every change to this deadline is recorded — who and when.
            </DialogDescription>
          </DialogHeader>
          {showHistory && (
            <ol className="space-y-2 text-sm">
              {(showHistory.history ?? [])
                .slice()
                .reverse()
                .map((h, i) => (
                  <li key={i} className="rounded border px-3 py-2">
                    <p>{h.text}</p>
                    <p className="type-label mt-1 ink-faded">
                      {formatDateTimeIN(h.at)}
                    </p>
                  </li>
                ))}
              {(showHistory.history ?? []).length === 0 && (
                <li className="text-sm ink-faded">No changes recorded.</li>
              )}
            </ol>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NewDeadlineDialog({
  open,
  onOpenChange,
  members,
  createDeadline,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  members: { userId: string; name?: string | null; email?: string | null }[];
  createDeadline: ReturnType<typeof useMutation<typeof api.tasks.createDeadline>>;
}) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("filing");
  const [dueDate, setDueDate] = useState("");
  const [responsibleId, setResponsibleId] = useState("me");
  const [reminderDays, setReminderDays] = useState("1");
  const [matterId, setMatterId] = useState("none");
  const [busy, setBusy] = useState(false);

  const visibleMatters = useQuery(api.matters.list) as
    | { _id: string; reference: string; title: string }[]
    | undefined;

  const submit = async () => {
    if (!title.trim() || !dueDate) {
      toast.error("A deadline needs a title and a due date.");
      return;
    }
    setBusy(true);
    try {
      await createDeadline({
        title,
        category: category as "filing",
        dueDate,
        responsibleId:
          responsibleId === "me" ? undefined : (responsibleId as Id<"users">),
        reminderDaysBefore: Number(reminderDays) || undefined,
        matterId: matterId === "none" ? undefined : (matterId as Id<"matters">),
      });
      toast.success("Deadline recorded.");
      onOpenChange(false);
      setTitle("");
      setDueDate("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the deadline.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">New deadline</DialogTitle>
          <DialogDescription>
            Enter the date yourself — Advokate never calculates limitation
            periods or other legally significant dates.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="d-title">Title</Label>
            <Input
              id="d-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Written statement — limitation date"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DEADLINE_CATEGORY_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="d-due">Due date</Label>
              <Input
                id="d-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Responsible</Label>
              <Select value={responsibleId} onValueChange={setResponsibleId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="me">Me</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.name ?? m.email ?? "Member"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="d-reminder">Reminder (days before)</Label>
              <Input
                id="d-reminder"
                type="number"
                min={0}
                value={reminderDays}
                onChange={(e) => setReminderDays(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Link to a matter (optional)</Label>
            <Select value={matterId} onValueChange={setMatterId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Firm-wide (no matter)</SelectItem>
                {(visibleMatters ?? [])
                  .filter((m) => m.reference)
                  .map((m) => (
                    <SelectItem key={m._id} value={m._id}>
                      {m.reference} — {m.title}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full" onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
            Record deadline
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// Playbooks
// ---------------------------------------------------------------------

type Stage = {
  name: string;
  tasks: { title: string; kind: string; daysFromStart?: number }[];
  requiredDocuments: string[];
};

type PlaybookDetail = {
  _id: string;
  name: string;
  matterType: string;
  description: string | null;
  currentVersion: number;
  stages: Stage[];
  versions: { version: number; createdAt: number; stageCount: number; taskCount: number }[];
};

function PlaybookLibrary({
  playbooks,
  canManage,
}: {
  playbooks: PlaybookRow[] | undefined;
  canManage: boolean;
}) {
  const [editing, setEditing] = useState<PlaybookRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [applying, setApplying] = useState<PlaybookRow | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Editable templates by matter type — stages, required documents,
          standard tasks and dependencies. Applying a playbook copies its tasks
          to a matter; dates always need a lawyer's confirmation.
        </p>
        {canManage && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1.5 size-4" /> New playbook
          </Button>
        )}
      </div>

      {playbooks === undefined ? (
        <p className="text-sm text-muted-foreground">Loading playbooks…</p>
      ) : playbooks.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm ink-faded">
            No playbooks yet. Create a template for a matter type you handle
            often — e.g. "Summary suit filing".
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {playbooks.map((p) => (
            <Card key={p._id} className="rule-frame">
              <CardContent className="space-y-2 pt-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-serif text-lg font-semibold">{p.name}</h3>
                    <p className="type-label ink-faded">
                      {p.matterType} · v{p.currentVersion} · applied{" "}
                      {p.timesApplied} time{p.timesApplied === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Badge variant="outline" className="font-normal">
                    Template
                  </Badge>
                </div>
                {p.description && (
                  <p className="text-sm text-muted-foreground">{p.description}</p>
                )}
                <div className="flex gap-2 pt-1">
                  {canManage && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(p)}
                      >
                        Edit
                      </Button>
                      <Button size="sm" onClick={() => setApplying(p)}>
                        Apply to matter…
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <PlaybookEditor
        playbook={editing}
        open={editing !== null || creating}
        onOpenChange={(v) => {
          if (!v) {
            setEditing(null);
            setCreating(false);
          }
        }}
      />
      <ApplyDialog playbook={applying} onOpenChange={() => setApplying(null)} />
    </div>
  );
}

function PlaybookEditor({
  playbook,
  open,
  onOpenChange,
}: {
  playbook: PlaybookRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const detail = useQuery(
    api.tasks.playbookDetail,
    playbook ? { playbookId: playbook._id as Id<"playbooks"> } : "skip",
  ) as PlaybookDetail | null | undefined;
  const createPlaybook = useMutation(api.tasks.createPlaybook);
  const updatePlaybook = useMutation(api.tasks.updatePlaybook);

  const [name, setName] = useState("");
  const [matterType, setMatterType] = useState("");
  const [description, setDescription] = useState("");
  const [stages, setStages] = useState<Stage[]>([
    { name: "Drafting", tasks: [], requiredDocuments: [] },
  ]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Load the template into the form once when editing starts.
  if (open && playbook && loadedFor !== playbook._id && detail) {
    setName(detail.name);
    setMatterType(detail.matterType);
    setDescription(detail.description ?? "");
    setStages(
      detail.stages.length > 0
        ? detail.stages
        : [{ name: "Drafting", tasks: [], requiredDocuments: [] }],
    );
    setLoadedFor(playbook._id);
  }
  if (!open && loadedFor !== null) {
    setLoadedFor(null);
  }

  const submit = async () => {
    setBusy(true);
    try {
      const payload = {
        name: name || playbook?.name || "Untitled playbook",
        matterType: matterType || playbook?.matterType || "General",
        description: description || undefined,
        stages: stages.map((s) => ({
          name: s.name,
          requiredDocuments: s.requiredDocuments.filter(Boolean),
          tasks: s.tasks.map((t) => ({
            title: t.title,
            kind: t.kind as "general",
            daysFromStart: t.daysFromStart,
          })),
        })),
      };
      if (playbook) {
        await updatePlaybook({ playbookId: playbook._id as Id<"playbooks">, ...payload });
        toast.success("New version saved — history preserved.");
      } else {
        await createPlaybook(payload);
        toast.success("Playbook created.");
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif">
            {playbook ? `Edit playbook — next version (v${(playbook.currentVersion ?? 0) + 1})` : "New playbook"}
          </DialogTitle>
          <DialogDescription>
            Saving an edit creates a new version; earlier versions stay in the
            history.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {playbook && detail && (
            <p className="type-label ink-faded">
              {detail.versions.length} version
              {detail.versions.length === 1 ? "" : "s"} recorded
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Matter type</Label>
              <Input
                value={matterType}
                onChange={(e) => setMatterType(e.target.value)}
                placeholder="e.g. Civil suit, bail matter"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Description (optional)</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {stages.map((s, si) => (
            <div key={si} className="space-y-3 rounded-md border p-3">
              <div className="flex items-center gap-2">
                <span className="type-label ink-faded">Stage {si + 1}</span>
                <Input
                  value={s.name}
                  onChange={(e) =>
                    setStages((prev) =>
                      prev.map((x, i) =>
                        i === si ? { ...x, name: e.target.value } : x,
                      ),
                    )
                  }
                  className="h-8"
                  placeholder="Stage name"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  aria-label="Remove stage"
                  onClick={() =>
                    setStages((prev) => prev.filter((_, i) => i !== si))
                  }
                >
                  ×
                </Button>
              </div>
              {s.tasks.map((t, ti) => (
                <div key={ti} className="flex items-center gap-2">
                  <Input
                    value={t.title}
                    onChange={(e) =>
                      setStages((prev) =>
                        prev.map((x, i) =>
                          i === si
                            ? {
                                ...x,
                                tasks: x.tasks.map((y, j) =>
                                  j === ti ? { ...y, title: e.target.value } : y,
                                ),
                              }
                            : x,
                        ),
                      )
                    }
                    className="h-8"
                    placeholder="Task"
                  />
                  <Select
                    value={t.kind}
                    onValueChange={(v) =>
                      setStages((prev) =>
                        prev.map((x, i) =>
                          i === si
                            ? {
                                ...x,
                                tasks: x.tasks.map((y, j) =>
                                  j === ti ? { ...y, kind: v } : y,
                                ),
                              }
                            : x,
                        ),
                      )
                    }
                  >
                    <SelectTrigger className="h-8 w-28 shrink-0 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(TASK_KIND_LABELS).map(([v, l]) => (
                        <SelectItem key={v} value={v}>
                          {l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    value={t.daysFromStart ?? ""}
                    onChange={(e) =>
                      setStages((prev) =>
                        prev.map((x, i) =>
                          i === si
                            ? {
                                ...x,
                                tasks: x.tasks.map((y, j) =>
                                  j === ti
                                    ? {
                                        ...y,
                                        daysFromStart: e.target.value
                                          ? Number(e.target.value)
                                          : undefined,
                                      }
                                    : y,
                                ),
                              }
                            : x,
                        ),
                      )
                    }
                    className="h-8 w-20 shrink-0"
                    placeholder="Day"
                    title="Days after the playbook start date"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    aria-label="Remove task"
                    onClick={() =>
                      setStages((prev) =>
                        prev.map((x, i) =>
                          i === si
                            ? { ...x, tasks: x.tasks.filter((_, j) => j !== ti) }
                            : x,
                        ),
                      )
                    }
                  >
                    ×
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setStages((prev) =>
                    prev.map((x, i) =>
                      i === si
                        ? {
                            ...x,
                            tasks: [
                              ...x.tasks,
                              { title: "", kind: "general", daysFromStart: undefined },
                            ],
                          }
                        : x,
                    ),
                  )
                }
              >
                <Plus className="mr-1 size-3.5" /> Add task
              </Button>
              <div className="space-y-1">
                <Label className="text-xs">Required documents (comma separated)</Label>
                <Input
                  value={s.requiredDocuments.join(", ")}
                  onChange={(e) =>
                    setStages((prev) =>
                      prev.map((x, i) =>
                        i === si
                          ? {
                              ...x,
                              requiredDocuments: e.target.value
                                .split(",")
                                .map((d) => d.trim())
                                .filter(Boolean),
                            }
                          : x,
                      ),
                    )
                  }
                  placeholder="Vakalatnama, certified copy of sale deed…"
                />
              </div>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setStages((prev) => [
                ...prev,
                { name: "", tasks: [], requiredDocuments: [] },
              ])
            }
          >
            <Plus className="mr-1.5 size-4" /> Add stage
          </Button>

          <Button className="w-full" onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
            {playbook ? "Save new version" : "Create playbook"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ApplyDialog({
  playbook,
  onOpenChange,
}: {
  playbook: PlaybookRow | null;
  onOpenChange: () => void;
}) {
  const detail = useQuery(
    api.tasks.playbookDetail,
    playbook ? { playbookId: playbook._id as Id<"playbooks"> } : "skip",
  ) as PlaybookDetail | null | undefined;
  const applyPlaybook = useMutation(api.tasks.applyPlaybook);

  const visibleMatters = useQuery(api.matters.list) as
    | { _id: string; reference: string; title: string }[]
    | undefined;

  const [matterId, setMatterId] = useState("none");
  const [startOn, setStartOn] = useState("");
  // Lawyer-confirmed deadlines: title/date/category triplets.
  const [confirmed, setConfirmed] = useState<
    { title: string; date: string; category: string; enabled: boolean }[]
  >([]);
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Seed confirmation rows from the template's required documents when
  // the dialog opens for a playbook — never automatic dates.
  const templateTasks = detail?.stages.flatMap((s) =>
    s.tasks.map((t) => `${s.name} — ${t.title}`),
  );
  if (playbook && seededFor !== playbook._id && detail) {
    setConfirmed(
      detail.stages.flatMap((s) =>
        s.requiredDocuments.map((doc) => ({
          title: `Prepare ${doc} (${s.name})`,
          date: "",
          category: "filing",
          enabled: false,
        })),
      ),
    );
    setSeededFor(playbook._id);
  }
  if (!playbook && seededFor !== null) {
    setSeededFor(null);
  }

  const submit = async () => {
    if (!playbook) return;
    if (matterId === "none") {
      toast.error("Choose the matter to apply this playbook to.");
      return;
    }
    if (!startOn) {
      toast.error("Pick the start date for the playbook.");
      return;
    }
    const enabled = confirmed.filter((c) => c.enabled && c.date);
    setBusy(true);
    try {
      const res = await applyPlaybook({
        playbookId: playbook._id as Id<"playbooks">,
        matterId: matterId as Id<"matters">,
        startOn,
        deadlineTitles: enabled.map((c) => c.title),
        deadlineDates: enabled.map((c) => c.date),
        deadlineCategories: enabled.map((c) => c.category as "filing"),
      });
      toast.success(
        `Playbook applied — ${res.taskCount} task(s), ${res.deadlineCount} deadline(s) created.`,
      );
      onOpenChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={playbook !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-serif">
            Apply “{playbook?.name}” to a matter
          </DialogTitle>
          <DialogDescription>
            Tasks are copied to the matter with dates counted from the start
            date you set. Confirm each date you want recorded as a deadline —
            nothing is calculated for you.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Matter</Label>
            <Select value={matterId} onValueChange={setMatterId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a matter" />
              </SelectTrigger>
              <SelectContent>
                {(visibleMatters ?? [])
                  .filter((m) => m.reference)
                  .map((m) => (
                    <SelectItem key={m._id} value={m._id}>
                      {m.reference} — {m.title}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pb-start">Playbook starts on</Label>
            <Input
              id="pb-start"
              type="date"
              value={startOn}
              onChange={(e) => setStartOn(e.target.value)}
            />
          </div>

          {detail && templateTasks && templateTasks.length > 0 && (
            <div className="rounded-md border p-3 text-sm">
              <p className="type-label mb-2">
                {templateTasks.length} task(s) will be created
              </p>
              <ul className="max-h-24 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
                {templateTasks.map((t) => (
                  <li key={t}>• {t}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-2">
            <Label>Confirm deadlines (lawyer's dates)</Label>
            {confirmed.length === 0 && (
              <p className="text-xs ink-faded">
                This template does not propose any dates. Add none, or record
                deadlines separately on the matter.
              </p>
            )}
            {confirmed.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <Checkbox
                  checked={c.enabled}
                  onCheckedChange={(v) =>
                    setConfirmed((prev) =>
                      prev.map((x, j) =>
                        j === i ? { ...x, enabled: v === true } : x,
                      ),
                    )
                  }
                  aria-label="Record as deadline"
                />
                <span className="min-w-0 flex-1 truncate text-xs">{c.title}</span>
                <Input
                  type="date"
                  value={c.date}
                  onChange={(e) =>
                    setConfirmed((prev) =>
                      prev.map((x, j) =>
                        j === i ? { ...x, date: e.target.value } : x,
                      ),
                    )
                  }
                  className="h-8 w-36 shrink-0 text-xs"
                />
                <Select
                  value={c.category}
                  onValueChange={(v) =>
                    setConfirmed((prev) =>
                      prev.map((x, j) =>
                        j === i ? { ...x, category: v } : x,
                      ),
                    )
                  }
                >
                  <SelectTrigger className="h-8 w-28 shrink-0 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(DEADLINE_CATEGORY_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>

          <Button className="w-full" onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
            Apply playbook
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
