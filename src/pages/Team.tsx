import { ChamberShell } from "@/components/ChamberShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

const CONSOLE = new Set(["firm_owner", "admin", "lawyer", "user"]);

function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const ROLE_LABEL: Record<string, string> = {
  firm_owner: "Firm Owner",
  admin: "Administrator",
  lawyer: "Advocate",
  user: "Advocate",
  staff: "Staff",
  member: "Staff",
  client: "Client",
};

export default function Team() {
  const { user: me } = useAuth();
  const team = useQuery(api.workspace.team);
  const invites = useQuery(api.invitations.listInvitations);
  const clients = useQuery(api.clients.list);
  const inviteStaff = useMutation(api.invitations.inviteStaff);
  const inviteClient = useMutation(api.invitations.inviteClient);
  const revoke = useMutation(api.invitations.revokeInvitation);

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"staff" | "client">("staff");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"lawyer" | "staff">("staff");
  const [clientId, setClientId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  const canManage = me ? CONSOLE.has(me.role ?? "") : false;

  const handleInvite = async () => {
    if (!email.trim()) {
      toast.error("Email is required.");
      return;
    }
    setBusy(true);
    try {
      const token = generateToken();
      if (kind === "staff") {
        await inviteStaff({ email, role, token });
      } else {
        if (!clientId) {
          toast.error("Choose the client record to connect.");
          setBusy(false);
          return;
        }
        await inviteClient({
          clientId: clientId as never,
          email,
          token,
        });
      }
      setIssuedToken(token);
      setEmail("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ChamberShell subtitle="The Digital Chamber">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="type-label ink-faded">Members of Chambers</p>
          <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight">
            Team
          </h1>
          <p className="mt-2 max-w-2xl ink-faded">
            Advocates and staff with access to this chamber. Staff and clients
            join by invitation only.
          </p>
        </div>
        {canManage && (
          <Button
            onClick={() => {
              setIssuedToken(null);
              setOpen(true);
            }}
          >
            Invite
          </Button>
        )}
      </div>

      {/* Members */}
      {team === undefined ? (
        <p className="mt-10 text-sm ink-faded">Calling the roll…</p>
      ) : (
        <div className="mt-8 overflow-hidden rounded-lg border border-border bg-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Email</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {team.map((m) => (
                <tr key={m._id}>
                  <td>
                    <p className="font-medium">
                      {m.name ?? "—"}
                      {m._id === me?._id && (
                        <span className="type-label ml-2 ink-faded">(you)</span>
                      )}
                    </p>
                    {m.barCouncilId ? (
                      <p className="type-label mt-0.5 ink-faded">
                        Bar ID {m.barCouncilId}
                      </p>
                    ) : null}
                  </td>
                  <td className="text-sm text-muted-foreground">{m.email ?? "—"}</td>
                  <td>
                    <span className="stamp text-primary">
                      {ROLE_LABEL[m.role ?? ""] ?? "Member"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Invitation register */}
      {canManage && invites !== undefined && invites.length > 0 && (
        <section aria-label="Invitations" className="mt-10">
          <p className="type-label ink-faded">Invitations</p>
          <div className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Kind</th>
                  <th>Status</th>
                  <th className="text-right">—</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => (
                  <tr key={inv._id}>
                    <td className="text-sm">{inv.email}</td>
                    <td className="type-label ink-faded">{inv.kind}</td>
                    <td>
                      <span
                        className={`stamp ${
                          inv.status === "pending"
                            ? "text-[#8a6a33]"
                            : inv.status === "accepted"
                              ? "text-emerald-700"
                              : "text-muted-foreground"
                        }`}
                      >
                        {inv.status}
                      </span>
                    </td>
                    <td className="text-right">
                      {inv.status === "pending" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            try {
                              await revoke({ invitationId: inv._id });
                              toast.success("Invitation revoked.");
                            } catch (err) {
                              toast.error(
                                err instanceof Error ? err.message : "Failed.",
                              );
                            }
                          }}
                        >
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Invite dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          {issuedToken ? (
            <>
              <DialogHeader>
                <DialogTitle className="font-serif text-2xl">
                  Invitation created
                </DialogTitle>
                <DialogDescription>
                  Share this link with {email || "the invitee"}. It is shown
                  once and stored only as a hash — copy it now.
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-md border border-border bg-muted p-3">
                <code className="block break-all text-xs">
                  {`${window.location.origin}/login?invite=${issuedToken}`}
                </code>
              </div>
              <DialogFooter>
                <Button
                  className="w-full"
                  onClick={() => {
                    void navigator.clipboard?.writeText(
                      `${window.location.origin}/login?invite=${issuedToken}`,
                    );
                    toast.success("Link copied.");
                    setOpen(false);
                  }}
                >
                  Copy link & close
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="font-serif text-2xl">
                  Invite someone
                </DialogTitle>
                <DialogDescription>
                  Staff join with a role; clients are connected to their
                  matters. Invitations expire in 14 days and are single-use.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Invite</Label>
                    <Select
                      value={kind}
                      onValueChange={(v) => setKind(v as "staff" | "client")}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="staff">Staff / Advocate</SelectItem>
                        <SelectItem value="client">Client</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {kind === "staff" && (
                    <div className="space-y-2">
                      <Label>Role</Label>
                      <Select
                        value={role}
                        onValueChange={(v) => setRole(v as "lawyer" | "staff")}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="lawyer">Advocate</SelectItem>
                          <SelectItem value="staff">Support staff</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {kind === "client" && (
                    <div className="space-y-2">
                      <Label>Client record</Label>
                      <Select
                        value={clientId}
                        onValueChange={setClientId}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Choose client" />
                        </SelectTrigger>
                        <SelectContent>
                          {(clients ?? []).map((c) => (
                            <SelectItem key={c._id} value={c._id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="inv-email">Email</Label>
                  <Input
                    id="inv-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button className="w-full" onClick={handleInvite} disabled={busy}>
                  {busy ? "Creating…" : "Create invitation"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </ChamberShell>
  );
}
