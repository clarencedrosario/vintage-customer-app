import { useAuth } from "@/hooks/use-auth";
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
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import type { MatterStatus, OrderStatus } from "@/convex/schema";
import { formatPrice } from "@/pages/Catalog";
import { BrandMark } from "@/components/BrandMark";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  CalendarClock,
  Feather,
  Inbox,
  LogOut,
  Receipt,
  ScrollText,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

const PRACTICE_AREAS = [
  "Contracts",
  "Corporate",
  "Employment",
  "Intellectual Property",
  "Compliance",
  "Disputes",
  "Other",
];

const STATUS_STYLES: Record<MatterStatus, { label: string; className: string }> =
  {
    received: { label: "Received", className: "text-chart-2" },
    under_review: { label: "Under Review", className: "text-chart-4" },
    engaged: { label: "Engaged", className: "text-chart-3" },
    closed: { label: "Closed", className: "text-muted-foreground" },
  };

const ORDER_STATUS: Record<OrderStatus, { label: string; className: string }> = {
  pending: { label: "Awaiting Payment", className: "text-chart-4" },
  paid: { label: "Paid", className: "text-chart-3" },
  invoiced: { label: "Invoiced", className: "text-chart-2" },
  cancelled: { label: "Cancelled", className: "text-muted-foreground" },
};

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const matters = useQuery(api.matters.listMine);
  const orders = useQuery(api.orders.listWithService);
  const bookings = useQuery(api.orders.listMyBookings);
  const submitInquiry = useMutation(api.matters.submitInquiry);
  const cancelBooking = useMutation(api.orders.cancelBooking);
  const verifyOrder = useAction(api.orders.verifyOrder);

  const [title, setTitle] = useState("");
  const [practiceArea, setPracticeArea] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const activeTab = searchParams.get("tab") ?? "matters";
  const setTab = (tab: string) => {
    setSearchParams(tab === "matters" ? {} : { tab });
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim() || !description.trim() || !practiceArea) {
      toast.error("Please complete all three fields before filing.");
      return;
    }
    setSubmitting(true);
    try {
      await submitInquiry({ title, practiceArea, description });
      toast.success("Inquiry filed. The firm has been notified.");
      setTitle("");
      setPracticeArea("");
      setDescription("");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "The inquiry could not be filed.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  // After Stripe Checkout redirects back, verify payment with Stripe.
  const returnOrderId = searchParams.get("order");
  const returnStatus = searchParams.get("status");
  const [verified, setVerified] = useState<string | null>(null);
  useEffect(() => {
    if (!returnOrderId) return;
    if (verified === returnOrderId) return;
    setVerified(returnOrderId);
    if (returnStatus === "cancelled") {
      toast.info("Checkout was cancelled — the order remains unpaid.");
      setSearchParams({});
      return;
    }
    verifyOrder({ orderId: returnOrderId as never })
      .then((status) => {
        if (status === "paid") {
          toast.success("Payment confirmed. Thank you.");
        } else {
          toast.info("Payment is still processing; check back shortly.");
        }
        setSearchParams({});
      })
      .catch((err) => {
        toast.error(
          err instanceof Error ? err.message : "Verification failed.",
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnOrderId, returnStatus, verified]);

  return (
    <div className="paper-texture min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
          <BrandMark subtitle="Client Workspace" />
          <div className="flex items-center gap-4">
            {user?.role === "admin" && (
              <Button asChild variant="ghost" size="sm">
                <Link to="/admin">Firm Administration</Link>
              </Button>
            )}
            <span className="hidden text-sm ink-faded sm:inline">
              {user?.email ?? "Client"}
            </span>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              <LogOut className="mr-2 size-4" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="flex flex-col gap-2 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="type-label ink-faded">The Ledger of Matters</p>
            <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
              Dear {user?.name?.split(" ")[0] ?? "Client"},
            </h1>
            <p className="mt-2 max-w-xl ink-faded">
              Your company’s engagements before the firm — matters,
              consultations and orders, all on the record.
            </p>
          </div>
          <Button asChild className="gap-2 self-start sm:self-auto">
            <Link to="/catalog">
              Browse the Catalog
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setTab} className="mt-8">
          <TabsList>
            <TabsTrigger value="matters" className="gap-2">
              <ScrollText className="size-4" />
              Matters
            </TabsTrigger>
            <TabsTrigger value="consultations" className="gap-2">
              <CalendarClock className="size-4" />
              Consultations
            </TabsTrigger>
            <TabsTrigger value="orders" className="gap-2">
              <Receipt className="size-4" />
              Orders & Invoices
            </TabsTrigger>
          </TabsList>

          {/* ---------------- Matters ---------------- */}
          <TabsContent value="matters" className="mt-8">
            <div className="grid gap-10 lg:grid-cols-[1fr_380px]">
              <section>
                <div className="flex items-center gap-3">
                  <h2 className="font-serif text-2xl font-semibold">
                    Your matters
                  </h2>
                  <span className="stamp ink-faded">
                    {matters === undefined ? "…" : `${matters.length} on file`}
                  </span>
                </div>

                {matters === undefined ? (
                  <Card className="mt-6">
                    <CardContent className="py-10 text-center text-sm ink-faded">
                      Consulting the ledger…
                    </CardContent>
                  </Card>
                ) : matters.length === 0 ? (
                  <Card className="mt-6 border-dashed">
                    <CardContent className="flex flex-col items-center py-12 text-center">
                      <Inbox className="size-8 text-muted-foreground" />
                      <p className="mt-4 font-serif text-xl">
                        No matters on file
                      </p>
                      <p className="mt-2 max-w-sm text-sm ink-faded">
                        File the form beside this, or engage a fixed-fee
                        service from the catalog to open your first matter.
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <ul className="mt-6 space-y-4">
                    {matters.map((matter) => {
                      const status = STATUS_STYLES[matter.status];
                      return (
                        <li key={matter._id}>
                          <Link
                            to={`/matters/${matter._id}`}
                            className="rule-frame block bg-card p-5 transition-colors hover:bg-accent/50"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="type-label ink-faded">
                                  {matter.practiceArea} · Filed{" "}
                                  {formatDate(matter.createdAt)}
                                </p>
                                <h3 className="mt-1 truncate font-serif text-xl font-semibold">
                                  {matter.title}
                                </h3>
                              </div>
                              <span className={`stamp ${status.className}`}>
                                {status.label}
                              </span>
                            </div>
                            <p className="mt-3 line-clamp-2 text-sm leading-relaxed ink-faded">
                              {matter.description}
                            </p>
                            <p className="mt-4 flex items-center gap-1 text-sm text-primary">
                              Consult the file
                              <ArrowRight className="size-3.5" />
                            </p>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <aside>
                <Card className="rule-frame bg-card">
                  <CardHeader>
                    <p className="type-label ink-faded">Form of Retainer</p>
                    <CardTitle className="mt-1 font-serif text-2xl">
                      File a new inquiry
                    </CardTitle>
                    <CardDescription>
                      Set down the nature of the matter. The firm will enter it
                      in the ledger upon receipt.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-5">
                      <div className="space-y-2">
                        <Label htmlFor="inquiry-title">Matter title</Label>
                        <Input
                          id="inquiry-title"
                          placeholder="e.g. Review of distributor agreement"
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          maxLength={120}
                          disabled={submitting}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Practice area</Label>
                        <Select
                          value={practiceArea}
                          onValueChange={setPracticeArea}
                          disabled={submitting}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select a practice area" />
                          </SelectTrigger>
                          <SelectContent>
                            {PRACTICE_AREAS.map((area) => (
                              <SelectItem key={area} value={area}>
                                {area}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="inquiry-description">
                          Description
                        </Label>
                        <Textarea
                          id="inquiry-description"
                          placeholder="Set out the facts plainly, with dates where you have them…"
                          className="min-h-[140px]"
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          maxLength={4000}
                          disabled={submitting}
                          required
                        />
                        <p className="text-right text-xs ink-faded">
                          {description.length}/4000
                        </p>
                      </div>
                      <Button
                        type="submit"
                        className="w-full gap-2"
                        disabled={submitting}
                      >
                        <Feather className="size-4" />
                        {submitting ? "Filing…" : "File the inquiry"}
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </aside>
            </div>
          </TabsContent>

          {/* ---------------- Consultations ---------------- */}
          <TabsContent value="consultations" className="mt-8">
            {bookings === undefined ? (
              <p className="type-label ink-faded">Consulting the diary…</p>
            ) : bookings.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center py-12 text-center">
                  <CalendarClock className="size-8 text-muted-foreground" />
                  <p className="mt-4 font-serif text-xl">
                    No consultations reserved
                  </p>
                  <p className="mt-2 max-w-sm text-sm ink-faded">
                    Any service in the catalog includes time with counsel.
                    Reserve a slot from a service page.
                  </p>
                  <Button asChild variant="outline" className="mt-6">
                    <Link to="/catalog">Browse the Catalog</Link>
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <ul className="space-y-4">
                {bookings.map((b) => (
                  <li
                    key={b._id}
                    className="rule-frame flex flex-wrap items-center justify-between gap-4 bg-card p-5"
                  >
                    <div className="min-w-0">
                      <p className="type-label ink-faded">
                        {b.service?.category}
                      </p>
                      <h3 className="mt-1 font-serif text-lg font-semibold">
                        {b.service?.name ?? "Consultation"}
                      </h3>
                      <p className="mt-1 text-sm ink-faded">
                        {formatDateTime(b.startAt)}
                      </p>
                      {b.notes && (
                        <p className="mt-2 line-clamp-2 text-sm ink-faded">
                          {b.notes}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`stamp ${
                          b.status === "confirmed"
                            ? "text-chart-3"
                            : b.status === "cancelled"
                              ? "text-muted-foreground"
                              : "text-chart-2"
                        }`}
                      >
                        {b.status}
                      </span>
                      {b.status === "confirmed" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            try {
                              await cancelBooking({ bookingId: b._id });
                              toast.success("Booking cancelled.");
                            } catch (err) {
                              toast.error(
                                err instanceof Error
                                  ? err.message
                                  : "Cancellation failed.",
                              );
                            }
                          }}
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          {/* ---------------- Orders & invoices ---------------- */}
          <TabsContent value="orders" className="mt-8">
            {orders === undefined ? (
              <p className="type-label ink-faded">Consulting the ledger…</p>
            ) : orders.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center py-12 text-center">
                  <Receipt className="size-8 text-muted-foreground" />
                  <p className="mt-4 font-serif text-xl">No orders yet</p>
                  <p className="mt-2 max-w-sm text-sm ink-faded">
                    Engagements you purchase — by card or on invoice — appear
                    here with their payment status.
                  </p>
                  <Button asChild variant="outline" className="mt-6">
                    <Link to="/catalog">Browse the Catalog</Link>
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <ul className="space-y-4">
                {orders.map((o) => {
                  const st = ORDER_STATUS[o.status];
                  return (
                    <li
                      key={o._id}
                      className="rule-frame flex flex-wrap items-center justify-between gap-4 bg-card p-5"
                    >
                      <div className="min-w-0">
                        <p className="type-label ink-faded">
                          {o.kind === "card" ? "Card order" : "Invoice"} ·{" "}
                          {formatDate(o.createdAt)}
                          {o.companyName ? ` · ${o.companyName}` : ""}
                        </p>
                        <h3 className="mt-1 font-serif text-lg font-semibold">
                          {o.service?.name ?? "Service"}
                        </h3>
                        {o.notes && (
                          <p className="mt-1 line-clamp-1 text-sm ink-faded">
                            {o.notes}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="font-serif text-lg font-semibold text-primary">
                          {formatPrice(o.amountCents)}
                        </span>
                        <span className={`stamp ${st.className}`}>
                          {st.label}
                        </span>
                        {o.status === "pending" && (
                          <Button
                            size="sm"
                            onClick={async () => {
                              try {
                                const status = await verifyOrder({
                                  orderId: o._id,
                                });
                                if (status === "paid") {
                                  toast.success("Payment confirmed.");
                                } else {
                                  toast.info(
                                    "Still awaiting payment at the processor.",
                                  );
                                }
                              } catch (err) {
                                toast.error(
                                  err instanceof Error
                                    ? err.message
                                    : "Verification failed.",
                                );
                              }
                            }}
                          >
                            Verify payment
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
