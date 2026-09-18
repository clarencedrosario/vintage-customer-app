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
import {
  CLIENT_KINDS,
  INDIAN_STATES,
} from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import { Building2, Landmark, Plus, ShieldCheck, User } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

const KIND_ICON: Record<string, typeof User> = {
  individual: User,
  company: Building2,
  trust: ShieldCheck,
  government: Landmark,
};

function AddClientDialog() {
  const createClient = useMutation(api.clients.create);
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
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

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
        notes: notes || undefined,
      });
      toast.success("Client added to the chamber's record.");
      setOpen(false);
      setName("");
      setEmail("");
      setPhone("");
      setAddressLine1("");
      setAddressLine2("");
      setCity("");
      setStateName("");
      setPincode("");
      setGstin("");
      setNotes("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the client.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="size-4" />
          Add client
        </Button>
      </DialogTrigger>
      <DialogContent className="rule-frame bg-card sm:max-w-lg">
        <DialogHeader>
          <p className="type-label ink-faded">Register of Clients</p>
          <DialogTitle className="font-serif text-2xl">Add a client</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
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
          <Button className="w-full" onClick={handleCreate} disabled={busy}>
            {busy ? "Recording…" : "Add the client"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Clients() {
  const clients = useQuery(api.clients.list);
  const openCounts = useQuery(api.clients.openMatterCounts);

  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients ?? [];
    return (clients ?? []).filter((c) => c.name.toLowerCase().includes(q));
  }, [clients, search]);

  return (
    <ChamberShell subtitle="The Digital Chamber" actions={<AddClientDialog />}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="type-label ink-faded">Register of Clients</p>
          <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight">
            Clients
          </h1>
          <p className="mt-2 max-w-xl ink-faded">
            Individuals, companies, trusts and government bodies on the
            chamber's record.
          </p>
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search clients…"
          className="sm:max-w-xs"
        />
      </div>

      {clients === undefined ? (
        <p className="mt-10 text-sm ink-faded">Opening the register…</p>
      ) : filtered.length === 0 ? (
        <Card className="mt-10 border-dashed">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <User className="size-8 text-muted-foreground" />
            <p className="mt-4 font-serif text-xl">
              {search ? "No clients match that search" : "No clients on record yet"}
            </p>
            <p className="mt-2 max-w-sm text-sm ink-faded">
              {search
                ? "Adjust the spelling and try again."
                : "Add your first client, then open a matter in their name."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => {
            const Icon = KIND_ICON[c.kind] ?? User;
            const openMatters = openCounts?.[c._id] ?? 0;
            const addr = [
              c.addressLine1,
              c.addressLine2,
              c.city,
              c.state,
              c.pincode,
            ]
              .filter(Boolean)
              .join(", ");
            return (
              <li key={c._id} className="rule-frame bg-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex size-10 items-center justify-center rounded-full border border-foreground/25 text-primary">
                    <Icon className="size-5" />
                  </span>
                  <span className="stamp ink-faded">{c.kind}</span>
                </div>
                <h2 className="mt-4 font-serif text-xl font-semibold leading-snug">
                  {c.name}
                </h2>
                {addr && <p className="mt-2 text-sm ink-faded">{addr}</p>}
                <div className="mt-3 space-y-1 text-sm ink-faded">
                  {c.phone && <p>{c.phone}</p>}
                  {c.email && <p className="truncate">{c.email}</p>}
                  {c.gstin && <p className="type-label">GSTIN {c.gstin}</p>}
                </div>
                <div className="mt-4 border-t border-border pt-3">
                  <p className="type-label ink-faded">
                    {openMatters} open {openMatters === 1 ? "matter" : "matters"}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </ChamberShell>
  );
}
