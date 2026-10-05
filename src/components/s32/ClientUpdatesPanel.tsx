// =====================================================================
// §32 Phase 10 — Client-update drafts (Matter file → "Client updates").
// Updates are assembled ONLY from approved timeline developments, carry
// frozen provenance re-verified live before every send, queue through
// the EXISTING comm outbox, and show recipients honestly (a never-
// recorded preference is shown as absent — never treated as consent).
// Backend: clientUpdates.* — note.write prepares/cancels/queues,
// matter.edit approves; every gate re-checked server-side.
// =====================================================================
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { CheckCircle2, FileText, Send, XCircle } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { S32Empty, S32Loading, S32Note, errMessage } from "@/components/s32/shared";
import { formatDateTimeIN } from "@/lib/format";

/** Must match src/lib/clientUpdates.ts MAX_DEVELOPMENTS (drift test group4.test.ts). */
export const MAX_DEVELOPMENTS = 25;

const DRAFT_STATUS_CLS: Record<string, string> = {
  draft: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  approved: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  sent: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  cancelled: "bg-muted text-muted-foreground",
};

type Development = {
  refKey: string;
  entryKind: string;
  title: string;
  detail: string | null;
  date: string;
  datePrecision: string;
};

type DraftRow = {
  draftId: string;
  subject: string;
  status: string;
  developmentCount: number;
  createdByName: string;
  createdAt: number;
  approvedByName: string | null;
  outboxId: string | null;
};

type DraftReview = {
  draft: {
    draftId: string;
    subject: string;
    body: string;
    status: string;
    createdByName: string;
    createdAt: number;
    approvedByName: string | null;
    approvedAt: number | null;
    outboxId: string | null;
  };
  provenanceCount: number;
  provenanceState: { ok: boolean; message: string };
  recipients: {
    role: string;
    clientName: string;
    userId: string | null;
    hasPortalAccount: boolean;
    email: string | null;
    clientUpdatesPreference: boolean | null;
    whatsappOptIn: boolean | null;
    clientThreadExists: boolean;
  }[];
  duplicate: { blocked: boolean; reason: string | null };
};

export function ClientUpdatesPanel({
  matterId,
  canEdit,
  canSend,
}: {
  matterId: Id<"matters">;
  canEdit: boolean;
  canSend: boolean;
}) {
  const developments = useQuery(api.clientUpdates.listDevelopments, { matterId });
  const draftsData = useQuery(api.clientUpdates.listDrafts, { matterId });
  const [selectedDraft, setSelectedDraft] = useState<string | null>(null);
  const review = useQuery(
    api.clientUpdates.draftReview,
    selectedDraft ? { draftId: selectedDraft as Id<"clientUpdateDrafts"> } : "skip",
  );

  const prepareFn = useMutation(api.clientUpdates.prepareDraft);
  const approveFn = useMutation(api.clientUpdates.approveDraft);
  const cancelFn = useMutation(api.clientUpdates.cancelDraft);
  const queueFn = useMutation(api.clientUpdates.queueForSend);

  const [picked, setPicked] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [busy, setBusy] = useState(false);

  const togglePick = (refKey: string) => {
    setPicked((prev) =>
      prev.includes(refKey)
        ? prev.filter((x) => x !== refKey)
        : prev.length >= MAX_DEVELOPMENTS
          ? prev
          : [...prev, refKey],
    );
  };

  const prepare = async () => {
    if (picked.length === 0) {
      toast.error("Select at least one approved development.");
      return;
    }
    setBusy(true);
    try {
      const res = await prepareFn({
        matterId,
        developmentIds: picked as Id<"matterTimeline">[],
        subject: subject.trim() || undefined,
      });
      toast.success("Draft prepared from approved developments — provenance frozen.");
      setSelectedDraft(res.draftId);
      setPicked([]);
      setSubject("");
    } catch (e) {
      toast.error(errMessage(e, "Could not prepare the draft."));
    } finally {
      setBusy(false);
    }
  };

  const approve = async (draftId: string) => {
    setBusy(true);
    try {
      await approveFn({ draftId: draftId as Id<"clientUpdateDrafts"> });
      toast.success("Draft approved — it can now be queued for send.");
    } catch (e) {
      toast.error(errMessage(e, "Could not approve the draft."));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (draftId: string) => {
    setBusy(true);
    try {
      await cancelFn({ draftId: draftId as Id<"clientUpdateDrafts"> });
      toast.success("Draft cancelled.");
    } catch (e) {
      toast.error(errMessage(e, "Could not cancel the draft."));
    } finally {
      setBusy(false);
    }
  };

  const queue = async (draftId: string) => {
    setBusy(true);
    try {
      await queueFn({ draftId: draftId as Id<"clientUpdateDrafts"> });
      toast.success("Queued through the communication outbox — send-time gates apply.");
    } catch (e) {
      // Refusals (stale provenance, duplicate set, no thread) surface verbatim.
      toast.error(errMessage(e, "Could not queue the update."));
    } finally {
      setBusy(false);
    }
  };

  const rv = review as DraftReview | null | undefined;
  const canQueueThis =
    rv?.draft.status === "approved" && rv.provenanceState.ok && !rv.duplicate.blocked;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <FileText className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Client updates</h3>
      </div>
      {draftsData?.disclosure ? <S32Note>{draftsData.disclosure}</S32Note> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Approved developments picker */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Approved developments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {developments === undefined ? (
              <S32Loading />
            ) : developments.length === 0 ? (
              <S32Empty>
                No approved developments on the matter timeline yet — client
                updates may only draw on entries a lawyer has approved.
              </S32Empty>
            ) : (
              <>
                <div className="max-h-72 space-y-1.5 overflow-auto pr-1">
                  {(developments as unknown as Development[]).map((d) => (
                    <label
                      key={d.refKey}
                      className="flex cursor-pointer items-start gap-2 rounded border border-border/60 p-2 text-sm hover:bg-muted/40"
                    >
                      <Checkbox
                        className="mt-0.5"
                        checked={picked.includes(d.refKey)}
                        disabled={!canSend || picked.length >= MAX_DEVELOPMENTS}
                        onCheckedChange={() => togglePick(d.refKey)}
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{d.title}</span>
                        <span className="block text-xs text-muted-foreground">
                          {d.entryKind} · {d.date}
                          {d.detail ? ` — ${d.detail.slice(0, 80)}` : ""}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                {canSend ? (
                  <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-2">
                    <div>
                      <Label className="text-xs">Subject (optional)</Label>
                      <Input
                        className="mt-1"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        placeholder={`Matter update — defaults to the matter reference`}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {picked.length}/{MAX_DEVELOPMENTS} selected
                      </span>
                      <Button size="sm" disabled={busy || picked.length === 0} onClick={() => void prepare()}>
                        Prepare draft
                      </Button>
                    </div>
                  </div>
                ) : (
                  <S32Note tone="amber">
                    Preparing updates needs the write-notes capability.
                  </S32Note>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Drafts list */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Drafts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {draftsData === undefined ? (
              <S32Loading />
            ) : draftsData.drafts.length === 0 ? (
              <S32Empty>No client-update drafts yet.</S32Empty>
            ) : (
              (draftsData.drafts as unknown as DraftRow[]).map((d) => (
                <button
                  key={d.draftId}
                  type="button"
                  className={`w-full rounded-md border p-2 text-left ${
                    selectedDraft === d.draftId
                      ? "border-primary bg-primary/5"
                      : "border-border/70 hover:bg-muted/40"
                  }`}
                  onClick={() => setSelectedDraft(d.draftId)}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{d.subject}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${DRAFT_STATUS_CLS[d.status] ?? "bg-muted"}`}>
                      {d.status}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {d.developmentCount} dev · {formatDateTimeIN(d.createdAt)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    by {d.createdByName}
                    {d.approvedByName ? ` · approved by ${d.approvedByName}` : ""}
                  </p>
                </button>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Draft review */}
      {selectedDraft && rv === undefined && <S32Loading />}
      {rv && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
              Review — {rv.draft.subject}
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${DRAFT_STATUS_CLS[rv.draft.status] ?? "bg-muted"}`}>
                {rv.draft.status}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Live provenance re-verification */}
            <div
              className={`flex items-start gap-2 rounded-md border p-2 text-sm ${
                rv.provenanceState.ok
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "border-amber-500/40 bg-amber-500/5"
              }`}
            >
              {rv.provenanceState.ok ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              ) : (
                <XCircle className="mt-0.5 size-4 shrink-0 text-amber-600" />
              )}
              <span>
                <span className="font-medium">Provenance ({rv.provenanceCount}): </span>
                {rv.provenanceState.message}
              </span>
            </div>

            {/* Duplicate-send guard */}
            {rv.duplicate.blocked && (
              <div className="rounded-md border border-red-500/40 bg-red-500/5 p-2 text-sm">
                <span className="font-medium">Duplicate set: </span>
                {rv.duplicate.reason}
              </div>
            )}

            {/* Recipients — honest states */}
            <div className="rounded-md border border-border/70 p-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Recipients
              </p>
              {rv.recipients.map((r) => (
                <div key={r.role} className="mt-1 text-sm">
                  <span className="font-medium">{r.clientName}</span>
                  <span className="text-muted-foreground">
                    {" "}· portal account: {r.hasPortalAccount ? "yes" : "no"}
                    {r.email ? ` · ${r.email}` : " · no email on record"}
                    {" "}· updates preference:{" "}
                    {r.clientUpdatesPreference === null ? (
                      <Badge variant="secondary" className="text-[10px]">
                        never recorded — shown as absent, not consent
                      </Badge>
                    ) : r.clientUpdatesPreference ? (
                      <Badge variant="outline" className="text-[10px]">on</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">off</Badge>
                    )}
                    {" "}· WhatsApp: {r.whatsappOptIn === null ? "never recorded" : r.whatsappOptIn ? "opted in" : "off"}
                    {" "}· thread: {r.clientThreadExists ? "exists" : "will be created"}
                  </span>
                </div>
              ))}
            </div>

            {/* Body preview — disclosure footer travels with every send */}
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border bg-muted/30 p-3 text-xs leading-relaxed">
              {rv.draft.body}
            </pre>

            <div className="flex flex-wrap justify-end gap-2">
              {rv.draft.status === "draft" && canEdit && (
                <Button size="sm" disabled={busy} onClick={() => void approve(rv.draft.draftId)}>
                  Approve
                </Button>
              )}
              {rv.draft.status === "approved" && canSend && (
                <Button
                  size="sm"
                  disabled={busy || !canQueueThis}
                  onClick={() => void queue(rv.draft.draftId)}
                >
                  <Send className="mr-1 size-3.5" /> Queue for send
                </Button>
              )}
              {(rv.draft.status === "draft" || rv.draft.status === "approved") && canSend && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void cancel(rv.draft.draftId)}>
                  Cancel draft
                </Button>
              )}
            </div>
            {rv.draft.status === "approved" && !canQueueThis && (
              <p className="text-xs text-muted-foreground">
                Queueing is disabled while provenance problems or a duplicate-set
                block exist — fix the cause rather than overriding it.
              </p>
            )}
            {rv.draft.outboxId && (
              <p className="text-xs text-muted-foreground">
                Queued in the communication outbox — delivery there, not here.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
