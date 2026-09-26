import { ChamberShell } from "@/components/ChamberShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { Bot, FileWarning, ShieldAlert, Sparkles } from "lucide-react";
import { Link } from "react-router";
import { useMemo, useState } from "react";

type AiJob = {
  _id: string;
  matterId: string;
  kind: string;
  status: "pending" | "done" | "failed" | "expired";
  result: string | null;
  structured: unknown;
  error: string | null;
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  requestedById: string;
  createdAt: number;
  completedAt: number | null;
};

type MatterLite = {
  _id: string;
  reference: string;
  title: string;
  status: string;
  nextHearingAt?: number;
  clientName?: string | null;
};

const KIND_LABELS: Record<string, string> = {
  summary: "Document summary",
  xray: "Case X-Ray",
  chronology: "Chronology suggestions",
  issues: "Issues & missing information",
  hearing_prep: "Hearing preparation",
  draft: "Draft notice / letter / pleading",
  client_comm: "Client communication draft",
  grounded_qa: "Grounded questions",
  opposition: "Opposition analysis",
  evidence_map: "Evidence map",
  assertion_review: "Assertion review",
  voice_note: "Voice note",
  ask_matter: "Ask My Matter",
  ask_document: "Ask This Document",
  smart_timeline: "Smart Timeline",
  compare: "Document comparison",
  morning_briefing: "Morning briefing",
  legal_research: "Legal research",
  email_summary: "Email summary",
  email_reply: "Email reply draft",
};

export default function AdvokateAI() {
  const matters = useQuery(api.matters.list) as MatterLite[] | undefined;
  const usage = useQuery(api.ai.usage) as
    | { monthKey: string; tokens: number; limit: number; jobs: number; remaining: number }
    | undefined;

  // Show the open matters most likely to be worked on.
  const open = useMemo(
    () =>
      (matters ?? [])
        .filter((m) => m.status !== "closed" && m.status !== "archived")
        .slice(0, 12),
    [matters],
  );

  const [selected, setSelected] = useState<string | null>(null);
  const activeMatter = selected ?? open[0]?._id ?? null;

  const jobs = useQuery(
    api.ai.listJobs,
    activeMatter ? { matterId: activeMatter as never, limit: 12 } : "skip",
  ) as AiJob[] | undefined;

  return (
    <ChamberShell
      subtitle="The Digital Chamber"
      title="Advokate AI"
      actions={
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <Sparkles className="size-3.5" aria-hidden="true" />
          Draft — professional review required
        </span>
      }
    >
      <div className="space-y-5">
        <Card className="rule-frame bg-card">
          <CardContent className="space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">Draft — Professional Review Required</Badge>
              <p className="text-xs text-muted-foreground">
                Advokate AI works only from documents you explicitly select.
                It distinguishes facts, allegations, inferences and legal
                arguments; it does not invent cases or citations, and it
                never promises outcomes. Nothing is filed or sent anywhere
                without a lawyer's approval.
              </p>
            </div>
            {usage && (
              <p className="text-xs text-muted-foreground">
                Usage this month ({usage.monthKey}): {usage.tokens.toLocaleString()} of{" "}
                {usage.limit.toLocaleString()} tokens across {usage.jobs} job(s) —{" "}
                {usage.remaining.toLocaleString()} remaining.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          {/* Matter picker */}
          <div className="space-y-2">
            <p className="type-label ink-faded">Choose a matter</p>
            {matters === undefined ? (
              <p className="text-sm text-muted-foreground">Retrieving…</p>
            ) : open.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No open matters. Open a matter to use AI tools on it.
              </p>
            ) : (
              open.map((m) => (
                <button
                  key={m._id}
                  type="button"
                  onClick={() => setSelected(m._id)}
                  aria-pressed={activeMatter === m._id}
                  className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                    activeMatter === m._id
                      ? "border-[#B68A45] bg-[#B68A45]/10"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  <p className="type-label ink-faded">{m.reference}</p>
                  <p className="truncate text-sm font-medium">{m.title}</p>
                </button>
              ))
            )}
          </div>

          {/* Jobs for the selected matter */}
          <div className="space-y-3">
            {activeMatter ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-serif text-lg font-semibold">
                    <Bot className="mr-2 inline size-4" aria-hidden="true" />
                    Saved AI requests
                  </h2>
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/matters/${activeMatter}?tab=ai`}>
                      Open the AI Studio
                    </Link>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  The AI Studio inside the matter handles source selection,
                  extraction review and every kind of request — summaries,
                  Case X-Ray, chronology, evidence map, hearing preparation,
                  drafting and voice notes. This page lists the saved
                  history.
                </p>
                {jobs === undefined ? (
                  <p className="text-sm text-muted-foreground">Retrieving…</p>
                ) : jobs.length === 0 ? (
                  <Card className="border-dashed">
                    <CardContent className="py-8 text-center text-sm ink-faded">
                      No AI requests on this matter yet. Open the AI Studio to
                      select authorized sources and run your first request.
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {jobs.map((j) => (
                      <Card key={j._id} className="rule-frame bg-card p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">
                            {KIND_LABELS[j.kind] ?? j.kind}
                          </Badge>
                          <Badge
                            variant={
                              j.status === "done"
                                ? "secondary"
                                : j.status === "failed"
                                  ? "destructive"
                                  : "outline"
                            }
                          >
                            {j.status === "done"
                              ? "Completed"
                              : j.status === "pending"
                                ? "Running"
                                : j.status === "failed"
                                  ? "Failed"
                                  : "Expired"}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(j.createdAt).toLocaleString("en-IN", {
                              timeZone: "Asia/Kolkata",
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                            {j.model ? ` · ${j.model}` : ""}
                            {j.promptTokens !== null
                              ? ` · ${(j.promptTokens + (j.completionTokens ?? 0)).toLocaleString()} tokens`
                              : ""}
                          </span>
                        </div>
                        {j.status === "done" && j.result && (
                          <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap font-serif text-sm">
                            {j.result}
                          </pre>
                        )}
                        {j.status === "failed" && (
                          <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
                            <ShieldAlert className="size-3.5" aria-hidden="true" />
                            {j.error ?? "The request failed and can be retried."}
                          </p>
                        )}
                        {j.status === "expired" && (
                          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <FileWarning className="size-3.5" aria-hidden="true" />
                            Timed out without a result. Retry from the AI
                            Studio.
                          </p>
                        )}
                      </Card>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Select a matter to see its saved AI history.
              </p>
            )}
          </div>
        </div>
      </div>
    </ChamberShell>
  );
}
