import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CalendarClock,
  FileText,
  Gavel,
  Landmark,
  Receipt,
  ScrollText,
  Search,
  Users,
} from "lucide-react";
import { Link, useNavigate } from "react-router";

const CAPABILITIES = [
  {
    icon: Gavel,
    title: "Matters & the docket",
    text: "Every matter carries its own reference, client, court and opposing party — with hearings, orders, documents and tasks arranged on an immutable docket.",
  },
  {
    icon: CalendarClock,
    title: "Cause list & deadlines",
    text: "The chamber's cause list in one view: appearances across courts, with tasks and due dates tracked to the matter they serve.",
  },
  {
    icon: Receipt,
    title: "Fees, GST & receipts",
    text: "Record time and disbursements on a matter, draft invoices with configurable tax, and receipt payments by UPI, NEFT, cash or cheque.",
  },
  {
    icon: FileText,
    title: "Documents & correspondence",
    text: "File pleadings, orders and communications against the matter they belong to — retrievable by anyone in chambers, in seconds.",
  },
  {
    icon: Users,
    title: "Clients of every kind",
    text: "Individuals, companies, trusts and government departments — with Indian address particulars and GSTIN where registered.",
  },
  {
    icon: Landmark,
    title: "Built for Indian practice",
    text: "INR billing, Asia/Kolkata time, Indian financial years (April–March) and state-wise address formats throughout.",
  },
];

const STEPS = [
  {
    no: "I.",
    title: "Enroll the chamber",
    text: "Set the chamber's particulars — name, address, GSTIN, tax rate and invoice prefix — once in Settings.",
  },
  {
    no: "II.",
    title: "Record clients & matters",
    text: "Add clients of every kind, then open matters against them. References are assigned automatically by year.",
  },
  {
    no: "III.",
    title: "Run the practice",
    text: "Schedule hearings, record orders, file documents, track time, and raise invoices — all from one intelligent workspace.",
  },
];

export default function Landing() {
  const { isLoading, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const portalHref = isAuthenticated ? "/dashboard" : "/auth";

  return (
    <div className="paper-texture relative flex min-h-screen flex-col">
      {/* Header */}
      <header className="relative z-10">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
          <Link to="/" className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full border border-foreground/25 text-primary">
              <ScrollText className="size-5" />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="font-serif text-lg font-semibold tracking-[0.08em]">
                ADVOKATE.IN
              </span>
              <span className="type-label ink-faded">The Digital Chamber</span>
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              className="hidden sm:inline-flex"
              onClick={() =>
                navigate(isAuthenticated ? "/dashboard" : "/auth")
              }
            >
              {isAuthenticated ? "Enter the Chamber" : "Member Sign-In"}
            </Button>
            <Button
              disabled={isLoading}
              onClick={() =>
                navigate(
                  isAuthenticated ? "/dashboard" : "/auth?returnTo=%2Fdashboard",
                )
              }
            >
              Open the Chamber
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1">
        <section className="vignette relative overflow-hidden">
          <div className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-24 pt-16 text-center sm:pt-24">
            <p className="type-label ink-faded">
              For Indian Advocates, Chambers & Law Firms
            </p>
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7 }}
              className="mx-auto mt-6 max-w-3xl font-serif text-4xl font-semibold leading-tight tracking-tight sm:text-6xl"
            >
              Run your entire chamber from one place.
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.15 }}
              className="mx-auto mt-6 max-w-2xl font-serif text-lg leading-relaxed ink-faded sm:text-xl"
            >
              Cases. Clients. Hearings. Documents. Billing. Communication.
              Research. Intelligence.
            </motion.p>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.25 }}
              className="mx-auto mt-4 max-w-xl text-base leading-relaxed ink-faded"
            >
              Advokate brings the whole practice of law under one roof — your
              entire legal practice, in one intelligent workspace.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.35 }}
              className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row"
            >
              <Button
                size="lg"
                disabled={isLoading}
                onClick={() => navigate(portalHref)}
                className="gap-2 px-8"
              >
                Enter the Chamber
                <ArrowRight className="size-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="px-8"
                onClick={() =>
                  document
                    .getElementById("capabilities")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
              >
                What's Inside
              </Button>
            </motion.div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.5 }}
              className="type-label mt-14 ink-faded"
            >
              One digital chamber. One intelligent workspace.
            </motion.p>
          </div>
        </section>

        {/* Capabilities */}
        <section
          id="capabilities"
          className="parchment-deep border-y border-border py-20"
        >
          <div className="mx-auto w-full max-w-6xl px-6">
            <div className="text-center">
              <p className="type-label ink-faded">The Workspace</p>
              <h2 className="mt-3 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
                Everything a chamber does, arranged around the matter
              </h2>
              <hr className="engraving-rule mx-auto mt-6 w-40" />
            </div>
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map((cap) => (
                <motion.div
                  key={cap.title}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5 }}
                  className="rule-frame bg-card p-6"
                >
                  <cap.icon className="size-5 text-primary" />
                  <h3 className="mt-4 font-serif text-xl font-semibold">
                    {cap.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed ink-faded">
                    {cap.text}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="py-20">
          <div className="mx-auto w-full max-w-5xl px-6">
            <div className="text-center">
              <p className="type-label ink-faded">Procedure</p>
              <h2 className="mt-3 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
                From enrollment to practice
              </h2>
              <hr className="engraving-rule mx-auto mt-6 w-40" />
            </div>
            <ol className="mt-12 grid gap-10 md:grid-cols-3">
              {STEPS.map((step, i) => (
                <motion.li
                  key={step.no}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.12 }}
                  className="relative text-center"
                >
                  <span className="font-serif text-4xl text-primary/70">
                    {step.no}
                  </span>
                  <h3 className="mt-3 font-serif text-xl font-semibold">
                    {step.title}
                  </h3>
                  <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed ink-faded">
                    {step.text}
                  </p>
                </motion.li>
              ))}
            </ol>
          </div>
        </section>

        {/* Relationship band */}
        <section className="parchment-deep border-y border-border py-16">
          <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-8 px-6 text-center sm:flex-row sm:text-left">
            <span className="flex size-16 shrink-0 items-center justify-center rounded-full border border-foreground/25 text-primary">
              <Search className="size-7" />
            </span>
            <div>
              <p className="type-label ink-faded">The Order of Things</p>
              <p className="mt-2 max-w-2xl text-lg leading-relaxed ink-faded">
                An organization keeps its team and clients. A client holds
                matters. And a matter holds everything else — parties,
                hearings, orders, documents, tasks, deadlines, notes,
                communications, time, expenses, invoices and payments — each
                linked back to the file it serves.
              </p>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="vignette parchment-deep relative overflow-hidden py-24">
          <div className="relative z-10 mx-auto w-full max-w-2xl px-6 text-center">
            <Gavel className="mx-auto size-8 text-primary" />
            <h2 className="mt-6 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
              Your entire legal practice. One intelligent workspace.
            </h2>
            <Button
              size="lg"
              disabled={isLoading}
              onClick={() => navigate(portalHref)}
              className="mt-8 gap-2 px-10"
            >
              {isAuthenticated ? "Return to the Chamber" : "Enroll Your Chamber"}
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-10">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
          <p className="type-label ink-faded">
            ADVOKATE.IN · The Digital Chamber · Made for Indian practice
          </p>
          <p className="text-sm ink-faded">
            Billing in INR · Asia/Kolkata · April–March financial year
          </p>
        </div>
      </footer>
    </div>
  );
}
