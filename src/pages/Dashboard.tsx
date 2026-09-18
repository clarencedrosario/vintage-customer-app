import { ChamberShell } from "@/components/ChamberShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  formatINRCompact,
  formatDateIN,
  formatDateTimeIN,
  PRACTICE_AREAS,
} from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  CalendarClock,
  FolderOpen,
  ListChecks,
  Plus,
  Receipt,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

const MATTER_STATUS: Record<MatterStatus, { label: string; className: string }> =
  {
    open: { label: "Open", className: "text-chart-3" },
    in_progress: { label: "In Progress", className: "text-chart-2" },
    on_hold: { label: "On Hold", className: "text-muted-foreground" },
    closed: { label: "Closed", className: "text-muted-foreground" },
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
      toast.error(
        err instanceof Error ? err.message : "Could not open the matter.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="size-4" aria-hidden="true" />
          Open a matter
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <p className="type-label ink-faded">New Entry</p>
          <DialogTitle className="font-serif text-2xl">
            Open a matter
          </DialogTitle>
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
              <p className="text-xs text-muted-foreground">
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

  // Reading the clock is a render side-effect; get it once per subscription
  // via a state initializer instead of calling Date.now() during render.
  const [now] = useState(() => Date.now());
  const upcomingHearings = (hearings ?? [])
    .filter((h) => h.status === "scheduled" && h.at > now)
    .slice(0, 6);
  const pendingTasks = (tasks ?? []).slice(0, 6);

  const stats = [
    {
      icon: FolderOpen,
      label: "Open matters",
      value: overview?.openMatters ?? "—",
    },
    {
      icon: Receipt,
      label: "Clients on record",
      value: overview?.clients ?? "—",
    },
    {
      icon: CalendarClock,
      label: "Upcoming hearings",
      value: overview?.upcomingHearings ?? "—",
    },
    {
      icon: ListChecks,
      label: "Pending tasks",
      value: overview?.pendingTasks ?? "—",
    },
  ];

  return (
    <ChamberShell
      subtitle="The Digital Chamber"
      title="Practice Overview"
      actions={<NewMatterDialog />}
    >
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="shadow-sm">
            <CardContent className="pt-5">
              <s.icon
                className="size-4 text-[#B68A45]"
                aria-hidden="true"
              />
              <p className="mt-2 font-serif text-3xl font-semibold">
                {s.value}
              </p>
              <p className="type-label mt-1 ink-faded">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Cause list */}
      <section className="mt-8">
        <h2 className="font-serif text-xl font-semibold">Cause list</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Scheduled appearances across courts.
        </p>
        <div className="rule-frame mt-3 overflow-x-auto rounded-lg">
          {hearings === undefined ? (
            <p className="p-6 text-sm text-muted-foreground">
              Consulting the diary…
            </p>
          ) : upcomingHearings.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No hearings scheduled. Add one from any matter file.
            </p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Matter</th>
                  <th scope="col">Hearing</th>
                  <th scope="col">Court</th>
                  <th scope="col">Before</th>
                  <th scope="col">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {upcomingHearings.map((h) => (
                  <tr key={h._id}>
                    <td className="type-label ink-faded">
                      {h.matter?.reference ?? "—"}
                    </td>
                    <td className="font-medium">{h.title}</td>
                    <td className="text-muted-foreground">{h.court ?? "—"}</td>
                    <td className="whitespace-nowrap">
                      {formatDateTimeIN(h.at)}
                    </td>
                    <td className="text-right">
                      <Link
                        to={`/matters/${h.matterId}`}
                        className="text-sm font-medium text-[#8a6a33] hover:underline"
                        aria-label={`Open matter file for ${h.title}`}
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Tasks */}
      <section className="mt-8">
        <h2 className="font-serif text-xl font-semibold">Tasks & deadlines</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Pending work across all matters, soonest due first.
        </p>
        <div className="rule-frame mt-3 overflow-x-auto rounded-lg">
          {tasks === undefined ? (
            <p className="p-6 text-sm text-muted-foreground">
              Reviewing the list…
            </p>
          ) : pendingTasks.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              Nothing pending. The docket is clear.
            </p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Matter</th>
                  <th scope="col">Task</th>
                  <th scope="col">Due</th>
                  <th scope="col">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pendingTasks.map((t) => (
                  <tr key={t._id}>
                    <td className="type-label ink-faded">
                      {t.matter?.reference ?? "—"}
                    </td>
                    <td className="font-medium">{t.title}</td>
                    <td className="whitespace-nowrap text-muted-foreground">
                      {t.dueAt ? formatDateIN(t.dueAt) : "—"}
                    </td>
                    <td className="text-right">
                      <Link
                        to={`/matters/${t.matterId}`}
                        className="text-sm font-medium text-[#8a6a33] hover:underline"
                        aria-label={`Open matter file for task ${t.title}`}
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
        {/* Matters */}
        <section>
          <h2 className="font-serif text-xl font-semibold">
            Matters before the chamber
          </h2>
          <div className="rule-frame mt-3 overflow-x-auto rounded-lg">
            {matters === undefined ? (
              <p className="p-6 text-sm text-muted-foreground">
                Consulting the ledger…
              </p>
            ) : matters.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">
                No matters on file yet. Open your first matter to begin the
                chamber's record.
              </p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Reference</th>
                    <th scope="col">Matter</th>
                    <th scope="col">Client</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {matters.slice(0, 8).map((m) => {
                    const st = MATTER_STATUS[m.status];
                    return (
                      <tr key={m._id}>
                        <td className="type-label ink-faded">{m.reference}</td>
                        <td className="font-serif text-[15px] font-semibold">
                          {m.title}
                        </td>
                        <td className="text-muted-foreground">
                          {m.client?.name ?? "—"}
                        </td>
                        <td>
                          <span className={`stamp ${st.className}`}>
                            {st.label}
                          </span>
                        </td>
                        <td className="text-right">
                          <Link
                            to={`/matters/${m._id}`}
                            className="text-sm font-medium text-[#8a6a33] hover:underline"
                            aria-label={`Open matter ${m.reference}`}
                          >
                            Open
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Outstanding */}
        <aside>
          <h2 className="font-serif text-xl font-semibold">Outstanding</h2>
          <div className="rule-frame mt-3 rounded-lg">
            {outstanding === undefined ? (
              <p className="p-6 text-sm text-muted-foreground">
                Consulting the books…
              </p>
            ) : outstanding.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">
                Nothing outstanding. The books are balanced.
              </p>
            ) : (
              <ul>
                {outstanding.slice(0, 6).map((i) => (
                  <li key={i._id}>
                    <Link
                      to="/billing"
                      className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-accent/40"
                    >
                      <span className="type-label ink-faded">{i.number}</span>
                      <span className="flex items-center gap-2 font-serif font-semibold text-[#8a6a33]">
                        {formatINRCompact(i.total - i.amountPaid)}
                        <ArrowRight className="size-3.5" aria-hidden="true" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </ChamberShell>
  );
}
