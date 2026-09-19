import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { ArrowLeft, Scale, Search } from "lucide-react";
import { useMemo, useState } from "react";

/**
 * Public directory of advocates on Advokate, for visitors who are not
 * members of any chamber. Lists named, non-client members with their
 * designation as the public face of the chamber.
 */
export default function FindALawyer() {
  const [q, setQ] = useState("");
  const team = useQuery(api.workspace.team);

  const advocates = useMemo(() => {
    const rows = (team ?? []).filter(
      (m) => m.status === "active" && m.orgRole !== "support_staff",
    );
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (m) =>
        (m.name ?? "").toLowerCase().includes(needle) ||
        (m.email ?? "").toLowerCase().includes(needle),
    );
  }, [team, q]);

  return (
    <div className="min-h-screen bg-sidebar">
      <header className="border-b border-sidebar-border">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
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
          <Button asChild variant="ghost" className="text-slate-300 hover:bg-sidebar-accent hover:text-white">
            <Link to="/">Back to portal selection</Link>
          </Button>
        </div>
      </header>

      <main className="paper-texture flex-1 px-6 py-16">
        <div className="mx-auto w-full max-w-3xl">
          <p className="type-label ink-faded">For public visitors</p>
          <h1 className="mt-3 font-serif text-4xl font-semibold tracking-tight">
            Find a Lawyer
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Advocates and chambers on Advokate. Contact an advocate directly
            about your matter; they will connect you to their client portal
            once engaged.
          </p>

          <div className="relative mt-8">
            <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name or email…"
              aria-label="Search advocates"
              className="w-full rounded-md border border-input bg-card py-2.5 pl-9 pr-3 text-sm outline-none focus:border-ring"
            />
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {team === undefined ? (
              <p className="text-sm ink-faded">Loading…</p>
            ) : advocates.length === 0 ? (
              <p className="text-sm ink-faded">
                No advocates listed yet.
              </p>
            ) : (
              advocates.map((m) => (
                <div
                  key={m.membershipId}
                  className="rule-frame rounded-xl p-5 shadow-sm"
                >
                  <p className="font-serif text-lg font-semibold">
                    {m.name ?? "Advocate"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {m.barCouncilId
                      ? `Bar Council ID ${m.barCouncilId}`
                      : "Member of the chamber"}
                  </p>
                </div>
              ))
            )}
          </div>

          <div className="mt-12 text-center">
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              Member? Choose your portal
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
