import { ChamberShell } from "@/components/ChamberShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDateTimeIN, formatDateIN, formatINR } from "@/lib/format";
import { useQuery } from "convex/react";
import { CalendarClock, FileText, Gavel, Receipt } from "lucide-react";
import { Link } from "react-router";

/** One document row; resolves a read URL via its own guarded subscription. */
function ClientDocLink({ documentId }: { documentId: Id<"matterDocuments"> }) {
  const url = useQuery(api.portals.clientDocumentUrl, { documentId });
  if (!url) return <span className="type-label ink-faded">—</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="type-label text-primary hover:underline"
    >
      Open
    </a>
  );
}

export default function ClientPortal() {
  const data = useQuery(api.portals.clientPortal);

  if (data === undefined) {
    return (
      <ChamberShell subtitle="Client Portal" title="Your matters">
        <p className="text-sm text-muted-foreground">Opening your file…</p>
      </ChamberShell>
    );
  }

  if (data === null) {
    return (
      <ChamberShell subtitle="Client Portal" title="Your matters">
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <FileText className="mx-auto size-10 text-muted-foreground" />
            <h2 className="mt-6 font-serif text-2xl font-semibold">
              No portal access yet
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Your lawyer connects client accounts to their matters. If you
              received an invitation link, open it while signed in with the
              invited email.
            </p>
            <Button asChild variant="outline" className="mt-6">
              <Link to="/login">Choose another portal</Link>
            </Button>
            <p className="mt-4 text-xs ink-faded">
              Expecting access? Ask your lawyer to send an invitation to this
              email address.
            </p>
          </CardContent>
        </Card>
      </ChamberShell>
    );
  }

  const statusLabels: Record<string, { label: string; cls: string }> = {
    open: { label: "Open", cls: "text-blue-700" },
    in_progress: { label: "In progress", cls: "text-[#8a6a33]" },
    on_hold: { label: "On hold", cls: "text-muted-foreground" },
    closed: { label: "Closed", cls: "text-emerald-700" },
  };

  return (
    <ChamberShell subtitle="Client Portal" title={`Welcome, ${data.client.name}`}>
      {/* Matters */}
      <p className="type-label ink-faded">Your matters</p>
      <div className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Reference</th>
              <th>Matter</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.matters.map((m) => {
              const s = statusLabels[m.status] ?? { label: m.status, cls: "" };
              return (
                <tr key={m._id}>
                  <td className="whitespace-nowrap font-medium">{m.reference}</td>
                  <td>
                    <p className="font-serif text-base font-semibold">{m.title}</p>
                    {m.court ? (
                      <p className="text-xs text-muted-foreground">{m.court}</p>
                    ) : null}
                  </td>
                  <td>
                    <span className={`stamp ${s.cls}`}>
                      {s.label}
                    </span>
                    </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Hearings */}
      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <section aria-label="Upcoming hearings">
          <p className="type-label ink-faded flex items-center gap-2">
            <Gavel className="size-3.5" /> Upcoming hearings
          </p>
          <div className="mt-3 space-y-3">
            {data.hearings.length === 0 ? (
              <p className="text-sm ink-faded">No hearings listed.</p>
            ) : (
              data.hearings.map((h) => (
                <div key={h._id} className="rule-frame rounded-lg p-4">
                  <p className="text-sm font-medium">{h.title}</p>
                  <p className="type-label mt-1 ink-faded">
                    {formatDateTimeIN(h.at)}
                    {h.court ? ` · ${h.court}` : ""}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Invoices */}
        <section aria-label="Invoices">
          <p className="type-label ink-faded flex items-center gap-2">
            <Receipt className="size-3.5" /> Invoices
          </p>
          <div className="mt-3 space-y-3">
            {data.invoices.length === 0 ? (
              <p className="text-sm ink-faded">No invoices.</p>
            ) : (
              data.invoices.map((inv) => (
                <div
                  key={inv._id}
                  className="rule-frame flex items-center justify-between gap-4 rounded-lg p-4"
                >
                  <div>
                    <p className="text-sm font-medium">{inv.number}</p>
                    <p className="type-label mt-1 ink-faded">
                      {formatDateIN(inv.issuedOn)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-serif font-semibold">{formatINR(inv.total)}</p>
                    <p className="type-label ink-faded">{inv.status.replace("_", " ")}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* Documents */}
      <section aria-label="Documents shared with you" className="mt-10">
        <p className="type-label ink-faded flex items-center gap-2">
          <FileText className="size-3.5" /> Documents shared with you
        </p>
        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
          {data.documents.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm ink-faded">
              No documents shared yet.
            </p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Kind</th>
                  <th>Filed</th>
                  <th className="text-right">—</th>
                </tr>
              </thead>
              <tbody>
                {data.documents.map((d) => (
                  <tr key={d._id}>
                    <td className="max-w-[280px] truncate">{d.name}</td>
                    <td className="type-label ink-faded">{d.kind}</td>
                    <td className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTimeIN(d.createdAt)}
                    </td>
                    <td className="text-right">
                      {d.storageId ? <ClientDocLink documentId={d._id} /> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Recent activity */}
      <section aria-label="Recent activity" className="mt-10">
        <p className="type-label ink-faded flex items-center gap-2">
          <CalendarClock className="size-3.5" /> Recent activity
        </p>
        <ol className="mt-3 space-y-2">
          {data.events.slice(0, 12).map((e) => (
            <li key={e._id} className="rule-frame rounded-lg p-3">
              <p className="text-sm">{e.detail}</p>
              <p className="type-label mt-1 ink-faded">{formatDateTimeIN(e.createdAt)}</p>
            </li>
          ))}
        </ol>
      </section>
    </ChamberShell>
  );
}
