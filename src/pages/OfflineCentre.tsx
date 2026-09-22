import { useCallback, useEffect, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { Link } from "react-router";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ChamberShell } from "@/components/ChamberShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { formatDateIN, formatDateTimeIN } from "@/lib/format";
import {
  printOfflinePack,
} from "@/lib/offlinePackPrint";
import {
  clearQueuedNote,
  deviceLabel as detectDeviceLabel,
  enqueueNote,
  getDeviceId,
  isProbablyOnline,
  listBundles,
  listQueuedNotes,
  removeBundle,
  saveBundle,
  type OfflineBundleRecord,
  type OfflinePayload,
  type QueuedNote,
} from "@/lib/offlineStore";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  CloudOff,
  FileDown,
  Gavel,
  HardDriveDownload,
  HardDriveUpload,
  Info,
  Loader2,
  Printer,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Undo2,
} from "lucide-react";

// =====================================================================
// Offline court mode — the member-facing UI for section 27.
//
// Everything here is explicit and opt-in. The page shows exactly what is
// on this device, when it was last synced, when it expires, and how to
// remove it. Honest limits are repeated in the interface: revocation is
// not instant on a disconnected device, and a shared computer exposes
// this copy to other users of the same OS account.
// =====================================================================

const SECTIONS = [
  { id: "orders", label: "Previous orders" },
  { id: "chronology", label: "Chronology" },
] as const;

const BUNDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type ServerBundle = {
  _id: string;
  matterId: string;
  matterLabel: string;
  deviceLabel: string;
  preparedAt: number;
  syncedAt: number;
  expiresAt: number;
  revokedAt: number | null;
  removedAt: number | null;
  selection: {
    includeNotes: boolean;
    documentCount: number;
    sectionCount: number;
  };
  queuedNotes: {
    id: string;
    body: string;
    queuedAt: number;
    status: string;
    conflictReason: string | null;
  }[];
};

type PrepareContext = {
  matter: { _id: string; reference: string; title: string; court: string | null };
  clientName: string;
  documents: { _id: string; name: string; visibility: string; hasFile: boolean }[];
  hearings: { _id: string; title: string; at: number }[];
  noteCount: number;
  permissions: { viewInternal: boolean };
  limits: { maxDocuments: number; maxEvents: number; ttlDays: number };
  existingBundle: {
    _id: string;
    preparedAt: number;
    syncedAt: number;
    fingerprint: string;
    revokedAt: number | null;
    deviceLabel: string;
  } | null;
};

/** Device-side bundle store, loaded outside the reactive Convex layer. */
function useDeviceBundles(userId: string | undefined) {
  const [bundles, setBundles] = useState<OfflineBundleRecord[] | undefined>(
    undefined,
  );
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let alive = true;
    if (!userId) {
      setBundles(undefined);
      return;
    }
    listBundles(userId)
      .then((rows) => {
        if (alive) setBundles(rows);
      })
      .catch(() => {
        if (alive) setBundles([]);
      });
    return () => {
      alive = false;
    };
  }, [userId, tick]);
  return { bundles, refresh };
}

function useQueuedNotes() {
  const [notes, setNotes] = useState<QueuedNote[] | undefined>(undefined);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let alive = true;
    listQueuedNotes()
      .then((rows) => {
        if (alive) setNotes(rows);
      })
      .catch(() => {
        if (alive) setNotes([]);
      });
    return () => {
      alive = false;
    };
  }, [tick]);
  return { notes, refresh };
}

export default function OfflineCentre() {
  const { user } = useAuth();
  const userId = user?._id;
  const online = isProbablyOnline();
  const [tab, setTab] = useState<string>("device");
  const [prepareOpen, setPrepareOpen] = useState(false);

  const matters = useQuery(api.matters.list) as
    | { _id: string; reference: string; title: string }[]
    | undefined;
  const serverBundles = useQuery(api.offline.myBundles) as
    | ServerBundle[]
    | undefined;
  const { bundles: deviceBundles, refresh: refreshDevice } =
    useDeviceBundles(userId);
  const { notes: queued, refresh: refreshQueue } = useQueuedNotes();

  const live = (serverBundles ?? []).filter((b) => !b.removedAt);
  const deviceFor = (bundleId: string) =>
    (deviceBundles ?? []).find((d) => d.bundleId === bundleId) ?? null;

  return (
    <ChamberShell
      subtitle="The Digital Chamber"
      title="Offline court mode"
      actions={
        <Badge variant="outline" className="gap-1.5">
          {online ? (
            <>
              <RefreshCw className="size-3.5 text-[#B68A45]" aria-hidden="true" />
              Online
            </>
          ) : (
            <>
              <CloudOff className="size-3.5 text-destructive" aria-hidden="true" />
              Offline
            </>
          )}
        </Badge>
      }
    >
      <div className="space-y-6">
        <Alert className="border-[#E5E7EB] bg-[#F7F5EF]">
          <Info className="size-4 text-[#B68A45]" />
          <AlertTitle className="font-serif">Explicit opt-in preparation</AlertTitle>
          <AlertDescription className="text-muted-foreground">
            Offline mode downloads a <strong>limited hearing pack</strong> for
            ONE matter to this browser — never the whole firm database. Packs
            expire in 7 days and the page always shows what is stored. Two
            honest limits: chamber revocation takes effect only at the next
            sync, not instantly on a disconnected device, and a shared
            computer exposes this copy to other users of the same OS account.
          </AlertDescription>
        </Alert>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="device">On this device</TabsTrigger>
            <TabsTrigger value="notes">Offline notes</TabsTrigger>
            <TabsTrigger value="review">
              Review queue
              {serverBundles && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  (
                  {serverBundles
                    .filter((b) => !b.removedAt)
                    .flatMap((b) => b.queuedNotes)
                    .filter((n) => n.status === "pending" || n.status === "conflict")
                    .length}
                  )
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="device" className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Device: {detectDeviceLabel()} · id {getDeviceId().slice(0, 12)}…
              </p>
              <Button
                onClick={() => setPrepareOpen(true)}
                disabled={!online || matters === undefined}
                title={
                  online
                    ? undefined
                    : "Reconnect to prepare a new pack — preparation needs the chamber server."
                }
              >
                <HardDriveDownload className="mr-2 size-4" />
                Prepare offline pack
              </Button>
            </div>
            {!serverBundles || !deviceBundles ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-24 w-full" />
                ))}
              </div>
            ) : live.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  Nothing is stored on this device. Prepare a pack before
                  heading to a court with poor connectivity.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {live.map((b) => (
                  <BundleCard
                    key={b._id}
                    bundle={b}
                    deviceRecord={deviceFor(b._id)}
                    onChanged={() => {
                      refreshDevice();
                      refreshQueue();
                    }}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="notes" className="mt-4">
            <OfflineNotesTab
              deviceBundles={deviceBundles ?? []}
              queued={queued ?? []}
              onQueued={refreshQueue}
            />
          </TabsContent>

          <TabsContent value="review" className="mt-4">
            <ReviewQueueTab serverBundles={serverBundles} />
          </TabsContent>
        </Tabs>
      </div>

      <PrepareDialog
        open={prepareOpen}
        onOpenChange={setPrepareOpen}
        matters={matters ?? []}
        onPrepared={() => {
          setPrepareOpen(false);
          setTab("device");
          refreshDevice();
        }}
      />
    </ChamberShell>
  );
}

// ---------------------------------------------------------------------
// One prepared pack
// ---------------------------------------------------------------------

function BundleCard({
  bundle,
  deviceRecord,
  onChanged,
}: {
  bundle: ServerBundle;
  deviceRecord: OfflineBundleRecord | null;
  onChanged: () => void;
}) {
  const convex = useConvex();
  const removeRow = useMutation(api.offline.remove);
  const revoke = useMutation(api.offline.revoke);
  const sync = useMutation(api.offline.sync);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const online = isProbablyOnline();

  const expired = Date.now() > bundle.expiresAt;
  const days = Math.max(
    0,
    Math.ceil((bundle.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)),
  );
  const pendingNotes = bundle.queuedNotes.filter(
    (n) => n.status === "pending" || n.status === "conflict",
  );
  const hasConflict = bundle.queuedNotes.some((n) => n.status === "conflict");

  const doSync = async () => {
    setBusy("sync");
    try {
      // Report the device copy's fingerprint so the server can detect
      // drift, and hand over the notes queued locally while offline.
      const queuedAll = await listQueuedNotes();
      const mine = queuedAll.filter((q) => q.bundleId === bundle._id);
      const res = await sync({
        bundleId: bundle._id as Id<"offlineBundles">,
        deviceFingerprint: deviceRecord?.fingerprint ?? "missing",
        queuedNotes: mine.map((q) => ({
          id: q.id,
          body: q.body,
          queuedAt: q.queuedAt,
          baseSyncedAt: q.baseSyncedAt,
        })),
      });
      for (const q of mine) {
        await clearQueuedNote(q.id).catch(() => undefined);
      }
      refreshQueue();
      if (res.conflicts.length > 0) {
        toast.warning("Synced with conflicts", {
          description: res.conflicts.join(" "),
        });
      } else {
        toast.success("Synced — pack verified against the chamber file.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setBusy(null);
      onChanged();
    }
  };

  const doRefreshCopy = async () => {
    setBusy("refresh");
    try {
      const payload = (await convex.query(api.offline.payloadFor, {
        bundleId: bundle._id as Id<"offlineBundles">,
      })) as OfflinePayload | null;
      if (!payload) {
        toast.error("This pack is no longer available to you.");
        return;
      }
      if (!deviceRecord) {
        toast.error("Local copy not found on this device.");
        return;
      }
      await saveBundle({ ...deviceRecord, payload, syncedAt: Date.now() });
      toast.success("Local copy refreshed from the chamber.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refresh failed.");
    } finally {
      setBusy(null);
      onChanged();
    }
  };

  const doRemove = async () => {
    setBusy("remove");
    try {
      if (deviceRecord) await removeBundle(deviceRecord.bundleId);
      await removeRow({ bundleId: bundle._id as Id<"offlineBundles"> });
      toast.success("Removed from this device.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Removal failed.");
    } finally {
      setBusy(null);
      setConfirmRemove(false);
      onChanged();
    }
  };

  const doRevoke = async () => {
    setBusy("revoke");
    try {
      await revoke({ bundleId: bundle._id as Id<"offlineBundles"> });
      toast.info(
        "Marked revoked. A disconnected device keeps its copy until it next syncs — that limit is honest and cannot be bypassed.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not revoke.");
    } finally {
      setBusy(null);
    }
  };

  const viewOffline = () => {
    if (!deviceRecord) {
      toast.error("No local copy found on this device.");
      return;
    }
    printOfflinePack(deviceRecord.payload);
  };

  return (
    <Card className={bundle.revokedAt ? "border-destructive/60" : undefined}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="font-serif text-base">
              <Link to={`/matters/${bundle.matterId}`} className="hover:underline">
                {bundle.matterLabel}
              </Link>
            </CardTitle>
            <CardDescription>
              {bundle.deviceLabel} · prepared {formatDateTimeIN(bundle.preparedAt)}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {bundle.revokedAt ? (
              <Badge variant="destructive" className="gap-1">
                <ShieldAlert className="size-3" /> Revoked — remove local copy
              </Badge>
            ) : expired ? (
              <Badge variant="destructive" className="gap-1">
                <Clock className="size-3" /> Expired — re-prepare
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1">
                <Clock className="size-3 text-[#B68A45]" /> Expires in {days} day
                {days === 1 ? "" : "s"}
              </Badge>
            )}
            {!deviceRecord && (
              <Badge variant="outline" className="gap-1">
                <HardDriveUpload className="size-3" /> Not on this device
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
          <span>
            Last synced:{" "}
            <span className="text-foreground">
              {formatDateTimeIN(bundle.syncedAt)}
            </span>
          </span>
          <span>
            Selection:{" "}
            <span className="text-foreground">
              {bundle.selection.sectionCount} sections ·{" "}
              {bundle.selection.documentCount} documents
              {bundle.selection.includeNotes ? " · notes included" : ""}
            </span>
          </span>
          <span>
            Queued notes:{" "}
            <span className="text-foreground">{pendingNotes.length}</span>
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={viewOffline}>
            <Printer className="mr-2 size-3.5" /> View / print pack
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!online || busy !== null || bundle.revokedAt !== null || expired}
            onClick={() => void doSync()}
            title={
              expired
                ? "Expired packs cannot sync — prepare a fresh one."
                : undefined
            }
          >
            {busy === "sync" ? (
              <Loader2 className="mr-2 size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 size-3.5" />
            )}
            Sync now
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!online || busy !== null || bundle.revokedAt !== null || expired}
            onClick={() => void doRefreshCopy()}
          >
            {busy === "refresh" ? (
              <Loader2 className="mr-2 size-3.5 animate-spin" />
            ) : (
              <FileDown className="mr-2 size-3.5" />
            )}
            Refresh local copy
          </Button>
          {!bundle.revokedAt && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() => void doRevoke()}
            >
              <ShieldAlert className="mr-2 size-3.5" /> Revoke
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={busy !== null}
            onClick={() => setConfirmRemove(true)}
          >
            <Trash2 className="mr-2 size-3.5" /> Remove from device
          </Button>
        </div>

        {hasConflict && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertTitle>Queued notes in conflict</AlertTitle>
            <AlertDescription>
              Some notes typed offline overlap with chamber activity. Review
              them in the “Review queue” tab before applying.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>

      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif">Remove from device?</DialogTitle>
            <DialogDescription>
              The local copy of “{bundle.matterLabel}” will be deleted from this
              browser. The chamber record of this pack stays for audit until it
              naturally expires.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemove(false)}>
              Keep it
            </Button>
            <Button variant="destructive" onClick={() => void doRemove()}>
              {busy === "remove" ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 size-4" />
              )}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------------------------------------------------------------------
// Prepare dialog — limited selection, explicit scope
// ---------------------------------------------------------------------

function PrepareDialog({
  open,
  onOpenChange,
  matters,
  onPrepared,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matters: { _id: string; reference: string; title: string }[];
  onPrepared: () => void;
}) {
  const prepare = useMutation(api.offline.prepare);
  const [matterId, setMatterId] = useState<string>("");
  const [hearingId, setHearingId] = useState<string>("");
  const [sectionIds, setSectionIds] = useState<string[]>(
    SECTIONS.map((s) => s.id),
  );
  const [includeNotes, setIncludeNotes] = useState(true);
  const [documentIds, setDocumentIds] = useState<Id<"matterDocuments">[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);

  const ctx = useQuery(
    api.offline.prepareContext,
    open && matterId ? { matterId: matterId as Id<"matters"> } : "skip",
  ) as PrepareContext | undefined;

  useEffect(() => {
    setHearingId("");
    setDocumentIds([]);
    setAcknowledged(false);
  }, [matterId]);

  const toggleSection = (id: string) =>
    setSectionIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  const toggleDocument = (id: Id<"matterDocuments">) =>
    setDocumentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const maxDocs = ctx?.limits.maxDocuments ?? 12;
  const canPrepare =
    acknowledged &&
    documentIds.length <= maxDocs &&
    (sectionIds.length > 0 || includeNotes);

  const doPrepare = async () => {
    if (!matterId || !ctx) return;
    setBusy(true);
    try {
      const res = await prepare({
        matterId: matterId as Id<"matters">,
        hearingId: hearingId ? (hearingId as Id<"hearings">) : undefined,
        sectionIds,
        includeNotes,
        documentIds,
        deviceLabel: detectDeviceLabel(),
      });
      const record: OfflineBundleRecord = {
        bundleId: res.bundleId,
        userId: getDeviceId(), // scoped per browser profile
        matterId,
        matterLabel: `${ctx.matter.reference} — ${ctx.matter.title}`,
        orgName: res.payload.org?.name ?? "",
        deviceLabel: detectDeviceLabel(),
        fingerprint: res.fingerprint,
        preparedAt: res.preparedAt,
        syncedAt: res.preparedAt,
        expiresAt: res.expiresAt,
        payload: res.payload,
      };
      await saveBundle(record);
      toast.success("Offline pack saved to this device.", {
        description: `Expires ${formatDateIN(res.expiresAt)}.`,
      });
      onPrepared();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not prepare the pack.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            Prepare offline pack
          </DialogTitle>
          <DialogDescription>
            One matter, one hearing, a capped selection. What you choose here
            is exactly what lands on this device — nothing else is cached.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="off-matter">Matter</Label>
            <Select value={matterId} onValueChange={setMatterId}>
              <SelectTrigger id="off-matter">
                <SelectValue placeholder="Choose a matter" />
              </SelectTrigger>
              <SelectContent>
                {matters.map((m) => (
                  <SelectItem key={m._id} value={m._id}>
                    {m.reference} — {m.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {matterId && !ctx ? (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" /> Preparing
              options…
            </div>
          ) : null}

          {ctx && (
            <>
              <div className="space-y-2">
                <Label htmlFor="off-hearing">Hearing (optional)</Label>
                <Select value={hearingId} onValueChange={setHearingId}>
                  <SelectTrigger id="off-hearing">
                    <SelectValue placeholder="No specific hearing" />
                  </SelectTrigger>
                  <SelectContent>
                    {ctx.hearings.map((h) => (
                      <SelectItem key={h._id} value={h._id}>
                        {h.title} — {formatDateIN(h.at)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Sections</Label>
                <div className="rounded-md border">
                  {SECTIONS.map((s) => (
                    <label
                      key={s.id}
                      className="flex items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted/60"
                    >
                      <Checkbox
                        checked={sectionIds.includes(s.id)}
                        onCheckedChange={() => toggleSection(s.id)}
                      />
                      {s.label}
                    </label>
                  ))}
                  <label className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/60">
                    <Checkbox
                      checked={includeNotes}
                      onCheckedChange={(v) => setIncludeNotes(v === true)}
                    />
                    Matter notes (latest 60, capped)
                  </label>
                </div>
              </div>

              <div className="space-y-2">
                <Label>
                  Documents ({documentIds.length}/{maxDocs})
                </Label>
                {ctx.documents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No documents visible to you on this matter.
                  </p>
                ) : (
                  <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border p-2">
                    {ctx.documents.map((d) => (
                      <label
                        key={d._id}
                        className="flex items-start gap-2 rounded px-1 py-1 text-sm hover:bg-muted/60"
                      >
                        <Checkbox
                          checked={documentIds.includes(d._id as Id<"matterDocuments">)}
                          onCheckedChange={() =>
                            toggleDocument(d._id as Id<"matterDocuments">)
                          }
                          className="mt-0.5"
                        />
                        <span>
                          {d.name}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {d.visibility === "internal"
                              ? "internal"
                              : "shared with client"}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {ctx.existingBundle && (
                <p className="rounded-md border border-[#E5E7EB] bg-[#F7F5EF] px-3 py-2 text-xs text-muted-foreground">
                  A pack for this matter was already prepared{" "}
                  {formatDateTimeIN(ctx.existingBundle.preparedAt)} on{" "}
                  {ctx.existingBundle.deviceLabel}. Preparing again replaces it.
                </p>
              )}

              <Separator />

              <div className="space-y-2 rounded-md border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">
                  What will be stored on this device
                </p>
                <p>
                  Hearing details, orders, chronology, the notes and documents
                  you ticked, and party names — for this one matter only.
                  Stored in this browser’s IndexedDB; expiry{" "}
                  {ctx.limits.ttlDays} days; removable any time from this page.
                </p>
                <label className="mt-2 flex items-start gap-2 text-foreground">
                  <Checkbox
                    checked={acknowledged}
                    onCheckedChange={(v) => setAcknowledged(v === true)}
                    className="mt-0.5"
                  />
                  <span className="text-xs">
                    I understand: this copy can be read by other users of the
                    same OS account on a shared computer, and chamber
                    revocation reaches this device only when it next syncs.
                  </span>
                </label>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!matterId || !ctx || !canPrepare || busy}
            onClick={() => void doPrepare()}
          >
            {busy ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <HardDriveDownload className="mr-2 size-4" />
            )}
            Prepare &amp; save to device
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// Offline notes tab — permitted note updates typed on the device
// ---------------------------------------------------------------------

function OfflineNotesTab({
  deviceBundles,
  queued,
  onQueued,
}: {
  deviceBundles: OfflineBundleRecord[];
  queued: QueuedNote[];
  onQueued: () => void;
}) {
  const [bundleId, setBundleId] = useState<string>("");
  const [body, setBody] = useState("");
  const online = isProbablyOnline();

  const target =
    deviceBundles.find((b) => b.bundleId === bundleId) ?? deviceBundles[0];

  const queue = async () => {
    if (!target || !body.trim()) return;
    await enqueueNote({
      id: `qn_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      bundleId: target.bundleId,
      body: body.trim(),
      queuedAt: Date.now(),
      baseSyncedAt: target.syncedAt,
    });
    setBody("");
    onQueued();
    toast.success(
      online
        ? "Note queued — it will be applied after your next sync, once reviewed."
        : "Note saved on this device. It will be applied when you next reconnect.",
    );
  };

  if (deviceBundles.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Prepare an offline pack first — notes typed here are stored on the
          device and applied to the matter only after you reconnect and a
          person reviews them.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-serif text-base">Queue a note</CardTitle>
        <CardDescription>
          Permitted updates only: a short factual note for the matter file.
          Nothing reaches the record without review after sync.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="off-note-pack">Pack</Label>
          <Select value={target?.bundleId ?? ""} onValueChange={setBundleId}>
            <SelectTrigger id="off-note-pack">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {deviceBundles.map((b) => (
                <SelectItem key={b.bundleId} value={b.bundleId}>
                  {b.payload.matter.reference} — {b.payload.matter.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="off-note-body">Note (max 4,000 chars)</Label>
          <Textarea
            id="off-note-body"
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 4000))}
            rows={5}
            placeholder="Outcome as recorded in court today, documents handed over, next date announced…"
          />
          <p className="text-right text-xs text-muted-foreground">
            {body.length}/4000
          </p>
        </div>
        <div className="flex justify-end">
          <Button disabled={!body.trim()} onClick={() => void queue()}>
            <HardDriveUpload className="mr-2 size-4" />
            {online ? "Queue for next sync" : "Save on device"}
          </Button>
        </div>
        {queued.length > 0 && (
          <div className="space-y-2 pt-2">
            <Separator />
            <p className="text-sm font-medium">
              Queued on this device ({queued.length})
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Note</TableHead>
                  <TableHead className="w-40">Queued</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {queued.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="max-w-md whitespace-pre-wrap text-sm">
                      {q.body}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDateTimeIN(q.queuedAt)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={async () => {
                          await clearQueuedNote(q.id).catch(() => undefined);
                          onQueued();
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------
// Review queue — a human decision on every queued note after sync
// ---------------------------------------------------------------------

function ReviewQueueTab({
  serverBundles,
}: {
  serverBundles: ServerBundle[] | undefined;
}) {
  const resolve = useMutation(api.offline.resolveNote);
  const [busyId, setBusyId] = useState<string | null>(null);

  const pending = (serverBundles ?? [])
    .filter((b) => !b.removedAt)
    .flatMap((b) =>
      b.queuedNotes
        .filter((n) => n.status === "pending" || n.status === "conflict")
        .map((n) => ({ bundle: b, note: n })),
    );

  const act = async (
    bundleId: string,
    noteId: string,
    action: "apply" | "drop",
  ) => {
    setBusyId(noteId);
    try {
      await resolve({
        bundleId: bundleId as Id<"offlineBundles">,
        noteId,
        action,
      });
      toast.success(
        action === "apply" ? "Note applied to the matter." : "Note dropped.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resolve note.");
    } finally {
      setBusyId(null);
    }
  };

  if (!serverBundles) {
    return <Skeleton className="h-40 w-full" />;
  }

  if (pending.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          <CheckCircle2 className="mx-auto mb-2 size-5 text-[#B68A45]" />
          Nothing awaiting review. Notes queued offline appear here after a
          sync, and each one needs an explicit human decision.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Alert className="border-[#E5E7EB] bg-[#F7F5EF]">
        <Gavel className="size-4 text-[#B68A45]" />
        <AlertTitle className="font-serif">Reviewable by design</AlertTitle>
        <AlertDescription className="text-muted-foreground">
          Offline notes never touch the matter file by themselves. Each one is
          applied or dropped by a person, and the decision is kept in the
          pack’s trail.
        </AlertDescription>
      </Alert>
      {pending.map(({ bundle, note }) => (
        <Card key={note.id}>
          <CardContent className="space-y-2 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{bundle.matterLabel}</p>
              <Badge
                variant={note.status === "conflict" ? "destructive" : "outline"}
                className="gap-1"
              >
                {note.status === "conflict" ? (
                  <>
                    <AlertTriangle className="size-3" /> Conflict
                  </>
                ) : (
                  <>
                    <Clock className="size-3" /> Pending
                  </>
                )}
              </Badge>
            </div>
            {note.conflictReason && (
              <p className="text-xs text-destructive">{note.conflictReason}</p>
            )}
            <p className="whitespace-pre-wrap rounded-md border bg-muted/40 px-3 py-2 text-sm">
              {note.body}
            </p>
            <p className="text-xs text-muted-foreground">
              Typed offline {formatDateTimeIN(note.queuedAt)}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busyId !== null}
                onClick={() => void act(bundle._id, note.id, "drop")}
              >
                <Undo2 className="mr-2 size-3.5" /> Drop
              </Button>
              <Button
                size="sm"
                disabled={busyId !== null}
                onClick={() => void act(bundle._id, note.id, "apply")}
              >
                {busyId === note.id ? (
                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 size-3.5" />
                )}
                Apply to matter
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
