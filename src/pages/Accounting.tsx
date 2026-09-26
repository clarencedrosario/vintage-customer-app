import { ChamberShell } from "@/components/ChamberShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useMutation, useQuery } from "convex/react";
import { BookOpen, Plus, Scale } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatINR } from "@/lib/format";

/** Paise (integer) → rupee string for inputs showing stored values. */
function fromPaise(p: number): string {
  return (p / 100).toFixed(2);
}

type DraftLine = { accountId: string; rupees: string };

const EMPTY_LINE: DraftLine = { accountId: "", rupees: "" };

function LedgerLineRows({
  label,
  lines,
  setLines,
  accounts,
}: {
  label: string;
  lines: DraftLine[];
  setLines: (l: DraftLine[]) => void;
  accounts: { _id: Id<"accounts">; code: string; name: string }[];
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {lines.map((line, i) => (
        <div key={i} className="flex gap-2">
          <Select
            value={line.accountId}
            onValueChange={(v) => {
              const next = [...lines];
              next[i] = { ...next[i], accountId: v };
              setLines(next);
            }}
          >
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Account" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a._id} value={a._id}>
                  {a.code} — {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="w-32"
            type="number"
            step="0.01"
            min="0"
            placeholder="₹"
            value={line.rupees}
            onChange={(e) => {
              const next = [...lines];
              next[i] = { ...next[i], rupees: e.target.value };
              setLines(next);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setLines(lines.filter((_, j) => j !== i))}
            disabled={lines.length <= 1}
          >
            ×
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setLines([...lines, { ...EMPTY_LINE }])}
      >
        <Plus className="mr-1 h-3.5 w-3.5" /> Add line
      </Button>
    </div>
  );
}

function JournalDialog({
  accounts,
  open,
  onOpenChange,
}: {
  accounts: { _id: Id<"accounts">; code: string; name: string }[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const post = useMutation(api.finance.postJournal);
  const [entryDate, setEntryDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [memo, setMemo] = useState("");
  const [debits, setDebits] = useState<DraftLine[]>([{ ...EMPTY_LINE }]);
  const [credits, setCredits] = useState<DraftLine[]>([{ ...EMPTY_LINE }]);
  const [busy, setBusy] = useState(false);

  const toPaise = (rupees: string) =>
    rupees === "" ? 0 : Math.round(parseFloat(rupees) * 100);

  const totalDebits = debits.reduce((s, l) => s + toPaise(l.rupees), 0);
  const totalCredits = credits.reduce((s, l) => s + toPaise(l.rupees), 0);
  const balanced =
    totalDebits === totalCredits &&
    totalDebits > 0 &&
    debits.every((l) => l.accountId) &&
    credits.every((l) => l.accountId);

  const submit = async () => {
    setBusy(true);
    try {
      await post({
        entryDate,
        memo: memo || undefined,
        debits: debits
          .filter((l) => l.accountId && toPaise(l.rupees) > 0)
          .map((l) => ({
            accountId: l.accountId as Id<"accounts">,
            amountPaise: toPaise(l.rupees),
          })),
        credits: credits
          .filter((l) => l.accountId && toPaise(l.rupees) > 0)
          .map((l) => ({
            accountId: l.accountId as Id<"accounts">,
            amountPaise: toPaise(l.rupees),
          })),
      });
      toast.success("Journal posted.");
      onOpenChange(false);
      setMemo("");
      setDebits([{ ...EMPTY_LINE }]);
      setCredits([{ ...EMPTY_LINE }]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to post.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-serif">Post a journal</DialogTitle>
          <DialogDescription>
            Debits must equal credits exactly (whole paise). Posted entries are
            immutable — corrections are audited reversals.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="j-date">Date</Label>
              <Input
                id="j-date"
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="j-memo">Memo</Label>
              <Input
                id="j-memo"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="e.g. Office rent for September"
              />
            </div>
          </div>
          <LedgerLineRows label="Debits" lines={debits} setLines={setDebits} accounts={accounts} />
          <LedgerLineRows label="Credits" lines={credits} setLines={setCredits} accounts={accounts} />
          <div className="flex items-center justify-between text-sm">
            <span className="ink-faded">
              Dr {formatINR(totalDebits / 100)} · Cr {formatINR(totalCredits / 100)}
            </span>
            {totalDebits > 0 && (
              <Badge variant={balanced ? "default" : "destructive"}>
                {balanced ? "Balanced" : "Does not balance"}
              </Badge>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!balanced || busy}>
              {busy ? "Posting…" : "Post journal"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const add = useMutation(api.finance.addAccount);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("expense");
  const [clientFund, setClientFund] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">Add account</DialogTitle>
          <DialogDescription>
            Codes must be 3–6 digits and unique. Client-fund accounts are
            tracked separately from operating money.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="a-code">Code</Label>
              <Input
                id="a-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. 1030"
              />
            </div>
            <div className="space-y-1">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="asset">Asset</SelectItem>
                  <SelectItem value="liability">Liability</SelectItem>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="expense">Expense</SelectItem>
                  <SelectItem value="equity">Equity</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="a-name">Name</Label>
            <Input
              id="a-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Bank — Fixed Deposit"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={clientFund}
              onChange={(e) => setClientFund(e.target.checked)}
            />
            Client-fund account (segregated from operating money)
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await add({
                    code,
                    name,
                    type: type as
                      | "asset"
                      | "liability"
                      | "income"
                      | "expense"
                      | "equity",
                    clientFund: clientFund || undefined,
                  });
                  toast.success("Account added.");
                  onOpenChange(false);
                  setCode("");
                  setName("");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Failed.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Add
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Accounting() {
  const accounts = useQuery(api.finance.listAccounts);
  const tb = useQuery(api.finance.trialBalanceReport);
  const journals = useQuery(api.finance.listJournals, { limit: 50 });
  const seed = useMutation(api.finance.seedChartOfAccounts);

  const [journalOpen, setJournalOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [reversalOf, setReversalOf] = useState<Id<"journalEntries"> | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const reverse = useMutation(api.finance.reverseJournal);

  return (
    <ChamberShell subtitle="Double-entry books" title="Accounting">
      {accounts !== undefined && accounts.length === 0 && (
        <Card className="rule-frame mb-6 bg-card">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
            <div>
              <p className="text-sm font-medium">No chart of accounts yet</p>
              <p className="text-xs ink-faded">
                Seed the standard chart for an Indian law practice — you can
                add or edit accounts afterwards. Nothing posts to the ledger
                (including billing entries) until accounts exist.
              </p>
            </div>
            <Button
              onClick={async () => {
                try {
                  const r = await seed();
                  toast.success(
                    r.seeded
                      ? `Seeded ${r.count} accounts.`
                      : "Chart of accounts already exists.",
                  );
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Failed.");
                }
              }}
            >
              <BookOpen className="mr-2 h-4 w-4" /> Seed standard chart
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <Button onClick={() => setJournalOpen(true)} disabled={!accounts?.length}>
          <Scale className="mr-2 h-4 w-4" /> Post journal
        </Button>
        <Button variant="outline" onClick={() => setAccountOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Add account
        </Button>
      </div>

      <Tabs defaultValue="tb">
        <TabsList>
          <TabsTrigger value="tb">Trial balance</TabsTrigger>
          <TabsTrigger value="journals">Journals</TabsTrigger>
        </TabsList>

        <TabsContent value="tb" className="mt-4">
          <Card className="rule-frame bg-card">
            <CardContent className="pt-6">
              {tb === undefined || tb === null ? (
                <p className="text-sm ink-faded">Loading…</p>
              ) : tb.rows.length === 0 ? (
                <p className="text-sm ink-faded">
                  No posted movements yet. Send an invoice with a seeded chart
                  of accounts, or post a journal.
                </p>
              ) : (
                <>
                  {!tb.reconciles && (
                    <p className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                      Trial balance does not reconcile — investigate before
                      relying on these figures.
                    </p>
                  )}
                  <div className="data-table overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="type-label border-b text-left ink-faded">
                          <th className="py-2">Code</th>
                          <th>Account</th>
                          <th>Type</th>
                          <th className="text-right">Debit</th>
                          <th className="text-right">Credit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tb.rows.map((r) => (
                          <tr key={r.accountId} className="border-b border-border/50">
                            <td className="py-2">{r.code}</td>
                            <td>{r.name}</td>
                            <td className="type-label ink-faded">{r.type}</td>
                            <td className="text-right tabular-nums">
                              {r.debitPaise ? formatINR(r.debitPaise / 100) : "—"}
                            </td>
                            <td className="text-right tabular-nums">
                              {r.creditPaise ? formatINR(r.creditPaise / 100) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t font-medium">
                          <td colSpan={3} className="py-2 text-right">
                            Totals
                          </td>
                          <td className="text-right tabular-nums">
                            {formatINR(tb.totalDebits / 100)}
                          </td>
                          <td className="text-right tabular-nums">
                            {formatINR(tb.totalCredits / 100)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <p className="type-label mt-3 ink-faded">
                    {tb.reconciles
                      ? `Reconciles ✓ — ${tb.journalCount} posted journal(s).`
                      : "Does not reconcile."}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="journals" className="mt-4">
          <div className="space-y-2">
            {(journals ?? []).length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-8 text-center text-sm ink-faded">
                  No journals posted yet.
                </CardContent>
              </Card>
            ) : (
              (journals ?? []).map((j) => (
                <div key={j._id} className="rule-frame bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {j.memo ?? "(no memo)"}
                      </p>
                      <p className="type-label mt-0.5 ink-faded">
                        {j.entryDate} · {j.source}
                      </p>
                    </div>
                    <Badge
                      variant={j.status === "posted" ? "default" : "secondary"}
                    >
                      {j.status}
                    </Badge>
                  </div>
                  <div className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
                    <div>
                      <span className="type-label ink-faded">Dr </span>
                      {j.debits
                        .map((l) => `${formatINR(l.amountPaise / 100)}`)
                        .join(", ")}
                    </div>
                    <div>
                      <span className="type-label ink-faded">Cr </span>
                      {j.credits
                        .map((l) => `${formatINR(l.amountPaise / 100)}`)
                        .join(", ")}
                    </div>
                  </div>
                  {j.status === "posted" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-2"
                      onClick={() => setReversalOf(j._id)}
                    >
                      Reverse…
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>

      {accounts && (
        <JournalDialog
          accounts={accounts}
          open={journalOpen}
          onOpenChange={setJournalOpen}
        />
      )}
      <NewAccountDialog open={accountOpen} onOpenChange={setAccountOpen} />

      <Dialog
        open={reversalOf !== null}
        onOpenChange={(v) => !v && setReversalOf(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">Reverse journal</DialogTitle>
            <DialogDescription>
              Creates a balanced opposite entry linked to the original. The
              original is marked reversed — never edited or deleted.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={2}
            placeholder="Reason (required, recorded in the audit log)"
            value={reversalReason}
            onChange={(e) => setReversalReason(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setReversalOf(null)}>
              Cancel
            </Button>
            <Button
              disabled={reversalReason.trim().length < 3}
              onClick={async () => {
                if (!reversalOf) return;
                try {
                  await reverse({
                    journalId: reversalOf,
                    reason: reversalReason,
                  });
                  toast.success("Reversal posted.");
                  setReversalOf(null);
                  setReversalReason("");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Failed.");
                }
              }}
            >
              Post reversal
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </ChamberShell>
  );
}
