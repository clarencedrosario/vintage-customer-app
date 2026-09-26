import { ChamberShell } from "@/components/ChamberShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDateTimeIN, formatDateIN, formatINR } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import {
  CalendarClock,
  ClipboardCheck,
  FileText,
  Gavel,
  MessageSquare,
  Receipt,
  Send,
  ScrollText,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";import { Link } from "react-router";
import { sha256Hex } from "@/lib/evidenceIntegrity";
import { toast } from "sonner";

/** One document row; resolves a read URL via its own guarded subscription. */
function ClientDocLink({ documentId }: { documentId: Id<"matterDocuments"> }) {
  const url = useQuery(api.portals.clientDocumentUrl, { documentId });
  if (!url) return <span className="type-label ink-faded">—</span>;
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

const MAX_MESSAGE = 2000;

function NewMessageDialog({
  matters,
}: {
  matters: { _id: Id<"matters">; reference: string; title: string }[];
}) {
  const send = useMutation(api.portals.clientMessage);
  const [matterId, setMatterId] = useState<string>(matters[0]?._id ?? "");
  const [body, setBody] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const sendIt = async () => {
    if (!matterId || !body.trim()) {
      toast.error("Choose a matter and write a message first.");
      return;
    }
    setBusy(true);
    try {
      await send({ matterId: matterId as never, body });
      toast.success("Message sent to your lawyer.");
      setBody("");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Send className="size-4" aria-hidden="true" />
          Message your lawyer
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <p className="type-label ink-faded">Secure message</p>
          <DialogTitle className="font-serif text-2xl">
            Write to your lawyer
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {matters.length > 1 && (
            <div className="space-y-1.5">
              <p className="type-label ink-faded">Matter</p>
              <select
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
                value={matterId}
                onChange={(e) => setMatterId(e.target.value)}
                aria-label="Choose matter"
              >
                {matters.map((m) => (
                  <option key={m._id} value={m._id}>
                    {m.reference} — {m.title}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <p className="type-label ink-faded">Message</p>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Ask about your case, share an update, or request information…"
              className="min-h-[110px]"
              maxLength={MAX_MESSAGE}
            />
            <p className="text-right text-xs text-muted-foreground">
              {body.length}/{MAX_MESSAGE}
            </p>
          </div>
          <Button className="w-full" onClick={sendIt} disabled={busy}>
            {busy ? "Sending…" : "Send message"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SubmitDocumentDialog({
  matters,
}: {
  matters: { _id: Id<"matters">; reference: string; title?: string }[];
}) {
  const generate = useMutation(api.portals.generateClientUploadUrl);
  const attach = useMutation(api.portals.clientUploadDocument);
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [matterId, setMatterId] = useState<string>(matters[0]?._id ?? "");
  const [name, setName] = useState("");

  const submit = async () => {
    const file = fileInput.current?.files?.[0];
    if (!matterId || !file) {
      toast.error("Choose a matter and select a file first.");
      return;
    }
    setBusy(true);
    try {
      const url = await generate({ matterId: matterId as never });
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      const { storageId } = (await res.json()) as { storageId: string };
      // Integrity hash computed in the browser over the exact bytes;
      // absent (never fabricated) if hashing is unavailable.
      let checksum: string | undefined;
      try {
        checksum = await sha256Hex(await file.arrayBuffer());
      } catch {
        checksum = undefined;
      }
      await attach({
        matterId: matterId as never,
        name: name.trim() || file.name,
        storageId: storageId as never,
        checksum,
      });
      toast.success("Document submitted for your lawyer's review.");
      setOpen(false);
      setName("");
      if (fileInput.current) fileInput.current.value = "";
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2">
          <Upload className="size-4" aria-hidden="true" />
          Submit a document
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <p className="type-label ink-faded">Document submission</p>
          <DialogTitle className="font-serif text-2xl">
            Send a document to the chamber
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="type-label ink-faded">Matter</p>
            <select
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
              value={matterId}
              onChange={(e) => setMatterId(e.target.value)}
              aria-label="Choose matter"
            >
              {matters.map((m) => (
                <option key={m._id} value={m._id}>
                  {m.reference} — {m.title}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <p className="type-label ink-faded">Display name (optional)</p>
            <input
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Certified copy of sale deed"
              aria-label="Document display name"
            />
          </div>
          <div className="space-y-1.5">
            <p className="type-label ink-faded">File</p>
            <input
              ref={fileInput}
              type="file"
              className="w-full text-sm"
              aria-label="Choose file to upload"
            />
          </div>
          <Button className="w-full" onClick={submit} disabled={busy}>
            {busy ? "Submitting…" : "Submit document"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ClientPortal() {
  const data = useQuery(api.portals.clientPortal);
  const requests = useQuery(api.documentRequests.clientChecklist);
  const [now] = useState(() => Date.now());

  if (data === undefined) {
    return (
      <ChamberShell subtitle="Client Portal" title="Your matters">
        <p className="text-sm text-muted-foreground">Opening your file…</p>
      </ChamberShell>
    );
  }

  if (data === null) {
    return (
      <ChamberShell subtitle="Client Portal" title="Your matters">
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <FileText className="mx-auto size-10 text-muted-foreground" />
            <h2 className="mt-6 font-serif text-2xl font-semibold">
              No portal access yet
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Your lawyer connects client accounts to their matters. If you
              received an invitation link, open it while signed in with the
              invited email.
            </p>
            <Button asChild variant="outline" className="mt-6">
              <Link to="/login">Choose another portal</Link>
            </Button>
            <p className="mt-4 text-xs ink-faded">
              Expecting access? Ask your lawyer to send an invitation to this
              email address.
            </p>
          </CardContent>
        </Card>
      </ChamberShell>
    );
  }

  const statusLabels: Record<string, { label: string; cls: string }> = {
    open: { label: "Open", cls: "text-blue-700" },
    in_progress: { label: "In progress", cls: "text-[#8a6a33]" },
    on_hold: { label: "On hold", cls: "text-muted-foreground" },
    closed: { label: "Closed", cls: "text-emerald-700" },
  };

  const checklist = requests ?? [];
  const invoiceStatuses: Record<string, { label: string; cls: string }> = {
    draft: { label: "Draft", cls: "text-muted-foreground" },
    sent: { label: "Awaiting payment", cls: "text-[#8a6a33]" },
    partially_paid: { label: "Partially paid", cls: "text-[#8a6a33]" },
    paid: { label: "Paid", cls: "text-emerald-700" },
    cancelled: { label: "Cancelled", cls: "text-muted-foreground" },
  };
  const openInvoices = data.invoices.filter((i) => i.status !== "paid" && i.status !== "cancelled" && i.status !== "draft");
  const totalDue = openInvoices.reduce(
    (s, i) => s + (i.totalMinor - i.amountPaidMinor) / 100,
    0,
  );
  const matterById = new Map(
    data.matters.map((m) => [m._id, m]),
  );
  const shortMatters = data.matters.map((m) => ({
    _id: m._id,
    reference: m.reference,
    title: m.title,
  }));

  return (
    <ChamberShell
      subtitle="Client Portal"
      title={`Welcome, ${data.client.name}`}
      actions={
        <div className="flex items-center gap-2">
          {data.submissionEnabled && shortMatters.length > 0 && (
            <SubmitDocumentDialog matters={shortMatters} />
          )}
          {shortMatters.length > 0 && (
            <NewMessageDialog matters={shortMatters} />
          )}
        </div>
      }
    >
      {/* Approved case updates */}
      <section aria-label="Case updates" className="mt-2">
        <p className="type-label ink-faded flex items-center gap-2">
          <ScrollText className="size-3.5" /> Latest case updates
        </p>
        {data.events.length === 0 ? (
          <p className="mt-3 text-sm ink-faded">
            No updates from the chamber yet. Hearing dates and shared documents
            will appear here as your lawyer records them.
          </p>
        ) : (
          <ol className="mt-3 space-y-2">
            {data.events.slice(0, 6).map((e) => (
              <li key={e._id} className="rule-frame rounded-lg p-3">
                <p className="text-sm">{e.detail}</p>
                <p className="type-label mt-1 ink-faded">
                  {matterById.get(e.matterId)?.reference ?? ""} ·{" "}
                  {formatDateTimeIN(e.createdAt)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Your matters */}
      <section aria-label="Your matters" className="mt-10">
        <p className="type-label ink-faded">Your matters</p>
        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Matter</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.matters.map((m) => {
                const s = statusLabels[m.status] ?? { label: m.status, cls: "" };
                return (
                  <tr key={m._id}>
                    <td className="whitespace-nowrap font-medium">{m.reference}</td>
                    <td>
                      <p className="font-serif text-base font-semibold">{m.title}</p>
                      {m.court ? (
                        <p className="text-xs text-muted-foreground">{m.court}</p>
                      ) : null}
                    </td>
                    <td>
                      <span className={`stamp ${s.cls}`}>{s.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        {/* Hearing dates & next steps */}
        <section aria-label="Hearing dates and next steps">
          <p className="type-label ink-faded flex items-center gap-2">
            <Gavel className="size-3.5" /> Hearing dates &amp; next steps
          </p>
          <div className="mt-3 space-y-3">
            {data.hearings.length === 0 ? (
              <p className="text-sm ink-faded">
                No hearings listed. Your lawyer will publish the next date here.
              </p>
            ) : (
              data.hearings.slice(0, 6).map((h) => (
                <div key={h._id} className="rule-frame rounded-lg p-4">
                  <p className="text-sm font-medium">{h.title}</p>
                  <p className="type-label mt-1 ink-faded">
                    {formatDateTimeIN(h.at)}
                    {h.court ? ` · ${h.court}` : ""}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {h.at > now ? "Next step: attend or follow the date." : ""}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Invoices & payment status */}
        <section aria-label="Invoices and payment status">
          <p className="type-label ink-faded flex items-center gap-2">
            <Receipt className="size-3.5" /> Invoices &amp; payment status
          </p>
          <div className="mt-3 space-y-3">
            {totalDue > 0 && (
              <div className="rule-frame rounded-lg p-4">
                <p className="type-label ink-faded">Total outstanding</p>
                <p className="font-serif text-2xl font-semibold">
                  {formatINR(totalDue)}
                </p>
              </div>
            )}
            {data.invoices.length === 0 ? (
              <p className="text-sm ink-faded">No invoices raised.</p>
            ) : (
              data.invoices.slice(0, 6).map((inv) => {
                const st =
                  invoiceStatuses[inv.status] ?? { label: inv.status, cls: "" };
                return (
                  <div
                    key={inv._id}
                    className="rule-frame flex items-center justify-between gap-4 rounded-lg p-4"
                  >
                    <div>
                      <p className="text-sm font-medium">{inv.number}</p>
                      <p className="type-label mt-1 ink-faded">
                        {formatDateIN(inv.issuedOn)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-serif font-semibold">{formatINR(inv.totalMinor / 100)}</p>
                      <p className={`type-label ${st.cls}`}>{st.label}</p>
                      {inv.status === "partially_paid" && (
                        <p className="type-label ink-faded">
                          Paid {formatINR(inv.amountPaidMinor / 100)} of{" "}
                          {formatINR(inv.totalMinor / 100)}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      {/* Document-request checklists */}
      <section aria-label="Document requests" className="mt-10">
        <p className="type-label ink-faded flex items-center gap-2">
          <ClipboardCheck className="size-3.5" /> Documents requested from you
        </p>
        <div className="mt-3 space-y-2">
          {checklist.length === 0 ? (
            <p className="text-sm ink-faded">
              Nothing requested from you at present.
            </p>
          ) : (
            <ClientRequestList requests={checklist} />
          )}
        </div>
      </section>

      {/* Shared documents */}
      <section aria-label="Documents shared with you" className="mt-10">
        <p className="type-label ink-faded flex items-center gap-2">
          <FileText className="size-3.5" /> Documents shared with you
        </p>
        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
          {data.documents.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm ink-faded">
              No documents shared yet.
            </p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Kind</th>
                  <th>Filed</th>
                  <th className="text-right">—</th>
                </tr>
              </thead>
              <tbody>
                {data.documents.slice(0, 12).map((d) => (
                  <tr key={d._id}>
                    <td className="max-w-[280px] truncate">
                      {d.name}
                      {d.submittedByClient ? (
                        <span className="type-label ml-2 ink-faded">
                          (submitted by you)
                        </span>
                      ) : null}
                    </td>
                    <td className="type-label ink-faded">{d.kind}</td>
                    <td className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTimeIN(d.createdAt)}
                    </td>
                    <td className="text-right">
                      {d.storageId ? <ClientDocLink documentId={d._id} /> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Secure messages */}
      <section aria-label="Messages with your lawyer" className="mt-10">
        <p className="type-label ink-faded flex items-center gap-2">
          <MessageSquare className="size-3.5" /> Messages with your lawyer
        </p>
        <div className="mt-3 space-y-2">
          {data.messages.length === 0 ? (
            <p className="text-sm ink-faded">
              No messages yet. Use “Message your lawyer” to start a secure
              conversation about a matter.
            </p>
          ) : (
            data.messages.slice(-15).map((m) => {
              const mine = m.fromClient === true;
              return (
                <div
                  key={m._id}
                  className={`rule-frame max-w-2xl rounded-lg p-3 ${
                    mine ? "ml-auto border-[#B68A45]/40" : ""
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{m.body}</p>
                  <p className="type-label mt-1 ink-faded">
                    {mine ? "You" : "The chamber"} ·{" "}
                    {formatDateTimeIN(m.createdAt)}
                  </p>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Shared chronology */}
      <section aria-label="Shared chronology" className="mt-10">
        <p className="type-label ink-faded flex items-center gap-2">
          <CalendarClock className="size-3.5" /> Chronology
        </p>
        <ol className="mt-3 space-y-2">
          {data.events.length === 0 ? (
            <p className="text-sm ink-faded">The chronology is empty.</p>
          ) : (
            data.events.map((e) => (
              <li key={e._id} className="rule-frame rounded-lg p-3">
                <p className="text-sm">{e.detail}</p>
                <p className="type-label mt-1 ink-faded">
                  {matterById.get(e.matterId)?.reference ?? ""} ·{" "}
                  {formatDateTimeIN(e.createdAt)}
                </p>
              </li>
            ))
          )}
        </ol>
      </section>
    </ChamberShell>
  );
}

// ---------------------------------------------------------------------
// Client document-request checklist — upload, track, respond.
// ---------------------------------------------------------------------

// Captured at module load — overdue markers refresh on next load.
const REQUEST_NOW = Date.now();

type ClientRequest = {
  _id: string;
  matterReference: string;
  matterTitle: string;
  title: string;
  instructions: string | null;
  dueAt: number | null;
  status: string;
  hasFile: boolean;
  reviewNote: string | null;
  comments: { body: string; at: number; fromClient: boolean }[];
};

function ClientRequestList({ requests }: { requests: ClientRequest[] }) {
  return (
    <>
      {requests.map((r) => (
        <ClientRequestRow key={r._id} request={r} />
      ))}
    </>
  );
}

function ClientRequestRow({ request: r }: { request: ClientRequest }) {
  const uploadUrl = useMutation(api.documentRequests.clientUploadUrl);
  const submit = useMutation(api.documentRequests.clientSubmit);
  const comment = useMutation(api.documentRequests.clientComment);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [showComments, setShowComments] = useState(false);

  const overdue =
    (r.status === "requested" || r.status === "rejected") &&
    r.dueAt !== null &&
    r.dueAt < REQUEST_NOW;

  const STATUS_META: Record<string, { label: string; cls: string }> = {
    requested: { label: "Requested — action needed", cls: "text-[#8a6a33]" },
    uploaded: { label: "Uploaded — awaiting review", cls: "text-[#4f6b8f]" },
    under_review: { label: "Under review", cls: "text-[#4f6b8f]" },
    accepted: { label: "Accepted", cls: "text-emerald-700" },
    rejected: { label: "Re-send requested", cls: "text-red-700" },
  };
  const meta = STATUS_META[r.status] ?? { label: r.status, cls: "" };

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const url = await uploadUrl({ requestId: r._id as Id<"documentRequests"> });
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await submit({
        requestId: r._id as Id<"documentRequests">,
        name: file.name,
        storageId,
      });
      toast.success("Uploaded — your lawyer will review it.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <div className="rule-frame rounded-lg p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{r.title}</p>
          <p className="type-label mt-0.5 ink-faded">
            {r.matterReference} · {r.matterTitle}
            {r.dueAt !== null && ` · due ${formatDateIN(r.dueAt)}`}
          </p>
        </div>
        <div className="text-right">
          <p className={`type-label ${meta.cls}`}>{meta.label}</p>
          {overdue && (
            <p className="type-label text-red-700">Past the due date</p>
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
          {r.reviewNote}
        </p>
      )}
      {r.status === "accepted" && (
        <p className="mt-2 text-xs text-emerald-700">
          Your document was accepted by the chamber.
        </p>
      )}

      {(r.status === "requested" || r.status === "rejected") && (
        <div className="mt-3">
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <Upload className="mr-1.5 size-3.5" />
            {busy ? "Uploading…" : r.status === "rejected" ? "Upload again" : "Upload securely"}
          </Button>
        </div>
      )}

      {(r.comments.length > 0 || r.status !== "accepted") && (
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
                    {c.fromClient ? "You" : "Chamber"} · {formatDateTimeIN(c.at)}
                  </p>
                </div>
              ))}
              {r.status !== "accepted" && (
                <div className="flex gap-2">
                  <Textarea
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    rows={2}
                    placeholder="Ask about this request…"
                    className="text-xs"
                    aria-label="Comment on this request"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!commentText.trim() || busy}
                    onClick={() =>
                      comment({
                        requestId: r._id as Id<"documentRequests">,
                        body: commentText,
                      })
                        .then(() => setCommentText(""))
                        .catch((err) =>
                          toast.error(
                            err instanceof Error ? err.message : "Failed.",
                          ),
                        )
                    }
                  >
                    Send
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
