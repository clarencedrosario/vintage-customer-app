import { ChamberShell } from "@/components/ChamberShell";
import { ConflictGatePanel } from "@/components/ConflictGatePanel";
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
import type { MatterStatus, OrgRole } from "@/convex/schema";
import {
  formatINRCompact,
  formatDateTimeIN,
  formatDateIN,
  PRACTICE_AREAS,
} from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  CalendarClock,
  ClipboardList,
  FolderOpen,
  Gavel,
  ListChecks,
  Plus,
  Receipt,
  ScrollText,
  TriangleAlert,
  UsersRound,
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

/** Roles that get the firm-management view in addition to their desk. */
const FIRM_VIEW_ROLES: readonly OrgRole[] = [
  "owner",
  "partner",
  "administrator",
];

function NewMatterDialog() {
  const clients = useQuery(api.clients.list);
  const members = useQuery(api.workspace.team);
  const createMatter = useMutation(api.matters.create);

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const conflict = useQuery(
    api.clients.conflictCheck,
    title.trim().length >= 3 ? { name: title.trim() } : "skip",
  );
  const [clientId, setClientId] = useState("");
  const [practiceArea, setPracticeArea] = useState("");
  const [court, setCourt] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [caseNumber, setCaseNumber] = useState("");
  const [bench, setBench] = useState("");
  const [opposingParty, setOpposingParty] = useState("");
  const [opposingCounsel, setOpposingCounsel] = useState("");
  const [description, setDescription] = useState("");
  const [leadLawyerId, setLeadLawyerId] = useState("");
  const [priority, setPriority] = useState("normal");
  const [billingArrangement, setBillingArrangement] = useState("");
  const [conflictCleared, setConflictCleared] = useState(false);
  const [busy, setBusy] = useState(false);
  const selectedClient = (clients ?? []).find((c) => c._id === clientId);

  const lawyerOptions = (members ?? []).filter(
    (m) => m.status === "active" && m.orgRole !== "support_staff",
  );

  const handleCreate = async () => {
    if (!title.trim() || !clientId || !practiceArea) {
      toast.error("Title, client and practice area are required.");
      return;
    }
    if (!conflictCleared) {
      toast.error("Run and clear the conflict check before opening the matter.");
      return;
    }
    setBusy(true);
    try {
      await createMatter({
        title,
        clientId: clientId as never,
        practiceArea,
        court: court || undefined,
        jurisdiction: jurisdiction || undefined,
        caseNumber: caseNumber || undefined,
        bench: bench || undefined,
        opposingParty: opposingParty || undefined,
        opposingCounsel: opposingCounsel || undefined,
        description: description || undefined,
        leadLawyerId: (leadLawyerId || undefined) as never,
        priority: priority as "normal" | "high" | "urgent",
        billingArrangement: billingArrangement || undefined,
      });
      toast.success("Matter opened. The reference has been assigned.");
      setOpen(false);
      setTitle("");
      setClientId("");
      setPracticeArea("");
      setCourt("");
      setJurisdiction("");
      setCaseNumber("");
      setBench("");
      setOpposingParty("");
      setOpposingCounsel("");
      setDescription("");
      setLeadLawyerId("");
      setPriority("normal");
      setBillingArrangement("");
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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <p className="type-label ink-faded">New Entry</p>
          <DialogTitle className="font-serif text-2xl">
            Open a matter
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label htmlFor="nm-title">Matter title</Label>
            <Input
              id="nm-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Writ petition — land acquisition"
            />
            {conflict && conflict.matches.length > 0 && (
              <div className="rounded-lg border border-[#B68A45]/50 bg-[#f6f1e6] p-3">
                <p className="text-xs font-medium text-[#8a6a33]">
                  {conflict.matches.length} possible conflict
                  {conflict.matches.length === 1 ? "" : "s"} — for human
                  review, not an automatic bar.
                </p>
                <ul className="mt-1 space-y-1">
                  {conflict.matches.slice(0, 4).map((m) => (
                    <li key={m.clientId} className="text-xs text-muted-foreground">
                      · {m.clientName}: {m.evidence[0]}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
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
              <Label>Category / practice area</Label>
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
              <Label htmlFor="nm-bench">Bench</Label>
              <Input
                id="nm-bench"
                value={bench}
                onChange={(e) => setBench(e.target.value)}
                placeholder="e.g. Division Bench I"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="nm-jur">Jurisdiction</Label>
              <Input
                id="nm-jur"
                value={jurisdiction}
                onChange={(e) => setJurisdiction(e.target.value)}
                placeholder="e.g. Maharashtra — original side"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nm-caseno">Case number</Label>
              <Input
                id="nm-caseno"
                value={caseNumber}
                onChange={(e) => setCaseNumber(e.target.value)}
                placeholder="e.g. WP/1234/2026"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="nm-opp">Opposing party</Label>
              <Input
                id="nm-opp"
                value={opposingParty}
                onChange={(e) => setOpposingParty(e.target.value)}
                placeholder="e.g. State of Maharashtra"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nm-oppc">Opposing counsel</Label>
              <Input
                id="nm-oppc"
                value={opposingCounsel}
                onChange={(e) => setOpposingCounsel(e.target.value)}
                placeholder="e.g. Adv. S. Deshmukh"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Lead lawyer</Label>
              <Select value={leadLawyerId} onValueChange={setLeadLawyerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">— Unassigned —</SelectItem>
                  {lawyerOptions.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.name ?? m.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="nm-bill">Billing arrangement</Label>
            <Input
              id="nm-bill"
              value={billingArrangement}
              onChange={(e) => setBillingArrangement(e.target.value)}
              placeholder="e.g. Fixed fee ₹50,000 per stage · hourly ₹3,000/hr"
            />
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
          {selectedClient && (
            <ConflictGatePanel
              title={title}
              clientId={selectedClient._id}
              clientName={selectedClient.name}
              onCleared={() => setConflictCleared(true)}
            />
          )}
          {!selectedClient && (
            <p className="type-label ink-faded">
              Select a client to enable the conflict-of-interest check.
            </p>
          )}
          <Button className="w-full" onClick={handleCreate} disabled={busy || !conflictCleared}>
            {busy ? "Opening…" : conflictCleared ? "Open the matter" : "Conflict check required"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MatterLink({ matterId }: { matterId: string }) {
  return (
    <Link
      to={`/matters/${matterId}`}
      className="text-sm font-medium text-[#8a6a33] hover:underline"
    >
      Open
    </Link>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <p className="p-6 text-sm text-muted-foreground">{children}</p>;
}

/** The personal desk every console member sees. */
function LawyerDesk() {
  const data = useQuery(api.portals.lawyerDashboard);
  const attention = useQuery(api.attention.feed);
  const [now] = useState(() => Date.now());

  if (!data) {
    return (
      <EmptyRow>
        Your desk appears once you are an active member of an organization.
      </EmptyRow>
    );
  }

  const openMatters = data.matters.filter((m) => m.status !== "closed").length;
  const stats = [
    {
      icon: FolderOpen,
      label: "Authorized matters",
      value: openMatters,
      total: data.matters.length,
    },
    { icon: UsersRound, label: "Clients on record", value: data.clients.length },
    {
      icon: Gavel,
      label: "Today's hearings",
      value: data.todaysHearings.length,
      extra: data.upcomingHearingsCount > 0 ? `${data.upcomingHearingsCount} upcoming` : undefined,
    },
    {
      icon: ListChecks,
      label: "My pending tasks",
      value: data.myTasks.length,
    },
  ];

  const soonDeadline = (dueAt: number | null) => {
    if (!dueAt) return null;
    if (dueAt < now) return <span className="text-red-700">past due</span>;
    if (dueAt < now + 3 * 864e5)
      return <span className="text-[#8a6a33]">due soon</span>;
    return null;
  };

  const attentionCounts = attention?.items ?? [];
  const criticalCount = attentionCounts.filter((i) => i.critical).length;

  return (
    <>
      {/* What needs my attention */}
      {attention !== undefined && attention !== null && (
        <Link
          to="/attention"
          className="rule-frame mb-6 flex items-center justify-between gap-4 rounded-lg bg-card p-4 transition-colors hover:bg-accent/30"
        >
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-serif text-lg font-semibold">
              <TriangleAlert
                className={`size-4 ${criticalCount > 0 ? "text-red-700" : "text-[#B68A45]"}`}
                aria-hidden="true"
              />
              What needs my attention
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {attentionCounts.length === 0
                ? "Nothing right now — the docket is clear."
                : `${attentionCounts.length} item${attentionCounts.length === 1 ? "" : "s"} today${criticalCount > 0 ? `, ${criticalCount} critical` : ""} — hearings, deadlines, messages and more.`}
            </p>
          </div>
          <ArrowRight className="size-4 shrink-0 text-[#8a6a33]" aria-hidden="true" />
        </Link>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="shadow-sm">
            <CardContent className="pt-5">
              <s.icon className="size-4 text-[#B68A45]" aria-hidden="true" />
              <p className="mt-2 font-serif text-3xl font-semibold">{s.value}</p>
              <p className="type-label mt-1 ink-faded">{s.label}</p>
              {"total" in s && s.total !== s.value && (
                <p className="type-label ink-faded">{s.total} on file</p>
              )}
              {"extra" in s && s.extra && (
                <p className="type-label ink-faded">{s.extra}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Today's hearings */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2 font-serif text-xl font-semibold">
          <Gavel className="size-4 text-[#B68A45]" aria-hidden="true" />
          Today's hearings
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Scheduled appearances across courts for today.
        </p>
        <div className="rule-frame mt-3 overflow-x-auto rounded-lg">
          {data.todaysHearings.length === 0 ? (
            <EmptyRow>
              No hearings listed for today. The diary is clear.
            </EmptyRow>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Matter</th>
                  <th scope="col">Hearing</th>
                  <th scope="col">Court</th>
                  <th scope="col">Appearance</th>
                  <th scope="col">Time</th>
                  <th scope="col">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.todaysHearings.map((h) => (
                  <tr key={h._id}>
                    <td className="type-label ink-faded">{h.matterReference}</td>
                    <td className="font-medium">{h.title}</td>
                    <td className="text-muted-foreground">{h.court ?? "—"}</td>
                    <td className="text-muted-foreground">
                      {h.appearance ?? "—"}
                    </td>
                    <td className="whitespace-nowrap">
                      {formatDateTimeIN(h.at)}
                    </td>
                    <td className="text-right">
                      <MatterLink matterId={h.matterId} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Upcoming deadlines */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2 font-serif text-xl font-semibold">
          <CalendarClock className="size-4 text-[#B68A45]" aria-hidden="true" />
          Upcoming deadlines
        </h2>
        <div className="rule-frame mt-3 overflow-x-auto rounded-lg">
          {data.deadlines.length === 0 ? (
            <EmptyRow>No dated work on the file.</EmptyRow>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Matter</th>
                  <th scope="col">Deadline</th>
                  <th scope="col">Due</th>
                  <th scope="col">Assigned</th>
                  <th scope="col">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.deadlines.slice(0, 8).map((t) => (
                  <tr key={t._id}>
                    <td className="type-label ink-faded">{t.matterReference}</td>
                    <td className="font-medium">{t.title}</td>
                    <td className="whitespace-nowrap">
                      {t.dueAt ? formatDateIN(t.dueAt) : "—"}{" "}
                      {soonDeadline(t.dueAt)}
                    </td>
                    <td className="text-muted-foreground">
                      {t.mine ? "You" : "Team"}
                    </td>
                    <td className="text-right">
                      <MatterLink matterId={t.matterId} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Assigned tasks */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2 font-serif text-xl font-semibold">
          <ClipboardList className="size-4 text-[#B68A45]" aria-hidden="true" />
          Assigned to you
        </h2>
        <div className="rule-frame mt-3 overflow-x-auto rounded-lg">
          {data.myTasks.length === 0 ? (
            <EmptyRow>
              Nothing assigned to you. Tasks you are given will appear here.
            </EmptyRow>
          ) : (
            <ul className="divide-y divide-border">
              {data.myTasks.slice(0, 8).map((t) => (
                <li
                  key={t._id}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{t.title}</p>
                    <p className="type-label mt-0.5 ink-faded">
                      {t.matterReference} ·{" "}
                      {t.dueAt ? `Due ${formatDateIN(t.dueAt)}` : "No due date"}
                    </p>
                  </div>
                  <MatterLink matterId={t.matterId} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_340px]">
        <div className="space-y-8">
          {/* Preparation gaps */}
          <section>
            <h2 className="flex items-center gap-2 font-serif text-xl font-semibold">
              <TriangleAlert className="size-4 text-[#B68A45]" aria-hidden="true" />
              Preparation gaps
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Matters with an upcoming hearing that are missing the basics.
            </p>
            <div className="mt-3 space-y-3">
              {data.gaps.length === 0 ? (
                <EmptyRow>
                  No gaps detected. Every matter with a hearing has its orders,
                  documents and notes in place.
                </EmptyRow>
              ) : (
                data.gaps.map((g) => (
                  <div key={g.matterId} className="rule-frame rounded-lg p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="type-label ink-faded">
                        {g.reference} · hearing{" "}
                        {formatDateTimeIN(g.hearingAt)}
                      </p>
                      <MatterLink matterId={g.matterId} />
                    </div>
                    <ul className="mt-2 space-y-1">
                      {g.items.map((item) => (
                        <li
                          key={item}
                          className="flex items-start gap-2 text-sm text-muted-foreground"
                        >
                          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#B68A45]" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Matters */}
          <section>
            <h2 className="font-serif text-xl font-semibold">
              Matters before the chamber
            </h2>
            <div className="rule-frame mt-3 overflow-x-auto rounded-lg">
              {data.matters.length === 0 ? (
                <EmptyRow>
                  No matters on file yet. Open your first matter to begin the
                  chamber's record.
                </EmptyRow>
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
                    {data.matters.slice(0, 8).map((m) => {
                      const st = MATTER_STATUS[m.status];
                      const client = data.clients.find((c) => c._id === m.clientId);
                      return (
                        <tr key={m._id}>
                          <td className="type-label ink-faded">{m.reference}</td>
                          <td className="font-serif text-[15px] font-semibold">
                            {m.title}
                          </td>
                          <td className="text-muted-foreground">
                            {client?.name ?? "—"}
                          </td>
                          <td>
                            <span className={`stamp ${st.className}`}>
                              {st.label}
                            </span>
                          </td>
                          <td className="text-right">
                            <MatterLink matterId={m._id} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            {data.mattersTruncated && (
              <p className="mt-2 text-xs text-muted-foreground">
                Showing the 50 most recent of your authorized matters.
              </p>
            )}
          </section>
        </div>

        <aside className="space-y-8">
          {/* Permitted billing */}
          <section aria-label="Billing">
            <h2 className="flex items-center gap-2 font-serif text-xl font-semibold">
              <Receipt className="size-4 text-[#B68A45]" aria-hidden="true" />
              Outstanding
            </h2>
            <div className="rule-frame mt-3 rounded-lg">
              {data.billing === null ? (
                <EmptyRow>
                  Billing is not part of your role's permissions.
                </EmptyRow>
              ) : data.billing.outstanding.length === 0 ? (
                <EmptyRow>Nothing outstanding. The books are balanced.</EmptyRow>
              ) : (
                <>
                  <p className="border-b border-border px-4 py-3 font-serif text-lg font-semibold text-[#8a6a33]">
                    {formatINRCompact(data.billing.totalDue)} due
                  </p>
                  <ul>
                    {data.billing.outstanding.map((i) => (
                      <li key={i.number}>
                        <Link
                          to="/billing"
                          className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-accent/40"
                        >
                          <span className="type-label ink-faded">
                            {i.number}
                          </span>
                          <span className="flex items-center gap-2 font-serif font-semibold text-[#8a6a33]">
                            {formatINRCompact(i.due)}
                            <ArrowRight
                              className="size-3.5"
                              aria-hidden="true"
                            />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </section>

          {/* Recent activity */}
          <section aria-label="Recent activity">
            <h2 className="flex items-center gap-2 font-serif text-xl font-semibold">
              <ScrollText className="size-4 text-[#B68A45]" aria-hidden="true" />
              Recent activity
            </h2>
            <div className="mt-3 space-y-2">
              {data.activity.length === 0 ? (
                <EmptyRow>
                  The docket is quiet. Activity on your matters will appear
                  here.
                </EmptyRow>
              ) : (
                data.activity.map((e) => (
                  <Link
                    key={e._id}
                    to={`/matters/${e.matterId}`}
                    className="rule-frame block rounded-lg p-3 transition-colors hover:bg-accent/30"
                  >
                    <p className="text-sm">{e.detail}</p>
                    <p className="type-label mt-1 ink-faded">
                      {e.matterReference} · {formatDateTimeIN(e.at)}
                    </p>
                  </Link>
                ))
              )}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

/** The firm-management view for owners, partners and administrators. */
function FirmView() {
  const data = useQuery(api.portals.firmDashboard);

  if (!data) {
    return (
      <EmptyRow>
        Firm statistics appear once you are an active member of an organization.
      </EmptyRow>
    );
  }

  const stats = [
    { icon: FolderOpen, label: "Open matters", value: data.stats.openMatters, sub: `${data.stats.matters} on file` },
    { icon: UsersRound, label: "Clients", value: data.stats.clients },
    { icon: UsersRound, label: "Team members", value: data.stats.teamMembers, sub: `${data.stats.invited} invited · ${data.stats.suspended} suspended` },
    { icon: Gavel, label: "Upcoming hearings", value: data.stats.upcomingHearings },
    { icon: ListChecks, label: "Pending tasks", value: data.stats.pendingTasks },
  ];

  const fmt = (n: number) => formatINRCompact(n);

  return (
    <>
      {/* Firm statistics */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label} className="shadow-sm">
            <CardContent className="pt-5">
              <s.icon className="size-4 text-[#B68A45]" aria-hidden="true" />
              <p className="mt-2 font-serif text-3xl font-semibold">{s.value}</p>
              <p className="type-label mt-1 ink-faded">{s.label}</p>
              {"sub" in s && s.sub && (
                <p className="type-label ink-faded">{s.sub}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        {/* Financial information (authorized users only) */}
        <section aria-label="Financials">
          <h2 className="font-serif text-xl font-semibold">
            Financial position
          </h2>
          <div className="rule-frame mt-3 rounded-lg">
            {data.financials === null ? (
              <EmptyRow>
                Financial information is restricted to members with billing
                permissions.
              </EmptyRow>
            ) : (
              <dl className="grid grid-cols-3 divide-x divide-border">
                <div className="p-4">
                  <dt className="type-label ink-faded">Billed</dt>
                  <dd className="mt-1 font-serif text-xl font-semibold">
                    {fmt(data.financials.billed)}
                  </dd>
                </div>
                <div className="p-4">
                  <dt className="type-label ink-faded">Collected</dt>
                  <dd className="mt-1 font-serif text-xl font-semibold text-emerald-700">
                    {fmt(data.financials.collected)}
                  </dd>
                </div>
                <div className="p-4">
                  <dt className="type-label ink-faded">Outstanding</dt>
                  <dd className="mt-1 font-serif text-xl font-semibold text-[#8a6a33]">
                    {fmt(data.financials.outstanding)}
                  </dd>
                </div>
              </dl>
            )}
            {data.financials !== null && (
              <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
                {data.financials.openInvoices} open invoice
                {data.financials.openInvoices === 1 ? "" : "s"} ·{" "}
                <Link to="/billing" className="text-[#8a6a33] hover:underline">
                  Open billing
                </Link>
              </p>
            )}
          </div>
        </section>

        {/* Team workload */}
        <section aria-label="Team workload">
          <h2 className="font-serif text-xl font-semibold">Team workload</h2>
          <div className="rule-frame mt-3 overflow-x-auto rounded-lg">
            {data.workload.length === 0 ? (
              <EmptyRow>No active members yet — invite your team.</EmptyRow>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Member</th>
                    <th scope="col">Role</th>
                    <th scope="col">Open matters</th>
                    <th scope="col">Tasks</th>
                  </tr>
                </thead>
                <tbody>
                  {data.workload.map((w) => (
                    <tr key={w.membershipId}>
                      <td className="font-medium">{w.name}</td>
                      <td className="type-label ink-faded">
                        {w.orgRole.replace("_", " ")}
                      </td>
                      <td>{w.openMatters}</td>
                      <td>{w.pendingTasks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            <Link to="/team" className="text-[#8a6a33] hover:underline">
              Manage the team →
            </Link>
          </p>
        </section>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        {/* Hearings / deadlines */}
        <section aria-label="Firm hearings">
          <h2 className="font-serif text-xl font-semibold">Next hearings</h2>
          <div className="mt-3 space-y-2">
            {data.upcomingHearings.length === 0 ? (
              <EmptyRow>No hearings scheduled across the firm.</EmptyRow>
            ) : (
              data.upcomingHearings.map((h) => (
                <Link
                  key={h._id}
                  to={`/matters/${h.matterId}`}
                  className="rule-frame flex items-center justify-between gap-3 rounded-lg p-3 transition-colors hover:bg-accent/30"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{h.title}</p>
                    <p className="type-label mt-0.5 ink-faded">
                      {h.matterReference}
                      {h.court ? ` · ${h.court}` : ""}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm whitespace-nowrap">
                    {formatDateTimeIN(h.at)}
                  </p>
                </Link>
              ))
            )}
          </div>
        </section>

        <section aria-label="Firm deadlines">
          <h2 className="font-serif text-xl font-semibold">Firm deadlines</h2>
          <div className="mt-3 space-y-2">
            {data.deadlines.length === 0 ? (
              <EmptyRow>No dated work across the firm.</EmptyRow>
            ) : (
              data.deadlines.map((t) => (
                <Link
                  key={t._id}
                  to={`/matters/${t.matterId}`}
                  className="rule-frame flex items-center justify-between gap-3 rounded-lg p-3 transition-colors hover:bg-accent/30"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{t.title}</p>
                    <p className="type-label mt-0.5 ink-faded">
                      {t.matterReference}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm whitespace-nowrap">
                    {t.dueAt ? formatDateIN(t.dueAt) : "—"}
                  </p>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>

      {/* Matter activity */}
      <section aria-label="Matter activity" className="mt-8">
        <h2 className="font-serif text-xl font-semibold">Matter activity</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          The most recently touched files you are authorized to see.
        </p>
        <div className="rule-frame mt-3 overflow-x-auto rounded-lg">
          {data.matterActivity.length === 0 ? (
            <EmptyRow>No matters on file yet.</EmptyRow>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Matter</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last activity</th>
                  <th scope="col">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.matterActivity.map((m) => {
                  const st = MATTER_STATUS[m.status];
                  return (
                    <tr key={m._id}>
                      <td className="type-label ink-faded">{m.reference}</td>
                      <td className="font-serif text-[15px] font-semibold">
                        {m.title}
                      </td>
                      <td>
                        <span className={`stamp ${st.className}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap text-muted-foreground">
                        {formatDateTimeIN(m.updatedAt)}
                      </td>
                      <td className="text-right">
                        <MatterLink matterId={m._id} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Team & firm administration */}
      <section aria-label="Administration" className="mt-8">
        <h2 className="font-serif text-xl font-semibold">
          Team &amp; firm administration
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              to: "/team",
              label: "Members & invitations",
              allowed: data.administration.canManageTeam || data.administration.canInvite,
              desc: "Suspend, reactivate, reassign roles and invite.",
            },
            {
              to: "/settings",
              label: "Permission matrix",
              allowed: data.administration.canEditPermissions,
              desc: "Tailor what each role may do.",
            },
            {
              to: "/settings",
              label: "Firm profile & billing identity",
              allowed: data.administration.canEditProfile,
              desc: "Address, GSTIN, currency and tax settings.",
            },
            {
              to: "/clients",
              label: "Client register",
              allowed: true,
              desc: "Connect clients and grant portal access.",
            },
          ].map((a) =>
            a.allowed ? (
              <Link
                key={a.label}
                to={a.to}
                className="rule-frame block rounded-lg p-4 transition-colors hover:bg-accent/30"
              >
                <p className="text-sm font-semibold">{a.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{a.desc}</p>
              </Link>
            ) : (
              <div
                key={a.label}
                className="rule-frame rounded-lg p-4 opacity-50"
              >
                <p className="text-sm font-semibold">{a.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Not permitted for your role.
                </p>
              </div>
            ),
          )}
        </div>
      </section>
    </>
  );
}

export default function Dashboard() {
  const caps = useQuery(api.workspace.myCapabilities);

  const orgRole = caps?.orgRole ?? null;
  const canCreate = caps?.capabilities.includes("matter.create") ?? false;
  const canCreateClients = caps?.capabilities.includes("client.create") ?? false;
  const showToggle =
    orgRole !== null && FIRM_VIEW_ROLES.includes(orgRole);

  const [view, setView] = useState<"desk" | "firm">("desk");

  return (
    <ChamberShell
      subtitle="The Digital Chamber"
      title={view === "firm" ? "Firm Overview" : "Practice Overview"}
      actions={
        canCreate && canCreateClients ? undefined : canCreate ? (
          <NewMatterDialog />
        ) : undefined
      }
    >
      {showToggle && (
        <div
          className="mb-6 inline-flex rounded-lg border border-border bg-card p-1"
          role="tablist"
          aria-label="Dashboard view"
        >
          {(
            [
              ["desk", "Your desk"],
              ["firm", "Firm"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                view === key
                  ? "bg-sidebar text-white"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {view === "firm" && showToggle ? (
        <FirmView />
      ) : showToggle ? (
        <>
          <LawyerDesk />
          <div className="mt-10 border-t border-border pt-6">
            <FirmView />
          </div>
        </>
      ) : (
        <LawyerDesk />
      )}
    </ChamberShell>
  );
}
