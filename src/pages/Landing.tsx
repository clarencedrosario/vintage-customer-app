import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { Scale, Feather, Landmark, ScrollText, ArrowRight } from "lucide-react";
import { Link, useNavigate } from "react-router";

const PRACTICE_AREAS = [
  {
    title: "Family Law",
    blurb:
      "Custody, support and dissolution — handled with candour and a steady hand.",
  },
  {
    title: "Estate & Wills",
    blurb:
      "Wills, trusts and probate, drafted so your affairs read plainly to those who follow.",
  },
  {
    title: "Real Estate",
    blurb:
      "Conveyances, titles and disputes, from the first offer to the final deed.",
  },
  {
    title: "Business & Contracts",
    blurb:
      "Formation, review and negotiation, with terms written to be honoured.",
  },
];

const STEPS = [
  {
    no: "I.",
    title: "Submit your inquiry",
    text: "Set down the nature of your matter in your own words, through the secure client portal.",
  },
  {
    no: "II.",
    title: "The firm reviews",
    text: "An attorney examines your file and records the matter in the ledger, marked “under review.”",
  },
  {
    no: "III.",
    title: "Correspond & resolve",
    text: "Exchange secure correspondence with counsel and follow each entry on your matter’s docket.",
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
              <Scale className="size-5" />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="font-serif text-lg font-semibold tracking-wide text-foreground">
                Whitmore &amp; Hale
              </span>
              <span className="type-label ink-faded">Attorneys at Law</span>
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
              {isAuthenticated ? "Client Portal" : "Client Sign-In"}
            </Button>
            <Button
              disabled={isLoading}
              onClick={() =>
                navigate(
                  isAuthenticated
                    ? "/dashboard"
                    : "/auth?returnTo=%2Fdashboard",
                )
              }
            >
              Begin an Inquiry
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1">
        <section className="vignette relative overflow-hidden">
          <div className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-24 pt-16 text-center sm:pt-24">
            <p className="type-label ink-faded">
              Est. 1927 · Counsel in Confidence
            </p>
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7 }}
              className="mx-auto mt-6 max-w-3xl font-serif text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-6xl"
            >
              Sound counsel, kept as it always has been — in writing.
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.15 }}
              className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed ink-faded"
            >
              Whitmore &amp; Hale is a general-practice firm serving clients
              across the state. Open a matter, follow its progress on the
              docket, and correspond with your attorney — all from a private
              client portal.
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
                onClick={() =>
                  navigate(
                    isAuthenticated ? "/dashboard" : "/auth?returnTo=%2Fdashboard",
                  )
                }
                className="gap-2 px-8"
              >
                Open the Client Portal
                <ArrowRight className="size-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="px-8"
                onClick={() =>
                  document
                    .getElementById("practices")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
              >
                Our Practice Areas
              </Button>
            </motion.div>
          </div>
        </section>

        {/* Practice areas */}
        <section id="practices" className="parchment-deep border-y border-border py-20">
          <div className="mx-auto w-full max-w-6xl px-6">
            <div className="text-center">
              <p className="type-label ink-faded">The Firm’s Practice</p>
              <h2 className="mt-3 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
                Areas in which we are retained
              </h2>
              <hr className="engraving-rule mx-auto mt-6 w-40" />
            </div>
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {PRACTICE_AREAS.map((area) => (
                <motion.div
                  key={area.title}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5 }}
                  className="rule-frame bg-card p-6 text-center"
                >
                  <Feather className="mx-auto size-5 text-primary" />
                  <h3 className="mt-4 font-serif text-xl font-semibold">
                    {area.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed ink-faded">
                    {area.blurb}
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
                Retaining the firm, step by step
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

        {/* Archival band */}
        <section className="parchment-deep border-y border-border py-16">
          <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-8 px-6 text-center sm:flex-row sm:text-left">
            <span className="flex size-16 shrink-0 items-center justify-center rounded-full border border-foreground/25 text-primary">
              <Landmark className="size-7" />
            </span>
            <div>
              <p className="type-label ink-faded">The Ledger &amp; Docket</p>
              <p className="mt-2 max-w-2xl text-lg leading-relaxed ink-faded">
                Every inquiry is entered in the firm ledger, assigned a docket,
                and tracked to conclusion. Clients may consult their own file at
                any hour — the record, as ever, speaks for itself.
              </p>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="vignette relative overflow-hidden py-24">
          <div className="relative z-10 mx-auto w-full max-w-2xl px-6 text-center">
            <ScrollText className="mx-auto size-8 text-primary" />
            <h2 className="mt-6 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
              Put your matter before counsel
            </h2>
            <p className="mt-4 text-lg ink-faded">
              Create your client account and submit an inquiry today. The firm
              attends to every communication with discretion.
            </p>
            <Button
              size="lg"
              disabled={isLoading}
              onClick={() =>
                navigate(
                  isAuthenticated ? "/dashboard" : "/auth?returnTo=%2Fdashboard",
                )
              }
              className="mt-8 gap-2 px-10"
            >
              {isAuthenticated ? "Return to the Portal" : "Sign In / Register"}
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-10">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
          <p className="type-label ink-faded">
            Whitmore &amp; Hale LLP · 1 Counsellor Row, Suite 400
          </p>
          <p className="text-sm ink-faded">
            The information here does not constitute legal advice, nor does it
            create an attorney–client relationship.
          </p>
        </div>
      </footer>
    </div>
  );
}
