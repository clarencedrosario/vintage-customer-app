import { ChamberShell } from "@/components/ChamberShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { parseCsv } from "@/lib/csvImport";
import { downloadCsv } from "@/lib/reportExports";
import { useMutation, useQuery } from "convex/react";
import { Download, Gavel, Upload } from "lucide-react";
import { Link } from "react-router";
import { useState } from "react";
import { toast } from "sonner";

type CauseRow = {
  _id: string;
  court: string;
  itemNumber: string | null;
  caseTitle: string;
  caseNumber: string | null;
  matterId: string | null;
  sourceName: string;
  sourceUrl: string | null;
  checkedAt: number;
};

type CourtUpdate = {
  _id: string;
  kind: string;
  title: string;
  detail: string | null;
  court: string | null;
  effectiveFrom: string | null;
  sourceName: string;
  sourceUrl: string | null;
  checkedAt: number;
};

const KIND_LABELS: Record<string, string> = {
  circular: "Circular",
  notification: "Notification",
  roster: "Roster",
  holiday: "Holiday",
  other: "Other",
};

function istToday(): string {
  const p = new Date(Date.now() + 5.5 * 3600_000).toISOString();
  return `${p.slice(0, 4)}-${p.slice(5, 7)}-${p.slice(8, 10)}`;
}

export default function CourtDay() {
  const [date, setDate] = useState(istToday);
  const [file, setFile] = useState<File | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [importing, setImporting] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [linkMatterId, setLinkMatterId] = useState("");

  const rows = useQuery(api.knowledge.listCauseList, { listDate: date }) as
    | CauseRow[]
    | undefined;
  const updates = useQuery(api.knowledge.listCourtUpdates) as
    | CourtUpdate[]
    | undefined;
  const matters = useQuery(api.matters.list) as
    | { _id: string; reference: string; title: string }[]
    | undefined;

  const importCauseList = useMutation(api.knowledge.importCauseList);
  const linkCauseRow = useMutation(api.knowledge.linkCauseListRow);

  const handleImport = async () => {
    if (!file) {
      toast.error("Choose a CSV file first.");
      return;
    }
    if (!sourceName.trim()) {
      toast.error("Record where the list came from (e.g. the court website).");
      return;
    }
    setImporting(true);
    try {
      const text = await file.text();
      const { headers, rows: cells } = parseCsv(text);
      const idx = (name: string) =>
        headers.findIndex((h) => h.trim().toLowerCase() === name);
      const iCourt = idx("court");
      const iItem = idx("itemnumber");
      const iTitle = idx("casetitle");
      const iNumber = idx("casenumber");
      if (iTitle === -1) {
        throw new Error("The CSV needs a caseTitle column.");
      }
      const parsed = cells.map((c) => ({
        court: iCourt >= 0 ? (c[iCourt] ?? "").trim() : "",
        itemNumber: iItem >= 0 ? (c[iItem] ?? "").trim() : undefined,
        caseTitle: (c[iTitle] ?? "").trim(),
        caseNumber: iNumber >= 0 ? (c[iNumber] ?? "").trim() : undefined,
      }));
      const res = await importCauseList({
        listDate: date,
        rows: parsed,
        sourceName: sourceName.trim(),
      });
      toast.success(
        `Imported ${res.imported} row(s). They stay labelled as manually imported from ${sourceName.trim()}.`,
      );
      setFile(null);
      setSourceName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  };

  const handleLink = async () => {
    if (linking === null || !linkMatterId) return;
    try {
      await linkCauseRow({
        rowId: linking as Id<"causeListEntries">,
        matterId: linkMatterId as Id<"matters">,
      });
      toast.success("Row linked to the matter and recorded on its file.");
      setLinking(null);
      setLinkMatterId("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not link.");
    }
  };

  const exportCsv = () => {
    if (!rows || rows.length === 0) return;
    const refById = new Map((matters ?? []).map((m) => [m._id, m.reference]));
    downloadCsv(
      `cause-list-${date}.csv`,
      rows.map((r) => ({
        Item: r.itemNumber ?? "",
        Court: r.court,
        "Case title": r.caseTitle,
        "Case number": r.caseNumber ?? "",
        "Linked matter": r.matterId ? refById.get(r.matterId) ?? "" : "",
        Source: r.sourceName,
        "Checked at": new Date(r.checkedAt).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
        }),
      })),
    );
  };

  return (
    <ChamberShell
      subtitle="The Digital Chamber"
      title="Court Day"
      actions={
        <Button asChild size="sm" variant="outline">
          <Link to="/calendar">
            <Gavel className="size-4" aria-hidden="true" />
            Calendar
          </Link>
        </Button>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="cd-date">Court date (Asia/Kolkata)</Label>
            <Input
              id="cd-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-44"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={!rows || rows.length === 0}
          >
            <Download className="size-4" aria-hidden="true" />
            Export day's list
          </Button>
        </div>

        <Card className="rule-frame bg-card">
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <h2 className="font-serif text-lg font-semibold">
                Cause list — {date}
              </h2>
              <span className="type-label ink-faded">
                Manually imported · not live court data
              </span>
            </div>
            {rows === undefined ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                Retrieving…
              </p>
            ) : rows.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                No cause-list rows for this date. Import a list from a lawful
                source below, or link items from Knowledge &amp; courts.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table w-full">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Court</th>
                      <th>Case</th>
                      <th>Matter</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r._id}>
                        <td className="whitespace-nowrap">
                          {r.itemNumber ?? "—"}
                        </td>
                        <td>{r.court}</td>
                        <td>
                          <span className="font-medium">{r.caseTitle}</span>
                          {r.caseNumber && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {r.caseNumber}
                            </span>
                          )}
                        </td>
                        <td>
                          {r.matterId ? (
                            <Link
                              to={`/matters/${r.matterId}?tab=hearings`}
                              className="text-[#8a6a33] underline underline-offset-4"
                            >
                              {(matters ?? []).find((m) => m._id === r.matterId)
                                ?.reference ?? "Open matter"}
                            </Link>
                          ) : linking === r._id ? (
                            <div className="flex items-center gap-1.5">
                              <Select
                                value={linkMatterId}
                                onValueChange={setLinkMatterId}
                              >
                                <SelectTrigger className="h-8 w-48 text-xs">
                                  <SelectValue placeholder="Choose matter" />
                                </SelectTrigger>
                                <SelectContent>
                                  {(matters ?? []).map((m) => (
                                    <SelectItem key={m._id} value={m._id}>
                                      {m.reference}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 px-2 text-xs"
                                onClick={() => void handleLink()}
                                disabled={!linkMatterId}
                              >
                                Link
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 px-2 text-xs"
                                onClick={() => {
                                  setLinking(null);
                                  setLinkMatterId("");
                                }}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              onClick={() => {
                                setLinking(r._id);
                                setLinkMatterId("");
                              }}
                            >
                              Link matter
                            </Button>
                          )}
                        </td>
                        <td className="text-xs text-muted-foreground">
                          {r.sourceName}
                          {r.sourceUrl && (
                            <>
                              {" · "}
                              <a
                                href={r.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="underline"
                              >
                                source
                              </a>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Import */}
        <Card className="rule-frame bg-card">
          <CardContent className="space-y-3 p-4">
            <h3 className="font-serif text-lg font-semibold">
              <Upload className="mr-2 inline size-4" aria-hidden="true" />
              Import a cause list (CSV)
            </h3>
            <p className="text-xs text-muted-foreground">
              Columns: <span className="font-mono">caseTitle</span> (required),{" "}
              <span className="font-mono">court</span>,{" "}
              <span className="font-mono">itemNumber</span>,{" "}
              <span className="font-mono">caseNumber</span>. Every row keeps
              its source name and last-checked time — this is imported
              information, not a synchronized court feed.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cl-source">Source of the list</Label>
                <Input
                  id="cl-source"
                  value={sourceName}
                  onChange={(e) => setSourceName(e.target.value)}
                  placeholder="e.g. Delhi High Court website"
                  className="w-64"
                />
              </div>
              <input
                id="cl-file"
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
              <Label
                htmlFor="cl-file"
                className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
              >
                {file ? file.name : "Choose CSV"}
              </Label>
              <Button size="sm" onClick={handleImport} disabled={importing || !file}>
                {importing ? "Importing…" : "Import rows"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Court updates */}
        <Card className="rule-frame bg-card">
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <h2 className="font-serif text-lg font-semibold">
                Court updates &amp; circulars
              </h2>
              <span className="type-label ink-faded">
                Manually recorded · with source links
              </span>
            </div>
            {updates === undefined ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                Retrieving…
              </p>
            ) : updates.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                No court updates recorded yet. Add circulars, roster changes
                and holidays from Knowledge &amp; courts.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {updates.slice(0, 12).map((u) => (
                  <div key={u._id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{KIND_LABELS[u.kind] ?? u.kind}</Badge>
                      <span className="text-sm font-medium">{u.title}</span>
                    </div>
                    {u.detail && (
                      <p className="mt-1 text-xs text-muted-foreground">{u.detail}</p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {u.court ? `${u.court} · ` : ""}
                      {u.effectiveFrom ? `from ${u.effectiveFrom} · ` : ""}
                      checked{" "}
                      {new Date(u.checkedAt).toLocaleDateString("en-IN", {
                        timeZone: "Asia/Kolkata",
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}{" "}
                      · {u.sourceName}
                      {u.sourceUrl && (
                        <>
                          {" · "}
                          <a
                            href={u.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="underline"
                          >
                            source
                          </a>
                        </>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ChamberShell>
  );
}
