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
import { formatDateTimeIN } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import {
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FileText,
  FolderOpen,
  Gavel,
  MessageSquarePlus,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { SupportCentre } from "@/components/SupportCentre";

const MAX_UPDATE = 1000;

function AddUpdateDialog({ taskId }: { taskId: string }) {
  const post = useMutation(api.portals.staffTaskUpdate);
  const [body, setBody] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="gap-1.5">
          <MessageSquarePlus className="size-4" aria-hidden="true" />
          Update
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <p className="type-label ink-faded">Progress note</p>
          <DialogTitle className="font-serif text-2xl">
            Record a status update
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="e.g. Filed the affidavit at the registry counter; certified copy to be collected on Monday."
            className="min-h-[100px]"
            maxLength={MAX_UPDATE}
          />
          <Button
            className="w-full"
            disabled={busy}
            onClick={async () => {
              if (!body.trim()) {
                toast.error("Write the update first.");
                return;
              }
              setBusy(true);
              try {
                await post({ taskId: taskId as never, body });
                toast.success("Update recorded.");
                setBody("");
                setOpen(false);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Failed.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "Record update"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AttachEvidenceDialog({ taskId }: { taskId: string }) {
  const generate = useMutation(api.portals.staffGenerateUploadUrl);
  const attach = useMutation(api.portals.staffAttachAcknowledgement);
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="gap-1.5">
          <Upload className="size-4" aria-hidden="true" />
          Evidence
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <p className="type-label ink-faded">Completion evidence</p>
          <DialogTitle className="font-serif text-2xl">
            Attach acknowledgement
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Filing receipts, delivery proofs or other completion evidence.
          </p>
          <input
            ref={fileInput}
            type="file"
            className="w-full text-sm"
            aria-label="Choose evidence file"
          />
          <Button
            className="w-full"
            disabled={busy}
            onClick={async () => {
              const file = fileInput.current?.files?.[0];
              if (!file) {
                toast.error("Choose a file first.");
                return;
              }
              setBusy(true);
              try {
                const url = await generate({});
                const res = await fetch(url, {
                  method: "POST",
                  headers: {
                    "Content-Type": file.type || "application/octet-stream",
                  },
                  body: file,
                });
                const { storageId } = (await res.json()) as {
                  storageId: string;
                };
                await attach({
                  taskId: taskId as never,
                  name: file.name,
                  storageId: storageId as never,
                });
                toast.success("Evidence attached.");
                setOpen(false);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Upload failed.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Uploading…" : "Attach evidence"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function StaffPortal() {
  const data = useQuery(api.portals.staffDashboard);
  const completeTask = useMutation(api.portals.completeTask);
  const [now] = useState(() => Date.now());

  if (data === undefined) {
    return (
      <ChamberShell subtitle="Staff Portal" title="Your assigned work">
        <p className="text-sm text-muted-foreground">Fetching your tasks…</p>
      </ChamberShell>
    );
  }

  const pending = data.tasks.filter((t) => t.status === "pending");
  const done = data.tasks.filter((t) => t.status === "done");
  const dueSoon = pending.filter((t) => t.dueAt !== null && t.dueAt < now);

  return (
    <ChamberShell subtitle="Staff Portal" title="Your assigned work">
      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <section aria-label="Assigned tasks">
          <p className="type-label ink-faded flex items-center gap-2">
            <ClipboardList className="size-3.5" /> Assigned work
            {dueSoon.length > 0 && (
              <span className="text-[#8a6a33]">· {dueSoon.length} past due</span>
            )}
          </p>
          <div className="mt-3 space-y-3">
            {pending.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-10 text-center text-sm ink-faded">
                  Nothing assigned right now. New filing, service or delivery
                  work will appear here.
                </CardContent>
              </Card>
            ) : (
              pending.map((t) => {
                const overdue = t.dueAt !== null && t.dueAt < now;
                return (
                  <div key={t._id} className="rule-frame rounded-lg p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{t.title}</p>
                        <p className="type-label mt-1 ink-faded">
                          {t.matterReference} ·{" "}
                          {t.dueAt
                            ? `Due ${formatDateTimeIN(t.dueAt)}`
                            : "No due date"}
                          {overdue ? " · past due" : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <AddUpdateDialog taskId={t._id} />
                        <AttachEvidenceDialog taskId={t._id} />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            try {
                              await completeTask({ taskId: t._id as never });
                              toast.success("Marked done.");
                            } catch (err) {
                              toast.error(
                                err instanceof Error ? err.message : "Failed.",
                              );
                            }
                          }}
                        >
                          <CheckCircle2 className="mr-1.5 size-4" />
                          Done
                        </Button>
                      </div>
                    </div>
                    {(t.updates.length > 0 || t.acknowledgements.length > 0) && (
                      <div className="mt-3 border-t border-border pt-3">
                        {t.updates.map((u, i) => (
                          <p
                            key={`${t._id}-u-${i}`}
                            className="text-xs text-muted-foreground"
                          >
                            <span className="type-label ink-faded">
                              {formatDateTimeIN(u.at)}:
                            </span>{" "}
                            {u.body}
                          </p>
                        ))}
                        {t.acknowledgements.map((a, i) => (
                          <p
                            key={`${t._id}-a-${i}`}
                            className="type-label mt-1 flex items-center gap-1.5 text-emerald-700"
                          >
                            <FileText className="size-3.5" /> {a.name}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {done.length > 0 && (
              <details className="rule-frame rounded-lg p-4">
                <summary className="cursor-pointer text-sm font-medium">
                  Completed ({done.length})
                </summary>
                <ul className="mt-3 space-y-2">
                  {done.map((t) => (
                    <li key={t._id} className="text-sm text-muted-foreground">
                      ✓ {t.title}
                      {t.acknowledgements.length > 0 && (
                        <span className="type-label ml-2 ink-faded">
                          {t.acknowledgements.length} file
                          {t.acknowledgements.length > 1 ? "s" : ""} attached
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </section>

        <div className="space-y-8">
          <section aria-label="Permitted matter references">
            <p className="type-label ink-faded flex items-center gap-2">
              <FolderOpen className="size-3.5" /> Matters involved
            </p>
            <div className="mt-3 space-y-2">
              {data.matters.length === 0 ? (
                <p className="text-sm ink-faded">—</p>
              ) : (
                data.matters.map((m) => (
                  <div key={m._id} className="rule-frame rounded-lg p-3">
                    <p className="text-sm font-medium">{m.title}</p>
                    <p className="type-label mt-0.5 ink-faded">
                      {m.reference}
                      {m.court ? ` · ${m.court}` : ""}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>

          <section aria-label="Upcoming hearings on your matters">
            <p className="type-label ink-faded flex items-center gap-2">
              <Gavel className="size-3.5" /> Hearings on your matters
            </p>
            <div className="mt-3 space-y-2">
              {data.hearings.length === 0 ? (
                <p className="text-sm ink-faded">—</p>
              ) : (
                data.hearings.map((h) => (
                  <div key={h._id} className="rule-frame rounded-lg p-3">
                    <p className="text-sm">{h.title}</p>
                    <p className="type-label mt-0.5 flex items-center gap-1.5 ink-faded">
                      <CalendarClock className="size-3.5" />
                      {h.matterReference} · {formatDateTimeIN(h.at)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>

          <section aria-label="Documents shared with staff">
            <p className="type-label ink-faded flex items-center gap-2">
              <FileText className="size-3.5" /> Authorized documents
            </p>
            <div className="mt-3 space-y-2">
              {data.documents.length === 0 ? (
                <p className="text-sm ink-faded">
                  No documents have been shared for your work.
                </p>
              ) : (
                data.documents.slice(0, 10).map((d) => (
                  <div key={d._id} className="rule-frame rounded-lg p-3">
                    <p className="truncate text-sm">{d.name}</p>
                    <p className="type-label mt-0.5 ink-faded">
                      {formatDateTimeIN(d.createdAt)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>

      {/* CJ GLOBAL — platform support tickets (raised by, not chamber work) */}
      <section aria-label="Platform support" className="mt-10" id="support">
        <SupportCentre compact />
      </section>
    </ChamberShell>
  );
}
