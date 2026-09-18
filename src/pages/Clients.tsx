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
import { CLIENT_KINDS, INDIAN_STATES } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

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
    return (clients ?? []).filter((c) =>
      c.name.toLowerCase().includes(q),
    );
  }, [clients, search]);

  return (
    <ChamberShell
      subtitle="Register of Clients"
      title="Clients"
      actions={<AddClientDialog />}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-sm text-muted-foreground">
          Individuals, companies, trusts and government bodies on the
          chamber's record.
        </p>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search clients…"
          className="sm:max-w-xs"
          aria-label="Search clients by name"
        />
      </div>

      <div className="rule-frame mt-4 overflow-x-auto rounded-lg">
        {clients === undefined ? (
          <p className="p-6 text-sm text-muted-foreground">
            Opening the register…
          </p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            {search
              ? "No clients match that search — adjust the spelling and try again."
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
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const openMatters = openCounts?.[c._id] ?? 0;
                return (
                  <tr key={c._id}>
                    <td>
                      <p className="font-medium">{c.name}</p>
                      {c.addressLine1 && (
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
                      {c.email && (
                        <p className="text-xs">{c.email}</p>
                      )}
                    </td>
                    <td className="text-muted-foreground">
                      {[c.city, c.state].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {c.gstin ?? "—"}
                    </td>
                    <td>
                      <span className={openMatters > 0 ? "font-medium text-[#8a6a33]" : "text-muted-foreground"}>
                        {openMatters}
                      </span>
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
