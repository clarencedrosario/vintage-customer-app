import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDateIN, formatDateTimeIN, formatINR } from "@/lib/format";
import {
  emptyStateFor,
  classifyUrgency,
  invoiceUrgency,
  urgencyClass,
  urgencyStamp,
  canSeeSection,
  COMMAND_CENTRE_SECTIONS,
} from "@/lib/commandCentre";
import {
  AlertTriangle,
  CalendarClock,
  ClipboardCheck,
  FileText,
  Gavel,
  History,
  Inbox,
  ListChecks,
  Loader2,
  MessageSquare,
  Receipt,
  Scale,
  ScrollText,
} from "lucide-react";
import { Link } from "react-router";
import { useQuery } from "convex/react";

/**
 * Case Command Centre (Feature 1) — the per-matter situation board.
 *
 * One aggregate subscription (commandCentre.matterOverview) feeds every
 * section. Access is enforced server-side: the viewer gets `null` for
 * cross-tenant / out-of-team matters and sections arrive pre-gated by
 * capability, so the client only decides how to render, never what to
 * reveal. Every row links to its authorized underlying record.
 */
export function CommandCentre({ matterId }: { matterId: Id<"matters"> }) {
  const overview = useQuery(api.commandCentre.matterOverview, { matterId });
  const caps = useQuery(api.workspace.myCapabilities);

  if (overview === undefined) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Assembling the matter at a glance…
      </div>
    );
  }

  if (overview === null) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        This matter is not on the chamber's record.
      </div>
    );
  }

  const financial = overview.financial;
  const urgentCount =
    overview.deadlines.overdueCount + overview.tasks.overdueCount;
  const fmtMoney = (minor: number) => formatINR(minor / 100);

  const sectionLink = (tab: string, label: string) => (
    <Link
      to={`/matters/${matterId}?tab=${tab}`}
      className="type-label text-primary hover:underline"
    >
      {label}
    </Link>
  );

  return (
    <div className="space-y-6">
      {/* Header strip — matter identity */}
      <div className="rule-frame rounded-lg bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="type-label ink-faded">
              {overview.matter.reference} · {overview.matter.practiceArea}
            </p>
            <h2 className="mt-1 font-serif text-xl font-semibold">
              {overview.matter.title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {overview.matter.clientName}
              </span>
              {overview.matter.court ? ` · ${overview.matter.court}` : ""}
              {overview.matter.caseNumber ? ` · ${overview.matter.caseNumber}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-serif">
              {overview.matter.status.replace("_", " ")}
            </Badge>
            {overview.matter.priority !== "normal" && (
              <Badge
                variant={overview.matter.priority === "urgent" ? "destructive" : "secondary"}
                className={overview.matter.priority === "urgent" ? "bg-red-700 text-white" : ""}
              >
                {overview.matter.priority.toUpperCase()} PRIORITY
              </Badge>
            )}
            {urgentCount > 0 && (
              <Badge variant="destructive" className="bg-red-700 text-white">
                <AlertTriangle className="mr-1 size-3" aria-hidden="true" />
                {urgentCount} overdue item{urgentCount === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
        </div>
        <div className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <p className="text-muted-foreground">
            <span className="type-label ink-faded">Lead lawyer</span>{" "}
            {overview.matter.leadLawyerName ?? <span className="ink-faded">Unassigned</span>}
          </p>
          <p className="text-muted-foreground">
            <span className="type-label ink-faded">Assigned team</span>{" "}
            {overview.matter.teamNames.length > 0
              ? overview.matter.teamNames.join(", ")
              : <span className="ink-faded">Whole chamber</span>}
          </p>
          <p className="text-muted-foreground">
            <span className="type-label ink-faded">Client's responsible lawyer</span>{" "}
            {overview.matter.clientResponsibleName ?? "—"}
          </p>
          <p className="text-muted-foreground">
            <span className="type-label ink-faded">Team restriction</span>{" "}
            {overview.matter.restrictedToTeam ? "Restricted to team" : "Open to chamber"}
          </p>
        </div>
      </div>

      {/* Next hearing strip */}
      {overview.nextHearing && (
        <div
          className={`rule-frame rounded-lg bg-card p-4 ${
            overview.nextHearingUpdateDue ? "border-red-700/40" : ""
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="type-label ink-faded">Next hearing</p>
              <p
                className={`text-sm font-medium ${
                  overview.nextHearingUpdateDue ? "text-red-700" : ""
                }`}
              >
                {overview.nextHearing.title} ·{" "}
                {formatDateTimeIN(overview.nextHearing.at)}
                {overview.nextHearing.court ? ` · ${overview.nextHearing.court}` : ""}
                {overview.nextHearingUpdateDue
                  ? " · date passed — schedule the next date"
                  : ""}
              </p>
            </div>
            {sectionLink("hearings", "Open hearings →")}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Deadlines */}
        <Card className="rule-frame">
          <CardContent className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="type-label ink-faded flex items-center gap-2">
                <CalendarClock className="size-4" aria-hidden="true" /> Deadlines
              </p>
              {sectionLink("docket", "All deadlines →")}
            </div>
            {overview.deadlines.overdue.length === 0 &&
            overview.deadlines.upcoming.length === 0 ? (
              <EmptyBlock id="deadlines" />
            ) : (
              <ul className="space-y-2">
                {overview.deadlines.overdue.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link
                      to={`/matters/${matterId}?tab=docket`}
                      className="min-w-0 truncate font-medium text-red-700 hover:underline"
                    >
                      {d.title}
                    </Link>
                    <span className={`type-label shrink-0 ${urgencyClass("overdue")}`}>
                      {formatDateIN(d.dueAt)} · {urgencyStamp("overdue", d.dueAt, overview.now)}
                    </span>
                  </li>
                ))}
                {overview.deadlines.upcoming.map((d) => {
                  const u = classifyUrgency(d.dueAt, overview.now);
                  return (
                    <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                      <Link
                        to={`/matters/${matterId}?tab=docket`}
                        className="min-w-0 truncate hover:underline"
                      >
                        {d.title}
                      </Link>
                      <span className={`type-label shrink-0 ${urgencyClass(u)}`}>
                        {formatDateIN(d.dueAt)}
                        {u === "urgent" ? ` · ${urgencyStamp(u, d.dueAt, overview.now)}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Tasks */}
        <Card className="rule-frame">
          <CardContent className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="type-label ink-faded flex items-center gap-2">
                <ListChecks className="size-4" aria-hidden="true" /> Open tasks
                {overview.tasks.openCount > 0 && (
                  <span className="ink-faded">({overview.tasks.openCount})</span>
                )}
              </p>
              {sectionLink("tasks", "Task desk →")}
            </div>
            {overview.tasks.overdue.length === 0 &&
            overview.tasks.soon.length === 0 &&
            overview.tasks.pendingApproval.length === 0 ? (
              <EmptyBlock id="tasks" />
            ) : (
              <ul className="space-y-2">
                {overview.tasks.overdue.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link to="/tasks" className="min-w-0 truncate font-medium text-red-700 hover:underline">
                      {t.title}
                    </Link>
                    <span className="type-label shrink-0 text-red-700">
                      {t.dueAt
                        ? `${formatDateIN(t.dueAt)} · ${urgencyStamp("overdue", t.dueAt, overview.now)}`
                        : "No due date"}
                    </span>
                  </li>
                ))}
                {overview.tasks.soon.map((t) => {
                  const u = classifyUrgency(t.dueAt ?? undefined, overview.now);
                  return (
                    <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
                      <Link to="/tasks" className="min-w-0 truncate hover:underline">
                        {t.title}
                        {t.priority !== "normal" && (
                          <Badge variant="outline" className="ml-2 type-label">
                            {t.priority}
                          </Badge>
                        )}
                      </Link>
                      <span className={`type-label shrink-0 ${urgencyClass(u)}`}>
                        {t.dueAt ? formatDateIN(t.dueAt) : "No due date"}
                        {u === "urgent" && t.dueAt
                          ? ` · ${urgencyStamp(u, t.dueAt, overview.now)}`
                          : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {overview.tasks.pendingApproval.length > 0 && (
              <div className="mt-3 rounded border border-[#8a6a33]/30 bg-[#8a6a33]/5 p-2">
                <p className="type-label text-[#8a6a33]">
                  {overview.tasks.pendingApprovalCount} automated task
                  {overview.tasks.pendingApprovalCount === 1 ? "" : "s"} pending review
                </p>
                {overview.tasks.pendingApproval.map((t) => (
                  <Link key={t.id} to="/tasks" className="mt-1 block truncate text-sm hover:underline">
                    {t.title}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent chronology */}
        <Card className="rule-frame">
          <CardContent className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="type-label ink-faded flex items-center gap-2">
                <ScrollText className="size-4" aria-hidden="true" /> Recent chronology
              </p>
              {sectionLink("docket", "Full docket →")}
            </div>
            {overview.chronology.length === 0 ? (
              <EmptyBlock id="chronology" />
            ) : (
              <ul className="space-y-2">
                {overview.chronology.map((e) => (
                  <li key={e.id} className="text-sm">
                    <p className="truncate">
                      {e.visibility !== "shared_with_client" && (
                        <Badge variant="outline" className="mr-1 type-label">
                          internal
                        </Badge>
                      )}
                      {e.detail ?? e.kind}
                    </p>
                    <p className="type-label mt-1 ink-faded">{formatDateTimeIN(e.at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Documents awaiting review */}
        <Card className="rule-frame">
          <CardContent className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="type-label ink-faded flex items-center gap-2">
                <FileText className="size-4" aria-hidden="true" /> Documents awaiting review
              </p>
              {sectionLink("documents", "Document room →")}
            </div>
            {overview.documentsAwaitingReview.length === 0 ? (
              <EmptyBlock id="documents" />
            ) : (
              <ul className="space-y-2">
                {overview.documentsAwaitingReview.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link
                      to={`/matters/${matterId}?tab=documents`}
                      className="min-w-0 truncate hover:underline"
                    >
                      {d.name}
                    </Link>
                    <span className="type-label shrink-0 ink-faded">{formatDateIN(d.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Client requests */}
        <Card className="rule-frame">
          <CardContent className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="type-label ink-faded flex items-center gap-2">
                <Inbox className="size-4" aria-hidden="true" /> Client requests
              </p>
              {sectionLink("requests", "Request checklist →")}
            </div>
            {overview.clientRequests.length === 0 ? (
              <EmptyBlock id="requests" />
            ) : (
              <ul className="space-y-2">
                {overview.clientRequests.map((r) => {
                  const overdue = r.dueAt !== null && r.dueAt < overview.now;
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                      <Link
                        to={`/matters/${matterId}?tab=requests`}
                        className="min-w-0 truncate hover:underline"
                      >
                        {r.title}
                      </Link>
                      <span className={`type-label shrink-0 ${overdue ? "text-red-700" : ""}`}>
                        {r.status.replace("_", " ")}
                        {r.dueAt ? ` · due ${formatDateIN(r.dueAt)}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Latest client communication + update-due flag */}
        <Card className="rule-frame">
          <CardContent className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="type-label ink-faded flex items-center gap-2">
                <MessageSquare className="size-4" aria-hidden="true" /> Latest client communication
              </p>
              {sectionLink("notes", "Notes →")}
            </div>
            {overview.latestClientContact ? (
              <div>
                <p className="truncate text-sm">{overview.latestClientContact.preview}</p>
                <p className="type-label mt-1 ink-faded">
                  {formatDateTimeIN(overview.latestClientContact.at)} · via{" "}
                  {overview.latestClientContact.kind}
                </p>
              </div>
            ) : (
              <EmptyBlock id="communication" />
            )}
            {overview.updateDue && (
              <div className="mt-3 rounded border border-[#8a6a33]/30 bg-[#8a6a33]/5 p-2">
                <p className="text-sm text-[#8a6a33]">
                  <AlertTriangle className="mr-1 inline size-4" aria-hidden="true" />
                  Client update due — the client has not heard from the chamber since the latest
                  activity on the file.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Financial strip — server-gated (null without billing capabilities) */}
      {financial && (
        <div className="grid gap-6 lg:grid-cols-2">
          {financial.canSeeInvoices && (
            <Card className="rule-frame">
              <CardContent className="p-5">
                <div className="mb-3 flex items-center justify-between">
                  <p className="type-label ink-faded flex items-center gap-2">
                    <Receipt className="size-4" aria-hidden="true" /> Outstanding invoices
                  </p>
                  {sectionLink("invoices", "Billing →")}
                </div>
                {financial.outstandingInvoices.length === 0 ? (
                  <EmptyBlock id="invoices" />
                ) : (
                  <ul className="space-y-2">
                    {financial.outstandingInvoices.map((inv) => {
                      const u = invoiceUrgency(
                        {
                          status: inv.status,
                          totalMinor: inv.totalMinor,
                          amountPaidMinor: inv.amountPaidMinor,
                          amountCreditedMinor: undefined,
                          dueOn: inv.dueOn ?? undefined,
                        },
                        overview.now,
                      );
                      return (
                        <li key={inv.id} className="flex items-center justify-between gap-2 text-sm">
                          <Link
                            to={`/matters/${matterId}?tab=invoices`}
                            className={`min-w-0 truncate hover:underline ${urgencyClass(u)}`}
                          >
                            {inv.number} · {fmtMoney(inv.outstandingMinor)}
                          </Link>
                          <span className={`type-label shrink-0 ${urgencyClass(u)}`}>
                            {inv.status.replace("_", " ")}
                            {inv.dueOn ? ` · due ${formatDateIN(inv.dueOn)}` : ""}
                          </span>
                        </li>
                      );
                    })}
                    {financial.outstandingTotalMinor > 0 && (
                      <li className="border-t pt-2 text-sm font-medium">
                        Total outstanding{" "}
                        <span className="float-right">
                          {fmtMoney(financial.outstandingTotalMinor)}
                        </span>
                      </li>
                    )}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          {financial.canSeePayments && (
            <Card className="rule-frame">
              <CardContent className="p-5">
                <div className="mb-3 flex items-center justify-between">
                  <p className="type-label ink-faded flex items-center gap-2">
                    <Receipt className="size-4" aria-hidden="true" /> Recent payments
                  </p>
                  {sectionLink("invoices", "Billing →")}
                </div>
                {financial.recentPayments.length === 0 ? (
                  <EmptyBlock id="payments" />
                ) : (
                  <ul className="space-y-2">
                    {financial.recentPayments.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate">Against {p.invoiceNumber}</span>
                        <span className="type-label shrink-0 ink-faded">
                          {fmtMoney(p.amountMinor)} · {formatDateIN(p.receivedOn)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Undertakings — open court-order deadlines + outstanding directions */}
        <Card className="rule-frame">
          <CardContent className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="type-label ink-faded flex items-center gap-2">
                <Scale className="size-4" aria-hidden="true" /> Undertakings
              </p>
              {sectionLink("orders", "Orders & directions →")}
            </div>
            {overview.undertakings.register.length === 0 &&
            overview.undertakings.deadlines.length === 0 &&
            overview.undertakings.directions.length === 0 ? (
              <EmptyBlock id="undertakings" />
            ) : (
              <ul className="space-y-2">
                {overview.undertakings.register.map((u) => {
                  const urgency = classifyUrgency(
                    u.dueAt === null ? undefined : u.dueAt,
                    overview.now,
                  );
                  return (
                    <li key={u.id} className="flex items-center justify-between gap-2 text-sm">
                      <Link
                        to={`/undertakings?focus=${u.id}`}
                        className="min-w-0 truncate hover:underline"
                      >
                        {u.text}
                      </Link>
                      <span
                        className={`type-label shrink-0 ${
                          u.breached
                            ? "text-red-700 font-medium"
                            : urgencyClass(urgency)
                        }`}
                      >
                        {u.breached
                          ? "breached"
                          : u.status === "completed_pending_verification"
                            ? "awaiting verification"
                            : u.dueAt === null
                              ? "no due date"
                              : formatDateIN(u.dueAt)}
                        {" · "}
                        {u.direction === "given" ? "given" : "received"}
                      </span>
                    </li>
                  );
                })}
                {overview.undertakings.deadlines.map((d) => {
                  const u = classifyUrgency(d.dueAt, overview.now);
                  return (
                    <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                      <Link
                        to={`/matters/${matterId}?tab=orders`}
                        className="min-w-0 truncate hover:underline"
                      >
                        {d.title}
                      </Link>
                      <span className={`type-label shrink-0 ${urgencyClass(u)}`}>
                        {formatDateIN(d.dueAt)} · court order
                      </span>
                    </li>
                  );
                })}
                {overview.undertakings.directions.map((d) => (
                  <li
                    key={`${d.orderId}-${d.index}`}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <Link
                      to={`/matters/${matterId}?tab=orders`}
                      className="min-w-0 truncate hover:underline"
                    >
                      {d.text}
                    </Link>
                    <span className="type-label shrink-0 ink-faded">direction outstanding</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Hearing Pack status */}
        <Card className="rule-frame">
          <CardContent className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="type-label ink-faded flex items-center gap-2">
                <Gavel className="size-4" aria-hidden="true" /> Hearing Pack
              </p>
              {sectionLink("hearings", "Build / download →")}
            </div>
            {overview.hearingPack ? (
              <div>
                <p className="text-sm">{overview.hearingPack.label}</p>
                <p className="type-label mt-1 ink-faded">
                  {overview.hearingPack.includeInternal
                    ? "Includes internal material"
                    : "Client-shared copy (internal excluded)"}
                  {" · "}
                  {formatDateIN(overview.hearingPack.createdAt)}
                </p>
              </div>
            ) : (
              <EmptyBlock id="pack" />
            )}
            {overview.recentHearings.length > 0 && (
              <ul className="mt-3 space-y-1">
                {overview.recentHearings.map((h) => (
                  <li key={h.id} className="text-sm">
                    <p className="truncate">
                      {h.title}
                      {h.outcome ? ` — ${h.outcome.slice(0, 90)}` : ""}
                    </p>
                    <p className="type-label ink-faded">{formatDateTimeIN(h.at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Risks */}
        <Card className="rule-frame">
          <CardContent className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="type-label ink-faded flex items-center gap-2">
                <ClipboardCheck className="size-4" aria-hidden="true" /> Risks
              </p>
              {sectionLink("issues", "Evidence & issues →")}
            </div>
            {overview.risks.openIssues.length === 0 && overview.risks.unreviewedOrders === 0 ? (
              <EmptyBlock id="risks" />
            ) : (
              <ul className="space-y-2">
                {overview.risks.openIssues.map((i) => (
                  <li key={i.id} className="text-sm">
                    <Link
                      to={`/matters/${matterId}?tab=issues`}
                      className="truncate hover:underline"
                    >
                      {i.title}
                    </Link>
                    {i.detail && (
                      <p className="type-label mt-1 ink-faded">{i.detail.slice(0, 90)}</p>
                    )}
                  </li>
                ))}
                {overview.risks.unreviewedOrders > 0 && (
                  <li className="text-sm">
                    <Link to={`/matters/${matterId}?tab=orders`} className="hover:underline">
                      {overview.risks.unreviewedOrders} order
                      {overview.risks.unreviewedOrders === 1 ? "" : "s"} awaiting review
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Audit — capability-gated client-side; server returns null otherwise */}
        {canSeeSection(COMMAND_CENTRE_SECTIONS.audit, caps?.capabilities) && (
          <Card className="rule-frame">
            <CardContent className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="type-label ink-faded flex items-center gap-2">
                  <History className="size-4" aria-hidden="true" /> Recent audit activity
                </p>
                {sectionLink("audit", "Full audit trail →")}
              </div>
              {overview.audit === null || overview.audit.length === 0 ? (
                <EmptyBlock id="audit" />
              ) : (
                <ul className="space-y-2">
                  {overview.audit.map((a) => (
                    <li key={a.id} className="text-sm">
                      <p className="truncate">
                        {a.action}
                        {a.detail ? ` — ${a.detail}` : ""}
                      </p>
                      <p className="type-label mt-1 ink-faded">
                        {a.actorName} · {formatDateTimeIN(a.at)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function EmptyBlock({ id }: { id: string }) {
  const state = emptyStateFor(id);
  return (
    <div className="rounded border border-dashed p-4 text-center">
      <p className="text-sm ink-faded">{state.message}</p>
      {state.hint ? <p className="type-label mt-1 ink-faded">{state.hint}</p> : null}
    </div>
  );
}
