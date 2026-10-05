// =====================================================================
// §32 Phase 12 — Firm export & exit (Settings → Export & exit).
// Job lifecycle: start → collect (scheduled steps) → verify → omissions
// → manifest → downloads (expiring, single-use) → revoke / close.
// HONESTY CONTRACT (requirement 5): INCLUDED parts and OMITTED records
// with reasons are shown side by side; verification failures are shown,
// never smoothed over; the manifest is displayed BEFORE any success
// labelling; and re-authentication refusals surface verbatim.
// Backend: firmExit.* — data.export capability or owner, every gated
// action re-checked server-side with the 168h sign-in window.
// =====================================================================
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Download, FileDown, PackageOpen, ShieldX } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { S32Empty, S32Loading, S32Note, errMessage } from "@/components/s32/shared";
import { formatDateTimeIN } from "@/lib/format";

const JOB_STATUS_CLS: Record<string, string> = {
  collecting: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  awaiting_reauthentication: "bg-muted text-muted-foreground",
  awaiting_download: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  revoked: "bg-muted text-muted-foreground line-through",
};

type JobRow = {
  jobId: string;
  label: string;
  status: string;
  parts: number;
  rows: number;
  verification: { verified: boolean; checkedParts: number; at: number; failures: string[] } | null;
  activeHoldBlocks: { holdId: string; matterId: string; reason: string } | null;
  startedByName: string;
  createdAt: number;
};

type ManifestPart = { table: string; rows: number; sha256: string; storageId: string };
type Omission = { table: string; rows: number; reason: string };

type ManifestData = {
  manifest: {
    schemaVersion: number;
    exportedAt: string;
    organization: { name: string; slug: string };
    parts: ManifestPart[];
    omissions: Omission[];
    documentsNote: string;
    legalHolds: { matterReference: string; reasonKind: string; placedAt: number }[];
    definition: string;
  };
  status: string;
  verification: JobRow["verification"];
  cursor: number;
  planSize: number;
  totalRows: number;
};

export function ExportExitPanel({ canExport, isOwner }: { canExport: boolean; isOwner: boolean }) {
  const jobsData = useQuery(api.firmExit.listJobs, canExport ? {} : "skip");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const manifest = useQuery(
    api.firmExit.buildManifest,
    canExport && selectedJobId ? { jobId: selectedJobId as Id<"firmExportJobs"> } : "skip",
  );

  const startFn = useMutation(api.firmExit.startExportJob);
  const collectFn = useMutation(api.firmExit.runCollectStep);
  const verifyFn = useMutation(api.firmExit.runVerification);
  const omissionsFn = useMutation(api.firmExit.recordOmissions);
  const issueFn = useMutation(api.firmExit.issueDownload);
  const redeemFn = useMutation(api.firmExit.redeemDownload);
  const revokeFn = useMutation(api.firmExit.revokeExport);
  const closeFn = useMutation(api.firmExit.closeOrganization);

  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [confirmText, setConfirmText] = useState("");

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setLastError(null);
    try {
      await fn();
      toast.success(ok);
      return true;
    } catch (e) {
      // Re-authentication and hold refusals surface VERBATIM — the exact
      // backend sentence is shown inline and in the toast.
      const msg = errMessage(e, "Action failed.");
      setLastError(msg);
      toast.error(msg);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    const ok = await act(
      () => startFn({ label: label.trim() || undefined }),
      "Export job started — collection runs in scheduled steps.",
    );
    if (ok) setLabel("");
  };

  const downloadPart = async (jobId: string, partIndex: number, storageId: string) => {
    // issueDownload creates the expiring grant; redeemDownload enforces
    // single-use. Both require recent sign-in — refusals surface verbatim.
    setBusy(true);
    setLastError(null);
    try {
      await issueFn({ jobId: jobId as Id<"firmExportJobs">, partIndex });
      const redeemed = await redeemFn({
        jobId: jobId as Id<"firmExportJobs">,
        storageId: storageId as Id<"_storage">,
      });
      window.open(redeemed.url, "_blank", "noopener");
      toast.success("Download opened — this link is single-use and expires.");
    } catch (e) {
      const msg = errMessage(e, "Download failed.");
      setLastError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    const ok = await act(
      () => closeFn({ confirm: "CLOSE ORGANIZATION" as const }),
      "Organization closed — the verified export is the exit deliverable.",
    );
    if (ok) setConfirmText("");
  };

  const jobs = (jobsData?.jobs ?? []) as unknown as JobRow[];
  const selected = jobs.find((j) => j.jobId === selectedJobId) ?? null;
  const m = manifest as ManifestData | undefined;
  const verified = m?.verification?.verified === true && (m.verification.failures ?? []).length === 0;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <PackageOpen className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Export &amp; exit</h3>
      </div>
      <S32Note>
        A verified export is the firm's complete, portable record: every
        included part carries its row count and SHA-256, and every table NOT
        included is listed with a reason — nothing disappears silently.
        Starting an export, issuing downloads, and closing the organization
        all require a successful sign-in within the last{" "}
        {jobsData?.reauthWindowHours ?? 168} hours.
      </S32Note>

      {!canExport && (
        <S32Note tone="amber">
          Exporting needs the data-export capability (or the owner role).
        </S32Note>
      )}

      {canExport && (
        <>
          {/* Start a job */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">New export job</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {jobsData === undefined ? (
                <S32Loading />
              ) : jobs.some((j) => j.status === "collecting") ? (
                <p className="text-sm text-muted-foreground">
                  An export job is already collecting — resume it below instead
                  of starting another.
                </p>
              ) : (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[240px] flex-1">
                    <Label className="text-xs">Label (optional)</Label>
                    <Input
                      className="mt-1"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="Firm exit export — dated automatically"
                    />
                  </div>
                  <Button size="sm" disabled={busy} onClick={() => void start()}>
                    Start export job
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Jobs */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Export jobs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {jobsData === undefined ? (
                <S32Loading />
              ) : jobs.length === 0 ? (
                <S32Empty>No export jobs yet.</S32Empty>
              ) : (
                jobs.map((j) => (
                  <div
                    key={j.jobId}
                    className={`cursor-pointer rounded-md border p-2 ${
                      selectedJobId === j.jobId
                        ? "border-primary bg-primary/5"
                        : "border-border/70 hover:bg-muted/40"
                    }`}
                    onClick={() => setSelectedJobId(j.jobId)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{j.label}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${JOB_STATUS_CLS[j.status] ?? "bg-muted"}`}>
                        {j.status.replace(/_/g, " ")}
                      </span>
                      {j.verification?.verified && (
                        <Badge variant="outline" className="text-[10px]">verified</Badge>
                      )}
                      <span className="ml-auto text-xs text-muted-foreground">
                        {j.parts} parts · {j.rows} rows · {formatDateTimeIN(j.createdAt)} · {j.startedByName}
                      </span>
                    </div>
                    {j.activeHoldBlocks && (
                      <p className="mt-1 text-xs text-red-700 dark:text-red-400">
                        Exit blocked by active legal hold: {j.activeHoldBlocks.reason}
                      </p>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Selected job workspace */}
          {selected && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Job — {selected.label}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Progress */}
                {m && (
                  <div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Collection progress: {m.cursor}/{m.planSize} checkpoints</span>
                      <span>{m.totalRows} manifest rows</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${m.planSize === 0 ? 0 : Math.round((m.cursor / m.planSize) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Verification — failures shown, never hidden */}
                {m?.verification && (
                  <div
                    className={`rounded-md border p-2 text-sm ${
                      verified
                        ? "border-emerald-500/40 bg-emerald-500/5"
                        : "border-amber-500/40 bg-amber-500/5"
                    }`}
                  >
                    <p className="font-medium">
                      Verification: {verified ? "PASSED" : "NOT PASSED"}
                      {m.verification.checkedParts > 0 && ` — ${m.verification.checkedParts} parts re-read and recomputed`}
                    </p>
                    {(m.verification.failures ?? []).length > 0 && (
                      <ul className="mt-1 list-disc pl-5 text-xs text-red-700 dark:text-red-400">
                        {m.verification.failures.map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap gap-2">
                  {selected.status === "collecting" && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => collectFn({ jobId: selected.jobId as Id<"firmExportJobs"> }), "Collection step scheduled — progress updates automatically.")}>
                      Advance collection
                    </Button>
                  )}
                  {selected.status !== "revoked" && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => verifyFn({ jobId: selected.jobId as Id<"firmExportJobs"> }), "Verification scheduled — independent re-read and recompute of every part.")}>
                      Run verification
                    </Button>
                  )}
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => omissionsFn({ jobId: selected.jobId as Id<"firmExportJobs"> }), "Omissions catalogue recorded (server-side counts).")}>
                    Refresh omissions
                  </Button>
                </div>

                {/* Manifest — INCLUDED parts vs OMITTED records, shown BEFORE success claims */}
                {m && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Export contents — manifest (schema v{m.manifest.schemaVersion}, exported {m.manifest.exportedAt.slice(0, 10)})
                    </p>
                    <div className="overflow-x-auto rounded-md border border-border/70">
                      <table className="w-full min-w-[560px] text-sm">
                        <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                          <tr>
                            <th className="px-3 py-1.5">Included part (table)</th>
                            <th className="px-3 py-1.5">Rows</th>
                            <th className="px-3 py-1.5">SHA-256</th>
                            <th className="px-3 py-1.5" />
                          </tr>
                        </thead>
                        <tbody>
                          {m.manifest.parts.map((p, i) => (
                            <tr key={`${p.table}-${i}`} className="border-t border-border/60">
                              <td className="px-3 py-1.5 font-mono text-xs">{p.table}</td>
                              <td className="px-3 py-1.5 font-mono">{p.rows}</td>
                              <td className="px-3 py-1.5 font-mono text-[10px]">{p.sha256.slice(0, 16)}…</td>
                              <td className="px-3 py-1.5 text-right">
                                {selected.status !== "revoked" && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 text-[11px]"
                                    disabled={busy}
                                    onClick={() => void downloadPart(selected.jobId, i, p.storageId)}
                                  >
                                    <FileDown className="mr-1 size-3" /> Download
                                  </Button>
                                )}
                              </td>
                            </tr>
                          ))}
                          {m.manifest.parts.length === 0 && (
                            <tr>
                              <td colSpan={4} className="px-3 py-2 text-center text-xs text-muted-foreground">
                                No parts collected yet — advance collection.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="overflow-hidden rounded-md border border-border/70">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                          <tr>
                            <th className="px-3 py-1.5">Omitted table (NOT included)</th>
                            <th className="px-3 py-1.5">Rows</th>
                            <th className="px-3 py-1.5">Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {m.manifest.omissions.map((o) => (
                            <tr key={o.table} className="border-t border-border/60">
                              <td className="px-3 py-1.5 font-mono text-xs">{o.table}</td>
                              <td className="px-3 py-1.5 font-mono">{o.rows}</td>
                              <td className="px-3 py-1.5 text-xs text-muted-foreground">{o.reason}</td>
                            </tr>
                          ))}
                          {m.manifest.omissions.length === 0 && (
                            <tr>
                              <td colSpan={3} className="px-3 py-2 text-center text-xs text-muted-foreground">
                                Run “Refresh omissions” to record the catalogue (counts computed server-side).
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    <S32Note>{m.manifest.documentsNote}</S32Note>

                    {m.manifest.legalHolds.length > 0 && (
                      <div className="rounded-md border border-red-500/40 bg-red-500/5 p-2 text-sm">
                        <p className="flex items-center gap-1.5 font-medium">
                          <ShieldX className="size-4 text-red-600" /> Legal holds listed on this export
                        </p>
                        <ul className="mt-1 text-xs text-muted-foreground">
                          {m.manifest.legalHolds.map((h, i) => (
                            <li key={i}>
                              {h.matterReference} — {h.reasonKind} — placed {formatDateTimeIN(h.placedAt)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <details className="rounded border border-border/60 p-2">
                      <summary className="cursor-pointer text-xs font-medium">Manifest definition</summary>
                      <p className="mt-1 text-xs text-muted-foreground">{m.manifest.definition}</p>
                    </details>
                  </div>
                )}

                {/* Revoke */}
                {selected.status !== "revoked" && (
                  <div className="space-y-2 rounded-md border border-border/70 p-2">
                    <Label className="text-xs">Revoke this export (owner/administrator; audited)</Label>
                    <Input
                      value={revokeReason}
                      onChange={(e) => setRevokeReason(e.target.value)}
                      placeholder="Reason (≥10 chars) — e.g. job superseded by a later export."
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || revokeReason.trim().length < 10}
                      onClick={() =>
                        void act(
                          () =>
                            revokeFn({
                              jobId: selected.jobId as Id<"firmExportJobs">,
                              reason: revokeReason,
                            }),
                          "Export revoked — downloads are refused from now on.",
                        )
                      }
                    >
                      <Download className="mr-1 size-3.5 rotate-180" /> Revoke export
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Close organization — owner only, hold-aware, reauth-gated */}
          <Card className="border-red-500/40">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm text-red-700 dark:text-red-400">
                <ShieldX className="size-4" /> Close organization
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <S32Note tone="red">
                Owner-only. Requires a VERIFIED export job (verification passed)
                and is BLOCKED while any legal hold is active — the block is
                recorded on the job, listed above, never hidden. This is an
                explicit, audited decision; the verified export is the exit
                deliverable.
              </S32Note>
              {isOwner ? (
                <>
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder='Type "CLOSE ORGANIZATION" to confirm'
                    className="max-w-sm font-mono"
                  />
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy || confirmText !== "CLOSE ORGANIZATION"}
                    onClick={() => void close()}
                  >
                    Close organization
                  </Button>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Only the owner can close the organization.</p>
              )}
            </CardContent>
          </Card>

          {lastError && (
            <div className="rounded-md border border-red-500/40 bg-red-500/5 p-2 text-sm text-red-700 dark:text-red-400">
              <p className="font-medium">Last refusal (verbatim):</p>
              <p className="mt-0.5">{lastError}</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
