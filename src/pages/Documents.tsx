import { ChamberShell } from "@/components/ChamberShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Archive,
  Bot,
  Columns2,
  ExternalLink,
  FileText,
  FolderOpen,
  History,
  MessageSquare,
  Pencil,
  Search,
  Tags,
  X,
} from "lucide-react";
import { Link } from "react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { VAULT_FOLDERS } from "@/convex/schemaExtras";

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
  folder: string | null;
  tags: string[];
  classification: string | null;
  archived: boolean;
  versionCount: number;
  hasExtractedText: boolean;
};

type SearchHit = {
  documentId: string;
  name: string;
  matterId: string;
  matterReference: string;
  folder: string | null;
  matchedTerms: string[];
  score: number;
  snippet: string;
  sourceName: string | null;
  page: number | null;
};

type VersionRow = {
  _id: string;
  version: number;
  name: string;
  note?: string | null;
  uploadedByName?: string | null;
  createdAt: number;
};

export default function Documents() {
  // "name" = filename/metadata search inside the vault view;
  // "fulltext" = extracted-text search across the whole library.
  const [mode, setMode] = useState<"name" | "fulltext">("name");
  const [search, setSearch] = useState("");
  const [folder, setFolder] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [compareA, setCompareA] = useState<string | null>(null);
  const [compareB, setCompareB] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [versionsFor, setVersionsFor] = useState<string | null>(null);
  const [classifyFor, setClassifyFor] = useState<LibDoc | null>(null);
  const [clsFolder, setClsFolder] = useState("10 Miscellaneous");
  const [clsTags, setClsTags] = useState("");
  const [clsNote, setClsNote] = useState("");
  const [renameFor, setRenameFor] = useState<LibDoc | null>(null);
  const [uploadVersionFor, setUploadVersionFor] = useState<string | null>(null);
  const [uploadVersionName, setUploadVersionName] = useState("");
  const [uploadVersionBusy, setUploadVersionBusy] = useState(false);
  const versionFileRef = useRef<HTMLInputElement | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const lib = useQuery(api.documents.library, {
    search: mode === "name" && search ? search : undefined,
    kind: "all",
    visibility: "all",
  }) as
    | { total: number; documents: LibDoc[]; matters: { _id: string; reference: string }[] }
    | null
    | undefined;

  const vaultData = useQuery(api.vault.vault, {
    folder,
    search: mode === "name" && search ? search : undefined,
    archived: showArchived ? true : false,
  }) as { documents: LibDoc[]; total: number; folders: readonly string[] } | null | undefined;

  const fullText = useQuery(
    api.vault.search,
    mode === "fulltext" && search.trim() ? { q: search } : "skip",
  ) as { results: SearchHit[]; terms: string[] } | undefined;

  const versions = useQuery(
    api.vault.versions,
    versionsFor ? { documentId: versionsFor as Id<"matterDocuments"> } : "skip",
  ) as VersionRow[] | undefined;

  const openUrl = useQuery(
    api.documents.getFileUrl,
    openId ? { documentId: openId as Id<"matterDocuments"> } : "skip",
  );

  const classifyFn = useMutation(api.vault.classify);
  const renameFn = useMutation(api.vault.rename);
  const moveFn = useMutation(api.vault.move);
  const archiveFn = useMutation(api.vault.setArchived);
  const removeFn = useMutation(api.vault.remove);
  const restoreVersionFn = useMutation(api.vault.restoreVersion);
  const addVersionFn = useMutation(api.vault.addVersion);
  const uploadVersionUrlFn = useMutation(api.matters.generateDocumentUploadUrl);

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

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    }
  };

  const byId = new Map((lib?.documents ?? []).map((d) => [d._id, d]));
  const docA = compareA ? byId.get(compareA) : undefined;
  const docB = compareB ? byId.get(compareB) : undefined;

  const vaultLib = vaultData ?? null;
  const rows = mode === "name" ? (vaultLib?.documents ?? []) : [];
  const versionsForDoc = versionsFor
    ? (byId.get(versionsFor) ?? rows.find((r) => r._id === versionsFor) ?? null)
    : null;

  const uploadNewVersion = async (doc: LibDoc, file: File) => {
    setUploadVersionBusy(true);
    try {
      const url = await uploadVersionUrlFn({ matterId: doc.matterId as Id<"matters"> });
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await addVersionFn({
        documentId: doc._id as Id<"matterDocuments">,
        storageId,
        name: uploadVersionName.trim() || doc.name,
        sizeBytes: file.size,
      });
      toast.success("Version uploaded — the live file now points to the new version.");
      setUploadVersionFor(null);
      setUploadVersionName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Version upload failed.");
    } finally {
      setUploadVersionBusy(false);
    }
  };
  const activeSearch = mode === "fulltext" ? fullText : undefined;

  return (
    <ChamberShell subtitle="The Digital Chamber" title="Document Vault">
      <div className="space-y-5">
        {/* Search bar with mode switch */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[260px] flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                mode === "fulltext"
                  ? "Search inside documents — e.g. payment of ₹25 lakh…"
                  : "Search filenames, tags, classification…"
              }
              className="pl-9"
              aria-label="Search documents"
            />
          </div>
          <Select value={mode} onValueChange={(v) => setMode(v as "name" | "fulltext")}>
            <SelectTrigger className="w-56" aria-label="Search mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Filenames &amp; metadata</SelectItem>
              <SelectItem value="fulltext">Inside documents (full-text)</SelectItem>
            </SelectContent>
          </Select>
          {mode === "name" && (
            <Select value={folder} onValueChange={setFolder}>
              <SelectTrigger className="w-56" aria-label="Filter by folder">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All folders</SelectItem>
                {VAULT_FOLDERS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
                <SelectItem value="unclassified">Unclassified</SelectItem>
              </SelectContent>
            </Select>
          )}
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Archived
          </label>
        </div>

        {/* Folder rail (vault view) */}
        {mode === "name" && (
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant={folder === "all" ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => setFolder("all")}
            >
              <FolderOpen className="mr-1 size-3.5" aria-hidden="true" /> All
            </Button>
            {VAULT_FOLDERS.map((f) => (
              <Button
                key={f}
                size="sm"
                variant={folder === f ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => setFolder(f)}
              >
                {f}
              </Button>
            ))}
            <Button
              size="sm"
              variant={folder === "unclassified" ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => setFolder("unclassified")}
            >
              Unclassified
            </Button>
          </div>
        )}

        {/* Full-text results */}
        {mode === "fulltext" ? (
          activeSearch === undefined ? (
            <p className="text-sm text-muted-foreground">
              Type a question or phrase to search inside your authorized
              documents. Natural-language queries work — the significant
              words are matched across extracted text with page references.
            </p>
          ) : activeSearch.results.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center text-sm ink-faded">
                Nothing found in the extracted text
                {activeSearch.terms.length > 0
                  ? ` for: ${activeSearch.terms.join(", ")}`
                  : ""}
                . Documents need their text extracted first (Sources tab in a
                matter's AI studio adds text-layer/OCR extraction).
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              <p className="type-label ink-faded">
                {activeSearch.results.length} match(es) · searched terms:{" "}
                {activeSearch.terms.join(", ")}
              </p>
              {activeSearch.results.map((r) => (
                <Card key={r.documentId} className="rule-frame bg-card">
                  <CardContent className="space-y-2 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{r.name}</p>
                        <p className="type-label ink-faded">
                          <Link
                            to={`/matters/${r.matterId}?tab=documents`}
                            className="hover:underline"
                          >
                            {r.matterReference}
                          </Link>
                          {r.folder ? ` · ${r.folder}` : ""}
                          {r.sourceName ? ` · via ${r.sourceName}` : ""}
                          {r.page != null ? `, p.${r.page}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => setOpenId(r.documentId)}
                        >
                          <ExternalLink className="size-3.5" aria-hidden="true" /> Open
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => {
                            if (!compareA || compareA === r.documentId) setCompareA(r.documentId);
                            else if (!compareB) setCompareB(r.documentId);
                            else {
                              setCompareA(r.documentId);
                              setCompareB(null);
                            }
                          }}
                        >
                          <Columns2 className="size-3.5" aria-hidden="true" />
                          {compareA === r.documentId ? "A" : compareB === r.documentId ? "B" : "Compare"}
                        </Button>
                        <Link
                          to={`/matters/${r.matterId}?tab=ai`}
                          className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-[#8a6a33] hover:underline"
                        >
                          <Bot className="size-3.5" aria-hidden="true" /> Ask
                        </Link>
                      </div>
                    </div>
                    {r.snippet && (
                      <p className="rounded border border-border/70 bg-[#F7F5EF]/60 p-2 text-xs leading-relaxed">
                        …{r.snippet}…
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )
        ) : /* Vault table */ vaultLib === undefined || lib === undefined ? (
          <p className="text-sm text-muted-foreground">Retrieving documents…</p>
        ) : vaultLib === null || lib === null ? (
          <p className="text-sm text-muted-foreground">
            Select an organization to see your documents.
          </p>
        ) : rows.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center text-sm ink-faded">
              {showArchived
                ? "No archived documents in this view."
                : "No documents in this folder. Classify documents from the actions menu, or upload inside a matter."}
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="data-table w-full">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Folder</th>
                  <th>Matter</th>
                  <th>Tags</th>
                  <th>Ver.</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d._id}>
                    <td>
                      <div className="flex items-center gap-2">
                        {d.kind === "communication" ? (
                          <MessageSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        ) : (
                          <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        )}
                        <span className="font-medium">{d.name}</span>
                        {d.submittedByClient && <Badge variant="secondary">From client</Badge>}
                        {d.archived && <Badge variant="outline">Archived</Badge>}
                        {d.hasExtractedText && (
                          <Badge variant="outline" className="text-[#8a6a33]">
                            text indexed
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-xs">{d.folder ?? "—"}</td>
                    <td>
                      <Link
                        to={`/matters/${d.matterId}?tab=documents`}
                        className="text-[#8a6a33] underline underline-offset-4"
                      >
                        {d.matterReference}
                      </Link>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {d.tags.length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          d.tags.map((t) => (
                            <Badge key={t} variant="outline" className="text-xs">
                              <Tags className="mr-1 size-3" aria-hidden="true" />
                              {t}
                            </Badge>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="text-center text-xs">
                      {d.versionCount > 1 ? `v${d.versionCount}` : "—"}
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
                          <ExternalLink className="size-3.5" aria-hidden="true" /> Open
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => {
                            setVersionsFor(d._id);
                          }}
                        >
                          <History className="size-3.5" aria-hidden="true" /> Versions
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => {
                            setClassifyFor(d);
                            setClsFolder(d.folder ?? "10 Miscellaneous");
                            setClsTags(d.tags.join(", "));
                            setClsNote(d.classification ?? "");
                          }}
                        >
                          <Tags className="size-3.5" aria-hidden="true" /> Classify
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => {
                            setRenameFor(d);
                            setRenameValue(d.name);
                          }}
                        >
                          <Pencil className="size-3.5" aria-hidden="true" /> Rename
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() =>
                            run(
                              () =>
                                archiveFn({
                                  documentId: d._id as Id<"matterDocuments">,
                                  archived: !d.archived,
                                }),
                              d.archived ? "Restored to the vault." : "Archived.",
                            )
                          }
                        >
                          <Archive className="size-3.5" aria-hidden="true" />
                          {d.archived ? "Restore" : "Archive"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete “${d.name}” and its version history? This cannot be undone.`,
                              )
                            ) {
                              void run(
                                () => removeFn({ documentId: d._id as Id<"matterDocuments"> }),
                                "Deleted (recorded in the audit log).",
                              );
                            }
                          }}
                        >
                          <X className="size-3.5" aria-hidden="true" /> Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Comparison strip */}
        {compareA && compareB ? (
          <div className="grid gap-3 rounded-md border border-[#B68A45]/40 bg-[#B68A45]/[0.05] p-3 sm:grid-cols-2">
            {[
              { label: "Document A", doc: docA, url: null as string | null },
              { label: "Document B", doc: docB, url: null as string | null },
            ].map(({ label, doc, url }) => (
              <div key={label} className="rounded border border-border bg-card p-3">
                <p className="type-label ink-faded">{label}</p>
                <p className="mt-1 text-sm font-medium">{doc ? doc.name : "Removed"}</p>
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
                  <a href={url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-xs text-[#8a6a33] underline underline-offset-4">
                    <ExternalLink className="size-3.5" aria-hidden="true" /> Open side by side
                  </a>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">Pick “Open” above to view it.</p>
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
                <X className="size-3.5" aria-hidden="true" /> Clear
              </Button>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {mode === "name"
            ? `${vaultLib?.total ?? 0} document(s) in your authorized view. `
            : ""}
          Full-text search reads only extracted text (text layer or OCR added
          via the AI Sources tab) and never crosses matter access boundaries.
          The recommended folder structure keeps the vault navigable: file by
          folder, not by date.
        </p>

        {/* Versions dialog */}
        <Dialog open={!!versionsFor} onOpenChange={(o) => !o && setVersionsFor(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-serif text-xl">Version history</DialogTitle>
              <DialogDescription>
                Every uploaded version is kept. Restoring an older version
                switches the live file — nothing is destroyed.
              </DialogDescription>
            </DialogHeader>
            {versionsForDoc && (
              <div className="mb-3 space-y-2 rounded border border-border bg-muted/30 p-3">
                <p className="type-label ink-faded">Add a new version</p>
                <Input
                  value={uploadVersionName}
                  onChange={(e) => setUploadVersionName(e.target.value)}
                  placeholder={`File name (defaults to "${versionsForDoc.name}")`}
                />
                <input
                  ref={versionFileRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f && versionsForDoc) void uploadNewVersion(versionsForDoc, f);
                    e.target.value = "";
                  }}
                />
                <Button
                  size="sm"
                  disabled={uploadVersionBusy}
                  onClick={() => versionFileRef.current?.click()}
                >
                  {uploadVersionBusy ? "Uploading…" : "Choose file & upload"}
                </Button>
              </div>
            )}
            {versions === undefined ? (
              <p className="text-sm text-muted-foreground">Retrieving…</p>
            ) : versions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Only the original upload exists so far. Add the first version
                with the panel above.
              </p>
            ) : (
              <ul className="space-y-2">
                {versions.map((v) => (
                  <li
                    key={v._id}
                    className="flex items-center justify-between gap-2 rounded border border-border p-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        v{v.version} — {v.name}
                      </p>
                      <p className="type-label ink-faded">
                        {new Date(v.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                        {v.uploadedByName ? ` · ${v.uploadedByName}` : ""}
                        {v.note ? ` · ${v.note}` : ""}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        run(
                          () =>
                            restoreVersionFn({
                              documentId: versionsFor as Id<"matterDocuments">,
                              version: v.version,
                            }),
                          `Version ${v.version} is now the live file.`,
                        )
                      }
                    >
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </DialogContent>
        </Dialog>

        {/* Classify dialog */}
        <Dialog open={!!classifyFor} onOpenChange={(o) => !o && setClassifyFor(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-serif text-xl">Classify document</DialogTitle>
              <DialogDescription>
                Folder, tags and classification power the vault filters and
                metadata search.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Folder</Label>
                <Select value={clsFolder} onValueChange={setClsFolder}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VAULT_FOLDERS.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cls-tags">Tags (comma-separated)</Label>
                <Input
                  id="cls-tags"
                  value={clsTags}
                  onChange={(e) => setClsTags(e.target.value)}
                  placeholder="limitation, specific performance"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cls-note">Classification note (optional)</Label>
                <Input
                  id="cls-note"
                  value={clsNote}
                  onChange={(e) => setClsNote(e.target.value)}
                  placeholder="e.g. Executed agreement — counterpart 2"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setClassifyFor(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (!classifyFor) return;
                  void run(
                    () =>
                      classifyFn({
                        documentId: classifyFor._id as Id<"matterDocuments">,
                        folder: clsFolder,
                        tags: clsTags
                          .split(",")
                          .map((t) => t.trim())
                          .filter(Boolean),
                        classification: clsNote || undefined,
                      }),
                    "Classification saved.",
                  );
                  setClassifyFor(null);
                }}
              >
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Rename dialog */}
        <Dialog open={!!renameFor} onOpenChange={(o) => !o && setRenameFor(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-serif text-xl">Rename document</DialogTitle>
              <DialogDescription>
                The vault and the matter's Documents tab both show the new
                name; the change is audit-logged.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="rn-name">Name</Label>
              <Input
                id="rn-name"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRenameFor(null)}>
                Cancel
              </Button>
              <Button
                disabled={!renameValue.trim()}
                onClick={() => {
                  if (!renameFor) return;
                  void run(
                    () =>
                      renameFn({
                        documentId: renameFor._id as Id<"matterDocuments">,
                        name: renameValue,
                      }),
                    "Renamed.",
                  );
                  setRenameFor(null);
                }}
              >
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ChamberShell>
  );
}
