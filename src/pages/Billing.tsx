import { ChamberShell } from "@/components/ChamberShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
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
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatINR, formatINRCompact, formatDateIN, todayIN } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import { BadgeIndianRupee, Plus, Receipt } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

const STATUS_STAMP: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "text-muted-foreground" },
  sent: { label: "Sent", className: "text-chart-2" },
  partially_paid: { label: "Part Paid", className: "text-chart-4" },
  paid: { label: "Paid", className: "text-chart-3" },
  cancelled: { label: "Cancelled", className: "text-muted-foreground" },
};

function PaymentDialog({
  invoiceId,
  balance,
}: {
  invoiceId: Id<"invoices">;
  balance: number;
}) {
  const recordPayment = useMutation(api.billing.recordPayment);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(balance));
  const [mode, setMode] = useState("neft");
  const [reference, setReference] = useState("");
  const [receivedOn, setReceivedOn] = useState(todayIN());
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Plus className="size-3.5" />
          Payment
        </Button>
      </DialogTrigger>
      <DialogContent className="rule-frame bg-card sm:max-w-md">
        <DialogHeader>
          <p className="type-label ink-faded">Receipt</p>
          <DialogTitle className="font-serif text-2xl">
            Record a payment
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pay-amt">Amount (₹)</Label>
            <Input
              id="pay-amt"
              type="number"
              min="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <p className="text-xs ink-faded">
              Balance due: {formatINR(balance)}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Mode</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="neft">NEFT / RTGS</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pay-date">Received on</Label>
              <Input
                id="pay-date"
                type="date"
                value={receivedOn}
                onChange={(e) => setReceivedOn(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pay-ref">
              Reference / UTR <span className="ink-faded">(optional)</span>
            </Label>
            <Input
              id="pay-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. UTIB00001234567890"
            />
          </div>
          <Button
            className="w-full"
            disabled={busy}
            onClick={async () => {
              const amt = parseFloat(amount);
              if (!Number.isFinite(amt) || amt <= 0) {
                toast.error("Enter a valid amount.");
                return;
              }
              setBusy(true);
              try {
                await recordPayment({
                  invoiceId,
                  amount: amt,
                  mode: mode as "upi" | "neft" | "cash" | "cheque" | "other",
                  reference: reference || undefined,
                  receivedOn,
                });
                toast.success("Payment recorded against the invoice.");
                setOpen(false);
              } catch (err) {
                toast.error(
                  err instanceof Error ? err.message : "Could not record.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Recording…" : "Record payment"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Billing() {
  const invoices = useQuery(api.billing.list);
  const stats = useQuery(api.billing.stats);
  const setStatus = useMutation(api.billing.setStatus);

  return (
    <ChamberShell subtitle="The Digital Chamber">
      <p className="type-label ink-faded">Register of Invoices</p>
      <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight">
        Billing
      </h1>
      <p className="mt-2 max-w-2xl ink-faded">
        Fees and disbursements billed from matters, with tax applied per the
        chamber's settings. Payments are receipted against each invoice.
      </p>

      {/* Stats */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: "Billed (this record)", value: stats?.billed },
          { label: "Collected", value: stats?.collected },
          { label: "Outstanding", value: stats?.outstandingAmount },
        ].map((s) => (
          <Card key={s.label} className="rule-frame bg-card">
            <CardContent className="pt-6">
              <BadgeIndianRupee className="size-5 text-primary" />
              <p className="mt-3 font-serif text-3xl font-semibold">
                {s.value === undefined ? "—" : formatINRCompact(s.value)}
              </p>
              <p className="type-label mt-1 ink-faded">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Invoice list */}
      {invoices === undefined ? (
        <p className="mt-10 text-sm ink-faded">Opening the register…</p>
      ) : invoices.length === 0 ? (
        <Card className="mt-10 border-dashed">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <Receipt className="size-8 text-muted-foreground" />
            <p className="mt-4 font-serif text-xl">No invoices yet</p>
            <p className="mt-2 max-w-md text-sm ink-faded">
              Record time or expenses on a matter, then draft an invoice from
              the matter file — it will appear here with its tax and payment
              status.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="mt-8 space-y-4">
          {invoices.map((inv) => {
            const st = STATUS_STAMP[inv.status] ?? STATUS_STAMP.draft;
            const balance = inv.total - inv.amountPaid;
            return (
              <li key={inv._id} className="rule-frame bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="type-label ink-faded">
                      {inv.number} · issued {formatDateIN(inv.issuedOn)}
                    </p>
                    <h2 className="mt-1 font-serif text-xl font-semibold">
                      {inv.matter?.title ?? "Matter"}
                    </h2>
                    <p className="mt-0.5 text-sm ink-faded">
                      {inv.client?.name}
                      {inv.matter ? (
                        <>
                          {" · "}
                          <Link
                            to={`/matters/${inv.matterId}`}
                            className="text-primary hover:underline"
                          >
                            {inv.matter.reference}
                          </Link>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-serif text-2xl font-semibold text-primary">
                      {formatINR(inv.total)}
                    </p>                    <p className="type-label ink-faded">
                      incl. GST {inv.taxPercent}% ({formatINR(inv.taxAmount)})
                    </p>
                    {inv.amountPaid > 0 && (
                      <p className="type-label ink-faded">
                        paid {formatINR(inv.amountPaid)} · due{" "}
                        {formatINR(balance)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
                  <span className={`stamp ${st.className}`}>{st.label}</span>
                  {inv.status === "draft" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await setStatus({ invoiceId: inv._id, status: "sent" });
                          toast.success("Invoice marked sent.");
                        } catch (err) {
                          toast.error(
                            err instanceof Error ? err.message : "Failed.",
                          );
                        }
                      }}
                    >
                      Mark sent
                    </Button>
                  )}
                  {inv.status !== "paid" && inv.status !== "cancelled" && inv.status !== "draft" && (
                    <PaymentDialog invoiceId={inv._id} balance={balance} />
                  )}
                  {inv.status !== "paid" && inv.status !== "cancelled" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await setStatus({
                            invoiceId: inv._id,
                            status: "cancelled",
                          });
                          toast.success("Invoice cancelled.");
                        } catch (err) {
                          toast.error(
                            err instanceof Error ? err.message : "Failed.",
                          );
                        }
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </ChamberShell>
  );
}
