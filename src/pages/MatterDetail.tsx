import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BrandMark } from "@/components/BrandMark";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { MatterStatus } from "@/convex/schema";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  CircleDashed,
  Eye,
  Gavel,
  Lock,
  Paperclip,
  Scale,
  Send,
} from "lucide-react";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";

const STATUS_LABELS: Record<MatterStatus, string> = {
  received: "Received",
  under_review: "Under Review",
  engaged: "Engaged",
  closed: "Closed",
};

const STATUS_ICONS: Record<MatterStatus, typeof CircleDashed> = {
  received: CircleDashed,
  under_review: Eye,
  engaged: Gavel,
  closed: Lock,
};

const STATUS_ORDER: MatterStatus[] = [
  "received",
  "under_review",
  "engaged",
  "closed",
];

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

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
    <a href={url} target="_blank" rel="noopener noreferrer" className="type-label text-primary hover:underline">
      Open
    </a>
  );
}

export default function MatterDetail() {
  const { matterId: rawId } = useParams<{ matterId: string }>();
  const matterId = rawId as Id<"matters"> | undefined;
  const { user } = useAuth();
  const matter = useQuery(api.matters.getMine, matterId ? { matterId } : "skip");
  const messages = useQuery(
    api.matters.listMessages,
    matterId ? { matterId } : "skip",
  );
  const events = useQuery(
    api.matters.listEvents,
    matterId ? { matterId } : "skip",
  );
  const documents = useQuery(
    api.matters.listDocuments,
    matterId ? { matterId } : "skip",
  );
  const postMessage = useMutation(api.matters.postMessage);
  const getUploadUrl = useMutation(api.matters.generateDocumentUploadUrl);
  const attachDocument = useMutation(api.matters.attachDocument);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [docKind, setDocKind] = useState<string>("contract");
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const handleSend = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!matterId || !draft.trim()) return;
    setSending(true);
    try {
      await postMessage({ matterId, body: draft });
      setDraft("");
      toast.success("Correspondence delivered to counsel.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "The message could not be sent.",
      );
    } finally {
      setSending(false);
    }
  };

  const handleUpload = async (file: File) => {
    if (!matterId) return;
    setUploading(true);
    try {
      const uploadUrl = await getUploadUrl({ matterId });
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      const { storageId } = (await res.json()) as { storageId: string };
      await attachDocument({
        matterId,
        name: file.name,
        kind: docKind as "contract" | "correspondence",
        storageId: storageId as Id<"_storage"> | undefined,
      });
      toast.success("Document filed to the matter.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "The upload could not be filed.",
      );
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const openDocument = async (docId: Id<"matterDocuments">) => {
    try {
      const url = (await new Promise<unknown>((resolve, reject) => {
        // getDocumentUrl is a query; subscribe briefly via useQuery is not
        // possible imperatively, so resolve through the convex client.
        reject(new Error("__use_query__"));
        void resolve;
      })) as never;
      void url;
    } catch {
      // fallthrough: handled below via the Documents list links
    }
  };
  void openDocument;

  if (matter === undefined) {
    return (
      <div className="paper-texture flex min-h-screen items-center justify-center">
        <p className="type-label ink-faded">Retrieving the file…</p>
      </div>
    );
  }

  if (matter === null) {
    return (
      <div className="paper-texture flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
        <Scale className="size-10 text-primary/70" />
        <div>
          <h1 className="font-serif text-2xl font-semibold">
            This file is not on your ledger
          </h1>
          <p className="mt-2 text-sm ink-faded">
            The matter you seek either does not exist or belongs to another
            client’s record.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/dashboard">
            <ArrowLeft className="mr-2 size-4" />
            Return to the ledger
          </Link>
        </Button>
      </div>
    );
  }

  const statusIndex = STATUS_ORDER.indexOf(matter.status);

  return (
    <div className="paper-texture min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
          <BrandMark subtitle="Matter File" />
          <Button asChild variant="outline" size="sm">
            <Link to="/dashboard">
              <ArrowLeft className="mr-2 size-4" />
              Workspace
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-6 py-10">
        {/* Docket heading */}
        <div className="rule-frame bg-card p-8">
          <p className="type-label ink-faded">
            {matter.practiceArea} · Opened {formatDate(matter.createdAt)}
          </p>
          <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight">
            {matter.title}
          </h1>
          <div className="mt-5">
            <ol className="flex flex-wrap items-center gap-x-6 gap-y-2">
              {STATUS_ORDER.map((status, i) => {
                const Icon = STATUS_ICONS[status];
                const reached = i <= statusIndex;
                const current = i === statusIndex;
                return (
                  <li key={status} className="flex items-center gap-2">
                    <Icon
                      className={`size-4 ${reached ? "text-primary" : "text-muted-foreground/50"}`}
                    />
                    <span
                      className={`type-label ${
                        current
                          ? "text-foreground"
                          : reached
                            ? "ink-faded"
                            : "text-muted-foreground/50"
                      }`}
                    >
                      {STATUS_LABELS[status]}
                    </span>
                    {i < STATUS_ORDER.length - 1 && (
                      <span
                        className={`hidden h-px w-8 sm:inline-block ${
                          i < statusIndex ? "bg-primary/60" : "bg-border"
                        }`}
                      />
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
          <Separator className="my-6" />
          <p className="whitespace-pre-wrap leading-relaxed ink-faded">
            {matter.description}
          </p>
        </div>

        <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_340px]">
          {/* Correspondence + documents */}
          <section>
            <h2 className="font-serif text-2xl font-semibold">Correspondence</h2>
            <p className="mt-1 text-sm ink-faded">
              Secure messages between your company and the firm on this matter.
            </p>

            <div className="mt-6 space-y-4">
              {messages === undefined ? (
                <Card>
                  <CardContent className="py-8 text-center text-sm ink-faded">
                    Opening the correspondence book…
                  </CardContent>
                </Card>
              ) : messages.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-8 text-center text-sm ink-faded">
                    No correspondence yet. Write to counsel below.
                  </CardContent>
                </Card>
              ) : (
                messages.map((msg) => {
                  const isClient = msg.authorUserId === user?._id;
                  return (
                    <Card
                      key={msg._id}
                      className={
                        isClient
                          ? "ml-auto max-w-[85%] bg-secondary"
                          : "mr-auto max-w-[85%] bg-card"
                      }
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between gap-4">
                          <CardTitle className="type-label ink-faded">
                            {isClient ? "You, the Client" : "The Firm"}
                          </CardTitle>
                          <span className="type-label ink-faded">
                            {formatTime(msg.createdAt)}
                          </span>
                        </div>
                      </CardHeader>
                      <CardContent className="whitespace-pre-wrap text-[15px] leading-relaxed">
                        {msg.body}
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>

            <form onSubmit={handleSend} className="mt-6">
              <Textarea
                placeholder="Write to counsel…"
                className="min-h-[100px]"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={2000}
                disabled={sending}
              />
              <div className="mt-3 flex items-center justify-between">
                <p className="text-xs ink-faded">{draft.length}/2000</p>
                <Button type="submit" disabled={sending || !draft.trim()}>
                  <Send className="mr-2 size-4" />
                  {sending ? "Sealing…" : "Send"}
                </Button>
              </div>
            </form>

            {/* Documents */}
            <div className="mt-12">
              <h2 className="font-serif text-2xl font-semibold">Documents</h2>
              <p className="mt-1 text-sm ink-faded">
                File contracts and correspondence to this matter for counsel’s
                review.
              </p>

              <div className="mt-4 flex flex-wrap items-end gap-3">
                <div className="w-44">
                  <Select value={docKind} onValueChange={setDocKind}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contract">Contract</SelectItem>
                      <SelectItem value="correspondence">
                        Correspondence
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
                  disabled={uploading || !matterId}
                  onClick={() => fileInput.current?.click()}
                >
                  <Paperclip className="mr-2 size-4" />
                  {uploading ? "Filing…" : "Upload document"}
                </Button>
              </div>

              <ul className="mt-5 space-y-2">
                {documents === undefined ? null : documents.length === 0 ? (
                  <li className="text-sm ink-faded">No documents filed yet.</li>
                ) : (
                  documents.map((d) => (
                    <li
                      key={d._id}
                      className="flex items-center justify-between gap-4 border-b border-border pb-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm">{d.name}</p>
                        <p className="type-label ink-faded">
                          {d.kind} · {formatTime(d.createdAt)}
                        </p>
                      </div>
                      {d.storageId && (
                        <DocumentLink documentId={d._id} />
                      )}
                    </li>
                  ))
                )}
              </ul>
            </div>
          </section>

          {/* Docket (timeline) */}
          <aside>
            <h2 className="font-serif text-2xl font-semibold">The Docket</h2>
            <p className="mt-1 text-sm ink-faded">
              Every entry recorded on this file.
            </p>

            {events === undefined ? (
              <p className="mt-6 text-sm ink-faded">Consulting the docket…</p>
            ) : (
              <ol className="mt-6">
                {events.map((event, i) => (
                  <li key={event._id} className="relative flex gap-4 pb-6">
                    {i < events.length - 1 && (
                      <span className="absolute left-[5px] top-4 h-full w-px bg-border" />
                    )}
                    <span className="mt-1.5 size-[11px] shrink-0 rounded-full border border-primary/60 bg-background" />
                    <div className="min-w-0">
                      <p className="text-sm leading-snug">{event.detail}</p>
                      <p className="type-label mt-1 ink-faded">
                        {formatTime(event.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
