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
import { CLIENT_KINDS, INDIAN_STATES, formatDateIN } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import {
  Archive,
  ArchiveRestore,
  ExternalLink,
  Plus,
  ShieldAlert,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

type ConflictMatch = {
  clientId: string;
  clientName: string;
  evidence: string[];
};

/** Live conflict scan while typing a new client's name. */
function ConflictScanner({ name }: { name: string }) {
  const trimmed = name.trim();
  const result = useQuery(
    api.clients.conflictCheck,
    trimmed.length >= 3 ? { name: trimmed } : "skip",
  );

  if (trimmed.length < 3 || !result || result.matches.length === 0) return null;

  return (
    <div className="rounded-lg border border-[#B68A45]/50 bg-[#f6f1e6] p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium text-[#8a6a33]">
        <ShieldAlert className="size-4" aria-hidden="true" />
        {result.matches.length} possible conflict
        {result.matches.length === 1 ? "" : "s"} — human review required
      </p>
      <ul className="mt-2 space-y-2">
        {result.matches.map((m: ConflictMatch) => (
          <li key={m.clientId} className="text-sm">
            <span className="font-medium">{m.clientName}</span>
            <ul className="mt-0.5 space-y-0.5">
              {m.evidence.map((e) => (
                <li key={e} className="text-xs text-muted-foreground">
                  · {e}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Checked against {result.scopedTo}'s own register only. Possible matches
        are flags for a person to review — the system does not and cannot
        declare that clearance is guaranteed.
      </p>
    </div>
  );
}

function AddClientDialog() {
  const createClient = useMutation(api.clients.create);
  const acknowledge = useMutation(api.clients.acknowledgeConflictCheck);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("individual");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState("");
  const [pincode, setPincode] = useState("");
  const [gstin, setGstin] = useState("");
  const [pan, setPan] = useState("");
  const [cin, setCin] = useState("");
  const [notes, setNotes] = useState("");
  const [conflictNote, setConflictNote] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setName("");
    setEmail("");
    setPhone("");
    setAddressLine1("");
    setAddressLine2("");
    setCity("");
    setStateName("");
    setPincode("");
    setGstin("");
    setPan("");
    setCin("");
    setNotes("");
    setConflictNote("");
    setKind("individual");
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error("Client name is required.");
      return;
    }
    setBusy(true);
    try {
      await createClient({
        name,
        kind: kind as "individual" | "company" | "trust" | "government",
        email: email || undefined,
        phone: phone || undefined,
        addressLine1: addressLine1 || undefined,
        addressLine2: addressLine2 || undefined,
        city: city || undefined,
        state: stateName || undefined,
        pincode: pincode || undefined,
        gstin: gstin || undefined,
        pan: pan || undefined,
        cin: cin || undefined,
        notes: notes || undefined,
      });
      toast.success("Client added to the chamber's record.");
      // Record the human's conflict review alongside the new client.
      try {
        await acknowledge({
          subject: name.trim(),
          note:
            conflictNote.trim() ||
            "Created after reviewing possible matches shown.",
          matchCount: 0,
        });
      } catch {
        // Register entry is best-effort; the client itself was created.
      }
      setOpen(false);
      reset();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not add the client.",
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
          Add client
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <p className="type-label ink-faded">Register of Clients</p>
          <DialogTitle className="font-serif text-2xl">
            Add a client
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <ConflictScanner name={name} />
          <div className="space-y-2">
            <Label>Client type</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLIENT_KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cl-name">
              {kind === "individual" ? "Full name" : "Name of the entity"}
            </Label>
            <Input
              id="cl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                kind === "individual"
                  ? "e.g. Ramesh Iyer"
                  : kind === "company"
                    ? "e.g. Meridian Textiles Pvt Ltd"
                    : kind === "trust"
                      ? "e.g. Seva Public Charitable Trust"
                      : "e.g. Public Works Department"
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cl-email">Email</Label>
              <Input
                id="cl-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="office@example.in"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cl-phone">Phone</Label>
              <Input
                id="cl-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98xxx xxxxx"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cl-addr1">Address line 1</Label>
            <Input
              id="cl-addr1"
              value={addressLine1}
              onChange={(e) => setAddressLine1(e.target.value)}
              placeholder="Flat / building / street"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cl-addr2">Address line 2</Label>
            <Input
              id="cl-addr2"
              value={addressLine2}
              onChange={(e) => setAddressLine2(e.target.value)}
              placeholder="Area / locality"
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 space-y-2">
              <Label>State</Label>
              <Select value={stateName} onValueChange={setStateName}>
                <SelectTrigger>
                  <SelectValue placeholder="Select state" />
                </SelectTrigger>
                <SelectContent>
                  {INDIAN_STATES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cl-pin">PIN code</Label>
              <Input
                id="cl-pin"
                value={pincode}
                onChange={(e) => setPincode(e.target.value)}
                placeholder="400001"
                maxLength={6}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cl-pan">
                PAN <span className="ink-faded">(if held)</span>
              </Label>
              <Input
                id="cl-pan"
                value={pan}
                onChange={(e) => setPan(e.target.value.toUpperCase())}
                placeholder="ABCDE1234F"
                maxLength={10}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cl-cin">
                CIN / registration no. <span className="ink-faded">(if held)</span>
              </Label>
              <Input
                id="cl-cin"
                value={cin}
                onChange={(e) => setCin(e.target.value.toUpperCase())}
                placeholder="U27200MH2011PTC221100"
                maxLength={21}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cl-city">City</Label>
              <Input
                id="cl-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Mumbai"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cl-gstin">
                GSTIN <span className="ink-faded">(if registered)</span>
              </Label>
              <Input
                id="cl-gstin"
                value={gstin}
                onChange={(e) => setGstin(e.target.value.toUpperCase())}
                placeholder="27ABCDE1234F1Z5"
                maxLength={15}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cl-notes">Notes</Label>
            <Textarea
              id="cl-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything the chamber should remember about this client…"
              className="min-h-[70px]"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cl-conflict">
              Conflict review note{" "}
              <span className="ink-faded">(recorded with the client)</span>
            </Label>
            <Input
              id="cl-conflict"
              value={conflictNote}
              onChange={(e) => setConflictNote(e.target.value)}
              placeholder="e.g. No match to existing matters; opposing party known from previous brief."
            />
          </div>
          <Button className="w-full" onClick={handleCreate} disabled={busy}>
            {busy ? "Recording…" : "Add the client"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ClientRowActions({
  clientId,
  archived,
  canEdit,
}: {
  clientId: string;
  archived: boolean;
  canEdit: boolean;
}) {
  const archive = useMutation(api.clients.archive);
  const unarchive = useMutation(api.clients.unarchive);
  const [busy, setBusy] = useState(false);

  if (!canEdit) return null;

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  return archived ? (
    <Button
      size="sm"
      variant="ghost"
      disabled={busy}
      onClick={() =>
        run(
          () => unarchive({ clientId: clientId as never }),
          "Client restored to the register.",
        )
      }
    >
      <ArchiveRestore className="mr-1.5 size-3.5" aria-hidden="true" />
      Restore
    </Button>
  ) : (
    <Button
      size="sm"
      variant="ghost"
      disabled={busy}
      onClick={() =>
        run(
          () => archive({ clientId: clientId as never }),
          "Client archived. History is preserved.",
        )
      }
    >
      <Archive className="mr-1.5 size-3.5" aria-hidden="true" />
      Archive
    </Button>
  );
}

export default function Clients() {
  const clients = useQuery(api.clients.list);
  const openCounts = useQuery(api.clients.openMatterCounts);
  const caps = useQuery(api.workspace.myCapabilities);
  const canEdit = caps?.capabilities.includes("client.edit") ?? false;

  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [responsibleFilter, setResponsibleFilter] = useState("all");
  const [sort, setSort] = useState("recent");

  const responsibleNames = useMemo(() => {
    const set = new Set<string>();
    (clients ?? []).forEach((c) => {
      if (c.responsibleLawyerId) set.add(c.responsibleLawyerId);
    });
    return Array.from(set);
  }, [clients]);

  const filtered = useMemo(() => {
    let list = [...(clients ?? [])];
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.email ?? "").toLowerCase().includes(q) ||
          (c.gstin ?? "").toLowerCase().includes(q) ||
          (c.phone ?? "").includes(q),
      );
    }
    if (kindFilter !== "all") list = list.filter((c) => c.kind === kindFilter);
    if (statusFilter === "active") list = list.filter((c) => !c.archivedAt);
    if (statusFilter === "archived")
      list = list.filter((c) => c.archivedAt !== undefined);
    if (responsibleFilter !== "all")
      list = list.filter(
        (c) => c.responsibleLawyerId === responsibleFilter,
      );
    list.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "matters")
        return (openCounts?.[b._id] ?? 0) - (openCounts?.[a._id] ?? 0);
      return b.createdAt - a.createdAt;
    });
    return list;
  }, [clients, openCounts, search, kindFilter, statusFilter, responsibleFilter, sort]);

  const archivedCount = (clients ?? []).filter((c) => c.archivedAt).length;

  return (
    <ChamberShell
      subtitle="Register of Clients"
      title="Clients"
      actions={<AddClientDialog />}
    >
      {/* Filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, GSTIN or phone…"
          className="lg:max-w-sm"
          aria-label="Search clients"
        />
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-36">
            <p className="type-label ink-faded mb-1.5">Type</p>
            <Select value={kindFilter} onValueChange={setKindFilter}>
              <SelectTrigger aria-label="Filter by client type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {CLIENT_KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-32">
            <p className="type-label ink-faded mb-1.5">Status</p>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="archived">
                  Archived{archivedCount > 0 ? ` (${archivedCount})` : ""}
                </SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-40">
            <p className="type-label ink-faded mb-1.5">Responsible</p>
            <Select
              value={responsibleFilter}
              onValueChange={setResponsibleFilter}
            >
              <SelectTrigger aria-label="Filter by responsible lawyer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Anyone</SelectItem>
                {responsibleNames.map((id) => (
                  <SelectItem key={id} value={id}>
                    {id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-40">
            <p className="type-label ink-faded mb-1.5">Sort</p>
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger aria-label="Sort clients">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Newest first</SelectItem>
                <SelectItem value="name">Name A–Z</SelectItem>
                <SelectItem value="matters">Most open matters</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="rule-frame mt-4 overflow-x-auto rounded-lg">
        {clients === undefined ? (
          <p className="p-6 text-sm text-muted-foreground">
            Opening the register…
          </p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            {search || kindFilter !== "all" || statusFilter !== "active"
              ? "No clients match those filters."
              : "No clients on record yet. Add your first client, then open a matter in their name."}
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col">Type</th>
                <th scope="col">Contact</th>
                <th scope="col">City</th>
                <th scope="col">GSTIN</th>
                <th scope="col">Open matters</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const openMatters = openCounts?.[c._id] ?? 0;
                return (
                  <tr key={c._id} className={c.archivedAt ? "opacity-60" : ""}>
                    <td>
                      <Link
                        to={`/clients/${c._id}`}
                        className="font-medium text-foreground hover:text-[#8a6a33] hover:underline"
                      >
                        {c.name}
                      </Link>
                      {c.archivedAt && (
                        <p className="type-label ink-faded">
                          Archived {formatDateIN(c.archivedAt)}
                        </p>
                      )}
                      {c.addressLine1 && !c.archivedAt && (
                        <p className="text-xs text-muted-foreground">
                          {c.addressLine1}
                        </p>
                      )}
                    </td>
                    <td>
                      <span className="stamp ink-faded">{c.kind}</span>
                    </td>
                    <td className="text-muted-foreground">
                      <p>{c.phone ?? "—"}</p>
                      {c.email && <p className="text-xs">{c.email}</p>}
                    </td>
                    <td className="text-muted-foreground">
                      {[c.city, c.state].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {c.gstin ?? "—"}
                    </td>
                    <td>
                      <span
                        className={
                          openMatters > 0
                            ? "font-medium text-[#8a6a33]"
                            : "text-muted-foreground"
                        }
                      >
                        {openMatters}
                      </span>
                    </td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          to={`/clients/${c._id}`}
                          className="type-label flex items-center gap-1 text-primary hover:underline"
                          aria-label={`Open Client 360 for ${c.name}`}
                        >
                          <ExternalLink className="size-3.5" aria-hidden="true" />
                          360
                        </Link>
                        <ClientRowActions
                          clientId={c._id}
                          archived={c.archivedAt !== undefined}
                          canEdit={canEdit}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {clients !== undefined && clients.length === 0 && (
        <Card className="mt-4 border-dashed sm:hidden">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Use the “Add client” button above to begin.
          </CardContent>
        </Card>
      )}
    </ChamberShell>
  );
}
