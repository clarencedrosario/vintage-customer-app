// =====================================================================
// §32 Phase 4 — Research evidence bundles (matter file → Review tab).
// Bundles are created from AI research jobs (existing flow, /research);
// this panel lists the matter's bundles, shows their citation manifests
// with validation flags, and records review status (freeze/supersede).
// =====================================================================
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { FolderArchive, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { S32Empty, S32Loading, S32Note, errMessage } from "@/components/s32/shared";
import { formatDateTimeIN } from "@/lib/format";

type Citation = {
  stableKey: string;
  sourceTitle?: string;
  sourceVersion?: number;
  anchor?: string;
  quote?: string;
  retrievedAt?: number;
  integrityHash?: string;
  validation?: {
    sourceExists: boolean;
    quoteVerified: boolean;
    problem?: string;
  };
};

type BundleRow = {
  _id: string;
  title: string;
  question: string;
  answer: string;
  jurisdiction: string;
  coverageNote: string;
  unresolvedQuestions: string[];
  citations: Citation[];
  status?: string;
  createdAt: number;
};

type Manifest = {
  label: string;
  title: string;
  jurisdiction: string;
  citations: {
    stableKey: string;
    sourceTitle?: string;
    sourceVersion?: number;
    anchor?: string;
    integrityHash?: string;
    validation?: { sourceExists: boolean; quoteVerified: boolean; problem?: string };
    exportedAs: "full_text" | "reference";
  }[];
  omitted: string[];
};

const STATUS_TONE: Record<string, "default" | "secondary" | "outline"> = {
  draft: "secondary",
  finalized: "default",
  superseded: "outline",
};

export function EvidenceBundlesPanel({ matterId }: { matterId: Id<"matters"> }) {
  const bundles = useQuery(api.evidenceBundles.listForMatter, { matterId });
  const setReviewFn = useMutation(api.evidenceBundles.setReview);
  const [manifestFor, setManifestFor] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const manifest = useQuery(
    api.evidenceBundles.manifest,
    manifestFor ? { bundleId: manifestFor as Id<"researchBundles"> } : "skip",
  );

  const setReview = async (
    bundleId: string,
    status: "draft" | "finalized" | "superseded",
  ) => {
    setBusyId(bundleId);
    try {
      await setReviewFn({ bundleId: bundleId as Id<"researchBundles">, status });
      toast.success(
        status === "finalized"
          ? "Bundle finalized — the record is frozen."
          : status === "superseded"
            ? "Bundle marked superseded."
            : "Bundle reopened as draft.",
      );
    } catch (e) {
      toast.error(errMessage(e, "Could not update the bundle."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <FolderArchive className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Research evidence bundles</h3>
      </div>

      <S32Note>
        Bundles freeze the citations a research answer stood on — source key,
        version, pinpoint and integrity hash. Quotation verification does not
        establish that a source supports the conclusion; the manifest is a
        research record, not a certified court record. Full corpus texts are
        never exported (licence-limited): the bundle carries references.
      </S32Note>

      {bundles === undefined ? (
        <S32Loading label="Loading bundles…" />
      ) : bundles.length === 0 ? (
        <S32Empty>
          No evidence bundle exists for this matter yet. Run AI research from the
          matter's AI Studio or the Research workbench, then create a bundle
          from the job to freeze its citations.
        </S32Empty>
      ) : (
        <div className="space-y-3">
          {(bundles as unknown as BundleRow[]).map((b) => {
            const broken = b.citations.filter(
              (c) => c.validation && (!c.validation.sourceExists || !c.validation.quoteVerified),
            );
            return (
              <Card key={b._id}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-sm">{b.title}</CardTitle>
                    <Badge variant={STATUS_TONE[b.status ?? "draft"] ?? "secondary"}>
                      {b.status ?? "draft"}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {b.jurisdiction}
                    </Badge>
                    {broken.length > 0 && (
                      <Badge variant="destructive" className="text-[10px]">
                        {broken.length} citation flag(s)
                      </Badge>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatDateTimeIN(b.createdAt)}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Q: {b.question}
                  </p>
                  <p className="line-clamp-2 text-sm">{b.answer}</p>
                  {b.unresolvedQuestions.length > 0 && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Unresolved: {b.unresolvedQuestions.join(" · ")}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">{b.coverageNote}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => setManifestFor(b._id)}
                    >
                      Citation manifest
                    </Button>
                    {(b.status ?? "draft") !== "finalized" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={busyId === b._id}
                        onClick={() => void setReview(b._id, "finalized")}
                      >
                        {busyId === b._id && <Loader2 className="mr-1 size-3 animate-spin" />}
                        Finalize
                      </Button>
                    )}
                    {(b.status ?? "draft") !== "superseded" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        disabled={busyId === b._id}
                        onClick={() => void setReview(b._id, "superseded")}
                      >
                        Supersede
                      </Button>
                    )}
                    {b.status === "superseded" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        disabled={busyId === b._id}
                        onClick={() => void setReview(b._id, "draft")}
                      >
                        Reopen as draft
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={manifestFor !== null} onOpenChange={(o) => !o && setManifestFor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">Citation manifest</DialogTitle>
            <DialogDescription>
              Every citation with its recorded version, pinpoint and integrity
              hash, plus everything deliberately omitted.
            </DialogDescription>
          </DialogHeader>
          {manifest === undefined ? (
            <S32Loading label="Building manifest…" />
          ) : manifest === null ? (
            <p className="text-sm text-muted-foreground">Bundle not found.</p>
          ) : (
            <div className="space-y-3">
              <S32Note>{(manifest as unknown as Manifest).label}</S32Note>
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {(manifest as unknown as Manifest).citations.map((c) => (
                  <div key={c.stableKey} className="rounded-md border border-border/70 p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm">{c.sourceTitle ?? c.stableKey}</p>
                      {c.sourceVersion !== undefined && (
                        <Badge variant="outline" className="text-[10px]">
                          v{c.sourceVersion}
                        </Badge>
                      )}
                      {c.validation &&
                        (c.validation.sourceExists ? (
                          c.validation.quoteVerified ? (
                            <Badge variant="default" className="text-[10px]">
                              quote verified
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="text-[10px]">
                              quote NOT verified
                            </Badge>
                          )
                        ) : (
                          <Badge variant="destructive" className="text-[10px]">
                            source missing
                          </Badge>
                        ))}
                      <Badge variant="secondary" className="text-[10px]">
                        exported as {c.exportedAs}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {c.anchor ?? "no pinpoint"} ·{" "}
                      {c.integrityHash ? `sha256 ${c.integrityHash.slice(0, 12)}…` : "no hash"}
                      {c.validation?.problem ? ` · ${c.validation.problem}` : ""}
                    </p>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs font-medium">Omitted from the export</p>
                <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                  {(manifest as unknown as Manifest).omitted.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
