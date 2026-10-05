// =====================================================================
// §32 Phase 7 — Legal holds, ethical walls, emergency access
// (Owner console section; matter-level hold card lives in the Review tab).
// Real backend: ethicalWalls.* — placeHold/liftHold/activeHolds,
// createWall/liftWall/listWalls/wallExplanation, grant/acknowledge/
// revokeEmergencyAccess. matter.close capability gates management
// server-side; the UI mirrors it only for honest disabled states.
// =====================================================================
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { BrickWall, Loader2, Lock, ShieldCheck, Unlock } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { S32Empty, S32Loading, S32Note, errMessage } from "@/components/s32/shared";
import { formatDateTimeIN } from "@/lib/format";

/** Must mirror backend LEGAL_HOLD_REASON_KINDS (drift-checked in group3.test.ts). */
export const HOLD_KINDS = ["litigation", "investigation", "audit", "regulatory", "other"] as const;
/** Must mirror backend EMERGENCY_GRANT_REASONS (drift-checked in group3.test.ts). */
export const GRANT_REASONS = [
  "court_order",
  "hold_setup_or_correction",
  "wall_correction",
  "security_incident",
  "other_documented",
] as const;

type Wall = {
  _id: string;
  title: string;
  reason: string;
  status: string;
  scope: { kind: string; userId?: string; orgRole?: string };
  matterIds?: string[] | null;
  matters: { _id: string; reference: string; title: string }[] | null;
  exemptActorIds?: string[] | null;
  createdAt: number;
  createdByName?: string;
  liftedAt?: number | null;
  liftReason?: string | null;
};

/** Row shape of ethicalWalls.grantsForWall (management view). */
export type EmergencyGrantRow = {
  grantId: string;
  actorId: string;
  actorName: string;
  reason: string;
  detail: string;
  acknowledgedAt: number | null;
  expiresAt: number;
  revokedAt: number | null;
  createdAt: number;
};

type Hold = {
  _id: string;
  matterId: string;
  reasonKind: string;
  reason: string;
  placedByName: string;
  createdAt: number;
};

type Grant = {
  _id: string;
  wallId: string;
  actorId: string;
  reason: string;
  detail: string;
  acknowledgedAt?: number;
  expiresAt: number;
  revokedAt?: number;
};

export function WallsHoldsPanel({
  matters,
  members,
  canManage,
}: {
  matters: { _id: string; reference: string; title: string }[];
  members: { _id: string; name: string }[];
  canManage: boolean;
}) {
  const holds = useQuery(api.ethicalWalls.activeHolds, canManage ? {} : "skip");
  const walls = useQuery(api.ethicalWalls.listWalls, { includeLifted: true });

  const placeHoldFn = useMutation(api.ethicalWalls.placeHold);
  const liftHoldFn = useMutation(api.ethicalWalls.liftHold);
  const createWallFn = useMutation(api.ethicalWalls.createWall);
  const liftWallFn = useMutation(api.ethicalWalls.liftWall);
  const grantFn = useMutation(api.ethicalWalls.grantEmergencyAccess);
  const ackFn = useMutation(api.ethicalWalls.acknowledgeEmergencyAccess);
  const revokeGrantFn = useMutation(api.ethicalWalls.revokeEmergencyAccess);

  // Hold form
  const [holdMatter, setHoldMatter] = useState("");
  const [holdKind, setHoldKind] = useState<string>("litigation");
  const [holdReason, setHoldReason] = useState("");
  const [holdBusy, setHoldBusy] = useState(false);
  const [liftFor, setLiftFor] = useState<string | null>(null);
  const [liftReason, setLiftReason] = useState("");

  // Wall form
  const [wallOpen, setWallOpen] = useState(false);
  const [wallTitle, setWallTitle] = useState("");
  const [wallReason, setWallReason] = useState("");
  const [wallScope, setWallScope] = useState("all");
  const [wallUser, setWallUser] = useState("");
  const [wallRole, setWallRole] = useState("associate");
  const [wallMatters, setWallMatters] = useState<string[]>([]);
  const [wallExempt, setWallExempt] = useState<string[]>([]);
  const [wallBusy, setWallBusy] = useState(false);

  // Emergency grant form
  const [grantFor, setGrantFor] = useState<string | null>(null);
  const [grantActor, setGrantActor] = useState("");
  const [grantReason, setGrantReason] = useState<string>("court_order");
  const [grantDetail, setGrantDetail] = useState("");
  const [grantBusy, setGrantBusy] = useState(false);

  // Per-wall grants listing + inline wall lift
  const [expandedGrants, setExpandedGrants] = useState<string | null>(null);
  const [liftWallFor, setLiftWallFor] = useState<string | null>(null);
  const [wallLiftReason, setWallLiftReason] = useState("");

  const placeHold = async () => {
    if (!holdMatter) {
      toast.error("Choose the matter to preserve.");
      return;
    }
    if (holdReason.trim().length < 10) {
      toast.error("Hold reason must be at least 10 characters (audited).");
      return;
    }
    setHoldBusy(true);
    try {
      await placeHoldFn({
        matterId: holdMatter as Id<"matters">,
        reasonKind: holdKind as (typeof HOLD_KINDS)[number],
        reason: holdReason,
      });
      toast.success("Legal hold placed — deletion is now blocked for every member, including owners.");
      setHoldMatter("");
      setHoldReason("");
    } catch (e) {
      toast.error(errMessage(e, "Could not place the hold."));
    } finally {
      setHoldBusy(false);
    }
  };

  const liftHold = async (holdId: string) => {
    if (liftReason.trim().length < 10) {
      toast.error("Lifting needs a reason of at least 10 characters (audited).");
      return;
    }
    try {
      await liftHoldFn({ holdId: holdId as Id<"legalHolds">, reason: liftReason });
      toast.success("Hold lifted — explicit, audited decision recorded.");
      setLiftFor(null);
      setLiftReason("");
    } catch (e) {
      toast.error(errMessage(e, "Could not lift the hold."));
    }
  };

  const createWall = async () => {
    if (!wallTitle.trim() || wallReason.trim().length < 10) {
      toast.error("Title and a reason (≥10 chars) are required.");
      return;
    }
    setWallBusy(true);
    try {
      await createWallFn({
        title: wallTitle,
        scope:
          wallScope === "all"
            ? { kind: "all" as const }
            : wallScope === "user"
              ? { kind: "user" as const, userId: wallUser as Id<"users"> }
              : { kind: "role" as const, orgRole: wallRole as "associate" },
        matterIds: wallScope === "all" || wallMatters.length === 0 ? undefined : (wallMatters as Id<"matters">[]),
        exemptActorIds: wallExempt.length > 0 ? (wallExempt as Id<"users">[]) : undefined,
        reason: wallReason,
      });
      toast.success("Wall created — named exempt actors only; no role is implicitly privileged.");
      setWallOpen(false);
      setWallTitle("");
      setWallReason("");
      setWallMatters([]);
      setWallExempt([]);
    } catch (e) {
      toast.error(errMessage(e, "Could not create the wall."));
    } finally {
      setWallBusy(false);
    }
  };

  const liftWall = async (wallId: string) => {
    if (wallLiftReason.trim().length < 10) {
      toast.error("Lifting a wall needs a reason of at least 10 characters (audited).");
      return;
    }
    try {
      await liftWallFn({ wallId: wallId as Id<"ethicalWalls">, reason: wallLiftReason });
      toast.success("Wall lifted — explicit, audited decision recorded.");
      setLiftWallFor(null);
      setWallLiftReason("");
    } catch (e) {
      toast.error(errMessage(e, "Could not lift the wall."));
    }
  };

  const grantAccess = async (wallId: string) => {
    if (!grantActor || grantDetail.trim().length < 10) {
      toast.error("Pick the actor and write the documented reason (≥10 chars).");
      return;
    }
    setGrantBusy(true);
    try {
      await grantFn({
        wallId: wallId as Id<"ethicalWalls">,
        actorId: grantActor as Id<"users">,
        reason: grantReason as (typeof GRANT_REASONS)[number],
        detail: grantDetail,
      });
      toast.success("Grant created — it opens nothing until the holder acknowledges it.");
      setGrantFor(null);
      setGrantActor("");
      setGrantDetail("");
    } catch (e) {
      toast.error(errMessage(e, "Could not create the grant."));
    } finally {
      setGrantBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <BrickWall className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Walls &amp; holds</h3>
        {!canManage && (
          <Badge variant="secondary" className="text-xs">
            Management needs the close-matters capability
          </Badge>
        )}
      </div>

      <S32Note>
        Holds are preservation orders: while one stands, deletion is blocked for
        every member — owners and administrators included. Walls restrict
        everything a member can retrieve about the covered matters; the ONLY way
        through is a time-boxed emergency grant that the holder must
        acknowledge, and every use is audited.
      </S32Note>

      {/* Legal holds */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Lock className="size-4 text-muted-foreground" /> Active legal holds
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {holds === undefined ? (
            <S32Loading />
          ) : (holds as unknown as Hold[]).length === 0 ? (
            <p className="text-sm text-muted-foreground">No active holds.</p>
          ) : (
            (holds as unknown as Hold[]).map((h) => (
              <div key={h._id} className="rounded-md border border-border/70 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="destructive" className="text-[10px]">{h.reasonKind}</Badge>
                  <span className="text-sm">{matters.find((m) => m._id === h.matterId)?.reference ?? "matter"}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {h.placedByName} · {formatDateTimeIN(h.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-xs italic text-muted-foreground">“{h.reason}”</p>
                {canManage &&
                  (liftFor === h._id ? (
                    <div className="mt-2 space-y-2">
                      <Textarea
                        className="min-h-[52px]"
                        value={liftReason}
                        onChange={(e) => setLiftReason(e.target.value)}
                        placeholder="Why the preservation duty ends (≥10 chars, audited)."
                      />
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setLiftFor(null)}>Cancel</Button>
                        <Button size="sm" variant="destructive" disabled={liftReason.trim().length < 10} onClick={() => void liftHold(h._id)}>
                          <Unlock className="mr-1 size-3.5" /> Lift hold
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => { setLiftFor(h._id); setLiftReason(""); }}>
                      Lift…
                    </Button>
                  ))}
              </div>
            ))
          )}
          {canManage && (
            <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
              <div className="grid gap-2 md:grid-cols-3">
                <div>
                  <Label className="text-xs">Matter</Label>
                  <Select value={holdMatter} onValueChange={setHoldMatter}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Choose matter" /></SelectTrigger>
                    <SelectContent>
                      {matters.map((m) => (
                        <SelectItem key={m._id} value={m._id}>
                          {m.reference} — {m.title.slice(0, 28)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Kind</Label>
                  <Select value={holdKind} onValueChange={setHoldKind}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {HOLD_KINDS.map((k) => (
                        <SelectItem key={k} value={k}>{k}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button size="sm" className="gap-1.5" disabled={holdBusy || !holdMatter} onClick={() => void placeHold()}>
                    <Lock className="size-4" /> Place hold
                  </Button>
                </div>
              </div>
              <Textarea
                className="min-h-[52px]"
                value={holdReason}
                onChange={(e) => setHoldReason(e.target.value)}
                placeholder="Why preservation is required (≥10 chars, audited)."
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Ethical walls */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2">
              <BrickWall className="size-4 text-muted-foreground" /> Ethical walls
            </span>
            {canManage && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setWallOpen((s) => !s)}>
                {wallOpen ? "Close" : "Create wall…"}
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {walls === undefined ? (
            <S32Loading />
          ) : (walls as unknown as Wall[]).length === 0 ? (
            <S32Empty>No walls stand. Create one only for a real conflict — scope it narrowly.</S32Empty>
          ) : (
            (walls as unknown as Wall[]).map((w) => (
              <div key={w._id} className="rounded-md border border-border/70 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{w.title}</p>
                  <Badge variant={w.status === "active" ? "outline" : "secondary"} className="text-[10px]">
                    {w.status === "active" ? "active" : "lifted"}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {w.scope.kind === "all" ? "whole firm" : w.scope.kind === "user" ? "one member" : `role: ${w.scope.orgRole}`}
                  </Badge>
                  {w.matters && w.matters.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {w.matters.map((m) => m.reference).join(", ")}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {w.createdByName ?? ""} · {formatDateTimeIN(w.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-xs italic text-muted-foreground">“{w.reason}”</p>
                {w.status === "lifted" && w.liftReason && (
                  <p className="mt-1 text-xs text-muted-foreground">Lifted: “{w.liftReason}”</p>
                )}
                {(w.exemptActorIds ?? []).length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Named exempt: {(w.exemptActorIds ?? []).map((u) => members.find((m) => m._id === u)?.name ?? u.slice(-6)).join(", ")}
                  </p>
                )}
                {canManage && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {grantFor === w._id ? (
                      <div className="w-full space-y-2 rounded-md border border-primary/30 bg-primary/5 p-2">
                        <div className="grid gap-2 md:grid-cols-2">
                          <Select value={grantActor} onValueChange={setGrantActor}>
                            <SelectTrigger><SelectValue placeholder="Emergency actor" /></SelectTrigger>
                            <SelectContent>
                              {members.map((m) => (
                                <SelectItem key={m._id} value={m._id}>{m.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select value={grantReason} onValueChange={setGrantReason}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {GRANT_REASONS.map((r) => (
                                <SelectItem key={r} value={r}>{r.replace(/_/g, " ")}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Input
                          value={grantDetail}
                          onChange={(e) => setGrantDetail(e.target.value)}
                          placeholder="Documented reason (≥10 chars) — e.g. court order reference."
                        />
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => setGrantFor(null)}>Cancel</Button>
                          <Button size="sm" disabled={grantBusy} onClick={() => void grantAccess(w._id)}>
                            Grant (≤24h)
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setGrantFor(w._id); setGrantActor(""); setGrantDetail(""); }}>
                          Emergency grant…
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => { setLiftWallFor(w._id); setWallLiftReason(""); }}
                        >
                          Lift…
                        </Button>
                      </>
                    )}
                  </div>
                )}
                {liftWallFor === w._id && canManage && (
                  <div className="mt-2 space-y-2">
                    <Textarea
                      className="min-h-[52px]"
                      value={wallLiftReason}
                      onChange={(e) => setWallLiftReason(e.target.value)}
                      placeholder="Why the conflict duty ends (≥10 chars, audited)."
                    />
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setLiftWallFor(null)}>Cancel</Button>
                      <Button size="sm" variant="destructive" disabled={wallLiftReason.trim().length < 10} onClick={() => void liftWall(w._id)}>
                        <Unlock className="mr-1 size-3.5" /> Lift wall
                      </Button>
                    </div>
                  </div>
                )}
                {canManage && (
                  <div className="mt-2">
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                      onClick={() => setExpandedGrants(expandedGrants === w._id ? null : w._id)}
                    >
                      {expandedGrants === w._id ? "Hide emergency grants" : "Emergency grants on this wall…"}
                    </button>
                    {expandedGrants === w._id && (
                      <WallGrants wallId={w._id} canManage={canManage} />
                    )}
                  </div>
                )}
              </div>
            ))
          )}
          {wallOpen && canManage && (
            <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
              <div className="grid gap-2 md:grid-cols-2">
                <div>
                  <Label className="text-xs">Title</Label>
                  <Input className="mt-1" value={wallTitle} onChange={(e) => setWallTitle(e.target.value)} placeholder="e.g. Former client X vs new matter Y" />
                </div>
                <div>
                  <Label className="text-xs">Scope</Label>
                  <Select value={wallScope} onValueChange={setWallScope}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Whole firm</SelectItem>
                      <SelectItem value="user">One member</SelectItem>
                      <SelectItem value="role">A role</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {wallScope === "user" && (
                  <div>
                    <Label className="text-xs">Member</Label>
                    <Select value={wallUser} onValueChange={setWallUser}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Choose member" /></SelectTrigger>
                      <SelectContent>
                        {members.map((m) => (
                          <SelectItem key={m._id} value={m._id}>{m.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {wallScope === "role" && (
                  <div>
                    <Label className="text-xs">Role</Label>
                    <Select value={wallRole} onValueChange={setWallRole}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["owner", "partner", "senior_associate", "associate", "junior", "paralegal", "accountant", "administrator"].map((r) => (
                          <SelectItem key={r} value={r}>{r.replace(/_/g, " ")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              {wallScope !== "all" && matters.length > 0 && (
                <div>
                  <Label className="text-xs">Matters covered (none = whole firm)</Label>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {matters.map((m) => {
                      const on = wallMatters.includes(m._id);
                      return (
                        <button
                          key={m._id}
                          type="button"
                          className={`rounded border px-2 py-0.5 text-[10px] ${on ? "border-primary bg-primary/10" : "border-border"}`}
                          onClick={() => setWallMatters(on ? wallMatters.filter((x) => x !== m._id) : [...wallMatters, m._id])}
                        >
                          {m.reference}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div>
                <Label className="text-xs">Named exempt actors (must be active members)</Label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {members.map((m) => {
                    const on = wallExempt.includes(m._id);
                    return (
                      <button
                        key={m._id}
                        type="button"
                        className={`rounded border px-2 py-0.5 text-[10px] ${on ? "border-primary bg-primary/10" : "border-border"}`}
                        onClick={() => setWallExempt(on ? wallExempt.filter((x) => x !== m._id) : [...wallExempt, m._id])}
                      >
                        {m.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              <Textarea
                className="min-h-[52px]"
                value={wallReason}
                onChange={(e) => setWallReason(e.target.value)}
                placeholder="Why this wall exists (≥10 chars, audited)."
              />
              <div className="flex justify-end">
                <Button size="sm" disabled={wallBusy} onClick={() => void createWall()}>
                  {wallBusy && <Loader2 className="mr-1 size-4 animate-spin" />}
                  Create wall
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Emergency access discipline — per-wall grant history is listed on each wall */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ShieldCheck className="size-4 text-muted-foreground" /> Emergency-access discipline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <S32Note>
            A grant opens nothing until its holder acknowledges it. Grants expire
            within 24 hours, can be revoked with a reason, and every use is
            audited. The holder sees the wall explanation — title, reason, their
            exemption or grant state — instead of a bare refusal. Each wall
            above lists every grant ever issued against it: who, why, when it
            was acknowledged, and whether it was revoked or expired.
          </S32Note>
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * Per-wall emergency-grant history (management view). Mounted only when a
 * wall's grant list is expanded, so the hooks here are per-instance.
 */
function WallGrants({ wallId, canManage }: { wallId: string; canManage: boolean }) {
  const grants = useQuery(api.ethicalWalls.grantsForWall, {
    wallId: wallId as Id<"ethicalWalls">,
  });
  const revokeFn = useMutation(api.ethicalWalls.revokeEmergencyAccess);
  const [revokeFor, setRevokeFor] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [busy, setBusy] = useState(false);

  const revoke = async (grantId: string) => {
    if (revokeReason.trim().length < 10) {
      toast.error("Revocation needs a reason of at least 10 characters (audited).");
      return;
    }
    setBusy(true);
    try {
      await revokeFn({ grantId: grantId as Id<"emergencyAccessGrants">, reason: revokeReason });
      toast.success("Grant revoked — access closes immediately and the revocation is audited.");
      setRevokeFor(null);
      setRevokeReason("");
    } catch (e) {
      toast.error(errMessage(e, "Could not revoke the grant."));
    } finally {
      setBusy(false);
    }
  };

  if (grants === undefined) return <S32Loading />;
  if (grants.length === 0) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        No emergency grants have ever been issued against this wall.
      </p>
    );
  }
  return (
    <div className="mt-1 space-y-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-2">
      {(grants as unknown as EmergencyGrantRow[]).map((g) => {
        const revoked = g.revokedAt != null;
        const expired = !revoked && g.expiresAt <= Date.now();
        const state = revoked
          ? { label: "revoked", cls: "bg-muted text-muted-foreground" }
          : expired
            ? { label: "expired", cls: "bg-muted text-muted-foreground" }
            : g.acknowledgedAt == null
              ? { label: "awaiting acknowledgement — opens nothing yet", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" }
              : { label: "active until expiry", cls: "bg-red-500/10 text-red-700 dark:text-red-400" };
        return (
          <div key={g.grantId} className="rounded border border-border/60 bg-background/70 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium">{g.actorName}</span>
              <Badge variant="outline" className="text-[10px]">{g.reason.replace(/_/g, " ")}</Badge>
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${state.cls}`}>{state.label}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">
                expires {formatDateTimeIN(g.expiresAt)}
              </span>
            </div>
            <p className="mt-0.5 text-xs italic text-muted-foreground">“{g.detail}”</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              granted {formatDateTimeIN(g.createdAt)}
              {g.acknowledgedAt != null ? ` · acknowledged ${formatDateTimeIN(g.acknowledgedAt)}` : " · NOT acknowledged"}
              {g.revokedAt != null ? ` · revoked ${formatDateTimeIN(g.revokedAt)}` : ""}
            </p>
            {canManage && !revoked &&
              (revokeFor === g.grantId ? (
                <div className="mt-1.5 space-y-1.5">
                  <Textarea
                    className="min-h-[48px]"
                    value={revokeReason}
                    onChange={(e) => setRevokeReason(e.target.value)}
                    placeholder="Why this access ends now (≥10 chars, audited)."
                  />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setRevokeFor(null)}>Cancel</Button>
                    <Button size="sm" variant="destructive" disabled={busy || revokeReason.trim().length < 10} onClick={() => void revoke(g.grantId)}>
                      Revoke grant
                    </Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" variant="outline" className="mt-1.5 h-6 text-[11px]" onClick={() => { setRevokeFor(g.grantId); setRevokeReason(""); }}>
                  Revoke…
                </Button>
              ))}
          </div>
        );
      })}
    </div>
  );
}
