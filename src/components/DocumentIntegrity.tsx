import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { Fingerprint, ScrollText, ShieldCheck, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { shortHash } from "@/lib/evidenceIntegrity";

/**
 * Inline chip on a document row: shows the recorded SHA-256 (short form),
 * an honest "no hash" state for legacy uploads, a Verify button that
 * re-hashes the stored bytes server-side, and a custody-trail dialog.
 */
export function DocumentIntegrityChip({
  documentId,
  integritySha256,
}: {
  documentId: Id<"matterDocuments">;
  integritySha256?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const record = useQuery(
    api.evidence.custody,
    open ? { documentId } : "skip",
  );
  const verify = useAction(api.evidenceVerify.verifyDocumentIntegrity);
  const addNote = useMutation(api.evidence.addCustodyNote);
  const [note, setNote] = useState("");

  const short = shortHash(integritySha256 ?? undefined);

  const runVerify = async () => {
    setBusy(true);
    try {
      const result = await verify({ documentId });
      if (result.ok === true) {
        toast.success("Integrity verified — hash matches.");
      } else if ("reason" in result && result.reason === "no_recorded_hash") {
        toast.info("No recorded hash for this upload — cannot verify.");
      } else if ("reason" in result && result.reason === "crypto_unavailable") {
        toast.error("Server hashing unavailable — nothing was fabricated.");
      } else if ("reason" in result) {
        toast.error(
          result.reason === "file_missing"
            ? "Stored file missing — verify failed."
            : result.reason === "no_file"
              ? "This record has no file attached."
              : "Verification could not run.",
        );
      } else {
        toast.error("INTEGRITY MISMATCH — stored bytes differ from record.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        className="type-label inline-flex items-center gap-1 ink-faded hover:text-foreground"
        onClick={() => setOpen(true)}
        title="Integrity & custody"
      >
        <Fingerprint className="h-3.5 w-3.5" aria-hidden="true" />
        {short ?? "no hash"}
      </button>

      {short && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          disabled={busy}
          onClick={runVerify}
        >
          <ShieldCheck className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Verify
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif">
              Integrity &amp; chain of custody
            </DialogTitle>
            <DialogDescription>
              {integritySha256 ? (
                <>
                  Recorded SHA-256:{" "}
                  <code className="break-all text-[10px]">
                    {integritySha256}
                  </code>
                </>
              ) : (
                "No hash recorded for this document (uploaded before integrity tracking or hash unavailable at upload)."
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-72 space-y-2 overflow-y-auto">
            {record === undefined ? (
              <p className="text-sm ink-faded">Loading…</p>
            ) : (record?.custody ?? []).length === 0 ? (
              <p className="text-sm ink-faded">No custody events recorded.</p>
            ) : (
              (record?.custody ?? [])
                .slice()
                .reverse()
                .map((e, i) => (
                  <div
                    key={`${e.at}-${i}`}
                    className={`rounded border p-2 text-xs ${
                      e.action === "integrity_mismatch"
                        ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
                        : "border-border bg-muted/30"
                    }`}
                  >
                    {e.action === "integrity_mismatch" && (
                      <ShieldAlert className="mb-1 h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    <span className="type-label ink-faded">
                      {new Date(e.at).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                    <p>
                      {e.byName ?? "System"} · {e.action}
                      {e.note ? ` — ${e.note}` : ""}
                    </p>
                  </div>
                ))
            )}
          </div>

          <div className="flex gap-2">
            <input
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              placeholder="Add custody note (e.g. original marked exhibit A)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={!note.trim() || busy}
              onClick={async () => {
                try {
                  await addNote({ documentId, note });
                  setNote("");
                  toast.success("Custody note added.");
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : "Could not add note.",
                  );
                }
              }}
            >
              <ScrollText className="mr-1 h-4 w-4" aria-hidden="true" />
              Note
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </span>
  );
}
