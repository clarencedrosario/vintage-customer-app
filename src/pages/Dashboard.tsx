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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import type { MatterStatus } from "@/convex/schema";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  Feather,
  Inbox,
  LogOut,
  Scale,
  ScrollText,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

const PRACTICE_AREAS = [
  "Family Law",
  "Estate & Wills",
  "Real Estate",
  "Business & Contracts",
  "Employment",
  "Personal Injury",
  "Immigration",
  "Criminal Defense",
];

const STATUS_STYLES: Record<MatterStatus, { label: string; className: string }> =
  {
    received: {
      label: "Received",
      className: "text-chart-2",
    },
    under_review: {
      label: "Under Review",
      className: "text-chart-4",
    },
    engaged: {
      label: "Engaged",
      className: "text-chart-3",
    },
    closed: {
      label: "Closed",
      className: "text-muted-foreground",
    },
  };

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const matters = useQuery(api.matters.listMine);
  const submitInquiry = useMutation(api.matters.submitInquiry);

  const [title, setTitle] = useState("");
  const [practiceArea, setPracticeArea] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

  return (
    <div className="paper-texture min-h-screen">
      {/* Header */}
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
          <Link to="/" className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full border border-foreground/25 text-primary">
              <Scale className="size-5" />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="font-serif text-lg font-semibold tracking-wide">
                Whitmore &amp; Hale
              </span>
              <span className="type-label ink-faded">Client Portal</span>
            </span>
          </Link>
          <div className="flex items-center gap-4">
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
        {/* Salutation */}
        <div className="flex flex-col gap-2 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="type-label ink-faded">The Ledger of Matters</p>
            <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
              Dear {user?.name?.split(" ")[0] ?? "Client"},
            </h1>
            <p className="mt-2 max-w-xl text-ink-faded">
              Below is the current record of your matters before the firm. File
              a new inquiry at any time; counsel attends to each entry in turn.
            </p>
          </div>
        </div>

        <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_380px]">
          {/* Ledger of matters */}
          <section>
            <div className="flex items-center gap-3">
              <ScrollText className="size-5 text-primary" />
              <h2 className="font-serif text-2xl font-semibold">
                Your matters
              </h2>
              <span className="stamp ink-faded ml-1">
                {matters === undefined
                  ? "…"
                  : `${matters.length} on file`}
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
                    When you file your first inquiry, it will be entered here
                    with a docket and status.
                  </p>
                  <Feather className="mt-4 size-4 text-primary/70" />
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

          {/* New inquiry */}
          <aside>
            <Card className="rule-frame bg-card">
              <CardHeader>
                <p className="type-label ink-faded">Form of Retainer</p>
                <CardTitle className="mt-1 font-serif text-2xl">
                  File a new inquiry
                </CardTitle>
                <CardDescription>
                  Set down the nature of your matter. The firm will enter it in
                  the ledger upon receipt.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="inquiry-title">Matter title</Label>
                    <Input
                      id="inquiry-title"
                      placeholder="e.g. Disputed boundary with neighbour"
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
                      Description of your situation
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
                  <p className="text-center text-xs ink-faded">
                    Filing an inquiry does not by itself create an
                    attorney–client relationship.
                  </p>
                </form>
              </CardContent>
            </Card>
          </aside>
        </div>
      </main>
    </div>
  );
}
