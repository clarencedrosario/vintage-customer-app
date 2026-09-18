import { ChamberShell } from "@/components/ChamberShell";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import type { MatterStatus } from "@/convex/schema";
import { formatINRCompact, formatDateIN, formatDateTimeIN, PRACTICE_AREAS } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  CalendarClock,
  FolderOpen,
  Landmark,
  ListChecks,
  Plus,
  Receipt,
  ScrollText,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

const MATTER_STATUS: Record<
  MatterStatus,
  { label: string; className: string }
> = {
  open: { label: "Open", className: "text-chart-2" },
  in_progress: { label: "In Progress", className: "text-chart-4" },
  on_hold: { label: "On Hold", className: "text-muted-foreground" },
  closed: { label: "Closed", className: "text-chart-3" },
};

function NewMatterDialog() {
  const clients = useQuery(api.clients.list);
  const createMatter = useMutation(api.matters.create);

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState("");
  const [practiceArea, setPracticeArea] = useState("");
  const [court, setCourt] = useState("");
  const [opposingParty, setOpposingParty] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const handleCreate = async () => {
    if (!title.trim() || !clientId || !practiceArea) {
      toast.error("Title, client and practice area are required.");
      return;
    }
    setBusy(true);
    try {
      await createMatter({
        title,
        clientId: clientId as never,
        practiceArea,
        court: court || undefined,
        opposingParty: opposingParty || undefined,
        description: description || undefined,
      });
      toast.success("Matter opened. The reference has been assigned.");
      setOpen(false);
      setTitle("");
      setClientId("");
      setPracticeArea("");
      setCourt("");
      setOpposingParty("");
      setDescription("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open the matter.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="size-4" />
          Open a matter
        </Button>
      </DialogTrigger>
      <DialogContent className="rule-frame bg-card sm:max-w-lg">
        <DialogHeader>
          <p className="type-label ink-faded">New Entry</p>
          <DialogTitle className="font-serif text-2xl">Open a matter</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nm-title">Matter title</Label>
            <Input
              id="nm-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Writ petition — land acquisition"
            />
          </div>
          <div className="space-y-2">
            <Label>Client</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a client" />
              </SelectTrigger>
              <SelectContent>
                {(clients ?? []).map((c) => (
                  <SelectItem key={c._id} value={c._id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(clients ?? []).length === 0 && (
              <p className="text-xs ink-faded">
                No clients yet — add one from the Clients page first.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Practice area</Label>
            <Select value={practiceArea} onValueChange={setPracticeArea}>
              <SelectTrigger>
                <SelectValue placeholder="Select practice area" />
              </SelectTrigger>
              <SelectContent>
                {PRACTICE_AREAS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="nm-court">Court / forum</Label>
              <Input
                id="nm-court"
                value={court}
                onChange={(e) => setCourt(e.target.value)}
                placeholder="e.g. Bombay High Court"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nm-opp">Opposing party</Label>
              <Input
                id="nm-opp"
                value={opposingParty}
                onChange={(e) => setOpposingParty(e.target.value)}
                placeholder="e.g. State of Maharashtra"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="nm-desc">Brief description</Label>
            <Textarea
              id="nm-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="The nature of the dispute or engagement…"
              className="min-h-[80px]"
            />
          </div>
          <Button className="w-full" onClick={handleCreate} disabled={busy}>
            {busy ? "Opening…" : "Open the matter"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Dashboard() {
  const overview = useQuery(api.workspace.overview);
  const hearings = useQuery(api.matters.allHearings);
  const tasks = useQuery(api.matters.upcomingTasks);
  const matters = useQuery(api.matters.list);
  const outstanding = useQuery(api.billing.outstanding);

  const now = Date.now();
  const upcomingHearings = (hearings ?? []).filter(
    (h) => h.status === "scheduled" && h.at > now,
  );
  const pendingTasks = (tasks ?? []).slice(0, 6);

  const stats = [
    { icon: FolderOpen, label: "Open matters", value: overview?.openMatters ?? "—", to: "/dashboard" },
    { icon: Users, label: "Clients on record", value: overview?.clients ?? "—", to: "/clients" },
    { icon: CalendarClock, label: "Upcoming hearings", value: overview?.upcomingHearings ?? "—", to: "/dashboard" },
    { icon: ListChecks, label: "Pending tasks", value: overview?.pendingTasks ?? "—", to: "/dashboard" },
  ];

  return (
    <ChamberShell
      subtitle="The Digital Chamber"
      actions={<NewMatterDialog />}
    >
      <p className="type-label ink-faded">Chamber Overview</p>
      <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
        One digital chamber. One intelligent workspace.
      </h1>

      {/* Stat cards */}
      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} to={s.to}>
            <Card className="rule-frame bg-card transition-colors hover:bg-accent/40">
              <CardContent className="pt-6">
                <s.icon className="size-5 text-primary" />
                <p className="mt-3 font-serif text-3xl font-semibold">{s.value}</p>
                <p className="type-label mt-1 ink-faded">{s.label}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        {/* Upcoming hearings */}
        <section>
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold">
              <CalendarClock className="size-5 text-primary" />
              Cause list
            </h2>
          </div>
          {hearings === undefined ? (
            <p className="mt-4 text-sm ink-faded">Consulting the diary…</p>
          ) : upcomingHearings.length === 0 ? (
            <Card className="mt-4 border-dashed">
              <CardContent className="py-8 text-center text-sm ink-faded">
                No hearings scheduled. Add one from any matter file.
              </CardContent>
            </Card>
          ) : (
            <ul className="mt-4 space-y-3">
              {upcomingHearings.slice(0, 6).map((h) => (
                <li key={h._id}>
                  <Link
                    to={`/matters/${h.matterId}`}
                    className="rule-frame flex flex-wrap items-center justify-between gap-3 bg-card p-4 transition-colors hover:bg-accent/40"
                  >
                    <div className="min-w-0">
                      <p className="type-label ink-faded">
                        {h.matter?.reference}
                      </p>
                      <h3 className="mt-0.5 font-serif text-lg font-semibold">
                        {h.title}
                      </h3>
                      {h.court && (
                        <p className="mt-0.5 text-sm ink-faded">{h.court}</p>
                      )}
                    </div>
                    <span className="stamp text-primary">
                      {formatDateTimeIN(h.at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Pending tasks */}
        <section>
          <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold">
            <ListChecks className="size-5 text-primary" />
            Tasks & deadlines
          </h2>
          {tasks === undefined ? (
            <p className="mt-4 text-sm ink-faded">Reviewing the list…</p>
          ) : pendingTasks.length === 0 ? (
            <Card className="mt-4 border-dashed">
              <CardContent className="py-8 text-center text-sm ink-faded">
                Nothing pending. The docket is clear.
              </CardContent>
            </Card>
          ) : (
            <ul className="mt-4 space-y-3">
              {pendingTasks.map((t) => (
                <li key={t._id}>
                  <Link
                    to={`/matters/${t.matterId}`}
                    className="rule-frame flex flex-wrap items-center justify-between gap-3 bg-card p-4 transition-colors hover:bg-accent/40"
                  >
                    <div className="min-w-0">
                      <p className="type-label ink-faded">
                        {t.matter?.reference}
                      </p>
                      <p className="mt-0.5">{t.title}</p>
                    </div>
                    {t.dueAt && (
                      <span className="stamp ink-faded">
                        due {formatDateIN(t.dueAt)}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_340px]">
        {/* Matters */}
        <section>
          <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold">
            <ScrollText className="size-5 text-primary" />
            Matters before the chamber
          </h2>
          {matters === undefined ? (
            <p className="mt-4 text-sm ink-faded">Consulting the ledger…</p>
          ) : matters.length === 0 ? (
            <Card className="mt-4 border-dashed">
              <CardContent className="flex flex-col items-center py-10 text-center">
                <Landmark className="size-8 text-muted-foreground" />
                <p className="mt-4 font-serif text-xl">No matters on file</p>
                <p className="mt-2 max-w-sm text-sm ink-faded">
                  Open your first matter to begin the chamber's record.
                </p>
              </CardContent>
            </Card>
          ) : (
            <ul className="mt-4 space-y-3">
              {matters.slice(0, 6).map((m) => {
                const st = MATTER_STATUS[m.status];
                return (
                  <li key={m._id}>
                    <Link
                      to={`/matters/${m._id}`}
                      className="rule-frame block bg-card p-4 transition-colors hover:bg-accent/40"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="type-label ink-faded">
                            {m.reference} · {m.practiceArea}
                          </p>
                          <h3 className="mt-0.5 truncate font-serif text-lg font-semibold">
                            {m.title}
                          </h3>
                          <p className="mt-0.5 text-sm ink-faded">
                            {m.client?.name}
                          </p>
                        </div>
                        <span className={`stamp ${st.className}`}>{st.label}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Outstanding */}
        <aside>
          <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold">
            <Receipt className="size-5 text-primary" />
            Outstanding
          </h2>
          {outstanding === undefined ? (
            <p className="mt-4 text-sm ink-faded">Consulting the books…</p>
          ) : outstanding.length === 0 ? (
            <Card className="mt-4 border-dashed">
              <CardContent className="py-8 text-center text-sm ink-faded">
                Nothing outstanding. The books are balanced.
              </CardContent>
            </Card>
          ) : (
            <ul className="mt-4 space-y-3">
              {outstanding.slice(0, 5).map((i) => (
                <li key={i._id}>
                  <Link
                    to="/billing"
                    className="rule-frame flex items-center justify-between gap-3 bg-card p-4 transition-colors hover:bg-accent/40"
                  >
                    <div className="min-w-0">
                      <p className="type-label ink-faded">{i.number}</p>
                      <p className="mt-0.5 font-serif text-lg font-semibold text-primary">
                        {formatINRCompact(i.total - i.amountPaid)}
                      </p>
                    </div>
                    <ArrowRight className="size-4 ink-faded" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </ChamberShell>
  );
}
