// =====================================================================
// §32 Phase 3 — Matter-impact alerts (matter file → Review tab).
// OPT-IN by design: nothing is watched until the lawyer anchors sources
// and switches alerts on (matter.edit gated server-side). Alerts list,
// acknowledge (note) / dismiss (reason) / assign / convert-to-task-
// proposal — every action the backend tests exercise.
// =====================================================================
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { BellRing, Loader2, Radar } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { S32Empty, S32Loading, S32Note, errMessage } from "@/components/s32/shared";
import { formatDateTimeIN } from "@/lib/format";

type Alert = {
  _id: string;
  stableKey: string;
  sourceTitle: string;
  fromVersion: number | undefined;
  toVersion: number;
  treatment: string | undefined;
  treatmentSourceKey: string | undefined;
  withheldTreatmentNote: string | undefined;
  sourceUrl: string | undefined;
  status: string;
  assignedToId: string | undefined;
  coverageNote: string;
};

export const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  dismissed: "Dismissed",
  converted_to_task: "Converted to task",
  superseded: "Superseded",
};

export function MatterImpactPanel({
  matterId,
  canEdit,
  members,
}: {
  matterId: Id<"matters">;
  canEdit: boolean;
  members: { _id: string; name: string; email: string }[];
}) {
  const matter = useQuery(api.matters.get, { matterId });
  const alerts = useQuery(api.matterImpact.list, { matterId, includeHandled: true });
  const setOptInFn = useMutation(api.matterImpact.setOptIn);
  const setAnchorFn = useMutation(api.matterImpact.setAnchor);
  const ackFn = useMutation(api.matterImpact.acknowledge);
  const dismissFn = useMutation(api.matterImpact.dismiss);
  const assignFn = useMutation(api.matterImpact.assign);
  const convertFn = useMutation(api.matterImpact.convertToTaskProposal);

  const [optBusy, setOptBusy] = useState(false);
  const [anchorKey, setAnchorKey] = useState("");
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const profile = matter?.legalProfile ?? null;
  const optedIn = profile?.impactAlerts === true;
  const anchors = profile?.anchoredSourceKeys ?? [];

  useEffect(() => {
    setActingOn(null);
    setNote("");
  }, [matterId]);

  const toggleOptIn = async () => {
    setOptBusy(true);
    try {
      await setOptInFn({ matterId, enabled: !optedIn });
      toast.success(
        optedIn
          ? "Alerts switched off — nothing is watched."
          : "Alerts on. Anchor the sources this matter stands on below.",
      );
    } catch (e) {
      toast.error(errMessage(e, "Could not change the alert setting."));
    } finally {
      setOptBusy(false);
    }
  };

  const toggleAnchor = async (stableKey: string, remove: boolean) => {
    try {
      await setAnchorFn({ matterId, stableKey, remove: remove || undefined });
      toast.success(remove ? "Anchor removed." : "Source anchored to this matter.");
    } catch (e) {
      toast.error(errMessage(e, "Could not change the anchor."));
    }
  };

  const act = async (
    fn: () => Promise<unknown>,
    ok: string,
  ) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      setActingOn(null);
      setNote("");
    } catch (e) {
      toast.error(errMessage(e, "The action failed."));
    } finally {
      setBusy(false);
    }
  };

  const openCount = (alerts ?? []).filter((a) => a.status === "open").length;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Radar className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Matter-impact alerts</h3>
        {openCount > 0 && (
          <Badge variant="destructive" className="text-[10px]">
            {openCount} open
          </Badge>
        )}
      </div>

      <S32Note>
        {optedIn
          ? "Watching is on for this matter — anchored sources are re-checked when the research corpus updates."
          : "OPT-IN: no source is watched and no alert is raised until you anchor sources and switch alerts on."}
      </S32Note>

      <div className="rounded-md border border-border/70 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-primary"
              checked={optedIn}
              disabled={!canEdit || optBusy}
              onChange={() => void toggleOptIn()}
            />
            Watch anchored sources for changes
          </label>
          {!canEdit && (
            <Badge variant="secondary" className="text-xs">
              Managing alerts needs the matter-edit permission
            </Badge>
          )}
        </div>
        {optedIn && (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-56 flex-1">
                <Label className="text-xs">
                  Anchor a source stable key (e.g. in:statute:ipc-1860)
                </Label>
                <Input
                  className="mt-1"
                  value={anchorKey}
                  onChange={(e) => setAnchorKey(e.target.value)}
                  placeholder="in:statute:ipc-1860"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!canEdit || !anchorKey.trim()}
                onClick={() => {
                  void toggleAnchor(anchorKey.trim(), false);
                  setAnchorKey("");
                }}
              >
                Anchor
              </Button>
            </div>
            {anchors.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nothing anchored yet — alerts fire only for anchored sources.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {anchors.map((k) => (
                  <Badge key={k} variant="outline" className="gap-1 text-[10px]">
                    {k}
                    {canEdit && (
                      <button
                        type="button"
                        aria-label={`Remove anchor ${k}`}
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => void toggleAnchor(k, true)}
                      >
                        ×
                      </button>
                    )}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {alerts === undefined ? (
        <S32Loading label="Loading alerts…" />
      ) : alerts.length === 0 ? (
        <S32Empty>
          No impact alerts for this matter. When an anchored source gains a newer
          version in the corpus, the alert appears here with the version change
          and any sourced treatment.
        </S32Empty>
      ) : (
        <div className="space-y-3">
          {alerts.map((a) => {
            const row = a as unknown as Alert;
            const isActing = actingOn === row._id;
            return (
              <Card key={row._id}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <BellRing className="size-4 text-muted-foreground" />
                    <CardTitle className="text-sm">{row.sourceTitle}</CardTitle>
                    <Badge variant={row.status === "open" ? "destructive" : "outline"}>
                      {STATUS_LABELS[row.status] ?? row.status}
                    </Badge>
                    <span className="ml-auto text-xs text-muted-foreground">
                      v{row.fromVersion ?? "—"} → v{row.toVersion}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {row.treatment && (
                    <p className="text-xs">
                      <span className="font-medium">Sourced treatment:</span>{" "}
                      {row.treatment}
                      {row.treatmentSourceKey ? ` (${row.treatmentSourceKey})` : ""}
                    </p>
                  )}
                  {row.withheldTreatmentNote && (
                    <S32Note>{row.withheldTreatmentNote}</S32Note>
                  )}
                  {row.sourceUrl && (
                    <a
                      href={row.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block text-xs text-primary underline-offset-2 hover:underline"
                    >
                      Open the changed source
                    </a>
                  )}
                  <p className="text-xs text-muted-foreground">{row.coverageNote}</p>

                  {isActing ? (
                    <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
                      <div>
                        <Label className="text-xs">Note (mandatory)</Label>
                        <Textarea
                          className="mt-1 min-h-[56px]"
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder="Recorded with the acknowledgement / dismissal."
                        />
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setActingOn(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          disabled={busy || !note.trim()}
                          onClick={() =>
                            void act(
                              () => ackFn({ alertId: row._id as Id<"matterImpactAlerts">, note }),
                              "Alert acknowledged with your note.",
                            )
                          }
                        >
                          Acknowledge
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || !note.trim()}
                          onClick={() =>
                            void act(
                              () => dismissFn({ alertId: row._id as Id<"matterImpactAlerts">, reason: note }),
                              "Alert dismissed — kept on the audit trail.",
                            )
                          }
                        >
                          Dismiss
                        </Button>
                        {members[0] && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              void act(
                                () =>
                                  assignFn({
                                    alertId: row._id as Id<"matterImpactAlerts">,
                                    assigneeId: members[0]!._id as Id<"users">,
                                  }),
                                `Assigned to ${members[0]!.name}.`,
                              )
                            }
                          >
                            Assign to {members[0]!.name}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void act(
                              () => convertFn({ alertId: row._id as Id<"matterImpactAlerts"> }),
                              "Task proposal created — approve it from the proposals flow.",
                            )
                          }
                        >
                          Convert to task proposal
                        </Button>
                      </div>
                    </div>
                  ) : (
                    row.status === "open" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => {
                          setActingOn(row._id);
                          setNote("");
                        }}
                      >
                        Handle this alert…
                      </Button>
                    )
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
