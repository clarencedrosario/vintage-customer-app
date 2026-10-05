// =====================================================================
// §32 Phase 5 — Filing-readiness workspace (matter file → Filing tab).
// Real backend: filingReadiness.getDraft / createDraft / setItem /
// deterministicChecks / propose+list/apply/dismissSuggestions /
// approveReady / listVersions. The no-acceptance-guarantee disclaimer
// and the frozen-snapshot semantics travel on every surface.
// =====================================================================
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { ClipboardCheck, FileWarning, Loader2, ShieldCheck } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { S32Empty, S32Loading, S32Note, errMessage } from "@/components/s32/shared";
import { formatDateTimeIN } from "@/lib/format";

type Item = {
  key: string;
  requirement: string;
  itemStatus: "satisfied" | "not_satisfied" | "not_applicable";
  documentId?: string;
  factId?: string;
  note?: string;
};

type Draft = {
  _id: string;
  version: number;
  status: string;
  items: Item[];
  disclaimer: string;
};

type Check = { key: string; status: string; detail: string };

type Suggestion = {
  _id: string;
  key: string;
  requirement: string;
  basis: string;
  status: "proposed" | "applied" | "dismissed";
  dismissedReason?: string;
};

type VersionRow = {
  _id: string;
  version: number;
  status: string;
  approvedAt?: number;
  approvedSnapshotHash?: string;
  invalidation?: { at: number; because: string; detail: string };
};

const ITEM_STATES = [
  { key: "not_satisfied", label: "Not satisfied" },
  { key: "satisfied", label: "Satisfied" },
  { key: "not_applicable", label: "N/A" },
] as const;

export function FilingReadinessPanel({ matterId }: { matterId: Id<"matters"> }) {
  const draft = useQuery(api.filingReadiness.getDraft, { matterId });
  const versions = useQuery(api.filingReadiness.listVersions, { matterId });
  const caps = useQuery(api.workspace.myCapabilities);
  const canEdit = caps?.capabilities.includes("matter.edit") ?? false;

  const checks = useQuery(
    api.filingReadiness.deterministicChecks,
    draft ? { checklistId: draft._id as Id<"filingChecklists"> } : "skip",
  );
  const suggestions = useQuery(
    api.filingReadiness.listSuggestions,
    draft ? { checklistId: draft._id as Id<"filingChecklists"> } : "skip",
  );

  const createFn = useMutation(api.filingReadiness.createDraft);
  const setItemFn = useMutation(api.filingReadiness.setItem);
  const proposeFn = useMutation(api.filingReadiness.proposeSuggestions);
  const applyFn = useMutation(api.filingReadiness.applySuggestion);
  const dismissFn = useMutation(api.filingReadiness.dismissSuggestion);
  const approveFn = useMutation(api.filingReadiness.approveReady);

  const [busy, setBusy] = useState(false);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [itemNote, setItemNote] = useState("");
  const [dismissFor, setDismissFor] = useState<string | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const [approveOpen, setApproveOpen] = useState(false);

  const createDraft = async () => {
    setBusy(true);
    try {
      await createFn({ matterId });
      toast.success("New checklist version created.");
    } catch (e) {
      toast.error(errMessage(e, "Could not create the checklist."));
    } finally {
      setBusy(false);
    }
  };

  const setItem = async (key: string, itemStatus: string) => {
    if (!draft) return;
    try {
      await setItemFn({
        checklistId: draft._id as Id<"filingChecklists">,
        key,
        requirement: draft.items.find((i) => i.key === key)?.requirement ?? key,
        itemStatus: itemStatus as "satisfied" | "not_satisfied" | "not_applicable",
        note: noteFor === key ? itemNote : undefined,
      });
      toast.success("Item updated — the checklist is an editable draft until approved.");
      setNoteFor(null);
      setItemNote("");
    } catch (e) {
      toast.error(errMessage(e, "Could not update the item."));
    }
  };

  const runApprove = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await approveFn({ checklistId: draft._id as Id<"filingChecklists"> });
      toast.success("Approved as ready — version frozen; any later document or profile change invalidates it automatically.");
      setApproveOpen(false);
    } catch (e) {
      toast.error(errMessage(e, "Approval was refused."));
    } finally {
      setBusy(false);
    }
  };

  if (draft === undefined) {
    return <S32Loading label="Loading the filing workspace…" />;
  }

  const d = draft as unknown as Draft | null;

  if (d === null) {
    return (
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Filing readiness</h3>
        </div>
        <S32Empty>
          No filing checklist exists for this matter yet. Create version 1 to
          record, item by item, what the filing needs — deterministic checks run
          over the current matter state and suggest only what the record
          supports.
        </S32Empty>
        <Button
          size="sm"
          disabled={!canEdit || busy}
          onClick={() => void createDraft()}
          className="gap-1.5"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ClipboardCheck className="size-4" />}
          Create checklist (v1)
        </Button>
        {!canEdit && (
          <S32Note>
            Creating or editing the checklist needs the matter-edit permission.
          </S32Note>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ClipboardCheck className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Filing readiness</h3>
        <Badge variant="outline" className="text-[10px]">
          v{d.version} · draft
        </Badge>
        {(checks as unknown as { checks: Check[] } | undefined)?.checks
          ?.filter((c) => c.status !== "ok")
          .map((c) => (
            <Badge key={c.key} variant="destructive" className="text-[10px]">
              {c.key.replace(/_/g, " ")}
            </Badge>
          ))}
      </div>

      <S32Note>{d.disclaimer}</S32Note>

      <div className="space-y-2">
        {(d.items ?? []).map((it) => (
          <div key={it.key} className="rounded-md border border-border/70 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">{it.requirement}</p>
                {it.note && (
                  <p className="mt-0.5 text-xs italic text-muted-foreground">{it.note}</p>
                )}
              </div>
              <div className="flex gap-1">
                {ITEM_STATES.map((s) => (
                  <Button
                    key={s.key}
                    size="sm"
                    variant={it.itemStatus === s.key ? "default" : "outline"}
                    className="h-7 text-xs"
                    disabled={!canEdit}
                    onClick={() => void setItem(it.key, s.key)}
                  >
                    {s.label}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => {
                    setNoteFor(noteFor === it.key ? null : it.key);
                    setItemNote("");
                  }}
                >
                  Basis…
                </Button>
              </div>
            </div>
            {noteFor === it.key && (
              <div className="mt-2">
                <Textarea
                  className="min-h-[52px]"
                  value={itemNote}
                  onChange={(e) => setItemNote(e.target.value)}
                  placeholder="Recorded basis / note for this item (optional)."
                />
                <div className="mt-1 flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => void setItem(it.key, it.itemStatus)}
                  >
                    Save basis
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Deterministic checks over CURRENT matter state */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileWarning className="size-4 text-muted-foreground" />
            Deterministic checks (current state)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {checks === undefined ? (
            <S32Loading label="Running checks…" />
          ) : (
            (checks as unknown as { checks: Check[]; disclaimer: string }).checks.map((c) => (
              <div key={c.key} className="flex items-start gap-2 text-sm">
                <Badge
                  variant={c.status === "ok" ? "outline" : "destructive"}
                  className="mt-0.5 text-[10px]"
                >
                  {c.status}
                </Badge>
                <p className="text-muted-foreground">{c.detail}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Derived suggestions — apply/dismiss by the lawyer only */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-2 text-sm">
            <span>Derived suggestions</span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={!canEdit || busy || !draft}
              onClick={async () => {
                setBusy(true);
                try {
                  await proposeFn({ checklistId: d._id as Id<"filingChecklists"> });
                  toast.success("Suggestions re-derived from the current record.");
                } catch (e) {
                  toast.error(errMessage(e, "Could not derive suggestions."));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Derive
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {suggestions === undefined ? (
            <S32Loading />
          ) : (suggestions as unknown as Suggestion[]).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No suggestions recorded — derive to populate from the matter's documents and profile.
            </p>
          ) : (
            (suggestions as unknown as Suggestion[]).map((s) => (
              <div key={s._id} className="rounded-md border border-border/70 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={s.status === "proposed" ? "secondary" : "outline"}
                    className="text-[10px]"
                  >
                    {s.status}
                  </Badge>
                  <p className="text-sm">{s.requirement}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Derived from: {s.basis}
                </p>
                {s.status === "proposed" && canEdit && (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={async () => {
                        try {
                          await applyFn({ suggestionId: s._id as Id<"filingSuggestions"> });
                          toast.success("Suggestion applied to the checklist draft.");
                        } catch (e) {
                          toast.error(errMessage(e, "Could not apply the suggestion."));
                        }
                      }}
                    >
                      Apply
                    </Button>
                    {dismissFor === s._id ? (
                      <>
                        <Textarea
                          className="min-h-[44px] flex-1"
                          value={dismissReason}
                          onChange={(e) => setDismissReason(e.target.value)}
                          placeholder="Reason (mandatory) for dismissing."
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={!dismissReason.trim()}
                          onClick={async () => {
                            try {
                              await dismissFn({
                                suggestionId: s._id as Id<"filingSuggestions">,
                                reason: dismissReason,
                              });
                              toast.success("Suggestion dismissed with reason.");
                              setDismissFor(null);
                              setDismissReason("");
                            } catch (e) {
                              toast.error(errMessage(e, "Could not dismiss the suggestion."));
                            }
                          }}
                        >
                          Confirm dismissal
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => {
                          setDismissFor(s._id);
                          setDismissReason("");
                        }}
                      >
                        Dismiss…
                      </Button>
                    )}
                  </div>
                )}
                {s.status === "dismissed" && s.dismissedReason && (
                  <p className="mt-1 text-xs italic text-muted-foreground">
                    Dismissed: {s.dismissedReason}
                  </p>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Approve → freeze; invalidations listed below */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          className="gap-1.5"
          disabled={!canEdit || busy}
          onClick={() => setApproveOpen(true)}
        >
          <ShieldCheck className="size-4" /> Approve as ready…
        </Button>
        <p className="text-xs text-muted-foreground">
          Approval freezes THIS version; later documents or profile changes
          invalidate it automatically — the next state is a new version, never a
          silent reopen.
        </p>
      </div>

      {versions !== undefined && (versions as unknown as VersionRow[]).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Version history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {(versions as unknown as VersionRow[])
              .slice()
              .sort((a, b) => b.version - a.version)
              .map((v) => (
                <div key={v._id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant={v.status === "draft" ? "secondary" : v.status === "approved_ready" ? "default" : "destructive"}>
                    v{v.version} · {v.status.replace(/_/g, " ")}
                  </Badge>
                  {v.approvedAt && (
                    <span className="text-xs text-muted-foreground">
                      approved {formatDateTimeIN(v.approvedAt)}
                      {v.approvedSnapshotHash ? ` · snapshot ${v.approvedSnapshotHash.slice(0, 10)}…` : ""}
                    </span>
                  )}
                  {v.invalidation && (
                    <span className="text-xs text-destructive">
                      invalidated {formatDateTimeIN(v.invalidation.at)} ({v.invalidation.because.replace(/_/g, " ")})
                    </span>
                  )}
                </div>
              ))}
          </CardContent>
        </Card>
      )}

      {/* Approval confirmation — honest, explicit */}
      <div
        role="dialog"
        aria-label="Confirm approval"
        className={approveOpen ? "fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" : "hidden"}
        onClick={() => setApproveOpen(false)}
      >
        <div
          className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-sm font-semibold">Approve filing readiness?</p>
          <S32Note className="mt-2">
            {(checks as unknown as { disclaimer?: string } | undefined)?.disclaimer ??
              "This is a dated readiness statement over the current record. It guarantees nothing about acceptance by any court or registry."}
          </S32Note>
          <div className="mt-4 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setApproveOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void runApprove()}>
              {busy && <Loader2 className="mr-1 size-4 animate-spin" />}
              Freeze v{d.version} as ready
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
