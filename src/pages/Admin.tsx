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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BrandMark } from "@/components/BrandMark";
import { formatPrice } from "@/pages/Catalog";
import { api } from "@/convex/_generated/api";
import type { MatterStatus } from "@/convex/schema";
import { useMutation, useQuery } from "convex/react";
import {
  BadgeDollarSign,
  CalendarClock,
  FolderOpen,
  Plus,
  ScrollText,
  Trash2,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

const MATTER_STATUSES: { value: MatterStatus; label: string }[] = [
  { value: "received", label: "Received" },
  { value: "under_review", label: "Under Review" },
  { value: "engaged", label: "Engaged" },
  { value: "closed", label: "Closed" },
];

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function Admin() {
  const { user, isLoading } = useAuth();
  const isAdmin = user?.role === "admin";

  const stats = useQuery(api.admin.stats, isAdmin ? {} : "skip");
  const clients = useQuery(api.admin.listClients, isAdmin ? {} : "skip");
  const bookings = useQuery(api.admin.listAllBookings, isAdmin ? {} : "skip");
  const orders = useQuery(api.admin.listAllOrders, isAdmin ? {} : "skip");
  const matters = useQuery(api.matters.adminList, isAdmin ? {} : "skip");
  const services = useQuery(api.services.list);

  const createService = useMutation(api.services.create);
  const removeService = useMutation(api.services.remove);
  const markOrderPaid = useMutation(api.admin.markOrderPaid);
  const updateBookingStatus = useMutation(api.admin.updateBookingStatus);
  const updateMatterStatus = useMutation(api.matters.adminUpdateStatus);

  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newSummary, setNewSummary] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newDuration, setNewDuration] = useState("60");

  const handleCreateService = async () => {
    const price = Math.round(parseFloat(newPrice) * 100);
    if (!newName.trim() || !newCategory || !newSummary.trim() || !newDescription.trim()) {
      toast.error("Fill in the name, category, summary and description.");
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      toast.error("Set a valid price in dollars.");
      return;
    }
    try {
      await createService({
        name: newName,
        category: newCategory,
        summary: newSummary,
        description: newDescription,
        priceCents: price,
        durationMinutes: parseInt(newDuration, 10) || 60,
      });
      toast.success("Service published to the catalog.");
      setNewName("");
      setNewCategory("");
      setNewSummary("");
      setNewDescription("");
      setNewPrice("");
      setNewDuration("60");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not publish.");
    }
  };

  if (!isLoading && !isAdmin) {
    return (
      <div className="paper-texture flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
        <h1 className="font-serif text-3xl font-semibold">
          Restricted to the firm
        </h1>
        <p className="max-w-md ink-faded">
          This area is for Advokate administrators. If you believe you should
          have access, contact the firm’s managing clerk.
        </p>
        <Button asChild variant="outline">
          <Link to="/dashboard">Return to your workspace</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="paper-texture min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
          <BrandMark subtitle="Firm Administration" />
          <Button asChild variant="outline" size="sm">
            <Link to="/dashboard">Client view</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 py-10">
        <p className="type-label ink-faded">The Firm’s Ledger</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
          Administration
        </h1>

        {/* Overview cards */}
        <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            {
              icon: Users,
              label: "Clients enrolled",
              value: stats?.clients ?? "—",
            },
            {
              icon: FolderOpen,
              label: "Open matters",
              value: stats?.openMatters ?? "—",
            },
            {
              icon: BadgeDollarSign,
              label: "Collected revenue",
              value:
                stats === undefined
                  ? "—"
                  : formatPrice(stats?.revenueCents ?? 0),
            },
            {
              icon: CalendarClock,
              label: "Upcoming consultations",
              value: stats?.upcomingBookings ?? "—",
            },
          ].map((s) => (
            <Card key={s.label} className="rule-frame bg-card">
              <CardContent className="pt-6">
                <s.icon className="size-5 text-primary" />
                <p className="mt-3 font-serif text-3xl font-semibold">
                  {s.value}
                </p>
                <p className="type-label mt-1 ink-faded">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="matters" className="mt-10">
          <TabsList>
            <TabsTrigger value="matters" className="gap-2">
              <ScrollText className="size-4" /> Matters
            </TabsTrigger>
            <TabsTrigger value="bookings" className="gap-2">
              <CalendarClock className="size-4" /> Bookings
            </TabsTrigger>
            <TabsTrigger value="orders" className="gap-2">
              <BadgeDollarSign className="size-4" /> Orders
            </TabsTrigger>
            <TabsTrigger value="catalog" className="gap-2">
              <Plus className="size-4" /> Catalog
            </TabsTrigger>
            <TabsTrigger value="clients" className="gap-2">
              <Users className="size-4" /> Clients
            </TabsTrigger>
          </TabsList>

          {/* Matters */}
          <TabsContent value="matters" className="mt-6">
            {matters === undefined ? (
              <p className="type-label ink-faded">Loading…</p>
            ) : matters.length === 0 ? (
              <p className="text-sm ink-faded">No matters filed.</p>
            ) : (
              <ul className="space-y-3">
                {matters.map((m) => (
                  <li
                    key={m._id}
                    className="rule-frame flex flex-wrap items-center justify-between gap-4 bg-card p-4"
                  >
                    <div className="min-w-0">
                      <p className="type-label ink-faded">{m.practiceArea}</p>
                      <h3 className="mt-0.5 font-serif text-lg font-semibold">
                        {m.title}
                      </h3>
                      <p className="mt-1 line-clamp-1 text-sm ink-faded">
                        {m.description}
                      </p>
                    </div>
                    <Select
                      value={m.status}
                      onValueChange={(v) =>
                        updateMatterStatus({ matterId: m._id, status: v as MatterStatus })
                      }
                    >
                      <SelectTrigger className="w-44">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MATTER_STATUSES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          {/* Bookings */}
          <TabsContent value="bookings" className="mt-6">
            {bookings === undefined ? (
              <p className="type-label ink-faded">Loading…</p>
            ) : bookings.length === 0 ? (
              <p className="text-sm ink-faded">No consultations reserved.</p>
            ) : (
              <ul className="space-y-3">
                {bookings.map((b) => (
                  <li
                    key={b._id}
                    className="rule-frame flex flex-wrap items-center justify-between gap-4 bg-card p-4"
                  >
                    <div className="min-w-0">
                      <p className="type-label ink-faded">
                        {b.service?.category}
                      </p>
                      <h3 className="mt-0.5 font-serif text-lg font-semibold">
                        {b.service?.name ?? "Consultation"}
                      </h3>
                      <p className="mt-1 text-sm ink-faded">
                        {b.client?.name ?? b.client?.email ?? "Client"} ·{" "}
                        {formatDateTime(b.startAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="stamp ink-faded">{b.status}</span>
                      {b.status === "confirmed" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              updateBookingStatus({
                                bookingId: b._id,
                                status: "completed",
                              })
                            }
                          >
                            Mark completed
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              updateBookingStatus({
                                bookingId: b._id,
                                status: "cancelled",
                              })
                            }
                          >
                            Cancel
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          {/* Orders */}
          <TabsContent value="orders" className="mt-6">
            {orders === undefined ? (
              <p className="type-label ink-faded">Loading…</p>
            ) : orders.length === 0 ? (
              <p className="text-sm ink-faded">No orders yet.</p>
            ) : (
              <ul className="space-y-3">
                {orders.map((o) => (
                  <li
                    key={o._id}
                    className="rule-frame flex flex-wrap items-center justify-between gap-4 bg-card p-4"
                  >
                    <div className="min-w-0">
                      <p className="type-label ink-faded">
                        {o.kind === "card" ? "Card" : "Invoice"} ·{" "}
                        {o.client?.email ?? "—"}
                        {o.companyName ? ` · ${o.companyName}` : ""}
                      </p>
                      <h3 className="mt-0.5 font-serif text-lg font-semibold">
                        {o.service?.name ?? "Service"}
                      </h3>
                      {o.notes && (
                        <p className="mt-1 line-clamp-1 text-sm ink-faded">
                          {o.notes}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="font-serif text-lg font-semibold text-primary">
                        {formatPrice(o.amountCents)}
                      </span>
                      <span className="stamp ink-faded">{o.status}</span>
                      {o.status !== "paid" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            try {
                              await markOrderPaid({ orderId: o._id });
                              toast.success("Marked as paid.");
                            } catch (err) {
                              toast.error(
                                err instanceof Error
                                  ? err.message
                                  : "Update failed.",
                              );
                            }
                          }}
                        >
                          Mark paid
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          {/* Catalog management */}
          <TabsContent value="catalog" className="mt-6">
            <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
              <div>
                <h2 className="font-serif text-2xl font-semibold">
                  Published services
                </h2>
                <ul className="mt-4 space-y-3">
                  {(services ?? []).map((s) => (
                    <li
                      key={s._id}
                      className="rule-frame flex items-center justify-between gap-4 bg-card p-4"
                    >
                      <div className="min-w-0">
                        <p className="type-label ink-faded">{s.category}</p>
                        <h3 className="mt-0.5 font-serif text-lg font-semibold">
                          {s.name}
                        </h3>
                        <p className="mt-1 line-clamp-1 text-sm ink-faded">
                          {s.summary}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="font-serif font-semibold text-primary">
                          {formatPrice(s.priceCents)}
                        </span>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={async () => {
                            try {
                              await removeService({ serviceId: s._id });
                              toast.success("Service removed.");
                            } catch (err) {
                              toast.error(
                                err instanceof Error
                                  ? err.message
                                  : "Remove failed.",
                              );
                            }
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <Card className="rule-frame bg-card">
                <CardHeader>
                  <CardTitle className="font-serif text-2xl">
                    Publish a service
                  </CardTitle>
                  <CardDescription>
                    New entries appear in the public catalog immediately.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="adm-name">Name</Label>
                    <Input
                      id="adm-name"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Vendor agreement review"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select
                      value={newCategory}
                      onValueChange={setNewCategory}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {[
                          "Contracts",
                          "Corporate",
                          "Employment",
                          "Intellectual Property",
                          "Compliance",
                          "Advisory",
                          "Disputes",
                        ].map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="adm-summary">Summary</Label>
                    <Input
                      id="adm-summary"
                      value={newSummary}
                      onChange={(e) => setNewSummary(e.target.value)}
                      placeholder="One-line description shown in the catalog"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="adm-desc">Description</Label>
                    <Textarea
                      id="adm-desc"
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                      placeholder="Full scope of the engagement…"
                      className="min-h-[90px]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="adm-price">Price (USD)</Label>
                      <Input
                        id="adm-price"
                        type="number"
                        min="1"
                        step="1"
                        value={newPrice}
                        onChange={(e) => setNewPrice(e.target.value)}
                        placeholder="450"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="adm-dur">Duration (min)</Label>
                      <Input
                        id="adm-dur"
                        type="number"
                        min="15"
                        step="15"
                        value={newDuration}
                        onChange={(e) => setNewDuration(e.target.value)}
                      />
                    </div>
                  </div>
                  <Button className="w-full gap-2" onClick={handleCreateService}>
                    <Plus className="size-4" />
                    Publish service
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Clients */}
          <TabsContent value="clients" className="mt-6">
            {clients === undefined ? (
              <p className="type-label ink-faded">Loading…</p>
            ) : clients.length === 0 ? (
              <p className="text-sm ink-faded">No clients enrolled yet.</p>
            ) : (
              <ul className="space-y-2">
                {clients.map((c) => (
                  <li
                    key={c._id}
                    className="rule-frame flex flex-wrap items-center justify-between gap-4 bg-card px-4 py-3"
                  >
                    <div>
                      <p className="text-sm">
                        {c.name ?? "—"}{" "}
                        <span className="ink-faded">· {c.email ?? "—"}</span>
                      </p>
                      {c.companyName && (
                        <p className="type-label mt-0.5 ink-faded">
                          {c.companyName}
                        </p>
                      )}
                    </div>
                    <span className="stamp ink-faded">
                      {c.role === "admin" ? "Administrator" : "Client"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
