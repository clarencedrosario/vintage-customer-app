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
import { useMutation, useQuery } from "convex/react";
import {
  BookOpen,
  ExternalLink,
  FileText,
  Landmark,
  Scale,
  Search,
  StickyNote,
} from "lucide-react";
import { Link } from "react-router";
import { useState } from "react";
import { toast } from "sonner";

type Entry = {
  _id: string;
  kind: "precedent" | "template" | "research_note" | "authority";
  title: string;
  state: "draft" | "approved" | "retired";
  categoryId: string | null;
  tags: string[] | null;
  sourceUrl: string | null;
  currentVersion: number;
  authorName: string | null;
  categoryName: string | null;
};

const KIND_META: Record<string, { label: string; icon: typeof Scale }> = {
  precedent: { label: "Precedent", icon: Landmark },
  template: { label: "Template", icon: FileText },
  research_note: { label: "Research note", icon: StickyNote },
  authority: { label: "Saved authority", icon: Scale },
};

export default function Research() {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [state, setState] = useState("approved");
  const [authoring, setAuthoring] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newKind, setNewKind] = useState("research_note");
  const [newSourceUrl, setNewSourceUrl] = useState("");

  const entries = useQuery(api.knowledge.list, {
    search: search || undefined,
    kind: kind === "all" ? undefined : (kind as Entry["kind"]),
    state: state as "draft" | "approved" | "retired" | "all",
  }) as Entry[] | undefined;

  const categories = useQuery(api.knowledge.listCategories) as
    | { _id: string; name: string }[]
    | undefined;

  const create = useMutation(api.knowledge.create);

  const submit = async () => {
    try {
      await create({
        kind: newKind as Entry["kind"],
        title: newTitle,
        body: newBody,
        sourceUrl: newSourceUrl || undefined,
      });
      toast.success("Saved as draft. Approve it from Knowledge & courts when ready.");
      setAuthoring(false);
      setNewTitle("");
      setNewBody("");
      setNewSourceUrl("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    }
  };

  return (
    <ChamberShell
      subtitle="The Digital Chamber"
      title="Legal Research"
      actions={
        <Button size="sm" variant="outline" onClick={() => setAuthoring((s) => !s)}>
          {authoring ? "Close" : "New note or authority"}
        </Button>
      }
    >
      <div className="space-y-5">
        <Card className="rule-frame bg-card">
          <CardContent className="p-4 text-xs text-muted-foreground">
            <p className="flex items-start gap-2">
              <BookOpen className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                Legal research here searches your chamber's own library —
                precedents, templates, research notes and saved authorities,
                each with authors, versions and source links. Advokate does
                not pretend to search live case-law databases: a genuine
                research integration would be a separate, clearly-labelled
                connection.
              </span>
            </p>
          </CardContent>
        </Card>

        {authoring && (
          <Card className="rule-frame bg-card">
            <CardContent className="space-y-3 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="res-kind">Type</Label>
                  <Select value={newKind} onValueChange={setNewKind}>
                    <SelectTrigger id="res-kind">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="research_note">Research note</SelectItem>
                      <SelectItem value="authority">Saved authority</SelectItem>
                      <SelectItem value="precedent">Precedent</SelectItem>
                      <SelectItem value="template">Template</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="res-url">Source link (optional)</Label>
                  <Input
                    id="res-url"
                    value={newSourceUrl}
                    onChange={(e) => setNewSourceUrl(e.target.value)}
                    placeholder="https://… judgment, gazette or source"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="res-title">Title</Label>
                  <Input
                    id="res-title"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="e.g. K.S. Puttaswamy — privacy principles relied on"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="res-body">Text</Label>
                  <textarea
                    id="res-body"
                    rows={4}
                    value={newBody}
                    onChange={(e) => setNewBody(e.target.value)}
                    placeholder="The proposition, the holding, and why it matters for your matters."
                    className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <Button size="sm" onClick={submit} disabled={!newTitle.trim() || newBody.trim().length < 5}>
                Save as draft
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search titles and text…"
              className="pl-9"
              aria-label="Search the research library"
            />
          </div>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="w-44" aria-label="Filter by type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="precedent">Precedents</SelectItem>
              <SelectItem value="template">Templates</SelectItem>
              <SelectItem value="research_note">Research notes</SelectItem>
              <SelectItem value="authority">Saved authorities</SelectItem>
            </SelectContent>
          </Select>
          <Select value={state} onValueChange={setState}>
            <SelectTrigger className="w-40" aria-label="Filter by state">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="retired">Retired</SelectItem>
              <SelectItem value="all">All states</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {entries === undefined ? (
          <p className="text-sm text-muted-foreground">Retrieving…</p>
        ) : entries.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center text-sm ink-faded">
              Nothing in the library matches. Save precedents, research notes
              and authorities here and they stay versioned and attributed.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {entries.map((e) => {
              const meta = KIND_META[e.kind];
              const Icon = meta?.icon ?? StickyNote;
              return (
                <Card key={e._id} className="rule-frame bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 type-label ink-faded">
                        <Icon className="size-3.5" aria-hidden="true" />
                        {meta?.label ?? e.kind}
                        {e.categoryName ? ` · ${e.categoryName}` : ""}
                      </p>
                      <p className="mt-0.5 font-serif text-lg font-semibold">
                        {e.title}
                      </p>
                    </div>
                    <Badge
                      variant={
                        e.state === "approved"
                          ? "secondary"
                          : e.state === "retired"
                            ? "outline"
                            : "default"
                      }
                    >
                      {e.state === "approved"
                        ? `v${e.currentVersion} approved`
                        : e.state}
                    </Badge>
                  </div>
                  {(e.tags ?? []).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(e.tags ?? []).map((t) => (
                        <Badge key={t} variant="outline" className="text-xs">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      {e.authorName ? `By ${e.authorName}` : ""}
                      {e.sourceUrl ? " · source available" : ""}
                    </span>
                    <div className="flex gap-2">
                      <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                        <Link to="/knowledge">Open in Knowledge</Link>
                      </Button>
                      {e.sourceUrl && (
                        <a
                          href={e.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs text-[#8a6a33] underline underline-offset-4"
                        >
                          <ExternalLink className="size-3.5" aria-hidden="true" />
                          Source
                        </a>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </ChamberShell>
  );
}
