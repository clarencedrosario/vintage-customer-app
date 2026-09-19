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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { MoreHorizontal, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const ORG_ROLE_OPTIONS = [
  "partner",
  "senior_associate",
  "associate",
  "junior",
  "paralegal",
  "accountant",
  "administrator",
  "support_staff",
] as const;

type AssignableRole = (typeof ORG_ROLE_OPTIONS)[number];

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  partner: "Partner",
  senior_associate: "Senior Associate",
  associate: "Associate",
  junior: "Junior",
  paralegal: "Paralegal",
  accountant: "Accountant",
  administrator: "Administrator",
  support_staff: "Support Staff",
};

function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export default function Team() {
  // Effective permissions from the server decide what renders; every
  // mutation re-checks server-side, so this UI gating is cosmetic only.
  const caps = useQuery(api.workspace.myCapabilities);
  const team = useQuery(api.workspace.team);
  const invites = useQuery(api.invitations.listInvitations);
  const clients = useQuery(api.clients.list);

  const setRole = useMutation(api.workspace.setMemberRole);
  const suspend = useMutation(api.workspace.suspendMember);
  const reactivate = useMutation(api.workspace.reactivateMember);
  const remove = useMutation(api.workspace.removeMember);
  const inviteStaff = useMutation(api.invitations.inviteStaff);
  const inviteClient = useMutation(api.invitations.inviteClient);
  const revoke = useMutation(api.invitations.revokeInvitation);

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"staff" | "client">("staff");
  const [email, setEmail] = useState("");
  const [orgRole, setOrgRole] = useState<AssignableRole>("junior");
  const [clientId, setClientId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ email: string; token: string } | null>(
    null,
  );

  const canInvite = caps?.capabilities.includes("team.invite") ?? false;
  const canManage = caps?.capabilities.includes("team.manage") ?? false;

  const handleInvite = async () => {
    if (!email.trim()) {
      toast.error("Email is required.");
      return;
    }
    setBusy(true);
    try {
      const token = generateToken();
      if (kind === "staff") {
        await inviteStaff({ email, orgRole, token });
      } else {
        if (!clientId) {
          toast.error("Choose the client record to connect.");
          setBusy(false);
          return;
        }
        await inviteClient({
          clientId: clientId as Id<"clients">,
          email,
          token,
        });
      }
      setIssued({ email, token });
      setEmail("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.success(done);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    }
  };

  return (
    <ChamberShell
      subtitle="The Digital Chamber"
      title="Team"
      actions={
        canInvite ? (
          <Button
            size="sm"
            onClick={() => {
              setIssued(null);
              setOpen(true);
            }}
          >
            <UserPlus className="mr-1.5 size-4" aria-hidden="true" />
            Invite
          </Button>
        ) : undefined
      }
    >
      <p className="max-w-2xl text-sm text-muted-foreground">
        Advocates, paralegals, accountants and staff of this organisation. A
        member's role decides what they may do — the full matrix is under
        Settings → Permissions. Support staff never hold lawyers' privileges.
      </p>

      {/* Members */}
      {team === undefined ? (
        <p className="mt-10 text-sm text-muted-foreground">Calling the roll…</p>
      ) : team.length === 0 ? (
        <p className="mt-10 text-sm text-muted-foreground">
          You are not an active member of an organisation yet. Create one under
          Settings → Organisation, or accept an invitation.
        </p>
      ) : (
        <div className="mt-8 overflow-hidden rounded-lg border border-border bg-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                {canManage && <th className="w-10" aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {team.map((m) => (
                <tr key={m.membershipId}>
                  <td>
                    <p className="font-medium">{m.name ?? "—"}</p>
                    {m.barCouncilId ? (
                      <p className="type-label mt-0.5 ink-faded">
                        Bar ID {m.barCouncilId}
                      </p>
                    ) : null}
                  </td>
                  <td className="text-sm text-muted-foreground">
                    {m.email ?? "—"}
                  </td>
                  <td>
                    {canManage && m.status !== "invited" ? (
                      <Select
                        value={m.orgRole}
                        onValueChange={(v) =>
                          act(
                            () =>
                              setRole({
                                membershipId: m.membershipId,
                                orgRole: v as AssignableRole,
                              }),
                            "Role updated.",
                          )
                        }
                      >
                        <SelectTrigger
                          size="sm"
                          className="h-7 w-[150px] text-xs"
                          aria-label={`Role for ${m.name ?? m.email ?? "member"}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {/* Owner appears only on owner rows and cannot be
                              granted here; last-owner protection is enforced
                              server-side. */}
                          {m.orgRole === "owner" && (
                            <SelectItem value="owner">Owner</SelectItem>
                          )}
                          {ORG_ROLE_OPTIONS.map((r) => (
                            <SelectItem key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="stamp text-primary">
                        {ROLE_LABEL[m.orgRole] ?? m.orgRole}
                      </span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`stamp ${
                        m.status === "active"
                          ? "text-emerald-700"
                          : m.status === "suspended"
                            ? "text-destructive"
                            : "text-muted-foreground"
                      }`}
                    >
                      {m.status}
                    </span>
                  </td>
                  {canManage && (
                    <td className="text-right">
                      {m.status !== "invited" && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-7"
                              aria-label={`Actions for ${m.name ?? m.email ?? "member"}`}
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {m.status === "active" ? (
                              <DropdownMenuItem
                                onClick={() =>
                                  act(
                                    () =>
                                      suspend({
                                        membershipId: m.membershipId,
                                      }),
                                    "Member suspended.",
                                  )
                                }
                              >
                                Suspend access
                              </DropdownMenuItem>
                            ) : m.status === "suspended" ? (
                              <DropdownMenuItem
                                onClick={() =>
                                  act(
                                    () =>
                                      reactivate({
                                        membershipId: m.membershipId,
                                      }),
                                    "Member reactivated.",
                                  )
                                }
                              >
                                Reactivate
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() =>
                                act(
                                  () =>
                                    remove({ membershipId: m.membershipId }),
                                  "Member removed.",
                                )
                              }
                            >
                              Remove from organisation
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Invitation register */}
      {canInvite && invites !== undefined && invites.length > 0 && (
        <section aria-label="Invitations" className="mt-10">
          <p className="type-label ink-faded">Invitations</p>
          <div className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Kind</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th className="text-right">—</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => (
                  <tr key={inv._id}>
                    <td className="text-sm">{inv.email}</td>
                    <td className="type-label ink-faded">{inv.kind}</td>
                    <td className="type-label ink-faded">
                      {inv.orgRole
                        ? (ROLE_LABEL[inv.orgRole] ?? inv.orgRole)
                        : "—"}
                    </td>
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
                          onClick={() =>
                            act(
                              () => revoke({ invitationId: inv._id }),
                              "Invitation revoked.",
                            )
                          }
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
          {issued ? (
            <>
              <DialogHeader>
                <DialogTitle className="font-serif text-2xl">
                  Invitation created
                </DialogTitle>
                <DialogDescription>
                  Share this link with {issued.email}. It is shown once and
                  stored only as a hash — copy it now.
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-md border border-border bg-muted p-3">
                <code className="block break-all text-xs">
                  {`${window.location.origin}/login?invite=${issued.token}`}
                </code>
              </div>
              <DialogFooter>
                <Button
                  className="w-full"
                  onClick={() => {
                    void navigator.clipboard?.writeText(
                      `${window.location.origin}/login?invite=${issued.token}`,
                    );
                    toast.success("Link copied.");
                    setOpen(false);
                  }}
                >
                  Copy link &amp; close
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
                  Staff join with an organisation role; clients are connected
                  to their record. Invitations expire in 14 days, are
                  single-use, and can be revoked.
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
                      <Label>Organisation role</Label>
                      <Select
                        value={orgRole}
                        onValueChange={(v) => setOrgRole(v as AssignableRole)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ORG_ROLE_OPTIONS.map((r) => (
                            <SelectItem key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {kind === "client" && (
                    <div className="space-y-2">
                      <Label>Client record</Label>
                      <Select value={clientId} onValueChange={setClientId}>
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
                <Button
                  className="w-full"
                  onClick={handleInvite}
                  disabled={busy}
                >
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
