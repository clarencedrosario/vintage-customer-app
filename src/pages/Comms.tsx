import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ChamberShell } from "@/components/ChamberShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Bell,
  CheckCheck,
  Inbox,
  Mail,
  MessageSquare,
  MessagesSquare,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { formatDateTimeIN } from "@/lib/format";

type ThreadSummary = {
  _id: Id<"conversations">;
  subject: string;
  scope: "matter" | "internal";
  matterId: Id<"matters"> | undefined;
  matterRef: string | null;
  matterTitle: string | null;
  lastMessageAt: number | undefined;
  unreadCount: number;
  canSend: boolean;
};

type MessageRow = {
  _id: Id<"messages">;
  body: string;
  senderKind: "member" | "client" | "system";
  senderName: string;
  createdAt: number;
  attachments: Array<{ documentId: Id<"matterDocuments">; name: string }>;
  invoiceRef: string | null;
  invoiceAmountMinor: number | null;
  kind: string;
};

export default function Comms() {
  const threads: ThreadSummary[] = useQuery(api.conversations.listForMe, {}) ?? [];
  const templates = useQuery(api.comm.listTemplates) ?? [];
  const prefs = useQuery(api.comm.myPreferences);
  const notifications = useQuery(api.conversations.notificationFeed) ?? [];
  const matters = useQuery(api.matters.list) ?? [];
  const [tab, setTab] = useState<"threads" | "outbox" | "notifications" | "whatsapp" | "preferences">("threads");
  const [openId, setOpenId] = useState<Id<"conversations"> | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);

  const detail = useQuery(
    api.conversations.detail,
    openId ? { conversationId: openId } : "skip",
  );

  return (
    <ChamberShell subtitle="Communications" title="The correspondence desk">
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="threads">Threads</TabsTrigger>
          <TabsTrigger value="outbox">Client messages</TabsTrigger>
          <TabsTrigger value="notifications">Delivery log</TabsTrigger>
          <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
        </TabsList>

        <TabsContent value="threads">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm ink-faded">
              Matter threads include the client. Internal threads stay between
              colleagues.
            </p>
            <Button size="sm" onClick={() => setNewOpen(true)}>
              <Plus className="size-4" /> New thread
            </Button>
          </div>
          <div className="mt-4 grid gap-6 lg:grid-cols-[380px_1fr]">
            <div className="space-y-2">
              {threads.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-10 text-center text-sm ink-faded">
                    No conversations yet. Start one from a matter file or with
                    “New thread”.
                  </CardContent>
                </Card>
              ) : (
                threads.map((t: ThreadSummary) => (
                  <button
                    key={t._id}
                    onClick={() => setOpenId(t._id)}
                    className={`rule-frame w-full cursor-pointer rounded-lg p-3 text-left transition-colors hover:bg-[#F7F5EF] ${
                      openId === t._id ? "border-[#B68A45] bg-[#F7F5EF]" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">
                        {t.subject}
                      </span>
                      {t.unreadCount > 0 && (
                        <Badge className="bg-[#0F172A] text-white">
                          {t.unreadCount}
                        </Badge>
                      )}
                    </div>
                    <p className="type-label mt-1 ink-faded">
                      {t.scope === "matter"
                        ? `Matter ${t.matterRef ?? ""}`
                        : "Internal"}{" "}
                      ·{" "}
                      {t.lastMessageAt
                        ? formatDateTimeIN(t.lastMessageAt)
                        : "just opened"}
                    </p>
                  </button>
                ))
              )}
            </div>

            <div>
              {detail === undefined ? null : detail === null ? (
                <Card className="border-dashed">
                  <CardContent className="py-16 text-center text-sm ink-faded">
                    Select a conversation to read it.
                  </CardContent>
                </Card>
              ) : (
                <ThreadDetail
                  detail={detail}
                  onUpdate={() => setUpdateOpen(true)}
                />
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="outbox">
          <OutboxDesk matters={matters} />
        </TabsContent>

        <TabsContent value="notifications">
          <p className="text-sm ink-faded">
            Every outbound email and WhatsApp message, with delivery status
            reported by the provider.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left type-label ink-faded">
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Channel</th>
                  <th className="py-2 pr-3">Category</th>
                  <th className="py-2 pr-3">Recipient</th>
                  <th className="py-2 pr-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {notifications.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center ink-faded">
                      Nothing sent yet.
                    </td>
                  </tr>
                ) : (
                  notifications.map((n) => (
                    <tr key={n._id} className="border-b last:border-0">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {formatDateTimeIN(n.createdAt)}
                      </td>
                      <td className="py-2 pr-3 capitalize">{n.channel}</td>
                      <td className="py-2 pr-3">{n.category}</td>
                      <td className="py-2 pr-3">{n.recipient}</td>
                      <td className="py-2 pr-3">
                        <StatusBadge status={n.status} reason={n.failureReason} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="whatsapp">
          <p className="text-sm ink-faded">
            WhatsApp messages can only be sent from Meta-approved templates to
            recipients who have opted in. The chamber manages templates; clients
            opt in from their portal preferences.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => (
              <Card key={t.name}>
                <CardContent className="p-4">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <ShieldCheck className="size-4 text-[#8a6a33]" />
                    {t.label}
                  </p>
                  <p className="type-label mt-2 ink-faded">
                    Template <code>{t.name}</code> · {t.languageCode}
                  </p>
                  <ul className="mt-2 list-disc pl-4 text-xs ink-faded">
                    {t.params.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs ink-faded">
                    Sent from: hearing reminders, invoice reminders, client
                    updates.
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="preferences">
          <PreferencesPanel prefs={prefs} />
        </TabsContent>
      </Tabs>

      <NewThreadDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        matters={matters.map((m) => ({ _id: m._id, reference: m.reference, title: m.title }))}
        onCreated={(id) => setOpenId(id)}
      />
      <ClientUpdateDialog
        open={updateOpen}
        onOpenChange={setUpdateOpen}
        matterId={detail?.matterId ?? null}
        onSent={(conversationId) => setOpenId(conversationId)}
      />
    </ChamberShell>
  );
}

// ---------------------------------------------------------------------

function StatusBadge({ status, reason }: { status: string; reason?: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    queued: { label: "Queued", cls: "bg-muted text-muted-foreground" },
    sent: { label: "Sent", cls: "bg-[#0F172A] text-white" },
    delivered: { label: "Delivered", cls: "bg-emerald-700 text-white" },
    read: { label: "Read", cls: "bg-emerald-800 text-white" },
    failed: { label: "Failed", cls: "bg-red-800 text-white" },
  };
  const s = map[status] ?? map.queued!;
  return (
    <span title={reason ?? undefined} className={`inline-block rounded px-2 py-0.5 text-xs ${s.cls}`}>
      {s.label}
    </span>
  );
}

// ---------------------------------------------------------------------

function ThreadDetail({
  detail,
  onUpdate,
}: {
  detail: {
    _id: Id<"conversations">;
    subject: string;
    scope: "matter" | "internal";
    matterId: Id<"matters"> | undefined;
    messages: MessageRow[];
    participants: Array<{ userId: Id<"users">; name: string; role: string }>;
    myUnread: number;
  };
  onUpdate: () => void;
}) {
  const markRead = useMutation(api.conversations.markRead);
  const send = useMutation(api.conversations.sendMessage);
  const notify = useMutation(api.conversations.notifyParticipantsByEmail);
  const setAuto = useMutation(api.comm.setThreadAutoSend);
  const threadInfo = useQuery(
    api.comm.prepareClientUpdate,
    detail.matterId ? { matterId: detail.matterId } : "skip",
  );
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const canPost = detail.scope === "matter" || detail.scope === "internal";

  const doSend = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      await send({ conversationId: detail._id, body });
      setBody("");
      await markRead({ conversationId: detail._id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
          <div>
            <h3 className="font-serif text-lg font-semibold">{detail.subject}</h3>
            <p className="type-label ink-faded">
              {detail.scope === "matter" ? "Matter thread" : "Internal thread"} ·{" "}
              {detail.participants.map((p) => p.name).join(", ")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {detail.matterId && threadInfo && (
              <Button size="sm" variant="outline" onClick={onUpdate}>
                <Send className="size-3.5" /> Client update
              </Button>
            )}
            {detail.myUnread > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => markRead({ conversationId: detail._id })}
              >
                <RefreshCw className="size-3.5" /> Mark read ({detail.myUnread})
              </Button>
            )}
          </div>
        </div>

        {detail.scope === "matter" && detail.matterId && threadInfo && (
          <div className="flex items-center justify-between gap-3 border-b bg-[#F7F5EF]/60 px-4 py-2">
            <p className="text-xs ink-faded">
              Auto-send approved client updates to this thread
            </p>
            <Switch
              checked={threadInfo.autoSendUpdates === true}
              onCheckedChange={async (on) => {
                try {
                  await setAuto({ conversationId: detail._id, enabled: on });
                  toast.success(on ? "Auto-send rule recorded." : "Auto-send rule removed.");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not update.");
                }
              }}
            />
          </div>
        )}

        <div className="max-h-[480px] space-y-3 overflow-y-auto p-4">
          {detail.messages.map((m) => (
            <div
              key={m._id}
              className={`rule-frame max-w-2xl rounded-lg p-3 ${
                m.senderKind === "client" ? "ml-auto border-[#B68A45]/40" : ""
              } ${m.senderKind === "system" ? "border-dashed bg-[#F7F5EF]/50" : ""}`}
            >
              {m.kind !== "message" && (
                <p className="type-label mb-1 text-[#8a6a33]">
                  {m.kind === "client_update" ? "Client update" : "Reminder"}
                </p>
              )}
              <p className="text-sm whitespace-pre-wrap">{m.body}</p>
              {m.attachments.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {m.attachments.map((a) => (
                    <li key={a.documentId} className="type-label text-[#8a6a33]">
                      📎 {a.name}
                    </li>
                  ))}
                </ul>
              )}
              {m.invoiceRef && (
                <p className="type-label mt-2 text-[#8a6a33]">
                  Invoice {m.invoiceRef}
                  {m.invoiceAmountMinor !== null
                    ? ` · Rs. ${(m.invoiceAmountMinor / 100).toLocaleString("en-IN")}`
                    : ""}
                </p>
              )}
              <p className="type-label mt-1 ink-faded">
                {m.senderName} · {formatDateTimeIN(m.createdAt)}
              </p>
            </div>
          ))}
        </div>

        {canPost && (
          <div className="space-y-2 border-t p-4">
            <Textarea
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write a message…"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={detail.messages.length === 0}
                onClick={async () => {
                  try {
                    const r = await notify({ conversationId: detail._id, messageId: detail.messages[detail.messages.length - 1]!._id });
                    toast.success(`Emailed ${r.queued} participant(s).`);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Could not notify.");
                  }
                }}
              >
                <Mail className="size-3.5" /> Email thread to participants
              </Button>
              <Button size="sm" disabled={sending || !body.trim()} onClick={doSend}>
                <Send className="size-3.5" /> Send
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------

function NewThreadDialog({
  open,
  onOpenChange,
  matters,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  matters: Array<{ _id: Id<"matters">; reference: string; title: string }>;
  onCreated: (id: Id<"conversations">) => void;
}) {
  const create = useMutation(api.conversations.createConversation);
  const [scope, setScope] = useState<"matter" | "internal">("matter");
  const [subject, setSubject] = useState("");
  const [matterId, setMatterId] = useState<string>("");
  const [includeClient, setIncludeClient] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await create({
        scope,
        subject,
        matterId: scope === "matter" && matterId ? (matterId as Id<"matters">) : undefined,
        includeClient: scope === "matter" ? includeClient : false,
      });
      toast.success("Thread created.");
      onOpenChange(false);
      setSubject("");
      setMatterId("");
      setIncludeClient(false);
      onCreated(r.conversationId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create thread.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">Start a conversation</DialogTitle>
          <DialogDescription>
            Matter threads can include the client's portal identity. Internal
            threads are colleague-only.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Thread type</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as "matter" | "internal")}>
              <SelectTrigger className="cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="matter">
                  <MessagesSquare className="mr-2 inline size-3.5" /> Matter thread
                </SelectItem>
                <SelectItem value="internal">
                  <MessageSquare className="mr-2 inline size-3.5" /> Internal thread
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {scope === "matter" && (
            <div className="space-y-2">
              <Label>Matter</Label>
              <Select value={matterId} onValueChange={setMatterId}>
                <SelectTrigger className="cursor-pointer">
                  <SelectValue placeholder="Choose a matter" />
                </SelectTrigger>
                <SelectContent>
                  {matters.map((m) => (
                    <SelectItem key={m._id} value={m._id}>
                      {m.reference} — {m.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label>Subject</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Hearing preparation — next steps"
            />
          </div>
          {scope === "matter" && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="include-client"
                checked={includeClient}
                onCheckedChange={(v) => setIncludeClient(v === true)}
              />
              <Label htmlFor="include-client" className="cursor-pointer text-sm">
                Include the client (their verified portal identity)
              </Label>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={busy || !subject.trim() || (scope === "matter" && !matterId)} onClick={submit}>
              Create thread
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------

function ClientUpdateDialog({
  open,
  onOpenChange,
  matterId,
  onSent,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  matterId: Id<"matters"> | null;
  onSent: (conversationId: Id<"conversations">) => void;
}) {
  const send = useMutation(api.comm.sendClientUpdate);
  const [text, setText] = useState("");
  const [whatsapp, setWhatsapp] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!matterId) return;
    setBusy(true);
    try {
      const r = await send({
        matterId,
        text,
        whatsappAlso: whatsapp,
        autoAuthorized: true,
      });
      toast.success(
        r.whatsappQueued
          ? "Update posted and queued on WhatsApp."
          : "Update posted to the client thread.",
      );
      onOpenChange(false);
      setText("");
      onSent(r.conversationId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send update.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">Post a client update</DialogTitle>
          <DialogDescription>
            Only the text you write here is sent — nothing internal is pulled
            in. Updates go out after the thread's approval rule allows them.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Textarea
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What the client should know about their matter today…"
          />
          <div className="flex items-center gap-2">
            <Checkbox
              id="wa-also"
              checked={whatsapp}
              onCheckedChange={(v) => setWhatsapp(v === true)}
            />
            <Label htmlFor="wa-also" className="cursor-pointer text-sm">
              Also send on WhatsApp (case_update template, if opted in)
            </Label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={busy || !text.trim() || !matterId} onClick={submit}>
              <Bell className="size-3.5" /> Post update
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------

function PreferencesPanel({
  prefs,
}: {
  prefs:
    | {
        emailEnabled: boolean;
        whatsappEnabled: boolean;
        whatsappNumber?: string;
        hearingReminders: boolean;
        invoiceReminders: boolean;
        clientUpdates: boolean;
      }
    | null
    | undefined;
}) {
  const save = useMutation(api.comm.setPreferences);
  const [email, setEmail] = useState(prefs?.emailEnabled ?? true);
  const [wa, setWa] = useState(prefs?.whatsappEnabled ?? false);
  const [waNumber, setWaNumber] = useState(prefs?.whatsappNumber ?? "");
  const [hearing, setHearing] = useState(prefs?.hearingReminders ?? true);
  const [invoice, setInvoice] = useState(prefs?.invoiceReminders ?? true);
  const [updates, setUpdates] = useState(prefs?.clientUpdates ?? true);

  if (prefs === undefined) return null;

  return (
    <div className="max-w-xl space-y-4">
      <p className="text-sm ink-faded">
        Choose how the chamber may reach you. WhatsApp requires your explicit
        opt-in and a number in international format.
      </p>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="p-email" className="cursor-pointer">Email notifications</Label>
          <Switch id="p-email" checked={email} onCheckedChange={setEmail} />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="p-wa" className="cursor-pointer">WhatsApp messages</Label>
          <Switch id="p-wa" checked={wa} onCheckedChange={setWa} />
        </div>
        {wa && (
          <div className="space-y-2">
            <Label htmlFor="p-wa-num">WhatsApp number</Label>
            <Input
              id="p-wa-num"
              value={waNumber}
              onChange={(e) => setWaNumber(e.target.value)}
              placeholder="919876543210"
            />
          </div>
        )}
        <div className="flex items-center justify-between">
          <Label htmlFor="p-hearing" className="cursor-pointer">Hearing reminders</Label>
          <Switch id="p-hearing" checked={hearing} onCheckedChange={setHearing} />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="p-inv" className="cursor-pointer">Invoice reminders</Label>
          <Switch id="p-inv" checked={invoice} onCheckedChange={setInvoice} />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="p-upd" className="cursor-pointer">Client updates</Label>
          <Switch id="p-upd" checked={updates} onCheckedChange={setUpdates} />
        </div>
      </div>
      <Button
        onClick={async () => {
          try {
            await save({
              emailEnabled: email,
              whatsappEnabled: wa,
              whatsappNumber: waNumber || undefined,
              hearingReminders: hearing,
              invoiceReminders: invoice,
              clientUpdates: updates,
            });
            toast.success("Preferences saved.");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not save.");
          }
        }}
      >
        Save preferences
      </Button>
    </div>
  );
}

// =====================================================================
// FEATURE 6 — Client communication approval: the outbox desk.
// =====================================================================

type OutboxRow = {
  _id: Id<"commOutbox">;
  matterId?: Id<"matters">;
  matterReference: string | null;
  category: string;
  channel: "email" | "whatsapp" | "in_thread";
  recipientDisplay: string;
  subject: string;
  status: string;
  requiresApproval: boolean;
  currentVersion: number;
  approvedVersion?: number;
  approvedByName?: string;
  reviewNote?: string;
  sourceLabel?: string;
  attempts: number;
  lastError?: string;
  createdByName?: string;
};

const OUTBOX_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Awaiting approval",
  approved: "Approved — ready to send",
  rejected: "Rejected",
  returned: "Returned with comments",
  queued: "Queued",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  failed: "Failed",
  cancelled: "Cancelled",
  awaiting_configuration: "Awaiting provider configuration",
};

function OutboxStatusBadge({ status }: { status: string }) {
  if (status === "failed" || status === "rejected") {
    return <Badge className="bg-[#7a1f1f] text-white">{OUTBOX_STATUS_LABELS[status]}</Badge>;
  }
  if (["awaiting_configuration", "pending_approval", "returned"].includes(status)) {
    return <Badge className="bg-[#8a6a33] text-white">{OUTBOX_STATUS_LABELS[status]}</Badge>;
  }
  if (["sent", "delivered", "read"].includes(status)) {
    return <Badge className="bg-[#2f4f3a] text-white">{OUTBOX_STATUS_LABELS[status]}</Badge>;
  }
  return <Badge variant="outline">{OUTBOX_STATUS_LABELS[status] ?? status}</Badge>;
}

function OutboxDesk({
  matters,
}: {
  matters: Array<{ _id: Id<"matters">; reference: string; title: string }>;
}) {
  const rows = useQuery(api.commOutbox.list) as OutboxRow[] | undefined;
  const caps = useQuery(api.workspace.myCapabilities);
  const policy = useQuery(api.commOutbox.categoryPolicy) as
    | Array<{ category: string; requiresApproval: boolean; overridden: boolean }>
    | undefined;
  const canApprove = caps?.capabilities.includes("matter.edit") ?? false;
  const canCompose = (caps?.capabilities.includes("note.write") ?? false) || canApprove;

  const [composeOpen, setComposeOpen] = useState(false);
  const [detailId, setDetailId] = useState<Id<"commOutbox"> | null>(null);
  const detail = useQuery(
    api.commOutbox.detail,
    detailId ? { outboxId: detailId } : "skip",
  );

  const queue = useMutation(api.commOutbox.queue);
  const attempt = useMutation(api.commOutbox.attemptDelivery);
  const retry = useMutation(api.commOutbox.retry);
  const cancel = useMutation(api.commOutbox.cancel);
  const approve = useMutation(api.commOutbox.approve);
  const rejectOrReturn = useMutation(api.commOutbox.rejectOrReturn);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not go through.");
    }
  };

  const pending = (rows ?? []).filter((r) => r.status === "pending_approval");
  const rest = (rows ?? []).filter((r) => r.status !== "pending_approval");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm ink-faded">
          Messages prepared for the client. Legal and substantive categories
          need a lawyer's approval before anything leaves the chamber — the
          exact approved wording is preserved and later edits require fresh
          approval.
        </p>
        {canCompose && (
          <Button size="sm" onClick={() => setComposeOpen(true)}>
            <Plus className="size-4" /> Prepare message
          </Button>
        )}
      </div>

      {pending.length > 0 && (
        <section>
          <h2 className="mb-2 font-serif text-lg">
            Awaiting approval <span className="text-sm ink-faded">({pending.length})</span>
          </h2>
          <div className="space-y-2">
            {pending.map((r) => (
              <Card key={r._id}>
                <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <OutboxStatusBadge status={r.status} />
                      <span className="text-xs uppercase tracking-wide ink-faded">
                        {r.category.replace(/_/g, " ")} · {r.channel.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p className="mt-1 truncate font-medium">{r.subject}</p>
                    <p className="text-sm ink-faded">
                      {r.matterReference ? `${r.matterReference} · ` : ""}v{r.currentVersion} · prepared by {r.createdByName ?? "staff"}
                      {r.sourceLabel ? ` · from ${r.sourceLabel}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => setDetailId(r._id)}>
                      Open
                    </Button>
                    {canApprove && (
                      <>
                        <Button
                          size="sm"
                          onClick={() =>
                            act(() => approve({ outboxId: r._id }), "Approved — ready to queue.")
                          }
                        >
                          <CheckCheck className="mr-1 size-3.5" /> Approve
                        </Button>
                        <ReturnDialog row={r} decide={rejectOrReturn} act={act} />
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-serif text-lg">All messages</h2>
        {rows === undefined && <p className="text-sm ink-faded">Loading the outbox…</p>}
        {rows !== undefined && rows.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center text-sm ink-faded">
              <Inbox className="mx-auto mb-3 size-8" />
              No client messages yet. Prepare one with “Prepare message” —
              approval flows here before delivery.
            </CardContent>
          </Card>
        )}
        <div className="space-y-2">
          {rest.map((r) => (
            <Card key={r._id}>
              <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <OutboxStatusBadge status={r.status} />
                    <span className="text-xs uppercase tracking-wide ink-faded">
                      {r.category.replace(/_/g, " ")} · v{r.currentVersion}
                    </span>
                  </div>
                  <p className="mt-1 truncate font-medium">{r.subject}</p>
                  <p className="text-sm ink-faded">
                    {r.matterReference ? `${r.matterReference} · ` : ""}
                    to {r.recipientDisplay}
                    {r.lastError ? ` · ${r.lastError}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => setDetailId(r._id)}>
                    Open
                  </Button>
                  {r.status === "approved" && (
                    <Button
                      size="sm"
                      onClick={() =>
                        act(async () => {
                          await queue({ outboxId: r._id });
                          await attempt({ outboxId: r._id });
                        }, "Message dispatched for delivery.")
                      }
                    >
                      <Send className="mr-1 size-3.5" /> Send
                    </Button>
                  )}
                  {(r.status === "failed" || r.status === "awaiting_configuration") && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        act(async () => {
                          await retry({ outboxId: r._id });
                          await attempt({ outboxId: r._id });
                        }, "Retrying delivery.")
                      }
                    >
                      <RefreshCw className="mr-1 size-3.5" /> Retry
                    </Button>
                  )}
                  {["draft", "pending_approval", "approved", "queued"].includes(r.status) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() =>
                        act(() => cancel({ outboxId: r._id }), "Message cancelled.")
                      }
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <OutboxDetailDialog
        detail={detail}
        canApprove={canApprove}
        onClose={() => setDetailId(null)}
        act={act}
        approve={approve}
        rejectOrReturn={rejectOrReturn}
      />
      <ComposeDialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        matters={matters}
        policy={policy}
      />
    </div>
  );
}

function ReturnDialog({
  row,
  decide,
  act,
}: {
  row: OutboxRow;
  decide: ReturnType<typeof useMutation<typeof api.commOutbox.rejectOrReturn>>;
  act: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [decision, setDecision] = useState<"rejected" | "returned">("returned");
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive"
        onClick={() => setOpen(true)}
      >
        <ShieldAlert className="mr-1 size-3.5" /> Review
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">Review decision</DialogTitle>
            <DialogDescription>
              Return sends it back to the author with your comments; reject
              closes it. Both are kept in the record.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select
              value={decision}
              onValueChange={(v) => setDecision(v as "rejected" | "returned")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="returned">Return with comments</SelectItem>
                <SelectItem value="rejected">Reject</SelectItem>
              </SelectContent>
            </Select>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Required — what should change, or why this is refused."
            />
          </div>
          <DialogFooter>
            <Button
              disabled={!note.trim()}
              onClick={() =>
                act(async () => {
                  await decide({ outboxId: row._id, decision, note: note.trim() });
                  setNote("");
                  setOpen(false);
                }, decision === "rejected" ? "Message rejected." : "Message returned with comments.")
              }
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function OutboxDetailDialog({
  detail,
  canApprove,
  onClose,
  act,
  approve,
  rejectOrReturn,
}: {
  detail:
    | {
        row: {
          _id: Id<"commOutbox">;
          category: string;
          status: string;
          subject: string;
          currentVersion: number;
          approvedByName?: string;
          reviewNote?: string;
        };
        versions: Array<{
          version: number;
          subject: string;
          body: string;
          status: string;
          authorName?: string;
          reviewNote?: string;
        }>;
      }
    | null
    | undefined;
  canApprove: boolean;
  onClose: () => void;
  act: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
  approve: ReturnType<typeof useMutation<typeof api.commOutbox.approve>>;
  rejectOrReturn: ReturnType<typeof useMutation<typeof api.commOutbox.rejectOrReturn>>;
}) {
  return (
    <Dialog open={!!detail} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        {detail && (
          <>
            <DialogHeader>
              <DialogTitle className="font-serif">{detail.row.subject}</DialogTitle>
              <DialogDescription>
                {detail.row.category.replace(/_/g, " ")} ·{" "}
                {OUTBOX_STATUS_LABELS[detail.row.status] ?? detail.row.status} · v
                {detail.row.currentVersion}
                {detail.row.approvedByName
                  ? ` · approved by ${detail.row.approvedByName}`
                  : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {detail.row.reviewNote && (
                <p className="rounded border border-border bg-background p-2.5 text-sm">
                  Reviewer note: {detail.row.reviewNote}
                </p>
              )}
              <pre className="whitespace-pre-wrap rounded border border-border bg-background p-3 font-serif text-sm">
                {detail.versions[0]?.body ?? ""}
              </pre>
              <details>
                <summary className="cursor-pointer text-sm ink-faded">
                  Version history ({detail.versions.length})
                </summary>
                <ul className="mt-2 space-y-2 text-xs ink-faded">
                  {detail.versions.map((v) => (
                    <li key={v.version} className="rounded border border-border p-2">
                      <span className="font-medium">v{v.version}</span> — {v.status}
                      {v.authorName ? ` · by ${v.authorName}` : ""}
                      {v.reviewNote ? ` · “${v.reviewNote}”` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
            <DialogFooter>
              {detail.row.status === "pending_approval" && canApprove && (
                <>
                  <Button
                    onClick={() =>
                      act(() => approve({ outboxId: detail.row._id }), "Approved.")
                    }
                  >
                    Approve v{detail.row.currentVersion}
                  </Button>
                  <ReturnDialog
                    row={detail.row as unknown as OutboxRow}
                    decide={rejectOrReturn}
                    act={act}
                  />
                </>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ComposeDialog({
  open,
  onClose,
  matters,
  policy,
}: {
  open: boolean;
  onClose: () => void;
  matters: Array<{ _id: Id<"matters">; reference: string; title: string }>;
  policy:
    | Array<{ category: string; requiresApproval: boolean; overridden: boolean }>
    | undefined;
}) {
  const compose = useMutation(api.commOutbox.compose);
  const [matterId, setMatterId] = useState("");
  const [category, setCategory] = useState("matter_update");
  const [channel, setChannel] = useState<"email" | "whatsapp" | "in_thread">("in_thread");
  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const catPolicy = policy?.find((p) => p.category === category);
  const needsApproval = catPolicy?.requiresApproval ?? false;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">Prepare a client message</DialogTitle>
          <DialogDescription>
            {needsApproval
              ? "This category needs a lawyer's approval before delivery."
              : "This category can be sent without lawyer approval."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ob-matter">Matter (optional)</Label>
              <Select value={matterId} onValueChange={setMatterId}>
                <SelectTrigger id="ob-matter">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No linked matter</SelectItem>
                  {matters.map((m) => (
                    <SelectItem key={m._id} value={m._id}>
                      {m.reference} — {m.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="ob-category">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="ob-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    ["hearing_update", "Hearing update"],
                    ["deadline_reminder", "Deadline reminder"],
                    ["document_request", "Document request"],
                    ["matter_update", "Matter update"],
                    ["appointment", "Appointment"],
                    ["billing_notice", "Billing notice"],
                    ["secure_message", "Secure message"],
                  ].map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="ob-channel">Channel</Label>
              <Select
                value={channel}
                onValueChange={(v) => setChannel(v as typeof channel)}
              >
                <SelectTrigger id="ob-channel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in_thread">Client thread</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {channel !== "in_thread" && (
              <div>
                <Label htmlFor="ob-recipient">Recipient</Label>
                <Input
                  id="ob-recipient"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder={channel === "email" ? "client@example.com" : "+91…"}
                />
              </div>
            )}
          </div>
          <div>
            <Label htmlFor="ob-subject">Subject</Label>
            <Input
              id="ob-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="ob-body">Message</Label>
            <Textarea
              id="ob-body"
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={busy || !subject.trim() || !body.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await compose({
                  matterId:
                    matterId && matterId !== "none"
                      ? (matterId as Id<"matters">)
                      : undefined,
                  category,
                  channel,
                  recipient: recipient || undefined,
                  subject: subject.trim(),
                  body: body.trim(),
                });
                toast.success(
                  needsApproval
                    ? "Prepared — sent to the approval queue."
                    : "Prepared and approved for sending.",
                );
                setSubject("");
                setBody("");
                setRecipient("");
                onClose();
              } catch (e) {
                toast.error(
                  e instanceof Error ? e.message : "Could not prepare the message.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Prepare
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
