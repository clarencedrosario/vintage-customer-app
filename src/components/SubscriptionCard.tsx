import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function inr(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function day(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const STATUS_STYLES: Record<string, string> = {
  trialing: "bg-sky-100 text-sky-900 border-sky-200",
  active: "bg-emerald-50 text-emerald-900 border-emerald-200",
  past_due: "bg-amber-50 text-amber-900 border-amber-200",
  grace: "bg-orange-50 text-orange-900 border-orange-200",
  read_only: "bg-stone-100 text-stone-700 border-stone-200",
  cancelled: "bg-stone-100 text-stone-700 border-stone-200",
  closed: "bg-stone-100 text-stone-700 border-stone-200",
};

export function SubscriptionCard() {
  const data = useQuery(api.subscriptions.mySubscription);
  const invoices = useQuery(api.subscriptions.mySubscriptionInvoices);
  const seats = useQuery(api.subscriptions.seatUsage);
  const start = useMutation(api.subscriptions.startSubscription);
  const requestPayment = useMutation(api.subscriptions.requestSubscriptionPayment);
  const checkout = useAction(api.paymentsProvider.startSubscriptionCheckout);
  const cancel = useMutation(api.subscriptions.cancelSubscription);
  const resume = useMutation(api.subscriptions.resumeSubscription);
  const createToken = useMutation(api.subscriptions.createExportToken);
  const consume = useMutation(api.subscriptions.consumeExportToken);

  const [busy, setBusy] = useState(false);
  const [exportToken, setExportToken] = useState<string | null>(null);
  const [pasteToken, setPasteToken] = useState("");
  const [bundle, setBundle] = useState<string | null>(null);

  if (data === undefined) return null;

  const openCheckout = async () => {
    setBusy(true);
    try {
      const res = await checkout({});
      window.open(res.url, "_blank", "noopener");
      toast.success(
        res.reused
          ? "Opened your existing payment link."
          : "Payment link created — complete the payment to activate.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start checkout.");
    } finally {
      setBusy(false);
    }
  };

  const downloadBundle = async () => {
    try {
      const result = await consume({ token: pasteToken.trim() });
      const blob = new Blob([JSON.stringify(result, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `advokate-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setBundle("Export downloaded. The link has been consumed and cannot be reused.");
      setPasteToken("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed.");
    }
  };

  const sub = data.subscription;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-serif text-lg">Subscription</CardTitle>
        <CardDescription>
          The plan that powers this chamber. Payment runs through the same
          verified Razorpay path as client invoices; opening a link never
          activates anything by itself.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {data.readOnly && (
          <div className="rounded-md border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-800">
            This chamber is in <strong>read-only mode</strong>. Records remain
            viewable and exportable, but no changes can be made. Renew a plan
            below to restore access.
          </div>
        )}
        {!data.readOnly && data.graceUntil && sub?.status === "grace" && (
          <div className="rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
            Grace period ends {day(data.graceUntil)} — renew before then to
            avoid read-only mode.
          </div>
        )}

        {sub ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-serif text-base">{sub.planName}</span>
              <Badge variant="outline" className={STATUS_STYLES[sub.status] ?? ""}>
                {sub.status.replace("_", " ")}
              </Badge>
              {sub.awaitingPayment && (
                <Badge variant="outline" className="bg-amber-50 text-amber-900 border-amber-200">
                  awaiting payment
                </Badge>
              )}
            </div>
            <div className="grid gap-x-8 gap-y-1 text-sm text-muted-foreground sm:grid-cols-2">
              <span>Seats: {seats ? `${seats.billable} billable${seats.limit ? ` of ${seats.limit}` : ""}` : "—"}</span>
              <span>Current period ends: {day(sub.currentPeriodEnd)}</span>
              {sub.trialEndsAt && <span>Trial ends: {day(sub.trialEndsAt)}</span>}
              {sub.cancelAt && <span>Cancellation scheduled for: {day(sub.cancelAt)}</span>}
              {sub.lastInvoiceNumber && <span>Last invoice: {sub.lastInvoiceNumber}</span>}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {(sub.status === "past_due" || sub.status === "grace" || sub.status === "trialing") && (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const res = await requestPayment({});
                      if (res.url) {
                        window.open(res.url, "_blank", "noopener");
                      } else {
                        await openCheckout();
                      }
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Could not prepare payment.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Pay for this period
                </Button>
              )}
              {sub.status !== "active" && sub.status !== "read_only" && sub.status !== "closed" && (
                <Button size="sm" variant="outline" disabled={busy} onClick={openCheckout}>
                  New payment link
                </Button>
              )}
              {sub.cancelAt && sub.status !== "closed" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await resume({});
                      toast.success("Scheduled cancellation withdrawn.");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Could not resume.");
                    }
                  }}
                >
                  Resume subscription
                </Button>
              )}
              {["trialing", "active", "past_due"].includes(sub.status) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-800 hover:bg-red-50 hover:text-red-900"
                  onClick={async () => {
                    if (!confirm("Schedule cancellation at the end of the current period?")) return;
                    try {
                      await cancel({});
                      toast.success("Cancellation scheduled for the end of the period.");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Could not cancel.");
                    }
                  }}
                >
                  Cancel subscription
                </Button>
              )}
              {sub.paymentLinkUrl && sub.awaitingPayment && (
                <a
                  href={sub.paymentLinkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center rounded-md border px-3 text-xs"
                >
                  Open payment link
                </a>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No subscription yet. Choose a plan below to start — trials begin
            immediately; paid plans open a payment link.
          </p>
        )}

        {data.plans.length > 0 && (
          <div className="space-y-2">
            <p className="type-label">Available plans</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.plans.map((p) => {
                const current = sub?.planId === p._id && ["trialing", "active", "past_due", "grace"].includes(sub.status);
                return (
                  <div
                    key={p._id}
                    className={`rounded-md border p-3 text-sm ${current ? "border-gold bg-amber-50/40" : "border-border"}`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{p.name}</span>
                      <span>
                        {inr(p.priceMinor)}
                        <span className="text-xs text-muted-foreground">/{p.interval === "yearly" ? "yr" : "mo"}</span>
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {p.kind === "individual" ? "Single-lawyer chamber" : "Firm"} ·{" "}
                      {p.seatLimit ? `${p.seatLimit} seats` : "unlimited seats"}
                      {p.trialDays ? ` · ${p.trialDays}-day trial` : ""}
                    </p>
                    {p.features.length > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">{p.features.join(" · ")}</p>
                    )}
                    <Button
                      size="sm"
                      variant={current ? "secondary" : "outline"}
                      className="mt-2 h-7 w-full text-xs"
                      disabled={busy || current}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const res = await start({ planId: p._id });
                          if (res.needsPayment) {
                            await openCheckout();
                          } else {
                            toast.success("Subscription started — trial is running.");
                          }
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Could not start plan.");
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {current ? "Current plan" : "Choose plan"}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {invoices && invoices.length > 0 && (
          <div className="space-y-2">
            <p className="type-label">Subscription invoices</p>
            <div className="overflow-hidden rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv) => (
                    <TableRow key={inv._id}>
                      <TableCell className="text-xs">{inv.number}</TableCell>
                      <TableCell className="text-xs">{inv.planName}</TableCell>
                      <TableCell className="text-xs">{inr(inv.amountMinor)}</TableCell>
                      <TableCell className="text-xs">
                        {day(inv.periodStart)} – {day(inv.periodEnd)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            inv.status === "paid"
                              ? "bg-emerald-50 text-emerald-900 border-emerald-200"
                              : "bg-amber-50 text-amber-900 border-amber-200"
                          }
                        >
                          {inv.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <div className="space-y-2 border-t border-border pt-4">
          <p className="type-label">Take a copy of your data</p>
          <p className="text-xs text-muted-foreground">
            Available even in read-only mode. Generates a one-time link, valid
            for 24 hours, that downloads the client and matter registers as
            JSON. Maximum of three unused links at a time.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  const res = await createToken({});
                  setExportToken(res.token);
                  toast.success("One-time export link created.");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Could not create export link.");
                }
              }}
            >
              Create export link
            </Button>
            {exportToken && (
              <code className="max-w-full truncate rounded bg-muted px-2 py-1 text-xs">
                {exportToken}
              </code>
            )}
          </div>
          <div className="flex max-w-md items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="paste-export" className="text-xs">
                Paste a link to download now
              </Label>
              <Input
                id="paste-export"
                value={pasteToken}
                onChange={(e) => setPasteToken(e.target.value)}
                placeholder="sx_…"
                className="h-8 text-xs"
              />
            </div>
            <Button size="sm" variant="secondary" disabled={!pasteToken.trim()} onClick={downloadBundle}>
              Download
            </Button>
          </div>
          {bundle && <p className="text-xs text-muted-foreground">{bundle}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
