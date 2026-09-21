import { ChamberShell } from "@/components/ChamberShell";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDateTimeIN } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import {
  CheckCircle2,
  FileText,
  Loader2,
  PenLine,
  Plus,
  Send,
  Share2,
  Stamp,
  Undo2,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

// ---------------------------------------------------------------------
// Draft review & approval desk — versions, annotations, approvals.
// ---------------------------------------------------------------------

const KIND_LABELS: Record<string, string> = {
  client_update: "Client update",
  legal_notice: "Legal notice",
  petition_draft: "Petition / pleading",
  internal_memo: "Internal memo",
  other: "Other",
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  drafted: { label: "Drafted", cls: "text-muted-foreground" },
  in_review: { label: "In review", cls: "text-[#4f6b8f]" },
  change_requested: { label: "Changes requested", cls: "text-[#8a6a33]" },
  approved: { label: "Approved", cls: "text-emerald-700" },
  rejected: { label: "Rejected", cls: "text-red-700" },
  shared: { label: "Approved · shared", cls: "text-emerald-700" },
  filed: { label: "Approved · filed", cls: "text-emerald-700" },
};

type DeskRow = {
  _id: string;
  title: string;
  kind: string;
  status: string;
  currentVersion: number;
  authorName: string;
  mine: boolean;
  toReview: boolean;
  openChangeRequests: number;
  matterId: string | null;
  matterReference: string | null;
  versionCount: number;
  updatedAt: number;
};

type Detail = {
  _id: string;
  title: string;
  kind: string;
  status: string;
  matterId: string | null;
  matterReference: string | null;
  currentVersion: number;
  currentBody: string;
  currentVersionStatus: string;
  currentReviewerName: string | null;
  currentAuthorName: string | null;
  openChangeRequests: number;
  canReview: boolean;
  isAuthorOrManager: boolean;
  versions: {
    version: number;
    status: string;
    authorName: string;
    reviewerName: string | null;
    reviewNote: string | null;
    reviewedAt: number | null;
    approvedByName: string | null;
    approvedAt: number | null;
    revisesVersion: number | null;
    createdAt: number;
    isCurrent: boolean;
  }[];
  comments: {
    _id: string;
    version: number;
    authorName: string;
    body: string;
    isChangeRequest: boolean;
    resolvedAt: number | null;
    createdAt: number;
    isCurrentVersion: boolean;
  }[];
};

export default function Drafts() {
  const [filter, setFilter] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const rows = useQuery(api.drafts.desk, {
    filter: filter as "all",
  }) as DeskRow[] | undefined;

  return (
    <ChamberShell title="Draft review" subtitle="Review and approval desk">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {[
            ["all", "All"],
            ["mine", "My drafts"],
            ["to_review", "To review"],
            ["awaiting_approval", "Awaiting review"],
            ["approved", "Approved"],
          ].map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setFilter(v)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                filter === v
                  ? "border-[#B68A45] bg-[#B68A45]/10 font-medium text-[#8a6d3b]"
                  : "border-border text-muted-foreground hover:bg-muted/60"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="mr-1.5 size-4" /> New draft
        </Button>
      </div>

      <div className="mt-4">
        {rows === undefined ? (
          <p className="text-sm text-muted-foreground">Loading drafts…</p>
        ) : rows.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center text-sm ink-faded">
              Nothing on the desk for this view.
            </CardContent>
          </Card>
        ) : (
          <div className="rule-frame overflow-x-auto rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left">
                  <th className="px-4 py-2.5 font-medium">Draft</th>
                  <th className="px-4 py-2.5 font-medium">Kind</th>
                  <th className="px-4 py-2.5 font-medium">Version</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Author</th>
                  <th className="px-4 py-2.5 text-right font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((d) => {
                  const meta = STATUS_META[d.status] ?? {
                    label: d.status,
                    cls: "",
                  };
                  return (
                    <tr key={d._id}>
                      <td className="max-w-xs px-4 py-3">
                        <p className="truncate font-medium">{d.title}</p>
                        {d.matterReference && (
                          <p className="type-label ink-faded">
                            {d.matterReference}
                          </p>
                        )}
                        {d.openChangeRequests > 0 && (
                          <p className="type-label text-[#8a6a33]">
                            {d.openChangeRequests} open change request
                            {d.openChangeRequests === 1 ? "" : "s"}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="font-normal">
                          {KIND_LABELS[d.kind] ?? d.kind}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        v{d.currentVersion}
                        {d.versionCount > 1 && (
                          <span className="type-label ink-faded">
                            {" "}
                            of {d.versionCount}
                          </span>
                        )}
                      </td>
                      <td className={`px-4 py-3 ${meta.cls}`}>{meta.label}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {d.authorName}
                        {d.toReview && (
                          <span className="type-label ml-2 text-[#4f6b8f]">
                            your review
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setOpenId(d._id)}
                        >
                          Open
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <NewDraftDialog open={creating} onOpenChange={setCreating} />
      <DraftDetailDialog draftId={openId} onOpenChange={() => setOpenId(null)} />
    </ChamberShell>
  );
}

// ---------------------------------------------------------------------
// New draft
// ---------------------------------------------------------------------

function NewDraftDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const create = useMutation(api.drafts.create);
  const members = useQuery(api.workspace.team);
  const matters = useQuery(api.matters.list) as
    | { _id: string; reference: string; title: string }[]
    | undefined;

  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("client_update");
  const [body, setBody] = useState("");
  const [matterId, setMatterId] = useState("none");
  const [reviewerId, setReviewerId] = useState("none");
  const [busy, setBusy] = useState(false);

  const activeMembers = (members ?? []).filter(
    (m) => m.status === "active" && m.orgRole !== "accountant",
  );

  const submit = async () => {
    if (!title.trim() || !body.trim()) {
      toast.error("A draft needs a title and its text.");
      return;
    }
    setBusy(true);
    try {
      const res = await create({
        title,
        kind: kind as "client_update",
        body,
        matterId: matterId === "none" ? undefined : (matterId as Id<"matters">),
        reviewerId:
          reviewerId === "none" ? undefined : (reviewerId as Id<"users">),
      });
      toast.success("Draft created — send it for review when ready.");
      onOpenChange(false);
      setTitle("");
      setBody("");
      void res;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-serif">New draft</DialogTitle>
          <DialogDescription>
            Client updates must be approved here before they are shared with
            the client externally.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="dr2-title">Title</Label>
              <Input
                id="dr2-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Hearing outcome update to client"
              />
            </div>
            <div className="space-y-2">
              <Label>Kind</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(KIND_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dr2-body">Draft text</Label>
            <Textarea
              id="dr2-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              placeholder="Write the full text of the draft…"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Matter (optional)</Label>
              <Select value={matterId} onValueChange={setMatterId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not linked</SelectItem>
                  {(matters ?? [])
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
              <Label>Reviewer (optional)</Label>
              <Select value={reviewerId} onValueChange={setReviewerId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Assign later</SelectItem>
                  {activeMembers.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.name ?? m.email ?? "Member"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button className="w-full" onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
            Create draft
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// Draft detail — version timeline, review actions, annotations
// ---------------------------------------------------------------------

function DraftDetailDialog({
  draftId,
  onOpenChange,
}: {
  draftId: string | null;
  onOpenChange: () => void;
}) {
  const detail = useQuery(
    api.drafts.detail,
    draftId ? { draftId: draftId as Id<"drafts"> } : "skip",
  ) as Detail | null | undefined;

  const revise = useMutation(api.drafts.revise);
  const submitForReview = useMutation(api.drafts.submitForReview);
  const approve = useMutation(api.drafts.approve);
  const rejectVersion = useMutation(api.drafts.rejectVersion);
  const markShared = useMutation(api.drafts.markShared);
  const markFiled = useMutation(api.drafts.markFiled);
  const comment = useMutation(api.drafts.comment);
  const resolveCR = useMutation(api.drafts.resolveChangeRequest);

  const [revising, setRevising] = useState(false);
  const [newBody, setNewBody] = useState("");
  const [reviewerId, setReviewerId] = useState("none");
  const [note, setNote] = useState("");
  const [commentText, setCommentText] = useState("");
  const [isCR, setIsCR] = useState(false);
  const [busy, setBusy] = useState(false);

  const members = useQuery(api.workspace.team);
  const activeMembers = (members ?? []).filter(
    (m) => m.status === "active" && m.orgRole !== "accountant",
  );

  // Reset local state whenever a different draft opens (comment bodies
  // keyed by draft id below so the dialog remounts cleanly).

  const run = (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    return fn()
      .then(() => toast.success(ok))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed."))
      .finally(() => setBusy(false));
  };

  const d = detail;
  const meta = d ? (STATUS_META[d.status] ?? { label: d.status, cls: "" }) : null;

  return (
    <Dialog open={draftId !== null} onOpenChange={onOpenChange} key={draftId ?? "none"}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        {!d ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline size-4 animate-spin" />
            Opening the draft…
          </p>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <DialogTitle className="font-serif text-xl">{d.title}</DialogTitle>
                  <DialogDescription>
                    {KIND_LABELS[d.kind] ?? d.kind} · v{d.currentVersion} ·{" "}
                    {d.matterReference ? `${d.matterReference} · ` : ""}
                    drafted by {d.currentAuthorName ?? "—"}
                    {d.currentReviewerName &&
                      ` · reviewer ${d.currentReviewerName}`}
                  </DialogDescription>
                </div>
                {meta && (
                  <span className={`type-label ${meta.cls}`}>{meta.label}</span>
                )}
              </div>
            </DialogHeader>

            {/* Current text */}
            {!revising ? (
              <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/30 px-4 py-3 text-sm leading-relaxed">
                {d.currentBody}
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="rev-body">
                  New version — supersedes v{d.currentVersion} (its approval does
                  not carry over)
                </Label>
                <Textarea
                  id="rev-body"
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  rows={10}
                />
                <div className="flex flex-wrap gap-2">
                  <Select value={reviewerId} onValueChange={setReviewerId}>
                    <SelectTrigger className="w-56">
                      <SelectValue placeholder="Reviewer" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        {d.currentReviewerName
                          ? `Keep ${d.currentReviewerName}`
                          : "Assign reviewer later"}
                      </SelectItem>
                      {activeMembers
                        .filter((m) => m.name !== d.currentAuthorName)
                        .map((m) => (
                          <SelectItem key={m.userId} value={m.userId}>
                            {m.name ?? m.email ?? "Member"}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    disabled={busy || !newBody.trim()}
                    onClick={() =>
                      run(
                        () =>
                          revise({
                            draftId: d._id as Id<"drafts">,
                            body: newBody,
                            reviewerId:
                              reviewerId === "none"
                                ? undefined
                                : (reviewerId as Id<"users">),
                          }),
                        `Version ${d.currentVersion + 1} created — review required.`,
                      ).then(() => {
                        setRevising(false);
                        setNewBody("");
                      })
                    }
                  >
                    <PenLine className="mr-1.5 size-3.5" /> Save revision
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setRevising(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {d.openChangeRequests > 0 && (
              <p className="rounded border border-[#d9c193] bg-[#f7f1e3] px-3 py-2 text-xs text-[#7a5c25]">
                {d.openChangeRequests} change request
                {d.openChangeRequests === 1 ? "" : "s"} on v{d.currentVersion}{" "}
                must be resolved before approval.
              </p>
            )}

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2">
              {d.isAuthorOrManager && !revising && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setNewBody(d.currentBody);
                    setRevising(true);
                  }}
                >
                  <PenLine className="mr-1.5 size-3.5" /> Revise
                </Button>
              )}
              {d.isAuthorOrManager &&
                (d.currentVersionStatus === "drafted" ||
                  d.currentVersionStatus === "change_requested") && (
                  <Button
                    size="sm"
                    disabled={busy || !d.currentReviewerName}
                    title={
                      d.currentReviewerName
                        ? undefined
                        : "Assign a reviewer first"
                    }
                    onClick={() =>
                      run(
                        () => submitForReview({ draftId: d._id as Id<"drafts"> }),
                        "Sent for review.",
                      )
                    }
                  >
                    <Send className="mr-1.5 size-3.5" /> Send for review
                  </Button>
                )}
              {d.canReview &&
                (d.currentVersionStatus === "in_review" ||
                  d.currentVersionStatus === "change_requested") && (
                  <>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () =>
                            approve({
                              draftId: d._id as Id<"drafts">,
                              note: note || undefined,
                            }),
                          `v${d.currentVersion} approved.`,
                        )
                      }
                    >
                      <CheckCircle2 className="mr-1.5 size-3.5" /> Approve v
                      {d.currentVersion}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy || !note.trim()}
                      title="A rejection reason is required"
                      onClick={() =>
                        run(
                          () =>
                            rejectVersion({
                              draftId: d._id as Id<"drafts">,
                              reason: note,
                            }),
                          "Rejected — the author must revise and resubmit.",
                        )
                      }
                    >
                      <Undo2 className="mr-1.5 size-3.5" /> Reject
                    </Button>
                  </>
                )}
              {d.isAuthorOrManager && d.currentVersionStatus === "approved" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => markShared({ draftId: d._id as Id<"drafts"> }),
                      "Marked as shared with the client.",
                    )
                  }
                >
                  <Share2 className="mr-1.5 size-3.5" /> Mark shared with client
                </Button>
              )}
              {(d.currentVersionStatus === "approved" ||
                d.currentVersionStatus === "shared") && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => markFiled({ draftId: d._id as Id<"drafts"> }),
                      "Recorded as filed.",
                    )
                  }
                >
                  <Stamp className="mr-1.5 size-3.5" /> Mark filed
                </Button>
              )}
            </div>
            {d.canReview && (
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Review note (required to reject; optional on approve)"
                className="text-xs"
                aria-label="Review note"
              />
            )}

            {/* Annotations & change requests */}
            <div className="space-y-2">
              <p className="type-label">Annotations on v{d.currentVersion}</p>
              {d.comments
                .filter((c) => c.isCurrentVersion)
                .map((c) => (
                  <div
                    key={c._id}
                    className={`rounded border px-3 py-2 text-sm ${
                      c.isChangeRequest && !c.resolvedAt
                        ? "border-[#d9c193] bg-[#fdf9ef]"
                        : "bg-background"
                    }`}
                  >
                    <p>{c.body}</p>
                    <p className="type-label mt-1 flex items-center gap-2 ink-faded">
                      {c.authorName} · {formatDateTimeIN(c.createdAt)}
                      {c.isChangeRequest &&
                        (c.resolvedAt ? (
                          <span className="text-emerald-700">
                            · resolved {formatDateTimeIN(c.resolvedAt)}
                          </span>
                        ) : (
                          <span className="text-[#8a6a33]">· change request</span>
                        ))}
                      {c.isChangeRequest &&
                        !c.resolvedAt &&
                        d.isAuthorOrManager && (
                          <button
                            type="button"
                            className="text-[#4f6b8f] underline-offset-2 hover:underline"
                            onClick={() =>
                              run(
                                () =>
                                  resolveCR({
                                    commentId: c._id as Id<"draftComments">,
                                  }),
                                "Change request resolved.",
                              )
                            }
                          >
                            mark resolved
                          </button>
                        )}
                    </p>
                  </div>
                ))}
              {d.comments.filter((c) => c.isCurrentVersion).length === 0 && (
                <p className="text-xs ink-faded">
                  No annotations on this version yet.
                </p>
              )}
              <div className="flex items-start gap-2">
                <Textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  rows={2}
                  placeholder="Annotate this version…"
                  className="text-xs"
                  aria-label="Annotation"
                />
                <div className="flex flex-col gap-1">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={isCR}
                      onChange={(e) => setIsCR(e.target.checked)}
                      className="accent-[#B68A45]"
                    />
                    Change request
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!commentText.trim() || busy}
                    onClick={() =>
                      run(
                        () =>
                          comment({
                            draftId: d._id as Id<"drafts">,
                            body: commentText,
                            isChangeRequest: isCR,
                          }),
                        "Annotation added.",
                      ).then(() => {
                        setCommentText("");
                        setIsCR(false);
                      })
                    }
                  >
                    Add
                  </Button>
                </div>
              </div>
            </div>

            {/* Version & approval history */}
            <div className="space-y-2">
              <p className="type-label">Version & approval history</p>
              <ol className="space-y-2">
                {d.versions.map((v) => {
                  const vm = STATUS_META[v.status] ?? {
                    label: v.status,
                    cls: "",
                  };
                  return (
                    <li
                      key={v.version}
                      className={`rounded border px-3 py-2 text-sm ${
                        v.isCurrent ? "border-[#B68A45]/60 bg-[#B68A45]/5" : ""
                      }`}
                    >
                      <p className="flex flex-wrap items-center gap-x-2">
                        <span className="font-medium">
                          v{v.version}
                          {v.isCurrent && " — current"}
                        </span>
                        <span className={`type-label ${vm.cls}`}>{vm.label}</span>
                        <span className="type-label ink-faded">
                          {formatDateTimeIN(v.createdAt)} · {v.authorName}
                        </span>
                      </p>
                      {v.revisesVersion !== null && (
                        <p className="type-label ink-faded">
                          revises v{v.revisesVersion}
                        </p>
                      )}
                      {v.approvedAt !== null && (
                        <p className="type-label text-emerald-700">
                          approved by {v.approvedByName} ·{" "}
                          {formatDateTimeIN(v.approvedAt)}
                        </p>
                      )}
                      {v.reviewNote && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          “{v.reviewNote}”
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>

            {d.matterId && (
              <Link
                className="type-label text-[#4f6b8f] underline-offset-2 hover:underline"
                to={`/matters/${d.matterId}`}
              >
                <FileText className="mr-1 inline size-3.5" />
                Open the matter file
              </Link>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
