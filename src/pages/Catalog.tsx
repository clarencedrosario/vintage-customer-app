import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { BrandMark } from "@/components/BrandMark";
import { useAuth } from "@/hooks/use-auth";
import {
  ArrowRight,
  Briefcase,
  Clock,
  Search as SearchIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";

export function formatPrice(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

export default function Catalog() {
  const services = useQuery(api.services.list);
  const seed = useMutation(api.services.seed);
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");

  // Seed the catalog the first time the page is opened.
  useEffect(() => {
    if (services?.length === 0) {
      void seed();
    }
  }, [services, seed]);

  const categories = useMemo(() => {
    if (!services) return [];
    return Array.from(new Set(services.map((s) => s.category))).sort();
  }, [services]);

  const filtered = useMemo(() => {
    if (!services) return [];
    const q = search.trim().toLowerCase();
    return services.filter((s) => {
      const matchesCategory = category === "all" || s.category === category;
      const matchesSearch =
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.summary.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [services, search, category]);

  return (
    <div className="paper-texture min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
          <BrandMark subtitle="Catalog of Counsel" />
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              navigate(isAuthenticated ? "/dashboard" : "/auth?returnTo=%2Fcatalog")
            }
          >
            {isAuthenticated ? "Your Workspace" : "Sign In"}
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 py-12">
        <div className="max-w-2xl">
          <p className="type-label ink-faded">Fixed-Fee Legal Services</p>
          <h1 className="mt-2 font-serif text-4xl font-semibold tracking-tight">
            The Catalog
          </h1>
          <p className="mt-3 text-lg ink-faded">
            Published rates, defined scope. Select a service to review the full
            brief, reserve time with counsel, and check out.
          </p>
        </div>

        {/* Search & filters */}
        <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search services — contracts, employment, trademark…"
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCategory("all")}
              className={`stamp ${category === "all" ? "text-primary" : "ink-faded"}`}
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`stamp ${category === c ? "text-primary" : "ink-faded"}`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        {services === undefined ? (
          <p className="mt-16 text-center type-label ink-faded">
            Opening the catalog…
          </p>
        ) : filtered.length === 0 ? (
          <div className="mt-16 text-center">
            <Briefcase className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-4 font-serif text-xl">
              No services match that search
            </p>
            <p className="mt-2 text-sm ink-faded">
              Adjust the terms, or clear the category filter.
            </p>
          </div>
        ) : (
          <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((s) => (
              <li key={s._id}>
                <Link
                  to={`/catalog/${s.slug}`}
                  className="rule-frame flex h-full flex-col bg-card p-6 transition-colors hover:bg-accent/40"
                >
                  <Badge variant="outline" className="type-label w-fit ink-faded">
                    {s.category}
                  </Badge>
                  <h2 className="mt-4 font-serif text-xl font-semibold leading-snug">
                    {s.name}
                  </h2>
                  <p className="mt-2 flex-1 text-sm leading-relaxed ink-faded">
                    {s.summary}
                  </p>
                  <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
                    <span className="font-serif text-lg font-semibold text-primary">
                      {formatPrice(s.priceCents)}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs ink-faded">
                      <Clock className="size-3.5" />
                      {s.durationMinutes} min
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
