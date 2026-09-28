import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  CalendarClock,
  FileText,
  Gavel,
  Headset,
  Scale,
  Search,
  Users,
} from "lucide-react";

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
    icon: FileText,
    title: "Fees, GST & receipts",
    text: "Record time and disbursements, draft invoices with configurable tax, and receipt payments by UPI, NEFT, cash or cheque.",
  },
  {
    icon: Users,
    title: "One chamber, every role",
    text: "Advocates, firm administration, support staff and clients each work in their own space over the same live records.",
  },
];

const PROOF = [
  {
    title: "Organisation-first",
    text: "Independent chambers and multi-lawyer firms each hold their own register, permission matrix and billing identity.",
  },
  {
    title: "Roles with restraint",
    text: "Nine working roles from Owner to Support Staff, each with an editable permission matrix — support staff can never see what they should not.",
  },
  {
    title: "Clients in the loop",
    text: "Approved updates, shared chronology, hearing dates and secure messages — never internal strategy.",
  },
];

export default function Landing() {
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
          <div className="flex items-center gap-3">
            <Link
              to="/find-a-lawyer"
              className="hidden text-sm font-medium text-slate-300 underline-offset-4 hover:text-white hover:underline sm:inline"
            >
              Find a Lawyer
            </Link>
            <Button
              asChild
              className="bg-sidebar-primary text-sidebar-primary-foreground hover:bg-[#C39A52]"
            >
              <Link to="/login">Member Sign-In</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto w-full max-w-4xl px-6 pb-14 pt-16 text-center sm:pt-20">
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
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button
              size="lg"
              asChild
              className="gap-2 bg-sidebar-primary px-8 text-sidebar-primary-foreground hover:bg-[#C39A52]"
            >
              <Link to="/login">
                Sign in to the chamber
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button
              size="lg"
              asChild
              variant="outline"
              className="gap-2 border-sidebar-border bg-transparent px-8 text-slate-200 hover:bg-white/5 hover:text-white"
            >
              <Link to="/find-a-lawyer">
                <Search className="size-4" aria-hidden="true" />
                Find a Lawyer
              </Link>
            </Button>
            <Button
              size="lg"
              asChild
              variant="outline"
              className="gap-2 border-sidebar-border bg-transparent px-8 text-slate-200 hover:bg-white/5 hover:text-white"
            >
              <Link to="/owner">
                <Headset className="size-4" aria-hidden="true" />
                Open owner console
              </Link>
            </Button>
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

        {/* Proof points */}
        <section className="paper-texture pb-20">
          <div className="mx-auto w-full max-w-6xl px-6">
            <div className="grid gap-4 sm:grid-cols-3">
              {PROOF.map((p) => (
                <div
                  key={p.title}
                  className="rounded-xl border border-border bg-card p-6 shadow-sm"
                >
                  <h3 className="font-serif text-lg font-semibold">{p.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {p.text}
                  </p>
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
              asChild
              className="mt-8 gap-2 bg-sidebar-primary px-10 text-sidebar-primary-foreground hover:bg-[#C39A52]"
            >
              <Link to="/login">
                Enroll Your Chamber
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
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
