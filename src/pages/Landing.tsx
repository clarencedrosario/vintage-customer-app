import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  CalendarClock,
  FileText,
  Gavel,
  Landmark,
  Receipt,
  Scale,
  Users,
} from "lucide-react";
import { Link, useNavigate } from "react-router";

const PORTALS = [
  {
    to: "/dashboard",
    icon: Landmark,
    title: "Practice Overview",
    text: "Open matters, the cause list, pending tasks and outstanding fees — the chamber at a glance.",
  },
  {
    to: "/clients",
    icon: Users,
    title: "Clients & Matters",
    text: "Individuals, companies, trusts and government departments, with every matter on its own file.",
  },
  {
    to: "/billing",
    icon: Receipt,
    title: "Billing & Receipts",
    text: "Invoices raised from time and expenses, GST applied, payments receipted against each bill.",
  },
];

const CAPABILITIES = [
  {
    icon: Gavel,
    title: "Matters & the docket",
    text: "Every matter carries its reference, court and parties — with hearings, orders, documents and tasks arranged on an immutable docket.",
  },
  {
    icon: CalendarClock,
    title: "Cause list & deadlines",
    text: "Appearances across courts in one view, with tasks and due dates tracked to the matter they serve.",
  },
  {
    icon: Receipt,
    title: "Fees, GST & receipts",
    text: "Record time and disbursements, draft invoices with configurable tax, and receipt payments by UPI, NEFT, cash or cheque.",
  },
  {
    icon: FileText,
    title: "Documents & correspondence",
    text: "File pleadings, orders and communications against the matter they belong to — retrievable in seconds.",
  },
];

export default function Landing() {
  const { isLoading, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const portalHref = isAuthenticated ? "/dashboard" : "/auth";

  return (
    <div className="min-h-screen bg-sidebar">
      {/* Navy masthead */}
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
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              className="hidden text-slate-300 hover:bg-sidebar-accent hover:text-white sm:inline-flex"
              onClick={() => navigate(isAuthenticated ? "/dashboard" : "/auth")}
            >
              Member Sign-In
            </Button>
            <Button
              disabled={isLoading}
              className="bg-sidebar-primary text-sidebar-primary-foreground hover:bg-[#C39A52]"
              onClick={() =>
                navigate(
                  isAuthenticated
                    ? "/dashboard"
                    : "/auth?returnTo=%2Fdashboard",
                )
              }
            >
              Open the Chamber
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto w-full max-w-4xl px-6 pb-16 pt-16 text-center sm:pt-20">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-sidebar-primary">
            For Indian Advocates, Chambers &amp; Law Firms
          </p>
          <h1 className="mx-auto mt-5 max-w-3xl font-serif text-4xl font-semibold leading-tight text-white sm:text-5xl">
            Run your entire chamber from one place.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-300">
            Cases. Clients. Hearings. Documents. Billing. Communication.
            Research. Intelligence — your entire legal practice in one
            intelligent workspace.
          </p>

          {/* Portal selection cards */}
          <div className="mx-auto mt-12 grid max-w-4xl gap-4 text-left sm:grid-cols-3">
            {PORTALS.map((p) => (
              <Link
                key={p.to + p.title}
                to={isAuthenticated ? p.to : "/auth"}
                className="group rounded-xl border border-sidebar-border bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
              >
                <span className="flex size-9 items-center justify-center rounded-md border border-border text-primary">
                  <p.icon className="size-4.5" aria-hidden="true" />
                </span>
                <h2 className="mt-4 font-serif text-lg font-semibold text-foreground">
                  {p.title}
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {p.text}
                </p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-[#8a6a33] transition-transform group-hover:translate-x-0.5">
                  Enter
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* Light section: capabilities */}
        <section className="paper-texture border-y border-border py-20">
          <div className="mx-auto w-full max-w-6xl px-6">
            <div className="text-center">
              <p className="type-label ink-faded">The Workspace</p>
              <h2 className="mt-3 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
                Everything a chamber does, arranged around the matter
              </h2>
              <hr className="engraving-rule mx-auto mt-6 w-40" />
            </div>
            <div className="mt-12 grid gap-4 sm:grid-cols-2">
              {CAPABILITIES.map((cap) => (
                <div
                  key={cap.title}
                  className="flex gap-4 rounded-xl border border-border bg-card p-6 shadow-sm"
                >
                  <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-primary">
                    <cap.icon className="size-4.5" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 className="font-serif text-lg font-semibold">
                      {cap.title}
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                      {cap.text}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Navy closing band */}
        <section className="bg-sidebar py-20">
          <div className="mx-auto w-full max-w-2xl px-6 text-center">
            <h2 className="font-serif text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Your entire legal practice. One intelligent workspace.
            </h2>
            <p className="mt-4 text-sm uppercase tracking-[0.14em] text-sidebar-primary">
              One digital chamber
            </p>
            <Button
              size="lg"
              disabled={isLoading}
              className="mt-8 gap-2 bg-sidebar-primary px-10 text-sidebar-primary-foreground hover:bg-[#C39A52]"
              onClick={() => navigate(portalHref)}
            >
              {isAuthenticated ? "Return to the Chamber" : "Enroll Your Chamber"}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-sidebar-border bg-sidebar py-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-6 sm:flex-row">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
            ADVOKATE.IN · The Digital Chamber · Made for Indian practice
          </p>
          <p className="text-xs text-slate-500">
            Billing in INR · Asia/Kolkata · April–March financial year
          </p>
        </div>
      </footer>
    </div>
  );
}
