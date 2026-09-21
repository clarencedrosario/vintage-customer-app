import { ChamberShell } from "@/components/ChamberShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import { formatDateTimeIN } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import {
  BellOff,
  CalendarClock,
  ClipboardList,
  Clock,
  Eye,
  FileText,
  Gavel,
  Receipt,
  RotateCcw,
  ScrollText,
  TriangleAlert,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

const KIND_META: Record<
  string,
  { label: string; icon: typeof Gavel; tone: string }
> = {
  hearing_today: { label: "Today's hearing", icon: Gavel, tone: "text-[#B68A45]" },
  prep_gap: { label: "Awaiting preparation", icon: FileText, tone: "text-[#B68A45]" },
  deadline: { label: "Deadline", icon: TriangleAlert, tone: "text-red-700" },
  client_message: { label: "Client message", icon: ScrollText, tone: "text-[#4f6b8f]" },
  missing_document: { label: "Missing document", icon: FileText, tone: "text-[#4f6b8f]" },
  order_unreviewed: { label: "Order to review", icon: ScrollText, tone: "text-[#8a6d3b]" },
  overdue_task: { label: "Overdue task", icon: TriangleAlert, tone: "text-red-700" },
  invoice_attention: { label: "Invoice", icon: Receipt, tone: "text-[#8a6d3b]" },
  draft_invoice: { label: "Draft invoice", icon: Receipt, tone: "text-muted-foreground" },
};

type FeedItem = {
  kind: string;
  itemId: string;
  matterId?: string;
  matterReference: string | null;
  title: string;
  reason: string;
  date: number;
  responsible: string;
  action: { label: string; tab?: string };
  critical?: boolean;
};

export default function Attention() {
  const feed = useQuery(api.attention.feed);
  const hidden = useQuery(api.attention.hiddenItems);
  const dismiss = useMutation(api.attention.dismiss);
  const snooze = useMutation(api.attention.snooze);
  const restore = useMutation(api.attention.restore);
  const restoreAll = useMutation(api.attention.restoreAll);

  const [kindFilter, setKindFilter] = useState("all");
  const [personFilter, setPersonFilter] = useState("all");
  const [sort, setSort] = useState("critical");
  const [showHidden, setShowHidden] = useState(false);
  const [busyItem, setBusyItem] = useState<string | null>(null);

  const people = useMemo(() => {
    const set = new Set<string>();
    (feed?.items ?? []).forEach((i) => set.add(i.responsible));
    return Array.from(set).sort();
  }, [feed]);

  const items = useMemo(() => {
    let list = [...(feed?.items ?? [])] as FeedItem[];
    if (kindFilter !== "all") list = list.filter((i) => i.kind === kindFilter);
    if (personFilter !== "all")
      list = list.filter((i) => i.responsible === personFilter);
    list.sort((a, b) => {
      if (sort === "date") return a.date - b.date;
      if (sort === "matter")
        return (a.matterReference ?? "").localeCompare(b.matterReference ?? "");
      const crit = Number(b.critical ?? false) - Number(a.critical ?? false);
      if (crit !== 0) return crit;
      return a.date - b.date;
    });
    return list;
  }, [feed, kindFilter, personFilter, sort]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (feed?.items ?? []).forEach((i) => {
      c[i.kind] = (c[i.kind] ?? 0) + 1;
    });
    return c;
  }, [feed]);

  const act = async (
    itemId: string,
    fn: () => Promise<void>,
    message: string,
  ) => {
    setBusyItem(itemId);
    try {
      await fn();
      toast.success(message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusyItem(null);
    }
  };

  return (
    <ChamberShell
      subtitle="The Digital Chamber"
      title="Morning docket"
      actions={
        <Button
          size="sm"
          variant="ghost"
          className="gap-1.5"
          onClick={() => setShowHidden((v) => !v)}
        >
          <Eye className="size-4" aria-hidden="true" />
          {showHidden ? "Hide dismissed" : "Show dismissed"}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        What needs your attention today — computed live from the matters you
        are authorized to see.
      </p>

      {/* Controls */}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="w-48">
          <p className="type-label ink-faded mb-1.5">Show</p>
          <Select value={kindFilter} onValueChange={setKindFilter}>
            <SelectTrigger aria-label="Filter by kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                All items{feed ? ` (${feed.items.length})` : ""}
              </SelectItem>
              {Object.entries(KIND_META).map(([kind, meta]) =>
                counts[kind] ? (
                  <SelectItem key={kind} value={kind}>
                    {meta.label} ({counts[kind]})
                  </SelectItem>
                ) : null,
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="w-44">
          <p className="type-label ink-faded mb-1.5">Responsible</p>
          <Select value={personFilter} onValueChange={setPersonFilter}>
            <SelectTrigger aria-label="Filter by responsible person">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everyone</SelectItem>
              {people.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-44">
          <p className="type-label ink-faded mb-1.5">Sort</p>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger aria-label="Sort items">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="critical">Critical first</SelectItem>
              <SelectItem value="date">Earliest date</SelectItem>
              <SelectItem value="matter">By matter</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {feed && feed.hiddenCount > 0 && (
          <p className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <BellOff className="size-3.5" aria-hidden="true" />
            {feed.hiddenCount} hidden
            {feed.totalComputed - feed.hiddenCount <= 0 &&
              feed.totalComputed > 0 &&
              " — everything else is clear"}
          </p>
        )}
      </div>

      {/* Items */}
      {feed === undefined ? (
        <p className="mt-8 text-sm text-muted-foreground">
          Assembling your docket…
        </p>
      ) : feed === null ? (
        <p className="mt-8 text-sm text-muted-foreground">
          Sign in and select an organization to see your docket.
        </p>
      ) : items.length === 0 ? (
        <Card className="mt-6 border-dashed">
          <CardContent className="py-14 text-center">
            <CalendarClock className="mx-auto size-10 text-muted-foreground" />
            <h2 className="mt-5 font-serif text-2xl font-semibold">
              Nothing needs your attention
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              {feed.hiddenCount > 0
                ? "Everything on the docket is dismissed or snoozed. Restore items below if something was hidden by mistake."
                : "The docket is clear. Hearings, deadlines and messages will appear here as they arise."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="mt-6 space-y-3">
          {items.map((i) => {
            const meta = KIND_META[i.kind] ?? KIND_META.order_unreviewed!;
            const Icon = meta.icon;
            return (
              <div
                key={i.itemId}
                className={`rule-frame rounded-lg bg-card p-4 ${
                  i.critical ? "border-l-4 border-l-red-700" : ""
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Icon className={`size-4 ${meta.tone}`} aria-hidden="true" />
                      <span className="type-label ink-faded">{meta.label}</span>
                      {i.critical && (
                        <span className="stamp text-red-700">critical</span>
                      )}
                    </div>
                    <p className="mt-1.5 font-serif text-lg font-semibold leading-snug">
                      {i.title}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {i.reason}
                    </p>
                    <p className="type-label mt-1.5 ink-faded">
                      {i.matterReference} · {formatDateTimeIN(i.date)} ·
                      Responsible: {i.responsible}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <Button asChild size="sm">
                      <Link to={`/matters/${i.matterId}${i.action.tab ? `?tab=${i.action.tab}` : ""}`}>
                        {i.action.label}
                      </Link>
                    </Button>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyItem === i.itemId}
                        onClick={() =>
                          act(
                            i.itemId,
                            async () => {
                              await snooze({ itemId: i.itemId, hours: 24 });
                            },
                            "Snoozed until tomorrow.",
                          )
                        }
                      >
                        <Clock className="mr-1 size-3.5" aria-hidden="true" />
                        Snooze 24h
                      </Button>
                      {i.critical ? (
                        <span
                          className="type-label ink-faded"
                          title="Critical deadlines cannot be dismissed"
                        >
                          No dismiss
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyItem === i.itemId}
                          onClick={() =>
                            act(
                              i.itemId,
                              async () => {
                                await dismiss({ itemId: i.itemId });
                              },
                              "Dismissed.",
                            )
                          }
                        >
                          <BellOff className="mr-1 size-3.5" aria-hidden="true" />
                          Dismiss
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Hidden items */}
      {showHidden && (
        <section className="mt-10" aria-label="Dismissed and snoozed items">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-serif text-xl font-semibold">
              Dismissed &amp; snoozed
            </h2>
            {(hidden ?? []).length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await restoreAll({});
                    toast.success("All items restored to the docket.");
                  } catch (err) {
                    toast.error(
                      err instanceof Error ? err.message : "Failed.",
                    );
                  }
                }}
              >
                <RotateCcw className="mr-1.5 size-4" aria-hidden="true" />
                Restore all
              </Button>
            )}
          </div>
          <div className="mt-3 space-y-2">
            {hidden === undefined ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : hidden.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing dismissed or snoozed.
              </p>
            ) : (
              hidden.map((h) => {
                const meta = KIND_META[h.itemId.split(":")[0] === "hearing" ? "hearing_today" : h.itemId.split(":")[0] === "message" ? "client_message" : h.itemId.split(":")[0] === "docreq" ? "missing_document" : h.itemId.split(":")[0] === "draft" ? "draft_invoice" : h.itemId.split(":")[0]] ?? null;
                return (
                  <div
                    key={h.itemId}
                    className="rule-frame flex items-center justify-between gap-3 rounded-lg bg-card p-3"
                  >
                    <p className="min-w-0 truncate text-sm">
                      <span className="type-label ink-faded">
                        {meta ? meta.label : "Item"}
                      </span>{" "}
                      {h.itemId}
                    </p>
                    <div className="flex shrink-0 items-center gap-2">
                      {h.snoozedUntil && (
                        <span className="type-label ink-faded">
                          until {formatDateTimeIN(h.snoozedUntil)}
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          try {
                            await restore({ itemId: h.itemId });
                            toast.success("Restored.");
                          } catch (err) {
                            toast.error(
                              err instanceof Error ? err.message : "Failed.",
                            );
                          }
                        }}
                      >
                        <RotateCcw className="mr-1.5 size-3.5" aria-hidden="true" />
                        Restore
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
            <ClipboardList className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            Critical deadlines and overdue tasks can never be dismissed — they
            may only be snoozed until the next day, and they return
            immediately when their data changes.
          </p>
        </section>
      )}
    </ChamberShell>
  );
}
