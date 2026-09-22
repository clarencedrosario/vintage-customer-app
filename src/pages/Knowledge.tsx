import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { ChamberShell } from "@/components/ChamberShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// =====================================================================
// Library & court information (section 25).
// Manual imports are always labelled as manual with who/when/where;
// nothing pretends to be a live synchronized court feed.
// =====================================================================

const KIND_LABELS: Record<string, string> = {
  precedent: "Precedent",
  template: "Template",
  research_note: "Research note",
  authority: "Authority",
};

const STATE_BADGE: Record<string, string> = {
  draft: "bg-amber-50 text-amber-900 border-amber-200",
  approved: "bg-emerald-50 text-emerald-900 border-emerald-200",
  retired: "bg-stone-100 text-stone-600 border-stone-200",
};

const UPDATE_LABELS: Record<string, string> = {
  circular: "Circular",
  notification: "Notification",
  roster: "Roster",
  holiday: "Holiday",
  other: "Other",
};

function dt(ts: number): string {
  return new Date(ts).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function d(ts: number): string {
  return new Date(ts).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function today(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

// ---------------------------------------------------------------------
// Knowledge entry editor / viewer dialog
// ---------------------------------------------------------------------

function EntryDialog({
  entryId,
  onClose,
}: {
  entryId: string;
  onClose: () => void;
}) {
  const entry = useQuery(api.knowledge.get, {
    entryId: entryId as never,
  });
  const editEntry = useMutation(api.knowledge.edit);
  const approveEntry = useMutation(api.knowledge.approve);
  const setState = useMutation(api.knowledge.setState);
  const reuse = useMutation(api.knowledge.reuseInMatter);
  const matters = useQuery(api.matters.list);

  const [editing, setEditing] = useState(false);
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceRef, setSourceRef] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [busy, setBusy] = useState(false);

  const [reuseMatter, setReuseMatter] = useState("");
  const [reuseMode, setReuseMode] = useState<"note" | "task">("note");
  const [reuseDue, setReuseDue] = useState("");

  const [primed, setPrimed] = useState(false);

  const shownVersion = viewVersion ?? entry?.bodyVersion ?? 0;
  const isDrafting = editing || entry?.state === "draft";

  const startEdit = () => {
    if (!entry) return;
    setTitle(entry.title);
    setBody(entry.body);
    setTags(entry.tags.join(", "));
    setSourceUrl(entry.sourceUrl ?? "");
    setSourceRef(entry.sourceRef ?? "");
    setChangeNote("");
    setEditing(true);
  };

  // Drafts open straight into the editor with their current content.
  useEffect(() => {
    if (entry && !primed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPrimed(true);
      if (entry.state === "draft") startEdit();
    }
  }, [entry, primed]);

  if (entry === undefined) {
    return (
      <Dialog open onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="sm:max-w-3xl">
          <p className="py-10 text-center text-sm text-muted-foreground">
            Opening entry…
          </p>
        </DialogContent>
      </Dialog>
    );
  }
  if (entry === null) {
    return (
      <Dialog open onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="sm:max-w-3xl">
          <p className="py-10 text-center text-sm text-muted-foreground">
            Entry not found.
          </p>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">{entry.title}</DialogTitle>
          <DialogDescription>
            {KIND_LABELS[entry.kind]} · v{shownVersion} of {entry.currentVersion} ·
            by {entry.authorName} · {d(entry.updatedAt)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={STATE_BADGE[entry.state] ?? ""}>
            {entry.state}
          </Badge>
          {entry.approvedVersion === shownVersion && entry.state === "approved" && (
            <Badge variant="outline" className="bg-emerald-50 text-emerald-900 border-emerald-200">
              approved v{entry.approvedVersion} · {entry.approvedByName ?? "reviewer"}
            </Badge>
          )}
          {entry.tags.map((t) => (
            <Badge key={t} variant="outline" className="bg-muted/60 text-muted-foreground">
              #{t}
            </Badge>
          ))}
          {entry.reuseCount > 0 && (
            <span className="text-xs text-muted-foreground">
              reused {entry.reuseCount} time{entry.reuseCount === 1 ? "" : "s"}
              {entry.lastReusedAt ? ` · last ${d(entry.lastReusedAt)}` : ""}
            </span>
          )}
        </div>

        {entry.state !== "draft" && !editing && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>View version:</span>
            {entry.versions
              .slice()
              .reverse()
              .map((v) => (
                <button
                  key={v.version}
                  type="button"
                  onClick={() => setViewVersion(v.version === shownVersion ? null : v.version)}
                  className={`rounded border px-1.5 py-0.5 ${
                    v.version === shownVersion
                      ? "border-[#B68A45] bg-amber-50 text-[#8a6a33]"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  v{v.version}
                </button>
              ))}
          </div>
        )}

        {isDrafting ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="ke-title" className="text-xs">Title</Label>
              <Input
                id="ke-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ke-body" className="text-xs">Body</Label>
              <Textarea
                id="ke-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={12}
                className="font-serif text-sm"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="ke-tags" className="text-xs">Tags (comma-separated)</Label>
                <Input
                  id="ke-tags"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  className="h-8 text-sm"
                  placeholder="bail, 482, quashing"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ke-src" className="text-xs">Source link</Label>
                <Input
                  id="ke-src"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  className="h-8 text-sm"
                  placeholder="https://…"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ke-ref" className="text-xs">Source citation</Label>
                <Input
                  id="ke-ref"
                  value={sourceRef}
                  onChange={(e) => setSourceRef(e.target.value)}
                  className="h-8 text-sm"
                  placeholder="e.g. 2023 SCC OnLine SC 999"
                />
              </div>
              {editing && (
                <div className="space-y-1">
                  <Label htmlFor="ke-note" className="text-xs">Change note</Label>
                  <Input
                    id="ke-note"
                    value={changeNote}
                    onChange={(e) => setChangeNote(e.target.value)}
                    className="h-8 text-sm"
                    placeholder="What changed in this version?"
                  />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              {editing && (
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              )}
              <Button
                size="sm"
                disabled={busy || body.trim().length < 5}
                onClick={async () => {
                  setBusy(true);
                  try {
                    if (editing) {
                      await editEntry({
                        entryId: entry._id as never,
                        title,
                        body,
                        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
                        sourceUrl: sourceUrl || undefined,
                        sourceRef: sourceRef || undefined,
                        changeNote: changeNote || undefined,
                      });
                      toast.success("New version saved — entry returned to draft for review.");
                    } else {
                      await editEntry({
                        entryId: entry._id as never,
                        body,
                        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
                        sourceUrl: sourceUrl || undefined,
                        sourceRef: sourceRef || undefined,
                      });
                      toast.success("Draft updated.");
                    }
                    setEditing(false);
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Could not save.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {editing ? "Save new version" : "Save draft"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-4 font-serif text-sm leading-relaxed">
              {entry.body}
            </div>
            {(entry.sourceUrl || entry.sourceRef) && (
              <p className="text-xs text-muted-foreground">
                Source:{" "}
                {entry.sourceUrl ? (
                  <a
                    href={entry.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  >
                    {entry.sourceRef || entry.sourceUrl}
                  </a>
                ) : (
                  entry.sourceRef
                )}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={startEdit}>
                Edit (creates new version)
              </Button>
              {entry.state === "draft" && (
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      await approveEntry({ entryId: entry._id as never });
                      toast.success("Version approved for reuse.");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Could not approve.");
                    }
                  }}
                >
                  Approve this version
                </Button>
              )}
              {entry.state === "approved" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await setState({ entryId: entry._id as never, state: "draft" });
                      toast.success("Entry returned to draft.");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Could not update.");
                    }
                  }}
                >
                  Return to draft
                </Button>
              )}
              {entry.state !== "retired" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-800 hover:bg-red-50 hover:text-red-900"
                  onClick={async () => {
                    try {
                      await setState({ entryId: entry._id as never, state: "retired" });
                      toast.success("Entry retired — hidden from the library list.");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Could not update.");
                    }
                  }}
                >
                  Retire
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Reuse — explicit, permission-checked on the server */}
        {entry.state !== "retired" && !editing && (
          <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
            <p className="type-label">Reuse in a matter</p>
            <p className="text-xs text-muted-foreground">
              Copies this entry into the matter as an internal note (or a task
              for follow-up). Requires access to the matter; the reuse is
              recorded in its chronology.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-48 flex-1 space-y-1">
                <Label htmlFor="reuse-matter" className="text-xs">Matter</Label>
                <select
                  id="reuse-matter"
                  value={reuseMatter}
                  onChange={(e) => setReuseMatter(e.target.value)}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
                >
                  <option value="">Choose a matter…</option>
                  {matters?.map((m) => (
                    <option key={m._id} value={m._id}>
                      {m.reference} — {m.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="reuse-mode" className="text-xs">As</Label>
                <select
                  id="reuse-mode"
                  value={reuseMode}
                  onChange={(e) => setReuseMode(e.target.value as "note" | "task")}
                  className="h-8 rounded-md border border-border bg-background px-2 text-sm"
                >
                  <option value="note">Internal note</option>
                  <option value="task">Task</option>
                </select>
              </div>
              {reuseMode === "task" && (
                <div className="space-y-1">
                  <Label htmlFor="reuse-due" className="text-xs">Due date</Label>
                  <Input
                    id="reuse-due"
                    type="date"
                    value={reuseDue}
                    onChange={(e) => setReuseDue(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              )}
              <Button
                size="sm"
                disabled={!reuseMatter || busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await reuse({
                      entryId: entry._id as never,
                      matterId: reuseMatter as never,
                      version: shownVersion !== entry.currentVersion ? shownVersion : undefined,
                      mode: reuseMode,
                      taskDueDate: reuseMode === "task" && reuseDue ? reuseDue : undefined,
                    });
                    toast.success("Reused in the matter — see its chronology.");
                    setReuseMatter("");
                    setReuseDue("");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Could not reuse.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Reuse
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------

export default function Knowledge() {
  const categories = useQuery(api.knowledge.listCategories);
  const createCategory = useMutation(api.knowledge.createCategory);
  const [tab, setTab] = useState("library");

  return (
    <ChamberShell
      subtitle="The Digital Chamber"
      title="Knowledge & court information"
    >
      <Tabs value={tab} onValueChange={setTab} className="space-y-6">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="library">Firm knowledge</TabsTrigger>
          <TabsTrigger value="causelist">Cause lists</TabsTrigger>
          <TabsTrigger value="updates">Court updates</TabsTrigger>
        </TabsList>

        <TabsContent value="library">
          <LibraryTab
            categories={categories ?? []}
            onCreateCategory={async (name) => {
              try {
                await createCategory({ name });
                toast.success("Category added.");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Could not add category.");
              }
            }}
          />
        </TabsContent>

        <TabsContent value="causelist">
          <CauseListTab />
        </TabsContent>

        <TabsContent value="updates">
          <UpdatesTab />
        </TabsContent>
      </Tabs>
    </ChamberShell>
  );
}

// ---------------------------------------------------------------------
// Firm knowledge tab
// ---------------------------------------------------------------------

function LibraryTab({
  categories,
  onCreateCategory,
}: {
  categories: { _id: string; name: string }[];
  onCreateCategory: (name: string) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [kind, setKind] = useState("");
  const [state, setState] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newCat, setNewCat] = useState("");

  const [nk, setNk] = useState("precedent");
  const [ncat, setNcat] = useState("");
  const [nt, setNt] = useState("");
  const [nb, setNb] = useState("");
  const [ntags, setNtags] = useState("");
  const [nurl, setNurl] = useState("");
  const [nref, setNref] = useState("");
  const [busy, setBusy] = useState(false);

  const createEntry = useMutation(api.knowledge.create);

  const entries = useQuery(api.knowledge.list, {
    search: search.trim() || undefined,
    categoryId: (categoryId || undefined) as never,
    kind: (kind || undefined) as never,
    state: (state || undefined) as never,
  });

  const filteredCategories = categories;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1 space-y-1">
          <Label htmlFor="k-search" className="text-xs">Search</Label>
          <Input
            id="k-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Title, tag or full text…"
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="k-cat" className="text-xs">Category</Label>
          <select
            id="k-cat"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="">All categories</option>
            {filteredCategories.map((c) => (
              <option key={c._id} value={c._id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="k-kind" className="text-xs">Kind</Label>
          <select
            id="k-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="">All kinds</option>
            {Object.entries(KIND_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="k-state" className="text-xs">State</Label>
          <select
            id="k-state"
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="">All (except retired)</option>
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
            <option value="retired">Retired</option>
            <option value="all">Everything</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="k-newcat" className="text-xs">New category</Label>
          <div className="flex gap-1">
            <Input
              id="k-newcat"
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              placeholder="Criminal"
              className="h-8 w-32 text-sm"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={!newCat.trim()}
              onClick={async () => {
                await onCreateCategory(newCat.trim());
                setNewCat("");
              }}
            >
              Add
            </Button>
          </div>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          New entry
        </Button>
      </div>

      {entries === undefined ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Opening the library…
        </p>
      ) : entries.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-serif text-lg">The library is empty</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Save precedents, templates, research notes and authorities here.
              Private client material is never added automatically — an entry
              is only created when someone deliberately writes it.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {entries.map((e) => (
            <Card
              key={e._id}
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => setOpenId(e._id)}
            >
              <CardContent className="space-y-2 pt-5">
                <div className="flex items-start justify-between gap-2">
                  <p className="type-label">{KIND_LABELS[e.kind] ?? e.kind}</p>
                  <Badge variant="outline" className={STATE_BADGE[e.state] ?? ""}>
                    {e.state}
                  </Badge>
                </div>
                <p className="font-serif text-base leading-snug">{e.title}</p>
                <p className="line-clamp-2 text-xs text-muted-foreground">{e.excerpt}</p>
                <div className="flex flex-wrap gap-1">
                  {e.tags.slice(0, 4).map((t) => (
                    <Badge key={t} variant="outline" className="bg-muted/60 text-muted-foreground">
                      #{t}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  v{e.currentVersion} · {e.authorName} · {d(e.updatedAt)}
                  {e.reuseCount > 0 ? ` · reused ×${e.reuseCount}` : ""}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {openId && <EntryDialog entryId={openId} onClose={() => setOpenId(null)} />}

      {/* New-entry dialog */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif">New knowledge entry</DialogTitle>
            <DialogDescription>
              Deliberate authoring only — nothing from client matters is
              published here automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="nk-kind" className="text-xs">Kind</Label>
                <select
                  id="nk-kind"
                  value={nk}
                  onChange={(e) => setNk(e.target.value)}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
                >
                  {Object.entries(KIND_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="nk-cat" className="text-xs">Category</Label>
                <select
                  id="nk-cat"
                  value={ncat}
                  onChange={(e) => setNcat(e.target.value)}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
                >
                  <option value="">None</option>
                  {categories.map((c) => (
                    <option key={c._id} value={c._id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="nk-title" className="text-xs">Title</Label>
              <Input
                id="nk-title"
                value={nt}
                onChange={(e) => setNt(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="nk-body" className="text-xs">Body</Label>
              <Textarea
                id="nk-body"
                value={nb}
                onChange={(e) => setNb(e.target.value)}
                rows={9}
                className="font-serif text-sm"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="nk-tags" className="text-xs">Tags</Label>
                <Input
                  id="nk-tags"
                  value={ntags}
                  onChange={(e) => setNtags(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="nk-url" className="text-xs">Source link</Label>
                <Input
                  id="nk-url"
                  value={nurl}
                  onChange={(e) => setNurl(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="nk-ref" className="text-xs">Source citation</Label>
                <Input
                  id="nk-ref"
                  value={nref}
                  onChange={(e) => setNref(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={busy || nt.trim().length < 3 || nb.trim().length < 5}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const id = await createEntry({
                      kind: nk as never,
                      title: nt,
                      body: nb,
                      categoryId: (ncat || undefined) as never,
                      tags: ntags.split(",").map((t) => t.trim()).filter(Boolean),
                      sourceUrl: nurl || undefined,
                      sourceRef: nref || undefined,
                    });
                    toast.success("Entry created as a draft.");
                    setCreating(false);
                    setNt("");
                    setNb("");
                    setNtags("");
                    setNurl("");
                    setNref("");
                    setOpenId(id);
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Could not create.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Create draft
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------
// Cause lists tab
// ---------------------------------------------------------------------

function CauseListTab() {
  const [listDate, setListDate] = useState(today());
  const rows = useQuery(api.knowledge.listCauseList, { listDate });
  const importRows = useMutation(api.knowledge.importCauseList);
  const linkRow = useMutation(api.knowledge.linkCauseListRow);
  const matters = useQuery(api.matters.list);

  const [showImport, setShowImport] = useState(false);
  const [sourceName, setSourceName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [linkFor, setLinkFor] = useState<string | null>(null);
  const [linkMatter, setLinkMatter] = useState("");

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-900">
        <strong>Manual import.</strong> Cause lists here were entered by your
        chamber from a published source — Advokate does not fetch live court
        data. Each row records who imported it, when, and from where.
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="cl-date" className="text-xs">List date</Label>
          <Input
            id="cl-date"
            type="date"
            value={listDate}
            onChange={(e) => setListDate(e.target.value)}
            className="h-8"
          />
        </div>
        <Button size="sm" onClick={() => setShowImport(true)}>
          Import rows for this date
        </Button>
      </div>

      {rows === undefined ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-serif text-lg">No cause-list rows for {d(new Date(`${listDate}T12:00:00+05:30`).getTime())}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Import rows from the published PDF or webpage of the court
              website for this date.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Case</TableHead>
                <TableHead>Court</TableHead>
                <TableHead>Linked matter</TableHead>
                <TableHead>Source · checked</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r._id}>
                  <TableCell className="text-xs">{r.itemNumber ?? "—"}</TableCell>
                  <TableCell>
                    <p className="text-sm">{r.caseTitle}</p>
                    {r.caseNumber && (
                      <p className="text-xs text-muted-foreground">{r.caseNumber}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{r.court}</TableCell>
                  <TableCell className="text-xs">
                    {r.matterId
                      ? `${r.matterReference} — ${r.matterTitle}`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.sourceName}
                    {r.sourceUrl && (
                      <>
                        {" · "}
                        <a
                          href={r.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                        >
                          link
                        </a>
                      </>
                    )}
                    <br />
                    {r.checkedByName} · {dt(r.checkedAt)}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        setLinkFor(r._id);
                        setLinkMatter(r.matterId ?? "");
                      }}
                    >
                      {r.matterId ? "Relink" : "Link matter"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Link dialog */}
      <Dialog open={!!linkFor} onOpenChange={(v) => !v && setLinkFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">Link to a matter</DialogTitle>
            <DialogDescription>
              Linking records the listing in the matter's chronology,
              attributed to the manual import source.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="link-matter" className="text-xs">Matter</Label>
              <select
                id="link-matter"
                value={linkMatter}
                onChange={(e) => setLinkMatter(e.target.value)}
                className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="">— Not linked —</option>
                {matters?.map((m) => (
                  <option key={m._id} value={m._id}>
                    {m.reference} — {m.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setLinkFor(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={async () => {
                  if (!linkFor) return;
                  setBusy(true);
                  try {
                    await linkRow({
                      rowId: linkFor as never,
                      matterId: (linkMatter || undefined) as never,
                    });
                    toast.success(linkMatter ? "Linked — chronology updated." : "Link removed.");
                    setLinkFor(null);
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Could not link.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import dialog */}
      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif">
              Import cause-list rows — {d(new Date(`${listDate}T12:00:00+05:30`).getTime())}
            </DialogTitle>
            <DialogDescription>
              One case per line: <code>Item no | Case title | Case number | Court</code>.
              Case title is required; the rest are optional.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="cl-src" className="text-xs">Source name (required)</Label>
                <Input
                  id="cl-src"
                  value={sourceName}
                  onChange={(e) => setSourceName(e.target.value)}
                  placeholder="e.g. Delhi High Court website"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cl-url" className="text-xs">Source URL</Label>
                <Input
                  id="cl-url"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://…"
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cl-raw" className="text-xs">Rows</Label>
              <Textarea
                id="cl-raw"
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                rows={8}
                className="font-mono text-xs"
                placeholder={"1 | ABC Ltd v. State | W.P.(C) 1234/2026 | High Court of Delhi\n2 | …"}
              />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {raw
                  ? `${raw.split("\n").filter((l) => l.trim().includes("|")).length} row(s) detected`
                  : "Pipe-separated lines; extra columns are ignored."}
              </p>
              <Button
                size="sm"
                disabled={busy || !sourceName.trim() || !raw.trim()}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const parsed = raw
                      .split("\n")
                      .map((line) => line.split("|").map((c) => c.trim()))
                      .filter((cols) => cols.length >= 2 && cols[1])
                      .map((cols) => ({
                        itemNumber: cols[0] && cols[0] !== "" ? cols[0] : undefined,
                        caseTitle: cols[1],
                        caseNumber: cols[2] || undefined,
                        court: cols[3] || "",
                      }));
                    const res = await importRows({
                      listDate,
                      rows: parsed,
                      sourceName,
                      sourceUrl: sourceUrl || undefined,
                    });
                    toast.success(`${res.imported} row(s) imported.`);
                    setShowImport(false);
                    setRaw("");
                    setSourceName("");
                    setSourceUrl("");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Import failed.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Import
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------
// Court updates tab
// ---------------------------------------------------------------------

function UpdatesTab() {
  const updates = useQuery(api.knowledge.listCourtUpdates);
  const add = useMutation(api.knowledge.addCourtUpdate);

  const [show, setShow] = useState(false);
  const [kind, setKind] = useState("circular");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [court, setCourt] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-900">
        <strong>Manually recorded.</strong> These updates were noted by your
        chamber from published sources — they are not synchronized from any
        live court feed.
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShow(true)}>
          Record an update
        </Button>
      </div>

      {updates === undefined ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
      ) : updates.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-serif text-lg">No court updates recorded</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Record circulars, notifications, rosters and holidays that affect
              your practice, each with its source and the date it was checked.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {updates.map((u) => (
            <Card key={u._id}>
              <CardContent className="space-y-1 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="bg-secondary text-secondary-foreground border-border">
                    {UPDATE_LABELS[u.kind] ?? u.kind}
                  </Badge>
                  <p className="font-serif text-base">{u.title}</p>
                </div>
                {u.detail && (
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{u.detail}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {u.court ? `${u.court} · ` : ""}
                  {u.effectiveFrom ? `effective ${u.effectiveFrom} · ` : ""}
                  source: {u.sourceName}
                  {u.sourceUrl && (
                    <>
                      {" · "}
                      <a
                        href={u.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        link
                      </a>
                    </>
                  )}
                  {" · checked "}
                  {u.checkedByName}, {dt(u.checkedAt)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={show} onOpenChange={setShow}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif">Record a court update</DialogTitle>
            <DialogDescription>
              Label it accurately: a manual note from a published source, with
              the date it was checked.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="cu-kind" className="text-xs">Kind</Label>
                <select
                  id="cu-kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
                >
                  {Object.entries(UPDATE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="cu-court" className="text-xs">Court</Label>
                <Input
                  id="cu-court"
                  value={court}
                  onChange={(e) => setCourt(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="cu-title" className="text-xs">Title</Label>
                <Input
                  id="cu-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="cu-detail" className="text-xs">Detail</Label>
                <Textarea
                  id="cu-detail"
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  rows={4}
                  className="text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cu-eff" className="text-xs">Effective from</Label>
                <Input
                  id="cu-eff"
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cu-src" className="text-xs">Source name (required)</Label>
                <Input
                  id="cu-src"
                  value={sourceName}
                  onChange={(e) => setSourceName(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="cu-url" className="text-xs">Source URL</Label>
                <Input
                  id="cu-url"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={busy || !title.trim() || !sourceName.trim()}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await add({
                      kind: kind as never,
                      title,
                      detail: detail || undefined,
                      court: court || undefined,
                      effectiveFrom: effectiveFrom || undefined,
                      sourceName,
                      sourceUrl: sourceUrl || undefined,
                    });
                    toast.success("Update recorded.");
                    setShow(false);
                    setTitle("");
                    setDetail("");
                    setCourt("");
                    setEffectiveFrom("");
                    setSourceName("");
                    setSourceUrl("");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Could not record.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Record
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
