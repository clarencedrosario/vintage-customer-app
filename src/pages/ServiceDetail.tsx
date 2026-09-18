import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { BrandMark } from "@/components/BrandMark";
import { formatPrice } from "@/pages/Catalog";
import { useAuth } from "@/hooks/use-auth";
import {
  ArrowLeft,
  CalendarClock,
  Clock,
  CreditCard,
  FileCheck,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

/** Next few business days at set hours, for the schedule picker. */
function buildSlots(): { at: number; label: string }[] {
  const slots: { at: number; label: string }[] = [];
  const d = new Date();
  d.setSeconds(0, 0);
  while (slots.length < 9) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day === 0 || day === 6) continue;
    for (const hour of [9, 11, 14]) {
      const s = new Date(d);
      s.setHours(hour, 0, 0, 0);
      slots.push({
        at: s.getTime(),
        label: s.toLocaleString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }),
      });
    }
  }
  return slots;
}

export default function ServiceDetail() {
  const { slug } = useParams<{ slug: string }>();
  const service = useQuery(
    api.services.getBySlug,
    slug ? { slug } : "skip",
  );
  const createOrder = useAction(api.orders.createOrder);
  const createBooking = useMutation(api.orders.createBooking);
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();

  const slots = buildSlots();
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [placing, setPlacing] = useState(false);

  const requireAccount = (fn: () => Promise<void> | void) => {
    if (!isAuthenticated) {
      navigate(
        `/auth?returnTo=${encodeURIComponent(`/catalog/${slug ?? ""}`)}`,
      );
      return;
    }
    void fn();
  };

  const handleBook = async () => {
    if (selectedSlot === null) {
      toast.error("Choose a time for the consultation first.");
      return;
    }
    try {
      await createBooking({ serviceId: service!._id, startAt: selectedSlot });
      toast.success("Consultation reserved. See your workspace for details.");
      navigate("/dashboard?tab=consultations");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Booking failed.");
    }
  };

  const handleCheckout = async (kind: "card" | "invoice") => {
    if (!companyName.trim() || !billingEmail.trim()) {
      toast.error("Company name and billing email are required.");
      return;
    }
    setPlacing(true);
    try {
      const res = await createOrder({
        serviceId: service!._id,
        kind,
        companyName,
        billingEmail,
        notes: notes || undefined,
      });
      if (res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
        return;
      }
      toast.success(
        "Order received. The firm will send your invoice shortly.",
      );
      navigate("/dashboard?tab=orders");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Checkout failed.");
    } finally {
      setPlacing(false);
    }
  };

  if (service === undefined) {
    return (
      <div className="paper-texture flex min-h-screen items-center justify-center">
        <p className="type-label ink-faded">Retrieving the brief…</p>
      </div>
    );
  }

  if (service === null) {
    return (
      <div className="paper-texture flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
        <h1 className="font-serif text-2xl font-semibold">
          This service is not in the catalog
        </h1>
        <Button asChild variant="outline">
          <Link to="/catalog">
            <ArrowLeft className="mr-2 size-4" />
            Back to the catalog
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="paper-texture min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
          <BrandMark subtitle="Catalog of Counsel" />
          <Button asChild variant="outline" size="sm">
            <Link to="/catalog">
              <ArrowLeft className="mr-2 size-4" />
              Catalog
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-6 py-10">
        {/* Brief */}
        <div className="rule-frame bg-card p-8">
          <p className="type-label ink-faded">{service.category}</p>
          <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight">
            {service.name}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-5 text-sm ink-faded">
            <span className="flex items-center gap-1.5">
              <Clock className="size-4" />
              {service.durationMinutes}-minute consultation included
            </span>
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="size-4" />
              Fixed fee — no hourly drift
            </span>
          </div>
          <Separator className="my-6" />
          <p className="leading-relaxed ink-faded">{service.description}</p>
          <p className="mt-8 font-serif text-3xl font-semibold text-primary">
            {formatPrice(service.priceCents)}
          </p>
        </div>

        <div className="mt-10 grid gap-10 lg:grid-cols-2">
          {/* Schedule */}
          <section className="rule-frame bg-card p-6">
            <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold">
              <CalendarClock className="size-5 text-primary" />
              Reserve a consultation
            </h2>
            <p className="mt-2 text-sm ink-faded">
              Included with this service. Choose from the firm’s open hours;
              you can adjust later from your workspace.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {slots.map((slot) => (
                <button
                  key={slot.at}
                  type="button"
                  onClick={() => setSelectedSlot(slot.at)}
                  className={`rule-frame px-3 py-2.5 text-left text-xs transition-colors ${
                    selectedSlot === slot.at
                      ? "bg-primary text-primary-foreground"
                      : "bg-background hover:bg-accent/50"
                  }`}
                >
                  {slot.label}
                </button>
              ))}
            </div>
            <Button
              className="mt-5 w-full"
              disabled={authLoading}
              onClick={() => requireAccount(handleBook)}
            >
              {isAuthenticated
                ? "Confirm this time"
                : "Sign in to reserve"}
            </Button>
          </section>

          {/* Checkout */}
          <section className="rule-frame bg-card p-6">
            <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold">
              <CreditCard className="size-5 text-primary" />
              Engage this service
            </h2>
            <p className="mt-2 text-sm ink-faded">
              Enter your company details. Pay now by card, or request an
              invoice against your accounts-payable process.
            </p>
            <div className="mt-5 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="sd-company">Company name</Label>
                <Input
                  id="sd-company"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Acme Manufacturing Co."
                  disabled={placing}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sd-email">Billing email</Label>
                <Input
                  id="sd-email"
                  type="email"
                  value={billingEmail}
                  onChange={(e) => setBillingEmail(e.target.value)}
                  placeholder="accounts@company.com"
                  disabled={placing}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sd-notes">
                  Notes for counsel{" "}
                  <span className="ink-faded">(optional)</span>
                </Label>
                <Textarea
                  id="sd-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Context the attorney should know before the first call…"
                  className="min-h-[90px]"
                  maxLength={2000}
                  disabled={placing}
                />
              </div>

              <Button
                className="w-full gap-2"
                disabled={placing || authLoading}
                onClick={() =>
                  requireAccount(() => handleCheckout("card"))
                }
              >
                {placing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CreditCard className="size-4" />
                )}
                Pay {formatPrice(service.priceCents)} by card
              </Button>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-card px-2 type-label ink-faded">or</span>
                </div>
              </div>
              <Button
                variant="outline"
                className="w-full gap-2"
                disabled={placing || authLoading}
                onClick={() =>
                  requireAccount(() => handleCheckout("invoice"))
                }
              >
                <FileCheck className="size-4" />
                Request an invoice
              </Button>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
