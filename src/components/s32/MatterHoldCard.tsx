// =====================================================================
// §32 Phase 7 — Matter-level legal hold card (Matter file → Review tab).
// Shows every hold ever placed on THIS matter (active first, with lifted
// history honestly labelled), and lets holders of the close-matters
// capability place or lift a hold with a mandatory audited reason.
// Backend: ethicalWalls.holdsForMatter / placeHold / liftHold — the
// matter.close capability check is enforced server-side.
// =====================================================================
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Lock, Unlock } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
export const HOLD_REASON_KINDS = [
  "litigation",
  "investigation",
  "audit",
  "regulatory",
  "other",
] as const;

type MatterHoldRow = {
  _id: string;
  reasonKind: string;
  reason: string;
  status: string;
  createdByName: string;
  createdAt: number;
  liftedAt?: number;
  liftedByName?: string;
  liftReason?: string;
};

export function MatterHoldCard({
  matterId,
  canManage,
}: {
  matterId: Id<"matters">;
  canManage: boolean;
}) {
  const holds = useQuery(api.ethicalWalls.holdsForMatter, { matterId });
  const placeHoldFn = useMutation(api.ethicalWalls.placeHold);
  const liftHoldFn = useMutation(api.ethicalWalls.liftHold);

  const [kind, setKind] = useState<string>("litigation");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [liftFor, setLiftFor] = useState<string | null>(null);
  const [liftReason, setLiftReason] = useState("");

  const active = (holds ?? []).filter((h) => h.status === "active");
  const lifted = (holds ?? []).filter((h) => h.status !== "active");

  const place = async () => {
    if (reason.trim().length < 10) {
      toast.error("Hold reason must be at least 10 characters (audited).");
      return;
    }
    setBusy(true);
    try {
      await placeHoldFn({
        matterId,
        reasonKind: kind as (typeof HOLD_REASON_KINDS)[number],
        reason,
      });
      toast.success(
        "Legal hold placed — deletion of this matter's records is now blocked for every member, including owners.",
      );
      setReason("");
    } catch (e) {
      toast.error(errMessage(e, "Could not place the hold."));
    } finally {
      setBusy(false);
    }
  };

  const lift = async (holdId: string) => {
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

  return (
    <div className="space-y-2 rounded-md border border-border/70 p-3">
      <div className="flex items-center gap-2">
        <Lock className="size-4 text-muted-foreground" />
        <h4 className="text-sm font-semibold">Legal holds on this matter</h4>
        {active.length > 0 && (
          <Badge variant="destructive" className="text-[10px]">
            preservation active — deletion blocked firm-wide
          </Badge>
        )}
      </div>
      <S32Note>
        A hold is a preservation order: while one stands, no member — owner or
        administrator included — can delete this matter's records, and lifting
        it is an explicit, audited decision.
      </S32Note>

      {holds === undefined ? (
        <S32Loading />
      ) : active.length === 0 && lifted.length === 0 ? (
        <S32Empty>No holds have ever been placed on this matter.</S32Empty>
      ) : (
        <div className="space-y-1.5">
          {[...active, ...lifted].map((h) => {
            const row = h as unknown as MatterHoldRow;
            return (
              <div key={row._id} className="rounded border border-border/60 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={row.status === "active" ? "destructive" : "secondary"} className="text-[10px]">
                    {row.reasonKind}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {row.status === "active" ? "active" : "lifted"}
                  </Badge>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {row.createdByName} · {formatDateTimeIN(row.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-xs italic text-muted-foreground">“{row.reason}”</p>
                {row.status !== "active" && row.liftReason && (
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    Lifted {row.liftedAt ? formatDateTimeIN(row.liftedAt) : ""}
                    {row.liftedByName ? ` by ${row.liftedByName}` : ""}: “{row.liftReason}”
                  </p>
                )}
                {canManage && row.status === "active" &&
                  (liftFor === row._id ? (
                    <div className="mt-2 space-y-2">
                      <Textarea
                        className="min-h-[52px]"
                        value={liftReason}
                        onChange={(e) => setLiftReason(e.target.value)}
                        placeholder="Why the preservation duty ends (≥10 chars, audited)."
                      />
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setLiftFor(null)}>Cancel</Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={liftReason.trim().length < 10}
                          onClick={() => void lift(row._id)}
                        >
                          <Unlock className="mr-1 size-3.5" /> Lift hold
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-1.5 h-7 text-xs"
                      onClick={() => { setLiftFor(row._id); setLiftReason(""); }}
                    >
                      Lift…
                    </Button>
                  ))}
              </div>
            );
          })}
        </div>
      )}

      {canManage && (
        <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-2">
          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <div>
              <Label className="text-xs">Kind of preservation duty</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HOLD_REASON_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button size="sm" className="gap-1.5" disabled={busy} onClick={() => void place()}>
                <Lock className="size-4" /> Place hold
              </Button>
            </div>
          </div>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why preservation is required (≥10 chars, audited)."
          />
        </div>
      )}
    </div>
  );
}
