import { ChamberShell } from "@/components/ChamberShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  formatINR,
  formatINRCompact,
  formatDateIN,
  formatDateTimeIN,
} from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import {
  Archive,
  ArrowLeft,
  FileText,
  Landmark,
  MessageSquare,
  Receipt,
  ScrollText,
  ShieldCheck,
  UserPlus,
  UserRound,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

const MATTER_STATUS: Record<string, { label: string; className: string }> = {
  open: { label: "Open", className: "text-chart-3" },
  in_progress: { label: "In Progress", className: "text-chart-2" },
  on_hold: { label: "On Hold", className: "text-muted-foreground" },
  closed: { label: "Closed", className: "text-muted-foreground" },
};

const INVOICE_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "text-muted-foreground" },
  sent: { label: "Sent", cls: "text-[#8a6a33]" },
  partially_paid: { label: "Partially paid", cls: "text-[#8a6a33]" },
  paid: { label: "Paid", cls: "text-emerald-700" },
  cancelled: { label: "Cancelled", cls: "text-muted-foreground" },
};

function DocLink({ documentId }: { documentId: Id<"matterDocuments"> }) {
  const url = useQuery(api.matters.getDocumentUrl, { documentId });
  if (!url) return <span className="type-label ink-faded">—</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="type-label text-primary hover:underline"
    >
      Open
    </a>
  );
}

function AddContactDialog({ clientId }: { clientId: Id<"clients"> }) {
  const add = useMutation(api.clients.addContact);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [primary, setPrimary] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <UserPlus className="size-4" aria-hidden="true" />
          Add contact
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <p className="type-label ink-faded">Additional contacts</p>
          <DialogTitle className="font-serif text-2xl">
            Add a contact
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ct-name">Name</Label>
            <Input
              id="ct-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Meera Iyer"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ct-rel">Relation / role</Label>
              <Input
                id="ct-rel"
                value={relation}
                onChange={(e) => setRelation(e.target.value)}
                placeholder="e.g. Accounts, son, authorised representative"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ct-phone">Phone</Label>
              <Input
                id="ct-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98xxx xxxxx"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ct-email">Email</Label>
            <Input
              id="ct-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.in"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={primary}
              onChange={(e) => setPrimary(e.target.checked)}
              className="accent-[#B68A45]"
            />
            Primary contact for this client
          </label>
          <Button
            className="w-full"
            disabled={busy}
            onClick={async () => {
              if (!name.trim()) {
                toast.error("Contact name is required.");
                return;
              }
              setBusy(true);
              try {
                await add({
                  clientId,
                  name,
                  relation: relation || undefined,
                  email: email || undefined,
                  phone: phone || undefined,
                  isPrimary: primary || undefined,
                });
                toast.success("Contact added.");
                setOpen(false);
                setName("");
                setRelation("");
                setEmail("");
                setPhone("");
                setPrimary(false);
              } catch (err) {
                toast.error(
                  err instanceof Error ? err.message : "Failed.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "Add contact"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PortalAccessCard({
  clientId,
  grant,
  canManage,
}: {
  clientId: Id<"clients">;
  grant: { email: string | null; name: string | null } | null;
  canManage: boolean;
}) {
  const revoke = useMutation(api.clients.revokePortalAccess);
  const grantAccess = useMutation(api.clients.grantPortalAccess);
  const invite = useMutation(api.invitations.inviteClient);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const generateToken = () => {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  };

  if (!canManage) {
    return (
      <p className="text-sm text-muted-foreground">
        Portal administration is not part of your role's permissions.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {grant ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
              <ShieldCheck className="size-4" aria-hidden="true" />
              Portal access granted
            </p>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {grant.name ?? "—"} · {grant.email}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await revoke({ clientId });
                toast.success("Portal access revoked.");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Failed.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Revoke
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            No portal access yet. Grant access to a verified account, or send
            the client an invitation.
          </p>
          <div className="flex gap-2">
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="client@example.in"
              aria-label="Client account email"
            />
            <Button
              disabled={busy || !email.trim()}
              onClick={async () => {
                setBusy(true);
                try {
                  await grantAccess({
                    clientId,
                    email: email.trim(),
                  });
                  toast.success("Portal access granted to that account.");
                  setEmail("");
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : "Failed.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Grant
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5"
            disabled={busy || !email.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                const token = generateToken();
                await invite({
                  email: email.trim(),
                  clientId,
                  token,
                });
                const origin = window.location.origin;
                setInviteLink(`${origin}/login?invite=${token}`);
                toast.success("Invitation created — share the link once.");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Failed.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <UserRound className="size-4" aria-hidden="true" />
            No account yet? Create an invitation
          </Button>
          {inviteLink && (
            <div className="rounded-lg border border-[#B68A45]/50 bg-[#f6f1e6] p-3">
              <p className="text-xs font-medium text-[#8a6a33]">
                Invitation link — shown once, valid for 14 days:
              </p>
              <p className="mt-1 break-all text-xs text-muted-foreground">
                {inviteLink}
              </p>
            </div>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Access binds to a verified identity with an explicit grant — never to a
        matching email or a guessable client ID.
      </p>
    </div>
  );
}

export default function Client360() {
  const { clientId: rawId } = useParams<{ clientId: string }>();
  const clientId = rawId as Id<"clients"> | undefined;
  const navigate = useNavigate();

  const data = useQuery(
    api.clients.client360,
    clientId ? { clientId } : "skip",
  );
  const caps = useQuery(api.workspace.myCapabilities);
  const archive = useMutation(api.clients.archive);
  const unarchive = useMutation(api.clients.unarchive);
  const setResponsible = useMutation(api.clients.setResponsibleLawyer);
  const removeContact = useMutation(api.clients.removeContact);
  const members = useQuery(api.workspace.team);

  const [tab, setTab] = useState("overview");
  const [busy, setBusy] = useState(false);

  if (data === undefined) {
    return (
      <ChamberShell subtitle="Client 360" title="Client record">
        <p className="text-sm text-muted-foreground">Opening the record…</p>
      </ChamberShell>
    );
  }

  if (data === null || !clientId) {
    return (
      <ChamberShell subtitle="Client 360" title="Client record">
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <Landmark className="mx-auto size-10 text-muted-foreground" />
            <h2 className="mt-5 font-serif text-2xl font-semibold">
              This client is not on the chamber's record
            </h2>
            <Button
              variant="outline"
              className="mt-6"
              onClick={() => navigate("/clients")}
            >
              <ArrowLeft className="mr-2 size-4" />
              Back to clients
            </Button>
          </CardContent>
        </Card>
      </ChamberShell>
    );
  }

  const c = data.client;
  const canEdit = caps?.capabilities.includes("client.edit") ?? false;
  const lawyerOptions = (members ?? []).filter(
    (m) =>
      m.status === "active" &&
      m.orgRole !== "support_staff" &&
      m.orgRole !== "accountant",
  );

  return (
    <ChamberShell
      subtitle="Client 360"
      title={c.name}
      actions={
        canEdit ? (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                if (c.archivedAt) {
                  await unarchive({ clientId });
                  toast.success("Client restored to the register.");
                } else {
                  await archive({ clientId });
                  toast.success("Client archived. History is preserved.");
                }
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Failed.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Archive className="size-4" aria-hidden="true" />
            {c.archivedAt ? "Restore" : "Archive"}
          </Button>
        ) : undefined
      }
    >
      {/* Overview strip */}
      <div className="rule-frame rounded-lg bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <p className="type-label ink-faded">
              <span className="stamp ink-faded">{c.kind}</span>
              {c.archivedAt
                ? ` · Archived ${formatDateIN(c.archivedAt)}`
                : " · Active"}
              {data.responsible
                ? ` · Responsible: ${data.responsible.name ?? data.responsible.email}`
                : ""}
            </p>
            <p className="text-sm text-muted-foreground">
              {[c.addressLine1, c.addressLine2, c.city, c.state, c.pincode]
                .filter(Boolean)
                .join(", ") || "No address recorded"}
            </p>
            <p className="text-sm text-muted-foreground">
              {[c.phone, c.email, c.gstin ? `GSTIN ${c.gstin}` : ""]
                .filter(Boolean)
                .join(" · ") || "No contact details recorded"}
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-4 text-right">
            <div>
              <dt className="type-label ink-faded">Matters</dt>
              <dd className="font-serif text-xl font-semibold">
                {data.matters.length}
              </dd>
            </div>
            <div>
              <dt className="type-label ink-faded">Open</dt>
              <dd className="font-serif text-xl font-semibold text-[#8a6a33]">
                {data.matters.filter((m) => m.status !== "closed").length}
              </dd>
            </div>
            <div>
              <dt className="type-label ink-faded">Outstanding</dt>
              <dd className="font-serif text-xl font-semibold">
                {data.outstanding > 0 ? formatINRCompact(data.outstanding) : "—"}
              </dd>
            </div>
          </dl>
        </div>
        {c.notes && (
          <p className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">
            {c.notes}
          </p>
        )}
        {canEdit && (
          <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
            <Label className="text-xs">Responsible lawyer</Label>
            <select
              className="rounded-md border border-border bg-card px-2 py-1 text-sm"
              value={c.responsibleLawyerId ?? ""}
              onChange={async (e) => {
                try {
                  await setResponsible({
                    clientId,
                    lawyerId: (e.target.value || undefined) as never,
                  });
                  toast.success("Responsible lawyer updated.");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Failed.");
                }
              }}
              aria-label="Assign responsible lawyer"
            >
              <option value="">— Unassigned —</option>
              {lawyerOptions.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name ?? m.email}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Section tabs */}
      <div
        className="mt-6 flex flex-wrap gap-1 border-b border-border"
        role="tablist"
        aria-label="Client 360 sections"
      >
        {(
          [
            ["overview", "Overview", FileText],
            ["matters", `Matters (${data.matters.length})`, Landmark],
            ["contacts", `Contacts (${data.contacts.length})`, Users],
            ["documents", `Documents (${data.documents.length})`, FileText],
            [
              "communications",
              `Communications (${data.communications.length + data.messages.length})`,
              MessageSquare,
            ],
            ["invoices", `Invoices (${data.invoices.length})`, Receipt],
            ["payments", `Payments (${data.payments.length})`, Receipt],
            ["notes", "Notes", ScrollText],
            ["portal", "Portal access", ShieldCheck],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? "border-[#B68A45] text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === "overview" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rule-frame rounded-lg bg-card p-4">
              <p className="type-label ink-faded">Recent matters</p>
              <ul className="mt-2 space-y-2">
                {data.matters.slice(0, 5).map((m) => (
                  <li key={m._id}>
                    <Link
                      to={`/matters/${m._id}`}
                      className="text-sm font-medium hover:text-[#8a6a33] hover:underline"
                    >
                      {m.title}
                    </Link>
                    <p className="type-label ink-faded">
                      {m.reference} · {MATTER_STATUS[m.status]?.label}
                    </p>
                  </li>
                ))}
                {data.matters.length === 0 && (
                  <li className="text-sm text-muted-foreground">
                    No matters yet.
                  </li>
                )}
              </ul>
            </div>
            <div className="rule-frame rounded-lg bg-card p-4">
              <p className="type-label ink-faded">Billing position</p>
              <p className="mt-2 font-serif text-2xl font-semibold">
                {formatINR(data.outstanding)}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  outstanding
                </span>
              </p>
              <p className="type-label mt-1 ink-faded">
                {data.invoices.length} invoice
                {data.invoices.length === 1 ? "" : "s"} ·{" "}
                {data.payments.length} payment
                {data.payments.length === 1 ? "" : "s"} recorded
              </p>
            </div>
            <div className="rule-frame rounded-lg bg-card p-4">
              <p className="type-label ink-faded">Primary contacts</p>
              <ul className="mt-2 space-y-1.5">
                {data.contacts.filter((x) => x.isPrimary).length === 0 &&
                data.contacts.length === 0 ? (
                  <li className="text-sm text-muted-foreground">
                    No additional contacts recorded.
                  </li>
                ) : (
                  data.contacts
                    .slice()
                    .sort((a, b) => Number(b.isPrimary ?? false) - Number(a.isPrimary ?? false))
                    .slice(0, 4)
                    .map((x) => (
                      <li key={x._id} className="text-sm">
                        {x.name}
                        {x.relation ? (
                          <span className="text-muted-foreground">
                            {" "}
                            · {x.relation}
                          </span>
                        ) : null}
                      </li>
                    ))
                )}
              </ul>
            </div>
            <div className="rule-frame rounded-lg bg-card p-4">
              <p className="type-label ink-faded">Latest documents</p>
              <ul className="mt-2 space-y-1.5">
                {data.documents.slice(0, 4).map((d) => (
                  <li key={d._id} className="truncate text-sm">
                    {d.name}
                  </li>
                ))}
                {data.documents.length === 0 && (
                  <li className="text-sm text-muted-foreground">None yet.</li>
                )}
              </ul>
            </div>
          </div>
        )}

        {tab === "matters" && (
          <div className="rule-frame overflow-x-auto rounded-lg">
            {data.matters.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">
                No matters for this client yet.
              </p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Matter</th>
                    <th>Court</th>
                    <th>Status</th>
                    <th>Updated</th>
                    <th>
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.matters.map((m) => {
                    const st = MATTER_STATUS[m.status] ?? {
                      label: m.status,
                      className: "",
                    };
                    return (
                      <tr key={m._id}>
                        <td className="type-label ink-faded">{m.reference}</td>
                        <td className="font-serif text-[15px] font-semibold">
                          {m.title}
                        </td>
                        <td className="text-muted-foreground">{m.court ?? "—"}</td>
                        <td>
                          <span className={`stamp ${st.className}`}>
                            {st.label}
                          </span>
                        </td>
                        <td className="text-xs text-muted-foreground">
                          {formatDateIN(m.updatedAt)}
                        </td>
                        <td className="text-right">
                          <Link
                            to={`/matters/${m._id}`}
                            className="text-sm font-medium text-[#8a6a33] hover:underline"
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
        )}

        {tab === "contacts" && (
          <div className="space-y-3">
            <div className="flex justify-end">
              {canEdit && <AddContactDialog clientId={clientId} />}
            </div>
            {data.contacts.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  No additional contacts recorded. Add accounts teams, family
                  members or authorised representatives here.
                </CardContent>
              </Card>
            ) : (
              <div className="rule-frame overflow-x-auto rounded-lg">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Relation / role</th>
                      <th>Phone</th>
                      <th>Email</th>
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.contacts.map((x) => (
                      <tr key={x._id}>
                        <td className="font-medium">
                          {x.name}
                          {x.isPrimary && (
                            <span className="type-label ml-2 text-[#8a6a33]">
                              primary
                            </span>
                          )}
                        </td>
                        <td className="text-muted-foreground">
                          {x.relation ?? "—"}
                        </td>
                        <td className="text-muted-foreground">{x.phone ?? "—"}</td>
                        <td className="text-muted-foreground">{x.email ?? "—"}</td>
                        <td className="text-right">
                          {canEdit && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={async () => {
                                try {
                                  await removeContact({ contactId: x._id });
                                  toast.success("Contact removed.");
                                } catch (err) {
                                  toast.error(
                                    err instanceof Error ? err.message : "Failed.",
                                  );
                                }
                              }}
                            >
                              Remove
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === "documents" && (
          <div className="rule-frame overflow-x-auto rounded-lg">
            {data.documents.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">
                No documents across this client's matters.
              </p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Matter</th>
                    <th>Kind</th>
                    <th>Visibility</th>
                    <th>Filed</th>
                    <th>
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.documents.map((d) => (
                    <tr key={d._id}>
                      <td className="max-w-[240px] truncate">{d.name}</td>
                      <td className="type-label ink-faded">
                        {d.matter?.reference ?? "—"}
                      </td>
                      <td className="type-label ink-faded">{d.kind}</td>
                      <td className="type-label ink-faded">
                        {d.visibility === "internal" ? "Internal" : "Shared"}
                      </td>
                      <td className="text-xs text-muted-foreground">
                        {formatDateIN(d.createdAt)}
                      </td>
                      <td className="text-right">
                        {d.storageId && <DocLink documentId={d._id} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === "communications" && (
          <div className="space-y-6">
            <section aria-label="Portal messages">
              <p className="type-label ink-faded">Portal messages</p>
              {data.messages.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  No portal messages yet.
                </p>
              ) : (
                <ol className="mt-2 space-y-2">
                  {data.messages.slice(0, 15).map((m) => (
                    <li key={m._id} className="rule-frame rounded-lg bg-card p-3">
                      <p className="text-sm whitespace-pre-wrap">{m.body}</p>
                      <p className="type-label mt-1 ink-faded">
                        {m.fromClient ? "From the client" : "To the client"} ·{" "}
                        {m.authorName} · {formatDateTimeIN(m.createdAt)}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <section aria-label="Filed communications">
              <p className="type-label ink-faded">Filed communications</p>
              {data.communications.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  No communications filed across this client's matters.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {data.communications.slice(0, 15).map((d) => (
                    <li
                      key={d._id}
                      className="rule-frame flex items-center justify-between gap-3 rounded-lg bg-card p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm">{d.name}</p>
                        <p className="type-label ink-faded">
                          {d.matter?.reference ?? "—"} ·{" "}
                          {formatDateIN(d.createdAt)}
                        </p>
                      </div>
                      {d.storageId && <DocLink documentId={d._id} />}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        {tab === "invoices" && (
          <div className="rule-frame overflow-x-auto rounded-lg">
            {data.invoices.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">
                No invoices raised for this client.
              </p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Matter</th>
                    <th>Issued</th>
                    <th>Total</th>
                    <th>Balance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.invoices.map((i) => {
                    const st = INVOICE_STATUS[i.status] ?? {
                      label: i.status,
                      cls: "",
                    };
                    return (
                      <tr key={i._id}>
                        <td className="type-label ink-faded">{i.number}</td>
                        <td className="type-label ink-faded">
                          {data.matters.find((m) => m._id === i.matterId)
                            ?.reference ?? "—"}
                        </td>
                        <td className="text-xs text-muted-foreground">
                          {formatDateIN(i.issuedOn)}
                        </td>
                        <td className="font-medium">{formatINR(i.totalMinor / 100)}</td>
                        <td className="font-medium">
                          {i.status === "paid"
                            ? "—"
                            : formatINR((i.totalMinor - i.amountPaidMinor) / 100)}
                        </td>
                        <td>
                          <span className={`stamp ${st.cls}`}>{st.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === "payments" && (
          <div className="rule-frame overflow-x-auto rounded-lg">
            {data.payments.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">
                No payments recorded against this client's invoices.
              </p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Amount</th>
                    <th>Mode</th>
                    <th>Reference</th>
                    <th>Received</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payments.map((p) => (
                    <tr key={p._id}>
                      <td className="type-label ink-faded">
                        {p.invoice?.number ?? "—"}
                      </td>
                      <td className="font-medium">{formatINR(p.amountMinor / 100)}</td>
                      <td className="text-muted-foreground">
                        {p.mode?.toUpperCase() ?? "—"}
                      </td>
                      <td className="text-muted-foreground">
                        {p.reference ?? "—"}
                      </td>
                      <td className="text-xs text-muted-foreground">
                        {formatDateIN(p.receivedOn)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === "notes" && (
          <div className="space-y-6">
            <section aria-label="Internal notes">
              <p className="type-label ink-faded">
                Internal notes (chamber only)
              </p>
              {data.internalNotes.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  No internal notes on this client's matters.
                </p>
              ) : (
                <ol className="mt-2 space-y-2">
                  {data.internalNotes.map((n) => (
                    <li key={n._id} className="rule-frame rounded-lg bg-card p-3">
                      <p className="text-sm whitespace-pre-wrap">{n.body}</p>
                      <p className="type-label mt-1 ink-faded">
                        {n.authorName} · {formatDateTimeIN(n.createdAt)}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Internal notes are filtered to matters you are authorized to
                see, and are never shown in the client portal.
              </p>
            </section>
          </div>
        )}

        {tab === "portal" && (
          <div className="rule-frame max-w-2xl rounded-lg bg-card p-5">
            <p className="type-label ink-faded">Client portal administration</p>
            <div className="mt-3">
              <PortalAccessCard
                clientId={clientId}
                grant={data.portalUser}
                canManage={data.canManagePortal}
              />
            </div>
          </div>
        )}
      </div>
    </ChamberShell>
  );
}
