import { ChamberShell } from "@/components/ChamberShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/convex/_generated/api";
import { formatDateTimeIN } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import { CheckCircle2, ClipboardList, FileText, FolderOpen } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";

export default function StaffPortal() {
  const data = useQuery(api.portals.staffPortal);
  const completeTask = useMutation(api.portals.completeTask);

  if (data === undefined) {
    return (
      <ChamberShell subtitle="Staff Portal" title="Your assigned work">
        <p className="text-sm text-muted-foreground">Fetching your tasks…</p>
      </ChamberShell>
    );
  }

  const pending = data.tasks.filter((t) => t.status === "pending");
  const done = data.tasks.filter((t) => t.status === "done");

  return (
    <ChamberShell subtitle="Staff Portal" title="Your assigned work">
      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <section aria-label="Assigned tasks">
          <p className="type-label ink-faded flex items-center gap-2">
            <ClipboardList className="size-3.5" /> Assigned tasks
          </p>
          <div className="mt-3 space-y-3">
            {pending.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-10 text-center text-sm ink-faded">
                  Nothing assigned right now.
                </CardContent>
              </Card>
            ) : (
              pending.map((t) => (
                <div
                  key={t._id}
                  className="rule-frame flex items-center justify-between gap-4 rounded-lg p-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{t.title}</p>
                    <p className="type-label mt-1 ink-faded">
                      {t.dueAt
                        ? `Due ${formatDateTimeIN(t.dueAt)}`
                        : "No due date"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await completeTask({ taskId: t._id });
                        toast.success("Marked done.");
                      } catch (err) {
                        toast.error(
                          err instanceof Error ? err.message : "Failed.",
                        );
                      }
                    }}
                  >
                    <CheckCircle2 className="mr-1.5 size-4" />
                    Mark done
                  </Button>
                </div>
              ))
            )}

            {done.length > 0 && (
              <details className="rule-frame rounded-lg p-4">
                <summary className="cursor-pointer text-sm font-medium">
                  Completed ({done.length})
                </summary>
                <ul className="mt-3 space-y-2">
                  {done.map((t) => (
                    <li key={t._id} className="text-sm text-muted-foreground">
                      ✓ {t.title}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </section>

        <div className="space-y-8">
          <section aria-label="Matters involved">
            <p className="type-label ink-faded flex items-center gap-2">
              <FolderOpen className="size-3.5" /> Matters involved
            </p>
            <div className="mt-3 space-y-2">
              {data.matters.length === 0 ? (
                <p className="text-sm ink-faded">—</p>
              ) : (
                data.matters.map((m) => (
                  <Link
                    key={m._id}
                    to={`/matters/${m._id}`}
                    className="rule-frame block rounded-lg p-3 hover:shadow-sm"
                  >
                    <p className="text-sm font-medium">{m.title}</p>
                    <p className="type-label mt-0.5 ink-faded">{m.reference}</p>
                  </Link>
                ))
              )}
            </div>
          </section>

          <section aria-label="Shared documents">
            <p className="type-label ink-faded flex items-center gap-2">
              <FileText className="size-3.5" /> Shared documents
            </p>
            <div className="mt-3 space-y-2">
              {data.documents.length === 0 ? (
                <p className="text-sm ink-faded">—</p>
              ) : (
                data.documents.map((d) => (
                  <div key={d._id} className="rule-frame rounded-lg p-3">
                    <p className="truncate text-sm">{d.name}</p>
                    <p className="type-label mt-0.5 ink-faded">
                      {formatDateTimeIN(d.createdAt)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </ChamberShell>
  );
}
