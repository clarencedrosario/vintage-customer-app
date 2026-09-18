import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Briefcase,
  CalendarClock,
  FileText,
  Landmark,
  MessagesSquare,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Link, useNavigate } from "react-router";

const CAPABILITIES = [
  {
    icon: Search,
    title: "Catalog of counsel",
    text: "Browse fixed-fee legal services for businesses — contracts, corporate, employment, IP and compliance — with transparent pricing.",
  },
  {
    icon: CalendarClock,
    title: "Scheduling that holds",
    text: "Reserve time with the right attorney directly from a service page. Confirmations appear in your dashboard at once.",
  },
  {
    icon: ShieldCheck,
    title: "Checkout you can audit",
    text: "Pay by card or request an invoice against your company account. Every order is receipted and traceable.",
  },
  {
    icon: FileText,
    title: "Matters & documents",
    text: "Open matters, follow the docket as work progresses, and exchange documents with counsel in one secure file.",
  },
  {
    icon: MessagesSquare,
    title: "Correspondence on the record",
    text: "Message the firm from any matter. Every exchange is entered on the docket, so nothing rests on memory.",
  },
  {
    icon: Landmark,
    title: "Oversight for the firm",
    text: "An administrative area keeps clients, engagements, bookings and revenue under one ledger.",
  },
];

const STEPS = [
  {
    no: "I.",
    title: "Enroll your company",
    text: "Create a business account and set out the matters your company needs counsel for.",
  },
  {
    no: "II.",
    title: "Engage from the catalog",
    text: "Compare fixed-fee services, book a consultation, and check out by card or company invoice.",
  },
  {
    no: "III.",
    title: "Follow the work",
    text: "Track each engagement on its docket — statuses, correspondence, and documents in one place.",
  },
];

const PROOF = [
  { figure: "3,400+", label: "matters administered" },
  { figure: "96%", label: "renewal rate, 2025" },
  { figure: "48h", label: "median first response" },
  { figure: "11", label: "practice areas covered" },
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
              <Briefcase className="size-5" />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="font-serif text-lg font-semibold tracking-[0.08em]">
                ADVOKATE
              </span>
              <span className="type-label ink-faded">
                Legal Operations for Business
              </span>
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
              {isAuthenticated ? "Your Workspace" : "Client Sign-In"}
            </Button>
            <Button
              disabled={isLoading}
              onClick={() =>
                navigate(
                  isAuthenticated
                    ? "/catalog"
                    : "/auth?returnTo=%2Fcatalog",
                )
              }
            >
              Browse the Catalog
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1">
        <section className="vignette relative overflow-hidden">
          <div className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-24 pt-16 text-center sm:pt-24">
            <p className="type-label ink-faded">
              Est. 1927 · The Law Office, Modernised
            </p>
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7 }}
              className="mx-auto mt-6 max-w-3xl font-serif text-4xl font-semibold leading-tight tracking-tight sm:text-6xl"
            >
              Managing legal work for business, without the correspondence
              chasing.
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.15 }}
              className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed ink-faded"
            >
              Advokate is the operational desk between your company and its
              counsel. Engage fixed-fee services from the catalog, schedule
              consultations, settle invoices, and follow every matter on its
              docket — from one serious, auditable workspace.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.3 }}
              className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row"
            >
              <Button
                size="lg"
                disabled={isLoading}
                onClick={() => navigate(portalHref)}
                className="gap-2 px-8"
              >
                Open Your Workspace
                <ArrowRight className="size-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="px-8"
                onClick={() => navigate("/catalog")}
              >
                Browse the Catalog
              </Button>
            </motion.div>

            {/* Proof figures */}
            <motion.dl
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.5 }}
              className="mx-auto mt-16 grid max-w-3xl grid-cols-2 gap-8 sm:grid-cols-4"
            >
              {PROOF.map((p) => (
                <div key={p.label}>
                  <dt className="sr-only">{p.label}</dt>
                  <dd className="font-serif text-3xl font-semibold text-primary">
                    {p.figure}
                  </dd>
                  <dd className="type-label mt-1 ink-faded">{p.label}</dd>
                </div>
              ))}
            </motion.dl>
          </div>
        </section>

        {/* Capabilities */}
        <section
          id="capabilities"
          className="parchment-deep border-y border-border py-20"
        >
          <div className="mx-auto w-full max-w-6xl px-6">
            <div className="text-center">
              <p className="type-label ink-faded">The Platform</p>
              <h2 className="mt-3 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
                Everything a company’s legal desk should do
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
                From enrollment to engagement
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

        {/* Final CTA */}
        <section className="vignette relative overflow-hidden py-24 parchment-deep">
          <div className="relative z-10 mx-auto w-full max-w-2xl px-6 text-center">
            <FileText className="mx-auto size-8 text-primary" />
            <h2 className="mt-6 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
              Put your company’s legal affairs in order
            </h2>
            <p className="mt-4 text-lg ink-faded">
              Enroll once. Then engage counsel as needed — with the assurance
              that every engagement, payment and document is on the record.
            </p>
            <Button
              size="lg"
              disabled={isLoading}
              onClick={() => navigate(portalHref)}
              className="mt-8 gap-2 px-10"
            >
              {isAuthenticated ? "Return to Your Workspace" : "Enroll Your Company"}
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-10">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
          <p className="type-label ink-faded">
            Advokate · Operated by Whitmore &amp; Hale LLP
          </p>
          <p className="text-sm ink-faded">
            Nothing on this site constitutes legal advice or creates an
            attorney–client relationship.
          </p>
        </div>
      </footer>
    </div>
  );
}
