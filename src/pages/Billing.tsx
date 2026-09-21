import { ChamberShell } from "@/components/ChamberShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { formatDateIN, formatINR, formatINRCompact, todayIN } from "@/lib/format";
import {
  buildInvoicePdf,
  invoiceFileName,
  type InvoicePdfData,
} from "@/lib/invoicePdf";
import { useMutation, useQuery } from "convex/react";
import {
  BadgeCheck,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  Plus,
  Receipt,
  Send,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

// ---------------------------------------------------------------------
// Billing — invoices in integer paise, GST-ready, Razorpay links.
// ---------------------------------------------------------------------

const STATUS_STAMP: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "text-muted-foreground" },
  sent: { label: "Sent", className: "text-chart-3" },
  partially_paid: { label: "Part Paid", className: "text-chart-2" },
  paid: { label: "Paid", className: "text-chart-4" },
  cancelled: { label: "Cancelled", className: "text-muted-foreground" },
  credited: { label: "Credited", className: "text-muted-foreground" },
};

const TAX_MODELS = [
  { value: "none", label: "No tax / exempt" },
  { value: "intra_state", label: "Intra-state — CGST + SGST" },
  { value: "inter_state", label: "Inter-state — IGST" },
] as const;

type LineDraft = {
  description: string;
  amountRupees: string;
  kind: string;
};

function rupeesToMinor(v: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

function lineAmountRupees(l: {
  amountMinor: number;
  minutes?: number;
  ratePerHourMinor?: number;
}): string {
  return (l.amountMinor / 100).toFixed(2);
}

export default function Billing() {
  const invoices = useQuery(api.billing.list);
  const stats = useQuery(api.billing.stats);
  const provider = useQuery(api.billing.providerStatus);
  const matters = useQuery(api.matters.list) as
    | { _id: string; reference: string; title: string; clientId: string }[]
    | undefined;

  const [newOpen, setNewOpen] = useState(false);
  const [consultOpen, setConsultOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const overdueCount = (invoices ?? []).filter((i) => i.overdue).length;

  return (
    <ChamberShell subtitle="Register of Invoices" title="Billing">
      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Billed (this record)", value: stats?.billed },
          { label: "Collected", value: stats?.collected },
          { label: "Outstanding", value: stats?.outstandingAmount },
          { label: "Overdue", value: stats?.overdueAmount },
        ].map((s) => (
          <Card key={s.label} className="shadow-sm">
            <CardContent className="pt-5">
              <p className="mt-3 font-serif text-3xl font-semibold">
                {s.value === undefined ? "—" : formatINRCompact(s.value)}
              </p>
              <p className="type-label mt-1 ink-faded">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="type-label ink-faded">
          {overdueCount > 0
            ? `${overdueCount} invoice${overdueCount === 1 ? "" : "s"} past the due date`
            : "Nothing overdue"}
          {provider && !provider.configured && (
            <span className="ml-2 text-[#8a6d3b]">
              · Online payments not configured — manual recording available
            </span>
          )}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setConsultOpen(true)}>
            <CreditCard className="mr-1.5 size-4" /> Consultation link
          </Button>
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="mr-1.5 size-4" /> New invoice
          </Button>
        </div>
      </div>

      {/* Invoice register */}
      <div className="rule-frame mt-4 overflow-x-auto rounded-lg">
        {invoices === undefined ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Loading invoices…</p>
        ) : invoices.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm ink-faded">
            No invoices yet — draft one from a matter's billable work.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left">
                <th className="px-4 py-2.5 font-medium">Invoice</th>
                <th className="px-4 py-2.5 font-medium">Client / matter</th>
                <th className="px-4 py-2.5 font-medium">Issued</th>
                <th className="px-4 py-2.5 font-medium">Total</th>
                <th className="px-4 py-2.5 font-medium">Balance</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 text-right font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {invoices.map((i) => {
                const stamp = STATUS_STAMP[i.status] ?? {
                  label: i.status,
                  className: "",
                };
                return (
                  <tr key={i._id} className={i.status === "draft" ? "opacity-80" : ""}>
                    <td className="whitespace-nowrap px-4 py-3 font-medium">
                      {i.number}
                      {i.overdue && (
                        <span className="type-label ml-2 text-red-700">overdue</span>
                      )}
                    </td>
                    <td className="max-w-[16rem] px-4 py-3">
                      <p className="truncate">{i.client?.name ?? "—"}</p>
                      {i.matter && (
                        <Link
                          className="type-label text-[#4f6b8f] underline-offset-2 hover:underline"
                          to={`/matters/${i.matterId}`}
                        >
                          {i.matter.reference}
                        </Link>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {formatDateIN(i.issuedOn)}
                      {i.dueOn && (
                        <span className="type-label ink-faded">
                          {" "}
                          · due {formatDateIN(i.dueOn)}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {formatINR(i.totalMinor / 100)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium">
                      {formatINR(i.balanceMinor / 100)}
                    </td>
                    <td className={`whitespace-nowrap px-4 py-3 ${stamp.className}`}>
                      {stamp.label}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <Button variant="outline" size="sm" onClick={() => setDetailId(i._id)}>
                        Open
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <NewInvoiceDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        matters={(matters ?? []).filter((m) => m.reference)}
      />
      <ConsultationDialog open={consultOpen} onOpenChange={setConsultOpen} />
      <InvoiceDetailDialog
        invoiceId={detailId}
        onOpenChange={() => setDetailId(null)}
      />
    </ChamberShell>
  );
}

// ---------------------------------------------------------------------
// New invoice — billable conversion + arrangement
// ---------------------------------------------------------------------

function NewInvoiceDialog({
  open,
  onOpenChange,
  matters,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  matters: { _id: string; reference: string; title: string }[];
}) {
  const create = useMutation(api.billing.createFromMatter);
  const [matterId, setMatterId] = useState("");
  const [arrangement, setArrangement] = useState("hourly");
  const [includeBillable, setIncludeBillable] = useState(true);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const billable = useQuery(
    api.billing.billable,
    open && matterId ? { matterId: matterId as Id<"matters"> } : "skip",
  );

  const submit = async () => {
    if (!matterId) {
      toast.error("Choose the matter to invoice.");
      return;
    }
    setBusy(true);
    try {
      await create({
        matterId: matterId as Id<"matters">,
        arrangement: arrangement as "hourly",
        includeBillable,
        notes: notes || undefined,
      });
      toast.success("Invoice drafted — open it to edit lines and tax.");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  const billableTotal =
    (billable?.time ?? []).reduce((s, t) => s + t.amountMinor, 0) +
    (billable?.expenses ?? []).reduce((s, e) => s + e.amountMinor, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">New invoice</DialogTitle>
          <DialogDescription>
            Billable time and expenses convert to editable line items; totals
            recalculate from the lines with your tax settings.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Matter</Label>
            <Select value={matterId} onValueChange={setMatterId}>
              <SelectTrigger>
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Billing arrangement</Label>
              <Select value={arrangement} onValueChange={setArrangement}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hourly">Hourly</SelectItem>
                  <SelectItem value="fixed_fee">Fixed fee</SelectItem>
                  <SelectItem value="retainer">Retainer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 pt-6">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={includeBillable}
                  onCheckedChange={(v) => setIncludeBillable(v === true)}
                />
                Convert billable work
              </label>
            </div>
          </div>
          {matterId && billable && (
            <p className="rounded border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {billable.time.length} time entr{billable.time.length === 1 ? "y" : "ies"} and{" "}
              {billable.expenses.length} expense
              {billable.expenses.length === 1 ? "" : "s"} uninvoiced —{" "}
              {formatINR(billableTotal / 100)} before tax.
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="inv-notes">Notes (optional)</Label>
            <Textarea
              id="inv-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
          <Button className="w-full" onClick={submit} disabled={busy}>
            {busy && "Drafting…"}
            {!busy && "Draft invoice"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// Invoice detail — editor (draft), send, links, payments, PDF, audit
// ---------------------------------------------------------------------

type InvoiceDetail = {
  _id: string;
  number: string;
  status: string;
  arrangement?: "hourly" | "fixed_fee" | "retainer";
  lines: NonNullable<
    { description: string; amountMinor: number; kind: string; minutes?: number; ratePerHourMinor?: number }[]
  >;
  subtotalMinor: number;
  discountPercentMinor?: number;
  discountAmountMinor?: number;
  taxModel: "none" | "intra_state" | "inter_state";
  taxRateBps?: number;
  cgstMinor?: number;
  sgstMinor?: number;
  igstMinor?: number;
  totalMinor: number;
  amountPaidMinor: number;
  balanceMinor: number;
  notes?: string | null;
  issuedOn: string;
  dueOn?: string | null;
  paymentLinkUrl?: string | null;
  audit?: { at: number; byName: string; text: string }[];
  matter?: { _id: string; reference: string; title: string } | null;
  client?: { name: string; addressLine1?: string; city?: string; state?: string; pincode?: string; gstin?: string } | null;
  payments: {
    _id: string;
    amountMinor: number;
    mode?: string;
    source?: string;
    reference?: string;
    receivedOn: string;
    refundedMinor?: number;
  }[];
};

function InvoiceDetailDialog({
  invoiceId,
  onOpenChange,
}: {
  invoiceId: string | null;
  onOpenChange: () => void;
}) {
  const detail = useQuery(
    api.billing.get,
    invoiceId ? { invoiceId: invoiceId as Id<"invoices"> } : "skip",
  ) as InvoiceDetail | null | undefined;

  const org = useQuery(api.orgs.profile) as
    | {
        name: string;
        addressLine1?: string;
        addressLine2?: string;
        city?: string;
        state?: string;
        pincode?: string;
        phone?: string;
        email?: string;
        gstin?: string;
        website?: string;
      }
    | null
    | undefined;

  const updateDraft = useMutation(api.billing.updateDraft);
  const send = useMutation(api.billing.send);
  const createLink = useMutation(api.billing.createPaymentLink);
  const cancelOrCredit = useMutation(api.billing.cancelOrCredit);
  const deleteDraft = useMutation(api.billing.deleteDraft);

  const [editing, setEditing] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [taxModel, setTaxModel] = useState("none");
  const [taxPercent, setTaxPercent] = useState("18");
  const [discountPercent, setDiscountPercent] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const d = detail;
  const isDraft = d?.status === "draft";

  const startEdit = () => {
    if (!d) return;
    setLines(
      (d.lines ?? []).map((l) => ({
        description: l.description,
        amountRupees: lineAmountRupees(l),
        kind: l.kind ?? "fee",
      })),
    );
    setTaxModel(d.taxModel);
    setTaxPercent(((d.taxRateBps ?? 0) / 100).toString());
    setDiscountPercent(
      d.discountPercentMinor ? (d.discountPercentMinor / 100).toString() : "",
    );
    setDueOn(d.dueOn ?? "");
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!d) return;
    const minorLines = lines.map((l) => ({
      description: l.description,
      amountMinor: rupeesToMinor(l.amountRupees),
      kind: l.kind,
    }));
    if (minorLines.some((l) => !Number.isFinite(l.amountMinor) || l.amountMinor < 0)) {
      toast.error("Every line needs a valid, non-negative amount.");
      return;
    }
    setBusy(true);
    try {
      await updateDraft({
        invoiceId: d._id as Id<"invoices">,
        lines: minorLines,
        taxModel: taxModel as "none",
        taxRateBps: taxModel === "none" ? undefined : Math.round(Number(taxPercent) * 100),
        discountPercentBps: discountPercent
          ? Math.round(Number(discountPercent) * 100)
          : undefined,
        dueOn: dueOn || undefined,
        arrangement: d.arrangement,
      });
      toast.success("Invoice recalculated.");
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  const downloadPdf = (kind: "invoice" | "receipt") => {
    if (!d || !org) return;
    const data: InvoicePdfData = {
      kind,
      number: d.number,
      issuedOn: d.issuedOn,
      dueOn: d.dueOn ?? null,
      status: d.status,
      arrangement: d.arrangement ?? null,
      org: {
        name: org.name,
        addressLine1: org.addressLine1 ?? null,
        addressLine2: org.addressLine2 ?? null,
        city: org.city ?? null,
        state: org.state ?? null,
        pincode: org.pincode ?? null,
        phone: org.phone ?? null,
        email: org.email ?? null,
        gstin: org.gstin ?? null,
        bankDetails: org.website
          ? `See ${org.website} for our bank details`
          : null,
        upiId: null,
      },
      clientName: d.client?.name ?? "Client",
      clientAddress: [
        d.client?.addressLine1,
        [d.client?.city, d.client?.state, d.client?.pincode].filter(Boolean).join(" "),
      ]
        .filter(Boolean)
        .join("\n"),
      clientGstin: d.client?.gstin ?? null,
      matterReference: d.matter?.reference ?? null,
      matterTitle: d.matter?.title ?? null,
      lines: d.lines ?? [],
      subtotalMinor: d.subtotalMinor,
      discountAmountMinor: d.discountAmountMinor,
      taxModel: d.taxModel,
      taxRateBps: d.taxRateBps,
      cgstMinor: d.cgstMinor,
      sgstMinor: d.sgstMinor,
      igstMinor: d.igstMinor,
      totalMinor: d.totalMinor,
      amountPaidMinor: d.amountPaidMinor,
      balanceMinor: d.balanceMinor,
      notes: d.notes ?? null,
      payments: d.payments.map((p) => ({
        receivedOn: p.receivedOn,
        amountMinor: p.amountMinor,
        mode: p.mode,
        reference: p.reference ?? null,
      })),
    };
    const doc = buildInvoicePdf(data);
    doc.save(invoiceFileName(data));
  };

  const run = (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    return fn()
      .then(() => toast.success(ok))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed."))
      .finally(() => setBusy(false));
  };

  return (
    <Dialog open={invoiceId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        {!d ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-start justify-between">
                <div>
                  <DialogTitle className="font-serif text-xl">{d.number}</DialogTitle>
                  <DialogDescription>
                    {d.client?.name ?? "—"}
                    {d.matter ? ` · ${d.matter.reference} — ${d.matter.title}` : ""}
                    {d.dueOn && ` · due ${formatDateIN(d.dueOn)}`}
                  </DialogDescription>
                </div>
                <span className={`type-label ${(STATUS_STAMP[d.status] ?? { className: "" }).className}`}>
                  {(STATUS_STAMP[d.status] ?? { label: d.status }).label}
                </span>
              </div>
            </DialogHeader>

            {/* Lines */}
            {!editing ? (
              <div className="overflow-hidden rounded-md border">
                <table className="w-full text-sm">
                  <tbody className="divide-y">
                    {(d.lines ?? []).map((l, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2">
                          <p>{l.description}</p>
                          {l.kind === "time" && l.minutes != null && (
                            <p className="type-label ink-faded">
                              {l.minutes} min · {formatINR((l.ratePerHourMinor ?? 0) / 100)}/hr
                            </p>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-medium">
                          {formatINR(l.amountMinor / 100)}
                        </td>
                      </tr>
                    ))}
                    {(d.lines ?? []).length === 0 && (
                      <tr>
                        <td className="px-3 py-3 text-sm ink-faded" colSpan={2}>
                          No lines yet — edit the draft to add them.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Line items</Label>
                {lines.map((l, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={l.description}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((x, j) =>
                            j === i ? { ...x, description: e.target.value } : x,
                          ),
                        )
                      }
                      placeholder="Description"
                      className="flex-1"
                    />
                    <Input
                      value={l.amountRupees}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((x, j) =>
                            j === i ? { ...x, amountRupees: e.target.value } : x,
                          ),
                        )
                      }
                      placeholder="0.00"
                      className="w-24 text-right"
                      inputMode="decimal"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                      aria-label="Remove line"
                      onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                    >
                      ×
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setLines((prev) => [
                      ...prev,
                      { description: "", amountRupees: "", kind: "fee" },
                    ])
                  }
                >
                  <Plus className="mr-1 size-3.5" /> Add line
                </Button>
              </div>
            )}

            {/* Tax / discount controls */}
            {editing ? (
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>Tax treatment</Label>
                  <Select value={taxModel} onValueChange={setTaxModel}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TAX_MODELS.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tax-pct">Tax rate %</Label>
                  <Input
                    id="tax-pct"
                    value={taxPercent}
                    onChange={(e) => setTaxPercent(e.target.value)}
                    disabled={taxModel === "none"}
                    inputMode="decimal"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="disc-pct">Discount %</Label>
                  <Input
                    id="disc-pct"
                    value={discountPercent}
                    onChange={(e) => setDiscountPercent(e.target.value)}
                    placeholder="e.g. 10"
                    inputMode="decimal"
                  />
                </div>
              </div>
            ) : null}

            {/* Totals summary */}
            {!editing && (
              <div className="space-y-1 rounded-md border bg-muted/30 px-4 py-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{formatINR(d.subtotalMinor / 100)}</span>
                </div>
                {!!d.discountAmountMinor && d.discountAmountMinor > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Discount</span>
                    <span>-{formatINR(d.discountAmountMinor / 100)}</span>
                  </div>
                )}
                {d.taxModel === "intra_state" && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        CGST {(((d.taxRateBps ?? 0) / 100) / 2).toFixed(2)}%
                      </span>
                      <span>{formatINR((d.cgstMinor ?? 0) / 100)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        SGST {(((d.taxRateBps ?? 0) / 100) / 2).toFixed(2)}%
                      </span>
                      <span>{formatINR((d.sgstMinor ?? 0) / 100)}</span>
                    </div>
                  </>
                )}
                {d.taxModel === "inter_state" && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      IGST {((d.taxRateBps ?? 0) / 100).toFixed(2)}%
                    </span>
                    <span>{formatINR((d.igstMinor ?? 0) / 100)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-1 font-semibold">
                  <span>Total</span>
                  <span>{formatINR(d.totalMinor / 100)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount paid</span>
                  <span>{formatINR(d.amountPaidMinor / 100)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>{d.balanceMinor <= 0 ? "Paid in full" : "Balance due"}</span>
                  <span className={d.balanceMinor <= 0 ? "text-emerald-700" : ""}>
                    {formatINR(d.balanceMinor / 100)}
                  </span>
                </div>
              </div>
            )}

            {/* Payment link */}
            {d.status !== "draft" && d.balanceMinor > 0 && (
              <div className="space-y-2 rounded-md border px-4 py-3">
                <p className="type-label">Online payment</p>
                {d.paymentLinkUrl ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={d.paymentLinkUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="type-label flex items-center gap-1 text-[#4f6b8f] underline-offset-2 hover:underline"
                    >
                      <ExternalLink className="size-3.5" /> Open payment link (UPI/QR/card)
                    </a>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        void navigator.clipboard.writeText(d.paymentLinkUrl ?? "");
                        toast.success("Payment link copied.");
                      }}
                    >
                      <Copy className="mr-1 size-3.5" /> Copy
                    </Button>
                    <span className="type-label ink-faded">
                      Marks paid only when Razorpay's verified webhook confirms.
                    </span>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => createLink({ invoiceId: d._id as Id<"invoices"> }),
                        "Payment link requested — it appears here in a moment.",
                      )
                    }
                  >
                    <CreditCard className="mr-1.5 size-3.5" /> Create payment link
                  </Button>
                )}
              </div>
            )}

            {/* Payments */}
            {d.payments.length > 0 && (
              <div className="space-y-1">
                <p className="type-label">Payments received</p>
                {d.payments.map((p) => (
                  <div
                    key={p._id}
                    className="flex items-center justify-between rounded border px-3 py-2 text-sm"
                  >
                    <span>
                      {formatDateIN(p.receivedOn)} ·{" "}
                      {(p.mode ?? (p.source === "razorpay" ? "online" : "payment")).toUpperCase()}
                      {p.source === "razorpay" && (
                        <BadgeCheck className="ml-1 inline size-3.5 text-emerald-700" />
                      )}
                      {p.reference && (
                        <span className="type-label ink-faded"> · {p.reference}</span>
                      )}
                      {!!p.refundedMinor && p.refundedMinor > 0 && (
                        <span className="type-label text-red-700">
                          {" "}
                          · refunded {formatINR(p.refundedMinor / 100)}
                        </span>
                      )}
                    </span>
                    <span className="font-medium">{formatINR(p.amountMinor / 100)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Audit trail */}
            {!!d.audit && d.audit.length > 0 && (
              <details className="rounded-md border px-3 py-2">
                <summary className="type-label cursor-pointer">Audit trail</summary>
                <ol className="mt-2 space-y-1">
                  {d.audit
                    .slice()
                    .reverse()
                    .map((a, i) => (
                      <li key={i} className="text-xs text-muted-foreground">
                        {formatDateIN(a.at)} · {a.byName} — {a.text}
                      </li>
                    ))}
                </ol>
              </details>
            )}

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2">
              {isDraft && editing && (
                <>
                  <Button size="sm" onClick={saveEdit} disabled={busy}>
                    Save & recalculate
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                </>
              )}
              {isDraft && !editing && (
                <>
                  <Button size="sm" variant="outline" onClick={startEdit}>
                    Edit lines & tax
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run(() => send({ invoiceId: d._id as Id<"invoices"> }), "Invoice sent.")
                    }
                  >
                    <Send className="mr-1.5 size-3.5" /> Send
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => deleteDraft({ invoiceId: d._id as Id<"invoices"> }),
                        "Draft deleted — billable work released.",
                      ).then(onOpenChange)
                    }
                  >
                    Delete draft
                  </Button>
                </>
              )}
              {!isDraft && (
                <>
                  <RecordPaymentButton invoiceId={d._id} balanceMinor={d.balanceMinor} />
                  <Button variant="outline" size="sm" onClick={() => downloadPdf("invoice")}>
                    <Download className="mr-1.5 size-3.5" /> Invoice PDF
                  </Button>
                  {d.amountPaidMinor > 0 && (
                    <Button variant="outline" size="sm" onClick={() => downloadPdf("receipt")}>
                      <Receipt className="mr-1.5 size-3.5" /> Receipt PDF
                    </Button>
                  )}
                  {d.status !== "cancelled" && d.status !== "credited" && !confirmingCancel && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmingCancel(true)}
                    >
                      Cancel / credit…
                    </Button>
                  )}
                  {confirmingCancel && (
                    <div className="flex w-full flex-wrap items-center gap-2">
                      <Input
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                        placeholder="Reason (recorded in the audit trail)"
                        className="min-w-56 flex-1"
                      />
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={!cancelReason.trim() || busy}
                        onClick={() =>
                          run(
                            () =>
                              cancelOrCredit({
                                invoiceId: d._id as Id<"invoices">,
                                creditRemaining: d.amountPaidMinor > 0,
                                reason: cancelReason,
                              }),
                            d.amountPaidMinor > 0
                              ? "Balance converted to a credit note."
                              : "Invoice cancelled.",
                          ).then(() => {
                            setConfirmingCancel(false);
                            setCancelReason("");
                          })
                        }
                      >
                        Confirm
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmingCancel(false)}
                      >
                        Keep
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RecordPaymentButton({
  invoiceId,
  balanceMinor,
}: {
  invoiceId: string;
  balanceMinor: number;
}) {
  const recordPayment = useMutation(api.billing.recordPayment);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState((balanceMinor / 100).toFixed(2));
  const [mode, setMode] = useState("neft");
  const [reference, setReference] = useState("");
  const [receivedOn, setReceivedOn] = useState(todayIN());
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 size-3.5" /> Record payment
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">Record a payment</DialogTitle>
          <DialogDescription>
            Manual recording is audited. Online payments reconcile through
            Razorpay's verified webhook instead.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pay-amt">Amount (₹)</Label>
            <Input
              id="pay-amt"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
            />
            <p className="text-xs text-muted-foreground">
              Balance due: {formatINR(balanceMinor / 100)}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
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
            <Label htmlFor="pay-ref">Reference / UTR (optional)</Label>
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
              const minor = rupeesToMinor(amount);
              if (!Number.isFinite(minor) || minor <= 0) {
                toast.error("Enter a valid amount.");
                return;
              }
              setBusy(true);
              try {
                await recordPayment({
                  invoiceId: invoiceId as Id<"invoices">,
                  amountMinor: minor,
                  mode: mode as "upi",
                  reference: reference || undefined,
                  receivedOn,
                });
                toast.success("Payment recorded against the invoice.");
                setOpen(false);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Could not record.");
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

// ---------------------------------------------------------------------
// Consultation payment links
// ---------------------------------------------------------------------

type Consultation = {
  _id: string;
  clientName: string;
  amountMinor: number;
  status: string;
  paymentLinkUrl?: string | null;
};

function ConsultationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const create = useMutation(api.billing.createConsultation);
  const list = useQuery(api.billing.consultationList, open ? {} : "skip") as
    | Consultation[]
    | undefined;

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("2500");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const minor = rupeesToMinor(amount);
    if (!name.trim() || !Number.isFinite(minor) || minor <= 0) {
      toast.error("A consultation needs a name and a valid amount.");
      return;
    }
    setBusy(true);
    try {
      await create({
        clientName: name,
        amountMinor: minor,
        matterSummary: summary || undefined,
      });
      toast.success("Consultation link created.");
      setName("");
      setSummary("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">Consultation payment</DialogTitle>
          <DialogDescription>
            A UPI/QR payment link for a pay-before-appointment consultation.
            It is marked paid only by the verified webhook.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="c-name">Client name</Label>
              <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-amt">Fee (₹)</Label>
              <Input
                id="c-amt"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-sum">Matter summary (optional)</Label>
            <Input
              id="c-sum"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="e.g. Property dispute — first consultation"
            />
          </div>
          <Button className="w-full" onClick={submit} disabled={busy}>
            {busy ? "Creating…" : "Create payment link"}
          </Button>

          {list && list.length > 0 && (
            <div className="space-y-2 border-t pt-3">
              <p className="type-label">Recent consultation links</p>
              {list.slice(0, 6).map((c) => (
                <div
                  key={c._id}
                  className="flex items-center justify-between rounded border px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.clientName}</p>
                    <p className="type-label ink-faded">
                      {formatINR(c.amountMinor / 100)} · {c.status}
                    </p>
                  </div>
                  {c.paymentLinkUrl && (
                    <a
                      href={c.paymentLinkUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="type-label flex items-center gap-1 text-[#4f6b8f] underline-offset-2 hover:underline"
                    >
                      <ExternalLink className="size-3.5" /> Link
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
