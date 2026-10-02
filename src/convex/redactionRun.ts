"use node";

// =====================================================================
// §32 PHASE 6 — VERIFIED REDACTION (Node action).
//
// produceVerifiedRedaction is the ONLY path that may label a derivative
// "verified", and it earns the label mechanically:
//   1. format support decided from the document name (UTF-8 text family
//      only — PDFs/images/containers are REFUSED, never boxed-over);
//   2. content guards: binary signature + strict UTF-8 decode + size
//      cap + integrity-record match;
//   3. the derivative bytes are PRODUCED by removing the recorded
//      terms, then RE-SCANNED with the same matcher;
//   4. "verified" is recorded ONLY when every term is provably absent —
//      residue FAILS the job, and a failed job is never labelled;
//   5. the verified derivative is stored as a real object and filed as
//      a vault document (integrity hash + custody + audit), where the
//      existing download/share machinery applies.
// Refusals and failures are recorded with their reasons. Nothing here
// bypasses access checks: the bridge query enforces capability + matter
// + document visibility before the action can read any bytes.
// =====================================================================

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { sha256HexBytes } from "./crypto";
import {
  MAX_SOURCE_BYTES,
  REDACTION_COVERAGE_NOTE,
  allAbsent,
  applyRedactions,
  decodeTextStrict,
  detectBinarySignature,
  formatSupport,
  scanText,
  validateEntries,
  type RedactionRefusalReason,
} from "../lib/redaction";
import { redactionEntryValidator } from "./schemaExtras";

export type RedactionRunResult =
  | { status: "unauthorized" }
  | { status: "refused"; reason: RedactionRefusalReason; detail: string | null }
  | {
      status: "failed";
      verification: { term: string; remaining: number }[];
      detail: string;
    }
  | {
      status: "verified";
      jobId: string;
      derivativeDocumentId: string;
      derivativeName: string;
      derivativeSha256: string;
      derivativeChars: number;
      hits: { term: string; count: number }[];
      verification: { term: string; remaining: number }[];
      coverageNote: string;
    };

export const produceVerifiedRedaction = action({
  args: {
    documentId: v.id("matterDocuments"),
    entries: v.array(redactionEntryValidator),
  },
  handler: async (ctx, args): Promise<RedactionRunResult> => {
    const info = await ctx.runQuery(internal.redaction.redactionSourceInfo, {
      documentId: args.documentId,
    });
    // Unauthorized callers leave NO trail entry — there is no
    // authenticated actor to attribute it to.
    if (!info) return { status: "unauthorized" };

    const refuse = async (
      reason: RedactionRefusalReason,
      detail?: string,
    ): Promise<RedactionRunResult> => {
      await ctx.runMutation(internal.redaction.recordRedactionOutcome, {
        documentId: args.documentId,
        entries: args.entries,
        status: "refused",
        refusalReason: reason,
        refusalDetail: detail,
        hits: [],
        verification: [],
        byId: info.actorId,
        byName: info.actorName,
      });
      return { status: "refused", reason, detail: detail ?? null };
    };

    // 1. Format support — from the document name. Unverifiable formats
    //    are refused outright; a "verified" label is impossible for them
    //    and pretending otherwise would be the classic redaction lie.
    const format = formatSupport(info.name);
    if (!format.supported) return await refuse(format.reason, format.detail);

    if (!info.storageId) {
      return await refuse("no_file", "The document has no stored file.");
    }

    // 2. Read the exact stored bytes.
    let blob: Blob | null = null;
    try {
      blob = await ctx.storage.get(info.storageId);
    } catch {
      return await refuse(
        "storage_read_failed",
        "Reading the stored object failed — nothing was produced.",
      );
    }
    if (!blob) return await refuse("no_file", "Stored object not found.");
    if (blob.size > MAX_SOURCE_BYTES) {
      return await refuse(
        "too_large",
        `Source is ${blob.size} bytes; the verifiable redaction cap is ${MAX_SOURCE_BYTES} bytes.`,
      );
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const observedHash = sha256HexBytes(bytes);

    // 3. The bytes must match the document's integrity record (when one
    //    exists) — never redact a file that does not match its record.
    if (
      info.recordedHash &&
      info.recordedHash.toLowerCase() !== observedHash
    ) {
      return await refuse(
        "source_integrity_mismatch",
        `Stored bytes hash ${observedHash.slice(0, 12)}… differs from the recorded ${info.recordedHash.slice(0, 12)}…. Refusing to redact a file that does not match its integrity record.`,
      );
    }

    // 4. Content guards — catch mislabelled binaries before touching text.
    const binaryLabel = detectBinarySignature(bytes);
    if (binaryLabel) {
      return await refuse(
        "binary_content",
        `File is named "${format.extension}" but its content is ${binaryLabel} — the text family this module can verify. Refused rather than mislabelled.`,
      );
    }
    const text = decodeTextStrict(bytes);
    if (text === null) {
      return await refuse(
        "not_utf8",
        "Bytes are not valid UTF-8 text — removal cannot be verified.",
      );
    }

    // 5. Entry validation (terms, mandatory reasons, caps, duplicates).
    const validated = validateEntries(args.entries);
    if (!validated.ok) {
      return await refuse(
        "invalid_entries",
        `Entries rejected: ${validated.reason}.`,
      );
    }

    // 6. Produce the derivative, then VERIFY by re-scanning it with the
    //    same matcher.
    const { output, hits } = applyRedactions(text, validated.entries);
    const verification = scanText(output, validated.entries);
    if (!allAbsent(verification)) {
      const residue = verification
        .filter((s) => s.remaining > 0)
        .map((s) => `${s.term} (${s.remaining})`)
        .join("; ");
      await ctx.runMutation(internal.redaction.recordRedactionOutcome, {
        documentId: args.documentId,
        entries: validated.entries,
        status: "failed",
        refusalDetail: `Re-scan found residue after replacement: ${residue}. No derivative was produced or labelled verified.`,
        hits,
        verification,
        sourceSha256: observedHash,
        byId: info.actorId,
        byName: info.actorName,
      });
      return {
        status: "failed",
        verification,
        detail: `Re-scan found residue: ${residue}. Nothing was labelled verified.`,
      };
    }

    // 7. Store the derivative as a real object and file it.
    const derivativeBytes = new TextEncoder().encode(output);
    const derivativeSha256 = sha256HexBytes(derivativeBytes);
    const derivativeStorageId = await ctx.storage.store(
      new Blob([output], { type: "text/plain" }),
    );
    const derivativeName = `${info.name.replace(/\.[^./\\]+$/, "")}.redacted.txt`;
    const recorded = await ctx.runMutation(
      internal.redaction.recordRedactionOutcome,
      {
        documentId: args.documentId,
        entries: validated.entries,
        status: "verified",
        hits,
        verification,
        sourceSha256: observedHash,
        derivative: {
          storageId: derivativeStorageId,
          sha256: derivativeSha256,
          chars: output.length,
          name: derivativeName,
        },
        byId: info.actorId,
        byName: info.actorName,
      },
    );
    if (!recorded || !recorded.derivativeDocumentId) {
      return await refuse(
        "storage_read_failed",
        "Derivative was produced but the filing transaction failed — it is NOT recorded as verified.",
      );
    }

    return {
      status: "verified",
      jobId: recorded.jobId,
      derivativeDocumentId: recorded.derivativeDocumentId,
      derivativeName,
      derivativeSha256,
      derivativeChars: output.length,
      hits,
      verification,
      coverageNote: REDACTION_COVERAGE_NOTE,
    };
  },
});
