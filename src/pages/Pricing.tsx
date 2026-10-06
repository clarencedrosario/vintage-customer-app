import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link } from "react-router";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { PLAN_CATEGORIES, categoryLabel } from "@/lib/planCatalog";
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
import { Scale } from "lucide-react";

function inr(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function tokens(n: number | null): string {
  return n == null ? "—" : n.toLocaleString("en-IN");
}

type CatalogPlan = NonNullable<
  ReturnType<typeof useQuery<typeof api.entitlements.publicPlanCatalog>>
>["plans"][number];

function PriceLine({ p }: { p: CatalogPlan }) {
  if (!p.priceConfigured) {
    return <span className="text-sm text-muted-foreground">Configuration pending</span>;
  }
  if (p.interval === "yearly") {
    const perMonth = Math.round(p.priceMinor / 12);
    return (
      <span>
        <span className="font-serif text-2xl font-semibold">{inr(p.priceMinor)}</span>
        <span className="text-xs text-muted-foreground"> /year</span>
        <span className="block text-xs text-muted-foreground">
          ≈ {inr(perMonth)} per month, billed yearly
        </span>
      </span>
    );
  }
  return (
    <span>
      <span className="font-serif text-2xl font-semibold">{inr(p.priceMinor)}</span>
      <span className="text-xs text-muted-foreground"> /month</span>
    </span>
  );
}

function PlanCard({ p }: { p: CatalogPlan }) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-lg font-semibold">{p.name}</h3>
          <p className="mt-0.5 text-xs uppercase tracking-[0.12em] text-muted-foreground">
            {categoryLabel(p.category)} · {p.billingUnit === "per_user" ? "per user" : "per firm"}
          </p>
        </div>
        {p.trialDays ? (
          <Badge variant="outline" className="shrink-0 border-sky-200 bg-sky-50 text-sky-900">
            {p.trialDays}-day trial
          </Badge>
        ) : null}
      </div>

      <div className="mt-4">
        <PriceLine p={p} />
        {p.savingsAmountMinor != null && p.savingsPercent != null && (
          <p className="mt-1 text-xs text-emerald-800">
            Saves {inr(p.savingsAmountMinor)} a year ({p.savingsPercent}%) vs paying monthly
          </p>
        )}
      </div>

      <ul className="mt-4 space-y-1.5 text-sm text-muted-foreground">
        <li>
          {p.kind === "individual" ? "Single-lawyer chamber" : "Firm"} ·{" "}
          {p.seatLimit ? `${p.seatLimit} seats` : "seat count not set"}
        </li>
        <li>
          {p.aiEnabled
            ? `AI included · ${tokens(p.aiAllowanceTokens)} tokens/month${p.aiAdvancedModel ? " · advanced tier when configured" : ""}`
            : "No AI — complete practice workspace"}
        </li>
        {p.aiEnabled && p.aiFeatures.length > 0 && <li>AI features: {p.aiFeatures.join(" · ")}</li>}
        {p.features.map((f) => (
          <li key={f}>{f}</li>
        ))}
        {p.storageLimitMb ? <li>{p.storageLimitMb} MB document storage</li> : null}
      </ul>

      <div className="mt-auto pt-5">
        {p.contactSales ? (
          <Button variant="outline" className="w-full" asChild>
            <a href="#contact">Contact sales</a>
          </Button>
        ) : p.purchasable ? (
          <Button className="w-full bg-sidebar-primary text-sidebar-primary-foreground hover:bg-[#C39A52]" asChild>
            <Link to="/login">Choose this plan</Link>
          </Button>
        ) : (
          <Button variant="outline" className="w-full" disabled>
            {p.priceConfigured ? "Online purchasing not open yet" : "Configuration pending"}
          </Button>
        )}
      </div>
    </div>
  );
}

function EnterpriseContact() {
  const request = useMutation(api.entitlements.requestEnterpriseContact);
  const [form, setForm] = useState({ name: "", email: "", orgName: "", orgSize: "", requirements: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await request({
        name: form.name,
        email: form.email,
        orgName: form.orgName || undefined,
        orgSize: form.orgSize || undefined,
        requirements: form.requirements,
      });
      setDone(res.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send the enquiry.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-6 py-5 text-sm text-emerald-900">
        {done}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="ent-name">Your name</Label>
        <Input
          id="ent-name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Advocate name"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ent-email">Work email</Label>
        <Input
          id="ent-email"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="you@chamber.in"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ent-org">Chamber / firm (optional)</Label>
        <Input
          id="ent-org"
          value={form.orgName}
          onChange={(e) => setForm({ ...form, orgName: e.target.value })}
          placeholder="e.g. M/s Krishnan & Associates"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ent-size">Team size (optional)</Label>
        <Input
          id="ent-size"
          value={form.orgSize}
          onChange={(e) => setForm({ ...form, orgSize: e.target.value })}
          placeholder="e.g. 12 advocates"
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="ent-req">Requirements</Label>
        <textarea
          id="ent-req"
          value={form.requirements}
          onChange={(e) => setForm({ ...form, requirements: e.target.value })}
          rows={4}
          placeholder="Tell us about your practice, seat counts, billing cycle and anything custom you need. (At least 20 characters.)"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="sm:col-span-2">
        <Button
          disabled={busy || !form.name.trim() || !form.email.trim() || form.requirements.trim().length < 20}
          onClick={submit}
          className="bg-sidebar-primary text-sidebar-primary-foreground hover:bg-[#C39A52]"
        >
          {busy ? "Sending…" : "Send enquiry"}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          This records an enquiry for our team to reply to your email. Nothing is charged and no
          plan is activated by this request.
        </p>
      </div>
    </div>
  );
}

export default function Pricing() {
  const catalog = useQuery(api.entitlements.publicPlanCatalog);
  const [interval, setInterval] = useState<"monthly" | "yearly">("monthly");

  const plans = catalog?.plans ?? [];
  const intervalReady = useMemo(
    () => ({
      monthly: plans.some((p) => p.interval === "monthly"),
      yearly: plans.some((p) => p.interval === "yearly"),
    }),
    [plans],
  );

  return (
    <div className="min-h-screen bg-sidebar">
      {/* Navy masthead — matches the landing page */}
      <header className="border-b border-sidebar-border">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
          <Link to="/" className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-md border border-sidebar-primary/40 text-sidebar-primary">
              <Scale className="size-4.5" aria-hidden="true" />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="font-serif text-lg font-semibold tracking-[0.06em] text-white">
                ADVOKATE.IN
              </span>
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-sidebar-primary">
                The Digital Chamber
              </span>
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <Link
              to="/find-a-lawyer"
              className="hidden text-sm font-medium text-slate-300 underline-offset-4 hover:text-white hover:underline sm:inline"
            >
              Find a Lawyer
            </Link>
            <Button asChild className="bg-sidebar-primary text-sidebar-primary-foreground hover:bg-[#C39A52]">
              <Link to="/login">Member Sign-In</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto w-full max-w-4xl px-6 pb-12 pt-14 text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-sidebar-primary">
            Plans &amp; Pricing
          </p>
          <h1 className="mx-auto mt-4 max-w-3xl font-serif text-4xl font-semibold leading-tight text-white sm:text-5xl">
            Priced honestly, for Indian practice.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-300">
            Every figure on this page comes from a configured price or it is not shown. Allowances
            are numbers, never "unlimited". AI is provided through your subscription — there is no
            separate consumer AI-service subscription to buy.
          </p>
        </section>

        {/* Light catalog */}
        <section className="paper-texture border-y border-border py-16">
          <div className="mx-auto w-full max-w-6xl px-6">
            {!catalog ? (
              <p className="text-center text-sm text-muted-foreground">Loading plans…</p>
            ) : (
              <>
                {/* Interval selector */}
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {(["monthly", "yearly"] as const).map((iv) => (
                    <button
                      key={iv}
                      type="button"
                      disabled={!intervalReady[iv]}
                      onClick={() => setInterval(iv)}
                      className={`rounded-full border px-5 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 ${
                        interval === iv
                          ? "border-sidebar-primary bg-sidebar text-white"
                          : "border-border bg-card text-foreground hover:bg-accent"
                      }`}
                    >
                      {iv === "monthly" ? "Monthly" : "Yearly"}
                    </button>
                  ))}
                </div>
                {!catalog.purchasingAvailable && (
                  <p className="mx-auto mt-4 max-w-2xl rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900">
                    Online purchasing is not switched on yet (the payment provider is not
                    configured). Plans are shown with their real structure; nothing can be
                    purchased or charged until the operator opens checkout.
                  </p>
                )}

                {/* Category sections */}
                <div className="mt-10 space-y-14">
                  {PLAN_CATEGORIES.map((cat) => {
                    const rows = plans.filter((p) => p.category === cat.id && p.interval === interval);
                    const otherInterval = plans.filter(
                      (p) => p.category === cat.id && p.interval !== interval,
                    );
                    if (rows.length === 0 && otherInterval.length === 0) return null;
                    return (
                      <div key={cat.id}>
                        <div className="text-center">
                          <p className="type-label ink-faded">{cat.label}</p>
                          <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                            {cat.blurb}
                          </p>
                          <hr className="engraving-rule mx-auto mt-5 w-28" />
                        </div>
                        {rows.length > 0 ? (
                          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {rows.map((p) => (
                              <PlanCard key={p.planId} p={p} />
                            ))}
                          </div>
                        ) : (
                          <p className="mt-6 text-center text-xs text-muted-foreground">
                            {cat.id === "enterprise"
                              ? "Enterprise arrangements are quoted by our team — use the contact form below."
                              : `Plans for this category are published for the ${otherInterval[0]?.interval === "yearly" ? "yearly" : "monthly"} cycle only.`}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Disclosures */}
                <div className="mx-auto mt-14 max-w-3xl rounded-xl border border-border bg-card p-6 shadow-sm">
                  <p className="type-label ink-faded">The fine print, in plain sight</p>
                  <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                    <li>
                      <strong className="text-foreground">Renewal — manual, by payment link:</strong> at
                      the end of each period we issue a payment link for the next period; renewal
                      completes when the link is paid. No automatic card charge is made — none is
                      implemented. If payment is not received within 7 days after the period end, the
                      subscription moves to a 7-day grace period and then becomes read-only (your
                      files stay viewable and exportable throughout).
                    </li>
                    <li>
                      <strong className="text-foreground">Plan changes — next-billing-period policy:</strong>{" "}
                      proration is not calculated in this release. Upgrades apply immediately and
                      nothing is charged at the moment of switching; the next payment covers the new
                      plan's full price. Downgrades can be scheduled for the period end and withdrawn
                      any time before it.
                    </li>
                    <li>
                      <strong className="text-foreground">Tax:</strong>{" "}
                      {plans.some((p) => p.taxInclusive === true)
                        ? "prices shown include tax where the plan says so; each card states its own treatment."
                        : plans.some((p) => p.taxInclusive === false)
                          ? "tax is added at checkout on top of the prices shown, per each plan's configuration."
                          : "the tax treatment of the published plans has not been configured yet — no tax claim is made on this page."}
                    </li>
                    <li>
                      <strong className="text-foreground">AI overage:</strong>{" "}
                      {plans.find((p) => p.overagePolicy)?.overagePolicy ??
                        "when a plan's monthly AI allowance is exhausted, new AI requests pause until the allowance resets — no overage is charged automatically."}
                    </li>
                    <li>
                      <strong className="text-foreground">Model availability:</strong> the advanced
                      AI tier is offered only when the platform operator has actually configured a
                      model for it; the standard tier likewise runs only while AI execution is
                      configured. Unavailability is reported honestly in the product.
                    </li>
                  </ul>
                </div>
              </>
            )}
          </div>
        </section>

        {/* Enterprise contact */}
        <section id="contact" className="paper-texture pb-20">
          <div className="mx-auto w-full max-w-3xl px-6">
            <Card>
              <CardHeader>
                <CardTitle className="font-serif text-2xl">Enterprise — talk to our team</CardTitle>
                <CardDescription>
                  Custom deployments are agreed for your practice, not advertised in advance. Send
                  your requirements and our team will reply by email.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <EnterpriseContact />
              </CardContent>
            </Card>
          </div>
        </section>
      </main>

      <footer className="border-t border-sidebar-border bg-sidebar py-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-6 sm:flex-row">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
            ADVOKATE.IN · The Digital Chamber · Made for Indian practice
          </p>
          <p className="text-xs text-slate-500">Billing in INR · Asia/Kolkata</p>
        </div>
      </footer>
    </div>
  );
}
