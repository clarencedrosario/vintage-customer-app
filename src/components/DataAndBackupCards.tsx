import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { api } from "@/convex/_generated/api";
import {
  IMPORT_COLUMNS,
  IMPORT_ENTITY_LABELS,
  IMPORT_ENTITY_NOTES,
  IMPORT_ROW_LIMIT,
  parseCsv,
  downloadTemplate,
  type ImportEntity,
} from "@/lib/csvImport";
import {
  useAction,
  useMutation,
  useQuery,
} from "convex/react";
import { Download, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

// ---------------------------------------------------------------
// Data import (section 28) — CSV staging, validation, duplicate
// handling, error report, then an explicit commit or discard.
// ---------------------------------------------------------------

type StagedRow = {
  kind: string;
  matterRef?: string;
  fields: Record<string, string>;
};

export function DataImportCard() {
  const batches = useQuery(api.imports.listBatches);
  const stageBatch = useMutation(api.imports.stage);
  const commitBatch = useMutation(api.imports.commit);
  const discardBatch = useMutation(api.imports.discard);

  const [entity, setEntity] = useState<ImportEntity>("clients");
  const [dupStrategy, setDupStrategy] = useState<"skip" | "create">("skip");
  const [staging, setStaging] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const cols = IMPORT_COLUMNS[entity];

  const handleFile = async (file: File) => {
    setStaging(true);
    try {
      const text = await file.text();
      const { headers, rows } = parseCsv(text);
      const objects = rows.map((cells) => {
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => {
          obj[h.trim().toLowerCase()] = (cells[i] ?? "").trim();
        });
        return obj;
      });
      const res = await stageBatch({
        entity,
        fileName: file.name,
        duplicateStrategy: dupStrategy,
        rows: objects,
      });
      if (res.errorCount > 0) {
        toast.warning(
          `${res.validRows} of ${res.totalRows} row(s) valid — ${res.errorCount} row(s) have issues. Open the batch to review.`,
        );
      } else {
        toast.success(
          `${res.validRows} row(s) validated. Review the preview, then apply or discard.`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      setStaging(false);
    }
  };

  return (
    <Card className="rule-frame bg-card">
      <CardHeader>
        <CardTitle className="font-serif text-2xl">Data import</CardTitle>
        <CardDescription>
          Bring in clients, matters, hearings, chronology and document
          metadata from your own records. Every batch is validated and
          previewed first — nothing is written until you explicitly apply
          it, and it can be discarded instead.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="imp-entity">What are you importing?</Label>
            <Select
              value={entity}
              onValueChange={(v) => setEntity(v as ImportEntity)}
            >
              <SelectTrigger id="imp-entity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(IMPORT_ENTITY_LABELS) as ImportEntity[]).map(
                  (e) => (
                    <SelectItem key={e} value={e}>
                      {IMPORT_ENTITY_LABELS[e]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="imp-dup">If a matching record already exists</Label>
            <Select
              value={dupStrategy}
              onValueChange={(v) => setDupStrategy(v as "skip" | "create")}
            >
              <SelectTrigger id="imp-dup">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="skip">Skip the duplicate row</SelectItem>
                <SelectItem value="create">
                  Import it anyway as a new record
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Template &amp; upload</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => downloadTemplate(entity)}
              >
                <Download className="size-4" aria-hidden="true" />
                Template
              </Button>
              <Label
                htmlFor="imp-file"
                className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
              >
                <Upload className="size-4" aria-hidden="true" />
                {staging ? "Reading…" : "Choose CSV"}
              </Label>
              <input
                id="imp-file"
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                disabled={staging}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                  e.target.value = "";
                }}
              />
            </div>
          </div>
        </div>

        <div className="rounded-md border border-border bg-background/50 p-4">
          <p className="text-sm font-medium">{IMPORT_ENTITY_NOTES[entity]}</p>
          <div className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {cols.map((c) => (
              <p key={c.key} className="text-xs text-muted-foreground">
                <span className="font-mono">{c.header}</span>
                {c.required ? " — required" : ""}
                {c.hint ? ` — ${c.hint}` : ""}
              </p>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Up to {IMPORT_ROW_LIMIT} rows per batch. Dates are read as
            Asia/Kolkata. Rows failing validation are listed in the error
            report and a batch is never partially applied.
          </p>
        </div>

        <div className="space-y-2">
          <p className="type-label ink-faded">Recent import batches</p>
          {batches === undefined ? (
            <p className="text-sm text-muted-foreground">Retrieving…</p>
          ) : batches.length === 0 ? (
            <p className="text-sm text-muted-foreground">No imports yet.</p>
          ) : (
            batches.map((b) => (
              <div
                key={b._id}
                className="flex flex-col gap-2 rounded-md border border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{b.fileName}</span>
                    <Badge variant="outline">
                      {IMPORT_ENTITY_LABELS[b.entity as ImportEntity] ??
                        b.entity}
                    </Badge>
                    <Badge
                      variant={
                        b.status === "committed"
                          ? "secondary"
                          : b.status === "staged"
                            ? "default"
                            : "outline"
                      }
                    >
                      {b.status === "staged"
                        ? "Awaiting review"
                        : b.status === "committed"
                          ? `Applied — ${b.createdCount ?? 0} created`
                          : "Discarded"}
                    </Badge>
                    {b.errorCount > 0 && (
                      <Badge variant="destructive">
                        {b.errorCount} row issue(s)
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {b.totalRows} row(s) in · {b.validRows} valid ·{" "}
                    {b.duplicateCount ?? 0} duplicate(s) ·{" "}
                    {new Date(b.createdAt).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                    })}
                  </p>
                </div>
                {b.status === "staged" && (
                  <Button size="sm" onClick={() => setDetailId(b.batchId)}>
                    Review batch
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </CardContent>

      {detailId && (
        <ImportBatchDialog
          batchId={detailId}
          onClose={() => setDetailId(null)}
          commitBatch={commitBatch}
          discardBatch={discardBatch}
        />
      )}
    </Card>
  );
}

function ImportBatchDialog(props: {
  batchId: string;
  onClose: () => void;
  commitBatch: ReturnType<typeof useMutation<typeof api.imports.commit>>;
  discardBatch: ReturnType<
    typeof useMutation<typeof api.imports.discard>
  >;
}) {
  const batch = useQuery(api.imports.getBatch, { batchId: props.batchId });
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && props.onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif">Review import batch</DialogTitle>
          <DialogDescription>
            {batch
              ? `${batch.fileName} — ${batch.validRows} of ${batch.totalRows} row(s) will be applied. Nothing is written until you choose Apply.`
              : "Retrieving batch…"}
          </DialogDescription>
        </DialogHeader>
        {batch && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{batch.totalRows} rows in</Badge>
              <Badge variant="outline">{batch.validRows} valid</Badge>
              <Badge variant="outline">
                {batch.duplicateCount ?? 0} duplicates
              </Badge>
              {batch.errorCount > 0 && (
                <Badge variant="destructive">
                  {batch.errorCount} row issue(s)
                </Badge>
              )}
            </div>

            {batch.errors.length > 0 && (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-red-200 bg-red-50/50 p-3">
                <p className="text-xs font-medium text-red-900">
                  Error report
                </p>
                {batch.errors.map((e, i) => (
                  <p key={i} className="text-xs text-red-800">
                    Row {e.row}: {e.message}
                  </p>
                ))}
              </div>
            )}

            <div className="max-h-48 overflow-y-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/60 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Record</th>
                  </tr>
                </thead>
                <tbody>
                  {(batch.rows as StagedRow[]).slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-t border-border/60">
                      <td className="px-3 py-1.5 capitalize text-muted-foreground">
                        {r.kind}
                      </td>
                      <td className="px-3 py-1.5">
                        {r.fields.name ||
                          r.fields.reference ||
                          r.fields.title ||
                          r.fields.summary ||
                          r.matterRef ||
                          "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await props.discardBatch({ batchId: props.batchId });
                    toast.success("Batch discarded — nothing was written.");
                    props.onClose();
                  } catch (err) {
                    toast.error(
                      err instanceof Error ? err.message : "Failed.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Discard
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await props.commitBatch({
                      batchId: props.batchId,
                    });
                    toast.success(
                      `Applied — ${r.created} record(s) created.`,
                    );
                    props.onClose();
                  } catch (err) {
                    toast.error(
                      err instanceof Error ? err.message : "Could not apply.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Apply batch
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------
// Backups & restore tests (section 28)
// ---------------------------------------------------------------

export function BackupCard() {
  const caps = useQuery(api.workspace.myCapabilities);
  const records = useQuery(api.backups.listRecords);
  const runArchiveExport = useAction(api.backups.archiveExport);
  const recordRestore = useMutation(api.backups.recordRestoreTest);

  const isOwnerAdmin =
    caps !== undefined &&
    (caps.orgRole === "owner" || caps.orgRole === "administrator");

  const [busy, setBusy] = useState(false);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [showTest, setShowTest] = useState(false);
  const [label, setLabel] = useState("");
  const [environment, setEnvironment] = useState("");
  const [result, setResult] = useState<"passed" | "failed" | "partial">(
    "passed",
  );
  const [procedureNote, setProcedureNote] = useState("");
  const [retentionNote, setRetentionNote] = useState("");

  return (
    <Card className="rule-frame bg-card">
      <CardHeader>
        <CardTitle className="font-serif text-2xl">
          Backups &amp; restore
        </CardTitle>
        <CardDescription>
          The platform runs scheduled backups of both the database and file
          storage. Here you can also take a portable archive of your
          chamber's records and keep an honest register of restore tests
          performed in a non-production environment.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="max-w-xl">
            <p className="text-sm font-medium">Archive export</p>
            <p className="text-xs text-muted-foreground">
              A JSON archive of your chamber's database records (clients,
              matters, hearings, orders, tasks, invoices, documents,
              chronology). Document files themselves stay in object storage,
              which is covered by the platform's own backup schedule. Every
              export is dated and recorded.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || caps === undefined || !isOwnerAdmin}
            onClick={async () => {
              setBusy(true);
              try {
                const res = await runArchiveExport({});
                setExportUrl(res.url ?? null);
                toast.success(
                  `Archive created — ${res.counts.matters} matters, ${res.counts.documents} documents.`,
                );
              } catch (err) {
                toast.error(
                  err instanceof Error ? err.message : "Export failed.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Preparing…" : "Export archive"}
          </Button>
        </div>
        {exportUrl && (
          <a
            href={exportUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-sm text-[#8a6a33] underline underline-offset-4"
          >
            <Download className="size-4" aria-hidden="true" />
            Download the most recent archive
          </a>
        )}
        {!isOwnerAdmin && caps !== undefined && (
          <p className="text-xs text-muted-foreground">
            Archive export and restore-test entries are made by owners and
            administrators.
          </p>
        )}

        <hr className="engraving-rule" />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="max-w-xl">
            <p className="text-sm font-medium">Restore-test register</p>
            <p className="text-xs text-muted-foreground">
              A row appears here only after a real restore has been executed
              in a non-production environment. Nothing is marked verified
              automatically, and no destructive reset is ever used as a
              substitute for a tested restore.
            </p>
          </div>
          {isOwnerAdmin && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowTest((s) => !s)}
            >
              {showTest ? "Close form" : "Record a restore test"}
            </Button>
          )}
        </div>

        {showTest && isOwnerAdmin && (
          <div className="space-y-3 rounded-md border border-[#B68A45]/40 bg-[#B68A45]/[0.04] p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="rt-label">Test label</Label>
                <Input
                  id="rt-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. September quarter restore drill"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rt-env">Non-production environment</Label>
                <Input
                  id="rt-env"
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value)}
                  placeholder="e.g. staging — restored from 23 Sep snapshot"
                />
              </div>
              <div className="space-y-2">
                <Label>Result</Label>
                <Select
                  value={result}
                  onValueChange={(v) => setResult(v as typeof result)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="passed">Passed</SelectItem>
                    <SelectItem value="partial">Partial</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="rt-ret">
                  Retention policy note (optional)
                </Label>
                <Input
                  id="rt-ret"
                  value={retentionNote}
                  onChange={(e) => setRetentionNote(e.target.value)}
                  placeholder="e.g. daily snapshots kept 30 days"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="rt-note">Procedure note (optional)</Label>
                <Textarea
                  id="rt-note"
                  rows={2}
                  value={procedureNote}
                  onChange={(e) => setProcedureNote(e.target.value)}
                  placeholder="What was restored, how it was checked, and who witnessed it."
                />
              </div>
            </div>
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await recordRestore({
                    label,
                    environment,
                    result,
                    procedureNote: procedureNote || undefined,
                    retentionNote: retentionNote || undefined,
                  });
                  toast.success("Restore test recorded.");
                  setLabel("");
                  setEnvironment("");
                  setProcedureNote("");
                  setRetentionNote("");
                  setShowTest(false);
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : "Could not record.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save entry
            </Button>
          </div>
        )}

        <div className="space-y-2">
          {records === undefined ? (
            <p className="text-sm text-muted-foreground">Retrieving…</p>
          ) : records.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No archive exports or restore tests recorded yet.
            </p>
          ) : (
            records.map((r) => (
              <div
                key={r._id}
                className="rounded-md border border-border px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={r.kind === "archive_export" ? "secondary" : "outline"}
                  >
                    {r.kind === "archive_export" ? "Archive export" : "Restore test"}
                  </Badge>
                  <span className="text-sm font-medium">{r.label}</span>
                  {r.result && (
                    <Badge
                      variant={
                        r.result === "passed"
                          ? "secondary"
                          : r.result === "failed"
                            ? "destructive"
                            : "outline"
                      }
                    >
                      {r.result}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(r.performedAt).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                  })}
                  {r.environment ? ` · ${r.environment}` : ""}
                  {r.counts
                    ? ` · ${r.counts.clients} clients, ${r.counts.matters} matters, ${r.counts.documents} documents`
                    : ""}
                </p>
                {r.procedureNote && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {r.procedureNote}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
