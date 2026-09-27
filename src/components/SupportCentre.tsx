import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Headset, LifeBuoy, MessageSquare, Send } from "lucide-react";

// =====================================================================
// CJ GLOBAL — customer support centre (shared surface).
//
// Used from the client portal, the staff portal and the console. Any
// authenticated user can raise a ticket and follow it to resolution;
// platform operators triage from /owner. This component only exposes
// tickets the signed-in user submitted — the server enforces the same.
// =====================================================================

const KIND_LABELS: Record<string, string> = {
  general: "General",
  billing: "Billing & subscription",
  technical: "Technical issue",
  account: "Account access",
  ai_escalation: "AI handoff",
};

const PRIORITY_LABELS: Record<string, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

const STATUS_BADGE: Record<string, string> = {
  open: "bg-sky-100 text-sky-900 border-sky-200",
  in_progress: "bg-amber-50 text-amber-900 border-amber-200",
  resolved: "bg-emerald-50 text-emerald-900 border-emerald-200",
  closed: "bg-stone-100 text-stone-700 border-stone-200",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

function when(ts?: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------
// New-ticket dialog (also used for AI handoff with a locked kind)
// ---------------------------------------------------------------------

export function NewTicketDialog({
  open,
  onOpenChange,
  trigger,
  lockedKind,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  trigger?: React.ReactNode;
  lockedKind?: "ai_escalation";
}) {
  const submit = useMutation(api.platformOps.submitTicket);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<string>("general");
  const [priority, setPriority] = useState<string>("normal");
  const [busy, setBusy] = useState(false);

  const canSend =
    subject.trim().length >= 4 && body.trim().length >= 10 && !busy;

  const sendIt = async () => {
    setBusy(true);
    try {
      await submit({
        subject: subject.trim(),
        body: body.trim(),
        kind: (lockedKind ?? kind) as never,
        priority: priority as never,
      });
      toast.success(
        lockedKind
          ? "Handed off to human support. Operators see it in their queue now."
          : "Ticket raised. Track it here — our team replies in this thread.",
      );
      setSubject("");
      setBody("");
      setKind("general");
      setPriority("normal");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not raise the ticket.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">
            {lockedKind ? "Escalate to human support" : "Raise a support ticket"}
          </DialogTitle>
          <DialogDescription>
            {lockedKind
              ? "Your AI request stays on the matter; this hands the conversation to a platform operator who can see your description and the request reference."
              : "Tickets go to the Advokate platform team — not to your chamber. Only you and the platform team can read this thread."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="ticket-subject" className="text-xs">Subject</Label>
            <Input
              id="ticket-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief one-line summary"
              className="h-8 text-sm"
              maxLength={200}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ticket-body" className="text-xs">
              Describe the issue
            </Label>
            <Textarea
              id="ticket-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              maxLength={8000}
              placeholder={
                lockedKind
                  ? "What did the AI get wrong or miss? What would a useful answer contain?"
                  : "What happened, what you expected, and any error text you saw."
              }
              className="text-sm"
            />
          </div>
          {!lockedKind && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Category</Label>
                <Select value={kind} onValueChange={setKind}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(KIND_LABELS)
                      .filter(([k]) => k !== "ai_escalation")
                      .map(([k, label]) => (
                        <SelectItem key={k} value={k}>{label}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRIORITY_LABELS).map(([p, label]) => (
                      <SelectItem key={p} value={p}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!canSend} onClick={sendIt}>
            {lockedKind ? "Hand off to a human" : "Raise ticket"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// Ticket thread dialog: messages + customer reply/reopen
// ---------------------------------------------------------------------

function TicketThreadDialog({
  ticketId,
  open,
  onOpenChange,
}: {
  ticketId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const detail = useQuery(
    api.platformOps.getTicket,
    ticketId && open ? { ticketId: ticketId as never } : "skip",
  );
  const reply = useMutation(api.platformOps.addCustomerMessage);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const ticket = detail?.ticket;

  const sendIt = async () => {
    if (!ticketId || !body.trim()) return;
    setBusy(true);
    try {
      await reply({ ticketId: ticketId as never, body: body.trim() });
      setBody("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-base">
            {ticket?.subject ?? "Ticket"}
          </DialogTitle>
          {ticket && (
            <DialogDescription className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={STATUS_BADGE[ticket.status]}>
                {STATUS_LABEL[ticket.status]}
              </Badge>
              <span>{KIND_LABELS[ticket.kind] ?? ticket.kind}</span>
              <span>· {PRIORITY_LABELS[ticket.priority]} priority</span>
              <span>· raised {when(ticket.createdAt)}</span>
            </DialogDescription>
          )}
        </DialogHeader>

        {detail === undefined && <p className="text-sm text-muted-foreground">Opening…</p>}
        {detail === null && (
          <p className="text-sm text-muted-foreground">
            This ticket is not visible to your account.
          </p>
        )}

        {detail && (
          <div className="space-y-3">
            <ol className="space-y-2">
              {detail.messages.map((m) => (
                <li
                  key={m._id}
                  className={`rounded-md border p-3 text-sm ${
                    m.authorType === "operator"
                      ? "border-[#B68A45]/40 bg-[#B68A45]/[0.06]"
                      : "border-border bg-muted/40"
                  }`}
                >
                  <p className="type-label ink-faded mb-1 flex items-center gap-1.5">
                    {m.authorType === "operator" ? (
                      <Headset className="size-3" aria-hidden="true" />
                    ) : (
                      <MessageSquare className="size-3" aria-hidden="true" />
                    )}
                    {m.authorType === "operator" ? "Advokate support" : "You"} ·{" "}
                    {when(m.createdAt)}
                  </p>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                </li>
              ))}
            </ol>

            {ticket && ticket.status !== "closed" && (
              <div className="space-y-2 border-t border-border pt-3">
                <Label htmlFor="ticket-reply" className="text-xs">
                  {ticket.status === "resolved"
                    ? "Add a reply (re-opens the ticket)"
                    : "Add a reply"}
                </Label>
                <Textarea
                  id="ticket-reply"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={3}
                  maxLength={4000}
                  className="text-sm"
                  placeholder="Type your message…"
                />
                <div className="flex justify-end">
                  <Button size="sm" disabled={!body.trim() || busy} onClick={sendIt}>
                    <Send className="mr-1.5 size-3.5" aria-hidden="true" />
                    Send
                  </Button>
                </div>
              </div>
            )}
            {ticket?.status === "closed" && (
              <p className="border-t border-border pt-3 text-xs text-muted-foreground">
                This ticket is closed. Raise a new ticket if the issue returns.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// Main centre: my tickets + raise
// ---------------------------------------------------------------------

export function SupportCentre({ compact = false }: { compact?: boolean }) {
  const tickets = useQuery(api.platformOps.myTickets);
  const [threadOpen, setThreadOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const live = useMemo(
    () => (tickets ?? []).filter((t) => t.status !== "closed").length,
    [tickets],
  );

  return (
    <Card>
      <CardHeader className={compact ? "pb-3" : undefined}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 font-serif text-lg">
              <LifeBuoy className="size-4" aria-hidden="true" />
              Platform support
            </CardTitle>
            <CardDescription>
              Tickets for the Advokate platform team — billing, access,
              technical issues, or an AI answer you want a human to review.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setNewOpen(true)}>
            <Headset className="mr-1.5 size-3.5" aria-hidden="true" />
            Raise ticket
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {tickets === undefined ? (
          <p className="text-sm text-muted-foreground">Retrieving…</p>
        ) : tickets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tickets yet. Anything you raise appears here with the full
            conversation.
          </p>
        ) : (
          <div className="space-y-2">
            {tickets.slice(0, compact ? 3 : 20).map((t) => (
              <button
                key={t._id}
                type="button"
                onClick={() => {
                  setSelected(t._id);
                  setThreadOpen(true);
                }}
                className="block w-full rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-muted"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={STATUS_BADGE[t.status]}>
                    {STATUS_LABEL[t.status]}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {t.subject}
                  </span>
                  <span className="type-label ink-faded">{when(t.lastActivityAt)}</span>
                </span>
                {t.escalatedFromAiJobId && (
                  <span className="type-label mt-1 block ink-faded">
                    Escalated from an Advokate AI conversation
                  </span>
                )}
              </button>
            ))}
            {tickets.length > (compact ? 3 : 20) && (
              <p className="text-xs text-muted-foreground">
                Showing the most recent {compact ? 3 : 20} of {tickets.length} — {live} live.
              </p>
            )}
          </div>
        )}
      </CardContent>

      <NewTicketDialog open={newOpen} onOpenChange={setNewOpen} />
      <TicketThreadDialog
        ticketId={selected}
        open={threadOpen}
        onOpenChange={setThreadOpen}
      />
    </Card>
  );
}
