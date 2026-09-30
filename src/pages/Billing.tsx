import { ChamberShell } from "@/components/ChamberShell";
import { Badge } from "@/components/ui/badge";
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
  inr,
  invoiceFileName,
  type InvoicePdfData,
} from "@/lib/invoicePdf";
import { useMutation, useQuery } from "convex/react";
import {
  BadgeCheck,
  CalendarClock,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  Inbox,
  Mail,
  MessageCircle,
  Plus,
  Printer,
  Receipt,
  Send,
  UserPlus,
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
  const [merchantOpen, setMerchantOpen] = useState(false);
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
              · Online payments not set up — connect your firm's own Razorpay account (client money is never collected through the platform account) or record payments manually
            </span>
          )}
          {provider?.configured && (
            <span className="ml-2 text-[#5a6b4f]">
              · Collecting on your firm's Razorpay account (••••{provider.keyIdLast4}, {provider.mode})
            </span>
          )}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setMerchantOpen(true)}>
            <BadgeCheck className="mr-1.5 size-4" /> Payment account
          </Button>
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
      <MerchantDialog open={merchantOpen} onOpenChange={setMerchantOpen} />
      <ConsultRequestsCard />
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
        pan?: string;
        bankDetails?: string;
        upiId?: string;
        website?: string;
      }
    | null
    | undefined;
  const logoUrl = useQuery(api.orgs.logoUrl);

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

  /** Convert the firm logo to a data URL for the PDF; null on failure. */
  const logoDataUrl = async (): Promise<string | null> => {
    if (!logoUrl) return null;
    try {
      const res = await fetch(logoUrl);
      const blob = await res.blob();
      if (!blob.type.startsWith("image/")) return null;
      return await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  };

  const downloadPdf = async (kind: "invoice" | "receipt") => {
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
        pan: org.pan ?? null,
        bankDetails: org.bankDetails ?? null,
        upiId: org.upiId ?? null,
        logoDataUrl: await logoDataUrl(),
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

  /** Open the generated PDF in a new tab for printing. */
  const printPdf = async () => {
    if (!d || !org) return;
    const data = await invoiceDataForPdf("invoice");
    const doc = buildInvoicePdf(data);
    doc.autoPrint();
    const url = doc.output("bloburl");
    window.open(url, "_blank");
  };

  /** Shared data builder for download/print/share paths. */
  const invoiceDataForPdf = async (
    kind: "invoice" | "receipt",
  ): Promise<InvoicePdfData> => {
    if (!d || !org) throw new Error("Invoice not loaded.");
    return {
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
        pan: org.pan ?? null,
        bankDetails: org.bankDetails ?? null,
        upiId: org.upiId ?? null,
        logoDataUrl: await logoDataUrl(),
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
  };

  /** Email the invoice: opens the mail client with a summary + attachment hint. */
  const emailInvoice = async () => {
    if (!d) return;
    try {
      const data = await invoiceDataForPdf("invoice");
      const subject = `Invoice ${data.number} — ${data.org.name}`;
      const body = [
        `Dear ${data.clientName},`,
        ``,
        `Please find invoice ${data.number} dated ${data.issuedOn} for ${inr(data.totalMinor)}${data.dueOn ? `, due ${data.dueOn}` : ""}.`,
        `The PDF is attached (generated from the chamber's records).`,
        ``,
        data.org.bankDetails ? `Payment details: ${data.org.bankDetails}` : ``,
        data.org.upiId ? `UPI: ${data.org.upiId}` : ``,
        ``,
        `Kind regards,`,
        data.org.name,
      ]
        .filter(Boolean)
        .join("\n");
      window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      // Also save the PDF so it can be attached from the downloads folder.
      buildInvoicePdf(data).save(invoiceFileName(data));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not prepare the email.");
    }
  };

  /** WhatsApp the invoice summary using the wa.me deep link. */
  const whatsappInvoice = () => {
    if (!d || !org) return;
    const total = formatINR(d.totalMinor / 100);
    const message = `Invoice ${d.number} from ${org.name}: ${total}${d.dueOn ? `, due ${d.dueOn}` : ""}. The PDF follows from our records.${org.upiId ? ` UPI: ${org.upiId}` : ""}`;
    window.open(
      `https://wa.me/?text=${encodeURIComponent(message)}`,
      "_blank",
    );
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
                  <Button variant="outline" size="sm" onClick={() => void downloadPdf("invoice")}>
                    <Download className="mr-1.5 size-3.5" /> Invoice PDF
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void printPdf()}>
                    <Printer className="mr-1.5 size-3.5" /> Print
                  </Button>
                  {d.status !== "draft" && (
                    <Button variant="outline" size="sm" onClick={() => void emailInvoice()}>
                      <Mail className="mr-1.5 size-3.5" /> Email
                    </Button>
                  )}
                  {d.status !== "draft" && (
                    <Button variant="outline" size="sm" onClick={whatsappInvoice}>
                      <MessageCircle className="mr-1.5 size-3.5" /> WhatsApp
                    </Button>
                  )}
                  {d.amountPaidMinor > 0 && (
                    <Button variant="outline" size="sm" onClick={() => void downloadPdf("receipt")}>
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

// ---------------------------------------------------------------------
// Public consultation requests & bookings (section 22)
// ---------------------------------------------------------------------

type ConsultRequest = {
  _id: Id<"consultations">;
  reference: string | null;
  source: string;
  clientName: string;
  clientEmail: string | null;
  clientPhone: string | null;
  matterSummary: string | null;
  amountMinor: number;
  status: string;
  slotAt: number | null;
  proposedSlotAt: number | null;
  advocateName: string | null;
  advocateUserId: string | null;
  connectedClientId: string | null;
  cancelReason: string | null;
  paymentLinkUrl: string | null;
  history: { at: number; text: string }[];
  createdAt: number;
};

const REQ_STATUS: Record<string, { label: string; tone: string }> = {
  requested: { label: "New request", tone: "border-[#B68A45]/40 bg-[#B68A45]/10 text-[#8a6d3b]" },
  pending: { label: "Payment link", tone: "border-[#E5E7EB] bg-white text-[#64748B]" },
  accepted: { label: "Accepted · fee pending", tone: "border-[#B68A45]/40 bg-[#B68A45]/10 text-[#8a6d3b]" },
  scheduled: { label: "Scheduled", tone: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  reschedule_proposed: { label: "Reschedule proposed", tone: "border-[#B68A45]/40 bg-[#B68A45]/10 text-[#8a6d3b]" },
  paid: { label: "Paid · to schedule", tone: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  completed: { label: "Completed", tone: "border-[#E5E7EB] bg-white text-[#64748B]" },
  declined: { label: "Declined", tone: "border-red-200 bg-red-50 text-red-800" },
  cancelled: { label: "Cancelled", tone: "border-red-100 bg-red-50 text-red-700" },
  refunded: { label: "Refunded", tone: "border-red-100 bg-red-50 text-red-700" },
};

function ConsultRequestsCard() {
  const requests = useQuery(api.consultRequests.list) as ConsultRequest[] | undefined;
  const [convertId, setConvertId] = useState<string | null>(null);
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);

  const rows = requests ?? [];
  const open = rows.filter((r) =>
    ["requested", "accepted", "reschedule_proposed", "paid"].includes(r.status),
  );

  if (requests === undefined) return null;

  return (
    <div className="rule-frame mt-6 rounded-lg">
      <div className="flex items-center justify-between px-4 pt-4">
        <h2 className="flex items-center gap-2 font-serif text-base font-semibold">
          <Inbox className="size-4 text-[#B68A45]" aria-hidden="true" />
          Consultation requests & bookings
          {open.length > 0 && (
            <span className="type-label text-[#8a6d3b]">{open.length} open</span>
          )}
        </h2>
        <Link
          to="/find-a-lawyer"
          target="_blank"
          className="type-label text-[#4f6b8f] underline-offset-2 hover:underline"
        >
          View public directory
        </Link>
      </div>
      <div className="p-4">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm ink-faded">
            No consultation requests yet. Publish a directory profile (Settings) so
            visitors can book a consultation.
          </p>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => {
              const stamp = REQ_STATUS[r.status] ?? { label: r.status, tone: "" };
              return (
                <div
                  key={r._id}
                  className="rounded-md border border-[#E5E7EB] px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{r.clientName}</p>
                        {r.source === "public" && r.reference && (
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {r.reference}
                          </span>
                        )}
                        <Badge variant="outline" className={`text-[11px] ${stamp.tone}`}>
                          {stamp.label}
                        </Badge>
                        {r.connectedClientId && (
                          <Badge variant="outline" className="text-[11px]">
                            Converted to client
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {[r.clientEmail, r.clientPhone, r.advocateName ? `for ${r.advocateName}` : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {r.matterSummary && (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {r.matterSummary}
                        </p>
                      )}
                      {(r.slotAt || r.proposedSlotAt) && (
                        <p className="mt-1 flex items-center gap-1.5 text-xs">
                          <CalendarClock className="size-3.5 text-[#B68A45]" aria-hidden="true" />
                          {r.slotAt ? "" : "Proposed: "}
                          {formatDateIN((r.slotAt ?? r.proposedSlotAt)!)}
                          {r.slotAt ? "" : " — awaiting the requester's confirmation"}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {r.status === "requested" && (
                        <AcceptButton consultationId={r._id} defaultSlot={r.slotAt} />
                      )}
                      {["requested", "accepted", "scheduled", "reschedule_proposed"].includes(r.status) && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => setRescheduleId(r._id)}
                          >
                            Reschedule
                          </Button>
                          <DeclineButton consultationId={r._id} mode="decline" />
                        </>
                      )}
                      {["scheduled", "paid", "accepted"].includes(r.status) && (
                        <CompleteButton consultationId={r._id} />
                      )}
                      {!r.connectedClientId && r.clientEmail && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => setConvertId(r._id)}
                        >
                          <UserPlus className="size-3.5" aria-hidden="true" />
                          Convert to client
                        </Button>
                      )}
                      {r.paymentLinkUrl && r.status === "accepted" && (
                        <a
                          href={r.paymentLinkUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="type-label inline-flex items-center gap-1 text-[#4f6b8f] underline-offset-2 hover:underline"
                        >
                          <ExternalLink className="size-3" /> Fee link
                        </a>
                      )}
                    </div>
                  </div>
                  {r.status === "declined" && r.cancelReason && (
                    <p className="mt-1 text-xs text-red-700">Reason: {r.cancelReason}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {convertId && (
        <ConvertDialog
          request={rows.find((r) => r._id === convertId)!}
          onClose={() => setConvertId(null)}
        />
      )}
      {rescheduleId && (
        <RescheduleDialog
          request={rows.find((r) => r._id === rescheduleId)!}
          onClose={() => setRescheduleId(null)}
        />
      )}
    </div>
  );
}

function AcceptButton({
  consultationId,
  defaultSlot,
}: {
  consultationId: Id<"consultations">;
  defaultSlot: number | null;
}) {
  const accept = useMutation(api.consultRequests.accept);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      className="h-7 text-xs"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await accept({ consultationId, slotAt: defaultSlot ?? undefined });
          toast.success("Request accepted — the requester will be notified.");
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Could not accept.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <BadgeCheck className="size-3.5" aria-hidden="true" />
      Accept
    </Button>
  );
}

function DeclineButton({
  consultationId,
  mode,
}: {
  consultationId: Id<"consultations">;
  mode: "decline" | "cancel";
}) {
  const decline = useMutation(api.consultRequests.decline);
  const cancel = useMutation(api.consultRequests.cancelByChamber);
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      if (mode === "decline") {
        await decline({ consultationId, reason });
      } else {
        await cancel({ consultationId, reason });
      }
      toast.success(mode === "decline" ? "Request declined." : "Booking cancelled.");
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 text-xs"
        onClick={() => setOpen(true)}
      >
        {mode === "decline" ? "Decline" : "Cancel"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">
              {mode === "decline" ? "Decline request" : "Cancel booking"}
            </DialogTitle>
            <DialogDescription>
              The requester sees this reason in their status notification and on
              the booking tracker. A written reason is required.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="e.g. The chamber does not take up matters in this area; may I suggest a colleague?"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Back
            </Button>
            <Button size="sm" variant="destructive" disabled={busy || !reason.trim()} onClick={run}>
              {mode === "decline" ? "Decline" : "Cancel booking"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CompleteButton({ consultationId }: { consultationId: Id<"consultations"> }) {
  const complete = useMutation(api.consultRequests.markCompleted);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 text-xs"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await complete({ consultationId });
          toast.success("Marked completed.");
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Failed.");
        } finally {
          setBusy(false);
        }
      }}
    >
      Mark completed
    </Button>
  );
}

function RescheduleDialog({
  request,
  onClose,
}: {
  request: ConsultRequest;
  onClose: () => void;
}) {
  const propose = useMutation(api.consultRequests.proposeReschedule);
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">Propose a new time</DialogTitle>
          <DialogDescription>
            {request.clientName} confirms (or declines) from their booking tracker
            using the reference code {request.reference ?? ""}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="rs-day">Date</Label>
            <Input id="rs-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rs-time">Time</Label>
            <Input id="rs-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={busy || !day || !time}
            onClick={async () => {
              const slotAt = new Date(`${day}T${time}`).getTime();
              if (Number.isNaN(slotAt) || slotAt < Date.now()) {
                toast.error("Pick a future date and time.");
                return;
              }
              setBusy(true);
              try {
                await propose({ consultationId: request._id, slotAt });
                toast.success("New time proposed.");
                onClose();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Propose
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConvertDialog({
  request,
  onClose,
}: {
  request: ConsultRequest;
  onClose: () => void;
}) {
  const convert = useMutation(api.consultRequests.convertToClient);
  const [kind, setKind] = useState("individual");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState(request.clientPhone ?? "");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">Convert to a connected client</DialogTitle>
          <DialogDescription>
            Creates (or matches) a client record for {request.clientName}. This is
            an authorization step by the chamber — the consultation booking itself
            never granted any access. Portal access still requires identity
            verification and explicit matter grants.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Client type</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="individual">Individual</SelectItem>
                <SelectItem value="company">Company</SelectItem>
                <SelectItem value="trust">Trust</SelectItem>
                <SelectItem value="government">Government</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cv-city">City (optional)</Label>
              <Input id="cv-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cv-phone">Phone (optional)</Label>
              <Input id="cv-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Requester email: {request.clientEmail ?? "— not given —"}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Back
            </Button>
            <Button
              size="sm"
              disabled={busy || !request.clientEmail}
              onClick={async () => {
                setBusy(true);
                try {
                  const res = await convert({
                    consultationId: request._id,
                    kind: kind as "individual" | "company" | "trust" | "government",
                    city: city || undefined,
                    phone: phone || undefined,
                  });
                  toast.success(
                    res.already ? "Already linked to a client record." : "Client record created/linked.",
                  );
                  onClose();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Convert
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Connect / rotate / disable the firm's OWN Razorpay merchant account.
 * Client money collects here — never through the platform account
 * (owner decision, 30 Sep 2026). Secrets are sent once and stored
 * encrypted; they are never displayed again.
 */
function MerchantDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const status = useQuery(api.orgMerchants.status, open ? {} : "skip") as
    | {
        connected: boolean;
        mode: string | null;
        keyIdLast4: string | null;
        connectedAt: number | null;
      }
    | undefined;
  const connect = useMutation(api.orgMerchants.connect);
  const disable = useMutation(api.orgMerchants.disable);

  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!keyId.trim() || !keySecret.trim()) {
      toast.error("Both the key id and the key secret are required.");
      return;
    }
    setBusy(true);
    try {
      await connect({
        keyId,
        keySecret,
        webhookSecret: webhookSecret || undefined,
      });
      toast.success(
        "Merchant account connected. Client payments now collect through your firm's own Razorpay account.",
      );
      setKeyId("");
      setKeySecret("");
      setWebhookSecret("");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      await disable({});
      toast.success("Merchant connection disabled — online collection stopped.");
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
          <DialogTitle className="font-serif">Firm payment account</DialogTitle>
          <DialogDescription>
            Client money must collect through your firm's own Razorpay
            account — never through the platform's. Test-mode keys only;
            live connections are a separate, explicit step.
          </DialogDescription>
        </DialogHeader>

        {status?.connected && (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="font-medium">
              Connected — key ••••{status.keyIdLast4} ({status.mode} mode)
            </p>
            <p className="ink-faded mt-1 text-xs">
              The secret is stored encrypted and is never shown again.
              Connect again with new keys to rotate.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              disabled={busy}
              onClick={turnOff}
            >
              Disable collection
            </Button>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <Label htmlFor="m-key-id">Razorpay test key id</Label>
            <Input
              id="m-key-id"
              value={keyId}
              onChange={(e) => setKeyId(e.target.value)}
              placeholder="rzp_test_…"
              autoComplete="off"
            />
          </div>
          <div>
            <Label htmlFor="m-key-secret">Key secret</Label>
            <Input
              id="m-key-secret"
              type="password"
              value={keySecret}
              onChange={(e) => setKeySecret(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div>
            <Label htmlFor="m-wh-secret">
              Webhook secret (optional, recommended)
            </Label>
            <Input
              id="m-wh-secret"
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              autoComplete="new-password"
            />
            <p className="ink-faded mt-1 text-xs">
              Point your firm's Razorpay dashboard webhook at
              {`${window.location.origin}/webhooks/razorpay/firm/<your-firm-id>`}
              . Events are verified against YOUR secret, and only your
              firm's own invoices can ever be reconciled by them.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Connecting…" : "Connect account"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
