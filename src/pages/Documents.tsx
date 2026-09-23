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
import { useMutation, useQuery } from "convex/react";
import {
  Columns2,
  ExternalLink,
  FileText,
  MessageSquare,
  Search,
  X,
} from "lucide-react";
import { Link } from "react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type LibDoc = {
  _id: string;
  name: string;
  kind: string;
  visibility: string;
  matterId: string;
  matterReference: string;
  hasFile: boolean;
  submittedByClient: boolean;
  createdAt: number;
};

export default function Documents() {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [visibility, setVisibility] = useState("all");
  const [compareA, setCompareA] = useState<string | null>(null);
  const [compareB, setCompareB] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const lib = useQuery(api.documents.library, {
    search: search || undefined,
    kind: kind as "document" | "communication" | "all",
    visibility: visibility as "internal" | "shared_with_client" | "all",
  }) as
    | {
        total: number;
        documents: LibDoc[];
        matters: { _id: string; reference: string }[];
      }
    | null
    | undefined;

  // URLs resolved only while needed (the server re-checks matter +
  // document-level access on every call).
  const openUrl = useQuery(
    api.documents.getFileUrl,
    openId ? { documentId: openId as Id<"matterDocuments"> } : "skip",
  );
  const urlA = useQuery(
    api.documents.getFileUrl,
    compareA ? { documentId: compareA as Id<"matterDocuments"> } : "skip",
  );
  const urlB = useQuery(
    api.documents.getFileUrl,
    compareB ? { documentId: compareB as Id<"matterDocuments"> } : "skip",
  );

  useEffect(() => {
    if (openId === null) return;
    if (openUrl === undefined) return; // still resolving
    if (openUrl) {
      window.open(openUrl, "_blank", "noopener");
    } else {
      toast.error("This record has no stored file, or you cannot open it.");
    }
    setOpenId(null);
  }, [openId, openUrl]);

  const library = lib ?? null;

  const byId = new Map((library?.documents ?? []).map((d) => [d._id, d]));
  const docA = compareA ? byId.get(compareA) : undefined;
  const docB = compareB ? byId.get(compareB) : undefined;

  return (
    <ChamberShell subtitle="The Digital Chamber" title="Documents">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search documents…"
              className="pl-9"
              aria-label="Search documents"
            />
          </div>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="w-44" aria-label="Filter by kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="document">Documents</SelectItem>
              <SelectItem value="communication">Communications</SelectItem>
            </SelectContent>
          </Select>
          <Select value={visibility} onValueChange={setVisibility}>
            <SelectTrigger className="w-52" aria-label="Filter by visibility">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All visibility</SelectItem>
              <SelectItem value="internal">Internal only</SelectItem>
              <SelectItem value="shared_with_client">Shared with client</SelectItem>
            </SelectContent>
          </Select>

        </div>

        {compareA && compareB ? (
          <div className="grid gap-3 rounded-md border border-[#B68A45]/40 bg-[#B68A45]/[0.05] p-3 sm:grid-cols-2">
            {[
              { label: "Document A", doc: docA, url: urlA },
              { label: "Document B", doc: docB, url: urlB },
            ].map(({ label, doc, url }) => (
              <div key={label} className="rounded border border-border bg-card p-3">
                <p className="type-label ink-faded">{label}</p>
                <p className="mt-1 text-sm font-medium">
                  {doc ? doc.name : "Removed"}
                </p>
                {doc && (
                  <p className="text-xs text-muted-foreground">
                    {doc.matterReference} ·{" "}
                    {new Date(doc.createdAt).toLocaleDateString("en-IN", {
                      timeZone: "Asia/Kolkata",
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                )}
                {url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-xs text-[#8a6a33] underline underline-offset-4"
                  >
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                    Open side by side
                  </a>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {url === undefined ? "Resolving…" : "No stored file."}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
            <Columns2 className="size-4 text-[#8a6a33]" aria-hidden="true" />
            <span className="text-muted-foreground">
              Comparison — pick two records of the same matter:
            </span>
            <Badge variant="outline">A: {docA ? docA.name : "—"}</Badge>
            <Badge variant="outline">B: {docB ? docB.name : "—"}</Badge>
            {(compareA || compareB) && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto h-7"
                onClick={() => {
                  setCompareA(null);
                  setCompareB(null);
                }}
              >
                <X className="size-3.5" aria-hidden="true" />
                Clear
              </Button>
            )}
          </div>
        )}

        {lib === undefined ? (
          <p className="text-sm text-muted-foreground">Retrieving documents…</p>
        ) : library === null ? (
          <p className="text-sm text-muted-foreground">
            Select an organization to see your documents.
          </p>
        ) : library.documents.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center text-sm ink-faded">
              No documents match. Documents you upload inside a matter appear
              here, filtered by what you are authorized to see.
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="data-table w-full">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Matter</th>
                  <th>Type</th>
                  <th>Visibility</th>
                  <th>Added</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {library.documents.map((d) => (
                  <tr key={d._id}>
                    <td>
                      <div className="flex items-center gap-2">
                        {d.kind === "communication" ? (
                          <MessageSquare
                            className="size-4 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                        ) : (
                          <FileText
                            className="size-4 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                        )}
                        <span className="font-medium">{d.name}</span>
                        {d.submittedByClient && (
                          <Badge variant="secondary">From client</Badge>
                        )}
                      </div>
                    </td>
                    <td>
                      <Link
                        to={`/matters/${d.matterId}?tab=documents`}
                        className="text-[#8a6a33] underline underline-offset-4"
                      >
                        {d.matterReference}
                      </Link>
                    </td>
                    <td className="capitalize">{d.kind}</td>
                    <td>
                      <Badge
                        variant={
                          d.visibility === "shared_with_client"
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {d.visibility === "shared_with_client"
                          ? "Shared with client"
                          : "Internal"}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(d.createdAt).toLocaleDateString("en-IN", {
                        timeZone: "Asia/Kolkata",
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          disabled={!d.hasFile}
                          onClick={() => setOpenId(d._id)}
                        >
                          <ExternalLink className="size-3.5" aria-hidden="true" />
                          Open
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => {
                            if (!compareA || compareA === d._id) {
                              setCompareA(d._id);
                            } else if (!compareB) {
                              setCompareB(d._id);
                            } else {
                              setCompareA(d._id);
                              setCompareB(null);
                            }
                          }}
                        >
                          <Columns2 className="size-3.5" aria-hidden="true" />
                          {compareA === d._id ? "A" : compareB === d._id ? "B" : "Compare"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {library ? `${library.total} document(s) in your authorized view. ` : ""}
          Pick “Compare” on two records of the same matter (for example a
          draft and the executed version) to study them side by side. File
          access is always re-checked server-side when opened.
        </p>
      </div>
    </ChamberShell>
  );
}
