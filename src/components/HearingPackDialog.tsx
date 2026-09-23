import { useConvex, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Switch } from "@/components/ui/switch";
import { buildHearingPackPdf, hearingPackFileName } from "@/lib/hearingPackPdf";
import type { HearingPackPdfData } from "@/lib/hearingPackPdf";
import { formatDateIN } from "@/lib/format";
import {
  ArrowDown,
  ArrowUp,
  Download,
  FileText,
  Loader2,
  ShieldCheck,
} from "lucide-react";

const SECTION_TITLES: Record<string, string> = {
  hearing: "Hearing details",
  summary: "Case summary & parties",
  chronology: "Chronology",
  orders: "Previous orders",
  documents: "Documents index",
  prep: "Preparation notes",
  tasks: "Open tasks",
};

const DEFAULT_SECTIONS = [
  "hearing",
  "summary",
  "chronology",
  "orders",
  "documents",
  "tasks",
];

type ContextData = NonNullable<ReturnType<typeof useQuery<typeof api.hearingPacks.context>>>;

export function HearingPackDialog({
  matterId,
  open,
  onOpenChange,
  preselectHearingId,
}: {
  matterId: Id<"matters">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When the caller opens the pack for a specific upcoming hearing
   *  (e.g. straight after recording the outcome), preselect it. */
  preselectHearingId?: Id<"hearings"> | null;
}) {
  const data = useQuery(
    api.hearingPacks.context,
    open ? { matterId } : "skip",
  ) as ContextData | undefined;

  const convex = useConvex();
  const generate = useMutation(api.hearingPacks.generate);
  const recordDownload = useMutation(api.hearingPacks.recordDownload);

  const [hearingId, setHearingId] = useState<string>(preselectHearingId ?? "");
  const [sections, setSections] = useState<string[]>(DEFAULT_SECTIONS);
  const [orderIds, setOrderIds] = useState<Id<"orders">[]>([]);
  const [documentIds, setDocumentIds] = useState<Id<"matterDocuments">[]>([]);
  const [includeInternal, setIncludeInternal] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const canGenerate = data?.permissions.canGenerate ?? false;
  const viewInternal = data?.permissions.viewInternal ?? false;

  const toggleOrder = (id: Id<"orders">) =>
    setOrderIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  const toggleDocument = (id: Id<"matterDocuments">) =>
    setDocumentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const moveSection = (index: number, dir: -1 | 1) => {
    setSections((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const downloadPack = async (packId: Id<"hearingPacks">) => {
    setBusy(packId);
    try {
      // packData re-checks access and rebuilds live content server-side —
      // a stale selection can never resurrect material the caller can no
      // longer see.
      const pack = await convex.query(api.hearingPacks.packData, { packId });
      if (!pack) {
        toast.error("This pack is no longer available to you.");
        return;
      }
      const typed = pack as unknown as HearingPackPdfData;
      const doc = buildHearingPackPdf(typed);
      doc.save(hearingPackFileName(typed));
      await recordDownload({ packId });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not download the pack.",
      );
    } finally {
      setBusy(null);
    }
  };

  const generatePack = async () => {
    if (!data) return;
    setBusy("generate");
    try {
      const res = await generate({
        matterId,
        hearingId: hearingId ? (hearingId as Id<"hearings">) : undefined,
        sectionIds: sections,
        orderIds,
        documentIds,
        includeInternal: includeInternal && viewInternal,
      });
      toast.success(`Hearing pack ${res.label} generated.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate the pack.");
    } finally {
      setBusy(null);
    }
  };

  const disabled = !data || !canGenerate;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">Build hearing pack</DialogTitle>
          <DialogDescription>
            A versioned PDF bundle for court: cover, selected sections, chronology,
            orders, document index and open tasks — with bookmarks and pagination.
          </DialogDescription>
        </DialogHeader>

        {!data ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Preparing options…
          </div>
        ) : !canGenerate ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Your role does not permit generating hearing packs.
          </p>
        ) : (
          <div className="space-y-5">
            {/* Hearing selector */}
            <div className="space-y-2">
              <Label htmlFor="pack-hearing">Attach a hearing (optional)</Label>
              <Select value={hearingId} onValueChange={setHearingId}>
                <SelectTrigger id="pack-hearing">
                  <SelectValue placeholder="No specific hearing" />
                </SelectTrigger>
                <SelectContent>
                  {data.hearings.map((h) => (
                    <SelectItem key={h._id} value={h._id}>
                      {h.title} — {formatDateIN(h.at)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Sections, reorderable */}
            <div className="space-y-2">
              <Label>Sections (in pack order)</Label>
              <div className="rounded-md border">
                {sections.map((s, i) => (
                  <div
                    key={s}
                    className="flex items-center justify-between border-b px-3 py-2 last:border-b-0"
                  >
                    <span className="text-sm">
                      {i + 1}. {SECTION_TITLES[s] ?? s}
                    </span>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => moveSection(i, -1)}
                        disabled={i === 0}
                        aria-label={`Move ${SECTION_TITLES[s]} up`}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => moveSection(i, 1)}
                        disabled={i === sections.length - 1}
                        aria-label={`Move ${SECTION_TITLES[s]} down`}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Orders */}
            <div className="space-y-2">
              <Label>Previous orders ({orderIds.length} selected)</Label>
              {data.orders.length === 0 ? (
                <p className="text-sm text-muted-foreground">No orders on this matter yet.</p>
              ) : (
                <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border p-2">
                  {data.orders.map((o) => (
                    <label
                      key={o._id}
                      className="flex items-start gap-2 rounded px-1 py-1 text-sm hover:bg-muted/60"
                    >
                      <Checkbox
                        checked={orderIds.includes(o._id)}
                        onCheckedChange={() => toggleOrder(o._id)}
                        className="mt-0.5"
                      />
                      <span>
                        {o.title}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {formatDateIN(o.passedOn)}
                          {o.reviewed ? " · reviewed" : " · unreviewed"}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Documents */}
            <div className="space-y-2">
              <Label>Documents index ({documentIds.length} selected)</Label>
              {data.documents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No documents visible to you on this matter.</p>
              ) : (
                <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border p-2">
                  {data.documents.map((d) => (
                    <label
                      key={d._id}
                      className="flex items-start gap-2 rounded px-1 py-1 text-sm hover:bg-muted/60"
                    >
                      <Checkbox
                        checked={documentIds.includes(d._id)}
                        onCheckedChange={() => toggleDocument(d._id)}
                        className="mt-0.5"
                      />
                      <span>
                        {d.name}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {d.visibility === "internal" ? "internal" : "shared with client"}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Client-safe toggle */}
            <div className="flex items-start justify-between rounded-md border bg-muted/40 px-4 py-3">
              <div className="space-y-1">
                <Label htmlFor="pack-internal" className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" /> Internal material
                </Label>
                <p className="text-xs text-muted-foreground">
                  {viewInternal
                    ? "Included. Turn off to produce a client-shared copy — internal notes, internal documents and unreviewed AI events are excluded both here and at download."
                    : "Your role cannot view internal material; the pack will be a client-shared copy."}
                </p>
              </div>
              <Switch
                id="pack-internal"
                checked={includeInternal && viewInternal}
                onCheckedChange={setIncludeInternal}
                disabled={!viewInternal}
              />
            </div>

            <Separator />

            {/* Generate + history */}
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Packs are versioned — earlier versions stay in the history below.
              </p>
              <Button onClick={generatePack} disabled={disabled || busy !== null}>
                {busy === "generate" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="mr-2 h-4 w-4" />
                )}
                Generate pack
              </Button>
            </div>

            {data.versions.length > 0 && (
              <div className="space-y-2">
                <Label>Version history</Label>
                <div className="divide-y rounded-md border">
                  {data.versions.map((v) => (
                    <div key={v._id} className="flex items-center justify-between px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{v.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {v.includeInternal ? "Internal copy" : "Client-shared copy"} ·{" "}
                          {v.downloads} download{v.downloads === 1 ? "" : "s"}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => void downloadPack(v._id)}
                      >
                        {busy === v._id ? (
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="mr-2 h-3.5 w-3.5" />
                        )}
                        Download
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
