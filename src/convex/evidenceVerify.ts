"use node";

// Node runtime: crypto.subtle (webcrypto) is guaranteed here, so the
// verification action can genuinely re-hash stored bytes. Convex allows
// only actions in "use node" modules, so the internal query/mutation
// bridges (docForVerification / recordVerification) live in evidence.ts
// (V8) and are invoked through internal.* references — the same
// module-split pattern as github.ts + githubStore.ts.

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { isValidSha256Hex, sha256Hex } from "../lib/evidenceIntegrity";

export type VerificationResult =
  | {
      ok: false;
      reason:
        | "unauthorized"
        | "no_file"
        | "no_recorded_hash"
        | "bad_recorded_hash"
        | "file_missing"
        | "crypto_unavailable";
    }
  | { ok: boolean; observedHash: string };

/**
 * Re-hash the stored object and compare against the recorded integrity
 * hash. Authorization is enforced inside docForVerification (the action
 * itself cannot reach the db or auth context directly). A missing
 * recorded hash is reported honestly — the document predates integrity
 * tracking or the browser could not hash at upload; nothing is
 * fabricated.
 */
export const verifyDocumentIntegrity = action({
  args: { documentId: v.id("matterDocuments") },
  handler: async (ctx, args): Promise<VerificationResult> => {
    const info = await ctx.runQuery(internal.evidence.docForVerification, {
      documentId: args.documentId,
    });
    if (!info) return { ok: false, reason: "unauthorized" };
    if (!info.storageId) return { ok: false, reason: "no_file" };
    if (!info.recordedHash) return { ok: false, reason: "no_recorded_hash" };
    if (!isValidSha256Hex(info.recordedHash))
      return { ok: false, reason: "bad_recorded_hash" };

    const blob = await ctx.storage.get(info.storageId);
    if (!blob) return { ok: false, reason: "file_missing" };

    let observed: string;
    try {
      observed = await sha256Hex(await blob.arrayBuffer());
    } catch {
      // WebCrypto unavailable in this runtime — reported honestly
      // rather than fabricating a verification result.
      return { ok: false, reason: "crypto_unavailable" };
    }

    const ok = observed === info.recordedHash;
    await ctx.runMutation(internal.evidence.recordVerification, {
      documentId: args.documentId,
      ok,
      observedHash: observed,
      byId: info.actorId,
      byName: info.actorName,
    });
    return { ok, observedHash: observed };
  },
});
