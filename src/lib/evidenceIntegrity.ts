/**
 * Evidence integrity — hashing and chain-of-custody helpers.
 *
 * The hash is computed by the uploader's browser over the exact bytes
 * sent to object storage and recorded on the document row. Server-side
 * re-verification (independent of the browser claim) is provided by the
 * `verifyDocumentIntegrity` action in src/convex/evidence.ts, which
 * re-hashes the stored object and appends a custody event with the
 * result. What this is NOT: a signed audit of who handled a paper
 * original — it is an integrity record for files in Advokate's storage.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * SHA-256 of file bytes as lowercase hex. Runs in the browser
 * (WebCrypto) and on the server (Node webcrypto) — both expose
 * crypto.subtle.digest("SHA-256", …).
 */
export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes =
    data instanceof Uint8Array
      ? data
      : new Uint8Array(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** A recorded integrity hash must be 64 lowercase hex characters. */
export function isValidSha256Hex(hash: string | undefined | null): boolean {
  return typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash);
}

/** Short display form: first 12 hex chars with an ellipsis. */
export function shortHash(hash: string | undefined | null): string | null {
  return isValidSha256Hex(hash) ? `${(hash as string).slice(0, 12)}…` : null;
}

// ---------------------------------------------------------------------
// Chain-of-custody events
// ---------------------------------------------------------------------

export const CUSTODY_ACTIONS = [
  "filed", // uploaded by a firm member
  "submitted_by_client", // arrived through the client portal
  "accepted_from_request", // accepted from a document-request checklist
  "imported", // data-import batch
  "downloaded", // secure download link issued/redeemed (no token material stored)
  "integrity_verified", // server re-hash matched the recorded hash
  "integrity_mismatch", // server re-hash DIFFERED — surfaced for review
  "version_added", // new version filed (vault)
  "restored", // an earlier version restored
  "redaction_derivative", // verified redaction derivative produced (§32 Phase 6)
  "note", // manual custody note
] as const;

export type CustodyAction = (typeof CUSTODY_ACTIONS)[number];

export type CustodyEvent<IdType = string> = {
  at: number;
  byId?: IdType;
  byName?: string;
  action: CustodyAction;
  note?: string;
};

/** Default IST day label for custody listings. */
export function custodyDay(ts: number): string {
  return new Date(ts + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function describeCustodyEvent(e: CustodyEvent): string {
  const who = e.byName ?? "System";
  const when = new Date(e.at).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const what =
    e.action === "filed"
      ? "Filed to the matter"
      : e.action === "submitted_by_client"
        ? "Submitted by client"
        : e.action === "accepted_from_request"
          ? "Accepted from document request"
          : e.action === "imported"
            ? "Imported"
            : e.action === "downloaded"
              ? "Secure download issued"
              : e.action === "integrity_verified"
                ? "Integrity verified (hash matches)"
                : e.action === "integrity_mismatch"
                  ? "INTEGRITY MISMATCH — stored file hash differs from record"
                  : e.action === "version_added"
                    ? "New version filed"
                    : e.action === "restored"
                      ? "Earlier version restored"
                      : e.action === "redaction_derivative"
                        ? "Verified redaction derivative produced"
                        : "Custody note";
  return `${what} — ${who} · ${when}${e.note ? ` · ${e.note}` : ""}`;
}

/**
 * Append a custody event. The trail is capped (oldest events fall off)
 * so a heavily-shared document cannot grow its row without bound; the
 * org audit log remains the complete record for consequential actions.
 */
export function appendCustody<IdType = string>(
  trail: CustodyEvent<IdType>[] | undefined,
  event: CustodyEvent<IdType>,
  max = 200,
): CustodyEvent<IdType>[] {
  return [...(trail ?? []), event].slice(-max);
}
